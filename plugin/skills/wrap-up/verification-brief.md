# Wrap-Up — Verification Brief Procedure

Canonical procedure for the acceptance-labeling action: applying `demo:pending` and posting
the Verification Brief. Record mode only (a record is identified for this run, per
`/claude-tweaks:wrap-up` Phase 1 — a materialized header is not required) — conversation-based
work has no work record to label, so this procedure does not run for it.

## Routing — read this before anything else, whatever invoked this file

**The routing below is this file's decision, not its caller's.** Every call site lands here
first and inherits it, so a new one never has to re-derive the condition (and cannot get it
wrong by omission). Five call sites exist today:

| Caller | Arrives holding |
|---|---|
| `/claude-tweaks:wrap-up` Phase 4 execution's Acceptance-labeling bullet (`wrap-up/execution-and-verification.md`) | one **sub-issue**, mid-close |
| `/claude-tweaks:wrap-up`'s auto-merge short-circuit (`wrap-up/review-console.md`) | one **sub-issue**, mid-close |
| `/claude-tweaks:dispatch`'s group auto-merge gate (`dispatch/settle-and-merge.md`) | one **sub-issue** per group member, mid-close — plus the group's whole closing sub-issue set (see the Self-inclusion rule) |
| `/claude-tweaks:dispatch`'s close-out step 3 (`dispatch/close-out.md`) | one or more **sub-issues** (the PR's `Fixes` records), at a later human-confirmed merge |
| `/claude-tweaks:tidy`'s `Open parent gate` action (`tidy/actions-github-issues.md`, or `tidy/actions-local-files.md` on that driver) | a **parent** number (`$PARENT_NUM`) directly |

**Whatever invoked this file: if the record in hand has a resolvable parent, run the
Parent-Gate Procedure below in place of — not alongside — Steps 1-4.** A decomposed sub-issue
never carries its own `demo:pending`; its parent carries one gate for all of them. This
holds on every path equally, including the two that bypass Phase 4's execution step entirely: an `auto:merge`'d
sub-issue is precisely the population `_shared/github-pr-scan-acceptance.md`'s `parent-gate` backstop scope
exists to catch, so giving it its own gate here would both defeat the parent acceptance gate and
falsify that scope's stated reason for existing. `auto:merge` governs merge timing only — it does not
change the unit of acceptance.

**Otherwise — no resolvable parent** (a record human-filed or `/capture`d directly, not
produced by a `/specify` decomposition) — run the **Oversight-floor gate** below, then Steps 1-4,
applying `demo:pending` to the record itself only when the gate says the record clears the floor.

**Before either branch, on every record-holding entry** (a no-parent record, or a sub-issue-side
entry into the Parent-Gate Procedure — not the parent-side `/claude-tweaks:tidy` entry below,
which holds no delivering record of its own): compose this record's Try it block — the next section. Neither the Parent-Gate Procedure nor the Oversight-floor gate gates it (#2821); they decide only where it lands.

A caller that already holds a **parent** number is inside the Parent-Gate Procedure by
construction — there is no sub-issue to resolve, so it starts at **Enumerate the parent's
sub-issues**.

## Try it block (every record, before either branch)

