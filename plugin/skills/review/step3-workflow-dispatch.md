# Step 3 Workflow Lens Dispatch — /claude-tweaks:review

Read from `step3-lens-dispatch.md`'s workflow-dispatch pointer only when `review-lens-dispatch` resolves `workflow`. It runs Step 3's agent lenses through the plugin workflow `claude-tweaks:review-lens-fanout` in one `Workflow` call instead of Task agents, settles the replies with `review-coordination.js settle-lens-replies`, and falls back to `step3-lens-dispatch.md`'s Task dispatch on any condition under Fallback below. How each Subagent Contract rule is kept for a workflow agent: `_shared/subagent-output-contract.md`'s "Workflow-dispatched agents" section. Everything `step3-lens-dispatch.md` says before its reproduction dispatch still applies — the composed dispatch-contract bundle, the lens scope by tier, the tier variants, the no-`Agent` probe, and the `build-review-context.js` call that gives `{ctx-dir}` and `{ctx-id}`.

## When this applies

The key resolved `workflow`. This file covers the agent lenses that use the reproduction-pair mechanism (3a-3g) and are in scope at the resolved tier. Lens 3h is never sent through the script: it is one agent with its own procedure (`ux-analysis.md`), dispatched as the Task path dispatches it. The workflow path is used at any diff size; the Task path's "sequential in the main thread" case for a diff under 10 files does not apply here. With no such lens in scope (the `low`-tier no-executable-content skip, or under `adaptive` none in `selected`), no call is made. When `review-lens-selection` resolves `adaptive`, the lenses are the CLI's `selected` set (3a-3g only), from the one run `step3-lens-selection.md` describes, not the tier's full set.

## Availability

The session has the tool when `Workflow` is among its tools, or `ToolSearch` with `select:Workflow` returns it. A continuation agent, a dispatched reviewer (a review running inside a Task agent, as under `/claude-tweaks:dispatch`) and a pipeline-driver worker have no Workflow tool. Check before composing any brief; without the tool, take the fallback at once, with condition 1 below. A `dontAsk` session, a headless `claude -p` one included, denies the `Workflow` call unless its permissions allow `Workflow(claude-tweaks:review-lens-fanout)` (`docs/reference/workflow-tool-probe.md`, rows `start-name` and `init-headless`); the plugin adds no such rule, so without one every review there takes condition 2. A review resumed in a new session never resumes a workflow run it started earlier: it treats that run as ended with no result. A headless `claude -p` session kills a workflow still running 10 minutes after its last turn unless `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` is set in its environment (`docs/reference/workflow-tool-probe.md`, rows `long-run` and `long-run-nowait`); without it, a long fan-out there ends as condition 4.

## Compose

For each lens (under `adaptive`, each lens in `selected`), compose its brief exactly as `step3-lens-dispatch.md` composes a Task brief: the scope and the context bundle path, the `SHELL DISCIPLINE:` and `READ-ONLY REVIEW:` lines, the `Path:Line`, finding-anchor, coverage-anchor, over-budget-bundle and code-state rules, lens 3f's scratch-checkout steps, the lens's questions, the byte-identical Calibration/Output block, and at `xhigh`/`max` the `effortLine` after it (`step3-tier-variants.md`). One thing differs: both reviewers of a lens get one string, so the brief cannot name a per-agent scratch path. In place of the Task path's `SCRATCH:` line, write this one, with `{ctx-dir}` and `{lens}` filled in literally, and keep the Scratch-rule citation and the Bash-only instruction the Task path puts beside it:

`SCRATCH: make your own scratch directory — run mkdir -p {ctx-dir}/agent-scratch as one call, then mktemp -d {ctx-dir}/agent-scratch/{lens}-XXXXXX as another, and use the path it prints as your SCRATCH: path. Never delete a parent, the session scratchpad or temp root, or any path outside that exact SCRATCH: path.`

In lens 3f's brief, the pasted scratch-checkout steps' `{id}` is written as "the basename of the directory your `mktemp -d` call printed", never filled in.

For each lens's `model`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" {profile}` — `fast` for 3a and 3f, `standard` for 3b-3e and 3g (`step3-lens-dispatch.md`'s model profile paragraph) — and pass the printed `model` field. `reviewers` is 2 at `medium` and above, 1 at `low`.

## Start

Make one `Workflow` call, alone in its message: `name` `claude-tweaks:review-lens-fanout`, `args` `{ lenses: [{ lens, brief, model, reviewers }, …] }`, passed as a JSON object, not a string, one entry per lens. The tool result arrives at launch (`status: async_launched`) with `taskId`, `runId` and `transcriptDir` and no returned value. Wait for the workflow's completion notification, without polling, and wait at most 30 minutes, counted from launch: as soon as the launch result returns, in the next message, start one timer as its own `run_in_background` Bash call, `node -e "setTimeout(()=>{},1800000)"`, and together with it dispatch lens 3h, when in scope, as a Task agent under the Task path's 3h rules, so it runs alongside the workflow. Whichever arrives first, the workflow's completion notification or that timer's completion, triggers the one state read below; when the workflow's notification arrives first, stop the timer task with `TaskStop` on its id. When no workflow launched (conditions 1 and 2 below), no timer starts and 3h is not dispatched here: the fallback's Task dispatch covers every lens, 3h included.

