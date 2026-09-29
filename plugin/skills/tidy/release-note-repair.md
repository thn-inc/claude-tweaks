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

1. **Compose the line** (`## Compose the line` above) and write it to the session-tmp path
   `{line-file}` with the Write tool. `{line-file}`, `{live-json}`, `{repaired-body}`, and
   `{after-json}` below are all session-tmp paths (`_shared/session-tmp-root.md`). Composition
   timing differs by mode: the Stage tier composes once at staging time (above, no repeat needed
   here); Auto mode (nothing staged) composes fresh here, immediately before repair; Interactive
   mode composes here too, but only after Step 6's batch approval resolves.
2. **Re-read live, then repair** — immediately before the write, never from the scan's snapshot
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
3. **Branch on the exit.** Every skip/failure branch below reports two things, never one: a Step
   7.5 checklist line, and — whenever a run directory resolved — a `decisions.md` SKIP entry
   (`node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status SKIP --step "Step 7 Fill Release Note (skipped)" --text "{ref}: {stderr reason} → not written"`); nothing is silent.
   - 0: continue to Step 4.
   - 4: recompose once (`## Compose the line` above). A second exit 4 routes exactly like exit 6 —
     Yours **review** row keyed `/claude-tweaks:specify {ref}`, plus the SKIP entry.
   - 5: stale premise (body edited, record closed, `ready` gone) — skip, nothing written. Step 7.5
     carries `- [x] Skipped Release Note: {ref} — stale premise` in every mode (auto, staged-then-
     approved, interactive) regardless of whether a run directory exists; the SKIP entry is the
     usual run-directory-only addition on top of that line.
   - 6: repair failure — nothing written, the record stays `ready` and still fails the gate, no
     label touched; Yours **review** row keyed `/claude-tweaks:specify {ref}` (re-shaping is
     `/specify`'s job), plus the SKIP entry.
   - 7 (`local-files` only): the CLI's own re-read verification failed **and** its own restore
     attempt also failed — the record file holds unverified repaired content, and the true original
     survives only at the snapshot. Restore once, automatically: copy the snapshot over the record
     file (`cp {snapshot} {path}`), re-read it, and confirm the bytes are identical to the
     snapshot. Confirmed: Yours **review** row naming `{path}` and `{snapshot}`, plus the SKIP
     entry. Restore itself fails: the Yours row's command line is that same `cp {snapshot} {path}`,
     plus the SKIP entry.
   - 3: read the stderr to tell the two causes apart. An anchoring failure (stderr names `resolve
     $RUN_ROOT per _shared/pipeline-run-dir.md`) gets one retry — re-resolve `$RUN_ROOT` and repeat
     this step; a second exit 3 is a Yours **review** failure plus the SKIP entry. A
     snapshot/`--out`/record write failure (a disk problem, not an anchoring one) is never
     retried — re-resolving `$RUN_ROOT` cannot fix it: Yours **review** failure plus the SKIP entry
     immediately. Never write without the snapshot either way.
   - 2: malformed call — a caller-side bug, not a per-record condition; fix the invocation rather
     than looping on it. Report the record as a Yours **review** row plus the SKIP entry.
4. **Write and verify** (`github-issues`; the local call already did both in Step 3):
   `gh issue edit {n} --body-file {repaired-body}` (gh absent: `issue_write` update mode, same
   body). A failed edit call itself: re-read the live body (`gh issue view {n} --json body`).
   Unchanged from `{live-json}`'s body: a repair failure — Yours **review** row noting the retry,
   plus the SKIP entry. Changed (the edit landed despite the reported failure): continue below —
   the verify call below catches any real mismatch.

   `gh issue view {n} --json body,labels,state > {after-json}` and
   `node "${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" verify --ref {n} --before-json {live-json} --after-json {after-json} --line-file {line-file} [--run "{run-dir}"]`.
   Exit 0: the live body passes `compose-record.js --check`, its Release Note is the composed
   line, and its label set equals the pre-write read. Exit 7: restore once, automatically —
   `gh issue edit {n} --body-file {snapshot}`, re-read (`gh issue view {n} --json body`), and
   confirm the body matches the snapshot. Confirmed: Yours **review** row naming `#{n}` and
   `{snapshot}`, plus the SKIP entry. Restore itself fails: the Yours row's command line is that
   same `gh issue edit {n} --body-file {snapshot}`, plus the SKIP entry.
5. After the batch, invalidate the session record snapshot once (`_shared/record-queue-fetch.md`'s
   Session-scoped record snapshot).

## Audit and report

With a run directory, each verified repair's `AUTO` entry (`_shared/auto-decision-log.md`) is
appended by the CLI itself, naming the line and the snapshot path. In auto mode each repaired
record is an **Applied automatically** row — verb `filled-note`, trailing column `snapshot saved`
(`commit {hash}` on `local-files`), then one three-space-indented sub-line carrying its composed
line, truncated to 96 characters plus `…` — three-space indent + 96 + `…` lands exactly on the
report lint's 100-character line cap (`plugin/bin/lib/tidy-report-lint/rules.js`'s `MAX_LINE`).
In every mode, Step 7.5's checklist carries a `Filled Release Note` line per repaired record and a
`Skipped Release Note` line per stale-skipped one (Step 3 above); every other skip/failure branch
in Step 3 reports through the Yours **review** group instead, never through Step 7.5. With no run
directory, a `Filled Release Note` line is followed by a ```text fence headed `Original body {ref}`
holding the snapshot file's contents — the undo copy.
