# Console execution — reconciler executes answered consoles, live accelerator, `consoleAutoResolve`

Closes the loop `_shared/console-on-pr.md` opens: that file renders and posts, this file detects a
human's answer and acts on it. Detection is pure Node (`bin/lib/reconcile/console-execute.js`) —
it never executes, only reports. **Execution always happens in an invoking agent session**, never
in Node: several item kinds are judgment-bearing (drafting a memory file, scrubbing an upstream
filing), and only an agent can run them. This file is what an agent session reads when it picks up
a reported-ready console, whether it got there via the reconciler, `/claude-tweaks:dispatch`,
`/claude-tweaks:tidy`, or the live-session accelerator below.

## Detection (Node, read-only)

`bin/lib/reconcile/console-execute.js` — wired into `bin/lib/reconcile/index.js` as the `console`
check (pr-first only, alongside `mirror`/`release`/`archive`; `local-merge` never has a
`console.json` to find). For each non-terminal run: read `console.json`; skip if absent, if
`resolved: true`, or if `executingAt` names a live (non-stale) claim (see below). Otherwise fetch
the primary comment (`gh pr view --json comments,body`, gh-CLI-only — same constraint every other
reconcile check states, no MCP fallback in Node; a gh-absent environment reports that reason, same
as `mirror`/`release`/`archive`), parse the Resolve checkbox and every `<!-- console-item: {id} -->`
row's tick state, and report `{ action: 'ready', runDir, prNumber, commentIds, items, mergeCheckVerdict, mergeGrantGap, rulingGateGaps }`
only when Resolve is ticked — an unresolved console (Resolve unticked) is reported as
`skip: not-resolved-yet`, not surfaced as work. The returned `items` carry each item's `approved`
boolean (its parsed tick), its declared `kind`, its `stagedHash` from `console.json`, and (for the
one `isMergeRow: true` item, when present, and each `isRulingRow: true` `sdd-ruling-*` item) that
flag itself — everything the executing session
needs without re-reading the comment itself. `mergeGrantGap` (#1802, below) is this same
detection's own mechanized re-fetch of every named record's live grant, not something the
executing session derives itself.

## Pre-execution claim

Before executing a reported-ready console, the agent session writes `console.json.executingAt`
(ISO timestamp) and `console.json.executingSession` (its own session id) — check-then-act: read
`console.json` immediately before writing, and if `executingAt` already names a **non-stale** claim
(younger than 30 minutes), stop — someone else is already executing this console, this session's
job here is done. A stale claim (older than 30 minutes with no `executedAt` written) is
reclaimable: overwrite it and proceed. This is what makes a live session racing a reconciler pass
(or two reconciler passes racing each other) cost nothing — whoever claims first wins; the loser's
claim attempt reads someone else's fresh timestamp and backs off.

## Execution routing

Route every approved item through the **same** procedures `wrap-up/execution-and-verification.md`
and `wrap-up/review-console.md`'s "On approval" section already define — cited, not restated:
staged batch items (Auto-applied through Cleanup actions) via `execution-and-verification.md`'s
apply list and `review-console.md`'s "On approval" steps 1-6; `Q#` queue writes, `M#` memory
updates, and `U#` upstream feedback via "On approval" steps 7-9's own per-item procedures. An
unticked item at Resolve time is declined — log it to `decisions.md` exactly as an Override-drill
decline does today ("declined, no reason given" when the comment carries no free-text rationale,
since a checkbox has none to read). Every executed or declined item appends its own
`_shared/auto-decision-log.md` line. An unticked `staged/reflect-{n}.md` Skill-updates row declines first, through `bin/reflect-apply.js --run {item-run-dir} --item '{name}' --decline 'declined at Review Console, no reason given'`, so the decline is recorded, not only logged; the ticked ones then apply through "On approval" step 2's reflect clause with `--only '{name},…'` naming exactly the ticked rows — never a plain run, which would apply the unticked ones too, and skipped when no reflect row is ticked (`--only` naming no item exits 2).

**Except an `sdd-ruling-*` item** (staged file `staged/sdd-ruling-{N}.md`, or
`spec-{N}/staged/sdd-ruling-{N}.md` on a multi-spec bundle, #3401): unticked at
Resolve time, or named in `resolve-console --decline`, it routes to **reverse**, never to a plain
decline — compose and file the reversal record per `wrap-up/review-console-appendix.md`'s
`sdd-ruling-*` bullet (ledger row → `deferred`, Resolution `reversed → #{new record}`; the row stays
`open`, cause logged, when the record is refused or not created). Ticked, it is ratify (ledger row →
`accepted`, per the same bullet). Log it as an `AUTO` line naming `reversed → #{new record}` only
once the record exists; when the record is refused or not created, log that cause instead
(`REFUSED` when `wrap-up/refused-proposals.md` refuses it, else `SKIP` — `FAILED` is reserved for
its two refine writers) — never `declined`, and never `reversed` without a record number.

**Except a finding row** (`findingItem` on its item — a can't-tell Low-confidence/Contested row,
`_shared/console-on-pr.md`'s Row shape, #3949): ticked, it files through `wrap-up/review-console.md`
step 7's can't-tell clause, `--only` naming the ticked rows' `findingItem` ids and `{item-run-dir}`
the run dir whose findings hold them (on a multi-spec console, the `spec-{N}` dir its spec slug
names); unticked at Resolve time, or named in `resolve-console --decline`, it is **dropped** —
nothing filed, logged as Override's `drop {#}` is (`wrap-up/review-console-interactive.md`), and
`resolve-console` records it `dropped`, which counts as cleared. Its tick is read from whichever
console comment carries its row (an overflow comment included); a row no comment carries is
recorded `declined`, not cleared — a drop needs the untick. A ticked row whose filing failed
(a non-zero `console-filings.js` exit, or a failed create) goes in `resolve-console --filing-failed`:
its reply reads `filing failed — see decisions.md`, Resolve stays unticked, and it is carried as
step 7 carries a failed filing — never recorded `executed`.

**Staged-file drift check, before executing any item that reads one:** verify the item's staged
file (`staged/...`) still exists, and re-hash its current content against `console.json`'s recorded
`stagedHash` for that item. Missing → unexecutable, report it as such (not an error — the file may
have been consumed by a different path already). Hash mismatch → unexecutable-stale, report it
(the staged content changed underneath an already-rendered tick — executing it would apply
something the human never actually saw ticked). Neither case blocks the rest of the console;
report and move on.

**Worktree-needing items** (a file edit under `worktree-always`): use the run's own still-assigned
worktree (`run-state.json.worktree`). A reaped worktree with a pending console is the rare case the
reconciler's merged-only reap rule already makes unlikely (`bin/lib/reconcile/reap-merged.js`) —
when it happens anyway, surface it rather than executing: there is nowhere to apply the edit.

## Write order after execution

**Reply comment first, then the resolved marker edit** on the console comment itself — never the
reverse. Post one reply comment (`<!-- console-item: executed -->`) summarizing per-item outcomes
(executed / declined / reversed / reverse-failed / unexecutable / unexecutable-stale), plus
dropped / filing-failed for a finding row, then edit the
console comment's first line to add `<!-- claude-tweaks-console-resolved -->`, then write
`console.json.executedAt` and `console.json.resolved` (`true` only when every item cleared) together,
in one write. The same write records each item's `outcome` (and `note`, for a non-executed item)
on its `console.json` item; a `filing-failed` or `reverse-failed` outcome is console residue — archival
refuses (`console-residue`) until `console-residue.js --ack` (#4172). The comment
marker is the source of truth; the `console.json` completion fields are the local cache. A split-brain
(reply posted, marker edit failed partway) is repaired by the next detection pass: it keys
"already executed" off the reply comment's presence on the PR, not off `console.json` alone, so a
missing marker with a present reply comment is read as "executed, retry only the marker edit,"
never as "not yet executed."

Both code readers of these completion fields — `readConsoleState`
(`bin/lib/reconcile/archive-merged.js`) and `preFetchSkipReason` (`bin/lib/reconcile/console-execute.js`)
— treat a non-empty `executedAt` as sufficient on its own, since consoles written before this
write order set `resolved: true` carry `executedAt` alone; this write order sets both.

## Idempotence

A second reconciliation (or a live session racing one) detects either the resolved marker on the
comment or `console.json.executedAt` and no-ops — covered by a unit test on the pure decision
function, not a live `gh`-backed integration test (no live PR exists in this offline environment;
same honesty stance as every other gh-dependent claim in this pr-first integration model).

## Live-session accelerator

An **interactive** (non-headless) session that reaches `_shared/console-on-pr.md`'s render/post
step also asks via `AskUserQuestion`, using the same Approve all / Override / Stop question
`wrap-up/review-console-interactive.md`'s "Present the console" already asks — rendered from the same content
just posted to the PR. Two surfaces, one answer: whichever resolves first wins.

- **Chat answers first:** execute directly via this file's Execution routing above, then perform
  the same Write order (reply comment, resolved marker, `console.json.executedAt`/`resolved`) —
  `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-console --run {run-dir} --approve {ids} --decline {ids} [--reverse-failed {ids}] [--filing-failed {ids}]`
  is the concrete mechanism: it performs the three coupled writes in the documented order (reusing
  `console-execute.js`'s own read/parse/decide helpers rather than re-deriving console state), so a
  later reconciler pass detects the resolved marker and no-ops rather than re-asking.
  A ruling row's chat `ratify {#}` maps to `--approve` and `reverse {#}` to `--decline`; a ruling
  the chat answer ratifies must be passed in `--approve` (an unticked ruling id in neither list is
  recorded `reversed`, as any other unticked id is recorded `declined`); perform the reverse
  (Execution routing above) before this call — the reply comment `resolve-console` posts records a
  flagged ruling item (`console.json`'s `isRulingRow: true`, `_shared/console-on-pr.md`) as
  `reversed` and every other `--decline` id as `declined, no reason given`, and
  a reversed ruling counts as cleared, so it never holds Resolve unticked (a console rendered before
  the flag existed carries none, so its ruling still reads `declined`). The `decisions.md` `AUTO`
  line naming `reversed → #{new record}` (or the logged refusal cause) stays the record of which
  reversal record was filed. When the reverse was refused or never created, also pass that
  ruling's id in `--reverse-failed`: the reply then labels it
  `reverse not filed — see decisions.md` and Resolve stays unticked. Never let such a ruling
  default to `reversed`.
- **PR ticks resolve first** (a human ticked boxes on the PR while the chat prompt was still open,
  or a reconciler pass executed it in the interim): before acting on the chat answer, re-check the
  console comment for the resolved marker. If present, do not execute again and do not re-render
  the `AskUserQuestion` outcome as if it were this session's own decision — report that the console
  was already resolved (by whom, if determinable from the reply comment) and move on.
- **Headless** firings skip `AskUserQuestion` entirely, per `_shared/console-on-pr.md`'s Headless
  conclusion — this accelerator only exists where a human is actually present to answer either
  surface.

## `consoleAutoResolve` wiring

At `autonomy: unattended` with `bookkeepingPermissions(ceiling).consoleAutoResolve` granted
(`_shared/autonomy-ceiling.md`; `bin/lib/issues/autonomy.js`), the executor is a **sanctioned
caller** of that capability from the reconciler side, exactly as `wrap-up/review-console.md`'s own
Auto-resolution short-circuit is from the live-session side — same capability, two trigger points,
because the ceiling can be raised (or the reconciler can run under a higher ceiling than the
session that originally rendered the console) *after* a console was already posted at a lower
ceiling. Do not conflate the two: the short-circuit resolves **before** `_shared/console-on-pr.md`
ever renders a comment, so a console reaching this file already implies the short-circuit did not
fire at render time — this wiring is what lets a *later* pass still auto-resolve it.

**Per item, not a blanket flag:** loop over every item and ask, individually, whether it is
floor-clearing. Today, every item the console's own sections cover (batch, `Q#`, `M#`, `U#`) is
floor-clearing whenever `consoleAutoResolve` is granted — `_shared/autonomy-ceiling.md` defines the
capability as unlocking every section uniformly, with **one narrower exception (#1294):** the item
carrying `isMergeRow: true` (`_shared/console-on-pr.md`'s Item ID scheme — the Git-worktree/
branch-finish Cleanup-actions row) is **not** floor-clearing when this run's `console.json` carries
a persisted `mergeCheckVerdict: "needs-human"` (`_shared/console-on-pr.md`'s `console.json`
section) — the same `assess-agent-autonomy merge-check` precedence rule
`wrap-up/review-console.md`'s render-time Auto-resolution short-circuit already applies (#1179),
mirrored here for the reconciler-side trigger point since a foreign session has no other way to
learn that verdict. `mergeCheckVerdict` absent, or present but not `"needs-human"`: the merge row
is floor-clearing exactly like every other item, unchanged from today. Every item this exception
doesn't name — every batch/`Q#`/`M#`/`U#` item, and the merge row itself absent a persisted
`needs-human` verdict — stays unconditionally floor-clearing. This single named exception is not
the general per-item floor predicate #347 (autonomy-tiered console resolution) is expected to add
later — it exists solely to close the specific correctness gap #1294 found; do not generalize it
into a broader test or pre-implement #347's predicate here (Related, not merged scope, same as
`_shared/console-on-pr.md`'s own note on #347).

**A finding row is floor-clearing and is ticked whatever its pre-tick** (#3949): at `unattended`
every can't-tell item files, its recommendation notwithstanding (`_shared/autonomy-ceiling.md`'s
`consoleAutoResolve` row), so this wiring never drops one — it files it per Execution routing above.

**Second narrower exception (#1802):** the same `isMergeRow: true` item is also **not**
floor-clearing when a live re-fetch shows any group member currently lacking both `auto:merge`
and a matured `auto:merge-pending` — unlike `mergeCheckVerdict` above, this fact needs no
persisted snapshot, since it is directly observable current label state rather than an LLM
judgment computed once at render time. **Deriving group membership in a foreign session:** the
executing session did not necessarily render this console, so it cannot rely on the original
session's own `dispatch-groups.json` (session-scoped, per `_shared/session-tmp-root.md`, and gone
once that session ends) — instead, parse every `Fixes #{n}` line from the PR's own body (`gh pr
view --json body`), the same durable, one-line-per-record marker `dispatch/settle-and-merge.md`'s
merge step writes onto every group member; that is the group. Fetch each named record's live
labels (`gh issue view --json labels`) and apply the exception if any lacks the grant. This closes
the gap the `mergeCheckVerdict` exception alone leaves open: `dispatch/settle-and-merge.md`'s
Auto-merge gate Layer 1 falls through before Layer 2's `merge-check` ever runs on a mixed-grant
bundle, so `mergeCheckVerdict` is omitted from `console.json` entirely — a withheld grant is
itself a human decision and must never silently resolve to merge for want of a verdict that was
never computed.

**Mechanized, not re-derived per session (#1966).** The two paragraphs above describe the check's
logic, but `bin/lib/reconcile/console-execute.js`'s `decideConsoleExecute` now performs it in
code — a foreign executing session no longer re-derives any of this by hand. It parses the
`Fixes #{n}` lines itself, fetches each named record's live labels via
`gh issue view --json labels,comments`, and evaluates maturity with the same `evaluateMaturation`
helper `bin/lib/console/resolve.js`'s live-session path already uses. "Group" here includes a
solo, non-bundle record — a singleton run's PR carries exactly one `Fixes #{n}` line, still a
one-member group the check applies to, not an exemption. The executing session reads the ready
result's own `mergeGrantGap` field instead: `null` means every member is granted (the row is
floor-clearing on this axis); `{ member, reason }` names the first ungranted (or
unreadable/unresolvable) member and withholds. A merge row evaluated without its context (no PR
body or no member grants supplied) withholds with `{ member: null, reason: 'grant-context-missing' }`
(#4048) — an absent context never reads as `null`.

**Third narrower exception (#3880):** an `isRulingRow: true` item named in the ready result's
`rulingGateGaps` (`[{ id, reason, detail? }]`, computed in code by `decideConsoleExecute` from each
ruling row's staged file, read via the item's `stagedPath` — `_shared/console-on-pr.md`) is **not**
floor-clearing: its box and Resolve stay unticked and the console stays pending for a human, the
same posture as the merge row. It mirrors `console-resolve.js`'s `pending — sdd-ruling-*` resolution
(`wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet) for the reconciler-side trigger
point. `rulingGateGaps: []` — every ruling row's header shows it safe — leaves each ruling row
floor-clearing, unchanged. An absent ruling-text map (no `rulingTexts` in the call's context)
withholds every ruling row as `sdd-ruling-unclassified` (#4048), withheld like any other ruling
gap; a recorded read error for a row still outranks that and names it `sdd-ruling-unreadable`.

**Auto-resolution performs real comment edits.** It ticks the floor-clearing boxes on the PR
comment (via `_shared/console-on-pr.md`'s post-or-update procedure) *before* executing — the same
comment-edit history a human's own ticks would leave, flagged in the reply comment and in
`decisions.md` as `AUTO`, never presented as if a human ticked it. The Resolve box is ticked only
when every item in the console is floor-clearing; a console with a genuinely non-floor item —
today, exactly the `isMergeRow: true` item under either exception above (a persisted `needs-human`
verdict, or a live-refetched member lacking `auto:merge`) and a ruling row named in
`rulingGateGaps` — gets its floor items ticked and executed, but each such item and Resolve stay
unticked and the console stays pending for a human. Log one `AUTO {time} — Console execution: auto-resolved {item}
on PR #{n}. Reversibility: {…}.` line per item actually resolved, per
`_shared/autonomy-ceiling.md`'s Logging convention — and, when the merge row was withheld, one
further line naming which exception fired: `AUTO {time} — Console execution: withheld branch-finish/merge on PR #{n} — persisted
mergeCheckVerdict: needs-human. Reversibility: n/a (declined to act).` for the first exception, or
`AUTO {time} — Console execution: withheld branch-finish/merge on PR #{n} — member #{m} lacks
auto:merge. Reversibility: n/a (declined to act).` for the second (#1802) — naming the specific
member `{m}` whose live labels lacked the grant. For a gap whose `member` is null
(`grant-context-missing`, `members-unresolved`) the line takes the null-member form instead:
`AUTO {time} — Console execution: withheld branch-finish/merge on PR #{n} — {reason}. Reversibility: n/a (declined to act).`
A withheld ruling row (third exception) logs
`AUTO {time} — Console execution: withheld ratify of {item} on PR #{n} — {reason}. Reversibility: n/a (declined to act).`
When the gap carries a `detail` — an `sdd-ruling-unreadable` row, whose staged file could not be read — `{reason}` reads `sdd-ruling-unreadable ({detail})`.

## Comment-tick trust boundary

Whoever can edit or tick the console comment approves — GitHub's write-access trust boundary
(`_shared/console-on-pr.md`'s Comment-edit permission surface), the same boundary the merge path
already accepts. Do not build a second authorization layer here. Checkbox edits carry no audit
trail beyond the comment's own edit history; the execution report states "approved via console
ticks" as the accepted residual, exactly as an in-session console click today carries no stronger
proof than "the person in this chat clicked it."

## Entry points

`bin/lib/hooks/session-start.js` surfaces a detected ready-to-execute console in its
`additionalContext` (same mechanism as its existing unfinished-pipeline-run notice), prompting the
session to read this file and act. `/claude-tweaks:dispatch` and `/claude-tweaks:tidy` each run the
`console` reconcile check at their own existing reconciliation touchpoints and, on a `ready` result,
follow this file rather than inventing a parallel procedure.

## `ctx.ownedRun` write-scoping exemption

Console execution is the sanctioned exception to the hooks dispatcher's ownership-scoped write path
(`bin/lib/hooks/context.js`'s `resolveRun`/`ctx.ownedRun` split, restated in that file's own
ownership comment) — it deliberately acts on runs whose owning session is gone by design (the
session that built the run and rendered the console may have ended long before a human ticks boxes
on the PR days later). A console-execution session's hook-level breadcrumbs for a foreign-owned or
unowned run are expected, not a bug; this file's own writes (`console.json`, the reply comment, the
resolved marker) go directly to the run dir and the PR regardless of `ctx.ownedRun`, the same way
`bin/lib/reconcile/*` already writes to runs regardless of session ownership.
