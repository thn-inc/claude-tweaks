---
name: harness-health
description: Use to check whether skills, rules, CLAUDE.md match codebase, template, practice. Never edits code. Keywords - harness health, skill health, skill drift, rule drift, CLAUDE.md drift, best practice, template conformance, new-skill gap, scheduled, routine.
argument-hint: "[--target <id>] [--kind skill|rule|claude-md|design-artifact|memory] [--memory-dir <path>] [--budget <n>] [--min-confidence low|med|high] [--force-gap-scan] [--dry-run] [--root <dir>]"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion
---

# Harness Health — Keep Skills, Rules, and CLAUDE.md Honest

A recurring health check for `.claude/skills/*.md`, `.claude/rules/*.md`, and CLAUDE.md: picks one target to audit against the codebase (or the next new-skill gap to check for), judges it via the shared `_shared/harness-health-analysis.md` procedure, and files a `by:harness-health`-labelled, born-`ready` GitHub issue. Never edits code — only harness documentation.

```
              [ /claude-tweaks:harness-health ] <- utility (no fixed lifecycle position)
                           |  picks a target via next-target; judges via the shared fragment
                           v
finding -> validate-findings -> file GitHub issue (by:harness-health, ready)
```

## When to Use

- You want skill, rule, and CLAUDE.md documentation to stay accurate between spec completions and full `/init` re-runs, without driving each check yourself.
- You want a scheduled Routine that periodically rotates through skills, rules, and CLAUDE.md and flags drift, structural decay, or best-practice gaps as they're found.
- You want to check one specific target right now (`--target <name> [--kind <skill|rule|claude-md|design-artifact>]`).
- You want to spot-check your own memory directory for format-budget violations, stale or contradicted facts, or duplication with checked-in docs (`--kind memory --memory-dir <path>`), interactively — never via a scheduled Routine.

