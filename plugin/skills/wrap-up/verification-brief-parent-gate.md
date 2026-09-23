# Verification Brief — Parent-Gate Procedure

Read this file only when `verification-brief.md`'s Routing section has determined the record in
hand has a resolvable parent — a decomposed sub-issue, never the majority "no parent" case. This
is the compose-and-post detail for that one branch; `verification-brief.md` itself holds the
Routing decision, the non-parent Oversight-floor gate, and the default Steps 1-4 that the majority
of closes actually take.

The Routing section above routes here — in place of, not alongside, Steps 1-4 below — whenever
the record in hand has a resolvable parent.

## Two entry shapes

Every step from **Enumerate the parent's sub-issues** onward is shared, unchanged, by every caller
— only how the caller arrives at `$PARENT_NUM` differs, and there are exactly two shapes:

- **Sub-issue-side entry** — the three mid-close callers in the Routing table at the top of
  `verification-brief.md` (`/claude-tweaks:wrap-up`'s Phase 4 execution step, `/claude-tweaks:wrap-up`'s
  auto-merge short-circuit, and `/claude-tweaks:dispatch`'s group auto-merge gate, the last running
  this procedure once per group member). Each arrives holding a **sub-issue** number, plus
  `$CLOSING_SUB_ISSUES` — the set of sub-issue numbers its own run is closing, which the
  **Self-inclusion rule** below reads (one element for both wrap-up entries; the whole group for
  the dispatch gate). Run every section below in order, starting with **Resolve the parent**.
- **Parent-side entry** — **`/claude-tweaks:tidy`'s `Open parent gate` action**, on either
  driver: `tidy/actions-github-issues.md` executing on a `[parent-gate]` finding from
  `_shared/github-pr-scan-acceptance.md`'s `parent-gate` scope, or `tidy/actions-local-files.md` executing
  on one from `tidy/step-1-records.md`'s Shape 7. Both arrive already holding the
  **parent** number directly (`$PARENT_NUM` — a `parent-issue`-labeled issue number, or an
  `is-parent-issue: true` record's id), read straight from their own scan. Skip **Resolve the
  parent** and **Self-inclusion rule** below entirely — there is no sub-issue mid-close in this
  entry, so nothing needs resolving or self-inclusion special-casing. Start at **Enumerate the
  parent's sub-issues**, but re-read every sub-issue's state and the parent's own disposition
  fresh rather than reusing the scan's snapshot, and re-run **Evaluate the gate** before composing
  anything — time has passed since the scan ran (`/tidy`'s Step 6 approval is never instantaneous
  with its scan), and another process (a concurrent `/wrap-up` gating the same parent, or a
  sub-issue reopening) may already have changed the outcome. Every per-driver branch below applies
  to this entry exactly as it does to a sub-issue-side one — take the `local-files` branches when
  that is the driver.

**Fail open on every `gh` call in this section.** If `gh` is unavailable, unauthenticated, the
repo has no GitHub remote, or any parent-gate `gh` call below fails: a **sub-issue-side** entry
skips the Parent-Gate Procedure entirely and falls back to today's behavior (apply `demo:pending`
to this record itself via Steps 1-4 in `verification-brief.md`) — never blocking the wrap-up, the
auto-merge short-circuit, or the dispatched group's merge gate. The **parent-side** entry skips
this one parent for this run, leaving its `[parent-gate]` finding surfaced and unmutated — never
failing the whole `/tidy` run over one parent's `gh` call. This paragraph is moot under
`work-backend: local-files`, whose branches below make no `gh` call at all; a filesystem error
there is a real failure to report, not a fail-open case.

## What this path deliberately does not run

This procedure replaces Steps 1-4, and **Step 2.5's visual-review safety-net gate sits inside
that range, so it does not run for a parent.** That is an explicit exclusion, not an oversight,
and it is stated here rather than left to be inferred from the range:

- The gate's input does not exist at parent scope. Step 2.5 branches on *this run's* `/review`
  summary and classifies *this run's* changed-file list. A parent's sub-issues close days or weeks
  apart (the design's own Risks section calls that the dominant workflow), so there is no single
  run whose diff is the parent's diff and no single `/review` summary covering it.
- The parent-side entry has neither. `/tidy`'s backstop can fire long after the last sub-issue
  merged, from a checkout with no branch, no dev server, and no `/review` summary for anything
  — and it is a staged batch action, so triggering a browser walk from it would be an
  unapproved side effect of approving a label write.

**What still covers the UI:** every sub-issue runs `/claude-tweaks:review` before it reaches any
caller of this file, and `/review` Step 6 invokes `/claude-tweaks:visual-review` for the
sub-issue's own UI changes in `full` mode. What a parent loses is the *safety net* — the
wrap-up-time re-trigger for a sub-issue whose `/review` produced only a recommendation. A
decomposed UI feature can therefore reach `demo:pending` on its parent with no browser walk
having run for some sub-issue, and the parent brief must not imply otherwise.

**So the brief carries the human instead.** Part 2 of **Compose the parent brief** below — the
end-to-end walkthrough, rendered inline inside `### Confirmed` — is the only walk instruction a
parent brief carries (it omits the `### Observation plan` section, so `/claude-tweaks:demo` runs no
Prepare/Validate/Show for a parent — part 2's inline end-to-end walkthrough inside Confirmed is
what carries the human). For a parent whose assembled sub-issues
touch UI, that walkthrough must therefore name the pages or journeys to open and what to look
for, not just the skill invocation — it is standing in for the safety net, not summarizing it.

## Resolve the parent

**Sub-issue-side entries only** — see "Two entry shapes" above. The parent-side entry already
holds `$PARENT_NUM` and skips straight to "Enumerate the parent's sub-issues" below.

Resolve the sub-issue's parent the same way `/claude-tweaks:review` Step 1.6 does
(`skills/review/SKILL.md:147-154`): `work-backend: local-files` — `facets.parent`;
`work-backend: github-issues` + `work-links: native` — the sub-issue relationship queried
from this sub-issue's own side; `work-backend: github-issues` + `work-links: body-text` — the
`Parent: #N` line in this sub-issue's own body.

**No parent resolvable** (a record human-filed or `/capture`d directly, or one produced by a
`/specify` decomposition whose Step 2.6 collapse decision created no parent —
`specify/decomposition-mode.md`) — skip this section entirely: fall through to Steps 1-4 in
`verification-brief.md` and apply `demo:pending` to this record itself, exactly as today.

## Enumerate the parent's sub-issues

With a parent resolved (`$PARENT_NUM`), enumerate the parent's sub-issues from the **parent**
side, never from a sub-issue-side scan — a sub-issue-side lookup works under one `work-links`
mode and silently returns nothing under the other.

Resolve `work-links` before picking a branch below (`native` or `body-text` —
`_shared/work-record-config.md`; the resolver applies that table's default when the key is
unset), the same read `wrap-up/unblocked-records.md` already performs:

```bash
WORK_LINKS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links)
```

```bash
# work-links: native
gh api "repos/{owner}/{repo}/issues/$PARENT_NUM/sub_issues" --jq '.[].number'

# work-links: body-text — parse the parent's own task list. Resolve this run's
# session-scoped temp path first (_shared/session-tmp-root.md, cited throughout
# this file rather than restated).
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" WRAPUP_PARENT_BODY=wrapup-parent-body.md)"
gh issue view $PARENT_NUM --json body -q .body > "$WRAPUP_PARENT_BODY"
node -e "
  const { parseSubIssues } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const fs = require('fs');
  console.log(JSON.stringify(parseSubIssues(fs.readFileSync('$WRAPUP_PARENT_BODY','utf8'))));
"
```

`work-backend: local-files` — the parent body carries no task list (`specify/record-creation-linking.md`'s
local-files branch — #1346's split of `record-creation.md` — writes only `facets.parent` on each sub-issue, never a checklist on the parent), so
query the reverse relationship instead — every record whose own `facets.parent` matches, open and
closed alike (the same two-call merge `specify/record-creation.md:44` already uses):

```js
const { queryRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
const subIssueRecords = [...queryRecords('specs', { parent: PARENT_ID }), ...queryRecords('specs', { parent: PARENT_ID, closed: true })];
const subIssues = subIssueRecords.map((r) => ({ number: r.id, state: r.facets.closed ? 'CLOSED' : 'OPEN', facets: r.facets }));
```

For each sub-issue number resolved above (`work-backend: github-issues`), fetch its current state
**and labels** in one call — `gh issue view {n} --json state,labels` — to build the `subIssues`
array `parentGateState({subIssues, parentLabels})` (`bin/lib/issues/acceptance.js`) reads, with each
sub-issue's `facets` (`parseRecordFacets(labels)`, `bin/lib/issues/record.js`) attached alongside
`state`. `facets` is fetched here, once, and reused by the Oversight-floor check's `maxRiskTier`
call below — no second per-sub-issue round-trip.

Then fetch the **parent's** own current labels — the other argument that predicate takes, and
the one nothing above has produced yet. Both entry shapes need this: the parent-side entry
re-fetches them because its scan's snapshot is stale by approval time, and a sub-issue-side entry
has never read them at all (**Resolve the parent** yields only a number):

```bash
gh issue view $PARENT_NUM --json labels -q '[.labels[].name]'
```

`work-backend: local-files` — read the parent record instead and translate its
`facets.acceptance`, per **Evaluate the gate** below.

## Self-inclusion rule

**Sub-issue-side entries only** — see "Two entry shapes" above. The parent-side entry never has a
sub-issue mid-close, so every sub-issue's live state is read as-is, with no special-casing.

**Every sub-issue number in `$CLOSING_SUB_ISSUES` counts as `CLOSED`** when building the `subIssues`
array, regardless of what `gh` reports for it. `$CLOSING_SUB_ISSUES` is the set of sub-issues
*this run* is closing, supplied by the caller. Every sub-issue-side caller evaluates the gate
while its own sub-issues are still open — all three label **before** the close lands — so reading
their live state makes a parent's last sub-issues always evaluate `incomplete` and the gate never
fires.

The set overrides state; it never adds sub-issues. Only members of `$CLOSING_SUB_ISSUES` that
the enumeration above already returned are affected — a member belonging to a different parent,
or to no parent at all, is simply irrelevant to this parent's `subIssues` array.

**A sub-issue-side entry arriving without an explicit `$CLOSING_SUB_ISSUES` defaults to the
one-element set `{the sub-issue in hand}` — never to the empty set.** That default is what keeps
this rule a strict widening of the self-contained one it replaced rather than a replacement for
it: a caller that names no set still gets exactly the old behavior. The empty set would instead
make every sub-issue evaluate `incomplete` and label nothing, which is precisely the silent no-op
this rule exists to prevent and the `[IL-65]` mode named below — so a future fifth caller that
forgets to pass one degrades to correct-for-one-sub-issue, not to silence.

**Sizing the set to the run, not to the invocation.** There is one path here, not two: the
single-sub-issue case is the one-element set.

| Sub-issue-side caller | `$CLOSING_SUB_ISSUES` |
|---|---|
| `/claude-tweaks:wrap-up` Phase 4 execution (`wrap-up/execution-and-verification.md`) | the one sub-issue this run is closing |
| `/claude-tweaks:wrap-up`'s auto-merge short-circuit (`wrap-up/review-console.md`) | the one sub-issue this run is closing |
| `/claude-tweaks:dispatch`'s group auto-merge gate (`dispatch/settle-and-merge.md`) | **every** member of the group, on every one of its per-member invocations — that gate's single merge carries one `Fixes #{issue}` line per record, so the whole group closes together |

The two wrap-up entries close exactly one record per run, so their set has exactly one member —
the sub-issue in hand — and this rule reduces to "the sub-issue being closed counts as `CLOSED`".
For the group gate the set's size is the difference between the eager gate firing and not existing
at all: count only the sub-issue in hand and a group holding two or more sub-issues of one parent
evaluates `incomplete` on every one of them, labeling nothing — not the sub-issues, not the parent.

**Ruling (`#205`): stays a prose contract, not a shared helper.** A fifth caller inherits the
"default to `{the sub-issue in hand}`, never `{}`" rule above with nothing to catch a wrong value
if it passes one — the risk this table exists to flag. Given only three callers exist today, each
already reading this table before writing its own `$CLOSING_SUB_ISSUES` line, and a shared helper
would mean threading a new call through every one of them for a hazard the default clause already
closes (an omitted set can no longer silently label nothing — see above), the cost doesn't clear
the bar yet. Revisit as a real code change once a fourth sub-issue-side caller is added, when the
table stops being small enough to audit by eye on every new caller.

**The gate still fires once per parent.** The group gate's later invocations for the same
parent re-fetch the parent's labels (**Enumerate the parent's sub-issues** above does this
per invocation), read `gated`, and no-op — one brief and one `demo:pending`, never a second.

This is the `[IL-65]` failure mode: a same-function self-inconsistency that no test catches,
because the symptom is a silent no-op.

## Evaluate the gate

Call `parentGateState({ subIssues, parentLabels })`, where `parentLabels` is the parent's current
labels (`work-backend: github-issues`) or, under `work-backend: local-files`, the one-element
translation of its `facets.acceptance` (`parent.facets.acceptance ? ['demo:' + parent.facets.acceptance] : []`):

- `incomplete` — a sibling sub-issue is still open. No-op; this sub-issue's own closing proceeds
  with no acceptance labeling of any kind, neither its own nor the parent's.
- `gated` or `resolved` — the parent already carries a `demo:*` disposition. No-op.
- `due` — every sub-issue is closed and the parent carries no disposition yet. **Continue to the
  oversight-floor check below before composing anything** — `due` alone no longer opens the gate
  (`#367`).

**Oversight-floor check (risk only, never size).** Resolve `{riskFloor}`/`{sizeFloor}` the same
way the non-parent path's Oversight-floor gate does:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values risk-floor size-floor
```

Compute `maxTier = maxRiskTier(subIssues.map((s) => s.facets))` (`bin/lib/issues/oversight-floor.js`
— each sub-issue's already-fetched `risk:*` facets from **Enumerate the parent's sub-issues** above;
a sub-issue missing `risk` entirely, or carrying an out-of-vocabulary value, makes `maxTier` `undefined`
so the call below fails closed as `unscored` rather than being silently outvoted by its siblings).
Call:

```
exceedsOversightFloor({ risk: maxTier }, { riskFloor, sizeFloor: null })
```

**`sizeFloor` must be the literal `null` here — never the resolved size-floor value and never
omitted.** Per `#366`'s contract this is what makes a `facets` object carrying no `size` key
correctly return `exceeds: false` (when risk doesn't trip) instead of failing closed on a `size`
axis that was never meant to be evaluated at the parent level — parents carry no scoring of their
own (`specify/record-creation.md`'s Parent record section), so there is nothing to read there
regardless.

- **`exceeds: false`** — the parent closes cleanly: no `demo:pending`, no brief, same as a
  below-floor sub-issue record on the non-parent path. Stop here; do not compose the parent brief.
- **`exceeds: true`** — proceed to **Compose the parent brief** below, exactly as `due` alone
  used to trigger before this gate existed.

## Compose the parent brief

A parent brief consists of:

1. One verification item per `## Cross-Spec Promises` row on the parent, phrased as the claim
   to confirm — e.g. `F1: #48 assumed #46 exposes getStatus() — confirm it does.` Rows still
   `open` are included and marked unverified; they **do not** block the gate from opening. The
   register is deliberately not a hard gate anywhere (`skills/review/SKILL.md:173-175`).
2. One walkthrough of the feature's primary path across the assembled sub-issues. For this repo the
   runnable unit is a skill invocation, not a deploy — name the invocation and the observable
   outcome.

Where no register exists (fewer than 4 sub-issues — the threshold that was the
`promise-register-min-leaves` policy lever until its retirement in #331; removal trail:
`_shared/policy-deprecations.md` — or `work-backend: local-files`), part 2 alone is the brief.

Render the same `## Verification Brief` template Step 4 (`verification-brief.md`) renders, with:
**The ask** — the parent's own design summary (problem, chosen approach — `_shared/work-record.md`'s
Decomposition rules); **What shipped** — one-paragraph summary of what was delivered across the
assembled sub-issues; **Confirmed** — parts 1 and 2 above, in place of Step 4's kind-keyed Confirmed
branches; **`{poster}`** in the template's own footer — substitute the **skill** actually
running *this* composition (see the Routing table in `verification-brief.md`), never hardcode
`` `/claude-tweaks:wrap-up` ``: `` `/claude-tweaks:wrap-up` `` for either wrap-up entry (Phase 4's
execution step or the auto-merge short-circuit), `` `/claude-tweaks:dispatch` `` for the group auto-merge gate,
`` `/claude-tweaks:tidy` `` for the backstop entry. Omit the **Observation plan** section — part 2's
walkthrough already names the entry point inline within Confirmed. A parent brief carries the `### Branch`
section on the same condition Step 4 states — the durability record belongs to the run in hand,
not to the parent, so it is present exactly when that run produced one.

## Apply the gate

`work-backend: github-issues` — bootstrap `demo:pending` first, per `_shared/label-bootstrap.md`'s
check-then-create loop:

```js
LABELS_JSON = [
  ["demo:pending", "Acceptance: built and verified — awaiting human sign-off via /claude-tweaks:demo", "006B75"]
]
```

The same pair Step 1 (`verification-brief.md`) bootstraps for the default (non-parent-gate) path —
this procedure runs **in place of, not alongside** Step 1 (see the top of this section), so on a
repo where every `demo:pending` application has ever gone through this procedure, the label may
not exist yet at all. Both entry shapes need this — a sub-issue-side caller skips Step 1 exactly
the same way the parent-side one does.

**Then check whether a brief is already posted, before posting one** — and, when re-entering for
a parent that may already be partially applied, before even composing it above. A gate whose
comment landed but whose label add failed still reads `due`, so `/tidy`'s `Open parent gate`
action re-enters this section for that parent on every future run. Fetch the parent's comments
(`gh issue view $PARENT_NUM --json comments`, the same lookup `/claude-tweaks:demo`'s Step 1
already does) and test whether **any** of them contains a `## Verification Brief` heading **with
a `### Confirmed` section** — every comment on the parent, not just the most recent one, which a
human reply or a bot notification will routinely have displaced (this population is long-lived
open records that other people comment on, so a most-recent-only test reports "no brief" on a
parent that plainly has one, and posts a duplicate). The `### Confirmed` requirement matches
`execution-and-verification.md`'s verify check exactly (`#205`) — a hand-written comment that
merely quotes the `## Verification Brief` heading, with no `### Confirmed` section, no longer
counts as "already posted" here: skipping the real post on that input would leave the record
`demo:pending` with a brief that then fails verification, which is worse than the rare double-post
this guard exists to avoid.

If a brief is already present, the recovery is to **skip the comment entirely and apply only the
missing label**:

```bash
gh issue edit $PARENT_NUM --add-label demo:pending
```

That completes the gate — the rest of this subsection is already done for that parent. Never
blindly re-post.

Otherwise write the rendered template composed above (**Compose the parent brief**) to this run's
session-scoped `parent-verification-brief.md` (`_shared/session-tmp-root.md`), then:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PARENT_VERIFICATION_BRIEF=parent-verification-brief.md)"
gh issue comment $PARENT_NUM --body-file "$PARENT_VERIFICATION_BRIEF"
gh issue edit $PARENT_NUM --add-label demo:pending
```

Post the brief **before** adding the label — matching Step 4 (`verification-brief.md`)'s existing
invariant that a reader never sees `demo:pending` without a brief already attached.

**Partial-state note.** These are two independent `gh` calls, not one atomic write: if the comment
posts and the label add then fails (a transient `gh` error; the bootstrap above should make a
missing-label failure specifically impossible), report exactly which step failed — don't assume
all-or-nothing, the same rule `tidy/actions-github-issues.md`'s `Defer` action states for its own
multi-step sequence. The already-posted-brief check above is the recovery path out of exactly that
state: the next entry finds the brief, skips the comment, and adds the label alone.

`work-backend: local-files` — append the brief to the parent record's own body and set
`facets.acceptance = 'pending'` on the parent, the same write Step 4 (`verification-brief.md`)
performs for a non-decomposed record, applied to the parent's file instead of this sub-issue's.
`parentBriefTemplate` below is the same rendered template from **Compose the parent brief**,
above — no separate write to a temp file is needed for this backend, since the write below embeds
it directly. `parentPath` is the `.path` field of the parent's own record — a combined open+closed
`queryRecords('specs', {})` / `queryRecords('specs', { closed: true })` listing (the parent
itself carries no `facets.parent`, so this is a fresh query, not the sub-issue listing above),
filtered to the entry whose `.id === PARENT_ID`:

```js
const { readRecord, writeRecord } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
const parentRecord = readRecord(parentPath);
parentRecord.facets.acceptance = 'pending';
parentRecord.body = parentRecord.body + '\n\n' + parentBriefTemplate;
writeRecord(parentPath, parentRecord);
```
