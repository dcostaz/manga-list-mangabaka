# manga-list-mangabaka

[![tests](https://github.com/dcostaz/manga-list-mangabaka/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/dcostaz/manga-list-mangabaka/actions/workflows/tests.yml)
[![release-runtime-zip](https://github.com/dcostaz/manga-list-mangabaka/actions/workflows/release-runtime-zip.yml/badge.svg?branch=main)](https://github.com/dcostaz/manga-list-mangabaka/actions/workflows/release-runtime-zip.yml)
[![download-runtime-zip](https://img.shields.io/badge/download-runtime_zip-0969da?logo=github)](https://github.com/dcostaz/manga-list-mangabaka/releases/download/runtime-latest/manga-list-mangabaka-runtime.zip)

Runtime tracker add-on package source for [MangaBaka](https://mangabaka.org), a manga metadata
aggregator (AniList, Anime-Planet, Kitsu, MangaUpdates, MyAnimeList, Shikimori) that also exposes a
personal library API.

This repository builds a runtime-installable zip add-on for the manga-list app's Unified Plugin
System, loaded by `PluginPackageLoader`. It declares the current capability vocabulary
(`docs/plugins/host-capability-contract.md` in the main `manga-list` repo) — `credential`,
`search.query`, `search.lookup`, `enrich`, `enrich.cover`, `sync.pull`, `sync.push`, `sync.list`,
`subscribe.add`, `subscribe.remove` — the same vocabulary MangaDex and MangaUpdates migrated to.

Settings reference: [docs/settings.md](docs/settings.md)

## ⚠️ Unverified assumption — read before relying on sync/subscribe

MangaBaka's `/v1/my/library` endpoints are **confirmed to exist** (`GET /v1/my/library` and
`GET /v1/my/profile` both return `401 {"message":"No session found"}` unauthenticated, while
made-up sibling paths return real `404`s) but their exact request/response shapes were **not**
independently verifiable at scaffold time — MangaBaka's interactive API explorer is a JS-rendered
SPA. The `sync.*`/`subscribe.*` methods in `api-wrapper-mangabaka.cjs` encode reasonable
assumptions (marked `// ASSUMPTION:` inline) about field names and endpoint shapes. Run:

```bash
npm run test:library:interactive
```

against a real MangaBaka account before trusting these in production, and correct the wrapper
against whatever the real API actually returns. `search`/`lookup`/`enrich`/`enrich.cover` have
**no such caveat** — they're backed by the public, unauthenticated `/v1/series/*` endpoints, which
were verified live.

## Authentication

MangaBaka uses OAuth2/OIDC (discovery document: `https://mangabaka.org/.well-known/openid-configuration`),
**not** username/password. This plugin uses the `client_credentials` grant against a personal API
client registered at mangabaka.org — `credentialSchema` is `client_id`/`client_secret`, not
`username`/`password`. Register a client at mangabaka.org, then enter its Client ID/Secret via the
host's Trackers settings tab (`credentials.primary` in the settings schema).

Latest runtime zip download (GitHub release asset):

https://github.com/dcostaz/manga-list-mangabaka/releases/download/runtime-latest/manga-list-mangabaka-runtime.zip

## Build

```bash
npm run build
```

Optional build flags:

```bash
node scripts/build-runtime-plugin-package.cjs --output ./dist/mangabaka-runtime.zip --host-api-version 1.0.0
```

Build output contains:

1. `plugin-package.json`
2. `apiwrappers/plugindtocontract.cjs`
3. `apiwrappers/reg-mangabaka/plugin-module.cjs`
4. `apiwrappers/reg-mangabaka/api-wrapper-mangabaka.cjs`
5. `apiwrappers/reg-mangabaka/api-settings-mangabaka.cjs`
6. `apiwrappers/reg-mangabaka/mangabaka-api-settings.json` (generated effective settings used at runtime; not an authored source file)
7. `images/mangabaka-icon.svg` (real logo asset)

Settings source of truth in this repository is split into:

1. `src/runtime/apiwrappers/reg-mangabaka/mangabaka-api-settings.definition.json`
2. `src/runtime/apiwrappers/reg-mangabaka/mangabaka-api-settings.values.json`

The build script validates and merges both source files into the runtime payload:
`apiwrappers/reg-mangabaka/mangabaka-api-settings.json`.

Contract version governance:

1. Plugin contract version comes from `src/runtime/apiwrappers/plugindtocontract.cjs` (`PLUGIN_CONTRACT_VERSION`).
2. Settings contract version is centrally defined in the same file (`PLUGIN_SETTINGS_CONTRACT_VERSION`).
3. The build script rejects a `plugin-package.json` whose `pluginContractVersion` major doesn't match `PLUGIN_CONTRACT_VERSION`'s major.

Type definitions governance:

1. Shared plugin-contract typedefs live in `types/plugintypedefs.d.ts` and `types/plugincontexttypedefs.d.ts` (copied verbatim from the host contract — not MangaBaka-specific).
2. MangaBaka-local raw API shapes live in `types/mangabakatypedefs.d.ts`.

## Test

```bash
npm test
npm run typecheck
```

`npm test` runs the unit suites under `tests/unit/`. `npm run typecheck` runs `tsc --noEmit`
(JSDoc-based type-checking; no compiled output).

GitHub Actions runs both on every push and pull request via `.github/workflows/tests.yml`.
GitHub Actions also builds and publishes the runtime zip on pushes to `main` via
`.github/workflows/release-runtime-zip.yml`.

Manual local integration tests (excluded from `npm test` and CI):

```bash
npm run test:search:interactive    # no credentials needed — public search/lookup endpoints
npm run test:library:interactive   # prompts for a real Client ID/Secret; verifies /v1/my/library
```

For non-interactive shells, set `MB_TEST_SEARCH_QUERY`, or `MB_TEST_CLIENT_ID`/`MB_TEST_CLIENT_SECRET`,
before running the corresponding command.

Unit test suites:

1. `tests/unit/build-runtime-plugin-package.test.cjs`
2. `tests/unit/runtime-settings.test.cjs`
3. `tests/unit/runtime-wrapper-contract.test.cjs` (includes the capabilities-matches-manifest drift guard)
4. `tests/unit/runtime-wrapper-token.test.cjs` (OAuth2 `client_credentials` flow)
5. `tests/unit/runtime-wrapper-search-cover.test.cjs`
6. `tests/unit/runtime-wrapper-readinglist.test.cjs` (`sync.*`/`subscribe.*` — see the assumption caveat above)

## pluginType

Declared as `tracker`, per the identity test in `docs/manga-list-architecture.md` §3.8.1: the
registered OAuth client is personal to the user's account and grants `library.read`/`library.write`
scoped access to *their* library — the remote system holds a reading list that belongs to this user.
