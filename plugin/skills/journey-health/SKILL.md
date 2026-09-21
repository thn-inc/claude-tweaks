---
name: journey-health
description: Use to check whether docs/journeys/*.md still back reliable e2e testing — audits one journey or the due coverage scan; always files an issue. Keywords - journey health, journey drift, journey staleness, agent e2e testing, coverage gap, scheduled, routine.
argument-hint: "[--target <journey-name>] [--budget <n>] [--deep] [--dry-run] [--root <dir>] [--min-confidence <low|med|high>]"
allowed-tools: Read, Grep, Glob, Bash, Skill, Write, AskUserQuestion
---

# Journey Health — Keep Journeys Honest for Agent E2E Testing

A recurring health check for `docs/journeys/*.md`: picks one journey to audit against the codebase, judges it, and always files a `by:journey-health`-labelled, born-`ready` GitHub issue. Records enter the same gate worklist as the other health-skill producers (`/code-health`, `/harness-health`, `/docs-health`) — journey-health issues are not a separate lane. Never edits journey files, stories, or code — every fix routes through `/claude-tweaks:journeys` or `/claude-tweaks:stories`, invoked by a human directly, or by `/claude-tweaks:dispatch` → `/claude-tweaks:flow` once `/claude-tweaks:backlog refine` has granted `auto:build`.

```
              [ /claude-tweaks:journey-health ] <- utility (no fixed lifecycle position)
                           |  next-target picks a journey; coverage scan runs when due
                           v
file-existence + self-review + coverage -> finding -> validate-findings -> file GitHub issue (by:journey-health, ready)
```

## When to Use

- You want journey documentation to stay accurate — and the QA stories/agent e2e checks built on it to stay trustworthy — without manually re-walking every journey.
- You want a scheduled Routine that periodically rotates through journeys and flags drift or coverage gaps as they're found.
- You want to check one specific journey right now (`--target <name>`).

Not for: creating or updating journey content (`/claude-tweaks:journeys`' job) or generating story coverage (`/claude-tweaks:stories`' job) — this skill only judges and files; it never writes journey files or story YAMLs itself. (The deep tier's `_shared/dev-url-detection.md` call does write `stories/servers.yml` — dev-server URL cache, not journey/story content — see Step 3.5.)

## Input

`$ARGUMENTS` may contain:

- `--target <journey-name>` — manual override: audit one specific journey directly, bypassing `next-target` selection.
- `--dry-run` — emit findings; never write cursor/cache state; never call `gh`. This scopes only to Steps 5-6 (`validate-findings` and filing) — it does not skip the deep tier's real side effects. Combined with `--deep`, Step 3.5 still resolves a dev URL (possibly starting an ephemeral server), and still drives a live `/claude-tweaks:test` or `/claude-tweaks:visual-review` run, before Step 5's `--dry-run` finally suppresses the write/file step. Omit `--deep` for a side-effect-free preview.
- `--budget <n>` — audit up to `n` journeys in one firing (default 1).
- `--root <dir>` — audit a project elsewhere (default: current working directory).
- `--deep` — also run the deep tier (Step 3.5): actually execute the selected journey's QA stories or walk it live, catching drift/regressions a static check can't. Interactive only — no scheduled Routine drives this yet (see Routine Configuration).
- `--min-confidence <low|med|high>` — hold back (don't file) any finding whose `confidence` ranks below this threshold, for this firing only. Opt-in — omitting it keeps every surviving finding filing unconditionally, the current default. Threaded into Step 5's `validate-findings` calls; the scheduled Routine passes `--min-confidence high` by default (see Routine Configuration).

## Workflow

**Step 1 — SELECT: pick the next journey.**

Set `RUN_ID` once for this firing — an ISO timestamp or any stable string unique per run (same convention as `/code-health`'s `RUN_ID`) — reused everywhere this workflow needs to identify this run, including Step 5's `validate-findings --run-id` and Step 6's regressed-reopen comment.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js" next-target --root "${ROOT:-$PWD}" ${TARGET:+--target "$TARGET"} ${BUDGET:+--budget "$BUDGET"}
```

Without `--budget` (or `--budget 1`), prints `{ target: {...}|null, coverageScanDue: boolean }`. With `--budget <n>` where `n > 1`, prints `{ targets: [...], coverageScanDue: boolean }` instead — run Steps 2-6 once per entry before moving on. `--budget` only governs the light tier's rotation; Step 3.5 (the deep tier, `--deep` only) re-resolves its own single target independently and runs at most once per firing regardless of `--budget`.

Read the `why` field on whichever target came back:
- If `target` is `null` and `coverageScanDue` is `false`: nothing is due this firing. Report this to the user and stop.
- `why: "deleted-file"` — this journey has a `files:` entry that no longer exists on disk (`target.missingFiles` lists which). Takes priority over staleness and churn — light tier only, always checked before Phase 1/2. Fires once per distinct missing set, not once per firing: Step 5's light-tier `validate-findings` call records the set on the journey's cursor (`deletedFileSig`), and an unchanged set is skipped from then on, leaving the journey to the normal staleness/churn rotation until its frontmatter or the missing paths actually change. A *new* file going missing behind an already-reported one still force-picks immediately. This is why the light-tier call in Step 5 must run even when its findings file is `[]` — skipping it leaves the acknowledgement unrecorded and the same journey force-picked forever, starving every other journey's rotation.
- `why: "stale"` — this journey has not been audited in over 30 days regardless of churn.
- `why: "hotspot"` — this journey's `files:` frontmatter paths have the highest git churn since its last light-tier audit among journeys with any churn at all.
- `why: "manual"` — `--target` was passed, bypassing selection.

If `target` is `null` but `coverageScanDue` is `true`, skip straight to Step 3 (coverage scan) — the coverage scan is still due even with nothing else to audit.

**Step 2 — LIGHT TIER JUDGE (when a target was selected).**

Read the target's journey file (`target.path`) in full.

> **Parallel execution:** Use parallel tool calls aggressively — all `Read`/`test -f` existence checks across `target.filesFrontmatter`'s paths are independent and should run concurrently.

1. **File-existence check.** For each path in `target.filesFrontmatter`, check whether it still exists in the repo (`Read` or a quick `test -f`). For each missing path, emit a finding: `{ journey: target.id, category: "drift", section: "files-frontmatter", description: "files: entry '{path}' no longer exists", reason: "<how you confirmed it's missing>", confidence: "high", severity: "high", recommendation: "Run /claude-tweaks:journeys {target.id} to prune the dead entry" }`. A missing declared file is never low-severity — it means the journey's documented domain mapping is flat-out wrong.
2. **Self-review criteria.** Apply the four checks (and the structural-validity check) in `_shared/journey-self-review.md` against the journey file's actual content. For each violated check, emit a finding: `{ journey: target.id, category: "drift", section: "self-review", description: "<which check failed and why>", reason: "<the specific text/evidence>", confidence: "high"|"med", severity: "high"|"med"|"low", recommendation: "Run /claude-tweaks:journeys {target.id} to fix {check name}" }`. A structural-validity failure (missing frontmatter, missing `## Steps`, no steps) always gets `confidence: "high"`, `severity: "high"`. A real-but-non-structural check failure (persona, origin coverage, outcome clarity) gets `severity: "med"`. Purely cosmetic wording drift gets `severity: "low"`.

Collect all findings from both checks (may be zero, one, or several) into a JSON array.

**Step 3 — COVERAGE SCAN (when `coverageScanDue`, per Step 1).**

Run the computation in `_shared/journey-coverage-check.md` across all journeys and all stories (not just the Step 1 target — this is a whole-library scan). For each uncovered-journey-step result, emit a finding: `{ journey: "<journey name>", category: "coverage", section: "coverage", description: "{M} uncovered steps ({step numbers})", reason: "no story in the stories directory has journey: {journey name} covering these steps", confidence: "high", severity: "high"|"med"|"low", recommendation: "Run /claude-tweaks:stories journey={journey name}" }`. Severity scales with how much of the journey is uncovered: `"high"` when every documented step is uncovered (zero story coverage for this journey at all), `"low"` when exactly one step is uncovered, `"med"` for anything in between. For each orphaned-story-with-URL-match result, emit a finding with `journey` set to the *suggested* journey (not an existing journey's own drift, but still filed the same way): `{ journey: "<suggested journey>", category: "coverage", section: "coverage", description: "Story '{storyId}' matches journey '{journey}' but has no journey: field", reason: "story '{storyId}''s URL {url} matches a step in journey '{journey}', but the story has no journey: field linking them", confidence: "med", severity: "low", recommendation: "Add journey: {journey} to {storyFile}" }`. Skip orphaned stories with no match entirely (informational only, never a finding, per the shared fragment).

**Bundling rule (recurring root causes)** (canonical shape in `_shared/health-finding-shapes.md` — check that file when either changes to keep this skill's copy in sync with its three siblings): when two or more `category: "coverage"` findings emitted in this same coverage-scan firing share the same root cause (e.g., a single batch story deletion causing several coverage gaps at once), file **one** finding, not one per journey/story. Pick the clearest/most representative occurrence as the primary finding; list every other occurrence in `relatedSections` — since `section` is always `"coverage"` here and carries no distinguishing information, populate each entry with an identifying label for that sibling occurrence instead (e.g. `"signup-flow: steps 2,3"`, `"login-flow: steps 4"`), not the literal `section` value; make `reason` state the shared root cause explaining all of them; make `recommendation` cover every listed occurrence, not just the primary one. Only bundle occurrences that share both `category: "coverage"` AND the root cause — never bundle unrelated coverage gaps together. This never applies to Step 2's `files-frontmatter`/`self-review` findings or Step 3.5's `live-check` findings — each of those emits at most one finding per violation, so there's nothing to bundle.

Append these findings to the same array from Step 2 (Steps 2 and 3 can both produce findings in the same firing; Step 2 is skipped entirely when Step 1 returned `target: null`).

Write the combined Steps 2-3 findings array to `$JH_F_LIGHT` (session-scoped `jh-findings-light.json`, resolved via `session-tmp-resolve.js` per `_shared/session-tmp-root.md` — cited, not restated). If neither step produced any findings, write `[]`.

**Step 3.5 — DEEP TIER (only when `--deep` was passed).** Re-resolves the target for the deep tier (independent cursor from Step 1's light-tier pick), checks recent QA evidence (globs `.claude-tweaks/artifacts/screenshots/qa/*/report.json`), and — when no satisfying evidence exists — resolves a dev URL and drives a live `/claude-tweaks:test` or `/claude-tweaks:visual-review` run, judging any failure as drift vs. regression. Full procedure — the skip condition, the QA-evidence sub-step 0, dev-URL/story-coverage sub-steps 1-2, the drift-vs-regression judgment in sub-step 3, and cleanup in sub-step 4 — lives in `deep-tier.md` in this skill's directory; read it only when `--deep` was actually passed.

Write Step 3.5's findings to `$JH_F_DEEP` (session-scoped `jh-findings-deep.json`, session-tmp-root.md) whenever `deep-tier.md`'s **Otherwise:** block ran — including an empty array `[]` (the QA-evidence-satisfied path and a clean live-verification pass both produce no findings, but the file must still be written so the deep-tier call below runs and the cursor advances). Skip creating this file entirely only when Step 3.5 didn't run at all (`--deep` wasn't passed), resolved `target: null`, or hit the skip condition (missing declared file) — none of those three cases reach the **Otherwise:** block, and none of them should advance the deep-tier cursor.

**Step 3.6 — VERIFY GATE: sanity-check surviving findings before dedup.**

Before fingerprinting and dedup, re-examine every finding in `$JH_F_LIGHT` and (when Step 3.5 ran) `$JH_F_DEEP` (re-resolve both, session-tmp-root.md) and ask: is it real (does the journey file, coverage scan, or live-check evidence actually show this, or was it misread)? Is it actionable (a concrete `recommendation`, not vague)? Would running the recommended follow-up skill actually resolve it without further investigation? Is `severity` justified by the `reason` cited? Drop any finding that fails. This is the canonical shape in `_shared/health-verify-gate.md` (the same adversarial-verify discipline `/code-health` and `/docs-health` apply inline, and `/harness-health` applies via its embedded copy) — check that file when either changes to keep this skill's copy in sync with its siblings; do not skip it under time pressure, and do not skip it just because a finding came from a mechanical check (file-existence, coverage) rather than open-ended judgment; a mechanical check can still misfire (a path resolved against the wrong cwd, a story matched against the wrong journey).

**Step 4 — GATHER OPEN ISSUES for dedup.** Resolve this run's session-scoped temp paths first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" JH_ISSUES_RAW=jh-issues-raw.json JH_ISSUES=jh-issues.json)"
gh issue list --label by:journey-health --state all --json number,state,labels,body --limit 500 > "$JH_ISSUES_RAW"
```

