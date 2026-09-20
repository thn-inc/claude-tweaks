# Backlog — Attention Mode

Read-only, like `overview` mode — no writes, no grants. Unifies discovery of every open record
carrying any `needs:*` label, `solution:unjustified`, `ready` + `shaped:headless` with no
`auto:build` grant, or `bot:blocked` into one ranked list with a per-row, type-differentiated
recommended action, plus two non-record rows — a merge-lane circuit-breaker banner and a
tidy-residue row, rendered above the ranked table independently of it. This is the "what does the
backlog need from me today"
surface — distinct from `/claude-tweaks:help`'s Triage Queue (awaiting authorization, flagged or
not) and Acceptance Queue (awaiting sign-off), which cover different concerns.

## Step 1: Fetch

The `needs:*` family and `bot:blocked` are read from the session-scoped record snapshot
(`_shared/record-queue-fetch.md`'s Session-scoped record snapshot section) rather than a
dedicated `gh issue list --label` call: resolve `snapshotPath($CLAUDE_CODE_SESSION_ID)` and reuse
it when fresh, falling through to one plain `gh issue list --state open --json {UNION_FIELDS}
--limit 200` refresh when stale or absent, adapted from that contract's plain-fetch fallback. The resulting
open-record set is then filtered to two sets: records whose labels include any name starting with
`needs:`, and records whose labels include `bot:blocked` — a record can land in both.

Two `gh issue list` calls remain direct label-based fetches (`needs:*` and `bot:blocked` now come
from the session-scoped snapshot above, not from a `--label` call). `--label` ANDs multiple values
passed to the same flag, which cuts both ways here, so the two shapes below are deliberate and
must not be normalized into each other:

- The `solution:unjustified` fetch is its own **single-label** call precisely because of that AND
  — merging it into the `ready`+`shaped:headless` call below would AND all three labels together,
  returning only records carrying all three (nearly always empty), not any of them on their own.
  Never merge it into that call.
- The `ready` + `shaped:headless` fetch passes **two labels to one call on purpose** — it wants
  exactly the AND: records carrying both. **Do not "fix" it by splitting it into separate
  `--label ready` / `--label shaped:headless` calls** — the rationale above is about
  `solution:unjustified` staying single-label, and splitting this one silently widens it to every
  `ready` record plus every `shaped:headless` record, which is not what this classification is.

Every temp file this mode writes below resolves through `bin/lib/session-tmp.js`'s `sessionTmpPath`, per `_shared/session-tmp-root.md`'s session-scoped temp-root convention (cited once here, not restated per script).

```bash
eval "$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  const os = require('os'); const path = require('path');
  const files = {
    ST_BACKLOG_ATTENTION_SNAPSHOT_RAW: 'backlog-attention-snapshot-raw.json',
    ST_BACKLOG_ATTENTION_SNAPSHOT_FILTERED: 'backlog-attention-snapshot-filtered.json',
    ST_BACKLOG_ATTENTION_SOLUTION_UNJUSTIFIED: 'backlog-attention-solution-unjustified.json',
    ST_BACKLOG_ATTENTION_SHAPED_HEADLESS: 'backlog-attention-shaped-headless.json',
  };
  for (const [varName, filename] of Object.entries(files)) {
    const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
    console.log(varName + '=' + JSON.stringify(p));
  }
")"
SNAPSHOT=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').snapshotPath(process.env.CLAUDE_CODE_SESSION_ID) || '')")
TTL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values record-snapshot-ttl-seconds)
if [ -n "$SNAPSHOT" ] && node -e "
  const { isFresh } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js');
  process.exit(isFresh(process.argv[1], Number(process.argv[2])) ? 0 : 1)
" "$SNAPSHOT" "$TTL"; then
  cp "$SNAPSHOT" "$ST_BACKLOG_ATTENTION_SNAPSHOT_RAW"
else
  FIELDS=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').UNION_FIELDS)")
  LIMIT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit)
  gh issue list --state open --json "$FIELDS" --limit "$LIMIT" > "$ST_BACKLOG_ATTENTION_SNAPSHOT_RAW"
fi
node -e "
  const records = require('$ST_BACKLOG_ATTENTION_SNAPSHOT_RAW').filter((r) => !r.state || r.state === 'OPEN');
  const needsRecords = records.filter((r) => r.labels.some((l) => l.name.startsWith('needs:')));
  const botBlockedRecords = records.filter((r) => r.labels.some((l) => l.name === 'bot:blocked'));
  console.log(JSON.stringify({ needsRecords, botBlockedRecords }));
" > "$ST_BACKLOG_ATTENTION_SNAPSHOT_FILTERED"
gh issue list --state open --label solution:unjustified --json number,title,createdAt,labels --limit 200 > "$ST_BACKLOG_ATTENTION_SOLUTION_UNJUSTIFIED"
gh issue list --state open --label ready --label shaped:headless --json number,title,createdAt,labels --limit 200 > "$ST_BACKLOG_ATTENTION_SHAPED_HEADLESS"
```

The `cp` branch reuses the shared session cache read-only — it is never written back here, since
this mode's own fallback fetch narrows to `--state open` only (the shared cache is `--state all`,
per `_shared/record-queue-fetch.md`), and writing that narrower result back would silently starve
a later consumer in the same session of closed-record data it expects the shared cache to carry.

