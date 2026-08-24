'use strict';

const path = require('path');
const MangaBakaAPISettings = require(path.join(__dirname, 'api-settings-mangabaka.cjs'));

const SERVICE_NAME = 'mangabaka';

/** @typedef {import('../../../../types/plugintypedefs').PluginServiceSettings} PluginServiceSettings */
/** @typedef {import('../../../../types/plugintypedefs').PluginCredential} PluginCredential */
/** @typedef {import('../../../../types/plugintypedefs').PluginProgressDTO} PluginProgressDTO */
/** @typedef {import('../../../../types/plugintypedefs').PluginProgressComparisonResult} PluginProgressComparisonResult */
/** @typedef {import('../../../../types/plugintypedefs').PluginSearchResult} PluginSearchResult */
/** @typedef {import('../../../../types/plugintypedefs').PluginLinkContribution} PluginLinkContribution */
/** @typedef {import('../../../../types/plugintypedefs').PluginCoverResult} PluginCoverResult */
/** @typedef {import('../../../../types/plugintypedefs').PluginInitResult} PluginInitResult */
/** @typedef {import('../../../../types/plugintypedefs').PluginStatus} PluginStatus */
/** @typedef {import('../../../../types/plugincontexttypedefs').PluginContextLike} PluginContextLike */
/** @typedef {import('../../../../types/mangabakatypedefs').MangaBakaHttpClientLike} MangaBakaHttpClientLike */
/** @typedef {import('../../../../types/mangabakatypedefs').MangaBakaCredentials} MangaBakaCredentials */
/** @typedef {import('../../../../types/mangabakatypedefs').MangaBakaTokenResponse} MangaBakaTokenResponse */
/** @typedef {import('../../../../types/mangabakatypedefs').MangaBakaRawSeries} MangaBakaRawSeries */

/**
 * @param {string} html
 * @returns {string}
 */
function extractHtmlErrorMessage(html) {
  if (typeof html !== 'string') {
    return 'Unknown HTML error response';
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && typeof titleMatch[1] === 'string' && titleMatch[1].trim()) {
    return titleMatch[1].trim();
  }

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return bodyText ? bodyText.slice(0, 180) : 'Unknown HTML error response';
}

/**
 * @returns {MangaBakaHttpClientLike}
 */
function createFallbackHttpClient() {
  return {
    interceptors: { response: { use: () => 0 } },
    get: async () => { throw new Error('HTTP client is not configured for MangaBaka runtime wrapper.'); },
    post: async () => { throw new Error('HTTP client is not configured for MangaBaka runtime wrapper.'); },
    patch: async () => { throw new Error('HTTP client is not configured for MangaBaka runtime wrapper.'); },
    delete: async () => { throw new Error('HTTP client is not configured for MangaBaka runtime wrapper.'); },
  };
}

/**
 * @returns {MangaBakaHttpClientLike}
 */
function createDefaultHttpClient() {
  try {
    // In the plugin runtime (~/plugins/runtime/...) there is no local node_modules,
    // so require('axios') fails; fall back to the host app via require.main.
    let axiosModule = null;
    try {
      // @ts-ignore axios is an optional runtime peer — no @types/axios in this package.
      axiosModule = require('axios');
    } catch (err) {
      if (require.main && typeof require.main.require === 'function') {
        axiosModule = require.main.require('axios');
      } else {
        throw err;
      }
    }
    const axios = axiosModule && axiosModule.default ? axiosModule.default : axiosModule;
    if (axios && typeof axios.create === 'function') {
      return axios.create();
    }
  } catch (error) {
    // Fallback is used when axios cannot be resolved in this runtime environment.
  }

  return createFallbackHttpClient();
}

class MangaBakaAPIWrapper {
  /**
   * @param {object} [params]
   * @param {MangaBakaAPISettings | null} [params.apiSettings]
   * @param {PluginServiceSettings} [params.serviceSettings]
   * @param {PluginContextLike | null} [params.context]
   * @param {MangaBakaHttpClientLike | null} [params.httpClient]
   */
  constructor(params = {}) {
    const apiSettings = params && typeof params === 'object' ? params.apiSettings : null;
    const serviceSettings = params && typeof params === 'object' ? params.serviceSettings : null;
    const providedContext = params && typeof params === 'object' ? params.context : null;
    const providedHttpClient = params && typeof params === 'object' ? params.httpClient : null;

    this.settings = serviceSettings && typeof serviceSettings === 'object' ? serviceSettings : {};
    this.apiSettings = apiSettings instanceof MangaBakaAPISettings ? apiSettings : null;
    this._context = providedContext && typeof providedContext === 'object' ? providedContext : null;
    /** @type {string | null} */
    this.accessToken = null;
    /** @type {MangaBakaCredentials | null} */
    this.credentials = null;
    this._initialized = false;
    // axios.create() returns a callable function, so typeof is 'function', not 'object' — accept both.
    this.httpClient = providedHttpClient && (typeof providedHttpClient === 'object' || typeof providedHttpClient === 'function')
      ? providedHttpClient
      : createDefaultHttpClient();

    this._setupAxiosInterceptor();
  }

