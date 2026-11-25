# Review Console — Follow-up Re-check

Referenced by `skills/wrap-up/review-console.md`'s "Follow-up re-check" section and `flow/multispec-review-console.md`'s "When to run" list. An open follow-up record whose `### Key Files` intersect this run's diff may already be done by it: each such record's deliverables are judged against the diff, and a close or narrow proposal is staged as `staged/followup-recheck-{n}.md` for a human to approve (#6284). Closing a record and posting a comment stay on `_shared/auto-mode-contract.md`'s Never-reversible list: nothing here closes or comments, and the console never resolves the item `apply` on its own.

**When.** Once per console, after the last fix wave and before `proposal-bundling.md`'s pass — single-spec: the run dir; multi-spec: the parent dir, once, never per spec, against the parent's integration branch. Skip it under `--dry-run`: it stages files. Run it from the run's worktree, where `HEAD` is the run's branch.

**Records file.** As `proposal-bundling.md`'s Records file paragraph: under `work-backend: github-issues`, refresh the session record snapshot per `_shared/record-queue-fetch.md`'s read-fresh-or-fetch block and pass its path as `--records-json`; under `work-backend: local-files` pass `--local` in its place. A fresh-but-empty snapshot is unreadable (exit 4), never "no candidates".

**Own set.** `--own` is the run's own record(s) — the targets in `run-state.json` / `manifest.yml` (multi-spec: every member record) — plus every record an `AUTO … filed as #N` line in this run's `decisions.md` names (multi-spec: every `spec-{N}/decisions.md` too), comma-joined. Omit `--own` when the set is empty. `{base}` is the run's integration branch per `_shared/integration-branch.md`, as `origin/{branch}` when the run pushes there, the local branch otherwise.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/recheck-followups.js" candidates --run "{run-dir}" --records-json "{snapshot}" --base "{base}" --own {own}
```

It writes `{run-dir}/recheck/candidates.json` and logs one `SCANNED` line; stdout is one JSON line, `{ candidates, overCap, excluded }`. Exit 0 with an empty `candidates` list ends the re-check. Any non-zero exit (2 malformed call, 3 run dir not anchored, git or a write failed, 4 records unreadable or empty) stages nothing: re-run the identical command once, and only a second non-zero exit logs one Degrade-trace line and carries on with no re-check.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status SKIP --section "/wrap-up" --step "Follow-up re-check" --reversibility n/a --text "condition: recheck-followups.js candidates exited {code} → fallback: no follow-up re-check this run"
```

**Judge dispatch.** Per `_shared/subagent-output-contract.md`, dispatch one agent per entry in `candidates.json`'s `candidates`, in parallel. Model profile: [Use: Standard] — per-deliverable judgment against a bounded diff, not synthesis-heavy. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`. The prompt carries only that candidate's `number`, its `items` (numbered from 1) and its `hunks` — no conversation history, no other file — asks whether the hunks satisfy each item, and inlines this output template verbatim, ending with a trailing `STATUS:` line as the reply's last line:

```
RECORD: #{n}
ITEM {k}: satisfied | not-satisfied | cant-tell
QUOTE {k}: {verbatim line(s) from one hunk — only for satisfied}
...
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
```

Convert each reply to one entry of the verdicts file, `{ "{n}": { "status": "{STATUS}", "verdicts": [{ "deliverable": {k}, "verdict": "{verdict}", "quote": "{quote}" }] } }`, one verdict per `ITEM` line with its `QUOTE` copied verbatim. Never read an unavailable, failed, empty or unparseable reply as `not-satisfied`: write its entry with its real status (`UNAVAILABLE` or `UNPARSEABLE` when it carries none) and no verdicts, and `stage` logs it judge-failed. Write the file with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value followup-recheck-verdicts.json` prints, then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/recheck-followups.js" stage --run "{run-dir}" --verdicts "{verdicts}"
```

`stage` checks every `satisfied` quote against the gathered hunks, stages `staged/followup-recheck-{n}.md` (a `Title: Close|Narrow #{n}: …` header) for each record with a satisfied deliverable, and logs its own `STAGED`/`SCANNED` lines; stdout is `{ staged, nothing, judgeFailed }`. A non-zero exit logs the Degrade-trace line above with `stage` in place of `candidates`.

**Rendering and approval.** A staged file renders as a Queue writes `Q#` row, its title from the `Title:` header. `console-resolve.js --policy console-auto` resolves it `pending` (reason `followup-recheck-human-call`) at every tier and `carried` under control mode, never `apply`. Approving it never creates a record: `review-console.md`'s "On approval" step 7 runs `approve` instead, and a ticked row on a console rendered on the PR (`_shared/console-execution.md`) adds `--item {q-id}`, so the approval lands on that row. `approve` derives the PR from the run itself: `run-state.json`'s `pr.number` (multi-spec: the parent's), or `local` under a `local-merge` `config.yml` pin or with no PR. A `--pr` that disagrees exits 2. It records the run branch's head commit and the staged file's hash. When `stage` later overwrites the file (a re-run), the hash no longer matches, and `execute` holds the item `proposal-changed` rather than act on text nobody approved. Exit 5 (control mode, or the item already carried, applied or dropped) writes nothing: report it, never create a record in its place. Skip declines it like any `Q#`. At `unattended` no human is present, so the item stays `pending`. `console-residue.js --run` lists it with a paste-ready `approve` line, then its `execute` line, for the run's final stop. A human approves from there before acknowledging, because `--ack` alone archives the proposal with the run.

**Multi-spec.** A parent-staged `followup-recheck-*` file renders as a parent `Q#` row (its `Title:` header), and `flow/multispec-review-console.md`'s On-approval step 2 runs `approve --run "{parent}" --id '{name}'` for it, never `gh issue create`. The CLI derives the PR: the bundle PR's number from the parent `run-state.json`'s `pr.number` under `pr-first` (`_shared/pr-early-run-lifecycle.md`), `local` under `local-merge`.

**Execution.** Only the post-merge steps run `execute`:
- `_shared/pr-first-merge-post-merge.md`'s Step 4.0c, after a PR merge. `wrap-up/merge-mode.md`'s Already merged path runs it too.
- `_shared/local-merge-auto-finish.md`'s step 7 and `flow/worktree-merge.md`'s step 6, with `--local-merged` after the push. Step 6 runs it once per run dir whose merge commit was recorded; for a multi-spec run, that is the parent.

A local merge counts as landed only when `--local-merged` is passed and the approval's recorded head commit is an ancestor of the local integration branch, so a skipped or conflicted branch's approval holds.

These merge paths run no `execute`, so their approvals stay residue by design:
- A `local-merge` finish that hands off to `/superpowers:finishing-a-development-branch` with no post-merge step (`flow/multispec-review-console.md`'s Shared teardown step 2) runs none: its approvals stay residue by design.
- The local-merge paths in `wrap-up/auto-merge-short-circuit.md` and `dispatch/settle-and-merge.md`.
- The driver's merge (`plugin/bin/lib/driver/merge.js`).

An approval whose merge has not landed is held. `console-residue.js --run` lists it with its paste-ready `execute` command, and no later pass picks it up.
