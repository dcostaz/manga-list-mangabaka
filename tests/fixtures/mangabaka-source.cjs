'use strict';

/**
 * MangaBaka as a stub source, in the shapes of https://mangabaka.org/api.json (read 2026-11-07) and of the
 * answers the old wrapper's live checks recorded (2026-08-24/27). An axios-shaped handler for the SDK's
 * createStubAxios().
 *
 * The library is served FIXTURE_PAGE entries per page whatever `limit` asks, so a three-entry library is two
 * pages and the client must follow `pagination.next` (F17).
 */

const BASE = 'https://api.mangabaka.org/v1';
const GOOD_KEYS = new Set(['mb-alpha-token', 'mb-beta-token']);
const FIXTURE_PAGE = 2;

/** @param {number} id */
function series(id) {
    return {
        id,
        title: `Series ${id}`,
        native_title: `シリーズ ${id}`,
        romanized_title: `Shiriizu ${id}`,
        secondary_titles: { en: [{ title: `The Series ${id}` }] },
        canonical_url: `https://mangabaka.org/${id}`,
        cover: { raw: { url: `https://cdn.mangabaka.org/covers/${id}.jpg`, width: 400, height: 600 }, x150: { x1: `https://cdn.mangabaka.org/covers/${id}-150.jpg` } },
        authors: ['An Author'],
        description: 'A series.',
        year: 2020,
        status: 'releasing',
        type: 'manga',
        total_chapters: '42',
        last_updated_at: '2026-10-01T00:00:00Z',
    };
}

const LIBRARY = [
    { series_id: 1, state: 'reading', rating: 85, progress_chapter: 12, progress_volume: 2, priority: 20 },
    { series_id: 2, state: 'considering', rating: null, progress_chapter: null, progress_volume: null, priority: 20 },
    { series_id: 3, state: 'paused', rating: 70, progress_chapter: 3, progress_volume: null, priority: 10 },
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
        return { status: 200, data: { status: 200, pagination: { count: 1, page: 1, limit: 20, next: null, previous: null }, data: [series(1)] } };
    }
    if (/^\/series\/\d+$/.test(path)) {
        const id = Number(path.split('/').pop());
        return id >= 900 ? { status: 404, data: { status: 404 } } : { status: 200, data: { status: 200, data: series(id) } };
    }
    if (/^https:\/\/cdn\.mangabaka\.org\//.test(url)) return { status: 200, data: new Uint8Array([1, 2, 3]) };
    return { status: 404, data: { status: 404 } };
}

module.exports = { sourceHandler, BASE, LIBRARY, series, GOOD_KEYS };
