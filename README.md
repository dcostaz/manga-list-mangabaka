# manga-list-mangabaka

[![tests](https://github.com/dcostaz/manga-list-mangabaka/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/dcostaz/manga-list-mangabaka/actions/workflows/tests.yml)
[![release-runtime-zip](https://github.com/dcostaz/manga-list-mangabaka/actions/workflows/release-runtime-zip.yml/badge.svg?branch=main)](https://github.com/dcostaz/manga-list-mangabaka/actions/workflows/release-runtime-zip.yml)
[![download-runtime-zip](https://img.shields.io/badge/download-runtime_zip-0969da?logo=github)](https://github.com/dcostaz/manga-list-mangabaka/releases/download/runtime-latest/manga-list-mangabaka-runtime.zip)

The manga-list tracker plugin for [MangaBaka](https://mangabaka.org), a manga metadata aggregator with a personal
library API. Contract **4.4.0** (`docs/plugins/host-capability-contract.md` in the host repo), built on
`@manga-list/plugin-sdk` in the template's shape (`Plan-2026Q4-tracker-plugin-standardization.md`, Phase 4; the sync
refactor's amendments A27–A30, `Plan-2026Q4-sync-refactor.md`).

4.4.0 (§2.4.1, `Plan-2026Q4-interface-refactor-tracker-search.md`) adds what Tracker Search shows: each search
candidate carries its record (`detail`, A32), `lookup` answers the display part (`display`, A33), a cancelled series is
`cancelled` (A34), and a search with `options.allHits` asks for every hit up to the `search.resultCap` setting (A35,
A36). Every candidate is an entry `lookup` resolves (A38).

Settings reference: [docs/settings.md](docs/settings.md). What happened to each 3.x method:
[docs/nothing-lost.md](docs/nothing-lost.md).

## Shape

```
src/runtime/apiwrappers/reg-mangabaka/
  client-mangabaka.cjs    L4: api.mangabaka.org — the token, the endpoints, the library's pages, the HTML-edge normalizer
  mapping-mangabaka.cjs   L3b: pure — MangaBaka's shapes → the contract's DTOs
  plugin-mangabaka.cjs    L3a: the template's generic definition (bindings by convention)
  plugin-package.json     the manifest
  mangabaka-api-settings.{definition,values}.json
  images/mangabaka-icon.svg
```

## What MangaBaka is, as this plugin relies on it

From MangaBaka's OpenAPI document (`https://mangabaka.org/api.json`, read 2026-11-07) and the live checks recorded
in the 3.x tests (2026-08-24/27):

- **Authentication** is a Personal Access Token (`mb-…`), generated on the MangaBaka account page and sent as the
  `x-api-key` header. No exchange, no expiry; `testCredentials` asks `GET /v1/my/profile`. (OAuth
  `client_credentials` was tried and refused for personal scopes; `authorization_code` would need a browser login the
  host does not have.)
- **The library** (`GET /v1/my/library`) is paged: `page` from 1, `limit` up to 100 (default 12), and a `pagination`
  object whose `next` is null on the last page. The client reads every page; the 3.x wrapper read one (F17). Each
  entry embeds its series (`Series`): the list read's `title` and its `altTitles` (native, romanized, `titles[]`,
  `secondary_titles`, the primary left out) come from it, with no series read; `altTitles` is `null` where an entry
  embeds no series or one with none of those fields (A30).
- **The system list is the system account's library, not the catalogue**: the manifest declares
  `watchOptions.wholeHolding: false` (A28), so a series missing from the `watch.list` read is not taken as missing from
  MangaBaka.
- **Library states** are `considering`, `completed`, `dropped`, `paused`, `plan_to_read`, `reading`, `rereading` — all
  seven in the manifest's `pull` table; `considering` is pull-only (the host writes `plan_to_read`). `paused` was
  confirmed live (2026-08-27); the other six are the API document's enum.
- **Writes**: `PATCH /v1/my/library/{series_id}` sets a state or progress; a series never added answers 404 and is
  created with `POST` on the same path (live-confirmed 2026-08-26/27); `DELETE` removes, and a 404 there is success.
  The library rating is 0–100; the host's is 0–10.
- **A removal** (`unsubscribe`, A29) is that `DELETE`: the library is the account's one list and the whole of what the
  list read returns, so a removed series is on none of the user's lists (live-confirmed 2026-08-27: gone from the list
  afterwards). The list read is never cached.
- **Search** (`GET /v1/series/search?q=…`, public, 30 requests a minute): every hit is the full series record, the
  same one `GET /v1/series/{id}` answers, so a candidate's `detail` and `lookup`'s `display` come from one mapping:
  titles with their language and kind, the description, the cover's sizes (`x150`/`x250`/`x350` are max heights,
  api.json) and its blurhash, content rating, original language, status as worded, dates, final volume and chapter
  total, tags with their path and spoiler flag, MangaBaka's rating and each site's 0–100 normalized one, rank,
  licensing and anime, relations and typed links. A field the record does not hold is absent. Without `allHits` the
  request sends `q` alone, the source's own page, as before; with it, `limit` set to the result cap (the live reads of
  2026-11-19 sent `limit` and the answer echoed it). The two answers are cached under different keys.
- **An unreadable answer** (a library page, a library entry, a series or a search answer with no `data`) is
  `source_error`, never an empty or short list, "not on the library" or `not_found` (A25).

## Build and test

```bash
npm test                    # client, mapping, build, and the contract suite (fixture: tests/fixtures/mangabaka-source.cjs)
npm run typecheck           # tsc --noEmit against the SDK's types
npm run check:nothing-lost  # every 3.x public method classified (docs/nothing-lost.md)
npm run build               # dist/manga-list-mangabaka-runtime-<version>.zip
```

The zip holds the three files, the manifest (at the root and beside the module), the merged settings and the icon;
never the SDK, which the host places beside the plugin runtime root.

Live checks, by hand, never in CI (`tests/integration/live.manual.cjs`, read-only):

```bash
ENABLE_REAL_SEARCH_TEST=1 [MB_TEST_SEARCH_QUERY="..."] npm run test:integration
ENABLE_REAL_LIBRARY_TEST=1 MB_TEST_API_KEY=mb-... npm run test:integration
```

`@manga-list/plugin-sdk` is a devDependency pinned to the contract's tag
(`git+https://github.com/dcostaz/manga-list-plugin-sdk.git#v4.4.0`).
