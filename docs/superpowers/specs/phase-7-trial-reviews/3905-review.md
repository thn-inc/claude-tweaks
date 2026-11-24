## Review: #3905 — github-pr-scan item 4 wrongly treats the closed and merged PR lists as mutually exclusive (PR #6214, branch drive-record-3905)

**Review effort:** low (derived from record labels: risk:low × size:low; diff heuristic agrees — 1 file / 2 lines at review start, prose only, no merge-sensitive path)

Standalone review (no `$PIPELINE_RUN_DIR`), code mode. Every step ran (the `ceremony:fast-lane` label does not skip steps in a standalone review). Merge-provenance check: no merge commits in `origin/main..HEAD`. Cherry-pick provenance check: no `cherry picked from` trailers, and no other open PR for #3905.

**Context the build missed, then found:** Deliverables 1–2's core text (the wrong "mutually exclusive" note → "`--state closed` also returns merged PRs", plus the by-`number` de-duplication) was already on `main` from #4819 (`3999088908`, 2026-11-03), before this build ran. The build's own diff (`88aa28611a`, `220b134102`) only added a sentence saying the closed window is shared with merged PRs, so the "second, unstated cost" named in the record's Current State was documented but not fixed.

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| 1. Correct item 4's parenthetical: `--state closed` includes merged PRs | done (on main via #4819; kept on this branch) |
| 2. Make the overlap handling explicit: dedupe by number, or select closed-without-merge PRs directly; record which and why | done. Both now hold: the closed query excludes merged PRs by query shape (`--search is:unmerged`, review commit `91fff3b8d6`), and the by-`number` de-duplication stays as a guard. Rationale is in the item-4 prose and in `91fff3b8d6`'s commit message. |
| 3. If the window behaviour changes, keep closed-without-merge coverage at least as wide as today | done. It is now much wider: 3 of 50 rows before, 50 of 50 after (live probe, below). |

| Acceptance Criterion | Status |
|---------------------|--------|
| Item 4 no longer claims the states are mutually exclusive, and says the closed filter includes merged PRs | met (`tests/github-pr-scan-closed-merged-overlap.test.js` (a) and (b)) |
| Item 4 states how a PR present in both result sets is handled | met: excluded by query shape, with de-duplication by `number` kept as a guard (test (c) pins the de-duplication) |
| If the query shape changes, the closed query returns only non-merged closed PRs, verified by running the documented command against this repo and quoting its count in the PR | partially met. The documented command `gh pr list --state closed --search is:unmerged --limit 50 --json number,headRefName` was run against thn-inc/claude-tweaks: 50 rows, all `mergedAt == null`, state `CLOSED`, every row with a string `headRefName`. Without `--search`, the same query returned 50 rows of which only 3 were unmerged. The counts are quoted in commit `91fff3b8d6`'s message, which is in the PR, but **not in the PR body**. The PR body's driver-written "Spec summary" is now also stale: it says both queries were kept unchanged and "the window problem itself is not fixed". |
| Conformance tests that pin item 4 pass, and `npm test` passes | met. Local: the 3 item-4/rail suites pass 70/70, and impact-selected `npm test` gives 5691 pass, 0 fail, 1 skipped (163 of 1431 files). CI on `91fff3b8d6`: tests 36,538 pass, 0 fail; journeys 238/238 (run 45445716895, all 4 shards plus `test` green). |

Current-State outcome reach: **reached** (after the review fix). The record's named outcome was abandoned-PR stale branches being "pushed out of view" by merged PRs filling the closed window. At review start the diff only described that problem; after `91fff3b8d6` the closed window holds only closed-unmerged PRs. Before the fix the record's Release Note ("finds stale branches from abandoned PRs more reliably") would have been false; it is now true.