Parse each issue body for its fingerprint marker. Fingerprint extraction reads the dual-marker form via `extractFingerprint` (`bin/lib/issues/record.js`): the current `<!-- work-fingerprint: journeyhealth-XXXXXXXX -->` marker, falling back to the legacy `<!-- journey-health-fingerprint: journeyhealth-XXXXXXXX -->` marker, then to the plain-text `work-fingerprint: journeyhealth-XXXXXXXX` companion line for an MCP-stripped body (`_shared/health-issue-index.md`). Build an array of `{ number, state, labels, fingerprint }` objects and write to `$JH_ISSUES`.

**Transport and outcomes:** read `_shared/health-issue-index.md` and apply it, with `{SKILL}` = `journey-health` and `{ISSUES_FILE}` = `$JH_ISSUES`. In short: `gh` absent means rebuild this index via the MCP `list_issues` tool, not skip the step; only a genuine "neither transport can reach GitHub" sets `ISSUES_FILE=""`, and that case gets reported rather than passing silently. A repo with no `by:journey-health` issues yet is a legitimately *empty* index (`[]`), not an unavailable one — keep the two distinct.

A matched issue carrying the `wontfix` label is a standing suppression decision: Step 5's `validate-findings` reads it directly off this issue index and skips re-filing entirely (see `_shared/work-record.md`'s `wontfix` closure row). It also persists that fingerprint to the durable `declined` slice on the `health-state` branch, so the suppression survives a later firing that cannot rebuild this index at all — the local `cache.json` is no help there, since a scheduled Routine's fresh container starts with an empty one.

