---
name: code-health
description: Use for a proactive, report-only repo sweep that files deduplicated GitHub issues. An LLM judges the code; never edits it. Keywords - code-health, sweep, repo audit, technical debt, proactive, github issues, scheduled, routine.
argument-hint: "[--area <path>] [focus=<vertical>] [--budget <n>] [--min-risk low|medium|high] [--dry-run] [--root <dir>]"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion
---

# Code-Health — LLM-as-Code-Judge, Proactive Repo Improvement

A recurring health check doing rounds: reads one directory slice (or, under `focus=<vertical>`, a generator's repo-wide candidate set), judges it against the universal criteria catalog, fingerprints each finding, dedups against open GitHub issues, and files the work worth doing. The LLM is the spine. Deterministic helpers handle fingerprint, dedup, and issue-payload projection. It never edits code.

```
              [ /claude-tweaks:code-health ] <- utility (no fixed lifecycle position)
                           |  judges the slice; surfaces findings
                           v
findings -> validate-findings -> file GitHub issue (by:code-health, ready) -> /claude-tweaks:specify -> /claude-tweaks:build / /claude-tweaks:flow
         +- fuzzy / not-yet -> /claude-tweaks:capture (backlog)
```

The plugin reacts to changes you make; `/code-health` surfaces the changes worth making.

## When to Use

- You want a hands-off pass that keeps technical debt visible without driving each scan yourself.
- You want LLM-judged improvements filed as GitHub issues that drop into `/specify` with near-zero translation.
- You want findings deduplicated against work already tracked — never re-flood the tracker.
- You want to run on demand against a specific area, or let `next-slice` pick the highest-priority area automatically.
- You want one vertical swept repo-wide in a single firing rather than one directory slice — `focus=<vertical>` (see "Focus Mode" below).

Not for: auto-fixing (report-only), CI gating (CI stays reactive), or replacing `/capture`/`/specify` (code-health owns no backlog — it routes findings into the stores that already exist).

## Input

`$ARGUMENTS` may contain:

- `--area <path>` — manual override: scope the run to one specific area, bypassing `next-slice` rotation. Use for targeted re-inspection.
- `focus=<vertical>` — candidate-driven scoping: bypass `next-slice` rotation entirely and instead run a deterministic candidate generator for the named vertical, judging its candidates with that vertical's pinned criterion instead of `criteriaForArea`'s area-type lookup. Mutually exclusive with `--area`. See "Focus Mode" below — full procedure in `focus-mode.md` in this skill's directory. `--min-risk`, `--dry-run`, and `--root` all still apply; `--budget` does not — Step 1 is skipped entirely under focus mode, so nothing consumes it, and a focus firing sweeps the generator's whole repo-wide candidate set regardless.
- `--dry-run` — emit the plan but write nothing (cache untouched, no issues filed). Use for the smoke check.
- `--root <dir>` — scan a project elsewhere (default: current working directory).
- `--budget <n>` — judge up to `n` slices in one run (default: 1). Use with `next-slice` when you want a deeper sweep in a single invocation.
- `--min-risk <level>` — minimum computed risk tier (severity × likelihood) that gets filed as a GitHub issue (default: `high`; one of `low|medium|high`). Findings below this are held in the local cache as `remembered` — not dropped, not filed — until they escalate or a deliberately deeper sweep lowers the bar. Pass `--min-risk medium` (or `low`) for an intentional deep-dive that surfaces more than the default high-risk-only trickle.

## Focus Mode

`focus=<vertical>` swaps ONLY the scoping strategy (Steps 1 and 3 below) and the criterion selection (Step 4): a deterministic generator produces a fixed set of candidate files/symbols repo-wide, instead of `next-slice` picking one directory-shaped slice per firing, and the focus pins its own criterion instead of `criteriaForArea`'s area-type lookup. Step 2 (gather open issues for dedup) and Steps 5 onward (JUDGE through SUMMARIZE) run completely unchanged — a focus firing is still judged holistically, still passes the verify gate, still gets fingerprinted, deduped, and filed exactly like a generalist run. A focus firing never touches the generalist rotation's cursor or content-hash state (both live in `bin/lib/code-health/scope.js`, which the focus-mode generator never imports) — it is cursor-neutral by design.

A generator's candidate set is a heuristic, explicitly partial starting point — never read it as a complete inventory of the vertical, and never report it as one. Each generator's own module header states its coverage boundaries in full (IL-110), and `focus-mode.md`'s Coverage section says where to read them.

Read `focus-mode.md` in this skill's directory for the full procedure: candidate generation, the zero-candidates no-op contract, criterion pinning, and the unrecognized-focus fail-loud rule. Which verticals are shipped changes as generators are added, so `focus-mode.md`'s registry lookup — not prose — is what names every currently-known value; never hand-list them here, in `focus-mode.md`, or anywhere else (a list restated in two places drifts, IL-40).

## Workflow

**Step 1 — SCOPE: select the target slice.**

If `focus=<vertical>` was provided, skip this step entirely — `focus-mode.md`'s own procedure replaces it. That procedure runs Step 2 (GATHER OPEN ISSUES) unchanged at its F0, before its own candidate generation and criterion pinning (which stand in for Steps 3 and 4). Only Steps 1, 3, and 4 are skipped. Otherwise, unless `--area` was provided, call the engine to pick the next slice to judge:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/code-health.js" next-slice --root "${ROOT:-$PWD}" ${BUDGET:+--budget "$BUDGET"}
```

This is named `next-slice`, not `next-target` like its three sibling health skills (harness-health, journey-health, docs-health) — those rotate over one specific file at a time, while code-health rotates over an area/directory swept as a unit per firing, a coarser unit worth its own name. (A directory over the byte cap is split into smaller directory-shaped slices — see below — but the rotation unit is still a directory, never a single file.)

The command prints `{ id, path, recursive, why }` JSON, or `null` if nothing is due. Read the output:
- If `null`: all slices were judged recently and their content is unchanged. Report this to the user and stop.
- If `why: "stale"`: this slice has not been judged in over 30 days regardless of content changes.
- If `why: "hotspot"`: this slice has the highest churn × complexity score among slices with changed content.
- `recursive` says how far the slice reaches: `true` means the whole subtree under `path`; **`false` means that directory's own direct files only** — its subdirectories are separate slices with their own ids and their own cursors. Honor this in Step 3, or a non-recursive slice's sweep re-reads (and re-files findings against) code that belongs to a sibling slice.

**Why a directory can be non-recursive.** `next-slice` caps an emitted slice at **30 KB of source** (`MAX_SLICE_BYTES` in `bin/lib/code-health/scope.js`). A directory over that cap is *split*: it yields a non-recursive slice for its own direct files plus one slice per subdirectory, each re-tested against the cap and split again if needed. Slice ids stay plain repo-relative paths at every depth (`bin`, `bin/lib`, `bin/lib/issues`), so `--area`, `classify`, and cursor keys are unchanged. Splitting never drops a file — a directory too big to split (no subdirectories left) is emitted whole and over the cap, and the read budget in Step 3 is what bounds that residual case.

**Multi-slice runs (`--budget > 1`):** `next-slice` returns a JSON **array** of up to `n` slices instead of a single object when `--budget` is passed. Treat each array entry as its own full sweep: run Steps 2–9 in their entirety for slice 1 (including its own `validate-findings --slice <id> --run-id <id>` call), then repeat the full Steps 2–9 for slice 2, and so on. Never collect findings from multiple slices into one shared `validate-findings` call — each slice needs its own `--slice` value so its cursor persists independently. A run that judges 3 slices makes 3 separate `validate-findings` invocations, not 1.

When `--area <path>` is provided, skip `next-slice` and use that path directly as the slice (manual override). A manual override always sweeps the **whole subtree** under that path, ignoring the byte cap — it is the deliberate escape hatch for "judge all of this now." Note the bookkeeping consequence when the path names a directory the splitter would have split: `validate-findings --slice <path>` records the cursor hash for that directory's *own-files* slice, so the nested content you just swept is tracked under the child slices' own cursors, not this one. Step 3's read budget still applies.

Verify the resolved path exists:

```bash
ls "${ROOT:-$PWD}/${AREA}"
```

If the path does not exist, stop and report the error. Set `AREA` and `ROOT` for the rest of the steps.

> **Parallel execution:** Use parallel tool calls aggressively — Step 2's `gh issue list` dedup-index query and Step 3's file reads under `${ROOT}/${AREA}` are independent read-only Bash operations (Step 2 depends only on the repo's issue tracker; Step 3 depends only on Step 1's resolved path) and should run concurrently rather than sequentially.

**Step 2 — GATHER OPEN ISSUES for dedup.**

Collect existing `by:code-health`-labelled issues so the engine can skip/reopen/suppress correctly. Session-scoped (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CH_ISSUES_RAW=ch-issues-raw.json CH_OPEN=ch-open.json)"
gh issue list --label by:code-health --state all --json number,state,labels,body --limit 500 > "$CH_ISSUES_RAW"
```

Parse each issue body for its fingerprint marker and build an array of `{ number, state, labels, fingerprint }` objects. Fingerprint extraction reads the dual-marker form via `extractFingerprint` (`bin/lib/issues/record.js`): the current `<!-- work-fingerprint: codehealth-XXXXXXXX -->` marker, falling back to the legacy `<!-- code-health-fingerprint: codehealth-XXXXXXXX -->` marker still present on issues filed before this skill moved onto the unified work record (`skills/_shared/work-record.md`), then to the plain-text `work-fingerprint: codehealth-XXXXXXXX` companion line for an MCP-stripped body (`_shared/health-issue-index.md`). Write to `$CH_OPEN`.

**Transport and outcomes:** apply `_shared/health-issue-index.md` with `{SKILL}` = `code-health`, `{ISSUES_FILE}` = `$CH_OPEN`. `gh` absent means rebuild the index via MCP `list_issues`, never skip; `ISSUES_FILE=""` is only for "no transport reaches GitHub", and is reported.

A matched issue carrying the `wontfix` label is a standing suppression decision, not a skip or reopen: `validate-findings` (Step 8) suppresses re-filing entirely and persists `status: 'wontfix'` to the local cache — a Routine's fresh container recreates that cache empty, covering repeat *local* runs only on its own. The MCP transport above covers `gh`-absent headless runs; (#171) the suppression is also persisted durably to the `declined` slice on the `health-state` branch (`decide()`'s `durableDeclined` param, `mergeWontfixIntoDeclined`) — read via `git fetch`, so it survives GitHub being unreachable outright, or a label applied before this container existed.