  /**
   * Detect HTML responses (e.g. a Cloudflare challenge/error page) and normalize
   * them as infrastructure errors rather than letting a JSON.parse failure leak.
   * @returns {void}
   */
  _setupAxiosInterceptor() {
    const responseInterceptors = this.httpClient
      && this.httpClient.interceptors
      && this.httpClient.interceptors.response
      && typeof this.httpClient.interceptors.response.use === 'function'
      ? this.httpClient.interceptors.response
      : null;

    if (!responseInterceptors) {
      return;
    }

    responseInterceptors.use(
      (response) => response,
      (rawError) => {
        const error = /** @type {any} */ (rawError);
        const response = error && typeof error === 'object' && error.response && typeof error.response === 'object'
          ? error.response
          : null;

        if (!response) {
          return Promise.reject(error);
        }

        const headers = response.headers && typeof response.headers === 'object' ? response.headers : {};
        const contentType = typeof headers['content-type'] === 'string' ? headers['content-type'] : '';
        const responseData = response.data;
        const looksLikeHtml = contentType.includes('text/html')
          || (typeof responseData === 'string' && /^\s*<(?:!doctype|html)/i.test(responseData));

        if (!looksLikeHtml) {
          return Promise.reject(error);
        }

        const cleanError = new Error(
          `MangaBaka backend infrastructure error: ${extractHtmlErrorMessage(typeof responseData === 'string' ? responseData : '')}`,
        );
        cleanError.name = 'MangaBakaBackendError';
        // @ts-ignore custom compatibility fields used by runtime consumers.
        cleanError.statusCode = typeof response.status === 'number' ? response.status : null;
        // @ts-ignore custom compatibility fields used by runtime consumers.
        cleanError.isInfrastructureError = true;
        // @ts-ignore custom compatibility fields used by runtime consumers.
        cleanError.originalError = error;

        return Promise.reject(cleanError);
      },
    );
  }

  /**
   * @param {object} [options]
   * @param {MangaBakaAPISettings | null} [options.apiSettings]
   * @param {PluginServiceSettings} [options.serviceSettings]
   * @param {string} [options.settingsPath]
   * @param {PluginContextLike | null} [options.context]
   * @param {MangaBakaHttpClientLike | null} [options.httpClient]
   * @param {() => MangaBakaHttpClientLike} [options.httpClientFactory]
   * @returns {Promise<MangaBakaAPIWrapper>}
   */
  static async init(options = {}) {
    let apiSettings = options && typeof options === 'object' && options.apiSettings instanceof MangaBakaAPISettings
      ? options.apiSettings
      : null;
    const settingsPath = options && typeof options === 'object' && typeof options.settingsPath === 'string'
      ? options.settingsPath
      : '';

    if (!apiSettings && settingsPath) {
      apiSettings = await MangaBakaAPISettings.init({ settingsPath });
    }

    const explicitServiceSettings = options && typeof options === 'object' && options.serviceSettings
      && typeof options.serviceSettings === 'object'
      ? options.serviceSettings
      : null;
    const serviceSettingsFromApiSettings = apiSettings ? apiSettings.toLegacyFormat() : null;
    const serviceSettings = explicitServiceSettings || serviceSettingsFromApiSettings || {};

    const context = options && typeof options === 'object' ? (options.context || null) : null;
    const directHttpClient = options && typeof options === 'object' && options.httpClient
      && (typeof options.httpClient === 'object' || typeof options.httpClient === 'function')
      ? options.httpClient
      : null;
    const httpClientFactory = options && typeof options === 'object' && typeof options.httpClientFactory === 'function'
      ? options.httpClientFactory
      : null;
    const httpClientFromFactory = !directHttpClient && httpClientFactory ? httpClientFactory() : null;

    return new MangaBakaAPIWrapper({
      apiSettings,
      serviceSettings,
      context,
      httpClient: directHttpClient || httpClientFromFactory || null,
    });
  }

  /** @returns {string} */
  static get serviceName() { return SERVICE_NAME; }

  static get pluginName() { return SERVICE_NAME; }

  /** @returns {string} */
  get pluginName() { return SERVICE_NAME; }

  /** @returns {string[]} */
  get pluginType() { return /** @type {string[]} */ (Object.freeze(['tracker'])); }

  /** @returns {string[]} */
  get capabilities() {
    return /** @type {string[]} */ (Object.freeze([
      'credential', 'search.query', 'search.lookup', 'enrich', 'enrich.cover',
      'sync.pull', 'sync.push', 'sync.list', 'subscribe.add', 'subscribe.remove',
    ]));
  }