The run file holds the returned value under `result`, beside the run's `status`. Its path is three directories above `transcriptDir`, then `workflows/{runId}.json`: a `transcriptDir` of `{session}/subagents/workflows/{runId}` gives `{session}/workflows/{runId}.json`. Call that path `{run-file}`. Never read another run's file, never retype a reply, and never read the replies into this thread: the notification's own copy of the value is cut short, and `settle-lens-replies` reads the run file itself.

When the notification or the timer arrives, read the run file's state once, with one plain command:

```bash
node -e "console.log(JSON.stringify((function(r){return {status:r.status,started:(r.result||{}).started,reason:(r.result||{}).reason}})(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')))))" "{run-file}"
```

`status` `completed` with `started: true` goes to Settle. Anything else is a fallback condition below, and once the fallback is taken a result that arrives later is never read. When the timer arrived first and the run has not reached `completed` (the state read shows another status, or fails), stop the run with `TaskStop` on the launch result's `taskId` before taking condition 4 or 5, so it stops spending.

## Fallback

The review falls back to `step3-lens-dispatch.md`'s Task dispatch, and logs one `SKIP` line, on any of these conditions — each with what the session observes. Under conditions 1 and 2 (no launch) the Task dispatch covers every lens, 3h included; under conditions 3–5 (taken after launch) it dispatches the agent lenses 3a–3g only, and keeps the 3h agent already dispatched alongside the workflow.

1. `no Workflow tool` — `Workflow` is not among the session's tools and `ToolSearch` does not return it.
2. `refused or failed before a reviewer starts` — the `Workflow` call's result is an error or a permission denial, not a launch.
3. `started: false` — the state command prints `started: false`, or any `started` other than `true` on a `completed` run; its `reason`, when there is one, is the tool's message.
4. `ended with no result` — no error, but the run file is absent (the state command fails with `ENOENT`), its `status` is not `completed`, or it holds no `result` (a killed run holds `"status":"killed","result":null`); this includes a run still going at 30 minutes.
5. `result unreadable` — the state command fails on a file that exists, or the first (or, standalone, the only) `settle-lens-replies` call exits 2 on the run file.

Resolve the line's text file with one plain call, `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" S=review-{ctx-id}-workflow-skip.txt`, `Write` one line to the printed path (`{path-S}`) — `condition: {label} → fallback: Task lens dispatch`, or `condition: {label}: {message} → fallback: Task lens dispatch` when the tool gave a message (its first line only) — and run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/review" --status SKIP --step "Step 3 lens dispatch (workflow fallback)" --text-file "{path-S}" --reversibility n/a
```

It writes `SKIP {HH:MM:SS} — Step 3 lens dispatch (workflow fallback): condition: {condition} → fallback: Task lens dispatch. Reversibility: n/a.` Standalone (no run directory), put the same sentence in the review report instead. Then dispatch the lenses as `step3-lens-dispatch.md` says for the Task path: every lens under conditions 1 and 2, lenses 3a–3g only under conditions 3–5. Under `adaptive`, "every lens" and "lenses 3a–3g" mean the CLI's `selected` set (intersected with 3a–3g under conditions 3–5), never the full tier set, and the Task path reads that same output rather than running the CLI again. Under conditions 4 and 5 the workflow reviewers may already have run, so that review pays for its lenses twice; the `SKIP` line names the condition. With the key at `task` this file is never read and no line is written.

## Settle

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" settle-lens-replies "{run-file}" --ctx-id "{ctx-id}" --run "$PIPELINE_RUN_DIR" --only confirmed
```

It writes every settled lens's `confirmed` pair lines under `## /review` and prints `{settled, needsSession, violations, overflow, skipped}`; each `settled` entry is `{lens, confirmed, unconfirmed, entries, logged}`, the shape a Task pair's `categorise-reproduction` call prints, and `logged: false` is handled as the Task path handles it. Record each `settled` lens as `step3-lens-dispatch-record.md` says (`record-lens-dispatch --path workflow --status completed`, `--reviewers 2`, a settled lens always having two usable reviewers). A `needsSession` lens is recorded by the steps it goes through below, and lens 3h, dispatched alongside the workflow, as the Task path records it. Under a fallback condition every lens is recorded on the Task path. Exit 2 is fallback condition 5. Exit 3 means the run directory is unanchored or missing, and is never a fallback condition: the fallback's own `SKIP` write and every Task-path `categorise-reproduction --run` call would exit 3 too. Re-resolve `$PIPELINE_RUN_DIR` per `_shared/pipeline-run-dir.md` and re-run this first call once, and when it exits 3 again, never take the fallback — re-run the call standalone (no `--run`, `--only` or `--hold`; nothing is logged), continue with its output, and name in the review summary that the run directory was unusable and the pair lines were not logged. Then, in this order:

1. Bring every `needsSession` lens to its pair verdict (the next section).
2. Run the absence-claim ground-truth check and the lens 3f vacuity check over every settled lens (a lens brought to its verdict in step 1 ran them in its Task per-pair steps; a settled lens's findings are its `confirmed` and `unconfirmed` lists in the first call's output), and at `medium` the cross-lens corroboration pass, exactly as `step3-lens-dispatch.md` orders them for a Task pair — its "An unpaired absence claim gets a ground-truth check" and "Lens 3f vacuity findings need execution evidence" bullets, then `step3-cross-lens-corroboration.md`. A judgment file is resolved per lens with that file's `J=review-{ctx-id}-lens-{LENS}-judgment.json` name.
3. Make the second call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" settle-lens-replies "{run-file}" --ctx-id "{ctx-id}" --run "$PIPELINE_RUN_DIR" --only unconfirmed
```

Add `--hold "{path-H}"` when the absence check refuted or corroboration promoted a finding of a settled lens: resolve `H=review-{ctx-id}-workflow-hold.json` with `session-tmp-resolve.js`, and `Write` there a JSON array of those whole `unconfirmed` entries from the first call's output, each with its lens added as `lens`. An exit 2 on this second call is never condition 5: the confirmed lines are already logged, so it means the hold file is wrong — an entry that matches no `unconfirmed` finding or two, or names a lens that did not settle. Fix the hold file and re-run this call; never take the fallback here. An exit 3 on this second call is not condition 5 either: re-resolve `$PIPELINE_RUN_DIR` per `_shared/pipeline-run-dir.md` and re-run this call once, and when it exits 3 again, never take the fallback — carry each settled lens's `unconfirmed` list from the first call's output on to Step 3.7 and name the unlogged `--only unconfirmed` lines in the review summary. A lens brought to its verdict through `categorise-reproduction` makes its own `--only unconfirmed` call, as the Task path does.

Standalone (no run directory): one call with neither `--run`, `--only` nor `--hold`; nothing is logged, and `log-reproduction-judgment` is skipped, as on the Task path. Name every `violations` entry (a reply whose status line is misplaced or missing — a contract violation) in the review summary.

## `needsSession`

Each lens the verb could not pair is listed with a `reason` and its reviewers, each with `side`, `state`, `statusWord`, and a `findingsPath` when its reply was usable. A reviewer that failed, replied `BLOCKED` or `NEEDS_CONTEXT`, has no status line, or whose reply does not parse is unusable; a reply with a misplaced status line is used and listed under `violations`. A usable reviewer whose `findingsPath` is null (the write failed) counts as unusable here. A reviewer's `text` field, present for a `BLOCKED` or `NEEDS_CONTEXT` reply, is not acted on: that side is dispatched again like any other unusable side.

**`single-reviewer`.** At `low`, apply `step3-tier-variants.md`'s Low-tier single-read rule to the findings at `findingsPath`: every finding enters `unconfirmed`, with that rule's per-finding line, and goes to the tiebreak. Nothing is dispatched again and no `SKIP` line is written. Once the single-read rule has run on a usable reviewer, record the lens `record-lens-dispatch --path workflow --reviewers 1 --status completed`. When that one reviewer is unusable, it is handled as `reviewer-unusable` below handles one side (one Task re-dispatch, one `SKIP` line), and the single-read rule applies to the new reply; that lens is then recorded on the Task path (`--path task`).

**`reviewer-unusable`.** Dispatch only the unusable reviewers again, once, as Task agents with the lens's same brief and model, and the resolver's `launchEffort`, when not `null`, as the Agent tool's `effort`, and log one `SKIP` line by the Fallback command with its own step label, `--step "Step 3 lens dispatch (reviewer re-dispatch)"`, its text file holding `condition: reviewer-unusable {lens}/{side}[, …] → fallback: Task dispatch of those reviewers`. The `Step 3 lens dispatch (workflow fallback)` label is used only for the five fallback conditions, so a review that re-dispatched reviewers stays distinguishable in `decisions.md` from one that fell back entirely. When both sides are unusable, both are dispatched again as one Task pair. `Write` each new reviewer's `findings` array to its side's path from `step3-lens-dispatch.md`'s `session-tmp-resolve.js` call (a usable side's `findingsPath` is already its side's path there), then run that lens through the Task path's per-pair steps from its `categorise-reproduction` call on. When that Task re-dispatch itself fails (a session limit, no `Agent` tool, a timeout), `step3-tier-variants.md`'s partner-died single-read rule applies to the lens. The one Task re-dispatch is that rule's one retry, so a failed re-dispatch goes straight to its single-read degrade, with no second retry.

## Then

Continue Step 3 where the Task path is after pairing: `step3-lens-dispatch.md`'s post-fan-out untracked-file sweep (its agent-scratch check covers the `mktemp -d` directories), then Steps 3.5 to 3.7 and Step 3 Routing as `code-mode-steps.md` orders them.