**Digest-mode fold.** Before writing `$CH_OPEN`, fold in any open digest issue's embedded checklist fingerprints per `_shared/health-filing-digest.md`'s GATHER-OPEN-ISSUES-step shape (`{PREFIX}` = `code-health`) — this is what lets a previously-digested finding dedupe as a normal open-issue match in Step 8 rather than being re-judged or re-digested.

**Step 3 — READ THE SLICE.**

If `focus=<vertical>` was provided, skip this step entirely — `focus-mode.md`'s Step F3 reads every candidate file under this same 60 KB read-budget discipline, restated there rather than here. Otherwise, stamp a freshness marker before reading anything, so Step 7.5 can later detect whether the slice changed underneath this run — a concurrent fix pass, another parallel code-health sweep, or an ordinary human edit landing between this read and eventual filing. Re-resolve:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CH_MARKER=ch-marker)"
touch "$CH_MARKER"
```

Read the source files in `${ROOT}/${AREA}`. Use Read and Glob:

```bash
# List the files in the area. Add -maxdepth 1 when Step 1 reported
# "recursive": false — subdirectories are then separate slices, not this one's.
find "${ROOT}/${AREA}" -type f | sort
```

Read each file in full. Hold the full content in context — this is the material the judge will apply criteria to.

**Read budget — 60 KB per slice.** `next-slice` already caps most slices at 30 KB (Step 1), but a directory with no subdirectory left to split by is emitted whole and can exceed that. Track bytes as you read, and on reaching **60 KB** stop full-reading and switch to a bounded read for the remaining files: their imports/exports and top-level declaration signatures (`grep -n '^\(export\|module\.exports\|function\|class\|const .* = \(async \)\?(\)' <file>`), full-reading further only where a bounded read shows something a criterion plausibly bites on.

Never silently skip a file. Every file not read in full must be listed in the Step 10 report as **deferred**, with its size — the next sweep of this slice picks them up, and a human reading the findings can see what the judge did not look at. A slice whose files were quietly dropped produces findings that falsely imply whole-slice coverage.

**Step 4 — CLASSIFY: detect area type + select criteria.**

If `focus=<vertical>` was provided, skip this step entirely — the focus pins its own criterion (`focus-mode.md`'s Criterion pinning table), so there is no area to classify and no `criteriaForArea` call. Otherwise, call the engine to determine the area's type:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/code-health.js" classify --root "${ROOT:-$PWD}" --area "<slice-id>"
```

