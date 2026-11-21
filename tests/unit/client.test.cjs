'use strict';

/**
 * MangaBaka's client, through the plugin the SDK builds, against the fixture source: the source calls, their
 * fields and their failures. Ported from the 3.x wrapper's readinglist, search-cover, search-freshness and
 * credentials tests (their live-confirmed facts are kept; what the SDK now owns is tested in the SDK).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createStubAxios, createStubContext, callContext } = require('@manga-list/plugin-sdk/testing');
const { isPluginError } = require('@manga-list/plugin-sdk');
const { locateTracker } = require('../../scripts/build-runtime-plugin-package.cjs');
const { sourceHandler, BASE } = require('../fixtures/mangabaka-source.cjs');
const { htmlNormalizer } = require('../../src/runtime/apiwrappers/reg-mangabaka/client-mangabaka.cjs');

const tracker = locateTracker();
const descriptor = require(path.join(tracker.dir, `plugin-${tracker.id}.cjs`));
const values = JSON.parse(fs.readFileSync(path.join(tracker.dir, `${tracker.id}-api-settings.values.json`), 'utf8')).settings;

const user = (overrides = {}) => callContext({ credential: { api_key: 'mb-alpha-token' }, identity: 'slot-a', scope: 'user-a', ...overrides });

/** @param {(config: Record<string, any>) => any} [handler] */
async function plugin(handler = sourceHandler) {
    /** @type {Record<string, unknown>} */
    const settings = { ...values, 'retry.backoff.initialDelay': 1, 'retry.maxAttempts': 2, 'rateLimit.perEndpoint.defaultDelay': 0 };
    for (const key of Object.keys(settings)) if (key.endsWith('.throttle')) settings[key] = 0;
    const axios = createStubAxios(handler);
    const instance = await descriptor.WrapperClass.init({ context: createStubContext({ axios }), serviceSettings: settings });
    return { instance, axios };
}

test('getReadingList follows pagination.next to the end, asking the API\'s largest page (F17)', async () => {
    const { instance, axios } = await plugin();
    const list = await instance.getReadingList(user());
    assert.deepEqual(list.map((/** @type {any} */ e) => e.pluginEntryId), ['1', '2', '3']);
    const pages = axios.calls.filter((c) => c.url === `${BASE}/my/library`);
    assert.deepEqual(pages.map((c) => [c.params.page, c.params.limit]), [[1, 100], [2, 100]]);
    assert.ok(pages.every((c) => c.headers['x-api-key'] === 'mb-alpha-token'), 'the token is the x-api-key header');
});

test('pullProgress: a series not on the library is all-null, never a throw (404)', async () => {
    const { instance } = await plugin();
    assert.deepEqual(await instance.pullProgress('901', undefined === undefined ? user() : user()), { pluginEntryId: '901', status: null, chapter: null, rating: null, lastUpdated: null });
});

test('pushProgress sends progress_chapter/progress_volume and rating ×10, never a status; per entry', async () => {
    /** @type {any[]} */
    const patched = [];
    const { instance } = await plugin((config) => {
        if (config.method === 'patch') { patched.push(config.data); if (String(config.url).endsWith('/902')) return { status: 500 }; }
        return sourceHandler(config);
    });
    const out = await instance.pushProgress([{ pluginEntryId: '1', chapter: 12, rating: 8.5 }, { pluginEntryId: '902', chapter: 1 }], user());
    assert.deepEqual(patched[0], { progress_chapter: 12, rating: 85 });
    assert.equal(out[0].success, true);
    assert.deepEqual(out[0].applied, { chapter: 12, rating: 8.5 });
    assert.equal(out[1].success, false, 'one entry failing does not fail the batch');
});