Compose this record's `### Try it` block per `_shared/try-it.md` (shape, sources, rules — cited, not
restated here) now, before the Parent-Gate Procedure or the Oversight-floor gate runs, and write it
to the session-scoped file that `/claude-tweaks:flow`'s Pipeline Summary reads back:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" TRY_IT=try-it-{N}.md)"
```

Write the composed block to `"$TRY_IT"`. Shell variables do not survive between calls, so any
later step that uses `$TRY_IT` — the posting fence below, the parent gate's append in
`verification-brief-parent-gate.md`, and Step 4's template read — re-runs that resolve line first. Where it lands is the branch's decision: a record with no
resolvable parent that clears the floor embeds it in its brief (Step 4's template); every other
record posts it alone, below.

**Posting it alone** — a record below the floor (`exceeds: false`), or any parent-linked sub-issue
(post that one after the Parent-Gate Procedure returns, so an end-to-end variant it appended rides
along). Under `_shared/pr-run-comments.md`'s gate (`run-state.json` carries a `pr` object), post it
as the `try-it` kind, marker `<!-- run-comment: try-it -->` in a single-spec run, or, when
`$MULTISPEC_PARENT_DIR` is set (a multi-spec `/claude-tweaks:flow` run sharing one PR across
specs), the `try-it:{N}` kind, marker `<!-- run-comment: try-it:{N} -->` — the same spec
qualification the `verdict` kind uses (`_shared/pr-run-comments.md`'s "Multi-spec verdict
comments" section):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" TRY_IT=try-it-{N}.md)"
KIND=try-it; [ -n "$MULTISPEC_PARENT_DIR" ] && KIND="try-it:{N}"
printf '<!-- run-comment: %s -->\n\n' "$KIND" | cat - "$TRY_IT" > "$TRY_IT.pr"
# find-or-create per _shared/pr-run-comments.md's post-or-update procedure, kind=$KIND, against {pr-number}
```

No `pr` object (`local-merge`, or a degraded `pr-first` run): post nothing — the
Pipeline Summary carries it. A below-floor record gets no comment on the issue; the floor still
means no ceremony there.

## Parent-Gate Procedure (parent-linked sub-issues)

The Routing section above routes here — in place of, not alongside, Steps 1-4 below — whenever
the record in hand has a resolvable parent. This is the minority path (a decomposed sub-issue,
not the general one-off record) — read `verification-brief-parent-gate.md` in this skill's
directory and follow it in full, in place of the rest of this file, whenever that condition
holds. It covers, in order: the two entry shapes, what it deliberately skips (Step 2.5's
visual-review safety net), Resolve the parent, Enumerate the parent's sub-issues, the
Self-inclusion rule, Evaluate the gate (including its own Oversight-floor check), Compose the
parent brief, and Apply the gate.

**No parent resolvable** — skip straight to Steps 1-4 below and apply `demo:pending` to this
record itself, exactly as the non-parent path always has.

## Oversight-floor gate (non-parent path only)

