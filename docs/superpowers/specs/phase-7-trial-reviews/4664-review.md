## Review: #4664 — flow: a context-cap handoff taken before the automatic stories step drops that step for good (PR #6201)

**Review effort:** medium (derived from label low, diff heuristic medium (risk:low × size:low; a new CLI flag on `plugin/bin/context-gauge.js` that `/flow` skill prose calls is a cross-package interface → risk proxy medium; 4 files / 75 lines → size proxy medium))

Standalone review (no `$PIPELINE_RUN_DIR`), so every step ran. The `fast-lane` profile in the driver run's `config.yml` was not applied. Reviewed range: `origin/main...6f8cde4e9f` (merge-base `15af9f65f8`). No merge commits and no cherry-pick provenance in the range. #4664 has no parent record, so Step 1.6 (cross-spec promises) was skipped.

Process notes:
- (a) The four medium-tier lens pairs (3a, 3b, 3c, 3f) were dispatched in one parallel batch, not one pair at a time. Each pair kept byte-identical prompts.
- (b) Step 3 Routing's interactive batch question was not asked. Every finding took the skill's default "Fix now" recommendation, under the session's standing instruction to commit and push only fixes the review itself applies. The one finding that could not be fixed now was routed Defer, and it was not filed (see Implementation Hindsight).

### Spec Compliance (spec-based only)
| Deliverable | Status |
|-------------|--------|
| 1. A `/flow` run that changed UI files, without `no-stories`, and that hands off before its automatic stories step no longer loses that step silently | done — `--stories-owed` refuses the handoff (`handoff: null` plus a reason, logged as a SKIP) unless `stories` is in `--next-steps` ahead of `test`. `flow/SKILL.md` Step 4 tells the caller to pass it. Caveat in Implementation Hindsight. |
| 2. A test covers a handoff taken while stories are still owed | done — `tests/bin-lib/timing/context-gauge.test.js` covers a refused handoff (`test,review` and `test,review,stories`), an accepted one (`stories,test,review` and `stories,review`), and the exit-2 misuse cases. |

| Acceptance Criterion | Status |
|---------------------|--------|
| 1. Stories owed + over the cap → the resumed run runs `/claude-tweaks:stories` before `test`, or the gauge reports the omission | met — a list that omits stories or misorders them gets `handoff: null` and a `--stories-owed` reason. An accepted list resumes with `stories` first; `stories` is a `FLOW_STEPS` token that `steps-and-gates.md` resumes from. |
| 2. `no-stories`, or no UI file changes, hands off exactly as today | met — without the flag nothing changes. The existing over-cap test at `context-gauge.test.js:304` hands off a list with no `stories`. |
| 3. `npm test` passes | met — PR CI ran the whole suite on the final head `4f8efd727d`: shards 1-4 pass, `test` pass. The local impact-scoped run (196 of 1,422 files) had 5,073 pass and 0 fail. |

Non-goals: none declared. Risk markers: none unresolved. The single Gotcha (reuse the existing UI-file trigger rule) is honored: Step 4's new sentence points at "Automatic story generation" and adds no second definition. Current-State outcome: reached — `flow/SKILL.md` Step 4, the gauge caller named in Current State, now passes the new flag. No PR-body deliverables.

### Verification (from /test)
- Type check: n/a — none configured
- Lint: n/a — none configured
- Tests: pass. Gate stamp: `verifiedHead: true` at `6f8cde4e9f` (scoped). After the fix wave: the scoped local run passed at `fdbff4cac1` and again at `4f8efd727d`. PR CI was green at `4f8efd727d`.

### QA Validation (from /test)
- **Status:** Skipped — no stories (no `stories/` directory)

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| convention | `--stories-owed` was accepted silently without `--next-steps`, and under `--record-steps` it ran its order check on the union of every record's steps, while the sibling flags `--keep-going`/`--no-stories` exit 2 when misused (`plugin/bin/context-gauge.js:106`, `:284`) | medium | fixed — `run()` now exits 2 with `--stories-owed is valid only with --next-steps` (`fdbff4cac1`) |
| convention | The new flag was missing from the header synopsis, the header flag prose, the exit-2 list and `USAGE`, so `--help` never showed it (`plugin/bin/context-gauge.js:9`, `:87`) | medium | fixed (`fdbff4cac1`) |
| convention | The context-gauge command reference at `docs/plugin-structure.md:321` omitted the flag and the refusal it causes | medium | fixed (`fdbff4cac1`) |
| test | The new suite `tests/bin-lib/timing/context-gauge-stories-order.test.js` re-declared about 40 lines of the neighbouring suite's fixture helpers in a reduced, divergent form | medium | fixed — its stories-after-test case moved into `context-gauge.test.js` and the file was deleted (`fdbff4cac1`) |
| test | The inserted test split the "top-level run never hands off wrap-up" comment from the test it describes (`context-gauge.test.js:485`) | low | fixed (`fdbff4cac1`) |
| test | Coverage gap: no case for `stories` listed with no `test` (e.g. `stories,review`), which must hand off (`plugin/bin/context-gauge.js:206`) | low | fixed — case added (`fdbff4cac1`) |
| error | Under `--record-steps` the `stories`-vs-`test` index check compared positions in the merged step union, not any one record's order (`plugin/bin/context-gauge.js:206`) | low | fixed — the combination is now refused (exit 2) (`fdbff4cac1`) |

