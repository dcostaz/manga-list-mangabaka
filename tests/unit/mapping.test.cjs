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
    assert.equal(out[0].canonicalUrl, 'https://mangabaka.org/manga/5/Series-5', "the record's own page (canonical_url)");
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
    assert.deepEqual(detail.sourceLinks, [{ siteId: 'mangabaka', siteLabel: 'MangaBaka', seriesUrl: 'https://mangabaka.org/manga/2/Series-2', isPrimary: true }]);
    assert.equal(mapping.enrich({ value: series(2), cached: false, fetchedAt: null }).contribution.pluginEntryId, '2');
    // A31: a cached read says so, and when it was fetched; one cached before the time was kept says it was cached alone.
    const cached = mapping.enrich({ value: series(2), cached: true, fetchedAt: '2026-11-15T00:00:00.000Z' }).contribution;
    assert.deepEqual([cached.cached, cached.fetchedAt], [true, '2026-11-15T00:00:00.000Z']);
    const old = mapping.enrich({ value: series(2), cached: true, fetchedAt: null }).contribution;
    assert.deepEqual([old.cached, 'fetchedAt' in old], [true, false]);
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

test('getReadingList: altTitles (A30) from the embedded series, the primary left out; null where the row embeds none or carries no such field', () => {
    const out = mapping.getReadingList([
        { series_id: 1, state: 'reading', Series: series(1) },
        { series_id: 2, state: 'reading' },
        { series_id: 3, state: 'reading', Series: { id: 3, title: 'Three' } },
        { series_id: 4, state: 'reading', Series: { id: 4, title: 'Four', native_title: 'Four', secondary_titles: {} } },
    ]);
    assert.deepEqual(validateResult('getReadingList', out, { manifest: tracker.manifest }), []);
    assert.deepEqual(out.map((/** @type {any} */ e) => e.altTitles), [['シリーズ 1', 'Shiriizu 1', 'The Series 1'], null, null, []]);
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
    assert.equal(out.data.sections[1].links[0].url, 'https://mangabaka.org/manga/1/Series-1');
});

test('searchCovers: MangaBaka\'s one cover, with its thumbnail and size; none without a cover', () => {
    assert.deepEqual(mapping.searchCovers(series(1)), [{ coverId: '1', imageUrl: 'https://cdn.mangabaka.org/covers/1.jpg', thumbnailUrl: 'https://cdn.mangabaka.org/covers/1-150.jpg', width: 400, height: 600 }]);
    assert.deepEqual(mapping.searchCovers(null), []);
});

// ── contract 4.4.0: the record, its display part, cancelled (§2.4.1: A32–A34) ──────────────────────────────────

const { seriesById, CANCELLED_ID, THIN_ID } = require('../fixtures/mangabaka-source.cjs');

test('search (A32): each candidate carries its record — the hit is the full record — without its identity', () => {
    const out = mapping.search({ query: 'Series 1', rows: [seriesById(1), seriesById(CANCELLED_ID), seriesById(THIN_ID)], fetchedAt: '2026-11-19T00:00:00Z', cached: true });
    assert.deepEqual(validateResult('search', out), []);
    const detail = out[0].detail;
    for (const key of ['pluginEntryId', 'canonicalUrl', 'syncedAt', 'cached', 'fetchedAt']) assert.equal(key in detail, false, `detail holds no ${key}`);
    assert.equal(out[0].cached, true, 'the candidate, not its detail, says it was cached');
    assert.deepEqual([detail.displayTitle, detail.seriesStatus, detail.seriesType, detail.year], ['Series 1', 'ongoing', 'manga', 2020]);
    assert.deepEqual([detail.authors, detail.artists, detail.genres], [['An Author'], ['An Artist'], ['adventure', 'drama']]);
    assert.deepEqual(detail.publishers, [{ name: 'Shogakukan', type: 'Original' }], 'a publisher with its role as the contributor type');
    assert.equal(detail.description, 'A series.\nIn two lines.');
});

test('display: titles with their language and kind, each listed once', () => {
    const [candidate] = mapping.search({ query: 'x', rows: [seriesById(1)], fetchedAt: null, cached: false });
    assert.deepEqual(candidate.detail.display.titles, [
        { title: 'Series 1', kind: 'main' },
        { title: 'シリーズ 1', language: 'ja', kind: 'native' },
        { title: 'Shiriizu 1', language: 'ja-Latn', kind: 'romanized' },
        { title: 'The Series 1', language: 'en', kind: 'alternate' },
    ]);
    const extra = mapping.lookup({ ...seriesById(1), secondary_titles: { unknown: [{ title: 'Untagged' }], fr: [{ title: 'La Série' }] } });
    assert.deepEqual(extra.display.titles.slice(4), [{ title: 'Untagged', kind: 'alternate' }, { title: 'La Série', language: 'fr', kind: 'alternate' }]);
});

