---
files:
  - plugin/skills/dispatch/driver-route.md
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/dispatch/two-call-gate.md
  - plugin/skills/dispatch/reporting.md
  - plugin/skills/wrap-up/cleanup-procedures-execution.md
  - plugin/bin/drive.js
  - plugin/bin/lib/driver/run.js
  - plugin/bin/lib/driver/adopt.js
  - plugin/bin/lib/driver/merge.js
  - plugin/bin/lib/driver/settle.js
  - plugin/bin/lib/express/queue.js
---

# Route a Dispatch Singleton Through the Driver

**Persona:** a maintainer running `/claude-tweaks:dispatch` as a drain, or by naming records, in a `pr-first` project. They have turned on the pipeline driver and want each express-sized singleton record built and merged by program code instead of a model session. They want any record the driver will not take to run exactly as it did before.

**Goal:** have dispatch ask the driver whether it takes each singleton record. The driver runs every record it admits in dispatch's own run directory and worktree. Dispatch then reads one final line and finishes the group from it, without writing a false claim comment or merging into an overlapping in-flight PR.

**Entry point:** `.claude-tweaks/policy.yml` with `express-driver: split` (odd issue numbers refused) or `express-driver: on`, then `/claude-tweaks:dispatch --budget N` or `/claude-tweaks:dispatch #N`.

**Success state:**
- Each admitted singleton's group ends from the driver's final line: `merged`, `armed`, `pending-review`, `express-escalated`, `blocked` or `refused`.
- The dispatch report shows `driver: {outcome}` with its PR.
- A record the driver refused ran today's path, with one `Driver route (skipped)` line naming why.
- Bundle groups, and every record under `express-driver: off`, ran with nothing changed.
- A `ceremony:fast-lane` record the driver would take reached the route as its own singleton group, never folded into a fast-lane bundle.

## Steps

### 1. Turn the route on — the policy
- **URL:** `.claude-tweaks/policy.yml`, key `express-driver`
- **Action:** set `split` or `on`. Dispatch reads it in the same `resolve-policy.js` call as `express-lane`, once per firing.
- **Should feel:** like flipping one switch. With it `off`, missing or unreadable, `driver-route.md` is never read and no `drive.js` call is made.
- **Should understand:**
  - The route needs only `express-driver`, not `express-lane`. With `express-lane` off, a refused record takes the normal two-call path.
  - Bundle groups never consult the route.
  - With `split` or `on`, the queue pull keeps a fast-lane record the driver would take out of fast-lane bundles (`bin/lib/express/queue.js`'s `keepSingleton` asks the driver's routing, eligibility and reviewer rules), so it arrives as a singleton. The queue-order cache is stamped `per-record+driver` (or `per-record+express+driver` with `express-lane` on), so an order computed without the driver half is never reused.
- **Red flags:**
  - A `drive.js` call under `express-driver: off`.
  - A bundle group routed to the driver.
  - A fast-lane bundle holding a record that `drive.js --check` would admit.

### 2. Ask the driver — `drive.js --check`
- **URL:** `node plugin/bin/drive.js --check #N`, which prints one line: `{"record":N,"admitted":bool,"reasons":[…]}`
- **Action:** dispatch runs it after Step 5 enters the group's worktree and before any bind.
- **Should feel:** free and final. The check is read-only, and whether the driver takes a record is the driver's verdict alone. The route states no parity, label or size rule of its own.
- **Should understand:**
  - Exit 0 means a verdict was printed, admitting or not.
  - Exit 1 means no verdict could be computed and nothing was printed.
  - Exit 2 means the invocation was malformed.
  - When the record is not admitted, or the command prints no verdict, the record takes today's path with one `SKIP` line, `Driver route (skipped)`, naming the condition and any reasons.
- **Red flags:**
  - A claim, run-directory write, worktree, file write or forge write made by `--check`.
  - A route that decides admission from labels or numbers.

### 3. Bind, then hand the record over — `drive.js #N --run`
- **URL:** `hooks.js record-worktree --run {run-dir} {worktree}` (no `--dispatch`), then `drive.js {n} --run "{run-dir}" --no-settle --in-flight-prs "{drain-prs}"` as one background Bash call
- **Action:** dispatch binds the worktree to the run directory. It then starts the driver from inside that worktree and ends its turn until the completion notification arrives.
- **Should feel:** like delegating, not doing. Dispatch claims nothing itself: the driver claims under the run directory's basename and mints and creates nothing.
- **Should understand:**
  - A bind that prints no `worktree recorded for` line sends the record to today's path, so `--run` never runs unbound.
  - `--run` refuses with exit 3 and writes nothing when:
    - the run directory is missing or not under `{main}/.claude-tweaks/pipelines`;
    - the working directory is not a linked worktree of the main checkout;
    - `run-state.json` names another worktree;
    - HEAD is detached.
  - A worktree on the integration branch itself passes that guard. The driver's policy step refuses it instead, before the claim: exit 1, a final line with outcome `refused`, and nothing written except the run's `manifest.json` lane, which the adoption has already filled as `driver` (`docs/reference/run-manifest.md`).
  - `--run` requires `--no-settle` and exactly one record.
