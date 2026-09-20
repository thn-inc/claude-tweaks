# GitHub PR Scan — Acceptance & Parent-Gate Scopes

Split from `_shared/github-pr-scan.md` (#204) — that file's own header, Detection Ladder,
Staleness Thresholds, and Output Contract still govern every scope below; this file holds only
the three acceptance-related scope bodies extracted to keep `github-pr-scan.md` under the 40 KB
per-invocation ceiling. A dispatcher inlining any scope below must inline `github-pr-scan.md`'s
Output Contract section alongside it — that section was not duplicated here, since duplicating a
canonical contract two files deep is worse than one extra `Read` at dispatch time. Consumed by
`/claude-tweaks:help` (Stage 4.7, **`acceptance-queue`** scope) and `/claude-tweaks:tidy` (Step
4.8, **`acceptance-gap`** and **`parent-gate`** scopes) — same inlining discipline as the parent
file: subagents cannot read this file directly, the dispatcher inlines the relevant scope section
whole into the scan agent's prompt.

Every `gh issue list`/`gh pr list` call below carries an explicit `--limit` — see
`github-pr-scan.md`'s own opening note for why.

## Scope: `acceptance-queue` (consumed by /help Stage 4.7)

One cheap list for the dashboard's Acceptance Queue section — deliberately `--state all`, unlike
every other count in this file, since `demo:pending` persists independent of open/closed state
(an `auto:merge`'d record's issue can already be closed while still awaiting sign-off). `/demo`
no longer sweeps this backlog itself (it resolves only the items you name — a bare ref or an
explicit `#N,#M` list, never a scan), so this is the sole place the outstanding set is enumerated.

```bash
gh issue list --label demo:pending --state all --json number,title --limit 200
```

Render as one line listing every matching record: `Awaiting sign-off: **{N} records** — #{n1}
({title1}), #{n2} ({title2}), ... — run /demo #{n1},#{n2},... to review them all` (a single ref
when `{N}` is 1: `run /demo #{n1}`) — omit entirely when the count is 0.

## Scope: `acceptance-gap` (consumed by /tidy Step 4.8)

Finds closed records that carry no acceptance label at all — the case `acceptance-queue` above
cannot see, since that scope only lists records already flagged `demo:pending`. A record closed
without ever receiving a `demo:*` label is invisible to `acceptance-queue` and would otherwise
disappear from the backlog with no disposition on record. Classification is entirely
`needsBackstop`'s (`bin/lib/issues/acceptance.js`) — this scope does not reimplement the
label taxonomy; see that module or `_shared/work-record.md` for what the labels mean.

**This scope finds `work-backend: github-issues` records only**, for the same reason the
`parent-gate` scope below does: it reads GitHub labels, and the Detection Ladder above skips this
whole file whenever `gh` is unreachable — it checks remote/install/auth, never `work-backend`. The
`local-files` twin of this sweep is `tidy/step-1-records.md`'s Shape 8, reading the record store
through `queryRecords` and translating `facets.closed`/`facets.acceptance`/`facets.parent` into
the same `needsBackstop` call. It emits the identical `[acceptance-gap]` row at the identical
severity and recommends the identical `/claude-tweaks:demo` invocation, so no consumer
distinguishes the two.

Record set: closed records from the last 30 days, computed as `Date.now() - 30 days` in the
`node` step below — cross-platform, no shell `date` variant needed.

Resolve session-scoped paths first (`_shared/session-tmp-root.md`, cited throughout this file rather than restated), then resolve `backlog-fetch-limit` and substitute it into the fetch below (per this file's "Fetch limit" section):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" RAW=tidy-closed-records-raw.json CLOSED=tidy-closed-records.json)"
LIMIT="{resolved-limit}"
gh issue list --state closed --limit "$LIMIT" \
  --json number,title,state,labels,closedAt \
  > "$RAW"
node -e "
  const fs = require('fs');
  const raw = require('$RAW');
  const LIMIT = $LIMIT;
  if (raw.length === LIMIT) {
    console.error('WARNING: the closed-record fetch returned exactly ' + LIMIT + ' records (the configured backlog-fetch-limit) — closed records older than the newest ' + LIMIT + ' are invisible to this scope, even within the 30-day window. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before treating this scope as complete.');
  }
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync('$CLOSED', JSON.stringify(raw.filter((r) => r.closedAt > cutoff)));
"
```

A closed record whose acceptance lives on a `/claude-tweaks:specify` decomposition parent must
not count as a gap — `needsBackstop`'s `hasParent` field exists precisely to suppress it. Resolving
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

A 30-day window does not bound the closed-record fetch the way it might seem to: a busy repo can
close far more than any reasonable hardcoded cap within 30 days (971 closed issues in 30 days was
observed on this repo alone), so a fixed limit silently drops the **oldest** closed records first —
exactly the quiet-failure a backstop scope must never have. The parent fetches share the same
exposure for a different reason — they are `--state all` over the repo's entire history, and
`gh issue list` returns newest-first, so a fixed cap drops the **oldest** parents first. Those are
precisely the parents whose sub-issues have already closed, so truncation silently re-floods this
scope with exactly the rows the filter exists to remove.

**`work-links: body-text`** — every parent's task list comes back in the same fetch:

Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PFG_NEW=tidy-parents-for-gap-new.json PFG_LEG=tidy-parents-for-gap-legacy.json GAP_SUBS=tidy-acceptance-gap-sub-issues.json)"
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
  if (fetched.some((f) => f.length === LIMIT)) {
    console.error('WARNING: a parent fetch returned exactly ' + LIMIT + ' records (the configured backlog-fetch-limit) — older parents were dropped, so their sub-issues re-enter this scope as false acceptance-gap rows. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before acting on any row below.');
  }
  const subIssueNumbers = parents.flatMap((p) => parseSubIssues(p.body));
  fs.writeFileSync('$GAP_SUBS', JSON.stringify(subIssueNumbers));
"
```

**`work-links: native`** — one `sub_issues` call per parent, same endpoint as `parent-gate`'s
native branch:

Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PFG_NEW=tidy-parents-for-gap-new.json PFG_LEG=tidy-parents-for-gap-legacy.json PFG=tidy-parents-for-gap.json)"
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
  if (fetched.some((f) => f.length === Number(process.env.FETCH_LIMIT))) {
    console.error('WARNING: a parent fetch returned exactly ' + process.env.FETCH_LIMIT + ' records (the configured backlog-fetch-limit) — older parents were dropped, so their sub-issues re-enter this scope as false acceptance-gap rows. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before acting on any row below.');
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
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PFG=tidy-parents-for-gap.json GAP_BATCH=tidy-gap-sub-issues-batch.json)"
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
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" GAP_BATCH=tidy-gap-sub-issues-batch.json GAP_SUBS=tidy-acceptance-gap-sub-issues.json)"
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
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PFG=tidy-parents-for-gap.json GAP_NUMS=tidy-acceptance-gap-sub-issue-numbers.jsonl GAP_FAIL=tidy-acceptance-gap-fallback-failures.txt GAP_SUBS=tidy-acceptance-gap-sub-issues.json)"
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
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CLOSED=tidy-closed-records.json GAP_SUBS=tidy-acceptance-gap-sub-issues.json)"
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
    .filter(r => needsBackstop({ state: 'CLOSED', labels: r.labels, hasParent: r.hasParent }));
  gaps.forEach(r => console.log('[acceptance-gap] #' + r.number + ': ' + r.title + ' — closed with no acceptance disposition — recommend /claude-tweaks:demo #' + r.number));
