## Review: #4472 — Subagent Scratch rule never forbids deleting outside the scratch path (draft PR #6193)

**Review effort:** medium (derived from label low, diff heuristic medium (risk:low × size:low; the diff touches a shared `_shared/` contract read by many skills → risk proxy medium; 4 files → size proxy medium))

Mode: code (standalone, no `$PIPELINE_RUN_DIR`). Scope: `origin/main` (16b5137a47)..HEAD. Reviewed head 9f3e98ae44; final head after review fixes 7dff4ed8bb. No merge commits, no cherry-pick provenance, no parent record (Step 1.6 skipped).

### Spec Compliance

At review start, Step 1 found one coherent gap. The build covered only the two Key Files templates. The PR body says it skipped `step3-tiebreak.md` (2 SCRATCH: lines), `step3-workflow-dispatch.md` (1) and `console-backfill.md` because they were outside the record's Key Files. The test pinned only a hand-picked two-file list. I classed this as a **minor gap**: one underlying omission behind D2, D3 and AC2, with three one-sentence edits and a test widening to close it. I proceeded rather than BLOCK, and the review closed the gap (commit 2193994a55). The table below shows status after the review fixes.

| Deliverable | Status |
|-------------|--------|
| Scratch rule in `_shared/subagent-output-contract.md` states the never-delete scope | done (a99331c20d) |
| Every dispatch template that grants a scratch path carries the one-line prohibition | done. Lens-dispatch and debate/gap-sweep at a99331c20d; tiebreak single-finding and chunk templates and the workflow-dispatch brief at 2193994a55. `tidy/console-backfill.md:113` inlines the tiebreak single-finding template verbatim, so it inherits the line. |
| Conformance test pins the prohibition in the contract and every SCRATCH: template | done. The test now sweeps every SCRATCH: template line under `plugin/skills` with a floor of 5 sites, per-file reach checks and go-red controls (2193994a55). |

| Acceptance Criterion | Status |
|---------------------|--------|
| The Scratch rule names the never-delete scope | met |
| Every `SCRATCH:` dispatch line in plugin/skills carries the prohibition, and a conformance test fails when one is missing | met. I proved it by reverting each fix in an archive extract: tiebreak reverted → `fail 1 … review/step3-tiebreak.md:69, review/step3-tiebreak.md:105`; workflow reverted → `fail 1 … review/step3-workflow-dispatch.md:17`. |
| `npm test` passes | met. PR CI run 45408981362 on head 7dff4ed8bb succeeded with 36459 tests, 36433 pass, 0 fail. |

Risk markers: none (no Gotchas, ambiguity markers or Open Questions). Current-State outcome: reached, because the lens, refutation, gap-sweep and tiebreak dispatch lines all carry the prohibition. PR-body deliverables: none.

### Verification (from /test)
- Type check: n/a (none configured)
- Lint: n/a (none configured)
- Tests: pass. At review start the stamp verified HEAD 9f3e98ae44 (scoped, `verifiedHead: true`) and PR CI was green. After the fix waves, `verify.js --scope` took the result from PR CI: run 45408229596 on 2193994a55 and run 45408981362 on 7dff4ed8bb, both successful, 0 failures. I checked each run's `headSha` with `gh run view`. The final stamp reads sha 7dff4ed8bb, scope scoped, `verifiedHead: true`, `dirty: false`.

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| convention / test | `step3-tiebreak.md:69` and `:105`: the tiebreak single-finding and chunk SCRATCH: templates had no never-delete sentence. Tiebreak runs at every tier, and `tidy/console-backfill.md:113` inlines the first template. Reproduced by 3a and 3f at high, and by 3b at medium (severity contested, lower kept). | high | fixed (2193994a55) |
| security / test | `step3-workflow-dispatch.md:17`: the workflow brief's SCRATCH: line (mktemp under the shared `agent-scratch/` parent) had no prohibition. Pairs 3b and 3f reproduced it; 3a's single report was tiebreak-confirmed. | medium | fixed (2193994a55, reworded in 7dff4ed8bb) |
| test | `tests/scratch-never-delete-conformance.test.js:14`: the test pinned a hand-picked two-file list, so unlisted SCRATCH: lines could lack the prohibition while it stayed green. 3b's pair reproduced this at low; cross-lens corroboration by 3a and 3f confirmed it at medium; the tiebreak confirmed 3f's coverage-anchored copy at medium. | medium | fixed: whole-tree sweep (2193994a55) |
| security | `tidy/console-backfill.md:113`: backfill agents get the tiebreak template's SCRATCH: line, which had no prohibition. Tiebreak-confirmed. | low | fixed transitively by the tiebreak template fix (2193994a55) |
| test | `tests/scratch-never-delete-conformance.test.js:11`: the pins had no go-red control. Tiebreak-confirmed. | low | fixed: frozen pre-change lines in all three template shapes go red, plus negative controls (2193994a55) |
| test | `tests/scratch-never-delete-conformance.test.js:15`: the test name overclaimed, because step3-lens-dispatch.md's match is orchestrator prose, not a SCRATCH: line. Tiebreak confirmed it at info with a drop recommendation. | info | resolved by the rewrite: renamed to "lens dispatch tells each lens agent the never-delete prohibition beside its SCRATCH: line" |

