# Step 3 Worker Lens Dispatch — /claude-tweaks:review

Read from `step3-lens-dispatch.md`'s worker-dispatch pointer only when `review-lens-dispatch` resolves `worker`. It runs Step 3's agent lenses as headless `lens-reviewer` workers through `review-lens-workers.js` (one detached launcher, awaited by its PID) instead of Task agents, folds the Task-path replies into the launcher's reply with `review-coordination.js merge-lens-replies`, settles everything with `settle-lens-replies`, and falls back to `step3-lens-dispatch.md`'s Task dispatch on any condition under Fallback below. How each Subagent Contract rule is kept for a worker: `_shared/subagent-output-contract.md`'s "Workflow-dispatched agents" section. Everything `step3-lens-dispatch.md` says before its reproduction dispatch still applies — the composed dispatch-contract bundle, the lens scope by tier, the tier variants, the no-`Agent` probe, and the `build-review-context.js` call that gives `{ctx-dir}`, `{ctx-id}` and `contextPath`.

## When this applies

The key resolved `worker`. The launcher runs the agent lenses 3a–3e and 3g that are in scope at the resolved tier; when `review-lens-selection` resolves `adaptive`, those in the CLI's `selected` set, from the one run `step3-lens-selection.md` describes. Lens 3f always runs on the Task path in the same review: its discrimination checks run in a scratch checkout, which a read-only worker cannot make, and the launcher fails any 3f side with reason `excluded`. Lens 3h is one agent with its own procedure (`ux-analysis.md`), dispatched as the Task path dispatches it. The worker path is used at any diff size; the Task path's "sequential in the main thread" case for a diff under 10 files does not apply. With no launcher lens in scope, no launcher starts, and 3f and 3h, when in scope, go through the Task path as usual.

Standalone (no run directory) the launcher cannot run, since `--run` is required: dispatch every lens on the Task path and say in the review report that the worker path needs a run directory. No `SKIP` line is written.

## Availability

Before composing any brief, check for the `claude` binary with one plain call, `command -v claude`. No output is fallback condition 1; take it at once. Off darwin the launcher starts, but every side fails with reason `platform`, so the reply reaches condition 3.

## Compose

For each launcher lens, compose its brief exactly as `step3-lens-dispatch.md` composes a Task brief — the scope, the `SHELL DISCIPLINE:` and `READ-ONLY REVIEW:` lines, the `Path:Line`, finding-anchor, coverage-anchor, over-budget-bundle and code-state rules, the lens's questions, the byte-identical Calibration/Output block, and at `xhigh`/`max` the `effortLine` after it (`step3-tier-variants.md`) — with three differences:

- No `SCRATCH:` line and no Scratch-rule citation. In their place, write this line:
  `READ-ONLY: you have no scratch path and no Write tool; create no file.`
- The launcher inlines the context bundle ahead of the brief, inside `<review-context>`, so the brief names no bundle path and tells the worker to read the bundle there, never from disk.
- A hunk the bundle shows as a marker line is read with `git diff --no-ext-diff --no-textconv {base}...{branch} -- '{path}'`, one path per call — the form the `lens-reviewer` role admits, in place of the Task path's `git diff {base}...{branch} -- '{path}'`.

For each lens's `model`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" {profile}` — `fast` for 3a, `standard` for 3b–3e and 3g (`step3-lens-dispatch.md`'s model profile paragraph) — and pass the printed `model` field. The resolver's `launchEffort` is not passed: the launcher sets each worker's effort from the `lens-reviewer` role itself. `reviewers` is 2 at `medium` and above, 1 at `low`.

