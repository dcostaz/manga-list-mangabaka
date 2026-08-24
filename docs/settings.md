# MangaBaka Settings Reference

This document describes the tracker-specific settings declared by the `manga-list-mangabaka` runtime package.

Settings contract version: **1.0.0** (declared in `src/runtime/apiwrappers/plugindtocontract.cjs`).

---

## Three-Tier Model

| Tier | Description |
|------|-------------|
| 1 — Package defaults | Keys and standalone-viable defaults baked into this package (`mangabaka-api-settings.definition.json` merged with `mangabaka-api-settings.values.json`) |
| 2 — Host overrides | User-edited per-tracker values stored by the host in its override file; only `readOnly=false` keys may be written |
| 3 — Host injection | Common cross-tracker defaults injected by the host at init time |

Effective resolution order: Tier 2 wins over Tier 3 wins over Tier 1.

During development (unit tests, integration tests in this repo) only Tier 1 is active. Tier 1 defaults must therefore be complete and standalone-viable without Tier 3 present.

---

## Tracker Identity

| Key | Default | Notes |
|-----|---------|-------|
| `ui.label` | `MangaBaka` | Display name shown in the host UI |
| `ui.icon` | `images/mangabaka-icon.svg` | Icon path relative to the runtime package |
| `ui.credentialsTemplate` | See below | Credential form schema |
| `credentials.primary` | `null` | Managed via host keychain; never stored in the settings file |

### Credential fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `client_id` | text | yes | OAuth2 client ID from a personal API client registered at mangabaka.org |
| `client_secret` | password | yes | OAuth2 client secret for that client |

---

## Authentication Architecture

MangaBaka is an OAuth2/OIDC provider (discovery document:
`https://mangabaka.org/.well-known/openid-configuration`). This plugin uses the
**`client_credentials`** grant — `client_id`/`client_secret` are POSTed directly to the token
endpoint (form-encoded, `client_secret_post` auth method) to obtain an access token scoped by
`oauth.scope` (`library.read library.write`). There is no username/password and no browser
redirect flow. The access token is cached (`context.cache`, `userScoped: true`) for
`expires_in - 30` seconds; `getToken(forceRefresh)` simply requests a fresh one from the same
client credentials — there is no separate `refresh_token` grant in play for this flow.

---

## API Endpoints

All `api.*` keys are locked (`readOnly=true`, `category=network`) and may only be changed by
updating the package source and releasing a new runtime zip.

| Key | Default | Order | Description |
|-----|---------|-------|-------------|
| `api.baseUrl` | `https://api.mangabaka.org/v1` | 200 | MangaBaka public data API base URL |
| `api.authBaseUrl` | `https://mangabaka.org/auth` | 205 | MangaBaka OAuth2/OIDC authorization server base URL (separate host from `api.baseUrl`) |
| `api.endpoints.token.template` | `${authBaseUrl}/oauth2/token` | 210 | OAuth2 token endpoint (`client_credentials` grant) |
| `api.endpoints.seriesDetail.template` | `${baseUrl}/series/${series_id}` | 220 | Full series details by ID — public, verified live |
| `api.endpoints.seriesSearch.template` | `${baseUrl}/series/search` | 230 | Search series by title — public, verified live |
| `api.endpoints.myLibrary.template` | `${baseUrl}/my/library` | 240 | **ASSUMPTION** — list/read the authenticated user's library. Confirmed to exist (401 unauthenticated); exact response shape unverified. |
| `api.endpoints.myLibraryEntry.template` | `${baseUrl}/my/library/${series_id}` | 250 | **ASSUMPTION** — get/add/update/remove a single library entry. Not directly confirmed live. |

Every `ASSUMPTION`-flagged endpoint must be corrected against `npm run test:library:interactive`'s
real output before this plugin is relied on for `sync.*`/`subscribe.*` in production. See
`docs/plugins/mangabaka/architecture.md` in the main `manga-list` repo for the full write-up.

---

## Rate Limiting

MangaBaka's own documented limits (`https://mangabaka.org/data/api`): 30 req/min on
`GET /series/search`, 180 req/min on everything else, both IP-based leaky-bucket, Cloudflare-cached
responses exempt. `rateLimit.global.maxPerMinute` defaults to 170 (a safety margin under 180) and
`api.endpoints.seriesSearch.throttle` defaults to 2100ms (a safety margin over the 2000ms a strict
30/min budget implies).

---

## Status Vocabulary

`plugin-package.json`'s `syncOptions.statusVocabulary` is currently **all `null`** — MangaBaka's
native library status strings (the values `library.read`/`library.write` actually use, e.g.
`reading`/`completed`/etc.) were not verified live. All-`null` means the host skips every
`subscribe()` call until this is filled in. Correct it via `npm run test:library:interactive`.