  /** Credential fields the host renders in the plugin credential form. */
  get credentialSchema() {
    return Object.freeze([
      { key: 'client_id', label: 'Client ID', type: 'text' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
    ]);
  }

  /** @returns {string} */
  get contractVersion() {
    const { PLUGIN_CONTRACT_VERSION } = require(path.join(__dirname, '..', 'plugindtocontract.cjs'));
    return PLUGIN_CONTRACT_VERSION;
  }

  /** @returns {Promise<PluginInitResult>} */
  async initialize() {
    this._initialized = true;
    return { status: 'ok' };
  }

  /** @returns {PluginStatus} */
  getStatus() {
    return { status: this._initialized ? 'ok' : 'initializing' };
  }

  // ---------------------------------------------------------------------
  // Credentials / OAuth2 client_credentials token
  // ---------------------------------------------------------------------

  /** @returns {Promise<PluginCredential | null>} */
  async getCredentials() {
    return this.credentials && typeof this.credentials === 'object' ? { ...this.credentials } : null;
  }

  /**
   * @param {MangaBakaCredentials} credentials
   * @returns {Promise<MangaBakaCredentials>}
   */
  async setCredentials(credentials) {
    if (!credentials || typeof credentials !== 'object') {
      throw new Error('Credentials must be an object.');
    }
    this.credentials = { ...credentials };
    return { ...this.credentials };
  }

  /**
   * The client_credentials grant has no user-consent session to expire — only
   * the access token expires, and getToken(forceRefresh) already re-requests
   * one from the same client_id/client_secret pair. There is nothing to
   * "refresh" about the credential itself, so this validates that the current
   * client_id/client_secret still work and returns it unchanged. Throws if
   * they no longer work, signalling the broker that the user must re-enter
   * credentials.
   * @param {PluginCredential} current
   * @returns {Promise<PluginCredential>}
   */
  async refreshCredentials(current) {
    if (!current || typeof current !== 'object') {
      throw new Error('(refreshCredentials) current credential is required');
    }
    await this._fetchClientCredentialsToken(current, { forceRefresh: true });
    return { ...current };
  }

  /**
   * @param {MangaBakaCredentials} credentials
   * @returns {Promise<boolean>}
   */
  async testCredentials(credentials) {
    try {
      const tokenData = await this._fetchClientCredentialsToken(credentials, { forceRefresh: true });
      return Boolean(tokenData && typeof tokenData.access_token === 'string' && tokenData.access_token.length > 0);
    } catch (error) {
      return false;
    }
  }

  /**
   * @param {boolean} [forceRefresh]
   * @returns {Promise<string>}
   */
  async getToken(forceRefresh = false) {
    if (!forceRefresh && this.accessToken) {
      return this.accessToken;
    }

    const cacheKey = this._getTokenCacheKey();
    const cache = this._context && this._context.cache;
    if (!forceRefresh && cache) {
      const cached = await cache.getValue(cacheKey, { userScoped: true });
      if (cached) {
        const cachedToken = String(cached);
        this.accessToken = cachedToken;
        return cachedToken;
      }
    }

    const credentials = await this.getCredentials();
    if (!credentials) {
      throw new Error('Credentials not found.');
    }

    const tokenData = await this._fetchClientCredentialsToken(credentials, { forceRefresh });
    const token = tokenData && typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
    if (!token) {
      return '';
    }

    await this._cacheToken(tokenData);
    this.accessToken = token;
    return token;
  }

  /**
   * @protected
   * @returns {string}
   */
  _getTokenCacheKey() {
    return `${SERVICE_NAME}_access_token`;
  }

  /**
   * @param {MangaBakaCredentials} credentials
   * @param {{ forceRefresh?: boolean }} [options]
   * @returns {Promise<MangaBakaTokenResponse>}
   */
  async _fetchClientCredentialsToken(credentials, options = {}) {
    const forceRefresh = options && typeof options === 'object' && options.forceRefresh === true;
    const cacheKey = this._getTokenCacheKey();
    const cache = this._context && this._context.cache;
    if (!forceRefresh && cache) {
      const cachedToken = await cache.getValue(cacheKey, { userScoped: true });
      if (cachedToken) {
        return { access_token: String(cachedToken), token_type: 'Bearer', expires_in: 0 };
      }
    }

    const endpoint = this._resolveEndpoint('api.endpoints.token.template');
    if (!endpoint) {
      throw new Error('(_fetchClientCredentialsToken) Error: Missing token endpoint config');
    }
    if (!this.httpClient || typeof this.httpClient.post !== 'function') {
      throw new Error('(_fetchClientCredentialsToken) Error: HTTP client is not configured');
    }

    const clientId = credentials && typeof credentials === 'object' ? credentials.client_id || '' : '';
    const clientSecret = credentials && typeof credentials === 'object' ? credentials.client_secret || '' : '';
    const scope = this._resolveSettingValue('oauth.scope') || 'library.read library.write';

    // token_endpoint_auth_methods_supported includes client_secret_post (per
    // https://mangabaka.org/.well-known/openid-configuration) — client_id/secret
    // travel in the form body alongside grant_type/scope.
    const body = new URLSearchParams();
    body.append('grant_type', 'client_credentials');
    body.append('client_id', clientId);
    body.append('client_secret', clientSecret);
    body.append('scope', String(scope));

    let response;
    try {
      response = await this.httpClient.post(
        endpoint,
        body.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[mangabaka] _fetchClientCredentialsToken: token request to ${endpoint} failed:`, detail);
      throw error;
    }

    const data = response && typeof response === 'object' ? response.data : null;
    const accessToken = data && typeof data === 'object' && typeof data.access_token === 'string' ? data.access_token : '';
    if (!accessToken) {
      throw new Error('(_fetchClientCredentialsToken) Error: Missing access_token in token response');
    }

    return {
      access_token: accessToken,
      token_type: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
      expires_in: typeof data.expires_in === 'number' ? data.expires_in : 0,
      scope: typeof data.scope === 'string' ? data.scope : undefined,
    };
  }

  /**
   * @protected
   * @param {MangaBakaTokenResponse} tokenData
   * @returns {Promise<void>}
   */
  async _cacheToken(tokenData) {
    const token = tokenData && typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
    const cache = this._context && this._context.cache;
    if (!token || !cache) {
      return;
    }

    const fallbackTtl = Number(this._resolveSettingValue('cache.ttl.accessTokenFallback')) || 3300;
    // Cache slightly under the token's own expiry so a call never fires on an
    // already-expired-but-still-cached token.
    const ttl = tokenData.expires_in > 30 ? tokenData.expires_in - 30 : fallbackTtl;
    await cache.setValue(this._getTokenCacheKey(), token, ttl, { userScoped: true });
    this.accessToken = token;
  }

  // ---------------------------------------------------------------------
  // Settings / endpoint helpers
  // ---------------------------------------------------------------------

  /**
   * @param {string} dottedKey
   * @returns {unknown}
   */
  _resolveSettingValue(dottedKey) {
    if (!dottedKey) return undefined;
    if (this.settings && typeof this.settings === 'object' && dottedKey in this.settings) {
      return this.settings[dottedKey];
    }
    const pathSegments = dottedKey.split('.');
    /** @type {any} */
    let cursor = this.settings;
    for (const segment of pathSegments) {
      if (!cursor || typeof cursor !== 'object' || !(segment in cursor)) return undefined;
      cursor = cursor[segment];
    }
    return cursor;
  }

  /**
   * @param {string} templateKey
   * @param {Record<string, string | number>} [replacements]
   * @returns {string}
   */
  _resolveEndpoint(templateKey, replacements = {}) {
    const template = this._resolveSettingValue(templateKey);
    if (typeof template !== 'string' || template.length === 0) return '';

    const baseUrl = this._resolveSettingValue('api.baseUrl');
    const authBaseUrl = this._resolveSettingValue('api.authBaseUrl');
    /** @type {Record<string, string>} */
    const allReplacements = {
      baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
      authBaseUrl: typeof authBaseUrl === 'string' ? authBaseUrl : '',
    };
    for (const [key, value] of Object.entries(replacements)) {
      allReplacements[key] = String(value);
    }

    let resolved = template;
    for (const [key, value] of Object.entries(allReplacements)) {
      resolved = resolved.split(`$\{${key}\}`).join(value);
    }
    return resolved;
  }

  /**
   * @param {string} key
   * @param {{ userScoped?: boolean }} [options]
   * @returns {Promise<unknown | null>}
   */
  async _getJSONCacheValue(key, options = {}) {
    const cache = this._context && this._context.cache;
    if (!cache || typeof cache.getValue !== 'function') return null;
    const raw = await cache.getValue(key, options);
    if (!raw) return null;
    try {
      return JSON.parse(String(raw));
    } catch (error) {
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {unknown} value
   * @param {number} ttlSeconds
   * @param {{ userScoped?: boolean }} [options]
   * @returns {Promise<void>}
   */
  async _setJSONCacheValue(key, value, ttlSeconds, options = {}) {
    const cache = this._context && this._context.cache;
    if (!cache || typeof cache.setValue !== 'function') return;
    await cache.setValue(key, JSON.stringify(value), ttlSeconds, options);
  }

  // ---------------------------------------------------------------------
  // Series normalization
  // ---------------------------------------------------------------------

  /**
   * @param {string | null | undefined} rawStatus
   * @returns {'ongoing' | 'completed' | 'hiatus' | 'unknown'}
   */
  _mapSeriesStatus(rawStatus) {
    const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
    if (status === 'completed' || status === 'complete') return 'completed';
    if (status === 'ongoing' || status === 'releasing') return 'ongoing';
    if (status === 'hiatus' || status === 'on_hiatus') return 'hiatus';
    return 'unknown';
  }

  /**
   * @param {MangaBakaRawSeries | null} raw
   * @returns {string | null}
   */
  _extractCoverUrl(raw) {
    const cover = raw && typeof raw === 'object' ? raw.cover : null;
    if (!cover || typeof cover !== 'object') return null;
    if (cover.raw && typeof cover.raw.url === 'string') return cover.raw.url;
    if (cover.x350 && typeof cover.x350.x1 === 'string') return cover.x350.x1;
    if (cover.x250 && typeof cover.x250.x1 === 'string') return cover.x250.x1;
    if (cover.x150 && typeof cover.x150.x1 === 'string') return cover.x150.x1;
    return null;
  }

  /**
   * Flattens MangaBaka's `secondary_titles` (an object keyed by language/type)
   * into a plain list of alt-title strings.
   * @param {MangaBakaRawSeries | null} raw
   * @returns {string[]}
   */
  _extractAltTitles(raw) {
    const secondary = raw && typeof raw === 'object' ? raw.secondary_titles : null;
    if (!secondary || typeof secondary !== 'object') return [];
    const titles = [];
    for (const entries of Object.values(secondary)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (entry && typeof entry.title === 'string' && entry.title.trim()) {
          titles.push(entry.title.trim());
        }
      }
    }
    return [...new Set(titles)];
  }

  /**
   * @param {number | string} pluginEntryId
   * @returns {Promise<MangaBakaRawSeries | null>}
   */
  async _fetchSeriesDetail(pluginEntryId) {
    const cacheKey = `mangabaka_series_${pluginEntryId}`;
    const ttl = Number(this._resolveSettingValue('cache.ttl.seriesMetadata')) || 86400;
    const cached = await this._getJSONCacheValue(cacheKey);
    if (cached) return /** @type {MangaBakaRawSeries} */ (cached);

    const endpoint = this._resolveEndpoint('api.endpoints.seriesDetail.template', { series_id: pluginEntryId });
    if (!endpoint) throw new Error('(_fetchSeriesDetail) Missing seriesDetail endpoint config');
    if (!this.httpClient || typeof this.httpClient.get !== 'function') {
      throw new Error('(_fetchSeriesDetail) HTTP client is not configured');
    }

    const response = await this.httpClient.get(endpoint);
    const body = response && typeof response === 'object' ? response.data : null;
    const data = body && typeof body === 'object' ? body.data : null;
    if (!data) return null;

    await this._setJSONCacheValue(cacheKey, data, ttl);
    return data;
  }

  // ---------------------------------------------------------------------
  // search.query / search.lookup
  // ---------------------------------------------------------------------

  /**
   * @param {string} query
   * @param {{ forceRefresh?: boolean }} [options]
   * @returns {Promise<PluginSearchResult[]>}
   */
  async search(query, options = {}) {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) return [];

    const useCache = !(options && options.forceRefresh === true);
    const sanitized = this._context && this._context.utils ? this._context.utils.sanitizeForSearch(q) : q;
    const cacheKey = `mangabaka_search_${sanitized}`;
    if (useCache) {
      const cached = await this._getJSONCacheValue(cacheKey);
      if (cached) return /** @type {PluginSearchResult[]} */ (cached);
    }

    const endpoint = this._resolveEndpoint('api.endpoints.seriesSearch.template');
    if (!endpoint) throw new Error('(search) Missing seriesSearch endpoint config');
    if (!this.httpClient || typeof this.httpClient.get !== 'function') {
      throw new Error('(search) HTTP client is not configured');
    }

    const response = await this.httpClient.get(endpoint, { params: { q } });
    const body = response && typeof response === 'object' ? response.data : null;
    /** @type {MangaBakaRawSeries[]} */
    const rows = body && typeof body === 'object' && Array.isArray(body.data) ? body.data : [];

    /** @type {PluginSearchResult[]} */
    const results = rows.map((row) => ({
      pluginEntryId: String(row.id),
      title: row.title,
      altTitles: this._extractAltTitles(row),
      description: typeof row.description === 'string' ? row.description : undefined,
      coverUrl: this._extractCoverUrl(row) || undefined,
      authors: Array.isArray(row.authors) ? row.authors : undefined,
      seriesStatus: this._mapSeriesStatus(row.status),
    }));

    const ttl = Number(this._resolveSettingValue('cache.ttl.searchResults')) || 3600;
    await this._setJSONCacheValue(cacheKey, results, ttl);
    return results;
  }

  /**
   * @param {string | number} pluginEntryId
   * @returns {Promise<PluginLinkContribution | null>}
   */
  async lookup(pluginEntryId) {
    const raw = await this._fetchSeriesDetail(pluginEntryId);
    if (!raw) return null;
    return this._toLinkContribution(raw, pluginEntryId);
  }

  /**
   * @param {MangaBakaRawSeries} raw
   * @param {string | number} pluginEntryId
   * @returns {Promise<PluginLinkContribution>}
   */
  async _toLinkContribution(raw, pluginEntryId) {
    let seriesUrl = null;
    try { seriesUrl = await this.getSeriesUrl(pluginEntryId); } catch { seriesUrl = null; }

    /** @type {PluginLinkContribution} */
    const contribution = {
      pluginEntryId: String(pluginEntryId),
      syncedAt: new Date().toISOString(),
      seriesStatus: this._mapSeriesStatus(raw.status),
    };
    if (raw.title) contribution.displayTitle = raw.title;
    const altTitles = this._extractAltTitles(raw);
    if (altTitles.length) contribution.altTitles = altTitles;
    if (Array.isArray(raw.authors) && raw.authors.length) contribution.authors = raw.authors;
    if (Array.isArray(raw.artists) && raw.artists.length) contribution.artists = raw.artists;
    if (Array.isArray(raw.genres) && raw.genres.length) contribution.genres = raw.genres;
    if (Array.isArray(raw.tags) && raw.tags.length) contribution.tags = raw.tags;
    if (raw.description) contribution.description = raw.description;
    const coverUrl = this._extractCoverUrl(raw);
    if (coverUrl) contribution.coverUrl = coverUrl;
    if (typeof raw.year === 'number' && Number.isFinite(raw.year)) contribution.year = raw.year;
    if (typeof raw.type === 'string' && raw.type) contribution.seriesType = raw.type;
    if (Array.isArray(raw.publishers) && raw.publishers.length) contribution.publishers = raw.publishers;
    contribution.sourceLinks = seriesUrl
      ? [{ siteId: SERVICE_NAME, siteLabel: 'MangaBaka', seriesUrl, isPrimary: true }]
      : [];
    return contribution;
  }

  /**
   * @param {string | number} pluginEntryId
   * @returns {Promise<string | null>}
   */
  async getSeriesUrl(pluginEntryId) {
    const id = Number(pluginEntryId);
    if (!Number.isFinite(id) || id <= 0) return null;
    // Confirmed live 2026-08-23: https://mangabaka.org/{id} resolves (200).
    return `https://mangabaka.org/${id}`;
  }

  // ---------------------------------------------------------------------
  // enrich / enrich.cover
  // ---------------------------------------------------------------------

  /**
   * host-capability-contract.md §2's enrich mapping. Backs both the array-shaped
   * enrich() below and syncEnrichment()'s single-entry callers.
   * @param {string | number} pluginEntryId
   * @returns {Promise<PluginLinkContribution | null>}
   */
  async buildLinkContribution(pluginEntryId) {
    return this.lookup(pluginEntryId);
  }

  /**
   * @param {{ pluginEntryId?: string, plugin_entry_id?: string }} localTrackerEntry
   * @returns {Promise<PluginLinkContribution | null>}
   */
  async syncEnrichment(localTrackerEntry) {
    const entry = localTrackerEntry && typeof localTrackerEntry === 'object' ? localTrackerEntry : {};
    const pluginEntryId = entry.pluginEntryId || entry.plugin_entry_id || null;
    if (!pluginEntryId) return null;
    return this.buildLinkContribution(pluginEntryId);
  }

  /**
   * host-capability-contract.md §2.1 — enrich's array-shaped dispatch. Array in,
   * array out, per-entry failure — never a whole-batch throw.
   * @param {Array<string | number>} pluginEntryIds
   * @returns {Promise<Array<{ pluginEntryId: string, success: boolean, contribution?: PluginLinkContribution, error?: string }>>}
   */
  async enrich(pluginEntryIds) {
    const ids = Array.isArray(pluginEntryIds) ? pluginEntryIds : [];
    const results = [];
    for (const id of ids) {
      try {
        const contribution = await this.buildLinkContribution(id);
        results.push(contribution
          ? { pluginEntryId: String(id), success: true, contribution }
          : { pluginEntryId: String(id), success: false, error: 'No contribution available for this id' });
      } catch (error) {
        results.push({ pluginEntryId: String(id), success: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }

  /**
   * Two modes per host-capability-contract.md §2's enrich.cover mapping: query mode
   * (title search, own pick of the top result) and id mode (a known id present —
   * skip search, fetch the known entry's cover directly).
   *
   * The real host caller, `CoverSearchOrchestrator` (`cls/coversearch/coversearchorchestrator.cjs`,
   * not yet migrated off its pre-capability-vocabulary calling convention), passes a full
   * LocalTracker-like entry object as the first argument — not a bare query string — and carries
   * the known id (when this entry is already linked to this tracker) as `options.trackerId`, not
   * `options.pluginEntryId`. This accepts both that real convention and the documented one, so it
   * works whether called by the current host or a future one that adopts the documented shape.
   * @param {string | { title?: string }} mangaCoreEntryOrQuery
   * @param {{ trackerId?: string, pluginEntryId?: string, searchTitles?: string[], forceRefresh?: boolean }} [options]
   * @returns {Promise<PluginCoverResult[]>}
   */
  async searchCovers(mangaCoreEntryOrQuery, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const knownId = opts.trackerId || opts.pluginEntryId || null;

    let raw = null;
    if (knownId) {
      raw = await this._fetchSeriesDetail(knownId);
    } else {
      const searchTitles = Array.isArray(opts.searchTitles)
        ? opts.searchTitles.filter((title) => typeof title === 'string' && title.trim())
        : [];
      const q = searchTitles.length > 0
        ? searchTitles[0]
        : typeof mangaCoreEntryOrQuery === 'string'
          ? mangaCoreEntryOrQuery.trim()
          : (mangaCoreEntryOrQuery && typeof mangaCoreEntryOrQuery.title === 'string' ? mangaCoreEntryOrQuery.title.trim() : '');
      if (!q) return [];
      const matches = await this.search(q, { forceRefresh: opts.forceRefresh });
      if (!matches.length) return [];
      raw = await this._fetchSeriesDetail(matches[0].pluginEntryId);
    }

    if (!raw) return [];
    const coverUrl = this._extractCoverUrl(raw);
    if (!coverUrl) return [];

    /** @type {PluginCoverResult} */
    const result = {
      coverId: String(raw.id),
      imageUrl: coverUrl,
      thumbnailUrl: raw.cover && raw.cover.x150 && raw.cover.x150.x1 ? raw.cover.x150.x1 : undefined,
      width: raw.cover && raw.cover.raw && typeof raw.cover.raw.width === 'number' ? raw.cover.raw.width : undefined,
      height: raw.cover && raw.cover.raw && typeof raw.cover.raw.height === 'number' ? raw.cover.raw.height : undefined,
    };
    return [result];
  }

  /**
   * Returns the cover image as a raw Buffer — never writes to disk itself,
   * per tracker-template.md §4.3's data-boundary discipline.
   *
   * `coverId` is the MangaBaka series id as returned by `searchCovers()`'s own `coverId` field —
   * but the real host caller, `ImageService._invokeProviderDownload()`
   * (`cls/services/imageservice.cjs:456`), constructs it as `${sourceId}/${fileName}` (a bridging
   * convention borrowed from the pre-existing MangaUpdates plugin, not something MangaBaka's own
   * `coverId` ever contains a `/` in). Splitting on `/` and taking the first segment handles both.
   * @param {string} coverId
   * @returns {Promise<Buffer>}
   */
  async downloadCover(coverId) {
    const rawCoverId = typeof coverId === 'string' ? coverId : String(coverId || '');
    const seriesIdPart = rawCoverId.includes('/') ? rawCoverId.split('/')[0] : rawCoverId;
    const seriesId = Number(seriesIdPart);
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      throw new Error('(downloadCover) Invalid coverId');
    }

    const cacheKey = `mangabaka_cover_bytes_${seriesId}`;
    const ttl = Number(this._resolveSettingValue('cache.ttl.coverUrls')) || 604800;
    const cache = this._context && this._context.cache;
    if (cache && typeof cache.getValue === 'function') {
      const cached = await cache.getValue(cacheKey);
      if (typeof cached === 'string' && cached.length > 0) {
        return Buffer.from(cached, 'base64');
      }
    }

    const raw = await this._fetchSeriesDetail(seriesId);
    const url = this._extractCoverUrl(raw);
    if (!url) throw new Error('(downloadCover) No cover URL available for this series');
    if (!this.httpClient || typeof this.httpClient.get !== 'function') {
      throw new Error('(downloadCover) HTTP client get method is not configured');
    }

    const response = await this.httpClient.get(url, { responseType: 'arraybuffer' });
    const responseData = response && typeof response === 'object' ? response.data : null;
    /** @type {Buffer | null} */
    let imageBuffer = null;
    if (Buffer.isBuffer(responseData)) {
      imageBuffer = responseData;
    } else if (responseData instanceof ArrayBuffer) {
      imageBuffer = Buffer.from(responseData);
    } else if (ArrayBuffer.isView(responseData)) {
      imageBuffer = Buffer.from(responseData.buffer);
    } else if (typeof responseData === 'string') {
      imageBuffer = Buffer.from(responseData, 'binary');
    }
    if (!imageBuffer) throw new Error('(downloadCover) Failed to fetch cover image bytes');

    if (cache && typeof cache.setValue === 'function') {
      await cache.setValue(cacheKey, imageBuffer.toString('base64'), ttl);
    }
    return imageBuffer;
  }

  // ---------------------------------------------------------------------
  // sync.pull / sync.push / sync.list — ASSUMPTION-marked (see
  // docs/plugins/mangabaka/architecture.md and mangabaka-api-settings.definition.json's
  // api.endpoints.myLibrary*/description fields): /v1/my/library is confirmed to
  // exist and require auth, but its exact request/response shape has not been
  // verified against a real account. Correct via
  // scripts/run-library-integration-test.cjs before relying on these in production.
  // ---------------------------------------------------------------------

  /**
   * @param {string | number} seriesId
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async _fetchLibraryEntry(seriesId) {
    const token = await this.getToken();
    if (!token) return null;

    const endpoint = this._resolveEndpoint('api.endpoints.myLibraryEntry.template', { series_id: seriesId });
    try {
      const response = await this.httpClient.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = response && typeof response === 'object' ? response.data : null;
      return body && typeof body === 'object' && body.data ? body.data : body;
    } catch (rawError) {
      const error = /** @type {any} */ (rawError);
      const status = error && error.response && typeof error.response.status === 'number' ? error.response.status : null;
      if (status === 404) return null;
      throw error;
    }
  }

  /**
   * host-capability-contract.md §2's sync.pull mapping.
   * @param {string | number} pluginEntryId
   * @returns {Promise<PluginProgressDTO>}
   */
  async pullProgress(pluginEntryId) {
    const entry = await this._fetchLibraryEntry(pluginEntryId);
    if (!entry) {
      return { readingStatus: null, chapter: null, volume: null, rating: null };
    }
    return {
      readingStatus: typeof entry.status === 'string' ? entry.status : null,
      chapter: typeof entry.chapter === 'number' ? entry.chapter : null,
      volume: typeof entry.volume === 'number' ? entry.volume : null,
      rating: typeof entry.rating === 'number' ? entry.rating : null,
      lastUpdated: typeof entry.updated_at === 'string' ? entry.updated_at : null,
    };
  }

  /**
   * @param {string | number} pluginEntryId
   * @param {{ chapter?: number, volume?: number, rating?: number }} progress
   * @returns {Promise<{ pluginEntryId: string, success: boolean, error?: string }>}
   */
  async _pushProgressOne(pluginEntryId, progress = {}) {
    try {
      const token = await this.getToken();
      if (!token) return { pluginEntryId: String(pluginEntryId), success: false, error: 'Not authenticated' };

      const endpoint = this._resolveEndpoint('api.endpoints.myLibraryEntry.template', { series_id: pluginEntryId });
      const payload = {};
      if (typeof progress.chapter === 'number') payload.chapter = progress.chapter;
      if (typeof progress.volume === 'number') payload.volume = progress.volume;
      if (typeof progress.rating === 'number') payload.rating = progress.rating;

      await this.httpClient.patch(endpoint, payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      return { pluginEntryId: String(pluginEntryId), success: true };
    } catch (error) {
      return { pluginEntryId: String(pluginEntryId), success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * host-capability-contract.md §2.1 — sync.push's array-shaped pushProgress().
   * Never carries status — that's subscribe.add's job under this contract.
   * @param {Array<{ pluginEntryId: string, chapter?: number, volume?: number, rating?: number }>} entries
   * @returns {Promise<Array<{ pluginEntryId: string, success: boolean, error?: string }>>}
   */
  async pushProgress(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const results = [];
    for (const entry of list) {
      results.push(await this._pushProgressOne(entry && entry.pluginEntryId, entry ? {
        chapter: entry.chapter,
        volume: entry.volume,
        rating: entry.rating,
      } : {}));
    }
    return results;
  }

  /**
   * host-capability-contract.md §2's sync.list mapping — the user's whole
   * remote library in one call, for reconciliation.
   * @returns {Promise<Array<{ pluginEntryId: string, readingStatus: string | null, chapter: number | null, volume: number | null, rating: number | null }>>}
   */
  async pullList() {
    const token = await this.getToken();
    if (!token) return [];

    const cacheKey = `${SERVICE_NAME}_library_list`;
    const ttl = Number(this._resolveSettingValue('cache.ttl.library')) || 1800;
    const cached = await this._getJSONCacheValue(cacheKey, { userScoped: true });
    if (cached) {
      return /** @type {Array<{ pluginEntryId: string, readingStatus: string | null, chapter: number | null, volume: number | null, rating: number | null }>} */ (cached);
    }

    const endpoint = this._resolveEndpoint('api.endpoints.myLibrary.template');
    const response = await this.httpClient.get(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = response && typeof response === 'object' ? response.data : null;
    /** @type {Array<Record<string, unknown>>} */
    const rows = body && typeof body === 'object' && Array.isArray(body.data) ? body.data : [];

    const results = rows.map((row) => ({
      pluginEntryId: String(row.series_id ?? row.id),
      readingStatus: typeof row.status === 'string' ? row.status : null,
      chapter: typeof row.chapter === 'number' ? row.chapter : null,
      volume: typeof row.volume === 'number' ? row.volume : null,
      rating: typeof row.rating === 'number' ? row.rating : null,
    }));

    await this._setJSONCacheValue(cacheKey, results, ttl, { userScoped: true });
    return results;
  }

  /**
   * Pure computation, no network — owns every precision quirk MangaBaka's
   * library API has so the host never needs source-specific exception logic.
   * `null` on any field means the comparison couldn't be made, never a
   * guessed `false`.
   * @param {{ readingStatus?: string | null, chapter?: number | null, rating?: number | null }} hostProgress
   * @param {{ readingStatus?: string | null, chapter?: number | null, rating?: number | null }} remoteProgress
   * @returns {PluginProgressComparisonResult}
   */
  compareProgress(hostProgress, remoteProgress) {
    const hp = hostProgress && typeof hostProgress === 'object' ? hostProgress : {};
    const rp = remoteProgress && typeof remoteProgress === 'object' ? remoteProgress : {};

    /** @type {boolean | null} */
    let chapterAhead = null;
    /** @type {boolean | null} */
    let chapterBehindOrEqual = null;
    if (typeof hp.chapter === 'number' && typeof rp.chapter === 'number') {
      chapterAhead = rp.chapter > hp.chapter;
      chapterBehindOrEqual = rp.chapter <= hp.chapter;
    }

    /** @type {boolean | null} */
    let ratingDiffers = null;
    if (typeof hp.rating === 'number' || typeof rp.rating === 'number') {
      ratingDiffers = (hp.rating ?? null) !== (rp.rating ?? null);
    }

    /** @type {boolean | null} */
    let statusDiffers = null;
    if (typeof hp.readingStatus === 'string' || typeof rp.readingStatus === 'string') {
      statusDiffers = (hp.readingStatus ?? null) !== (rp.readingStatus ?? null);
    }

    return { chapterAhead, chapterBehindOrEqual, ratingDiffers, statusDiffers };
  }

  // ---------------------------------------------------------------------
  // subscribe.add / subscribe.remove — same ASSUMPTION caveat as sync.* above.
  // ---------------------------------------------------------------------

  /**
   * @param {string | number} pluginEntryId
   * @param {{ status?: string }} context
   * @returns {Promise<{ pluginEntryId: string, success: boolean, error?: string }>}
   */
  async _subscribeOne(pluginEntryId, context) {
    try {
      const token = await this.getToken();
      if (!token) return { pluginEntryId: String(pluginEntryId), success: false, error: 'Not authenticated' };

      const status = context && typeof context.status === 'string' ? context.status : undefined;
      const endpoint = this._resolveEndpoint('api.endpoints.myLibraryEntry.template', { series_id: pluginEntryId });
      // ASSUMPTION: PATCH with { status } both adds a new entry and updates an
      // existing one (idempotent upsert). If MangaBaka instead requires POST
      // to /v1/my/library with { series_id, status } for new entries, split
      // this into an existence check + POST/PATCH branch once verified live.
      await this.httpClient.patch(endpoint, { status }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      return { pluginEntryId: String(pluginEntryId), success: true };
    } catch (error) {
      return { pluginEntryId: String(pluginEntryId), success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * host-capability-contract.md §2.1 — subscribe.add's array-shaped subscribe().
   * `status` is the resolved target value, supplied by the host via
   * syncOptions.statusVocabulary — currently all-null pending live verification
   * of MangaBaka's native library status strings (see plugin-package.json).
   * @param {Array<{ pluginEntryId: string, status?: string }>} entries
   * @returns {Promise<Array<{ pluginEntryId: string, success: boolean, error?: string }>>}
   */
  async subscribe(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const results = [];
    for (const entry of list) {
      results.push(await this._subscribeOne(entry && entry.pluginEntryId, entry ? { status: entry.status } : {}));
    }
    return results;
  }

  /**
   * @param {string | number} pluginEntryId
   * @returns {Promise<{ pluginEntryId: string, success: boolean, error?: string }>}
   */
  async _unsubscribeOne(pluginEntryId) {
    try {
      const token = await this.getToken();
      if (!token) return { pluginEntryId: String(pluginEntryId), success: false, error: 'Not authenticated' };

      const endpoint = this._resolveEndpoint('api.endpoints.myLibraryEntry.template', { series_id: pluginEntryId });
      try {
        await this.httpClient.delete(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (rawError) {
        const error = /** @type {any} */ (rawError);
        const status = error && error.response && typeof error.response.status === 'number' ? error.response.status : null;
        // Idempotent — removing an already-absent entry is not an error.
        if (status !== 404) throw error;
      }
      return { pluginEntryId: String(pluginEntryId), success: true };
    } catch (error) {
      return { pluginEntryId: String(pluginEntryId), success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * host-capability-contract.md §2.1 — subscribe.remove's array-shaped
   * unsubscribe(). Idempotent — removing an already-absent entry is not an error.
   * @param {Array<string | number>} pluginEntryIds
   * @returns {Promise<Array<{ pluginEntryId: string, success: boolean, error?: string }>>}
   */
  async unsubscribe(pluginEntryIds) {
    const ids = Array.isArray(pluginEntryIds) ? pluginEntryIds : [];
    const results = [];
    for (const id of ids) {
      results.push(await this._unsubscribeOne(id));
    }
    return results;
  }
}

module.exports = MangaBakaAPIWrapper;
