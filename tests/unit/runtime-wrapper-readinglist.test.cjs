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
    getCalls: [], patchCalls: [], deleteCalls: [],
    getHandler: () => ({ data: null }),
    patchHandler: () => ({ data: {} }),
    deleteHandler: () => ({ data: {} }),
  };
  const client = {
    interceptors: { response: { use() { return 0; } } },
    async post() { return { data: { access_token: 'library-token', token_type: 'Bearer', expires_in: 3600 } }; },
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
      'api.authBaseUrl': 'https://mangabaka.org/auth',
      'api.endpoints.token.template': '${authBaseUrl}/oauth2/token',
      'api.endpoints.myLibrary.template': '${baseUrl}/my/library',
      'api.endpoints.myLibraryEntry.template': '${baseUrl}/my/library/${series_id}',
      'oauth.scope': 'library.read library.write',
    },
    httpClient,
    context: { cache: cacheAdapter || createMockCacheAdapter(), utils: null },
  });
  await wrapper.setCredentials({ client_id: 'demo-client', client_secret: 'demo-secret' });
  return wrapper;
}

test('pullProgress - maps a found library entry to PluginProgressDTO', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/my/library/7')) {
      return { data: { data: { series_id: 7, status: 'reading', chapter: 12, volume: 2, rating: 8.5, updated_at: '2026-08-01T00:00:00.000Z' } } };
    }
    return { data: null };
  };

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const progress = await wrapper.pullProgress(7);

  assert.equal(progress.readingStatus, 'reading');
  assert.equal(progress.chapter, 12);
  assert.equal(progress.volume, 2);
  assert.equal(progress.rating, 8.5);
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

test('pushProgress - never sends status, only chapter/volume/rating', async () => {
  const { client, hooks } = createMockHttpClient();
  const wrapper = await createWrapper(client, createMockCacheAdapter());

  await wrapper.pushProgress([{ pluginEntryId: 1, chapter: 5, volume: 1, rating: 9 }]);

  assert.equal(hooks.patchCalls.length, 1);
  assert.deepEqual(hooks.patchCalls[0].body, { chapter: 5, volume: 1, rating: 9 });
});

test('pullList - maps the full library and caches it userScoped', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/my/library')) {
      return { data: { data: [{ series_id: 1, status: 'reading', chapter: 3 }, { series_id: 2, status: 'completed', chapter: 40 }] } };
    }
    return { data: null };
  };

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const list = await wrapper.pullList();

  assert.equal(list.length, 2);
  assert.equal(list[0].pluginEntryId, '1');
  assert.equal(list[0].readingStatus, 'reading');
  assert.equal(list[1].pluginEntryId, '2');
});

test('subscribe - array in, array out, per-entry failure never a whole-batch throw', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.patchHandler = (url) => {
    if (url.includes('/my/library/2')) throw new Error('rejected');
    return { data: {} };
  };

  const wrapper = await createWrapper(client, createMockCacheAdapter());
  const results = await wrapper.subscribe([
    { pluginEntryId: 1, status: 'reading' },
    { pluginEntryId: 2, status: 'reading' },
  ]);

  assert.equal(results[0].success, true);
  assert.equal(results[1].success, false);
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
