# Wrap-Up — Verification Brief Procedure

Canonical procedure for the acceptance-labeling action: applying `demo:pending` and posting
the Verification Brief. Record mode only (a record is identified for this run, per
`/claude-tweaks:wrap-up` Phase 1 — a materialized header is not required) — conversation-based
work has no work record to label, so this procedure does not run for it.

## Routing — read this before anything else, whatever invoked this file

**The routing below is this file's decision, not its caller's.** Every call site lands here
first and inherits it, so a new one never has to re-derive the condition (and cannot get it
wrong by omission). Four call sites exist today:

| Caller | Arrives holding |
|---|---|
| `/claude-tweaks:wrap-up` Phase 4 execution's Acceptance-labeling bullet (`wrap-up/execution-and-verification.md`) | one **sub-issue**, mid-close |
| `/claude-tweaks:wrap-up`'s auto-merge short-circuit (`wrap-up/review-console.md`) | one **sub-issue**, mid-close |
| `/claude-tweaks:dispatch`'s group auto-merge gate (`dispatch/settle-and-merge.md`) | one **sub-issue** per group member, mid-close — plus the group's whole closing sub-issue set (see the Self-inclusion rule) |
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

A caller that already holds a **parent** number is inside the Parent-Gate Procedure by
construction — there is no sub-issue to resolve, so it starts at **Enumerate the parent's
sub-issues**.

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
  posted. The record closes with no `demo:*` label and no ceremony (this is the *not required*
  outcome, not a `demo:exempt` marker — see the design's Non-Goals). It stays demoable later on
  request: `/claude-tweaks:demo #N`'s existing closing-commit-reconstruction fallback already
  resolves a record carrying no `demo:pending` label, unchanged by this gate.

  Record the exemption (#2383) so `wrap-up-engine.js verify`'s `acceptance-labeling` check knows
  this record was deliberately skipped, not silently missed: append `N` to
  `$PIPELINE_RUN_DIR/verify-expectations.json`'s `oversightExempt` array (read-modify-write —
  the console's own later write, `review-console.md` Step 10, preserves this field rather than
  clobbering it; create the file with the version-1 defaults first when it doesn't exist yet):

  ```bash
  node -e "
  const fs = require('fs');
  const p = process.argv[1] + '/verify-expectations.json';
  let data = { version: 1, memory: [], upstream: [] };
  if (fs.existsSync(p)) { try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
  const s = new Set(data.oversightExempt || []);
  s.add(Number(process.argv[2]));
  data.oversightExempt = [...s].sort((a, b) => a - b);
  fs.writeFileSync(p, JSON.stringify(data));
  " "$PIPELINE_RUN_DIR" "{N}"
  ```
- **`exceeds: true`** (including `reason: 'unscored'` — a missing or out-of-vocabulary
  `risk`/`size` facet fails closed) — proceed to Step 1 exactly as before this gate existed.

Log the outcome to `decisions.md` either way (`_shared/auto-decision-log.md`): `AUTO` status,
rationale = the `reason` field (or `null` on a pass), reversibility = high (the closing-commit
fallback covers a skipped gate; a human can still `/demo #N` it).

## Step 1: Bootstrap the Acceptance labels

Run the check-then-create loop from `_shared/label-bootstrap.md` with:

```js
LABELS_JSON = [
  ["demo:pending", "Acceptance: built and verified — awaiting human sign-off via /claude-tweaks:demo"]
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
screenshots to `docs/demo-evidence/{record}/{NN}-{description}.png` on this run's current branch
— `{record}` is the issue number (`github-issues`) or record id (`local-files`); `{NN}` is a
zero-padded sequence starting at `01`; `{description}` is a short kebab-case label matching the
screenshot's content (e.g. `settings-toggle-persisted`). Commit before composing the template
below — the embed needs the committed SHA.

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
execution step or the auto-merge short-circuit), `` `/claude-tweaks:dispatch` `` for the group auto-merge gate, and
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
instead of the whole template.

```bash
printf '<!-- run-comment: brief -->\n\n' | cat - /tmp/verification-brief-{issue}.md > /tmp/pr-brief-{issue}.md
# find-or-create per _shared/pr-run-comments.md's post-or-update procedure, kind=brief, against {pr-number}
gh issue comment {issue} --body "Verification Brief posted to PR #{pr-number}: {pr-url}"
gh issue edit {issue} --add-label demo:pending
```

Then post the run's Timing table as the `timing` kind, under the same gate (#1928); a `tokens: transcript not found (...)` line, when present, is posted verbatim with the table:

```bash
printf '<!-- run-comment: timing -->\n\n' > /tmp/pr-timing-{issue}.md
node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript >> /tmp/pr-timing-{issue}.md
# find-or-create per _shared/pr-run-comments.md's post-or-update procedure, kind=timing, against {pr-number}
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
