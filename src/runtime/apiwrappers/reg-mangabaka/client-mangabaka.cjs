'use strict';

/**
 * L4 — MangaBaka's client: REACH and EXCHANGE (Plan-2026Q4-tracker-plugin-standardization §1.2).
 *
 * Talks to api.mangabaka.org and returns its own shapes. Endpoints are the settings' templates; every request goes
 * through `view.http`, bound per call by the SDK to the call's credential, identity, scope and signal. One source
 * call per contract method, named after it (the template's convention): the SDK binds `mapping.<method>(await
 * client.<method>(...))`.
 *
 * Source facts this file relies on (https://mangabaka.org/api.json, read 2026-11-07):
 *  - a Personal Access Token is sent as the `x-api-key` header; no exchange.
 *  - `GET /v1/my/library` is paginated: `page` (from 1), `limit` (default 12, at most 100), and a `pagination`
 *    object whose `next` is null on the last page (F17: the old wrapper read one page, 12 entries at most).
 *  - a library entry's `state` is one of considering, completed, dropped, paused, plan_to_read, reading, rereading;
 *    its `rating` is 0–100.
 */

const { PluginError, isPluginError } = require('@manga-list/plugin-sdk');

/** The API's own maximum page size for the library. */
const LIBRARY_PAGE_LIMIT = 100;

/**
 * A Personal Access Token needs no exchange: the token is the credential's `api_key`.
 */
const auth = {
    /** @param {{ api_key?: string } | null} credential */
    async exchange(credential) {
        const apiKey = credential && typeof credential.api_key === 'string' ? credential.api_key.trim() : '';
        if (!apiKey) {
            throw new PluginError('credential_rejected', 'no Personal Access Token was presented');
        }
        return { tokens: { key: { value: apiKey } } };
    },
    /**
     * @param {Record<string, { value: string }>} tokens
     * @param {Record<string, any>} config
     */
    apply(tokens, config) {
        return { ...config, headers: { ...(config.headers || {}), 'x-api-key': tokens.key.value } };
    },
};

/**
 * @param {string} html
 * @returns {string}
 */
function htmlErrorMessage(html) {
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (title && title[1] && title[1].trim()) return title[1].trim();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 180) : 'an HTML error page';
}

/**
 * MangaBaka's edge can answer with an HTML page (a Cloudflare challenge or error) where JSON belongs: a typed
 * error, never a parse of HTML.
 * @param {any} response
 */
function htmlNormalizer(response) {
    const headers = response && response.headers ? response.headers : {};
    const contentType = typeof headers['content-type'] === 'string' ? headers['content-type'] : '';
    const data = response ? response.data : null;
    const isHtml = contentType.includes('text/html') || (typeof data === 'string' && /^\s*<(?:!doctype|html)/i.test(data));
    if (isHtml && !(data instanceof Uint8Array)) {
        throw new PluginError('offline', `MangaBaka's edge answered an HTML page: ${htmlErrorMessage(typeof data === 'string' ? data : '')}`, { status: response.status });
    }
}

/**
 * @param {Record<string, unknown>} settings
 * @param {string} name - the endpoint's settings name (api.endpoints.<name>.template)
 * @param {Record<string, string | number>} [params]
 */
function endpoint(settings, name, params = {}) {
    const template = settings[`api.endpoints.${name}.template`];
    if (typeof template !== 'string' || !template) {
        throw new PluginError('source_error', `MangaBaka: no endpoint template for '${name}' in the settings`);
    }
    /** @type {Record<string, string>} */
    const values = { baseUrl: String(settings['api.baseUrl'] || ''), authBaseUrl: String(settings['api.authBaseUrl'] || '') };
    for (const [key, value] of Object.entries(params)) values[key] = encodeURIComponent(String(value));
    let url = template;
    for (const [key, value] of Object.entries(values)) url = url.split(`\${${key}}`).join(value);
    return url;
}

/** @param {unknown} data */
function toBuffer(data) {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data === 'string') return Buffer.from(data, 'binary');
    throw new PluginError('source_error', 'MangaBaka answered no image bytes');
}

/** @param {unknown} error */
const isNotFound = (error) => isPluginError(error) && error.code === 'not_found';

/**
 * @param {{ settings: Record<string, unknown>, utils: Record<string, any>, addNormalizer: (fn: (response: any) => void) => void }} deps
 */
