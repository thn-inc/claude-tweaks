---
files:
  - plugin/bin/verify-run-bookends.js
  - plugin/bin/lib/log-decision/claim-log.js
  - plugin/skills/dispatch/task-prompt.md
  - plugin/skills/flow/claim-targets.md
---

# Confirm Call 1's Bookends Before Reporting DONE

**Persona:** a dispatched first-call agent running `/claude-tweaks:flow #{n} build,test auto` inside a `/claude-tweaks:dispatch` group's worktree, on either transport (`gh` present, or a `gh`-absent cloud sandbox using MCP). Secondary persona: the maintainer reading the CLI's JSON when a dispatch stalls.
**Goal:** before reporting `OUTCOME: build-test-ok` / `STATUS: DONE`, prove that call 1 left everything call 2 needs to adopt the run cleanly (case 1): a committed `work/{n}-spec.md`, the worktree stamp, the draft-PR stamp under `pr-first`, a canonical `Step 2.8: claimed #{n}` line, and a live claim per target.
**Entry point:** the build and test steps have finished; the agent reaches the first-call template's "Bookends (every transport, #2912)" paragraph, after its `CRITICAL:` test-artifact check.
**Success state:** `verify-run-bookends.js` exits 0 and its `confirmed` object lists every target under `claims`, `materialize` and `claimLog`. Or, on exit 1, the agent runs each `missing` entry's `remedy`, re-runs the check to exit 0, and only then reports DONE. If it still exits 1, the agent reports `build-test-blocked` / `BLOCKED`.

## Steps

### 1. Run the bookend check — first-call agent
- **URL:** `node "{plugin-root}/bin/verify-run-bookends.js" --run "{minted-run-dir}" --targets {comma-joined issue numbers}`
- **Action:** run it once, in the foreground, from the group's worktree.
- **Should feel:** a single mechanical confirmation that costs seconds, not a second test pass.
- **Should understand:**
  - The check reads `run-state.json`, `config.yml`'s `integration-model` pin, `decisions.md`, the claim blob via git, and `git cat-file -e HEAD:…` for each spec. It never trusts the agent's own narrative, and it runs the same way with or without `gh`.
  - The Manifesto writes the pin (#3350), so on a `pr-first` run the `pr` bookend is evaluated.
  - With no valid pin (a run older than #3350, or an invalid policy.yml value), the check prints one `verify-run-bookends: degraded — … carries no valid integration-model pin (absent)` line on stderr and leaves the PR bookend unchecked; the exit code is unchanged. The agent logs that line as a `SKIP` decision, never as a failure.
- **Red flags:**
  - the check skipped because the run was on the `gh` path (it is required on every transport);
  - `"pr":"n/a"` read as proof the draft PR exists (it means the run is pinned `local-merge`, or unpinned);
  - a `degraded —` stderr line ignored instead of logged as a `SKIP` decision.

### 2. Read a missing bookend — same agent
- **URL:** the exit-1 JSON, `{"ok":false,"missing":[{"bookend","issue","reason","remedy"}]}`
- **Action:** read each entry's `bookend` (`worktree`, `pr`, `claim`, `materialize`, `claim-log`) and `reason`.
- **Should feel:** diagnosed. Each entry names exactly what is absent and the one command that supplies it.
- **Should understand:**
  - `materialize` with reason `not-committed` means the spec file is absent from HEAD (it may exist on disk, uncommitted); `undetermined` means git could not answer (timeout, no worktree), which is never treated as done.
  - `claim-log` means `decisions.md` carries no exact `Step 2.8: claimed #{n}` line. A paraphrase ("claimed issue #{n}") does not count here, even though the stamps gate tolerates it.
  - For a bundle (a parent run dir with more than one target), only `spec-{n}/work/{n}-spec.md` counts.
- **Red flags:**
  - a `materialize` entry for a spec that is visibly committed at HEAD;
  - a `claim-log` entry when an exact `Step 2.8: claimed #{n}` line is present.

### 3. Run the remedies — same agent
- **URL:** each `missing` entry's `remedy` string
- **Action:** substitute the remedy's `<...>` and `{...}` placeholders and run it: `materialize.js {n} --run-dir "…"` (plus `--multi-record-slug {n}` for a bundle, `--record-json <path>` when `gh` is absent) then commit the spec; `hooks.js record-worktree`; the PR-early lifecycle then `hooks.js record-pr`; `log-decision.js … --text "claimed #{n} (bin/claim-targets.js, transport: …)"`; or `claim-targets.js` (gh-absent: `flow/claim-targets.md`'s MCP claim procedure).
- **Should feel:** like finishing the steps `/flow` would have done, through the same sanctioned writers.
- **Should understand:** when a `claim` entry is missing for the same issue, its remedy already writes the canonical claim line, so the matching `claim-log` remedy says it is covered rather than logging a duplicate.
- **Red flags:**
  - hand-editing `run-state.json` or hand-writing a claim-log line in free text;
  - writing a bundle member's spec to flat `work/{n}-spec.md`.

### 4. Re-run and report — same agent
- **URL:** the same command as step 1
- **Action:** re-run it. Exit 0 → report `build-test-ok` / `DONE`. Still exit 1 → report `build-test-blocked` / `BLOCKED` and settle per `settle-and-merge.md`.
- **Should feel:** final. A DONE that follows is backed by an artifact check, not a recollection.
- **Should understand:** call 2's adoption probe (`flow-preflight.js`) then sees `config.yml`, the stamps and the committed spec, and reports case 1 instead of case-3 recovery.
- **Red flags:** reporting DONE after a second exit 1.

## Origin
- Created during build of #2912: the trace of run `2026-10-02T182455-record-2765` showed call 1 bypassed `/flow`'s build step, so no materialize commit, no draft PR, and a free-hand claim line reached call 2. `verify-run-bookends.js` gained the `materialize` and `claim-log` bookends and a `remedy` per entry, and dispatch's first-call template now requires the check on every transport.
- Updated during build of #3350: the Manifesto now writes the `integration-model` run pin, so the `pr` bookend is live on `pr-first` runs; an unpinned run prints a `degraded —` line that the agent logs as a `SKIP`.
- Related records: #3225 (`recover-from-a-dispatch-config-deny-3225.md`, the pre-implementation config gate), #2837 (`clear-the-two-call-gate-for-a-dispatched-group-2775.md`, the dispatcher's post-hoc artifact check), #1728 (the CLI's origin on the MCP path).
