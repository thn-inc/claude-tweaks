# Claimed-mint fallback attribution (#3363) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freshly minted `/flow` run dir holding only Step 2.8's claim-log line is never a fallback-attribution target, and preflight adopts such a dir as case 2.

**Architecture:** `isUnadoptedMint` (`plugin/bin/lib/hooks/context.js`) gains one more "still unadopted" shape — no `run-state.json` and a `decisions.md` that `classifyDecisions` (`plugin/bin/lib/log-decision/claim-log.js`) classifies `claim-log-only`. The preflight half (`eventsHaveOwnContent` in `plugin/bin/lib/flow/preflight.js`) already shipped on main; this plan only adds AC-exact regression tests for it.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T203907-record-3363/work/3363-spec.md`

## Global Constraints

- No new dependencies; reuse `classifyDecisions` — never re-derive the claim-line shape.
- An **empty** `decisions.md` (`classifyDecisions` → `'empty'`) stays adopted — existing fixtures (`tests/hooks-dispatcher.test.js`, `tests/hooks-bookkeeping-stamps-gate.test.js`, the standalone-run test in `tests/hooks-run-attribution.test.js`) touch an empty `decisions.md` to mark a dir adopted.
- A `decisions.md` that exists but cannot be read (any error other than ENOENT) stays adopted — fail toward the pre-change behavior.
- Presence of `run-state.json` (parseable or not) still means adopted.

## Review Focus

1. A claim-log-only dir is the ONLY candidate → fallback resolves `{ dir: null, attribution: null }`, never the mint (Task 1 test).
2. A claim-log-only mint sorting newest beside an older real run → fallback picks the older real run (Task 1 test).
3. A `decisions.md` with a claim line plus any other line (e.g. the Manifesto snapshot header) → adopted, still a fallback candidate (Task 1 test).
4. A claim-log-only mint WITH `run-state.json` (dispatch-stamped) → adopted, unchanged (Task 1 test).
5. Preflight: env-/session-attributed event lines (`attribution` absent on the hook's own-run writes, since `appendEvent` only tags guesses) still count as other content (Task 2 test).

---

### Task 1: `isUnadoptedMint` treats a claim-log-only mint as unadopted

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js` (`isUnadoptedMint`, ~line 54, plus its comment block above it)
- Test: `tests/hooks-run-attribution.test.js` (append to the `unadopted mints (#721)` section, ~line 185-220)

