'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MangaBakaAPIWrapper = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-mangabaka', 'api-wrapper-mangabaka.cjs',
));

/**
 * search() gives each result a match confidence, answers from this plugin's cache when it can and says so
 * (`cached`, `fetchedAt`), and `options.refresh` asks MangaBaka itself (host-capability-contract §2.4). The host
 * sets `refresh` only when the user asks for a live search.
 */

function series(id, title, extra = {}) {
  return { id, state: 'active', title, native_title: null, romanized_title: null, secondary_titles: {}, type: 'manhwa', status: 'ongoing', ...extra };
}

async function createWrapper(rows) {
  const data = new Map();
  const calls = { search: 0 };
  const httpClient = {
    interceptors: { response: { use() { return 0; } } },
    async get(url) {
      if (String(url).includes('/series/search')) {
        calls.search += 1;
        return { data: { status: 200, data: rows } };
      }
      return { data: null };
    },
  };
  const wrapper = await MangaBakaAPIWrapper.init({
    serviceSettings: {
      'api.baseUrl': 'https://api.mangabaka.org/v1',
      'api.endpoints.seriesDetail.template': '${baseUrl}/series/${series_id}',
      'api.endpoints.seriesSearch.template': '${baseUrl}/series/search',
    },
    httpClient,
    context: {
      cache: {
        async getValue(key) { return data.has(key) ? data.get(key) : null; },
        async setValue(key, value) { data.set(key, value); },
      },
      utils: { sanitizeForSearch: (text) => text.toLowerCase() },
    },
  });
  return { wrapper, calls, data };
}

test('search: every result carries a match confidence from 0 to 1', async () => {
  const { wrapper } = await createWrapper([
    series(1, 'Solo Leveling'),
    series(2, 'Solo Leveling: Ragnarok'),
    series(3, 'Leveling Up Alone', { native_title: '나 혼자만 레벨업' }),
    series(4, 'Something Else Entirely'),
  ]);

  const results = await wrapper.search('solo leveling');
  const byId = Object.fromEntries(results.map((result) => [result.pluginEntryId, result.confidence]));

  assert.equal(byId['1'], 1, 'the same title, whatever the case');
  assert.equal(byId['2'], 0.85, 'one title contains the other');
  assert.ok(byId['3'] > 0 && byId['3'] < 0.85, 'some words in common');
  assert.equal(byId['4'], 0, 'nothing in common');
});

test('search: an alternate title that is the query makes an exact match', async () => {
  const { wrapper } = await createWrapper([series(1, 'Na Honjaman Level-Up', { secondary_titles: { en: [{ type: 'alternative', title: 'Solo Leveling' }] } })]);

  const [result] = await wrapper.search('Solo Leveling');

  assert.equal(result.confidence, 1);
});

test('search: accents and punctuation do not count against a match', async () => {
  const { wrapper } = await createWrapper([series(1, 'Pokémon: Adventures!')]);

  const [result] = await wrapper.search('pokemon adventures');

  assert.equal(result.confidence, 1);
});

test('search: a first search is live, a repeat is answered from the cache and says when it was fetched', async () => {
  const { wrapper, calls } = await createWrapper([series(1, 'Solo Leveling')]);

  const first = await wrapper.search('Solo Leveling');
  assert.equal(first[0].cached, undefined, 'a live answer carries no cache marks');
  assert.equal(first[0].fetchedAt, undefined);
  assert.equal(calls.search, 1);

  const second = await wrapper.search('Solo Leveling');
  assert.equal(calls.search, 1, 'the repeat did not reach MangaBaka');
  assert.equal(second[0].cached, true);
  assert.ok(Number.isFinite(Date.parse(second[0].fetchedAt)));
  assert.equal(second[0].confidence, 1, 'a cached result still carries a confidence');
});

test('search: refresh asks MangaBaka itself, answers live, and refreshes the cache', async () => {
  const { wrapper, calls } = await createWrapper([series(1, 'Solo Leveling')]);
  await wrapper.search('Solo Leveling');

  const live = await wrapper.search('Solo Leveling', { refresh: true });
  assert.equal(calls.search, 2);
  assert.equal(live[0].cached, undefined);

  await wrapper.search('Solo Leveling');
  assert.equal(calls.search, 2, 'the live answer refreshed the cache');
});

test('search: forceRefresh still bypasses the cache', async () => {
  const { wrapper, calls } = await createWrapper([series(1, 'Solo Leveling')]);
  await wrapper.search('Solo Leveling');

  await wrapper.search('Solo Leveling', { forceRefresh: true });

  assert.equal(calls.search, 2);
});

test('search: a list cached before fetch times were recorded says cached, without a time', async () => {
  const { wrapper, calls, data } = await createWrapper([series(1, 'Solo Leveling')]);
  await wrapper.search('Solo Leveling');
  for (const [key, value] of data) {
    if (!key.startsWith('mangabaka_search_')) continue;
    data.set(key, JSON.stringify(JSON.parse(value).payload));
  }

  const [cached] = await wrapper.search('Solo Leveling');

  assert.equal(calls.search, 1);
  assert.equal(cached.cached, true);
  assert.equal(cached.fetchedAt, undefined);
});