Not for: code-quality findings (`/claude-tweaks:code-health`'s job — including cases where a rule's `paths:` glob is still correct but the code doesn't comply with it). Not a replacement for `/claude-tweaks:wrap-up`'s Skills curation row or `/claude-tweaks:init`'s Update Mode — both consume the same shared procedure this skill does (wrap-up also against `claude-md`, via its CLAUDE.md & rules row's `assetType: claude-md`), on their own scope models (a finished spec's diff; a whole-codebase reconnaissance) rather than this skill's churn/staleness rotation. Memory (`~/.claude/projects/{slug}/memory/`) is not auto-audited — reachable only via an explicit `--kind memory --memory-dir <path>` invocation, never through the automatic rotation a scheduled Routine uses, since memory lives outside the repo with no git churn signal and is not expected to be reachable from a Routine's execution environment.

## Input

`$ARGUMENTS` may contain:

- `--target <id>` — manual override: audit one specific target directly, bypassing `next-target` selection.
- `--kind <skill|rule|claude-md|design-artifact|memory>` — disambiguate `--target` when an id collides across kinds, or (without `--target`) restrict auto-selection to one kind. `memory` is never auto-selected without this flag — it is excluded from the default rotation pool entirely.
- `--memory-dir <path>` — required when `--kind memory` is used. The invoking assistant's own memory directory path, exactly as stated in its own system prompt's auto-memory section for this project. Never derive or guess this path.
- `--dry-run` — emit findings; never write cursor/cache state; never call `gh`.
- `--budget <n>` — audit up to `n` targets in one firing (default 1).
- `--min-confidence <low|med|high>` — minimum `confidence` a finding needs to be filed as a GitHub issue (default: none — every surviving finding files regardless of confidence). Findings below this floor are held in the durable `remembered` cache — not dropped, not filed — until a later, deliberately deeper run lowers the bar. Mirrors `/code-health`'s `--min-risk`; closes this skill's own previously-documented no-floor asymmetry with it (see Routine Configuration below).
- `--force-gap-scan` — force `gapScanDue: true` this firing regardless of the 90-day gap-scan cursor. A manual escape hatch for testing gap-detection heuristics or checking a suspected fresh pattern on demand, mirroring `--target`'s existing manual override for the deep-audit side of selection.
- `--root <dir>` — audit a project elsewhere (default: current working directory).

## Workflow

**Step 1 — SELECT: pick the next target(s).**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness-health.js" next-target --root . ${TARGET:+--target "$TARGET"} ${KIND:+--kind "$KIND"} ${BUDGET:+--budget "$BUDGET"} ${MEMORY_DIR:+--memory-dir "$MEMORY_DIR"} ${FORCE_GAP_SCAN:+--force-gap-scan}
```

To audit memory, the human must explicitly ask for it — set `KIND=memory` and `MEMORY_DIR=<your own memory directory path, from your system prompt>` before invoking. Never set these automatically or infer them from context. `FORCE_GAP_SCAN` is likewise only ever a deliberate human request (`--force-gap-scan`) — never set it automatically.

Without `--budget` (or `--budget 1`), prints `{ target: { kind, id, path, why } | null, gapScanDue: boolean }` — a single target. With `--budget <n>` where `n > 1`, prints `{ targets: [{ kind, id, path, why }, ...], gapScanDue: boolean }` instead — up to `n` targets, each a different id (possibly mixing kinds).

**Findings-file naming (session-scoped, `_shared/session-tmp-root.md`).** Every findings-file path this skill writes below is resolved via `sessionTmpPath`, combining the session root with this skill's existing per-purpose suffix — the "record-suffixed callers keep both suffixes" case that convention documents, since `{target.id}` here plays the same role a record number does elsewhere:

```bash
FINDINGS_FILE=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  const targetId = process.argv[1];
  const name = targetId ? 'harness-health-findings-' + targetId + '.json' : 'harness-health-findings.json';
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, name) || require('path').join(require('os').tmpdir(), name))
" "$TARGET_ID")
```

Run this once per target (`$TARGET_ID` set to that target's `.id`) for a multi-target run, and once with `$TARGET_ID` unset for a single-target run (no `--budget`, or `--budget 1`) — the resolved `$FINDINGS_FILE` is `harness-health-findings.json` in that case. The gap-scan-only path (below) resolves its own `harness-health-findings-gapscan.json` the same way, substituting that literal name for `targetId ? ... : ...` above.

**Multi-target runs (`--budget > 1`):** treat each `targets` array entry as its own full per-target sweep — run Steps 2, 3, 6, and 7 in their entirety for target 1 (including its own `validate-findings --target <id> --kind <kind>` call and its own `gh issue create` calls), writing that target's Step 3 findings to its own session-scoped `$FINDINGS_FILE` (resolved above, not a shared path), then repeat Steps 2, 3, 6, 7 for target 2, and so on. Never collect findings from multiple targets into one shared `validate-findings` call — each target needs its own `--target`/`--kind` pair so its cursor persists independently; skipping this silently leaves N-1 of N targets' cursors stuck, so they get immediately re-selected as `stale`/`hotspot` on the very next firing despite having just been judged. Step 5 (GATHER OPEN ISSUES) only needs to run once per firing — its open-issue index is reused across every target's Step 6 call, not target-specific. Step 4 (GAP SCAN), when due, also runs once per firing regardless of budget, never once per target (see below); fold its new-skill candidates into whichever single target's findings file is processed last this firing, or — if no `targets` came back but `gapScanDue` is still `true` — write them to their own session-scoped `harness-health-findings-gapscan.json` (resolved above) and give that file its own dedicated `validate-findings --gap-scan` call with no `--target`/`--kind`. A run that audits 3 targets makes 3 separate `validate-findings` invocations (plus the gap scan's own standalone call if it had nowhere else to attach), never 1 shared invocation across targets.

> **Parallel execution (conditional):** When `--budget > 1` returns 2 or more targets, dispatch each target's READ+JUDGE work (Steps 2-3) as parallel Task agents — each target is a different file with an independent dimension check, so the audits don't interact. Otherwise (a single target, or `--budget` not passed), run Steps 2-3 sequentially in the main thread. Each dispatched agent gets the target's `{ kind, id, path, why }` object from Step 1 plus its judging procedure **inlined verbatim** — never a path, which reaches nothing (agents see only their own prompt) and makes every agent re-read the full shared fragment. For `kind: skill`/`rule`/`claude-md`, inline the body of `judge-procedure.md` in this skill's directory (everything below its horizontal rule), substituting `{target.path}`/`{target.id}`/`{target.kind}`/`{plugin-root}`/`{root}`; it distills `_shared/harness-health-analysis.md` for exactly those kinds, so keep the two in sync when either changes. For `kind: design-artifact`, inline this skill's own Step 3 branch text instead — that branch routes through no shared fragment at all. For `kind: memory`, inline this skill's own Step 3 memory-branch text plus the body of `_shared/harness-health-memory-checks.md`, which is small and self-sufficient; neither kind ever routes through `_shared/harness-health-analysis.md`. The sequential (`--budget 1`) path still reads the fragment directly, and it stays canonical and unchanged for `/claude-tweaks:wrap-up`'s Skills curation row and `/claude-tweaks:init` Phase 6. `judge-procedure.md` carries its own output contract; restate it in the prompt only for the `design-artifact`/`memory` branch, which has none: write findings to this target's session-scoped findings file — the orchestrator resolves the concrete `$FINDINGS_FILE` value per Step 1's Findings-file naming section **before dispatch**, in the main thread (where `$CLAUDE_PLUGIN_ROOT`/`$CLAUDE_CODE_SESSION_ID` are genuinely available), and substitutes that literal absolute path into the agent's prompt the same way `{target.path}`/`{plugin-root}` are substituted — never asking the agent to re-run the resolver itself, since it cannot read sibling files or reliably see the session id — then reply with nothing but the Subagent Contract status line (`_shared/subagent-output-contract.md`) — `DONE`/`DONE_WITH_CONCERNS` once written, `NEEDS_CONTEXT` if the target or procedure was insufficient, `BLOCKED` otherwise. This doesn't fit Template A/B/C (the output is a JSON findings array written to a file path, not a table/bullet-list/yes-no answer), so the literal per-agent output instruction above stands in for one, per that contract's "not every consumer uses A/B/C" allowance. `[Use: Standard]` (`_shared/subagent-dispatch-core.md` § Model Selection — judgment-heavy analysis against the dimension check, not mechanical extraction). Dispatch shape: single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) applies. Assemble results after all agents complete, then proceed to each target's own Steps 6-7 sequentially in the main thread (dedup/filing must not race against a shared `gh`/cache write).

Unlike `/code-health`'s `next-slice`, this command is named `next-target` because harness-health, journey-health, and docs-health each rotate over one specific file at a time (a skill file, a journey file, a doc). `/code-health`'s `next-slice` rotates over an area/directory swept as a unit per firing — a coarser unit than a single file, even after an oversized directory is split into smaller directory-shaped slices — so it kept its own name rather than adopting this family's.

**Policy schema check (separate from the target/gap-scan work above, runs every firing).** Placed here — immediately after `next-target` returns, before the nothing-due early-stop and the gap-scan-only skip below — so it executes on every firing regardless of which branch Step 1 takes. Call:

```bash
node -e "const {auditPolicy}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/policy-schema.js'); console.log(JSON.stringify(auditPolicy(process.cwd())))"
```

This is a deterministic validation check, not the judged dimension analysis `_shared/harness-health-analysis.md` performs — a malformed key or value is a mechanical fact, not a semantic judgment, so it doesn't produce a `patch`/`new-skill` finding through that shared file. If `unrecognizedKeys`, `invalidValues`, and `migratableKeys` are all empty, do nothing further for this check this firing. Otherwise, file one work-record issue (origin `by:harness-health`, `risk:low` + `size:low` — this is always a same-shape mechanical fix) titled `"policy.yml has {N} unrecognized key(s) / invalid value(s)"` when only `unrecognizedKeys`/`invalidValues` are non-empty, `"CLAUDE.md has {M} policy key(s) that no longer apply"` when only `migratableKeys` is, and `"policy.yml has {N} problem(s); CLAUDE.md has {M} policy key(s) that no longer apply"` when both are. Body: each `unrecognizedKeys` entry (possible typo or a stale key removed from the schema — see `_shared/policy-schema.md`), each `invalidValues` entry (`key`, the actual `value`, and the expected type/enum from `expected` — all of these are `policy.yml`-derived, which is the only file read for config), and each `migratableKeys` entry as a migration line: `key`, its CLAUDE.md `value`, and the remedy, which `alsoInPolicy` picks — `false` means move the key into `.claude-tweaks/policy.yml`, `true` means delete the CLAUDE.md line because `policy.yml` already carries that key and is what applies. Recommend `/claude-tweaks:init --update`, whose Config Home Drift check performs the move behind a shown diff, rather than describing a hand-edit. Dedup against open `by:harness-health` issues the same way Step 5/6 do for the main target — reuse Step 5's `gh issue list` fetch when this firing reaches Step 5 (a target/gap-scan firing); on a firing that stops at the nothing-due early-exit before ever reaching Step 5, run the same `gh issue list --label by:harness-health --state all --json number,state,labels,body --limit 500` fetch here instead, since Step 5 never ran this firing — except in `--dry-run` mode, where this fetch is skipped entirely (per this skill's own `--dry-run` rule: never call `gh`) and the finding is only printed as what would be checked and potentially filed, with no dedup performed.

**Override-bypass check (#809, same shape as the Policy schema check above — separate, runs every firing).** Detection half of the two mechanisms #809 considered for a declared CLAUDE.md pipeline override (a named skill forbidden, with a required substitute — this project's own "Superpowers overrides:" convention, `skills/init/claude-md-template.md`) that is prose with no enforcement: enforcement (a PreToolUse/Skill-invocation refusal) was rejected as the first cut because reliably parsing arbitrary override prose into a hard-block rule risks false positives on a legitimate exception or a differently-worded declaration; this audit-only check matches the plugin's existing "never edits code" posture for health sweeps instead. Call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness-health-override-scan.js" --root .
```