test('subscribe: PATCH sets the state; a 404 (never added) falls back to POST on the same entry endpoint', async () => {
    /** @type {string[]} */
    const seen = [];
    const { instance } = await plugin((config) => {
        if (String(config.url).includes('/my/library/')) seen.push(`${config.method} ${config.data ? config.data.state : ''}`);
        if (config.method === 'patch' && String(config.url).endsWith('/7')) return { status: 404 };
        return sourceHandler(config);
    });
    const out = await instance.subscribe([{ pluginEntryId: '7', status: 'paused' }], user());
    assert.deepEqual(seen, ['patch paused', 'post paused']);
    assert.deepEqual(out[0], { pluginEntryId: '7', success: true, listId: null, status: 'paused' });
});

test('subscribe: a non-404 PATCH failure is the entry\'s failure, and no POST is attempted', async () => {
    /** @type {string[]} */
    const methods = [];
    const { instance } = await plugin((config) => {
        if (String(config.url).includes('/my/library/')) methods.push(config.method);
        return config.method === 'patch' ? { status: 409 } : sourceHandler(config);
    });
    const out = await instance.subscribe([{ pluginEntryId: '8', status: 'reading' }], user());
    assert.equal(out[0].success, false);
    assert.deepEqual(methods, ['patch']);
});

test('unsubscribe: an entry already absent (404) is success', async () => {
    const { instance } = await plugin((config) => (config.method === 'delete' ? { status: 404 } : sourceHandler(config)));
    assert.deepEqual(await instance.unsubscribe(['5'], user()), [{ pluginEntryId: '5', success: true }]);
});

test('unsubscribe (A29): the DELETE takes the series off the library, so the list read no longer returns it', async () => {
    /** @type {Set<number>} */
    const removed = new Set();
    const { instance, axios } = await plugin((config) => {
        const id = Number(String(config.url).split('/').pop());
        if (config.method === 'delete') {
            if (removed.has(id)) return { status: 404, data: { status: 404 } };
            removed.add(id);
            return { status: 200, data: { status: 200, data: true } };
        }
        const out = sourceHandler(config);
        if (config.url === `${BASE}/my/library` && out.data && Array.isArray(out.data.data)) {
            out.data = { ...out.data, data: out.data.data.filter((/** @type {any} */ e) => !removed.has(e.series_id)) };
        }
        return out;
    });
    assert.deepEqual(await instance.unsubscribe(['3', '3'], user()), [{ pluginEntryId: '3', success: true }, { pluginEntryId: '3', success: true }]);
    assert.deepEqual(axios.calls.filter((c) => c.method === 'delete').map((c) => c.url), [`${BASE}/my/library/3`, `${BASE}/my/library/3`]);
    assert.deepEqual((await instance.getReadingList(user())).map((/** @type {any} */ e) => e.pluginEntryId), ['1', '2']);
});

test('getReadingList: every entry carries altTitles from the series it embeds (A30), with no series read', async () => {
    const { instance, axios } = await plugin();
    const list = await instance.getReadingList(user());
    assert.deepEqual(list[0].altTitles, ['シリーズ 1', 'Shiriizu 1', 'The Series 1']);
    assert.equal(axios.calls.some((c) => /\/series\/\d+$/.test(String(c.url))), false);
});

test('A25: an unreadable library page, library entry, series or search answer is source_error, never an empty or absent answer', async () => {
    const { instance } = await plugin((config) => {
        const url = String(config.url);
        if (url === `${BASE}/my/library` && config.params && config.params.page === 2) return { status: 200, data: { status: 200 } };
        if (url === `${BASE}/my/library/2` || url === `${BASE}/series/2` || url === `${BASE}/series/search`) return { status: 200, data: { status: 200 } };
        return sourceHandler(config);
    });
    await assert.rejects(instance.getReadingList(user()), (e) => isPluginError(e) && e.code === 'source_error');
    await assert.rejects(instance.pullProgress('2', user()), (e) => isPluginError(e) && e.code === 'source_error');
    await assert.rejects(instance.lookup('2', user()), (e) => isPluginError(e) && e.code === 'source_error');
    await assert.rejects(instance.search('Series 1', undefined, user()), (e) => isPluginError(e) && e.code === 'source_error');
});

