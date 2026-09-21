# Record Queue Fetch — Shared Procedure

Single source of truth for the first read every open-work-record scan performs: resolve
`work-backend`, fetch the queue, and facet-parse it. Consumed by `/claude-tweaks:help`
(`status-scan.md` Stage 1), `/claude-tweaks:tidy` (`tidy/step-1-records.md`, its Step 1),
`/claude-tweaks:backlog` (both `refine-mode.md`'s and `overview-mode.md`'s Step 1), and
`/claude-tweaks:visualize` (`visualize/record-graph.md` Step A) — every one of these scans
starts from the identical fetch below before branching into its own consumer-specific
classification (dashboard bucket counts for `/help`; the per-shape finding classification for `/tidy`;
priority/Related synthesis plus the grant worklist for `/backlog refine`, lens routing plus the
build recommendation for `/backlog overview`; stage-column bucketing plus six-axis encoding for
`/visualize record-graph`). `/claude-tweaks:backlog`'s `attention` mode (`attention-mode.md`'s
Step 1) is a narrower fifth consumer — it reads only the Session-scoped record snapshot section
below for its `needs:*`/`bot:blocked` fetch, never the full `work-backend: github-issues`/
`local-files` fetch sections the other four consumers run.
Subagents cannot read this file — the dispatcher inlines this section into the scan agent's
prompt, the same pattern already used for `_shared/github-pr-scan.md`.

## `work-backend` resolution

Read the `work-backend` field from the project's CLAUDE.md (`_shared/work-record.md`'s Config
keys table, written by `/claude-tweaks:init`). A missing flag is treated as `local-files`.

Every consumer reads `work-backend` directly, with no alias fallback.

## Session-scoped record snapshot

