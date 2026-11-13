# Learned-Skills PR — keeping auto-applied skill edits off the run branch

Cited from `curation-engine.md` section 4's serial-commit pass, which reads this file for every applied finding named under "When it applies". `merge-check`'s agent-instruction floor parks a run whose own diff carries a `.claude/skills/**` edit, so an auto-applied Skills-row edit committed on the run branch would park a record whose own change could have merged (#5290). This file moves that edit off the run branch: onto a separate learned-skills PR that waits for a human, or into a staged Review Console proposal. Its one CLI is `bin/learned-skills-pr.js`. That file's header is the authoritative contract for every route and exit code quoted here.

## When it applies

- Every applied finding from the `skills` row.
- Any other row's applied finding whose `targetPath` an earlier finding in this same pass already captured. It rides that same patch, and `capture` returns `shared: true` for it.

Console-approved skill updates (the Review Console's "On approval" step) are out of scope. A human approved them, and they commit on the run branch as before.

## Call sequence

Resolve these once per pass, each as its own plain call, and paste each value literally into the commands below:

- `{run}`: the main-checkout run dir every call below writes into — `$PIPELINE_RUN_DIR`'s path on a single-spec run. In a multi-spec consolidated wrap-up it is the **parent** run dir, `$MULTISPEC_PARENT_DIR`'s path (`flow/multispec-batch-curation.md`), never `$PIPELINE_RUN_DIR`, which there names one member's `{parent}/spec-{N}/` and would put the patches, the manifest and `staged/` under that member and name the branch `learned-skills/spec-{N}`. Substitute the literal path, not a `$VAR`.
- `{integration-branch}`: per `_shared/integration-branch.md`. `land` always takes it, whichever source the merge-base came from.
- `{merge-base}`: `pack.blastRadius.value.mergeBase` from `{run-dir}/wrap-up-pack.json`. In a multi-spec consolidated wrap-up, use the batch merge-base from `flow/multispec-batch-curation.md` step 1 instead. With neither, use what `git merge-base --end-of-options HEAD "origin/{integration-branch}"` prints.
- `{worktree}`: the run worktree's absolute root.

**Per finding, in the serial-commit pass's own order.** Write the finding's `summary` with the Write tool to a session-tmp file (`_shared/session-tmp-root.md`), then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" capture --run "{run}" --worktree "{worktree}" --merge-base "{merge-base}" --target "{targetPath}" --summary-file "{tmp-summary-file}"
```

It prints one JSON line. Act on its `route`, or on its exit code:

| Outcome | What the controller does |
|---|---|
| `run-branch` (`reason: "record-owned"`) | The record-owned rule: the record's own commits already touch this file, so the edit stays on the run branch. Commit it there as section 4's step (2) does, and log `skill-curation.md`'s run-branch AUTO line. `merge-check`'s floor applies to that diff, by design. |
| `captured` (`shared: true` included) | The edit has left the tree as a patch. Do not commit it. Its `commit` and `pr` are filled from `land` (Payload rewrite, below). |
| `staged` | The edit is staged at `stagePath`, and the library wrote its STAGED line. Hand-log that line only on `logFailed: true`. On `residue: true` the target still shows in `git status`, so add a wrap-up ledger item (status `open`) naming it: a later catch-all commit would sweep it onto the run branch. Rewrite the payload as a staged finding. |
| `clean` | Nothing changed and nothing was captured before. This is the audit's clean-path case, handled exactly as section 4's step (1) says. |
| Exit 1, stderr "nothing was changed" | Commit on the run branch as today, and log `SKIP {time} — Learned-skills PR capture (degraded): condition: capture exited 1 ({stderr line}) → fallback: committed on the run branch. Reversibility: n/a.` through `log-decision.js --status SKIP`, the stderr line passed by `--text-file` (`_shared/auto-decision-log.md`'s Degrade-trace rule). This is the one fail-safe exception, and `merge-check`'s floor still holds that run. |
| Exit 1, stderr "staging failed too" | Go where stderr says the edit is. **In the working tree** ("commit it", or "commit the tree on the run branch", the joined case whose earlier capture stays captured included): commit the tree on the run branch and log the same SKIP line. **In a named patch file**: the edit is only there. Log the SKIP line naming that file, add a wrap-up ledger item (status `open`) naming it so Phase 3's nothing-left-behind gate forces a decision, and drop the finding from the payload, as section 4 drops an unanchored one. |
| Exit 2 | A malformed call or a refused `--run`. Nothing changed: fix the call and re-run it. |

**Ordering.** Every finding sent back to the run branch above (`run-branch`, and both exit-1 working-tree cases) is committed there **before** the `land` or `stage` call below. `land` reads `--merge-base` to recognize an edit the run branch already carries. It marks that entry superseded and logs `already rides the run branch; not delivered twice`, so committing first is what keeps one edit from being delivered twice.

## After the pass, before any `record` call

Run this once when any finding was captured. Pick the verb by `integration-model` (`_shared/integration-model.md`):

- `pr-first` → `land`. Pass `--record` once per record. In a multi-spec consolidated wrap-up, repeat it once per member (`--record 5290 --record 5291`). When no record resolves, run `stage --reason "no record resolved"` instead.

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" land --run "{run}" --worktree "{worktree}" --record {n} --integration-branch "{integration-branch}" --merge-base "{merge-base}"
  ```

- `local-merge` → `stage`:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" stage --run "{run}" --worktree "{worktree}" --reason "integration-model is local-merge" --merge-base "{merge-base}"
  ```

Both print one JSON line. `land` commits each patch to `learned-skills/{run-id}` through git plumbing on a temp index, so the worktree's own branch, index and files are never touched. It then pushes that branch and opens one ready PR, or reuses the open one on a resumed run. A patch that cannot ride it (a failed `git apply --check`, push or PR create) is staged instead.

The CLI writes the log lines itself: one AUTO line per landed finding, in `skill-curation.md`'s learned-skills PR shape, and one STAGED line per staged one. A stage whose gate wrote the description-only form, or could not run, logs `_shared/staged-patch.md`'s own line for that case instead of the STAGED shape. Hand-log the AUTO lines only on a top-level `logFailed: true`, and a STAGED line only on that `staged[]` row's `logFailed: true`.

- A `failed[]` entry (exit 1) is one whose staged write failed too. Its edit is only in its patch file, so handle it as capture's patch-file case above.
- A `land` or `stage` exit 1 with no JSON line means a git or gh failure escaped the per-entry downgrades.
  - For `land`: run `stage` with `--reason "land exited 1"`, never the stderr text on the command line. Log `SKIP {time} — Learned-skills PR land (degraded): condition: land exited 1 ({stderr line}) → fallback: every captured patch staged. Reversibility: n/a.` the same way as the capture SKIP line.
  - For `stage` (the direct `local-merge` call or that fallback): every captured patch still sits only in `{run}/learned-skills/`. Handle each as capture's patch-file case: a SKIP line naming its patch file, and an open wrap-up ledger item so Phase 3's nothing-left-behind gate sees it.

## Payload rewrite

Match each finding to the output by `targetPath` (findings that shared one capture share one entry):

- **Landed** (`landed[]`): `action` stays `applied`. Set `commit` to `landed[].commit`, shortened to the hash its AUTO line prints, and `pr` to `pr.url`.
- **Staged** (`staged[]`): set `action: "staged"` and `stagePath` to the absolute `staged[].stagePath`, and remove `commit`. A staged finding carries no `pr`.
- **Superseded**: the edit rides the run branch. Its `commit` is the run-branch commit made above.

## The PR waits for a human

- **Never armed.** This file and its CLI run no merge command, and `housekeeping-auto-merge` is never read for this PR. `_shared/github-pr-scan.md`'s item 9 excludes a `<!-- wrap-up-skills-pr -->` PR from both of its arm routes, the housekeeping marker and the run-marker grant, even when the source record carries `auto:merge`.
- **Body.** The body carries the `<!-- wrap-up-skills-pr -->` marker and names each record only as `refs #{n}`. It never carries a closing keyword or the run marker.
- **Where a human sees it.** The Review Console's Skill updates disposition reads `applied ({commit}, learned-skills PR {url})`. On the short-circuit path, which renders no console, the FYI `PushNotification` carries that same engine-rendered section (`auto-merge-short-circuit.md`). The final summary's Phase 2 trace appends `learned-skills PR {url}` to the Skills row's Detail cell. Both come from `render` (`curation-engine.md` section 2, Step 3), never from hand-composed text.