The command prints `{ areaId, types }`. Use the `types` array to select the applicable criteria via `criteriaForArea(types)` from `bin/lib/code-health/criteria.js`. Types are additive — matching is a `.some()` intersection against each area-gated criterion's `appliesTo` array, not exact-equality, so an area gets the universal criteria plus *every* area-gated criterion whose `appliesTo` includes at least one of the area's types. Do not hand-copy any example result into a mental shortcut; call `criteriaForArea` for the real slice instead, since `criteria.js` is the single source of truth and the result drifts as criteria are added or re-gated.

**This command's own `areaId` field is a different identity from Step 6's per-finding `areaId` — do not conflate them.** This `classify` output's `areaId` echoes back the slice id (the directory Step 1/`--area` scoped the whole sweep to — e.g. `bin/lib/code-health` for a recursive slice covering its own nested subdirectories too). It exists here only alongside `types` for classification purposes. Never copy this value into a Step 6 finding's `areaId` — see that step's derivation rule, which is per-finding and can name a deeper directory than this slice id whenever the finding's anchor file sits in a nested subdirectory of a recursive slice.

If `types` is `[]` (unknown area), apply universal criteria only — run the same `criteriaForArea([])` call below to get the current list (do not hand-maintain a separate copy of it; the catalog in `criteria.js` is the single source of truth):

