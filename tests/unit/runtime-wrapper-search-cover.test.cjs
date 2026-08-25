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
  const hooks = { getCalls: [], getHandler: () => ({ data: null }) };
  const client = {
    interceptors: { response: { use() { return 0; } } },
    async get(url, config) {
      hooks.getCalls.push({ url, config });
      return hooks.getHandler(url, config);
    },
  };
  return { client, hooks };
}

const DICE_SERIES = {
  id: 1,
  state: 'active',
  title: 'DICE',
  native_title: '다이스',
  romanized_title: 'DICE',
  secondary_titles: { unknown: [{ type: 'unknown', title: 'Dice - The Cube that Changes Everything' }] },
  description: 'A dice mechanic transforms Dongtae.',
  type: 'manhwa',
  status: 'completed',
  year: 2013,
  authors: ['YUN Hyun-sook'],
  genres: ['action', 'drama'],
  tags: ['school_life'],
  publishers: ['LINE Webtoon'],
  cover: {
    raw: { url: 'https://images.mangabaka.dev/full.jpg', width: 580, height: 838 },
    x150: { x1: 'https://cdn.mangabaka.dev/x150.jpg' },
  },
};

async function createWrapper(httpClient, cacheAdapter) {
  return MangaBakaAPIWrapper.init({
    serviceSettings: {
      'api.baseUrl': 'https://api.mangabaka.org/v1',
      'api.endpoints.seriesDetail.template': '${baseUrl}/series/${series_id}',
      'api.endpoints.seriesSearch.template': '${baseUrl}/series/search',
    },
    httpClient,
    context: { cache: cacheAdapter || createMockCacheAdapter(), utils: { sanitizeForSearch: (t) => t.toLowerCase() } },
  });
}

test('search - maps MangaBaka search response to PluginSearchResult[]', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/series/search')) {
      return { data: { status: 200, pagination: { count: 1, next: null, previous: null, page: 1, limit: 10 }, data: [DICE_SERIES] } };
    }
    return { data: null };
  };

  const wrapper = await createWrapper(client);
  const results = await wrapper.search('dice');

  assert.equal(results.length, 1);
  assert.equal(results[0].pluginEntryId, '1');
  assert.equal(results[0].title, 'DICE');
  assert.deepEqual(results[0].altTitles, ['다이스', 'Dice - The Cube that Changes Everything']);
  assert.equal(results[0].coverUrl, 'https://images.mangabaka.dev/full.jpg');
  assert.equal(results[0].seriesStatus, 'completed');
});

test('search - returns empty array for a blank query without calling the API', async () => {
  const { client, hooks } = createMockHttpClient();
  const wrapper = await createWrapper(client);

  const results = await wrapper.search('   ');
  assert.deepEqual(results, []);
  assert.equal(hooks.getCalls.length, 0);
});

test('lookup / buildLinkContribution - full shape with sourceLinks and mapped seriesStatus', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/series/1')) return { data: { status: 200, data: DICE_SERIES } };
    return { data: null };
  };

  const wrapper = await createWrapper(client);
  const contribution = await wrapper.buildLinkContribution(1);

  assert.equal(contribution.pluginEntryId, '1');
  assert.equal(contribution.displayTitle, 'DICE');
  assert.equal(contribution.seriesStatus, 'completed');
  assert.equal(typeof contribution.syncedAt, 'string');
  assert.deepEqual(contribution.authors, ['YUN Hyun-sook']);
  assert.deepEqual(contribution.genres, ['action', 'drama']);
  assert.equal(contribution.coverUrl, 'https://images.mangabaka.dev/full.jpg');
  assert.equal(contribution.year, 2013);
  assert.equal(contribution.seriesType, 'manhwa');
  assert.equal(contribution.sourceLinks.length, 1);
  assert.equal(contribution.sourceLinks[0].seriesUrl, 'https://mangabaka.org/1');
  assert.equal(contribution.sourceLinks[0].isPrimary, true);
});

test('lookup - returns null when the series is not found', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = () => ({ data: null });

  const wrapper = await createWrapper(client);
  assert.equal(await wrapper.lookup(999), null);
});

test('enrich - array in, array out, per-entry failure never a whole-batch throw', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/series/1')) return { data: { status: 200, data: DICE_SERIES } };
    return { data: null };
  };

  const wrapper = await createWrapper(client);
  const results = await wrapper.enrich([1, 999]);

  assert.equal(results.length, 2);
  assert.equal(results[0].pluginEntryId, '1');
  assert.equal(results[0].success, true);
  assert.equal(results[0].contribution.displayTitle, 'DICE');
  assert.equal(results[1].pluginEntryId, '999');
  assert.equal(results[1].success, false);
});

