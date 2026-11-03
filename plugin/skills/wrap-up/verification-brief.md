# Wrap-Up — Acceptance Packet Procedure

Canonical procedure for the acceptance-labeling action: posting the acceptance packet
(`_shared/acceptance-packet.md`) and applying `demo:pending`. Record mode only (a record is identified for this run, per
`/claude-tweaks:wrap-up` Phase 1 — a materialized header is not required) — conversation-based
work has no work record to label, so this procedure does not run for it.

## Routing — read this before anything else, whatever invoked this file

**The routing below is this file's decision, not its caller's.** Every call site lands here
first and inherits it, so a new one never has to re-derive the condition (and cannot get it
wrong by omission). Six call sites exist today:

| Caller | Arrives holding |
|---|---|
| `/claude-tweaks:wrap-up` Phase 4 execution's Acceptance-labeling bullet (`wrap-up/execution-and-verification.md`) | one **sub-issue**, mid-close |
| `/claude-tweaks:wrap-up`'s auto-merge short-circuit (`wrap-up/review-console.md`) | one **sub-issue**, mid-close |
| `/claude-tweaks:dispatch`'s group auto-merge gate (`dispatch/settle-and-merge.md`) | one **sub-issue** per group member, mid-close — plus the group's whole closing sub-issue set (see the Self-inclusion rule) |
| `/claude-tweaks:dispatch`'s close-out step 3 (`dispatch/close-out.md`) | one or more **sub-issues** (the PR's `Fixes` records), at a later human-confirmed merge |
| `_shared/pr-first-merge-post-merge.md` Step 4.0b (post-merge) | one or more **sub-issues** (the merge's closing records), after the merge landed — runs only the below-floor close |
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
The post-merge Step 4.0b entry is the exception, per `verification-brief-parent-gate.md`'s
**Resolve the parent** no-parent branch.

**Before either branch, on every record-holding entry** (a no-parent record, or a sub-issue-side
entry into the Parent-Gate Procedure — not the parent-side `/claude-tweaks:tidy` entry below,
which holds no delivering record of its own, nor the post-merge Step 4.0b entry, whose delivering
runs already posted theirs): compose this record's Try it block — the next section. Neither the Parent-Gate Procedure nor the Oversight-floor gate gates it (#2821); they decide only where it lands.

A caller that already holds a **parent** number is inside the Parent-Gate Procedure by
construction — there is no sub-issue to resolve, so it starts at **Enumerate the parent's
sub-issues**.

## Try it block (every record, before either branch)

Compose this record's `### Try it` block per `_shared/try-it.md` (shape, sources, rules — cited, not
restated here) now, before the Parent-Gate Procedure or the Oversight-floor gate runs, and write it
to the session-scoped file that `/claude-tweaks:flow`'s Pipeline Summary reads back:

```bash
TRY_IT="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value try-it-{N}.md)"
```

Write the composed block to `"$TRY_IT"`. Shell variables do not survive between calls, so any
later step that uses `$TRY_IT` — the posting fence below, the parent gate's append in
`verification-brief-parent-gate.md`, and Step 3's `{LINKS}` and Step 4's narrative — re-runs that resolve line first. Where it lands is the branch's decision: a record with no
resolvable parent, on either side of the floor, carries it in its packet's Test guide (Steps 3-4);
a parent-linked sub-issue posts it alone, below.