```bash
node -e "const {criteriaForArea}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/code-health/criteria.js'); console.log(criteriaForArea([]).map(c=>c.id).join(', '))"
```

> **Parallel execution:** Use parallel tool calls aggressively — each selected criterion's fragment file is an independent Read and should run concurrently.

Load each selected criterion's fragment file (the `fragment` field in the catalog) and embed it in the judge prompt for Step 5. Fragments live under `skills/_shared/` — read each one and include its content so the judge has the calibration text inline.

**Step 5 — JUDGE: apply each criterion holistically.**

**Tools as evidence (optional assists).**

Before or during judging, the judge MAY call the following deterministic tools to ground its findings. Each is optional — skip gracefully if the tool is not installed or the command errors. Tool output is evidence the judge weighs when forming a finding; raw tool output is never filed as a finding itself.

| Tool | Command | Evidence it provides |
|------|---------|----------------------|
| Project lint/typecheck | `npm run lint --if-present 2>&1 \| tail -40` or `npx tsc --noEmit 2>&1 \| head -40` | Concrete type errors and lint violations in the slice (under focus mode, in the candidate set) |
| Dead code / unused deps | `npx knip --reporter json \| head -c 4000` or `npx depcheck --json \| jq '{dependencies, devDependencies}'` | Unused exports, unreferenced packages |
| Dependency vulnerabilities | `npm audit --json \| jq '{critical:.metadata.vulnerabilities.critical, high:.metadata.vulnerabilities.high}'` or `npx osv-scanner --format json . \| jq '[.results[].packages[].vulnerabilities[]] \| length'` | Known CVEs in installed packages |
| Dependency cycles | `npx madge --circular --json <slice-path> \| jq 'length'` | Import cycles in the slice (under focus mode, pass a candidate file's own directory) |
| Grep / git log | Standard Bash + git CLI | Code patterns, recent churn, authorship |

Every command above is already projected or capped — the raw JSON/text a tool prints can run past 200 KB, and none of it is worth reading in full for evidence purposes. A finding confirmed by a tool output is higher-confidence than one based on code reading alone. Include the relevant bounded excerpt (the jq projection's result, or the `head`/`tail` slice) as part of the finding's `evidence` field (not as a separate finding). If a bounded run signals something worth deeper diagnosis (e.g. `critical` or `high` counts are non-zero), it's fine to re-run that one tool without the cap to pull the specific detail into evidence — never file a finding wider than what the judge actually read.

When a tool is absent or errors, log a single line to stderr and continue — do not abort the judge run.

For each selected criterion, read the code with that criterion as the lens. Apply the criterion holistically — this is a behavioral judgment, not a mechanical check. Evidence grounds the finding; do not file speculative findings.

Every selected criterion whose catalog entry carries a fragment had that fragment embedded in Step 4 — use it as the calibration text inline before judging that criterion. Criteria whose catalog entry has `fragment: null` carry no calibration file; judge those from this step's guidance alone.

After applying all enumerated criteria, run a final "anything else worth flagging?" pass to catch what the checklist missed.

**Step 6 — EMIT FINDINGS as a JSON array.**

For each finding, emit exactly this shape:

```json
{
  "criterion": "<catalog id, e.g. 'simplification'>",
  "areaId": "<the anchor file's own containing directory, relative to root — see the pinned derivation rule below, e.g. 'src/api'>",
  "anchor": "<relfile#NearestNamedSymbol — see anchor rules below>",
  "relatedAnchors": "<optional array of relfile#NearestNamedSymbol strings — sibling occurrences of the same root cause; omit if there's only one occurrence>",
  "severity": "<low|medium|high>",
  "confidence": "<high|medium|low>",
  "likelihood": "<low|medium|high>",
  "effort": "<low|medium|high>",
  "title": "<short summary>",
  "evidence": "<what was observed — cites anchor; no line numbers>",
  "suggestedApproach": "<described fix in prose — NO code>",
  "acceptance": "<acceptance criteria>"
}
```

**`areaId` derivation (pinned, canonical across every scoping mode):** `areaId` is always `path.dirname(anchor-file)` — the directory, relative to root, that directly contains the finding's own `anchor` file — computed per finding, never per slice. This is the one rule every code-health scoping mode must satisfy identically: the generalist rotation path (Steps 1-4 above) and any focus-mode-style candidate-driven path (`focus-mode.md`) MUST derive `areaId` this same way, so the same file produces the identical fingerprint input (Step 8: `criterion + areaId + normalizeAnchor(anchor)`) no matter which mode found it. Do NOT substitute the slice id from Step 1 (`next-slice`'s `id`/`path`) or Step 4's `classify` output — both name the *slice*, which is coarser than the anchor file's own directory whenever the slice is recursive and the finding's anchor sits in a nested subdirectory. Example: a finding anchored at `plugin/bin/lib/residue/probes/branches.js#someExport`, found while judging the recursive `plugin/bin/lib/residue` slice, still gets `areaId: "plugin/bin/lib/residue/probes"` — never `"plugin/bin/lib/residue"`. Getting this wrong duplicates the same finding under two different fingerprints depending on which scoping mode happened to find it first.

**`criteria-review-quality.md` references a `critical` or `info` tier inherited from `/claude-tweaks:review`'s broader 5-tier scale** (the only fragment this applies to — every other criterion fragment's own severity calibration already uses only `high`/`medium`/`low`, matching the schema directly). Code-health's own schema accepts only `low|medium|high` for `severity` — never emit `critical` or `info`. When this fragment's calibration language points toward `critical`, map it to `severity: high` (code-health has no higher tier); treat anything it would call `info` as not worth filing at all rather than as a `low` finding.

