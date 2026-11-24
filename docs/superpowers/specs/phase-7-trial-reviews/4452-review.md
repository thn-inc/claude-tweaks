## Review: #4452 — Pipeline shadow guard misses a cp into an existing pipelines dir (draft PR #6189, branch drive-record-4452)

**Review effort:** medium (derived from record labels: risk:medium × size:medium; diff heuristic agrees: 4 files, 45 lines, hook-gate code → medium)

Mode: code (standalone, no `$PIPELINE_RUN_DIR`). Scope: `origin/main...HEAD`, merge-base `4e7336a46c`. The review started at HEAD `b173e6adc4`, and its own fixes moved it to `95f4a230d2`. Merge-provenance check found no merge commits. Cherry-pick check found no `cherry picked from` trailers and no duplicate open PR.

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| 1. Treat a `cp`, `mv` or `install` whose destination is an existing pipelines dir as creating an entry under it | done (`pre-tool-use.js` `shadowPipelineRunDir` `entryInto` branch + `checkPipelineShadowGuard` into-dir set; review widened it to `ln`) |
| 2. Pin the shape | done (`tests/hooks-pipeline-shadow-guard.test.js` `#4452` deny test; review added the literal relative OScpNoLost destination, `cp -t` and `ln -s` cases) |

| Acceptance Criterion | Status |
|---------------------|--------|
| The OScpNoLost shape denies through `pre.run` | met. The deny test calls `pre.run`. The build pinned only an absolute-destination variant, so the review added the record's literal relative form (`cd ./x/../.claude-tweaks \|\| cp a <relative wt pipelines>`, run from the main checkout), commit `95f4a230d2`. |
| No new deny appears against #4303's head over its 1176-command corpus | unverifiable. The corpus is not in the repository: `git grep` finds no 1176-command corpus, and the #4303 run dir is gone. The build's PR summary says it "didn't run the 1176-command corpus". The partial evidence: the impact-selected suite (225 files, 9185 pass, 0 fail) and the scoped runner (0 fail) were both run after the fixes, and they include `hooks-gate-coverage`'s parser corpus. |
| The rule has a red-turning mutant | met. The build did not check it, so the review ran it in a scratch checkout: with `pre-tool-use.js` reverted to base, the `#4452` deny test failed (`ℹ tests 2 / pass 1 / fail 1`, `✖ #4452: a cp / mv / install into an EXISTING pipelines dir … is denied`). For the review's own `link` addition, removing `'link'` turned the test red with `ln -s a '…/wt/.claude-tweaks/pipelines': expected a deny, but got: {}`. |
| `tests/hooks-pipeline-shadow-guard.test.js` passes | met (36/36 at HEAD `95f4a230d2`) |

Non-Goals: none stated. Risk markers: none (no Gotchas, no ambiguity markers, no Open Questions). Current-State outcome: reached, because the named OScpNoLost shape now denies. Gate: minor gap (1 unverifiable criterion), proceed.

### Verification (from /test)
- Type check: n/a (no typecheck command configured)
- Lint: n/a (no lint command configured)
- Tests: pass. The entry stamp was `verifiedHead: true` (scoped on a valid `fullSha`), and PR CI was green (4 shards + test). After the review's fixes:
  - `npm test` (impact-selected): 225 of 1420 files, 9185 pass, 0 fail.
  - `verify.js --scope .claude-tweaks/verify-scope.json`: pass, stamp `95f4a230d2`, `verifiedHead: true`.

### QA Validation (from /test)
- **Status:** Skipped — no stories (no `stories/` directory)

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| security | `ln -s a <existing linked-worktree pipelines dir>` (and `ln -t DIR`) creates an entry under the pipelines dir without a deny. The parser reports `ln` as action `link` (`git-command.js:3882/3886`), and the into-dir set at `pre-tool-use.js:785` covered only copy/move/install (3b, both agents; tiebreak confirmed). | low | fixed — `link` added to the into-dir set, `ln -s` case pinned, mutant proved red (`745288ab19`) |
| test | The `install -d` case lived in a new one-test file (`tests/hooks-pipeline-shadow-guard-install-d-4452.test.js`) that duplicated the suite's imports and `bashInput`, though the existing suite already holds the #4452 cases and is the record's Key File (3a pair confirmed; 3f both agents, tiebreak confirmed). | low | fixed — moved into `tests/hooks-pipeline-shadow-guard.test.js`, file deleted (`745288ab19`) |
| test | The four-shape deny loop gave `assertDenied` no per-command label, so a failure didn't say which shape broke (3f pair confirmed). | low | fixed — `assertDenied(out, label)` now prefixes the command (`745288ab19`) |
| test | No shadow-guard test uses the `-t`/`--target-directory` form, which reaches the into-dir set through `explicitTargetDir` (3f, tiebreak confirmed; parser-level `-t` tests exist). | low | fixed — `cp -t <pipelines> a` added to the loop (`745288ab19`) |
| convention | Branch commit subjects break the `{Verb} {what} — {detail}` style: `fix:` prefix, and `b173e6adc4` repeats the token as `— refs — refs #4452` (3a pair confirmed). | low | accepted — not fixed. These are pushed draft-PR commits: rewriting them needs a force-push, which this review was not authorized to do, and the squash merge composes its own subject (`compose-subject.js`). The doubled token comes from the driver (Key Learnings 1). |
| test | The `install -d` regression test is green at base `4e7336a`, so it guards only the follow-up `install-d` reclassification (`git-command.js:3870`), not the first fix (3f pair confirmed). | info | accepted — intended: it is the regression guard for commit `b173e6adc4`; the cp/mv/install/ln deny test discriminates the first fix |
| convention | The new `install-d` action value has no other consumer; the only reader (`pre-tool-use.js:785`) checks copy/move/install/link (3a; tiebreak confirmed). | info | accepted — confirms the rename is safe; no change needed |
| security | Copying a `pipelines`-named source dir into a worktree's `.claude-tweaks` (`cp -r pipelines <wt>/.claude-tweaks`) creates the pipelines dir itself and is allowed (3b; tiebreak confirmed). | info | not fixed — beyond the record's literal-destination shape, and the original guard didn't cover it either. Recommended route: materiality digest (`pre-existing-outside-diff` shape). Not written: this standalone run had no human approval for a digest write. |

