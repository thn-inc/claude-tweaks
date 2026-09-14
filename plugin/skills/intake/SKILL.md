---
name: intake
description: Sort a mixed braindump — pasted text or a file — onto this repo's shelves. Keywords - intake, braindump, gatekeeper.
argument-hint: "[<dump text>] [--file <path>]"
---

# Intake — Sort a braindump onto this repo's shelves

Lifecycle: dump → **`/claude-tweaks:intake`** → `/claude-tweaks:capture` → `/claude-tweaks:specify`

A human-only gatekeeper for a mixed dump of ideas, complaints, and half-thoughts — splits it into fragments, judges each one against *this* repo, and delegates every write to the skill that already owns it. Never extracts a URL, never invents a spec-shaped body, never loops past one nudge round.

## When to Use

- You have a braindump — pasted text, or a file of saved links/notes — that mixes work items, half-decisions, already-shipped observations, tool complaints, and noise
- You want each fragment sorted onto this repo's shelves (backlog, upstream, memory) or dropped, in one pass, before anything is filed
- You're not sure yet which fragments even belong in this repo

## Input

`$ARGUMENTS` is parsed as `[<dump text>] [--file <path>]`:

| Argument | Behavior |
|----------|----------|
| Free text | The dump body, taken verbatim. Mutually exclusive with `--file`. |
| `--file <path>` | Read the dump from this file. Mutually exclusive with free text. |
| Both text and `--file` | Hard error — stop and report; pick one. |
| Empty | One plain free-text prompt with the literal wording "Paste the dump here, or re-run with `--file <path>`." — never an `AskUserQuestion` (Step 4's call is this run's one decision). |

## Step 1: Context, read once

Read, once, before fragmenting anything:

- CLAUDE.md's project-philosophy sections and the README head — what this repo is and owns.
- The session-scoped record snapshot via `_shared/record-queue-fetch.md`'s read-fresh-or-fetch block (titles, bodies, labels, state) — the candidate set for `absorb`/`shipped` matching below.
- Recent merged commits via `_shared/integration-branch.md`'s resolution ladder, windowed per `_shared/health-recent-commit-check.md` — the `shipped` evidence set.
- `work-backend`/`work-types` from CLAUDE.md's `## Work records` section.
- `git remote get-url origin`, once. `$SELF_REPO` is `true` when the URL resolves to `thomasholknielsen/claude-tweaks`, **and also `true`** when the command fails, prints nothing, or the remote can't be classified — an uncertain identity never files an external issue.

## Step 2: Fragment

Split the dump into fragments: bullets, numbered lines, and blank-line-separated paragraphs each start a new fragment; a continuation line with no new bullet/number/blank line merges into the fragment above it — a judgment call, not a regex. Keep each fragment's source text verbatim. Capture a **hint** when the fragment carries one: `Label //` prefix, or a bare leading word before a URL or sentence.

**Within-dump duplicates.** Two fragments are duplicates when their text is identical after normalization (case-folded, whitespace collapsed, URL query strings stripped), or when one is a judged restatement of the other (a judgment call, exactly like fragmentation itself — untestable). The later fragment gets verdict `drop`, citing the earlier one.

## Step 3: Judge

Judge every fragment against exactly these eight verdicts, in this order — **first match wins**:

| Verdict | Meaning |
|---|---|
| `drop` | A within-dump duplicate or restatement of an earlier fragment (Step 2). |
| `shipped` | Already done. |
| `absorb:#N` | Belongs on one already-open record. |
| `upstream` | A defect or gap in claude-tweaks itself, filed against its own repo — never when `$SELF_REPO` is `true` (see below). |
| `remember` | A durable preference/fact about how to work, not a change to make. |
| `file` | A new backlog stub. |
| `nudge` | Relevant but too vague to sort without an answer. |
| `not-here` | Everything else — relevant to a different repo, or not actionable here. |

- **`shipped`** — the fragment's subject matches the subject line of a merged commit in the recent-merge window (`_shared/health-recent-commit-check.md`'s matching discipline), or the title of a closed record in the snapshot. Cite the commit hash or `#N`.
- **`absorb:#N`** — exactly one open record in the snapshot whose title or body names the fragment's subject (same component, same operation — topic-level, judged, not `/claude-tweaks:capture`'s file-path bar), after applying the absorb exclusions from `capture/routing.md` (closed / `parent-issue` carrier / `bot:in-progress` carrier). **Two or more qualifying candidates → `nudge`**, asking "absorb into #A or #B, or file fresh?" Zero candidates → fall through to the next verdict.
- **`upstream`** — `_shared/learning-routing.md` rule 1 (a claude-tweaks defect). **When `$SELF_REPO` is `true`, this verdict is removed from the set for the whole run** and a rule-1 fragment continues down the order instead — it lands as `file` or `absorb`, since a fragment about the plugin's own behavior is relevant to the plugin's own repo when the plugin's own repo is where you're running this.
- **`remember`** — `_shared/learning-routing.md` rules 2–3.
- **`file`** — relevant (names or implies a change to something this repo owns), actionable, and new. Always a plain stub: `Context:` carries `From intake {YYYY-MM-DD}` plus the hint, if any, plus a one-line why. Never spec-shaped — intake never composes a spec-shaped body. Over the cap → `nudge` toward `/superpowers:brainstorming` instead.
- **`nudge`** — relevant but too vague to act on; ask one concrete question.
- **`not-here`** — the residual: relevant to a different repo, or not actionable anywhere right now.

Intake is never obligated to file — a fragment below the materiality floor drops or nudges rather than becoming a stub nobody asked for (`_shared/materiality-floor.md`).

## Step 4: Table

Render the batch table:

```
| F | Hint | Fragment (first ~80 chars) | Verdict | Why / target |
```