If the snapshot-fallback fetch returns exactly the resolved `backlog-fetch-limit` results, or
either of the two direct `--label` fetches below returns exactly `200`, state that in the
rendered output — the same "may be more, here's the count" convention `/claude-tweaks:help`'s own
fetches use — rather than silently treating it as complete. The `shaped-headless` fetch additionally needs `auto:build`
excluded, done in Step 2's merge script (below) rather than via a `gh` query flag — `gh issue
list --label` only ANDs, it has no exclusion flag, matching this file's own established idiom of
doing set logic in the `node -e` merge step rather than the `gh` query.

## Step 2: Merge and dedupe

Merge by issue number. A record's number appearing in more than one of these sets is not assumed
impossible — no automated path stamps every one of these markers together today, but a human can
always add any combination directly, so the merge must not assume the sets are disjoint. When a
number appears in more than one, render **one row** for it: `Type` joins the matched types with
` + ` (e.g. `needs:definition + solution:unjustified`, or `needs:decision + bot:blocked`), and
`Recommended action` concatenates each matched type's remedy in that same order,
semicolon-separated. A record can in principle carry every classification at once — e.g.
`needs:definition` + `needs:decision` + `solution:unjustified` + `shaped:headless (no grant)` +
`bot:blocked` — the same one-row-per-number, concatenated-action convention applies regardless of
how many match; `types` is always rendered in fetch order (the matched `needs:*` label name(s)
first, in the order they appear on the record's own `labels` array, then `solution:unjustified`,
then `shaped:headless (no grant)`, then `bot:blocked`) for a deterministic Type column.

A record whose types include `needs:decision` also needs the live proposal text for Step 4: read
its newest comment matching `<!-- needs-decision:` with no `**Resolved:**` line anywhere in its
body (`_shared/work-record.md`'s Decision-comment template and resolution rule), and capture that
comment's `**Proposed:** {text}` line verbatim. The snapshot-filtered `needsRecords` set already
carries each record's `comments` array (part of `_shared/record-queue-fetch.md`'s `UNION_FIELDS`,
present on both the cache-hit and the plain-fetch fallback path above) — read `Proposed:` from
there directly; only if a record object somehow lacks a `comments` array does the merge fall back
to a live `gh issue view {n} --json comments` call, mirroring `grant-lane-decision.md`'s own
comment-query shape.

```bash
eval "$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  const os = require('os'); const path = require('path');
  const files = {
    ST_BACKLOG_ATTENTION_SNAPSHOT_FILTERED: 'backlog-attention-snapshot-filtered.json',
    ST_BACKLOG_ATTENTION_SOLUTION_UNJUSTIFIED: 'backlog-attention-solution-unjustified.json',
    ST_BACKLOG_ATTENTION_SHAPED_HEADLESS: 'backlog-attention-shaped-headless.json',
    ST_BACKLOG_ATTENTION_MERGED: 'backlog-attention-merged.json',
  };
  for (const [varName, filename] of Object.entries(files)) {
    const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
    console.log(varName + '=' + JSON.stringify(p));
  }
