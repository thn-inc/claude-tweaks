# Tidy — `--console-backfill` Mode

Entered when `/claude-tweaks:tidy --console-backfill` is invoked — `SKILL.md`'s Input routes here in place of Steps 1-7.5. This mode never runs the backlog scan. It settles the unresolved items that closed and archived runs left in their Review Consoles (a can't-tell finding, a staged proposal, a digest-bound line nobody posted): every item ends as **filed** (a backlog record), **dropped** (the tiebreak refuted it), **digested** (a materiality-digest line) or **dismissed** (a byte-identical staged duplicate), and its console records which. **Human-present only** — a Routine and a pipeline never reach it; the summary in Step 4 is the one stop.

`bin/console-backfill.js` does the deterministic half and never calls a model or `gh`: `list` finds the work, `dispose` plans each pass, `apply` writes the outcomes back. This procedure does the rest — the tiebreak agents, the `gh` writes, the digest comment. It never writes `console.json` itself; `apply` is the only writer, and it re-checks at apply time that the run is closed.

## Step 1: Flags

A routing token that replaces a skill's phases owns every flag the skill accepts (`docs/skill-authoring.md`). `--console-backfill` replaces Steps 1-7.5, so:

- `--scope` and `--approve` with `--console-backfill`: rejected in combination — report both tokens, run neither.
- `--dry-run`: re-implemented — run `list --dry-run` (Step 4), print it, and stop. Nothing is written, dispatched or filed.

## Step 2: Main session only

The tiebreak agents are dispatched from this session. If the procedure is running inside a Task agent (no `Agent` tool), it stops and reports that `/claude-tweaks:tidy --console-backfill` must run in the main session. Never a nested or in-place substitute for the dispatch.

## Step 3: Backend gate

