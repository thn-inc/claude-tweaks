## Review: #3835 — Route a lens agent's BLOCKED or NEEDS_CONTEXT reason in review's Step 3 dispatch (draft PR #6171)

**Review effort:** low (derived from record labels: risk:low × size:low; the diff heuristic agrees: 2 files and 21 lines at review start, no merge-sensitive paths, no floor set)

Mode: code (standalone: no `$PIPELINE_RUN_DIR`). The record carries `ceremony:fast-lane`, but a standalone review runs every step. Scope: `origin/main...HEAD`, with no merge commits and no cherry-pick duplicates. Reviewed HEAD at start: `a3b5ffc`. Final HEAD: `4239110`.

### Spec Compliance (spec-based only)
| Deliverable | Status |
|-------------|--------|
| Re-prompt-once rule beside the partner-died rule for a non-absence `BLOCKED`/`NEEDS_CONTEXT` reply, then single-read coverage (`step3-lens-dispatch.md:109`) | done |
| Extend the partner-died `STAGED` line's reason slot with `blocked: {reason}` / `needs-context: {reason}`, and put the stated reason in the coverage caveat | done (**partial at review start**: the slot existed only as a restatement in `step3-lens-dispatch.md`, while the owner template `step3-tier-variants.md:17` and its reader `pair-lines.js:152` still listed three causes. Fixed by this review in `057d170`) |
| An absence-claim reason goes through the ground-truth check first | done |
| Conformance test with a go-red control beside `tests/review-absence-claim-ground-truth-conformance.test.js` | done |

| Acceptance Criterion | Status |
|---------------------|--------|
| `step3-lens-dispatch.md` names the re-prompt-once step and routes a still-blocked lens to the partner-died single-read coverage outcome | met |
| The `STAGED` reason slot includes `blocked`/`needs-context`, and the Step 7 / PR-verdict caveat names the lens and its reason | met (after `057d170`. Before it, the reason slot was only restated in the citing file) |
| A conformance test asserts both, and reverting the new sentence turns it red | met: `go-red: dropping the re-prompt-once sentence…` in the absence-claim suite. The slot is now also carried by the degrade suite's `LOG_LINE_LITERAL` and the `pair-lines.test.js` slot pins. Removing the new reader pattern in a scratch copy turned exactly `AC3.3: each single-read-coverage alternation filling matches that form` red (99 others green) |
| `step3-lens-dispatch.md` stays under `RAIL_BYTES` (52,500) | met: 50,290 bytes (`review-tiebreak-step-conformance` green) |
| `npm test` passes | met: impact-selected local run 5,894 tests, 5,893 pass, 0 fail, 1 skipped. PR CI at `4239110`: shards 1–4 and `test` green |

Risk markers: the Gotchas are validated. Headroom was measured, and the `dispatch/task-prompt.md:61-62` citation of the partner-died paragraph still resolves. The original request's Open Question was resolved by the shaped Technical Approach. Current-State outcome: reached, because the diff adds the routing rule the Current State says is missing. Step 1.6: skipped (no parent record).