Discrimination proof for the fixes: in a `git archive` extract of HEAD, a control run passed 72/72. Each mutation then made exactly one test fail:
- dropping the usage refusal failed the malformed-invocations test
- ignoring the order check failed the `--stories-owed` test
- requiring `test` to be present failed it too
- dropping the whole check failed it as well

Lens 3b (security) returned "No findings." from both agents.

### Tiebreak
**Verdicts:** 7 confirmed · 1 dropped · 0 digest · 0 console
- AUTO 15:29:43 — Reproduction: lens "3c" finding plugin/bin/context-gauge.js:206 confirmed by tiebreak:4bfca576bb9e. Confirmed. Reversibility: high. (info, Recommendation: drop — the refusal reason is wordy but names the flag, the fix and the fallback)
- AUTO 15:29:43 — Reproduction: lens "3f" finding tests/bin-lib/timing/context-gauge.test.js:486 confirmed by tiebreak:e56213877bec. Confirmed. Reversibility: high. (info, drop — confirms the test discriminates)
- AUTO 15:29:43 — Reproduction: lens "3f" finding tests/bin-lib/timing/context-gauge.test.js:304 confirmed by tiebreak:782095eda92a. Confirmed. Reversibility: high. (info, drop — the no-flag path is covered)
- AUTO 15:30:08 — Reproduction: lens "3a" finding plugin/bin/context-gauge.js:9 confirmed by tiebreak:54309c4d4ea5. Confirmed. Reversibility: high. (medium, file — fixed above)
- AUTO 15:30:08 — Reproduction: lens "3a" finding docs/plugin-structure.md:321 confirmed by tiebreak:fb21803f35c1. Confirmed. Reversibility: high. (medium, file — fixed above)
- AUTO 15:30:08 — Tiebreak tiebreak:780ed9e24607: lens "3a" finding tests/bin-lib/timing/context-gauge-stories-order.test.js:49 dropped: refuted by tiebreak. Evidence: tests/bin-lib/timing/context-gauge-stories-order.test.js:53 " assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'test,review,stories', '--stories-owed'], c.deps), 0, c.err.join(''));". Severity: low. Reversibility: high. (It was the only stories-after-test case, and the fold kept it.)
- AUTO 15:30:08 — Reproduction: lens "3f" finding tests/bin-lib/timing/context-gauge-stories-order.test.js:17 confirmed by tiebreak:f4e26390ed87. Confirmed. Reversibility: high. (low, file — fixed by the fold)
- AUTO 15:30:08 — Reproduction: lens "3f" finding tests/bin-lib/timing/context-gauge-stories-order.test.js:16 confirmed by tiebreak:6522ba7d5d5c. Confirmed. Reversibility: high. (low, drop — duplicate of tiebreak:f4e26390ed87)

Cross-lens corroboration (medium): the missing USAGE/header finding was reported independently by 3a and 3c (`plugin/bin/context-gauge.js:87`) and promoted to confirmed without a tiebreak.

### Fan-out leftovers
0 untracked files left by the review fan-out. 0 files left in `agent-scratch`, and no `disc-*` worktrees. 1 new local listener appeared after the pre-dispatch snapshot: `2.1.325:63477`. It is a Claude Code CLI process, probably a sibling session; it was not killed, and its owner was not identified. No finding rests on it.

### Implementation Hindsight
- Approach correctness: `--stories-owed` is declared by the caller. The gauge refuses a stories-dropping handoff only when the orchestrator passes the flag, and that orchestrator is the same prose follower that gauged too early in the reported run. The new instruction sits right on the gauge command line in `flow/SKILL.md` Step 4, which is more targeted than the old "after build's automatic stories" clause. But nothing in `context-gauge.js` detects the owed step itself. A mechanical guard would need either a run-dir marker that the automatic-stories step clears, or a gauge-side UI-diff probe (`bin/design-detect.js`, Layer 3) plus a "stories ran" signal. That is bigger than this record's scope. → **Defer** (`Defer-reason: genuinely-larger`). It was **not filed**: filing a record is outside what this review session was authorized to do. To file it, paste:
  `/claude-tweaks:capture "context-gauge: detect an owed automatic stories step from run state instead of relying on the caller passing --stories-owed (follow-up to #4664)"`
