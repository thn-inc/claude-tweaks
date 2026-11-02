# GitHub PR Scan — Acceptance & Parent-Gate Scopes

Split from `_shared/github-pr-scan.md` (#204) — that file's own header, Detection Ladder,
Staleness Thresholds, and Output Contract still govern every scope below; this file holds only
the three acceptance-related scope bodies, extracted when `github-pr-scan.md` neared the
since-retired 40 KB per-invocation ceiling (decision 0024 replaced it with the Read-limit rail). A dispatcher inlining any scope below must inline `github-pr-scan.md`'s
Output Contract section alongside it — that section was not duplicated here, since duplicating a
canonical contract two files deep is worse than one extra `Read` at dispatch time. Consumed by
`/claude-tweaks:help` (Stage 4.7, **`acceptance-queue`** scope) and `/claude-tweaks:tidy` (Step
4.8, **`acceptance-gap`** and **`parent-gate`** scopes) — same inlining discipline as the parent
file: subagents cannot read this file directly, the dispatcher inlines the relevant scope section
whole into the scan agent's prompt.

Every `gh issue list`/`gh pr list` call below carries an explicit `--limit`. The `acceptance-gap`
and `parent-gate` scopes size theirs from `backlog-fetch-limit` (see each scope's Fetch limit
section); the acceptance-queue fetch's fixed cap is a tracked follow-up.

## Scope: `acceptance-queue` (consumed by /help Stage 4.7)

One cheap list for the dashboard's Acceptance Queue section — deliberately `--state all`, unlike
every other count in this file, since a pending acceptance persists independent of open/closed state
(an `auto:merge`'d record's issue can already be closed while still awaiting sign-off). `/demo`
no longer sweeps this backlog itself (it resolves only the items you name — a bare ref or an
explicit `#N,#M` list, never a scan), so this is the sole place the outstanding set is enumerated.

```bash
gh issue list --search "label:demo:pending,accept:pending" --state all --json number,title --limit 200
```

The comma is an OR across the two pending spellings (`_shared/work-record.md`, Acceptance axis).
A record carrying a pending label is listed regardless of any resolution label it also carries;
this scope enumerates pending labels and does not apply the precedence rule. The query is a search,
so a record labelled seconds before the run can be missing while the search index lags — unwarned,
and picked up by the next run.

Render as one line listing every matching record: `Awaiting sign-off: **{N} records** — #{n1}
({title1}), #{n2} ({title2}), ... — run /demo #{n1},#{n2},... to review them all` (a single ref
when `{N}` is 1: `run /demo #{n1}`) — omit entirely when the count is 0.

## Scope: `acceptance-gap` (consumed by /tidy Step 4.8)

Finds closed records that carry no acceptance label at all — the case `acceptance-queue` above
cannot see, since that scope only lists records already flagged pending. A record closed
without ever receiving an acceptance label is invisible to `acceptance-queue` and would otherwise
disappear from the backlog with no disposition on record. A record closed with GitHub's own
`stateReason` of `NOT_PLANNED` or `DUPLICATE` is excluded from this scope entirely — a not-planned
or duplicate closure has nothing to accept, so it is never a gap. Classification is entirely
`needsBackstop`'s (`bin/lib/issues/acceptance.js`) — this scope does not reimplement the
label taxonomy; see that module or `_shared/work-record.md` for what the labels mean.

**This scope finds `work-backend: github-issues` records only**, for the same reason the
`parent-gate` scope below does: it reads GitHub labels, and the Detection Ladder above skips this
whole file whenever `gh` is unreachable — it checks remote/install/auth, never `work-backend`. The
`local-files` twin of this sweep is `tidy/step-1-records.md`'s Shape 8, reading the record store
through `queryRecords` and translating `facets.closed`/`facets.acceptance`/`facets.parent`/`facets.isParentIssue`/`facets.notPlanned` into
the same `needsBackstop` call. It emits the identical `[acceptance-gap]` row at the identical
severity and recommends the identical `/claude-tweaks:demo` invocation, so no consumer
distinguishes the two.

Record set: closed records from the last 30 days. The fetch splits that window into two date slices — `closed:$SINCE..$MID` and `closed:>$MID` — and applies the disposition, not-planned and duplicate exclusions server-side through `--search` on each slice; the client-side `closedAt` cutoff, `needsBackstop` and the oversight floor still run on the merged set, unchanged. Negated
`-reason:` qualifiers are used rather than `reason:completed`, so a closed record with a null
`stateReason` stays in. The oversight floor stays client-side: it passes a record meeting either
the risk or the size axis and fails closed on unscored records, which negated `-label:` qualifiers
cannot express.

Resolve `{since-date}` first, as its own call, with `node -e "console.log(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))"` (cross-platform, no shell `date` variant needed), and substitute its `YYYY-MM-DD` output literally. The server date is one date wider than the 30-day client cutoff below, on purpose: the `closed:` qualifier's timezone is unprobed, so the extra day keeps the server set a superset. Resolve `{mid-date}` the same way, as its own call, with `node -e "console.log(new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))"`, and substitute its `YYYY-MM-DD` output literally: it is the split point between the two date slices below, 15 days back and so inside the window.

Resolve session-scoped paths first (`_shared/session-tmp-root.md`, cited throughout this file rather than restated), then resolve `backlog-fetch-limit` and substitute it into the fetch below (per this file's "Fetch limit" section):

```bash
RAW_OLD="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-closed-records-raw-old.json)"
RAW_NEW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-closed-records-raw-new.json)"
CLOSED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-closed-records.json)"
: > "$CLOSED"
LIMIT="{resolved-limit}"
SINCE="{since-date}"
MID="{mid-date}"
export SINCE MID
gh issue list --state closed --limit "$LIMIT" \
  --search "closed:$SINCE..$MID -reason:\"not planned\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending -label:accept:approved -label:accept:changes-requested -label:accept:pending" \
  --json number,title,state,labels,closedAt,stateReason \
  > "$RAW_OLD"
gh issue list --state closed --limit "$LIMIT" \
  --search "closed:>$MID -reason:\"not planned\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending -label:accept:approved -label:accept:changes-requested -label:accept:pending" \
  --json number,title,state,labels,closedAt,stateReason \
  > "$RAW_NEW"
node -e "
  const fs = require('fs');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(process.env.SINCE || '') || Number.isNaN(Date.parse(process.env.SINCE)) || new Date(process.env.SINCE).toISOString().slice(0, 10) !== process.env.SINCE || new Date(process.env.SINCE) > new Date(Date.now() - 30 * 864e5)) throw new Error('SINCE is not a YYYY-MM-DD date over 30 days back — the since-date placeholder was not substituted or was resolved wrong; an empty date returns zero rows, a later one drops records.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(process.env.MID || '') || Number.isNaN(Date.parse(process.env.MID)) || new Date(process.env.MID).toISOString().slice(0, 10) !== process.env.MID || process.env.MID <= process.env.SINCE || process.env.MID >= new Date().toISOString().slice(0, 10)) throw new Error('MID is not a YYYY-MM-DD date later than SINCE and earlier than today — the mid-date placeholder was not substituted or was resolved wrong; an empty or inverted slice silently drops its records.');
  const LIMIT = $LIMIT;
  const CAP = Math.min(LIMIT, 1000);
  const slices = [
    ['closed:' + process.env.SINCE + '..' + process.env.MID, require('$RAW_OLD')],
    ['closed:>' + process.env.MID, require('$RAW_NEW')],
  ];
  for (const [qualifier, rows] of slices) {
    if (rows.length >= CAP) {
      console.error('WARNING: the closed-record slice ' + qualifier + ' returned ' + rows.length + ' records, reaching its cap of ' + CAP + ' (the smaller of backlog-fetch-limit and the 1000-result search ceiling) — records past it are invisible to this scope. With a cap below 1000, raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run; at a cap of 1000, that slice alone reaches the search ceiling and the scope cannot be complete.');
    }
  }
  const byNumber = new Map(slices.flatMap(([, rows]) => rows).map((r) => [r.number, r]));
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync('$CLOSED', JSON.stringify([...byNumber.values()].filter((r) => r.closedAt > cutoff)));
"
```

When this block fails — the since-date or mid-date guard throws, or a failed `gh` call leaves `$RAW_OLD` or `$RAW_NEW` unreadable —
the scope stops: report no `[acceptance-gap]` rows at all and quote the error verbatim, as for an
exit-3 sub-issue fetch below. `$CLOSED` is emptied first, so a later block never reads a stale one.

A closed record whose acceptance lives on a `/claude-tweaks:specify` decomposition parent must
not count as a gap — `needsBackstop`'s `hasParent` field exists precisely to suppress it, and its
`isParent` field excludes every parent here (only `parent-gate`'s closed branch passes `parentExceedsFloor`) — its acceptance is the parent gate's: the below-floor close
(#4466) or `/claude-tweaks:demo` above it (a hand-closed one: `parent-gate` below). Resolving
which closed records are sub-issues reuses the same parent-side enumeration the `parent-gate` scope
below already documents in full — never the sub-issue side, which works under one `work-links` mode
and silently returns nothing under the other. This step only needs sub-issue *existence*, not
per-sub-issue state, so it skips that scope's state-map plumbing; and it fetches `--state all` rather
than `parent-gate`'s `--state open`, because a sub-issue whose parent was already gated and approved —
which closes the parent (`demo/SKILL.md`'s Approve step) — must still be suppressed here, and an
open-only fetch would miss it.

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
this scope's session-scoped `tidy-acceptance-gap-sub-issues.json` is empty, and every decomposed
sub-issue re-enters this scope as a false `[acceptance-gap]` row — the
exact flood `hasParent` exists to stop, with no error anywhere to say so.

### Fetch limit

This scope's own closed-record fetch above and both parent-fetch branches below bound their
fetches with `{resolved-limit}` rather than a hardcoded cap. Resolve `backlog-fetch-limit` with
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit`
(`_shared/work-record-config.md`'s key table; the resolver applies the schema default when the
key is absent) and substitute the literal number into **every**
block below that names it. Substitute it independently per
block and never carry it across blocks in a shell variable — shell environment does not survive
between Bash calls and never reaches a subagent, so a cross-block `export` silently resolves
empty (the same discipline `_shared/trust-table.md` states for its own identical fetches).

The closed-record fetch is bounded on the server by the window (one date wider than the 30-day cutoff) and the disposition filter,
which is why it no longer fills the cap with already-dispositioned records: a busy repo can close
far more than any reasonable hardcoded cap within 30 days (971 closed issues in 30 days was
observed on this repo alone), and a cap on that unfiltered stream silently dropped the **oldest**
closed records first — exactly the quiet-failure a backstop scope must never have. The closed-record
fetch is split into two date slices, `closed:$SINCE..$MID` and `closed:>$MID`, because one query is
capped at GitHub search's 1000 results and the undisposed set can exceed that: each slice is capped
at the smaller of the limit and 1000 and warns on its own when it reaches that cap (naming its date
range, row count and remedy), and the two slices merge number-keyed before the cutoff. The
closed-record fetch is a search too: a record closed or relabelled seconds before the run can be missing while the search index lags — unwarned, and picked up by the next run. The parent fetches share the same
exposure for a different reason — they are `--state all` over the repo's entire history, and
`gh issue list` returns newest-first, so a fixed cap drops the **oldest** parents first. Those are
precisely the parents whose sub-issues have already closed, so truncation silently re-floods this
scope with exactly the rows the filter exists to remove. A label-filtered
`gh issue list` is capped at 1000 by GitHub whatever `--limit` says (`--label risk:low --limit 1500` returned 1000 of
1513), so raising `backlog-fetch-limit` past 1000 does not widen these fetches.

**`work-links: body-text`** — every parent's task list comes back in the same fetch:

Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
PFG_NEW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parents-for-gap-new.json)"
PFG_LEG="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parents-for-gap-legacy.json)"
GAP_SUBS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-acceptance-gap-sub-issues.json)"
LIMIT="{resolved-limit}"
export FETCH_LIMIT="$LIMIT"
gh issue list --label parent-issue --state all --json number,body --limit "$LIMIT" \
  > "$PFG_NEW"
# Legacy-label fetch — PERMANENT cross-project support for adopter repos that haven't migrated;
# removable only at a major version dropping pre-rename repo support. [IL-85]
gh issue list --label family:parent --state all --json number,body --limit "$LIMIT" \
  > "$PFG_LEG"

node -e "
  const { parseSubIssues } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const fs = require('fs');
  const LIMIT = Number(process.env.FETCH_LIMIT);
  const fetched = ['$PFG_NEW', '$PFG_LEG'].map(require);
  // Number-keyed dedup across the two label fetches — identical rows, either fetch may win.
  const parents = [...new Map(fetched.flat().map((p) => [p.number, p])).values()];
  if (fetched.some((f) => f.length >= Math.min(LIMIT, 1000))) {
    console.error('WARNING: a parent fetch reached its cap of ' + Math.min(LIMIT, 1000) + ' records (the smaller of backlog-fetch-limit and the 1000-result ceiling) — older parents were dropped, so their sub-issues re-enter this scope as false acceptance-gap rows. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before acting on any row below (raising it past 1000 does not help).');
  }
  const subIssueNumbers = parents.flatMap((p) => parseSubIssues(p.body));
  fs.writeFileSync('$GAP_SUBS', JSON.stringify(subIssueNumbers));
"
```

**`work-links: native`** — one `sub_issues` call per parent, same endpoint as `parent-gate`'s
native branch:

Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
PFG_NEW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parents-for-gap-new.json)"
PFG_LEG="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parents-for-gap-legacy.json)"
PFG="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parents-for-gap.json)"
LIMIT="{resolved-limit}"
export FETCH_LIMIT="$LIMIT"
gh issue list --label parent-issue --state all --json number --limit "$LIMIT" \
  > "$PFG_NEW"
# Legacy-label fetch — PERMANENT cross-project support for adopter repos that haven't migrated;
# removable only at a major version dropping pre-rename repo support. [IL-85]
gh issue list --label family:parent --state all --json number --limit "$LIMIT" \
  > "$PFG_LEG"

node -e "
  const fs = require('fs');
  const fetched = ['$PFG_NEW', '$PFG_LEG'].map(require);
  // Number-keyed dedup across the two label fetches — identical rows, either fetch may win.
  const parents = [...new Map(fetched.flat().map((p) => [p.number, p])).values()];
  if (fetched.some((f) => f.length >= Math.min(Number(process.env.FETCH_LIMIT), 1000))) {
    console.error('WARNING: a parent fetch reached its cap of ' + Math.min(Number(process.env.FETCH_LIMIT), 1000) + ' records (the smaller of backlog-fetch-limit and the 1000-result ceiling) — older parents were dropped, so their sub-issues re-enter this scope as false acceptance-gap rows. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before acting on any row below (raising it past 1000 does not help).');
  }
  fs.writeFileSync('$PFG', JSON.stringify(parents));
"
```

Run the batched fetch — one CLI call resolving every parent's sub-issues at once
(`bin/fetch-sub-issues.js`, wrapping `native-dependencies.js`'s `fetchNativeSubIssues`), invoked via
command substitution rather than an `xargs` pipe so an empty parent list still invokes it validly
(its zero-positional contract prints an empty envelope rather than erroring) and the CLI's own exit
status survives instead of being replaced by the pipe's:

```bash
PFG="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parents-for-gap.json)"
GAP_BATCH="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-gap-sub-issues-batch.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/fetch-sub-issues.js" --resolve-retries $(node -e "require('$PFG').forEach(p => console.log(p.number))") > "$GAP_BATCH"
```

Branch on this command's exit code before doing anything else. **Exit 4** — the `subIssues`
GraphQL field is unavailable on this host — run the Fallback block below for **every** parent
instead of the canonicalization step that follows; it produces the same session-scoped
`tidy-acceptance-gap-sub-issues.json` by the older, verbatim REST path. **Exit 3** — the
GraphQL call itself failed (network/API error, or a missing-repository response) — the run fails
loud: report no `[acceptance-gap]` rows at all, naming the failed parents from the command's
stderr. **Exit 1 or 2** — a malformed invocation or a missing `gh`/unresolvable repo: an
environment or transcription bug, not a data outcome — stop and surface the CLI's stderr rather
than reading the (empty) batch file. **Exit 0** — continue to the canonicalization step below.

`--resolve-retries` already resolved every parent the probe could not fit in one page via its own
per-parent paginated REST call, merged back into `byParent` — a retry parent whose REST call
failed would have already made the CLI exit 3 above, naming the parent. The only work left is
canonicalization — flatten, dedupe, sort:

```bash
GAP_BATCH="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-gap-sub-issues-batch.json)"
GAP_SUBS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-acceptance-gap-sub-issues.json)"
node -e "
  const fs = require('fs');
  const batch = require('$GAP_BATCH');
  const all = Object.values(batch.byParent || {}).flat();
  const subIssueNumbers = Array.from(new Set(all)).sort((a, b) => a - b);
  fs.writeFileSync('$GAP_SUBS', JSON.stringify(subIssueNumbers));
"
```

This run's session-scoped `tidy-acceptance-gap-sub-issues.json` is only ever written here, once the
envelope is already fully resolved — there is no partial-write hazard left to guard against, since a
failed retry never reaches this line at all.

#### Fallback (probe unavailable — older GHE)

Runs only on exit 4 above, for every parent — the older, per-parent REST loop this branch used
before the batched probe existed. Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
PFG="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parents-for-gap.json)"
GAP_NUMS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-acceptance-gap-sub-issue-numbers.jsonl)"
GAP_FAIL="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-acceptance-gap-fallback-failures.txt)"
GAP_SUBS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-acceptance-gap-sub-issues.json)"
: > "$GAP_NUMS"
: > "$GAP_FAIL"
node -e "require('$PFG').forEach(p => console.log(p.number))" | while read -r N; do
  gh api --paginate "repos/{owner}/{repo}/issues/$N/sub_issues" --jq '.[].number' >> "$GAP_NUMS" || echo "$N" >> "$GAP_FAIL"
done

node -e "
  const fs = require('fs');
  const failures = fs.readFileSync('$GAP_FAIL', 'utf8').trim().split('\n').filter(Boolean);
  if (failures.length) {
    throw new Error('sub-issue REST fallback failed for parent(s): ' + failures.join(', ') + ' — refusing to write the acceptance-gap sub-issues file on an undercounted set');
  }
  const raw = fs.readFileSync('$GAP_NUMS', 'utf8').trim().split('\n').filter(Boolean).map(Number);
  const subIssueNumbers = Array.from(new Set(raw)).sort((a, b) => a - b);
  fs.writeFileSync('$GAP_SUBS', JSON.stringify(subIssueNumbers));
"
```

Both the primary path and the Fallback path converge on the same canonicalized session-scoped
`tidy-acceptance-gap-sub-issues.json` — numerically sorted, deduplicated — which is what makes
them interchangeable. The `while read` loop's own exit code can't surface a failed per-parent
`gh api` call, so each iteration appends its parent number to the failures file on failure, and the
assembly step throws — naming every failed parent — before the output file is written, never an
undercounted set (the same guard the trust-table Fallback carries).

### Oversight-floor pre-filter

Before filtering for gaps, resolve `risk-floor`/`size-floor` **once** for this scan invocation —
one `resolve-policy.js` call regardless of how many closed records were fetched above, never
resolved per candidate record. Resolved inside the same code block that consumes it below, not a
separate one: shell state does not survive between separate Bash calls, so a value read in an
earlier block is empty by the time a later block runs (the same discipline the Fetch-limit and
`work-links` resolutions above state for their own identical case).

With this run's session-scoped `tidy-acceptance-gap-sub-issues.json` written by whichever branch
applies, filter the closed-record set — note the filename: this scope's sub-issue list and the
`parent-gate` scope's `tidy-parent-gates.json` are different artifacts written by different
procedures in the same agent prompt, so they never share a path. A closed, undisposed record is
only reported when it both exceeds the oversight floor (`bin/lib/issues/oversight-floor.js`'s
`exceedsOversightFloor`, built by #366) and is a `needsBackstop` gap — a record that closed below
the floor never needed a disposition in the first place, so it is not a gap at all, not merely a
low-priority one. The closed-record fetch above already carries `labels`, so `parseRecordFacets`
reads `risk`/`size` straight off data already in hand — no second round-trip. Resolve session-scoped
paths first (`_shared/session-tmp-root.md`):

```bash
CLOSED="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-closed-records.json)"
GAP_SUBS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-acceptance-gap-sub-issues.json)"
{ read -r RISK_FLOOR; read -r SIZE_FLOOR; } < <(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values risk-floor size-floor)
node -e "
  const { needsBackstop } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/acceptance.js');
  const { exceedsOversightFloor } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/oversight-floor.js');
  const { parseRecordFacets } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const records = require('$CLOSED');
  const subIssues = new Set(require('$GAP_SUBS'));
  const [riskFloor, sizeFloor] = process.argv.slice(1);
  const gaps = records
    .map(r => ({ ...r, labels: r.labels.map(l => l.name), hasParent: subIssues.has(r.number) }))
    .filter(r => exceedsOversightFloor(parseRecordFacets(r.labels), { riskFloor, sizeFloor }).exceeds)
    .filter(r => needsBackstop({
      state: 'CLOSED',
      labels: r.labels,
      hasParent: r.hasParent,
      isParent: parseRecordFacets(r.labels).isParentIssue,
      stateReason: r.stateReason,
    }));
  gaps.forEach(r => console.log('[acceptance-gap] #' + r.number + ': ' + r.title + ' — closed with no acceptance disposition — recommend /claude-tweaks:demo #' + r.number));
" -- "$RISK_FLOOR" "$SIZE_FLOOR"
```

Note the spread order: derived fields come after the parsed spread, never before (`[IL-01]`). The
oversight-floor filter runs before `needsBackstop`, per the pre-filter's own ordering — a
below-floor record is skipped before ever reaching the disposition check, not after.

Un-dispositioned closed records are **staged, never auto-applied**, regardless of
`tidy-aggressiveness`. Applying a disposition is a judgment about whether shipped work actually
solved the problem — not a mechanical cleanup — and `_shared/auto-mode-contract.md` places that
kind of work-record judgment outside what `auto` silences. Do not fold this finding into any
auto-apply tier.

Emit `[acceptance-gap]` rows per the Output Contract, at severity `info` — not `medium`, and
not `low`. This is the one finding in this file whose row count is a standing backlog rather
than a defect count: on a repo that closes records ad hoc it returns a three-digit set on every
run, indefinitely. `/claude-tweaks:tidy` runs this scope in the same agent as `repo-wide`
(`tidy/scan-procedures.md` Step 4.8), and tidy reads a row's severity as recommendation urgency
(`tidy/scan-execution.md`'s column semantics), so any tier above `info` would rank a standing
backlog as more urgent than it is beside every actionable `repo-wide` finding. `info` is also where its behavioural sibling already sits — "Open PR awaiting review", the
other no-mutation, always-surfaced row (`tidy/step-6-auto.md`).

## Scope: `parent-gate` (consumed by /tidy Step 4.8)

Finds decomposition parents whose every sub-issue has closed but which carry no
acceptance disposition yet — the population `/claude-tweaks:wrap-up`'s own parent-gate
procedure (`wrap-up/verification-brief.md`) applies eagerly when it closes a parent's last sub-issue.
A sub-issue closed via `auto:merge`, by hand, or by a dispatch run that ended early never reaches
that eager path at all, so its parent's gate never fires on its own; this scope is the backstop
sweep that catches it later.

Classification is entirely `parentGateState`'s
(`bin/lib/issues/acceptance.js`) — this scope does not reimplement the gate logic, and sub-issue
enumeration reuses the same parent-side resolution `wrap-up/verification-brief.md`'s
parent-gate procedure already documents rather than inventing a second one.

**This scope finds `work-backend: github-issues` parents only** — because it queries the
`parent-issue` label, which exists on that driver alone. Nothing switches it off elsewhere: the
Detection Ladder above checks a reachable GitHub remote, an installed `gh`, and an authenticated
one — never `work-backend` — so a `local-files` project that has a GitHub remote (the normal
case, and why `repo-wide`'s PR scan runs there at all) passes the Ladder, runs this scope, and
simply gets zero rows back. Item 8 above states the same posture for its own counts.

What the Ladder does decide is the genuinely `gh`-absent case — no remote, `gh` not installed, or
not authenticated — where it skips this entire file, this scope included. That is what makes a
`gh`-gated file the wrong home for a sweep needing no `gh` at all, so the `local-files` twin of
this sweep lives in `tidy/step-1-records.md` (Shape 7), reading the record store through
`queryRecords`. It emits the identical `[parent-gate]` row and feeds the identical
`Open parent gate` action, so no consumer distinguishes the two.

Record set: open records carrying `parent-issue` (`/claude-tweaks:specify` labels every
decomposition parent this way — see `specify/record-creation.md`'s Parent record section),
plus those closed in the last 30 days, plus the state map, fetched once (every issue under `body-text`, every native sub-issue under `native`).

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
construction, so `parseSubIssues` returns `[]` for every parent, every parent reads
`incomplete` (`parentGateState` never reports `due` for a parent with no discoverable sub-issues),
and this backstop emits nothing at all — on a repo where it is the only thing that gates a
parent whose last sub-issue closed outside `/claude-tweaks:wrap-up`. Its value also selects the
state map's `{state-map-search}` below.

### Fetch limit

**Every fetch below is bounded by `{resolved-limit}`, never a hardcoded cap.** Resolve
`backlog-fetch-limit` with
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit`
(`_shared/work-record-config.md`'s key table; the resolver applies the schema default when the
key is absent) and substitute the literal number into **every**
block below that names it. Substitute it independently per
block and never carry it across blocks in a shell variable — shell environment does not survive
between Bash calls and never reaches a subagent, so a cross-block `export` silently resolves
empty (the same discipline `_shared/trust-table.md` states for its own identical fetches). Under
`body-text` the state map is `--state all` over the repo's entire lifetime with no recency bound,
which is why it cannot carry a fixed cap: past that cap every truncated sub-issue defaults to
`OPEN`, so every parent containing one reads `incomplete` and this backstop stops firing —
permanently, and with nothing on the output to say it did. Under `native` the map is searched,
so GitHub search's 1000-result ceiling also applies.

Substitute `{state-map-search}`: `has:parent-issue` under `native` (the native sub-issue
population; a just-linked one the search index lags on defaults to `OPEN`), the empty string under
`body-text` (task-list children are not native links, and an empty `--search` keeps `gh issue list`
off the search API, so no 1000 ceiling applies).

Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
PI_NEW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-issues-new.json)"
PI_LEG="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-issues-legacy.json)"
ALL_STATES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-all-issue-states.json)"
PC_NEW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-closed-parent-issues-new.json)"
PC_LEG="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-closed-parent-issues-legacy.json)"
PARENTS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-issues.json)"
: > "$PARENTS"
gh api user --jq .login > "$PARENTS.login"
LIMIT="{resolved-limit}"
export FETCH_LIMIT="$LIMIT"
STATE_SEARCH='{state-map-search}'
export STATE_SEARCH
gh issue list --label parent-issue --state open --json number,title,body,labels --limit "$LIMIT" \
  > "$PI_NEW"
# Legacy-label fetch — PERMANENT cross-project support for adopter repos that haven't migrated;
# removable only at a major version dropping pre-rename repo support. [IL-85]
gh issue list --label family:parent --state open --json number,title,body,labels --limit "$LIMIT" \
  > "$PI_LEG"
gh issue list --label parent-issue --state closed --search "closed:>=$(node -p "new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10)")" --json number,title,body,labels,state,stateReason,closedAt,comments --limit "$LIMIT" \
  > "$PC_NEW"
gh issue list --label family:parent --state closed --search "closed:>=$(node -p "new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10)")" --json number,title,body,labels,state,stateReason,closedAt,comments --limit "$LIMIT" \
  > "$PC_LEG"

gh issue list --state all --search "$STATE_SEARCH" --json number,state,labels --limit "$LIMIT" \
  > "$ALL_STATES"

node -e "
  const fs = require('fs');
  if (!['', 'has:parent-issue'].includes(process.env.STATE_SEARCH)) throw new Error('STATE_SEARCH is not a known value — the state-map-search placeholder was not substituted.');
  const LIMIT = Number(process.env.FETCH_LIMIT);
  const { isCloseMarkerComment } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/below-floor-parent-close.js');
  const fetched = ['$PI_NEW', '$PI_LEG', '$PC_NEW', '$PC_LEG'].map(require);
  const login = fs.readFileSync('$PARENTS.login', 'utf8').trim();
  if (!login) throw new Error('gh api user returned no login — a close marker posted by the current identity could not be recognised.');
  const parents = [...new Map(fetched.flat().filter((p) => p.state !== 'CLOSED' || Date.now() - Date.parse(p.closedAt) < 30 * 864e5).map((p) => [p.number, { ...p, comments: undefined, belowFloorClose: (p.comments || []).some((c) => isCloseMarkerComment(c, login)) }])).values()];
  fs.writeFileSync('$PARENTS', JSON.stringify(parents));
  const states = require('$ALL_STATES');
  if (fetched.some((f) => f.length >= Math.min(LIMIT, 1000))) {
    console.error('WARNING: a parent fetch reached its cap of ' + Math.min(LIMIT, 1000) + ' records (the smaller of backlog-fetch-limit and the 1000-result ceiling) — older parents were dropped and are invisible to this scope entirely. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before treating this scope as complete (raising it past 1000 does not help).');
  }
  const STATE_CAP = process.env.STATE_SEARCH ? Math.min(LIMIT, 1000) : LIMIT;
  if (states.length >= STATE_CAP) {
    console.error('WARNING: fetched ' + states.length + ' issue states, reaching the state-map cap of ' + STATE_CAP + ' — every sub-issue beyond it defaults to OPEN, so any parent containing one reads incomplete and this backstop silently never fires for it. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before treating this scope as complete (raising it past 1000 does not help a searched map).');
  }
  if (process.env.STATE_SEARCH && !states.length && parents.length) {
    console.error('WARNING: the searched state map is empty while ' + parents.length + ' parents exist — every sub-issue reads OPEN, so this backstop cannot fire. Check that work-links resolved native (task-list children are not native links) and re-run.');
  }
"
```

When this block fails — the state-map-search guard throws, the empty-login guard throws, or a failed
`gh` call leaves a fetch file unreadable — the scope stops: report no `[parent-gate]` rows at all and quote the error verbatim.
`$PARENTS` is emptied first; never read it or `$ALL_STATES` afterwards — a 0-row state map would
read every sub-issue as `OPEN`.

The state map's `labels` field (added alongside `number`/`state`) is what lets the oversight-floor
pre-filter below read each sub-issue's `risk:*` label from data already fetched here — no second
`gh` round-trip per parent or per sub-issue.

**Report every warning emitted above verbatim beside this scope's rows, and never suppress
either of them.** Both truncations fail in the *quiet* direction — fewer rows, not wrong ones —
which is exactly the direction a backstop must never fail in silently, since a scope that emits
nothing is indistinguishable from a repo with no un-gated parents.

### Sub-issue enumeration

For each parent, enumerate its sub-issues from the **parent** side — never the sub-issue side, which
works under one `work-links` mode and silently returns nothing under the other.
Sub-issue **state** is read from the state map just fetched above in both branches below, never from
a sub-issue's own `state` field wherever one happens to already be present in a response — GitHub's
REST responses (the `sub_issues` endpoint included) report lowercase `open`/`closed`, while
`parentGateState` and the state map both use the `gh issue list --json state` uppercase
`OPEN`/`CLOSED` form; reading from one source only avoids a silent casing mismatch. A sub-issue
number absent from the state map (the fetch above truncated before reaching it, warned above; or,
under `native`, the search index lagged a just-linked one, unwarned) defaults to `OPEN`, the
fail-safe direction — an unresolved sub-issue must never let a parent read as `due` (mirrors
`parentGateState`'s own "never reports `due` for a parent with no discoverable sub-issues" rule).

**`work-links: body-text`** — every parent's task list is already in hand from the first fetch
above; no further `gh` calls. Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
PARENTS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-issues.json)"
ALL_STATES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-all-issue-states.json)"
GATES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-gates.json)"
node -e "
  const { parseSubIssues } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const fs = require('fs');
  const parents = require('$PARENTS');
  const infoOf = new Map(require('$ALL_STATES').map(i => [i.number, { state: i.state, labels: (i.labels || []).map(l => l.name) }]));
  const gates = parents.map(p => ({
    number: p.number,
    title: p.title,
    parentLabels: p.labels.map(l => l.name),
    state: p.state || 'OPEN', stateReason: p.stateReason || null, belowFloorClose: p.belowFloorClose === true,
    subIssues: parseSubIssues(p.body).map(n => {
      const info = infoOf.get(n);
      return { number: n, state: (info && info.state) || 'OPEN', labels: (info && info.labels) || [], unread: !info };
    }),
  }));
  fs.writeFileSync('$GATES', JSON.stringify(gates));
"
```

**`work-links: native`** — the parent body carries no task list, so sub-issue numbers come from the
sub-issues API instead, via the same batched aliased-GraphQL probe with a per-parent REST fallback
that the `acceptance-gap` scope above uses:

```bash
PARENTS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-issues.json)"
PG_BATCH="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parentgate-sub-issues-batch.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/fetch-sub-issues.js" --resolve-retries $(node -e "require('$PARENTS').forEach(p => console.log(p.number))") > "$PG_BATCH"
```

Branch on this command's exit code before doing anything else. **Exit 4** — the `subIssues`
GraphQL field is unavailable on this host — run the Fallback block below for **every** parent
instead of the composing step that follows; it produces the same session-scoped
`tidy-parent-gates.json` by the older, verbatim REST path. **Exit 3** — the GraphQL call itself failed (network/API error, or
a missing-repository response) — the run fails loud: report no `[parent-gate]` rows at all, naming
the failed parents from the command's stderr. **Exit 1 or 2** — a malformed invocation or a
missing `gh`/unresolvable repo: an environment or transcription bug, not a data outcome — stop and
surface the CLI's stderr rather than reading the (empty) batch file. **Exit 0** — continue to the
composing step below.

`--resolve-retries` already resolved every parent the probe could not fit in one page via its own
per-parent paginated REST call, merged back into `byParent` — a retry parent whose REST call
failed would have already made the CLI exit 3 above, naming the parent. Unlike `acceptance-gap`'s
flattened union, this scope keeps each parent's own sub-issue set intact — the composing step
below reads the envelope's `byParent` directly, per-parent, because `subIssues` needs each
parent's own numbers, not existence alone:

```bash
PG_BATCH="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parentgate-sub-issues-batch.json)"
PARENTS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-issues.json)"
ALL_STATES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-all-issue-states.json)"
GATES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-gates.json)"
node -e "
  const fs = require('fs');
  const batch = require('$PG_BATCH');
  const byParent = batch.byParent || {};
  const parents = require('$PARENTS');
  const infoOf = new Map(require('$ALL_STATES').map(i => [i.number, { state: i.state, labels: (i.labels || []).map(l => l.name) }]));
  const gates = parents.map((p) => ({
    number: p.number,
    title: p.title,
    parentLabels: p.labels.map(l => l.name),
    state: p.state || 'OPEN', stateReason: p.stateReason || null, belowFloorClose: p.belowFloorClose === true,
    subIssues: (byParent[p.number] || []).map(n => {
      const info = infoOf.get(n);
      return { number: n, state: (info && info.state) || 'OPEN', labels: (info && info.labels) || [], unread: !info };
    }),
  }));
  fs.writeFileSync('$GATES', JSON.stringify(gates));
"
```

This run's session-scoped `tidy-parent-gates.json` is only ever written here, once the envelope is
already fully resolved — there is no partial-write hazard left to guard against, since a failed
retry never reaches this line at all.

#### Fallback (probe unavailable — older GHE)

Runs only on exit 4 above, for every parent — the older, per-parent REST loop this branch used
before the batched probe existed (exactly `wrap-up/verification-brief.md`'s own native command,
`gh api repos/{owner}/{repo}/issues/{n}/sub_issues --jq '.[].number'`, run once per parent in the
fetched set — each **page** appended as one JSON line rather than assembled by hand, so no
shell-side JSON construction is needed; the composing step merges pages per parent, and a failed
call appends its parent number to the failures file, which the composing step throws on — never a
silently vanished parent). Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
PARENTS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-issues.json)"
ALL_STATES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-all-issue-states.json)"
SUB_ISSUES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-sub-issues.jsonl)"
PG_FAIL="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parentgate-fallback-failures.txt)"
GATES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-gates.json)"
: > "$SUB_ISSUES"
: > "$PG_FAIL"
node -e "require('$PARENTS').forEach(p => console.log(p.number))" | while read -r N; do
  gh api --paginate "repos/{owner}/{repo}/issues/$N/sub_issues" --jq "{number: $N, subIssueNumbers: [.[].number]}" \
    >> "$SUB_ISSUES" || echo "$N" >> "$PG_FAIL"
done

node -e "
  const fs = require('fs');
  const failures = fs.readFileSync('$PG_FAIL', 'utf8').trim().split('\n').filter(Boolean);
  if (failures.length) {
    throw new Error('sub-issue REST fallback failed for parent(s): ' + failures.join(', ') + ' — refusing to write the parent-gates file with silently missing parents');
  }
  const parents = require('$PARENTS');
  const infoOf = new Map(require('$ALL_STATES').map(i => [i.number, { state: i.state, labels: (i.labels || []).map(l => l.name) }]));
  const byNumber = new Map(parents.map(p => [p.number, p]));
  const subRows = fs.readFileSync('$SUB_ISSUES', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const merged = new Map();
  for (const { number, subIssueNumbers } of subRows) {
    merged.set(number, (merged.get(number) || []).concat(subIssueNumbers));
  }
  const gates = Array.from(merged, ([number, subIssueNumbers]) => {
    const p = byNumber.get(number);
    return {
      number,
      title: p.title,
      parentLabels: p.labels.map(l => l.name),
      state: p.state || 'OPEN', stateReason: p.stateReason || null, belowFloorClose: p.belowFloorClose === true,
      subIssues: subIssueNumbers.map(n => {
        const info = infoOf.get(n);
        return { number: n, state: (info && info.state) || 'OPEN', labels: (info && info.labels) || [], unread: !info };
      }),
    };
  });
  fs.writeFileSync('$GATES', JSON.stringify(gates));
"
```

Both the primary path and the Fallback path converge on the same session-scoped
`tidy-parent-gates.json` shape — `{number, title, parentLabels, state, stateReason, belowFloorClose,
subIssues:[{number,state,labels,unread}]}` per parent.

### Oversight-floor pre-filter

Before filtering to due parents, resolve `risk-floor` **once** for this scan invocation — a single
`resolve-policy.js` call regardless of how many parents were fetched above, never resolved per
parent, inside the same code block that consumes it below (shell state does not survive between
separate Bash calls — the same discipline this scope's own Fetch-limit and `work-links`
resolutions state above). `sizeFloor` is never resolved at all: the parent-level check below always
passes the literal `null` for it, per `exceedsOversightFloor`'s contract (#366) — a parent carries
no `size:*` label of its own (`specify/record-creation.md`'s Parent record section), so evaluating
size at this level would mean gating on a fact that does not exist.

With this run's session-scoped `tidy-parent-gates.json` assembled by whichever branch above
applies, filter to parents whose gate is due; a due parent below the floor is surfaced, not filtered out. A parent's aggregate
risk is the **max** risk tier across its `subIssues` — never a size read at the parent level, and
never omitted or defaulted to the resolved `size-floor` value, which would silently fail every
sub-issue's missing `size` facet closed and gate every parent regardless of risk. Any single
unscored sub-issue (`risk:*` missing or out-of-vocabulary) makes the whole parent's aggregate
unscored too, matching `exceedsOversightFloor`'s own fail-closed rule for a missing facet. Resolve
session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
GATES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-parent-gates.json)"
RISK_FLOOR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values risk-floor)
node -e "
  const { parentGateState, closedParentGap } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/acceptance.js');
  const { exceedsOversightFloor } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/oversight-floor.js');
  const { parseRecordFacets, TIERS } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const gates = require('$GATES');
  const [riskFloor] = process.argv.slice(1);
  function maxRiskTier(subIssues) {
    let hasUnscored = false;
    let maxIndex = -1;
    for (const subIssue of subIssues) {
      const { risk } = parseRecordFacets(subIssue.labels);
      const index = TIERS.indexOf(risk);
      if (index === -1) { hasUnscored = true; continue; }
      if (index > maxIndex) maxIndex = index;
    }
    return hasUnscored ? undefined : TIERS[maxIndex];
  }
  const bad = {};
  gates.forEach((f) => {
    if (f.state === 'CLOSED') {
      const v = closedParentGap({ ...f, subIssues: f.subIssues.map((s) => ({ risk: parseRecordFacets(s.labels).risk, unread: s.unread })), riskFloor });
      if (v === 'gap') console.log('[acceptance-gap] #' + f.number + ': ' + f.title + ' — closed with no acceptance disposition — recommend /claude-tweaks:demo #' + f.number);
      else if (v !== 'none') bad[v] = (bad[v] || 0) + 1;
      return;
    }
    if (parentGateState({ subIssues: f.subIssues, parentLabels: f.parentLabels }) !== 'due') return;
    console.log('[parent-gate] #' + f.number + ': ' + f.title + (exceedsOversightFloor({ risk: maxRiskTier(f.subIssues) }, { riskFloor, sizeFloor: null }).exceeds
      ? ' — parent complete, no acceptance disposition — Open parent gate, then /claude-tweaks:demo #' + f.number
      : ' — parent complete below the oversight floor, still open — Open parent gate (closes it; no brief owed)'));
  });
  for (const v in bad) console.error('WARNING: ' + bad[v] + ' closed parent(s) print no [acceptance-gap] row (' + v + ') — risk unreadable; check work-links and backlog-fetch-limit, then re-run.');