**Digest-mode fold.** Before writing `$JH_ISSUES`, fold in any open digest issue's embedded checklist fingerprints per `_shared/health-filing-digest.md`'s GATHER-OPEN-ISSUES-step shape (`{PREFIX}` = `journey-health`) — this is what lets a previously-digested finding dedupe as a normal open-issue match in Step 5 rather than being re-judged or re-digested.

**Step 5 — VALIDATE, FINGERPRINT, DEDUP.**

Findings from Steps 2-3 (light tier) and Step 3.5 (deep tier) use different `--tier`/`--target` cursor keys and must never share one `validate-findings` call — each tier's own target needs its own cursor recorded independently (same discipline `/code-health`'s multi-slice `--budget` runs use: one call per distinct target).

Always run the light-tier call, even when its findings file is `[]`. Resolve this run's session-scoped paths first (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit an earlier fence's shell variables):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" JH_F_LIGHT=jh-findings-light.json JH_P_LIGHT=jh-payloads-light.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js" validate-findings "$JH_F_LIGHT" \
  --root "${ROOT:-$PWD}" --tier light \
  --run-id "${RUN_ID}" \
  ${ISSUES_FILE:+--issues "$ISSUES_FILE"} \
  ${LIGHT_TARGET_ID:+--target "$LIGHT_TARGET_ID"} \
  ${COVERAGE_SCAN_RAN:+--coverage-scan} \
  ${MIN_CONFIDENCE:+--min-confidence "$MIN_CONFIDENCE"} \
  ${DRY_RUN:+--dry-run} \
  > "$JH_P_LIGHT"
