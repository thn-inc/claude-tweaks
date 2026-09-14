# Backlog Refine — Resolve Lane and Breaker Reset

Two human-present-only procedures, split out into their own file rather than added to
`refine-mode.md` (already close to its 46,080-byte per-file ceiling): the **Resolve lane**'s
batch-table render and write mechanics, and the standalone `--reset-breaker` reset (#1887 retitled
this file from "Record Resolver (`#N`)" — `#N` is now a filter over the whole-queue sweep, not a
separate mode, so this file is no longer `#N`'s own entry point).

`refine-mode.md` Step 4 reads this file for the Resolve lane on **every** `refine` invocation —
whole-queue (bare `refine`) or `#N[,#M...]`-filtered — resolving exactly the fetched population's
own unresolved decision comments and `bot:blocked` state, never a separate sweep of its own.
`SKILL.md`'s Input routing still loads this file directly for the standalone `--reset-breaker`
form, unaffected by the fold-in above.

## `--reset-breaker` (standalone)

Resolves before any worklist fetch — a `#N` also present on the same invocation does not delay
this: the reset runs first, then the run exits without touching any record, named or not. Runs
exactly `merge-lane-reset.md`'s existing question-and-write procedure verbatim — read that file
directly rather than restating its `AskUserQuestion` text or its `writeBreakerState` call here.
No sweep, no batch table. When a `#N[,#M...]` list is also present on the same invocation, report
one explicit line after the reset procedure completes naming the record(s) that were **not**
processed this run (e.g. "#{n}, #{m}: not processed — `--reset-breaker` exits before any
worklist fetch; re-run `/claude-tweaks:backlog refine #{n},#{m}` to resolve them") — never a
silent discard of the named numbers.

`/claude-tweaks:backlog` is already on `_shared/run-dir-resolution.md`'s standalone-auto allowlist,
so this resolves the same `{ISO}-backlog-standalone` run directory any other standalone `backlog`
invocation does — no new run-directory mechanism needed. `merge-lane-reset.md`'s own Reset branch
writes its one `decisions.md` AUTO line into that directory, in its own existing log-line format
(quoted there, not restated here).

## The Resolve lane

### Step 1: Fetch

`refine-mode.md`'s own Resolve fetch (Step 1 there) supplies this population: every record in the
run's fetched worklist (whole-queue, or narrowed to `#N[,#M...]` when filtered) — never a `--label`
query, so a record still carrying only the pre-migration comment-only marker (no label at all)
stays reachable. A run reached directly at this file's own `#N[,#M...]` entry (a caller resolving
straight to the Resolve lane without going through `refine-mode.md`'s other populations) fetches
each named number directly instead:

```bash
for n in {N...}; do gh issue view "$n" --json number,title,labels,body,comments; done
```

For each fetched record, collect:

**(a) Every unresolved decision comment.** A comment whose body matches
`^<!-- needs-decision: (\S+) -->` with no `**Resolved:**` line anywhere in its body is unresolved
(`_shared/work-record.md`'s Decision-comment template + Resolution rule — cited, never restated).
Group by the captured `{unit}`; the newest unresolved comment per unit is that unit's live
proposal — an older unresolved comment from the same unit is a stale residual the Idempotence
check in `grant-lane-decision.md` normally prevents from ever accumulating; leave it untouched,
out of scope here. A record with live proposals from two different units gets two rows (Step 2).

**(b) Compatibility shim, with removal condition.** A comment whose body starts with the literal
`<!-- backlog-refine-human-only -->` (PR #1440's pre-generalization marker, predating both the
`needs:decision` label and the Decision-comment template) with no `**Resolved:**` line is treated
as one more live proposal, `{unit}` = the literal `backlog-refine`. That marker's body carries no
`**Proposed:**` line at all — its shape was a plain sentence, `Marked human-only by
/claude-tweaks:backlog refine: {RATIONALE}` — so Step 2's Evidence column quotes that sentence
directly instead of a `Proposed:` line. **Removal condition:** delete this shim once no open
record in the repo carries the old marker — a one-off `gh search issues` audit at the next minor
release after #1489 ships.

**(c) `bot:blocked`.** Whether the record's `labels` include it — independent of (a)/(b); a record
can carry both, neither, or only one.

### Step 2: Batch table

One row per record per live proposal from (a)/(b) — a record with two live proposals (two
different units) gets two rows; a record with one live proposal and no `bot:blocked` gets one row;
a record carrying `bot:blocked` with **no** live proposal at all still gets one row, offering only
the re-authorize choice, so a `bot:blocked` record with no decision comment stays reachable through
this same command.

Render one table for the whole Resolve population (columns: `#`, `Record`, `Unit`, `Choices`,
`Evidence`) — the whole queue, or the `#N,#M` list when filtered. Choices per row:

- **grant anyway** — adds `auto:build` (human-confirmed — the `/backlog refine` row's already-authorized
  write in `_shared/work-record-permission-matrix.md`).
- **build it myself** — resolves the comment only, no label change.
- **keep** — resolves the comment only, no label change.
- **park** — removes `ready`, adds `parked` (bootstrapped per `_shared/label-bootstrap.md`) — the
  two are never applied together (`_shared/work-record.md`'s Stage axis: backlog | `parked` |
  `ready`, one-of). Requires a `Trigger:` condition: ask the human for the trigger text as part
  of resolving this row (same convention as `/tidy`'s Defer action —
  `tidy/actions-github-issues.md`'s `## Defer` — cited, not restated), appended to the body as a
  `**Trigger:** {condition}` line before the label writes.
- **close** — closes the record (`gh issue close`).
- **re-authorize** — appended to every row belonging to a record carrying `bot:blocked` (including
  a comment-less row from (c) above); strips `bot:blocked`, adds `auto:build`, mirroring
  `refine-lanes.md`'s Re-authorize lane mechanics exactly (`auto:build` only, never `auto:merge`).
  Independent of whichever grant/build-it-myself/keep/park/close choice the same row also carries:
  resolving `needs:decision` never touches a co-occurring `bot:blocked`, and vice versa.

**"Build it myself" and "keep" are deliberately identical in write effect** — both clear the
comment with no other label change. They exist as two separate options only so the
`**Resolved:**` text names the human's actual reason (a scheduled future build vs. a considered
no-op) for a later reader of the record's history, never for any downstream mechanism.

**Premise, stated (#1493):** This relies on GitHub bumping the issue's own `updatedAt` on a
comment mutation (verified for comment creation; assumed for edits). If a comment edit turns out
not to bump it, `keep` must additionally perform a write that does (e.g. a no-op label touch) —
revisit before relying on the staleness clock alone.

Evidence column: quote the row's live proposal's `**Proposed:**` line verbatim, or, for a shim row
(b), the rationale sentence in place of it. A bare re-authorize row with no live proposal states
"Prior failure — human judgment required," mirroring the whole-queue Re-authorize lane's own fixed
evidence line.

### Step 2.5: Empty batch

When Step 2 yields zero Resolve-lane rows for every named record — no unresolved decision comment
((a)/(b)) and no `bot:blocked` (c) on any of them — this lane alone has nothing to confirm; report
that plainly (which named record(s) were checked and that neither condition was found). This no
longer means the whole `refine #{n}` invocation found nothing: since #1887, `#N` filters every lane
of `refine-mode.md`'s unified sweep, not just this one — a `ready` + `shaped:headless` record with
no `auto:build` grant still reaches the Grant lane (`refine-mode.md` Step 3), restricted to the
named number(s), and Step 4's confirm gate covers whichever lanes the filtered population actually
populated. Only when *every* lane's filtered population is empty is there truly nothing to
confirm for `refine #{n}`.

### Step 3: Confirm

**One `AskUserQuestion` for the whole batch — never one question per comment, never one per
record.** This resolver has no machine-computed "recommended" value the way the whole-queue lanes
do: a `**Proposed:**` line states an either/or (e.g. "grant despite the flag, or build it
yourself" — `grant-lane-decision.md`'s fixed template text), never a single pick. The recommended
default rendered per row is therefore fixed, not content-derived: **keep** for every
needs:decision/shim row (the safe no-op), **re-authorize** for every `bot:blocked` row —
independent axes, both applied together under "Apply all recommended." Reuses
`refine-lanes.md`'s existing batch-confirm shape (its `<!-- refine-confirm-gate -->`
`AskUserQuestion`), not its literal option text — that gate's "Grant auto:build only, hold merge"
option has no analog here and is omitted:

- `question`: `"Apply these choices, or override specific rows?"`, `header`: `"Backlog refine #N"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all recommended (Recommended)"`, `description`: `"Keep every decision as a considered no-op; re-authorize every bot:blocked row"`
- Option 2 — `label`: `"Override specific rows"`, `description`: `"I'll specify #-by-# choices in my next message"`
- Option 3 — `label`: `"Skip all"`, `description`: `"Leave every row untouched for now"`

Overrides are ordinary free-text in the user's next message, not the `Other` field — same
convention as `refine-lanes.md`'s own gate. An override naming **park** for a row with no
trigger stated in that same message is incomplete — ask a follow-up for the `Trigger:` condition
before applying that row; never write `parked` with no trigger.

### Step 4: Apply

For each resolved row (skip a row the human's answer left untouched):

1. **Comment edit** — every choice except a bare re-authorize row with no live proposal: prepend
   `**Resolved:** {choice} — {date}` to that comment's body. Read its id from the same `comments`
   array Step 1 already fetched: `gh issue view --json comments` returns each comment's GraphQL
   node id (`IC_...`), never the numeric REST id — confirmed empirically against a live comment on
   this repo — so a REST PATCH to `issues/comments/{id}` is not an option here; it would need the
   numeric id this call doesn't return. Update the body in place via the same GraphQL mutation
   `_shared/pr-run-comments.md`'s Post-or-update procedure Step 2 already uses for PR comments —
   an issue comment and a PR comment are the same `IssueComment` object on the wire, so the
   mutation is identical:

   ```bash
   gh api graphql -f query='mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id}}}' \
     -f id="{comment-id}" -F body=@{session-scoped resolved-body file}
   ```

2. **Label/state writes**, per the row's choice:

   | Choice | Write |
   |---|---|
   | grant anyway | `gh issue edit {n} --add-label auto:build` |
   | build it myself / keep | none |
   | park | append `**Trigger:** {condition}` to the body (`gh issue edit {n} --body-file <temp file>`, same mechanic as `/tidy`'s Defer action), bootstrap `parked` (`_shared/label-bootstrap.md`), then `gh issue edit {n} --remove-label ready --add-label parked` |
   | close | `gh issue close {n}` |
   | re-authorize | `gh issue edit {n} --remove-label bot:blocked --add-label auto:build` |

3. **Snapshot invalidation.** Immediately after a record's label/state writes above succeed,
   invalidate the session-scoped record snapshot (`_shared/github-write-transport.md`'s
   unconditional rule — cited, never restated; call shape copied from `capture/SKILL.md`'s own
   post-write invalidation):

   ```bash
   node -e "require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').invalidateSnapshot(process.env.CLAUDE_CODE_SESSION_ID)"
   ```

4. **`needs:decision` label removal.** After every row for a given record has been applied this
   run, remove the `needs:decision` label from that record only when zero unresolved
   `needs-decision:*`-marked comments remain on it (`_shared/work-record.md`'s Resolution rule) —
   a record refused by two units concurrently keeps the label until both are resolved. A
   shim-only row (Step 1(b)) may carry no `needs:decision` label at all (comment-only, pre-label
   marker) — nothing to remove in that case.

5. **Log** one `decisions.md` line per record (this run's `{ISO}-backlog-standalone` directory —
   same resolution as `--reset-breaker` above), naming the record, every choice applied, and the
   writes made:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO \
     --section "/backlog" --step "refine #{n}" \
     --text "Backlog refine #{n}: {choice(s)} — {labels/state changed}" --reversibility high
   ```

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Restating `_shared/work-record.md`'s Decision-comment template or Resolution rule inline | Cite it — two copies drift (`CLAUDE.md`'s Cross-references rule) |
| Removing `needs:decision` while another unit's comment on the same record is still unresolved | The Resolution rule is explicit: only when zero unresolved `needs-decision:*` comments remain |
| Treating `#N[,#M...]` as a separate mode from bare `refine`, post-#1887 | One procedure (`refine-mode.md`) — `#N` only narrows every lane's population; restating this file's Resolve-lane render as its own sweep re-forks what the fold-in unified |
| A Routine firing `refine #N`, bare `refine`'s Resolve lane, or `refine --reset-breaker` | All three are human-present-only forms, exactly like bare `refine`'s other human-decision lanes — `SKILL.md`'s Component-Skill Contract, `refine-headless.md`'s Resolve skip |
| Duplicating `merge-lane-reset.md`'s question text or write mechanics for `--reset-breaker` | Call that file's existing procedure directly — it is the one write path that ever clears a trip |
