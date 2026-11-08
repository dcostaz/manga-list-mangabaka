'use strict';

/**
 * L3b — MangaBaka's mapping: MAP (Plan-2026Q4-tracker-plugin-standardization §1.2). Pure functions: MangaBaka's
 * shapes in, the contract's DTOs out (host-capability-contract.md §2, §2.6). One function per contract method,
 * named after it. Status tokens pass through as MangaBaka's own (`reading`, `considering`, …): the host resolves
 * them through the manifest's statusVocabulary (§2.2), never the plugin.
 */

const { markCached } = require('@manga-list/plugin-sdk');

const SITE = 'https://mangabaka.org';

/** @param {any} raw @returns {string | null} */
function canonicalUrl(raw) {
    if (raw && typeof raw.canonical_url === 'string' && raw.canonical_url) return raw.canonical_url;
    const id = raw ? Number(raw.id) : NaN;
    return Number.isFinite(id) && id > 0 ? `${SITE}/${id}` : null;
}

/** MangaBaka's publication status → the contribution's closed set. @param {unknown} raw */
function seriesStatus(raw) {
    const status = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (status === 'completed' || status === 'complete') return 'completed';
    if (status === 'releasing' || status === 'ongoing') return 'ongoing';
    if (status === 'hiatus' || status === 'on_hiatus') return 'hiatus';
    return 'unknown';
}

/** @param {any} raw @returns {string | null} */
function coverUrl(raw) {
    const cover = raw && typeof raw === 'object' ? raw.cover : null;
    return cover && cover.raw && typeof cover.raw.url === 'string' ? cover.raw.url : null;
}

/** Every other title the series carries, the primary left out. @param {any} raw @returns {string[]} */
function altTitles(raw) {
    if (!raw || typeof raw !== 'object') return [];
    const primary = typeof raw.title === 'string' ? raw.title.trim() : '';
    /** @type {string[]} */
    const candidates = [];
    for (const value of [raw.native_title, raw.romanized_title]) {
        if (typeof value === 'string' && value.trim()) candidates.push(value.trim());
    }
    if (Array.isArray(raw.titles)) {
        for (const entry of raw.titles) if (entry && typeof entry.title === 'string' && entry.title.trim()) candidates.push(entry.title.trim());
    }
    if (raw.secondary_titles && typeof raw.secondary_titles === 'object') {
        for (const entries of Object.values(raw.secondary_titles)) {
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) if (entry && typeof entry.title === 'string' && entry.title.trim()) candidates.push(entry.title.trim());
        }
    }
    const unique = [...new Set(candidates)];
    return primary ? unique.filter((title) => title !== primary) : unique;
}

/**
 * How well a candidate's titles match the query, 0–1: an exact word-for-word match is 1, containment 0.85, else the
 * words' overlap. @param {string} query @param {string[]} titles
 */
function confidence(query, titles) {
    /** @param {unknown} text */
    const words = (text) => (typeof text === 'string'
        ? text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
        : []);
    const queryWords = words(query);
    if (!queryWords.length) return 0;
    const queryKey = queryWords.join(' ');
    const querySet = new Set(queryWords);
    let best = 0;
    for (const title of titles) {
        const titleWords = words(title);
        if (!titleWords.length) continue;
        const key = titleWords.join(' ');
        let similarity;
        if (key === queryKey) similarity = 1;
        else if (key.includes(queryKey) || queryKey.includes(key)) similarity = 0.85;
        else {
            const titleSet = new Set(titleWords);
            const shared = [...querySet].filter((w) => titleSet.has(w)).length;
            similarity = Math.min(0.99, shared / new Set([...querySet, ...titleSet]).size);
        }
        best = Math.max(best, similarity);
    }
    return Math.round(best * 100) / 100;
}

/** @param {any} raw */
function contribution(raw) {
    const id = String(raw.id);
    /** @type {Record<string, any>} */
    const out = { pluginEntryId: id, syncedAt: new Date().toISOString(), seriesStatus: seriesStatus(raw.status) };
    if (raw.title) out.displayTitle = raw.title;
    const alts = altTitles(raw);
    if (alts.length) out.altTitles = alts;
    for (const key of ['authors', 'artists', 'genres', 'tags', 'publishers']) {
        if (Array.isArray(raw[key]) && raw[key].length) out[key] = raw[key];
    }
    if (raw.description) out.description = raw.description;
    const cover = coverUrl(raw);
    if (cover) out.coverUrl = cover;
    if (typeof raw.year === 'number' && Number.isFinite(raw.year)) out.year = raw.year;
    if (typeof raw.type === 'string' && raw.type) out.seriesType = raw.type;
    const url = canonicalUrl(raw);
    out.sourceLinks = url ? [{ siteId: 'mangabaka', siteLabel: 'MangaBaka', seriesUrl: url, isPrimary: true }] : [];
    return out;
}

/** MangaBaka's 0–100 library rating → the host's 0–10. @param {unknown} rating */
const ratingOf = (rating) => (typeof rating === 'number' ? Math.round(rating) / 10 : null);

