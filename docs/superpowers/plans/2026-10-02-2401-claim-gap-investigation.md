# Record #2401 Investigation — Claim-Gap Root Cause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the confirmed root cause of record #2329 reaching a full build with no landed `claims-registry` claim, and correct the now-stale "Known gap" prose (and its pinning test) in `plugin/skills/flow/claim-targets.md` that still claims no mechanical backstop exists, when one has existed since commit `0120f1fad` (#2526).

**Architecture:** No runtime code changes. Two prose/test corrections: (1) `claim-targets.md`'s "Known gap" paragraph is rewritten to state the mechanical backstop (`checkBookkeepingStampsGate`'s `hasLoggedClaim` check, #2526) now exists, with historical context dating #2329's build (2026-09-14) to before the backstop landed (2026-09-20); (2) the test in `tests/flow-claim-preflight.test.js` that currently pins the stale "no mechanical backstop" wording is updated to pin the corrected wording instead.

**Tech Stack:** Markdown (skill prose), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-02T033811-record-2401/work/2401-spec.md`

## Global Constraints

- Do not touch `plugin/bin/lib/hooks/pre-tool-use.js` runtime logic — the mechanical backstop it already implements is correct and out of scope; this plan only corrects documentation that fell out of sync with it.
- Keep edits surgical — only the "Known gap" paragraph in `claim-targets.md` and the one test block in `tests/flow-claim-preflight.test.js` that pins it.
- Preserve every other assertion in `tests/flow-claim-preflight.test.js` (e.g., the `#2492` log-line assertions) unchanged.

## Review Focus

