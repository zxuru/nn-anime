# Proposal: single-input catalogue search against AniList (`/anilist`)

Task: T140 · Spec affected: `SPEC-discovery.md` (the AniList catalogue) and `SPEC-web-ui.md`
(the new screen and its route). Status: **approved by the requester and implemented**; this file is
what the spec owner integrates.

Written in English because that is the language of the approved specification. Every other document
under `docs/specs/` is in Spanish; translating this one is a decision for its owner.

## What changed while implementing it, and why (read this first)

1. **A two-word genre is written with a hyphen, not with a space.** The grammar splits the input on
   whitespace, so `#slice of life` is the genre `slice` —which does not exist— plus the title
   `of life`. `#slice-of-life` and `#slice_of_life` are the spellings that work; the key folds the
   hyphen and the underscore into a space before comparing. The table below is the corrected one.
2. **A genre name is reported exactly as typed** (after hyphens become spaces). `#shonnen` reports
   `shonnen`; `#action,naruto` reports `action,naruto` —the comma is part of what was typed and
   hiding it would hide the mistake—. The original table said `action naruto`.
3. **`isAdult: false` is fixed in the query**, as the approved contract says. It is a catalogue
   search, not the showcase: the adult switch of the application does **not** drive it (open
   question OQ-3, still open).