" "$RISK_FLOOR" "$SIZE_FLOOR"
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
(`tidy/scan-procedures.md` Step 4.8) under one 15-row, highest-severity-first cap, so any tier
above `info` would permanently evict every actionable `repo-wide` finding beneath it. `info` is
also where its behavioural sibling already sits — "Open PR awaiting review", the other
no-mutation, always-surfaced row (`tidy/step-6-auto.md`).

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
plus every issue's current state, fetched once.

### Fetch limit

**Every fetch below is bounded by `{resolved-limit}`, never a hardcoded cap.** Resolve
`backlog-fetch-limit` with
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit`
(`_shared/work-record-config.md`'s key table; the resolver applies the schema default when the
key is absent) and substitute the literal number into **every**
block below that names it. Substitute it independently per
block and never carry it across blocks in a shell variable — shell environment does not survive
between Bash calls and never reaches a subagent, so a cross-block `export` silently resolves
empty (the same discipline `_shared/trust-table.md` states for its own identical fetches). The
state map in particular is `--state all` over the repo's entire lifetime with no recency bound,
which is why it cannot carry a fixed cap: past that cap every truncated sub-issue defaults to
`OPEN`, so every parent containing one reads `incomplete` and this backstop stops firing —
permanently, and with nothing on the output to say it did.

Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PI_NEW=tidy-parent-issues-new.json PI_LEG=tidy-parent-issues-legacy.json ALL_STATES=tidy-all-issue-states.json PARENTS=tidy-parent-issues.json)"
LIMIT="{resolved-limit}"
export FETCH_LIMIT="$LIMIT"
gh issue list --label parent-issue --state open --json number,title,body,labels --limit "$LIMIT" \
  > "$PI_NEW"
# Legacy-label fetch — PERMANENT cross-project support for adopter repos that haven't migrated;
# removable only at a major version dropping pre-rename repo support. [IL-85]
gh issue list --label family:parent --state open --json number,title,body,labels --limit "$LIMIT" \
  > "$PI_LEG"

gh issue list --state all --json number,state,labels --limit "$LIMIT" \
  > "$ALL_STATES"

node -e "
  const fs = require('fs');
  const LIMIT = Number(process.env.FETCH_LIMIT);
  const fetched = ['$PI_NEW', '$PI_LEG'].map(require);
  // Number-keyed dedup across the two label fetches — identical rows, either fetch may win.
  const parents = [...new Map(fetched.flat().map((p) => [p.number, p])).values()];
  fs.writeFileSync('$PARENTS', JSON.stringify(parents));
  const states = require('$ALL_STATES');
  if (fetched.some((f) => f.length === LIMIT)) {
    console.error('WARNING: a parent fetch returned exactly ' + LIMIT + ' records (the configured backlog-fetch-limit) — older parents were dropped and are invisible to this scope entirely. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before treating this scope as complete.');
  }
  if (states.length === LIMIT) {
    console.error('WARNING: fetched exactly ' + states.length + ' issue states (the configured backlog-fetch-limit) — every sub-issue beyond this cap defaults to OPEN, so any parent containing one reads incomplete and this backstop silently never fires for it. Raise backlog-fetch-limit in .claude-tweaks/policy.yml and re-run before treating this scope as complete.');
  }
"
```

