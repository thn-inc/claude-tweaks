---
files:
  - plugin/skills/build/execution-mode-policy.md
  - plugin/skills/flow/SKILL.md
  - plugin/skills/build/SKILL.md
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/review/review-summary-template.md
  - plugin/skills/assess-agent-autonomy/merge-check.md
  - plugin/skills/dispatch/settle-and-merge.md
  - plugin/skills/dispatch/reporting.md
---

# Stop a Run on a Host That Cannot Dispatch Subagents

**Persona:** an agent running `/claude-tweaks:flow #{n}` (or `/claude-tweaks:build #{n}`) inside a host that has no `Agent`/`Task` tool, such as a forked agent resuming a paused run or a sandbox whose nested agents get no dispatch tool. Secondary personas: the maintainer at a top-level session who reads the stop and resumes the run, and the `/claude-tweaks:dispatch` session that settles a dispatched group's first call.
**Goal:** find out up front that the host cannot run the `subagent` execution strategy, stop cleanly with a resume command instead of implementing the plan inline, and make sure any review that ran without independent agents never merges unattended.
**Entry point:** `/claude-tweaks:flow` Step 2.4 (step list includes `build`), or `/claude-tweaks:build` Common Step 1.5, probes for an `Agent`/`Task` tool with `_shared/subagent-dispatch-core.md`'s no-`Agent` probe ("`ToolSearch` finds none, deferred or otherwise") and finds none.
**Success state:** the run reports BLOCKED with its cause and a paste-ready resume command on its own line, nothing was implemented in-session, nothing was torn down, and the maintainer resumes from a top-level session with one paste. A review that ran in such a host carries one `Independence: degraded` caveat, and its merge waits for a human.

## Steps

