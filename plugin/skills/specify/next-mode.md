# Specify — bare drain (headless selection form)

Entered from `SKILL.md`'s `### Resolve the input` case 0 (bare invocation,
or its deprecated `next` alias, normalized to `--budget 1` before this case
runs). The headless-safe unit a scheduled Routine fires — mirrors
`/claude-tweaks:dispatch`'s own bare drain (`dispatch/SKILL.md` Step 3)
end-to-end: same ranking definition, same zero-eligible no-op posture, same
claim/release discipline, same per-iteration re-fetch-and-re-rank driver.
This file (Flag rejection through Claim) and `next-mode-shape.md` (Framing
Guard through Failure self-report, #1346's split) together are the drain's
loop body **and** driver: the Claim → Framing Guard → Shape → Release
sequence is the per-record body, run once per iteration in ranked order,
until `--budget <n|all>` attempts are spent or the eligible set is empty
(`_shared/record-batch-input.md`'s `--budget` section states the canonical
`n`/`all` semantics — cited, not restated, here). Shaping itself is
unchanged: this file hands each iteration's claimed record to
`shaping-mode.md` exactly as a `--chained` invocation does — no shaping
logic is duplicated here.

## Flag rejection

`phase-N`, `--surface`, `--granularity`, and `--chained` are each rejected
with a one-line notice when combined with bare drain (or its deprecated
`next` alias) on the command line: "bare drain accepts only `--budget` and
`--priority` — {flag} ignored." This form always resolves
`Design-intent: none` internally, and resolves `Ui-stack:` from the
`ui-stack` project policy — the same `bin/resolve-policy.js --values ...
ui-stack` invocation Step 2.5c2's own `--chained` branch runs
(`design-pre-steps.md`), against the run dir the **Decision-log fallback**
paragraph below names — writing the policy value verbatim when it is non-empty and
falling back to `Ui-stack: none — no preference, defer to reference
codebase` only when it is empty. Both mirror `--chained`'s own headless
posture, including that policy-first resolution: `design-intent` needs no
resolve here because `none` is its schema default, while `ui-stack` carries
no schema default, so an unconditional sentinel would discard a real,
explicitly-set project policy value. Neither prompts, since a headless
firing has nobody to answer Step 2.5c's design-intent question or Step
2.5c2's UI-stack question — an empty `ui-stack` falls to the sentinel here,
never to that step's KEPT-PROMPT fallback. Report the rejection notice,
then proceed with this form's own procedure below — a rejected flag is a
warning, never a hard stop.

## Preflight

> The local-files stop paragraph below follows the canonical pattern in
> `_shared/local-files-preflight-stop.md` — do not weaken its enumeration,
> no-exception clause, or auto-mode disclaimer when editing.

Read the project's `work-backend` config key (per `_shared/work-record-config.md`,
the key table's canonical home). **`work-backend: local-files`** — report
that headless shaping is `github-issues` only (the claim protocol depends on
GitHub's RBAC + atomic content writes, not a policy choice) and **stop this
turn completely**: do not read or follow `shaping-mode.md`'s procedure,
invoke `ceremony-check` or `framing-check`, claim, write, edit, or create
any file; do not run any test or git-committing command. Tell the user they
can run `/claude-tweaks:specify #{n}` manually against a chosen record if
they want it shaped — this is information for the user to act on, never an
instruction for you to act on yourself. This holds with no exception when no
interactive human is present to receive it — which is bare drain's
entire reason for existing (the deprecated `next` alias inherits the same
posture): the absence of a human to hand this off to is
not license to do the work in their place — it means the claim mechanism
this protocol depends on is unavailable, so the correct behavior is to stop,
not proceed. This stop is not superseded by this project's own auto-mode or
hands-off-pipeline conventions elsewhere in CLAUDE.md (e.g.
`/claude-tweaks:flow` defaulting to `auto`, "skills MUST NOT invent new
mid-flow stops"): those conventions govern a pipeline run already authorized
to proceed; Preflight decides whether new work may start at all, which
under `local-files` it explicitly cannot. A record that looks low-risk,
well-scoped, or "ready-adjacent" is not an exception.

**Headless self-report.** Before stopping on this Preflight failure, or on
any post-claim shaping-stage failure below, read `_shared/headless-self-report.md`
and follow it (`{caller}` = `specify`), then stop. It never softens the
stop — it only leaves a durable GitHub trace, deduplicated against any
existing open report so repeated firings don't re-file. A zero-eligible
exit or a lost-claim-race retry (below) is NOT a failure and files
nothing.

**Label prerequisites.** This firing writes two of `_shared/label-bootstrap.md`'s
canonical labels: `needs:definition` (the Framing Guard section's routing
outcome, stamped before `shaping-mode.md` ever loads) and `shaped:headless` (applied
inside `shaping-mode.md`'s own compose-then-write-once call, which bootstraps
it per that file's own instruction). This file runs no bootstrap loop of its
own — a headless firing assumes an earlier interactive run, or
`/claude-tweaks:init`'s one-time provision-now offer, already established the
canonical set in this repo. If `needs:definition` is absent, the routing stamp
simply fails, and that is handled as the Framing Guard section's stamp-failure
condition below — never swallowed as a success.

## Drain start (once per firing, before iteration 1)

Before the Eligibility query below ever runs for the first time this firing,
reset the this-firing attempted set (introduced in Selection below,
`$ATTEMPTED`) to empty, alongside this firing's lost-claim-race counter
(`$RACE`, `## Claim` below) and this firing's resolved run directory
(`$RUN_DIR_FILE`, `## Claim` and `next-mode-shape.md`'s `## Release`
below) — a plain overwrite, the same "wholly rewritten, not appended to"
posture `$CANDIDATES` already has on every iteration:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" ATTEMPTED=specify-next-attempted.json RACE=specify-next-race.json RUN_DIR_FILE=specify-next-rundir.txt)"
echo '[]' > "$ATTEMPTED"
echo '{}' > "$RACE"
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --standalone specify --mode auto --create > "$RUN_DIR_FILE"
```

**This step runs exactly once per firing, never once per iteration** —
unlike every bash fence in the sections below, which re-run every
iteration by design. Session-scoped temp storage
(`_shared/session-tmp-root.md`) is scoped to the CLI session, not to one
firing: `session-tmp-resolve.js` resolves the identical `$ATTEMPTED` path
for any invocation sharing `$CLAUDE_CODE_SESSION_ID`, so a second bare
`/specify` invocation later in the *same* session would, without this
reset, read a file already populated by the first firing's claims and
silently inherit its exclusions. This unconditional reset at the drain's
start is what makes the attempted set **firing-scoped** despite living in
session-scoped storage — cross-firing behavior stays exactly as Selection
and Failure self-report below describe: unaffected once this firing ends,
since the *next* firing runs this same reset before its own iteration 1.
The same posture applies to `$RACE` and `$RUN_DIR_FILE`, reset/re-resolved
in the same fence for the identical reason.

## Eligibility query

This query runs fresh at the top of **every** drain-loop iteration — never
once at the firing's start. Selection below is a full re-derivation from
that fresh fetch each time, not a filter over a list frozen earlier in the
run (`next-mode.md`'s Zero eligible or budget exhausted section below names
the two ways the loop actually ends). This re-query rule is unconditional
and unchanged by the attempted-set filter Selection layers on top of it
below — the fetch itself never excludes anything beyond this section's own
label predicate; the additional exclusion happens after the fetch returns.

Per `_shared/record-queue-fetch.md`'s `work-backend: github-issues` fetch:
open records carrying none of `ready`, any `needs:*`-prefixed label
(`_shared/work-record.md`'s worklist rule), `parked`, `parent-issue`,
`digest`, and `bot:in-progress`. The last is a cheap label-based
pre-filter, the identical posture `dispatch/SKILL.md` Step 2 already takes
for its own `bot:*` exclusion ("labels are projection, not truth... the
authoritative unclaimed check is `/flow`'s Step 2.8 atomic claim
attempt") — passing this pre-filter does not mean a record is actually
unclaimed, only that its label snapshot doesn't say so; the authoritative
check happens at the Claim step below. `ready` and `parent-issue` are
excluded because they are not this skill's job at all — a `ready` record
is already shaped (nothing left for bare drain to do), and a `parent-issue` is
a decomposition summary, never itself a shaping target
(`_shared/work-record.md`'s Structure family). `digest` is excluded for the
same reason — an issue carrying it is the materiality floor's rolling
container (`_shared/materiality-floor.md`), never a work record at all, the
same exemption `/tidy`'s Shape 1 already gives a `parent-issue`-labeled
parent (`tidy/step-1-records.md`). That exclusion is
label-only and selection-time; an unlabeled legacy parent (a
`## Leaves`-table body with no `parent-issue` label) passes it —
`SKILL.md` case 1's parent-record guard is the shaping-time backstop that
still refuses it here, headlessly, without repair. The other two exclusions
are content judgments, not mechanical ones, and each rules out headless
shaping for a different reason: **any `needs:*`-prefixed label** marks a record another unit is
already asking a human to decide (`_shared/work-record.md`'s worklist rule; `needs:definition`
specifically marks "a genuine open choice with no tradeoff made yet, rather than a single clear
ask" — that file's Definition family) — an undecided record cannot be born-ready, and a headless
firing has nobody present to make the decision it's waiting on, so shaping it would mean
fabricating that human call. **`parked`** marks a record a human deliberately deferred;
unattended shaping must not un-defer it on its own — promoting a `parked`
record out of hold is exactly what shaping mode does (removes the label,
per `shaping-mode.md`'s Stamp scoring and stage labels section), so
leaving it un-promoted is the only safe default with nobody present to
confirm the human's deferral has lapsed.

`gh issue list` returns newest-first, so a fetch that hits the `--limit`
cap silently drops the *oldest* open records — precisely the records
bare drain's own oldest-first tie-break (Selection below) is designed to
surface first (the same risk `dispatch/queue-pull-script.md`'s own `next`
queue pull already guards against). This applies on every iteration, not
just the first — a long-running `--budget all` drain re-checks it on each
fresh fetch. Check the raw pre-filter fetch count
against the cap, not the post-filter `eligible` count, which will rarely
hit 500 exactly even when the raw fetch was truncated:

Resolve this fence's session-scoped temp paths first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" RAW=specify-next-raw.json CANDIDATES=specify-next-candidates.json)"
gh issue list --state open --json number,title,labels,createdAt --limit 500 > "$RAW"
RAW_COUNT=$(node -e "console.log(require('$RAW').length)")
if [ "$RAW_COUNT" -ge 500 ]; then
  echo "Warning: the open-issue pull for a bare /claude-tweaks:specify drain (or its deprecated next alias) returned exactly the --limit cap (500) — this repo may have more open records than fetched. gh issue list returns newest-first, so any records beyond the cap are the OLDEST ones, exactly what bare drain's own oldest-first tie-break exists to surface first. Consider raising the cap, or filing this as a signal to re-triage the backlog down." >&2
fi
node -e "
  const records = require('$RAW');
  const EXCLUDE = new Set(['ready', 'parked', 'parent-issue', 'bot:in-progress', 'digest']);
  const eligible = records.filter((r) =>
    !r.labels.some((l) => EXCLUDE.has(l.name) || l.name.startsWith('needs:'))
  );
  console.log(JSON.stringify(eligible));
" > "$CANDIDATES"
```

No further claim-state filtering runs here — the `bot:in-progress`
exclusion above is a cheap label pre-filter only, same posture as
dispatch's own queue-time filter. The authoritative unclaimed check is the
Claim step's live re-read below, which reads each candidate's actual
claim-blob state per `_shared/issue-claims.md`'s "Reading claim state" and
attempts an atomic create-only/conditional write; a record can pass the
pre-filter above and still turn out contested once Claim runs.

## Selection

When `--priority <band>` is present, drop every candidate whose
`priority:` label doesn't match the band — unprioritized records never
match; mirrors `/dispatch`'s flag.

The ranked list, by dispatch's own ranking (`dispatch/SKILL.md` Step 3):
`priority:high` > `priority:medium` > `priority:low` > unprioritized,
oldest `createdAt` first within each band — the top of that ranking is
this iteration's pick.

This is a **full re-derivation on every iteration** of the drain loop,
never a filter over a list frozen at the firing's start: the Eligibility
query above re-runs fresh each time this section is reached, so a record
shaped or routed earlier in this same run is naturally absent from a later
iteration's fetch (it no longer matches the Eligibility query's own
predicate — it now carries `ready`, `shaped:headless`, or a
`needs:*`-prefixed label), and a record that becomes newly eligible
mid-run (a label removed, a `parked` deferral lifted by a human in another
session) is naturally picked up the next time this section runs.

**This-firing attempted set (additive, on top of the mandatory re-query
above).** A record whose attempt ends in `failed` (`next-mode.md`'s Zero
eligible or budget exhausted section; concretely, `next-mode-shape.md`'s
Failure self-report) does not always carry a new label — the parent-record
guard's tier-2 headless refusal and some exception paths release the claim
with no label write at all, so the fetch's own predicate alone cannot be
relied on to exclude it. To guarantee **this same firing** never
re-selects a record it already claimed, regardless of outcome (shaped,
routed, failed, or refused), maintain an in-memory set of every record
number this firing has successfully claimed — append to it the moment a
claim write succeeds (`## Claim` below, the same point the attempt counter
increments), and filter the ranked candidate list against it every
iteration, after the fresh fetch returns and before picking the top
entry. A **lost claim race never enters this set** — nothing was claimed,
so there is nothing to exclude beyond what the fresh fetch's own predicate
already handles. This filter is additive only: it never substitutes for
the mandatory re-query above, which still re-runs unconditionally every
iteration; it just narrows that fresh result further, so a record already
attempted this firing is never picked twice even when its labels are
unchanged. Persist the set in a session-scoped file (`$ATTEMPTED` below)
since a fresh bash invocation does not inherit prior iterations' shell
state, the same reason `$CANDIDATES`/`$PICK` are re-resolved every
iteration rather than kept in a shell variable. Session-scoped storage by
itself is scoped to the CLI session, not to one firing — it is the
unconditional reset **before this firing's very first iteration** (Drain
start above) that actually makes this set firing-scoped: without it, a
second bare drain invocation later in the same session would resolve the
identical `$ATTEMPTED` path and inherit the first firing's exclusions.

Re-resolve this fence's session-scoped temp paths (a fresh bash invocation does not inherit the Eligibility fence's shell variables, `_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CANDIDATES=specify-next-candidates.json PICK=specify-next-pick.json ATTEMPTED=specify-next-attempted.json)"
node -e "
  const RANK = { high: 0, medium: 1, low: 2 };
  const bandOf = (r) => {
    const p = r.labels.find((l) => l.name.startsWith('priority:'));
    return p ? RANK[p.name.slice('priority:'.length)] : 3;
  };
  const fs = require('fs');
  const attempted = fs.existsSync('$ATTEMPTED') ? new Set(require('$ATTEMPTED')) : new Set();
  const priorityFilter = process.argv[1] || null; // '--priority' value, or unset
  let candidates = require('$CANDIDATES').filter((r) => !attempted.has(r.number));
  if (priorityFilter) candidates = candidates.filter((r) => r.labels.some((l) => l.name === 'priority:' + priorityFilter));
  const ranked = candidates.slice().sort((a, b) =>
    bandOf(a) - bandOf(b) || new Date(a.createdAt) - new Date(b.createdAt));
  console.log(JSON.stringify(ranked.length ? ranked[0] : null));
" "$PRIORITY_FILTER" > "$PICK"
```

## Zero eligible or budget exhausted (loop termination + close-out)

A `null` result at this fence's `$PICK` path (this iteration's fresh
Eligibility-query fetch, filtered against the this-firing attempted set
above, turned up no candidates) ends the drain loop. **`all`'s
termination condition, stated precisely: the eligible set minus this
firing's attempted set is empty** — not the eligible set alone, since a
record this firing already attempted (any outcome) is permanently
excluded from every later iteration by the attempted-set filter even when
its labels never changed, which is what makes `--budget all` guaranteed
to terminate rather than looping forever on one record whose failure
writes no label. Two distinct cases, by whether this firing has claimed
anything yet (the `shaped`/`routed`/`failed` counts below):

- **Nothing claimed yet** (the very first iteration returns `null`): report
  "nothing eligible this firing" and exit cleanly — no self-report, no
  notification, no close-out rendered. The firing's own session transcript
  line is the only trace, deliberately (mirrors dispatch's "Zero eligible
  groups" posture) — `/claude-tweaks:tidy` and `/claude-tweaks:help`
  surface queue state independently on their own cadence.
- **At least one attempt already ran this firing**: this is the loop's
  normal, successful termination — the eligible set minus this firing's
  attempted set drained to empty before `--budget` was spent (`--budget
  all` can only end this way). Render the close-out below; there is no
  "remaining" line in this case, since nothing is left to attempt.

**Budget exhaustion** ends the loop the same way but with the eligible set
minus this firing's attempted set still non-empty: this firing's attempt
counter (incremented once per successful claim in `## Claim` below)
reaches `--budget <n>` while a fresh fetch, filtered against the attempted
set, still returns a non-`null` pick. Render the close-out below, plus one
line naming the record(s) this firing's ranking would have attempted next
had budget allowed — the top of that final fetch's (already
attempted-set-filtered) ranked list.

**Close-out.** Lead with the three counts, then each bucket's own
accumulated record refs beneath:

```
{shaped: N, routed: M, failed: K}
shaped: #a, #b, ...
routed: #c, ...
failed: #d, ...
remaining (budget exhausted, not attempted this firing): #e, #f, ...
```

- `shaped` — this firing's own Shape-step successes (`next-mode-shape.md`'s
  `## Release`, `shaped: #{n}` reason).
- `routed` — this firing's own Framing Guard routing outcomes
  (`next-mode-shape.md`'s `## Release`, `routed: needs:definition #{n}`
  reason) — a productive outcome, never a failure, per that section.
- `failed` — this firing successfully claimed the record, then
  `next-mode-shape.md`'s Framing Guard or Shape step raised an error
  before completing, **or a shaping-stage guard deliberately refused the
  record without writing any label** (the parent-record guard's tier-2
  headless refusal, inside `next-mode-shape.md`'s own Shape section) —
  both land on the same `## Release`'s `failed: shaping` reason. A
  close-out reader should
  treat `failed` as **"claimed but produced no record change"**, never
  hunt for an exception that may not exist — a deliberate refusal is just
  as valid a `failed` entry as a thrown error. Never a lost claim race
  (`## Claim` below — that consumes no budget and never reaches this
  bucket) and never a Framing Guard routing outcome (that is `routed`,
  never `failed`). Each entry here already filed the shared self-report
  per `next-mode-shape.md`'s Failure self-report section before the loop
  continued past it.
- `remaining` — rendered only on the budget-exhaustion case above; omitted
  entirely when the loop ended because the eligible set emptied.

This close-out is this firing's own report — it renders on every
loop-termination path above (bare drain interactive or headless alike)
except the nothing-claimed-yet no-op, independent of the pre-existing, unchanged "no `## Next Actions` block for
a headless firing" rule (`next-mode-shape.md`'s Shape section) — that rule
governs the separate interactive suggestion-menu render, not this summary.

**Under `--source sweep`,** this firing is a component step of `/claude-tweaks:sweep`
— the close-out counts above render as the step's report to the parent, never a
`## Next Actions`/suggestion-menu render, even with a human present at sweep's own
prompt: the parent owns the handoff. `decisions.md` entries go to the parent's shared
run dir, adopted via the resolution ladder. The `$ATTEMPTED` this-firing set still
resets at firing start exactly as for a Routine firing.

## Claim

Re-read the selected record's live labels immediately before claiming — the
Eligibility query snapshot (above) is stale by definition by the time
Selection picks a winner:

```bash
gh issue view {n} --json labels -q '[.labels[].name]'
```

If the re-read shows the record no longer eligible (now carries `ready`,
any `needs:*`-prefixed label, `parked`, `parent-issue`, `digest`, or `bot:in-progress`),
or the claim write below is contested — either is a **lost claim race**: it
consumes no `--budget` unit, and the loop normally retries immediately,
exactly as if the record had never appeared, against a fresh Eligibility
fetch and re-rank. The two branches differ in one respect: for an
ineligible re-read specifically, that retry is never handed the same
record again — the fresh fetch's own predicate excludes it, since
something else changed its labels between the two reads. The
contested-write branch below carries no such guarantee: a `409`/`5xx` can
recur with zero label change, so nothing about the fresh fetch's predicate
excludes it there. **Cap, covering both branches:** run the lost-race
bookkeeping fence below on every lost claim race; its 3rd consecutive
count for the same record number adds that record to `$ATTEMPTED`
(Selection above) instead of retrying it again — still consuming no
budget unit — and the loop continues from a fresh fetch same as any other
lost race. The cap exists because the ineligible-re-read argument above
does not extend to a recurring contested write, so an unbounded retry
there could otherwise loop indefinitely on one record whose state never
actually changes:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" ATTEMPTED=specify-next-attempted.json RACE=specify-next-race.json)"
node -e "
  const fs = require('fs');
  const race = fs.existsSync('$RACE') ? require('$RACE') : {};
  const n = Number(process.argv[1]);
  const count = (race[n] || 0) + 1;
  if (count >= 3) {
    const ids = fs.existsSync('$ATTEMPTED') ? require('$ATTEMPTED') : [];
    ids.push(n);
    fs.writeFileSync('$ATTEMPTED', JSON.stringify(ids));
    delete race[n];
  } else {
    race[n] = count;
  }
  fs.writeFileSync('$RACE', JSON.stringify(race));
  console.log(count >= 3 ? 'capped' : 'retry');
" {n}
```

`capped` means this record is now excluded for the rest of this firing —
return to the Eligibility query above for a fresh fetch and re-rank as
usual. `retry` means retry immediately against a fresh fetch, same as
before this cap existed. This is a different outcome from the `gh issue
view` re-read command, or reading `$RUN_DIR` from this firing's resolved
run-directory file (below), failing to run at all (network error, `gh`
auth failure, malformed response, a non-zero exit, a missing/empty file)
— that is a genuine infra failure, not an eligibility result, and ends the
whole firing per Failure self-report below; it must not be folded into the
no-cost retry above.

Otherwise, claim it per `_shared/issue-claims.md`'s "The lock": read the
claim blob, classify with `classifyClaimBlob`, and write create-only
(`'absent'`) or conditionally (`'tombstone'`/`'stale'`). A contested write
(`'live'`, or a write rejection) runs the same lost-race bookkeeping fence
above — no budget consumed either way. This is not a failure; file no
self-report. A successful, uncontested claim write is what actually starts
an attempt — increment this firing's attempt counter here, the one
`--budget` is checked against (the loop-termination section above), and
append this record's number to the this-firing attempted set (Selection
above, `$ATTEMPTED`) here as well, in the same step, regardless of what
outcome the record goes on to reach below — a lost claim race above never
reaches this point, so it never enters the set. Add `bot:in-progress`
alongside a successful claim write (bootstrap-then-add, per
`_shared/issue-claims.md`'s "The bot:in-progress label" section) —
best-effort, never blocking the claim itself on a failed add.

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" ATTEMPTED=specify-next-attempted.json)"
node -e "
  const fs = require('fs');
  const ids = fs.existsSync('$ATTEMPTED') ? require('$ATTEMPTED') : [];
  ids.push(Number(process.argv[1]));
  fs.writeFileSync('$ATTEMPTED', JSON.stringify(ids));
" {n}
```

Proceed to `next-mode-shape.md`'s Framing Guard.

This firing always resolves its run directory in `auto` mode — a headless
bare drain firing has no human present to answer an interactive-mode
prompt, so `--mode auto` is a structural fact of the form itself (the
deprecated `next` alias inherits the same posture), not a policy choice.
`runId` for every claim this firing makes is this firing's own resolved
run directory identity — resolved **once per firing, not once per
iteration**, via `_shared/run-dir-resolution.md`'s standalone-auto fallback
(Resolution order step 4) — `specify` is on that file's allowlist as of
this task, added alongside `/claude-tweaks:dispatch`'s own bare-drain
entry, for the identical reason: bare drain is the headless-safe form a
scheduled Routine fires unattended, so step 5's interactive fallback is
never a real option for it. The resolution itself runs exactly once, in
Drain start above, writing the result to a session-scoped file
(`$RUN_DIR_FILE`) rather than a shell variable — the same carrier
`$ATTEMPTED` uses, and for the same reason: a fresh bash invocation
inherits neither. Every fence needing it, here and in
`next-mode-shape.md`'s Release, re-resolves the path and reads the file,
so one `decisions.md` accumulates this whole firing's audit trail across
every record it attempts:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" RUN_DIR_FILE=specify-next-rundir.txt)"
RUN_DIR=$(cat "$RUN_DIR_FILE")
```

Call the result `$RUN_DIR`; the resulting directory's basename is this
firing's `runId`. Log every claim (and, below, every release) to that
directory's `decisions.md` per `_shared/issue-claims.md`'s own logging
convention — cited, not restated, here.


**Split across two files (#1346).** This file holds Flag rejection through Claim. The Framing
Guard, Shape, Release, and Failure self-report sections continue in `next-mode-shape.md`, this
skill's directory. Section numbering/naming is unchanged across the split, so a cross-reference
naming a section by name still resolves regardless of which file it lands in. Continue there now.
