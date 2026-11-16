---
name: accept
description: Use for a human acceptance verdict on one built thing at a time — unrecorded work, a `#N` record, or a `#N,#M` list — walking its acceptance packet. Distinct from /test and /review. Keywords - acceptance, sign-off, packet, verdict, accept:pending, demo, verification brief, human verdict, demo:pending, session-recall, closing commit.
argument-hint: "[#N[,#M...]]"
---

# Accept — Human Acceptance Sign-Off

Gives one built thing a real human verdict — approve or request changes: either this
conversation's own unrecorded work, or a specific `#N` record. This skill resolves one item at a
time — a bare `#N`, or a `#N[,#M...]` list taken in order, never combined — and it never discovers
or lists what's outstanding across the backlog; `/claude-tweaks:help`'s dashboard (Stage 4.7) is where that list lives.

**Same flow, two entries.** A record's acceptance packet (`_shared/acceptance-packet.md`) is the one
thing both entries work on, and the packet module, `bin/acceptance-packet.js`, is its only builder:
this skill never composes a packet itself.

- **Automatic entry** — `automatic-entry.md` in this skill's directory, read by
  `wrap-up/verification-brief.md` Step 4 in a pipeline run. It posts the packet when none exists and
  applies `accept:pending` when no acceptance label is present and the record clears the oversight
  floor. It never prompts, never blocks and returns after labelling.
- **On-demand entry** — `/claude-tweaks:accept [#N[,#M...]]`, typed by a human. It finds the packet,
  refreshes its stale parts in place, walks the human through it and takes the verdict.

```
pipeline run ─→ automatic entry ─→ packet + accept:pending ─┐
                                                            v
human ─→ /claude-tweaks:accept #N ─→ refresh ─→ walk ─→ verdict ─→ accept:approved | accept:changes-requested → follow-up record
```

A record that doesn't clear the oversight floor (`exceedsOversightFloor`,
`bin/lib/issues/oversight-floor.js`) closes with **no** acceptance label and, with no parent, still
carries its packet, which this skill reads whatever the labels. A decomposition parent keeps the
Parent-Gate Procedure (`wrap-up/verification-brief-parent-gate.md`), which still writes
`demo:pending`; this skill reads both spellings. With no packet either (a record closed before the
packet), Step 1's closing-commit recovery resolves it.

## When to Use

- You just finished ad hoc work in this same conversation — no `/capture`, no work record — and want a clean recap plus an explicit sign-off gate before moving on; `/accept`'s session-recall source (Step 1) picks this up automatically, no filing required.
- `/claude-tweaks:help`'s dashboard told you a specific `#N` is awaiting sign-off (Stage 4.7 — fires on either driver) — including an autonomously `auto:merge`'d record already closed — and you want to walk through that one record now.
- `/claude-tweaks:tidy`'s `acceptance-gap` rows — Step 4.8 under `work-backend: github-issues`, Step 1's Shape 8 under `local-files`; a hand-closed decomposition parent comes from `parent-gate` or Shape 7 — named a record that closed with no disposition at all: no packet, no label or `acceptance:` facet, and typically no session anywhere that remembers it. Step 1 builds a packet from the closing commit.
- You keep having to ask "how do I test this" days after a build finished — this skill walks the packet the pipeline already wrote at build time, so you never re-derive it.
- Some of what you're reviewing has no interactive surface at all (docs, config, a harness or skill file) — this skill still gives it a lightweight human look, just not a click-through.

