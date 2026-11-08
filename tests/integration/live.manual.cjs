'use strict';

/**
 * Live checks against api.mangabaka.org — run by hand, never in CI (Plan-2026Q4-tracker-plugin-standardization,
 * Phase 4: "the manual integration tests are kept and run once"). Read-only: nothing here writes to the library.
 *
 *   ENABLE_REAL_SEARCH_TEST=1 [MB_TEST_SEARCH_QUERY="..."] npm run test:integration
 *   ENABLE_REAL_LIBRARY_TEST=1 MB_TEST_API_KEY=mb-... npm run test:integration
 *
 * The plugin is built exactly as the host builds it; its HTTP client is Node's fetch behind an axios-shaped
 * adapter, so the run needs no dependency.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { locateTracker } = require('../../scripts/build-runtime-plugin-package.cjs');

const tracker = locateTracker();
const descriptor = require(path.join(tracker.dir, `plugin-${tracker.id}.cjs`));
const settings = JSON.parse(fs.readFileSync(path.join(tracker.dir, `${tracker.id}-api-settings.values.json`), 'utf8')).settings;

const searchSkip = process.env.ENABLE_REAL_SEARCH_TEST !== '1' || process.env.CI === 'true';
const librarySkip = process.env.ENABLE_REAL_LIBRARY_TEST !== '1' || process.env.CI === 'true' || !process.env.MB_TEST_API_KEY;

/** An axios-shaped client over fetch: request(config) → { status, data, headers }, throws with `response` ≥ 400. */
const fetchAxios = {
    /** @param {Record<string, any>} config */
    async request(config) {
        const url = new URL(config.url);
        for (const [key, value] of Object.entries(config.params || {})) if (value !== undefined) url.searchParams.set(key, String(value));
        const hasBody = config.data !== undefined && config.data !== null;
        const response = await fetch(url, {
            method: String(config.method || 'get').toUpperCase(),
            headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...(config.headers || {}) },
            body: hasBody ? JSON.stringify(config.data) : undefined,
            signal: config.signal || AbortSignal.timeout(config.timeout || 30000),
        });
        const headers = Object.fromEntries(response.headers.entries());
        const data = config.responseType === 'arraybuffer'
            ? Buffer.from(await response.arrayBuffer())
            : (headers['content-type'] || '').includes('json') ? await response.json() : await response.text();
        const out = { status: response.status, data, headers, config };
        if (response.status >= 400) {
            const error = new Error(`Request failed with status code ${response.status}`);
            /** @type {any} */ (error).response = out;
            throw error;
        }
        return out;
    },
};

async function plugin() {
    return descriptor.WrapperClass.init({ context: { utils: {}, http: fetchAxios, cache: null }, serviceSettings: settings });
}

/** @param {unknown} credential @param {string} scope */
const context = (credential, scope) => ({ credential, identity: `manual-${scope}`, scope, signal: null });

test('live: search answers candidates with a 0–1 confidence and a canonical URL', { skip: searchSkip }, async () => {
    const instance = await plugin();
    const results = await instance.search(process.env.MB_TEST_SEARCH_QUERY || 'Frieren', undefined, context(null, 'system'));
    assert.ok(results.length > 0, 'at least one candidate');
    for (const r of results) {
        assert.ok(r.confidence >= 0 && r.confidence <= 1);
        assert.match(String(r.canonicalUrl), /^https:\/\/mangabaka\.org\//);
    }
    const detail = await instance.lookup(results[0].pluginEntryId, context(null, 'system'));
    assert.equal(detail.pluginEntryId, results[0].pluginEntryId);
    const summary = await instance.summarizeEntries([results[0].pluginEntryId], context(null, 'system'));
    assert.equal(summary[0].success, true);
    console.log(`search: ${results.length} candidates; first '${results[0].title}' (${results[0].pluginEntryId}), status ${summary[0].summary.status}`);
});

test('live: the token tests good, and the whole library comes back with MangaBaka\'s own state tokens', { skip: librarySkip }, async () => {
    const instance = await plugin();
    const credential = { api_key: process.env.MB_TEST_API_KEY };
    assert.equal(await instance.testCredentials(credential), true);
    const list = await instance.getReadingList(context(credential, 'user'));
    const tokens = new Set(list.map((/** @type {any} */ e) => e.status));
    for (const token of tokens) {
        if (token !== null) assert.ok(token in tracker.manifest.syncOptions.statusVocabulary.pull, `'${token}' is in the pull table`);
    }
    console.log(`library: ${list.length} entries (more than 12 proves pagination), states seen: ${[...tokens].join(', ')}`);
});
