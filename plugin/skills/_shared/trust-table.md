# Trust Table — Shared Procedure

Single source of truth for rendering `bin/lib/issues/trust.js`'s per-class trust table. Consumed
by `/claude-tweaks:help` (`status-scan.md` Stage 4.8), `/claude-tweaks:backlog overview`
(overview-mode.md — Step 1.5 computes once per invocation; bare mode renders a collapsed
consequence line and the trust lens renders this table), and `/claude-tweaks:backlog refine`
(`refine-mode.md` Step 3, which
reuses the Fetch section for its advisory trust consequence lines, fetched only at `trusted`+ or
`--trust`). Subagents cannot read this file —
`/help`'s dispatcher inlines this file's Fetch and Render sections into Stage 4.8's agent prompt,
the same pattern already used for `_shared/github-pr-scan.md`. The Fetch section goes in
**whole**, its `backlog-fetch-limit` and `work-links` resolution sub-sections included: the
parent-issue fetch has two mutually exclusive branches, and an agent that cannot resolve
`work-links` cannot choose between them.

**Read-only, and read-only for a reason.** This procedure reports what evidence exists and
nothing else — it never grants a label, changes a label, merges anything, or recommends an
autonomous action. `_shared/policy-schema.md`'s `autonomy` lever (default `supervised`) is the
only thing that acts on this table's verdicts, and it does so through
`bin/lib/issues/autonomy.js` in its own consumers — `_shared/autonomy-ceiling.md` names them —
never here. **Rendering and acting stay separate surfaces on purpose:** do not attach a "next
step" suggestion to a verdict in this table, whatever the ceiling is set to. That is exactly the
mid-flow autonomy the bookend architecture withholds.

**Omit entirely under `work-backend: local-files`.** `demo:approved`/`demo:changes-requested` are
GitHub Issue labels this table reads directly; there is no local-record equivalent to fetch.

## Fetch

`trustRows` reads one record set — closed records form the cells, and open records are still
scanned for follow-up `Origin:` references naming a closed record's number — and one derived
input, the set of record numbers that are decomposed sub-issues. The record set is a single
`gh issue list --state all` call; the sub-issue set costs a second one (plus, under
`work-links: native`, one `sub_issues` call per parent). Both are fetched below before anything
is rendered.

Before running anything below, resolve `backlog-fetch-limit` with
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit` (per
`_shared/work-record.md`'s Config keys table, the same value `_shared/record-queue-fetch.md`
resolves; the resolver applies the schema default when the key is absent) and substitute it for
`{resolved-limit}` in **every** block below that references it. Substitute the literal number
independently in each block — do **not** rely on a `${BACKLOG_FETCH_LIMIT:-1000}` expansion
reading an `export` from an earlier step, and do not factor the `LIMIT="{resolved-limit}"` line
out into a block of its own either. Shell environment does not survive between Bash calls and
never reaches a subagent, so any cross-block reliance on a shell variable — an env expansion or a
variable set in a prior fenced block — silently resolves empty or falls back to `1000` even when
the project configures a higher limit. Every fenced block below that uses `$LIMIT` or
`process.env.FETCH_LIMIT` sets both at its own top for exactly this reason.

A decomposed sub-issue must not form a cell of its own — its parent issue already carries the one
graded verdict, and counting the sub-issue too would let `total >= MIN_SAMPLES` be satisfied by
records nobody judged (`trust.js`'s `hasParent !== true` filter). Resolving which closed records
are sub-issues reuses the same parent-side enumeration `_shared/github-pr-scan-acceptance.md`'s
`acceptance-gap` scope already documents in full — never the sub-issue side, which works under one
`work-links` mode and silently returns nothing under the other — and fetches parents `--state all`
for the same reason that scope does: an approved parent issue is closed, so an open-only fetch
would miss exactly the parents this filter needs to see.

This table grades the **entire** historical closed-record set with no recency bound at all — and
so does the `--state all` parent-issue fetch that feeds it. A fixed `--limit 200` here would let
`gh issue list`'s newest-first ordering silently drop the **oldest** `parent-issue` records first —
and older parents are exactly the ones most likely to already sit inside a `total >= 8` cell, so
truncation would reopen the exact defect this filter exists to close, with no warning. The
parent-issue fetches below therefore use the same `{resolved-limit}` and the same
truncation-warning discipline as the main record fetch further down, not a separate hardcoded cap.
(`acceptance-gap`'s own *closed-record* fetch is bounded by the same `{resolved-limit}` and
carries the same truncation-warning discipline — a 30-day window does not bound it, per that
file's "Fetch limit" section — not a separate hardcoded cap.)

Every intermediate file this procedure writes below lands in the session scratchpad, never bare
`/tmp` — per `_shared/session-tmp-root.md`'s convention (cited, not restated): a literal
`/tmp/trust-table-*` path is not guaranteed visible from one Bash call to the next in this
harness, the same per-call isolation `backlog-fetch-limit` above is worked around for. Resolve
every path below once, before running anything else, via the CLI wrapper — seven files is over
that convention's three-file cutoff for preferring it to the inline `node -e` form:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" \
  PARENT_ISSUES=trust-table-parent-issues.json \
  SUB_ISSUES=trust-table-sub-issues.json \
  SUB_ISSUES_BATCH=trust-table-sub-issues-batch.json \
  GIT_LOG=trust-table-git-log.txt \
  RECORDS=trust-table-records.json \
  SUB_ISSUE_NUMBERS=trust-table-sub-issue-numbers.jsonl \
  SUB_ISSUE_FAILURES=trust-table-sub-issue-failures.txt)"
echo "$PARENT_ISSUES|$SUB_ISSUES|$SUB_ISSUES_BATCH|$GIT_LOG|$RECORDS|$SUB_ISSUE_NUMBERS|$SUB_ISSUE_FAILURES"
```