> This table lists `confirmed` findings: those both agents in a lens's reproduction pair reported, or that Step 3.7's tiebreak confirmed. Cross-lens corroboration (medium tier) promoted nothing.

### Tiebreak
**Verdicts:** 7 confirmed · 4 dropped · 5 digest · 0 console

The confirmed verdicts are the ones in the table above. The dropped and digested verdicts:
- `plugin/bin/lib/hooks/pre-tool-use.js:755` — the equality check reimplements `isPathContained`'s `orEqual` (3a) (low) — dropped: refuted by tiebreak. `orEqual` means contained-or-equal, not equal-only, so `===` on canonical paths is correct.
- `plugin/bin/lib/hooks/pre-tool-use.js:755` — no negative control for a copy into a pipelines subdirectory (3f) (low) — dropped: refuted. Widening to containment would turn the existing `cp source.md <wt>/…/pipelines/2026-…/decisions.md` deny test red.
- `plugin/bin/lib/hooks/pre-tool-use.js:755` — the `real === pipelinesDir` equality is unguarded, mutant `if (entryInto)` survives (3f) (medium) — dropped: refuted. The mutant returns null for a not-yet-existing destination, so the same existing deny test goes red.
- `plugin/bin/lib/hooks/git-command.js:3795` — a regression dropping `explicitTargetDir` for cp/mv stays green (3f) (low) — dropped: refuted. Parser tests `tests/hooks-git-command.test.js:338-344` and `tests/hooks-gate-coverage.test.js:520` cover it.
- `git-log/b173e6adc4:1` — duplicated `— refs — refs #4452` (3a) (low) — digest: evidence-unverified (a commit message is not a file the resolver can read). The reviewer checked it directly: `git log -1 --format=%s b173e6adc4` prints the doubled token. The pair-confirmed row above covers it.
- `git-log/8a6aa0f9fe:2` — no `Claude-Session:` trailer on the build's commits (3a) (low) — digest: evidence-unverified. The tiebreak recommends drop, since the attribution reminder doesn't bind the build session.
- `tests/hooks-pipeline-shadow-guard.test.js:193` — the record's literal relative OScpNoLost shape isn't pinned (3b) (low) — digest: verdict:cant-tell. The cited line was wrong (the case is at line ~46). The reviewer fixed the gap anyway: relative-destination case added in `95f4a230d2`.
- `tests/hooks-pipeline-shadow-guard.test.js:52` — the main-checkout allow control doesn't discriminate the new branch (3f) (info) — digest: evidence-path-mismatch. Recommendation: drop; it is a valid control.
- `tests/hooks-pipeline-shadow-guard.test.js:41` — the four denials come from the shadow guard, not a sibling gate (3f) (info) — digest: evidence-unverified. Recommendation: drop; this is a positive observation.

No can't-tell finding at medium or higher.

### Fan-out leftovers
None. The post-fan-out sweep found no untracked file outside the review's own scratch, `agent-scratch/` was empty, there were no new listeners, and both scratch checkouts (`disc-review-main`) were removed (`git worktree list` shows none).

