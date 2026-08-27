'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MangaBakaAPIWrapper = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-wrapper-mangabaka.cjs',
));

function createMockCacheAdapter() {
  const data = new Map();
  return {
    async getValue(key) { return data.has(key) ? data.get(key) : null; },
    async setValue(key, value) { data.set(key, value); },
  };
}

function createMockHttpClient() {
  const hooks = {
    getCalls: [], patchCalls: [], postCalls: [], deleteCalls: [],
    getHandler: () => ({ data: null }),
    patchHandler: () => ({ data: {} }),
    postHandler: () => ({ data: {} }),
    deleteHandler: () => ({ data: {} }),
  };
  const client = {
    interceptors: { response: { use() { return 0; } } },
    async get(url, config) {
      hooks.getCalls.push({ url, config });
      const result = hooks.getHandler(url, config);
      if (result && result.throw) throw result.throw;
      return result;
    },
    async patch(url, body, config) {
      hooks.patchCalls.push({ url, body, config });
      const result = hooks.patchHandler(url, body, config);
      if (result && result.throw) throw result.throw;
      return result;
    },
    async post(url, body, config) {
      hooks.postCalls.push({ url, body, config });
      const result = hooks.postHandler(url, body, config);
      if (result && result.throw) throw result.throw;
      return result;
    },
    async delete(url, config) {
      hooks.deleteCalls.push({ url, config });
      const result = hooks.deleteHandler(url, config);
      if (result && result.throw) throw result.throw;
      return result;
    },
  };
  return { client, hooks };
}

async function createWrapper(httpClient, cacheAdapter) {
  const wrapper = await MangaBakaAPIWrapper.init({
    serviceSettings: {
      'api.baseUrl': 'https://api.mangabaka.org/v1',
      'api.endpoints.myLibrary.template': '${baseUrl}/my/library',
      'api.endpoints.myLibraryEntry.template': '${baseUrl}/my/library/${series_id}',
    },
    httpClient,
    context: { cache: cacheAdapter || createMockCacheAdapter(), utils: null },
  });
  await wrapper.setCredentials({ api_key: 'mb-test-token' });
  return wrapper;
}

test('pullProgress - maps a found library entry to PluginProgressDTO (real field names confirmed live 2026-08-24)', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/my/library/7')) {
      return { data: { data: { series_id: 7, state: 'reading', progress_chapter: 12, progress_volume: 2, rating: 8.5 } } };
    }
    return { data: null };
  };

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const progress = await wrapper.pullProgress(7);

  // readingStatus is the LOCAL enum value, not MangaBaka's raw native `state`
  // — _mapNativeLibraryStatusToLocal() does that translation (pull direction
  // of tracker-template.md §6's two-layer mapping pattern).
  assert.equal(progress.readingStatus, 'READING');
  assert.equal(progress.chapter, 12);
  assert.equal(progress.volume, 2);
  assert.equal(progress.rating, 8.5);
});

test('pullProgress - collapses both "plan_to_read" and "considering" to local PLAN_TO_READ', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/my/library/1')) return { data: { data: { series_id: 1, state: 'plan_to_read' } } };
    if (url.includes('/my/library/2')) return { data: { data: { series_id: 2, state: 'considering' } } };
    return { data: null };
  };

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  assert.equal((await wrapper.pullProgress(1)).readingStatus, 'PLAN_TO_READ');
  assert.equal((await wrapper.pullProgress(2)).readingStatus, 'PLAN_TO_READ');
});

test('pullProgress - maps rereading (no underscore) to local RE_READING', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => (url.includes('/my/library/3') ? { data: { data: { series_id: 3, state: 'rereading' } } } : { data: null });

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  assert.equal((await wrapper.pullProgress(3)).readingStatus, 'RE_READING');
});

test('pullProgress - returns all-null DTO when the entry does not exist (404)', async () => {
  const { client, hooks } = createMockHttpClient();
  const notFound = new Error('Not Found');
  notFound.response = { status: 404 };
  hooks.getHandler = () => ({ throw: notFound });

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const progress = await wrapper.pullProgress(999);

  assert.deepEqual(progress, { readingStatus: null, chapter: null, volume: null, rating: null });
});

test('pushProgress - array in, array out, per-entry failure never a whole-batch throw', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.patchHandler = (url) => {
    if (url.includes('/my/library/2')) throw new Error('boom');
    return { data: {} };
  };

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const results = await wrapper.pushProgress([
    { pluginEntryId: 1, chapter: 5 },
    { pluginEntryId: 2, chapter: 6 },
  ]);

  assert.equal(results.length, 2);
  assert.equal(results[0].pluginEntryId, '1');
  assert.equal(results[0].success, true);
  assert.equal(results[1].pluginEntryId, '2');
  assert.equal(results[1].success, false);
  assert.match(results[1].error, /boom/);
});

test('pushProgress - never sends status, only progress_chapter/progress_volume/rating (real field names)', async () => {
  const { client, hooks } = createMockHttpClient();
  const wrapper = await createWrapper(client, createMockCacheAdapter());

  await wrapper.pushProgress([{ pluginEntryId: 1, chapter: 5, volume: 1, rating: 9 }]);

  assert.equal(hooks.patchCalls.length, 1);
  assert.deepEqual(hooks.patchCalls[0].body, { progress_chapter: 5, progress_volume: 1, rating: 9 });
});

