# Frontend Detection — Sniff Rules + Body-Metadata Spec

Reference for the wrapper's 3-layer detection logic — Layers 1-3, the layers that can actually decide. (Layer 0, the context-signals enrichment layer, sits above them in resolution order but decides nothing; see the precedence summary below and `impeccable-plugin.md`.) Layer 3 (file-extension sniff) is detailed here. Layer 2 reads the record's `Surface:` body-metadata line (lifted into the materialized header — spec 20), which `/specify` writes on every new sub-issue record today; pre-v4.5 specs predate the field, so an absent value is normal and falls through to Layer 3.

## Layer 3 — File-extension sniff (fallback)

When neither the CLAUDE.md kill-switch nor the record's `Surface:` body-metadata line resolves the question, fall back to inspecting the changed files directly. Any file matching either a trigger extension or a trigger path pattern marks the diff as "frontend."

### Trigger extensions

Files with these extensions are unambiguously frontend:

| Extension | Notes |
|-----------|-------|
| `.tsx` | React/Preact TypeScript components |
| `.jsx` | React/Preact JavaScript components |
| `.vue` | Vue single-file components |
| `.svelte` | Svelte components |
| `.html` | Static markup, server templates |
| `.css` | Stylesheets |
| `.scss` | Sass stylesheets |
| `.sass` | Sass stylesheets (indented syntax) |
| `.less` | Less stylesheets |
| `.astro` | Astro components |
| `.mdx` | Markdown with embedded JSX |

### Trigger path patterns

Files whose path contains any of these segments are treated as frontend regardless of extension (catches `index.ts` route files, server-rendered template `.js`, etc.):

| Path segment | Typical use |
|--------------|-------------|
| `/components/` | Component libraries |
| `/pages/` | Next.js / Nuxt page routes |
| `/app/` | Next.js app-router, SvelteKit `$app` |
| `/routes/` | SvelteKit / Remix / SolidStart routes |
| `/views/` | Vue / Rails view templates |
| `/ui/` | Generic UI directory |

### Match rule

A file matches the frontend predicate if **any** of the following is true:

1. Its extension (lowercase) is in the trigger-extension table above.
2. Its path (forward-slash normalized) contains any segment from the trigger-path table above as a directory boundary (i.e., surrounded by `/` or at start/end with `/`) — **except** when the path also matches `app/api/` or `pages/api/` as adjacent segments, in which case the `app`/`pages` segment match does not count (#1786). This exclusion only withdraws the segment match; an extension match from clause 1 still wins (an `app/api/x/page.tsx` file still matches, on its extension).

If at least one file in the target list matches, the diff is frontend → proceed. If zero match, return `{skipped: "non-frontend (sniff)"}`.

### Negative cases (must not match)

- `.ts` and `.js` files outside any trigger path — these are typically server, lib, or utility code
- `.md` files (documentation) — no UI rendering
- `.json`, `.yaml`, `.toml` — config files, not UI
- `.py`, `.rb`, `.go`, `.rs`, `.java`, etc. — server-side languages
- `.sql` — database schema/migrations
- `Dockerfile`, `Makefile`, etc. — infrastructure
- Next.js API route handlers — `app/api/**/route.{ts,js}`, `pages/api/**` — render nothing; excluded from the `app`/`pages` segment rule even though they sit under those segments (#1786)

A backend project that touches only `.ts`/`.js` files outside `/components/`, `/pages/`, etc. correctly returns the skip — this is the dominant case for false-positive avoidance.

### Edge cases

- **Storybook files** (`.stories.tsx`, `.stories.ts`) — the `.tsx` matches; `.ts` only matches if path contains a trigger segment. Both are correct treatment (frontend if component-adjacent).
- **Test files** (`.test.tsx`, `.spec.tsx`) — match via `.tsx` extension. This is correct — test files describe UI behavior.
- **Type-only files** (`.d.ts`) — do not match. Correct — they don't render.
- **CSS-in-JS via `.ts`** — do not match unless the path contains a trigger segment. This is a known false-negative; the record's `Surface:` body-metadata line is the explicit override.

## Layer 2 — Body-metadata lines (read by wrapper via the materialized header — spec 20; written by `/specify`)

Every sub-issue record may declare three design-related body-metadata lines: `Surface:`, `Design-intent:`, and `Ui-stack:`. `/specify` writes all three on every new frontend sub-issue record (`Design-intent:`/`Ui-stack:` omitted for backend/infra/terminal). The wrapper reads `Surface:` for Layer 2 detection and `Design-intent:` for `polish` mode's intent-driven dispatch; `Ui-stack:` is read by `/claude-tweaks:build`'s Design Pre-Build step (`build/design-prebuild.md`), not by the wrapper itself — all three lifted into the materialized header at build time (spec 20's contract for the first two; #357 for `Ui-stack:`).

**The canonical definition of these fields lives in the spec template** at `skills/specify/spec-template.md` (see the body-metadata block description near the top of the fenced template). Both the wrapper (which reads the fields) and `/specify` (which writes them) reference that single source of truth — never restate the enumeration as a second authority. A file at the point of writing may inline a reader-facing slice of the values (`specify/shaping-mode-stamping.md`'s Metadata block does — #1346's split of `shaping-mode.md` — to spare shaping mode a read of the larger template) only when it names `spec-template.md` as canonical for the full field set in the same breath and states the hand-sync obligation; anything that reads the fields — this skill included — points here instead of copying.

For Layer 2 detection, see `Surface:` values in `skills/specify/spec-template.md` (canonical source for the value enumeration). The Layer 2 pass/skip/fall-through decision table itself lives in `SKILL.md`'s "Universal preconditions" Step 1 (Layer 2 section, this skill's own directory) — the operational procedure every mode's Step 1 actually runs; this file doesn't restate it, to avoid the two drifting apart.

`Design-intent:` is not read in Layer 2 — it gates intent-driven command dispatch in `polish` mode. `Ui-stack:` is not read in Layer 2 either — it has no enumeration to route on, only a free-form value forwarded verbatim into the implementer's prompt (`build/design-prebuild.md`'s Ui-stack mandate section). See the spec template's body-metadata block description for `Design-intent:`'s enumeration and `Ui-stack:`'s field description.

## Detection precedence summary

```
Context signals (Layer 0 — ENRICHMENT ONLY, no branch)
    │
    ├─ resolved            → carry signals forward
    ├─ absent / off-pin    → carry nothing forward
    └─ execution failure   → carry nothing forward
    │
    │   (all three continue — Layer 0 has no skip edge)
    ▼
CLAUDE.md design-integration flag (Layer 1)
    │
    ├─ disabled  → skip (universal)
    ├─ missing   → skip (treat as disabled)
    └─ enabled / plugin-only → continue
                                   │
                                   ▼
Surface: body-metadata line (Layer 2, only if spec input)
    │
    ├─ backend / infra        → skip
    ├─ web / mobile / desktop → continue
    ├─ terminal               → track terminal (declared only; no sniff)
    └─ missing                → continue (fall through)
    │
    ▼
Track resolution (every mode — NOT a layer, gates nothing)
setup.platform × Surface: → web | ios | android | adaptive
    │
    ├─ native track, Surface: declared
    │      └─ dispatch, platform named   (Layer 3 skipped — the sniff is
    │                                     web-only and cannot rule on
    │                                     native code)
    │
    ├─ native track, Surface: missing ──┐
    │                                   │
    └─ web track ───────────────────────┤
                                        │
                                        ▼
                          File-extension sniff (Layer 3)
                                        │
                                        ├─ no matches → skip
                                        └─ matches    → dispatch
                                                        (native track:
                                                         platform named)
```

**Layer 0 gates nothing.** Every one of its outcomes continues to Layer 1 — that is why it is drawn with no skip edge while the three layers below each have one. It enriches; it has no veto and no skip power of its own. Layers 1-3 remain the only things that can stop a dispatch.

**Track resolution gates nothing either, for a different reason.** Layer 0 has no skip edge because it is enrichment; track resolution has none because *both* of its outcomes dispatch. It decides which track, never whether. The only skips downstream of it are Layer 3's, plus the two mode-level ones the native track implies (`test` and `live` are web-only — see `SKILL.md`'s track-resolution section).

**Layer 3 is retained, not superseded.** Layer 0 carries a `scan.targets` list that looks like a frontend-file list and is not one: it filters on the extensions Impeccable's detector can *parse*, which include bare `.js` and `.ts` — the exact files the negative-cases section above requires Layer 3 to reject. Nothing upstream computes a frontend predicate, so Layer 3 remains the only thing that answers "is this change frontend?" — on the web track always, and on the native track whenever no `Surface:` was declared. `impeccable-plugin.md` has the full argument; `tests/impeccable-plugin-contract.test.js` holds a permanent frozen-fixture assertion of the non-equivalence.

**The trigger tables above are web-only, and that is why the native track routes around them.** No native extension appears in either table — not `.swift`, `.kt`, `.dart`, `.xib`, `.storyboard` — so a SwiftUI or Compose diff matches nothing here. That is not a gap to fill: this file answers "is this change *web* frontend?", which is the only question the layers below it need. Adding native extensions would make Layer 3 admit native diffs to the web-only CLI, which is the defect native routing exists to remove.

The earlier a layer can decide, the cheaper the skip. Kill-switch is a single CLAUDE.md read; sniff requires walking the file list. Layer 0 is ordered first for a different reason — it is an unconditional enrichment fetch whose result later steps may consult, not a decision that could short-circuit the ones after it.