### Implementation Hindsight
- The gate keys "into-directory destination" semantics on the parser's action names (`['copy', 'move', 'install', 'link']` at `pre-tool-use.js:785`), but the parser owns that knowledge. This review had to add `link` by hand, and the build had to invent the `install-d` action purely to opt `install -d` out. Moving it to an `into: true` flag on parser targets would change the `{action, file}` shape that ~277 `deepStrictEqual` assertions in `tests/hooks-gate-coverage.test.js`/`tests/hooks-git-command.test.js` pin.
  - Evidence: this review's 3b `ln` finding; `git-command.js:3870`.
  - Cost this session: one extra fix wave.
  - Disposition: Defer (`genuinely-larger`). `deferral-route.js` returned `{"verdict":"digest","rule":"no-evidence"}`. The digest entry is not written: it waits for human approval, and this standalone run had none.

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| Branch commit subjects keep the driver's `fix:` prefix and doubled `— refs` | Rewriting pushed draft-PR history needs a force-push, which wasn't authorized. The squash merge's subject is composed at merge time (`compose-subject.js`), so the branch subjects never land on `main`. |
| The 1176-command #4303 corpus criterion stays unverified | The corpus artifact no longer exists in the repo or in a run dir. Re-creating it is outside a review. The impact-selected suite and the gate-coverage parser corpus were the closest available evidence, and both pass. |
| Findings were routed with the recommended "Fix now" / "Accept" defaults, with no interactive batch question | Standalone review, but the invocation was an unattended driver-trial run, and the operator asked for the summary written to a file and then a stop. Every applied fix is low severity and in this PR's own files. |

### Visual Review
- **Status:** Skipped — no UI changes
- Skill-load gate reason: "no frontend surface (no surface declared) and no UI trigger file in the diff". Journeys whose `files:` overlap the diff: delete-a-remote-branch-with-git-dash-c-3900, dispatch-a-group-with-rendered-task-prompts-4589, exit-a-phase-in-one-call-4026, follow-a-review-console-ask-deny-3712, get-a-disguised-main-checkout-write-denied-4303, keep-sibling-sessions-processes-alive-through-a-dispatched-build-4548, keep-the-shared-stash-through-a-dispatched-build-4559, recover-from-a-bookkeeping-stamp-deny, recover-from-a-dispatch-config-deny-3225, resolve-the-integration-model-on-a-slow-gh-host-4578, review-project-policy, run-a-heredoc-node-script-from-the-main-checkout-3989, run-integrity-lifecycle, run-shell-loops-without-a-hook-storm-3074, see-an-ad-hoc-sessions-friction-at-wrap-up-2783, write-a-glued-redirect-from-the-main-checkout-4015, write-a-quoted-windows-path-from-a-session-4281

### Design Quality (from /claude-tweaks:design-wrapper review)
Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- No simplifications needed. The `code-simplifier` subagent ran on the changed hunks of the three files, and `git status` confirmed it made no edits.

### Skill Load Delta
Skill load delta: no skill files changed — skipped

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Shadow guard into-dir set gains `link`, so `ln -s a <existing wt pipelines dir>` is denied — `plugin/bin/lib/hooks/pre-tool-use.js` | `745288ab19` |
| Bug fix | The `#4452` deny loop adds `cp -t` and `ln -s` cases and labels each command via `assertDenied(out, label)` — `tests/hooks-pipeline-shadow-guard.test.js` | `745288ab19` |
| Bug fix | `install -d` test folded into the suite; `tests/hooks-pipeline-shadow-guard-install-d-4452.test.js` deleted | `745288ab19` |
| Bug fix | The record's literal relative OScpNoLost destination pinned — `tests/hooks-pipeline-shadow-guard.test.js` | `95f4a230d2` |

Both commits were pushed to `origin/drive-record-4452`; `git ls-remote` matches HEAD `95f4a230d2`. The PR was not merged, closed or marked ready.

Footer: Security Hardening, Agent Trust Scope and App Store Readiness passes were skipped by their pre-checks (no client/route, config or mobile files in scope). Step 6.7: no late findings. 3g-cov: skipped (no `stories/`). 3i: the `docs/REGISTRY.md` auto-detect matches `docs/hooks.md` and `docs/donts.md` for `plugin/bin/lib/hooks/**`; neither enumerates the shadow guard's command shapes, so no freshness finding. Materiality digest: 0 entries written this run (2 recommended, pending human approval: the hindsight action-whitelist item and the `cp -r` pipelines-named-source item).

### Key Learnings
1. The pipeline driver's commit composer doubles the ref suffix. `plugin/bin/lib/driver/steps.js:1074` writes `${title} — refs #${record}`, and the worker's title already ends in `— refs`, apparently its own `refs #N` with the number stripped by `normalizeTitle`/`neutralize`. Six driver commits carry `— refs — refs #N` (#4664, #4472, #4460, #4452, #4365, #4108) — a #6021 driver-trial defect worth its own record.
2. A gate that keys behavior on the parser's action-name vocabulary drifts whenever a write verb is added or re-tagged. The build missed `ln`, and it had to invent `install-d` as an opt-out. Have the parser classify the destination's semantics itself.
3. An acceptance criterion that cites an external artifact (the #4303 "1176-command corpus") is unverifiable at review once that artifact's run dir is gone. Criteria should name a committed fixture or a reproducible command. The build disclosed it skipped this one and the mutant check, so the review could run the mutant, but no one could run the corpus.

### Next Actions
**`/claude-tweaks:wrap-up 4452`** — capture learnings and clean up (recommended)
