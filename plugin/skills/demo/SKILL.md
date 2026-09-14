---
name: demo
description: Use for a human verdict on one built thing at a time: unrecorded work, a `#N` record, or a `#N,#M` list. Distinct from /test and /review. Keywords - acceptance, sign-off, demo, verification brief, human verdict, demo:pending, session-recall, closing commit.
argument-hint: "[#N[,#M...]]"
---

# Demo — Human Acceptance Sign-Off

Gives one built thing a real human verdict — approve or request changes: either this
conversation's own unrecorded work, or a specific `#N` record. Sits after wrap-up when a record
exists; independent of it entirely for conversation-based work with no record to wait on. This
skill resolves one item at a time — a bare `#N`, or a `#N[,#M...]` list taken in order, never
combined — and it never discovers or lists what's outstanding across the backlog; `/claude-tweaks:help`'s dashboard (Stage 4.7) is where that list lives:

```
/claude-tweaks:build → /claude-tweaks:test → /claude-tweaks:review → /claude-tweaks:wrap-up
                                                                              │
                                                                              v
                                                              [ /claude-tweaks:demo ]   <- utility (no fixed lifecycle position — run anytime, on one item at a time)
                                                                              │
                                                       ┌──────────────────────┴──────────────────────┐
                                                       v                                              v
                                              demo:approved                          demo:changes-requested → follow-up record (backlog)
```