4. **The browser never talks to AniList.** The screen calls `GET /api/anilist/search` on our own
   server, which is the only place with the host allow-list, the request budget and the cache
   (`connect-src 'self'` in this application's CSP forbids the direct call). Two consequences:
   the cover travels as the server's own path (`/api/anilist/image/cover/<id>`) instead of
   `coverImage.large`, and the client-side rules below are enforced against our route, which in
   turn enforces the API's.
5. **The screen is a new one (`/anilist`)**, with its link in the header. The provider search
   (`/search`) is not touched: the two answer different questions and one of them is not about the
   user's sources.
6. **The item of the response is the discovery piece plus three fields** (`titles`, `secondaryTitle`,
   `genres`), so the same component paints it and its `ref` decides the same thing: with a local
   record it opens the detail, without one it opens the title search.
7. **An item without a usable cover is dropped**, because that is this catalogue's own rule
   (`toEntry`: no cover from AniList's CDN, no piece). The approved item type allowed
   `coverUrl: string | null`; here the piece always has a cover or does not exist.
8. **The genre list is asked for only when the text contains `#`.** A title-only search does not
   wait for a constant it will not use, and does not spend a request of the API's budget on it.
   If the list is needed and does not arrive, the search fails rather than answering without the
   filter that was asked for.

## API surface used, and where each fact was checked

| Used | Exists | Source (official AniList docs — the source of docs.anilist.co) |
|---|---|---|
| `Page(page:, perPage:)`, `perPage` max 50 | yes | `AniList/docs` → `docs/reference/query.md` |
| `Media(type:, search:, genre_in:, sort:, isAdult:)` | yes, all five | same |
| `PageInfo.total`, `currentPage`, `hasNextPage` | yes; **`total` is documented as "not guaranteed to be accurate, do not rely on this for logic"** | `docs/reference/object/pageinfo.md` |
| `Media.id`, `title`, `genres`, `averageScore`, `coverImage` | yes | `docs/reference/object/media.md` |
| `MediaTitle.romaji`, `english`, `native` | yes | `docs/reference/object/mediatitle.md` |
| `MediaCoverImage.extraLarge`, `large` | yes | `docs/reference/object/mediacoverimage.md` |
| `MediaSort.SEARCH_MATCH`, `POPULARITY_DESC` | yes | `docs/reference/enum/mediasort.md` |
| `GenreCollection: [String]` | yes | `docs/reference/query.md`, and `{ GenreCollection }` in the docs' own migration file |
| Errors with HTTP 200 in `errors[]` | yes, documented | `docs/guide/graphql/errors.md` |
| 90 req/min, **currently degraded to 30/min**, burst limiter, 429 + `Retry-After` | yes | `docs/guide/rate-limiting.md` |

Not used, deliberately: tags (`tag_in`, a different system, out of scope); `title_contains`-style
filters (they do not exist); `userPreferred` (auth-dependent default).

## The query

```graphql
query ($search: String, $genres: [String], $page: Int, $perPage: Int, $sort: [MediaSort]) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage hasNextPage }
    media(type: ANIME, search: $search, genre_in: $genres, sort: $sort, isAdult: false) {
      id
      title { romaji english native }
      genres
      averageScore
      coverImage { extraLarge large }
      format
      startDate { year month day }
      ...
    }
  }
}

query { GenreCollection }
```

The selection set of `media` is the catalogue's own `MEDIA_FIELDS`: the same fields the top and the
schedule ask for, so the same cache row and the same piece serve all of them.

## Parsing (pure, in `core`)

```ts
parseAniListInput(input: string, validGenres: readonly string[]): AniListSearchInput
buildAniListVariables(parsed, options?: { page?; perPage? }): AniListSearchVariables
genreKey(name: string): string
displayTitleOf(titles: AniListTitles, fallbackId: number): { title: string; secondary?: string }

interface AniListSearchInput {
  readonly search: string | null          // never ''
  readonly genres: readonly string[]      // canonical casing, deduped, in input order
  readonly unknownGenres: readonly string[]
}
interface AniListSearchVariables {
  readonly search?: string                // the key is ABSENT when there is no title
  readonly genres?: readonly string[]     // the key is ABSENT when there are no genres
  readonly page: number
  readonly perPage: number                // default 25, clamped to 1..50
  readonly sort: readonly ('SEARCH_MATCH' | 'POPULARITY_DESC')[]   // exactly one
}
```

Rules: NFC-normalise the input, split on whitespace; a token starting with `#` is a genre (strip one
`#`; hyphens become spaces); everything else is title text joined by single spaces, keeping the
casing and the punctuation the user typed; genre comparison is **exact on the key** (NFKD, marks
stripped, lowercase, every run of non-alphanumerics → one space) and never a prefix; duplicates are
removed keeping the first occurrence; an empty `validGenres` makes every genre unknown —the caller
must wait for the list, or it would report a valid genre as unknown.

Sort: `SEARCH_MATCH` **iff** there is a title; otherwise `POPULARITY_DESC`.

## Data layer

- `GET /api/anilist/search?q=<raw input>&page=N` → `anilistSearchResponseSchema`:
  `{ items, page, hasNextPage, total?, unknownGenres }`. `page` is 1-based and sanitised (anything
  that is not a positive integer is page 1). A failure of AniList is **502**, not an empty list.
- `catalog.search(raw, page, signal)` parses with the list from `GenreCollection` (in memory, 24 h,
  in-flight shared, failures not cached), asks with the variables, writes the page and its covers
  into `anilist_list_cache` with the provider-search TTL (900 s) and returns the items plus the page
  frame. A cached page is served **only when the frame is also known** (`pageInfo` does not live in
  that table), so a cold cache never hides the "more" button.
- Failure taxonomy, for the screen: `network`, `timeout` (10 s deadline), `throttled` (429 +
  `Retry-After`), `server` (other non-2xx), `shape` (JSON or contract mismatch), plus `aborted`,
  which is never shown.

## UX

Debounce 300 ms; one `AbortController` per query, aborted by a newer input or by unmount; **at
least 2 000 ms between requests leaving the client** (the documented effective limit today is
30/min plus a burst limiter, so what is left over is waited for, not sent); after a 429 nothing
leaves until `Retry-After` has elapsed, and the wait is shown; any input change resets to page 1;
"Ver más" asks `page + 1` with the same variables and appends, and cannot be pressed twice in a
row; the empty state requires a settled response; `total` is shown as `≈` and decides nothing;
genres that do not exist are announced without blocking the search; the results region is
`aria-live="polite"`. All strings live in `packages/web/src/i18n/es.ts`.

## Test table (input → variables sent) — corrected

| # | input | variables | note |
|---|---|---|---|
| 1 | `naruto` | `{search:'naruto', page:1, perPage:25, sort:['SEARCH_MATCH']}`, no `genres` | |
| 2 | `shingeki no kyojin #action` | `{search:'shingeki no kyojin', genres:['Action'], …}` | |
| 3 | `attack on titan #drama #fantasy` | `{search:'attack on titan', genres:['Drama','Fantasy'], …}` | order kept |
| 4 | `#comedy #slice-of-life` | `{genres:['Comedy','Slice of Life'], sort:['POPULARITY_DESC']}`, no `search` | |
| 5 | *(empty)* | `{page:1, perPage:25, sort:['POPULARITY_DESC']}`, no `search`, no `genres` | popular |
| 6 | `   #ACTION   ` | `genres:['Action']` | case, whitespace |
| 7 | `#action #Action #ACTION` | `genres:['Action']` | dedupe by key |
| 8 | `#slice-of-life`, `#slice_of_life` | `genres:['Slice of Life']` | **not** `#slice of life` |
| 9 | `#mahou-shoujo` | `genres:['Mahou Shoujo']` | |
| 10 | `#sci_fi` | `genres:['Sci-Fi']` | |
| 11 | `#shonnen naruto` | `{search:'naruto', …}`, no `genres`, unknown `['shonnen']` | never sent |
| 12 | `#` | unknown `['#']`, no filters | |
| 13 | `##action` | unknown `['#action']`, no filters | no silent repair |
| 14 | `#act` | unknown `['act']` | no partial matching |
| 15 | `a #drama b` | `{search:'a b', genres:['Drama'], …}` | |
| 16 | `#música` | unknown `['música']`, no filters | no translation table |
| 17 | `Naruto  #ACTION  ` | `{search:'Naruto', genres:['Action'], …}` | casing kept |
| 18 | `Fate/stay night #action` | `search:'Fate/stay night'` | punctuation kept |
| 19 | `éxito` / `e\u0301xito` | identical output | NFC |
| 20 | `#action,naruto` | unknown `['action,naruto']` | comma is not a separator |

Assertions on the variables check **key presence** (`Object.hasOwn`), not equality with
`undefined`: `toEqual({search: undefined})` passes for both an omitted key and an explicit one and
would measure nothing.

## Acceptance criteria, with what measured each one

- [x] Every row of the table is a unit test in `packages/core/src/anilist-search.test.ts` (33 tests).
- [x] An unknown genre never reaches the variables: mutating the builder to forward `unknownGenres`
      turns the test red.
- [x] No `''`/`[]`/`null` reaches the variables: asserted with `Object.hasOwn`; the mutation that
      sends `search: ''` turns rows 4, 5 and 12 red.
- [x] `sort` is `SEARCH_MATCH` iff there is a title; mutating the rule turns rows 1 and 4 red.
- [x] HTTP 200 with `errors[]` is an error, not an empty result (the client's own contract; the
      double for this feature rejects what AniList rejects).
- [x] Exact genre comparison: mutating it to a prefix match turns rows 13 and 14 red.
- [x] The genre list is never hardcoded; it is asked for once and only when the text has `#`
      (route and catalogue tests; the mutation that always asks turns it red).
- [x] A failure is 502: the mutation that answers an empty list turns that test red.
- [x] Pagination is decided by `hasNextPage` and never by `total`: the mutation that uses `total`
      turns it red.
- [x] Debounce 300 ms and budget 2 000 ms are constants with their own test; the gate arithmetic
      (`puedeSalir`, `esperaHasta`, `puertaTras429`, `proximaSalida`) and the "more" guard are pure
      and tested.
- [x] The empty state cannot be painted while a request is in flight: the initial state **is**
      "loading" (the screen always searches on mount, popular list), and the page test asserts the
      empty text is absent from the first render.
- [x] `tsc --noEmit` clean, `biome check` clean (the 3 pre-existing warnings), and the i18n
      orphan-key test green.

Not measured, and declared: the hook's own wiring (that a new input aborts the in-flight request,
that the budget wait really precedes the call, that a 429 really blocks the next call) has no test —
this repository has no DOM react renderer, and `renderToString` does not run effects. The rules it
uses are pure and tested; the sequencing needs a browser. Same for the real AniList API: this
environment has no TLS egress from processes, so the contract is measured against the double, which
returns the shapes the API returns.

## Open questions still open

1. **`isAdult`.** Fixed to `false` as approved, so this screen never shows adult titles and the
   application's switch does not reach it. Keep it, or drive it from the switch?
2. **Spanish genre names.** `#acción` is reported as unknown because AniList's list has no Spanish
   entries. Adding aliases means a translation table —the thing that already caused a silent
   failure in this repository once—. English-only for now.
3. **`total` as `≈`.** Shown as approximate, never used for logic.
4. **Input length.** No cap. Do you want one, with a visible notice?
5. **Deep link.** The query does not live in the URL (`/anilist` has no `?q=`), unlike `/search`.
   Adding it is small, and it is not in the approved contract.