```

Run the deep-tier call whenever this run's session-scoped `jh-findings-deep.json` exists (i.e., whenever Step 3.5 reached the **Otherwise:** block, even if the file is `[]`) — this is required for `recordAudit` to fire and the deep cursor to advance on every path through that block (QA-evidence-satisfied, QA-evidence-regression, or live-verification). Re-resolve this fence's session-scoped paths too:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" JH_F_DEEP=jh-findings-deep.json JH_P_DEEP=jh-payloads-deep.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js" validate-findings "$JH_F_DEEP" \
  --root "${ROOT:-$PWD}" --tier deep \
  --run-id "${RUN_ID}" \
  ${ISSUES_FILE:+--issues "$ISSUES_FILE"} \
  --target "$DEEP_TARGET_ID" \
  ${MIN_CONFIDENCE:+--min-confidence "$MIN_CONFIDENCE"} \
  ${DRY_RUN:+--dry-run} \
  > "$JH_P_DEEP"
```

`LIGHT_TARGET_ID`/`DEEP_TARGET_ID` are the respective `target.id` values from Step 1 and Step 3.5 (omit `LIGHT_TARGET_ID` if Step 1 returned `target: null` and only the coverage scan ran; `DEEP_TARGET_ID` is required whenever the deep-tier call runs at all, since Step 3.5 always resolves a concrete journey before producing findings). Both commands validate, fingerprint, dedup, and record their own tier's cursor unless `--dry-run`, and both emit gh-ready payloads on stdout.

