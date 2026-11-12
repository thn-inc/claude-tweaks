# CI Run Health Check (#5161)

A deterministic check `/claude-tweaks:harness-health` runs every firing, lazy-loaded from `SKILL.md`'s Step 1. It reports CI run health for the audited repository (per-workflow run duration against the merge gate's 15-minute watch, the weekly trend, superseded and cancelled runs, push-run coverage, and Actions budget headroom) and files one deduplicated `by:harness-health` issue when a threshold is breached. It is not the judged dimension analysis `_shared/harness-health-analysis.md` performs: a run duration or a headroom percentage is a measured fact, so it never produces a `patch`/`new-skill` finding.

## When it runs

Every firing, whichever branch Step 1 takes, nothing-due early exit included; that exit stops before Step 8, so there the `ci health:` lines go into its stop report instead. Under `--dry-run` it is skipped (the CLI calls `gh` for every read) and Step 8's SUMMARIZE report carries the line `ci health: skipped (--dry-run never calls gh)`.

## Invocation

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ci-health.js" --file
```

When `--root` names another checkout, add `--repo {owner}/{name}`, read from that checkout's `origin` remote; without it the CLI reads the current directory's origin. `--file` files only on a breach, and never on a truncated window or a failed runs read (any page): the CLI applies those rules itself, so never re-derive them here.

## Reading the result

- **Exit 0** (report written, partial allowed): copy every stdout line into Step 8's SUMMARIZE report under a `ci health:` lead, verbatim. The lines already name what was skipped or unavailable (`not filed: window truncated`, `not filed: runs read failed`, `not filed: open issue exists`, `billing unavailable (...)`, `failed read: ...`), so add no summary of your own on top. A report with no `breach:` line carries no filing line.
- **Exit 2 with stdout lines** (every runs read failed): the report still names what was unavailable, billing line included. Copy every stdout line under the same `ci health:` lead, exactly as for exit 0.
- **Exit 2 with empty stdout** (a usage or origin error): report `ci health: failed ({first stderr line})`.

**Missing label.** A `failed read: file issue: {error}` line whose error names a label that does not exist means the repository lacks a label the issue carries. Bootstrap `by:harness-health`, `risk:low` and `size:low` (and `type:task` under `work-types: labels`) per `_shared/label-bootstrap.md`, with the descriptions `filing.md`'s bootstrap block gives (`type:task`'s, which that block omits, from `record.js`'s `TYPE_LABELS`, defined in `plugin/bin/lib/issues/record-vocabulary.js`), then re-run the invocation above once with `--file`. Report the re-run's lines in place of the first run's; a second failure is reported as it stands, never retried again.

## `gh` absent

With `gh` absent (a cloud Routine sandbox), the report says both halves are unavailable (`runs unavailable (gh absent)`, `billing unavailable (gh absent)`), and the CLI exits 2. That is never a clean result: report it as it stands. `_shared/github-write-transport.md`'s MCP path covers record CRUD, not workflow-run or billing reads, so there is no fallback read. In such a sandbox the origin is often a proxy URL that is not a GitHub origin, so a run without `--repo` exits 2 with empty stdout before any read, and reports `ci health: failed ({first stderr line})` instead; that is not a clean result either.

## What it never does

The check reports and files only. It never edits a workflow file, and it never changes the merge gate's 15-minute watch, whatever p90 it measures: p90 is run duration and excludes queue wait, so it is advisory evidence for the watch, not a verdict on it.
