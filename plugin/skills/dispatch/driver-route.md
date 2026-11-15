# Dispatch — Driver Route (#5232)

Referenced by `skills/dispatch/SKILL.md` Step 5's Driver route pointer. Read it only when `express-driver` resolves `split` or `on`, and apply it to a singleton group only. It hands the record to the pipeline driver (`bin/drive.js`) when the driver admits it: this session asks `drive.js --check`, runs the driver as one background Bash call, and reads only its final event line. Whether the driver takes a record is the driver's verdict alone; this file states no rule of its own about which records it takes.

## Closed rule

The route decision has exactly these states:

| State | Result |
|---|---|
| `express-driver` resolves `off`, or to a value other than `off`, `split`, `on`, or cannot be read | `driver-route.md` is not read, no `drive.js` call is made, today's path applies |
| `split` or `on`, record is a singleton group | `drive.js --check` runs, whatever `express-lane` resolves (the driver lane does not need `express-lane` on) |
| `--check` exits non-zero, prints no line, prints a line that is not one JSON object, or the object's `admitted` field is missing or not `true` | today's path (the express gate when `express-lane` resolves `true`, else the normal path); one `SKIP` line goes to `decisions.md` naming the condition and, when printed, the reasons (Logging a decline) |
| `--check` admits | `drive.js {n} --run "{minted-run-dir}" --no-settle --in-flight-prs "{drain-prs}"` runs as one background Bash call (The call); no express gate call is made for this record |
| a bundle group | today's path; the route is never consulted |

A state not listed here is refused with one line naming the state, and the record takes today's path.

Today's path is Step 5 as it reads without this file: the Express lane paragraph when `express-lane` resolves `true`, else the group's two Task calls.

## Order

1. Step 4 mints `{minted-run-dir}`, and Step 5 creates and enters the group's worktree, its Worktree-resume check included.
2. Run `drive.js --check` before any bind, because its verdict decides the bind's form. One plain foreground command; it writes nothing and prints one line, `{"record":N,"admitted":bool,"reasons":[…]}` (exit 0: a verdict printed, admitted or not):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/drive.js" --check {n}
   ```

3. Not admitted: write one `SKIP` line (Logging a decline) and take today's path, which binds as it always does (`sibling-session-check.md`'s bind, after the express gate when `express-lane` resolves `true`). Admitted: bind without `--dispatch`, as an express-eligible singleton is bound — the #3225 config gate guards a `/flow`-framed run, and the driver writes `config.yml` only once its PR exists:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{minted-run-dir}" "{worktree}"
   ```

4. Admitted and bound: `drive.js --run` (The call). The bind comes first because `--run` refuses a run directory whose `run-state.json` does not name this worktree. Claim nothing yourself: the driver claims the record under `{minted-run-dir}`'s basename, and a claim this session already took would stop the driver's claim step.

## The call

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/drive.js" {n} --run "{minted-run-dir}" --no-settle --in-flight-prs "{drain-prs}"
```

When this firing's queue pull wrote `dispatch-near-dup-pairs.json`, pass `--near-dup-pairs "{near-dup-pairs}"` too:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/drive.js" {n} --run "{minted-run-dir}" --no-settle --in-flight-prs "{drain-prs}" --near-dup-pairs "{near-dup-pairs}"
```