test('getReadingList - maps the full library and caches it userScoped (real dispatch name, not sync.list\'s documented pullList)', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/my/library')) {
      return {
        data: {
          data: [
            { series_id: 1, state: 'reading', progress_chapter: 3, Series: { id: 1, title: 'Title One' } },
            { series_id: 2, state: 'completed', progress_chapter: 40, Series: { id: 2, title: 'Title Two' } },
          ],
        },
      };
    }
    return { data: null };
  };

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  // cls/services/pluginservice.cjs:1746 gates on typeof instance.getReadingList === 'function' —
  // this is the method name PluginService actually calls, not `pullList`.
  const list = await wrapper.getReadingList();

  assert.equal(list.length, 2);
  assert.equal(list[0].pluginEntryId, '1');
  assert.equal(list[0].title, 'Title One');
  assert.equal(list[0].status, 'READING');
  assert.equal(list[0].chapter, 3);
  assert.equal(list[1].pluginEntryId, '2');
});

test('getReadingList - computes a per-row comparison when options.hostProgressByEntryId is supplied', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/my/library')) {
      return { data: { data: [{ series_id: 1, state: 'completed', progress_chapter: 40, rating: 9 }] } };
    }
    return { data: null };
  };

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const hostProgressByEntryId = new Map([['1', { readingStatus: 'READING', chapter: 30, rating: 8 }]]);
  const list = await wrapper.getReadingList({ hostProgressByEntryId });

  assert.equal(list[0].comparison.chapterAhead, true);
  assert.equal(list[0].comparison.statusDiffers, true);
  assert.equal(list[0].comparison.ratingDiffers, true);
});

test('subscribe - array in, array out, per-entry failure never a whole-batch throw', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.patchHandler = (url) => {
    if (url.includes('/my/library/2')) throw new Error('rejected');
    return { data: {} };
  };

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const results = await wrapper.subscribe([
    { pluginEntryId: 1, status: 'READING' },
    { pluginEntryId: 2, status: 'READING' },
  ]);

  assert.equal(results[0].success, true);
  assert.equal(results[1].success, false);
});

test('subscribe - resolves the local status enum to MangaBaka\'s native state before sending (real bug: host passes the raw local enum, not a pre-resolved value)', async () => {
  const { client, hooks } = createMockHttpClient();

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  await wrapper.subscribe([{ pluginEntryId: 1, status: 'PLAN_TO_READ' }]);

  assert.equal(hooks.patchCalls.length, 1);
  assert.deepEqual(hooks.patchCalls[0].body, { state: 'plan_to_read' });
});

test('subscribe - fails cleanly (never sends the raw local string) for an unrecognized status', async () => {
  const { client } = createMockHttpClient();
  const wrapper = await createWrapper(client, createMockCacheAdapter());

  const [result] = await wrapper.subscribe([{ pluginEntryId: 1, status: 'NOT_A_REAL_STATUS' }]);

  assert.equal(result.success, false);
  assert.match(result.error, /No native MangaBaka state/);
});

test('subscribe - PATCH 404 (series never added before) falls back to POST /my/library to create it (real bug: PATCH is not an upsert, confirmed live 2026-08-26)', async () => {
  const { client, hooks } = createMockHttpClient();
  const notFound = new Error('Not Found');
  notFound.response = { status: 404 };
  hooks.patchHandler = () => ({ throw: notFound });

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const [result] = await wrapper.subscribe([{ pluginEntryId: 42, status: 'READING' }]);

  assert.equal(result.success, true);
  assert.equal(hooks.postCalls.length, 1);
  assert.match(hooks.postCalls[0].url, /\/my\/library$/);
  assert.deepEqual(hooks.postCalls[0].body, { series_id: 42, state: 'reading' });
});

test('subscribe - a non-404 PATCH failure propagates without ever attempting POST', async () => {
  const { client, hooks } = createMockHttpClient();
  const serverError = new Error('Internal Server Error');
  serverError.response = { status: 500 };
  hooks.patchHandler = () => ({ throw: serverError });

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const [result] = await wrapper.subscribe([{ pluginEntryId: 42, status: 'READING' }]);

  assert.equal(result.success, false);
  assert.equal(hooks.postCalls.length, 0);
});

test('unsubscribe - idempotent: a 404 on an already-absent entry is still success', async () => {
  const { client, hooks } = createMockHttpClient();
  const notFound = new Error('Not Found');
  notFound.response = { status: 404 };
  hooks.deleteHandler = () => ({ throw: notFound });

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const results = await wrapper.unsubscribe([1]);

  assert.equal(results[0].success, true);
});

test('compareProgress - null on any field means the comparison could not be made', () => {
  const wrapper = new (require(path.join(
    __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-wrapper-mangabaka.cjs',
  )))();

  const noData = wrapper.compareProgress({}, {});
  assert.deepEqual(noData, { chapterAhead: null, chapterBehindOrEqual: null, ratingDiffers: null, statusDiffers: null });

  const result = wrapper.compareProgress({ chapter: 5, rating: 8, readingStatus: 'reading' }, { chapter: 10, rating: 9, readingStatus: 'completed' });
  assert.equal(result.chapterAhead, true);
  assert.equal(result.chapterBehindOrEqual, false);
  assert.equal(result.ratingDiffers, true);
  assert.equal(result.statusDiffers, true);
});
