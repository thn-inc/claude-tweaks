---
name: feedback
description: Use when a learning belongs upstream in the claude-tweaks plugin rather than this project — a skill that behaves wrongly (defect) or has no opinion where it should (gap). Files a GitHub issue against claude-tweaks after an explicit scrub and confirmation.
argument-hint: "[<learning text>] [--kind=defect|gap] [--dry-run] [--queue] [--full] [--pre-confirmed]"
---

# Feedback — Route a learning upstream to the claude-tweaks plugin

The D5 writer of `_shared/learning-routing.md`. Files learnings that would help
every adopter of the plugin, not just this project.

Lifecycle: `/claude-tweaks:reflect` → **`/claude-tweaks:feedback`** → upstream issue

## When to Use

- The routing classifier returned **D5** for a learning (rule 1 or rule 7).
- A `/claude-tweaks:*` skill behaved wrongly, errored, or was missing a
  capability, and the lesson would hold in any project using the plugin.
- A health sweep surfaced a finding whose subject is a claude-tweaks skill
  rather than this project's own code.
- Invoked bare (no arguments) to check this project's own `upstream-candidate`
  backlog — findings the health sweeps' headless path already filed locally
  and left for a human to forward — and to evaluate the session itself
  against the maintainer-objective rubric (see Step 0).

Do **not** use this skill to file against any repository other than
`thomasholknielsen/claude-tweaks`. A learning owned by a third-party dependency
is reported to the user and stopped — see `_shared/learning-routing.md`,
"Non-claude-tweaks upstream".

## Input

`$ARGUMENTS` is parsed as `[<learning text>] [--kind=<value>] [--dry-run] [--queue] [--full] [--pre-confirmed]`:

| Argument | Behavior |
|----------|----------|
| Free-text learning | The substance of the report. When absent, gather it from the conversation or ask. |
| `--kind=defect` | The plugin does something wrong. Skips Step 2's inference. |
| `--kind=gap` | The plugin has no opinion where it should. Skips Step 2's inference. |
| `--dry-run` | Run Steps 1-7 (classification, self-reference, dedup, drafting, scrub, and the confirm gate's dry-run branch), then render the draft and **stop** — Step 8 (label resolution and `gh issue create`) never runs. Step 4's dedup search is a real, read-only `gh issue list` call; no `gh` call ever creates, labels, or files anything. When `--pre-confirmed` is also passed, `--dry-run` wins — see Step 7. |
| `--queue` | Explicit bare-invocation mode (see Step 0) even when free-text is also present — process this project's own `upstream-candidate` backlog instead of (or in addition to) the free-text learning. |
| `--full` | Presence-only, meaningful only for bare/`--queue` invocation (Step 0's session-evaluation gather): ignore any existing watermark for the resolved transcript, dispatch the full un-scoped judge (no offset clause), then overwrite the watermark with the fresh result exactly as a first-ever evaluation would. This is also what bypasses `session-evaluation.md`'s Skip check (Step 0's Gather 2): that check reads the same watermark, so ignoring it always resolves to dispatch. A no-op combined with free-text-only invocation — free-text invocation without `--queue` runs no session evaluation at all (Step 0's rule). |
| `--pre-confirmed` | Presence-only like `--dry-run`; the caller passes the item's staged-file path and the approved snapshot body alongside it. Skip Step 7's `AskUserQuestion` for this item when the caller-supplied approved snapshot is diffed against the current staged file with no mismatch (drift check); Step 6's scrub always reruns as a separate safety net regardless. On drift, falls back to a normal per-item confirm (see Step 7). Legitimate only from `/claude-tweaks:wrap-up`'s Review Console or `/claude-tweaks:flow`'s consolidated multi-spec console (see Component-Skill Contract). |

## Workflow

### Step 0: Bare-invocation umbrella (queue check + session evaluation)

When `$ARGUMENTS` carries no free-text learning (or `--queue` was passed), this is bare invocation:
run **two** gathers and merge their results into one batch before Steps 1-6 process it. Free-text
invocation runs neither gather — the single-learning path (Steps 1-9) is unchanged. A
`--pre-confirmed` invocation never runs these gathers either — it processes only its
caller-supplied staged item(s).

**Gather 1 — local upstream-candidate queue (unchanged).** This project may already hold
headless-filed candidates waiting for a human — the health sweeps' Subject check
(`_shared/learning-routing.md`) files these locally with `upstream-candidate` plus the sweep's own
`by:` label, deliberately without `ready`, precisely because nothing else in the plugin queries them
(#239). Check for them:

```bash
gh issue list --label upstream-candidate --state open --json number,title,body,labels --limit 100
```

(matching the label's expected low cardinality — a handful of headless-filed candidates, not the
full backlog — while still bounding the read per `[IL-67]`; if the count returned equals the
limit, state this in the summary rather than silently treating it as complete.)

**Gather 2 — session evaluation.** Read `session-evaluation.md` in this skill's directory. Before
dispatch, its **Skip check** runs first (on the transcript-resolved branch, `--full` not passed):
when the resolved transcript hasn't grown since the last stamped evaluation, skip the judge
dispatch entirely and report the prior stamp's `issueUrls` instead of re-evaluating — see that
section for the full check and its self-assessment exemption. Otherwise, run the judge dispatch
(or its self-assessment degradation) against `_shared/feedback-objectives.md`'s rubric. Each
returned finding becomes one merged-batch item; a `NOT EVALUATED` block is not a finding —
session-evaluation.md's own rule — and never enters the batch. The two gathers are
failure-isolated in both directions: a judge dispatch that errors or returns nothing usable
degrades to `session-evaluation.md`'s self-assessment path (noted in the run summary) and never
aborts the run — Gather 1's queue candidates proceed through the batch regardless — and a Gather
1 `gh` failure likewise never blocks the evaluation; the failed gather is reported in the run
summary while the other proceeds.

**Merging.** The two gathers feed **one merged batch by concatenation, no reconciliation** — each
item keeps its own draft shape; nothing here reconciles a queue candidate against an evaluation
finding even when they describe the same underlying issue. Run Steps 1-6 non-interactively for
every item in the merged batch (gather from the queue issue's own body, or from the finding's
symptom/evidence/proposed fix — deriving the affected component from the skill, contract, or CLI
the evidence names, falling back to "unclear / general" per Step 1 — classify,
confirm self-reference doesn't apply, dedup search, draft, scrub), then call
`_shared/upstream-feedback-batch.md`'s shared batch contract once — chunked per that file's own
rule — instead of looping Step 7 individually per item. Step 4's dedup fingerprint basis stays the
affected component plus the core symptom, exactly as today — the draft template's
`**Objective:**`/`**Measurement:**`/`**Cost this session:**` fields (Step 5) never join that basis.

Inside this loop, "stop" in Steps 2, 3, or 6 scopes to the one item that triggered it — drop that
item from the batch (report why, alongside the others' results) and continue the loop for the
rest; it never aborts the whole bare-invocation run, matching Step 7's own per-item isolation for
the drift-check fallback. A judge finding that Step 2 classifies as not D5 drops from the batch the
same way. A dedup match in Step 4 does not stop the item or ask interactively — see Step 4's own
batch-mode text. On a checked queue-derived item filing successfully (Step 8), close the local
`upstream-candidate` issue with a comment linking the new upstream issue — an evaluation finding has
no local issue to close. An unchecked item is handled per the shared contract's decline rule
(comment + leave the local issue open, where one exists).

**Interaction budget.** The whole bare-invocation run — both gathers, however many items each
produces — costs exactly one Step 7 batch confirmation plus one `## Next Actions` call; the
evaluation gather itself adds zero mid-flow `AskUserQuestion` calls. Under `--dry-run`, findings
from both gathers render and the run stops — Step 7's existing `--dry-run` precedence, extended
here to evaluation findings without change.

**Neither gather produced anything:** proceed to Step 1 as usual (gather from the conversation, or
ask).

This is what resolves `upstream-candidate`'s dead-write state (#239): the label's own consumer
was always meant to be a human eyeball plus a manual `/claude-tweaks:feedback` invocation
(`_shared/learning-routing.md`'s Headless-runs paragraph says exactly this), and this step is what
makes that eyeball's job a single command instead of a `gh issue list` a human has to remember to
run.

### Step 1: Gather

Determine the summary (one line), the affected component (the skill, contract,
or CLI involved, or "unclear / general"), and a title naming the component and
the symptom. For a defect, also gather repro steps and expected-vs-actual. For a
gap, gather the use case — what the user was trying to do and why the plugin's
current behavior does not support it.

Also judge Definition: does this learning name a genuine open choice with no
tradeoff made yet — two or more viable directions, no stated preference — or a
single clear ask? This is a content call made in this same turn, not a
structural heuristic (the same posture `solution:unjustified`'s judgment takes).
`Needed` only when the learning genuinely names an undecided choice; default
`Clear` otherwise. When `Needed`, form a one-line rationale naming the open
choice — this and the verdict feed Step 5's draft.

When the free-text names a preserved unfiled draft by absolute path (the
`/claude-tweaks:feedback re-file the preserved draft at {abs path}` form `/claude-tweaks:tidy`'s
backstop scan hands out), read that file and use its body directly as the gathered summary,
affected component, and repro-steps-or-use-case content — the draft was already fully composed
once; Step 6's scrub reruns unconditionally as the standing safety net regardless of this shortcut.

### Step 2: Classify the kind

Read `_shared/learning-routing.md` and confirm the learning is D5 at all.

**If it is not D5, stop.** Report the destination the contract actually returned
and hand the learning back to the caller. This skill files D5 learnings and
nothing else — a misrouted learning filed here becomes an off-topic public issue.

Otherwise:

- Classifier **rule 1** fired → `defect`
- Classifier **rule 7** fired → `gap`

The kind comes from which rule fired. Never guess it, and never infer it from
tone. If `--kind=` was passed, use that and skip the inference.

A defect and a gap differ in triage, urgency, and what a maintainer does with
them. They must not arrive looking identical.

### Step 3: Self-reference check

```bash
git remote get-url origin
```

If the remote resolves to the claude-tweaks repository itself, **stop**. Report
that the learning belongs in this project's own records and re-run the
classifier from rule 4 per `_shared/learning-routing.md`. Do not file.

**Fallback when `git remote get-url origin` throws (no live git context —**
**e.g. a persisted worktree-isolation pin after a worktree teardown, #703).**
Prefer an already-known slug over failing outright:

1. Read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`'s `repository`
   field. This is a static file read, never a git command, so it works
   regardless of git context — but it only proves self-reference when
   `${CLAUDE_PLUGIN_ROOT}` is nested inside the current project's own working
   tree (the local-dev `claude --plugin-dir ./plugin` case this repo's own
   CLAUDE.md documents), since that's the one situation where the plugin's
   declared home repo genuinely *is* the project being worked in. Check that
   nesting via a plain path prefix comparison against `$RUN_ROOT`
   (`_shared/pipeline-run-dir.md`'s Anchoring section) — no git command
   needed for that comparison either.
2. If nested, confirm the slug with `gh repo view --repo {slug} --json
   nameWithOwner` and treat a match as self-reference (stop, same as the
   primary check). A marketplace-installed plugin (`CLAUDE_PLUGIN_ROOT` under
   `~/.claude/plugins/cache/...`) is never nested this way even when the
   current project *is* claude-tweaks — `plugin.json`'s `repository` field is
   a fixed copy shared by every project that installs the plugin, so it
   proves nothing there.
3. If `${CLAUDE_PLUGIN_ROOT}` isn't nested in the current project (including
   every marketplace install), there is no pre-known slug that answers this
   check — skip it with a logged assumption ("git context broken; project
   identity unconfirmed; proceeding as not self-referential") rather than
   throwing. This is the safer failure direction: incorrectly filing a
   project's own bug as upstream feedback is easier to catch and re-route at
   review than silently dropping a legitimate feedback filing because git was
   unavailable.

### Step 4: Dedup

Derive the `--search` keywords from the affected component name **only** — never from the
free-text symptom/summary, since that text is draft-derived and has not yet passed Step 6's scrub
criteria below. A component name (a skill, contract, or CLI name from the claude-tweaks plugin's own
public documentation — never a name drawn from the reporting project) is inherently public
vocabulary and carries no privacy risk on its own — this is what keeps
draft-derived, potentially-private text from ever reaching the public search API before the scrub
gate runs:

```bash
gh issue list --repo thomasholknielsen/claude-tweaks --search '<component>' --state all --limit 10 --json number,title,state,url
```

**On a transient-looking failure** (the error text names a 5xx/server error, a timeout, or a
connection reset — e.g. `HTTP 503: No server is currently available to service your request`, not
an auth/ref problem): retry this call **once** after a 15-second wait, then treat a second failure
like any other failure — the same signature and single-retry convention
`_shared/pr-early-run-lifecycle.md`'s push/PR-create steps already use for a `gh`/git call. Not
`_shared/github-rate-limit.md`'s classification: that file is scoped to rate-limit signatures
(403/429), never a plain 5xx/timeout outage — a bare 403/429 here is not retried.

When the affected component resolved to Step 1's `"unclear / general"` fallback, there is no
public-safe keyword to search on: **skip the search entirely** and say so in the report — never
fall back to the summary text this step just ruled out. Step 8's fingerprint-marker dedup still
runs and remains the authoritative duplicate check.

Show any plausible matches and ask whether to file anyway, comment on the
existing issue instead (then stop), or cancel. A component-name-only search is a coarse screen,
not a reliable duplicate check — a busy component's ten most relevant issues need not include an
actual duplicate. That is acceptable because the authoritative dedup runs later: `bin/file-feedback.js`
matches the fingerprint marker exactly at Step 8 and reports `dedup-hit` without filing. Treat a
no-match here as "nothing obvious to show the human", never as proof the report is new.

**Inside Step 0's batch loop** (non-interactive), this three-way ask does not run. A match
instead becomes the drafted item's dedup flag — `**possible duplicate:** #{N}` per
`_shared/upstream-feedback-batch.md`'s Chunking rule — and the human's check/uncheck decision on
that flagged item in the shared batch contract stands in for "file anyway" (checked) or "cancel"
(left unchecked, handled by the contract's decline rule). "Comment on the existing issue instead"
has no dedicated batch-mode option; a human who wants that outcome uses the contract's free-text
edit channel (naming the item and requesting "comment on #{N} instead of filing") rather than a
third checkbox state.

Derive `fingerprintBasis: { component, summary }` for the drafted item — the
affected-component-plus-core-symptom inputs, wider than what fed the narrowed search above — and
carry it into the drafts file built for Step 8, full and unscrubbed. This basis feeds a different
consumer than the search: `bin/file-feedback.js` derives the fingerprint marker via
`fingerprintFromBasis('feedback', basis)` (`bin/lib/health-core/fingerprint.js`) when it processes
the draft, so a later run recognizes its own prior filing — that stable dedup-on-refile detection
needs the full basis regardless of what the search above sends. Carrying it unscrubbed is safe for
the same reason the search above is narrowed: the basis never leaves this machine as text —
`fingerprintFromBasis` sha1-hashes it into a `feedback-{8 hex}` marker, and that opaque marker is
the only thing derived from it that ever reaches GitHub (embedded in the filed body, and matched by
the CLI's own dedup lookup). Never scrub the basis to match the scrubbed body: that mints a
different marker for the same finding and breaks dedup-on-refile. Never call `createFingerprint`
directly here.

**Prior-decline annotation (#1033).** With `fingerprintBasis` derived above, compute this item's
fingerprint the same way Step 8's filing CLI would — `computeFingerprint({ fingerprintBasis })`
(`bin/lib/feedback/file-feedback.js`, the same wrapper around `fingerprintFromBasis` the CLI itself
calls, so this lookup and Step 8's own dedup-on-refile check always agree on the same hash) — and
look it up via `bin/lib/declined-learning/store.js`'s `lookupDecline(fingerprint)`. A match means a
human already declined this exact finding before, via this same fingerprint; carry `priorDecline:
{ declinedAt, reason }` on the drafted item for `_shared/upstream-feedback-batch.md`'s Rendering and
Chunking steps to annotate — mirroring reflect's "annotated, never silently suppressed" treatment
(`reflect/full-mode.md`'s Prior-decline annotation): a re-surfacing finding still gets a full draft
and a real confirm decision, it just carries the prior context so the human isn't asked to decline
the same thing twice with no memory of having done so already. This is the reachable half of the
fix: unlike the judge-dispatch offset clause (`session-evaluation.md`'s `dismissedSubjects`, which
can only ever omit a finding the judge chooses not to raise), this runs after a candidate item
already has a computed fingerprint, so an exact-hash lookup here is fully mechanical — no judgment
call, no near-miss handling needed at this step.

### Step 5: Draft

Title: `<component>: <symptom>`

```
**Summary:** <one line>

**Kind:** Defect | Gap

**Affected component:** <skill, contract, or CLI — or "unclear / general">

**Objective:** <objective name from _shared/feedback-objectives.md> (evaluation-sourced drafts only)

**Measurement:** <counts> (countable lenses only — omitted for judgment lenses)

**Cost this session:** <one line, from the finding> (evaluation-sourced drafts only)

**Repro steps:** (defect only)
1. ...

**Expected vs. actual:** (defect only)
Expected: ...
Actual: ...

**Use case:** (gap only)
<what you were trying to do and why current behavior does not support it>

**Definition:** Needed | Clear — <one-line rationale, when Needed>

**Plugin version:** <from ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json>

---
Filed via /claude-tweaks:feedback.
<!-- fingerprint: <marker> -->
```

Resolve the plugin version from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`,
never from install metadata or `gitCommitSha` (`[IL-89]`).

**Objective**/**Measurement**/**Cost this session** omission rule: all three fields are omitted
entirely on drafts no evaluation produced — free-text learnings and Step 0 queue candidates alike.

### Step 6: Scrub — HARD GATE

<!-- HARD-GATE: feedback-scrub -->

The target repository is **public** and the learning was derived from a codebase
that may not be. Before showing the draft, remove:

- Credentials, tokens, and connection strings
- Absolute paths outside the plugin itself
- Code excerpts from the reporting project
- The reporting project's name, when that project is private — say "a private
  project" instead

Keep only what a maintainer needs to reproduce or understand the report.

This gate is unconditional. It runs on every invocation, including `--dry-run`
and including invocations that began inside a pipeline.

**`[Use: Capable]` singleton.** The scrub judgment is dispatched — never run inline
— as **one** Task agent per invocation: the main thread hands it the drafted body from Step 5 and
this step's removal criteria verbatim, and the agent returns the scrubbed body plus a one-line note
of what it removed (or "nothing to remove"). Resolve the model via `node
"${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable` (no `--run-dir` — `/feedback`
is typically invoked standalone with no run directory; one scrub dispatch per invocation,
enforced here by this skill rather than by a run-dir tally; append `--unattended` only when the
invocation is genuinely headless — a scheduled Routine or a `claude -p` run — resolved from
session state, never a hard-coded literal). Record #221 originally granted
this scrub the skill's one Frontier singleton slot; this skill's Frontier singleton slot now
belongs to the session-evaluation judge
(`session-evaluation.md`, Step 0) instead, knowingly superseding #221's scrub entry — the scrub's
structure, unconditionality, and hard-stop semantics above and below are unchanged. Degrades per
the resolver's own preconditions, logged in its `source` — never re-enumerated here. Filing (Step
8) and confirmation (Step 7) stay in the main thread and human-gated regardless of which model
scrubbed the draft; the dispatch structure is identical either way.

**If the learning cannot survive the scrub, stop.** When the report is only
intelligible with content that must be removed — the reproduction depends on
private code, or the symptom cannot be stated without naming private
infrastructure — do not file a gutted version and do not file the original.
Report that the learning is unfileable as-is and hand it back. A learning that
cannot be scrubbed cannot be published.

### Step 7: Confirm — HARD GATE

<!-- HARD-GATE: feedback-confirm -->

**A subagent that inherited this skill's own text as background context — via `fork`, a
broad Task dispatch, or any mechanism carrying the full conversation — must not execute past
this point on its own initiative.** If it cannot present this gate interactively (no live
human to answer it), it must stop and report `BLOCKED` rather than filing anything. See
`_shared/subagent-output-contract.md`'s "HARD-GATE Marker Convention and Inheritance Hazard"
section (`docs/incident-log.md` `[IL-139]`).

Show the full scrubbed draft(s) and call into `_shared/upstream-feedback-batch.md`'s shared batch
contract — one item (this invocation's single learning, or a single surviving `--queue` candidate)
is the contract's degenerate single-chunk case; N items under `--queue` chunk per that file's own
rule. Never file without the resulting per-item confirmation, in any mode. Publishing to a public
repository is outward-facing and effectively irreversible.

**`--pre-confirmed`:** the caller passes both the item's staged-file path and the exact body text
it rendered and got approval for (the approved snapshot) — not just a path reference. Before
filing, two checks run, always in this order:

1. **Scrub rerun (unconditional)** — Step 6's scrub always reruns first, on the current on-disk
   staged content, as a defense-in-depth safety net before publishing — regardless of whether the
   drift check below finds a mismatch, since a modification that caused drift could itself have
   reintroduced content that needs scrubbing. This produces the content that will actually be
   filed. If this rerun trips Step 6's own hard-stop ("cannot survive the scrub") for this item,
   treat it exactly like a Step 6 stop anywhere else in a batch: drop this one item (report why)
   and continue processing the rest of the chunk — it never aborts sibling items.
2. **Drift check** — if `staged/wrap-up-upstream-{N}.md` no longer exists, treat this as "already
   filed" (see Step 8's cleanup-on-success below) and skip this item without re-filing or
   erroring. Otherwise, re-read it fresh from disk (the post-scrub content from step 1 above) and
   compare it, byte-for-byte, against the approved snapshot the caller passed. A mismatch means
   the staged file changed after it was rendered and approved — fall back to the normal
   `AskUserQuestion` confirm, showing the post-scrub content (not the pre-scrub approved snapshot)
   so the human approves exactly what would be filed. This fallback is per-item — it never aborts
   sibling items in the same batch.

When the drift check finds no mismatch, skip the `AskUserQuestion` call for that item and file the
post-scrub content directly.

**`--dry-run`:** render every draft, state the classified destination and kind, then **stop here**
— no `AskUserQuestion` call of any kind, and nothing filed. This holds whether or not
`--pre-confirmed` was also passed: `--dry-run` takes precedence over it. Separately,
`bin/file-feedback.js` (Step 8's filing CLI) accepts its own `--dry-run` flag — independent of
this gate, for exercising the CLI directly without going through this human-gated flow; this
skill's own flow never reaches Step 8 while this gate holds.

### Step 8: File

**First**, resolve the label. Never pass one that has not been confirmed to
exist:

```bash
gh label list --repo thomasholknielsen/claude-tweaks --limit 200
```

On a transient-looking failure (5xx/timeout/connection-reset signature — not a plain 403/429,
which `_shared/github-rate-limit.md` owns), retry once after a 15-second wait per Step 4's own
retry note above, then treat a second failure like any other failure.

Pass `--label bug` for a defect or `--label enhancement` for a gap **only** when
that label is present in the output.

When Step 1's Definition judgment (or Step 5's rendered `**Definition:**` line) reads `Needed`,
also bootstrap `needs:definition` per `_shared/label-bootstrap.md`'s check-then-create loop
(`["needs:definition", "Undecided idea — must go through /specify's brainstorm redirect before
reaching ready"]`) and pass `--label needs:definition`. This is the **single named exception** to
the internal-taxonomy rule below — every other label in that taxonomy stays off-limits here.

Omit `--label bug`/`--label enhancement` entirely when unconfirmed and say
why — never substitute a guessed label, and never apply the repository's own
internal automation taxonomy (`by:*`, `type:*`, `risk:*`, `ready`, `size:*`),
which belongs to records that moved through its in-repo pipeline — `needs:definition` above is
the one deliberate, named exception to this rule. This CLI files against another repo, and it
never bootstraps labels there — the label-resolution checks above stay in the skill, run before
the drafts file is built; the CLI only ever receives the labels the drafts file names and does
not compute label policy itself.

**Then** file via `bin/file-feedback.js`, not a shell recipe: `gh` has no `--title-file`, so a
title interpolated into a shell string is corruptible by backticks or `$(...)` — the CLI instead
passes the title through its runner's argv array, never string-interpolated, while the body still
goes via `--body-file`.

1. Write the drafts file via the **Write tool** — never `echo`, which mangles `\n` in zsh — to
   `{run-dir}/staged/feedback-drafts.json` when a run directory exists, or a scratch path
   otherwise. Each entry is `{ title, body, labels, fingerprintBasis }`: `labels` is exactly the
   `--label` argument(s) resolved above (an omitted label stays omitted), and `fingerprintBasis`
   is Step 4's `{ component, summary }`.
2. Invoke:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/file-feedback.js" --drafts <path> --repo thomasholknielsen/claude-tweaks
   ```

   `--repo` is explicit and hardcoded here, matching every other `gh` call in this step and Step
   4 above — the CLI's own `--repo` default resolves the invoking project's `origin` remote, which
   is the host project `/feedback` is running from, not the upstream `claude-tweaks` repo the
   learning is filed against. (No `--dry-run` here — Step 7's own dry-run gate already stopped
   before Step 8 is ever reached; the CLI's `--dry-run` flag noted in Step 7 is a separate,
   direct-invocation-only affordance.) Every `gh` call this CLI makes (the CLI's own
   fingerprint-marker dedup lookup — this step's authoritative check, a plain `gh issue list` plus
   an in-process marker match, never `--search`, per `_shared/github-write-transport.md`; not Step
   4's component-keyword screen — and the read-back `gh issue view`) automatically retries up to 4 times (5 total
   attempts — this record's own observed worst case) after a 15-second wait on a transient-looking
   failure — `bin/lib/feedback/file-feedback.js`'s `withTransientRetry`, applied internally by
   `fileOne`. `gh issue create` retries the same way, but dedup-safe: since issue creation isn't
   idempotent, a retry first re-runs that same dedup lookup for this draft's fingerprint marker — a hit
   means the "failed" attempt actually succeeded server-side (its response was lost to the same
   transient condition), so that issue is reused instead of a second one being filed
   (`createWithDedupSafeRetry`). No per-call shell loop needed either way.
3. Report its per-draft result table verbatim — `filed #{n}` / `dedup-hit #{n}` /
   `filing-failure: {reason}` per line, in input order. This table **is** Step 9's per-item report
   source now, not a paraphrase.
4. On any `filing-failure` row, follow the existing "do not silently drop the payload" rule: the
   CLI's own stderr/table already states the `gh` error and which draft failed, so this step adds
   only the existing staged-fallback behavior — write that draft's body to the run directory's
   `staged/` as `upstream-unfiled-{N}.md` when a run directory exists, deliberately outside the
   `staged/wrap-up-upstream-*.md` aggregation glob `review-console.md` and
   `multispec-review-console.md` both scan, so a stop-and-resume never re-enumerates a failed
   draft as a fresh upstream proposal — and tell the user the filing did not happen and the draft
   is preserved. This row means the CLI's own single retry (above) already ran and still failed —
   not that no retry was attempted.
5. **On success when invoked via `--pre-confirmed`:** delete the staged file at
   `staged/wrap-up-upstream-{N}.md` for each draft the CLI table reports as `status: filed` or
   `status: dedup-hit` — condition on the table's status, not on `gh issue create`'s own exit code
   directly — immediately after the CLI returns. This is what makes Step 7's drift check "file not
   found" branch mean "already filed" rather than an error, and prevents a
   `/claude-tweaks:wrap-up resume` (or the multi-spec console's own resume) from re-rendering and
   re-filing an item whose chunk already succeeded before an interruption. A direct
   (non-`--pre-confirmed`) invocation has no staged file to clean up — this step is a no-op in
   that path.

### Step 9: Report

Give the user the created issue URL. If the flow stopped early — at Step 2 (not
a D5 learning), Step 3 (self-reference), Step 4 (duplicate), Step 6 (unscrubbable),
or Step 7 (declined or `--dry-run`) — report which step stopped it and why.
Nothing further is needed.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention), lines drawn from context — include only the lines that apply:

**{the parent workflow's next command, fully qualified, e.g. `/claude-tweaks:wrap-up {spec}`}** — continue the parent workflow (recommended)
`/claude-tweaks:feedback {second learning}` — file another related learning while it's fresh
`gh issue view {created issue URL} --web` — open the filed issue for reading or follow-up

## Component-Skill Contract

When `$PIPELINE_RUN_DIR` is set, `/claude-tweaks:feedback` is running inside a
pipeline (invoked by `/claude-tweaks:wrap-up`, `/claude-tweaks:reflect`, or
another pipeline orchestrator). In that case omit the `## Next Actions` block —
the parent owns the handoff.

Direct invocation may pass `--source <parent-skill>` as an explicit fallback when
ambiguity exists (rare; `$PIPELINE_RUN_DIR` is the primary signal).

Being inside a pipeline never relaxes Steps 6 and 7. `auto` mode does not
silence this skill — see `_shared/auto-mode-card.md`.

**`--pre-confirmed` legitimacy is narrower than "inside a pipeline."** The only legitimate source
of `--pre-confirmed` is `/claude-tweaks:wrap-up`'s Review Console, or the consolidated multi-spec
console at `/claude-tweaks:flow`'s end-of-run, invoking this skill per checked `U#` item — not a
general condition any pipeline orchestrator may claim, and not inferred from `$PIPELINE_RUN_DIR`
or any other ambient signal. This is a prose-enforced, auditable contract — a named caller, not an
ambient signal — because skills are markdown instructions the model follows, not executable code;
nothing structurally prevents a future second caller from passing the flag. A future caller other
than those two consoles passing `--pre-confirmed` is a scope violation to flag at review time, not
a precedent to extend the carve-out to.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Filing without showing the scrubbed draft | Publishing to a public repo is outward-facing and irreversible; confirmation is the contract, not a formality |
| Filing against a repo other than `thomasholknielsen/claude-tweaks` | Out of scope by design — a third-party owner has different consent requirements |
| Inferring the kind from tone rather than from which classifier rule fired | Defect and gap differ in triage; a mislabelled report wastes a maintainer's time in both directions |
| Applying a label `gh label list` did not confirm | Guessing risks importing the repo's internal automation taxonomy from outside its pipeline |
| Skipping the scrub because the reporting project "looks fine" | The scrub is unconditional; the cost of one leak exceeds the cost of every scrub |
| Filing when `git remote` shows claude-tweaks itself | Self-filing duplicates a record the project should hold directly |
