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
| `api_key` | password | yes | Personal Access Token generated on your MangaBaka account/profile settings page |

---

## Authentication Architecture

MangaBaka publishes an OAuth2/OIDC discovery document
(`https://mangabaka.org/.well-known/openid-configuration`) advertising `client_credentials` as a
supported grant. **This was tried first and confirmed live to fail**: the token endpoint issues a
token, but `GET /v1/my/library` rejects it with `401 {"message":"BAD_REQUEST: Missing required
scope"}` — a `client_credentials` token represents the application, not a specific user, so
MangaBaka correctly refuses to bind personal `library.*` scopes to one. Reaching personal data that
way would require the `authorization_code` (+ PKCE) flow instead — real per-user browser login,
which is new infrastructure this codebase doesn't have.

This plugin instead uses MangaBaka's **Personal Access Token** (PAT) support: a static token, sent
as a plain `x-api-key` header on every authenticated request. There is no token endpoint, no
expiry, and no refresh flow — the credential itself is the usable value.
`refreshCredentials()`/`testCredentials()` make a lightweight `GET /v1/my/profile` call to confirm
the token still works; there is nothing to cache or renew.

---

## API Endpoints

All `api.*` keys are locked (`readOnly=true`, `category=network`) and may only be changed by
updating the package source and releasing a new runtime zip.

| Key | Default | Order | Description |
|-----|---------|-------|-------------|
| `api.baseUrl` | `https://api.mangabaka.org/v1` | 200 | MangaBaka public data API base URL |
| `api.endpoints.myProfile.template` | `${baseUrl}/my/profile` | 205 | Lightweight authenticated endpoint used only to validate a Personal Access Token — no side effects |
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
