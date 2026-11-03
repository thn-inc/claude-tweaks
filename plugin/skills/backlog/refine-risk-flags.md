# Backlog Refine — Unconfirmed Risk Flags

Cited by `refine-mode.md` Step 3.7 — read this only when that step's pre-filter printed at least one record, and never under the headless posture; nothing else in this skill cites it (#4618). Here a human confirms or narrows a flag set a headless run kept (`_shared/work-record.md`'s Risk flag lines). This step applies no classification: it reads only `classify`'s `entry`, never its `flags` or `kept` (they carry the classifier's floor), and writes only through `confirm`, which acts on the flags the body already carries and adds none. A record with no flag line is never touched (AC6).

## Classify

For each line Step 3.7 printed, run `node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" classify --body-file "{tmp-risk-snapshot}"`, `{tmp-risk-snapshot}` being its `snapshot`, and read `entry` (`{status, reason, unconfirmed}`). Keep a record only when `entry.unconfirmed` is `true` and `entry.status` is not `unclassified`; drop every other record untouched. A non-zero exit leaves that record out, reported with stderr verbatim. With no record kept, this step ends.

## Ask once

A kept record's flags are the slugs its own `Risk-flags:` line names (an `ok` entry guarantees the exact `Risk-flags: a, b` grammar). Ask in the shape `shaping-mode-stamping.md`'s `### Risk flags` step 3 and its comma-list batch paragraph give: one batch table and one `AskUserQuestion` for every kept record's flags together, options labelled `#{n} {slug}`, a selected option meaning remove. Refine's deltas:

- Every flag left unselected is kept and confirmed, and a row's evidence cell reads `already on the record, unconfirmed`.
- A record whose `entry.status` is `unknown` takes no option and no `confirm`: its row says what step 3 says of an unknown entry, naming `entry.reason`, with the remedy under Refused (below).
- A record whose line reads `Risk-flags: none` has no option. `confirm` answers only the flags a body already carries, so on a `none` line nothing is left unanswered and any answers file, `{}` included, clears the marker: the human's answer is the confirmation.
- When no kept record has an option (each is `none` or `unknown`), skip the batch question. If any is `none`, ask one single-choice `AskUserQuestion` naming those records instead: `Confirm no risk flags (Recommended)` clears their markers, `Leave unconfirmed` writes nothing. With only `unknown` records, ask nothing.
- An `AskUserQuestion` that errors, times out or is auto-answered writes nothing: every record stays kept and unconfirmed.

## Write each answered record

Resolve its two files with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" BODY=backlog-refine-risk-body-{key}.md ANSWERS=backlog-refine-risk-answers-{key}.json` and paste them in literally as `{tmp-risk-body}` and `{tmp-risk-answers}`. Write `{tmp-risk-answers}` as a JSON object giving each of the record's flags `"keep"` or `"remove"` (`{}` for a `none` line; a slug left out stays kept and unconfirmed). Then, in this order, under `refine-mode.md` Step 5's Body pre-write reverify, fail closed: a failed re-read or a changed body skips this record's write, logged, tallied and reported exactly as that rule states for a body.

1. **Re-read** the live body: under `github-issues`, `gh issue view {n} --json body -q .body > "{tmp-risk-body}"`; under `local-files`, and for a `facets.unsynced === true` record under either driver, `node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js').readRecord(process.argv[1]).body)" -- "{path}" > "{tmp-risk-body}"` (`readRecord`). A non-zero exit is a failed re-read.
2. **Compare** with `cmp -s "{tmp-risk-snapshot}" "{tmp-risk-body}"`: any non-zero exit is a changed body.
3. **Confirm** with `node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" confirm --body-file "{tmp-risk-body}" --answers-file "{tmp-risk-answers}"`. It rewrites the body file, prints `flags`, `removed`, `unconfirmed`, `status` and `refused`, and logs nothing (step 6 does, after the write). A non-zero exit writes nothing for this record, reported with stderr verbatim.
4. **Write**, only when `refused` is `null`: under `github-issues`, `gh issue edit {n} --body-file "{tmp-risk-body}"`; under `local-files`, and for an unsynced record, `writeRecord` on the record's file with its title and `facets` unchanged and the body file less the trailing newline step 1 added, `node -e "const s=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');const r=s.readRecord(process.argv[1]);s.writeRecord(process.argv[1],{title:r.title,body:require('fs').readFileSync(process.argv[2],'utf8').replace(/\n$/,''),facets:r.facets})" -- "{path}" "{tmp-risk-body}"`, then `git add "{path}"` and `git commit -m "Backlog Refine: confirm risk flags on {id}"`.
5. **Refresh Step 1's snapshot** once the write succeeded, so Step 5's body reverify for this record compares against the body now on it rather than the one this step replaced. `{ref}` is the line's `number`, or for a local record its `path`; the block re-reads the stored body (`gh issue view`, or `readRecord`) into that record's row of `session-scoped backlog-refine-faceted.json`:

```bash
ST_BACKLOG_REFINE_FACETED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-refine-faceted.json)"
node -e "
  const fs = require('fs');
  const { execFileSync } = require('child_process');
  const { readRecord } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  const [faceted, ref] = process.argv.slice(1);
  const rows = JSON.parse(fs.readFileSync(faceted, 'utf8'));
  const row = rows.find((r) => String(r.number ?? r.path) === ref);
  if (row === undefined) throw new Error('no Step 1 snapshot row for ' + ref);
  const local = row.number === undefined || row.number === null;
  row.body = local ? readRecord(row.path).body : JSON.parse(execFileSync('gh', ['issue', 'view', ref, '--json', 'body'], { encoding: 'utf8', windowsHide: true })).body;
  fs.writeFileSync(faceted + '.next', JSON.stringify(rows));
  fs.renameSync(faceted + '.next', faceted);
" -- "$ST_BACKLOG_REFINE_FACETED" "{ref}"
```

A non-zero exit from that block leaves the snapshot stale, so Step 5 skips this record's body writes as changed (fail closed): report it.
6. **Log** each `removed` slug, only once step 4's write succeeded, as `shaping-mode-stamping.md`'s `### Risk flags` step 5 states (its `logged: false` fallback covers `logFailures`), with `--site backlog` in place of `--site specify`: `node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" log-removals --run "$PIPELINE_RUN_DIR" --site backlog --removed {removed}` when this run's run dir resolved. Under `local-files` its Gotchas bullet goes into the body file before step 4's write. `--site backlog` logs under `/backlog`'s `Refine risk flags` step.

## Refused

**When `confirm` returns a non-null `refused` (Reading A),** write nothing for that record and log nothing. Its row carries `shaping-mode-stamping.md`'s `### Risk flags` step 3 refused wording: the line must be repaired first, with `refused.reason` named when set and none named for a `null` reason. The row names refine's remedy for the human to run: for `malformed`, `/claude-tweaks:specify #{n}` (which rewrites the line as the widened set) and then `/claude-tweaks:backlog refine #{n}`; for `unknown-slug`, making the slug known (policy `risk-categories`, read only with control mode on) or a human correcting the line on the record, and then `/claude-tweaks:backlog refine #{n}`.

## Report

Report each record's outcome (confirmed, the slugs removed, skipped, refused or failed) before Step 4 renders. The read-to-write window left after the re-read is the residual `refine-mode.md`'s Concurrency section accepts.