Not for: discovering what's outstanding across the backlog (`/claude-tweaks:help`'s job — Stage 4.7 lists every `#N` on either driver), merging or opening PRs (`/superpowers:finishing-a-development-branch`'s job), re-running mechanical checks (`/test`'s job), or code-quality judgment (`/review`'s job). `/accept` only ever resolves the Acceptance axis, one item at a time.

## Input

`$ARGUMENTS` — *(none)* resolves this session's own unrecorded work via session-recall (Step 1);
`#N` resolves that single record's acceptance packet, else its Verification Brief, falling back — when it carries no pending
acceptance label (either spelling, `_shared/work-record.md`) — first to the record's closing commit in git history, then to session-recall
scoped to that `#N` (Step 1); `#N[,#M...]` — grammar (notation, tokenization) is `_shared/record-batch-input.md`'s contract —
is an explicit human-supplied batch: each ref
runs the `#N` path in list order,
Step 1 → Step 2 → Step 3 to completion before the next ref begins, so a batch aborted part-way
has already applied every verdict given so far and lost nothing.

**The no-record path** (session-recall, no record) is taken only with no `#N` argument and
unrecorded work in this session. A `#N` that does not resolve — no such record, the wrong repo, a
failed record read — is an error: report it and stop that ref. It never falls back to the no-record path; the
`#N`-scoped recall above needs a record that resolved.

Per-item failure isolation: a ref that resolves to nothing — no such record, wrong repo, a
malformed or empty token from a stray comma (`_shared/record-batch-input.md`'s classification
failures) — is reported and skipped, and the remaining
refs still run; the batch never aborts on one bad element — accept's own execution semantics,
that contract's Out-of-scope section. One verdict question per item —
never a combined verdict, never cross-item merging, never a Task fan-out.
A batch is the human's own list — never a sweep: `/accept` still never scans the backlog for what
to include, and the no-argument session-recall path cannot be combined with refs. Never sweeps
the backlog — `/claude-tweaks:help` (Stage 4.7) is where the full outstanding list lives.
The Interaction style directive's multi-item batch table does not apply to a batch here — a
verdict is the human judgment being collected, not a recommendation to confirm, so each item
gets its own verdict question.

## Step 1: Resolve the one item

`/claude-tweaks:accept` resolves one item at a time — never a sweep; a `#N[,#M...]` list is still
one item at a time, repeated in list order (`## Input`). `$ARGUMENTS` selects which path
runs — read only the matching branch in `entry-paths.md` in this skill's directory: no arguments
(session-recall) or `#N` given (single-record lookup — entered once per ref for a list).

For each `#N`, before reading its `entry-paths.md` branch, resolve the session-temp paths as its
own call (`_shared/session-tmp-root.md`), and paste each printed path where a call in that branch
or below names it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" RECORD=accept-record-{n}.json PACKET_FILE=accept-packet-{n}.md REFRESHED=accept-refreshed-{n}.md FACTS=accept-facts-{n}.json NARRATIVE=accept-narrative-{n}.json SPEC=accept-spec-{n}.md BUILT=accept-built-{n}.md
```

### The packet's state (`#N` only)

The `#N` branch writes the record's `gh issue view` result to `"{RECORD}"`. The packet is always
read with this call, as its own Bash call — never by fetching comments and matching the marker by
hand:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/accept-entry.js" read --record {n} --out "{PACKET_FILE}"
```

It prints one line: `status` (`found`, `unreadable` or `none`), the comment's `url`, and `skipped`,
the untrusted copies to name. A found or unreadable comment's body is written to `"{PACKET_FILE}"`.
`work-backend: local-files`: write the record body's delimited packet block (`entry-paths.md`) to
`"{PACKET_FILE}"` with the Write tool and treat it as `found`, or as `none` with no block. Then
classify, as its own Bash call, with `{status}` the value the read printed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/accept-entry.js" state --labels-json "{RECORD}" --packet-status {status}
```

For `found` or `unreadable`, add `--packet-file "{PACKET_FILE}"` (an `unreadable` packet then
classifies as `unhandled`); for `none`, add nothing.

`local-files` reads the record's `acceptance:` facet into `--acceptance-facet "{facet}"` in place of
`--labels-json`, pasting it only when it is `pending`, `approved`, `changes-requested` or empty. It
prints `{state, recording, verdict, message}`. Route on `state`:

| State | Minimal behavior |
|---|---|
| `awaiting-local` | Start the app from the record's PR branch — a checkout of the PR's head per `_shared/scratch-worktree.md`, never switching the human's own checkout — running the packet's Test guide commands there, then walk the guide with its local links. A parked record (`node "${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js" parked --record {n}` exits 0; exit 6, unknown, is fail-closed: no re-entry, report it and stop this ref) re-enters instead, replacing that scratch-worktree checkout for this case only: `node "${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js" reenter --record {n} --pr {pr}` (exit 7, a stale directory: `reenter-remove` it and retry once; any other non-zero exit: report it and stop this ref), start the app per `_shared/dev-url-detection.md`, open the packet's links, run `node "${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js" reenter-check --worktree "{worktree}" --expect-head {head}` before the verdict (exit 8 modified: say so) and, only once the chosen option's actions have finished (on `Accept and merge`, after `_shared/pr-first-merge.md` Step 3 and Step 4), `node "${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js" reenter-remove --worktree "{worktree}"`. `moved:true` from `reenter` (the PR head or base moved since the park), or `reenter-check` exit 8: say so, and withhold `Accept and merge` for this verdict round. The checks are re-run only by `_shared/pr-first-merge.md` Step 2.5 on a later merge (a pipeline re-run or `/claude-tweaks:dispatch close-out`), never inside this round |
| `waiting-for-deploy` | Show the deploy status (the packet's Deploy status section), skip the link step (Validate and the URL Show), and say plainly that the dev deploy is not confirmed live; walk the rest |
| `live-on-dev` | Walk the guide with its dev links |
| `already-decided` | An approved label, or a changes-requested label with no pending label beside it: show the recorded verdict (`verdict`) and stop this ref: no second verdict, no label change. Changes-requested beside a pending label is a rebuilt record awaiting re-acceptance and takes its packet's state instead |
| `no-packet` | Build one via the packet module (**No-packet build** below), then walk it; a legacy brief already on the record renders first, as itself, and no packet is built (`entry-paths.md`) |
| `unhandled` | Print the CLI's one-line `message` and stop this ref; never guess |

**No recording** — `recording: false` on a found packet: say there is no recording in one line,
and walk the rest.

**Reuse and refresh** — a found packet in one of the first three states is reused, never posted
again. Refresh its stale parts first, as its own Bash call, always to a distinct `--out`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/accept-entry.js" refresh --packet-file "{PACKET_FILE}" --out "{REFRESHED}"
```

It prints `{refreshed, unverified}`. Only the Deploy status section, the Test guide links' base URL
and the Recording link are ever rewritten; every other byte, a human's edits included, stays. No
deploy-status source exists yet, so pass no `--deploy-json` until one does: a field with no source
is left as is and named `unverified`, in one line. Only when `refreshed` is non-empty, publish the
refreshed body, as its own Bash call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" post --record {n} --body-file "{REFRESHED}"
```

`post` finds the marker comment and edits it in place: never a second packet, and never a packet
posted as a fresh comment by hand. `local-files`: `acceptance-packet.js local --record-file
"{record-file}" --body-file "{REFRESHED}"`, with no `--pending`. Then re-run `state` with
`--packet-file "{REFRESHED}"` and walk the refreshed body. A non-zero refresh is stated in one
line, and the packet walks as read. A failed post is stated in one line too, and the walk continues
on the unrefreshed packet; `post` clears a pending label when its edit fails (its contract), so
before the verdict question re-apply each pending label `"{RECORD}"` showed the record holding,
and only that one, as its own Bash call per label:

```bash
gh issue edit {n} --add-label {pending-label}
```

`{pending-label}` is `accept:pending` or `demo:pending`, exactly as `"{RECORD}"` listed it.
`local-files` needs nothing here: `local` changes no facet when it fails.

**No-packet build** — a legacy brief already on the record (`entry-paths.md`'s pending-label brief
or its PR pointer) renders as itself, and nothing is built. Otherwise the packet module builds it;
this skill writes only the narrative. Inputs,
each dropped when it does not resolve: the record body written with the Write tool to `"{SPEC}"`
(or the record file under `local-files`), the newest run directory under
`$RUN_ROOT/.claude-tweaks/pipelines/archive/` whose name ends `-record-{n}` as `--run`, and the
closing commit `entry-paths.md`'s recovery finds as `--base "{sha}^" --head "{sha}"`. With no
closing commit there is nothing to build from: the recovery's session-recall fallback runs. Paste
`{sha}` only as hex digits and `{run-dir}` only with none of `"`, backtick, `$`, `\` or a line
break, else drop its flag. As separate Bash calls:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" gather --record {n} --out "{FACTS}" --run "{run-dir}" --spec "{SPEC}" --base "{sha}^" --head "{sha}"
```

Write `"{NARRATIVE}"` with the Write tool from the record body and the closing commit's diff, every
claim citing fact ids copied from `"{FACTS}"` (`_shared/acceptance-packet.md`'s Facts and claims);
it asserts nothing past what the commit shows. Then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" render --facts "{FACTS}" --narrative "{NARRATIVE}" --out "{BUILT}" --poster "/claude-tweaks:accept"
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" post --record {n} --body-file "{BUILT}"
```

`local-files`: `local --record-file "{record-file}" --body-file "{BUILT}"`. No label is applied:
the verdict follows. Classify the built packet with `state` and walk it. A gather, render or post
failure is stated in one line, and the closing-commit reconstruction in `entry-paths.md` composes
the brief in this session instead; a post exit 4 (`gh` absent) walks the built packet unposted and
says so.

## Step 2: Per-item walkthrough

**An acceptance packet renders as a packet.** When Step 1 resolved an acceptance packet
(`_shared/acceptance-packet.md`), drop its marker line, take its Test guide as the Try it block, hoisted to the top and rendered once,
then render its remaining sections in order under the packet's title and notes. Never compose a fresh Try it block for a packet: a Test
guide holding only its one empty line renders that line. The packet's `### Observation plan` appendix is the plan the rest of this step walks,
show-first, after the design-contract section below when one resolves. A packet with no appendix
skips Prepare/Validate/Show and goes straight to the Verdict question. The Try it and full-brief paragraphs
that follow apply to legacy briefs only, and to what Step 1 composed.

**Try it first (#2821).** Before anything else in this step — before the design-contract section
and before any Prepare/Validate output — render the record's Try it block (`_shared/try-it.md`)
as Step 1 resolved it: the brief's `### Try it` section (a parent brief's `### Try it — end to
end`), found on the issue or — under `pr-first` — on the PR its pointer names, or, for a record
whose walkthrough was posted alone, its closing PR's `try-it` run comment (`entry-paths.md`'s PR
run-comment lookup). Either way `/claude-tweaks:accept #N` opens on the same walkthrough the
Pipeline Summary and the PR showed. Step 1 composed a fresh one only when none exists; a
label-backed brief carrying none (posted before this shipped) — compose one now per that contract
from the record's Acceptance Criteria and Step 1's entry point, and never render it empty.

Then render the rest of this record's full Verification Brief (The ask / What shipped / Confirmed /
Observation plan — evidence the human can judge, not a checklist to complete), with its Try it
block hoisted to the top — rendered once, above, never a second time in place. A legacy brief, in the shape of
the template `wrap-up/verification-brief-parent-gate.md` now holds, was fetched in Step 1's `#N` lookup; closing-commit
reconstructions and session-recall entries composed their own Observation plan directly, in Step
1's `#N` and no-arguments paths respectively — all three render identically here, and a
reconstruction says so in its own `### Confirmed` section rather than being flagged separately at
this point. Then render the design-contract section below when one resolves, execute the plan
show-first, and ask for the verdict. A brief with no `### Observation plan` section splits on
what it carries instead: one carrying a retired `### See it yourself` or `### Verify it yourself
(manual)` heading — a label-backed brief posted before this schema shipped — walks the
Compatibility branch below. One carrying neither the section nor a retired heading — a Parent-Gate
parent brief, whose walkthrough lives in its `### Try it — end to end` section per
`wrap-up/verification-brief.md`'s Parent-Gate Procedure, or a session-recall entry whose recall
yielded no confident path list (Step 1's omission rule) — skips Prepare/Validate/Show entirely and
goes straight to the Verdict question below: the human judges from the Try it block rendered
first (or, when recall could not name an entry point, the one line saying it was omitted —
`entry-paths.md`'s session-recall Try it bullet) and the brief's own `### Confirmed` content.

### The design contract this was built against

Run the locate-and-parse procedure in `_shared/design-contract.md` over the changed-path list
Step 1 already produced — the closing commit's `--name-only` list, the paths the packet or label-backed brief names,
or session recall's own list. Do not go looking for files beyond it. **When no contract resolves,**
render nothing — no heading, no empty section, no "not found" note. **When a contract resolves, or
the parse reports one malformed,** read `design-contract-section.md` in this skill's directory and
follow it: it renders the five blocks verbatim under this heading with the `Design-seed:` line, or
— for the malformed case — omits the section and leaves the one plain-line trace above the verdict.
This section never becomes a reason to block.

### Show-first walkthrough

Applies whenever this record's packet or brief carries a `### Observation plan` section — every **sub-issue**
brief composed or posted after this schema shipped. Two populations legitimately carry no such
section at all even now: a Parent-Gate parent brief (walkthrough lives in its `### Try it — end to end` section
instead) and a session-recall entry whose recall yielded no confident path list (Step 1's omission
rule) — both skip this whole subsection and go straight to the Verdict question below, per the
routing above. Only a brief carrying a retired `### See it yourself` / `### Verify it yourself
(manual)` heading (posted before this schema shipped) walks the Compatibility branch below
instead. Step 1's packet state narrows it: `waiting-for-deploy` skips Validate and the URL Show,
and `awaiting-local` runs Prepare from the PR branch.

**Prepare** — run the plan's Prepare commands, one at a time (`Prepare: none` → skip entirely). If
a Prepare command exits non-zero, or — for a `rendered-page`/`app-route` entry point — the entry
point does not respond afterward (connection refused or HTTP 404), fall back to
`_shared/dev-url-detection.md` to resolve a working dev server rather than trusting the
plan's own Entry point verbatim.

**Validate** — URL surfaces (`rendered-page`/`app-route`) only; `cli`/`flow`/`diff` plans skip
straight to Show. Run whenever browser tools are available (playwright-cli is headless-capable, so
this never needs a visible window): open a quick `playwright-cli` session at the plan's exact deep
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
`/claude-tweaks:accept` never debugs or fixes the underlying application code itself — that stays
out of scope the same way code-quality judgment already does (`/claude-tweaks:review`'s job).

**Caching:** Prepare/Validate runs once per record per `/claude-tweaks:accept` invocation. What's
cached is the resolved entry-point URL/port/credentials and the validation outcome — never a live
browser session handle, since Validate's own session closes before Show runs. A Request-changes
verdict ends that record's walkthrough; any later re-run of the same record is a new invocation
with fresh Prepare/Validate.

### Verdict

**Browser verdict (optional, `rendered-page`/`app-route` only):** applies only to the URL surfaces
Validate above already gates on, and only when browser tools resolve (the same gate Validate uses
— unavailable → skip straight to the terminal question below, no error). When both hold, read
`browser-verdict.md` in this skill's directory and follow it — it composes the recap-page manifest,
runs the `_shared/visual-decision.md` turn loop, maps each event to a verdict outcome (a Pick
**replaces** the terminal question; an Exit **falls back** to it with Approve omitted; everything
else falls back unchanged), and stops the server on every exit path. A `cli`/`flow`/`diff` plan
never reads it. No auto-mode path reaches this — the automatic entry never walks a packet or asks
(`## Component-Skill Contract` below).

**Fallback — terminal `AskUserQuestion`, reused every round (unchanged from before this
adoption):** Call `AskUserQuestion` with `question`: `"Does {title} do what you asked
for?"`, `header`: `"Verdict"`, `multiSelect`: `false`. On an exit-triggered fallback above, omit
Option 1 (Approve) — the browser round already ruled it out:

- Option 1 — `label`: `"Approve"`, `description`: `"This does what was asked"`
- Option 2 — `label`: `"Request changes"`, `description`: `"There's a gap — I'll describe it"`
- Option 3 — for a label-backed entry: `label`: `"Skip for now"`, `description`: `"Leave it pending — I'll come back to this"`. For a closing-commit reconstruction, or a packet on a record with no pending label (never pending — there is nothing to leave), read the record's `risk:*`/`size:*` facets against `exceedsOversightFloor` (`bin/lib/issues/oversight-floor.js`, the same predicate both sweeps filter on). Above the floor: `label`: `"Skip for now"`, `description`: `"Nothing is written — it still carries no acceptance disposition, so /claude-tweaks:tidy's acceptance-gap scan will surface it again"` (true on both drivers — the disposition is an acceptance label under `github-issues` and an `acceptance:` facet under `local-files`, and each driver has its own sweep for it). Below the floor, where both sweeps filter it out: `label`: `"Skip for now"`, `description`: `"Nothing is written — below the oversight floor no disposition is owed, and /claude-tweaks:accept #N still reads the packet"`. For a session-recall entry: `label`: `"Skip for now"`, `description`: `"Nothing is written — unlike a label-backed record, this won't resurface in a later session"`

**Parked local target (#4615).** When `accept-park.js parked` exited 0 for this record, ask exactly three options in place of the three above: `Accept and merge (Recommended)` first resolves the run dir for Step 4 (`_shared/acceptance-labeling-landed.md`'s "Resolve the run dir", as `dispatch/close-out.md` step 3 does; on `no run dir`, say so plainly and ask again with the other two options, this one withheld), then re-checks the head at merge time: `gh pr view {pr} --json headRefOid -q .headRefOid` must equal `reenter`'s printed `head`, and `node "${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js" reenter-check --worktree "{worktree}" --expect-head {head}` must exit 0 (on `moved:true`, a different PR head, or any `reenter-check` exit other than 0, say the head or base moved since the park, or the head since re-entry, and ask again with the other two options, `Accept and merge` withheld this round; the checks are re-run by Step 2.5 on a later merge, as the `awaiting-local` row says, never in this round), then records the approval (`accept:pending` removed, so `parked` then exits 5), then runs `_shared/pr-first-merge.md` Step 3 alone with `{tag}` = `human-approved` and `{expected-head}` = `reenter`'s printed `head` (so `gh pr merge --match-head-commit`), as `dispatch/close-out.md` step 5 does (its `--auto` arm waits on the required checks, no bypass), and Step 4 when the outcome is `merged`, with `PIPELINE_RUN_DIR` bound as `dispatch/close-out.md` step 7 binds it (the resolved run dir, the archived one included, from the PR body's `claude-tweaks-run:` marker as its step 3 resolves it); Step 2.5 and Step 2.9 are skipped for this merge (it is reached only with an unmoved head, pinned by `{expected-head}`); `Accept, I'll merge` records the approval and leaves the PR open; `Broken: here's what I saw` hands the description to the verdict handler (#4614), with no resume here. Cannot-run (no start command, or `Surface: infra`): say so plainly and offer exactly two options, `Accept (agent checks only)` (writes the approval only, no merge: the human merges, as for `Accept, I'll merge`) and `Broken: here's what I saw`, running nothing.

### Compatibility: briefs with no Observation plan

A label-backed brief posted before this schema shipped carries the retired `### See it yourself`
/ `### Verify it yourself (manual)` headings instead of `### Observation plan`. Those two heading
names are quoted **deliberately**, for backward compatibility with briefs already posted — not as
a reintroduction of the sections themselves. Such a brief walks that flow — its own Verdict
question (Approve / See-or-Verify / Request changes / Skip), the interactive pre-flight, and the
live-or-manual sub-choice — in place of the Show-first walkthrough above; read
`skills/demo/legacy-brief-compatibility.md` (under the plugin root) for the full procedure.

### Scope-fork checkpoint

If, anywhere in this walkthrough, the human asks for something beyond confirming this record's
existing behavior — a new feature, a change beyond what Prepare/Validate needed to make the
environment checkable — stop once per item (the first time this happens for the record being accepted — a `#N,#M` batch resets the once-per-item stop for each ref) before doing it. Call
`AskUserQuestion` with `question`: `"That's new scope beyond what's being accepted here. Want me to
capture it as a backlog item now and come back to your sign-off decision, or build it now as its
own thing outside /claude-tweaks:accept?"`, `header`: `"Scope fork"`, `multiSelect`: `false`:

- Option 1 — `label`: `"Capture it"`, `description`: `"File it as a backlog item, then come back to your sign-off decision"`
- Option 2 — `label`: `"Build it now"`, `description`: `"Build it now as its own thing, outside /claude-tweaks:accept"`

"Capture it" routes through the same follow-up-record mechanism Step 3's Request-changes branch
already uses (`follow-up-record.md` in this skill's directory),
with one difference: the body's `Origin:` line reads `Origin: demo scope-fork from
#{n}` (or `from session recall` for a session-recall entry) instead of the changes-requested
variant — a scope-fork capture isn't a changes-requested verdict, so it needs its own provenance
marker. If the human picks "Build it now," don't re-ask for further closely-related work in this
same session.

### Task-anchor discipline

This record's verdict — not yet Approved/Request-changes/Skipped — must never be silently
dropped because the conversation moves on, whether from a declined `AskUserQuestion`, a
Prepare/Validate failure that grows its own back-and-forth, a scope-fork detour above, or any other
detour. Once any such detour concludes, before shifting to a new unrelated topic, restate that
this record's decision is still outstanding and offer to resume. Never end a `/claude-tweaks:accept` run with a
record left mid-decision and unmentioned.

## Step 3: Apply verdicts

Read `verdict-interim.md` in this skill's directory and follow it, for label-backed and
session-recall entries alike. It writes `accept:*` labels only and removes a present `demo:*` twin
in the same edit. A verdict given in Dispatch is not handled by this skill until #4614 lands.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention) — exactly once, after the last item of a `#N[,#M...]` batch; each conditional line keys on the batch as a whole. Exactly one of these three outcome branches applies per invocation — render only that branch's line, bolded and suffixed `(recommended)`:

- **A changes-requested follow-up was filed for any item this run** (Request-changes outcome): **`/claude-tweaks:backlog refine`** — the new gap record needs shaping/authorization like any other backlog item (recommended)
- **No follow-up was filed, and any item this run remains pending after Skip:** **`/claude-tweaks:help`** — lists every #N still awaiting sign-off (Stage 4.7) (recommended)
- **Approved, or Skip resolved with nothing left pending across the batch:** **`/claude-tweaks:help`** — full pipeline status (recommended)

## Component-Skill Contract

`/claude-tweaks:accept` has two entries. The on-demand entry, this file, is typed by a human and
has no `PIPELINE_RUN_DIR` signal to check; the `## Next Actions` block always renders. The
automatic entry is the non-interactive sub-file `automatic-entry.md`, which
`wrap-up/verification-brief.md` Step 4 reads (its Routing table lists the callers); it is never
invoked through the Skill tool, renders no Next Actions and returns to its caller.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Handing the human an entry point without Prepare/Validate having run | The human becomes the integration test, hitting port collisions and broken auth one round-trip at a time |
| Asking for the verdict before Prepare/Validate/Show have run | Show-first means the human judges evidence already surfaced, not a promise to go look later |
| Blocking the walkthrough on a stale `flow` Inspect pointer instead of stating it and continuing | A missing artifact is evidence for the verdict, not a reason to stall the record — run its `Regenerate:` line or say so and move on |
| Skipping Validate and handing the human an unverified URL | Validate is silent and headless — skipping it for convenience hands over exactly the broken-link risk it exists to catch |
| Re-deriving "how do I test this" from the diff when a packet or brief already exists | The pipeline wrote it at build time with full context — Step 1's no-packet build is for records that never got one, not a substitute for reading one |
| Posting a second packet, or posting a packet as a fresh comment by hand | One marker comment per record is the contract; `acceptance-packet.js post` edits it in place, and a second copy splits the human's edits from what the next reader sees |
| Falling back to session recall for a `#N` that does not resolve | Recall would describe whatever this session did under the wrong number — an unresolved ref is an error to report |
| Writing a reconstruction's `### Confirmed` as though someone watched the work | A closing commit evidences what shipped, not that anyone checked it — name the reconstruction and stop at what the commit itself shows |
| Merging or opening a PR from within this skill | Those belong to `/superpowers:finishing-a-development-branch` — `/accept` only resolves the Acceptance axis |
| Silently dropping a record mid-decision because the conversation moved on | A pending verdict must be restated before shifting topic — see Step 2's Task-anchor discipline |
| Treating a record with no interactive surface as not needing sign-off | A `cli`/`flow`/`diff` plan still gets a real human look — it pairs the diff/rationale with concrete pointers, not just "review the diff" |
| Handing a sub-issue's `cli`/`diff` plan to a human as if the slice were the feature | The plan must say which siblings gate the real check and what that check is — render the Full verification block when the record carries one |
| Debugging or fixing an application bug a Prepare/Validate check uncovers | Out of scope like code-quality judgment — capture it as a Request-changes candidate |
| Leaving a live browser session open after Validate or Show finishes | Leaked sessions consume resources — Validate's own session must close before Show runs; Show's `open`/`xdg-open` hands the browser off to the human, it never holds a session open itself |
| Writing `accept:approved`/`accept:pending` for a session-recall entry | No record holds it — the verdict lives in the conversation, not a label; only Request-changes produces a real record |
| Sweeping the pending acceptance backlog from within this skill | Discovery is `/claude-tweaks:help`'s job (Stage 4.7 lists every outstanding `#N`) — `/accept` resolves one item at a time — never a sweep; a `#N,#M` list is the human's own explicit list, never a backlog scan |
| Summarizing, re-wording, or reordering the direction contract's five blocks | The blocks are the pre-build promise the human is checking the result against; a paraphrase is one more reading of the result, which is exactly the circularity this section exists to break |
| Rendering the design-contract heading when no contract resolved, or with only the blocks that parsed | Most records have no contract — an empty section is noise on all of them, and a partial one is worse, because it reads as complete (`_shared/design-contract.md` collapses malformed into absent for this reason) |
| Dropping a malformed contract silently because the section is omitted either way | Omitting the section is right; omitting the *trace* is not. `/accept` has no run dir to log to, so its one plain line is the only place an upstream block rename becomes visible instead of looking like a record that never had a contract |