Risk markers: no unvalidated Gotchas, `<!-- ambiguity -->` markers or Open Questions. Gotcha "keep the MCP degrade note accurate": verified. Item 4 is still a `gh pr list` (PR-backed) call, so the Transport section's per-item degrade rule still applies unchanged. Gotcha "byte-pinned prose, run the full suite": verified (CI full suite green; `tests/bin-lib/skill-audit/context-cost.test.js`'s composed-bundle Read rail passes, and the new item-4 sentence is shorter than the one it replaces).

### Verification (from /test)
- Type check: n/a (no typed sources)
- Lint: pass (CI)
- Tests: pass. At review start the stamp read `verifiedHead: true` on `220b134102` (scoped). After the review fix it reads `verifiedHead: true` on `91fff3b8d6`, source CI (tests 36,538 pass / 0 fail; journeys 238 pass / 0 fail).

### QA Validation (from /test)
- **Status:** Skipped — no stories (no `stories/` directory). No open-items ledger was found for this record, so QA entries could not be merged into the findings table below (standalone review, no run dir, so nothing was logged to a `decisions.md`).

### Code Review Findings (confirmed)
No findings — code is clean.

Step 3 lens dispatch: `SKIP — Step 3 lenses 3b, 3c (skipped): diff ships no executable content (1 prose file) → acceptance criteria checked directly.` At review start the only change was one prose sentence in item 4, outside any fenced block, with no command. (The review's own later fix did change a fenced command; that change was checked directly by the live probe, the pinning suites and CI above.) 3g-cov: skipped (no `stories/`). 3i: no finding (`docs/REGISTRY.md` maps `_shared/*.md` only to CLAUDE.md, which does not describe item 4). No lens agents were dispatched, so the post-fan-out sweep has nothing to compare.

### Fan-out leftovers
None.

### Implementation Hindsight
- **Approach correctness: the build documented the window cost instead of fixing it** → **change now (applied, `91fff3b8d6`)**. Evidence: live probe on 2026-11-24: `gh pr list --state closed --limit 50 --json number,mergedAt` gave 50 rows, 3 unmerged; `gh pr list --state closed --search is:unmerged --limit 50 …` gave 50 rows, 50 unmerged. The build's PR body gives two reasons for keeping the query. "Could not run `gh` here" was a limit of its environment, not a design reason. "The record's suggested single closed query would not widen closed-unmerged coverage" is correct about the record's Technical Approach (a single `--state closed` query split locally has the same 50-row window), but the record's Deliverable 2 already offered the alternative that does widen it: "select closed-without-merge PRs directly". Change applied:
  - `plugin/skills/_shared/github-pr-scan.md` item 4: the closed fence is now `gh pr list --state closed --search is:unmerged --limit {resolved-limit} --json number,headRefName > "{closed-path}"`. The prose now reads: "`--state closed` also returns merged PRs (47 of its 50 rows in one sweep), so the closed query adds `--search is:unmerged` to spend its `{resolved-limit}`-row window on PRs closed without merging; the merged query covers merged PRs, and the de-duplication stays as a guard." That replaces the build's "Merged PRs share the closed window…" sentence.
  - `tests/github-pr-scan-closed-merged-overlap.test.js`: the `CLOSED_QUERY` pin now carries `--search is:unmerged`. Revert check: run against `origin/main`'s item-4 text in a scratch copy, the suite goes red (4 pass, 1 fail: test (d)); on the fix it is green.
  - `tests/github-pr-scan-fetch-limit.test.js`: one comment updated (the gh stub ignores `--search`, so its two lists still overlap and the de-duplication go-red case still runs).
  - `docs/journeys/see-each-closed-prs-leftover-branch-once-4819.md`: the Action, Should-understand, Red-flags and Success-state lines updated to the new closed query, plus an Origin bullet for #3905.
- Structural debt, missing consolidation, convention drift, skill-worthy patterns: no findings. The de-duplication is now redundant by query shape, but it is kept on purpose as a guard, since it is pinned by a go-red test and costs nothing.

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| Kept the by-`number` de-duplication although `--search is:unmerged` already makes the two lists disjoint | A search-index inconsistency or a future query edit could reintroduce overlap. The guard is one condition, already pinned by a go-red test, and removing it would mean rewriting a passing test for no behaviour gain. |
| The closed query now goes through GitHub's search API (`--search`) instead of the plain list endpoint | Measured to return the same `number`/`headRefName` shape with 50/50 closed-unmerged rows. The search API's 1000-result ceiling is far above any `{resolved-limit}` this scan uses, and the existing cap row still reports a full window. |

### Visual Review
- **Status:** Skipped — no UI changes
- Skill-load gate reason, verbatim: "no frontend surface (surface: infra) and no UI trigger file in the diff". Journeys whose `files:` overlap the diff: accept-a-locally-parked-pr-4615, compose-a-per-run-context-bundle-1988, recover-a-ci-parked-run, review-a-runs-learned-skill-edits-on-their-own-pr-5290, run-tidys-pr-scan-on-a-large-repo-4820, see-a-partly-reported-ci-run-as-pending-3658, see-each-closed-prs-leftover-branch-once-4819, update-a-conflicting-parked-pr-at-close-out-4273.

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- No simplifications needed. The two markdown files are non-code artifacts that `/claude-tweaks:simplify` Step 1 filters out. The two test-file edits are one string literal and comment lines, which a simplifier pass cannot reduce. The `code-simplifier` subagent was therefore **not dispatched**: this is a judgment skip, named here rather than reported as a clean pass.

### Skill Load Delta
Skill load delta (base 88cdbe8 = merge-base with origin/main):

| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |
|---|---|---|---|---|---|
| 41 entries: plugin:accept, plugin:activity, plugin:assess-agent-autonomy, … +38 more | 1,944–52,110 | 0 | 7,468,520–7,509,122 | +76 | — |

(Measured at review start, on the build's diff. The review fix makes the item-4 sentence shorter, so it lowers this delta; it was not re-measured.)

### Manual Steps Required
| # | What | Where |
|---|------|-------|
| 1 | Refresh PR #6214's body: its "Spec summary" says both queries were kept and "the window problem itself is not fixed", and it does not quote the closed-unmerged count AC 3 asks for (50 of 50, from `91fff3b8d6`'s message). The review was told to push only its own fixes, so it did not edit the PR body. | PR #6214 description |

Footer: Security Hardening, Agent Trust Scope and App Store Readiness passes were skipped by their pre-checks (no client/route paths, neither `.claude/settings.json` nor `.claude-tweaks/policy.yml`, no mobile-app signal in the diff). Step 6.7 had nothing to route. PR verdict comment and phase exit: not run (standalone review, no run dir or `run-state.json`).

### Verdict
**PASS**. One minor gap remains: AC 3's count is quoted in the commit, not the PR body (Manual Step 1).

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Hindsight fix | Item 4's closed query now excludes merged PRs (`--search is:unmerged`), so closed-unmerged coverage goes from 3/50 to 50/50 rows; prose, pinning test, fetch-limit test comment and #4819 journey updated — `plugin/skills/_shared/github-pr-scan.md`, `tests/github-pr-scan-closed-merged-overlap.test.js`, `tests/github-pr-scan-fetch-limit.test.js`, `docs/journeys/see-each-closed-prs-leftover-branch-once-4819.md` | `91fff3b8d6` (pushed to `drive-record-3905`) |

### Key Learnings
1. A record filed before a sibling fix can arrive half-done. #4819 had already shipped #3905's headline text, so the build's real job was the "second, unstated cost". Check `git log -S` on the record's quoted phrase before planning, so the remaining work gets the attention.
2. "I could not run `gh`" is an environment limit, not a design reason. When a build declines a record-offered option for that reason, the review (which can usually run it) should probe it rather than accept the decline. Here one probe turned a documented limitation into a 16x coverage fix.
3. `gh pr list --state closed --search is:unmerged` is the working shape for "closed without merging". It returned the same `number`/`headRefName` JSON as the plain list, with every row `mergedAt == null`.

### Next Actions
**`/claude-tweaks:wrap-up 3905`** — capture learnings and clean up (recommended)