" -- "$RISK_FLOOR"
```

A `CLOSED` gate's row is `closedParentGap`'s verdict: a `gap` prints `acceptance-gap`'s row, severity and
routing (`/claude-tweaks:demo #{n}`), mutating nothing. Report its two `WARNING:` lines verbatim beside the rows; never suppress them.

Un-gated parents recommend the `Open parent gate` action (`tidy/SKILL.md`'s Action Vocabulary,
executed for this scope's rows via `tidy/actions-github-issues.md`'s `## Open parent gate`) — never applied without
going through `/tidy`'s own Step 6 batch approval first, at **every** aggressiveness tier in auto
mode (`step-6-auto.md`'s Open parent gate row is `Stage`/`Stage`/`Stage`), the same as
`acceptance-gap` — though for a related but distinct reason. `Open parent gate` posts a comment
and adds a label: an outward-facing GitHub API write. `_shared/auto-mode-contract.md`'s
reversibility floor requires `high` — "undoable via file edit or `git revert`" — before anything
may auto-resolve, and its never-reversible list separately forbids "network calls beyond reads
(no API writes, no message sends)" at every tier regardless of mode. Neither bar is clearable by
this write, however mechanical or precondition-only it is; `/claude-tweaks:wrap-up` applying the
identical write with zero staging is not a counter-example, since that write is an unconditional
step of a pipeline a human already launched against one named record and sits in no tier table at
all, unlike this action. Separately, and independent of the write-level reasoning above, this
scope and the `Open parent gate` action it feeds never write an approved or changes-requested
Acceptance label (`_shared/work-record.md`) under any circumstance — that disposition stays exclusively
`/claude-tweaks:demo`'s job, staged and human-only, which is why an above-floor recommendation still
ends with "then `/claude-tweaks:demo #{n}`" even once the gate is open. Approving a below-floor row
closes the parent through `wrap-up/verification-brief-parent-gate.md`'s **Close the parent below the
floor**, with no `/claude-tweaks:demo` step.

Emit `[parent-gate]` rows per the Output Contract, at severity `info` — the same severity
`acceptance-gap` uses and for the same reason: `/claude-tweaks:tidy` runs this scope in the same
agent as `repo-wide` and `acceptance-gap` in one highest-severity-first table
(`tidy/scan-procedures.md` Step 4.8), and this can be a standing backlog on a repo with several
open decompositions, not a one-off defect count.
