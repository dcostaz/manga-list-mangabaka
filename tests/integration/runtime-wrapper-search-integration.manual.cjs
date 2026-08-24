'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MangaBakaAPIWrapper = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-wrapper-mangabaka.cjs',
));
const { buildEffectiveSettingsDocument } = require(path.join(__dirname, '..', '..', 'scripts', 'build-runtime-plugin-package.cjs'));

const shouldSkip = process.env.ENABLE_REAL_SEARCH_TEST !== '1' || process.env.CI === 'true';

function createFetchHttpClient() {
  return {
    interceptors: { response: { use() { return 0; } } },
    async get(url, config = {}) {
      const params = config && config.params ? new URLSearchParams(config.params).toString() : '';
      const fullUrl = params ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url;
      const response = await fetch(fullUrl, { headers: config.headers || {} });
      const rawText = await response.text();
      let data = null;
      try { data = rawText ? JSON.parse(rawText) : null; } catch (_error) { data = rawText; }
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), data };
    },
  };
}

test(
  'interactive search integration - fetches live MangaBaka search results and a series detail (no auth needed)',
  {
    skip: shouldSkip && 'Set ENABLE_REAL_SEARCH_TEST=1 and run locally (not CI).',
    timeout: 60000,
  },
  async () => {
    const query = typeof process.env.MB_TEST_SEARCH_QUERY === 'string' && process.env.MB_TEST_SEARCH_QUERY.trim()
      ? process.env.MB_TEST_SEARCH_QUERY.trim()
      : 'Dice';

    process.stdout.write(`[search-test] Querying MangaBaka for: ${query}\n`);

    const effectiveSettings = buildEffectiveSettingsDocument();
    const wrapper = await MangaBakaAPIWrapper.init({
      serviceSettings: effectiveSettings.settings,
      httpClient: createFetchHttpClient(),
    });

    const results = await wrapper.search(query, { forceRefresh: true });
    assert.ok(Array.isArray(results), 'search() must return an array');
    assert.ok(results.length > 0, `Expected at least one search result for query '${query}'.`);

    const first = results[0];
    assert.equal(typeof first.pluginEntryId, 'string');
    assert.ok(first.pluginEntryId.length > 0);
    assert.equal(typeof first.title, 'string');
    assert.ok(first.title.length > 0);

    process.stdout.write(`[search-test] Result count: ${results.length}\n`);
    process.stdout.write(`[search-test] First result: ${first.pluginEntryId} | ${first.title}\n`);

    const contribution = await wrapper.lookup(first.pluginEntryId);
    assert.ok(contribution, 'lookup() must return a contribution for a known id');
    assert.equal(contribution.pluginEntryId, first.pluginEntryId);
    process.stdout.write(`[search-test] lookup(${first.pluginEntryId}) -> ${contribution.displayTitle}\n`);
    process.stdout.write(`[search-test] seriesUrl -> ${contribution.sourceLinks?.[0]?.seriesUrl}\n`);
    process.stdout.write('[search-test] Search integration test completed successfully.\n');
  },
);