**Step 6 — FILE.**

Every journey-health record files onto the unified work record (`skills/_shared/work-record.md`): origin `by:journey-health`; severity folds into the scoring axis instead of staying a producer-specific label the gate must know:

| Severity | risk | size |
|---|---|---|
| `high` | `risk:high` | `size:medium` |
| `med` | `risk:medium` | `size:medium` |
| `low` | `risk:low` | `size:medium` |

Size is always `size:medium` — a journey-health finding carries no scope/size signal (no files-changed count, no lines-changed estimate) the way a code-health or harness-health finding's own evidence does, so there is no deterministic basis to fold into a `low`/`high` split; `medium` is the flat, honest default for every finding this skill files. Type follows the finding's `category`: `regression-suspected` files as `bug` (the journey/story text is accurate — the implementation broke); `drift` and `coverage` file as `task` (documentation or coverage maintenance, not a defect). Every filed finding is **born-`ready`** — journey-health findings are agent-sized and spec-shaped by construction (Current State / Deliverables / Acceptance Criteria), so they file with the `ready` label already applied and appear directly in the authorization gate's worklist, skipping maturation (per the intro, records are not a separate lane). `toIssuePayload` (`bin/lib/journey-health/issue-payload.js`) assembles the payload via `record.js`'s `recordPayload`, then appends the category-derived diagnostic label (`journey-health:drift` / `journey-health:coverage` / `journey-health:regression-suspected`) after the canonical labels — the emitted label set is exactly `by:journey-health` + `risk:<tier>` + `size:medium` + `ready` + the diagnostic label, matching the table above.

**Materiality floor, before the cap digest.** Before the drain-rate cap check below, apply `_shared/materiality-floor.md`'s floor test to any survivor whose Step 5 decision is `'file'`: a finding that fails to clear the materiality floor routes to the materiality floor's own shared digest container instead — never to `journey-health`'s per-origin `{PREFIX}:digest` cap issue described below, a separate mechanism. Only a survivor that clears the materiality floor proceeds to the cap check. **In practice no journey-health finding is below floor today:** this skill's size axis is flat (`size:medium` for every finding, per the paragraph above) while the floor requires a low size, so every survivor clears it and files as an ordinary issue. The citation is here so the ordering is already correct if that axis ever gains a low tier — not because this skill currently produces digest entries.

**Drain-rate cap and digest mode.** Before filing any survivor whose Step 5 decision is `'file'`, apply the `health-open-cap` throttle per `_shared/health-filing-digest.md`'s FILE-step shape (`{PREFIX}` = `journey-health`) — at or above the cap, the finding is appended to `journey-health`'s digest issue instead of filed as a new singleton. A `'reopen'` decision (regression) always bypasses the cap.

