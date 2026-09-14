---
files:
  - plugin/bin/verify.js
  - plugin/bin/lib/verify/args.js
  - plugin/bin/lib/flow/manifest.js
  - plugin/bin/lib/timing/derive.js
  - plugin/bin/phase-timing.js
  - plugin/bin/lib/hooks/subagent-stop.js
  - plugin/skills/flow/summary-template.md
  - plugin/skills/wrap-up/summary-template.md
  - plugin/skills/_shared/pr-run-comments.md
  - plugin/skills/wrap-up/verification-brief.md
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/test/verification.md
  - plugin/skills/flow/multispec-run-dir-layout.md
  - plugin/skills/flow/multispec-summary.md
  - tests/timing-prose-conformance.test.js
---

# Read Where a Pipeline Run Spent Its Minutes

**Persona:** a maintainer who just watched a `/claude-tweaks:flow` run take an hour and wants to know which phase ate it (an internal tooling user), and the agent session rendering the Pipeline Summary, the wrap-up summary, or the run's PR comment, which must print those numbers rather than estimate them.
**Goal:** get a per-phase minutes table for any run — live or archived — from two mechanical sources the run wrote for itself (the runner's `verify` event and the manifest's `phases[]` log) plus the `skill_invoked` breadcrumbs the hooks already keep, with every unknown phase saying so instead of guessing.
**Entry point:** a run directory under `$RUN_ROOT/.claude-tweaks/pipelines/` (or its archive) that holds `events.jsonl`; optionally `manifest.yml` and `run-state.json`.
**Success state:** `{run-dir}/timing.json` exists, the `### Timing` table in the summary reads `| Phase | Minutes | Verify |` with the canonical ten phases, `total` counts each minute once, and the PR carries the same table as its `timing` comment.

## Steps

### 1. Let the runner record its own boundary
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --run "$PIPELINE_RUN_DIR" --cmd …` (the canonical snippet in `test/verification.md`)
- **Action:** Run verification the way the skill already does; the `--run` flag is now part of the one-line canonical command.
- **Should feel:** Nothing changes in the run's output; one more line lands in `events.jsonl` with `type: "verify"`, the mode, the suites that actually ran, the duration, and the pass flag.
- **Should understand:** An unset `$PIPELINE_RUN_DIR` arrives as an empty value and writes nothing. A run dir that lives inside a worktree (a shadow copy) is refused on stderr, never written silently, and never fails the verification itself.
- **Red flags:** `verify.js: --run … refused (not-anchored)` on stderr — the path is not under the main checkout's pipelines tree; fix the path, do not suppress the line.

### 2. Let `spec-status` keep the manifest's phase log
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" spec-status --run … --spec N --status running --phase build`
- **Action:** Nothing new to type — every transition a multi-spec run already makes now persists `phase` (latest) and appends to `phases[]`.
- **Should feel:** `manifest.yml` grows a small indented list per spec; the file still round-trips byte-for-byte when the list is absent.
- **Should understand:** The log is append-only. A phase re-entered after a review loop adds another entry rather than rewriting the first; the derivation sums every span with the same name.
- **Red flags:** A hand-edited `manifest.yml` with the list at the wrong indentation parses as no list at all — the writer is `spec-status`, nothing else.

### 3. Derive the table
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript`
- **Action:** Run it once at summary time (the Pipeline Summary, the wrap-up summary, and the PR `timing` comment all paste its output verbatim).
- **Should feel:** One command, exit 0, a table headed `| Phase | Minutes | Verify |`; `timing.json` written beside the events.
- **Should understand:** `Minutes` is the phase's span; a container (`build`, `call-1`, `call-2`) also shows `(own N)`, the minutes not already counted by a nested phase — `total` sums only those. A phase with no event reads `unattributed` rather than a guessed number; a typed slash command leaves no `skill_invoked` event, so that phase is `unattributed` by design. Exit 2 only means the invocation itself was malformed (no `--run`, not a directory, an unreadable events file).
- **Red flags:** An unfamiliar phase name in the table — an un-mapped `claude-tweaks:*` skill was invoked inside review or wrap-up and opened its own top-level span; add it to the nested parent map in `derive.js` if it belongs to the enclosing phase.

### 4. Trust the contract-violation count again
- **URL:** `events.jsonl`, `type: "contract-violation"`
- **Action:** Read the count after a run that dispatched subagents.
- **Should feel:** Only real subagent replies are graded; an orchestrator's own narration turns no longer show up.
- **Should understand:** The SubagentStop hook grades `agent_transcript_path` only, and only when it names a file *distinct* from the same firing's own `transcript_path`. Two shapes are a deliberate no-op rather than a graded turn: the field absent entirely (no fallback to the parent session's transcript), and the field present but identical to `transcript_path` — the dispatching session's own file, which the harness sometimes sends while a main session ends its turn waiting on an async dispatch. A genuine subagent stop always carries its own distinct transcript, so neither no-op can hide a real violation.
- **Red flags:** Zero violations on a run where an agent clearly replied without a status line — either the harness stopped sending `agent_transcript_path`, or it is sending this session's own `transcript_path` under that name. Compare the two fields in the firing before concluding the check is simply off.