Followed by exactly one `AskUserQuestion`: `question: "Apply these verdicts?"`, `header: "Intake"`, `multiSelect: false`, options `Apply all (Recommended)` / `Override rows`.

**Override grammar.** One or more `F{n} {verdict}` pairs, comma-separated, a parameterized verdict carrying its parameter inline — e.g. `F1 file, F3 absorb:#573, F4 drop, F6 not-here`. A `nudge` row cannot be answered in an override — its answer belongs to Step 5. Re-render only the changed rows; no second question.

## Step 5: Nudge round

One free-text prompt listing every `nudge` row's question. An answered row is re-judged into `absorb`/`file`/`not-here`; a skipped row becomes `drop — unanswered`. One nudge round, never a loop.

## Step 6: Execute

| Verdict | Writer |
|---|---|
| `absorb:#N` | `Skill(skill: "claude-tweaks:capture", args: "<text> --route=absorb:N --source intake")` |
| `file` | One batch call — see below |
| `upstream` | `Skill(skill: "claude-tweaks:feedback", args: "<text>")` |
| `remember` | `_shared/learning-routing.md`'s Memory write procedure (D4), run inline |
| `shipped` / `drop` / `not-here` | Nothing written |

**Processing order**, fixed:

1. Every `absorb:#N`, in fragment order, each its own `Skill(skill: "claude-tweaks:capture", args: "<text> --route=absorb:N --source intake")` call.
2. The `file` batch: write `{title, body}` entries to a session-scoped JSON file resolved via `eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" INTAKE_BATCH=intake-batch.json)"`, then one `Skill(skill: "claude-tweaks:capture", args: "--batch $INTAKE_BATCH --route=keep --source intake")` call for the whole batch.
3. Every `upstream`, in fragment order, each its own `Skill(skill: "claude-tweaks:feedback", args: "<text>")` call — `/claude-tweaks:feedback`'s own scrub and confirm gate still applies; no pre-approved fast-path flag is used here.
4. Every `remember`, via `_shared/learning-routing.md`'s D4 procedure, inline.

**Failure semantics.** A failed per-fragment call records `Failed — {error}` for that fragment and the run continues with the next fragment — best-effort, never abort, mirroring `capture/batch-mode.md`'s own per-call fail-safe. Per-entry failures inside the batch call come back in `/claude-tweaks:capture`'s Batch Summary and are re-rendered the same way. Actions Performed rows (Step 7) are re-sorted by fragment index before rendering, so the report aligns row-for-row with Step 4's table regardless of processing order.

## Step 7: Report

- `### Actions Performed` — `| Action | Detail | Ref |`, one row per non-`drop`/`shipped`/`not-here` fragment: `Filed #N`, `Absorbed into #N`, `Upstream #N`, `Remembered <file>`, or `Failed — {error}`.
- `### Dropped` — every `drop`/`shipped`/unanswered-`nudge` row, with its reason.
- `### Carry-over` — every `not-here` fragment's verbatim text, in one fenced block, paste-ready for the next repo.
- Then the `## Next Actions` block below.

## Next Actions

Plain markdown, paste-ready:

**`/claude-tweaks:specify #N[,#M…]`** — shape the filed set (recommended, bold, only the ids this run actually filed)
`/claude-tweaks:backlog overview` — see the fuller backlog
`/claude-tweaks:tidy` — triage what's already there

## Decisions

- **No `auto` mode, never inside `/flow`, no headless form.** Intake is the human gatekeeper by definition — a headless intake would file on the maintainer's behalf from unreviewed text. Revisit only if a scheduled producer of pre-extracted ideas appears *and* the trust ledger has a class for it.
- **Strict gate, one nudge round, no tiered "inspiration" shelf.** A third shelf for relevant-but-not-actionable becomes the graveyard `/claude-tweaks:capture`'s own anti-patterns table already warns about.
- **Extraction stays in user config.** claude-tweaks never fetches a URL, reads a video, or calls a user-config skill — a URL-only fragment is a `nudge`.
- **One repo per run.** Cross-repo routing isn't a routing problem; `not-here` fragments come back as text for the next repo's run.
- **Maintenance rule.** Any change to Steps 2–6 re-runs the graded dogfood check (`tests/fixtures/intake-sample-dump.md` against `tests/fixtures/intake-sample-dump.expected.md`) before merge.

## Component-Skill Contract

`/claude-tweaks:intake` is a **standalone-only** entry point, invoked directly by a human — it is never invoked by another skill, never a `/claude-tweaks:flow` step, and has no `auto`/headless form (see Decisions above). There is no `PIPELINE_RUN_DIR` signal, no parent context to defer to, and the `## Next Actions` block always renders.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Filing a fragment as spec-shaped | Intake's `file` verdict is always a stub — spec shape is `/claude-tweaks:specify`'s job, not this skill's |
| Running a second nudge round | One nudge round, never a loop — an unanswered nudge becomes `drop — unanswered`, it doesn't get asked again |
| Silently omitting a dropped fragment | Every fragment lands somewhere in the report — `### Dropped` names every `drop`/`shipped`/unanswered row, nothing vanishes |
| Fetching a URL to see what it is | Extraction is out of scope — a URL-only fragment is a `nudge`, not something to fetch |
| Restating a skill edge inside this file | Edges belong in `docs/skill-graph.md`'s `## intake` section, stated once |
| Adding an intake-side routing prompt on top of `/claude-tweaks:capture`'s `--route=keep` | `--route=keep` already renders no routing prompt — the intake table (Step 4) is the one decision |
| Filing an upstream issue from an uncertain repo identity | `$SELF_REPO` collapses toward `true` on any doubt — an unreadable, missing, or unclassifiable remote never files externally |