Before filing this firing's own new findings, drain the durable retry queue from prior firings' filing failures and check for regressed reopens (see `_shared/health-state.md`) — both mechanics below follow the canonical shape in `_shared/health-filing-mechanics.md` (`{BINARY}` = `journey-health.js`, `{PREFIX}` = `journey-health`); check that file when either changes to keep this skill's copy in sync with its three siblings. Each drained retry payload is also subject to the same cap check above before its `gh issue create` attempt. Resolve this run's session-scoped temp path first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" JH_RETRY_PAYLOADS=jh-retry-payloads.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js" retry-queue drain --root "${ROOT:-$PWD}" > "$JH_RETRY_PAYLOADS"
```

For each payload in `$JH_RETRY_PAYLOADS`, attempt `gh issue create` exactly as below. Track every attempt's outcome (retry-queue payloads AND any brand-new payload from this step's own filing loop that fails) as `[{ fingerprint, payload, ok: true }]` or `[{ fingerprint, payload, ok: false, error: "<gh's error output>" }]`, write to this run's session-scoped `jh-retry-results.json`, then re-resolve both session-scoped paths this fence needs (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the prior fence's shell variable):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" JH_RETRY_RESULTS=jh-retry-results.json JH_ESCALATED=jh-escalated.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js" retry-queue update "$JH_RETRY_RESULTS" --root "${ROOT:-$PWD}" > "$JH_ESCALATED"
```

If `$JH_ESCALATED` is non-empty, file (or update) a `journey-health:filing-failed` issue for each entry, naming the stuck fingerprint and its failure history — bootstrap that label the same way as the others below.

Before filing, bootstrap only the label families this run applies, with real descriptions — using the shared helper so a too-long description fails loudly here rather than as a 422 on `gh issue create`. `by:journey-health`, `risk:*`, `size:medium`, `ready`, and `upstream-candidate` are canonical pairs from `_shared/label-bootstrap.md`'s `LABELS_JSON` — copy their descriptions from there rather than duplicating them here. Journey-health's own diagnostic labels aren't in that shared set, so bootstrap them with these descriptions: `journey-health:drift` ("Journey category: the journey file no longer matches the codebase"), `journey-health:coverage` ("Journey category: a journey step or story has a coverage gap"), `journey-health:regression-suspected` ("Journey category: live behavior appears to have regressed"), `journey-health:filing-failed` ("Escalation: gh issue create failed repeatedly for this fingerprint — needs human attention").

Each payload in `$JH_P_LIGHT` and (when Step 3.5 ran) `$JH_P_DEEP` (Step 5's session-scoped output, `_shared/session-tmp-root.md`) carries structured fields, not just the GitHub issue text — `id`, `journey`, `category`, `section`, `severity`, `confidence` are all present directly on the payload object (not just embedded in `payload.body`'s markdown), alongside `title`, `body`, `labels`, and `type`. These stay on the payload as triage metadata — nothing here branches on them anymore.

**Subject check before filing.** Apply the "Subject check (health sweeps)" section of `skills/_shared/learning-routing.md` — a finding about a claude-tweaks skill is a D5 learning routed to `/claude-tweaks:feedback`, not a project issue.

For a payload whose fingerprint marker (embedded in `payload.body`, read via `extractFingerprint`) matches a `status: "regressed"` entry in `.claude-tweaks/journey-health/cache.json` after this run, the finding was previously closed and has reappeared — reopen the existing issue instead of filing a new one:

```bash
gh issue reopen <issue_number>
gh issue comment <issue_number> --body "Regressed: this finding reappeared. Run: ${RUN_ID}"
```

`<issue_number>` is that cache entry's `issue` field.

**Interactive mode only — the ask-before-file gate.** Before filing this firing's own new findings (not the retry-queue drains or regressed reopens above, which already executed unconditionally), read `_shared/health-filing-gate.md` and follow its two-tier decision, using its per-consumer batch table's `journey-health` row for the table columns and the Recommended pre-fill rule.