Substitute the seven printed absolute paths for `{tmp-parent-issues}`, `{tmp-sub-issues}`,
`{tmp-sub-issues-batch}`, `{tmp-git-log}`, `{tmp-records}`, `{tmp-sub-issue-numbers}`, and
`{tmp-sub-issue-failures}` respectively, literally, in **every** block below that references
one — the same discipline `{resolved-limit}` above already uses, never a shell variable relied
on to survive across calls or reach a subagent.

### `work-links` resolution

**Read `work-links` before choosing between the two branches below** — they are mutually
exclusive, and nothing in the fetched data reveals which one applies. It lives in the project's
`.claude-tweaks/policy.yml` (per `_shared/work-record-config.md`'s key table), so resolve it
directly rather than assuming the first-listed
branch:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links
```

The printed value names the branch to take — the resolver applies the documented default
(`body-text`) when the key is unset. Taking the `body-text` branch on a `work-links: native` repo
is not a degraded read but a silent total failure: a native parent's body carries no task list by
construction, so `parseSubIssues` returns `[]` for every parent,
`{tmp-sub-issues}` is empty, and every decomposed sub-issue re-enters `cell.total`
as ungraded evidence — reinstating exactly the manufactured-`clean` path this filter exists to
close, in the one direction this table must never fail in.

**`work-links: body-text`** — one fetch supplies every parent's task list:

```bash
LIMIT="{resolved-limit}"
export FETCH_LIMIT="$LIMIT"
gh issue list --label parent-issue --state all --json number,body --limit "$LIMIT" \
  > "{tmp-parent-issues}"
node -e "
  const { parseSubIssues } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const fs = require('fs');
  const parents = require('{tmp-parent-issues}');
  if (parents.length === Number(process.env.FETCH_LIMIT)) {
    console.error('WARNING: fetched exactly ' + parents.length + ' parent-issue records (the configured backlog-fetch-limit) — older parent issues were dropped, so their sub-issues may silently re-enter cell totals as ungraded evidence. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before reading any verdict.');
  }
  const subIssueNumbers = parents.flatMap((p) => parseSubIssues(p.body));
  fs.writeFileSync('{tmp-sub-issues}', JSON.stringify(subIssueNumbers));
"
```

**`work-links: native`** — the parent body carries no task list, so fetch parent numbers alone and
query the sub-issues API instead, via a batched aliased-GraphQL probe with a per-parent REST
fallback:

```bash
LIMIT="{resolved-limit}"
export FETCH_LIMIT="$LIMIT"
gh issue list --label parent-issue --state all --json number --limit "$LIMIT" \
  > "{tmp-parent-issues}"
```

```bash
LIMIT="{resolved-limit}"
export FETCH_LIMIT="$LIMIT"
node -e "
  const parents = require('{tmp-parent-issues}');
  if (parents.length === Number(process.env.FETCH_LIMIT)) {
    console.error('WARNING: fetched exactly ' + parents.length + ' parent-issue records (the configured backlog-fetch-limit) — older parent issues were dropped, so their sub-issues may silently re-enter cell totals as ungraded evidence. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before reading any verdict.');
  }
"
```

The sub-issue fetch itself follows the same session-scoped freshness rule as the git-log dump
below and the record snapshot in `_shared/record-queue-fetch.md`'s Session-scoped record snapshot
section — reuse `/tmp/ct-subissues-{session-id}.json` (`record-snapshot.js`'s
`subIssuesPath($CLAUDE_CODE_SESSION_ID)`) when fresh, else regenerate it via the batched probe
below:

```bash
SUBSNAP=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').subIssuesPath(process.env.CLAUDE_CODE_SESSION_ID) || '')")
if [ -n "$SUBSNAP" ] && node -e "
  const { isFresh } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js');
  process.exit(isFresh(process.argv[1], Number(process.argv[2])) ? 0 : 1)
" "$SUBSNAP" "$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values record-snapshot-ttl-seconds)"; then
  cp "$SUBSNAP" "{tmp-sub-issues}"
  echo SUBSNAP_FRESH