**Severity, likelihood, and effort are three separate, simpler judgments — do not conflate them:**

- **`severity`** — impact *if* the pattern manifests. Unchanged meaning from before.
- **`likelihood`** — how probable this is to actually matter in practice. One holistic judgment folding together whichever of these three factors actually apply to the finding at hand:
  - **Exposure** — is this on a hot/frequently-executed path and user-facing, or a rarely-touched internal script / dead corner?
  - **Blast radius** — does this affect one call site, or a shared/foundational module many things depend on?
  - **Exploitability** — for security-relevant criteria specifically: can external input actually reach and trigger this, or is it a theoretical concern with no real attack surface? Non-security criteria simply have no exploitability consideration to weigh.
- **`effort`** — the cost/complexity of the finding's own `suggestedApproach`. A one-line parameter addition is `low`; a bundled fix across several sibling occurrences is `medium`; a structural change (new abstraction, cross-file rework) is `high`.

**Bundling rule (recurring root causes)** (canonical shape in `_shared/health-finding-shapes.md` — check that file when either changes to keep this skill's copy in sync with its three siblings): when the same criterion and the same suggested fix recur at multiple call sites within the slice being judged (under focus mode, within the candidate set being judged), file **one** finding, not one per call site. Pick the clearest/most representative occurrence as the primary `anchor`; list every other occurrence in `relatedAnchors`; make `evidence` enumerate all occurrences; make `acceptance` require all of them fixed, not just the primary. Only bundle occurrences that share both the criterion AND the fix — do not bundle unrelated findings under one anchor just because they're nearby in the same file or directory.

**Anchor rules (critical for dedup stability):**
- Format: `relative/file/path#NearestNamedSymbol`
- `NearestNamedSymbol` is the name of the nearest enclosing function, class, const, or section header.
- No line numbers. No surrounding prose. No absolute paths.
- Examples: `src/api/user.js#getUser`, `lib/parser.js#Parser`, `bin/code-health.js#cmdRun`
- When a finding is module-level (no named symbol), use the file itself: `src/api/user.js#module`

Write the array to `$CH_FINDINGS` (session-scoped, session-tmp-root.md).

**Step 7 — VERIFY GATE: sanity-check surviving findings before dedup.**

Before fingerprinting and dedup, re-examine each finding the judge emitted and ask five questions — this is the canonical shape in `_shared/health-verify-gate.md` (worded here against this skill's own finding schema); check that file when either changes to keep this skill's copy in sync with `docs-health`/`journey-health`'s own inline copies and `harness-health`'s embedded one:

1. **Is it real?** Does the code actually exhibit the problem, or did the judge misread the structure? If the code is correctly guarded (a timeout IS configured, a check IS present), drop the finding.
2. **Is it actionable?** Is the `suggestedApproach` concrete and executable? A finding like "consider improving error handling" with no specific location or change is not actionable — drop it or refine it until it is.
3. **Does it reproduce?** Given the code read in Step 3, would a developer following the `suggestedApproach` be able to find and fix the issue without additional investigation? If not, the anchor or evidence is too vague — either tighten it or drop the finding.
4. **Is `likelihood` justified by the evidence?** The finding's `evidence` should support the claimed exposure/blast-radius/exploitability — not just assert a likelihood tier without grounding it in what was actually observed in the code.
5. **Is `effort` consistent with `suggestedApproach`?** A `suggestedApproach` that reads as a one-line change should not carry `effort: high`, and vice versa.

Drop any finding that fails any of the five questions. Log the drop reason. A smaller set of high-quality findings is always preferable to a larger set with noise. This is the adversarial-verify discipline that the v1 design established — apply it every time.

The verify gate is a judgment step, not a mechanical check. It cannot be automated. Do not skip it even under time pressure.

**Step 7.5 — FRESHNESS RE-CHECK: catch findings whose anchor changed since Step 3 read it.**

The verify gate above judges whether a finding is *correct*. This step is a separate, purely mechanical check for whether it is *still current*: a judge agent reads a file once, at Step 3, but filing (Step 9) can land much later — long enough for a concurrent fix pass, another parallel code-health sweep, or an ordinary human edit to change the very file a finding is anchored to. Filing on stale content produces duplicate or already-resolved issues (the incident that motivated this step: a 6-agent parallel sweep ran alongside an unrelated large fix pass touching the same files, and by review time most surviving findings had already been resolved by that fix pass).

For every finding still in the candidate set after Step 7, check its anchor file — and every entry in `relatedAnchors`, when present, since a changed sibling occurrence stales the whole bundled finding — against the Step 3 marker. Re-resolve:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CH_MARKER=ch-marker CH_FINDINGS=ch-findings.json)"
ANCHOR_FILE="${ROOT}/${anchor%%#*}"
if [ ! -e "$ANCHOR_FILE" ]; then
  echo "possibly-stale: anchor file deleted since read"
elif [ -n "$(find "$ANCHOR_FILE" -newer "$CH_MARKER" 2>/dev/null)" ]; then
  echo "possibly-stale: anchor file modified since read"
fi
```

(`${anchor%%#*}` strips the `#NearestNamedSymbol` suffix, leaving the relative file path — the same parsing as the Step 6 anchor format.)

Tag any finding that trips either condition with `"possiblyStale": true` in its JSON and rewrite `$CH_FINDINGS` with the tag applied — do not drop the finding outright, since the underlying change might be unrelated to what the finding actually describes (a docstring edit two lines from the flagged block). Findings whose anchor (and every related anchor) is unchanged proceed as-is, with no tag.

This check is cheap and mechanical — one `find -newer` per anchor — so run it every time, even under time pressure. Step 9 reads `possiblyStale` to route the finding to a human for re-confirmation (interactive mode) or to hold it back entirely (headless/Routine mode) rather than filing it against content the judge never actually saw.

**Step 8 — VALIDATE, FINGERPRINT, DEDUP.** Re-resolve:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CH_FINDINGS=ch-findings.json CH_PAYLOADS=ch-payloads.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/code-health.js" validate-findings "$CH_FINDINGS" \
  --root "${ROOT:-$PWD}" \
  --slice "${SLICE_ID}" \
  --run-id "${RUN_ID}" \
  ${ISSUES_FILE:+--issues "$ISSUES_FILE"} \
  ${MIN_RISK:+--min-risk "$MIN_RISK"} \
  ${DRY_RUN:+--dry-run} \
  > "$CH_PAYLOADS"
```

`SLICE_ID` is the `id` field from the `next-slice` output in Step 1 (or the `--area` value when using manual override; under focus mode, `focus:<vertical>` — see `focus-mode.md`'s F5). `RUN_ID` is the run identifier for this sweep (ISO timestamp or any stable string unique per run).

Read `$CH_PAYLOADS`. The command:
- Validates each finding (drops malformed ones with a logged reason on stderr).
- Fingerprints via `criterion + areaId + normalizeAnchor(anchor)`.
- Deduplicates against open `by:code-health` issues and the local cache — including honoring a `wontfix`-labelled match as a standing suppression (see Step 2).
- Writes the updated cache and records the run-log + slice cursor (unless `--dry-run`).
- Emits gh-ready payloads on stdout as a JSON array.

**Step 9 — FILE / REOPEN ISSUES.**

Read `filing.md` in this skill's directory and apply it. It owns the whole filing procedure: the born-`ready` rule, the drain-rate cap and digest mode (`_shared/health-filing-digest.md`), the retry-queue drain and regressed-reopen mechanics (`_shared/health-filing-mechanics.md`'s canonical shape, as `{BINARY}` = `code-health.js`, `{PREFIX}` = `code-health`), label bootstrapping, the interactive file-all/route-individually gate (`_shared/health-filing-gate.md`), and the `work-types` Type-expression branch. `/code-health` never edits anything directly — it only judges and files.

**Step 9.5 — Confirm health-state persistence.**

Cursor, run-log, and remembered-cache persistence now happens against the durable `health-state`
branch, not local disk — see `_shared/health-state.md` for the mechanism. `validate-findings`
handles this internally (via `bin/lib/health-core/durable-state.js`) whenever it's run without
`--dry-run` and `--slice` is set; a persistence failure after retries is reported to stderr but
never blocks payload emission (a lost bookkeeping write just means the next firing might redo
some rotation work, which is safe).

In `--dry-run` mode, neither the local cache nor the durable health-state write happens — the
run is truly a no-op for all persistence.

**Step 10 — SUMMARIZE.**

Report: how many findings were emitted, how many survived dedup, how many issues were filed / skipped / remembered. List any new issue URLs. Always include the throttle line per `_shared/health-filing-digest.md`'s SUMMARIZE step: `filed: N, digested: M, cap: {CAP}, materiality: K` — report it even when `M` and `K` are both `0`, so the throttle is visible rather than inferred.

Also report the slice's read coverage, so the summary can never imply more coverage than the sweep had: the slice id, whether it was read recursively or own-files-only (Step 1's `recursive`), bytes read, and — if Step 3's read budget was reached — every **deferred** file with its size, under a `Deferred (read budget)` heading. When nothing was deferred, say so in one line rather than omitting the section; an absent section is indistinguishable from a forgotten one. Under focus mode, there is no slice id or `recursive` flag — report `focus-mode.md`'s scanned-file and skipped-file counts instead (Step F2).

## Routine Configuration

`/code-health` ships a routine template (`skills/code-health/routine-template.yml`) designed for small, predictable sips: one slice per run, so a scheduled firing is cheap and a skipped one is harmless. Instantiate it for the current project with:

```
/claude-tweaks:routine create code-health
```

This resolves the account- and project-specific values a portable template can't hardcode (which environment, which repo) and creates a live cloud Routine via `RemoteTrigger` directly — see `skills/routine/SKILL.md` for the full mechanism. Add `--dry-run` to inspect the assembled configuration before anything is created.

**Headless run flow:** SCOPE(`next-slice`) → CLASSIFY → JUDGE → VERIFY GATE → FRESHNESS RE-CHECK → `validate-findings` → file issues (dropping any finding still flagged `possiblyStale`). Triage happens later in GitHub — the Routine does not wait for interactive input. The template's prompt omits `--area` so `next-slice` always picks the highest-priority slice automatically. Code-health's own `--budget` flag (default 1 slice per run) governs how deep each firing goes — raise it via a manual `/claude-tweaks:code-health --budget <n>` run if you want a one-off deeper sweep; the routine itself always uses the template's single-slice default, and token cost scales with whatever budget is in effect for that invocation.

A focus-mode routine (`routine-template.yml`'s `focus` field, currently unset in every shipped template — see `skills/_shared/routine-template-schema.md`) does not follow this one-slice-per-run shape at all: it sweeps every candidate the generator finds, repo-wide, on every firing. See `focus-mode.md` for its own routine framing.

A skipped run (e.g., `next-slice` returns `null` because all slices are fresh) is harmless — rotation resumes from the same position on the next window. This is now actually true across a scheduled cloud-routine's container recycling too: rotation cursors, the sub-threshold remembered cache, and the filing retry queue all live on the durable `health-state` branch (`_shared/health-state.md`), not local disk that a fresh container wouldn't have.

> **Billing note:** Routines run inside the subscription; verify automation-credit specifics against the live account. (Canonical text in `_shared/health-routine-notes.md` — shared with `/harness-health`, `/journey-health`, and `/docs-health`.)

## CI Integration

Read `ci-integration.md` in this skill's directory when wiring `/code-health` state into CI, a pre-push hook, or a periodic validation step — it owns `status --fail-on regressed|risk-high` (Regression and Risk Gating) and `churn-report --fail-on-high-churn <r>` (Fingerprint Churn), with their exit-code contracts. Nothing in the main Workflow depends on it.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention). When high-severity issues were filed, bold the `/claude-tweaks:specify` line and suffix it `(recommended)`; otherwise render all four lines unranked in the order below.

**`/claude-tweaks:specify <issue-url-or-title>`** — promote a filed code-health issue into an agent-sized spec (recommended when high-severity issues were filed)
`/claude-tweaks:capture <finding>` — park a fuzzy or below-threshold finding in the backlog for later triage
`/claude-tweaks:code-health --area <other-path>` — re-run on a different directory slice
`/claude-tweaks:tidy` — fold the new issues into a backlog-hygiene pass alongside captured and deferred items

## Component-Skill Contract

`/claude-tweaks:code-health` is a **standalone-only** skill — no invocation path exists from `/claude-tweaks:flow` or any other skill in this project today (`flow/SKILL.md`'s Allowed Steps table and workflow text never mention `code-health`, and `docs/skill-graph.md` records no edge from `/flow`). The `## Next Actions` block always renders. If a future orchestrator wraps this skill, that orchestrator must update this contract to state its own `$PIPELINE_RUN_DIR`-gated handoff; until then, treat parent invocation as not applicable.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Editing code to fix a finding mid-sweep | Report-only — fixing belongs to `/build` / `/flow` once `/specify` promotes it. |
| Filing every finding regardless of severity or confidence | Floods the tracker; sub-threshold and low-confidence findings are cached, not filed. |
| Re-filing a finding that already has an open issue | Duplicates the tracker. Run `validate-findings --issues` first. |
| Hashing the prose description instead of the anchor | Prose changes every run; dedup needs the stable anchor `relfile#NearestSymbol`. |
| Emitting a line number in the anchor | Line numbers move, breaking dedup. Anchor is `file#Symbol` — no `:12`, no `:12:3`. |
| Calling the network from `code-health.js` or `criteria.js` | The engine is emit-only and unit-testable; only the skill touches `gh`. |
| Treating the cache as durable state | It's a rebuildable optimization; GitHub issue state is the cross-run source of truth. |
| Filing `confidence: 'low'` on a noisy criterion | Criteria carrying `confidenceFloor: 'high'` (canonical list: `bin/lib/code-health/criteria.js`) need `confidence: 'high'`; `validate-findings`' `applyConfidenceFloor` drops the rest pre-dedup. |
| Skipping the verify gate before filing | Files plausible-but-wrong findings. Survivors must pass every verify question — real, actionable, reproducible, likelihood justified, effort consistent — pre-dedup. |
| Filing a finding still flagged `possiblyStale` | Its anchor file changed after the judge read it. Route to human re-confirmation (interactive) or the next sweep (headless). |
| Filing `gh issue create` off a `--dry-run` payload with no real `validate-findings` call | Breaks rotation silently: cursors and the run-log never persist, so `next-slice` re-selects the same slice. |
| Splitting one recurring root cause into N near-duplicate issues | One fix at N call sites floods the tracker; `relatedAnchors` covers every occurrence in one finding. |
| Filing before presenting the interactive gate | The two-tier decision precedes any `gh issue create` for new findings — see `_shared/health-filing-gate.md`'s placement rule. |
| Reading a `"recursive": false` slice's subdirectories | Separate slices with own ids and cursors — sweeping them blows the read budget and files under the wrong slice id. Add `-maxdepth 1`. |
| Dropping files at Step 3's read budget without listing them | Implies whole-slice coverage the sweep never had. Over-budget files are read bounded and reported **deferred** in Step 10. |
| Treating a focus-mode candidate set as fully read | The 60 KB budget defers most candidates on any real repo (`focus-mode.md`'s F3) — the judge only sees what was actually read. Check the deferred count and `skippedFiles` before trusting a clean-looking result. |
