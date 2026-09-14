# Review — Code-Mode Procedure (Steps 1-7)

Loaded by `SKILL.md` in `code` and `full` mode only — `visual`/`journey`/`discover` modes delegate entirely to `/claude-tweaks:visual-review` and never read this file (that skip is exactly why this file is not part of `SKILL.md`: the dispatcher stays cheap for modes that use none of it, and both files keep real headroom under the 40 KB ceiling). Extracted from `SKILL.md` for #887, following `/claude-tweaks:visual-review`'s own prelude/mode split (#108).

## Ceremony-Aware Step Selection

When a pipeline run directory exists, read `config.yml`'s `ceremony-profile`. Under `fast-lane`,
Steps 1 (Spec Compliance Check), 1.6 (Cross-Spec Promise Check), and 4 (Implementation Hindsight)
are skipped. The roster of every profile's skips — and of what no profile may skip — is
`_shared/ceremony-profile.md`; this section keeps only the three step numbers. Standalone review
(no pipeline run directory) always runs every step, matching
`/claude-tweaks:reflect`/`/claude-tweaks:wrap-up`'s own standalone-defaults-to-full rule. A Review
finding at any severity still triggers the existing ceremony escape hatch
(`/claude-tweaks:wrap-up`'s Phase 1 ceremony escape hatch downgrades `ceremony-profile` to
`standard` for the rest of the run via `bin/set-config.js` — the sanctioned run-config writer;
the runnable invocation lives in that hatch, refs #1376) — unchanged. Full rationale was in
`docs/superpowers/specs/2026-07-20-lifecycle-ceremony-tiering-design.md`, deleted `70849915`.

## Step 1: Spec Compliance Check (spec-based only)

Skip this step entirely under `ceremony-profile: fast-lane` (roster tag `review-step-1`,
`_shared/ceremony-profile.md`) — proceed directly to Step 1.5.

Skip it too on a `base:{ref}` scope (Input rule 9): no spec exists to verify — proceed to Step 1.5 with "no spec — base-ref scope" in Step 7's summary.

If a spec number was provided, read the spec file and verify the implementation meets it:

> **Parallel execution:** Use parallel tool calls aggressively — all Grep/Glob/Read operations searching the codebase for each deliverable's implementation and each criterion's verifiability are independent and should run concurrently.

1. **Deliverables** — for each deliverable checkbox in the spec, search the codebase for the implementation. Mark each as `done`, `partial`, or `missing`.
2. **Acceptance Criteria** — for each criterion, determine whether it's verifiable from the code and tests. Mark as `met`, `partially met`, or `not met`.
3. **Non-Goals** — verify the implementation didn't accidentally include work scoped out by the spec's Non-Goals section.
4. **Risk-Marker Verification** — runs alongside check 2 above (Acceptance Criteria). Scan the
   spec (the same materialized file this step already reads — no separate fetch) for unresolved
   risk markers left over from `/claude-tweaks:specify`: Gotchas bullets whose validation status
   is not "validated" (contains "unvalidated," "assumed," or "unconfirmed" —
   `shaping-mode-stamping.md`'s framing-check fold, #1346's split of `shaping-mode.md`), inline `<!-- ambiguity: ... -->` markers
   (`red-team.md`'s per-sentence write-back), and `## Open Questions` rows (`red-team.md`'s
   general-finding table). For each marker found, independently verify it against the artifact's
   real external validator/schema/tool — **a structural or syntax check alone (e.g. "the config
   parses," "the file exists") is necessary but not sufficient; the value itself must be confirmed
   against ground truth**, not merely well-formed. Mark each as `verified` or `unresolved`.

### Gate:

| Result | Action |
|--------|--------|
| All deliverables done + all criteria met | Proceed to Step 1.5 |
| Minor gaps (1-2 partial items) | Flag gaps, proceed — they may be addressed in Implementation Hindsight |
| Any risk marker `unresolved` after independent verification | **BLOCKED** — same tier as Significant gaps. Name the unverified marker(s) (file:line or table row) so the user knows exactly what still needs ground-truth confirmation |
| Significant gaps (missing deliverables or criteria) | **BLOCKED** — the spec isn't fully built yet. List what's missing so the user can resume `/claude-tweaks:build` |

If blocked, skip the rest of the review. Present the gap analysis so the user knows exactly what to finish.

> **Why this is Step 1:** A thorough code review on incomplete work wastes effort. Catch spec gaps before investing in quality analysis.

## Step 1.5: Test Gate

Verify that `/claude-tweaks:test` has passed before proceeding to analytical review. Reviewing code quality on code that doesn't work is wasted effort.

**Under a `base:{ref}` scope the tree this gate verifies must be `origin/{integration-branch}`** — the gate runs from a checkout already standing at that tip (the caller asserts it before invoking), never from a feature-branch worktree's HEAD, whose stamp would verify a tree the reviewed range does not contain.

`PASS_WITH_CAVEATS` counts as passed — caveats are informational observations (e.g., minor UX roughness, non-blocking warnings) and do not block review. QA caveats are included in the findings table (Step 3 Routing) for visibility but have status `observation`, not `open`.

### In `/claude-tweaks:flow` pipeline:

Check for `TEST_PASSED=true` in pipeline context. If present, add one belt-and-braces read of the runner's own artifact (#1921) — `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status` (one plain command; prints `{present, sha, head, dirty, scope, fullSha, match, verifiedHead, reportPath, legacy}`, exit 0 always). `verifiedHead: true` (a clean HEAD covered by a full pass, or by a passing scoped run anchored on a still-valid `fullSha` — `match` alone would re-trigger a scoped run forever, #1923) → proceed to Step 2. `verifiedHead: false` with `TEST_PASSED=true` is reported, never silently accepted: "TEST_PASSED set but the runner stamp does not verify HEAD ({stamp-sha}, {scope} vs {head}) — re-running `/claude-tweaks:test`", then re-trigger `/claude-tweaks:test` once and re-check.

### Standalone (outside `/claude-tweaks:flow`):

Check the verification pass stamp (`test/verification.md`'s "Verification pass stamp" step) — one read of the runner-written stamp (#1921), replacing the commit-archaeology this check used to require:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status
```

- **`verifiedHead: true`** (a clean HEAD covered by a full pass, or by a passing scoped run anchored on a still-valid `fullSha`) → a recent pass; proceed to Step 2. The stamp asserts verification only (types + lint + tests) — when QA stories exist, the QA Ledger Check below still runs as usual.
- **`present: false`, `verifiedHead: false`, or `dirty: true`** → no recent pass (fail-open; a stale stamp is never trusted): auto-trigger `/claude-tweaks:test --source review` (the explicit parent signal — scoped when a declaration exists, per `test/verification.md`'s table). If QA stories exist (`stories/*.yaml`), trigger `/claude-tweaks:test all --source review` (full suite + QA). Otherwise trigger `/claude-tweaks:test --source review` (standard suite only).

### QA Ledger Check

After confirming `TEST_PASSED`, read the open items ledger (`docs/plans/*-ledger.md`) and filter for entries with phase `test/qa`:

- If any QA ledger entries have status `open` (failures that were not resolved), include them in the test gate report alongside the `TEST_PASSED` status. These represent QA failures that `/claude-tweaks:test` surfaced and that still need resolution.
- If all QA entries have status `observation` or `fixed`, note: "QA observations present — see findings table in Step 3 Routing."

### Gate:

| Result | Action |
|--------|--------|
| `TEST_PASSED=true` (pipeline) + runner stamp `verifiedHead: true` | Proceed to Step 2 |
| `TEST_PASSED=true` (pipeline) + runner stamp `verifiedHead: false` | Report it (stamp sha/scope vs HEAD), re-trigger `/claude-tweaks:test`, re-check |
| Runner stamp `verifiedHead: true` (standalone) | Proceed to Step 2 |
| `/claude-tweaks:test` triggered and passes | Proceed to Step 2 |
| `/claude-tweaks:test` triggered and fails | **STOP** — present test failures. Fix before continuing. Run `/claude-tweaks:test` to re-verify. |

> **Why this gates review:** Mechanical correctness is a prerequisite for analytical quality judgment. Code review on broken code wastes effort.

## Step 1.6: Cross-Spec Promise Check (parent-linked records only)

**Skip entirely** under `ceremony-profile: fast-lane` (roster tag `review-step-1.6`, `_shared/ceremony-profile.md`), or silently when this record has no
resolvable parent or its parent has no `## Cross-Spec Promises` section — most records. This step
never blocks the review.

For the parent resolution, promise-table update flow, and forward-assumption tracking procedure,
read `cross-spec-promise-check.md` in this skill's directory.

## Step 2: Identify What Changed

**Resolving `{base}`:** never trust a bare local branch name for `{base}` — a long-lived worktree's local tracking branch (commonly `main`) routinely drifts behind its remote. Resolve it via `git fetch origin {base}` then use `origin/{base}` in every command below, or otherwise confirm `git log -1 {base}` matches `git log -1 origin/{base}` before trusting the diff scope.

On a `base:{ref}` scope, `{base}` is the given ref and `{branch}` is `origin/{integration-branch}`. **This paragraph overrides the `origin/{base}` rule above it**: a `base:{ref}` ref is a tag (`v6.48.0`) or a sha, neither of which has an `origin/` form, so it is used exactly as given — after `git fetch --tags origin`, so the tag resolves locally. Only `{branch}` takes the `origin/` prefix on this scope. The change set is `git log --first-parent {base}..{branch}` / `git diff {base}..{branch}` — the first-parent line of the integration branch, so each squash-merged PR is one commit and a `--no-ff` merge counts once.

### Merge-Provenance Check

Before analyzing the diff, detect whether the base branch was merged into this branch mid-history — content that arrived that way is not work this branch introduced and must not be reviewed as such. `{base}`/`{branch}` reuse whatever base-branch resolution the rest of this step already uses.

```bash
git log --merges {base}..{branch} --oneline                                      # detect
```

- **No merge commits detected** (the common case) — this check is a no-op: no further computation, no new output section. The rest of Step 2 proceeds exactly as before, against the full diff.
- **Merge commits detected** — read `merge-provenance-check.md` in this skill's directory: the own-work file-set computation, how to report the excluded files, and the own-work scope that replaces the raw `git diff` scope for Steps 3, 3.5, and 5.

Not to be confused with "Reusing a Prior Whole-Branch Review" below — that handles a *later spec's* review citing an *earlier spec's already-completed* whole-branch review in a multi-spec batch; this check handles what's *in the diff at all* for a single review, independent of whether any prior review exists.

Analyze the diff's **shape** — scoped to the own-work file set above when merge commits were detected — to understand the scope. Read `--stat` and `--name-only`, **not** the full diff:

```bash
git diff {base}...{branch} --stat        # files changed, per-file line counts, and totals
git diff {base}...{branch} --name-only   # bare path list, for path-pattern matching
```

- Which files changed and in which packages/apps
- Lines added/removed
- Whether schema, API surface, or infrastructure changed
- Whether new dependencies were introduced

**Do not read the full diff in the main thread.** Measured on a 20-commit branch: `git diff` is ~89.5 KB against ~0.9 KB for `--stat` — a ~100x difference, and 30-commit branches are routine in this repo. Everything this step classifies, and everything Step 2.5's diff heuristic consumes, comes from the two commands above.

The one exception is the dependency question, which needs manifest *content* rather than just a filename: when `--name-only` shows a dependency manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or equivalent), read a **targeted** diff of just that file (`git diff {base}...{branch} -- package.json`). That is bounded by construction — it is not a licence to widen back to the full diff.

Full diff *content* belongs to Step 3's dispatched lens agents, which have their own context windows. See Step 3's dispatch note. It lives in `step3-lens-dispatch.md`.

If infrastructure or deployment changes are detected (Terraform, CDK, Docker, CI/CD, database migrations, new environment variables) that aren't already in the ledger as `ops` items, triage each for auto-executability first — most "outside the codebase" tasks have a CLI and get executed, not appended. Append only what survives triage, with phase `ops`, status `open`, and a `(reason-not-auto: {value})` qualifier embedded in the item description per `_shared/ledger-format.md`'s ops-item rule — an ops item without one is a classification error. This catches ops requirements introduced during review fixes that weren't present in the original build.

This classification guides which review lenses to apply — a pure UI change doesn't need a database review.

### Reusing a Prior Whole-Branch Review

In a multi-spec batch (`/claude-tweaks:flow 42,45,48`, or any run where several specs share one worktree/branch), a later spec's review may be tempted to cite an earlier spec's already-completed whole-branch review instead of re-dispatching. Only reuse it when the scope is **byte-identical**: the exact same commit range this review would otherwise cover, with zero delta — nothing has landed on the branch since the cited review's `HEAD`.

If the current diff is instead an **overlapping superset** — the branch has moved forward since the cited review ran (new commits from this spec or another), even a small amount — the cited review does not cover that delta. Do not treat "we reviewed the branch already" as covering commits that landed after its `HEAD`. Instead: cite the prior review for the range it actually covered, and run a supplementary review scoped to just the delta (`git diff <cited-review-HEAD>..<current-HEAD>`) — not a fresh full whole-branch review.

When it's unclear which case applies, default to overlapping superset (the conservative assumption) and run the supplementary check. Confirm byte-identical scope explicitly (diff the two commit ranges) before skipping re-dispatch — an unverified assumption of "same scope" is exactly how partial coverage escapes review.

## Step 2.5: Derive Review Effort

Resolve a `review-effort` tier — one of `low` / `medium` / `high` / `xhigh` / `max` — before dispatching Step 3's lenses. This tier gates which lenses run (Step 3), whether cross-lens debate and the per-candidate refutation pass run (Step 3.5), whether the gap-sweep pass runs (Step 3.6), and how findings surface (`step3-routing.md`). It is never persisted back to the work record — it's derived fresh on every review run, unlike `risk:*`/`size:*`/`ceremony:*`.

Resolution order — read `review-effort-derivation.md` in this skill's directory for the procedure: the explicit-argument rule, the record `risk:*`/`size:*` label read (per-backend commands plus the risk × record-size combination table), the diff heuristic fallback, and the `review-effort-floor` project floor. Skip that read when `$ARGUMENTS` carried an effort token — an explicit token always wins, so the tier is already resolved.

**Ambiguity never resolves toward less scrutiny.** If reading record labels fails, fall through to the diff heuristic rather than defaulting to `low`. If the diff heuristic itself can't render a clear signal, default to `high` — the tier that reproduces this skill's pre-existing default behavior — never `low`.

Record the resolved tier and which resolution step produced it, for Step 7's summary: `{explicit argument | record labels: risk:{x} × size:{y} | diff heuristic: {reasoning}}`, plus `floor applied: {value}` when step 4's `review-effort-floor` raised the tier.

## Step 3: Code Review

Review changed files through these lenses. Skip lenses that don't apply to the type of change (e.g., skip "Performance" for a docs-only change).

The severity scale, category enum, per-lens floors, and the CALIBRATION filter are the shared review-quality criteria — read `_shared/criteria-review-quality.md` (also used by `/claude-tweaks:code-health`'s review lens). The table below is the operative copy:

**Severity floor per lens** (calibrate flag thresholds — over-flagging is the most common review failure):

| Lens | Expected ceiling | Notes |
|------|------------------|-------|
| 3a Convention | medium | Only flag when divergence compounds (e.g., new code introduces a third logging pattern); single-instance style differences are not findings. |
| 3b Security | critical / high | Always actionable. No "info" findings — if it's a security observation that isn't actionable, drop it. |
| 3c Error handling | high | Critical only when an uncaught error leaves the system in a broken state. |
| 3d Performance | high | Critical only when a measured regression exists (real query, real benchmark); never speculative. |
| 3e Architecture | high | Critical only when a layering violation will break a near-term feature; otherwise medium. |
| 3f Test quality | medium | Tests are not production code; flag only when a missing test would have caught a real bug. |
| 3g-cov Coverage | low / informational | Never blocks the review. |
| 3h UX (when QA data) | high | Capable profile — judgment-heavy synthesis. |
| 3i Doc freshness | low / informational | Never blocks the review. |

**3a skill-routed entries.** Lens 3a records a `review/skill` ledger entry rather than choosing a destination; `/claude-tweaks:wrap-up`'s Skills curation row classifies it via `skills/_shared/learning-routing.md`, where a finding about a claude-tweaks skill resolves to D5 (upstream) rather than a project skill update. Do not inline this note into the 3a agent prompt — that agent's job is to record, not to route.

**Lens scope, the dispatch contract, the canonical agent prompt, and the 3a-3f lens definitions live in `step3-lens-dispatch.md`** in this skill's directory — read it before dispatching. It holds: which lenses each `review-effort` tier puts in scope (fewer at `low` and `medium`, every applicable lens at `high` and above), the low-tier single-read dispatch rule, and the `xhigh`/`max` reasoning nudge; the Working Directory Discipline rule for every `Task()` dispatch in Steps 3, 3.5, and 3.6; the `build-review-context.js` shared context bundle that keeps full diff content out of this thread; the reproduction-pair dispatch and its `review-coordination.js categorise-reproduction` call; per-lens model profiles; the canonical agent prompt to inline (its "Per-lens Calibration + Output template" section — Calibration block + OUTPUT FORMAT, moved there from `step3-routing.md` so that file loads only when findings exist); and the question list each of lenses 3a-3f reviews against.

### 3g-cov: Journey-Story Coverage (when journeys and stories exist)

Check coverage between journey files and story YAML files. This lens is informational — coverage gaps do not block the review.

Run the computation in `_shared/journey-coverage-check.md` (shared with `/claude-tweaks:journey-health`'s coverage scan; that file also documents the skip condition and parallel-execution note).

Add findings to the code review findings table:

   **Uncovered journey steps:**
   ```
   | {N} | Journey '{name}' has {M} uncovered steps ({step numbers}) | Medium | Coverage | docs/journeys/{name}.md | Run `/claude-tweaks:stories journey={name}` |
   ```

   **Orphaned stories with journey URL match:**
   ```
   | {N} | Story '{id}' matches journey '{name}' but has no `journey:` field | Low | Coverage | stories/{file}.yaml | Add `journey: {name}` |
   ```

   **Orphaned stories with no match** (informational, not added to findings table):
   Log: "{N} orphaned stories with no journey match (negative stories or standalone flows)."

### 3h: UX Analysis (when QA data available)

Run the UX analysis procedure from `ux-analysis.md` in this skill's directory. Only runs when QA screenshots and/or caveats exist from a recent `/claude-tweaks:test qa` or `/claude-tweaks:test all` run. When no QA data is available, skip this lens silently.

### 3i: Documentation Freshness (informational)

**Skip when** `docs/REGISTRY.md` doesn't exist, or the diff is docs-only.

Read `step3-doc-freshness-lens.md` in this skill's directory for the procedure: the `docs/REGISTRY.md` Auto-detect match and its informational finding row, plus sub-lens **3i-diagram** (structural-complexity signal table, co-located-diagram check, deterministic tie-break, and its own finding row). Skip `3i-diagram` additionally when CLAUDE.md's `diagram-suggestions` flag is `disabled` or missing.

### Step 3.5 & 3.6: Cross-Lens Debate, Per-Candidate Refutation, and Gap-Sweep

Three effort-gated findings-quality mechanisms run after Step 3's per-lens reproduction completes: Cross-Lens Debate (resolves contradictions between different lenses reviewing the same region), the Per-Candidate Refutation Pass (re-examines `confirmed` findings at or above a `medium` severity floor, capped at 10 per review, for correlated error reproduction-pair agreement alone can't catch), and Gap-Sweep / Completeness Critic (a single fresh-eyes agent asking what every angle-scoped lens, collectively, missed).

**Skip all three entirely when the resolved `review-effort` tier (Step 2.5) is `low` or `medium`** — proceed directly to Step 3 Routing below, matching Step 3's own narrower lens scope at those tiers.

**At `high` and above**, Cross-Lens Debate runs. **At `xhigh` and `max` only**, the Per-Candidate Refutation Pass and Gap-Sweep additionally run (one tier stricter, so `high`-tier reviews aren't paying for all three mechanisms at once). Read `step3-debate-and-refutation.md` in this skill's directory for the full procedure — dispatch templates, the `review-coordination.js` `detect-overlap`/`resolve-debate`/`resolve-refutation` invocations, and decision-log formats — lazy-loaded only when the resolved tier is `high` or above, following the same lazy-load pattern as `step3-routing.md`.

After Step 3.5, every finding has a final bucket — `confirmed`, `unconfirmed`, or `contested`. Only `confirmed` findings flow into Step 3 Routing. `unconfirmed` and `contested` are already staged to the Wrap-Up Console.

### Step 3 Routing — Code Review Findings

Routing logic lives entirely in `step3-routing.md` in this skill's directory: severity-based auto routing (with the contract floors), the interactive batch table, recommendation rules, the deferral gate, the parallel-fix dispatch contract (3+ independent fixes via `/superpowers:dispatching-parallel-agents`, with its mandatory post-dispatch diff audit), and the auto-advance-on-zero-findings rule. `unconfirmed` and `contested` findings bypass Step 3 Routing — they route directly to the Wrap-Up Console (Low-confidence and Contested subsections, respectively). The fix-now re-verify runs scoped per `test/verification.md`'s "Re-verify scoping" table (review-fix row).

---

## Step 4: Implementation Hindsight (Decision Point)

Skip this step entirely under `ceremony-profile: fast-lane` (roster tag `review-step-4`,
`_shared/ceremony-profile.md`) — proceed directly to Step 5.

Run `/claude-tweaks:reflect` in **hindsight** mode. Pass:
- **Scope** — the changes analyzed in Steps 2-3
- **Ledger phase** — `review/hindsight`

The reflect skill handles the full hindsight evaluation, finding presentation, routing, ledger writes, and re-verification after fixes. See `/claude-tweaks:reflect` for details.

If the reflect skill produces "Change now" fixes, re-run `/claude-tweaks:test` before proceeding.

---

## Step 5: Simplify Changed Code

Run `/claude-tweaks:simplify` on the same own-work file scope Steps 2-4 use — the Merge-Provenance Check's own-work file list (Step 2) when merge commits were detected, otherwise the full `git diff --name-only` file set. Do not hand `/claude-tweaks:simplify` the raw diff unfiltered when merge commits were found: `/claude-tweaks:simplify` has no merge-provenance handling of its own, so it fully trusts whatever scope this step passes it — passing the raw diff would let it edit code this branch never actually introduced, the exact outcome the Merge-Provenance Check exists to prevent.

The simplify skill handles scope resolution, running the code-simplifier subagent, and re-verification after changes. See `/claude-tweaks:simplify` for details.

---

## Step 6: Visual Review

**When this step runs:**
- **Code mode:** Delegate to `/claude-tweaks:visual-review --mode=recommendation` — it detects UI changes via `git diff` and identifies affected journeys, returning a structured recommendation without opening a browser (no `agent-browser` dependency). Do not stop to ask; note any recommendation in the summary (Step 7). This is `recommendation` mode, not `discover` mode — `discover` actually opens a browser and walks the app, which would contradict this step's "recommendation only, non-blocking" design.
- **Full mode:** Invoke `/claude-tweaks:visual-review` with the target URL/journey and QA data (if available). The visual review owns UI/journey detection and the procedure. Findings feed into the summary (Step 7) as the "UI / Visual" lens with their own severity classifications. When the diff has zero UI-file matches (the same trigger-extension check `/claude-tweaks:visual-review` already uses for its own detection), fall back to `--mode=recommendation` instead — same as code mode above — rather than opening a full browser mode on a diff with nothing to visually review.

**Routing (optional):** actionable full-mode visual findings the user wants to action inline route through Step 6.7 below, in one consolidated pass with Step 6.5's design findings — Step 3 Routing has already completed by this point. When the user opts not to action a finding inline, it remains in the Step 7 summary's "Visual Review" section as informational. (`/claude-tweaks:visual-review`'s own Step 5 Boost fix/defer/accept flow does not apply here — it runs only when `/claude-tweaks:visual-review` is standalone and interactive, never when invoked BY `/claude-tweaks:review`.)

Invocation:

```
/claude-tweaks:visual-review {affected-journey-or-url}
```

`/claude-tweaks:visual-review` owns the mechanics — UI file detection, affected-journey lookup, browser prerequisite checks, dev URL resolution, the page/journey/discover procedures, and the missing-browser skip path. This skill consumes its report; it does not re-implement detection here.

## Step 6.5: Design Quality Pass (Impeccable)

Invoke `/claude-tweaks:design-wrapper review <spec>` to run Impeccable's `critique` + `audit` commands on the changed UI files — and, when the built artifact carries a direction contract, to dispatch Impeccable's own `impeccable-finish-reviewer` agent against it (the wrapper's Step 3.7; its findings arrive in the same `findings` list under `source: "finish-review"`). Findings are advisory in Phase 1 — they inform the verdict and surface in the review summary, but are not auto-applied.

**Invocation:**

Before invoking the wrapper, run `_shared/design-wrapper-handling.md`'s "Caller-side pre-check" with `--mode review`, `--files` from the diff scope this run already resolved (Step 2's own-work file list when merge commits were detected, otherwise the full `git diff --name-only` set), and `--surface` from this record's materialized `surface:` header field — so a non-frontend record, or a project with the design kill-switch off, never pays for loading `design-wrapper/SKILL.md` plus `modes/review.md`. On `decision: "skip"`, treat exactly like the wrapper's own `{skipped: ...}` return in the Result handling table below and skip straight to Step 6.7. On `decision: "proceed"`, pass the spec number (or paths) used for this review run — the wrapper resolves changed UI files via its own detection and runs `/impeccable:impeccable critique` + `/impeccable:impeccable audit`.

**Result handling:**

| Wrapper return | Review behavior |
|----------------|-----------------|
| `{result: "advisory", findings: [...], score_trend?: {...}}` | Include findings in the summary as a "Design Quality" section (see Step 7's template). When `score_trend` is present, the section also renders a Design/Audit Health trend line above the findings table (current score vs. the last captured score, per `review-summary-template.md`). Findings are advisory — they inform the verdict, but no auto-fixes. A `decisions_staged` field (present when the wrapper staged `target: "decisions"` findings to `{run-dir}/staged/design-decision-*.md`) means those findings await the Review Console — render them under the section's **Decisions** sub-heading only when the field is absent (nothing was staged — standalone review, or no `decisions` findings this run). |
| `{skipped: ...}` (from the wrapper, or from the pre-check's `decision: "skip"` above) | Omit the "Design Quality" section from the summary. Note the skip reason in the summary footer. |
| `{deferred: ...}` (should not happen for `review` mode) | Treat as skip and omit the section. |

See `_shared/design-wrapper-handling.md` for the canonical return-shape contract and the "why skips don't fail" rationale.

**Why findings are advisory (review-specific):** Impeccable critiques are LLM-generated and opinionated. The user judges which findings to action. The wrapper's `review` mode is read-only — code-modifying behavior lives in `polish` (invoked separately). Surfacing findings is the value-add; the user routes them to fixes, deferrals, or accepted decisions through Step 6.7 if they choose.

**Routing (optional):** actionable design findings the user wants to action inline route through Step 6.7 below, in one consolidated pass with Step 6's visual findings. When the user opts not to action them inline, they remain in the Design Quality summary section as informational.

## Step 6.7: Late Findings Routing (design + visual, consolidated)

Runs **at most once** per review, after Steps 6 and 6.5 have both completed — and only when at least one of them produced actionable findings (Step 6 in full mode with actionable "UI / Visual" findings; Step 6.5 with `{result: "advisory", findings: [...]}`) AND the user opts to action findings inline. This replaces what were two sequential passes (a design-findings pass and a visual-findings pass), each with its own batch table and its own `AskUserQuestion` — one stop now covers both categories.

1. Render every actionable finding from both sources as a row in **one** batch table with a Category column, recommended actions pre-filled:

| Category | Severity source |
|---|---|
| `Design Quality` (from Step 6.5) | Wrapper output (`info` → low, `warning` → medium, `error` → high) |
| `UI / Visual` (from Step 6) | `/claude-tweaks:visual-review`'s own report classification |

2. Apply the routing rules from `step3-routing.md` to the combined table — severity-based auto routing when a pipeline run directory exists (low → AUTO, medium → STAGED, high → STAGED, critical → KEPT-PROMPT), or the interactive batch-table flow (one `AskUserQuestion` for apply-all/override) otherwise.
3. After resolution, fold each finding back into its own Step 7 summary section ("Design Quality" / "Visual Review"), noting its final status (fixed / deferred / accepted).

This pass never replays Step 3.5 (each source's findings have no peers to debate against) and never re-dispatches reproduction pairs — both sources' output is already filtered/classified before it reaches this routing. Step 3 Routing itself is untouched by this consolidation: code findings still resolve before Steps 4-5, because fixes must land before hindsight and simplification run.

## Step 7: Present Review Summary

Present a structured summary covering spec compliance, test results (from `/claude-tweaks:test`), code review findings, browser review (if run), implementation hindsight, tradeoffs, simplification, and a verdict (PASS or BLOCKED). The summary must include an Actions Performed table (when autonomous fixes were applied) and a Next Actions block (always). For the complete template, the context-signal rules, and the **compact clean-PASS form** (rendered instead of the full template when the verdict is PASS with zero findings, zero actions, and zero manual steps), read `review-summary-template.md` in this skill's directory.

**Verdict comment (`run-state.json` carries a `pr` object — `_shared/pr-run-comments.md`):** once
the verdict is final (PASS or BLOCKED), compose a comment — `<!-- run-comment: verdict -->` as
its first line, then the verdict, then the top findings by severity (max 5), reusing
`review-summary-template.md`'s own `Category | Finding | Severity | Action` findings-table shape
— and post-or-update it on the PR per that file's canonical procedure. A no-op when the `pr`
object is absent (`local-merge`, or a degraded `pr-first` run).

### Key Learnings for Wrap-Up

At the end of the summary, include a `### Key Learnings` section with 1-3 insights that emerged during this review — patterns discovered, conventions confirmed or challenged, techniques worth remembering. These feed directly into `/claude-tweaks:wrap-up`'s Phase 1 reflect pass so wrap-up doesn't have to re-derive them from scratch.

```
### Key Learnings
1. {insight} — {why it matters for future work}
2. {insight} — {why it matters}
```

If no notable learnings emerged, state: "No key learnings — straightforward review."

**Phase exit (`worktree` mode, `integration-model: pr-first` — `_shared/integration-model.md`):** push the branch and flip this phase's PR checklist row — `_shared/git-discipline.md`'s Phase-exit push section and `_shared/pr-checklist-refresh.md`'s Phase-checklist update section. A no-op under `local-merge` or `current-branch` mode.

## Important Notes

- Spec compliance is the first gate — incomplete specs go back to `/claude-tweaks:build`, not through code review
- Test passing is a hard gate — broken code blocks the entire review. Run `/claude-tweaks:test` to verify.
- Implementation Hindsight is an action gate — "change now" items must be fixed before passing
- Code simplification runs on changed files only — never expand scope to unrelated code
- Skip review lenses that don't apply to the type of change
- This skill reviews the *current work* — it is not a codebase-wide audit
- When a confirmed bug finding needs a fix that isn't a one-line mechanical correction, follow the reproduce-first discipline in `_shared/reproduce-first-discipline.md` before applying the change — don't guess at fixes during routing; once the fix is confirmed, walk the causal-depth chain per the discipline's step 3.