This parses every `route(s) to \`/X\`, never \`/Y\`` clause out of CLAUDE.md (`bin/lib/harness-health/override-bypass.js`'s `parseDeclaredOverrides` — the one prose shape this repo's own override already uses; a differently-worded override is silently not recognized, never misread) and checks the `skill_invoked` event ledger (`bin/lib/hooks/skill-invocation.js`) across every pipeline run directory under `.claude-tweaks/pipelines/` (active and archived) for a case where `/Y` was invoked at least once and `/X` was never invoked anywhere in that evidence — the exact shape of the incident #809 describes. An empty `bypasses` array is the expected, common case, not a gap in coverage. For each entry in `bypasses`, file one work-record issue (origin `by:harness-health`, `risk:low` + `size:low` — a detection finding, not a code fix) titled `"CLAUDE.md override bypassed: {forbidden} invoked without {substitute}"`, body naming the declared override's exact clause, the `forbiddenCount`, and the `evidence` run directories/timestamps, and recommending the human either strengthen the override's phrasing, add enforcement for this specific override, or accept that the declared substitute was never actually needed here. Dedup against open `by:harness-health` issues the same way the Policy schema check above does (reuse Step 5's fetch when reached this firing; the same standalone `gh issue list` fetch otherwise); skip filing entirely under `--dry-run`, printing what would be filed instead.

