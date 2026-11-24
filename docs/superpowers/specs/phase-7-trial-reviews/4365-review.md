## Review: #4365 — Express lane own-PR post-merge sampling (PR #6180, branch drive-record-4365)

**Review effort:** medium (derived from record labels: risk:medium × size:medium; diff heuristic agrees — 9 files / 61 lines, `_shared` contract surface; no `review-effort-floor` set)

### Spec Compliance (spec-based only)
| Deliverable | Status |
|-------------|--------|
| 1. `samples --pr <n>`: filter the due set before the 3-per-firing cap, keep `--every` and the reviewed-marker drop, add `found`; USAGE + flag table | done |
| 2. After `merged`, gated on `express-lane: true`, run `samples --pr {pr}` and the review call — `flow/express-entry.md` and `dispatch/SKILL.md`'s explicit-form path | done (review scoped the dispatch copy to the `#N`/`#N,#M` forms — see finding 2) |
| 3. `found: false` / non-zero exit / incomplete review → "left to the next drain's sweep", no retry | done (stated once in `_shared/express-lane.md`; callers cite it after review fix 1/3) |
| 4. Rewrite drain-only sentences and update their pins | done (review also fixed the stale journey, skill-graph, plugin-structure and `express-prompt.md` copies) |

| Acceptance Criterion | Status |
|---------------------|--------|
| `--pr 12` at ordinal 5, `--every 5` → `found: true`, `sampled` holds #12 only, even when 3 older sampled PRs are due | met — after review fix 7; as built, no test reached the cap (a filter-after-cap mutant stayed green on the original test and went red on the added one) |
| Ordinal 4 → `found: true, sampled: []`; absent → `found: false, sampled: []`; reviewed → `found: true, sampled: []` | met |
| `samples` without `--pr` unchanged apart from `found` absent | met |
| `flow/express-entry.md` and `dispatch/SKILL.md` name `samples --pr {pr}` after `merged`, gated on `express-lane`; a prose test pins each | met |
| `express-lane.md` Post-merge sampling describes both paths; no sentence still says a non-drain merge is reviewed only by a later drain | met (the stale journey-doc sentence, outside `express-lane.md`, fixed too) |
| "left to the next drain's sweep" pinned for the three cases | met (`tests/express-lane-prose.test.js:85`) |
| `npm test` passes | met — after review fix 1; as built, PR CI was red (see Verification) |

Current-State outcome: reached — both foreground paths now run the own-PR check. Risk markers: none unresolved.