test('enrich (4.3.0, A31): a repeat is answered from the cache with its fetch time; refresh asks MangaBaka again', async () => {
    const { instance, axios } = await plugin();
    const system = callContext({ credential: null, identity: 'system-slot', scope: 'system' });
    const reads = () => axios.calls.filter((c) => c.url === `${BASE}/series/2`).length;
    const live = await instance.enrich(['2'], system);
    assert.deepEqual([live[0].contribution.cached, live[0].contribution.fetchedAt], [undefined, undefined], 'a live answer says nothing');
    const cached = await instance.enrich(['2'], system);
    assert.equal(cached[0].contribution.cached, true);
    assert.match(String(cached[0].contribution.fetchedAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(reads(), 1);
    const refreshed = await instance.enrich(['2'], { refresh: true }, system);
    assert.equal(refreshed[0].contribution.cached, undefined);
    assert.equal(reads(), 2);
});

test('search: a repeat is answered from the cache with its fetch time; refresh asks MangaBaka again', async () => {
    const { instance, axios } = await plugin();
    const system = callContext({ credential: null, identity: 'system-slot', scope: 'system' });
    const live = await instance.search('Series 1', undefined, system);
    assert.equal(live[0].cached, undefined);
    assert.equal(live[0].confidence, 1);
    const cached = await instance.search('Series 1', undefined, system);
    assert.equal(cached[0].cached, true);
    assert.equal(typeof cached[0].fetchedAt, 'string');
    const searchCalls = () => axios.calls.filter((c) => c.url === `${BASE}/series/search`).length;
    assert.equal(searchCalls(), 1);
    const refreshed = await instance.search('Series 1', { refresh: true }, system);
    assert.equal(refreshed[0].cached, undefined);
    assert.equal(searchCalls(), 2);
});

test('search: a blank query asks nothing', async () => {
    const { instance, axios } = await plugin();
    assert.deepEqual(await instance.search('   ', undefined, user()), []);
    assert.equal(axios.calls.length, 0);
});

test('searchCovers: id mode fetches the known series; title mode searches then fetches the top result', async () => {
    const { instance, axios } = await plugin();
    const byId = await instance.searchCovers({ title: 'ignored' }, { pluginEntryId: '3' }, user());
    assert.equal(byId[0].coverId, '3');
    assert.equal(axios.calls.some((c) => c.url === `${BASE}/series/search`), false, 'id mode skips the search');
    const byTitle = await instance.searchCovers({ title: 'Series 1' }, undefined, user());
    assert.equal(byTitle[0].coverId, '1');
});

test('downloadCover: bytes for a series id, and for the older "<id>/<file>" form; an id naming no series is not_found', async () => {
    const { instance } = await plugin();
    assert.ok(Buffer.isBuffer(await instance.downloadCover('1', user())));
    assert.ok(Buffer.isBuffer(await instance.downloadCover('1/cover.jpg', user())));
    await assert.rejects(instance.downloadCover('not-an-id', user()), (e) => isPluginError(e) && e.code === 'not_found');
});

test('lookup: a series MangaBaka does not have is not_found', async () => {
    const { instance } = await plugin();
    await assert.rejects(instance.lookup('901', user()), (e) => isPluginError(e) && e.code === 'not_found');
});

test('queryLive: a series not found is the not_found arm, never a throw', async () => {
    const { instance } = await plugin();
    assert.deepEqual(await instance.queryLive('901', user()), { status: 'not_found' });
});

test('summarizeEntries answers from the series, never the user\'s library (Decision 3)', async () => {
    const { instance, axios } = await plugin();
    const out = await instance.summarizeEntries(['1'], callContext({ credential: null, identity: 'system-slot', scope: 'system' }));
    assert.deepEqual(out[0].summary, { label: 'Releasing', status: 'releasing', latestChapter: 42, lastUpdated: '2026-10-01T00:00:00Z' });
    assert.equal(axios.calls.some((c) => String(c.url).includes('/my/')), false);
});

test('testCredentials: true when the profile answers to the token, false on a 401, false with no token', async () => {
    const { instance } = await plugin();
    assert.equal(await instance.testCredentials({ api_key: 'mb-alpha-token' }), true);
    assert.equal(await instance.testCredentials({ api_key: 'mb-revoked' }), false);
    assert.equal(await instance.testCredentials({}), false);
});

test('an HTML answer from MangaBaka\'s edge is a typed error, not parsed', () => {
    assert.throws(
        () => htmlNormalizer({ status: 503, headers: { 'content-type': 'text/html' }, data: '<html><title>Just a moment...</title></html>' }),
        (e) => isPluginError(e) && e.code === 'offline' && /Just a moment/.test(e.message),
    );
    assert.doesNotThrow(() => htmlNormalizer({ status: 200, headers: { 'content-type': 'application/json' }, data: { ok: true } }));
});

test('search with allHits (A35, A36) asks MangaBaka for the result cap as its limit and answers every hit; without it, q alone as before', async () => {
    const { instance, axios } = await plugin();
    const system = callContext({ credential: null, identity: 'system-slot', scope: 'system' });
    const filtered = await instance.search('Series 1', undefined, system);
    const every = await instance.search('Series 1', { allHits: true }, system);
    const calls = axios.calls.filter((c) => c.url === `${BASE}/series/search`);
    assert.deepEqual(calls.map((c) => c.params), [{ q: 'Series 1' }, { q: 'Series 1', limit: 25 }], 'the default cap is 25; the filtered call sends no limit');
    assert.deepEqual([filtered.length, every.length], [2, 3], 'allHits answers more than the source\'s own page');
    assert.deepEqual(every.map((/** @type {any} */ c) => c.detail.seriesStatus), ['ongoing', 'cancelled', 'completed']);
});

test('search with allHits: the configured search.resultCap is the limit', async () => {
    const settings = { ...values, 'search.resultCap': 1, 'retry.maxAttempts': 2, 'rateLimit.perEndpoint.defaultDelay': 0 };
    for (const key of Object.keys(settings)) if (key.endsWith('.throttle')) settings[key] = 0;
    const axios = createStubAxios(sourceHandler);
    const instance = await descriptor.WrapperClass.init({ context: createStubContext({ axios }), serviceSettings: settings });
    const every = await instance.search('Series 1', { allHits: true }, user());
    assert.equal(axios.calls.find((c) => c.url === `${BASE}/series/search`).params.limit, 1);
    assert.equal(every.length, 1);
});

test('search: the cache is keyed on the limit, so a filtered answer is never reused as an allHits one, nor the reverse', async () => {
    const { instance, axios } = await plugin();
    const system = callContext({ credential: null, identity: 'system-slot', scope: 'system' });
    const searchCalls = () => axios.calls.filter((c) => c.url === `${BASE}/series/search`).length;
    await instance.search('Series 1', undefined, system);
    const every = await instance.search('Series 1', { allHits: true }, system);
    assert.equal(searchCalls(), 2, 'the filtered answer in the cache does not answer allHits');
    assert.equal(every[0].cached, undefined);
    assert.equal(every.length, 3);
    const everyAgain = await instance.search('Series 1', { allHits: true }, system);
    const filteredAgain = await instance.search('Series 1', undefined, system);
    assert.equal(searchCalls(), 2, 'each repeat is answered from its own cache entry');
    assert.deepEqual([everyAgain.length, everyAgain[0].cached, filteredAgain.length, filteredAgain[0].cached], [3, true, 2, true]);
    await instance.search('Series 1', { allHits: true, refresh: true }, system);
    assert.equal(searchCalls(), 3, 'refresh asks MangaBaka again with allHits too');
});

test('lookup (A33, A38): every search candidate resolves, with the display part of its series read', async () => {
    const { instance } = await plugin();
    const every = await instance.search('Series 1', { allHits: true }, user());
    for (const candidate of every) {
        const detail = await instance.lookup(candidate.pluginEntryId, user());
        assert.equal(detail.pluginEntryId, candidate.pluginEntryId);
        assert.deepEqual(detail.display, candidate.detail.display);
    }
});