The state map's `labels` field (added alongside `number`/`state`) is what lets the oversight-floor
pre-filter below read each sub-issue's `risk:*` label from data already fetched here — no second
`gh` round-trip per parent or per sub-issue.

**Report every warning emitted above verbatim beside this scope's rows, and never suppress
either of them.** Both truncations fail in the *quiet* direction — fewer rows, not wrong ones —
which is exactly the direction a backstop must never fail in silently, since a scope that emits
nothing is indistinguishable from a repo with no un-gated parents.

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
parent whose last sub-issue closed outside `/claude-tweaks:wrap-up`.

### Sub-issue enumeration

For each parent, enumerate its sub-issues from the **parent** side — never the sub-issue side, which
works under one `work-links` mode and silently returns nothing under the other.
Sub-issue **state** is read from the state map just fetched above in both branches below, never from
a sub-issue's own `state` field wherever one happens to already be present in a response — GitHub's
REST responses (the `sub_issues` endpoint included) report lowercase `open`/`closed`, while
`parentGateState` and the state map both use the `gh issue list --json state` uppercase
`OPEN`/`CLOSED` form; reading from one source only avoids a silent casing mismatch. A sub-issue
number absent from the state map (the fetch above truncated before reaching it — the warning
above fires when that is possible) defaults to `OPEN`, the fail-safe direction — an unresolved
sub-issue must never let a parent read as `due` (mirrors `parentGateState`'s own "never reports
`due` for a parent with no discoverable sub-issues" rule).

**`work-links: body-text`** — every parent's task list is already in hand from the first fetch
above; no further `gh` calls. Resolve session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PARENTS=tidy-parent-issues.json ALL_STATES=tidy-all-issue-states.json GATES=tidy-parent-gates.json)"
node -e "
  const { parseSubIssues } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const fs = require('fs');
  const parents = require('$PARENTS');
  const infoOf = new Map(require('$ALL_STATES').map(i => [i.number, { state: i.state, labels: (i.labels || []).map(l => l.name) }]));
  const gates = parents.map(p => ({
    number: p.number,
    title: p.title,
    parentLabels: p.labels.map(l => l.name),
    subIssues: parseSubIssues(p.body).map(n => {
      const info = infoOf.get(n);
      return { number: n, state: (info && info.state) || 'OPEN', labels: (info && info.labels) || [] };
    }),
  }));
  fs.writeFileSync('$GATES', JSON.stringify(gates));
