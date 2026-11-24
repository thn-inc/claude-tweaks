---
files:
  - plugin/bin/review-lens-workers.js
  - plugin/bin/lib/driver/lens-workers.js
  - plugin/bin/lib/driver/roles.js
  - plugin/bin/lib/timing/transcript.js
  - plugin/bin/review-coordination.js
---

# Run Review Lenses as Headless Workers

**Persona:** a plugin maintainer (or `/claude-tweaks:review`'s worker path, `step3-worker-dispatch.md`, under `review-lens-dispatch: worker`) who holds the lens briefs a `/claude-tweaks:review` Step 3 fan-out would send and wants them run as lean, read-only headless `claude -p` workers instead of in-session Task agents.
**Goal:** one `review-lens-workers.js` call runs every launchable lens side, prints the same reply JSON the workflow script returns, names every side that failed and why, and leaves a per-side log the timing report reads.
**Entry point:** `node plugin/bin/review-lens-workers.js --run <run-dir> --lenses-file <json> --cwd <reviewed-worktree> --bundle <file>`.
**Success state:** exit 0 with the reply on one stdout line, ready for `review-coordination.js settle-lens-replies`; every failed side has one `review-lens-workers: lens {lens} {side} failed: {reason}` line on stderr; `worker-dispatches.jsonl` in the run directory holds one line per side.

## Steps

### 1. Prepare the inputs and call the CLI — the maintainer
- **URL:** `node plugin/bin/review-lens-workers.js --run <run-dir> --lenses-file <json> --cwd <reviewed-worktree> --bundle <file>` (`--help` prints the usage and exits 0)
- **Action:** write `{ "lenses": [{ "lens", "brief", "model", "reviewers" }] }` to the lens file (each `lens` one plain token, named once; a non-blank `brief` and `model`; `reviewers` 1 or 2), put the context bundle text in the bundle file, point `--cwd` at the reviewed worktree (absolute, an existing directory inside a git work tree) and `--run` at the pipeline run directory under the main checkout's `.claude-tweaks/pipelines/`.
- **Should feel:** one call replaces one Task per lens side; nothing is written into the reviewed worktree, because the bundle text is inlined in each worker's prompt and the log goes to the run directory.
- **Should understand:**
  - The lens file is refused by the same checks as the workflow script's `args`, so both producers reject the same input the same way.
  - Each worker runs read-only in `--cwd`: Read, Grep, Glob and three pinned git forms (`git diff`, `git show`, `git log`), no Write or Edit, no network.
  - At most 4 workers run at once, each with a 15-minute ceiling.
- **Red flags:** a lens file that names the same lens twice and still starts workers; a file appearing in the reviewed worktree after a run.

### 2. Read a refusal — the maintainer
- **URL:** stderr line `review-lens-workers: {message}` followed by the usage, exit code 2
- **Action:** fix whatever the message names and re-run. Exit 2 covers an unknown flag, any of the four flags missing or empty, an unreadable or unparseable lens file, an unreadable bundle, a lens file the input checks refuse, a `--cwd` that is not an absolute existing directory inside a git work tree, a `--run` that is not anchored under the main checkout's `.claude-tweaks/pipelines/` (a worktree-local shadow among them), a `--run` that lies inside `--cwd`, a policy that cannot be read, and a failed git derivation.
- **Should feel:** a refusal arrives before any worker starts, and says which input to change.
- **Should understand:**
  - A refused `--run` takes exit 2, not the run-directory writers' exit 3: this CLI's codes are 0 and 2 only.
  - `--run` inside `--cwd` is refused because the launcher's log would be written into the reviewed worktree.
  - The git derivations (the common dir as a read path when it lies outside `--cwd`, the empty tree id for the worker's pinned git environment) run before any worker starts.
- **Red flags:** a worker starting after an exit 2; a refused `--run` reading as a run-directory failure the caller should retry with another code path.

### 3. Hand the reply to settle-lens-replies — the maintainer
- **URL:** stdout, one JSON line `{ started: true, lenses: [{ lens, reviewers }], reviewers: [{ lens, side, text, failed }] }`, then `node plugin/bin/review-coordination.js settle-lens-replies`
- **Action:** save the stdout line and pass it to `settle-lens-replies` as the workflow path's reply is passed; settle as `settle-a-lens-fan-out-in-one-call-5598.md` describes.
- **Should feel:** the reply is the same shape the workflow script returns, in lens order then side A, B, so the settle step needs no adapter.
- **Should understand:**
  - A failed side is `text: null, failed: true`; its reason never enters the reply.
  - A worker reply of "No findings." is a reply, never a blank failure.
- **Red flags:** a failed side carrying text; sides out of lens order; the reply split across several stdout lines.

### 4. Read the per-side failures and fall back — the maintainer
- **URL:** stderr lines `review-lens-workers: lens {lens} {side} failed: {reason}`, with a worker-written detail in parentheses when the envelope carries one
- **Action:** read each reason, then run the failed sides through the Task path; the settle step's `needsSession` handling finishes a lens with a failed side the same way it does a failed workflow reviewer. The reasons are:
  - `excluded`: lens 3f, whose discrimination checks run tests in a scratch checkout a read-only role cannot do; it never reaches a worker, and the review's worker path dispatches it on the Task path beside the launcher.
  - `platform`: off the sandbox-probed platforms (the role has no Bash there), or the git in `--cwd` does not honour `GIT_ATTR_SOURCE`.
  - `launch`: the role's launch could not be built, a launch threw, or the worker ended with a failure that is not `auth` or `timeout`.
  - `auth`: the worker reported `Not logged in`.
  - `timeout`: the worker hit its 15-minute ceiling.
  - `blank`: the worker replied with no text.
  - `denied`: a git command the worker attempted was refused by its permission rules.
- **Should feel:** the review still completes; each failed side is named, never silently an empty findings table.
- **Should understand:**
  - Off darwin the call still exits 0: every launchable side comes back failed with `platform`.
  - The detail in parentheses is worker-written text, stripped of control characters, neutralized and cut to 200 characters.
  - A `log append failed for lens {lens} {side}: {reason}` line means one log record was not written; the reply and exit code are unchanged.
- **Red flags:** a `denied` or `platform` side treated as a clean empty review; a failure line with raw terminal escapes.

### 5. The GIT_ATTR_SOURCE gate — the maintainer
- **URL:** stderr line `review-lens-workers: the git in {cwd} does not honour GIT_ATTR_SOURCE, which the lens-reviewer's pinned git environment needs; no worker starts`
- **Action:** on a sandbox-probed platform the CLI checks, once before any worker starts, that the git in `--cwd` honours `GIT_ATTR_SOURCE`; when it does not, upgrade that git or run the lenses through the Task path.
- **Should feel:** a loud, early stop rather than a worker running with a pinned environment an older git silently ignores.
- **Should understand:** the check is skipped when every lens is excluded, since no worker could start; when it fails, every side that is not excluded fails with `platform`.
- **Red flags:** workers starting under a git that ignores `GIT_ATTR_SOURCE`; the gate line printed for an all-3f call.

### 6. Interrupt a run — the maintainer
- **URL:** Ctrl-C (SIGINT) or SIGTERM to the CLI process, exit 130 or 143
- **Action:** interrupt when needed; on POSIX the CLI forwards SIGTERM to every running worker, waits for their launches to settle (bounded by the launcher's kill grace), sends SIGKILL to any still running, prints nothing on stdout and exits 130 (SIGINT) or 143 (SIGTERM).
- **Should feel:** an interrupted call never looks like a reply.
- **Should understand:** a worker that settles in time logs its record; one that ignored SIGTERM may not, and a side that never started writes no record.
- **Red flags:** stdout text after an interrupt; a worker still running after the CLI exits.

### 7. Read the dispatch log — the maintainer
- **URL:** `worker-dispatches.jsonl` in the run directory (read by `timing/transcript.js`'s `readWorkerDispatches` into the timing report's dispatches)
- **Action:** read one line per side, appended as that side settles: `{ kind: 'worker', launched, lens, side, description, agentType: 'lens-reviewer', metaModel, startTs, endTs, wallClockMs, failed, reason }`, plus the token fields for a launched side.
- **Should feel:** the cost of a headless lens review is on the record the same way a Task reviewer's is.
- **Should understand:**
  - `launched: false` marks a side no worker started for (`excluded`, `platform`, a launch refusal); the timing report never counts such a line as a dispatch.
  - A launched side's tokens come from the worker envelope's usage; with none (a timeout or a launch failure), they are summed from the worker's own transcript, and are null with a `notFound` note only when that cannot be found either.
  - This CLI is the file's only writer, and appends never rewrite earlier lines.
- **Red flags:** a launched side with null tokens and no note; a line rewritten rather than appended.

## Origin
- Created during the build of #6000, which added `plugin/bin/review-lens-workers.js`, `plugin/bin/lib/driver/lens-workers.js`, the `lens-reviewer` role in `plugin/bin/lib/driver/roles.js` and the worker log read by `timing/transcript.js`.
- Persona and step 4 updated during the build of #6003, which wired this CLI into `/claude-tweaks:review` Step 3 as the `worker` value of `review-lens-dispatch`.
- Related journeys: `run-review-lenses-through-a-workflow-5599.md` (the workflow path this one parallels), `settle-a-lens-fan-out-in-one-call-5598.md` (the settle verb that reads this reply), `attribute-agent-cost-to-dispatches-3375.md` (where the worker log's items show up).