test('syncEnrichment - resolves pluginEntryId from either camelCase or snake_case field', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => (url.includes('/series/1') ? { data: { status: 200, data: DICE_SERIES } } : { data: null });

  const wrapper = await createWrapper(client);
  assert.equal((await wrapper.syncEnrichment({ pluginEntryId: 1 })).pluginEntryId, '1');
  assert.equal((await wrapper.syncEnrichment({ plugin_entry_id: 1 })).pluginEntryId, '1');
  assert.equal(await wrapper.syncEnrichment({}), null);
});

test('searchCovers - id mode skips title search and fetches the known entry cover directly', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => (url.includes('/series/1') ? { data: { status: 200, data: DICE_SERIES } } : { data: null });

  const wrapper = await createWrapper(client);
  const covers = await wrapper.searchCovers('', { pluginEntryId: 1 });

  assert.equal(covers.length, 1);
  assert.equal(covers[0].coverId, '1');
  assert.equal(covers[0].imageUrl, 'https://images.mangabaka.dev/full.jpg');
  assert.equal(covers[0].thumbnailUrl, 'https://cdn.mangabaka.dev/x150.jpg');
});

test('searchCovers - query mode searches then fetches the top result cover', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/series/search')) return { data: { status: 200, pagination: {}, data: [DICE_SERIES] } };
    if (url.includes('/series/1')) return { data: { status: 200, data: DICE_SERIES } };
    return { data: null };
  };

  const wrapper = await createWrapper(client);
  const covers = await wrapper.searchCovers('dice');

  assert.equal(covers.length, 1);
  assert.equal(covers[0].coverId, '1');
});

test('searchCovers - accepts CoverSearchOrchestrator\'s real calling convention: a full entry object plus options.trackerId', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => (url.includes('/series/1') ? { data: { status: 200, data: DICE_SERIES } } : { data: null });

  const wrapper = await createWrapper(client);
  // cls/coversearch/coversearchorchestrator.cjs:314 calls wrapper.searchCovers(fullEntry, wrapperOptions)
  // with a LocalTracker-like object as the first arg and the known id as options.trackerId, not a
  // bare query string / options.pluginEntryId.
  const covers = await wrapper.searchCovers({ uuid: 'lt-1', title: 'DICE' }, { trackerId: '1', searchTitles: ['DICE'] });

  assert.equal(covers.length, 1);
  assert.equal(covers[0].coverId, '1');
});

test('searchCovers - query mode with a full entry object and no known id falls back to options.searchTitles then entry.title', async () => {
  const { client, hooks } = createMockHttpClient();
  hooks.getHandler = (url) => {
    if (url.includes('/series/search')) return { data: { status: 200, pagination: {}, data: [DICE_SERIES] } };
    if (url.includes('/series/1')) return { data: { status: 200, data: DICE_SERIES } };
    return { data: null };
  };

  const wrapper = await createWrapper(client);
  const covers = await wrapper.searchCovers({ uuid: 'lt-1', title: 'DICE' }, { searchTitles: ['DICE'] });

  assert.equal(covers.length, 1);
  assert.equal(covers[0].coverId, '1');
});

test('downloadCover - returns a Buffer and never writes to disk itself', async () => {
  const { client, hooks } = createMockHttpClient();
  const fakeBytes = Buffer.from('fake-image-bytes');
  hooks.getHandler = (url) => {
    if (url.includes('/series/1')) return { data: { status: 200, data: DICE_SERIES } };
    if (url === 'https://images.mangabaka.dev/full.jpg') return { data: fakeBytes };
    return { data: null };
  };

  const wrapper = await createWrapper(client);
  const buffer = await wrapper.downloadCover('1');

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.toString(), 'fake-image-bytes');
});

test('downloadCover - accepts ImageService\'s real "${seriesId}/${fileName}" bridging convention', async () => {
  const { client, hooks } = createMockHttpClient();
  const fakeBytes = Buffer.from('fake-image-bytes');
  hooks.getHandler = (url) => {
    if (url.includes('/series/1')) return { data: { status: 200, data: DICE_SERIES } };
    if (url === 'https://images.mangabaka.dev/full.jpg') return { data: fakeBytes };
    return { data: null };
  };

  const wrapper = await createWrapper(client);
  // cls/services/imageservice.cjs:456 constructs coverId as `${sourceId}/${metadata.fileName}`.
  const buffer = await wrapper.downloadCover('1/cover.jpg');

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.toString(), 'fake-image-bytes');
});

test('downloadCover - rejects an invalid coverId', async () => {
  const { client } = createMockHttpClient();
  const wrapper = await createWrapper(client);
  await assert.rejects(() => wrapper.downloadCover('not-a-number'), /Invalid coverId/);
});

test('getSeriesUrl - resolves the canonical mangabaka.org page for a series id', async () => {
  const { client } = createMockHttpClient();
  const wrapper = await createWrapper(client);
  assert.equal(await wrapper.getSeriesUrl(1), 'https://mangabaka.org/1');
  assert.equal(await wrapper.getSeriesUrl('not-a-number'), null);
});