"
```

**`work-links: native`** — the parent body carries no task list, so sub-issue numbers come from the
sub-issues API instead, via the same batched aliased-GraphQL probe with a per-parent REST fallback
that the `acceptance-gap` scope above uses:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PARENTS=tidy-parent-issues.json PG_BATCH=tidy-parentgate-sub-issues-batch.json)"
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
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PG_BATCH=tidy-parentgate-sub-issues-batch.json PARENTS=tidy-parent-issues.json ALL_STATES=tidy-all-issue-states.json GATES=tidy-parent-gates.json)"
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
    subIssues: (byParent[p.number] || []).map(n => {
      const info = infoOf.get(n);
      return { number: n, state: (info && info.state) || 'OPEN', labels: (info && info.labels) || [] };
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
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PARENTS=tidy-parent-issues.json ALL_STATES=tidy-all-issue-states.json SUB_ISSUES=tidy-sub-issues.jsonl PG_FAIL=tidy-parentgate-fallback-failures.txt GATES=tidy-parent-gates.json)"
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
      subIssues: subIssueNumbers.map(n => {
        const info = infoOf.get(n);
        return { number: n, state: (info && info.state) || 'OPEN', labels: (info && info.labels) || [] };
      }),
    };
  });
  fs.writeFileSync('$GATES', JSON.stringify(gates));
"
```

Both the primary path and the Fallback path converge on the same session-scoped
`tidy-parent-gates.json` shape — `{number, title, parentLabels, subIssues:[{number,state,labels}]}`
per parent.

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
applies, filter to parents that both exceed the floor and whose gate is due. A parent's aggregate
risk is the **max** risk tier across its `subIssues` — never a size read at the parent level, and
never omitted or defaulted to the resolved `size-floor` value, which would silently fail every
sub-issue's missing `size` facet closed and gate every parent regardless of risk. Any single
unscored sub-issue (`risk:*` missing or out-of-vocabulary) makes the whole parent's aggregate
unscored too, matching `exceedsOversightFloor`'s own fail-closed rule for a missing facet. Resolve
session-scoped paths first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" GATES=tidy-parent-gates.json)"
RISK_FLOOR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values risk-floor)
node -e "
  const { parentGateState } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/acceptance.js');
  const { exceedsOversightFloor } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/oversight-floor.js');
  const { parseRecordFacets, TIERS } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const gates = require('$GATES'); // [{number, title, subIssues, parentLabels}]
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
  gates
    .filter(f => exceedsOversightFloor({ risk: maxRiskTier(f.subIssues) }, { riskFloor, sizeFloor: null }).exceeds)
    .filter(f => parentGateState({ subIssues: f.subIssues, parentLabels: f.parentLabels }) === 'due')
    .forEach(f => console.log('[parent-gate] #' + f.number + ': ' + f.title + ' — parent complete, no acceptance disposition — Open parent gate, then /claude-tweaks:demo #' + f.number));
" "$RISK_FLOOR"
```

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
scope and the `Open parent gate` action it feeds never write `demo:approved` or
`demo:changes-requested` under any circumstance — that disposition stays exclusively
`/claude-tweaks:demo`'s job, staged and human-only, which is why the recommendation always still
ends with "then `/claude-tweaks:demo #{n}`" even once the gate is open.

Emit `[parent-gate]` rows per the Output Contract, at severity `info` — the same severity
`acceptance-gap` uses and for the same reason: `/claude-tweaks:tidy` runs this scope in the same
agent as `repo-wide` and `acceptance-gap` under one 15-row, highest-severity-first cap
(`tidy/scan-procedures.md` Step 4.8), and this can be a standing backlog on a repo with several
open decompositions, not a one-off defect count.