### 1. Probe before claiming — the agent running flow or build
- **URL:** `/claude-tweaks:flow` Step 2.4 (before Steps 2.5-2.8), or `/claude-tweaks:build` Common Step 1.5 (before Common Step 1.6's plan reviewer, whatever 1.5's own skip gate decides)
- **Action:** run the no-`Agent` probe. A step list without `build` (dispatch's `review,polish,wrap-up` call) skips it.
- **Should feel:** invisible on a normal host. A fork or a cwd-pinned Task subagent that does have `Agent` passes straight through.
- **Should understand:** the probe's result decides, never the host's shape (#4555 found `Agent` present in a fork). Flow probes before Step 2.8, so a host that can never build leaves no claim and no draft PR behind.
- **Red flags:**
  - stopping a session because it is a fork or a subagent, when its probe found `Agent`;
  - probing after the claim or the draft PR already exist on a fresh run;
  - a build hand-off that jumps from planning straight to Common Step 2 and skips the probe.

### 2. Stop instead of improvising — same agent
- **URL:** `build/execution-mode-policy.md`'s `## No-dispatch host (#4555)` section
- **Action:** report `BLOCKED — this host has no Agent/Task tool, so the \`subagent\` execution strategy cannot run.`, then `Resume from a top-level session:`, then the resume command on its own line. Under `/claude-tweaks:dispatch` that command is `/claude-tweaks:dispatch #{n}`; otherwise it repeats the invocation received, `PIPELINE_RUN_DIR="…"` prefix kept. The command renders only when each part fits its grammar (`{n}` digits, the received target a `#{n}` or a plain repo-relative path, the step-list tokens, the quoted run directory); a part that does not fit, such as a target holding a quote, `$`, backtick, newline or space, is replaced by "re-run your original invocation". A standalone `/claude-tweaks:build` not locked to `subagent-only` adds the human-only alternative `/claude-tweaks:build {received target} batched`.
- **Should feel:** a clean, honest stop with the next move already written out, not a silent degrade.
- **Should understand:** implementing the plan's tasks in-session is the unlicensed path #491 forbids; `batched` is offered to a human and never chosen for them. The `SKIP` line (`condition: no Agent/Task tool in this host → fallback: run stopped before build; resume from a top-level session`) goes into `decisions.md` only when the run dir already has `config.yml` at flow Step 2.4; otherwise it is in the stop report only, so the resume still adopts the dir as a fresh mint.
- **Red flags:**
  - any plan task implemented inline "to make progress";
  - a switch to `batched` the human did not type;
  - a dispatch resume command that carries the `PIPELINE_RUN_DIR` prefix of a run that is about to be torn down;
  - a received target pasted into the resume command when it holds a quote, `$`, backtick, newline or space;
  - the stop tearing down the claim, worktree or draft PR on a resume, or the worktree, materialize commit and draft PR a standalone worktree-mode build created before the probe.

### 3. Settle and relay the stop — the `/claude-tweaks:dispatch` session
- **URL:** `dispatch/settle-and-merge.md`'s No-dispatch-host special case, then `dispatch/reporting.md`'s "No-dispatch-host stops are relayed (#4555)" paragraph
- **Action:** the first call reports `OUTCOME: build-test-blocked`, `ISSUE #{n}: failed:no-dispatch-host`, `STATUS: BLOCKED`. Settle skips steps 1-7 (no release, no `failure-check`, no retry count, no failure comment, no tombstone); headless, it files a self-report as `flow-step-2.4-no-dispatch-host`. The group's report block names the cause and ends with `/claude-tweaks:dispatch #{n}` on its own line.
- **Should feel:** like a pre-flight stop that is the host's fault, not a strike against the record.
- **Should understand:** no claim of this run exists at the stop, so there is nothing to release; the record keeps `auto:build`. When the record already has an open draft PR, `/claude-tweaks:dispatch #{n}`'s open-pr line names `/claude-tweaks:dispatch resume #{n}` when resume would accept it.
- **Red flags:**
  - a spurious "claim released" comment, or an attempt counted toward `dispatch-retry-ceiling`;
  - a human-present dispatch whose report block shows only the status lines, with no cause or resume command.

### 4. Resume from a top-level session — maintainer
- **URL:** the pasted resume command, in a session that has the `Agent` tool
- **Action:** paste it and let the run continue.
- **Should feel:** one paste, no reconstruction of state.
- **Should understand:** the probe passes here, and the run proceeds as if the stop never happened.
- **Red flags:** the resume landing in the same host shape and stopping again without saying so.

### 5. Review without independent agents — the agent running review
- **URL:** `review/step3-lens-dispatch.md`'s run-level no-`Agent` note; `review-summary-template.md`'s **Independence: degraded** slot; the PR verdict comment
- **Action:** when Step 3 starts with no `Agent` tool (a build-less resume flow did not probe), log `condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself` once under `## /review`, and render `**Independence: degraded** — no Agent tool in this host; every lens and tiebreak was judged by the reviewer itself` in the summary, which the verdict comment copies.
- **Should feel:** one plain statement a reader cannot miss, instead of N per-lens caveats to add up.
- **Should understand:** the per-lens `single-read coverage` lines and the `Tiebreak caveat:` line still write, unchanged. The same-session-as-build clause appears only inside one `/claude-tweaks:flow` call that ran `build` too, which is effectively unreachable now that build stops first.
- **Red flags:** a self-judged review logged or rendered as if it were the normal independent review.

### 6. Route the merge to a human — `merge-check`
- **URL:** `assess-agent-autonomy/merge-check.md`'s "An `Independence: degraded` review is a hard floor (#4555)" bullet
- **Action:** when `$PIPELINE_RUN_DIR/decisions.md` (or the one beside `--pack`, or a bundle member's `spec-{n}/decisions.md`) carries review's run-level `SKIP` line, or the summary rendered the **Independence: degraded** line, render `needs-human`. A `decisions.md` that should exist but is absent or unreadable while a run directory resolves cannot rule the floor out, so it renders `needs-human` too; with no run directory to read, the summary line alone decides.
- **Should feel:** a hard floor, weighed against nothing else.
- **Should understand:** every auto-merge path requires a `merge-check` `auto-merge` verdict, so this one floor keeps a degraded review out of every unattended merge.
- **Red flags:** an `auto-merge` verdict, or a console default-merge, on a run whose review is marked `Independence: degraded`, or on a run whose `decisions.md` could not be read.

## Origin
- Created during build of #4555 (dispatch-capability preflight: flow Step 2.4, build Common Step 1.5, the policy section, review's run-level caveat, the merge-check floor, Settle's special case and reporting relay).
- Updated at wrap-up of #4555: Step 2 names the resume command's grammar gate and the standalone worktree build's kept state, and Step 6 names the floor's fail-closed read of an absent or unreadable `decisions.md` — both from the review's fix wave.
- Steps 1-6 built in this session; pinned by `tests/no-dispatch-host-preflight-conformance.test.js` and `tests/review-dispatched-reviewer-degrade-conformance.test.js`.
- Related records: #491 (the execution-strategy ruling this stop enforces), #447 (cwd-pinned dispatch, `build/worktree-setup.md`'s Cwd-pinned session pointer), #3817 (per-lens single-read degrade), #3377 (the plan-review relay the reporting paragraph is modelled on).
