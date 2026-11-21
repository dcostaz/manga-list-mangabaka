'use strict';

/**
 * MangaBaka as a stub source, in the shapes of https://mangabaka.org/api.json (read 2026-11-07), of the answers the
 * old wrapper's live checks recorded (2026-08-24/27) and of sub-plan 7.6's live search and series reads (2026-11-19).
 * An axios-shaped handler for the SDK's createStubAxios().
 *
 * The library is served FIXTURE_PAGE entries per page whatever `limit` asks, so a three-entry library is two
 * pages and the client must follow `pagination.next` (F17). The search answers SEARCH_PAGE hits without `limit` and up
 * to `limit` with it, so an allHits search (A35) answers more.
 */

const BASE = 'https://api.mangabaka.org/v1';
const GOOD_KEYS = new Set(['mb-alpha-token', 'mb-beta-token']);
const FIXTURE_PAGE = 2;

/**
 * A series record, the shape a search hit and a series read both answer (the live reads of 2026-11-19: every hit is
 * the full record). Its titles repeat the native, romanized and English ones under their language, as MangaBaka's do.
 * @param {number} id
 */
function series(id) {
    const proxied = (/** @type {number} */ height) => ({
        x1: `https://cdn.mangabaka.org/covers/${id}-${height}.jpg`,
        x2: `https://cdn.mangabaka.org/covers/${id}-${height}@2.jpg`,
        x3: `https://cdn.mangabaka.org/covers/${id}-${height}@3.jpg`,
    });
    return {
        id,
        state: 'active',
        merged_with: null,
        canonical_url: `https://mangabaka.org/manga/${id}/Series-${id}`,
        title: `Series ${id}`,
        native_title: `シリーズ ${id}`,
        romanized_title: `Shiriizu ${id}`,
        secondary_titles: { en: [{ type: 'unknown', title: `The Series ${id}`, note: null }] },
        titles: [
            { language: 'ja', traits: ['native'], title: `シリーズ ${id}`, note: null, is_primary: true },
            { language: 'ja-Latn', traits: ['native'], title: `Shiriizu ${id}`, note: null, is_primary: true },
            { language: 'en', traits: ['official'], title: `The Series ${id}`, note: null, is_primary: true },
        ],
        cover: {
            raw: { url: `https://cdn.mangabaka.org/covers/${id}.jpg`, size: 632322, width: 400, height: 600, blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', thumbhash: 'bPgFHARmxqjYaXYn+GibkIYHKA==', format: 'jpeg' },
            x150: proxied(150),
            x250: proxied(250),
            x350: proxied(350),
        },
        authors: ['An Author'],
        artists: ['An Artist'],
        description: 'A series.\nIn two lines.',
        year: 2020,
        published: { start_date: '2020-04-28', end_date: null, start_date_is_estimated: false, end_date_is_estimated: false },
        status: 'releasing',
        is_licensed: true,
        has_anime: false,
        anime: null,
        content_rating: 'safe',
        type: 'manga',
        original_language: 'ja',
        rating: 87.0569142857143,
        popularity: { global: { current: 59, history: { '1d': 61 } }, type: { current: 47, history: { '1d': 48 } } },
        final_volume: '15',
        total_chapters: '42',
        links: ['https://www.viz.com/series', `https://mangabaka.org/${id}`],
        links_v2: [{ id: 'l-1', url: 'https://www.viz.com/series', name: 'www.viz.com', name_display: 'VIZ', type: 'publisher', language: 'en' }],
        publishers: [{ id: 4531, name: 'Shogakukan', canonical_url: 'https://mangabaka.org/publisher/4531/Shogakukan', language: 'ja', note: null, type: 'Original' }],
        genres_v2: null,
        genres: ['adventure', 'drama'],
        tags_v2: [
            { id: 669, is_spoiler: false, is_genre: false, is_explicit: false, parent_id: 1141, name: 'Cooking', level: 3, name_path: 'Activities > Daily Life > Cooking', content_rating: 'safe' },
            { id: 70, is_spoiler: true, is_genre: false, is_explicit: false, parent_id: null, name: 'Time Skip', level: 1, name_path: 'Time Skip', content_rating: 'safe' },
        ],
        tags: ['Cooking', 'Time Skip'],
        last_updated_at: '2026-10-01T00:00:00Z',
        relationships: { side_story: [2] },
        relationships_v2: [{ id: 'r-1', to_series_id: 2, relation_type: 'side_story', is_manual: false, note: null, chronology: 'unknown', published_start_date: null }],
        source: {
            anilist: { id: 118586, rating: 8.7, rating_normalized: 87 },
            anime_planet: { id: 'series', rating: 4.4, rating_normalized: 88 },
            anime_news_network: { id: 24449, rating: null, rating_normalized: null },
            kitsu: { id: 56355, rating: 8.421, rating_normalized: 84 },
            manga_updates: { id: 'ugf5dzu', rating: 8.6, rating_normalized: 86 },
            my_anime_list: { id: 126287, rating: 8.87, rating_normalized: 89 },
            shikimori: { id: 126287, rating: 8.86, rating_normalized: 89 },
        },
    };
}

/** A cancelled series (A34; the live *Versatile Mage* is one). */
const CANCELLED_ID = 4;
/**
 * A pornographic doujinshi holding little: no rating, description, cover, links, tags or site ratings, its other
 * fields null or empty as the live reads give them (A32: what it does not hold is absent from the mapping).
 */
const THIN_ID = 5;

/** @param {number} id */
function seriesById(id) {
    if (id === CANCELLED_ID) return { ...series(id), status: 'cancelled', type: 'manhua' };
    if (id === THIN_ID) {
        return {
            ...series(id),
            content_rating: 'pornographic', type: 'other', status: 'completed', rating: null, description: null,
            cover: { raw: { url: null, blurhash: null }, x150: { x1: null, x2: null, x3: null }, x250: null, x350: null },
            native_title: null, romanized_title: null, secondary_titles: null, titles: [],
            authors: [], artists: [], publishers: [], links: [], links_v2: [], tags: [], tags_v2: [], genres: [],
            final_volume: null, total_chapters: null, published: { start_date: null, end_date: null }, year: null,
            relationships: {}, relationships_v2: [], popularity: { global: { current: null }, type: { current: null } },
            is_licensed: null, has_anime: null, original_language: null, last_updated_at: null,
            source: { anilist: { id: null, rating: null, rating_normalized: null } },
        };
    }
    return series(id);
}

/** The search's hits, in the source's order. */
const SEARCH_HITS = [1, CANCELLED_ID, THIN_ID];
/** What the source answers without `limit`: its own page. */
const SEARCH_PAGE = 2;

/** The library: each entry embeds its series (`Series`), the source of the list read's title and alternate titles. */
const LIBRARY = [
    { series_id: 1, state: 'reading', rating: 85, progress_chapter: 12, progress_volume: 2, priority: 20, Series: series(1) },
    { series_id: 2, state: 'considering', rating: null, progress_chapter: null, progress_volume: null, priority: 20, Series: series(2) },
    { series_id: 3, state: 'paused', rating: 70, progress_chapter: 3, progress_volume: null, priority: 10, Series: series(3) },
];

/**
 * @param {Record<string, any>} config
 * @returns {{ status: number, data?: unknown, headers?: Record<string, string> }}
 */
function sourceHandler(config) {
    const url = String(config.url || '');
    const method = String(config.method || 'get').toLowerCase();
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const key = config.headers && config.headers['x-api-key'];

    if (path.startsWith('/my/')) {
        if (!GOOD_KEYS.has(key)) return { status: 401, data: { status: 401 } };
        if (path === '/my/profile') return { status: 200, data: { status: 200, data: { username: key } } };
        if (path === '/my/library') {
            const page = Number(config.params && config.params.page) || 1;
            const start = (page - 1) * FIXTURE_PAGE;
            const rows = LIBRARY.slice(start, start + FIXTURE_PAGE);
            const next = start + FIXTURE_PAGE < LIBRARY.length ? `${BASE}/my/library?page=${page + 1}` : null;
            return { status: 200, data: { status: 200, pagination: { count: LIBRARY.length, page, limit: FIXTURE_PAGE, next, previous: null }, data: rows } };
        }
        const id = Number(path.split('/').pop());
        if (!Number.isFinite(id) || id >= 900) return { status: 404, data: { status: 404 } };
        if (method === 'get') return { status: 200, data: { status: 200, data: { ...(LIBRARY.find((e) => e.series_id === id) || LIBRARY[0]), series_id: id } } };
        return { status: 200, data: { status: 200, data: true } };
    }
    if (path === '/series/search') {
        const limit = Number(config.params && config.params.limit) || SEARCH_PAGE;
        const rows = SEARCH_HITS.slice(0, limit).map(seriesById);
        return { status: 200, data: { status: 200, pagination: { count: SEARCH_HITS.length, page: 1, limit, next: null, previous: null }, data: rows } };
    }
    if (/^\/series\/\d+$/.test(path)) {
        const id = Number(path.split('/').pop());
        return id >= 900 ? { status: 404, data: { status: 404 } } : { status: 200, data: { status: 200, data: seriesById(id) } };
    }
    if (/^https:\/\/cdn\.mangabaka\.org\//.test(url)) return { status: 200, data: new Uint8Array([1, 2, 3]) };
    return { status: 404, data: { status: 404 } };
}

module.exports = { sourceHandler, BASE, LIBRARY, series, seriesById, GOOD_KEYS, CANCELLED_ID, THIN_ID, SEARCH_HITS, SEARCH_PAGE };