### Verification (from /test)
- Type check: n/a (no type checker configured)
- Lint: n/a
- Tests: pass — before this review, local runner stamp `verifiedHead: true` (scoped) but **PR CI red** at 85a16d6 (run 45329867653): `dispatch/SKILL.md stays under the read-limit rail`, `rail: every shipped skill .md fits one Read call`, `SKILL.md fits the Read rail` — the branch's file was 52,498 B, but on the merge ref with main's #6142 (+9 B) it was 52,507 B > 52,500 B. Attributable (main itself at 52,110 B). Fixed forward: after the fix, `npm test -- --full` → 35,799 tests, 35,779 pass, 0 fail, 20 skipped; merged-tree `dispatch/SKILL.md` 52,349 B; PR CI at 28dda7f all green (shards 1-4, test, label-fix-branch; run 45353018464).

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| test-gate | PR CI red: merged `dispatch/SKILL.md` 7 B over the Read rail (3 rail tests) | high | fixed — own-PR sentence now cites `_shared/express-lane.md` instead of restating it (−158 B) |
| error/convention | `dispatch/SKILL.md:250` own-PR check unscoped — a bare drain would run it per merged singleton, duplicating its own loop-termination sweep and misreporting "left to the next drain's sweep"; three copies drifted on scope | medium | fixed — scoped to the `#N`/`#N,#M` forms |
| convention | `flow/express-entry.md:25` restates the shared procedure (gate, failure handling, no-retry) | medium | fixed — keeps the gate + `samples --pr`, cites the shared section |
| convention/error | `flow/express-entry.md:25` names `express-prompt.md` bare (it lives in dispatch's directory); "name the PR in the note" after the note is rendered, with no template slot | medium | fixed — skill-qualified reference; named "on a line after the note" |
| convention | `dispatch/express-prompt.md:78` review-call preamble names only Step 3's loop termination as its dispatcher | medium | fixed — own-PR dispatcher clause added (`samples --pr`, own report/note) |
| convention | `docs/skill-graph.md` rows 309/311/319/395 stale — new flow→dispatch edge and Step 5's `samples --pr` missing | medium | fixed |
| test | `--pr` test never reaches the 3-per-firing cap, so AC1's filter-before-cap ordering was unpinned | medium | fixed — `--every 1` case; proven by mutation (filter-after-cap mutant: original test green, new test red) |
| test | lookback-filtered `--pr` untested | low | fixed — `now` past the 30-day window → `found: true, sampled: []` |
| test | `--pr` validation (0, negative, non-numeric) untested | low | fixed — malformed-invocation rows |
| docs | journey doc lines 79/86 still state the drain-only rule | low | fixed |
| docs | `docs/plugin-structure.md` entries describe the review call as drain-only; `samples` lacks `--pr` | low | fixed |
| convention | `cli.js` module header's `samples` description omits `--pr`/`found` | low | fixed |
| convention | prose tests pin the restated procedure | low | accepted — tiebreak recommended drop; pins updated as part of fix 3 |
| convention | `ceremony-profile.md:44` restates the sampling trigger | info | accepted — tiebreak: a one-clause citation, not a restated procedure |
| test | `ceremony-profile.md:44` clause unpinned | info | accepted — tiebreak: prior wording was unpinned too; canonical section is pinned |
| test | prose pins anchored to unique sentences | info | accepted — non-defect confirmation |

### Tiebreak
**Verdicts:** 12 confirmed · 2 dropped · 0 digest · 0 console
- docs/skill-graph.md:395 — new flow→dispatch edge not recorded (medium) — Recommendation: file — fixed
- plugin/skills/flow/express-entry.md:25 — own-PR procedure restated (medium) — Recommendation: file — fixed
- plugin/skills/dispatch/SKILL.md:250 — restated procedure eats the Read-rail margin (low) — Recommendation: file — fixed (finding 1)
- plugin/skills/dispatch/SKILL.md:250 — three copies drift; Step 5 copy unscoped (medium) — Recommendation: file — fixed
- tests/dispatch-express-routing-prose.test.js:802 — pins lock in duplication (low) — Recommendation: drop
- plugin/skills/_shared/ceremony-profile.md:44 — third restatement (info) — Recommendation: drop
- plugin/skills/_shared/express-lane.md:53 — step 1 omits `found` (refuted, info) — Recommendation: drop — `found` appears only under `--pr`, documented at line 51
- docs/skill-graph.md:309 — rows 309/311/395 stale (medium) — Recommendation: file — fixed
- plugin/skills/dispatch/express-prompt.md:78 — preamble names only loop termination (medium) — Recommendation: file — fixed
- docs/journeys/ship-a-small-record-on-the-express-lane-4025.md:86 — drain-only rule (low) — Recommendation: file — fixed
- docs/plugin-structure.md:237 — drain-only description (low) — Recommendation: file — fixed
- plugin/bin/lib/express/cli.js:490 — `found: true` for a non-express hit (refuted, info) — Recommendation: drop — the drain sweep excludes such a hit too; `found: true, sampled: []` truthfully means "not due"
- plugin/skills/_shared/ceremony-profile.md:44 — clause unpinned (info) — Recommendation: drop
- tests/express-lane-prose.test.js:84 — pins anchored correctly (info) — Recommendation: drop

Also confirmed before the tiebreak: 3a pair (cli.js header), 3f pair (filter-before-cap, severity contested high/medium → medium; `--pr` validation), and cross-lens corroboration 3a+3c (flow bare `express-prompt.md` reference) and 3c+3f (no filter-before-cap / lookback test). Lens 3b (security): no findings from either agent.

### Fan-out leftovers
0 untracked files; agent-scratch empty. 12 new local listeners since the pre-dispatch snapshot, reported (not killed; ownership unattributed — sibling sessions were active): 2.1.325:59011, 2.1.325:61949, 2.1.325:63776, node:20212, node:20213, node:20214, node:20215, node:20216, node:20262, node:20263, rapportd:62242, rapportd:62243.

### Implementation Hindsight
- Driver commit subjects keep `()` / `— refs` residue: `neutralize()` (`plugin/bin/lib/driver/events.js`) strips the worker title's `#N` refs, then `commitStep` (`steps.js:1048`) appends `— refs #N` again (this branch: `… via samples --pr () — refs #4365`, `… — refs — refs #4365`) → Defer — digested (rule `policy-reason`, pre-existing-outside-diff): https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-7125478675
- `dispatch/SKILL.md` has ~160 B of Read-rail headroom even after this review's trim; this PR hit the rail twice → Defer — filed #6194 (born-ready: split Step 5's Express lane / Driver route paragraphs into a sub-file)
- Approach correctness, consolidation, convention: no further changes needed.