function createClient({ settings, utils, addNormalizer }) {
    addNormalizer(htmlNormalizer);
    const ttl = (/** @type {string} */ key, /** @type {number} */ fallback) => Number(settings[`cache.ttl.${key}`]) || fallback;
    /** @param {unknown} q */
    const sanitize = (q) => (utils && typeof utils.sanitizeForSearch === 'function' ? utils.sanitizeForSearch(String(q)) : String(q).toLowerCase());

    /** @param {any} view */
    return (view) => {
        const http = view.http;
        const cache = view.cache;
        /** @param {Record<string, any>} config */
        const authed = (config) => http.authedRequest(config);

        /** The series, from the cache when fresh. @param {string | number} id @returns {Promise<any>} */
        async function series(id) {
            const key = `series:${id}`;
            const cached = await cache.get(key);
            if (cached) return cached;
            const body = (await http.get(endpoint(settings, 'seriesDetail', { series_id: id }), { endpoint: 'seriesDetail' })).data;
            const data = body && typeof body === 'object' ? body.data : null;
            if (!data) throw new PluginError('not_found', `MangaBaka has no series ${id}`);
            await cache.set(key, data, ttl('seriesMetadata', 86400));
            return data;
        }

        /** @param {string} query @param {{ refresh?: boolean }} [options] */
        async function search(query, options = {}) {
            const q = typeof query === 'string' ? query.trim() : '';
            if (!q) return { query: q, rows: [], fetchedAt: null, cached: false };
            const key = `search:${sanitize(q)}`;
            if (!options.refresh) {
                const hit = /** @type {any} */ (await cache.get(key));
                if (hit && Array.isArray(hit.rows) && hit.rows.length) return { query: q, rows: hit.rows, fetchedAt: hit.fetchedAt || null, cached: true };
            }
            const body = (await http.get(endpoint(settings, 'seriesSearch'), { params: { q }, endpoint: 'seriesSearch', timeoutKind: 'search' })).data;
            const rows = body && Array.isArray(body.data) ? body.data : [];
            const fetchedAt = new Date().toISOString();
            await cache.set(key, { rows, fetchedAt }, ttl('searchResults', 3600));
            return { query: q, rows, fetchedAt, cached: false };
        }

        /** @param {string | number} id @returns {Promise<any | null>} the library entry, or null when not on the library */
        async function libraryEntry(id) {
            try {
                const body = (await authed({ method: 'get', url: endpoint(settings, 'myLibraryEntry', { series_id: id }), endpoint: 'myLibraryEntry' })).data;
                return body && typeof body === 'object' && body.data ? body.data : null;
            } catch (error) {
                if (isNotFound(error)) return null;
                throw error;
            }
        }

        return {
            /** A token is good when the source serves the profile it unlocks. @param {unknown} _credential */
            async testCredentials(_credential) {
                await authed({ method: 'get', url: endpoint(settings, 'myProfile'), endpoint: 'myProfile' });
                return true;
            },
            search,
            /** @param {string} id */
            lookup: (id) => series(id),
            /** @param {string} id */
            enrich: (id) => series(id),
            /** @param {{ title?: string }} query @param {{ pluginEntryId?: string }} [options] */
            async searchCovers(query, options = {}) {
                if (options && options.pluginEntryId) return series(options.pluginEntryId);
                const found = await search(query && query.title ? query.title : '');
                return found.rows.length ? series(found.rows[0].id) : null;
            },
            /** coverId is the series id (an older `<id>/<file>` form is accepted). @param {string} coverId */
            async downloadCover(coverId) {
                const seriesId = Number(String(coverId || '').split('/')[0]);
                if (!Number.isFinite(seriesId) || seriesId <= 0) {
                    throw new PluginError('not_found', `MangaBaka cover id '${coverId}' names no series`);
                }
                const key = `cover-bytes:${seriesId}`;
                const cached = await cache.get(key);
                if (typeof cached === 'string' && cached) return Buffer.from(cached, 'base64');
                const raw = await series(seriesId);
                const url = raw && raw.cover && raw.cover.raw && raw.cover.raw.url;
                if (typeof url !== 'string' || !url) throw new PluginError('not_found', `MangaBaka series ${seriesId} has no cover`);
                const bytes = toBuffer((await http.get(url, { responseType: 'arraybuffer', endpoint: 'coverImage' })).data);
                await cache.set(key, bytes.toString('base64'), ttl('coverUrls', 604800));
                return bytes;
            },
            pullProgress: libraryEntry,
            /** @param {{ pluginEntryId: string, chapter?: number, volume?: number, rating?: number }} entry */
            async pushProgress(entry) {
                /** @type {Record<string, number>} */
                const body = {};
                if (typeof entry.chapter === 'number') body.progress_chapter = entry.chapter;
                if (typeof entry.volume === 'number') body.progress_volume = entry.volume;
                if (typeof entry.rating === 'number') body.rating = Math.round(entry.rating * 10);
                await authed({ method: 'patch', url: endpoint(settings, 'myLibraryEntry', { series_id: entry.pluginEntryId }), data: body, endpoint: 'myLibraryEntry' });
                return body;
            },
            /** The whole library, every page (F17). */
            async getReadingList() {
                /** @type {any[]} */
                const rows = [];
                for (let page = 1; page; ) {
                    const body = (await authed({ method: 'get', url: endpoint(settings, 'myLibrary'), params: { page, limit: LIBRARY_PAGE_LIMIT }, endpoint: 'myLibrary' })).data;
                    if (body && Array.isArray(body.data)) rows.push(...body.data);
                    const pagination = body && body.pagination;
                    page = pagination && pagination.next ? page + 1 : 0;
                }
                return rows;
            },
            /** Set the entry's state; an entry not yet on the library is added. @param {{ pluginEntryId: string, status: string }} entry */
            async subscribe(entry) {
                const url = endpoint(settings, 'myLibraryEntry', { series_id: entry.pluginEntryId });
                try {
                    await authed({ method: 'patch', url, data: { state: entry.status }, endpoint: 'myLibraryEntry' });
                } catch (error) {
                    if (!isNotFound(error)) throw error;
                    await authed({ method: 'post', url, data: { state: entry.status }, endpoint: 'myLibraryEntry' });
                }
                return { state: entry.status };
            },
            /** Already absent is success (§2). @param {string} id */
            async unsubscribe(id) {
                try {
                    await authed({ method: 'delete', url: endpoint(settings, 'myLibraryEntry', { series_id: id }), endpoint: 'myLibraryEntry' });
                } catch (error) {
                    if (!isNotFound(error)) throw error;
                }
                return {};
            },
            /** @param {string} id */
            queryLive: (id) => series(id),
            /** The series' own volatile state, never the user's library (Decision 3). @param {string} id */
            summarizeEntries: (id) => series(id),
        };
    };
}

module.exports = { createClient, auth, endpoint, htmlNormalizer, LIBRARY_PAGE_LIMIT };