")"
node -e "
  const { execFileSync } = require('child_process');
  const { needsRecords, botBlockedRecords } = require('$ST_BACKLOG_ATTENTION_SNAPSHOT_FILTERED');
  const solutionUnjustified = require('$ST_BACKLOG_ATTENTION_SOLUTION_UNJUSTIFIED');
  const shapedHeadless = require('$ST_BACKLOG_ATTENTION_SHAPED_HEADLESS')
    .filter((r) => !r.labels.some((l) => l.name === 'auto:build'));
  const byNumber = new Map();
  for (const r of needsRecords) {
    const needsTypes = r.labels.filter((l) => l.name.startsWith('needs:')).map((l) => l.name);
    byNumber.set(r.number, { ...r, types: [...needsTypes] });
  }
  for (const r of solutionUnjustified) {
    const existing = byNumber.get(r.number);
    if (existing) existing.types.push('solution:unjustified');
    else byNumber.set(r.number, { ...r, types: ['solution:unjustified'] });
  }
  for (const r of shapedHeadless) {
    const existing = byNumber.get(r.number);
    if (existing) existing.types.push('shaped:headless (no grant)');
    else byNumber.set(r.number, { ...r, types: ['shaped:headless (no grant)'] });
  }
  for (const r of botBlockedRecords) {
    const existing = byNumber.get(r.number);
    if (existing) existing.types.push('bot:blocked');
    else byNumber.set(r.number, { ...r, types: ['bot:blocked'] });
  }
  function getComments(r) {
    if (Array.isArray(r.comments)) return r.comments;
    try {
      const out = execFileSync('gh', ['issue', 'view', String(r.number), '--json', 'comments'], { encoding: 'utf8' });
      return JSON.parse(out).comments || [];
    } catch {
      return [];
    }
  }
  for (const r of byNumber.values()) {
    if (!r.types.includes('needs:decision')) continue;
    const live = getComments(r)
      .filter((c) => c.body && /^<!-- needs-decision: (\S+) -->/m.test(c.body) && !c.body.includes('**Resolved:**'))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .pop();
    const match = live && live.body.match(/\*\*Proposed:\*\*\s*(.+)/);
    r.proposed = match ? match[1].trim() : null;
  }
  console.log(JSON.stringify([...byNumber.values()]));
" > "$ST_BACKLOG_ATTENTION_MERGED"
```

## Step 3: Rank

Priority band first (`priority:high` > `priority:medium` > `priority:low`), then oldest
`createdAt` first within a band — the identical two-key ordering `/claude-tweaks:dispatch`'s own
`next` ranking uses (`dispatch/SKILL.md`'s Step 3), not a third scheme. A record with no priority
label sorts after every banded record, ordered among themselves by `createdAt` only.

```bash
eval "$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  const os = require('os'); const path = require('path');
  const files = {
    ST_BACKLOG_ATTENTION_MERGED: 'backlog-attention-merged.json',
    ST_BACKLOG_ATTENTION_RANKED: 'backlog-attention-ranked.json',
  };
  for (const [varName, filename] of Object.entries(files)) {
    const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
    console.log(varName + '=' + JSON.stringify(p));
  }