**Composed-bytes-per-step check (#1909, reporting only — no issue filed, runs every firing).** Surfaces `context-cost.js`'s own composed-bytes-per-step measurement (#1990) rather than re-deriving it; the hard gate on that measurement already lives in `tests/bin-lib/skill-audit/context-cost.test.js`'s `overComposedCeiling` suite, so this check never files a finding — a breach there is a test failure, not a harness-health discovery. Call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/context-cost-report.js" --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

Include the per-step `bytes.max` values (one line per `step`, sorted descending) in Step 8's SUMMARIZE report — this is the standing answer to "how many bytes does each pipeline step load" that a session or a maintainer can otherwise only get by running the CLI by hand. An `error` row (an unparsed compose call, a missing/unreadable source) is reported the same way, naming the file:line rather than a byte count.

Read the `why` field on whichever target(s) came back:
- If both `target`/`targets` are empty and `gapScanDue` is `false`: nothing is due this firing. Report this to the user and stop.
- `why: "stale"` — this target has not been audited in over 90 days regardless of domain churn.
- `why: "hotspot"` — this target's domain paths (backtick-quoted references for skills/CLAUDE.md; the `paths:` frontmatter glob for rules) have the highest git churn since its last audit among targets with any churn at all.
- `why: "manual"` — `--target` was passed, bypassing selection.
- Memory targets (`kind: memory`) only ever produce `why: "stale"` or `why: "manual"` — never `"hotspot"`, since memory has no git churn signal.

If there is no target to deep-audit this firing (`target` is `null`, or `targets` is empty) but `gapScanDue` is `true`, skip straight to Step 4 (gap detection) — the gap scan is still due even with nothing else to audit.

**Skill-library shape pass (separate from the target/gap-scan due-ness above).** Read `library-shape-analysis.md` in this skill's directory for a periodic pass comparing skills *against each other* (too-shallow / overlapping / bloated) on its own 90-day cursor — check its own due-ness (per that file's "Due-ness and SELECT" section) independently of whatever `next-target` returned above, and run it in addition to the standard target/gap-scan work this firing when due.

