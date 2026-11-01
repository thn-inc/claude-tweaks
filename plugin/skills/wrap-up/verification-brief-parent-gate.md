# Verification Brief — Parent-Gate Procedure

Read this file only when `verification-brief.md`'s Routing section has determined the record in
hand has a resolvable parent — a decomposed sub-issue, never the majority "no parent" case. This
is the compose-and-post detail for that one branch; `verification-brief.md` itself holds the
Routing decision, the non-parent Oversight-floor gate, and the default Steps 1-4 that the majority
of closes actually take.

The Routing section above routes here — in place of, not alongside, Steps 1-4 below — whenever
the record in hand has a resolvable parent.

## Two entry shapes

Every caller runs **Enumerate the parent's sub-issues** through **Evaluate the gate** unchanged.
The two shapes differ in how a caller arrives at `$PARENT_NUM`; past the gate, the post-merge
Step 4.0b entry also differs, as its bullet and the paragraphs after this list state:

- **Sub-issue-side entry** — the five sub-issue callers in the Routing table at the top of
  `verification-brief.md`: the three mid-close ones (`/claude-tweaks:wrap-up`'s Phase 4 execution
  step, `/claude-tweaks:wrap-up`'s auto-merge short-circuit, and `/claude-tweaks:dispatch`'s group
  auto-merge gate, the last running this procedure once per group member),
  `/claude-tweaks:dispatch`'s close-out step 3, at a later human-confirmed merge whose run never
  landed labeling, and `_shared/pr-first-merge-post-merge.md` Step 4.0b, the one **post-merge**
  entry. The first four run before their merge lands; Step 4.0b runs after it has landed and acts
  only on `due` with `exceeds: false`, where it runs **Close the parent below the floor** — every
  other gate outcome is a no-op for it. Each arrives holding a **sub-issue** number, plus
  `$CLOSING_SUB_ISSUES` — the set of sub-issue numbers its own run is closing, which the
  **Self-inclusion rule** below reads (one element for both wrap-up entries; the whole group for
  the dispatch gate; the PR's `Fixes` records for close-out; the merge's closing records for
  Step 4.0b). Step 4.0b also passes `$MERGING_PR` — the merged PR's number, empty on a no-PR
  local merge — which **Close the parent below the floor** reads for its listing lines. Run every
  section below in order, starting with **Resolve the parent**.
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

**Return to the Try it post (#2821).** A sub-issue-side entry, on every exit of this procedure —
`incomplete`, `gated`/`resolved`, `exceeds: false`, or `exceeds: true` after **Apply the gate** —
returns to `verification-brief.md`'s **Posting it alone** and posts this sub-issue's Try it block
(with any end-to-end variant appended to `"$TRY_IT"`). The one exception is the fail-open fallback
below, which hands this record to the no-parent path, so the block lands where that path's
Oversight-floor gate puts it: embedded in the record's own brief (Step 4's template) when it clears
the floor, posted alone (**Posting it alone**) when it does not. The parent-side
(`/claude-tweaks:tidy`) entry does not post one, and neither does the post-merge
`_shared/pr-first-merge-post-merge.md` Step 4.0b entry: it posts no Try it block and appends
nothing to `"$TRY_IT"`, since the run that delivered each sub-issue already posted its own.