**Headless (Routine) runs skip this gate entirely** — do not read that file — per `_shared/health-filing-gate.md`'s applicability rule; every surviving finding files automatically, with no human to route it through a table.

For each survivor disposed as "File issue" (every payload if "Apply all recommended" was chosen and its Recommended value was `"File issue"`; only the individually-overridden ones otherwise), call `gh issue create` per the branch below.

**Type expression branch** (canonical shape in `_shared/health-finding-shapes.md` — check that file when either changes to keep this skill's copy in sync with its three siblings). Read the project's `work-types` config key once before filing and branch — never re-probe mid-flow (`_shared/work-record.md`'s config-key table; the key is written by `/init`). `work-types: native` applies `payload.type` (`bug` for a `regression-suspected` finding, `task` for `drift`/`coverage`) via GitHub's native Issue Type; `work-types: labels` adds the matching `type:bug`/`type:task` label instead (the pairs live in `record.js`'s `TYPE_LABELS`):

```bash
# Example: a drift finding (type task), work-types: native
gh issue create --title "<payload.title>" --body "<payload.body>" --type task \
  --label by:journey-health --label risk:high --label size:medium --label ready --label journey-health:drift

# Same finding, work-types: labels
gh issue create --title "<payload.title>" --body "<payload.body>" \
  --label by:journey-health --label risk:high --label size:medium --label ready --label journey-health:drift --label type:task

# Example: a regression-suspected finding (type bug), work-types: native
gh issue create --title "<payload.title>" --body "<payload.body>" --type bug \
  --label by:journey-health --label risk:medium --label size:medium --label ready --label journey-health:regression-suspected

# Same finding, work-types: labels
gh issue create --title "<payload.title>" --body "<payload.body>" \
  --label by:journey-health --label risk:medium --label size:medium --label ready --label journey-health:regression-suspected --label type:bug
```

**Exception — a headless D5 finding.** When the subject check routed this finding to D5 and no human is present to clear `/claude-tweaks:feedback`'s confirmation gate, this payload is the one case where the label set differs: apply `upstream-candidate` plus `by:journey-health`, and omit `ready`, `risk:*` and `size:*` entirely. It is not this project's work to build. See `skills/_shared/learning-routing.md`'s "Subject check (health sweeps)".

Apply the same branch to every payload regardless of category — a `coverage` payload's call carries `journey-health:coverage` and `--type task`/`--label type:task` the same way a `drift` payload does; only the `--type task`/`--type bug` vs. `--label type:task`/`--label type:bug` branch and the `--label` list change, never the underlying `gh issue create --title/--body`. `/journey-health` never edits journey files, stories, or code.

**Recent-commit overlap check.** After each `gh issue create` above succeeds, run `_shared/health-recent-commit-check.md` in full.

In `--dry-run` mode, print what would be filed or reopened, and the `gh` commands that would run, but do not call `gh`.

**Step 7 — SUMMARIZE.**

Report: which journey (if any) was audited, whether the coverage scan ran, how many findings were emitted, how many filed vs skipped by dedup. When Step 3.5 ran, also report: which journey was deep-audited (or that nothing was due, or that it was skipped for missing `files:` entries), and the drift-vs-regression verdict for any live-check failure. List any new issue URLs. Always include the throttle line per `_shared/health-filing-digest.md`'s SUMMARIZE step: `filed: N, digested: M, cap: {CAP}, materiality: K` — report it even when `M` and `K` are both `0`, so the throttle is visible rather than inferred.

## Routine Configuration

`/journey-health` ships a routine template (`skills/journey-health/routine-template.yml`) designed for small, predictable sips: one journey per run, so a scheduled firing is cheap and a skipped one is harmless. Instantiate it for the current project with:

```
/claude-tweaks:routine create journey-health
```

**Headless run flow:** SELECT(`next-target`) → LIGHT TIER JUDGE → COVERAGE SCAN (when due) → validate-findings → file. A firing with nothing due (`target: null`, `coverageScanDue: false`) is a cheap no-op. Rotation cursors (light/deep audit + coverage-scan) and the filing retry queue live on the durable `health-state` branch (`_shared/health-state.md`), surviving container recycling across scheduled firings.

Report-only, matching `/code-health` and `/harness-health` — every finding files as a `by:journey-health`-labelled, born-`ready` GitHub issue, with no `Edit` in `allowed_tools`.

**Confidence floor on headless firings.** `routine-template.yml`'s prompt passes `--min-confidence high` by default, so a scheduled firing only files `confidence: high` findings automatically — `med`/`low` findings are held back for that firing (see `--min-confidence` in Input). This closes the asymmetry `/code-health`'s `--min-risk` flag closed for that skill, though the mechanism differs: `--min-risk` diverts below-threshold findings into a durable `remembered` cache that can later escalate; `--min-confidence` simply drops a below-threshold finding for this run only (journey-health has no `remembered` cache tier), so it re-surfaces fresh on a future firing rather than resuming from where it was held. Lower the bar (`--min-confidence med` or omit the flag) in the routine's prompt for a noisier, more complete firing.

> **Billing note:** Routines run inside the subscription; verify automation-credit specifics against the live account. (Canonical text in `_shared/health-routine-notes.md` — shared with `/code-health`, `/harness-health`, and `/docs-health`.)

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention). Bold the `/claude-tweaks:routine create journey-health` line and suffix it `(recommended)` once a first standalone run confirms the output looks right; before that, render all three lines unranked in the order below.

**`/claude-tweaks:routine create journey-health`** — schedule this as a recurring Routine (recommended once a first standalone run confirms the output looks right)
`/claude-tweaks:journey-health --target <name>` — audit one specific journey right now
`/claude-tweaks:tidy` — fold any filed journey-health issues into a backlog-hygiene pass

## Component-Skill Contract

`/claude-tweaks:journey-health` is a **standalone-only** skill — no invocation path exists from `/claude-tweaks:flow` or any other skill in this project today (`flow/SKILL.md`'s Allowed Steps table and workflow text never mention `journey-health`, and `docs/skill-graph.md` records no edge from `/flow`). The `## Next Actions` block always renders. If a future orchestrator wraps this skill, that orchestrator must update this contract to state its own `$PIPELINE_RUN_DIR`-gated handoff; until then, treat parent invocation as not applicable.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Editing a journey file, story YAML, or code directly | `/journey-health` only judges and files — fixes route through `/claude-tweaks:journeys` or `/claude-tweaks:stories`, run by a human or by `/claude-tweaks:dispatch` → `/claude-tweaks:flow` once `/claude-tweaks:backlog refine` granted `auto:build`. |
| Treating a `files:` entry that exists but is content-stale the same as a missing one | Missing-on-disk is a mechanical file-existence finding; content drift is a self-review or deep-tier one. Don't conflate the two `section` values. |
| Re-proposing a patch already marked `declined` in the cache | The decline-memory cache exists so a rejected proposal doesn't reappear every firing. |
| Skipping the coverage scan because a per-journey target was already selected this firing | It's a decoupled whole-library check with its own cursor — run it whenever `coverageScanDue` is true, whatever `next-target` picked. |
| Treating the local cache as durable state | The cache is a rebuildable optimization — GitHub issue state is the cross-run source of truth, as in `/code-health`/`/harness-health`. |
| Running the deep tier's dev server without stopping it afterward | No `/wrap-up` cleans up after a standalone run — this skill's Step 3.5 must stop any ephemeral server it started, per `_shared/dev-url-detection.md`'s "Standalone" cleanup rule. |
| Splitting one recurring root cause into N near-duplicate issues instead of bundling | Floods the tracker with one fix applied to N sections — use `relatedSections` to cover every occurrence in one finding. |
| Filing before presenting the interactive gate | The two-tier decision must precede any `gh issue create` for new findings — `_shared/health-filing-gate.md`'s placement rule. |
| Skipping Step 3.6's verify gate under time pressure | Mechanical checks misfire — a path resolved against the wrong cwd, a story matched to the wrong journey. Every surviving finding must pass it before Step 4's dedup, as in `/code-health`, `/harness-health`, and `/docs-health`. |