Resolve the launcher's files with one plain call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" L=review-{ctx-id}-worker-lenses.json O=review-{ctx-id}-worker-out.json E=review-{ctx-id}-worker-err.txt M=review-{ctx-id}-worker-merged.json
```

and `Write` `{ "lenses": [{ "lens", "brief", "model", "reviewers" }, …] }`, one entry per launcher lens, to `{path-L}`.

## Start

`{worktree}` is what `git rev-parse --show-toplevel` prints, and `{contextPath}` is the `contextPath` field `build-review-context.js` printed. Start the launcher with one Bash call:

```bash
nohup node "${CLAUDE_PLUGIN_ROOT}/bin/review-lens-workers.js" --run "$PIPELINE_RUN_DIR" --lenses-file "{path-L}" --cwd "{worktree}" --bundle "{contextPath}" > "{path-O}" 2> "{path-E}" < /dev/null & echo $!
```

It prints the launcher's PID, `{pid}` below. The launcher refuses a `--run` inside `--cwd` (a review run from the main checkout itself), which ends as condition 2. In the next message, dispatch lens 3f's pair (and lens 3h, when in scope) as Task agents under the Task path's rules, so they run alongside the workers. Then wait for the launcher with one foreground call, with no Bash `timeout`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/wait-for.js" pid --pid {pid} --max-seconds 150
```

Exit 0 means the launcher has exited: go to Read the reply. Exit 3 with `bound` `call` means it is still running: make the same call again. Exit 3 with `bound` `deadline` closes one 20-minute window, and the next call opens another. Wait at most 3 windows, 60 minutes, which is 4 waves of the launcher's 15-minute worker ceiling at its concurrency of 4. When the third window's deadline is reached, stop the launcher with `kill {pid}` (that PID only, never a process by name) and take condition 2 with the message `wait bound reached`.

A Start call that prints no PID (refused or failed), or a `wait-for.js` exit 2 (a malformed call, or a missing or invalid session id), is condition 2 too, its message `no launcher PID` or the first line of `wait-for.js`'s stderr; a 3f or 3h not yet dispatched stays in Fallback's Task set.

## Read the reply

Read the reply's state once, with one plain command:

```bash
node -e "console.log(JSON.stringify((function(r){var s=r.reviewers||[];return {started:r.started,total:s.length,failed:s.filter(function(x){return x.failed}).map(function(x){return x.lens+'/'+x.side})}})(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')))))" "{path-O}"
```

- The command fails (an empty `{path-O}`, or text that is not JSON), or `started` is anything other than `true`: condition 2, its message the first line of `{path-E}` (`head -n 1 "{path-E}"`).
- Every reviewer is in `failed` (`failed` as long as `total`): condition 3, its message the first line of `{path-E}`.
- Some reviewers failed: dispatch each lens with a failed side again on the Task path, all of that lens's reviewers (its `reviewers` count, 1 at `low`), with the brief `step3-lens-dispatch.md` composes for a Task agent, `SCRATCH:` line included, the lens's same model, and the resolver's `launchEffort`, when not `null`, as the Agent tool's `effort`. Each failed side's reason is on its `review-lens-workers: lens {lens} {side} failed: {reason}` line in `{path-E}`. Resolve `R=review-{ctx-id}-worker-redispatch.txt` with `session-tmp-resolve.js`, `Write` one line to it, `workers failed: {lens}/{side}[, …] → fallback: Task dispatch of those lenses`, and log it with the Fallback command below, with its own step label, `--step "Step 3 lens dispatch (worker lens re-dispatch)"` and `--text-file "{path-R}"`. That label is never `worker fallback`, so the fallback count by condition holds only the four conditions. This Task re-dispatch is the lens's one retry: a re-dispatched reviewer that itself fails is merged as `-` and goes straight to `step3-tier-variants.md`'s partner-died single-read degrade, never to a second re-dispatch through `needsSession`.
- No reviewer failed: go to Merge.

## Merge