**Transport (#4602).** With `gh` present, every call in this section runs as written. With `gh`
absent, each call runs through the GitHub MCP tool its `_shared/github-write-transport.md` row names
(that file's Detection rule), and the reads **Run the gate CLI** makes become MCP reads you write to
its facts file and hand it with `--facts-json`. The native parent read is `issue_read`
(`get_parent`) and the body-text read is `issue_read` (`get`); the native list is `issue_read`
(`get_sub_issues`, paged per its row); and every `gh issue view` read (the sub-issue's and the
parent's bodies, each sub-issue, the parent's labels, the parent's comments the CLI reads for
**Close the parent below the floor** (`parentComments`), and **Apply the gate**'s comment read) is
`issue_read` (`get`, plus `get_comments` for comments, paged per its row). `gh api user` is `get_me`;
`gh issue comment` is `add_issue_comment`; `gh issue close` and `gh issue edit --add-label` are
`issue_write` (update mode), the latter under the Full-replace hazard's read-merge-write.
`_shared/label-bootstrap.md`'s check-then-create loop has no MCP row: on the MCP path skip it, and a
label write that then fails is a failing call under the paragraph below. The CLI's normalizer
(`bin/lib/issues/mcp-parent-gate-shape.js`) normalizes the MCP shape before any rule below reads it:
it uppercases `state` and `state_reason` (`closed` → `CLOSED`, `completed` → `COMPLETED`,
`not_planned` → `NOT_PLANNED`, `reopened` → `REOPENED`), so `parentGateState` (which matches
`CLOSED` exactly), the close reason and the idempotence check read the `gh` path's values; it
reads the parent's labels as label names; and it takes `{pr}` from the last of the references
`closed_by_pull_requests` returns (at most 5 — a deterministic truncation that can name a different
PR than the `gh` path's uncapped list). On the MCP path a "`gh` call" in the
paragraphs below means the tool its row names. The default-branch read in Step 4.0b is
`git remote show origin` on that path (`_shared/integration-branch.md`'s rank-5 git read); when it
fails, or prints an empty or `(unknown)` branch, it is a failing call under the paragraph below,
which skips the whole of Step 4.0b.

**Fail open on every `gh` call in this section.** If neither `gh` nor the GitHub MCP server is
available, `gh` is present but unauthenticated (the Detection rule picks `gh` on presence alone, so
there is no fallback to MCP), the repo has no GitHub remote, or any parent-gate `gh` call below
fails: a **sub-issue-side** entry skips the Parent-Gate Procedure entirely and falls back to
the no-parent path (`verification-brief.md`'s Oversight-floor gate, then Steps 1-4 on this record
itself when it clears the floor) — never blocking the wrap-up, the auto-merge short-circuit, or
the dispatched group's merge gate. The post-merge `_shared/pr-first-merge-post-merge.md` Step 4.0b
entry is the sub-issue-side exception: on any failing `gh` call it skips that parent — or the
whole step, when the call is Step 4.0b's default-branch check — names each skipped parent in the
closing summary, and never falls back to the no-parent path — its merge has already landed, so
there is no wrap-up or merge left to protect, and `/claude-tweaks:tidy`'s `parent-gate` backstop is
the recovery. The **parent-side** entry skips this one parent for this run, leaving its
`[parent-gate]` finding surfaced and unmutated — never failing the whole `/tidy` run over one
parent's `gh` call. This paragraph is moot under `work-backend: local-files`, whose branches below
make no `gh` call at all; a filesystem error there is a real failure to report, not a fail-open
case.

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
end-to-end walkthrough, rendered as the brief's `### Try it — end to end` section
(`_shared/try-it.md`'s end-to-end variant) — is the only walk instruction a parent brief carries
(it omits the `### Observation plan` section, so `/claude-tweaks:demo` runs no Prepare/Validate/Show
for a parent — it renders that Try it section first and goes to the verdict). For a parent whose
assembled sub-issues touch UI, that walkthrough must therefore name the pages or journeys to open
and what to look for, not just the skill invocation — it is standing in for the safety net, not
summarizing it.

## Resolve the parent

**Sub-issue-side entries only** — see "Two entry shapes" above. The parent-side entry already
holds `$PARENT_NUM` and skips straight to "Enumerate the parent's sub-issues" below.

The CLI (`--sub-issue`) resolves the parent as `/claude-tweaks:review` Step 1.6 does — by
`facets.parent` under `work-backend: local-files`, else per `work-links` — and reports
`state: 'no-parent'` when there is none.

**No parent resolvable** (a record human-filed or `/capture`d directly, or one produced by a
`/specify` decomposition whose Step 2.6 collapse decision created no parent —
`specify/decomposition-mode.md`) — skip this section entirely: fall through to Steps 1-4 in
`verification-brief.md` and apply `demo:pending` to this record itself, exactly as today. The
exception is `_shared/pr-first-merge-post-merge.md` Step 4.0b's post-merge entry, for which no
resolvable parent is a no-op: no labeling, no Try it.

## Enumerate the parent's sub-issues

With a parent resolved (`$PARENT_NUM`), the CLI enumerates its sub-issues from the **parent**
side, never from a sub-issue-side scan, which works under one `work-links` mode and silently
returns nothing under the other. `work-links` (`_shared/work-record-config.md`) comes from
`.claude-tweaks/policy.yml`, overridable with `--work-links`. Every call re-reads the sub-issues
and the parent's labels, so the parent-side entry never reuses its scan's stale snapshot.

`work-backend: local-files` — the parent carries no task list
(`specify/record-creation-linking.md`), so its sub-issues are the records whose `facets.parent`
names it, and its `facets.acceptance` stands in for its labels, per **Evaluate the gate** below.

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

**One caller skips this rule:** the reconciler's late `post-merge` pass judges closing records by
live state (`selfInclude: false`), because it runs at least 10 minutes after the merge, when
GitHub's state is the truth — a sub-issue a human reopened since keeps its parent open.

**A sub-issue-side entry arriving without an explicit `$CLOSING_SUB_ISSUES` defaults to the
one-element set `{the sub-issue in hand}` — never to the empty set.** That default is what keeps
this rule a strict widening of the self-contained one it replaced rather than a replacement for
it: a caller that names no set still gets exactly the old behavior. The empty set would instead
make every sub-issue evaluate `incomplete` and label nothing, which is precisely the silent no-op
this rule exists to prevent and the `[IL-65]` mode named below — so a future sixth caller that
forgets to pass one degrades to correct-for-one-sub-issue, not to silence.

**Sizing the set to the run, not to the invocation.** There is one path here, not two: the
single-sub-issue case is the one-element set.

| Sub-issue-side caller | `$CLOSING_SUB_ISSUES` |
|---|---|
| `/claude-tweaks:wrap-up` Phase 4 execution (`wrap-up/execution-and-verification.md`) | the one sub-issue this run is closing |
| `/claude-tweaks:wrap-up`'s auto-merge short-circuit (`wrap-up/review-console.md`) | the one sub-issue this run is closing |
| `/claude-tweaks:dispatch`'s group auto-merge gate (`dispatch/settle-and-merge.md`) | **every** member of the group, on every one of its per-member invocations — that gate's single merge carries one `Fixes #{issue}` line per record, so the whole group closes together |
| `/claude-tweaks:dispatch`'s close-out step 3 (`dispatch/close-out.md`) | the PR's `Fixes` record numbers — the one merge it confirms closes them all |
| `_shared/pr-first-merge-post-merge.md` Step 4.0b | the merge's closing records — GitHub can still report a just-merged sub-issue `OPEN` for a few seconds after the merge |

The two wrap-up entries close exactly one record per run, so their set has exactly one member —
the sub-issue in hand — and this rule reduces to "the sub-issue being closed counts as `CLOSED`".
For the group gate the set's size is the difference between the eager gate firing and not existing
at all: count only the sub-issue in hand and a group holding two or more sub-issues of one parent
evaluates `incomplete` on every one of them, labeling nothing — not the sub-issues, not the parent.

**Ruling (`#205`): stays a prose contract, not a shared helper.** Each caller added
since inherits the "default to `{the sub-issue in hand}`, never `{}`" rule above with nothing to
catch a wrong value if it passes one — the fifth, Step 4.0b (#4466), did inherit it — the risk this table
exists to flag. When three callers existed, each
already reading this table before writing its own `$CLOSING_SUB_ISSUES` line, and a shared helper
would mean threading a new call through every one of them for a hazard the default clause already
closes (an omitted set can no longer silently label nothing — see above), the cost didn't clear
the bar. The revisit condition — a fourth sub-issue-side caller — was met by close-out step 3
(#3783); the shared-helper decision is a backlog record of its own, not settled here. Since #4603
the CLI applies the default itself (`--sub-issue {n}` with no `--closing` counts `{n}`), so an
omitted set can no longer reach the gate. A wrong value still can, which is why the table stays.

**The gate still fires once per parent.** The group gate's later invocations for the same
parent re-fetch the parent's labels (**Enumerate the parent's sub-issues** above does this
per invocation), read `gated`, and no-op — one brief and one `demo:pending`, never a second.

This is the `[IL-65]` failure mode: a same-function self-inconsistency that no test catches,
because the symptom is a silent no-op.

## Run the gate CLI

`bin/parent-gate.js` applies the sections above (**Resolve the parent**, **Enumerate the parent's
sub-issues** and the **Self-inclusion rule**) and **Evaluate the gate**'s state and floor rules
below as code, in one call. Run it as its own Bash call, once per entry, and route on the one JSON
verdict line it prints.

Sub-issue-side entry under `work-backend: github-issues`, where `{closing-sub-issues}` is
`$CLOSING_SUB_ISSUES` comma-joined, sized by the table above:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js" --sub-issue {n} --closing {closing-sub-issues}
```

These pre-merge entries never pass `--idempotence`: they never run **Close the parent below the
floor**, so the CLI reads neither the parent's comments nor the current `gh` identity for them.
Step 4.0b, which does run that section, passes `--idempotence` on its own command line.

Sub-issue-side entry under `work-backend: local-files`: it runs **Close the parent below the
floor** now (the `exceeds: false` bullet below), so it also adds `--idempotence`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js" --sub-issue {n} --closing {closing-sub-issues} --idempotence --backend local-files
```

Parent-side entry (`/claude-tweaks:tidy`, which runs **Close the parent below the floor** from
it), adding `--backend local-files` under that driver:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js" --parent {parent-number} --idempotence
```

**With `gh` absent** (the Detection rule's MCP path, or exit 2 below), take this path once. Fetch
each read per the **Transport (#4602).** paragraph, then resolve the facts file's path as its own
call (`_shared/session-tmp-root.md`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value parent-gate-facts.json
```

Write one JSON object to the printed path with the Write tool. Record each MCP `get` result whole,
never reshaped, and write only the keys this entry's mode needs:

- `parentLink` — `get_parent` of the sub-issue in hand, or `null` when it has none: a
  sub-issue-side entry under `work-links: native`.
- `subIssueGet` — `get` of the sub-issue in hand: a sub-issue-side entry under
  `work-links: body-text`.
- `subIssueList` — every `get_sub_issues` entry of the parent, all pages concatenated: under
  `work-links: native`, once a parent resolved.
- `parentGet` — `get` of the parent, once a parent resolved.
- `subIssueGets` — an object keyed by each enumerated sub-issue's number, its value that
  sub-issue's `get`: exactly one key per number the parent's sub-issue list or task list names.
- `parentComments` — every `get_comments` entry of the parent, all pages concatenated.
- `me` — `get_me`.

`parentComments` and `me` are needed only on an `--idempotence` call whose `parentGet` reads open
and not `reopened`. Then add `--facts-json {facts-file}` to the entry's command line above, with the
printed path in place of `{facts-file}`. If any MCP read fails, write no file: that is a failing
call under the **Fail open on every `gh` call** paragraph.

The verdict carries one field each:

- `parent` — the parent's number (`null` with none): the `$PARENT_NUM` the later Close and Apply
  fences use.
- `state` — `incomplete`, `gated`, `resolved` or `due` (**Evaluate the gate**), or `no-parent`.
- `exceeds` — the oversight-floor result on `due`; otherwise `null`.
- `closeReason` — `completed` or `not planned` on `due` with `exceeds: false` (step 3's close
  reason); otherwise `null`.
- `idempotence` — **Close the parent below the floor** step 1's value, on an `--idempotence` call
  that is `due` with `exceeds: false`; otherwise `null`.
- `maxTier` — the highest sub-issue `risk:*` tier, `null` when a sub-issue is unscored.
- `riskFloor` — the `risk-floor` the CLI resolved.
- `parentIssue` — whether the parent carries `parent-issue`.
- `needs` — the parent's `needs:*` labels.
- `held` — the enumerated sub-issues that `--held` names.
- `subIssues` — each enumerated sub-issue in number order, after the **Self-inclusion rule**:
  `number`, `title`, `state`, `stateReason` and `pr` (`null` with no PR).
- `skipped` — each untrusted heading comment step 1 did not count.

Route on its exit code:

- **0** — route the verdict.
- **Under `work-backend: local-files`, any non-zero exit** — report the failure and stop that
  entry; never fail open. A filesystem error there is a real failure to report, as **Close the
  parent below the floor** step 5 states.
- **Exit 2 on the `gh` path with `gh` absent** (its message names `--facts-json`) — take the
  gh-absent path above, once.
- **Exit 2 under `--facts-json`** — it can only mean no GitHub remote for a qualified `--closing`
  token, an undeterminable repository root and working directory, or an unreadable or invalid
  `.claude-tweaks/policy.yml` (the stderr line names the file): a failing `gh` call under **Fail open on every `gh` call**, never the gh-absent path
  again, so the two paths cannot loop.
- **Any other non-zero exit on the `gh` or `--facts-json` path** — a failing `gh` call under
  **Fail open on every `gh` call**.

Whenever an exit fails open, quote the CLI's stderr line in the entry's output: exit 1 is a
malformed invocation, a bug in the calling skill, and only that line tells it apart from a `gh`
outage.

## Evaluate the gate

The verdict's `state` is `parentGateState({ subIssues, parentLabels })`'s
(`bin/lib/issues/acceptance.js`), over the enumerated sub-issues with the **Self-inclusion rule**
applied and the parent's current labels (`work-backend: github-issues`) or, under
`work-backend: local-files`, the acceptance label its `facets.acceptance` translates to:

- `incomplete` — a sibling sub-issue is still open. No-op; this sub-issue's own closing proceeds
  with no acceptance labeling of any kind, neither its own nor the parent's.
- `gated` or `resolved` — the parent already carries an acceptance disposition, in either label spelling (`_shared/work-record.md`). No-op.
- `due` — every sub-issue is closed and the parent carries no disposition yet. **Continue to the
  oversight-floor check below before composing anything** — `due` alone no longer opens the gate
  (`#367`).

**Oversight-floor check (risk only, never size).** On `due`, `exceeds` says whether the highest
sub-issue `risk:*` tier (`maxTier`) reaches the `risk-floor` (`riskFloor`, resolved from
`.claude-tweaks/policy.yml`, overridable with `--risk-floor`). A sub-issue with no `risk`, or an
out-of-vocabulary one, fails the check closed as `unscored`, never outvoted by its siblings. The
size axis is never evaluated (`#366`): parents carry no scoring of their own
(`specify/record-creation.md`'s Parent record section). This section routes on `state` and
`exceeds` only: `parentIssue`, `needs` and `held` are Step 4.0b's
(`_shared/pr-first-merge-post-merge.md`).

- **`exceeds: false`** — no `demo:pending`, no brief, same as a below-floor sub-issue record on
  the non-parent path. Do not compose the parent brief. The parent still has to be closed, and
  the entry decides when:
  - **Sub-issue-side entry, `work-backend: github-issues`:** a pre-merge caller leaves the parent
    open, because this run's merge has not landed yet. `_shared/pr-first-merge-post-merge.md`'s
    Step 4.0b closes it after the merge lands: that post-merge entry runs
    **Close the parent below the floor** here. A merge no session saw land is closed by the
    reconciler's `post-merge` check, which runs this gate's own code (`bin/lib/issues/parent-gate.js`,
    through `bin/lib/issues/below-floor-parent-close.js`) except that it skips the **Self-inclusion
    rule**; `/claude-tweaks:tidy`'s `parent-gate` backstop catches whatever that leaves open.
  - **Sub-issue-side entry, `work-backend: local-files`:** run **Close the parent below the floor**
    now, and commit the parent record with the entry's own close commit. The parent is
    never closed ahead of the merge, per that section's step 5.
  - **Parent-side entry (`/claude-tweaks:tidy`):** run **Close the parent below the floor**.

  The walkthrough is not gated (#2821): on a sub-issue-side entry other than Step 4.0b, compose
  the end-to-end variant (`_shared/try-it.md`) across the assembled sub-issues and append it to
  this run's `"$TRY_IT"` file (`verification-brief.md`'s **Try it block**), so it posts with the
  sub-issue's own block and reaches the Pipeline Summary. Parent-side entry
  (`/claude-tweaks:tidy`): no walkthrough — no delivering run exists to carry it.
- **`exceeds: true`** — proceed to **Compose the parent brief** below, exactly as `due` alone
  used to trigger before this gate existed. On a sub-issue-side entry, append the same end-to-end
  variant that brief carries to `"$TRY_IT"` too, as on `exceeds: false` — one rule for both
  outcomes, so the run that opens the parent gate shows the end-to-end path in its Pipeline Summary.

## Close the parent below the floor

Runs only on `due` with `exceeds: false`, from the entries **Evaluate the gate**'s `exceeds: false`
bullet names. A pre-merge sub-issue-side entry under `github-issues` never runs this section.
It writes no acceptance label — never `demo:pending`, `demo:approved` or
`demo:changes-requested` — and composes no Verification Brief: below the floor no sign-off is owed,
so the closing comment records why the parent closed rather than asking anyone to accept it.

**1. Idempotence — route on the verdict before writing anything.** Every entry that reaches this
section ran **Run the gate CLI** with `--idempotence`, so it read the parent's state, `stateReason`
and comments, and the current `gh` identity, and its `idempotence` field says what to do:

- `already-closed`: A parent already `CLOSED` is a no-op: an earlier entry, or a human, closed it.
- `reopened`: An open parent whose `stateReason` is `REOPENED` is a no-op too, reported in the
  output and never re-closed: a human reopened it after an earlier close.
- `close-only`: a comment carries a `## Closed below the oversight floor` heading line, counting
  only a comment from a trusted author (`_shared/pr-run-comments.md`'s Trusted authors) or from
  the current `gh` identity (the CLI reads its login), since the plugin's own bot or app token can
  post under an untrusted author association. An earlier run posted the comment and its close
  then failed: run only step 3's close call, with no second comment.
- `comment-and-close`: run steps 2 and 3. Any other comment carrying the heading reads as no
  comment posted, and the verdict's `skipped` names each one; name each in that section's skip
  notice in the output, since planting a heading must not suppress the real comment.

Under `work-backend: local-files` the CLI reads the parent record instead: `already-closed` is a
set `facets.closed`, `close-only` a body already holding the heading, and `reopened` never occurs;
step 5's fence repeats both checks. Steps 2 and 3 take `{maxTier}`, `{riskFloor}`, each listing
line's `{n}`, `{title}` and `{pr}` (`subIssues[]`; a `null` `pr` means no suffix) and the close
reason (`closeReason`) from the same verdict.

**2. Compose the closing comment:**

```markdown
## Closed below the oversight floor

Every sub-issue of this decomposition is closed, and the highest sub-issue risk, `risk:{maxTier}`, does not exceed the resolved `risk-floor` (`{riskFloor}`), so no Verification Brief or `demo:pending` sign-off is owed.

- #{n} {title} — closed by PR #{pr}
```

When step 3 closes with `"not planned"`, add the line
`No sub-issue closed as completed, so this parent closes as not planned.` after the template's
first paragraph.

One listing line per sub-issue **Enumerate the parent's sub-issues** returned, in number order.
`{title}` is the verdict's `subIssues[].title`. For a `$CLOSING_SUB_ISSUES` member,
`{pr}` is `$MERGING_PR` when it is non-empty (**Two entry shapes** above): that PR's merge is the
one that closed it, and GitHub may not have linked it yet a few seconds after the merge.
Otherwise `{pr}` is the `number` of the sub-issue's `closedByPullRequestsReferences` entry the
CLI read (the last one when it lists several — an entry carries only `id`, `number`,
`repository` and `url`, no state or merged field, so this fallback is arbitrary but
deterministic). A sub-issue left with no `{pr}` either way is listed as `- #{n} {title}`, with
no suffix. Never write a merge SHA
in place of a missing PR number: a line names a PR or carries no suffix. Under
`work-backend: local-files` each line is `- {id} {title}`, from the verdict's `subIssues[]`
(`number`, `title`) — no PR data exists there.

**3. Write, comment, close** (`work-backend: github-issues`). Resolve this run's session-scoped
temp path (`_shared/session-tmp-root.md`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value parent-close-comment.md
```

Write the composed comment to the printed path with the Write tool, then run each call below as
its own command, with that literal path in place of `{parent-close-comment}`:

```bash
gh issue comment $PARENT_NUM --body-file "{parent-close-comment}"
```

Close with `--reason completed` only when at least one sub-issue closed `COMPLETED` (its
`stateReason`, from **Enumerate the parent's sub-issues**; a `$CLOSING_SUB_ISSUES` member counts
as `COMPLETED`, since its merge closes it):

```bash
gh issue close $PARENT_NUM --reason completed
```

Otherwise every sub-issue closed not planned or duplicate — nothing shipped, which
`bin/lib/issues/acceptance.js`'s `needsBackstop` likewise treats as nothing to accept — so close
with:

```bash
gh issue close $PARENT_NUM --reason "not planned"
```

With `gh` absent, post the same file's text with `add_issue_comment` and close with `issue_write`
(`update` mode, `state: closed`, `state_reason` `completed` or `not_planned`), per
`_shared/github-write-transport.md`'s Comment and Close rows; never pass `labels` on the close call.

Comment first, then close, so a reader of the closed parent always finds the reason attached.

**4. Partial state.** These are two independent `gh` calls. If one fails, report exactly
which call failed — don't assume all-or-nothing — and never fall back to the no-parent path: no
record of the entry's own is waiting on this close. A comment that posted before a failed close
leaves the parent open with a heading comment step 1 counts, so a rerun's step-1 check closes it
without a second comment; when no session reruns it, `/claude-tweaks:tidy`'s `parent-gate`
backstop surfaces the still-open parent and finishes it.

**5. `work-backend: local-files`** — the same steps through the store, with no `gh` call.
`parentPath` is resolved exactly as **Apply the gate** below resolves it. Resolve
`{parent-close-comment}` and Write the comment composed in step 2, with `- {id} {title}` listing
lines, to it with the Write tool, as step 3 does, so no record title passes through JS source:

```js
const fs = require('fs');
const { readRecord, writeRecord, closeRecord } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
const parentCloseSection = fs.readFileSync('{parent-close-comment}', 'utf8').trimEnd();
const parentRecord = readRecord(parentPath);
if (!parentRecord.facets.closed) {
  if (!/^## Closed below the oversight floor\s*$/m.test(parentRecord.body)) {
    parentRecord.body = parentRecord.body + '\n\n' + parentCloseSection;
    writeRecord(parentPath, parentRecord);
  }
  closeRecord(parentPath);
}
```

A parent whose `facets.closed` is already set is a no-op; a body already holding the heading means
`closeRecord` alone. `closeRecord` re-reads the file, so calling it after `writeRecord` keeps the
appended section. A filesystem error is a real failure to report, never a fail-open case. On a
sub-issue-side entry, log the close when a run directory is set — it is an auto-resolution under
`_shared/auto-mode-contract.md`'s exception, so it carries the same audit line as Step 4.0b's:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "Parent-Gate local-files close" --reversibility "high (clear the parent record's closed facets)" --text "closed parent {id} below the oversight floor (risk:{maxTier}, risk-floor {riskFloor})"
```

Then commit the parent record file with the entry's own close commit — its next
commit after labeling; for `/claude-tweaks:wrap-up` that is the execution step's summarizing
commit (`wrap-up/execution-and-verification.md`). When the entry has no later commit before its
merge (the auto-merge short-circuit), commit the parent record file itself before the merge, with
a `{Verb} … — refs #{parent}` subject, and, under `pr-first`, push it before the merge, so the
squash carries it. The parent is never closed ahead of the merge: on wrap-up's
execution step the commit follows the merge of `wrap-up/cleanup-procedures.md`'s item 4 (Git
worktree), and on the auto-merge short-circuit labeling and the commit happen on the run's branch
before its merge.

## Compose the parent brief

A parent brief consists of:

1. One verification item per `## Cross-Spec Promises` row on the parent, phrased as the claim
   to confirm — e.g. `F1: #48 assumed #46 exposes getStatus() — confirm it does.` Rows still
   `open` are included and marked unverified; they **do not** block the gate from opening. The
   register is deliberately not a hard gate anywhere (`skills/review/SKILL.md:173-175`).
2. One walkthrough of the feature's primary path across the assembled sub-issues — the
   end-to-end variant of `_shared/try-it.md`, rendered as the brief's `### Try it — end to end`
   section.

Where no register exists (fewer than 4 sub-issues — the threshold that was the
`promise-register-min-leaves` policy lever until its retirement in #331; removal trail:
`_shared/policy-deprecations.md` — or `work-backend: local-files`), part 2 alone carries the brief, and `### Confirmed` reads `No cross-spec promise register — walk the end-to-end path in Try it above.` (the section stays: the already-posted check below and `engine-verify.js` both key on it).

Render the same `## Verification Brief` template Step 4 (`verification-brief.md`) renders, with:
**The ask** — the parent's own design summary (problem, chosen approach — `_shared/work-record.md`'s
Decomposition rules); **What shipped** — one-paragraph summary of what was delivered across the
assembled sub-issues; **Confirmed** — part 1 above, in place of Step 4's kind-keyed Confirmed
branches; **Try it** — part 2, in place of Step 4's per-record Try it block; **`{poster}`** in the template's own footer — substitute the **skill** actually
running *this* composition (see the Routing table in `verification-brief.md`), never hardcode
`` `/claude-tweaks:wrap-up` ``: `` `/claude-tweaks:wrap-up` `` for either wrap-up entry (Phase 4's
execution step or the auto-merge short-circuit), `` `/claude-tweaks:dispatch` `` for the group auto-merge gate,
`` `/claude-tweaks:tidy` `` for the backstop entry. Omit the **Observation plan** section — part 2's
Try it section already names the entry point. A parent brief carries the `### Branch`
section on the same condition Step 4 states — the durability record belongs to the run in hand,
not to the parent, so it is present exactly when that run produced one.

## Apply the gate

`work-backend: github-issues` — bootstrap the acceptance labels below first, per `_shared/label-bootstrap.md`'s
check-then-create loop:

```js
LABELS_JSON = [
  ["demo:pending", "Acceptance: built and verified — awaiting human sign-off via /claude-tweaks:demo", "006B75"],
  ["accept:pending",           "Acceptance: built and verified — awaiting the human's acceptance verdict", "006B75"],
  ["accept:approved",          "Acceptance: a human verified this record does what was asked", "006B75"],
  ["accept:approved-batch",    "Acceptance: approved in one batch verdict — no per-record walkthrough", "006B75"],
  ["accept:changes-requested", "Acceptance: a human found a gap — see the linked follow-up record", "006B75"]
]
```

The same rows Step 1 (`verification-brief.md`) bootstraps for the default (non-parent-gate) path —
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
a `### Confirmed` section** — counting only a comment from a trusted author
(`_shared/pr-run-comments.md`'s Trusted authors; an untrusted comment carrying the heading reads as
no brief posted, and each one skipped is named in that section's skip notice in the gate's output,
since planting a heading must not suppress the real post) — every comment on the parent, not just the most recent one, which a
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
PARENT_VERIFICATION_BRIEF="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value parent-verification-brief.md)"
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
`queryRecords('specs', {})` / `queryRecords('specs', { closed: true })` listing, filtered to the
entry whose `.id` is the verdict's `parent` (`$PARENT_NUM`):

```js
const { readRecord, writeRecord } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
const parentRecord = readRecord(parentPath);
parentRecord.facets.acceptance = 'pending';
parentRecord.body = parentRecord.body + '\n\n' + parentBriefTemplate;
writeRecord(parentPath, parentRecord);
```
