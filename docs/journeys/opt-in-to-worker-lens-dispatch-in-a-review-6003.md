---
files:
  - plugin/skills/review/step3-worker-dispatch.md
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/review/step3-lens-dispatch-record.md
  - plugin/bin/review-coordination.js
  - plugin/bin/lib/policy-schema.js
---

# Opt In to Worker Lens Dispatch in a Review

**Persona:** a plugin maintainer running `/claude-tweaks:review` inside a pipeline run on darwin (a top-level session or a dispatched Task agent), who has opted in to `review-lens-dispatch: worker` to measure whether headless `lens-reviewer` workers run Step 3's lenses more cheaply than Task agents or the workflow script.
**Goal:** lenses 3a–3e and 3g run as headless workers through one detached `review-lens-workers.js` launcher, 3f and 3h run on the Task path beside it, every reply is folded into one settle file and settled in one `settle-lens-replies` call, and anything that stops the worker path drops the review back to the Task dispatch with one named `SKIP` line.
**Entry point:** `review-lens-dispatch: worker` in `.claude-tweaks/policy.yml` (or a run's `config.yml` for one review; the key defaults to `task`), then `/claude-tweaks:review` with a run directory.
**Success state:** `decisions.md`'s `## /review` holds the pair lines the Task path would have written, each launcher-settled lens is recorded `--path worker` in `lens-dispatch.json`, and `worker-dispatches.jsonl` holds one line per worker side — or one `Step 3 lens dispatch (worker fallback)` `SKIP` line names why the worker path did not finish.

## Steps

### 1. Opt in — the maintainer
- **URL:** `.claude-tweaks/policy.yml`: `review-lens-dispatch: worker`; check with `node plugin/bin/resolve-policy.js --values review-lens-dispatch`
- **Action:** set the key. The `Worker dispatch (opt-in, #6003)` pointer in `step3-lens-dispatch.md` sends Step 3 to `step3-worker-dispatch.md` only when the key resolves `worker`.
- **Should feel:** a one-line, reversible switch; `task` or `workflow` leaves the worker file unread.
- **Should understand:**
  - An older plugin build reading `worker` resolves `task` with a stderr warning, so a mixed-version session falls back silently to Task dispatch.
  - Standalone (no run directory) the launcher cannot run: every lens goes through the Task path and the review report says the worker path needs a run directory; no `SKIP` line is written.
- **Red flags:** the resolver printing anything but `task`, `workflow` or `worker`; a standalone review that writes a worker `SKIP` line.

### 2. Check availability and compose the lens file — the review session
- **URL:** `command -v claude`, then `session-tmp-resolve.js L=… O=… E=… M=…` and a `Write` of `{ "lenses": [{ "lens", "brief", "model", "reviewers" }] }` to `{path-L}`
- **Action:** confirm the `claude` binary exists (no output is fallback condition 1), compose each launcher lens's brief as the Task path does but with the `READ-ONLY:` line in place of `SCRATCH:`, no bundle path (the launcher inlines the bundle in `<review-context>`), and the `git diff --no-ext-diff --no-textconv` hunk form; resolve each lens's `model` with `resolve-profile.js`.
- **Should feel:** the same brief the Task path sends, minus anything a read-only worker cannot do.
- **Should understand:** off darwin the launcher starts but every side fails with `platform`, which ends as fallback condition 3; the launcher sets each worker's effort from the `lens-reviewer` role, so the resolver's `launchEffort` is not passed.
- **Red flags:** a brief that tells a worker to read the bundle from disk or to write a scratch file; lens 3f in the lens file.

### 3. Start the launcher and wait — the review session
- **URL:** `nohup node "${CLAUDE_PLUGIN_ROOT}/bin/review-lens-workers.js" --run … --lenses-file "{path-L}" --cwd "{worktree}" --bundle "{contextPath}" > "{path-O}" 2> "{path-E}" < /dev/null & echo $!`, then `node "${CLAUDE_PLUGIN_ROOT}/bin/wait-for.js" pid --pid {pid} --max-seconds 150`
- **Action:** start the launcher, dispatch lens 3f's pair (and 3h when in scope) as Task agents in the next message, then call `wait-for.js` again on each exit 3 until exit 0, for at most three 20-minute windows; at the third deadline `kill {pid}` and take condition 2 with `wait bound reached`.
- **Should feel:** the workers and the 3f/3h Task agents run side by side; the session waits on one PID, never on a guessed sleep.
- **Should understand:** no PID printed, a `wait-for.js` exit 2, or a `--run` inside `--cwd` (a review from the main checkout itself) is condition 2, `launch error`.
- **Red flags:** a `kill` by process name; a wait with a Bash `timeout`; 3f sent to the launcher.

### 4. Read the reply and re-dispatch failed lenses — the review session
- **URL:** one `node -e` read of `{path-O}` printing `{started, total, failed}`; each failed side's reason on its `review-lens-workers: lens {lens} {side} failed: {reason}` line in `{path-E}`
- **Action:** an unreadable reply or `started` not `true` is condition 2; every reviewer failed is condition 3; some failed: dispatch each lens with a failed side again on the Task path (all its reviewers, the Task brief with `SCRATCH:`), logging `Step 3 lens dispatch (worker lens re-dispatch)` through `log-decision.js`.
- **Should feel:** a partial failure costs only the failed lenses, never the whole review.
- **Should understand:** that Task re-dispatch is the lens's one retry; a re-dispatched reviewer that also fails takes the partner-died single-read degrade, never a second re-dispatch.
- **Red flags:** a partial failure logged under the `worker fallback` label; a failed side read as an empty findings table.

### 5. Merge the Task replies and settle — the review session
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" merge-lens-replies --into "{into}" --out "{path-M}" --lens {lens} --reviewers {n} --side-a "{file-A|-}" --side-b "{file-B|-}"`, then `settle-lens-replies "{settle-file}" --ctx-id "{ctx-id}" --run "$PIPELINE_RUN_DIR" --only confirmed`
- **Action:** `Write` each Task reviewer's whole reply to a session-temp text file and fold each Task lens (3f, every re-dispatched lens) into the launcher's reply, one lens per call (`{into}` is `{path-O}` first, `{path-M}` after; `-` for a reviewer that failed); then settle `{path-M}` (or `{path-O}` when nothing was merged) as the workflow path settles, and record each lens with `record-lens-dispatch` — `--path worker` for a launcher-settled lens, `--path task` for every Task-path lens.
- **Should feel:** one settle call for the whole fan-out, with no reply transcribed by hand.
- **Should understand:** `merge-lens-replies` prints `{out, lenses, replaced}`; exit 2 writes nothing and is run once more after fixing the call, and a second exit 2 or any exit 3 is condition 4. A first settle call exiting 2 is condition 4 too.
- **Red flags:** a settle file missing a Task lens; a lens recorded `--path worker` whose replies came from Task agents.

### 6. Fall back when the path cannot finish — the review session
- **URL:** `log-decision.js --run "$PIPELINE_RUN_DIR" --section "/review" --status SKIP --step "Step 3 lens dispatch (worker fallback)" --text-file "{path-S}" --reversibility n/a`
- **Action:** on any of the four conditions — `no claude binary`, `launch error`, `every worker failed`, `settle exit 2` — dispatch the review's lens set on the Task path, minus every lens whose Task replies are already held (3f, 3h, re-dispatched lenses), and log one `SKIP` line naming the condition.
- **Should feel:** the review still completes; the only trace is one named line.
- **Should understand:** under conditions 2–4 the workers may already have run, so that review pays for its lenses twice; the parked measurement record reads these `SKIP` lines and `worker-dispatches.jsonl`.
- **Red flags:** a fallback with no `SKIP` line; a held 3f reply dispatched again; a fallback set hard-coded to 3a–3g under `adaptive` selection.

## Origin
- Created during the build of #6003, which added the `worker` value of `review-lens-dispatch` (`plugin/bin/lib/policy-schema.js`), `plugin/skills/review/step3-worker-dispatch.md`, the worker pointer in `step3-lens-dispatch.md`, the `--path worker` record value (`step3-lens-dispatch-record.md`), and `review-coordination.js merge-lens-replies`.
- Related journeys: `run-review-lenses-as-headless-workers-6000.md` (the launcher CLI this path calls), `run-review-lenses-through-a-workflow-5599.md` (the workflow path this one parallels), `settle-a-lens-fan-out-in-one-call-5598.md` (the settle verb), `record-lens-dispatches-and-read-lens-history.md` (the dispatch record).