test('display: cover sizes smallest first with the blurhash placeholder; content rating, dates, counts, tags, links, relations', () => {
    const { display } = mapping.lookup(seriesById(1));
    assert.equal(display.cover.placeholder.blurhash, 'LEHV6nWB2yk8pyo0adR*.7kCMdnj');
    assert.equal(display.cover.sizes[0].url, 'https://cdn.mangabaka.org/covers/1-150.jpg');
    assert.equal(display.cover.sizes[0].width, 100, 'x150 is a max height of 150: 150 × 400/600');
    assert.deepEqual(display.cover.sizes.at(-1), { url: 'https://cdn.mangabaka.org/covers/1.jpg', width: 400 }, 'the original last');
    assert.equal(display.cover.sizes.length, 10);
    assert.deepEqual([display.contentRating, display.originalLanguage, display.statusText], ['safe', 'ja', 'releasing']);
    assert.deepEqual(display.dates, { started: '2020-04-28', updated: '2026-10-01T00:00:00Z' }, 'no end date is absent');
    assert.deepEqual([display.volumes, display.chapters], [{ final: 15 }, { total: 42 }]);
    assert.deepEqual(display.tags, [
        { name: 'Cooking', group: 'Activities', path: 'Activities > Daily Life > Cooking', spoiler: false },
        { name: 'Time Skip', path: 'Time Skip', spoiler: true },
    ]);
    assert.deepEqual(display.links, [{ label: 'VIZ', url: 'https://www.viz.com/series', type: 'publisher', language: 'en' }]);
    assert.deepEqual(display.relations, [{ relation: 'side_story', pluginEntryId: '2', url: 'https://mangabaka.org/2' }]);
    assert.deepEqual([display.licensing, display.popularity], [{ licensed: true, anime: false }, { rank: 59 }]);
});

test('display: MangaBaka\'s rating and each site\'s, on the 0–100 normalized scale; a site without one is left out', () => {
    const { display } = mapping.lookup(seriesById(1));
    assert.deepEqual(display.ratings, [
        { source: 'MangaBaka', value: 87.0569142857143, scale: 100 },
        { source: 'AniList', value: 87, scale: 100 },
        { source: 'Anime-Planet', value: 88, scale: 100 },
        { source: 'Kitsu', value: 84, scale: 100 },
        { source: 'MangaUpdates', value: 86, scale: 100 },
        { source: 'MyAnimeList', value: 89, scale: 100 },
        { source: 'Shikimori', value: 89, scale: 100 },
    ]);
});

test('A32: a thin pornographic hit holds what it holds; nothing null, empty or a placeholder', () => {
    const [thin] = mapping.search({ query: 'x', rows: [seriesById(THIN_ID)], fetchedAt: null, cached: false });
    assert.deepEqual(validateResult('search', [thin]), []);
    assert.deepEqual(thin.detail, {
        displayTitle: 'Series 5',
        seriesStatus: 'completed',
        seriesType: 'other',
        display: { titles: [{ title: 'Series 5', kind: 'main' }], contentRating: 'pornographic', statusText: 'completed' },
    });
});

test('A34: MangaBaka\'s cancelled is cancelled; upcoming and unknown stay unknown', () => {
    const out = mapping.lookup(seriesById(CANCELLED_ID));
    assert.deepEqual(validateResult('lookup', out), []);
    assert.equal(out.seriesStatus, 'cancelled');
    assert.equal(mapping.enrich({ value: seriesById(CANCELLED_ID), cached: false, fetchedAt: null }).contribution.seriesStatus, 'cancelled');
    assert.deepEqual(['upcoming', 'unknown', null].map(mapping._seriesStatus), ['unknown', 'unknown', 'unknown']);
});

test('lookup (A33): the entry in full with the same display part a search hit carries', () => {
    const out = mapping.lookup(seriesById(1));
    assert.deepEqual(validateResult('lookup', out), []);
    assert.equal(out.pluginEntryId, '1');
    assert.equal(out.canonicalUrl, 'https://mangabaka.org/manga/1/Series-1');
    const [candidate] = mapping.search({ query: 'x', rows: [seriesById(1)], fetchedAt: null, cached: false });
    assert.deepEqual(out.display, candidate.detail.display);
});
