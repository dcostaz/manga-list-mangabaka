export type MangaBakaServiceSettings = Record<string, unknown>;
export type MangaBakaCredentials = Record<string, string>;

export interface MangaBakaHttpResponseInterceptorLike {
  use(
    onFulfilled: (response: unknown) => unknown,
    onRejected: (error: unknown) => Promise<never>
  ): unknown;
}

/** Loosely typed on purpose — response bodies are validated at each call site, not by this interface. */
export interface MangaBakaHttpResponseLike {
  status?: number;
  headers?: Record<string, unknown>;
  data?: any;
}

/** Shape of a rejected HTTP call — an axios-like error with an optional `.response`. */
export interface MangaBakaHttpErrorLike extends Error {
  response?: MangaBakaHttpResponseLike;
}

export interface MangaBakaHttpClientLike {
  interceptors?: {
    response?: MangaBakaHttpResponseInterceptorLike;
  };
  get: (
    url: string,
    config?: Record<string, unknown>
  ) => Promise<MangaBakaHttpResponseLike>;
  post: (
    url: string,
    data?: unknown,
    config?: Record<string, unknown>
  ) => Promise<MangaBakaHttpResponseLike>;
  patch: (
    url: string,
    data?: unknown,
    config?: Record<string, unknown>
  ) => Promise<MangaBakaHttpResponseLike>;
  delete: (
    url: string,
    config?: Record<string, unknown>
  ) => Promise<MangaBakaHttpResponseLike>;
}

/**
 * OAuth2 client_credentials token response, per MangaBaka's OIDC discovery
 * document (https://mangabaka.org/.well-known/openid-configuration):
 * token_endpoint returns a standard RFC 6749 §5.1 access token response.
 * No refresh_token is issued for this grant — a new token is simply
 * requested again from the same client_id/client_secret pair.
 */
export interface MangaBakaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface MangaBakaSettingsDocument {
  metadata: Record<string, unknown>;
  schema: Record<string, unknown>;
  settings: MangaBakaServiceSettings;
}

export interface MangaBakaAPISettingsInitOptions {
  settingsPath?: string;
  defaultSettings?: MangaBakaServiceSettings;
}

export interface MangaBakaAPISettingsConstructorParams {
  settings?: MangaBakaServiceSettings | MangaBakaSettingsDocument;
  settingsPath?: string;
}

export interface MangaBakaAPISettingsLike {
  componentName: string;
  toLegacyFormat(): MangaBakaServiceSettings;
}

/**
 * Raw shape of a single item in /v1/series/{id}'s `data` object and
 * /v1/series/search's `data[]` array (both share the same series shape) —
 * confirmed live 2026-08-23 against api.mangabaka.org.
 */
export interface MangaBakaRawSeries {
  id: number;
  state: string;
  merged_with: number | null;
  title: string;
  native_title?: string | null;
  romanized_title?: string | null;
  secondary_titles?: Record<string, Array<{ type: string; title: string; note?: string | null }>>;
  cover?: MangaBakaRawCover | null;
  authors?: string[];
  artists?: string[];
  description?: string | null;
  year?: number | null;
  published?: { start_date?: string | null; end_date?: string | null };
  status?: string | null;
  type?: string | null;
  rating?: number | null;
  total_chapters?: string | number | null;
  publishers?: string[];
  genres?: string[];
  tags?: string[];
  links?: Record<string, string>;
  links_v2?: Array<{ type: string; url: string }>;
  last_updated_at?: string;
}

export interface MangaBakaRawCoverVariant {
  x1: string;
  x2?: string;
}

export interface MangaBakaRawCover {
  raw?: { url: string; width?: number; height?: number };
  x150?: MangaBakaRawCoverVariant;
  x250?: MangaBakaRawCoverVariant;
  x350?: MangaBakaRawCoverVariant;
}

export interface MangaBakaSearchResponse {
  status: number;
  pagination: { count: number; next: string | null; previous: string | null; page: number; limit: number };
  data: MangaBakaRawSeries[];
}

export interface MangaBakaSeriesResponse {
  status: number;
  data: MangaBakaRawSeries;
}

/**
 * ASSUMPTION (unverified — no live credential available at scaffold time):
 * the shape of one entry in GET /v1/my/library's response. MangaBaka's
 * interactive API explorer is JS-rendered and could not be reached to
 * confirm this. Correct against reality via
 * `scripts/run-library-integration-test.cjs` before relying on it.
 */
export interface MangaBakaRawLibraryEntry {
  series_id: number;
  status: string;
  chapter?: number | null;
  volume?: number | null;
  rating?: number | null;
  updated_at?: string | null;
}
