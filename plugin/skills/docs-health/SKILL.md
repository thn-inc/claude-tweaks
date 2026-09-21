---
name: docs-health
description: Use for docs/** audits: Diátaxis drift, depth-mismatch, findability, staleness; dedups + files. Never edits docs. Keywords - docs-health, Diátaxis, genre drift, depth mismatch, findability, orphan docs, staleness, proactive, github issues, scheduled, routine.
argument-hint: "[--target <id>] [--dir <path>] [--budget <n>] [--min-confidence low|med|high] [--dry-run] [--root <dir>]"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion
---

# Docs Health — Diátaxis Genre-Drift + Depth-Mismatch + Findability + Staleness Sweep for docs/**

A recurring health check for `docs/**`: picks one doc to audit, judges it against the shared `_shared/criteria-docs-diataxis.md` procedure (implied-type-vs-found-type and placement-vs-content genre-drift, implied-vs-found depth-mismatch, inbound-reference findability, factual staleness including declared freshness-dependencies, dual-persona misleading-risk), and files a `by:docs-health`-labelled, born-`ready` GitHub issue. Never edits docs — only files findings, mirroring `/code-health` and `/harness-health`.

```
              [ /claude-tweaks:docs-health ] <- utility (no fixed lifecycle position)
                           |  picks a target via next-target; judges via the shared criteria fragment
                           v
finding -> validate-findings -> file GitHub issue (by:docs-health, ready)
```

## When to Use

- You want `docs/**` (guides, references, ADRs, retrospectives) to stay accurate, appropriately scoped, and correctly shaped — Diátaxis genre where it applies, native genre otherwise (an ADR stays ADR-shaped, not forced into a tutorial/how-to/reference/explanation mold) — between manual edits, without driving each check yourself.
- You want a scheduled Routine that periodically rotates through `docs/**` and flags genre-drift, depth-mismatch, findability, or staleness as it's found.
- You want to check one specific doc right now (`--target <id>`).

Not for: mechanical/unambiguous checks (broken links, malformed frontmatter, missing structural metadata) — those belong in the consuming project's own build/CI pipeline, the same "CI stays reactive" boundary `/code-health` already draws for code. Not for `.claude/skills/*.md`/`.claude/rules/*.md`/CLAUDE.md — that is `/claude-tweaks:harness-health`'s exclusive territory; docs-health's rotation pool only ever walks `docs/`, so it structurally never touches those files. Not for `docs/superpowers/**` — the historical design-doc archive (`docs/superpowers/specs/` and `docs/superpowers/plans/`, the output of `/claude-tweaks:specify` + `/superpowers:writing-plans`), kept as a permanent record of shipped work and pruned in bulk as a separate deliberate maintenance action (`docs/decisions/0007-*`), never as a drift finding. These documents describe work that already shipped, so they are *supposed* to read as stale — auditing them for drift would spend the rotation's largest reads on findings that are correct by design. Excluded from the rotation pool entirely, matched on the full path `docs/superpowers` and not on a name substring: `docs/plans/` (live ephemeral pipeline state) is near-identically named and deliberately stays **in** scope. Not for `docs/journeys/**` — that is `/claude-tweaks:journey-health`'s exclusive territory (journey accuracy and agent-e2e coverage instead of Diátaxis genre-drift); excluded from the rotation pool entirely, mirroring the harness-health exclusion above.

## Input

`$ARGUMENTS` may contain:

- `--target <id>` — manual override: audit one specific doc directly, bypassing `next-target` selection. `<id>` is the doc's path relative to `docs/`, without the `.md` extension (e.g. `decisions/0007-foo`).
- `--dir <path>` — restrict `next-target`'s candidate pool to docs under one subdirectory of `docs/` (e.g. `decisions`, `guides/setup`); the normal stale/hotspot rotation logic still applies within that subset. Combine with `--budget <n>` for a focused multi-doc sweep over just one area. Ignored when `--target` is also passed.
- `--dry-run` — emit findings; never write cursor/cache state; never call `gh`.
- `--budget <n>` — audit up to `n` docs in one firing (default 1).
- `--min-confidence <low|med|high>` — minimum `confidence` tier that gets filed as a GitHub issue (default: no floor — every surviving finding files, matching today's behavior). Findings below this are held in the durable `remembered` cache instead of being dropped or filed, mirroring `/code-health`'s `--min-risk` mechanism. Pass `--min-confidence med` (or `high`) for a quieter run, e.g. a scheduled headless Routine firing.
- `--root <dir>` — audit a project elsewhere (default: current working directory).

## Workflow

**Step 1 — SELECT: pick the next target(s).**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/docs-health.js" next-target --root "${ROOT:-$PWD}" ${TARGET:+--target "$TARGET"} ${DIR:+--dir "$DIR"} ${BUDGET:+--budget "$BUDGET"}
```

Without `--budget` (or `--budget 1`), prints `{ target: { kind, id, path, why } | null }` — a single target. With `--budget <n>` where `n > 1`, prints `{ targets: [{ kind, id, path, why }, ...] }` instead — up to `n` targets, each a different id.

> **Parallel execution (conditional):** When `--budget n` (n > 1) is in effect, dispatch each target's Step 2 (READ) + Step 3 (JUDGE) as a parallel Task agent — each independently reads its own doc and returns that target's findings array (see the dispatch template below). Otherwise (the `--budget 1` default), run Steps 2-3 sequentially in the main thread. Dispatch shape: single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) applies.

**Multi-target runs (`--budget > 1`):** treat each array entry as its own full sweep: run Steps 2-6 in their entirety for target 1 (including its own `validate-findings --target <id>` call in Step 5 and its own Step 6 filing), then repeat the full Steps 2-6 for target 2, and so on. Never collect findings from multiple targets into one shared `validate-findings` call — each target needs its own `--target` value so its audit cursor persists independently (`bin/docs-health.js`'s `validate-findings` hard-gates on `--target` being present for any non-dry-run call, since docs-health has no gap-scan-equivalent fallback for cursor advancement). A run that audits 3 targets makes 3 separate `validate-findings` invocations, not 1. Once every target has been swept, move on to Step 7 to summarize all of them together.

When dispatching Steps 2-3 in parallel, build each target's prompt by inlining the body of `judge-procedure.md` (below its horizontal rule) from this skill's directory **verbatim**, wrapped in the frame below. Substitute `{target.path}`, `{target.id}`, `{plugin-root}` (the resolved `$CLAUDE_PLUGIN_ROOT`), and `{root}` (the resolved `${ROOT:-$PWD}`) throughout before dispatch.

Inline it literally — do not pass a path to it. Agents only see what's in their own prompt, so a pointer to `judge-procedure.md`, to this SKILL.md, or to any `_shared/` fragment does not reach them, and an agent that cannot resolve a reference emits malformed output rather than merely expensive output.

```
Task scope: Read and judge one doc for docs-health findings. Read-only — do not modify any file.

Read `{target.path}` in full.

If the file is larger than 40,000 bytes, do not read it whole. Instead: read its frontmatter and complete heading outline (`grep -n '^#\{1,6\} ' "{target.path}"`); read the first and last top-level sections in full; read any further section on demand as a specific signal points at it. Regardless of size, enumerate every fenced shell command block in the whole file — grep it for lines whose first non-whitespace characters are three backticks — and execute each one per point 6. Redirect each command's output to a temp file and inspect only its exit status plus `tail -20` — the check is whether the command still works, not what it prints; widen to the full temp-file output only when a command fails or its tail contradicts what the doc claims. A partial read never shrinks that sweep. Cap `confidence` at `med` for any finding resting on content you did not read in full, and say so in that finding's `reason`.

<<< the body of judge-procedure.md, inlined verbatim and placeholder-substituted >>>

OUTPUT FORMAT (required):
A JSON array of findings in exactly the shape shown in this prompt (empty array `[]` if none).
Status line (required): the last non-empty line of your reply must read exactly `STATUS: DONE` (or DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), after the JSON array.
Do not add narration before or after the JSON array and status line.

[Use: Standard] (contract § Model Selection — multi-file judgment, format-sensitive output)
```

Assemble each target's returned findings before continuing that target's own Step 3.5 VERIFY GATE onward — Steps 3.5-6 still run per-target, sequentially, in the main thread, since they touch shared state (the issue index, dedup cache, filing) that cannot safely run in parallel Task agents.

Read the `why` field on whichever target(s) came back:
- If `target`/`targets` is empty: nothing is due this firing. Report this to the user and stop.
- `why: "stale"` — this doc has not been audited in over 60 days regardless of churn.
- `why: "hotspot"` — this doc (or its own backtick-quoted referenced paths) has the highest churn since its last audit among docs with any churn at all.
- `why: "manual"` — `--target` was passed, bypassing selection.

**Step 2 — READ the target.**

Check the file's size first, then read `target.path` in full unless it exceeds the byte cap defined immediately below. If `docs/` doesn't exist yet, report "no docs/ tree to audit yet" and stop (a real state, not an error).

**Byte cap — partial read above 40,000 bytes.** The rotation pool is Diátaxis-portal content only (`docs/superpowers/**` and `docs/journeys/**` are excluded from it by construction — see Step 1), so a target this large is rare and is itself a signal worth judging rather than a routine cost. Above the cap, do not read the whole file. Instead:

1. Read the frontmatter and the complete heading outline (`grep -n '^#\{1,6\} ' "${TARGET_PATH}"`).
2. Read the first and last top-level sections in full — the first carries the doc's implied type and depth promise, the last carries whatever it trailed off into.
3. Read any additional section on demand, as a specific signal points at it (a heading whose language contradicts the outline's shape, a section named in a `check-freshness` result).
4. **Regardless of the cap, enumerate every fenced shell command block in the whole file** — grep `${TARGET_PATH}` for lines whose first non-whitespace characters are three backticks — and execute each one per point 6 of `judge-procedure.md`. Redirect each command's output to a temp file and inspect only its exit status plus `tail -20` — the check is whether the command still works, not what it prints; widen to the full temp-file output only when a command fails or its tail contradicts what the doc claims. A partial read never shrinks that sweep: Step 3.5's gate hard-checks it before any `no findings` conclusion, and a command block skipped because it sat in an unread section is exactly the failure that gate exists to catch.

Cap `confidence` at `med` for any finding whose evidence rests on content not read in full — a found-type or depth judgment over a partial read is inherently weaker than one over the whole doc — and say so in that finding's `reason`. A staleness finding anchored to a specific line you did read keeps its normal confidence.

**Step 3 — JUDGE the target.**

Read `judge-procedure.md` in this skill's directory and apply its body (everything below the horizontal rule) to the target's content, substituting `{target.path}`/`{target.id}` from Step 1, `{plugin-root}` (`$CLAUDE_PLUGIN_ROOT`), and `{root}` (`${ROOT:-$PWD}`). It covers, in order: non-Diátaxis-native genre detection, genre-drift and placement-fit (`word-count`), depth-mismatch, findability (`find-refs`), staleness including declared freshness-dependencies (`check-freshness`) and the mandatory execute-every-command-block sweep, then the `misleads`/`classification`/`confidence`/`reversibility` judgments, the bundling rule, and the finding schema to emit.

That file is the single source of truth for this procedure — the parallel dispatch prompt in Step 1 inlines the same body verbatim rather than restating it. Its deeper rationale (the Diátaxis dimensions, dual-persona misleading-risk, and the constraints on what not to flag) lives in `_shared/criteria-docs-diataxis.md`; `judge-procedure.md` is self-contained and does not require reading it.

`confidence` drives Step 6's interactive-gate Recommended-column pre-fill (`high`/`med` → File issue; `low` → Capture).

Write the array to this run's session-scoped `docs-health-findings.json` (`_shared/session-tmp-root.md`; resolve via `eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" DOCS_HEALTH_FINDINGS=docs-health-findings.json)"` in whichever fence writes it).

**Step 3.5 — VERIFY GATE: sanity-check surviving findings before dedup.**

Before fingerprinting and dedup, re-examine each finding and ask: is it real (does the doc actually say this, or was it misread)? Is it actionable (a concrete `oldString`/`newString`, not vague)? Would a human editor be able to apply the fix without further investigation? Is `misleads` justified by which reader would actually encounter this doc's failure mode? Does `newString` conform to the contract that governs the target — when the edit writes into a structured field whose vocabulary is defined elsewhere in the repo (a ledger `Status` cell, a policy key, a frontmatter facet, a label name), locate that definition and check the proposed value against it? Drop any finding that fails. This gate also doubles as the last checkpoint before declaring a `no findings` result for this doc: if the doc contains any literal shell command block the reader is instructed to run, confirm it was actually executed per point 6 of `judge-procedure.md` — not just cross-referenced via grep/find/git log, and not just recalled from a prior pass — before finalizing `no findings`; a `no findings` conclusion reached without running an example command the doc contains does not pass this gate. This is the canonical shape in `_shared/health-verify-gate.md` (the same adversarial-verify discipline `/code-health` and `/journey-health` apply inline, and `/harness-health` applies via its embedded copy) — check that file when either changes to keep this skill's copy in sync with its siblings; do not skip it under time pressure.

**Step 4 — GATHER OPEN ISSUES for dedup.** Resolve this run's session-scoped temp paths first, per `_shared/session-tmp-root.md` (cited throughout this file rather than restated):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" DOCS_HEALTH_ISSUES_RAW=docs-health-issues-raw.json DOCS_HEALTH_ISSUES=docs-health-issues.json)"
gh issue list --label by:docs-health --state all --json number,state,labels,body --limit 500 > "$DOCS_HEALTH_ISSUES_RAW"
```

Parse each issue body for its fingerprint marker via `extractFingerprint` (`bin/lib/issues/record.js`): the `<!-- work-fingerprint: docshealth-XXXXXXXX -->` marker, falling back to the plain-text `work-fingerprint: docshealth-XXXXXXXX` companion line for an MCP-stripped body (`_shared/health-issue-index.md`). Build an array of `{ number, state, labels, fingerprint }` objects and write to `$DOCS_HEALTH_ISSUES`.

**Transport and outcomes:** read `_shared/health-issue-index.md` and apply it, with `{SKILL}` = `docs-health` and `{ISSUES_FILE}` = `$DOCS_HEALTH_ISSUES`. In short: `gh` absent means rebuild this index via the MCP `list_issues` tool, not skip the step; only a genuine "neither transport can reach GitHub" sets `ISSUES_FILE=""`, and that case gets reported rather than passing silently. A repo with no `by:docs-health` issues yet is a legitimately *empty* index (`[]`), not an unavailable one — keep the two distinct.

A matched issue carrying the `wontfix` label is a standing suppression decision: Step 5's `validate-findings` reads it directly off this issue index and skips re-filing entirely (see `_shared/work-record.md`'s `wontfix` closure row). It also persists that fingerprint to the durable `declined` slice on the `health-state` branch, so the suppression survives a later firing that cannot rebuild this index at all — the local `cache.json` is no help there, since a scheduled Routine's fresh container starts with an empty one.

**Digest-mode fold.** Before writing `$DOCS_HEALTH_ISSUES`, fold in any open digest issue's embedded checklist fingerprints per `_shared/health-filing-digest.md`'s GATHER-OPEN-ISSUES-step shape (`{PREFIX}` = `docs-health`) — this is what lets a previously-digested finding dedupe as a normal open-issue match in Step 5 rather than being re-judged or re-digested.

**Step 5 — VALIDATE, FINGERPRINT, DEDUP.** Re-resolve this run's session-scoped paths first (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the prior fence's shell variables):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" DOCS_HEALTH_FINDINGS=docs-health-findings.json DOCS_HEALTH_PAYLOADS=docs-health-payloads.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/docs-health.js" validate-findings "$DOCS_HEALTH_FINDINGS" \
  --root "${ROOT:-$PWD}" \
  ${ISSUES_FILE:+--issues "$ISSUES_FILE"} \
  ${TARGET_ID:+--target "$TARGET_ID"} \
  ${MIN_CONFIDENCE:+--min-confidence "$MIN_CONFIDENCE"} \
  ${DRY_RUN:+--dry-run} \
  > "$DOCS_HEALTH_PAYLOADS"
```

`TARGET_ID` is that target's `.id` from Step 1 — always pass it for a real (non-dry-run) run: the CLI hard-gates on `--target` being present whenever `--dry-run` is not passed (docs-health has no gap-scan-equivalent fallback for cursor advancement, unlike harness-health/journey-health), and exits 2 if it's omitted. Omit only in `--dry-run` mode when previewing without a specific target. The command validates each finding, fingerprints via `assetType + target + section + normalizedDescription`, dedups against open `by:docs-health` issues and the local cache, records the audit cursor for `doc:${TARGET_ID}` unless `--dry-run`, holds any finding below `--min-confidence` in the durable `remembered` cache instead of filing it, and emits gh-ready payloads on stdout.

**Step 6 — FILE.**

Every docs-health record files onto the unified work record (`skills/_shared/work-record.md`): origin `by:docs-health`; classification folds into the scoring axis:

| Classification | risk | size |
|---|---|---|
| `additive` | `risk:low` | `size:low` |
| `restructural` | `risk:medium` | `size:high` |

Every filed finding is **born-`ready`** — docs-health findings are agent-sized and spec-shaped by construction (Current State / Deliverables / Acceptance Criteria), so they file with the `ready` label already applied and appear directly in the authorization gate's worklist, skipping maturation. `toIssuePayload` (`bin/lib/docs-health/issue-payload.js`) assembles the payload via `record.js`'s `recordPayload`, then appends the classification-derived diagnostic label (`docs-health:additive` / `docs-health:restructural`) after the canonical labels — the emitted label set is exactly `by:docs-health` + scoring + `ready` + the diagnostic label.

**Materiality floor, before the cap digest.** Before the drain-rate cap check below, apply `_shared/materiality-floor.md`'s floor test to any survivor whose Step 5 decision is `'file'`: a finding that fails to clear the materiality floor routes to the materiality floor's own shared digest container instead — never to `docs-health`'s per-origin `{PREFIX}:digest` cap issue described below, a separate mechanism. Only a survivor that clears the materiality floor proceeds to the cap check.

**Drain-rate cap and digest mode.** Before filing any survivor whose Step 5 decision is `'file'`, apply the `health-open-cap` throttle per `_shared/health-filing-digest.md`'s FILE-step shape (`{PREFIX}` = `docs-health`) — at or above the cap, the finding is appended to `docs-health`'s digest issue instead of filed as a new singleton. A `'reopen'` decision (regression) always bypasses the cap.

Before filing this firing's own new findings, drain the durable retry queue from prior firings' filing failures and check for regressed reopens (see `_shared/health-state.md`) — both mechanics below follow the canonical shape in `_shared/health-filing-mechanics.md` (`{BINARY}` = `docs-health.js`, `{PREFIX}` = `docs-health`); check that file when either changes to keep this skill's copy in sync with its three siblings. Each drained retry payload is also subject to the same cap check above before its `gh issue create` attempt. Resolve this run's session-scoped temp path first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" DOCS_HEALTH_RETRY_PAYLOADS=docs-health-retry-payloads.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/docs-health.js" retry-queue drain --root . > "$DOCS_HEALTH_RETRY_PAYLOADS"
```

For each payload in `$DOCS_HEALTH_RETRY_PAYLOADS`, attempt `gh issue create` exactly as below. Track every attempt's outcome (retry-queue payloads AND any brand-new payload from this step's own filing loop that fails) as `[{ fingerprint, payload, ok: true }]` or `[{ fingerprint, payload, ok: false, error: "<gh's error output>" }]`, write to this run's session-scoped `docs-health-retry-results.json`, then re-resolve both session-scoped paths this fence needs (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the prior fence's shell variable):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" DOCS_HEALTH_RETRY_RESULTS=docs-health-retry-results.json DOCS_HEALTH_ESCALATED=docs-health-escalated.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/docs-health.js" retry-queue update "$DOCS_HEALTH_RETRY_RESULTS" --root . > "$DOCS_HEALTH_ESCALATED"
```

If `$DOCS_HEALTH_ESCALATED` is non-empty, file (or update) a `docs-health:filing-failed` issue for each entry, naming the stuck fingerprint and its failure history — bootstrap that label the same way as the others below.

**Subject check before filing.** Apply the "Subject check (health sweeps)" section of `skills/_shared/learning-routing.md` — a finding about a claude-tweaks skill is a D5 learning routed to `/claude-tweaks:feedback`, not a project issue.

For a payload whose fingerprint marker (embedded in `payload.body`, read via `extractFingerprint`) matches a `status: "regressed"` entry in `.claude-tweaks/docs-health/cache.json` after this run, the finding was previously closed and has reappeared — reopen the existing issue instead of filing a new one:

```bash
gh issue reopen <issue_number>
gh issue comment <issue_number> --body "Regressed: this finding reappeared. Run: ${RUN_ID}"
```

`<issue_number>` is that cache entry's `issue` field.

Before filing, bootstrap only the label families this run applies, with real descriptions — using the shared helper so a too-long description fails loudly here rather than as a 422 on `gh issue create`. Canonical pairs copied verbatim from `_shared/label-bootstrap.md`'s `LABELS_JSON`, plus docs-health's own diagnostic labels:

```bash
# Bootstrap per _shared/label-bootstrap.md, LABELS_JSON =
# [["by:docs-health",  "Origin: filed by the docs-health skill"],
#  ["risk:low",         "Scoring: low blast radius — safe for autonomous build"],
#  ["risk:medium",      "Scoring: moderate blast radius — review before merge recommended"],
#  ["size:low",         "Scoring: small, agent-sized change"],
#  ["size:high",        "Scoring: large change — consider decomposition before building"],
#  ["ready",            "Stage: spec-shaped and agent-sized — in the authorization gate's worklist"],
#  ["upstream-candidate", "A headless health-sweep finding about claude-tweaks — forward via /claude-tweaks:feedback"],
#  ["docs-health:additive",     "Safe, mechanical patch — additive change with no removed content"],
#  ["docs-health:restructural", "Structural change requiring human review before applying"],
#  ["docs-health:filing-failed", "Escalation: gh issue create failed repeatedly for this fingerprint — needs human attention"]]
```

Each payload in `$DOCS_HEALTH_PAYLOADS` carries structured fields directly (`id`, `target`, `assetType`, `category`, `misleads`, `section`, `classification`, `confidence`, `reversibility`), alongside `title`, `body`, `labels`, and `type`. These stay on the payload as triage metadata — the batch table below reads `category`/`misleads`/`classification`/`confidence`, and the dismiss path reads `id`. The finding's `oldString`/`newString` patch text is deliberately **not** duplicated as top-level fields: `payload.body` already carries both verbatim in its fenced Current/Proposed blocks, and that markdown is what ships to GitHub. Read the patch out of `body` if you need it.

**Interactive mode only — the ask-before-file gate.** Before filing this firing's own new findings (not the retry-queue drains or regressed reopens above, which already executed unconditionally), read `_shared/health-filing-gate.md` and follow its two-tier decision, using its per-consumer batch table's `docs-health` row for the table columns and the Recommended pre-fill rule.

**Headless (Routine) runs skip this gate entirely** — do not read that file — per `_shared/health-filing-gate.md`'s applicability rule; every surviving finding files automatically, with no human to route it through a table.

For each survivor disposed as "File issue" (every payload if "Apply all recommended" was chosen and its Recommended value was `"File issue"`; only the individually-overridden ones otherwise), call `gh issue create`.

**Type expression branch** (canonical shape in `_shared/health-finding-shapes.md` — check that file when either changes to keep this skill's copy in sync with its three siblings). Read the project's `work-types` config key once before filing and branch — never re-probe mid-flow (`_shared/work-record.md`'s config-key table). `work-types: native` applies `payload.type` (always `task`) via GitHub's native Issue Type; `work-types: labels` adds the matching `type:task` label instead:

```bash
# work-types: native
gh issue create --title "<payload.title>" --body "<payload.body>" --type task \
  --label by:docs-health --label risk:low --label size:low --label ready --label docs-health:additive

# work-types: labels
gh issue create --title "<payload.title>" --body "<payload.body>" \
  --label by:docs-health --label risk:low --label size:low --label ready --label docs-health:additive --label type:task
```

**Exception — a headless D5 finding.** When the subject check routed this finding to D5 and no human is present to clear `/claude-tweaks:feedback`'s confirmation gate, this payload is the one case where the label set differs: apply `upstream-candidate` plus `by:docs-health`, and omit `ready`, `risk:*` and `size:*` entirely. It is not this project's work to build. See `skills/_shared/learning-routing.md`'s "Subject check (health sweeps)".

Apply the same branch to every payload regardless of classification — a `restructural` payload's call carries `risk:medium`/`size:high`/`docs-health:restructural` instead. `/docs-health` never edits anything directly; matching `/code-health`/`/harness-health`, it only ever judges and files.

**Recent-commit overlap check.** Immediately after each `gh issue create` above succeeds for a new finding, run `_shared/health-recent-commit-check.md` and apply it in full — it screens the just-filed finding against recently-merged commits and, on a strong match, posts a triage comment rather than blocking or reopening anything.

In `--dry-run` mode, print what would be filed or reopened, and the `gh` commands that would run, but do not call `gh`.

**Step 7 — SUMMARIZE.**

Report: which target(s) were audited, how many findings were emitted, how many filed vs skipped by dedup. List any new issue URLs. Always include the throttle line per `_shared/health-filing-digest.md`'s SUMMARIZE step: `filed: N, digested: M, cap: {CAP}, materiality: K` — report it even when `M` and `K` are both `0`, so the throttle is visible rather than inferred.

## Routine Configuration

`/docs-health` ships a routine template (`skills/docs-health/routine-template.yml`) designed for small, predictable sips: one target per run, so a scheduled firing is cheap and a skipped one is harmless. Instantiate it for the current project with:

```
/claude-tweaks:routine create docs-health
```

**Headless run flow:** SELECT(`next-target`) → JUDGE → validate-findings → file. A firing with nothing due (`target: null`) is a cheap no-op.

Report-only, matching `/code-health`/`/harness-health` — every finding files as a `by:docs-health`-labelled, born-`ready` GitHub issue, with no `Edit` call anywhere in its documented workflow. Rotation cursors and the filing retry queue live on the durable `health-state` branch (`_shared/health-state.md`), surviving container recycling across scheduled firings — a skipped or failed firing does not lose progress.

**`--min-confidence` closes the confidence-floor asymmetry for headless firings.** `/harness-health` and `/journey-health` closed the same gap in the same pass (see `_shared/health-routine-notes.md`). This skill's `--min-confidence <low|med|high>` flag mirrors `/code-health`'s `--min-risk` mechanism: pass it in the routine template's arguments (e.g. `--min-confidence med`) to hold a below-threshold finding in the durable `remembered` cache instead of filing it, for a quieter headless firing. Omitting the flag preserves today's file-everything default — including a `confidence: low` finding that the interactive gate's own Recommended-column rule would otherwise route to Capture.

> **Billing note:** Routines run inside the subscription; verify automation-credit specifics against the live account. (Canonical text in `_shared/health-routine-notes.md` — shared with `/code-health`, `/harness-health`, and `/journey-health`.)

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention). Bold the `/claude-tweaks:routine create docs-health` line and suffix it `(recommended)` once a first standalone run confirms the output looks right; before that, render all three lines unranked in the order below.

**`/claude-tweaks:routine create docs-health`** — schedule this as a recurring Routine (recommended once a first standalone run confirms the output looks right)
`/claude-tweaks:docs-health --target <id>` — audit one specific doc right now
`/claude-tweaks:tidy` — fold any filed docs-health issues into a backlog-hygiene pass

## Component-Skill Contract

`/claude-tweaks:docs-health` is a **standalone-only** skill — no invocation path exists from `/claude-tweaks:flow` or any other skill in this project today (`flow/SKILL.md`'s Allowed Steps table and workflow text never mention `docs-health`, and `docs/skill-graph.md` records no edge from `/flow`). The `## Next Actions` block always renders. If a future orchestrator wraps this skill, that orchestrator must update this contract to state its own `$PIPELINE_RUN_DIR`-gated handoff; until then, treat parent invocation as not applicable.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Applying any patch directly instead of filing an issue | `/docs-health` never edits — same report-only contract as `/code-health`/`/harness-health`. |
| Flagging prose quality or style as a finding | Only genre-drift, depth-mismatch, findability, and factual staleness are judged. See `_shared/criteria-docs-diataxis.md`'s Constraints. |
| Flagging length alone, without a mismatched expectation | Depth-mismatch needs a surprise against location/heading/genre signals — absolute length never matters. See `_shared/criteria-docs-diataxis.md` Dimension 3. |
| Flagging a low inbound-reference count without checking if the doc is standalone by intent | Findability needs a blocking orphan — not one marked draft/archived/template, nor reached only via an out-of-scope external link. See `_shared/criteria-docs-diataxis.md` Dimension 5. |
| Flagging mechanical issues (broken links, malformed frontmatter) | Those belong in CI — the "CI stays reactive" boundary `/code-health` draws for code. |
| Including `docs/superpowers/**` in the rotation pool | Historical design-doc archive — staleness is by design. Excluded by `bin/lib/docs-health/scope.js`'s `listDocs` (`EXCLUDE_TOP_LEVEL_DIRS`). |
| Excluding the archive by matching `plans` or `specs` anywhere in the path | `docs/plans/` (live pipeline state) and `docs/superpowers/plans/` (archive) are near-identically named. Match top-level `docs/superpowers` only, keeping `docs/plans/` in scope. |
| Reading a target in full when it exceeds the Step 2 byte cap | Costs more than the finding is worth. Read the outline plus first/last sections, more on demand — still run every fenced command block, and cap `confidence` at `med`. |
| Auditing `.claude/skills/*.md`, `.claude/rules/*.md`, or CLAUDE.md | `/claude-tweaks:harness-health`'s territory — this rotation pool only walks `docs/`. |
| Re-proposing a patch already marked `declined` in the cache | The decline-memory cache exists so rejected proposals don't reappear. |
| Skipping the verify gate under time pressure | Unattended firings compound uncaught misreads into staged noise. |
| Treating the local cache as durable state | A rebuildable optimization — GitHub issue state is the cross-run source of truth, as in `/code-health`/`/harness-health`. |
| Editing `docs/**` content to "fix" what a finding describes | This skill judges and files — never edits. |
| Splitting one recurring root cause into N near-duplicate issues | One fix applied N times floods the tracker. Use `relatedSections` to cover every occurrence in one finding. |
| Filing before presenting the interactive gate | The two-tier decision must precede any `gh issue create` for new findings — see `_shared/health-filing-gate.md`. |
