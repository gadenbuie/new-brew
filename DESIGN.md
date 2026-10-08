# New Brew

A static website for catching up on new and updated Homebrew packages — the
stuff you see scroll by in the `brew update` preamble, but in a friendly,
scannable, console-styled UI that remembers what you've already seen.

## Core workflow

> Take a product name → understand what it does → click out to the project
> website if interested.

New Brew collapses this into one screen: scan the timeline, open a row's
card in the details sidebar to read what the thing is, follow the homepage
link. The `brew.sh` page is one click away for anything that deserves a
deeper look.

## Architecture (hybrid data model)

The Homebrew API has no timestamps and there is no first-party "what changed"
feed, so we combine two data paths, both using the exact git-diff semantics
that `brew update` itself uses:

### 1. Precomputed changes (GitHub Action, 3× per day across US work hours)

A scheduled workflow generates `changes.json` and commits it to the
`gh-pages` branch (never `main`). It runs at
8:00am ET, 12:30pm ET, and 5:00pm ET (2pm PT) — UTC cron `0 12`, `30 16`,
`0 21` (times drift an hour earlier in winter since cron ignores DST —
acceptable):

- Blobless clones of `Homebrew/homebrew-core` and `Homebrew/homebrew-cask`.
- `git log --name-status --since=60 days` over `Formula/` and `Casks/`
  → one event per package change: `added` (new) / `modified` (updated).
- Joins each package with `formulae.brew.sh/api/formula.json` +
  `cask.json` metadata at build time → every row carries `description`,
  `homepage`, `version`, `deprecated`.
- Deduplicates to one row per package: the most recent event wins, but a
  package whose earliest in-window event was an addition is marked `new`.
- Records `generated_at` plus the `core_head_sha` / `cask_head_sha` the
  data was cut from — this is the browser's gap-fill anchor.

Schema (illustrative):

```json
{
  "generated_at": "2026-10-08T14:00:00Z",
  "retention_days": 60,
  "core_head_sha": "…",
  "cask_head_sha": "…",
  "items": [
    {
      "n": "ripgrep",       // name/token
      "t": "f",             // "f" formula | "c" cask
      "k": "u",             // "u" updated | "n" new
      "d": "2026-10-08",    // date of most recent event (UTC, day granularity)
      "ts": "2026-10-08T21:03:11.000Z", // full UTC committer timestamp — the sort key
      "v": "15.2.0",        // current stable version
      "desc": "Search tool like grep and faster than it",
      "url": "https://github.com/BurntSushi/ripgrep",
      "dep": false          // deprecated
    }
  ]
}
```

### 2. Browser gap-fill (GitHub REST compare API)

Since the hourly Action runs, the world moves on. On each visit the browser
fills the gap between `*_head_sha` in changes.json and current HEAD:

- `GET /repos/Homebrew/homebrew-core/compare/{base}...HEAD` — CORS open,
  unauthenticated, returns up to 300 files with `status: added/modified`.
- Chunk at ≤75 commits per compare (250-commit API cap; 300-file response cap)
  → an hourly gap is typically a single compare call per repo.
- Merge gap events into the precomputed rows (same dedupe rules), keeping the
  newer date and letting an `added` event upgrade a package to `new`.
- Sorting is by precise change time (`ts`, a UTC ISO committer timestamp).
  Precomputed rows carry the exact commit time; gap events share their
  compare-chunk's newest-commit timestamp (the compare API can't attribute
  files to individual commits), so only gap-chunk members tie — those fall
  back to alphabetical. Rows from caches predating `ts` sort by their day.
- Cap gap-fill at ~20 requests per visit; on rate-limit exhaustion or failure,
  fall back gracefully to the precomputed data with a small "as of HH:MM" note.

### 3. Client-side dataset cache (localStorage)

The merged dataset from the last successful sync is cached in localStorage so
that revisiting between scheduled runs costs **zero API requests**:

- Cached record: the merged `items` plus the tap HEAD SHAs actually synced to
  and the `changes.json` identity (`generated_at` + base SHAs) it was built
  from.
- On load: paint the cached dataset instantly, then fetch `changes.json`
  (a cheap static fetch, no rate limits, often served from HTTP cache). If its
  identity matches the cache and a sync already happened, skip the GitHub API
  entirely.
- When it doesn't match (new Action run landed), gap-fill only from the
  cached synced HEAD to current HEAD — i.e., each between-runs window pays
  for lookups exactly once per browser, no matter how many times you visit.
- First visit ever: gap-fill straight from `changes.json`'s base SHAs.
- Quota errors on write are caught and ignored — caching silently degrades
  to fetch-only if the dataset ever outgrows localStorage (~5 MB limit).

### Rate-limit math (unauthenticated: 60 req/hr per visitor IP)

| Action cadence | Gap size | Browser requests/visit |
|---|---|---|
| Weekly | ~5,700 commits/repo | ~46+ ❌ |
| Daily | ~800 | ~26–30 ⚠️ |
| **3×/day, work hours (chosen)** | ~300–450 (up to ~700 overnight) | **~12–16 once per window, 0 on cached revisits ✅** |
| Hourly | ~35–50 | ~2–4, but wasteful for a browsing habit that isn't hourly |

## Features

- **Scope:** both formulae and casks. Four independent chip toggles —
  casks/formulae and new/updated — defaulting to all-unset (everything
  passes). Within each group, activating one member excludes the other
  until it's also activated; an empty group passes both. Chips persist.
- **Theme:** dark by default TUI palette with a light counterpart; a
  `[system]` toggle in the title row cycles light / dark / system.
  The choice persists and follows the OS while in system mode (applied
  pre-paint via an inline script to avoid flashes).
