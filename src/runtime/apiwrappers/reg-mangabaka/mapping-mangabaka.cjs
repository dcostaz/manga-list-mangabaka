'use strict';

/**
 * L3b — MangaBaka's mapping: MAP (Plan-2026Q4-tracker-plugin-standardization §1.2). Pure functions: MangaBaka's
 * shapes in, the contract's DTOs out (host-capability-contract.md §2, §2.6). One function per contract method,
 * named after it. Status tokens pass through as MangaBaka's own (`reading`, `considering`, …): the host resolves
 * them through the manifest's statusVocabulary (§2.2), never the plugin.
 */

const { markCached, CONTENT_RATINGS } = require('@manga-list/plugin-sdk');

/** @typedef {import('@manga-list/plugin-sdk').PluginEntryRecord} PluginEntryRecord */
/** @typedef {import('@manga-list/plugin-sdk').PluginEntryDisplay} PluginEntryDisplay */
/** @typedef {import('@manga-list/plugin-sdk').PluginEntryDetail} PluginEntryDetail */
/** @typedef {import('@manga-list/plugin-sdk').PluginLinkContribution} PluginLinkContribution */
/** @typedef {import('@manga-list/plugin-sdk').PluginMatchCandidate} PluginMatchCandidate */
/** @typedef {import('@manga-list/plugin-sdk').PluginSeriesStatus} PluginSeriesStatus */
/** @typedef {import('@manga-list/plugin-sdk').PluginContentRating} PluginContentRating */
/** @typedef {import('@manga-list/plugin-sdk').PluginContributor} PluginContributor */
/** @typedef {import('@manga-list/plugin-sdk').PluginDisplayTitle} PluginDisplayTitle */
/** @typedef {import('@manga-list/plugin-sdk').PluginDisplayCoverSize} PluginDisplayCoverSize */
/** @typedef {import('@manga-list/plugin-sdk').PluginDisplayCover} PluginDisplayCover */
/** @typedef {import('@manga-list/plugin-sdk').PluginDisplayTag} PluginDisplayTag */
/** @typedef {import('@manga-list/plugin-sdk').PluginDisplayRating} PluginDisplayRating */
/** @typedef {import('@manga-list/plugin-sdk').PluginDisplayRelation} PluginDisplayRelation */
/** @typedef {import('@manga-list/plugin-sdk').PluginDisplayLink} PluginDisplayLink */

const SITE = 'https://mangabaka.org';

/**
 * The sites whose ratings a MangaBaka record carries (`source.<key>`), named as the sites name themselves; a key not
 * listed here is named by its own key.
 */
const RATING_SITES = Object.freeze({
    anilist: 'AniList',
    anime_planet: 'Anime-Planet',
    anime_news_network: 'Anime News Network',
    kitsu: 'Kitsu',
    manga_updates: 'MangaUpdates',
    my_anime_list: 'MyAnimeList',
    shikimori: 'Shikimori',
});

/** The proxied cover sizes a record carries, each scaled to a max height in px (api.json, `V1_Series_Cover_Image`). */
const COVER_HEIGHTS = Object.freeze([150, 250, 350]);
/** Each size at 1×, 2× and 3× its height. */
const COVER_DENSITIES = Object.freeze([1, 2, 3]);

/** @param {any} raw @returns {string | null} */
function canonicalUrl(raw) {
    if (raw && typeof raw.canonical_url === 'string' && raw.canonical_url) return raw.canonical_url;
    const id = raw ? Number(raw.id) : NaN;
    return Number.isFinite(id) && id > 0 ? `${SITE}/${id}` : null;
}

/**
 * MangaBaka's publication status → the contribution's closed set. MangaBaka's own are releasing, completed, hiatus,
 * cancelled, upcoming and unknown (api.json); `cancelled` is its own from 4.4.0 (A34), `upcoming` is not one.
 * @param {unknown} raw
 * @returns {PluginSeriesStatus}
 */