Materiality digest: 1 finding routed this run — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-7125478675

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| `dispatch/SKILL.md` left ~151 B under the rail on the merged tree rather than split now | The split is a separate, larger change touching Step 5 and its prose tests; filed as #6194 rather than folded into this record's scope |
| `found: true` for a search hit that fails `isExpressPr`/has no usable `mergedAt` | Tiebreak refuted the finding: such a PR is never due on either path, so "found, not sampled" is truthful; `found: false` keeps its job of flagging search-index lag |

### Visual Review
- **Status:** Skipped — no UI changes
- Skill-load gate: "no frontend surface (surface: backend) and no UI trigger file in the diff"; journeys whose `files:` overlap the diff include `ship-a-small-record-on-the-express-lane-4025` (updated by this review) among 100+ dispatch/flow journeys

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- No simplifications needed (code-simplifier over `plugin/bin/lib/express/cli.js` and the four touched test files)

### Skill Load Delta
Skill load delta (base 8d21732 = merge-base with origin/main):

| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |
|---|---|---|---|---|---|
| 40 entries: plugin:accept, plugin:activity, plugin:assess-agent-autonomy, … +37 more | 1,944–51,971 | 0 | 7,444,913–7,485,515 | +1,358 | — |
| plugin:dispatch | 52,340 | +239 | 7,444,913 | +1,358 | — |

Doc freshness (3i, informational): `plugin/bin/lib/express/cli.js` matches the auto-detect patterns of `docs/reference/run-manifest.md` and `docs/reference/station-events.md`; neither covers `samples`, so no update needed. 3g-cov skipped (no `stories/`). Steps 6.6/6.65/6.66 skipped (no client/route files, no settings/policy files, no mobile-app signal).

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Read-rail breach on the merge ref; Step 5 own-PR check scoped to `#N`/`#N,#M` — `plugin/skills/dispatch/SKILL.md` | `28dda7fd2f` |
| Bug fix | Cite the shared own-PR check, skill-qualified `express-prompt.md`, line after the note — `plugin/skills/flow/express-entry.md` | `28dda7fd2f` |
| Bug fix | Name both explicit forms — `plugin/skills/_shared/express-lane.md` | `28dda7fd2f` |
| Bug fix | Own-PR dispatcher clause — `plugin/skills/dispatch/express-prompt.md` | `28dda7fd2f` |
| Bug fix | Filter-before-cap, lookback and `--pr` validation tests; updated prose pins — `tests/bin-lib/express/cli.test.js`, `tests/dispatch-express-routing-prose.test.js`, `tests/flow-express-entry-prose.test.js` | `28dda7fd2f` |
| Bug fix | Stale drain-only descriptions — `docs/skill-graph.md`, `docs/plugin-structure.md`, `docs/journeys/ship-a-small-record-on-the-express-lane-4025.md`, `plugin/bin/lib/express/cli.js` header | `28dda7fd2f` |
| Record filed | dispatch/SKILL.md Read-rail headroom split | #6194 |
| Digest entry | driver commit-subject residue | #5046 comment 7125478675 |

### Key Learnings
1. A byte-railed file within a few bytes of its cap passes on the branch and fails only on the PR's merge ref once a sibling lands — check the size in `git merge-tree --write-tree origin/main HEAD`, not the branch file — this PR's own build trimmed to 52,498 B and still went red.
2. An acceptance criterion phrased "even when 3 older due PRs exist" needs a fixture that actually exceeds the cap; the as-built `--pr` test passed against a filter-after-cap mutant, and only the mutation exposed it.
3. `assertEachFactGoesRed` needs disjoint fact spans — two pins over overlapping text both vanish when one is stripped, so the go-red control fails on a correct file.

### Next Actions

**`/claude-tweaks:wrap-up 4365`** — capture learnings and clean up (recommended)