- A reader of the corrected "Known gap" paragraph must come away knowing the backstop is live today, not still "tracked separately" — verb tense and claim must not drift back to stale phrasing.
- The corrected paragraph must still name `claims/issue-{n}.json` and `checkBookkeepingStampsGate` (other tests/readers key on these tokens) — a rewrite that drops them silently breaks unrelated consumers.
- The test update must assert the *new* wording, not merely stop asserting the old wording — a test that goes from `assert.match(stale)` to no assertion at all loses the pin entirely.
- The historical dating (#2329 built 2026-09-14, backstop landed 2026-09-20 via #2526) must cite real, re-checkable evidence (commit hashes), not an invented timeline — this is the crux of the investigation's credibility.
- The spec file's own investigation write-up must distinguish "confirmed" (the claim-gap timeline) from "circumstantial, unconfirmed" (the separate `config.yml`-never-written/session-boundary anomaly) exactly as the record's own Current State already does — don't overclaim resolution of the second anomaly.

---

### Task 1: Correct the stale "Known gap" paragraph in claim-targets.md

**Files:**
- Modify: `plugin/skills/flow/claim-targets.md:164-181`
- Test: `tests/flow-claim-preflight.test.js:257-273`

**Interfaces:**
- Consumes: nothing (prose-only change)
- Produces: corrected prose other skill files may cite in the future; no code interface

- [ ] **Step 1: Update the failing test first — change the stale-wording assertion to the corrected-wording assertion**

Edit `tests/flow-claim-preflight.test.js`'s existing test (the one starting `test('claim-targets.md mandates a decisions.md log line on successful claim, and names the missing mechanical backstop (#2492)'`) to assert the corrected wording instead of the stale one:

```javascript
test('claim-targets.md mandates a decisions.md log line on successful claim, and documents the mechanical backstop that now enforces it (#2492, #2526)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  const claimSection = content.split('## Claim every named target')[1];
  assert.ok(claimSection, 'claim section heading must exist');
  // The mandatory post-claim log-decision.js call — a local, durable trace
  // independent of a fresh gh/MCP read against claims-registry.
  assert.match(claimSection, /Log the claim \(mandatory, #2492\)/);
  assert.match(claimSection, /bin\/log-decision\.js.*--run "\$PIPELINE_RUN_DIR" --status AUTO/s);
  assert.match(claimSection, /--step "Step 2\.8"/);
  // The mechanical backstop note: checkBookkeepingStampsGate now enforces
  // this stamp (closed by #2526, shortly after #2492 documented the gap) —
  // this must assert the gap is CLOSED, not merely that it is discussed.
  assert.match(claimSection, /Mechanical backstop.*#2526/s);
  assert.doesNotMatch(claimSection, /this step has no mechanical backstop today/);
  assert.match(claimSection, /checkBookkeepingStampsGate/);
  assert.match(claimSection, /hasLoggedClaim/);
  assert.match(claimSection, /claims\/issue-\{n\}\.json/);
  assert.match(claimSection, /2026-09-14/);
  assert.match(claimSection, /#2329/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/flow-claim-preflight.test.js`
Expected: FAIL — the renamed test fails on `assert.match(claimSection, /Mechanical backstop.*#2526/s)` (text not yet present) and `assert.doesNotMatch(claimSection, /this step has no mechanical backstop today/)` would currently pass (the old text is still there) but the `hasLoggedClaim`/`2026-09-14`/`#2329` assertions fail since none of that text exists yet in `claim-targets.md`.

- [ ] **Step 3: Rewrite the "Known gap" paragraph in claim-targets.md**

Replace this existing paragraph (the one starting "**Known gap: this step has no mechanical backstop today.**" and ending "...not a rider on an unrelated fix.") with:

```markdown
**Mechanical backstop (closed by #2526).** Unlike its sibling bookkeeping stamps —
`record-worktree` and, under `integration-model: pr-first` (`_shared/integration-model.md`),
the PR-early draft-PR open — `bin/lib/hooks/pre-tool-use.js`'s `checkBookkeepingStampsGate`
also denies the next covered write (and in particular the phase-exit `git push`) until it sees
this step's `decisions.md` claim-log line, via its `hasLoggedClaim` check (added in #2526,
shortly after #2492 below first documented the gap — both landed 2026-09-20). A materialize
commit with no matching `claims/issue-{n}.json` claim recorded for its target therefore cannot
reach a covered push today.

**Historical gap (pre-#2526, confirmed root cause of #2401's investigation).** Before #2526
landed, this step was prose-only, with no code path enforcing it independent of the
orchestrating agent's own compliance — #2492 confirmed this the hard way: a
`/flow #{n} build,test` dispatch completed a full build and test pass with no
`claims/issue-{n}.json` blob ever written on `claims-registry`, and none of this file's own
skip-guard conditions applied to that dispatch shape — the call was simply never made.
Record #2329 is a second, earlier instance of the identical failure mode: its materialize
commit landed 2026-09-14 (run `2026-09-14T040051-record-2329`), six days before #2526's fix
(2026-09-20) — at build time there was no mechanical gate to have caught the missing claim.
`bin/claim-targets.js`'s own write path was never the gap (`tests/bin-lib/claim-targets/claim-targets.test.js`
already covers the create-only/conditional/contested/transient/unverified-write-back cases in
depth, including the exact write-then-verify race #2073 closed) — the gap was purely the
absence of a mechanical check *downstream* of that CLI, which #2526 closed.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/flow-claim-preflight.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/claim-targets.md tests/flow-claim-preflight.test.js
git commit -m "Correct stale claim-targets.md known-gap prose — mechanical backstop shipped in #2526

refs #2401"
```

---

### Task 2: Record the investigation conclusion in the materialized spec file

**Files:**
- Modify: `.claude-tweaks/pipelines/2026-10-02T033811-record-2401/work/2401-spec.md`

**Interfaces:**
- Consumes: Task 1's corrected `claim-targets.md` text (cites the same commit/PR numbers)
- Produces: an `## Investigation Findings` section for `/review`/`/wrap-up` to read when composing the closing summary/release note

- [ ] **Step 1: Append an Investigation Findings section**

Insert a new `## Investigation Findings` section immediately before `## Original request` in
`.claude-tweaks/pipelines/2026-10-02T033811-record-2401/work/2401-spec.md`:

```markdown
## Investigation Findings

**Confirmed root cause.** Record #2329's materialize commit landed 2026-09-14
(`2026-09-14T040051-record-2329`) — six days before commit `0120f1fad` (#2526, 2026-09-20)
added `checkBookkeepingStampsGate`'s `hasLoggedClaim` check, the first mechanical enforcement
of `/flow` Step 2.8's claim step. Before that commit, Step 2.8 was prose-only ("no code path
enforcing it independent of the orchestrating agent's own compliance" — `claim-targets.md`'s
own words, written by #2492/#2525 the same day, ~40 minutes before #2526 closed the gap).
#2329 is a second, earlier instance of exactly the failure mode #2492 diagnosed for issue
#2322: a build/test dispatch can complete with no `bin/claim-targets.js` call ever landing a
claim, and nothing at build time stopped it. No reproduction is needed beyond this timeline —
the gap is closed today (verified live: this very run's own `git push` was denied by
`checkBookkeepingStampsGate` until its Step 2.8 claim was logged, see this run's
`decisions.md`).

**Secondary finding: stale documentation now corrected.** `claim-targets.md`'s "Known gap"
paragraph was never updated after #2526 shipped, so it still asserted (as of this
investigation) that no mechanical backstop existed — contradicted by the very hook this
record's own build triggered. A pinning test (`tests/flow-claim-preflight.test.js`) enforced
the stale wording. Both are corrected in this build (see commit "Correct stale
claim-targets.md known-gap prose").

**Unconfirmed, separate anomaly (not resolved by this investigation).** The Current State's
second anomaly — #2329's run directory never getting a `config.yml` despite `decisions.md`
showing populated `/build`/`/test` entries, with `pre-compact`/`session-end` events in the
same window — remains circumstantial. It is plausibly unrelated to the claim-gap root cause
above (a session-boundary/compaction interaction, not a claim-enforcement gap) and is not
reproducible from available historical evidence. No further action taken on it here; flagged
for a human to judge whether it merits its own record if it recurs.
```

- [ ] **Step 2: Verify the section was inserted correctly**

Run: `grep -c "^## Investigation Findings$" "$PIPELINE_RUN_DIR/work/2401-spec.md"`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add .claude-tweaks/pipelines/2026-10-02T033811-record-2401/work/2401-spec.md
git commit -m "Record investigation findings for #2401 in materialized spec

refs #2401"
```