Read `work-backend` the way `step-1-records.md` does (the project's CLAUDE.md `## Work records` section; a missing flag is `local-files`). This mode files records and posts to the digest issue through GitHub, so any value but `github-issues` ends here, before anything is written, with `HELD — console backfill needs work-backend: github-issues; local-files support is tracked as the backlog record "Console backfill: settle Review Console residue under work-backend: local-files"`.

## Step 4: Summary first

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/console-backfill.js" list --dry-run` and print its output verbatim. It writes nothing and needs no checkout: the runs and items it counts, the deterministic digest/dismiss/file split, the live runs it skips, and the two numbers the question below needs (`tiebreak dispatches`, `records filed at most`). Exit 3 means the pipelines root is missing: report `HELD`, nothing was written.

With `--dry-run`, stop here. Otherwise ask one `AskUserQuestion`, `{a}` and `{N}` taken from the summary:

- `question`: `"The backfill will dispatch {a} tiebreak agents and may file up to {N} records. Proceed?"`
- `Proceed (Recommended)` — runs the passes below; each pass may file records and post to the shared digest issue.
- `Stop` — ends with nothing written; report `HELD`.

## Step 5: The integration tip, a scratch worktree, and the run's state

Resolve `{integration-branch}` by `_shared/integration-branch.md`'s Resolution ladder. Then, as separate plain calls, `git fetch origin {integration-branch}` and `git rev-parse origin/{integration-branch}`; the printed sha is `{mainSha}`. Create a scratch worktree per `_shared/scratch-worktree.md`'s `## 2. Creating it`, put it at that tip with `git checkout --detach {mainSha}` when the tool created it on a branch, and confirm `git rev-parse HEAD` prints `{mainSha}`. The tiebreak agents read its files, and `resolve-tiebreak` runs against it as `--root`.

Tear it down at the end on every exit path — a `console-backfill.js` failure, an agent failure, the loop ending — per `_shared/scratch-worktree.md`'s `## 6. Tearing down` (the detached HEAD equals `origin/{integration-branch}`, so its ancestry check passes). A worktree the `git worktree add` fallback created under `.worktrees/` is removed with `git worktree remove {path}`: `ExitWorktree` does not operate on it (§6). The worktree is never written to.

Take a run stamp with one plain call, `node -e "console.log(Date.now())"` (`{stamp}`: a same-session re-run then writes fresh tiebreak files, never over an earlier run's). Resolve the run's paths once with one plain call: `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" WORKLIST=console-backfill-worklist.json BATCHLIST=console-backfill-batchlist.json EXISTING=console-backfill-existing.json COMMENTS=console-backfill-comments.json VERDICTS=console-backfill-verdicts.json PLAN=console-backfill-plan.json AWAITING=console-backfill-awaiting.json REFS=console-backfill-refs.json ENTRIES=console-backfill-entries.json OUTDIR=console-backfill-filings.d DIGESTDIR=console-backfill-digest.d TBDIR=console-backfill-tiebreak-{stamp}.d` (`_shared/session-tmp-root.md`; use each path inside its printed quotes). Then initialise `{VERDICTS}` with the write-json fence below, `{path}` = `{VERDICTS}` and `{json}` = `{}` — not the `Write` tool, which refuses a file this session has not read since it last changed:

```bash
node -e "require('fs').writeFileSync(process.argv[1],process.argv[2])" "{path}" '{json}'
```

The verdicts file is kept across passes, keyed by item id, so each verdict is computed once per item.

Keep two sets for the run. The **failed set** (item id plus a named reason) is never retried and is reported at the end. The **stale set** holds item ids that were refused `stale-hash` once.

## Step 6: One pass

Repeat Steps 6-8 until Step 9's exit test fires.

1. **List again, before EVERY batch.** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-backfill.js" list --main-sha {mainSha} --out "{WORKLIST}"`. Every `itemHash` is fresh that way, including after an earlier pass persisted a split group. Exit 2 or 3: stop and report stderr.
2. **Drop the failed set** from the fresh list. This fence writes `{BATCHLIST}` and prints how many items the list holds and how many are left after the failed set:

   ```bash
   node -e "const fs=require('fs');const [src,dst,...skip]=process.argv.slice(1);const w=JSON.parse(fs.readFileSync(src,'utf8'));const sk=new Set(skip);let remaining=0;let eligible=0;w.runs=w.runs.map(r=>{remaining+=r.items.length;const items=r.items.filter(i=>!sk.has(i.itemId));eligible+=items.length;return {...r,items};}).filter(r=>r.items.length);fs.writeFileSync(dst,JSON.stringify(w));console.log(JSON.stringify({remaining,eligible}))" "{WORKLIST}" "{BATCHLIST}" {failed-itemIds}
   ```

   `{failed-itemIds}` is the failed set's ids, space-separated, or nothing. `eligible` of 0 goes to Step 9.
3. **Fetch once per pass**, each redirected to its path:
   - **Size the dedup read from the repo** (`_shared/github-write-transport.md`'s "Sizing the list-then-filter window"; never a hard-coded window): `gh issue list --state all --limit 100000 --json number --jq length` prints the record count. A count equal to 100000 is truncated, not complete — stop, `HELD` if nothing has landed yet, else `PARTIAL`, and report it. Otherwise `gh issue list --state all --limit {count + 100} --json number,title,body > "{EXISTING}"`. This run's earlier filings are in it, so a record filed in pass 1 dedups in pass 2.
   - the open digest issue: `gh issue list --label digest --state open --json number,url`. When one is open, `gh issue view {n} --json comments --jq .comments > "{COMMENTS}"` (pass it as `--digest-comments`; the comments carry their author association, so only trusted ones dedup, `_shared/materiality-floor.md`'s Dedup). When none is open, omit `--digest-comments`; the container is created in Step 7 only if the pass holds a digest line, per `_shared/materiality-floor.md`'s Container.
4. **Dispose.** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-backfill.js" dispose --work-list "{BATCHLIST}" --verdicts "{VERDICTS}" --existing "{EXISTING}" [--digest-comments "{COMMENTS}"] --limit 24 --out-dir "{OUTDIR}" > "{PLAN}"` (`--limit 24` is the CLI default, stated so the batch size is visible). Exit 2 or 3: stop and report stderr. The plan is one line of JSON, so print its fields instead of reading it:

   ```bash
   node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify({dispositions:p.dispositions.length,file:p.file,reuse:p.reuse,digestLines:p.digest.lines.length,digestDuplicates:p.digest.duplicates,drops:p.dispositions.filter(d=>d.action==='drop').map(d=>({itemId:d.itemId,ref:d.ref})),awaitingVerdict:p.awaitingVerdict},null,1))" "{PLAN}"
   ```

   `drops` lists each refuted finding with its evidence (`ref`), for the Step 10 report. `file` lists each new record to create (`itemId`, `fingerprint`, `title`, `path`); proposal bodies are in the files named by `path` and never in the plan. A finding whose record already exists (filed by an earlier, interrupted run) comes back as a `reuse` with no verdict needed, and never as `awaitingVerdict`.
5. **Dispositions in the plan:** act on them (Step 7), then start the next pass. **None, but `awaitingVerdict` is non-empty:** judge the next findings (Step 8), then start the next pass. **Neither:** stop and report it; that is a defect, not a clean finish.

## Step 7: Settle the plan, in this order

The non-finding items (digest, dismiss, file) need no tiebreak, and neither does a prefiled finding. Per item, in this fixed order: dedup → file or digest → record ref → apply. The dedup is already in the plan (`reuse` is a filing that has a record, or repeats an earlier item of this pass; `digest.duplicates` is a line already posted). Write `{REFS}` with the write-json fence (Step 5) once the pass's `gh` writes are done: `{json}` is a JSON object `{"<itemId>":"<ref>"}`, or `{}` when there are none.

- **File.** For each `file[]` entry, read the proposal at `path`. Its header (the lines before the first blank line) carries `Title:`, `Type:`, `Labels:` and `Defer-reason:`. Run `wrap-up/refused-proposals.md`'s check on `Defer-reason:` first. A missing or invalid value files nothing: the item joins the failed set with reason `no-defer-reason`, is reported unsettled, and the run's outcome stays `PARTIAL`. The human action is to add a valid `Defer-reason:` line to that staged file's header (the item's console directory, `staged/`) and re-run. Otherwise create the record: the title is `file[].title`, single-quoted with each `'` inside it written `'\''` (`wrap-up/review-console.md` "On approval" step 7's quoting rule — a claim quoted in a title routinely carries backticks or `$(`); the body is the proposal's text after the header's blank line, written unchanged to a session-tmp file and passed with `--body-file`. Labels are the `Labels:` header's, and only those: `Labels: none`, or no `Labels:` line, is no label. A finding or shadow-dup proposal carries `needs:definition` from its own header. On top of those, the Type row's expression from `_shared/work-record.md` (a `type:*` label under `work-types: labels`). Never add or remove an `auto:*` or `bot:*` label on any record — they are granted by `/claude-tweaks:backlog refine`, never filed, and `dispose` already strips them from a Queue proposal's header. Transport per `_shared/github-write-transport.md`. The created record's ref is `#N`.
- **Reuse.** An entry with an existing record already has its `#N` in the plan. A same-pass `reuse` carrying `sameAs` takes its twin's `#N` — the settle fence below does this from `{REFS}`.
- **Digest.** Create the container first when none is open (`_shared/materiality-floor.md`'s Container, label bootstrapped per `_shared/label-bootstrap.md`). Split the pass's `digest.lines` into comments of **under 60,000 characters** each — the one-comment-per-run rule of `_shared/materiality-floor.md` then holds per pass:

  ```bash
  node -e "const fs=require('fs');const [plan,dir,cap]=process.argv.slice(1);const p=JSON.parse(fs.readFileSync(plan,'utf8'));fs.mkdirSync(dir,{recursive:true});const dup=new Set(p.digest.duplicates);const byLine=new Map(p.dispositions.filter(d=>d.action==='digest'&&!dup.has(d.itemId)).map(d=>[d.digest.line,d.itemId]));const chunks=[];let cur=null;for(const line of p.digest.lines){if(!cur||cur.size+line.length+1>Number(cap)){cur={lines:[],itemIds:[],size:0};chunks.push(cur);}cur.lines.push(line);cur.itemIds.push(byLine.get(line));cur.size+=line.length+1;}const out=chunks.map((c,k)=>{const f=dir+'/digest-'+k+'.md';fs.writeFileSync(f,c.lines.join('\n')+'\n');return {path:f,itemIds:c.itemIds};});console.log(JSON.stringify(out,null,1))" "{PLAN}" "{DIGESTDIR}" 60000
  ```

  Post each printed `path` with `gh issue comment {n} --body-file "{path}"`; the comment's URL is the ref of every item in that chunk's `itemIds`. A `digestDuplicates` item's ref is the comment holding its entry: one already posted carries that comment's URL in the plan; a same-pass repeat (the plan's `digest.sameAs`) takes its twin's comment URL — the settle fence below does this from `{REFS}`. The `digest` issue is a container, not a record: no label or state change on it here, and its comment-cap rollover stays `digest-sweep.md`'s.
  A reflect observation or convention with no `**Destination:**` line (staged before destination lines existed) digests with `Defer-reason: reflect-no-destination`, the same rule the live console's `reflect-apply.js` applies; every other unmapped staged item keeps `console-backfill-unmapped-kind`.
- **Failures.** A failed `gh` call leaves that item out of `{REFS}`. It stays unsettled, joins the failed set with the error, and the next run resumes it: a record created before a crash is found by its `work-fingerprint` in `{EXISTING}` and settles with no verdict, so nothing is filed twice and no filed record is orphaned.

Drops and dismissals carry their evidence in the plan's `ref` already. Then **apply**: build the entries — the plan's `entries` with every null `ref` filled from `{REFS}`, a same-pass twin (a filing's or a digest line's) resolved, and any item still without a ref left out (a missing refs file reads as `{}`):

```bash
node -e "const fs=require('fs');const [plan,refs,dst]=process.argv.slice(1);const p=JSON.parse(fs.readFileSync(plan,'utf8'));let r={};try{r=JSON.parse(fs.readFileSync(refs,'utf8'));}catch(e){}for(const u of [...p.reuse,...((p.digest&&p.digest.sameAs)||[])])if(u.sameAs&&r[u.sameAs]&&!r[u.itemId])r[u.itemId]=r[u.sameAs];const entries=[];const unsettled=[];for(const e of p.entries){const ref=e.ref||r[e.itemId]||null;if(ref)entries.push({...e,ref});else unsettled.push(e.itemId);}fs.writeFileSync(dst,JSON.stringify(entries));console.log(JSON.stringify({entries:entries.length,unsettled}))" "{PLAN}" "{REFS}" "{ENTRIES}"
```

Every printed `unsettled` id joins the failed set. Then `node "${CLAUDE_PLUGIN_ROOT}/bin/console-backfill.js" apply --entries "{ENTRIES}"` and print the `applied` and `refused` counts. A refusal is reported with its reason, never retried blindly, and its item joins the failed set — except the first `stale-hash` refusal of an item. `stale-hash` means re-list once, never force: a console changed between the list and the apply (an earlier entry of this pass persisted a split group), and the filing or digest line already landed. Put the item in the stale set instead; the next pass's Step 6 re-lists, the item returns with a fresh hash, its verdict is still in `{VERDICTS}`, its record is found by fingerprint and its digest line by the digest dedup, and `apply` settles it. A second `stale-hash` refusal of the same item joins the failed set. Exit 3 from `apply` (a `console.json` unwritable) stops the loop.

## Step 8: Judge the awaiting findings

When Step 6.5 found no disposition and a non-empty `awaitingVerdict`: print the next findings to judge, at most 24, with this fence redirected to `{AWAITING}`, then read that file:

```bash
node -e "const fs=require('fs');const [list,plan,n]=process.argv.slice(1);const w=JSON.parse(fs.readFileSync(list,'utf8'));const p=JSON.parse(fs.readFileSync(plan,'utf8'));const want=new Set(p.awaitingVerdict);const out=[];for(const r of w.runs)for(const i of r.items){if(out.length>=Number(n))break;if(!want.has(i.itemId))continue;out.push({itemId:i.itemId,name:i.itemId.replace(/^bf:/,'').replace(/[^A-Za-z0-9_-]/g,'_'),finding:i.finding,claimText:i.claimText,context:i.context});}console.log(JSON.stringify(out,null,1))" "{BATCHLIST}" "{PLAN}" 24 > "{AWAITING}"
```

Dispatch one fresh agent per finding in **waves of 8** — a wave in one batch, every agent returned before the next wave — following `review/step3-tiebreak.md`'s `## Dispatch` (its wait rules, foreground discipline and parallel-execution form). Model `Capable`: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable` (no run directory exists).

Read `review/step3-tiebreak.md` and inline the fenced template under its `## Dispatch` verbatim into each `Task()` prompt, with these field values and nothing else changed:

- `Finding:` = the item's `claimText`, then a second line `Source (context only — judge just the finding at Location): {context}`.
- `Severity:` = `finding.reporterSeverity`.
- `Location:` = `{path}:{line}` from `finding`, or `{path}` when `line` is null.
- `Diff scope:` replaced by `Current code: {scratch worktree} at {mainSha} — decide whether this finding still holds today`.
- No `Positions:` lines — the stored finding carries none, whatever its `kind`.
- The bracketed READ-ONLY REVIEW line becomes `_shared/subagent-dispatch-core.md`'s `READ-ONLY REVIEW:` line, verbatim; `SCRATCH:` becomes a per-agent path from `session-tmp-resolve.js` (`SCRATCH=console-backfill-agent-{k}.d`); the model bracket line becomes the resolved profile.

A `BLOCKED`, `NEEDS_CONTEXT` or empty reply is re-dispatched once as a fresh agent, then passed as an empty reply — the resolver turns it into can't-tell, so a failed dispatch fails toward scrutiny, never toward a drop. Never log verdict lines into the closed run's `decisions.md`.

Resolve each reply with files named by the item's `name`: `Write` the finding as `{lens, path, line, claim: claimText, reporterSeverity, kind}` (from the item's `finding` and `claimText`) to `{TBDIR}/{name}-finding.json` and the agent's reply to `{TBDIR}/{name}-reply.txt`, then `node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" resolve-tiebreak "{TBDIR}/{name}-finding.json" "{TBDIR}/{name}-reply.txt" --root "{scratch worktree}" > "{TBDIR}/{name}-verdict.json"`. The resolver's output is never copied by hand. Then merge every verdict file into `{VERDICTS}` with this fence:

```bash
node -e "const fs=require('fs');const [vf,dir,aw]=process.argv.slice(1);let v={};try{v=JSON.parse(fs.readFileSync(vf,'utf8'));}catch(e){}const items=JSON.parse(fs.readFileSync(aw,'utf8'));const added=[];const missing=[];for(const i of items){try{const o=JSON.parse(fs.readFileSync(dir+'/'+i.name+'-verdict.json','utf8'));if(!o||typeof o.outcome!=='string')throw new Error('no outcome');v[i.itemId]=o;added.push(i.itemId);}catch(e){missing.push(i.itemId);}}fs.writeFileSync(vf,JSON.stringify(v));console.log(JSON.stringify({added,missing}))" "{VERDICTS}" "{TBDIR}" "{AWAITING}"
```

Each printed `missing` id (a `resolve-tiebreak` that exited non-zero leaves no usable file — never invent a verdict) joins the failed set with reason `resolve-tiebreak failed`.

## Step 9: Exit test

After Step 6.2, `remaining` is the full list and `eligible` what is left once the failed set is dropped. `remaining` of 0: the work list is empty — done. `eligible` of 0 with a non-empty `remaining`: every remaining item has a named failure — stop. Otherwise the pass continues.

## Step 10: Report

Run `list --dry-run` once more for the live-runs line, tear down the scratch worktree (Step 5), then report, each as paste-ready lines the reader can follow:

- every filed record (`#N`, with the item it settled);
- every drop, with its evidence (`{path}:{line} "{quote}"`), kept from each pass's plan fence `drops`;
- every digest comment URL and the count digested (a run that digested none states `0`, `_shared/materiality-floor.md`'s Digest URL and count surfacing);
- every unsettled item, with its reason, and the re-run `/claude-tweaks:tidy --console-backfill`;
- a separate line for items whose filing or digest line landed but whose `apply` did not: `landed, not applied: {itemId} → {ref}`, with the same re-run — the next run finds the record by fingerprint or the line by the digest dedup, needs no new verdict, and applies it;
- the live runs skipped (their consoles are untouched).

Close with the outcome word (`driver-skill-outcome-taxonomy`): `HELD` when a gate fired before any write (Step 3, Step 4's `Stop`, a truncated record read or an exit 3 on the first pass), `failed` when a write was attempted and nothing landed, `PARTIAL` when something landed and items remain (an item left `no-defer-reason` keeps a run `PARTIAL`), `done` when the work list is empty.
