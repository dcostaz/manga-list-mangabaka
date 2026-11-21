'use strict';

/**
 * The contract suite (host-capability-contract.md, through @manga-list/plugin-sdk/testing) against MangaBaka,
 * with the fixture source.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runConformance } = require('@manga-list/plugin-sdk/testing');
const { locateTracker } = require('../../scripts/build-runtime-plugin-package.cjs');
const { sourceHandler, LIBRARY } = require('../fixtures/mangabaka-source.cjs');

const tracker = locateTracker();
const descriptor = require(path.join(tracker.dir, `plugin-${tracker.id}.cjs`));
const values = JSON.parse(fs.readFileSync(path.join(tracker.dir, `${tracker.id}-api-settings.values.json`), 'utf8'));

/** Settings for a fast run: throttles and backoff off. */
const fastSettings = () => {
    /** @type {Record<string, unknown>} */
    const s = { ...values.settings, 'retry.backoff.initialDelay': 1, 'retry.backoff.maxDelay': 2, 'retry.maxAttempts': 2, 'rateLimit.perEndpoint.defaultDelay': 0 };
    for (const key of Object.keys(s)) if (key.endsWith('.throttle')) s[key] = 0;
    return s;
};

test('MangaBaka passes the contract suite with 0 failures', async () => {
    const report = await runConformance({
        WrapperClass: descriptor.WrapperClass,
        descriptor,
        manifest: tracker.manifest,
        settings: fastSettings(),
        source: sourceHandler,
        credentials: [{ api_key: 'mb-alpha-token' }, { api_key: 'mb-beta-token' }],
        inputs: { lookup: ['1'], enrich: [['1', '2']], pullProgress: ['1'], downloadCover: ['1'], queryLive: ['1'], summarizeEntries: [['1', '2']], unsubscribe: [['1']], subscribe: [[{ pluginEntryId: '1', status: 'reading' }]], pushProgress: [[{ pluginEntryId: '1', chapter: 12, rating: 8.5 }]] },
        expect: { readingListLength: LIBRARY.length },
    });
    assert.deepEqual(report.failed, []);
    for (const id of ['sync.list.returns-the-whole-library', 'F3.getReadingList-without-a-credential-is-rejected', 'F11.no-identity-leaks-across-calls', 'F11.cache-keys-name-the-scope', 'result.summarizeEntries', 'result.pullProgress']) {
        assert.ok(report.passed.includes(id), `passed ${id}`);
    }
    // 4.4.0: run against the fixture source, which honours `limit` and answers more with it (A35), never skipped.
    assert.ok(report.passed.includes('A35.allHits-answers-at-least-the-filtered-hits-and-at-most-the-cap'), 'allHits asks the source for more (A35)');
    assert.ok(report.passed.includes('A38.every-candidate-resolves-by-lookup'), 'every candidate resolves by lookup (A38)');
    assert.deepEqual(report.skipped, []);
});