")"
node -e "
  const { parseRecordFacets } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const BAND_ORDER = { high: 0, medium: 1, low: 2 };
  const records = require('$ST_BACKLOG_ATTENTION_MERGED');
  const ranked = records
    .map((r) => ({ ...r, priority: parseRecordFacets(r.labels).priority }))
    .sort((a, b) => {
      const bandA = a.priority && BAND_ORDER[a.priority] !== undefined ? BAND_ORDER[a.priority] : 3;
      const bandB = b.priority && BAND_ORDER[b.priority] !== undefined ? BAND_ORDER[b.priority] : 3;
      if (bandA !== bandB) return bandA - bandB;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  console.log(JSON.stringify(ranked));
" > "$ST_BACKLOG_ATTENTION_RANKED"
```

## Step 3.5: Non-record rows

Two rows render above the ranked table, in this order, independently of whether the table itself
has any rows.

### Breaker banner

Best-effort read the global merge-lane circuit breaker, same snippet shape as
`merge-lane-reset.md`'s own read:

```bash
node -e "
  const { readBreakerState } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/merge-lane-breaker.js');
  console.log(JSON.stringify(readBreakerState(process.cwd())));
"
```

Render the banner only when the read succeeds, `tripped: true`, and the result is not the
degraded fail-closed shape (`transientReadFailure: true`) `readBreakerState` returns on a genuine
fetch failure — mirroring `merge-lane-reset.md`'s own "a read failure degrades to skip" posture: a
read failure or the degraded shape omits the banner entirely, never renders a false-positive
tripped state. When it renders:

```
⚠ Merge-lane circuit breaker tripped {trippedAt} by #{trippedBy.record}: {trippedBy.reason} — run /claude-tweaks:backlog refine --reset-breaker
```

### Tidy row

Glob `{$RUN_ROOT}/.claude-tweaks/pipelines/*-tidy-standalone*/staged/` and
`{$RUN_ROOT}/.claude-tweaks/pipelines/*-sweep-standalone*/staged/` together — a `*-sweep-standalone*`
run's staged items originate from tidy's own Step 1 component run inside sweep's shared run dir,
so they carry the same approvable shape as a standalone tidy run's — with `$RUN_ROOT` resolved
per `_shared/pipeline-run-dir.md`'s Anchoring section (`git rev-parse --git-common-dir`, normalized
— never a bare relative path, `[IL-127]`). Take the newest matching run directory across both
globs by its ISO-timestamp prefix. When that directory's `staged/` holds one or more files, render:

```
{count} tidy proposal(s) staged awaiting approval — run /claude-tweaks:tidy --approve
```

Omit the row entirely when no such directory exists, or its `staged/` is empty or absent.
**Accepted limitation:** only the single newest matching directory is ever surfaced (this row's
own newest-directory selection rule above, with no walk-back of its own) — if two tidy runs both
left non-empty `staged/` before either was approved, the older one stays invisible on this row
until the newer is resolved, so resolving it surfaces the next-newest on this row's next render
(archival removes the resolved run from the glob's candidate pool entirely). `tidy --approve`'s
own no-arg default (`tidy/approve-mode.md`) shares this row's glob-and-sort rule and picks the
same directory as this row whenever that directory's `staged/` is already non-empty, but
additionally walks back past an empty-`staged/` newest run to an older non-empty one — so when
the newest run's own `staged/` is already empty, `--approve` can find work this row is omitted
and showing nothing for.

## Step 4: Render

The two non-record rows from Step 3.5 render first, each on its own line, each independently
omitted when its own condition doesn't hold; the ranked table follows:

```markdown
⚠ Merge-lane circuit breaker tripped {trippedAt} by #{trippedBy.record}: {trippedBy.reason} — run /claude-tweaks:backlog refine --reset-breaker

{count} tidy proposal(s) staged awaiting approval — run /claude-tweaks:tidy --approve

## Backlog — Needs Attention

| Record | Type | Filed | Recommended action |
|--------|------|-------|---------------------|
| #{n} | needs:definition | {createdAt, relative} | run /claude-tweaks:specify #{n} to route through brainstorming |
| #{n} | needs:decision | {createdAt, relative} | run /claude-tweaks:backlog refine #{n} — proposed: "{Proposed line, verbatim}" |
| #{n} | solution:unjustified | {createdAt, relative} | run /claude-tweaks:challenge #{n} for the evidence-or-accept-risk verdict on the flag |
| #{n} | shaped:headless (no grant) | {createdAt, relative} | run /claude-tweaks:backlog refine to grant via the sweep's Grant lane (spec was headlessly shaped — no human has reviewed it) |
| #{n} | bot:blocked | {createdAt, relative} | run /claude-tweaks:backlog refine #{n} to re-authorize after the failure |
| #{n} | needs:definition + solution:unjustified | {createdAt, relative} | run /claude-tweaks:specify #{n} to route through brainstorming; run /claude-tweaks:challenge #{n} for the evidence-or-accept-risk verdict on the flag |

### Batch launchers

{command} ({k})
   #{N}  #{M} …
   {batch command covering every row above}
{command} ({k})
   #{N}  #{M} …
   {single command for #{N}}
   {single command for #{M}}

Pick up next: #{n} "{title}" — {oldest/highest-priority reason}.
```

`needs:definition` rows recommend `run /claude-tweaks:specify #{n} to route through
brainstorming`. `solution:unjustified` rows recommend `run /claude-tweaks:challenge #{n} for the
evidence-or-accept-risk verdict on the flag` — naming `/claude-tweaks:challenge` explicitly as the
mechanism that renders the actual accept-risk-or-add-evidence choice, since this mode itself
performs no grant and reads no evidence judgment on its own.

Every other `needs:*` value — starting with `needs:decision`, and including any `needs:*` marker
this file doesn't name individually — recommends `run /claude-tweaks:backlog refine #{n} to
resolve the {type} marker`, with one per-type clause added on top: a `needs:decision` row
replaces the generic clause with `run /claude-tweaks:backlog refine #{n} — proposed: "{Proposed
line, verbatim}"` (the record's captured `proposed` text from Step 2, quoted exactly);
`shaped:headless (no grant)` keeps its existing no-human-reviewed clause, `run
/claude-tweaks:backlog refine to grant via the sweep's Grant lane (spec was headlessly shaped —
no human has reviewed it)` — bare `refine`'s Grant lane (the sweep), rather than `refine #{n}`.
Since #1887, `refine #{n}` *would* also grant it — `#N` now filters `refine-mode.md`'s whole
sweep, Grant lane included, so a `#{n}`-filtered run reaches the same Grant-lane check restricted
to that one record — this row still recommends the bare form because it covers every ungranted
`shaped:headless` record in one batch-confirm rather than one command per record; `bot:blocked` says `run
/claude-tweaks:backlog refine #{n} to re-authorize after the failure`. This `refine #{n}` catch-all is the **permanent default** for any future `needs:*`
marker — a new marker earns a dedicated launcher only by a later record's own explicit decision,
never by default. The trailing "Pick up next" line names the single oldest/highest-priority
record across all types — the same shape `overview` mode's own "what to build next" recommendation
uses; it is derived from the ranked table only, never from the two non-record rows above it.

### Batch launchers

Between the table and the "Pick up next" line, group the ranked table's rows by the command
their Recommended-action column runs, and render one batch/ref-less/paste-block command per
group — the identical grouping rule `tidy/step-6-auto.md`'s "Yours grouping (by the command the
human runs)" section already defines for tidy's own report (group key derivation, fixed group
order, and the batch-vs-ref-less-vs-paste-block split, read there — not restated here). Two
facts specific to attention's row types, on top of that shared rule:

- **The Grant lane is ref-less.** `shaped:headless (no grant)` rows key on the *whole-queue*
  `/claude-tweaks:backlog refine` form (its Recommended-action text above), never `refine #{n}` —
  same reason the per-row text already states (bare `refine` covers every ungranted
  `shaped:headless` record in one batch-confirm; `refine #{n}` would now also grant a filtered
  record since #1887, but one command per record is strictly more clicks than the bare form for
  this row type). This renders as its own group, distinct from the batchable
  `backlog refine` group below even though both cite the same skill+mode: a ref-less command is
  identical for every row and closes with one line, `/claude-tweaks:backlog refine`; it is never
  folded into a batch line naming specific record numbers.
- **`needs:definition` and `solution:unjustified` are never batched.** `needs:definition` rows
  key on `/claude-tweaks:specify #{n}`, whose batch form rejects a `needs:definition` element by
  design (`specify/SKILL.md`'s batch branch) — this group always closes with a paste block, one
  `/claude-tweaks:specify #{n}` line per record, never a comma-joined batch line.
  `solution:unjustified` rows key on `/claude-tweaks:challenge #{n}`, single-ref only by its
  `argument-hint` — same paste-block treatment. Every other type (`needs:decision`, `bot:blocked`,
  and any other `needs:*` catch-all) keys on the targeted `/claude-tweaks:backlog refine` form,
  whose `argument-hint` accepts a comma list — that group closes with one batch line,
  `/claude-tweaks:backlog refine #{a},#{b},…`, naming every matched record.

A row carrying more than one type (Step 2's merge) contributes one line to *each* matching
group — a `needs:definition + solution:unjustified` row's number appears in both the `specify`
paste block and the `challenge` paste block, never elided into one. Omit the whole block when the
ranked table is empty (see below); a group with zero rows this render never appears.

When the merged list is empty, render `Nothing needs attention — no open record carries a
needs:* marker, solution:unjustified, an ungranted shaped:headless spec, or bot:blocked.` instead
of an empty table, and omit both the Batch launchers block and the "Pick up next" line. The
breaker banner and tidy row still render independently above this message when their own
conditions hold — an empty table is not an empty mode output.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| A single `gh issue list --label solution:unjustified --label ready --label shaped:headless` call | `--label` ANDs multiple values within one call — this returns only records carrying all three, nearly always empty |
| Granting, closing, or shaping anything from this mode | Read-only, like `overview` — the recommended actions are for the human to run, never executed here |
| Inventing a third ranking scheme | Reuse `/claude-tweaks:dispatch`'s existing priority-band-then-age ordering |
| A separate row per matched type for a record carrying two or more of the classifications | Dedupe by issue number and render one row with a concatenated Type/Recommended action, however many types matched |
| Rendering the breaker banner from a failed/degraded read | `merge-lane-reset.md`'s fail-open posture — omit, never a false-positive tripped state |
