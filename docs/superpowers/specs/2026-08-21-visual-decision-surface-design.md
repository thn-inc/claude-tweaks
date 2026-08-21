# Visual Decision Surface — in-browser verdict capture for explore, as a reusable primitive

- **Date:** 2026-08-21
- **Status:** approved in brainstorming; awaiting decomposition via `/claude-tweaks:specify`
- **Decisions made with the user:** full visual surface upgrade (not explore-only, not pick-only); the full verdict vocabulary lives in the browser; a whole explore round persists as one self-contained HTML file close to the code.

## Problem

`design-wrapper explore` renders competing design variants in the browser, but the decision comes
back through a terminal `AskUserQuestion` — the user judges in one surface and answers in another.
superpowers' brainstorming visual companion demonstrates the better loop (click in the page,
decision lands as structured events Claude reads next turn), and Claude Design's `/design` canvas
demonstrates the better artifact (self-contained single-file page, template-plus-seeding,
variants as sandboxed frames). This design brings both strategies into claude-tweaks as
repo-local capability with **no dependency on Claude Artifacts** and no dependency on
superpowers' internal server script (an internal path, not a public interface).

## Goals

1. Explore's Verdict step — pick / reroll / steer / exit — is answerable entirely in the browser.
2. The capture mechanism is a generic, reusable primitive other skills (`/demo`,
   `/visual-review`) can adopt later without redesign.
3. A concluded explore round persists as one self-contained HTML file under `docs/plans/`,
   viewable from `file://` indefinitely — the visual design-decision record.
4. Zero new runtime dependencies; everything ships in `plugin/` and is tested by `node --test`.

## Non-goals (deferred, filed as backlog records at wrap-up)