- **Red flags:**
  - A claim taken by dispatch before `--run`.
  - A `--dispatch` bind before the call.
  - A `sleep` or polling loop while the driver runs.

### 4. Hold an overlapping merge — the drain-PR list
- **URL:** the driver's `merge-overlap` event line. The run's `decisions.md` also gets the line `Auto-merge gate: group [...] held — overlaps drain PR #{pr}`.
- **Action:** dispatch passes this firing's drain-PR list. If the list does not exist yet, dispatch writes `[]` to it first. It also passes the near-duplicate pairs file when the queue pull wrote one.
- **Should feel:** safe by default. Before the PR is marked ready, the driver holds it at `pending-review`, still a draft, in any of these cases:
  - one of its changed paths is shared with an open listed PR;
  - an open listed PR closes a strong near-duplicate partner of the record;
  - the list cannot be read;
  - a listed PR cannot be read.
- **Should understand:**
  - The hold runs before the judgment workers launch, so a held record costs no judgment worker.
  - The console sees a driver hold through the same `decisions.md` line as a prose hold.
- **Red flags:**
  - A ready or merge call after an overlap.
  - A call made without `--in-flight-prs`.

### 5. Finish the group from one line — the final event line
- **URL:** `tail -n 3 {output-file}`. The final event line is the last JSON line above the harness's `[exited with code N]` marker.
- **Action:** route on `outcome`:
  - **`merged`, `armed` or `pending-review`:** ends once `express-lane.js verify` exits 0. After a `--run` merge, the worktree and local branch are kept for dispatch's close-out, while the remote branch is deleted and the run closed.
  - **`express-escalated`:** re-binds with `--dispatch` and runs the ordinary first call on the same run directory and worktree. The driver still wrote the run's escalation line, so `/build` does not mistake the driver's commits for shipped work.
  - **`blocked`:** this session runs Settle, then §5.
  - **`refused`:** today's path.
- **Should feel:** mechanical. Dispatch reads nothing but the final line, and the report says `driver: {outcome}` with no hand-composed timing line.
- **Should understand:**
  - On `blocked`, the final line's `stop` decides which Settle case runs. A claim stop on `claim-exit-3` or `claim-exit-6` gets only Settle's Claim-contest case. `claim-exit-7` is dispatch's Claim permission stop, and the firing ends. Any other claim stop runs no Settle. Every other stop runs Settle's numbered steps.
  - A non-zero exit that leaves no parseable final line, the `--run` guard's exit 3 included, is `blocked` through §5 with no Settle. A non-zero exit that does leave one is routed by its outcome word.
  - After a driver call that took no claim, or a claim stop on `claim-exit-2`, `-3` or `-6`, §5's cleanup-only call appends `(driver-no-claim: skip the claim release)`. Whether a claim was taken is judged by the absence of the `Step 2.8: claimed #{n}` line, and an absent `decisions.md` counts as no line. With that phrase appended, Section E releases nothing.
  - `claim-exit-4` and `claim-exit-5` may have written a claim, so they still release.
- **Red flags:**
  - A "Released by run" comment on a record the driver never claimed.
  - Label removals on another run's tombstone.
  - An escalated record closed as already shipped.

## Origin
- Created during the build of #5232 (run `2026-11-15T173500-spec-5232`). That build added the dispatch side of the pipeline driver: `drive.js --check`, `--run` adoption, the `--in-flight-prs`/`--near-dup-pairs` merge hold, and `plugin/skills/dispatch/driver-route.md` behind one conditional pointer in `dispatch/SKILL.md`.
- Updated during the build of #6011 (run `2026-11-22T083032-record-6011`): the queue pull keeps driver-routable fast-lane records out of bundles, with the `per-record+driver` and `per-record+express+driver` grouping stamps.
- The driver's own steps are journey `drive-a-named-record-to-a-draft-pr-5218`. Its settle is `find-a-stopped-driver-run-already-settled-5219`. The prose express lane this route falls back to is `ship-a-small-record-on-the-express-lane-4025`.
