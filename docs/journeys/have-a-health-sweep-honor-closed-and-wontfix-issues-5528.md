---
files:
  - plugin/bin/lib/health-core/issue-index.js
  - plugin/bin/lib/health-core/dedup.js
  - plugin/bin/lib/code-health/dedup.js
  - plugin/skills/_shared/health-issue-index.md
---

# Have a Health Sweep Honor Closed and Wontfix Issues

**Persona:** Maintainer whose health sweep (`/claude-tweaks:code-health`, `/claude-tweaks:harness-health`, `/claude-tweaks:journey-health` or `/claude-tweaks:docs-health`, run by hand or by a scheduled Routine) writes its `--issues` file straight from what `gh issue list --json number,state,labels,body` returns, without tidying the fields first.
**Goal:** Get the dedup decisions the sweep documents: a finding whose issue was closed comes back as a reopen, and a finding whose issue carries `wontfix` stays suppressed.
**Entry point:** The sweep's GATHER OPEN ISSUES step, followed by `node plugin/bin/{skill}.js validate-findings {findings} --issues {file}`.
**Success state:** The sweep's output is the same whether the issues file holds `state: "CLOSED"` and label objects or `state: "closed"` and label names. Nothing was silently skipped, and the maintainer never had to know which shape the session wrote.

## Steps

### 1. Build the issue index — the sweep's GATHER OPEN ISSUES step
- **Action:** The sweep fetches its `by:{skill}` issues with `gh issue list` (or, without `gh`, the MCP `list_issues` tool), extracts each fingerprint, and writes `{ number, state, labels, fingerprint }` objects to the issues file.
- **Should feel:** Like there is nothing to get wrong — the two fields can be copied across as `gh` returned them.
- **Should understand:** `state` may be in either case and each label may be a name or `gh`'s label object; the loader lowercases the state and reduces labels to names (`_shared/health-issue-index.md`).
- **Red flags:** An instruction to lowercase the state or project label names by hand before writing the file.

### 2. Re-encounter a finding whose issue was closed — `validate-findings --issues {file}`
- **Action:** The sweep re-finds a problem whose issue is `CLOSED` and has no `wontfix` label.
- **Should feel:** Honest — the regression is surfaced, not swallowed.
- **Should understand:** The finding comes back as a payload to reopen that issue, and code-health's local cache records it as `regressed`. The first sweep after this fix can reopen issues an earlier sweep skipped.
- **Red flags:** No payload for the finding and no cache change — the closed issue was read as still open.

### 3. Re-encounter a finding whose issue is marked wontfix — `validate-findings --issues {file}`
- **Action:** The sweep re-finds a problem whose issue carries the `wontfix` label, written in the file as the object `{ "name": "wontfix" }`.
- **Should feel:** Respected — a standing decision is not argued with again.
- **Should understand:** No payload is produced for that finding, and code-health caches it as `wontfix` so a later run without GitHub access still suppresses it. The label is matched exactly: `Wontfix` is a different label.
- **Red flags:** The finding re-filed or its closed issue reopened despite the label.

### 4. Notice a label shape the loader does not know — stderr
- **Action:** The issues file carries a label entry with no name (a `null`, a number, an object without a string `name`), or a `labels` value that is not a list.
- **Should feel:** Informed, not interrupted — the sweep finishes and says what it ignored.
- **Should understand:** One line, `[{skill}] loadIssueIndex: ignored {n} label entries with no name`, with the total for the whole file. The issue itself is kept; only the nameless entries are dropped.
- **Red flags:** No line at all while a `wontfix` label goes unrecognised, or one line per issue flooding the output.

## Origin
- Created during build of record #5528 (flow run `2026-11-15T210059-spec-5528-5529`).
- Steps 1-4 built in this session.
- Related: `code-health-focus-sweep.md` (the sweep these decisions belong to), record #5529 (the other fix from the same audit).
