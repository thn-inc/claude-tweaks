QA collection, recoveries, reporting, and ledger writes — Phases 4, 4.5, 5, 5.5. Read `qa-procedures.md` for pre-flight and `qa-prompts.md` for parallel dispatch.

# QA Phase 4: Collect

22. Parse each agent's report to extract:
    - Story ID (from the `RESULT:` line or `REPORT_JSON` comment)
    - Overall result: PASS, PASS_WITH_CAVEATS, or FAIL
    - Steps completed vs total (from the `Steps: X/Y` portion)
    - Caveats array (from the `REPORT_JSON` comment's `caveats` field — may be empty)
    - Recovered locators array (from the `REPORT_JSON` comment's `recovered_locators` field — may be empty)
    - Page inventories array (from the `REPORT_JSON` comment's `page_inventories` field — one entry per unique URL visited, may be empty)
    - Trace path (from the `TRACE:` line, if present — only for failures)
    - The full agent report text
    - Elapsed time (from the timing data recorded in Phase 3, step 20)
23. Be resilient: if an agent times out or crashes, mark that story as FAIL and include whatever output was available. If a `TRACE:` line is present in the partial output, retain it.

### Finding Classification

After collecting all agent reports, classify each failure into one of 5 categories using heuristic rules. Classification is automated — override categories in the findings table if needed.

| Category | Signal | Default Severity | Suggested Fix Pattern |
|----------|--------|-----------------|----------------------|
| `stale-selector` | Error contains "locator not found" or "element not found" | Low | "Update locator in story YAML" |
| `code-bug` | Error contains "assertion" or "expected" or "verify failed" | High | "Investigate component behavior" |
| `ux-issue` | From caveats (PASS_WITH_CAVEATS stories) | Medium | Specific to the observation |
| `flaky-env` | Error contains "timeout" or "navigation failed" or "net::" | Low | "Re-run: `/test qa retry={RUN_DIR}`" |
| `story-bug` | Element exists but in wrong position, or step instructions don't match current UI flow | Medium | "Regenerate story: `/stories focus={area}`" |

**Classification rules (apply in order — first match wins):**
1. Error contains "locator not found" or "element not found" -> `stale-selector`
2. Error contains "timeout" or "navigation failed" or "net::" -> `flaky-env`
3. Error contains "assertion" or "expected" or "verify failed" -> `code-bug`
4. Error suggests the page structure changed (element exists but in wrong position) -> `story-bug`
5. No error match -> `code-bug` (default for unclassified failures)

**Caveat-to-finding conversion:** Each caveat from a PASS_WITH_CAVEATS story generates a `ux-issue` finding with severity Medium. These are informational and do not block the gate.

**Auto-recovered selector classification:** When a locator was auto-recovered by the qa-agent (present in the `recovered_locators` array), classify it as `stale-selector` with status `auto-fixed` rather than `open`. These do not block the gate — the locator has already been corrected in the story YAML (see Phase 4.5).

## Phase 4.5: Apply Selector Recoveries

After ALL agents in a tier complete (not during execution — to avoid file write conflicts between parallel agents), apply any recovered locators to the story YAML files.

**Important:** This phase runs once per tier, after Phase 4 (Collect) finishes for that tier. Recovered locators are buffered by each qa-agent in its report — the agent never writes to YAML files directly.

**Procedure:**

1. Collect all `recovered_locators` arrays across all agent reports in this tier. If none have recoveries, skip this phase.

2. Group recoveries by source YAML file (tracked in Phase 1, step 6 — each story knows which file it came from).

3. For each source file with recoveries:
   a. Read the YAML file using the Read tool.
   b. For each recovery in this file:
      - Find the story by its ID within the `stories` array.
      - Find the step by the `step_index` from the recovery record.
      - Replace the old `locator:` value with the recovered locator.
      - Add a YAML comment on the line above: `# auto-recovered from: {original_locator}`
   c. Use the Edit tool for each targeted replacement — do not rewrite the entire file. This preserves comments, ordering, and formatting.

4. Log a summary after all updates:
   ```
   Auto-recovered {N} locator(s) in {M} story file(s)
   ```

**Conflict avoidance:** Because this phase runs only after all agents in a tier have completed, there is no risk of concurrent writes to the same YAML file. If the same file has recoveries from multiple agents (multiple stories in the same file), apply them sequentially within this phase.

## Phase 5: Report

24. Record the total wall-clock time for the entire run (from the start of Phase 3 to the end of Phase 4).

25. Write report artifacts to disk:

**`{RUN_DIR}/report.json`** — machine-readable:

**Canonical schema.** The `page_inventories` array below (`interactive_elements`/`forms`/`navigation`/`accessibility`/`layout`) re-specifies the same nested shape declared canonical by `agents/qa-agent.md`'s `## Report` section — this file's `page_inventories` block must be kept byte-for-byte in sync with it.

```json
{
  "run_dir": "{RUN_DIR}",
  "timestamp": "ISO-8601",
  "stories_dir": "{STORIES_DIR}",
  "filters": {
    "tag": "{TAG_FILTER or null}",
    "priority": "{PRIORITY_FILTER or null}",
    "retry": "{RETRY_RUN_DIR or null}",
    "journey": "{JOURNEY_FILTER or null}"
  },
  "summary": {
    "total": N,
    "passed": N,
    "pass_with_caveats": N,
    "failed": N,
    "skipped": N
  },
  "timing": {
    "wall_clock_seconds": N,
    "parallelism_factor": N.N
  },
  "findings": [
    {
      "story_id": "story-id",
      "category": "stale-selector|code-bug|ux-issue|flaky-env|story-bug",
      "severity": "Low|Medium|High",
      "finding": "Description of the finding",
      "suggested_fix": "Suggested remediation",
      "trace": "{trace path or null}"
    }
  ],
  "caveats": [
    {
      "story_id": "story-id",
      "observation": "Observation text from the agent"
    }
  ],
  "recovered_locators": [
    {
      "story_id": "story-id",
      "source_file": "filename.yaml",
      "step_index": 0,
      "original_locator": "old-locator",
      "recovered_locator": "new-locator",
      "reason": "reason description"
    }
  ],
  "page_inventories": [
    {
      "story_id": "story-id",
      "url": "absolute URL",
      "interactive_elements": { "buttons": N, "links": N, "inputs": N, "selects": N, "checkboxes": N },
      "forms": { "count": N, "fields_per_form": [N, N] },
      "navigation": { "nav_elements": N, "breadcrumbs": true, "tabs": N },
      "accessibility": { "aria_landmarks": N, "heading_levels": [1, 2, 3], "missing_labels": N },
      "layout": { "viewport_overflow": false, "scroll_height": N }
    }
  ],
  "stories": [
    {
      "id": "story-id",
      "name": "Story name",
      "source_file": "filename.yaml",
      "status": "PASS|PASS_WITH_CAVEATS|FAIL|SKIPPED",
      "steps_passed": N,
      "steps_total": N,
      "elapsed_seconds": N,
      "error": null,
      "caveats": [],
      "trace": "{trace path or null}",
      "screenshot_dir": "{SCREENSHOT_PATH}"
    }
  ]
}
```

The `summary.passed` count includes both PASS and PASS_WITH_CAVEATS stories (since caveats are informational). The `summary.pass_with_caveats` count is the subset of passed stories that had caveats. The `findings` array contains classified failure findings and caveat-derived ux-issue findings. Each failure finding includes the `trace` path captured by the qa-agent before closing the session — a Chrome DevTools trace, opened via Chrome DevTools → Performance → Load profile (the CLI has no trace-viewing subcommand). The `caveats` array contains raw observations from PASS_WITH_CAVEATS stories. The `recovered_locators` array contains all locator recoveries across all stories — each entry includes the source file and step index so the YAML update can be traced. The `page_inventories` array contains structured snapshot data per unique URL — consumed by `/review` lens 3h (UX analysis, `ux-analysis.md`) and `/visual-review` (`browser-review.md`'s Shared review contract, "First Impressions (Step 2)") to ground page-level recommendations in observed structure.

**`{RUN_DIR}/report.md`** — human-readable (same format as the report below).

**QA pass stamp (pipeline runs, #3003).** Inside a `/claude-tweaks:flow` pipeline, immediately after `report.json` is written, run `node "${CLAUDE_PLUGIN_ROOT}/bin/qa-stamp.js" --write --report "{RUN_DIR}/report.json" [--stories-dir <dir>]` (pass `--stories-dir` when `STORIES_DIR` is not the default). The CLI writes the stamp only for a clean tree (its own `.claude-tweaks/artifacts/`-excluding check, not report.json's `dirty`) where every story is PASS or PASS_WITH_CAVEATS. Otherwise it prints `{written: false, reason[, invalidated: true | invalidateFailed: <code>]}` and writes nothing; a `reason` is not itself an error, but a never-firing stamp is invisible unless surfaced — add one line to the QA report's output: `QA pass stamp: not written ({reason})` (append `, invalidated prior stamp` when `invalidated` is `true`, or `, could not remove stale prior stamp ({code}) — the next same-HEAD check may skip wrongly` when `invalidateFailed` is present). A later `/claude-tweaks:test` call at the same HEAD (a dispatched group's second call) reads the stamp before dispatching stories (`SKILL.md`'s pipeline story selection).

26. Present the aggregated results:

```
# QA Review Summary

**Run:** {current date and time}
**Stories directory:** {STORIES_DIR}
**Filters:** {list active filters, or "none"}
**Stories:** {total} total | {pass} pass | {pass_with_caveats} pass (caveats) | {fail} fail | {skip} skipped
**Status:** ALL PASSED | PASSED WITH OBSERVATIONS | PARTIAL FAILURE | ALL FAILED

## Findings (action required)

(Only include if there are findings from failures)

| #   | Story        | Category         | Severity | Finding                          | Trace                                | Suggested Fix                       |
| --- | ------------ | ---------------- | -------- | -------------------------------- | ------------------------------------ | ----------------------------------- |
| 1   | {story name} | stale-selector   | Low      | Locator "Submit" not found       | .claude-tweaks/artifacts/traces/{id}/{ts}.zip                 | Update locator in story YAML        |
| 2   | {story name} | code-bug         | High     | Expected "Dashboard" in title    | .claude-tweaks/artifacts/traces/{id}/{ts}.zip                 | Investigate component behavior      |

> Traces are Chrome DevTools traces — open via Chrome DevTools → Performance → Load profile. Classification is automated — override categories in the findings table if needed.

## Observations (informational)

(Only include if there are caveats from PASS_WITH_CAVEATS stories)

| #   | Story        | Observation                                    |
| --- | ------------ | ---------------------------------------------- |
| 1   | {story name} | Missing aria-label on 3 interactive element(s) |
| 2   | {story name} | Page load took 4.2s                            |

## Recovered Locators

(Only include if any locators were auto-recovered during the run)

Auto-recovered {N} locator(s) in {M} story file(s). Story YAML files have been updated.

| #   | Story        | Step             | Original             | Recovered                |
| --- | ------------ | ---------------- | -------------------- | ------------------------ |
| 1   | {story name} | Step description | role:button "Submit" | testid:submit-cta        |
| 2   | {story name} | Step description | text:"Old label"     | label:"Email address"    |

## Results

| #   | ID           | Story        | Source File | Status            | Steps            | Elapsed |
| --- | ------------ | ------------ | ----------- | ----------------- | ---------------- | ------- |
| 1   | {story.id}   | {story name} | {filename}  | PASS              | {passed}/{total} | {N}s    |
| 2   | {story.id}   | {story name} | {filename}  | PASS_WITH_CAVEATS | {passed}/{total} | {N}s    |
| 3   | {story.id}   | {story name} | {filename}  | FAIL              | {passed}/{total} | {N}s    |
| 4   | {story.id}   | {story name} | {filename}  | SKIPPED           | —                | —       |

## Skipped (dependency, auth-vault, target-environment, or step-origin skips)

(Only include if there are skipped stories)

| Story ID     | Story Name   | Reason                       |
| ------------ | ------------ | ---------------------------- |
| {story.id}   | {story name} | Blocked by {dep id} / missing-auth-vault: {vault name} / unacknowledged-remote-target: {host} / unresolved-secondary-origin: {origin} |

## Story Hygiene

(Only include when Phase 2.5's tag-hygiene capture recorded anything — `VAULT_TAG_STALE` or `NEEDS_REVIEW_RAN` non-empty. This section is the consumer for the repair tags `/stories` writes; without it those tags are dead writes nothing ever reads.)

| Story ID   | Tag               | This run | Recommendation                                              |
| ---------- | ----------------- | -------- | ----------------------------------------------------------- |
| {story.id} | `needs-review`    | PASS     | Tag is stale — clear it (re-run below revalidates + clears) |
| {story.id} | `needs-review`    | FAIL     | Story is genuinely broken — regenerate it                   |
| {story.id} | `needs-auth-vault`| PASS     | Vault `{name}` now exists — tag is stale, clear it          |

`/claude-tweaks:stories` — update-mode re-run revalidates flagged stories, clears healed tags, and regenerates broken ones

## Failures

(Only include this section if there are failures)

### Story: {failed story name}
**ID:** {story.id}
**Source:** {filename}
**Trace:** `{trace path}` — a Chrome DevTools trace; open via Chrome DevTools → Performance → Load profile (not a slash command)
**Agent Report:**
{full agent report for this story}

---

(Repeat for each failed story)

## Timing

| Story        | Elapsed | Status            |
| ------------ | ------- | ----------------- |
| {story.id}   | {N}s    | PASS              |
| {story.id}   | {N}s    | PASS_WITH_CAVEATS |
| {story.id}   | {N}s    | FAIL              |

**Total wall-clock:** {M}m {S}s
**Parallelism factor:** {stories_run / (wall_clock / avg_story_time)}

(Parallelism factor indicates effective concurrency: 1.0 means fully serial, 4.0 means four stories ran in parallel on average. Only stories with PASS, PASS_WITH_CAVEATS, or FAIL status are counted — SKIPPED stories are excluded.)

## Journey Coverage

(Only include when JOURNEY_FILTER was set or when stories with `journey:` fields are present)

| Journey | Stories Run | Passed | Failed | Steps Covered | Status |
|---------|-----------|--------|--------|---------------|--------|
| {name} | {N} | {pass} | {fail} | {covered}/{total} | Full / Partial |

(Steps Covered counts how many of the journey's documented step URLs had at least one story exercised against them in this run.)

## Screenshots & Traces
- Screenshots: `{RUN_DIR}/`
- Failure traces: `{TRACES_BASE}/<story-id>/<timestamp>.zip` — Chrome DevTools traces; open via Chrome DevTools → Performance → Load profile

## Report Files
- Machine-readable: `{RUN_DIR}/report.json`
- Human-readable: `{RUN_DIR}/report.md`
```

**Status determination:**
- **ALL PASSED** — every story passed (PASS or PASS_WITH_CAVEATS), no failures (excluding skipped)
- **PASSED WITH OBSERVATIONS** — every story passed but at least one has PASS_WITH_CAVEATS status
- **PARTIAL FAILURE** — some stories passed and some failed
- **ALL FAILED** — no stories passed

## Phase 5.5: Ledger Integration

After reporting, write findings and observations to the open items ledger (format and entry rules: `_shared/ledger-format.md`) with phase `test/qa`. Findings from failures get status `open`. Observations from PASS_WITH_CAVEATS get status `observation`.

27. **Write finding entries:** For each item in the `findings[]` array (from the report) **except** `ux-issue` category findings (skip those — they are the same caveats already written separately by item 28, and item 28's `observation` status is their canonical ledger entry), add an item to the ledger with phase `test/qa`, the finding description (including `[story: {story_id}, category: {category}, trace: {trace path or "none"}]`), severity from the finding, and status `open`. These represent failures that must be resolved before the pipeline completes.

28. **Write caveat entries:** For each item in the `caveats[]` array (from the report), add an item to the ledger with phase `test/qa`, the observation text (including `[story: {story_id}]`), severity `Info`, and status `observation`. These are informational and do not block the pipeline. This is the sole ledger entry for a given caveat — its `ux-issue`-classified counterpart in `findings[]` is intentionally skipped by item 27 to avoid writing the same observation twice under contradictory open/blocking semantics.

29. **Dedup:** Before writing each entry, check whether a ledger entry for the same story ID and finding text already exists (from a previous QA run). If a matching entry exists, do not create a duplicate — leave the existing entry in place. Match by story ID and finding content, not by exact string comparison (minor wording differences across runs should still be detected as duplicates).

## Gate for /flow

When QA review is part of a `/claude-tweaks:test` run inside a `/claude-tweaks:flow` pipeline:
- **ALL PASSED** or **PASSED WITH OBSERVATIONS** → set `TEST_PASSED=true`, proceed to the next pipeline step (PASS_WITH_CAVEATS counts as passed — caveats are informational, not blocking)
- **Any failures** → **STOP** the pipeline and present the failure report (with trace paths attached for each failure)