Lenses dispatched (medium tier, Task path, reproduction pairs): 3a Convention (haiku ×2), 3b Security (sonnet ×2), 3f Test Quality (haiku ×2). I skipped 3c because the diff has no executable error paths (prose plus a conformance test). 3g-cov was skipped (no stories). Interactive routing: a standalone review recommends "Fix now" for every finding. I applied all of them under the trial instruction to commit and push only fixes the review itself applies, and asked no question.

### Tiebreak

**Verdicts:** 5 confirmed · 0 dropped · 0 digest · 0 console
- AUTO 14:52:26 — Reproduction: lens "3b" finding plugin/skills/tidy/console-backfill.md:113 confirmed by tiebreak:c3a4262a7bbd. Confirmed. Reversibility: high.
- AUTO 14:52:26 — Reproduction: lens "3a" finding plugin/skills/review/step3-workflow-dispatch.md:17 confirmed by tiebreak:559bd82157f4. Confirmed. Reversibility: high.
- AUTO 14:52:26 — Reproduction: lens "3a" finding tests/scratch-never-delete-conformance.test.js:11 confirmed by tiebreak:68237ed00abf. Confirmed. Reversibility: high.
- AUTO 14:52:26 — Reproduction: lens "3a" finding tests/scratch-never-delete-conformance.test.js:15 confirmed by tiebreak:87b32e95d44c. Confirmed. Reversibility: high.
- AUTO 14:52:26 — Reproduction: lens "3f" finding plugin/skills/review/step3-tiebreak.md:69 confirmed by tiebreak:4f34a91cd74a. Confirmed. Reversibility: high.

One capable-tier chunk agent (opus) judged all five. Verdicts were settled by `resolve-tiebreak --root` against an archive extract of the reviewed head 9f3e98ae44, because the fix wave had already rewritten the test file. No can't-tell findings. Transcription note: the reply file I fed the resolver carries the agent's Verdict, Evidence and Severity lines verbatim, but its Recommendation prose is a close paraphrase; the resolver does not read that prose.

### Fan-out leftovers
0 untracked files; no files left under `agent-scratch/`. 4 new local listeners appeared since the pre-dispatch snapshot. I reported them and did not kill them; ownership is unattributed: `2.1.325:62927`, `2.1.325:62932` (Claude Code CLI version-named processes, likely sibling sessions), `node:20154`, `rapportd:62246`/`rapportd:62247` (macOS). None is a server a lens agent started; read-only lenses ran no servers.

### Implementation Hindsight
- **Convention drift.** The workflow-dispatch brief's new sentence says "outside that exact SCRATCH: path", but that line called the mktemp-printed directory only "your scratch path". The tiebreak judge noticed it. → change now: fixed in 7dff4ed8bb ("use the path it prints as your SCRATCH: path").
- **Approach correctness.** The fix is prose-only. Nothing mechanical stops a dispatched agent from deleting outside its SCRATCH: path: `plugin/bin/lib/hooks/pre-tool-use.js` has no recursive-delete guard for the session scratchpad or temp root, and the post-fan-out `agent-scratch` check detects leftovers, never over-deletion. → capture: a PreToolUse guard refusing a recursive delete whose target is the session scratchpad, the temp root or an ancestor of the dispatch's SCRATCH: path. `deferral-route.js --defer-reason tangential --size medium --priority medium --risk medium --agent-raised` returned `{"verdict":"digest","rule":"policy-reason"}`. **The digest entry was not written.** This trial run is limited to review-applied fixes, so it awaits a human decision.
- **Convention.** Build commit 9f3e98ae44's subject repeats a token (`— refs — refs #4472`). → accept as-is: cosmetic, the commit is already pushed (no history rewrite), and squash-merge composes its own subject.
- Structural debt and consolidation: none. The sentence repeats across the contract and five templates because dispatched agents cannot read sibling files, so each prompt template must carry it verbatim. The new sweep keeps those copies in step. The test reuses `tests/helpers/option-description.js`'s `listMarkdownFiles` (Node 20-safe) and `read-skill.js`'s `readText`.
- No ledger (standalone, no run dir).

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| Proceeded past Step 1 with a known spec gap instead of returning BLOCKED to `/build` | The gap was one coherent omission (3 one-sentence template edits plus widening the test), and the trial instruction permits review-applied fixes. It was closed and verified inside the review, and all criteria are now met. |
| Step 5 simplification scoped to the test file only | The five markdown files are prose prompt templates with one-sentence insertions. Whole-file simplification of 100+ KB of untouched prose would edit code this branch never wrote. |
| Guard-hook capture left unwritten (digest verdict) | The trial rules restrict this run's side effects to review-applied fixes. It is surfaced here for a human to file. |