**Posting it alone** — a parent-linked sub-issue only, which has no packet of its own to carry the
block (post it after the Parent-Gate Procedure returns, so an end-to-end variant it appended rides
along). Under `_shared/pr-run-comments.md`'s gate (`run-state.json` carries a `pr` object), post it
as the `try-it` kind, marker `<!-- run-comment: try-it -->` in a single-spec run, or, when
`$MULTISPEC_PARENT_DIR` is set (a multi-spec `/claude-tweaks:flow` run sharing one PR across
specs), the `try-it:{N}` kind, marker `<!-- run-comment: try-it:{N} -->` — the same spec
qualification the `verdict` kind uses (`_shared/pr-run-comments.md`'s "Multi-spec verdict
comments" section):

```bash
TRY_IT="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value try-it-{N}.md)"
KIND=try-it; [ -n "$MULTISPEC_PARENT_DIR" ] && KIND="try-it:{N}"
printf '<!-- run-comment: %s -->\n\n' "$KIND" | cat - "$TRY_IT" > "$TRY_IT.pr"
# find-or-create per _shared/pr-run-comments.md's post-or-update procedure, kind=$KIND, against {pr-number}
```

No `pr` object (`local-merge`, or a degraded `pr-first` run): post nothing — the
Pipeline Summary carries it.

## Parent-Gate Procedure (parent-linked sub-issues)

The Routing section above routes here — in place of, not alongside, Steps 1-4 below — whenever
the record in hand has a resolvable parent. This is the minority path (a decomposed sub-issue,
not the general one-off record) — read `verification-brief-parent-gate.md` in this skill's
directory and follow it in full, in place of the rest of this file, whenever that condition
holds. It covers, in order: the two entry shapes, what it deliberately skips (Step 2.5's
visual-review safety net), Resolve the parent, Enumerate the parent's sub-issues, the
Self-inclusion rule, Run the gate CLI, Evaluate the gate (including its own Oversight-floor check), Close the
parent below the floor, Compose the parent brief, and Apply the gate.

**No parent resolvable** — run the Oversight-floor gate and Steps 1-4 below: the record itself
gets a packet, with `demo:pending` only above the floor (Decision Q5).

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

- **`exceeds: false`** — this record does not clear the oversight floor. Skip Step 1
  (no `demo:pending` bootstrap) and Step 2.5 (the visual-review safety net is ceremony), and run Steps
  2, 3 and 4: Step 4 posts the packet without `--label` (Decision Q5,
  `_shared/acceptance-packet.md`). The walkthrough is not skipped: the Try it block composed above feeds the packet's Test guide, and the Pipeline Summary renders it. The record closes with no acceptance label and no ceremony (this is the *not required*
  outcome, not a `demo:exempt` marker — see the design's Non-Goals). It stays demoable later on
  request: `/claude-tweaks:demo #N` reads its packet, whatever its labels.

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
  ["demo:pending", "Acceptance: built and verified — awaiting human sign-off via /claude-tweaks:demo", "006B75"],
  ["accept:pending",           "Acceptance: built and verified — awaiting the human's acceptance verdict", "006B75"],
  ["accept:approved",          "Acceptance: a human verified this record does what was asked", "006B75"],
  ["accept:approved-batch",    "Acceptance: approved in one batch verdict — no per-record walkthrough", "006B75"],
  ["accept:changes-requested", "Acceptance: a human found a gap — see the linked follow-up record", "006B75"]
]
```

`/wrap-up` applies only `demo:pending` — it never applies the approved or changes-requested
acceptance labels (see `_shared/work-record.md`'s permission matrix). The `accept:*` rows only
create the labels in the repo (`_shared/label-bootstrap.md`, below its canonical array).

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

`app-route`/`rendered-page` plans — continue to Step 2.5, unless the record is below the floor.
`cli`/`flow`/`diff` plans — skip Step 2.5 and go straight to Step 3.

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
suggestions) are not blocking; they carry into Step 4's narrative as context, not a gate. Never apply
`demo:pending` until any high/critical finding is fixed and reverified clean.

**Browser-unavailable fallback** (`Skipped — browser tools not configured`, or the trigger above
itself hits this status when it runs `/visual-review`): not a bug-found case — there is nothing to
fix, only nothing to verify. Proceed to Step 3 without blocking, using the same auto-mode
stage/skip semantics `/visual-review` already applies elsewhere (`_shared/auto-mode-contract.md`).
Record that visual verification wasn't available in this environment — Step 3's branch for
`app-route`/`rendered-page` plans under the browser-unavailable fallback applies instead.

## Step 3: Gather the packet inputs

The evidence sources are the ones the brief always drew on; each now feeds one flag of Step 4's
`acceptance-packet.js gather`, or its narrative. `{run-dir}` becomes `--run`, and the verify
`report.json` path becomes `--report` when Step 4 runs in the run's own checkout. Resolve the input
files' session-temp paths as its own call (`_shared/session-tmp-root.md`), and paste each printed
path where a later call names `{AC_RESULTS}` and so on:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" AC_RESULTS=packet-ac-results-{N}.json LINKS=packet-links-{N}.json PLAN=packet-plan-{N}.md
```

Write each with the Write tool:

- **`{PLAN}`** — Step 2's observation plan, in `_shared/observation-plan.md`'s grammar.
- **`{AC_RESULTS}`** — a transcription of `/review`'s `### Spec Compliance` table, shaped
  `{ "1": "met", "2a": "not met", "AC1": "partially met" }`: keys exactly the ids
  `parseAcceptanceCriteria` (`bin/lib/wrap-up/packet-gather.js`) yields from Step 4's `--spec` file,
  the criterion's own number or positional `AC1`, `AC2` for bulleted criteria; values exactly
  `met`, `partially met` or `not met` in lowercase. The review table is keyed by criterion text, so
  match each row to its id and leave out a row matching no id. A review with no table (no spec,
  or a review its ceremony profile skipped) writes no file and passes no `--ac-results`.
- **`{LINKS}`** — the Try it block's Entry point as a `link` input, one entry per Try it group,
  each with its own id `entry-point-{n}`:
  `[{ "id": "entry-point-1", "label": "{feature}", "url": "{local base URL}{route}" }]`. An Entry
  point is a route, and gather refuses a bare one, so `url` is `APP_URL` (`_shared/dev-url-detection.md`,
  do not re-derive URL discovery), the same value `--local-base-url` carries, plus the route. An Entry
  point already a full URL, which `_shared/observation-plan.md`'s schema allows, is used as is. Write
  `"command"` in place of `"url"`, holding the Entry point as the Try it block states it, for
  `cli`/`flow` plans and a `diff` plan's file path, on an `infra` or `backend` surface, and
  when no base URL resolves or the host would be refused: a refused link leaves the Test guide with
  no step to cite.

**`app-route`/`rendered-page` plans whose Step 2.5 walk completed** (resolved clean with an
actual walk — not the browser-unavailable fallback):

1. Read the visual-review report (from Step 2.5's trigger, or `/review`'s existing Step 6 report
   when no trigger was needed) for its headline: `clean`, or `found and fixed: {N} issues` (name
   each in one line). Step 4's narrative states it as a `test-guide` claim.
2. Select 1-3 of the walk's most representative screenshots — the primary journey step's final
   state, or the single-page review's key screenshot(s). Hand them to Step 4's screenshot-commit
   procedure; their URLs become `recording` inputs (`--recordings`).

**Every other plan** (`cli`/`flow`/`diff`, or `app-route`/`rendered-page` with no completed walk:
the browser-unavailable fallback, or a below-floor record, where Step 2.5 did not run):

1. Pull the spec-compliance verdict and key quality notes from `/review`'s own summary
   (`### Spec Compliance` and `### Code Review Findings` sections), for the narrative.
2. Read the diff for the narrative: `git diff --stat {base}...HEAD` plus the diff itself, or for
   larger diffs the stat summary plus the 2-3 hunks most central to the record's Acceptance
   Criteria. Gather's `change` facts are what the claims cite.
3. Under the browser-unavailable fallback, the narrative states that visual verification wasn't
   available in this environment, as a `test-guide` claim citing the first group's `link:entry-point-1`.

## Step 4: Compose and post the brief

The packet replaced the brief, so where the routing below says "brief" it means the packet, an
"embed" is a `--recordings` entry, and a note it puts "in the brief" is a `test-guide` claim in the
narrative.

**Screenshot commit** (`app-route`/`rendered-page` plans whose Step 2.5 walk completed, with screenshots from Step 3): commit the 1-3 selected
screenshots to `docs/demo-evidence/{record}/{NN}-{description}.png` — `{record}` is the issue
number (`github-issues`) or record id (`local-files`); `{NN}` is a zero-padded sequence starting
at `01`; `{description}` is a short kebab-case label matching the screenshot's content (e.g.
`settings-toggle-persisted`). Commit before gathering below — the embed needs the
committed SHA. Which branch the commit lands on is decided first.

**`integration-model: local-merge` or `current-branch` mode** — no PR to read: commit on the current branch with the fence below, with no push and no PR (`_shared/git-discipline.md`: no phase-exit push there).

