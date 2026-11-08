'use strict';

/**
 * MangaBaka's mapping: pure, MangaBaka's shapes in, the contract's DTOs out. Ported from the 3.x wrapper's
 * search, readinglist and summarize tests; the status assertions changed on purpose: the token is MangaBaka's own
 * and the host resolves it (A6), where the 3.x wrapper sent the host's enum.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { validateResult } = require('@manga-list/plugin-sdk');
const { locateTracker } = require('../../scripts/build-runtime-plugin-package.cjs');
const { series } = require('../fixtures/mangabaka-source.cjs');

const tracker = locateTracker();
const mapping = require(path.join(tracker.dir, `mapping-${tracker.id}.cjs`));

test('search: candidates carry pluginEntryId, a 0–1 confidence and the canonical URL', () => {
    const out = mapping.search({ query: 'Series 5', rows: [series(5)], fetchedAt: null, cached: false });
    assert.deepEqual(validateResult('search', out), []);
    assert.equal(out[0].pluginEntryId, '5');
    assert.equal(out[0].confidence, 1);
    assert.equal(out[0].canonicalUrl, 'https://mangabaka.org/5');
});

test('search: an alternate title equal to the query is an exact match; accents and punctuation do not count against it', () => {
    assert.equal(mapping._confidence('the series 5', ['Something', 'The Series 5']), 1);
    assert.equal(mapping._confidence('Pokémon: Adventures!', ['Pokemon Adventures']), 1);
    assert.ok(mapping._confidence('one piece', ['Two Pieces']) < 0.85);
});

test('search: a cached answer says so, with its fetch time when it has one', () => {
    const withTime = mapping.search({ query: 'x', rows: [series(1)], fetchedAt: '2026-01-01T00:00:00Z', cached: true });
    assert.equal(withTime[0].cached, true);
    assert.equal(withTime[0].fetchedAt, '2026-01-01T00:00:00Z');
    const noTime = mapping.search({ query: 'x', rows: [series(1)], fetchedAt: null, cached: true });
    assert.equal(noTime[0].cached, true);
    assert.equal(noTime[0].fetchedAt, undefined);
});

test('alt titles: native, romanized, titles[] and secondary_titles, the primary left out, no duplicates', () => {
    assert.deepEqual(mapping._altTitles({ ...series(1), titles: [{ title: 'Series 1' }, { title: 'Shiriizu 1' }] }), ['シリーズ 1', 'Shiriizu 1', 'The Series 1']);
});

test('lookup and enrich: the contribution, its status mapped, its source link', () => {
    const detail = mapping.lookup(series(2));
    assert.deepEqual(validateResult('lookup', detail), []);
    assert.equal(detail.seriesStatus, 'ongoing', 'MangaBaka "releasing" is ongoing');
    assert.deepEqual(detail.sourceLinks, [{ siteId: 'mangabaka', siteLabel: 'MangaBaka', seriesUrl: 'https://mangabaka.org/2', isPrimary: true }]);
    assert.equal(mapping.enrich(series(2)).contribution.pluginEntryId, '2');
});

test('getReadingList: MangaBaka\'s own state token passes through — considering, paused, rereading included (A6)', () => {
    const rows = [
        { series_id: 1, state: 'considering' },
        { series_id: 2, state: 'paused', rating: 85, progress_chapter: 12 },
        { Series: { id: 3, title: 'Three' }, state: 'rereading' },
    ];
    const out = mapping.getReadingList(rows);
    assert.deepEqual(validateResult('getReadingList', out, { manifest: tracker.manifest }), []);
    assert.deepEqual(out.map((/** @type {any} */ e) => [e.pluginEntryId, e.status]), [['1', 'considering'], ['2', 'paused'], ['3', 'rereading']]);
    assert.equal(out[1].rating, 8.5, 'MangaBaka 0–100 → the host\'s 0–10');
    assert.equal(out[2].title, 'Three');
});

test('pullProgress: the entry\'s token and progress; no entry is all-null', () => {
    assert.deepEqual(mapping.pullProgress({ state: 'paused', progress_chapter: 4, rating: 70 }, '9'), { pluginEntryId: '9', status: 'paused', chapter: 4, rating: 7, lastUpdated: null });
    assert.deepEqual(mapping.pullProgress(null, '9'), { pluginEntryId: '9', status: null, chapter: null, rating: null, lastUpdated: null });
});

test('every token MangaBaka can return is a key of the manifest\'s pull table (the seven states of api.json)', () => {
    for (const state of ['considering', 'completed', 'dropped', 'paused', 'plan_to_read', 'reading', 'rereading']) {
        assert.ok(state in tracker.manifest.syncOptions.statusVocabulary.pull, state);
    }
});

test('summarizeEntries: the series\' volatile state, never a link state', () => {
    const out = mapping.summarizeEntries(series(1));
    assert.deepEqual(out.summary, { label: 'Releasing', status: 'releasing', latestChapter: 42, lastUpdated: '2026-10-01T00:00:00Z' });
});

test('queryLive: an ok arm with an overview and a link, no link state', () => {
    const out = mapping.queryLive(series(1), '1');
    assert.deepEqual(validateResult('queryLive', out), []);
    assert.equal(out.data.sections[1].links[0].url, 'https://mangabaka.org/1');
});

test('searchCovers: MangaBaka\'s one cover, with its thumbnail and size; none without a cover', () => {
    assert.deepEqual(mapping.searchCovers(series(1)), [{ coverId: '1', imageUrl: 'https://cdn.mangabaka.org/covers/1.jpg', thumbnailUrl: 'https://cdn.mangabaka.org/covers/1-150.jpg', width: 400, height: 600 }]);
    assert.deepEqual(mapping.searchCovers(null), []);
});