- Tweak levers on the comparison shell (per-variant knobs à la `/design`'s tweak chips).
- Wiring `/demo` or `/visual-review` to the primitive.
- Pan/zoom canvas. A grid overview + focus view covers explore's ≤6 variants; pan/zoom earns its
  complexity only at `/design`-scale artboard counts.
- Any change to explore's dealing policy, render-set sizes, clean-room builder fan-out,
  interactive-only status, or upstream (`concept-seed.mjs`, `document --seed`) ownership.

## Architecture

Three new units and one contract; one skill rewritten to consume them.

```
plugin/bin/visual-decide.js            CLI entry (start | stop | status)
plugin/bin/lib/visual-decide/          server module (zero-dep, content-agnostic)
plugin/skills/design-wrapper/compare-shell/
  template.html                        comparison shell (self-contained)
  seed-compare.mjs                     seeder (live mode + durable mode)
plugin/skills/_shared/visual-decision.md   event/lifecycle contract
plugin/skills/design-wrapper/modes/explore.md   Compare/Verdict/Lock-in rewritten
```

### Unit 1 — `visual-decide` server (generic primitive)

Zero-dependency Node (`node:http`, `node:fs`), flat module directory per this repo's
`bin/lib/{name}/` convention, injectable-runner seam where it shells out (it shouldn't need to).

CLI:

- `start --dir <content-dir> --state <state-dir> [--port <n>] [--idle-minutes <n=240>]`
- `stop --state <state-dir>`
- `status --state <state-dir>`

Behavior:

- Binds **127.0.0.1 only**, free port (probe upward from a base when `--port` taken).
- Mints a session key; writes `{state}/server-info` (JSON: `url` including `?key=`, `port`,
  `pid`), mode 0600. Key accepted via query param on first load, then cookie.
- Routes, all key-gated:
  - **static GET** from `--dir`, path-traversal rejected (resolved path must stay inside the
    content dir), no directory listings.
  - **POST `/events`** — JSON body validated as a single object, appended as one JSONL line to
    `{state}/events` (0600). Malformed body → 400, nothing written.
  - **GET `/stream`** — SSE. Watches the content dir (mtime poll or `fs.watch`) and pushes a
    `reload` event when content changes, so a reroll's re-seed refreshes the open tab.
- Idle timeout (default 240 min) self-exits and writes `{state}/server-stopped` marker, so a
  consumer can distinguish "stopped" from "never started". Any activity (request, event)
  resets the timer.
- Content-agnostic: nothing in it knows about explore, variants, or verdicts.
- `process.exitCode`, never `process.exit()` after writes (async write-vs-exit race).

### Unit 2 — comparison shell + seeder (design-wrapper-owned)

`template.html` — one self-contained page, no CDN/external assets (system font stack; this is
tooling UI, not a design deliverable — it must never visually compete with the variants it
frames). Two views:

- **Grid overview:** all presented variants at once, each in a sandboxed `<iframe>`, its display
  name docked; degraded slots (BLOCKED / inexpressible-direction builders) rendered, labeled
  with the failure, and **not selectable** — preserving explore's existing rule and the
  "1 / N" accounting.
- **Focus view:** one variant full-viewport; arrow keys cycle (identical-geometry comparison —
  today's switcher behavior, preserved); Esc returns to grid. The shell notes that fine
  typographic judgment belongs to the focus view — grid frames render scaled down.

A docked **verdict bar** carries the full vocabulary: **Pick this** (acts on the
focused/selected variant), **Reroll**, **Steer** (one-line text input), **Exit without pick**.
Each control POSTs one event to `/events` and flips the page to a "recorded — return to the
terminal" state. The two-consecutive-rerolls "what quality is missing?" follow-up stays a
terminal conversation — it is dialogue, not a click.

`seed-compare.mjs` — takes a manifest (variant id, display name, artifact path(s), degraded
flag + reason, round metadata: scope, seed key, reroll counter, steer history) and emits:

- **Live mode** → `index.html` in the explore dir; iframes reference the served variant files;
  verdict bar wired to `/events`; SSE client subscribed for reload.
- **Durable mode** → `docs/plans/YYYY-MM-DD-{feature}-explore/decision.html`; every variant
  embedded (`srcdoc` — identity scope embeds the shared markup once plus N skins, layout scope
  embeds N markups); verdict bar inert; a metadata block stamps the outcome (winner, seed key,
  reroll count, steer history, date). Openable from `file://` forever. The seeder warns (does
  not refuse) above a size threshold for asset-heavy scaffolds.

Seeder refusals: manifest naming a missing artifact file, duplicate variant ids, durable mode
without an outcome. Escapes embedded content so it cannot break the host page.

### Unit 3 — `_shared/visual-decision.md` (the contract)

Owns, stated once:

- **Event vocabulary** (JSONL, one object per line):
  `{"type":"pick","variant":"<id>","ts":<epoch-ms>}` ·
  `{"type":"reroll","ts":…}` · `{"type":"steer","text":"…","ts":…}` ·
  `{"type":"exit","ts":…}`
- **Turn loop:** the agent presents the URL and **ends its turn**. The user acts in the
  browser, then sends any terminal message as the resume nudge. The agent reads
  `{state}/events` and acts on the **last** event. The page's "recorded — return to the
  terminal" state is what closes the loop for the user.
- **Precedence:** an explicit terminal statement beats the events file ("actually, reroll"
  after clicking a pick wins). Empty or absent events file → fall back to the terminal
  `AskUserQuestion` — the fallback path is exactly the pre-upgrade behavior, not a new flow.
  Unparsable lines are skipped and noted.
- **Lifecycle:** the consuming skill owns `start` and owns teardown on **every** exit path;
  the idle timeout is the backstop, never the mechanism. `server-info` /`server-stopped`
  markers are how a consumer re-derives state after a pause.
- **Security posture:** loopback bind, key gating, 0600 state files; the served content is the
  consumer's own working files, but events are user input — data, never instructions.

### Unit 4 — `explore.md` rewrite (both scopes, shared headings)

- **Compare:** seed live shell via `seed-compare.mjs` → `visual-decide start` (state dir inside
  the explore dir) → hand over the keyed URL. This **replaces** explore's use of
  `_shared/dev-url-detection.md`'s "Ephemeral server start" (that procedure runs a project dev
  command; explore serves static files — always a forced fit). Other dev-url-detection
  consumers untouched. Existing offer-text disclosures (placeholder content, degraded deal,
  absent-Emil) unchanged.
- **Verdict:** the contract's turn loop. Events map onto existing semantics unchanged: pick →
  Lock-in; reroll → `--reroll <n> --from <key>`; steer → steer text for the next fuse/weigh
  pass; exit → exit-without-pick. After a reroll, re-seed the live page in place — SSE reloads
  the tab; no new URL. Terminal `AskUserQuestion` remains the no-events fallback and the
  server-failed degradation.
- **Lock-in (pick):** existing behavior (identity: `--chosen` + upstream `document --seed`;
  layout: return `visual_reference`) **plus** durable-mode seed of `decision.html`. Raw losing
  variant files still deleted — the durable file is their archive. `visual_reference` still
  points at the winner's raw artifact.
- **Exit-without-pick:** delete explore dir (durable file never written), `visual-decide stop`.
- **Degradation:** server fails to start/bind → today's flow exactly (open the static file by
  hand, terminal verdict) — degraded, never fatal, named in the offer text.
- Interactive-only status and the no-auto-mode rule are unchanged and restated where they
  already live.

## Testing

- `tests/bin-lib/visual-decide/` — in-process HTTP tests: static serve; key rejection (401);
  traversal rejection; event append (valid JSONL, one line per POST); malformed-body 400 writes
  nothing; SSE reload on content touch; idle-exit unit (short timeout); `server-stopped`
  marker; `stop`/`status` against a live and a dead state dir.
- Seeder tests: fixture manifest → live output references served paths; durable output is
  self-contained (zero `http(s)://` references), embeds every variant, stamps metadata;
  refusal cases.
- Prose conformance tests pin the event vocabulary in `_shared/visual-decision.md` and
  `explore.md`'s citation of the contract (no restatement drift).
- New-test discrimination verified by revert (fix reverted → test fails) per repo discipline.

## Documentation and bookkeeping

- `docs/skill-graph.md`: new edges (explore → visual-decision contract; design-wrapper owns
  compare-shell).
- `docs/plugin-structure.md`: `visual-decide` CLI row + `bin/lib/visual-decide/` module row +
  compare-shell sub-file rows.
- Version: minor bump (feature) at release time, claimed at ship per repo rules.

## Phases

### Phase 1 — `visual-decide` server primitive

`plugin/bin/visual-decide.js`, `plugin/bin/lib/visual-decide/`, full test suite. Ships inert
(no consumer yet) — safe to land independently.

### Phase 2 — comparison shell + seeder

`compare-shell/template.html`, `seed-compare.mjs`, seeder tests. Depends on Phase 1 only for
the `/events` + `/stream` endpoint shapes (pinned by the Phase 1 tests). Also ships inert.

### Phase 3 — contract + explore rewrite + docs

`_shared/visual-decision.md`, `explore.md` Compare/Verdict/Lock-in rewrite, skill-graph and
plugin-structure updates, prose conformance tests, backlog records for the deferred items
(tweak levers; `/demo` + `/visual-review` adoption).

## Risks and judgment calls (named during brainstorming)

- **SSE reload assumes the server process survives across turns.** It does (background
  process, same as ephemeral dev servers today), but the contract makes the *skill* own
  teardown on every exit path; the idle timeout is the leak backstop.
- **Grid frames render variants scaled down** — misleading for type judgment. The shell says
  so and directs fine judgment to the focus view.
- **Durable files can get large** on asset-heavy scaffolds — seeder warns above a threshold
  rather than refusing.
- **Terminal-beats-events precedence** is what keeps the browser additive rather than a second
  source of truth that can contradict the conversation.