One continuous session pulling the whole issue set independently per skill invocation (`/backlog
overview` then `/capture` then `/specify`, each with no shared cache) burns one round-trip per
call for identical data. Under `work-backend: github-issues`, every fetch in this file — the base
`github-issues` fetch below, and every direct consumer that names this section instead of the
open-only contract (`/claude-tweaks:capture`'s born-ready check, `/claude-tweaks:specify` Step 1 +
its Idempotency map, `_shared/trust-table.md`'s Fetch section) — reads through one session-scoped
snapshot instead of shelling out on every call.

- **Path** — `bin/lib/issues/record-snapshot.js`'s `snapshotPath($CLAUDE_CODE_SESSION_ID)`:
  `/tmp/ct-records-{session-id}.json`. A subagent that cannot see `$CLAUDE_CODE_SESSION_ID` (the
  dispatcher inlines this file rather than letting a subagent read it directly — see the header
  note above) gets `null` back from `snapshotPath`/`gitLogPath` for an absent session id, which
  `isFresh` reads as never-fresh — the caller falls through to a plain fetch every time, the same
  as before this section existed. Nothing breaks; only the caching benefit is unavailable to a
  session-id-less caller.
- **Field set** — the union every consumer needs, so one fetch covers all of them:
  `number,title,labels,body,state,stateReason,createdAt,closedAt,comments,updatedAt,milestone`
  (`record-snapshot.js`'s `UNION_FIELDS` — the code twin of this line; cite the constant, never
  retype the field list).
- **Freshness** — the snapshot file's mtime younger than `record-snapshot-ttl-seconds` seconds
  (`policy.yml`, default 300 — `_shared/policy-schema.md`'s Additional levers table).
  `record-snapshot.js`'s `isFresh(path, ttlSeconds)` is the single check every consumer below
  runs; never hand-roll an `mtime` comparison inline.
- **Invalidation** — any `gh issue create`/`edit`/`close` (or its MCP equivalent) by a plugin
  skill deletes the snapshot via `record-snapshot.js`'s `invalidateSnapshot($CLAUDE_CODE_SESSION_ID)`
  immediately after the write succeeds, so the next consumer re-fetches instead of reading stale
  state — see `_shared/github-write-transport.md`'s note on the CRUD mapping table, the single
  point every create/edit/close call site in the plugin already routes through.

**Read-fresh-or-fetch, in every consumer below:**

```bash
SESSION_ID="${CLAUDE_CODE_SESSION_ID:-}"
TTL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values record-snapshot-ttl-seconds)
SNAPSHOT=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').snapshotPath(process.env.CLAUDE_CODE_SESSION_ID) || '')")
if [ -n "$SNAPSHOT" ] && node -e "
  const { isFresh } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js');
  process.exit(isFresh(process.argv[1], Number(process.argv[2])) ? 0 : 1)
" "$SNAPSHOT" "$TTL"; then
  cp "$SNAPSHOT" {tmp-records-file}
else
  LIMIT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit)
  export FETCH_LIMIT="$LIMIT"
  FIELDS=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').UNION_FIELDS)")
  gh issue list --state all --json "$FIELDS" --limit "$LIMIT" > {tmp-records-file}
  UNION_LEN=$(node -e "console.log(require('{tmp-records-file}').length)")
  if [ "$UNION_LEN" = "$LIMIT" ]; then
    echo "WARNING: the --state all snapshot hit backlog-fetch-limit ($LIMIT); open records were completed by a second open-only fetch — closed-record coverage is truncated at the $LIMIT newest" >&2
    gh issue list --state open --json "$FIELDS" --limit "$LIMIT" > {tmp-open-only-file}
    node -e "
      const { mergeOpenIntoUnion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js');
      const union = require('{tmp-records-file}');
      const open = require('{tmp-open-only-file}');
      require('fs').writeFileSync('{tmp-records-file}', JSON.stringify(mergeOpenIntoUnion(union, open)));
    "
  fi
  [ -n "$SNAPSHOT" ] && cp {tmp-records-file} "$SNAPSHOT"
fi
```

This block always fetches `--state all` (the union covers both open and closed consumers) and
always the full field set — there is no per-consumer `{EXTRA_FIELDS}` list to maintain anymore,
since the union already carries every field any consumer has ever needed. A consumer whose
existing contract wants only open records (the base `github-issues` fetch below, unchanged for
`/help`/`/tidy`/`/backlog`/`/visualize`) filters `state === 'OPEN'` out of `{tmp-records-file}` in
its own facet-parse pass rather than re-fetching narrower.

**Union-cap completion (#1919).** When the `--state all` union comes back at exactly `LIMIT` rows,
the cap may have silently dropped the oldest open records — closed records newer than them fill
every remaining slot, and the union's own open subset then undercounts the true open set with no
signal (the base fetch's own truncation check, below, only fires on the *open* count hitting the
limit, which can't happen in this shape while the open subset stays far under it). The block above
detects this by comparing the union's length against `LIMIT` and, when equal, performs one
additional `--state open` fetch, sized to the same `LIMIT`, and merges any open records missing
from the union (deduped by `number` via
`record-snapshot.js`'s `mergeOpenIntoUnion`, which keeps the union row's full field set on a
collision) directly into `{tmp-records-file}` before it's cached to `$SNAPSHOT`. The open-only
fetch itself is still subject to the same cap — a repo with more than `LIMIT` open records needs a
raised `backlog-fetch-limit` regardless of this completion step.

**Invariant for direct `{tmp-records-file}` consumers.** Once the completion above has run,
`{tmp-records-file}`'s row count is no longer bounded by `LIMIT` — it can be `LIMIT` plus however
many missing open records the merge added. A consumer that reads `{tmp-records-file}` directly
(rather than through the open-filtered `{tmp-faceted-file}` below) and runs its own truncation
check against `Number(process.env.FETCH_LIMIT)` must compare with `>=`, not `===`: an exact-equality
check silently stops firing on exactly the runs where the merge fired, which is exactly when
truncation still occurred (closed-record coverage capped at `LIMIT`).

## `work-backend: github-issues` fetch

The fetch script below resolves `backlog-fetch-limit` itself via the canonical read path (per
`_shared/work-record.md`'s Config keys table) — the resolver applies the schema default when the
key is absent. `{tmp-records-file}` below is populated by the Session-scoped record snapshot's
read-fresh-or-fetch block above (run it first, substituting this section's own `{tmp-records-file}`
path into that block) — this section then narrows the snapshot's `--state all` union down to the
open-only, base-field contract every existing citer already expects: `/help`, `/tidy`, `/backlog`'s
Step 1, and `/visualize` need no changes to their own files for this — the snapshot layer is fully
internal to this fetch.

```bash
LIMIT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit)
export FETCH_LIMIT="$LIMIT"
node -e "
  const { parseRecordFacets } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const issues = require('{tmp-records-file}').filter((i) => i.state === 'OPEN');
  if (issues.length === Number(process.env.FETCH_LIMIT)) {
    console.error('WARNING: fetched exactly ' + issues.length + ' open issues (the configured backlog-fetch-limit) — there may be more beyond this cap. Consider raising backlog-fetch-limit in .claude-tweaks/policy.yml, or running /claude-tweaks:tidy to reduce backlog volume.');
  }
  console.log(JSON.stringify(issues.map((i) => ({ ...i, facets: parseRecordFacets(i.labels) }))));
" > {tmp-faceted-file}
```

Note that `{tmp-records-file}` now holds the **unfiltered** `--state all` snapshot content (open
and closed together) — the `.filter((i) => i.state === 'OPEN')` above is what narrows it down to
this section's open-only contract on the way to `{tmp-faceted-file}`. A consumer that reads
`{tmp-records-file}` directly instead of going through `{tmp-faceted-file}` (none do today) would
need to apply the same filter itself.

`backlog-fetch-limit` replaces the previous hardcoded 200/500 per-consumer limits — `gh issue list --limit N` auto-paginates internally regardless of how large `N` is, so raising the default doesn't change the fetch mechanism, only how much it's willing to pull before stopping. A consumer whose own population is naturally small (e.g. a `--label ready` filtered fetch) still uses this same limit and the same truncation check — the limit bounds "how many rows before we assume there might be more," not a per-consumer tuning knob.

`{EXTRA_FIELDS}` is retired — the session-scoped snapshot fetches the full union field set
(`body` included) on every pull, so `/claude-tweaks:help`'s Conflict detection, `/claude-tweaks:backlog`'s
priority/Related synthesis and `rankNextToBuild` dependency parsing, and `/claude-tweaks:visualize`'s
`Blocked by #N` parsing all already have `body` on `{tmp-faceted-file}` with no extra field to
request. `/claude-tweaks:tidy` needs no extra field for this fetch either — it pulls unsynced
local-fallback records via a separate, already-documented `queryRecords('specs', { unsynced: true })`
call in its own Step 1.

`parseRecordFacets` silently ignores any label it doesn't recognize (`bin/lib/issues/record.js`)
— a consumer that also needs the raw `labels` array (not just the parsed `facets`) keeps both,
since the spread above (`...i`) preserves every original field alongside the derived `facets`.

## `work-backend: local-files` fetch

```bash
node -e "
  const { queryRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  console.log(JSON.stringify(queryRecords('specs', {})));
" > {tmp-faceted-file}
```

Every record returned already carries its parsed `.facets` — no separate parse pass needed.
Both drivers land in the same faceted-record shape (`{ ..., facets }`) at `{tmp-faceted-file}`
— only the fetch varies per driver; a consumer's own classification logic runs identically
against either driver's output.

## Staleness clock (either driver)

`github-issues` uses the query's own `updatedAt`, straight from the fetch above. `local-files`
has no timestamp facet (`local-store.js`'s schema carries none), so use the record file's own
last-commit date instead:

```bash
git -C "{REPO_ROOT}" log -1 --format=%cI -- "{path}"
```

An empty result — an uncommitted/brand-new record — is treated as fresh, not stale.
`{REPO_ROOT}` resolves via `git rev-parse --show-toplevel` in the dispatcher before the agent
fires (see Working Directory Discipline in `_shared/subagent-dispatch-core.md`).

### Threshold resolution

Before computing staleness, read `record-staleness-weeks` from the project's CLAUDE.md (per
`_shared/work-record.md`'s Config keys table) and export it as `RECORD_STALENESS_WEEKS`; if
the key is absent, leave the variable unset so each consumer's own default (4) applies.
(This is a CLAUDE.md field read, not a `policy.yml` key — the policy resolver does not serve
it.) Each consumer's own classification script converts this to milliseconds
(`weeks * 7 * 24 * 60 * 60 * 1000`) and passes the result as `thresholdMs` to
`classifyStaleness(ageMs, thresholdMs)` (`bin/lib/issues/record-buckets.js`) — the conversion
is per-consumer inline code, not part of the shared module itself.

## See also

- `_shared/work-record.md` — the record taxonomy this fetch's `facets` are parsed against
- `_shared/github-pr-scan.md` — the analogous shared fragment for PR/issue-state scanning
  (Stage/Step 4.5-4.8), the precedent this file follows
- `bin/lib/issues/record-buckets.js` — the shared bucket predicates (`isBacklog`, `isParked`,
  `isBotBlocked`, `isBotInProgress`) and `classifyStaleness`, consumed by `/claude-tweaks:help`'s
  Stage 1 and `/claude-tweaks:tidy`'s Step 1 Shapes 1/2/5 (`/claude-tweaks:backlog` consumes this
  fetch too, but does its own classification without this module)
- `bin/lib/issues/record-snapshot.js` — the session-scoped snapshot's code twin (`UNION_FIELDS`,
  `snapshotPath`, `gitLogPath`, `isFresh`, `readSnapshot`, `writeSnapshot`, `invalidateSnapshot`)
- `_shared/github-write-transport.md` — the CRUD mapping table every issue create/edit/close call
  site routes through, and the snapshot-invalidation note attached to it