/** @param {any} row */
function readingListEntry(row) {
    const series = row && row.Series && typeof row.Series === 'object' ? row.Series : null;
    const id = String(row.series_id ?? (series && series.id) ?? row.id);
    return {
        pluginEntryId: id,
        title: series && typeof series.title === 'string' ? series.title : null,
        canonicalUrl: (series && canonicalUrl(series)) || `${SITE}/${id}`,
        status: typeof row.state === 'string' ? row.state : null,
        chapter: typeof row.progress_chapter === 'number' ? row.progress_chapter : null,
        rating: ratingOf(row.rating),
        volume: typeof row.progress_volume === 'number' ? row.progress_volume : null,
        listId: null,
        priority: typeof row.priority === 'number' ? row.priority : null,
        lastUpdated: typeof row.updated_at === 'string' ? row.updated_at : null,
    };
}

module.exports = {
    /** @param {{ query: string, rows: any[], fetchedAt: string | null, cached: boolean }} found */
    search(found) {
        return found.rows.map((row) => {
            const alts = altTitles(row);
            const candidate = {
                pluginEntryId: String(row.id),
                title: row.title,
                altTitles: alts,
                confidence: confidence(found.query, [row.title, ...alts]),
                canonicalUrl: canonicalUrl(row),
            };
            return found.cached ? markCached(candidate, found.fetchedAt) : candidate;
        });
    },
    /** @param {any} raw */
    lookup: (raw) => ({ ...contribution(raw), canonicalUrl: canonicalUrl(raw) }),
    /** @param {any} raw */
    enrich: (raw) => ({ contribution: contribution(raw) }),
    /** One cover per series: MangaBaka's current one. @param {any} raw */
    searchCovers(raw) {
        const url = coverUrl(raw);
        if (!raw || !url) return [];
        const meta = raw.cover && raw.cover.raw ? raw.cover.raw : {};
        return [{
            coverId: String(raw.id),
            imageUrl: url,
            thumbnailUrl: raw.cover && raw.cover.x150 && raw.cover.x150.x1 ? raw.cover.x150.x1 : undefined,
            width: typeof meta.width === 'number' ? meta.width : undefined,
            height: typeof meta.height === 'number' ? meta.height : undefined,
        }];
    },
    /** @param {any | null} entry @param {string} id */
    pullProgress: (entry, id) => ({
        pluginEntryId: String(id),
        status: entry && typeof entry.state === 'string' ? entry.state : null,
        chapter: entry && typeof entry.progress_chapter === 'number' ? entry.progress_chapter : null,
        rating: entry ? ratingOf(entry.rating) : null,
        lastUpdated: entry && typeof entry.updated_at === 'string' ? entry.updated_at : null,
    }),
    /** What landed, back on the host's scale. @param {Record<string, number>} sent */
    pushProgress: (sent) => ({
        applied: {
            ...(typeof sent.progress_chapter === 'number' ? { chapter: sent.progress_chapter } : {}),
            ...(typeof sent.rating === 'number' ? { rating: sent.rating / 10 } : {}),
        },
    }),
    /** @param {any[]} rows */
    getReadingList: (rows) => rows.map(readingListEntry),
    /** @param {{ state: string }} out */
    subscribe: (out) => ({ listId: null, status: out.state }),
    /** @param {any} raw @param {string} id */
    queryLive(raw, id) {
        const url = canonicalUrl(raw);
        const alts = altTitles(raw);
        return {
            status: 'ok',
            data: {
                pluginEntryId: String(id),
                displayTitle: typeof raw.title === 'string' ? raw.title : undefined,
                statusLabel: seriesStatus(raw.status),
                fetchedAt: new Date().toISOString(),
                sections: [
                    {
                        type: 'stat-grid',
                        label: 'Overview',
                        fields: [
                            { label: 'Series status', value: seriesStatus(raw.status) },
                            { label: 'Type', value: typeof raw.type === 'string' ? raw.type : '—' },
                            { label: 'Year', value: typeof raw.year === 'number' ? raw.year : '—' },
                            { label: 'Alt titles', value: alts.length },
                        ],
                    },
                    ...(url ? [{ type: 'link-list', label: 'Links', links: [{ label: 'MangaBaka', url }] }] : []),
                ],
            },
        };
    },
    /** The series' volatile state (A4): publication status and chapter count, never the user's list. @param {any} raw */
    summarizeEntries: (raw) => ({
        summary: {
            label: typeof raw.status === 'string' ? raw.status.charAt(0).toUpperCase() + raw.status.slice(1) : null,
            status: typeof raw.status === 'string' ? raw.status : null,
            latestChapter: typeof raw.total_chapters === 'number' ? raw.total_chapters : (Number(raw.total_chapters) || null),
            lastUpdated: typeof raw.last_updated_at === 'string' ? raw.last_updated_at : null,
        },
    }),
    // exposed for the mapping tests
    _confidence: confidence,
    _altTitles: altTitles,
};