Once every Task agent of lens 3f and of each re-dispatched lens has replied or failed, fold each such lens into the launcher's reply, one lens at a time. `Write` each reviewer's whole reply, verbatim, to a session-temp text file (resolve `A=review-{ctx-id}-lens-{LENS}-reply-A.txt B=review-{ctx-id}-lens-{LENS}-reply-B.txt` with one `session-tmp-resolve.js` call per lens), then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" merge-lens-replies --into "{into}" --out "{path-M}" --lens {lens} --reviewers {n} --side-a "{file-A|-}" --side-b "{file-B|-}"
```

`{into}` is `{path-O}` for the first merge and `{path-M}` for every later one. `{n}` is the lens's `reviewers` count; at 1, drop `--side-b`. Pass `-` for a reviewer that failed or never replied. Exit 2 means the call was wrong and nothing was written: fix the flags or the text file and run it once more, never a third time. A second exit 2, or any exit 3 (the write failed), takes condition 4 with a message, since the settle file cannot be built: its `SKIP` text is `condition: settle exit 2: merge-lens-replies {exit 2|write} failed → fallback: Task lens dispatch`, so it never reads as a settle call's exit 2.

The settle file, `{settle-file}` below, is `{path-M}` when any merge ran, else `{path-O}`.

## Settle

`step3-workflow-dispatch.md`'s Settle, `needsSession` and Then sections apply here, with `{settle-file}` in place of `{run-file}` and the `worker fallback` label in place of `workflow fallback`. The first call is:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" settle-lens-replies "{settle-file}" --ctx-id "{ctx-id}" --run "$PIPELINE_RUN_DIR" --only confirmed
```

An exit 2 on the first call is fallback condition `settle exit 2`: take Fallback's Task dispatch, and the `SKIP` line names the condition, since the launcher's replies were already paid for. A lens listed under `needsSession` goes through its reviewer re-dispatch, and a reviewer listed under `skipped` is handled, exactly as on the workflow path: these two fail-closed shapes are never a worker-fallback condition. A `needsSession` lens that `## Read the reply` already re-dispatched is never dispatched again: its failed side takes the partner-died degrade.

Record each lens as `step3-lens-dispatch-record.md` says. A lens settled from the launcher's replies (a `settled` lens, or a `single-reviewer` lens whose one launcher reviewer was usable) is recorded with `--path worker` where `step3-workflow-dispatch.md` says `--path workflow`. Every Task-path lens — 3f, 3h, each lens re-dispatched in Read the reply or through `needsSession`, and every lens after a fallback — is recorded `--path task`.

## Fallback

The review falls back to `step3-lens-dispatch.md`'s Task dispatch, and logs one `SKIP` line, on any of these conditions — each with what the session observes.

1. `no claude binary` — the Availability check printed nothing.
2. `launch error` — `{path-O}` is empty or not JSON, or its `started` is not `true` (a refused call, an interrupted launcher), or Start printed no PID, or `wait-for.js` exited 2, or the wait bound was reached; the message is `{path-E}`'s first line, `no launcher PID`, `wait-for.js`'s first stderr line, or `wait bound reached`.
3. `every worker failed` — every reviewer in the reply has `failed: true`.
4. `settle exit 2` — the first `settle-lens-replies` call exits 2 on the settle file, or `merge-lens-replies` failed as Merge says (its message names the merge).

The Task dispatch covers the review's lens set — the agent lenses in scope at the tier, or under `adaptive` the CLI's `selected` set, never a hard-coded 3a–3g — minus every lens whose Task-path replies are already held: 3f and 3h from Start, once dispatched there, and each lens Read the reply re-dispatched. Only the lenses with no Task replies in hand are dispatched. Under condition 1, decided before anything was dispatched, 3f and 3h are in the set. The held replies settle on that same Task path exactly as the Task path settles them, through each lens's own per-pair route, never through `settle-lens-replies`.

Resolve the line's text file with one plain call, `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" S=review-{ctx-id}-worker-skip.txt`, `Write` one line to the printed path (`{path-S}`) — `condition: {label} → fallback: Task lens dispatch`, or `condition: {label}: {message} → fallback: Task lens dispatch` when there is a message (its first line only) — and run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/review" --status SKIP --step "Step 3 lens dispatch (worker fallback)" --text-file "{path-S}" --reversibility n/a
```

It writes `SKIP {HH:MM:SS} — Step 3 lens dispatch (worker fallback): condition: {condition} → fallback: Task lens dispatch. Reversibility: n/a.` Under conditions 2–4 the workers may already have run, so that review pays for its lenses twice. A partial failure is not a fallback: its `workers failed` line uses its own label, `worker lens re-dispatch` (Read the reply). The parked measurement record takes its token and fallback counts from the launcher's `worker-dispatches.jsonl` in the run directory (timing) and these `SKIP` lines. With the key at `task` or `workflow` this file is never read and no line is written.
