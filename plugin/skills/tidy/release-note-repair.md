# Tidy — Fill Release Note (Shape 4.5's action)

Execution procedure for `SKILL.md`'s **Fill Release Note** action: a `ready` record whose only
spec-shape gap is its `## Release Note` (`step-1-records.md`'s Shape 4.5) gets one composed line
inserted in place, labels untouched — the line is scope-neutral, so every grant stands (#2786).
Main thread only (Step 6 staging, Step 7 execution), never a scan agent's prompt. Both drivers run
the same steps; only the live read and the write differ. Every mechanical step is
`release-note-repair.js`'s; the only judgment here is the line itself.

## Worklist

The candidates file Shape 4.5's scan wrote — the absolute path substituted for
`{release-note-candidates-file}` at dispatch — is the list in every mode: the report's
`[release-note]` rows and Step 7's loop both come from its `candidates` array, never from the Work
Records agent's summary row. Each entry carries `ref`, `id`, `title`, `verdict`, `sha` (the
scan-time body's sha256) and `deliverables`. A missing or unparseable file, or a Work Records agent
that did not return `DONE`, means the scan did not complete: repair nothing and list one
`[release-note] scan did not complete` row under **Yours ({N})**'s `review` group. A `verdict:
scan-error` entry is never repaired — it is a `review`-group row whose trailing column names the
`--check` exit.

## Compose the line

One verb-first sentence summarizing the entry's `deliverables` as a release-notes reader would
notice it, per `specify/spec-template.md`'s Release Note guidance (its "no user-visible change"
phrasing included). Write it to the session-tmp file `tidy-release-note-{id}.txt`
(`_shared/session-tmp-root.md`). `release-note-repair.js` checks every bound mechanically — single
line, no `#\d+`, no path-shaped token, no backtick, no conventional-commit prefix. On its exit 4,
recompose once from the violations on stderr; a second exit 4 is a repair failure, never a weaker
line.

## Stage tier (`conservative`, or `--dry-run`)

Compose the line, then stage one item per record with `stage-item.js` (`step-6-auto.md`'s Staging
section), `--id tidy-release-note-{id}`. The `.md` holds the record ref, `Proposed line: {line}`
and `Premise sha256: {sha}`. The sidecar is `[{"tag": "[release-note]", "record": {n, or null on
local-files}, "title": …, "action": "Fill Release Note (insert one ## Release Note section; labels
unchanged)", "command": "insert one ## Release Note section into {ref} — release-note-repair.md"}]`;
`action` is exactly the `Proposed:` text `decision-markers.md` writes and Shape 4.5's comment check
matches. An approved item runs the Auto path with that line and sha.

## Auto path (one record at a time)

1. **Re-read live, then repair** — immediately before the write, never from the scan's snapshot
   (`_shared/reverify-before-write.md`):
   - `github-issues`: `gh issue view {n} --json body,labels,state > {live-json}` (gh absent: the
     `issue_read` row of `_shared/github-write-transport.md`, saved as the same three fields), then
     `node "${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" repair --driver github-issues --ref {n} --live-json {live-json} --expect-sha {sha} --line-file {line-file} --out {repaired-body} {dest}`.
   - `local-files`: `node "${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" repair --driver local-files --ref {id} --record-file {path} --expect-sha {sha} --line-file {line-file} {dest}`,
     `{path}` resolved in Step 7's working tree (the scratch worktree under `worktree-always`);
     this one call writes the record file and re-verifies it.
   - `{dest}` is `--run "{run-dir}"` whenever a run directory resolved (`step-6-auto.md`,
     `_shared/pipeline-run-dir.md`): the pre-write snapshot lands at
     `{run-dir}/snapshots/tidy-release-note-{id}.original.md` — never `staged/`, which the
     SessionStart banner, `--approve`, and `backlog attention` all read as awaiting approval. With
     no run directory (interactive mode), `{dest}` is `--snapshot-file` with the session-tmp path
     `tidy-release-note-{id}.original.md`. The CLI refuses a repair with neither.
2. **Branch on the exit.**
   - 0: continue.
   - 4: recompose (above).
   - 5: stale premise (body edited, record closed, `ready` gone) — skip, nothing written.
   - 6: repair failure — nothing written, the record stays `ready` and still fails the gate, no
     label touched; list it under **Yours** as `/claude-tweaks:specify {ref}` (re-shaping is
     `/specify`'s job).
   - 3: re-resolve `$RUN_ROOT` and retry; never write without the snapshot.
   - 2: fix the call.

   With a run directory, log each 5 and 6: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status SKIP --step "Step 7 Fill Release Note (skipped)" --text "{ref}: {stderr reason} → not written"`.
3. **Write and verify** (`github-issues`; the local call already did both):
   `gh issue edit {n} --body-file {repaired-body}` (gh absent: `issue_write` update mode, same
   body), then `gh issue view {n} --json body,labels,state > {after-json}` and
   `node "${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" verify --ref {n} --before-json {live-json} --after-json {after-json} --line-file {line-file} [--run "{run-dir}"]`.
   Exit 0: the live body passes `compose-record.js --check`, its Release Note is the composed
   line, and its label set equals the pre-write read. Exit 7: report a failure naming the snapshot
   — `gh issue edit {n} --body-file {snapshot}` restores the original.
4. After the batch, invalidate the session record snapshot once (`_shared/record-queue-fetch.md`'s
   Session-scoped record snapshot).

## Audit and report

With a run directory, each verified repair's `AUTO` entry (`_shared/auto-decision-log.md`) is
appended by the CLI itself, naming the line and the snapshot path. In auto mode each repaired
record is an **Applied automatically** row — verb `filled-note`, trailing column `snapshot saved`
(`commit {hash}` on `local-files`), then one three-space-indented sub-line carrying its composed
line, truncated to 97 characters plus `…`. In every mode, Step 7.5's checklist carries a `Filled
Release Note` line per repaired record, and with no run directory it is followed by a ```text
fence headed `Original body {ref}` holding the snapshot file's contents — the undo copy.