- Structural debt, missing consolidation, convention drift: nothing beyond what Step 3 fixed (the test fold, the flag-site sweep).
- Skill-worthy patterns: none filed. See Key Learnings 1.

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| Ship the caller-declared `--stories-owed` guard now and leave mechanical detection to a follow-up | It meets every acceptance criterion: AC1 explicitly allows "the gauge reports the omission so the caller can correct". The mechanical version needs new run-state signals beyond this record. |
| Keep the refusal reason's wording ("…or run stories first: continue in place") | The tiebreak judged it info / drop: it names the flag, the fix and the fallback. |

### Visual Review
- **Status:** Skipped — no UI changes
- Gate reason: no frontend surface (surface: backend) and no UI trigger file in the diff. Journeys whose `files:` overlap the diff: act-on-a-red-wall-clock-budget-scan-3491, adopt-a-run-directory-from-one-preflight-pack-1931, compose-a-per-run-context-bundle-1988, get-the-run-ledger-inside-the-worktree-3036, hand-a-phase-to-a-fresh-agent-at-the-context-cap-4027, notice-a-timing-budget-regression-from-the-scheduled-perf-run, pre-authorize-a-flow-runs-merge, recover-from-a-dispatch-config-deny-3225, resume-a-stalled-dispatched-build-4588, run-the-suite-alongside-sibling-sessions-3969, split-a-shared-lib-module-behind-a-facade-4010, stop-a-run-on-a-host-that-cannot-dispatch-subagents-4555

### Design Quality (from /claude-tweaks:design-wrapper review)
Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- The `--stories-owed` one-line condition in `measure()` became a named `keepsOwedStories` helper plus a `STORIES_OWED_REASON` constant beside the sibling `*_REASON` constants. Behavior and message are unchanged (`plugin/bin/context-gauge.js`, -1/+11, `4f8efd727d`). The diff was audited against the change scope, and the run re-verified green.

### Skill Load Delta
Skill load delta (base 15af9f6 = merge-base with origin/main):

| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |
|---|---|---|---|---|---|
| 40 entries: plugin:accept, plugin:activity, plugin:assess-agent-autonomy, … +37 more | 1,944–52,110 | 0 | 7,448,874–7,489,476 | +294 | — |
| plugin:flow | 52,352 | +294 | 7,448,874 | +294 | — |

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | `--stories-owed` refused outside `--next-steps` (exit 2), so it never runs silently ignored and never applies to a `--record-steps` union — `plugin/bin/context-gauge.js` | `fdbff4cac1` |
| Bug fix | Flag documented in the header synopsis, flag prose, exit-2 list and `USAGE` — `plugin/bin/context-gauge.js` | `fdbff4cac1` |
| Bug fix | Flag and its refusal added to the context-gauge command reference — `docs/plugin-structure.md` | `fdbff4cac1` |
| Bug fix | Duplicate fixture suite folded into the gauge suite and deleted; orphaned comment re-attached; `stories,review` and two exit-2 cases added — `tests/bin-lib/timing/context-gauge.test.js`, `tests/bin-lib/timing/context-gauge-stories-order.test.js` (deleted) | `fdbff4cac1` |
| Simplified | `keepsOwedStories` helper + `STORIES_OWED_REASON` constant — `plugin/bin/context-gauge.js` | `4f8efd727d` |

Both commits were pushed to `drive-record-4664`. PR #6201 is still a draft and was not merged, closed or marked ready. No PR verdict comment was posted: this standalone review had no `run-state.json` `pr` object. No phase-exit call was made, because there was no run directory.

Footer: Security Hardening (6.6), Agent Trust Scope (6.65) and App Store Readiness (6.66) were all skipped at pre-check: no client/route files, neither `.claude/settings.json` nor `.claude-tweaks/policy.yml`, and no mobile-app files in the diff. Lens 3i: `README.md` matches through `plugin/skills/**/SKILL.md` but holds no context-gauge or handoff text, so it is not stale; `docs/plugin-structure.md` was updated by the fix wave. No 3i-diagram signals. 3g-cov skipped (no stories).

### Key Learnings
1. A flag added to a `plugin/bin` CLI belongs at every site its sibling flags occupy: header synopsis, flag prose, the exit-2 list, `USAGE`, the flag-combination refusal in `run()`, and the CLI's line in `docs/plugin-structure.md`. The driver's build landed it only in `parseArgs` and `measure`, and three lens agents independently caught the gap. That makes it a recurring class worth a checklist in a bin-CLI skill.
2. The driver build added a sibling test file that copied the neighbouring suite's fixtures instead of extending that suite. Copies like this drift (this one had already dropped options the originals take). Folding the case back in also exposed a missing `stories,review` case.
3. A flag the caller has to remember to pass closes a prose-ordering gap only as far as the caller follows prose. When the failure being fixed was a caller skipping prose, prefer a guard that reads run state the caller cannot forget to declare. That is the deferred follow-up here.

### Next Actions
**`/claude-tweaks:wrap-up 4664`** — capture learnings and clean up (recommended)