### Visual Review
- **Status:** Skipped — no UI changes
- Skill-load gate: "no frontend surface (no surface declared) and no UI trigger file in the diff". Journeys whose `files:` overlap the diff: compose-a-per-run-context-bundle-1988, confirm-a-finding-beside-a-second-issue-on-one-line-2907, confirm-coverage-findings-across-reproduction-pairs-3049, confirm-findings-split-across-a-multi-line-statement-2955, confirm-paraphrased-findings-across-reproduction-pairs-3418, count-skill-file-reads-per-file-4359, drop-a-refuted-code-is-missing-claim-3329, get-a-verdict-on-every-unverified-review-finding-3947, keep-a-second-reader-in-a-dispatched-review-3078, keep-review-lenses-from-running-suites-3001, keep-untrusted-text-off-a-command-line-4595, log-reproduction-lines-through-the-pairing-command-5595, measure-composed-bytes-per-call-site-1990, prove-a-test-discriminates-in-a-scratch-checkout-4556, read-a-size-capped-review-lens-bundle-3020, run-a-review-from-a-worktree-isolated-session-2956, run-review-lenses-through-a-workflow-5599, select-review-lenses-from-diff-facts-and-lens-yield-6001, settle-every-review-finding-at-the-console-3949, state-every-failure-branch-of-a-fail-closed-guard-3965, stop-a-run-on-a-host-that-cannot-dispatch-subagents-4555, trust-a-defect-several-review-lenses-flagged-3604.

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- No simplifications needed. The `code-simplifier` subagent ran on `tests/scratch-never-delete-conformance.test.js` and reported `No simplifications needed.` / `STATUS: DONE`; the working tree stayed clean.

### Documentation Freshness (3i, informational)
| # | Finding | Severity | Category | Affected | Recommended |
|---|---------|----------|----------|----------|-------------|
| 1 | Doc `docs/reference/workflow-tool-probe.md` covers changed areas (`plugin/skills/review/step3-workflow-dispatch.md`) but wasn't updated | Low | Docs | docs/reference/workflow-tool-probe.md | Review in wrap-up (likely no update needed: the edit adds a sentence to a brief and doesn't change Workflow-tool behavior) |

### Skill Load Delta
Skill load delta (base 16b5137 = merge-base with origin/main):

| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |
|---|---|---|---|---|---|
| 41 entries: plugin:accept, plugin:activity, plugin:assess-agent-autonomy, … +38 more | 1,944–52,110 | 0 | 7,449,461–7,490,063 | +881 | — |

### Manual Steps Required
No manual steps: nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed

| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Added the never-delete prohibition to both tiebreak SCRATCH: templates (`plugin/skills/review/step3-tiebreak.md`); console-backfill inherits it | `2193994a55` |
| Bug fix | Added the never-delete prohibition to the workflow-dispatch SCRATCH: brief (`plugin/skills/review/step3-workflow-dispatch.md`) | `2193994a55` |
| Bug fix | Rewrote `tests/scratch-never-delete-conformance.test.js` as a whole-tree SCRATCH: template sweep (site floor, per-file reach, go-red controls); proved red by revert | `2193994a55` |
| Bug fix | Hindsight change-now: named the mktemp-printed directory as the workflow brief's SCRATCH: path (`plugin/skills/review/step3-workflow-dispatch.md`) | `7dff4ed8bb` |
| Push | Pushed both commits to `drive-record-4472` (draft PR #6193 left draft and open; not merged, closed or marked ready) | `7dff4ed8bb` |

Footer: Security Hardening, Agent Trust Scope and App Store Readiness passes were skipped by their pre-checks (no client/route files, neither config file, no mobile-app files in scope). No PR verdict comment was posted and no phase-exit ran (standalone review, no run dir or `pr` object).

### Key Learnings
1. **A Key Files list read as an allowlist can leave an "every X" deliverable knowingly unmet.** The build agent saw that 3 SCRATCH: templates fell outside the record's Key Files, wrote that in the PR body, and shipped a test pinning only the listed files. Nothing in the driver flagged the unmet criterion before review. Why it matters for the #6021 driver trial: a record whose deliverable says "every …" needs its Key Files built from the grep that enumerates the sites, or the driver needs to treat a self-reported unmet AC as a stop, not a note.
2. **A "fails when one is missing" criterion needs a corpus sweep with a site floor, not a file list.** The two-file pin was green while three templates lacked the rule. A sweep over the template-line shape with a floor and frozen pre-change go-red lines is what actually satisfied the AC, as the revert proof shows.
3. **Prose prohibitions on destructive cleanup have no mechanical backstop here.** The review's own lens and tiebreak agents ran under the new sentence and left no scratch behind. Still, the original incident class (`rm -rf` on a shared parent) stays unenforced until a PreToolUse guard exists. That guard is captured above and not yet filed.

### Next Actions

**`/claude-tweaks:wrap-up 4472`** — capture learnings and clean up (recommended)