function seriesStatus(raw) {
    const status = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (status === 'completed' || status === 'complete') return 'completed';
    if (status === 'releasing' || status === 'ongoing') return 'ongoing';
    if (status === 'hiatus' || status === 'on_hiatus') return 'hiatus';
    if (status === 'cancelled' || status === 'canceled') return 'cancelled';
    return 'unknown';
}

/**
 * Drop what the source does not hold: a field is absent, never null, '' or [] (A32), and an object left with no
 * field is absent too.
 * @template {object} T
 * @param {T} obj
 * @returns {T}
 */
function held(obj) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
        if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
        out[key] = value;
    }
    return /** @type {T} */ (out);
}

/** @param {unknown} value @returns {string | undefined} */
const text = (value) => (typeof value === 'string' && value.trim() ? value : undefined);

/** A count MangaBaka gives as a string ("147") or a number. @param {unknown} value @returns {number | undefined} */
function count(value) {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** @param {unknown} value @returns {string[] | undefined} */
function strings(value) {
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()) : undefined;
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

/**
 * @param {any} raw
 * @returns {PluginLinkContribution}
 */
function contribution(raw) {
    const id = String(raw.id);
    /** @type {PluginLinkContribution} */
    const out = { pluginEntryId: id, syncedAt: new Date().toISOString(), seriesStatus: seriesStatus(raw.status) };
    if (raw.title) out.displayTitle = raw.title;
    const alts = altTitles(raw);
    if (alts.length) out.altTitles = alts;
    for (const key of /** @type {const} */ (['authors', 'artists', 'genres', 'tags', 'publishers'])) {
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

// ── The record and its display part (contract 4.4.0, §2.4.1: A32, A33) ────────────────────────────────────────
// MangaBaka's search hit is its full series record, and its series read the same record: one mapping serves the
// candidate's `detail` and `lookup`'s `display`. A field the record does not hold is absent, never null, '' or [].

/**
 * A `titles[]` entry's kind: `native` where MangaBaka marks it so, `romanized` where that native title is in Latin
 * script (a `-Latn` language, as `ja-Latn`), `alternate` otherwise.
 * @param {{ language?: unknown, traits?: unknown }} entry
 * @returns {PluginDisplayTitle['kind']}
 */
function titleKind(entry) {
    const traits = Array.isArray(entry.traits) ? entry.traits : [];
    if (!traits.includes('native')) return 'alternate';
    return typeof entry.language === 'string' && /-(latn|ro)$/i.test(entry.language) ? 'romanized' : 'native';
}

/**
 * Every title the record carries, with its language and kind: the main title, the native and romanized titles,
 * the language-tagged `titles[]`, then `secondary_titles` (keyed by language; `unknown` gives none). A title is
 * listed once, where it first appears; the native and romanized titles take their language from `titles[]`.
 * @param {any} raw
 * @returns {PluginDisplayTitle[]}
 */
function displayTitles(raw) {
    /** @type {any[]} */
    const listed = Array.isArray(raw.titles) ? raw.titles.filter((/** @type {any} */ t) => t && text(t.title)) : [];
    /** @param {string} title */
    const languageOf = (title) => {
        const entry = listed.find((t) => t.title.trim() === title);
        return entry ? text(entry.language) : undefined;
    };
    /** @type {PluginDisplayTitle[]} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    /** @param {unknown} value @param {PluginDisplayTitle['kind']} kind @param {string | undefined} [language] */
    const add = (value, kind, language) => {
        const title = text(value);
        if (!title || seen.has(title.trim())) return;
        seen.add(title.trim());
        out.push(held({ title: title.trim(), language: language === undefined ? languageOf(title.trim()) : language, kind }));
    };
    add(raw.title, 'main');
    add(raw.native_title, 'native');
    add(raw.romanized_title, 'romanized');
    for (const entry of listed) add(entry.title, titleKind(entry), text(entry.language));
    if (raw.secondary_titles && typeof raw.secondary_titles === 'object') {
        for (const [language, entries] of Object.entries(raw.secondary_titles)) {
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) if (entry) add(entry.title, 'alternate', language === 'unknown' ? '' : language);
        }
    }
    return out;
}

/**
 * The cover's sizes, smallest first, the original last, and its blurhash placeholder. The proxied sizes (`x150`,
 * `x250`, `x350`, each at `x1`/`x2`/`x3`) are scaled to that max height with the aspect ratio kept (api.json); their
 * width is worked out from the original's dimensions, never above the original's.
 * @param {any} raw
 * @returns {PluginDisplayCover | undefined}
 */
function displayCover(raw) {
    const cover = raw.cover && typeof raw.cover === 'object' ? raw.cover : null;
    if (!cover) return undefined;
    const original = cover.raw && typeof cover.raw === 'object' ? cover.raw : {};
    const width = count(original.width);
    const height = count(original.height);
    /** @type {Array<PluginDisplayCoverSize & { height: number }>} */
    const proxied = [];
    for (const max of COVER_HEIGHTS) {
        const set = cover[`x${max}`];
        if (!set || typeof set !== 'object') continue;
        for (const density of COVER_DENSITIES) {
            const url = text(set[`x${density}`]);
            if (!url) continue;
            const target = max * density;
            const scaled = width && height ? Math.min(width, Math.round((target * width) / height)) : undefined;
            proxied.push({ url, height: target, ...(scaled ? { width: scaled } : {}) });
        }
    }
    /** @type {PluginDisplayCoverSize[]} */
    const sizes = proxied.sort((a, b) => a.height - b.height).map(({ url, width: w }) => held({ url, width: w }));
    const rawUrl = text(original.url);
    if (rawUrl) sizes.push(held({ url: rawUrl, width }));
    /** @type {Set<string>} */
    const seen = new Set();
    const unique = sizes.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
    if (!unique.length) return undefined;
    const blurhash = text(original.blurhash);
    return blurhash ? { sizes: unique, placeholder: { blurhash } } : { sizes: unique };
}

/**
 * Tags with their path, top-level group and spoiler flag (`tags_v2`); the plain `tags` names where it has none.
 * @param {any} raw
 * @returns {PluginDisplayTag[] | undefined}
 */
function displayTags(raw) {
    if (Array.isArray(raw.tags_v2) && raw.tags_v2.length) {
        return raw.tags_v2.filter((/** @type {any} */ t) => t && text(t.name)).map((/** @type {any} */ t) => {
            const path = text(t.name_path);
            const segments = path ? path.split('>').map((s) => s.trim()).filter(Boolean) : [];
            return held({
                name: String(t.name).trim(),
                group: segments.length > 1 ? segments[0] : undefined,
                path,
                spoiler: typeof t.is_spoiler === 'boolean' ? t.is_spoiler : undefined,
            });
        });
    }
    const names = strings(raw.tags);
    return names ? names.map((name) => ({ name })) : undefined;
}

/**
 * MangaBaka's own rating and each site's it carries, every one on its 0–100 normalized value (card brief §5 rule 9).
 * @param {any} raw
 * @returns {PluginDisplayRating[]}
 */
function displayRatings(raw) {
    /** @param {unknown} value */
    const percent = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined);
    /** @type {PluginDisplayRating[]} */
    const out = [];
    const own = percent(raw.rating);
    if (own !== undefined) out.push({ source: 'MangaBaka', value: own, scale: 100 });
    if (raw.source && typeof raw.source === 'object') {
        for (const [key, site] of Object.entries(raw.source)) {
            const value = percent(site && typeof site === 'object' ? /** @type {any} */ (site).rating_normalized : undefined);
            if (value === undefined) continue;
            out.push({ source: RATING_SITES[/** @type {keyof typeof RATING_SITES} */ (key)] || key, value, scale: 100 });
        }
    }
    return out;
}

/**
 * The typed external links (`links_v2`): display name, type and language; the plain `links` where it has none.
 * @param {any} raw
 * @returns {PluginDisplayLink[] | undefined}
 */
function displayLinks(raw) {
    if (Array.isArray(raw.links_v2) && raw.links_v2.length) {
        return raw.links_v2.filter((/** @type {any} */ l) => l && text(l.url)).map((/** @type {any} */ l) => held({
            label: text(l.name_display) || text(l.name) || hostOf(l.url),
            url: l.url,
            type: text(l.type),
            language: text(l.language),
        }));
    }
    const urls = strings(raw.links);
    return urls ? urls.map((url) => ({ label: hostOf(url), url })) : undefined;
}

/** @param {string} url @returns {string} */
function hostOf(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

/**
 * Relations to other MangaBaka series (`relationships_v2`, or the older `relationships` map), each to an entry this
 * plugin resolves.
 * @param {any} raw
 * @returns {PluginDisplayRelation[] | undefined}
 */
function displayRelations(raw) {
    /** @param {string} relation @param {unknown} id @returns {PluginDisplayRelation | null} */
    const relationTo = (relation, id) => {
        const n = Number(id);
        return relation && Number.isFinite(n) && n > 0 ? { relation, pluginEntryId: String(n), url: `${SITE}/${n}` } : null;
    };
    /** @type {Array<PluginDisplayRelation | null>} */
    let out = [];
    if (Array.isArray(raw.relationships_v2) && raw.relationships_v2.length) {
        out = raw.relationships_v2.map((/** @type {any} */ r) => (r ? relationTo(text(r.relation_type) || '', r.to_series_id) : null));
    } else if (raw.relationships && typeof raw.relationships === 'object') {
        for (const [relation, ids] of Object.entries(raw.relationships)) {
            if (Array.isArray(ids)) for (const id of ids) out.push(relationTo(relation, id));
        }
    }
    const relations = /** @type {PluginDisplayRelation[]} */ (out.filter(Boolean));
    return relations.length ? relations : undefined;
}

/**
 * Publishers with their role (MangaBaka's `type`: Original, English…) as the contributor's `type`.
 * @param {unknown} value
 * @returns {PluginContributor[] | undefined}
 */
function publishersOf(value) {
    if (!Array.isArray(value)) return undefined;
    /** @type {PluginContributor[]} */
    const out = [];
    for (const p of value) {
        if (typeof p === 'string' && p.trim()) out.push(p);
        else if (p && typeof p === 'object' && text(p.name)) out.push(held({ name: String(p.name), type: text(p.type) }));
    }
    return out;
}

/**
 * The display part (A33): what MangaBaka holds beyond the contribution, as it holds it.
 * @param {any} raw
 * @returns {PluginEntryDisplay}
 */
function display(raw) {
    const published = raw.published && typeof raw.published === 'object' ? raw.published : {};
    const popularity = raw.popularity && raw.popularity.global && typeof raw.popularity.global === 'object' ? raw.popularity.global : {};
    return held({
        titles: displayTitles(raw),
        descriptions: text(raw.description) ? [{ text: String(raw.description) }] : undefined,
        cover: displayCover(raw),
        originalLanguage: text(raw.original_language),
        contentRating: CONTENT_RATINGS.includes(raw.content_rating) ? /** @type {PluginContentRating} */ (raw.content_rating) : undefined,
        statusText: text(raw.status),
        dates: held({ started: text(published.start_date), ended: text(published.end_date), updated: text(raw.last_updated_at) }),
        volumes: count(raw.final_volume) !== undefined ? { final: count(raw.final_volume) } : undefined,
        chapters: count(raw.total_chapters) !== undefined ? { total: count(raw.total_chapters) } : undefined,
        tags: displayTags(raw),
        ratings: displayRatings(raw),
        popularity: count(popularity.current) !== undefined ? { rank: count(popularity.current) } : undefined,
        licensing: held({
            licensed: typeof raw.is_licensed === 'boolean' ? raw.is_licensed : undefined,
            anime: typeof raw.has_anime === 'boolean' ? raw.has_anime : undefined,
        }),
        relations: displayRelations(raw),
        links: displayLinks(raw),
    });
}

/**
 * A32: the record a candidate carries — the search hit is the full record — without its identity.
 * @param {any} raw
 * @returns {PluginEntryRecord}
 */
function record(raw) {
    return held({
        displayTitle: text(raw.title),
        altTitles: altTitles(raw),
        authors: strings(raw.authors),
        artists: strings(raw.artists),
        description: text(raw.description),
        coverUrl: coverUrl(raw) || undefined,
        seriesStatus: raw.status !== undefined && raw.status !== null ? seriesStatus(raw.status) : undefined,
        genres: strings(raw.genres),
        tags: strings(raw.tags),
        year: typeof raw.year === 'number' && Number.isFinite(raw.year) ? raw.year : undefined,
        seriesType: text(raw.type),
        publishers: publishersOf(raw.publishers),
        display: display(raw),
    });
}

/** MangaBaka's 0–100 library rating → the host's 0–10. @param {unknown} rating */
const ratingOf = (rating) => (typeof rating === 'number' ? Math.round(rating) / 10 : null);

/** The series fields that carry alternate titles. */
const ALT_TITLE_FIELDS = Object.freeze(['native_title', 'romanized_title', 'titles', 'secondary_titles']);

/**
 * A library row's alternate titles (A30), from the series it embeds: `null` where the row embeds none, or one that
 * carries none of the alternate-title fields; never a series read.
 * @param {any} series
 * @returns {string[] | null}
 */
function listRowAltTitles(series) {
    if (!series || !ALT_TITLE_FIELDS.some((field) => series[field] !== undefined && series[field] !== null)) return null;
    return altTitles(series);
}

/** @param {any} row */
function readingListEntry(row) {
    const series = row && row.Series && typeof row.Series === 'object' ? row.Series : null;
    const id = String(row.series_id ?? (series && series.id) ?? row.id);
    return {
        pluginEntryId: id,
        title: series && typeof series.title === 'string' ? series.title : null,
        altTitles: listRowAltTitles(series),
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
    /**
     * Each hit a candidate carrying its record (A32): MangaBaka's hit is the full series record. No hit is dropped,
     * so an `allHits` answer (A35) needs nothing here.
     * @param {{ query: string, rows: any[], fetchedAt: string | null, cached: boolean }} found
     * @returns {PluginMatchCandidate[]}
     */
    search(found) {
        return found.rows.map((row) => {
            const alts = altTitles(row);
            const detail = record(row);
            /** @type {PluginMatchCandidate} */
            const candidate = {
                pluginEntryId: String(row.id),
                title: row.title,
                altTitles: alts,
                confidence: confidence(found.query, [row.title, ...alts]),
                canonicalUrl: canonicalUrl(row),
                ...(Object.keys(detail).length ? { detail } : {}),
            };
            return found.cached ? markCached(candidate, found.fetchedAt) : candidate;
        });
    },
    /**
     * `search.lookup` (A33): the entry in full, its display part included; the series read holds the same record as
     * a search hit.
     * @param {any} raw
     * @returns {PluginEntryDetail}
     */
    lookup(raw) {
        const shown = display(raw);
        return { ...contribution(raw), canonicalUrl: canonicalUrl(raw), ...(Object.keys(shown).length ? { display: shown } : {}) };
    },
    /** @param {any} raw */
    /**
     * A31: a contribution answered from the cache says so, and when it was fetched.
     * @param {{ value: any, cached: boolean, fetchedAt: string | null }} read
     */
    enrich: (read) => {
        const out = contribution(read.value);
        if (!read.cached) return { contribution: out };
        return { contribution: read.fetchedAt ? { ...out, cached: true, fetchedAt: read.fetchedAt } : { ...out, cached: true } };
    },
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
    _seriesStatus: seriesStatus,
};