### Verification (from /test)
- Type check: n/a (no separate check in this repo's verify declaration)
- Lint: n/a (no separate check in this repo's verify declaration)
- Tests: pass. Gate at start: runner stamp `a3b5ffc` (scoped) verified HEAD. Re-verify after the fix waves: scoped run at `4239110` (9 changed files since `4d84b1e5c`; suites: tests; static: yes; 192 of 1,417 test files impact-selected), with the tests suite taken from CI run https://github.com/thn-inc/claude-tweaks/actions/runs/45327418648 (success). The stamp now verifies HEAD `4239110`. Caveat: a CI-sourced pass does not cover macOS, Node 22 or Windows.

CAVEAT: tests counts unparsed (family generic) — count-stamp comparison skipped; see ~/Code Workspaces/claude-tweaks/.git/worktrees/drive-record-3835/claude-tweaks-verify/tests.log

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| error | `step3-tier-variants.md:17`: the partner-died `STAGED` template's reason slot still listed only `{session limit twice \| unavailable \| timed out}`, while the new rule told the dispatcher to log `blocked: {reason}` / `needs-context: {reason}` there (record deliverable 2 not built). The read-trigger list at `:3` also omitted the blocked case. | medium | fixed (`057d170`) |
| error | `plugin/bin/lib/timing/pair-lines.js:152`: the `single-read-coverage` reader accepted only the three old causes, so a blocked/needs-context coverage line would be counted as unparsed. Its template string would also have drifted from the prose. | medium | fixed (`057d170`): an additive pattern, so archived lines still parse. It is linear by construction, with a perf case added |
| test | `tests/review-absence-claim-ground-truth-conformance.test.js:94`: the new test pinned only the dispatch prose, not the template or reader that must accept the new causes | low | fixed (`057d170`): the degrade suite's literal and `pair-lines.test.js`'s slot pins now carry both causes, plus a no-reason negative control |
| error | `review-summary-template.md:25,43`: the Coverage caveat examples show only `timed out` / `unavailable` | low | accepted: the slot already says "every affected lens with its reason", so `3c (blocked: …)` fits. The tiebreak also recommended drop |
| docs | `docs/reference/step-yield.md:167` (lens 3i, registry auto-detect on `pair-lines.js`): the pair-line table quoted the old three-cause `single-read-coverage` slot | low | fixed (`4239110`) |
| docs | `docs/reference/dispatch-cost-baseline.md` (lens 3i, auto-detect `plugin/bin/lib/timing/**`): not updated | info | accepted: a snapshot of one past run's `phase-timing.js` tables, which the reader change does not touch |

Lens 3b (Security): no findings. Lens 3c (Error Handling): the four findings above, as single reads (low tier), all settled by the tiebreak.

### Tiebreak
**Verdicts:** 4 confirmed · 0 dropped · 0 digest · 0 console
- AUTO 19:06:41 — Reproduction: lens "3c" finding plugin/skills/review/step3-tier-variants.md:17 confirmed by tiebreak:81ea350a565d. Confirmed. Reversibility: high.
- AUTO 19:06:41 — Reproduction: lens "3c" finding plugin/bin/lib/timing/pair-lines.js:152 confirmed by tiebreak:cf2d52201aaa. Confirmed. Reversibility: high.
- AUTO 19:06:41 — Reproduction: lens "3c" finding plugin/skills/review/review-summary-template.md:25 confirmed by tiebreak:d0880824fecf. Confirmed. Reversibility: high.
- AUTO 19:06:41 — Reproduction: lens "3c" finding tests/review-absence-claim-ground-truth-conformance.test.js:94 confirmed by tiebreak:070f3c001b3f. Confirmed. Reversibility: high.

No can't-tell findings.

### Fan-out leftovers
0 untracked files left by the review fan-out, and no agent-scratch leftovers. 2 new local listeners since the pre-dispatch snapshot, reported (not killed; ownership unattributed): rapportd:62238, rapportd:62239 (the macOS Continuity daemon re-binding its ports, almost certainly not a lens agent).

### Implementation Hindsight
- A citing file (`step3-lens-dispatch.md`) added new values to a template slot owned by another file, without editing the owner template or its code reader. Every twin pin stayed green because neither twin changed. → change now (D2, project skill `[skill: prose-code-twin-pin]`): added an anti-pattern row to `.claude/skills/prose-code-twin-pin/SKILL.md` (`c540035`)
- Approach, structural debt, consolidation, convention: no changes needed. The rule reuses the partner-died path, as the record's Technical Approach prescribes.

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| The Coverage caveat slot's examples in `review-summary-template.md` were left unchanged | The slot is already generic ("with its reason"), and a one-line edit there would touch a byte-pinned line (`COVERAGE_CAVEAT_LINE`) for no behavior change |
| The short-form `review/…` paths in the new twin-pin row stay unresolved by `load-delta.js` | They match the file's existing rows (e.g. `review/step3-debate-and-refutation.md`), and resolving them would only grow that skill's load closure |

### Visual Review
- **Status:** Skipped — no UI changes
- Skill-load gate reason: no frontend surface (surface: infra) and no UI trigger file in the diff
- Journeys whose `files:` overlapped the diff: compose-a-per-run-context-bundle-1988, confirm-a-finding-beside-a-second-issue-on-one-line-2907, confirm-coverage-findings-across-reproduction-pairs-3049, confirm-findings-split-across-a-multi-line-statement-2955, confirm-paraphrased-findings-across-reproduction-pairs-3418, count-skill-file-reads-per-file-4359, drop-a-refuted-code-is-missing-claim-3329, get-a-verdict-on-every-unverified-review-finding-3947, keep-a-second-reader-in-a-dispatched-review-3078, keep-review-lenses-from-running-suites-3001, keep-untrusted-text-off-a-command-line-4595, log-reproduction-lines-through-the-pairing-command-5595, measure-composed-bytes-per-call-site-1990, prove-a-test-discriminates-in-a-scratch-checkout-4556, read-a-size-capped-review-lens-bundle-3020, run-a-review-from-a-worktree-isolated-session-2956, run-review-lenses-through-a-workflow-5599, select-review-lenses-from-diff-facts-and-lens-yield-6001, state-every-failure-branch-of-a-fail-closed-guard-3965, stop-a-run-on-a-host-that-cannot-dispatch-subagents-4555, trust-a-defect-several-review-lenses-flagged-3604

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- No simplifications needed (code-simplifier over `pair-lines.js` and the four changed test files; markdown filtered out by Step 1)

### Skill Load Delta
Skill load delta (base 4d84b1e = merge-base with origin/main):

| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |
|---|---|---|---|---|---|
| .claude:prose-code-twin-pin | 32,271 | +1,008 | 56,933 | +1,008 | 2: `review/step3-lens-dispatch.md`, `review/step3-tier-variants.md` |
| 41 entries: plugin:accept, plugin:activity, plugin:assess-agent-autonomy, … +38 more | 1,944–52,101 | 0 | 7,444,426–7,485,028 | +871 | — |

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed

| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Partner-died `STAGED` reason slot, caveat and read-trigger list extended with the `blocked`/`needs-context` causes — `plugin/skills/review/step3-tier-variants.md` | `057d170` |
| Bug fix | Additive `single-read-coverage` reader pattern for the new causes, with the template synced — `plugin/bin/lib/timing/pair-lines.js` | `057d170` |
| Bug fix | Slot pins and the degrade-suite literal extended, a no-reason control and a perf linearity case added — `tests/bin-lib/timing/pair-lines.test.js`, `tests/review-dispatched-reviewer-degrade-conformance.test.js`, `perf/pair-lines-linearity.test.js` | `057d170` |
| Skill update | Hindsight: anti-pattern row for a citing file that adds a value to a template slot — `.claude/skills/prose-code-twin-pin/SKILL.md` | `c540035` |
| Doc fix | `single-read-coverage` row synced with the extended slot — `docs/reference/step-yield.md` | `4239110` |

All three commits were pushed to `drive-record-3835` (draft PR #6171, remote head `4239110`). The PR was not merged, closed or marked ready. No verdict comment was posted (standalone run: no `run-state.json` `pr` object).

### Key Learnings
1. A new value for a logged line, added only in a file that cites the line's template, leaves the prose↔code twin pin green because neither twin changed. Edit the slot in the owner file and add the reader pattern so the existing pins carry it. This is now a row in `prose-code-twin-pin`.
2. `tests/bin-lib/timing/step-yield-schema.test.js` pins only the form ids in `docs/reference/step-yield.md`'s pair-line table, not its template column, so a reader template change leaves that doc stale with every suite green (this review caught it only through lens 3i). Not routed: a candidate digest entry or record for wrap-up, which this trial's rules exclude from this session.
3. The low-tier single-read lenses plus the tiebreak found exactly the deliverable gap Step 1's spec check flagged independently (4/4 confirmed). The spec check and the lens agreed without seeing each other.

### Next Actions

**`/claude-tweaks:wrap-up 3835`** — capture learnings and clean up (recommended)