**Step 2 — READ the target.**

Read the file at `target.path` in full. If none of `.claude/skills/`, `.claude/rules/`, or CLAUDE.md exist yet, report "no harness documentation to audit yet" and stop (this is a real state, not an error — a project that only ran `/init bootstrap`).

**Step 3 — JUDGE the target.**

Findings file path: this run's session-scoped `$FINDINGS_FILE` (resolved per Step 1's Findings-file naming section above) — `harness-health-findings.json` for a single-target run (no `--budget`, or `--budget 1`); for a multi-target run (`--budget > 1`), each target gets its own suffixed `harness-health-findings-{target.id}.json` instead — per Step 1's multi-target repeat instructions, never write two targets' findings into one shared file.

When `target.kind === 'design-artifact'`, skip the full procedure below — construct one finding directly, without a content read:

1. Map `target.id` to its regenerate command: `PRODUCT` → `/impeccable:impeccable init`, `DESIGN` → `/impeccable:impeccable document`.
2. Build `oldString` from `target.why`: `"Unaudited for {target.daysSinceLastAudit} days"` when `why: "stale"`; when `why: "hotspot"`, use `"{target.churnCount} commits touching {target.pathGlobs joined with ', '}, since last audit"` if `target.pathGlobs` is non-empty, otherwise `"{target.churnCount} commits touching referenced content, since last audit"` (`PRODUCT`'s `pathGlobs` is always `[]` by design — selection can still return `why: "hotspot"` for it via paths scraped from its own prose, but those scraped paths aren't carried onto `target.pathGlobs`, so name them generically rather than joining an empty list); when `why: "manual"`, use `"Freshness audit manually requested"` (a manual `--target` invocation carries neither `daysSinceLastAudit` nor `churnCount` — don't fabricate either).
3. Emit one finding: `{ kind: "patch", assetType: "design-artifact", target: target.id, category: "drift", section: "Freshness", oldString: <from step 2>, newString: "Run {regenerate command}", classification: "restructural", confidence: "high", reversibility: "high", reason: <one sentence restating the oldString evidence>, description: "Re-run {regenerate command} to refresh {target.id === 'PRODUCT' ? 'PRODUCT.md' : 'DESIGN.md'}, confirm the regenerated content still matches the project's actual state, and close this issue." }`. Write it (as a single-element array, or appended to an existing array if the gap scan also ran this firing) to this target's findings file (see the path rule above Step 3's design-artifact branch).

This branch doesn't need `_shared/harness-health-analysis.md`'s dimension check — the dimensions (template conformance, best-practice fit, cross-skill overlap, etc.) are skill/rule/claude-md-specific and don't map onto a project-root design-context file. `_shared/harness-health-analysis.md` is shared by `/wrap-up` and `/init`, neither of which ever passes a `design-artifact` target, so this branch lives here rather than in the shared file.

When `target.kind === 'memory'`, also skip the dimension check — read the target file's full body and apply `_shared/harness-health-memory-checks.md` instead, a narrower, more mechanical procedure suited to an index entry rather than a multi-section document. Read **only** that fragment: it is self-sufficient (the checks plus the memory-scoped finding fields), so this branch never loads `_shared/harness-health-analysis.md` at all. Emit findings in the shape that fragment states, with `assetType: "memory"` and `target: target.id`, appended to the same findings array.