**`demo:pending` is no longer unconditional (`#367`).** `/claude-tweaks:wrap-up`'s acceptance-labeling
step only applies the gate — brief plus `demo:pending` — to a record whose `risk:*`/`size:*`
facets exceed the configured oversight floor (`exceedsOversightFloor`,
`bin/lib/issues/oversight-floor.js`; a decomposition parent is gated on the max risk tier across
its sub-issues, aggregated by `wrap-up/verification-brief.md`'s Parent-Gate Procedure, never on
size). A record that doesn't clear the floor closes with **no** `demo:*` label at all — not a new
`demo:exempt` marker, just the absence of one. It is never unreachable by this skill: the
closing-commit-reconstruction fallback below (previously exercised only for the occasional record
that closed outside `/wrap-up`'s normal flow) is now also the default discovery path for this
below-floor population — a `/claude-tweaks:demo #N` on a below-floor record resolves through it
exactly as it always has for any other unlabeled record, no code change needed for that case.

## When to Use

- You just finished ad hoc work in this same conversation — no `/capture`, no work record — and want a clean recap plus an explicit sign-off gate before moving on; `/demo`'s session-recall source (Step 1) picks this up automatically, no filing required.
- `/claude-tweaks:help`'s dashboard told you a specific `#N` is awaiting sign-off (Stage 4.7 — fires on either driver) — including an autonomously `auto:merge`'d record already closed — and you want to walk through that one record now.
- `/claude-tweaks:tidy`'s `acceptance-gap` rows — Step 4.8 under `work-backend: github-issues`, Step 1's Shape 8 under `local-files` — named a record that closed with no disposition at all: no brief, no label or `acceptance:` facet, and typically no session anywhere that remembers it. Step 1 reconstructs one from the closing commit.
- You keep having to ask "how do I test this" days after a build finished — this skill surfaces the brief `/wrap-up` already wrote at build time, so you never re-derive it.
- Some of what you're reviewing has no interactive surface at all (docs, config, a harness or skill file) — this skill still gives it a lightweight human look, just not a click-through.

Not for: discovering what's outstanding across the backlog (`/claude-tweaks:help`'s job — Stage 4.7 lists every `#N` on either driver), merging or opening PRs (`/superpowers:finishing-a-development-branch`'s job), re-running mechanical checks (`/test`'s job), or code-quality judgment (`/review`'s job). `/demo` only ever resolves the Acceptance axis, one item at a time.

## Input

`$ARGUMENTS` — *(none)* resolves this session's own unrecorded work via session-recall (Step 1);
`#N` resolves that single record's Verification Brief, falling back — when no `demo:pending`
label exists on it — first to the record's closing commit in git history, then to session-recall
scoped to that `#N` (Step 1); `#N[,#M...]` — grammar (notation, tokenization) is `_shared/record-batch-input.md`'s contract —
is an explicit human-supplied batch: each ref
runs the `#N` path in list order,
Step 1 → Step 2 → Step 3 to completion before the next ref begins, so a batch aborted part-way
has already applied every verdict given so far and lost nothing.
Per-item failure isolation: a ref that resolves to nothing — no such record, wrong repo, a
malformed or empty token from a stray comma (`_shared/record-batch-input.md`'s classification
failures) — is reported and skipped, and the remaining
refs still run; the batch never aborts on one bad element — demo's own execution semantics,
that contract's Out-of-scope section. One verdict question per item —
never a combined verdict, never cross-item merging, never a Task fan-out.
A batch is the human's own list — never a sweep: `/demo` still never scans the backlog for what
to include, and the no-argument session-recall path cannot be combined with refs. Never sweeps
the backlog — `/claude-tweaks:help` (Stage 4.7) is where the full outstanding list lives.
The Interaction style directive's multi-item batch table does not apply to a batch here — a
verdict is the human judgment being collected, not a recommendation to confirm, so each item
gets its own verdict question.

## Step 1: Resolve the one item

`/claude-tweaks:demo` resolves one item at a time — never a sweep; a `#N[,#M...]` list is still
one item at a time, repeated in list order (`## Input`). `$ARGUMENTS` selects which path
runs — read only the matching branch in `entry-paths.md` in this skill's directory: no arguments
(session-recall) or `#N` given (single-record lookup — entered once per ref for a list).

## Step 2: Per-item walkthrough

Render this record's full Verification Brief (The ask / What shipped / Confirmed / Observation
plan — evidence the human can judge, not a checklist to complete). Label-backed entries were
fetched per `verification-brief.md`'s digest template in Step 1's `#N` lookup; closing-commit
reconstructions and session-recall entries composed their own Observation plan directly, in Step
1's `#N` and no-arguments paths respectively — all three render identically here, and a
reconstruction says so in its own `### Confirmed` section rather than being flagged separately at
this point. Then render the design-contract section below when one resolves, execute the plan
show-first, and ask for the verdict. A brief with no `### Observation plan` section splits on
what it carries instead: one carrying a retired `### See it yourself` or `### Verify it yourself
(manual)` heading — a label-backed brief posted before this schema shipped — walks the
Compatibility branch below. One carrying neither the section nor a retired heading — a Parent-Gate
parent brief, whose walkthrough lives inline in `### Confirmed` per
`wrap-up/verification-brief.md`'s Parent-Gate Procedure, or a session-recall entry whose recall
yielded no confident path list (Step 1's omission rule) — skips Prepare/Validate/Show entirely and
goes straight to the Verdict question below: the human judges from the brief's own `### Confirmed`
content.

### The design contract this was built against

Design work built through Impeccable carries a **direction contract** in the opening comment of the
artifact it produced — five blocks, written *before* the code. That is the one thing an acceptance
gate cannot reconstruct afterward: once the artifact exists, the intent behind it is only inferable
from the result, which is circular. Surfacing it here is what lets a human answer "is this what it
was trying to be?" instead of only "does this look fine?".

Run the locate-and-parse procedure in `../_shared/design-contract.md` over the changed-path list
Step 1 already produced — the closing commit's `--name-only` list, the label-backed brief's paths,
or session recall's own list. Do not go looking for files beyond it.

**When a contract resolves,** render this section under exactly this heading, above the verdict
question, with the five blocks reproduced **verbatim** — never summarized, re-worded, or reordered.
Introduce it as *what this was promising to be*, and make the direction of the check explicit: the
human is comparing the result against a promise made beforehand, not reading a description of what
shipped. `### What shipped` already covers the latter, and collapsing the two wastes the only
section here that carries pre-build intent.

Then a `Design-seed:` line, when there is one — the record body's own `Design-seed:` metadata line
(fetched with the record in Step 1) if present, otherwise the seed the parse just read out of the
artifact. If both exist and disagree, render the artifact's and say in one line that the record's
differs, which means the artifact was rebuilt on a different roll after the record was stamped.
Omit the line entirely when neither source has one — upstream carries a seed key only *"when the
seed dealt stagings,"* so a contract without one is complete, not truncated.

**When no contract resolves,** render nothing — no heading, no empty section, no "not found" note.
Most records have no design contract and never will; a placeholder on every one of them would be
noise.

**The malformed case is the one exception, and only barely.** The section is still omitted entirely
— never a heading with only the blocks that parsed, since a half-rendered contract reads as complete
— but that procedure requires the downgrade leave a trace, and `/claude-tweaks:demo` is standalone-only, so there
is no `$PIPELINE_RUN_DIR` and no `decisions.md` to write it to. Say it instead in **one plain line**
above the verdict, naming the file and which labels were found. Without it, an upstream block rename
is indistinguishable from a record that simply never had a contract — which is exactly the silent
failure the drift assertions in `tools/upstream-drift/manifest.yml` exist to catch, and this line is
what makes it visible to the one human already looking at this build.

This section never becomes a reason to block, and it is never audited here. Whether the render
actually honors the contract is `impeccable-finish-reviewer`'s job upstream — this skill puts the
promise in front of a human and asks them.

### Show-first walkthrough

Applies whenever this record's brief carries a `### Observation plan` section — every **sub-issue**
brief composed or posted after this schema shipped. Two populations legitimately carry no such
section at all even now: a Parent-Gate parent brief (walkthrough lives inline in `### Confirmed`
instead) and a session-recall entry whose recall yielded no confident path list (Step 1's omission
rule) — both skip this whole subsection and go straight to the Verdict question below, per the
routing above. Only a brief carrying a retired `### See it yourself` / `### Verify it yourself
(manual)` heading (posted before this schema shipped) walks the Compatibility branch below
instead.

**Prepare** — run the plan's Prepare commands, one at a time (`Prepare: none` → skip entirely). If
a Prepare command exits non-zero, or — for a `rendered-page`/`app-route` entry point — the entry
point does not respond afterward (connection refused or HTTP 404), fall back to
`skills/_shared/dev-url-detection.md` to resolve a working dev server rather than trusting the
plan's own Entry point verbatim.

**Validate** — URL surfaces (`rendered-page`/`app-route`) only; `cli`/`flow`/`diff` plans skip
straight to Show. Run whenever browser tools are available (agent-browser is headless-capable, so
this never needs a visible window): open a quick `agent-browser` session at the plan's exact deep
link, confirm it actually renders (not just an HTTP 200), attempt Auth Vault login when
credentials resolve (the same source `/claude-tweaks:stories` uses; no configured credentials →
skip the login check, reachability/render alone is still worth confirming), then close the
session. Browser tools unavailable → skip Validate without blocking, and note that visual
verification wasn't available in this environment.

**Show** — by Surface kind:

- `rendered-page`/`app-route` — `open {entry point}` on macOS, `xdg-open {entry point}` on Linux.
  When neither command exists or the call exits non-zero, degrade to presenting the validated URL
  plus self-contained steps: **self-contained** — every command block includes its own `cd` to
  the right checkout/worktree, never an inherited working directory; **copy-paste-clean** — no
  inline commentary inside a block meant to be pasted as-is, explanation goes in prose
  before/after it; **proactively explain surprising-but-correct state** Prepare/Validate itself
  observed while rendering (e.g. an empty dashboard on first load) — inline, before the human has
  to ask.
- `cli` — run the plan's Entry point command and show its output directly.
- `flow` — walk the Inspect pointers in order, opening each named artifact. When an artifact is
  gone, run its `Regenerate:` line; a `Regenerate:` that itself exits non-zero is treated exactly
  like a missing artifact — state it and continue, never block the walkthrough on it.
- `diff` — render the diff named by Entry point: full under ~200 lines, else the stat summary plus
  the 2-3 hunks most central to the record's Acceptance Criteria.

**Full verification** — when this record's Observation plan carries a `Full verification:`
block (`_shared/observation-plan.md`), render it verbatim right after Show, before Failure
posture and the Verdict question. The block is a pointer to the parent's eventual end-to-end
check, not a substitute for it — the Verdict question below still asks only about this slice.

**Failure posture:** a Prepare or Validate failure is evidence for Request changes, never a
debugging detour to chase mid-conversation — capture what broke (screenshot, console error,
command output) and fold it directly into this record's brief as grounds for the verdict.
`/claude-tweaks:demo` never debugs or fixes the underlying application code itself — that stays
out of scope the same way code-quality judgment already does (`/claude-tweaks:review`'s job).

**Caching:** Prepare/Validate runs once per record per `/claude-tweaks:demo` invocation. What's
cached is the resolved entry-point URL/port/credentials and the validation outcome — never a live
browser session handle, since Validate's own session closes before Show runs. A Request-changes
verdict ends that record's walkthrough; any later re-demo of the same record is a new invocation
with fresh Prepare/Validate.

### Verdict

**Browser verdict (optional, `rendered-page`/`app-route` only):** applies only to the URL surfaces
Validate above already gates on — `cli`/`flow`/`diff` plans go straight to the terminal question
below; there is no browser session already in play for them, and opening one solely to click a
button is pure overhead over just asking. Follows `_shared/visual-decision.md`'s contract —
cited here, never restated.

Available whenever browser tools resolve (the same gate Validate uses above — unavailable → skip
straight to the terminal question below, no error). Compose a single-variant `layout`-scope
manifest: one variant, whose one file is a small recap page (this record's title, an "Open {entry
point}" link, and the `### Confirmed`/design-contract text already rendered above) — **not** a
live embed of the entry point itself. Show already handed that to the human directly, and
compare-shell's manifest schema requires a real local file per variant, never an arbitrary origin.
Seed it live (`seed-compare.mjs --manifest <manifest.json> --mode live --out <demo-dir>/index.html`),
start the server (`visual-decide.js start --dir <demo-dir> --state <demo-dir>/.vd-state`), present
the keyed URL, and end the turn — the contract's turn loop takes over from here.

On resume, read `{state}/events` and act on the last non-tweak event per the contract's Turn loop:

- **Pick** (the round's only variant) — Approve, applied immediately via Step 3's Approve action.
  The browser round **replaces** the terminal question for this outcome.
- **Exit** — ambiguous between Request changes and Skip (the contract's vocabulary has no way to
  say which) — **falls back** to the terminal question below, with the Approve option omitted
  since the explicit exit signal already rules it out.
- **Reroll / Steer** — not meaningful here: one built artifact, not N candidates to reroll or
  steer toward another one. Falls back to the full terminal question below, unchanged.
- **Tweak** — never a verdict, per the contract's Turn loop; the hue/spacing/corner-radius sliders
  are compare-shell's fixed shared UI and preview against nothing meaningful on a recap page with
  no design candidate in play. Trailing tweak events are ignored on resume exactly as the contract
  specifies.
- **Empty or absent events file, an unparsable-only file, or an ambiguous terminal-text/events-file
  conflict** — the contract's own documented fallback: the terminal question below, unchanged.

Stop the server (`visual-decide.js stop --state <demo-dir>/.vd-state`) before proceeding to Step
3, on every exit path — pick, exit, or any error that aborts the round — per the contract's
Lifecycle ownership; never rely on the idle timeout. This is a fresh server per verdict attempt,
never reused across records or across a re-demo of the same one.

**No auto-mode path reaches this.** `/claude-tweaks:demo` has no `$PIPELINE_RUN_DIR` to begin
with — it is never invoked from within an `auto`-mode pipeline (`## Component-Skill Contract`
below) — so this whole browser-verdict path is structurally unreachable from `auto`, the same
constraint `_shared/visual-decision.md` requires of every consumer.

**Fallback — terminal `AskUserQuestion`, reused every round (unchanged from before this
adoption):** Call `AskUserQuestion` with `question`: `"Does {title} do what you asked
for?"`, `header`: `"Verdict"`, `multiSelect`: `false`. On an exit-triggered fallback above, omit
Option 1 (Approve) — the browser round already ruled it out:

- Option 1 — `label`: `"Approve"`, `description`: `"This does what was asked"`
- Option 2 — `label`: `"Request changes"`, `description`: `"There's a gap — I'll describe it"`
- Option 3 — for a label-backed entry: `label`: `"Skip for now"`, `description`: `"Leave demo:pending — I'll come back to this"`. For a closing-commit reconstruction (never carried `demo:pending` — there is nothing to leave): `label`: `"Skip for now"`, `description`: `"Nothing is written — it still carries no acceptance disposition, so /claude-tweaks:tidy's acceptance-gap scan will surface it again"` (true on both drivers — the disposition is a `demo:*` label under `github-issues` and an `acceptance:` facet under `local-files`, and each driver has its own sweep for it). For a session-recall entry: `label`: `"Skip for now"`, `description`: `"Nothing is written — unlike a label-backed record, this won't resurface in a later session"`

### Compatibility: briefs with no Observation plan

A label-backed brief posted before this schema shipped carries the retired `### See it yourself`
/ `### Verify it yourself (manual)` headings instead of `### Observation plan`. Those two heading
names are quoted **deliberately**, for backward compatibility with briefs already posted — not as
a reintroduction of the sections themselves. Such a brief walks that flow — its own Verdict
question (Approve / See-or-Verify / Request changes / Skip), the interactive pre-flight, and the
live-or-manual sub-choice — in place of the Show-first walkthrough above; read
`legacy-brief-compatibility.md` in this skill's directory for the full procedure.

### Scope-fork checkpoint

If, anywhere in this walkthrough, the human asks for something beyond confirming this record's
existing behavior — a new feature, a change beyond what Prepare/Validate needed to make the
environment checkable — stop once per item (the first time this happens for the record being demoed — a `#N,#M` batch resets the once-per-item stop for each ref) before doing it. Call
`AskUserQuestion` with `question`: `"That's new scope beyond what's being demoed here. Want me to
capture it as a backlog item now and come back to your sign-off decision, or build it now as its
own thing outside /claude-tweaks:demo?"`, `header`: `"Scope fork"`, `multiSelect`: `false`:

- Option 1 — `label`: `"Capture it"`, `description`: `"File it as a backlog item, then come back to your sign-off decision"`
- Option 2 — `label`: `"Build it now"`, `description`: `"Build it now as its own thing, outside /claude-tweaks:demo"`

"Capture it" routes through the same follow-up-record mechanism Step 3's Request-changes branch
already uses, with one difference: the body's `Origin:` line reads `Origin: demo scope-fork from
#{n}` (or `from session recall` for a session-recall entry) instead of the changes-requested
variant — a scope-fork capture isn't a changes-requested verdict, so it needs its own provenance
marker. If the human picks "Build it now," don't re-ask for further closely-related work in this
same session.

### Task-anchor discipline

This record's verdict — not yet Approved/Request-changes/Skipped — must never be silently
dropped because the conversation moves on, whether from a declined `AskUserQuestion`, a
Prepare/Validate failure that grows its own back-and-forth, a scope-fork detour above, or any other
detour. Once any such detour concludes, before shifting to a new unrelated topic, restate that
this record's decision is still outstanding and offer to resume. Never end a `/claude-tweaks:demo` run with a
record left mid-decision and unmentioned.

## Step 3: Apply verdicts

For a `#N[,#M...]` batch this step runs per item, immediately after that item's verdict — never
batched across items — so the next ref's Step 1 starts only once this ref's label swap (or
follow-up filing) has landed.

**Label-backed entries** (Step 1's `#N` lookup): bootstrap `demo:approved`,
`demo:changes-requested`, and `demo:approved-batch` via the check-then-create loop from
`_shared/label-bootstrap.md` before the first swap this run.

**Provenance signal (Approve only).** A single-record verdict and a `#N,#M` batch-list verdict
are otherwise byte-identical on the wire — both run Step 2's per-item walkthrough in full — so
the Approve action below records which invocation shape produced this verdict: a bare `#N`
invocation or the no-argument session-recall path is single-record-backed, the default, nothing
extra written. A `#N,#M...` batch invocation (more than one ref in this run's list — see Input)
is batch-sourced — the Approve action additionally applies `demo:approved-batch`, so
`bin/lib/issues/trust.js`'s coverage/verdict computation (via `acceptance.js`'s
`approvalProvenance`) can tell a rapid multi-item batch pass apart from a dedicated single-record
session. This is a `work-backend: github-issues`-only signal — the trust table it feeds is
already github-issues-only (`_shared/trust-table.md`'s framing note), so `work-backend: local-files`
writes no equivalent facet. A pre-existing `demo:approved` label carries no such marker and reads
as single-record-backed — the safer default, since promoting an unlabeled historical approval to
"batch" would understate coverage rather than overstate it.

- **Approve** — `gh issue edit {n} --remove-label demo:pending --add-label demo:approved` — for a batch-sourced verdict (per the Provenance signal note above), add `--add-label demo:approved-batch` to the same invocation. `work-backend: local-files`: set `facets.acceptance = 'approved'` via `writeRecord` — no equivalent provenance facet on this driver (see the Provenance signal note above). One command covers both entry shapes: `--remove-label` on a label the record does not carry is a silent no-op — verified on this repo, exit 0, and `--add-label` in the same invocation still lands — so a closing-commit reconstruction, which never had `demo:pending`, needs no variant. For a decomposition parent — `parent-issue` in its labels (`work-backend: github-issues`) or `facets.isParentIssue === true` (`work-backend: local-files`) — close it too: nothing else in the system ever closes a parent, so without this the parent stays open forever and the acceptance label is the only trace the parent issue was ever accepted. `work-backend: github-issues`: `gh issue close {n} --reason completed`. `work-backend: local-files`: `closeRecord(path)` (`bin/lib/issues/local-store.js`), run **after** the `writeRecord` call above — `closeRecord` does its own fresh read of the file, so calling it second means it preserves the `acceptance: 'approved'` facet just written rather than racing it.
- **Request changes** — prompt for a short reason inline, then:
  1. **`work-backend: github-issues`:** `gh issue edit {n} --remove-label demo:pending --add-label demo:changes-requested`. **`work-backend: local-files`:** set `facets.acceptance = 'changes-requested'` via `writeRecord`. For a decomposition parent — `parent-issue` in its labels (`work-backend: github-issues`) or `facets.isParentIssue === true` (`work-backend: local-files`), the same two-driver test the Approve branch above uses — nothing further follows this: the parent stays open, since a changes-requested verdict means the parent issue's work is not done.
  2. File a linked follow-up record: backlog stage (no `ready` — a one-line reason isn't
     spec-shaped), Type `bug` by default (override to `feature`/`task` when the reason clearly
     describes new scope, not a defect), no `by:*` label — instead a body line
     `Origin: demo changes-requested from #{n}` per `_shared/work-record.md`'s side-effect-record
     convention — plus the reason and a link back to the original. `work-backend: github-issues`:
     use the same `recordPayload` composition `/claude-tweaks:capture` uses
     (`bin/lib/issues/record.js`), just without invoking `/claude-tweaks:capture` itself —
     and, unlike `/claude-tweaks:capture`'s own call, **omit the `origin` field entirely** rather than passing
     `origin:'demo'`: `record.js`'s `ORIGINS` enum has no `'demo'` entry, so passing it throws;
     omitting `origin` is also what keeps this follow-up label-free, consistent with the
     "no `by:*` label" requirement above (`recordPayload` only pushes a `by:*` label when
     `origin` is set).
     `work-backend: local-files`: use `createRecord(dir, { slug, title, body, facets })` from
     `bin/lib/issues/local-store.js` — `title` is the reason text just collected, `body` is the
     reason plus the link back to the original plus the `Origin:` line above, `facets: { type,
     stage: 'backlog' }` (`type` being `bug` or the overridden type). Compute `slug` via that
     same module's `deriveSlug(title, existingSlugs)`. Never `allocateId`+`writeRecord`
     separately — same allocateId+writeRecord race `capture/SKILL.md`'s Backend Selection
     section documents (two near-simultaneous filings, e.g. two `/claude-tweaks:demo` "Request changes"
     verdicts landing in the same run, or `/claude-tweaks:demo` racing a `/claude-tweaks:capture`/`/claude-tweaks:specify` decomposition,
     can silently share one numeric id); see that section for the full call shape to mirror.
  3. Note the bidirectional link back on the original record. `work-backend: github-issues`:
     comment on the original issue with the new follow-up's issue number. `work-backend:
     local-files`: there is no comment mechanism (same constraint `verification-brief.md` and
     `_shared/work-record.md` already document) — append a short note with the follow-up's id to
     the original record's body instead, via the same `readRecord`/`writeRecord` round trip.
- **Skip for now** — no label change.

**Session-recall entries** (Step 1's no-arguments path) — no record exists, so nothing here ever
bootstraps a label or writes to GitHub/local-files for Approve or Skip:

- **Approve** — nothing written anywhere. The verdict lives in this conversation.
- **Skip for now** — nothing written anywhere. Unlike a label-backed record, this will not
  reappear in a future `/claude-tweaks:demo` run — a different session has no memory of this conversation to
  recall from. This is the accepted tradeoff of not persisting anything, not a bug.
- **Request changes** — the exact same follow-up-filing procedure as the label-backed path's
  Request changes above (step 2), reusing `recordPayload` (`work-backend: github-issues`) or
  `createRecord`+`deriveSlug` (`work-backend: local-files`) directly — the only difference is
  there is no original record to relabel or comment a link back onto, or reference within the
  follow-up's own body — the `Origin:` line is the sole provenance marker for a session-recall
  follow-up. The `Origin:` body line reads `Origin: demo changes-requested from session recall`
  instead of `from #{n}`.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention) — exactly once, after the last item of a `#N[,#M...]` batch; each conditional line keys on the batch as a whole. Exactly one of these three outcome branches applies per invocation — render only that branch's line, bolded and suffixed `(recommended)`:

- **A `demo:changes-requested` follow-up was filed for any item this run** (Request-changes outcome): **`/claude-tweaks:backlog refine`** — the new gap record needs shaping/authorization like any other backlog item (recommended)
- **No follow-up was filed, and any item this run remains `demo:pending` after Skip:** **`/claude-tweaks:help`** — lists every #N still awaiting sign-off (Stage 4.7) (recommended)
- **Approved, or Skip resolved with nothing left pending across the batch:** **`/claude-tweaks:help`** — full pipeline status (recommended)

## Component-Skill Contract

`/claude-tweaks:demo` is a **standalone-only** skill — it is never invoked by a parent skill
in the workflow. There is no `PIPELINE_RUN_DIR` signal to check; the `## Next Actions` block
always renders.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Handing the human an entry point without Prepare/Validate having run | The human becomes the integration test, hitting port collisions and broken auth one round-trip at a time |
| Asking for the verdict before Prepare/Validate/Show have run | Show-first means the human judges evidence already surfaced, not a promise to go look later |
| Blocking the walkthrough on a stale `flow` Inspect pointer instead of stating it and continuing | A missing artifact is evidence for the verdict, not a reason to stall the record — run its `Regenerate:` line or say so and move on |
| Skipping Validate and handing the human an unverified URL | Validate is silent and headless — skipping it for convenience hands over exactly the broken-link risk it exists to catch |
| Re-deriving "how do I test this" from the diff when a brief already exists | `/wrap-up` wrote it at build time with full context — Step 1's closing-commit reconstruction is the fallback for records that never got a brief, not a substitute for reading one |
| Writing a reconstruction's `### Confirmed` as though someone watched the work | A closing commit evidences what shipped, not that anyone checked it — name the reconstruction and stop at what the commit itself shows |
| Merging or opening a PR from within this skill | Those belong to `/superpowers:finishing-a-development-branch` — `/demo` only resolves the Acceptance axis |
| Silently dropping a record mid-decision because the conversation moved on | A pending verdict must be restated before shifting topic — see Step 2's Task-anchor discipline |
| Treating a record with no interactive surface as not needing sign-off | A `cli`/`flow`/`diff` plan still gets a real human look — it pairs the diff/rationale with concrete pointers, not just "review the diff" |
| Handing a sub-issue's `cli`/`diff` plan to a human as if the slice were the feature | The plan must say which siblings gate the real check and what that check is — render the Full verification block when the record carries one |
| Debugging or fixing an application bug a Prepare/Validate check uncovers | Out of scope like code-quality judgment — capture it as a Request-changes candidate |
| Leaving a live browser session open after Validate or Show finishes | Leaked sessions consume resources — Validate's own session must close before Show runs; Show's `open`/`xdg-open` hands the browser off to the human, it never holds a session open itself |
| Writing `demo:approved`/`demo:pending` for a session-recall entry | No record holds it — the verdict lives in the conversation, not a label; only Request-changes produces a real record |
| Sweeping the `demo:pending` backlog from within this skill | Discovery is `/claude-tweaks:help`'s job (Stage 4.7 lists every outstanding `#N`) — `/demo` resolves one item at a time — never a sweep; a `#N,#M` list is the human's own explicit list, never a backlog scan |
| Summarizing, re-wording, or reordering the direction contract's five blocks | The blocks are the pre-build promise the human is checking the result against; a paraphrase is one more reading of the result, which is exactly the circularity this section exists to break |
| Rendering the design-contract heading when no contract resolved, or with only the blocks that parsed | Most records have no contract — an empty section is noise on all of them, and a partial one is worse, because it reads as complete (`_shared/design-contract.md` collapses malformed into absent for this reason) |
| Dropping a malformed contract silently because the section is omitted either way | Omitting the section is right; omitting the *trace* is not. `/demo` has no run dir to log to, so its one plain line is the only place an upstream block rename becomes visible instead of looking like a record that never had a contract |
