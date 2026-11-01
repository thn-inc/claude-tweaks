---
files:
  - plugin/bin/preflight-records.js
  - plugin/bin/lib/preflight-records/preflight-records.js
  - plugin/skills/flow/multispec-preflight-failure.md
  - plugin/skills/flow/multi-spec.md
---

# Handle a Failed Multi-Spec Pre-flight

**Persona:** a maintainer or operator running `/claude-tweaks:flow #A,#B,#C` on a multi-record batch in default `auto` mode, either at a terminal with `gh` or as a cloud session or Routine with no `gh`, only GitHub MCP tools.
**Goal:** either get a batch whose dependencies were really checked, or get a clear stop that says why they couldn't be. Never a run that quietly builds records in an unchecked order.
**Entry point:** `/flow`'s multi-spec Validation step 3 (`multi-spec.md`), which calls `bin/preflight-records.js` once, before Step 2.8 claims anything.
**Success state:** one of four outcomes, each visible.
- Exit 0: the run proceeds on real records, overlap groups and merge-gate data.
- A one-off `gh` hiccup: absorbed by one retry.
- A persistent failure: a STOP before claiming that quotes the CLI's stderr, or, with no `gh`, names the record whose MCP fetch failed.
- A gh-absent run: proceeds on records it fetched itself. Under `work-links: native` it also gets one `SKIP` line saying the native links were unchecked.

## Steps

### 1. Pre-flight runs once — the common case
- **URL:** `plugin/skills/flow/multi-spec.md` Validation step 3
- **Action:** `/flow` runs `bin/preflight-records.js {targets} --merge-gate --integration-branch "$INTEGRATION_BRANCH"` (plus `--waves` under `parallel`). On exit 0, ordering, the merge-state gate, waves and conflict detection all read the one envelope.
- **Should feel:** Invisible — nothing to decide when pre-flight works.
- **Should understand:** Steps 4 and 5 run only on an exit-0 envelope. Every other exit takes the paths below.
- **Red flags:** Ordering or conflict detection running after a non-zero exit, as if the missing data meant "no dependencies".

### 2. A `gh` hiccup gets one retry, then a stop
- **URL:** `plugin/skills/flow/multispec-preflight-failure.md`, "Exit 1"
- **Action:** On exit 1 (a record fetch or the native GraphQL call failed), `/flow` re-runs the identical call once. A second exit 1 is a **STOP before claiming**, quoting stderr. On a fetch failure, stderr names every failing record; a native GraphQL failure names none. Under `parallel`, the re-run without `--waves` is that one retry.
- **Should feel:** Forgiving of a blip, firm about a real outage. One retry, never a loop, never a third call.
- **Should understand:** A missing record can't cause this, because step 1 (Parse) already stopped on any record that wouldn't resolve. Nothing needs tearing down, since no claim, worktree or run-dir write exists yet. Inside a `/claude-tweaks:dispatch` bundle, the STOP is that bundle's failed run.
- **Red flags:** More than one retry. A STOP after a claim was made. A `parallel` run that retries twice (once with `--waves`, once without).

### 3. A malformed call or a dependency cycle stops at once
- **URL:** `plugin/skills/flow/multispec-preflight-failure.md`, "Exit 2"
- **Action:** On exit 2 (an invocation bug, an unresolvable owner/repo under `native` or for a `--blocker-landing` blocker set, a `Blocked by #0` blocker number, a `--records-json` or `--blocker-states-json` input problem, or a `--waves` dependency cycle), `/flow` STOPs before claiming, with no retry, quoting stderr.
- **Should feel:** Immediate — retrying can't fix a malformed call.
- **Should understand:** A `--waves` cycle under `parallel` also STOPs, and never drops to a sequential run. Step 4 would hard-fail the same cycle anyway.
- **Red flags:** An exit-2 run that retries, or that falls back to sequential.

### 4. No `gh`: the skill fetches the records and hands them in
- **URL:** `plugin/skills/flow/multispec-preflight-failure.md`, "Transport"; `plugin/bin/preflight-records.js` `--records-json`, validated by `issuesFromRecordsJson` in `plugin/bin/lib/preflight-records/preflight-records.js`
- **Action:** With no `gh`, `/flow` fetches each target over MCP `issue_read` (get mode), reusing step 1's records where present. It reshapes each one to `gh issue view`'s `{number,title,body,labels,url}`, writes the array to a session-scoped temp file, and adds `--records-json {file}` to the same call. If any `issue_read` fetch fails, `/flow` STOPs before claiming, naming that record, and writes no partial file. The CLI makes no `gh` call on this path, so it never exits 1. A bad file (missing, not JSON, wrong shape, a record missing or extra) is exit 2, naming the problem.
- **Should feel:** Like the normal run. Records, overlap groups and the merge gate are all real, just fetched another way.
- **Should understand:** This mirrors `materialize.js --record-json` (#1459). The CLI never falls back to `gh` when the file is bad.
- **Red flags:** A gh-absent multi-spec run that exits 1 at step 3. A `--records-json` run that still shells out to `gh`. A `--records-json` file written with records missing after an `issue_read` fetch failed, instead of a STOP.

### 5. Native links can't be read without `gh`, and the run says so
- **URL:** `plugin/skills/flow/multispec-preflight-failure.md`, "`nativeLinksUnchecked: true`"; the parent run's `decisions.md` (`## /flow`)
- **Action:** Under `work-links: native`, the `--records-json` envelope reports `workLinks: "body-text"` and `nativeLinksUnchecked: true`. `/flow` proceeds. After the Manifesto write, it logs one `SKIP … — Step 1 native dependency links (skipped)` line: ordering, the merge-state gate and (under `parallel`) the wave plan ran on body-text dependencies.
- **Should feel:** Candid. The run continues, and the Review Console shows plainly that native-only dependencies went unchecked.
- **Should understand:** The GitHub MCP server has no GraphQL passthrough (`dispatch/mcp-transport.md`, #2523), so native blocked-by links are invisible here. In a native-links repo, bodies rarely mention dependencies, so cross-record order is effectively unchecked. That is a deliberate, maintainer-approved degrade, the same one `/claude-tweaks:dispatch` makes.
- **Red flags:** No `SKIP` line on a native, gh-absent run. A `SKIP` that reads as "no dependencies" rather than "unchecked". A `gh`-path native failure silently switching to body text, when it should be exit 1.

## Origin
- Created during #3351's build (run 2026-10-17T095806-spec-3351): `preflight-records.js --records-json`, `issuesFromRecordsJson`, and `multispec-preflight-failure.md`.
- Related: `run-a-batch-whose-record-needs-a-merged-prerequisite-2733.md` (the merge-state gate that now defers to this ruling) and `run-independent-records-in-parallel-waves-2677.md` (the waves fallback, now exit 1 only).