For every other `target.kind` (skill, rule, claude-md), apply the full procedure in `_shared/harness-health-analysis.md` (the dimension check, evidence pre-checks, verify gate, concrete gap signals, and — for `claude-md` targets — that file's CLAUDE.md-specific checks including the rule-expiry check, which is the only check that proposes *removing* content, via `intent: "remove"` — using `target.kind` to select which dimensions and origin-template references apply) to the target. Emit findings as a JSON array in the Finding Shape that file defines, with `assetType` set to `target.kind` and `target` set to `target.id`. Write the array to this target's findings file (see the path rule above Step 3's design-artifact branch).

**Bundling rule (recurring root causes)** (canonical shape in `_shared/health-finding-shapes.md` — check that file when either changes to keep this skill's copy in sync with its three siblings): when two or more `kind: "patch"` findings against this same target share both the same `category` and the same root-cause explanation, file **one** finding, not one per section. Pick the clearest/most representative occurrence as the primary `section`; list every other occurrence in `relatedSections` (`_shared/harness-health-analysis.md`'s Finding Shape); make `reason` state the shared root cause explaining all of them; make `description` (the acceptance criteria) require every listed section fixed, not just the primary one. Only bundle occurrences that share both `category` AND the root cause. `kind: "new-skill"` candidates never carry `relatedSections` — they have no `section` to bundle by.

**Step 4 — GAP SCAN (when due, per Step 1's `gapScanDue`).**

Apply `_shared/harness-health-analysis.md`'s new-skill gap detection over commits since the gap-scan cursor (or the whole repo, if this is the first-ever gap scan). Runs once per firing regardless of budget, never once per target. Append any new-skill candidates to the findings array from Step 3 — for a single-target run, that's the one shared file; for a multi-target run (`--budget > 1`), append them to whichever target's findings file is processed last this firing (or, if no `targets` came back this firing but `gapScanDue` is still `true`, write them to their own session-scoped `harness-health-findings-gapscan.json`, resolved per Step 1's Findings-file naming section). This step is skill-only — it never proposes a new rule or a new CLAUDE.md section.

**Step 5 — GATHER OPEN ISSUES for dedup.**

Resolve this run's session-scoped temp paths first, per `_shared/session-tmp-root.md` (cited throughout this file rather than restated):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HARNESS_HEALTH_ISSUES_RAW=harness-health-issues-raw.json HARNESS_HEALTH_ISSUES=harness-health-issues.json)"
gh issue list --label by:harness-health --state all --json number,state,labels,body --limit 500 > "$HARNESS_HEALTH_ISSUES_RAW"
```

Parse each issue body for its fingerprint marker. Fingerprint extraction reads the dual-marker form via `extractFingerprint` (`bin/lib/issues/record.js`): the current `<!-- work-fingerprint: harnesshealth-XXXXXXXX -->` marker, falling back to the legacy `<!-- harness-health-fingerprint: harnesshealth-XXXXXXXX -->` marker still present on issues filed before this skill moved onto the unified work record (`skills/_shared/work-record.md`), then to the plain-text `work-fingerprint: harnesshealth-XXXXXXXX` companion line for an MCP-stripped body (`_shared/health-issue-index.md`). Build an array of `{ number, state, labels, fingerprint }` objects and write to `$HARNESS_HEALTH_ISSUES`.

**Transport and outcomes:** read `_shared/health-issue-index.md` and apply it, with `{SKILL}` = `harness-health` and `{ISSUES_FILE}` = `$HARNESS_HEALTH_ISSUES`. In short: `gh` absent means rebuild this index via the MCP `list_issues` tool, not skip the step; only a genuine "neither transport can reach GitHub" sets `ISSUES_FILE=""`, and that case gets reported rather than passing silently. A repo with no `by:harness-health` issues yet is a legitimately *empty* index (`[]`), not an unavailable one — keep the two distinct.

A matched issue carrying the `wontfix` label is a standing suppression decision: Step 6's `validate-findings` reads it directly off this issue index and skips re-filing entirely (see `_shared/work-record.md`'s `wontfix` closure row). It also persists that fingerprint to the durable `declined` slice on the `health-state` branch, so the suppression survives a later firing that cannot rebuild this index at all — the local `cache.json` is no help there, since a scheduled Routine's fresh container starts with an empty one.

**Digest-mode fold.** Before writing `$HARNESS_HEALTH_ISSUES`, fold in any open digest issue's embedded checklist fingerprints per `_shared/health-filing-digest.md`'s GATHER-OPEN-ISSUES-step shape (`{PREFIX}` = `harness-health`) — this is what lets a previously-digested finding dedupe as a normal open-issue match in Step 6 rather than being re-judged or re-digested.

**Step 6 — VALIDATE, FINGERPRINT, DEDUP.**

Resolve this run's session-scoped payloads path first (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit an earlier fence's shell variables) — `$FINDINGS_FILE` itself is assumed still set from Step 3's resolution, the same assumption this command already makes for `$TARGET_ID`/`$TARGET_KIND`/`$GAP_SCAN_RAN`/`$MIN_CONFIDENCE`/`$DRY_RUN`:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HARNESS_HEALTH_PAYLOADS=harness-health-payloads.json HARNESS_HEALTH_FINDINGS=harness-health-findings.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/harness-health.js" validate-findings "${FINDINGS_FILE:-$HARNESS_HEALTH_FINDINGS}" \
  --root "${ROOT:-$PWD}" \
  ${ISSUES_FILE:+--issues "$ISSUES_FILE"} \
  ${TARGET_ID:+--target "$TARGET_ID"} ${TARGET_KIND:+--kind "$TARGET_KIND"} \
  ${GAP_SCAN_RAN:+--gap-scan} \
  ${MIN_CONFIDENCE:+--min-confidence "$MIN_CONFIDENCE"} \
  ${DRY_RUN:+--dry-run} \
  > "$HARNESS_HEALTH_PAYLOADS"
```

`TARGET_ID`/`TARGET_KIND` are `target.id`/`target.kind` from Step 1 (omit both if Step 1 returned `target: null` and only the gap scan ran — pass both together or neither, since cursor recording needs the namespaced `kind:id` key). `GAP_SCAN_RAN` is passed whenever Step 4 actually ran this firing. `FINDINGS_FILE` is the target-scoped, session-scoped path from Step 3 (Step 1's Findings-file naming section) — `harness-health-findings.json` for a single-target run; `harness-health-findings-{target.id}.json` per target, or `harness-health-findings-gapscan.json`, for a multi-target run — run this whole command once per target for a `--budget > 1` firing, per Step 1's multi-target instructions, never once for a shared file covering multiple targets. `MIN_CONFIDENCE` is only ever set from an explicit human `--min-confidence` request; a Routine's default headless firing omits it (see Routine Configuration below). The command validates each finding, fingerprints via `assetType + target + section + normalizedDescription`, dedups against open `by:harness-health` issues and the local cache, drops any finding below `--min-confidence` into the durable `remembered` cache instead of filing it, records the audit cursor for `${TARGET_KIND}:${TARGET_ID}` (and the gap-scan cursor when `--gap-scan` was passed) unless `--dry-run`, and emits gh-ready payloads on stdout.

**Step 7 — FILE.**

**Subject check before filing.** Apply the "Subject check (health sweeps)" section of `skills/_shared/learning-routing.md` — a finding about a claude-tweaks skill is a D5 learning routed to `/claude-tweaks:feedback`, not a project issue.

Read `filing.md` in this skill's directory and apply it. It owns the whole filing procedure: the classification-to-scoring fold (`additive` -> `risk:low`/`size:low`, `restructural` -> `risk:medium`/`size:high`, `new-skill` unscored by design), the born-`ready` rule, the retry-queue drain and regressed-reopen mechanics (`_shared/health-filing-mechanics.md`'s canonical shape, as `{BINARY}` = `harness-health.js`, `{PREFIX}` = `harness-health`), label bootstrapping, the interactive file-all/route-individually gate (`_shared/health-filing-gate.md`), and the `work-types` Type-expression branch. `/harness-health` never edits anything directly — it only judges and files.

**Step 8 — SUMMARIZE.**

Report: which target(s) were audited (or that only the gap scan ran), how many findings were emitted, how many filed vs skipped by dedup. List any new issue URLs. Always include the throttle line per `_shared/health-filing-digest.md`'s SUMMARIZE step: `filed: N, digested: M, cap: {CAP}, materiality: K` — report it even when `M` and `K` are both `0`, so the throttle is visible rather than inferred. Always include the composed-bytes-per-step line from the check above: `bytes/step (max): {step}={bytes} B, ...` sorted descending by bytes.

## Routine Configuration

`/harness-health` ships a routine template (`skills/harness-health/routine-template.yml`) designed for small, predictable sips: one target per run, so a scheduled firing is cheap and a skipped one is harmless. Instantiate it for the current project with:

```
/claude-tweaks:routine create harness-health
```

**Headless run flow:** SELECT(`next-target`) → JUDGE → validate-findings → file. A firing with nothing due (`target: null`, `gapScanDue: false`) is a cheap no-op.

Report-only, matching `/code-health` — every finding files as a `by:harness-health`-labelled, born-`ready` GitHub issue, with no `Edit` call anywhere in its documented workflow. Rotation cursors and the filing retry queue live on the durable `health-state` branch (`_shared/health-state.md`), surviving container recycling across scheduled firings — a skipped or failed firing does not lose progress.

**Confidence floor on headless firings.** This skill's own `validate-findings --min-confidence <low|med|high>` now mirrors `/code-health`'s `--min-risk` flag — a finding below the floor is held in the durable `remembered` cache instead of filed. `docs-health` closed the same gap the same way in the same pass; `journey-health` also closed it, but with a different mechanism (drops a below-floor finding for that run rather than holding it durably — see `_shared/health-routine-notes.md`). The routine template's default prompt omits `--min-confidence`, so a scheduled firing still files every surviving finding regardless of confidence by default, matching this skill's pre-existing behavior — pass `--min-confidence med` (or `low`) in a customized Routine prompt to intentionally quiet a noisy headless firing down to `/code-health`'s own default posture.

> **Billing note:** Routines run inside the subscription; verify automation-credit specifics against the live account. (Canonical text in `_shared/health-routine-notes.md` — shared with `/code-health`, `/docs-health`, and `/journey-health`.)

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention). Bold the `/claude-tweaks:routine create harness-health` line and suffix it `(recommended)` once a first standalone run confirms the output looks right; before that, render all three lines unranked in the order below.

**`/claude-tweaks:routine create harness-health`** — schedule this as a recurring Routine (recommended once a first standalone run confirms the output looks right)
`/claude-tweaks:harness-health --target <name> --kind <skill|rule|claude-md|design-artifact>` — audit one specific target right now
`/claude-tweaks:tidy` — fold any filed harness-health issues into a backlog-hygiene pass

## Component-Skill Contract

`/claude-tweaks:harness-health` is a **standalone-only** skill — no invocation path exists from `/claude-tweaks:flow` or any other skill in this project today (`flow/SKILL.md`'s Allowed Steps table and workflow text never mention `harness-health`, and `docs/skill-graph.md` records no edge from `/flow`). The `## Next Actions` block always renders. If a future orchestrator wraps this skill, that orchestrator must update this contract to state its own `$PIPELINE_RUN_DIR`-gated handoff; until then, treat parent invocation as not applicable.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Applying a patch directly instead of filing an issue | `/harness-health` never edits — every finding files as a GitHub issue regardless of `assetType`/classification/confidence/reversibility, like `/code-health` |
| Treating a rule's low compliance ratio as automatic drift | It can mean the code violates a still-correct rule (a `/code-health` problem) — reason about *why* the ratio is low before emitting a finding |
| Re-proposing a patch already marked `declined` in the cache | Decline-memory exists so rejected proposals don't reappear every firing |
| Skipping the verify gate under time pressure | Unattended firings compound uncaught misreads into staged noise — `_shared/harness-health-analysis.md`'s gate is not optional |
| Reading every sub-file of a candidate skill regardless of relevance | Sub-file-heavy skills (`build`, `stories`, `init`) make that expensive across a whole-library rotation — bound reads by relevance |
| Treating the local cache as durable state | It's a rebuildable optimization — GitHub issue state is the cross-run source of truth, same as `/code-health` |
| Editing code to "fix" what a skill, rule, or CLAUDE.md describes | This skill touches harness documentation only |
| Proposing a "new-rule" or "new-claude-md-section" finding | Gap detection is skill-only this phase — rules and CLAUDE.md get only `patch` findings |
| Folding memory into `listTargets`'s default pool | A bare Routine firing can't know to skip memory — the exclusion must be structural (separate lister or CLI branch), not a documented convention |
| Splitting one recurring root cause into N near-duplicate issues | Floods the tracker with one fix restated N times — use `relatedSections` to cover every occurrence in one finding |
| Filing before presenting the interactive gate | The two-tier decision must precede any `gh issue create` for new findings — see `_shared/health-filing-gate.md`'s placement rule |
| Collecting findings from multiple `--budget > 1` targets into one shared `validate-findings` call | It advances the audit cursor for exactly one `--target`/`--kind` pair per invocation — a shared call leaves N-1 cursors stuck, re-selecting those targets as due on the next firing. Run Step 6/7 once per target, per Step 1. |