`#367` — makes the gate below conditional on `exceedsOversightFloor` (`bin/lib/issues/oversight-floor.js`,
from #366) rather than unconditional. **Parent-linked records never reach this section** — the
Parent-Gate Procedure (`verification-brief-parent-gate.md`) has its own, separate risk-only
aggregation in its own **Evaluate the gate**; this section is the non-parent path's equivalent,
run in its place.

Resolve `{riskFloor}`/`{sizeFloor}` and this record's own `risk:*`/`size:*` facets
(`parseRecordFacets(labels)`, `bin/lib/issues/record.js` — the same labels already fetched to
reach this file):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values risk-floor size-floor
```

Call `exceedsOversightFloor({ risk: facets.risk, size: facets.size }, { riskFloor, sizeFloor })`.

- **`exceeds: false`** — this record does not clear the oversight floor. **Skip Step 1 through
  Step 4 entirely** — no `demo:pending` bootstrap, no observation plan, no brief composed or
  posted. The walkthrough is not skipped: the Try it block composed above posts alone
  (**Posting it alone**), and the Pipeline Summary renders it. The record closes with no `demo:*` label and no ceremony (this is the *not required*
  outcome, not a `demo:exempt` marker — see the design's Non-Goals). It stays demoable later on
  request: `/claude-tweaks:demo #N`'s existing closing-commit-reconstruction fallback already
  resolves a record carrying no `demo:pending` label, unchanged by this gate.

  Record the exemption (#2383) so `wrap-up-engine.js verify`'s `acceptance-labeling` check knows
  this record was deliberately skipped, not silently missed: add `N` to
  `$PIPELINE_RUN_DIR/verify-expectations.json`'s `oversightExempt` array through the sanctioned
  writer (#2764) — it creates the file with the version-1 defaults when absent, unions `N` into
  the array, and preserves every other field, as the console's own later write
  (`review-console.md` step 11) does:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --oversight-exempt {N}
  ```

  Exit 3 from that writer means the run dir is wrong — re-resolve `$RUN_ROOT` per
  `_shared/pipeline-run-dir.md` and retry; exit 2 is a malformed call to fix, never a reason to
  fall back to a direct Write.
- **`exceeds: true`** (including `reason: 'unscored'` — a missing or out-of-vocabulary
  `risk`/`size` facet fails closed) — proceed to Step 1 exactly as before this gate existed.

Log the outcome to `decisions.md` either way (`_shared/auto-decision-log.md`): `AUTO` status,
rationale = the `reason` field (or `null` on a pass), reversibility = high (the closing-commit
fallback covers a skipped gate; a human can still `/demo #N` it).

## Step 1: Bootstrap the Acceptance labels

Run the check-then-create loop from `_shared/label-bootstrap.md` with:

```js
LABELS_JSON = [
  ["demo:pending", "Acceptance: built and verified — awaiting human sign-off via /claude-tweaks:demo", "006B75"]
]
```

Only `demo:pending` is bootstrapped here — `/wrap-up` never applies the other two acceptance
labels (see `_shared/work-record.md`'s permission matrix).

## Step 2: Author the observation plan

Resolve `{base}` (used here and in Step 3 below) by `summary-template.md`'s `{base}` rule.

Pick the plan's `Surface` kind by judgment from what this run actually did — not from a path
classifier — per `skills/_shared/observation-plan.md`'s schema, grammar, and per-kind semantics
(cited there, stated once; not restated here). That file's precedence rule governs when the
changed-file list includes UI, route, or rendered-content code: `app-route`/`rendered-page` take
precedence there, and choosing `cli`/`flow`/`diff` anyway needs a one-line justification written
into the plan's own text.

Author the plan's Entry point, Prepare, and Inspect fields per that schema. For a run with no
UI/route surface, the old non-interactive guidance still applies, folded into the matching kind:

- A changed skill or harness file — pick `flow`; the Inspect pointer names the specific behavior
  to exercise (a step number, a branch, a template section), not "read the skill."
- Changed `bin/` code — pick `cli`; the Entry point is the command to run, and the Inspect
  pointer is its expected output (e.g. the module's own test file and its pass output, or a
  one-line `node -e` exercising the changed function).
- A changed doc or config file — pick `diff`; the Inspect pointer names the specific claim or
  setting to check against current behavior.

`app-route`/`rendered-page` plans — continue to Step 2.5. `cli`/`flow`/`diff` plans — skip Step
2.5 and go straight to Step 3.

## Step 2.5: Visual-Review Safety-Net Gate (app-route/rendered-page plans only)

Skip this step when the plan's kind is `cli`, `flow`, or `diff` (Step 2) — there is nothing to walk.

Read this run's `/claude-tweaks:review` summary — the `### Visual Review` section's `**Status:**`
field (`review-summary-template.md`). Branch on its value:

| Status value | Meaning | Action |
|---|---|---|
| `Completed (code + visual)` or `Completed (code + visual, QA-enriched)` | A full browser walk already ran; any bug it found was already fixed and reverified through `/review`'s Step 3 Routing before `/review` could PASS | Proceed to Step 3 — no further action |
| `Recommended — journeys affected` or `Recommended — UI changed (no journeys)` | Only recommendation mode ran — no browser walk happened | Trigger the gate below |
| `Skipped — no UI changes` | `/review` read the diff and found no UI, but Step 2's plan kind can still be `app-route`/`rendered-page` — the builder picks the kind from judgment, not from `/review`'s own signal, so a backend-only change can still land here | Treat as `Recommended` — trigger the gate below and let `/visual-review`'s own detection re-confirm. It costs a walk that finds nothing; the reverse error skips acceptance on a real UI change |
| `Skipped — browser tools not configured` or `Completed (code only — no browser)` | Nothing was walked, nothing can be — the latter is full-mode `/review` completing with a code-only fallback when no browser backend was available at invocation, same practical outcome as the former | See the browser-unavailable fallback below |
| No `/review` summary available for this run (standalone `/wrap-up`, no recent `/review` run) | No signal exists | Treat as `Recommended` — trigger the gate below |

**Trigger the gate** (`Recommended` / no-summary / `Skipped — no UI changes` cases): invoke
`/claude-tweaks:visual-review` now, passing `--source wrap-up` (the explicit flag is the stable
statement of parent invocation — the same one `skills/wrap-up/SKILL.md`'s Phase 1 reflect pass
already passes to `/claude-tweaks:reflect` on every run), using the same mode
resolution `/review` Step 6 already applies — `journey:{name}` when a journey was named (by the
recommendation, or by matching
`docs/journeys/*.md` against the changed files), otherwise page mode against the resolved
`APP_URL` (`dev-url-detection.md`), otherwise discover mode. Route every finding through the same
severity floors `_shared/criteria-review-quality.md` defines: **high/critical** (broken layout,
accessibility barrier, functional defect) blocks — dispatch a fix the same way `/review`'s Step 3
Routing does, then re-run the walk until clean. **Medium/low** findings (polish, consistency
suggestions) are not blocking; they carry into Step 3's digest as context, not a gate. Never apply
`demo:pending` until any high/critical finding is fixed and reverified clean.

**Browser-unavailable fallback** (`Skipped — browser tools not configured`, or the trigger above
itself hits this status when it runs `/visual-review`): not a bug-found case — there is nothing to
fix, only nothing to verify. Proceed to Step 3 without blocking, using the same auto-mode
stage/skip semantics `/visual-review` already applies elsewhere (`_shared/auto-mode-contract.md`).
Record that visual verification wasn't available in this environment — Step 3's branch for
`app-route`/`rendered-page` plans under the browser-unavailable fallback applies for this
record's Confirmed section instead.

## Step 3: Source the Confirmed-section content

Every record's brief converges on the same self-contained shape — no branch between "pointer to
another skill" and "generic fallback."

**`app-route`/`rendered-page` plans whose Step 2.5 walk completed** (resolved clean with an
actual walk — not the browser-unavailable fallback):

1. Read the visual-review report (from Step 2.5's trigger, or `/review`'s existing Step 6 report
   when no trigger was needed) for its headline: `clean`, or `found and fixed: {N} issues` (name
   each in one line).
2. Select 1-3 of the walk's most representative screenshots — the primary journey step's final
   state, or the single-page review's key screenshot(s). Hand them to Step 4's screenshot-commit
   procedure.
3. Resolve the entry point — `APP_URL` + the journey/page path (reuse `dev-url-detection.md`, do
   not re-derive URL discovery).

**`cli`/`flow`/`diff` plans, or `app-route`/`rendered-page` plans under the browser-unavailable
fallback** (Step 2 picked a plan kind that skips Step 2.5, or Step 2.5's browser-unavailable
fallback applied):

1. Pull the spec-compliance verdict and key quality notes from `/review`'s own summary
   (`### Spec Compliance` and `### Code Review Findings` sections).
2. Capture the diff: `git diff --stat {base}...HEAD` plus the diff itself. For diffs under ~200
   lines, include it in full; for larger diffs, include the stat summary plus the 2-3 hunks most
   central to the record's Acceptance Criteria.

## Step 4: Compose and post the brief

**Screenshot commit** (`app-route`/`rendered-page` plans whose Step 2.5 walk completed, with screenshots from Step 3): commit the 1-3 selected
screenshots to `docs/demo-evidence/{record}/{NN}-{description}.png` — `{record}` is the issue
number (`github-issues`) or record id (`local-files`); `{NN}` is a zero-padded sequence starting
at `01`; `{description}` is a short kebab-case label matching the screenshot's content (e.g.
`settings-toggle-persisted`). Commit before composing the template below — the embed needs the
committed SHA. Which branch the commit lands on is decided first.

**`integration-model: local-merge` or `current-branch` mode** — no PR to read: commit on the current branch with the fence below, with no push and no PR (`_shared/git-discipline.md`: no phase-exit push there).

**Read the run's own PR before committing (`integration-model: pr-first`, #4039).**
Step 4 never commits to or pushes `{integration-branch}`, and the session's current branch is not
proof that the run's PR is still open. Acceptance labeling reaches Step 4 after wrap-up's cleanup items
(`execution-and-verification.md`): on the console's "Approve all + merge" path and
`dispatch/close-out.md` step 3, item 4 has already removed the merged run's worktree and branch and
item 8 has archived its run directory, so Step 4 runs from the main checkout on the integration
branch. A re-run after a `BLOCKED` verify verdict can find the PR merged too. A commit on a merged
branch never reaches the integration branch.

Run `git branch --show-current` as its own Bash call first and pass the name in literally in every
later command — a `git` inside `$(...)` is refused in a worktree session
(`_shared/scratch-worktree.md` §7). **Guard:** when it prints `{integration-branch}`, prints nothing
(detached HEAD), names a branch other than the run's own, or prints a name that does not match
`^[A-Za-z0-9._/-]+$` (a legal branch name can carry `$`, quotes, or a backtick — never put such a
name in a command), the current-branch route is unavailable: take the evidence-PR route regardless of what the read returned.
The run's own branch is the branch checked out in the worktree `run-state.json`'s `worktree` field records —
the session's current branch while it is still inside that worktree. Tell by running
`git rev-parse --show-toplevel` as its own Bash call and comparing its output with that recorded path
— an exact match after dropping a trailing `/`; any other output, or an error, counts as outside.
Outside it (back in the main checkout) the current-branch route is unavailable. With no `worktree`
recorded (a standalone wrap-up's run directory, or none resolves), the run's own branch is the
current branch itself, still under the guard above.

When a run directory resolves — `$PIPELINE_RUN_DIR`, or, once cleanup item 8 archived it,
`$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` (`_shared/timing-render.md`'s archive-path
rule) — read the run's own PR from it. The CLI keys on `run-state.json`'s `pr.number`, so the read
survives the branch's deletion:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/pr-merge-state.js" --run "{run-dir}" --phase wrap-up
```

Its `state` is one of `conflicting`, `no-conflict`, `unknown` (the run's PR is open), `not-open`
(merged or closed), `no-pr` (none recorded), `gh-absent`, or `read-failed` (unreadable). On
`conflicting` the CLI also appends its own "Post-push merge-state check" entry to `decisions.md`, which is expected.

The branch read is the fallback only — when no run directory resolves, or the run read reported
`no-pr`. Use the existing resolver (`bin/lib/reconcile/pr-state.js`'s `resolvePrState`;
a merged PR wins when the branch has several):

```bash
node -e "const s=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/reconcile/pr-state.js').resolvePrState(process.cwd(), process.argv[1]); console.log(typeof s === 'string' ? s : s ? s.state + ' ' + s.number : 'no-pr')" "{branch}"
```

It prints `OPEN {n}`, `MERGED {n}`, `CLOSED {n}`, `no-pr`, `gh-absent`, or `network-failure`; read
`OPEN` as open, `MERGED`/`CLOSED` as `not-open`, and `network-failure` as `read-failed`. Route on
the result:

- **Run PR open (`conflicting`, `no-conflict`, `unknown`)** — only when the session is on the run's own branch: commit on the current branch (the fence below), then push that commit straight away, as its own Bash call: `git push origin {branch}`. The run's later phase-exit push would carry it, but a re-run after that push has none. If the push fails, compose the brief without embedded screenshots and say why — an unpushed SHA does not resolve; the commit stays on the branch.
- **Run PR merged or closed (`not-open`), or the current-branch route unavailable** — never commit to the dead branch or the integration branch, and never switch the session's branch in place. Provision a scratch worktree (`_shared/scratch-worktree.md` §2 create, §3 catch-up) the way `wrap-up/residue-sweep.md`'s `pr-first` landing does ("Landing the batch"), on branch `demo-evidence/{record}` cut from the freshly fetched `origin/{integration-branch}` (`_shared/integration-branch.md`). When that name is already taken locally or on `origin` (check with `git branch --list 'demo-evidence/{record}*'` and `git ls-remote --heads origin 'demo-evidence/{record}*'`, each its own call), append `-2`, `-3`, … and use the first free name. Write the screenshots into that worktree's `docs/demo-evidence/{record}/`, stage them with `git add docs/demo-evidence/{record}/` as its own call (a pathspec commit only takes paths git already tracks), then commit with a pathspec so nothing else rides along: `git commit -m "Add demo evidence screenshots for #{record}" -- docs/demo-evidence/{record}/`. Record `git rev-parse HEAD` — `{commit-sha}` in the embed below is this evidence commit's SHA, never the dead branch's. Then `git push -u origin demo-evidence/{record}` and open an evidence-only PR with `gh pr create --base {integration-branch} --head demo-evidence/{record} --body-file …` — or `mcp__github__create_pull_request` with `gh` absent (`_shared/github-write-transport.md`'s PR create exception). Its body references the record as `Refs #{record}` — never `Fixes`, `Closes`, or `Resolves`: the record's closure belongs to its original PR. The evidence PR is left open for a human to merge and is never auto-merged — no `auto:merge` grant covers it. Tear the worktree down per `_shared/scratch-worktree.md` §6 via `ExitWorktree`; that section's ancestry check would refuse this unmerged commit, so the proof before discarding is that the branch's HEAD is on `origin` — `git ls-remote --heads origin demo-evidence/{record}` returns the recorded SHA. Call `ExitWorktree` with `discard_changes: true` only after the ls-remote proof, stating it as the reason. If provisioning, the commit, or the push fails, nothing reached `origin`: compose the brief without embedded screenshots, say in it why they are missing, and tear the worktree down per `_shared/scratch-worktree.md` §6 — when its ancestry check refuses an unpushed commit, leave the worktree and name its path in the brief and the summary. If the push succeeded but the PR create fails, the commit is on `origin`, so keep the embeds and the teardown, and name the pushed branch and the failure in the brief and the summary row in place of the PR link, for a human to open the PR. If the ls-remote proof does not return the recorded SHA (empty, a different SHA, or an error), do not discard: leave the worktree and name its path in the brief and the summary.
- **No PR recorded (`no-pr`)** — both reads found none (a degraded run that never opened one): commit and push as for an open PR, on the run's own branch; the guard above still applies.
- **State unreadable (`gh-absent`, `read-failed`, or any other output)** — the PR cannot be shown to be live, so treat it as open only when this is the run's own in-run Phase 4 and its merge half resolved leave-open (`console.json`'s `merge.resolution` reads `leave-open`, or an attended console chose "Approve all, leave PR open" — the test `execution-and-verification.md`'s Leave-open mergeability re-check uses) and the session is on the run's own branch; otherwise take the evidence-PR route. Any other output from either read (a crash, `MODULE_NOT_FOUND`, an unparseable line) is unreadable too.

Log the route when a run directory resolves (`_shared/pipeline-run-dir.md`), passing `{run-dir}` as
resolved above — the live or archive path, never a bare `$PIPELINE_RUN_DIR` that item 8 may have
archived:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --section "/wrap-up" --status AUTO --step "Verification Brief Step 4" --reversibility high --text-file "{text-file}"
```

`{text-file}` holds one line, `screenshot commit for #{record}: PR state {state} → {current branch | evidence PR #{m} ({url})}`, written per `_shared/auto-decision-log.md`'s Text from git or a user paragraph — `{url}` comes back from the forge, so it never passes through shell quoting.

On the evidence-PR route, name the evidence PR's URL in the brief (one line under the
screenshots) and in wrap-up's Actions Performed (`summary-template.md`'s evidence-PR row).

The commit, for the open-PR, `no-pr`, `local-merge`, and `current-branch` routes:

```bash
git add docs/demo-evidence/{record}/
git commit -m "Add demo evidence screenshots for #{record}"
```

Embed via a commit-SHA-pinned raw URL (not branch-pinned — resolves regardless of which branch
this lands on, as soon as the commit is pushed to origin, sidestepping any question of "which
branch is this brief rendering against"):

```
![{description}](https://raw.githubusercontent.com/{owner}/{repo}/{commit-sha}/docs/demo-evidence/{record}/{NN}-{description}.png)
```

Resolve `{owner}/{repo}` from `git remote get-url origin`; `{commit-sha}` is the screenshot
commit's own SHA (`git rev-parse HEAD` immediately after the commit above). This resolves once
that commit is pushed to origin — the normal case for `github-issues`-backend work (which always
eventually pushes for the record to close via merge). If this run's work is later discarded
without ever pushing, the embedded image simply won't resolve, same as any broken link — the
brief's text content is unaffected.

`work-backend: local-files` — no comment mechanism (existing constraint, per
`_shared/work-record.md`); embed via a relative repo path instead of a raw URL:
`![{description}](../../demo-evidence/{record}/{NN}-{description}.png)` (adjust the relative
depth to the record file's actual location under `specs/`).

**Branch (`integration-model: pr-first` only, `_shared/integration-model.md`).** Nothing to render here — under `pr-run-comments.md`'s gate, this brief already posts *on* the run's own PR (opened at run start by `_shared/pr-early-run-lifecycle.md`, kept current at every phase exit), so a reader already has the branch and the PR in front of them. No separate `### Branch` section is composed.

Render this exact template:

```markdown
## Verification Brief

### The ask
{condensed vision/why — the record's problem statement, not just the Acceptance Criteria
checklist; a human returning days later needs to remember *why*, not just *what to check*}

### What shipped
{one-paragraph summary from the record body + diff}

{the Try it block composed in **Try it block** above — re-run the **Try it block** resolve line, read the file at the path `$TRY_IT` names, and insert its content verbatim, its own `### Try it` heading included}

### Confirmed
{app-route/rendered-page, walk completed:}
Visual review walked {journey/page name} — {clean | "found and fixed: {N} issues — {one line each}"}.

{screenshot embeds from above, 1-3}

{app-route/rendered-page, browser unavailable:}
_Visual verification wasn't available in this environment._

{diff/rationale, same shape as cli/flow/diff below}

{cli/flow/diff:}
Code review: {spec-compliance verdict}. {key quality notes, 1-2 lines}

{diff, embedded in full or bounded to key hunks per Step 3}

### Observation plan
- Surface: {rendered-page | app-route | cli | flow | diff}
- Entry point: {from Step 2}
- Prepare: {command sub-bullets, or none}
- Inspect: {pointer sub-bullets — flow pointers may carry an indented Regenerate: line}

{this section's content follows `skills/_shared/observation-plan.md`'s schema and grammar; it is
always present on a sub-issue brief — a parent brief omits it (Parent-Gate Procedure)}

---

_Posted by {poster}. Resolve with `/claude-tweaks:demo`._
```

`{poster}` is the **skill** that invoked this file, on this default (Step 1-4) path exactly as on
the Parent-Gate Procedure's — never hardcode `` `/claude-tweaks:wrap-up` ``. Per the Routing
table at the top of this file: `` `/claude-tweaks:wrap-up` `` for either wrap-up entry (Phase 4's
execution step or the auto-merge short-circuit), `` `/claude-tweaks:dispatch` `` for the group auto-merge gate or close-out step 3, and
— on the Parent-Gate Procedure's parent-side entry only — `` `/claude-tweaks:tidy` ``. The string
is outward-facing (posted as a GitHub comment, or embedded in a local record body), so a
`/tidy`-posted parent brief claiming `/wrap-up` posted it would be wrong on exactly the population
the backstop exists for: parents that never reached `/wrap-up`. The same applies to a
`/dispatch`-posted brief: that path never reached `/wrap-up`'s Phase 4 execution step either.

`work-backend: github-issues` — write the rendered template to
`/tmp/verification-brief-{issue}.md`, then check the pr-first gate (`run-state.json` carries a
`pr` object — `_shared/pr-run-comments.md`):

**No `pr` object** (`local-merge`, or a degraded `pr-first` run): post to the issue exactly as
today.

```bash
gh issue comment {issue} --body-file /tmp/verification-brief-{issue}.md
gh issue edit {issue} --add-label demo:pending
```

**`pr` object present:** the full brief moves to the PR; the issue keeps a one-line pointer
instead of the whole template. **Multi-spec marker (#2970):** when `$MULTISPEC_PARENT_DIR` is
set (a multi-spec `/claude-tweaks:flow` run sharing one PR across specs —
`flow/multi-spec.md`), the marker is spec-qualified, `<!-- run-comment: brief:{spec} -->`, where
`{spec}` is this spec's record id (the numeric suffix of `basename($PIPELINE_RUN_DIR)`, the same
derivation `review/code-mode-steps.md`'s verdict comment uses) — per
`_shared/pr-run-comments.md`'s "Multi-spec brief and timing comments" section. A single-spec run
keeps the plain `<!-- run-comment: brief -->` marker unchanged.

```bash
printf '<!-- run-comment: brief -->\n\n' | cat - /tmp/verification-brief-{issue}.md > /tmp/pr-brief-{issue}.md
# $MULTISPEC_PARENT_DIR set: printf '<!-- run-comment: brief:{spec} -->\n\n' instead, {spec} = basename($PIPELINE_RUN_DIR)'s numeric suffix
# find-or-create per _shared/pr-run-comments.md's post-or-update procedure, kind=brief (or brief:{spec} under multi-spec), against {pr-number}
gh issue comment {issue} --body "Verification Brief posted to PR #{pr-number}: {pr-url}"
gh issue edit {issue} --add-label demo:pending
```

Then post the run's Timing table as the `timing` kind, under the same gate (#1928); a `tokens: transcript not found (...)` line, when present, is posted verbatim with the table, and so is the CLI's Dispatches block (tier and role tables and any `dispatches:`/`dispatch agent-{id}:` lines) when it prints one. The same multi-spec marker rule applies: `<!-- run-comment: timing:{spec} -->` when `$MULTISPEC_PARENT_DIR` is set, the plain `<!-- run-comment: timing -->` marker otherwise:

```bash
printf '<!-- run-comment: timing -->\n\n' > /tmp/pr-timing-{issue}.md
# $MULTISPEC_PARENT_DIR set: printf '<!-- run-comment: timing:{spec} -->\n\n' instead, {spec} = basename($PIPELINE_RUN_DIR)'s numeric suffix
node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript >> /tmp/pr-timing-{issue}.md
# find-or-create per _shared/pr-run-comments.md's post-or-update procedure, kind=timing (or timing:{spec} under multi-spec), against {pr-number}
```

When wrap-up's cleanup item 8 has already archived the run directory (`cleanup-procedures.md`), pass `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` as `--run` instead — the events and manifest travel with the archive.

Post the comment(s) before adding the label — a reader reacting to the label's appearance should
never see `demo:pending` without a brief (or its pointer) already attached. Acceptance labeling
stays on the issue either way — only where the full brief's content lives changes.

`work-backend: local-files` — append the same template as a new `## Verification Brief` section
to the record body (after any existing content), and write the record with
`facets.acceptance = 'pending'`:

```js
const { readRecord, writeRecord } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
const record = readRecord(filePath);
record.facets.acceptance = 'pending';
record.body = record.body + '\n\n' + briefTemplate;
writeRecord(filePath, record);
```