- **Seen tracking:** last-visit timestamp in localStorage. The window is
  `max(last visit, 7 days ago)` on load; the timestamp updates when you
  leave (or press a "caught up" / "mark seen" button — decide in UI polish).
- **Timeline:** unified, newest first (by precise UTC commit timestamp),
  with small badges: `new`/`upd` × `cask`/`formula`, date, name, version,
  plus a dimmed, ellipsized one-line description for scanability. Dense
  monospace rows, TUI aesthetic: box-drawing, dark theme, keyboard-friendly
  (j/k or arrows to move, `/` to filter, `esc` to close).
- **Two-column layout:** the timeline on the left; a details sidebar on the
  right that always shows a card for the current selection (moves with j/k
  or a row click). `p` (or the card's [pin] button) pins a row so its card
  stays in the sidebar for the session — a scan-and-pin review queue in pin
  order. Pinning never reorders anything: the card you're looking at stays
  exactly where it is and only its pin state changes; it shows once (as the
  current card, on top) until the selection moves on, at which point it
  settles into the pinned stack in pin order. Cards fetch rich metadata
  (versions, license, deps / artifacts & requirements, caveats, deprecation)
  from formulae.brew.sh on demand — session-cached, with a synchronous peek
  so revisits render instantly — and `o`/`O` open the selected row's
  homepage / brew.sh page in a new tab; `⌘/ctrl + shift + O` opens every
  pinned row at once (homepage first, brew.sh as fallback). Below ~1080px the sidebar becomes
  an offcanvas stack opened with enter/space or a row tap (selection alone
  never yanks focus). Pins are session-only.
- **First visit:** default window = 7 days, clearly labeled.
- **Long absence (> retention):** window silently capped to available
  retention (60 days), with a note.

## UI sketch

```
 new brew                          since Oct 1 · 142 packages · updated 14:00
 ───────────────────────────────────────────────────────────────────────────
 [all] [casks] [formulae] [new] [updated]                    ⌂ caught up
 ───────────────────────────────────────────────────────────────────────────
   2026-10-08  ghostty         Open-source terminal emulator    cask    NEW   1.1.0
   2026-10-08  ripgrep         Search tool like grep          formula UPD   15.2.0
   2026-10-07  zot             Zettelkasten wiki              formula NEW  0.4.20
   2026-10-07  ghostty         Open-source terminal emulator    cask    UPD   1.0.1
   …

 sidebar cards:
 ┌─ details ──────────────────────────────────────────── ┐
 │ ripgrep — current card (follows selection)   [pin]   │
 │ … metadata, brew install ripgrep [copy], links …      │
 │ ghostty — pinned 1/3                          [unpin] │
 │ …                                                    │
 └────────────────────────────────────────────────────── ┘
```

## Stack & repo layout

- **SvelteKit + Svelte 5** (runes), `adapter-static` → GitHub Pages.
- No UI framework, no CSS framework — hand-rolled console look, plain CSS.
- No client data library — a small store module handles fetch, merge,
  localStorage, and windowing logic.

```
.github/workflows/
  data.yml      # 3×/day (US work hours): build changes.json, commit to gh-pages
  deploy.yml    # on push to main: build site, publish build to gh-pages
scripts/
  build-data.mjs   # the Action's generator
src/routes/+page.svelte        # the whole app (single route)
src/lib/data.svelte.ts         # changes.json fetch + gap-fill + merge + localStorage cache
src/lib/state.svelte.ts        # localStorage: last visit, filters, since mode; session pins
src/lib/components/            # Row.svelte, PkgCard.svelte, FilterBar.svelte, SincePicker.svelte
static/data/changes.json       # generated; untracked — synced from gh-pages via npm run sync:data
```

## GitHub Pages deployment

- Pages serves the `gh-pages` branch directly (Source: "Deploy from a
  branch", set once in repo settings). `main` holds only source.
- `deploy.yml` builds on every push to `main` and publishes `build/` to
  `gh-pages`, carrying over the latest `changes.json` so the rebuild never
  regresses the data job's commits.
- The 3×-daily `data.yml` commits regenerated `changes.json` straight to
  `gh-pages` — data goes live via the Pages branch build with zero bot
  commits on `main` (public repo → Actions minutes are free).
- Locally, `npm run sync:data` copies `data/changes.json` off the `gh-pages`
  branch into `static/data/` for the dev server.
- `.nojekyll` ships in `static/` so the branch build skips Jekyll.
- Pages CDN serves changes.json with sensible caching; the merged dataset is
  also kept in localStorage as the revisit/edge-case cache (see
  "Client-side dataset cache" above).

## Edge cases & rules

- Deleted/renamed packages: ignored (git `D`/`R` statuses skipped) — the app
  is about discovering new things, not tracking removals.
- Deprecated/disabled packages: shown with a `dep` badge so you know before
  clicking through.
- Items that fall outside the window but are `new`: still shown if their
  event date is within the window; packages older than the window never
  appear.
- Version bumps with no visible version change (bottle-only rebuilds) are
  deduped naturally by one-row-per-package.

## Non-goals (anti-over-engineering)

- No backend, no auth, no analytics, no server-side anything.
- No per-item seen/dismissed state (timestamp only, per decision).
- No search index — filtering the loaded dataset is enough at this scale.
  The search input applies its query on a short (150 ms) typing pause
  rather than every keystroke; the filtered result is shared between the
  chip counts and the visible list (one scan, not two); and the list
  mounts in rAF-grown batches so a big commit can't block the frame.
- No virtualized list until the DOM actually complains.
