---
record: 735
origin: human
risk: low
size: low
ceremony: fast-lane
grants: [build]
surface: backend
---
# 735: Wire Surface: terminal into /build Common Step 1.7 pre-build (terminal-routing.md says pre-build runs on the terminal track; build only routes web/mobile/desktop)

Surface: backend

# Ledger record proposal — item #1 (record #685's run)

**Origin:** ledger resolve gate (Phase 2 ledger narrowing, `unattended` ceiling)
**Stage:** backlog (Keep)
**Affected files:** skills/build/SKILL.md (Common Step 1.7), skills/build/design-prebuild.md, skills/design-wrapper/terminal-routing.md, skills/_shared/terminal-ux.md

## Current State

`skills/build/SKILL.md` Common Step 1.7 invokes `/claude-tweaks:design-wrapper pre-build` only for `surface ∈ web | mobile | desktop`. `skills/design-wrapper/terminal-routing.md`'s outcomes table says `pre-build` **runs** on the terminal track (always-load set: `_shared/terminal-ux.md` + `_shared/design-craft.md`, no Impeccable references). A `Surface: terminal` record (e.g. #685, tidy report rendering) therefore never reaches the pre-build hop, and the terminal craft file only reaches an implementer if the plan happens to cite it by hand — which #685's plan did, by luck of authorship.

## Deliverables

- Extend Common Step 1.7's surface predicate to include `terminal`, routing to the wrapper's terminal track (`terminal-routing.md`'s `pre-build` row), and update `design-prebuild.md`'s skip conditions accordingly.
- A test pin (e.g. in `tests/terminal-track.test.js`) asserting build's Step 1.7 names `terminal`.
- `docs/skill-graph.md` edge check: build → design-wrapper already exists; no new edge.

## Acceptance Criteria

- [ ] `skills/build/SKILL.md` Common Step 1.7 routes `surface: terminal` to `/claude-tweaks:design-wrapper pre-build`.
- [ ] `design-prebuild.md` documents the terminal always-load set (or cites `terminal-routing.md`'s row).
- [ ] A test fails if `terminal` is dropped from Step 1.7's predicate.

## Technical Approach

Add `terminal` alongside `web | mobile | desktop` in Common Step 1.7's surface predicate in `skills/build/SKILL.md`, routing a `Surface: terminal` record to `/claude-tweaks:design-wrapper pre-build` exactly as the other three surfaces already are. `design-prebuild.md`'s skip conditions currently assume a non-web/mobile/desktop surface always skips; update that assumption so `terminal` instead proceeds to `terminal-routing.md`'s `pre-build` row (always-load set: `_shared/terminal-ux.md` + `_shared/design-craft.md`, no Impeccable references — the terminal track never invokes Impeccable). Add a test pinning that Step 1.7's surface predicate literally names `terminal`, so a future edit can't silently drop it the way it was silently absent until now. No new `docs/skill-graph.md` edge is needed — build → design-wrapper is already recorded.

### Key Files

- `plugin/skills/build/SKILL.md` — Common Step 1.7 surface predicate
- `plugin/skills/build/design-prebuild.md` — skip conditions; update for the terminal track
- `plugin/skills/design-wrapper/terminal-routing.md` — the `pre-build` row this record wires build into
- `plugin/skills/_shared/terminal-ux.md` — always-load set the terminal track pulls in once wired
- `tests/terminal-track.test.js` — new pinning test for Step 1.7's predicate

## Gotchas

- Blocked at #685's own gate because the fix expands pipeline scope beyond #685's diff — this is a design decision about the terminal track's build integration living in files #685 never touched, which is why it was routed here as a separate backlog record via Phase 2 ledger narrowing rather than fixed inline.
- #685's own plan happened to cite `_shared/terminal-ux.md` by hand, working around the gap by luck of authorship — that workaround does not generalize; any terminal-surface record without an author who already knows to cite it by hand misses the craft file entirely until this wiring lands.
- `terminal-routing.md`'s outcomes table already documents the *intended* behavior (`pre-build` runs on the terminal track) — this record is purely a code/prose wiring fix to match that existing promise, not a design change to what the terminal track should do.

## Original request

Wire Surface: terminal into /build Common Step 1.7 pre-build (terminal-routing.md says pre-build runs on the terminal track; build only routes web/mobile/desktop)

# Ledger record proposal — item #1 (record #685's run)

**Origin:** ledger resolve gate (Phase 2 ledger narrowing, `unattended` ceiling)
**Stage:** backlog (Keep)
**Affected files:** skills/build/SKILL.md (Common Step 1.7), skills/build/design-prebuild.md, skills/design-wrapper/terminal-routing.md, skills/_shared/terminal-ux.md

## Current State

`skills/build/SKILL.md` Common Step 1.7 invokes `/claude-tweaks:design-wrapper pre-build` only for `surface ∈ web | mobile | desktop`. `skills/design-wrapper/terminal-routing.md`'s outcomes table says `pre-build` **runs** on the terminal track (always-load set: `_shared/terminal-ux.md` + `_shared/design-craft.md`, no Impeccable references). A `Surface: terminal` record (e.g. #685, tidy report rendering) therefore never reaches the pre-build hop, and the terminal craft file only reaches an implementer if the plan happens to cite it by hand — which #685's plan did, by luck of authorship.

## Deliverables

- Extend Common Step 1.7's surface predicate to include `terminal`, routing to the wrapper's terminal track (`terminal-routing.md`'s `pre-build` row), and update `design-prebuild.md`'s skip conditions accordingly.
- A test pin (e.g. in `tests/terminal-track.test.js`) asserting build's Step 1.7 names `terminal`.
- `docs/skill-graph.md` edge check: build → design-wrapper already exists; no new edge.

## Acceptance Criteria

- [ ] `skills/build/SKILL.md` Common Step 1.7 routes `surface: terminal` to `/claude-tweaks:design-wrapper pre-build`.
- [ ] `design-prebuild.md` documents the terminal always-load set (or cites `terminal-routing.md`'s row).
- [ ] A test fails if `terminal` is dropped from Step 1.7's predicate.

Blocker at #685's gate: expands pipeline scope — the wiring is a design decision about the terminal track's build integration, in files outside #685's diff.


Origin: /claude-tweaks:wrap-up Review Console (record #685, run 2026-08-16T205523-spec-685) — staged/ledger-record-terminal-prebuild-wiring.md