**Interfaces:**
- Consumes: `classifyDecisions(text: string|null) -> 'absent'|'empty'|'claim-log-only'|'content'` from `plugin/bin/lib/log-decision/claim-log.js`.
- Produces: `isUnadoptedMint(dir, state) -> boolean` — same signature, widened semantics.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-run-attribution.test.js`, using the file's own `project()`/`mkRun()`/`readEvents()` helpers and this fixture constant:

```js
const CLAIM_ONLY = '## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.\n';
```

  - `fallback never selects a claim-log-only mint (decisions.md holds only the Step 2.8 claim line, no run-state.json) (#3363)`: older `mkRun(cwd, '2026-07-01T090000-real', { status: 'active' })`, newer `mkRun(cwd, '2026-07-02T090000-mint', null)` with `decisions.md = CLAIM_ONLY` → `resolveRun(cwd, {}, 'me')` and `resolveRun(cwd, {}, null)` both deepEqual `{ dir: real, attribution: 'fallback' }`.
  - `a claim-log-only mint is the only run — resolves null (#3363)`: only the mint → both deepEqual `{ dir: null, attribution: null }`.
  - `AC1.1: a foreign session's hook event never lands in a claim-log-only mint's events.jsonl (#3363)`: only the mint; `const owned = ctxLib.resolveRun(cwd, {}, 'other-session'); sessionEnd.run({ input: { reason: 'exit', session_id: 'other-session' }, ownedRun: owned, cwd });` → `readEvents(mint)` deepEqual `[]`.
  - `a claim line plus any other decisions.md content is adopted (#3363)`: mint's `decisions.md = CLAIM_ONLY + '- AUTO 18:43:00 — Manifesto: levers written. Reversibility: n/a.\n'` → `resolveRun(cwd, {}, 'me')` deepEqual `{ dir: mint, attribution: 'fallback' }`.
  - `a claim-log-only dir with run-state.json is adopted (#3363)`: `mkRun(cwd, '2026-07-02T090000-mint', { status: 'active' })` + `decisions.md = CLAIM_ONLY` → `{ dir: mint, attribution: 'fallback' }`.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/hooks-run-attribution.test.js`
Expected: FAIL — the first three new tests fail (fallback returns the mint); the last two pass.

- [ ] **Step 3: Implement** in `plugin/bin/lib/hooks/context.js`: `require('../log-decision/claim-log')` for `classifyDecisions`; in `isUnadoptedMint`, after the existing `state`/`run-state.json` early returns, read `decisions.md` — ENOENT → `true`; any other read error → `false`; otherwise return `classifyDecisions(text) === 'claim-log-only'`. Update the comment block above it to name the claim-log-only shape and #3363 (flow Step 2.8 writes the claim line before Step 3 writes anything else).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/hooks-run-attribution.test.js tests/hooks-context.test.js tests/hooks-dispatcher.test.js tests/teardown-gate.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/friction-events-cli.test.js tests/verify-run-bookends.test.js tests/bin-lib/closing-tally/closing-tally.test.js`
Expected: PASS, 0 failures. (Dependency-caller enumeration: `isUnadoptedMint`'s only caller is `isSkippableFallbackCandidate` → `resolveRun`'s two fallback arms, `git grep -n "isUnadoptedMint\|isSkippableFallbackCandidate" -- plugin`; the extra suites are every `tests/` file carrying a `Step 2.8: claimed` fixture line, `git grep -ln "Step 2.8: claimed" -- tests`, i.e. the fixtures that could rely on fallback-resolving a claim-log-only dir.)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/context.js tests/hooks-run-attribution.test.js
git commit -m "Skip claim-log-only mints in hook fallback attribution — a Step 2.8-claimed dir is still unadopted, refs #3363"
```

---

### Task 2: AC-exact preflight regression tests

**Files:**
- Test: `tests/bin-lib/flow/preflight.test.js` (append after the existing `events.jsonl holding only fallback-attributed lines` tests, ~line 410-430)

**Interfaces:**
- Consumes: the file's existing `adoptionFor(decisions, extra)`, `CLAIM_ONLY`, `ADOPTION_NOTES`.

- [ ] **Step 1: Write the tests**
  - `AC2.1: claim-log-only decisions.md beside fallback-only events.jsonl → case 2 (#3363)`: `adoptionFor(CLAIM_ONLY, { 'events.jsonl': <two lines, both "attribution":"fallback"> })` → `a.case === 2`, `a.hasOtherContent === false`.
  - `AC3.1: an env- or session-attributed (untagged) events.jsonl line is still other-run content (#3363)`: for each of `'{"type":"skill_invoked","skill":"claude-tweaks:build","ts":"2026-09-06T12:01:00.000Z"}\n'` and `'{"type":"commit","ts":"2026-09-06T12:01:00.000Z","attribution":"session"}\n'` (each prefixed by one fallback-tagged line), `adoptionFor(CLAIM_ONLY, { 'events.jsonl': text }).a.hasOtherContent === true`.

- [ ] **Step 2: Run**

Run: `node --test tests/bin-lib/flow/preflight.test.js`
Expected: PASS (behavior already shipped). Then prove discrimination: temporarily make `eventsHaveOwnContent` return `true` on any non-empty line, re-run, see AC2 fail; restore via `git checkout -- plugin/bin/lib/flow/preflight.js` in the same command.

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/flow/preflight.test.js
git commit -m "Pin AC2/AC3 adoption cases for claim-log-only mints with fallback events, refs #3363"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1; Deliverable 2 → already on main (`eventsHaveOwnContent`); Deliverable 3 (a regression test for each) → Task 1 tests + existing fallback-only test + Task 2. AC1 → Task 1 AC1 test; AC2/AC3 → Task 2.
- **Placeholders:** none.