**Route the commit (`integration-model: pr-first`, #4039, #4125).**
Step 4 never commits to or pushes `{integration-branch}`, and the session's current branch is not
proof that the run's PR is still open. Acceptance labeling reaches Step 4 after wrap-up's cleanup items
(`execution-and-verification.md`): on the console's "Approve all + merge" path and
`dispatch/close-out.md` step 3, item 4 has already removed the merged run's worktree and branch and
item 8 has archived its run directory, so Step 4 runs from the main checkout on the integration
branch. A re-run after a `BLOCKED` verify verdict can find the PR merged too. A commit on a merged
branch never reaches the integration branch. `bin/evidence-route.js` makes the decision from the
current branch, the worktree `run-state.json` records, the run's own PR (read through
`bin/pr-merge-state.js`, which also appends its own "Post-push merge-state check" entry to `decisions.md`, which is expected),
the branch's PR as the fallback, and `console.json`'s merge resolution. Its rules live in `decideEvidenceRoute` in `bin/lib/wrap-up/evidence-route.js` (its `--help` lists the route, reason, and state vocabularies), not restated here. Run it as its own Bash call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/evidence-route.js" --run "{run-dir}"
```

`{run-dir}` is `$PIPELINE_RUN_DIR`, or `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` once
cleanup item 8 archived it (`_shared/timing-render.md`'s archive-path rule). Drop `--run` when no run
directory resolves. Add `--in-run` only when this file was reached from Phase 4 execution's
Acceptance-labeling bullet (the Routing table's first row), and `--leave-open` only when an attended
Review Console chose "Approve all, leave PR open" this run.

It prints one JSON line `{route, branch, state, reason}`. Route on `route` alone; `state` feeds the
log line below. A non-zero exit, or output that does not parse as that line, takes the evidence-PR route, and the log line's `{state}` then reads `unavailable`.

- **`current-branch`** — commit on the current branch (the fence below), then push that commit straight away, as its own Bash call: `git push origin {branch}`, with `{branch}` the JSON's `branch`. The run's later phase-exit push would carry it, but a re-run after that push has none. If the push fails, compose the brief without embedded screenshots and say why — an unpushed SHA does not resolve; the commit stays on the branch.
- **`evidence-pr`** — never commit to the dead branch or the integration branch, and never switch the session's branch in place. Provision a scratch worktree (`_shared/scratch-worktree.md` §2 create, §3 catch-up) the way `wrap-up/residue-sweep.md`'s `pr-first` landing does ("Landing the batch"), on branch `demo-evidence/{record}` cut from the freshly fetched `origin/{integration-branch}` (`_shared/integration-branch.md`). When that name is already taken locally or on `origin` (check with `git branch --list 'demo-evidence/{record}*'` and `git ls-remote --heads origin 'demo-evidence/{record}*'`, each its own call), append `-2`, `-3`, … and use the first free name. Write the screenshots into that worktree's `docs/demo-evidence/{record}/`, stage them with `git add docs/demo-evidence/{record}/` as its own call (a pathspec commit only takes paths git already tracks), then commit with a pathspec so nothing else rides along: `git commit -m "Add demo evidence screenshots for #{record}" -- docs/demo-evidence/{record}/`. Record `git rev-parse HEAD` — `{commit-sha}` in the embed below is this evidence commit's SHA, never the dead branch's. Then `git push -u origin demo-evidence/{record}` and open an evidence-only PR with `gh pr create --base {integration-branch} --head demo-evidence/{record} --body-file …` — or `mcp__github__create_pull_request` with `gh` absent (`_shared/github-write-transport.md`'s PR create exception). Its body references the record as `Refs #{record}` — never `Fixes`, `Closes`, or `Resolves`: the record's closure belongs to its original PR. The evidence PR is left open for a human to merge and is never auto-merged — no `auto:merge` grant covers it. Tear the worktree down per `_shared/scratch-worktree.md` §6 via `ExitWorktree`; that section's ancestry check would refuse this unmerged commit, so the proof before discarding is that the branch's HEAD is on `origin` — `git ls-remote --heads origin demo-evidence/{record}` returns the recorded SHA. Call `ExitWorktree` with `discard_changes: true` only after the ls-remote proof, stating it as the reason. If provisioning, the commit, or the push fails, nothing reached `origin`: compose the brief without embedded screenshots, say in it why they are missing, and tear the worktree down per `_shared/scratch-worktree.md` §6 — when its ancestry check refuses an unpushed commit, leave the worktree and name its path in the brief and the summary. If the push succeeded but the PR create fails, the commit is on `origin`, so keep the embeds and the teardown, and name the pushed branch and the failure in the brief and the summary row in place of the PR link, for a human to open the PR. If the ls-remote proof does not return the recorded SHA (empty, a different SHA, or an error), do not discard: leave the worktree and name its path in the brief and the summary.