Run it as one Bash call with `run_in_background: true`, from the group's worktree, where Step 5 already moved this session; in Step 5's cwd-pinned case (#447), prefix it with `cd {worktree-path} &&`, as every command of the prose calls is. `--no-settle` leaves every stop to this session (Outcome words). `{drain-prs}` is the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-drain-prs.json` prints: this firing's drain-PR list (`drain-pr-overlap.md`'s Step 5). When that file does not exist yet, write `[]` to it with the Write tool first, since the driver holds a missing or unreadable list at `pending-review`. `{near-dup-pairs}` is what the same CLI prints for `--value dispatch-near-dup-pairs.json`.

Always pass `--in-flight-prs`: without it the driver applies no drain-overlap hold. The hold and the merge are driver code. Before it marks its PR ready, `drive.js` itself holds at `pending-review`, the PR left in draft, on a changed path shared with an open listed PR, on an open listed PR that closes a strong near-duplicate partner of the record, or on a list it cannot read; past the hold, its own merge step decides and runs the merge. No model performs the merge, and this session runs no Auto-merge gate for the group.

## Waiting and reading

Never `sleep` or poll while the driver runs. End the turn and wait for the background task's completion notification; Step 5 is sequential, so no other group of this session waits on it. Then run one plain command, `{output-file}` being the output file the notification names:

```bash
tail -n 3 {output-file}
```

The harness appends a blank line and `[exited with code N]` after the call's own output, so the final event line is the last line above that marker, and `N` is the call's exit code. Read nothing else: not the earlier event lines, and not the run directory's `driver-events.jsonl`, which a merge archives. The final line is one JSON object whose `step` is `final`, carrying `outcome`, `pr` and the structured `stop` (`step`, `class`, `reason`).

## Outcome words

Route on the final line's `outcome`:

| Word | Then |
|---|---|
| `merged` | the group ends once `node "${CLAUDE_PLUGIN_ROOT}/bin/express-lane.js" verify --run "{minted-run-dir}" --issue {n}` exits 0 (non-zero: `blocked` through `two-call-gate.md` §5, with no Settle), reading the archived copy once the merge archived the dir |
| `armed` | as `merged` |
| `pending-review` | as `merged` |
| `express-escalated` | re-bind with `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{minted-run-dir}" "{worktree}" --dispatch`, then the ordinary first call on the same run dir and the same worktree, which still exist because the driver ran with its settle off, and the normal path |
| `blocked` | the driver left its stop to the caller, so this session runs `settle-and-merge.md`'s Step 6 Settle for the record, with `$ISSUE` = {n} and `$PIPELINE_RUN_DIR` = `{minted-run-dir}` (a headless firing counts as `DISPATCH_HEADLESS=1`, `express-prompt.md`'s discriminator): after a claim stop (`stop.step` is `claim`), only its Claim-contest special case, except that when `stop.reason` is `claim-exit-7`, it is dispatch's Claim permission stop — its Claim permission denied paragraph, §5's `(claim-permission-denied: skip the claim release)`, and the firing ends, as for `failed:claim-permission-denied`; otherwise its numbered steps 1-7, with `--reason "failed: driver-{stop.step}"`. Then `two-call-gate.md` §5 |
| `refused` | the verdict changed between the check and the run, and the driver wrote nothing (no claim, no PR): take today's path for the record, with one `SKIP` line (Logging a decline). That path re-decides the bind: when `express-lane` resolves `true`, the express gate runs, and an eligible verdict keeps this route's bind for the express call; on anything but an eligible verdict, re-bind with `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{minted-run-dir}" "{worktree}" --dispatch` before the ordinary first call, since this route bound without `--dispatch` |

Any other word, no final line, a final line that is not one JSON object, or a non-zero exit that left no parseable final line (the `--run` guard's exit 3 included) is `blocked` through `two-call-gate.md` §5, with no Settle (§5 item 1's no-report gap): a guard failure is a dispatch-side defect, never routed onward to today's path.

## After the call

Once the call returns, run `drain-pr-overlap.md`'s Step 5 list write as it runs after the express call, taking the PR number from the final line's `pr`, since a merge archives the run directory and its `run-state.json` with it (after `express-escalated`, the ordinary calls that follow open the PR). The group counts for `settle-and-merge.md`'s Drain-overlap hold like any auto-merge group. Write no model-selection log line for the group (#3212): no Task call resolved a model, and the final line's `costUsd` and `turns` are that record.

## Logging a decline

A record that takes today's path after a `--check` that did not admit, or after `refused`, gets one `SKIP` line (`_shared/auto-decision-log.md`'s Degrade-trace rule). Write its text with the Write tool to a session-tmp file (`_shared/session-tmp-root.md`), because the reasons come from a CLI, not from this file — `condition: {condition} → fallback: {the express gate | the normal path}`, where `{condition}` names what fired (`drive.js --check exited {code}`, `printed no line`, `printed no JSON object`, `admitted not true; reasons: {reasons}`, or `drive.js --run refused: {stop.reason}`) — then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{minted-run-dir}" --status SKIP --step "Driver route (skipped)" --reversibility n/a --text-file "{text-file}"
```