else
  echo SUBSNAP_STALE
fi
```

Branch on the printed token, never on whether the file appears to exist — `{tmp-sub-issues}` can already be present and stale from an earlier run, so the token is the only observable signal (mirrors the git-log block's both-branches-observable precedent later in this file). When the block above printed `SUBSNAP_FRESH`, `{tmp-sub-issues}` was just written from the snapshot — skip straight to the git-log section below, the fetch and retry ladder that follow are unnecessary. When it printed `SUBSNAP_STALE`, run the batched fetch instead — one CLI call resolving every parent's sub-issues at once (`bin/fetch-sub-issues.js`, wrapping `native-dependencies.js`'s `fetchNativeSubIssues`), invoked via command substitution rather than an `xargs` pipe so an empty parent list still invokes it validly (its zero-positional contract prints an empty envelope rather than erroring) and the CLI's own exit status survives instead of being replaced by the pipe's:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/fetch-sub-issues.js" --resolve-retries $(node -e "require('{tmp-parent-issues}').forEach(p => console.log(p.number))") > "{tmp-sub-issues-batch}"
```

Branch on this command's exit code before doing anything else. **Exit 4** — the `subIssues`
GraphQL field is unavailable on this host — run the Fallback block below for **every** parent
instead of the canonicalization step that follows; it produces the same
`{tmp-sub-issues}` by the older, verbatim REST path. **Exit 3** — the GraphQL call
itself failed (network/API error, or a missing-repository response) — the run fails loud: report
no verdict at all, naming the failed parents from the command's stderr. **Exit 1 or 2** — a
malformed invocation or a missing `gh`/unresolvable repo: an environment or transcription bug, not
a data outcome — stop and surface the CLI's stderr rather than reading the (empty) batch file.
**Exit 0** — continue to the canonicalization step below.

`--resolve-retries` already resolved every parent the probe could not fit in one page — a
missing alias, or a `subIssues` connection whose `pageInfo.hasNextPage` was true
(`native-dependencies.js`'s `fetchNativeSubIssues` never lands a parent in `byParent` for either
case) — via its own per-parent paginated REST call, merged back into `byParent`; a retry parent
whose REST call failed would have already made the CLI itself exit 3 above, naming the parent, so
reaching this point means every parent's sub-issues are already in hand. The only work left is
canonicalization — flatten, dedupe, sort:

```bash
node -e "
  const fs = require('fs');
  const batch = require('{tmp-sub-issues-batch}');
  const all = Object.values(batch.byParent || {}).flat();
  const subIssueNumbers = Array.from(new Set(all)).sort((a, b) => a - b);
  fs.writeFileSync('{tmp-sub-issues}', JSON.stringify(subIssueNumbers));
  const subSnapPath = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').subIssuesPath(process.env.CLAUDE_CODE_SESSION_ID);
  if (subSnapPath) fs.writeFileSync(subSnapPath, JSON.stringify(subIssueNumbers));
"
```

`{tmp-sub-issues}` and the session snapshot are only ever written here, once the
envelope is already fully resolved — there is no partial-write hazard left to guard against, since
a failed retry never reaches this line at all (`--resolve-retries` exits 3 naming the parent instead).

#### Fallback (probe unavailable — older GHE)

Runs only on exit 4 above, for every parent — the older, per-parent REST loop this branch used
before the batched probe existed:

```bash
: > "{tmp-sub-issue-numbers}"
: > "{tmp-sub-issue-failures}"
node -e "require('{tmp-parent-issues}').forEach(p => console.log(p.number))" | while read -r N; do
  gh api --paginate "repos/{owner}/{repo}/issues/$N/sub_issues" --jq '.[].number' >> "{tmp-sub-issue-numbers}" || echo "$N" >> "{tmp-sub-issue-failures}"
done

LIMIT="{resolved-limit}"
export FETCH_LIMIT="$LIMIT"
node -e "
  const fs = require('fs');
  const failures = fs.readFileSync('{tmp-sub-issue-failures}', 'utf8').trim().split('\n').filter(Boolean);
  if (failures.length) {
    throw new Error('sub-issue REST fallback failed for parent(s): ' + failures.join(', ') + ' — refusing to write {tmp-sub-issues} or the session snapshot on an undercounted set');
  }
  const parents = require('{tmp-parent-issues}');
  if (parents.length === Number(process.env.FETCH_LIMIT)) {
    console.error('WARNING: fetched exactly ' + parents.length + ' parent-issue records (the configured backlog-fetch-limit) — older parent issues were dropped, so their sub-issues may silently re-enter cell totals as ungraded evidence. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before reading any verdict.');
  }
  const raw = fs.readFileSync('{tmp-sub-issue-numbers}', 'utf8').trim().split('\n').filter(Boolean).map(Number);
  const subIssueNumbers = Array.from(new Set(raw)).sort((a, b) => a - b);
  fs.writeFileSync('{tmp-sub-issues}', JSON.stringify(subIssueNumbers));
  const subSnapPath = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').subIssuesPath(process.env.CLAUDE_CODE_SESSION_ID);
  if (subSnapPath) fs.writeFileSync(subSnapPath, JSON.stringify(subIssueNumbers));
"
```

The `while read` loop's own exit code can't surface a failed per-parent `gh api` call — the loop
itself always exits 0 — so each iteration appends its own parent number to
`{tmp-sub-issue-failures}` on failure, and the assembly step reads that file
**before** touching either output file. A non-empty failures file throws, naming every failed
parent, before either `{tmp-sub-issues}` or the session snapshot is written — this
branch feeds both, and an undercounted set would otherwise cache silently for the whole TTL.

The error ladder, end to end: the batched alias resolves the common case in one call; a missing
alias or a truncated `hasNextPage` page joins `retry` rather than ever being read as "no
sub-issues"; a per-parent REST retry covers those; and a retry that also fails, or the batched
call itself failing outright (exit 3), fails loud rather than rendering a verdict on incomplete
data — partial pages are never used as if they were complete. Both the primary path and the
Fallback path converge on the same canonicalized `{tmp-sub-issues}` — numerically
sorted, deduplicated — which is what makes them interchangeable: the downstream consumer wraps
its contents in a `Set`, so canonical order is the equality bar between the two paths' output, not
just set-equivalence.

With `{tmp-sub-issues}` written by whichever branch applies, fetch the record
set itself — this block resolves its own `$LIMIT`/`FETCH_LIMIT` too, for the same reason:

Resolve the integration branch per `_shared/integration-branch.md`'s resolution ladder, substituting
its value for `{integration-branch}` below. Dump the full history once, in a form the operational
evidence path can scan for `(refs|closes|fixes) #N` references and revert trailers — `%x1f`/`%x1e`
are unit/record separator bytes, never appearing in real commit text, so a multi-line commit
message can never be mistaken for a SHA or split across records. `trust.js`'s own `parseGitLog`
turns that raw dump into the `[{ sha, message }]` shape `trustRows` expects; never hand-roll the
split, or two call sites can silently disagree about identical evidence:

The git-log dump follows the same session-scoped freshness rule as the record snapshot below
(`_shared/record-queue-fetch.md`'s Session-scoped record snapshot section) — reuse
`/tmp/ct-gitlog-{session-id}.txt` (`record-snapshot.js`'s `gitLogPath($CLAUDE_CODE_SESSION_ID)`)
when fresh, else regenerate it:

```bash
GITLOG=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').gitLogPath(process.env.CLAUDE_CODE_SESSION_ID) || '')")
if [ -n "$GITLOG" ] && node -e "
  const { isFresh } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js');
  process.exit(isFresh(process.argv[1], Number(process.argv[2])) ? 0 : 1)
" "$GITLOG" "$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values record-snapshot-ttl-seconds)"; then
  cp "$GITLOG" "{tmp-git-log}"
else
  git log "{integration-branch}" --format='%H%x1f%B%x1e' > "{tmp-git-log}"
  [ -n "$GITLOG" ] && cp "{tmp-git-log}" "$GITLOG"
fi
```

`comments` carries each record's own comment bodies — the negative-evidence marker path (#268)
reads `<!-- trust-negative-evidence: ... -->` back from here (`bin/lib/issues/retry.js`'s
`hasNegativeEvidenceMarker`, consumed by `trust.js`); the session-scoped record snapshot's union
field set already carries it. Read through the snapshot instead of a bare fetch:

```bash
LIMIT="{resolved-limit}"
export FETCH_LIMIT="$LIMIT"
{Session-scoped record snapshot's read-fresh-or-fetch block (_shared/record-queue-fetch.md),
 with {tmp-records-file} = {tmp-records}}
node -e "
  const fs = require('fs');
  const { trustRows, parseGitLog } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/trust.js');
  const issues = require('{tmp-records}');
  const subIssues = new Set(require('{tmp-sub-issues}'));
  if (issues.length >= Number(process.env.FETCH_LIMIT)) {
    console.error('WARNING: fetched ' + issues.length + ' records (at or beyond the configured backlog-fetch-limit) — history beyond this cap was dropped, so every cell below may be under-counted. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before reading any verdict.');
  }
  const records = issues.map((i) => ({ ...i, labels: i.labels.map((l) => l.name), hasParent: subIssues.has(i.number) }));
  const gitLog = parseGitLog(fs.readFileSync('{tmp-git-log}', 'utf8'));
  const policy = { 'trust-revert-window-days': process.argv[1] };
  console.log(JSON.stringify(trustRows(records, gitLog, Date.now(), policy)));
" -- "{resolved-window}"
```

Resolve `trust-revert-window-days` with
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values trust-revert-window-days` and
substitute its literal value for `{resolved-window}` above — the resolver applies the schema
default, so the substitution is never empty (`trustRows` tolerates one anyway). It reaches the script
as a `process.argv` arg after `--`, never spliced into the JS source — a value containing a quote
character would otherwise break out of the string literal, the same reason
`code-health/focus-mode.md`'s F1 block passes its own values that way.

Note the spread order: derived fields (`labels`, `hasParent`) come after the parsed spread, never
before (`[IL-01]`).

**Report every truncation warning emitted above verbatim above the table, and never suppress
any of them.** `gh issue list` returns newest-first, so the cap drops the **oldest** records, and
the dropped window is not a random sample of a cell's evidence. Where a class improved over time
its rejections sit precisely in that window, so truncation can strip a `changes-requested` while
keeping every approval — leaving a cell looking cleaner than it is, the one direction this table
must never fail in. The same reasoning applies to the parent-issue fetches: a dropped `oldest`
parent silently un-suppresses its sub-issues back into `total`, the same failure direction.

## Render

One row per cell, in the module's own `key` sort order (already stable — do not re-sort, and
never cap or truncate the row count; see the row-count note below):

| Provenance | Risk | Total | Approved | Approved (Batch) | Changes Requested | Operational | Negative Evidence | Undispositioned | Coverage | Not Planned | Follow-ups | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| {provenance} | {band} | {total} | {approved} | {approvedBatch} | {changesRequested} | {operationalGood} | {negativeEvidence} | {undispositioned} | {coverage} | {notPlanned} | {followUps} | {verdict} |

Render `{coverage}` as a percentage with no decimals (`row.coverage`, e.g. `0.125` renders `13%`).

**Undispositioned is never omitted, hidden, or folded into another column.** It is the count of
closed records carrying no `demo:*` disposition at all — not a count of failures, a count of
unknowns. It is the measure of how blind the system currently is, and on a repo with no
acceptance-verdict discipline yet it is the largest number on the table.

**Operational is a second, independent evidence source** — a closed record with no `demo:*`
disposition still counts as known-good when it was merged and stayed unreverted for at least
`trust-revert-window-days` (applied by `bin/lib/issues/trust.js`; default in `_shared/policy-schema.md`). It folds into `Coverage`
the same way `Approved`/`Changes Requested` do (it sums into `dispositioned`). A record with
a `demo:*` verdict is never double-counted here — demo-descent evidence is tried first, and the
operational path only runs when it found nothing.

**Negative Evidence is what pins a verdict below `clean` regardless of positive count**
(`bin/lib/issues/trust.js`'s `negativeEvidence`, `_shared/autonomy-ceiling.md`'s Revocation
section). Two sources feed it, both scoped to the same `demo:*`-absent records the Operational
column reads: a dispatch Settle failure classified `correctness`/`ambiguous`
(`dispatch/settle-and-merge.md` Step 6.5's persisted marker), and a closing commit the Operational
path would have counted known-good but discovers was reverted. It folds into `Coverage` the same
way every other column does — a known-bad outcome is not an unknown one — so
`Total = Approved + Changes Requested + Operational + Negative Evidence + Undispositioned` always
holds, superseding the pre-#268 formula that summed only the first three into `dispositioned`. A
non-zero cell here reads `mixed` even when `Changes Requested` and `Follow-ups` are both `0` — the
same precedence a `changes-requested` disposition already had.

**Approved (Batch) is the subset of Approved that was sign-off via a `/claude-tweaks:demo`
`#N,#M` batch invocation rather than a dedicated single-record session** — a legitimate,
deliberately cheap path (`_shared/work-record.md`'s Acceptance provenance row), distinguished by
the `demo:approved-batch` label `bin/lib/issues/acceptance.js`'s `approvalProvenance` reads back.
Both invocation shapes run the same per-item walkthrough (`skills/demo/SKILL.md` Step 2) — the
marker distinguishes a rapid multi-item pass from a single-record session, not whether a
walkthrough happened. A pre-existing `demo:approved` with no marker reads as single-record-backed,
so this column is `0` for every cell graded before the signal existed. **A cell whose Approved
evidence is entirely Approved (Batch), with no Operational corroboration, cannot reach `clean`**
— it demotes to `mixed` the same way a non-zero Negative Evidence does (`trust.js`'s
`batchOnly`), because a batch sign-off, while legitimate, is a shallower verification signal than
this table otherwise grades autonomy on. `Approved (Batch)` equal to `Approved` with `Operational`
at `0` is the tell; read
them together the same way Coverage and Not Planned are read together below.

**Coverage is the fraction of a class's closed records that carry any verdict at all**
(`dispositioned / total`), and it is the figure that says whether a Verdict column can be
believed. A cell needs `trust.js`'s `MIN_VERDICTS` real dispositions before it grades at all, so
a graded cell is never resting on one lucky record — but a `clean` verdict at 12% coverage and
one at 90% are different claims, and only this column distinguishes them.

**Not Planned is counted and rendered, and is deliberately not a verdict input.** A record closed
`NOT_PLANNED` was declined before any work happened, so there is no work product for the class to
be judged on. It stays on the row because it says something real about a class's filing precision
— a class that files a lot of work nobody wants is worth seeing — but treating it as a quality
failure would be a category error, and with no time window in this table an unrecoverable one.

It does still count toward `total`, and therefore toward `MIN_SAMPLES`. That is the exact inverse
of its old effect: a declined record used to hard-block `clean`, and now it helps a cell reach the
size floor while contributing no evidence at all. `MIN_VERDICTS` is what stops that mattering —
the evidence floor is counted on dispositions alone, so a cell of 5 approvals and 35 declines
grades on those 5 — but it grades at 12% coverage, and the Coverage column is the only place a
reader sees that. Read the two columns together; a `clean` verdict sitting on low coverage and a
high Not Planned count is a class whose work is mostly being turned away, not one that is mostly
succeeding.

**Row count is bounded in practice, not by the taxonomy.** The `producer:*`, `human:*`, and
`unstructured:*` provenances are enumerable (`record.js`'s `ORIGINS`, plus two singletons) and the
risk band is binary, but `side-effect:{source}` is free text derived from a record's `Origin:`
body line, so the row count has no formal ceiling. What holds it down is `provenance.js`'s
normalization — clause truncation and trailing-`from #N` stripping collapse per-record detail into
one class per emitted context, and anything still overflowing its length cap funnels into the
single `unstructured:unstructured` cell. A repo whose skills emit a handful of `Origin:` contexts
therefore gets a handful of rows. Capping the render anyway is still the wrong trade: a repo that
did produce many rows is one whose classes are fragmenting, which is exactly what the operator
needs to see, and the cap would land on the Undispositioned counts this table exists to surface.

**Any `unstructured:*` row is structurally ungradable, not merely short of evidence.** Its Verdict
is pinned to `insufficient-evidence` at every sample count (`trust.js`'s `UNGRADABLE_KIND`) —
`unstructured` is `provenance.js`'s classifier reporting that it could not reduce those records'
`Origin:` lines to a class at all (`unstructured:unstructured` for text past its length cap,
`unstructured:empty-origin` for text that normalized to nothing). A bucket whose only shared
property is that nobody knows what is in it has no coherent class to earn trust for. Say so when
rendering the row — a reader must not read its permanent `insufficient-evidence` as a cell that is
one more month of samples away from a verdict.

**All-insufficient collapse.** When every row's Verdict reads `insufficient-evidence`, do not
render the table — render one line instead: "No cell has enough dispositioned evidence yet — {N}
classes, {M} closed records, {approved} approved, {changesRequested} changes-requested." `{N}` is
the row count, `{M}` the sum of every row's `total`, and `{approved}`/`{changesRequested}` the
sums of those two columns across all rows. **Compute all four — none of them is a literal.** A
cell can read `insufficient-evidence` on either floor alone — `total` under `trust.js`'s
`MIN_SAMPLES` however good its dispositions look, or `dispositioned` under its `MIN_VERDICTS` —
so real approvals and rejections can already exist under this collapse; printing a hard-coded zero
would erase the first acceptance evidence the repo ever produces, which is the single thing
`autonomy: supervised` exists to let the operator watch.

Append the sentence "Every closed record's acceptance disposition is still unknown." only when
`{approved}` and `{changesRequested}` are both `0`. When any collapsed row is an `unstructured:*`
one, also append "{K} of those classes are unclassifiable and will never reach a verdict," where
`{K}` is the count of collapsed rows whose `kind` is `unstructured`. A pinned row cannot lift the
collapse by itself, so it would otherwise stay invisible for as long as every other cell is small,
which is exactly while it is accumulating.

Render the full table as soon as at least one row's Verdict is `clean` or `mixed`.

## Known limitation: no time window

Every count on this table is all-time. `changesRequested` and `followUps` are permanent, so a
class that earns one rejection is `mixed` from then on, with no path back however well it
performs afterward. That is the right failure direction for now — it is conservative, and on this
repo both counts are currently zero everywhere, so nothing is pinned yet. It stops being right as
soon as a class accumulates its first rejection and then improves.

The fix is a trailing evaluation window (grade on records closed in the last N days, keep the
all-time counts for display), which also subsumes the reason `notPlanned` had to leave the verdict
above. **Revisit when any cell first reads `mixed`** — that is the point at which the limitation
becomes observable rather than theoretical.