Log the route when a run directory resolves (`_shared/pipeline-run-dir.md`), passing `{run-dir}` as
resolved above — the live or archive path, never a bare `$PIPELINE_RUN_DIR` that item 8 may have
archived:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --section "/wrap-up" --status AUTO --step "Verification Brief Step 4" --reversibility high --text-file "{text-file}"
```

`{text-file}` holds one line, `screenshot commit for #{record}: PR state {state} → {current branch | evidence PR #{m} ({url})}`, written per `_shared/auto-decision-log.md`'s Text from git or a user paragraph — `{url}` comes back from the forge, so it never passes through shell quoting.

On the evidence-PR route, name the evidence PR's URL in the packet's Test guide (a `test-guide`
claim citing the first group's `link:entry-point-1`, the URL in its text) and in wrap-up's Actions Performed
(`summary-template.md`'s evidence-PR row).

The commit, for the `current-branch` route and the `local-merge` / `current-branch` integration modes:

```bash
git add docs/demo-evidence/{record}/
git commit -m "Add demo evidence screenshots for #{record}"
```

Link via a commit-SHA-pinned raw URL (not branch-pinned — resolves regardless of which branch
this lands on, as soon as the commit is pushed to origin, sidestepping any question of "which
branch is this brief rendering against"). The packet renders it as a plain link, not an embedded
image (`_shared/acceptance-packet.md`'s `## Untrusted content`):

```
https://raw.githubusercontent.com/{owner}/{repo}/{commit-sha}/docs/demo-evidence/{record}/{NN}-{description}.png
```

Resolve `{owner}/{repo}` from `git remote get-url origin`; `{commit-sha}` is the screenshot
commit's own SHA (`git rev-parse HEAD` immediately after the commit above). This resolves once
that commit is pushed to origin — the normal case for `github-issues`-backend work (which always
eventually pushes for the record to close via merge). If this run's work is later discarded
without ever pushing, the link simply won't resolve, same as any broken link — the
brief's text content is unaffected.

Each URL is one entry of Step 4's `{RECORDINGS}` input below:
`[{ "id": "{NN}-{description}", "text": "{description}", "url": "{raw url}" }]`.

`work-backend: local-files` — no comment mechanism (existing constraint, per
`_shared/work-record.md`), and a recording's `url` must be http(s), so pass no `--recordings`: name
each committed screenshot's relative repo path in a `test-guide` claim instead,
`../../demo-evidence/{record}/{NN}-{description}.png` (adjust the relative depth to the record
file's actual location under `specs/`).

**Branch (`integration-model: pr-first` only, `_shared/integration-model.md`).** Nothing to render here — the packet sits on the record, not on the run's own PR (opened at run start by `_shared/pr-early-run-lifecycle.md`, kept current at every phase exit), and `post` links the two through the PR's `Acceptance packet:` body line, so a reader of either reaches the other. No separate `### Branch` section is composed.

**Compose and post the packet** (`_shared/acceptance-packet.md`'s `## Pipeline`; its contract is cited here, not restated). The packet lives on the record whether or not the run has a PR: `post` appends its `Acceptance packet:` line to the PR's body and posts no comment on the PR. Under a multi-spec run each spec's packet lands on its own record. Resolve the session-temp paths as its own call (`_shared/session-tmp-root.md`), and paste each printed path where a call below names `{FACTS}` and so on:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" FACTS=packet-facts-{N}.json NARRATIVE=packet-narrative-{N}.json PACKET=packet-{N}.md DROPPED=packet-dropped-{N}.json RECORDINGS=packet-recordings-{N}.json SPEC=packet-spec-{N}.md FLAGS=packet-flags-{N}.json PROOFS=packet-proofs-{N}.json
```

**Risk facts**, as its own Bash call before the gather: `risk-flags.js facts` reads the record's `Risk-flags:` line from `{spec}` and the plan's `Proof(<slug>):` lines, and writes the gather's `--flags` and `--proofs` inputs. `{spec}` is the value the `--spec` bullet below resolves, the same one the gather gets, so resolve it here. Pass `--plan-file` only when `{run-dir}/packet-inputs/manifest.json`'s `files.plan` is `copied` (read the manifest first: a later snapshot without a plan copy leaves an earlier `plan.md` there); otherwise, or with no run directory, drop it. `{spec}` and `{run-dir}` follow the path grammar below the gather fence. A `{run-dir}` that fails it drops `--plan-file`; a `{spec}` that fails it skips this call, the gather then passes neither `--flags` nor `--proofs`, and the summary says the risk facts were not gathered.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" facts --spec-file "{spec}" --plan-file "{run-dir}/packet-inputs/plan.md" --flags-out "{FLAGS}" --proofs-out "{PROOFS}"
```

It prints one JSON line `{ status, flags, proofs, plan, planParse }`, with `flags` and `proofs` as counts. With `flags` above 0, say in the summary, for `plan: 'absent'`: the risk proofs were not read because no plan copy exists; for `planParse: 'could-not-parse'`: the risk proofs were not read because the plan copy could not be parsed. Either case reads as proofs not read, never as no proof written. A non-zero exit removes both outputs: 1 is an unreadable `{spec}` or a plan read failure other than absence, 2 a malformed call, an unreadable policy or an output that is also an input, 3 an unwritable output. Report it in the summary and log it (**Log a stop or a failure** below), then go on: it never stops the packet. The gather still passes `--flags` and `--proofs`, and its partial states each missing file, as `--flags input not read — treated as absent` and the same for `--proofs`.

**Gather**, as its own Bash call, dropping an optional flag whose source this list says is absent, or whose value fails its grammar (below the fence):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" gather --record {N} --out "{FACTS}" --run "{run-dir}" --spec "{spec}" --report "{report}" --story-results "{qa-report}" --stories-dir "{stories-dir}" --ac-results "{AC_RESULTS}" --base "origin/{integration-branch}" --head "{head}" --links "{LINKS}" --surface "{surface}" --local-base-url "{local-url}" --recordings "{RECORDINGS}" --flags "{FLAGS}" --proofs "{PROOFS}"
```

Several pasted values come from text the plugin did not write — the record body, a git branch name, project config — and inside double quotes `$(…)` or a backtick still runs (`docs/skill-authoring.md`'s untrusted-text rule). Paste a value only when it matches its grammar; otherwise omit its flag and say so in the summary, as for any absent input. `{N}` and `{pr-number}`: digits only. `{surface}`: exactly one of `web`, `mobile`, `desktop`, `backend`, `infra`, `terminal`. `{integration-branch}` and `{head}`: letters, digits and `.` `_` `/` `-` only. `{local-url}`: an `http://` or `https://` URL with no `"`, backtick, `$`, `\` or whitespace. Every path (`{run-dir}`, `{spec}`, `{report}`, `{qa-report}`, `{stories-dir}`, and Post's `{record-file}`): none of `"`, backtick, `$`, `\` or a line break, since a space is safe between the quotes.

- `--run` — `{run-dir}` as resolved above, `$PIPELINE_RUN_DIR` or `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` once cleanup item 8 archived it. It supplies `decisions.md`, the Review Console's finding set, and the `packet-inputs/` snapshot wrap-up Phase 1 took. Omitted when no run directory resolves.
- `--spec` — the first that exists: the current checkout's `work/{N}-spec.md` at the run dir's relative path, then `{run-dir}/work/{N}-spec.md`, else the record body written with the Write tool to `{SPEC}` (read with `gh issue view {N} --json body`, or MCP `issue_read`), or under `work-backend: local-files` the record file itself, since a record body carries the same `## Acceptance Criteria`.
- `--report` and `--story-results` — only when the current branch is not the integration branch (the run's own checkout). `--report` is `{git-dir}/claude-tweaks-verify/report.json`, with `{git-dir}` from `git rev-parse --git-dir` as its own call. `--story-results` is the QA run's `report.json` (the QA stamp's `reportPath`, else the newest `.claude-tweaks/artifacts/screenshots/qa/*/report.json`), whose `stories[]` is the set `/test` selected, passed only when QA ran. From the main checkout both are omitted, because its files belong to other runs, and gather reads the snapshot.
- `--stories-dir` always — the project's stories directory (`STORIES_DIR`, else `stories/`). Without it a tag-only negative story reads as a routine pass. It supplies negative flags only (Decision Q13), and a missing directory is a project with no stories.
- `--ac-results` — Step 3's `{AC_RESULTS}`, omitted with no review table.
- `--base` — `origin/{integration-branch}` (`_shared/integration-branch.md`).
- `--head` — the PR's head sha when `run-state.json` carries a `pr` object, read as its own call with `gh pr view {pr-number} --json headRefOid` (MCP `pull_request_read`). Omitted with no PR or a failed read: gather then takes the snapshot's `head`, else `HEAD`. When `git cat-file -e {sha}` fails, run `git fetch origin pull/{pr-number}/head` as its own call first (a fresh sandbox or a pruned branch); a diff that still fails becomes gather's stated `git changes not gathered`.
- `--links` — Step 3's `{LINKS}`.
- `--surface` — the materialized header's `surface:`, else the record body's `Surface:` line, so a no-header record keeps the commands-only rule; omitted with neither.
- `--local-base-url` — the dev URL `_shared/dev-url-detection.md` resolves, on UI surfaces and `app-route`/`rendered-page` plans, omitted when none resolves.
- `--recordings` — `{RECORDINGS}`, only when the embeds survive the route above.
- `--flags` and `--proofs` — `{FLAGS}` and `{PROOFS}` from the Risk facts call above, always, whatever its exit; only a skipped call passes neither.

Pass no `--scope` (the CLI reads the default verify-scope declaration itself, Decision Q6), no expected-checks list, and no QA-stamp flag (the CLI reads the QA pass stamp from the checkout's git dir or the snapshot itself, Decision Q13). `--dev-base-url`, `--deploy` and `--decision-items` are filled by the dev-target and control-mode records, and none is passed here; `--flags` and `--proofs` come from the Risk facts call above.

Gather non-zero: report it in the summary and log it, post nothing, apply no label.

**Narrate.** Write `{NARRATIVE}` with the Write tool as the envelope `validateNarrativeShape` requires, `{ "schemaVersion": 1, "claims": [{ "section": "test-guide", "text": "…", "refs": ["link:entry-point-1"] }] }`, every claim citing fact ids copied from `{FACTS}` (encoded ids included), never inventing one; the contract's section table says which kinds each section may cite, and the `fact-validated-narration` project skill, where present, is the checklist. A section with no claim reads as empty, so write `what-changed` claims over the `change` facts (the record's problem and what shipped), one `least-confident` claim per `finding` fact, and `tried-to-break` claims over the `negative` and `failed` facts. Over the `flag` and `proof` facts, write one `risk-proofs` claim per flag that has a `proof` fact, citing both (a `proof` fact is `not-run`, so the claim renders `planned, not verified`); a flag no claim cites renders as `no proof shown`. Each Try it step (re-run the **Try it block** resolve line and read the file) becomes one `test-guide` claim citing its own group's `link:entry-point-{n}`, with its Precondition, Access and Expected in the claim text; a step needing a login names the vault entry, never a value.

**Render**, as its own Bash call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" render --facts "{FACTS}" --narrative "{NARRATIVE}" --out "{PACKET}" --dropped-out "{DROPPED}" --observation-plan "{PLAN}" --poster "{poster}"
```

Exit 1: fix the narrative the stderr names and re-render once. A second exit 1: report it in the summary and log it, post nothing, apply no label. Any other non-zero exit stops the same way, with no re-render.

`{poster}` is the **skill** that invoked this file, on this default (Step 1-4) path exactly as on
the Parent-Gate Procedure's — never hardcode `/claude-tweaks:wrap-up`, and pass it bare, since
`render` escapes a backtick. Per the Routing table at the top of this file: `/claude-tweaks:wrap-up`
for either wrap-up entry (Phase 4's execution step or the auto-merge short-circuit),
`/claude-tweaks:dispatch` for the group auto-merge gate or close-out step 3. The string is
outward-facing (posted as a GitHub comment, or embedded in a local record body), so a
`/dispatch`-posted packet claiming `/wrap-up` posted it would be wrong: that path never reached
`/wrap-up`'s Phase 4 execution step.

**Post.** `work-backend: github-issues`, as its own Bash call, with `--pr` only when `run-state.json` carries a `pr` object and `--label` omitted below the floor (Decision Q5):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" post --record {N} --body-file "{PACKET}" --label demo:pending --pr {pr-number}
```

`post` posts or edits the packet before it adds the label, so a reader reacting to the label never sees `demo:pending` without a packet attached. Acceptance labeling stays on the record either way. Route on its exit code, and on the one JSON result line it prints:

- **Exit 0** — the packet landed. Report a result `prLink` with `ok: false`, and any `extras` or `skipped`, in the summary: none of them fails the publish.
- **Exit 1** — the label is not applied. With no result JSON, `--body-file` would not read and nothing ran. Otherwise report the result's `error`, and `stalePacket` when it names one, in the summary and log it, stating what `labelRemoval` reports and never more:
  - `labelRemoval: 'removed'` — the post or edit failed and the pending label was removed.
  - `labelRemoval: 'absent'` — the post or edit failed and no pending label was there to remove.
  - `labelRemoval: 'failed'` — the post or edit failed and so did the removal: add a needs-human line naming the pending label still on the record, and `stalePacket` when it names one.
  - `labelRemoval: null` — nothing was cleared. A failed comment read or an unreadable existing packet made no write at all, so any pending label is still there: say so. A result carrying a `url` is the other case: the packet landed and the label failed to apply (`labelApplied: false`), so report that packet's url.
- **Exit 2** — a malformed call, or a `--body-file` with no marker on its first line. Nothing ran: report it, post nothing, apply no label. This is never the MCP path.
- **Exit 4** — `gh` is absent: the contract's MCP transport (Decision Q4). Read the record's comments through `issue_read` (`get_comments`) and run `readPacket`'s rules by hand (`## Canonical copy and lookup`).
  - A failed read or an `unreadable` packet: report it, write nothing, post nothing, apply no label (`## Failure contract`).
  - An existing packet: report the failed edit naming that packet's url, post nothing, apply no label, and clear the pending label.
  - None: post `{PACKET}`'s text with `add_issue_comment`, per `_shared/github-write-transport.md`'s Marker comments on the MCP path; a failure there is reported and followed by the same clearing. Then, above the floor only, apply the label through `issue_write`'s read-merge-write. Then, when the run has a PR, read its body with `pull_request_read` and link the packet through MCP `update_pull_request`, matching `publishPacket`'s `replacePacketLine`: replace this record's existing `Acceptance packet:` line (a single url on the same `/issues/{N}#`; another record's line stays) with `Acceptance packet: {comment url}`, append that line after a blank line when the body has none, and write nothing when the body already reads that way. A failed label write leaves the packet in place and skips the PR line, reported as the `gh` path's `labelApplied: false` is. A failed PR-line write does not fail the publish, reported as the `gh` path's `prLink` with `ok: false` is.
  - Clearing the label is `issue_read` (`get_labels`) immediately before the write, then, only when `demo:pending` or `accept:pending` is present, `issue_write` with the complete array `mergeLabelNames` computes, per `_shared/github-write-transport.md`'s Full-replace hazard, and no write when neither is present. A failed clearing gets the same needs-human line.

`work-backend: local-files` — run `local` as its own Bash call, with `--pending` omitted below the floor (Decision Q5). `{record-file}` is the record file itself, the `.path` of its entry in a combined open+closed `queryRecords('specs', {})` / `queryRecords('specs', { closed: true })` listing, since the record may have closed by now. A non-zero exit means the record is unchanged: report it in the summary and log it.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" local --record-file "{record-file}" --body-file "{PACKET}" --pending
```

**Log a stop or a failure** when a run directory resolves, as its own Bash call, with `{text-file}` holding one line, `condition: packet {risk facts | gather | render | post | local} failed ({stderr line}) → fallback: {what happened to the packet and the label}`, written per `_shared/auto-decision-log.md`'s Text from git or a user paragraph:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --section "/wrap-up" --status SKIP --step "Acceptance packet Step 4" --reversibility n/a --text-file "{text-file}"
```

Then post the run's Timing table as the `timing` kind, under `_shared/pr-run-comments.md`'s gate (`run-state.json` carries a `pr` object, #1928), whatever the packet's outcome; a `tokens: transcript not found (...)` line, when present, is posted verbatim with the table, and so is the CLI's Dispatches block (tier and role tables and any `dispatches:`/`dispatch agent-{id}:` lines) when it prints one. **Multi-spec marker (#2970):** a multi-spec `/claude-tweaks:flow` run sharing one PR across specs (`flow/multi-spec.md`) qualifies the marker per `_shared/pr-run-comments.md`'s "Multi-spec brief and timing comments" section: `<!-- run-comment: timing:{spec} -->` when `$MULTISPEC_PARENT_DIR` is set, the plain `<!-- run-comment: timing -->` marker otherwise:

```bash
printf '<!-- run-comment: timing -->\n\n' > /tmp/pr-timing-{issue}.md
# $MULTISPEC_PARENT_DIR set: printf '<!-- run-comment: timing:{spec} -->\n\n' instead, {spec} = basename($PIPELINE_RUN_DIR)'s numeric suffix
node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript >> /tmp/pr-timing-{issue}.md
# find-or-create per _shared/pr-run-comments.md's post-or-update procedure, kind=timing (or timing:{spec} under multi-spec), against {pr-number}
```

When wrap-up's cleanup item 8 has already archived the run directory (`cleanup-procedures.md`), pass `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` as `--run` instead — the events and manifest travel with the archive.
