# Human in control: acceptance-centred pipeline

**Status:** design, awaiting approval · **Date:** 2026-10-30 · **Next:** `/claude-tweaks:specify` this doc

## Intent

The plugin today is built for a human who is *involved*: many small stops along the way (Manifesto,
Review Console items, staged fixes, reflection notes, memory approvals, merge prompts, `/demo` run by
hand). The maintainer's real working pattern has moved past that. They trust the plans, auto-merge
PRs, and validate features by deploying to dev, using them, and trying to break them; when
something is off they start a fresh session and iterate.

The goal is a pipeline built for a human who is *in control* — who owns exactly two decisions:

1. **Intent** — brainstorming and planning: what gets built, and why.
2. **Acceptance** — using the built feature and deciding whether it is what they meant.

Everything between those two belongs to the machine and asks nothing. Where the machine is unsure,
it either resolves the question by policy or carries it forward to one of the two control points.

The evidence that the involvement model has outlived its user is already in the repo: dozens of
open ledger residues, unreviewed console items and leftover worktrees accumulate because the
plugin keeps asking for attention the human has (sensibly) stopped giving.

## Goals

- One policy switch turns the model on for a project; existing per-lever config stays as overrides.
- Zero human stops between intent and acceptance, except ones the human chose (local acceptance,
  risk flags they kept).
- At acceptance, the human finds an **acceptance packet** that makes validating cheap: what changed,
  a recording, a manual test guide with ready-to-click links, what the agent could not test, what it
  already tried to break, and where it is least confident.
- The same acceptance flow runs automatically at pipeline end *and* on demand
  (`/claude-tweaks:accept #N`).
- A verdict ("accept" / "broken") is a real signal that sets work in motion, whichever surface it
  was given on.
- Invisible risk (things UI validation cannot see) is controlled at intent time, never discovered
  at merge time.
- Project-agnostic: works for any project, with or without a dev environment.

## Non-goals

- **An inbox in claude-tweaks.** The cross-project overview belongs to Dispatch. claude-tweaks
  produces packets and consumes verdicts; Dispatch displays them. Dispatch's side is a separate
  design in that repo (see *Dispatch boundary*).
- **Acceptance verdicts as trust scoring.** Verdicts route work; they do not feed an autonomy
  ladder. Risk is controlled by category at intent time, not by track record.
- **Deploying code.** The plugin learns *how to tell* a change is in dev; it does not become a
  deploy tool. (Running a project-declared deploy command, as `dispatch/close-out.md` already can,
  stays as-is.)

## Anti-goals (failure even if it technically works)

- An acceptance packet whose links point at a build that does not contain the feature — a false
  "it's broken" erodes exactly the trust this model rests on.
- A "tested X" claim with no run behind it, or a check that silently skipped itself and shows as
  nothing. Every claim cites real evidence; a skipped check reads as **couldn't test**, never as
  silence.
- Silent acceptance: an unanswered verdict is never treated as "accepted".
- Re-creating the residue pile under a new name: anything not worth a human's attention is
  resolved or filed, never left pending.
- Machinery that can *loosen* control. Automatic mechanisms may only add caution (switch a run to
  local acceptance, add a flag); only the human removes it.

## Constraints

- Contract changes follow expand → migrate every consumer (including the installed build reading
  this repo's committed config) → remove, per CLAUDE.md. The `demo:*` labels are read by
  `bin/lib/issues/acceptance.js`, `trust.js`, `oversight-floor.js`, `console/resolve.js`, and by
  /tidy, /backlog, /help, /wrap-up, /dispatch, /visualize prose plus a large test surface
  (`grep -rln "demo:pending\|demo:approved\|demo:changes-requested" plugin tests docs`).
- `auto`'s existing hard gates (test failure, spec compliance, plan validation, etc.) are not
  weakened by this design. This design removes *involvement* stops, not *safety* gates.
- `/stories`' Target Environment Guard already disables negative (break-it) stories on any
  non-localhost host. The design builds on that, it does not relax it.
- Skill text authored per `docs/skill-authoring.md`; skill edges recorded in `docs/skill-graph.md`
  only.

## The model, end to end

```
 INTENT (human)                   MIDDLE (machine, no stops)                 ACCEPTANCE (human)
 brainstorm/plan ──► risk flags ──► spec → build → test → review ──► packet ──► verdict
                     (kept/removed     + diff tripwire (can only          │          │
                      by human)          add caution)                     │          ├ accept
                                                                          │          ├ broken: fix forward
                                       target=local: stop before merge ◄──┘          └ broken: revert now (dev)
                                       target=dev:   merge → await deploy → dev smoke → packet
```

## Design

### 1. Control mode — one switch

A single policy key turns the model on (proposed name: `control-mode: on`, default off). When on,
it implies:

- `autonomy: unattended` behaviours (console auto-resolve etc., per `_shared/autonomy-ceiling.md`),
  extended by §5 below;
- merge authorization for trusted-origin, unflagged records (§11);
- acceptance target default (`acceptance-target`, §4);
- the deploy declaration (§4) and owned-owners list (§5) are read.

Individual levers keep working as overrides. `/claude-tweaks:init` gains a short setup path that
asks the ~3 questions needed (acceptance target default, how dev is reached / how to tell it's
live, dev base URL) and writes them.

### 2. Intent-time risk flags

During brainstorming/specify, the work is classified against a fixed set of **invisible-risk
categories** — things clicking around in dev cannot reveal:

- data migrations / schema changes
- auth, permissions, access control
- public contracts other consumers depend on (APIs, file formats, hook payloads, labels)
- irreversible side effects (deletions, outbound sends, payments)

The project may extend the list in policy. Each flag surfaces **during the brainstorm/spec
conversation**, where the human is already present, and the human keeps or removes it. A kept flag
means:

1. **Acceptance target is forced to `local`** — the human's verdict precedes merge.
2. **The plan must contain a specific proof** for the risk (e.g. migration rehearsed against a data
   copy; a test that an unauthenticated request is still refused). The packet shows that proof in
   its own section.

Flags are recorded on the work record so every downstream step can read them.

**Diff tripwire.** The declaration is cross-checked against what the code actually touched. Policy
declares sensitive path globs per category (e.g. `migrations/**`, `src/auth/**`); the agent also
classifies the diff. If the change crosses a category nobody flagged, the run **switches itself to
local acceptance** and says why in the packet. The tripwire is monotonic: it can add a flag, never
remove one. Only the human removes a flag, and the removal is logged to the decision log.

### 3. The autonomous middle

In control mode nothing between intent and acceptance asks the human anything:

- **Review Console is not a stop.** Everything it can resolve by policy, it resolves and logs
  (existing `consoleAutoResolve` machinery). Anything it genuinely cannot — a contested finding, an
  unconfirmed bug flagged by review — is carried into the packet's **"Decisions left for you"**
  section instead of a separate console.
- **Bookkeeping never accumulates.** Ledger residue, reflection insights, archived-run residue:
  each is resolved, or filed as a backlog record (spec-shaped, per the deferral gate), at run end.
  "Pending for a human" is not a terminal state in this mode.
- **Memory writes: fully automatic.** Logged so a bad one is traceable and revertable; no
  approval.
- **Upstream feedback filing** — see §5.

Existing HARD-GATEs (test failure, spec compliance, plan validation, merge conflict that cannot be
resolved, …) still stop the run; a stop in control mode is a failure to report, not a question to
answer.

### 4. Acceptance targets and the pipeline finish

**Agent-side checking always happens locally, before merge.** The agent runs its stories,
including the negative (break-it) stories, against a local build in the worktree, and records the
walkthrough (GIF today via `/walkthrough`'s encoder; see §6). This is where adversarial testing is
safe and fast, and where the Target Environment Guard already allows it.

**The human's check runs on the run's acceptance target:** `local` or `dev`. Project default in
policy (`acceptance-target`), overridable per work item — ideally at intent time ("I want to try
this one locally"), and forced to `local` by any kept risk flag (§2).

- **`local`** — the pipeline stops before merge with the PR open and the packet posted.
  `/claude-tweaks:accept #N` starts the app from the worktree and walks the human through the
  packet. The verdict question is:
  - **Accept and merge** (recommended)
  - **Accept, I'll merge**
  - **Broken: here's what I saw** → returns to the builder within the same run; the broken behavior
    becomes a regression test.
- **`dev`** — the pipeline merges. Then:
  1. If the project declares a deploy signal, the session waits a bounded time for it (same shape
     as waiting for CI today).
  2. Once dev reports the change is live, a **dev smoke check** runs: happy-path only, read-only,
     dedicated test account, never negative stories.
  3. The packet is posted with dev links and the record marked as awaiting a verdict.
  - No signal, or the bounded wait expires: the packet posts as **"waiting for deploy"**. Whenever
    it is opened (`/accept` or Dispatch), it checks what version dev is running and states plainly
    whether the feature is there yet. No background waiter outlives the session.

**Deploy declaration (policy, project-agnostic).** Each project states, if it has a dev
environment:

| Field | Meaning |
|---|---|
| how code reaches dev | `on-merge` (automatic), `command` (plugin runs a declared command), or `none` |
| live signal | a CI workflow to watch, or a URL that returns the deployed version/sha |
| dev base URL | so every packet link targets dev, not localhost |

Absent declaration → packet falls back to local "try it" instructions (today's behavior); nothing
breaks for existing projects. A project declaring no usable live signal gets the honest
**"can't confirm it's deployed"**, never a guess.

### 5. Upstream filing and ownership

Feedback filing into another repository is **automatic for any repo we own** and **left for the
human** otherwise.

- *Owned* = repos under the current repo's owner (user or org), plus owners listed in a policy key
  (proposed: `owned-owners`). claude-tweaks itself is owned and therefore automatic.
- External repos (e.g. superpowers, other third-party plugins) → the item goes to the packet's
  "Decisions left for you" section, never filed automatically.

Ownership is decided by policy, not by whichever GitHub account is logged in, so it behaves the
same in every environment (local, cloud, Routine).

### 6. The acceptance packet

One per work item (for decomposed work, one per parent; see *Designer's calls*). Posted on the work
record as a marker-block comment, which is the canonical copy and is linked from the PR, so
`/accept` and Dispatch read the same thing.

Sections:

1. **What changed** — user-facing summary, not a diff tour.
2. **Recording** — the walkthrough of the feature in use.
3. **Test guide** — numbered manual steps, each with a direct link that lands in the right state
   (role, test data). Credentials are referenced by vault entry name, **never** embedded as session
   tokens or passwords.
4. **Couldn't test** — what the agent could not verify, and why (no backend, no dev server,
   needs a real device, needs real credentials…). A check that skipped itself is listed here.
5. **Tried to break** — the negative stories and edge cases run, with results.
6. **Least confident** — where the agent's judgment is weakest; "if I were you I'd poke here".
7. **Risk proofs** — present only when risk flags were kept (§2): the specific evidence per flag.
8. **Decisions left for you** — §3's and §5's carried-forward items, if any.
9. **Deploy status** — target, and (dev) whether the feature is confirmed live.

Every claim in 3–7 cites evidence from an actual run (story report, screenshot, test output). The
packet is narrated from gathered facts and its citations validated against them (the
`fact-validated-narration` pattern used by /activity).

**Exposure.** Screenshots and recordings of dev can capture tokens, e-mail addresses or
customer-like data, and the packet may land in a public repo. Recordings/screenshots are redacted
or, for public repos, stored privately and linked rather than embedded. The builder decides the
mechanism; the requirement is that nothing secret-shaped reaches a public surface.

Existing raw material to build from: wrap-up's Verification Brief and Try-it block
(`_shared/try-it.md`), `/stories` negative stories, qa-agent step screenshots, review's
low-confidence findings, `/walkthrough`'s GIF encoder (`bin/walkthrough-encode.js`).

### 7. `/claude-tweaks:accept` — `/demo` rewritten

`/demo` is renamed and rewritten as the acceptance step. It is the same flow whichever way it
starts:

- **Automatic, at pipeline end:** produce the packet, post it, mark the record awaiting verdict.
- **On demand, `/claude-tweaks:accept #N`:** walk the human through the same packet — open the
  links, show the recording, step through the test guide, then ask the verdict. Re-running on an
  item that already has a packet reuses it and refreshes anything stale (e.g. deploy status, links
  to an older deploy); it never builds a second packet.

The same verdict comes from either surface (terminal or Dispatch) and has the same effect.

Keep from today's `/demo`: verdict labels (renamed), follow-up record mechanics, Verification
Brief/Try-it as packet input, the Prepare/Validate/Show observation plan. Drop: standalone-only
restriction, the terminal question as the *only* way to give a verdict.

### 8. Verdicts and what they set in motion

Verdict vocabulary (labels, renamed from `demo:*`; proposed names):

| Label | Meaning | Effect |
|---|---|---|
| `accept:pending` | packet posted, awaiting human | none; visible in Dispatch |
| `accept:approved` | human accepted | record closes (if not already) |
| `accept:changes-requested` | human says broken | follow-up per below |

**"Broken"** offers two forms:

- **Fix forward** — files a follow-up record carrying the original's context, the human's note,
  and a requirement that the broken behavior becomes a regression test. Born `ready` + `auto:build`
  so the existing build trigger picks it up with no further human step. It inherits the original's
  provenance (§11): a fix-forward to trusted work is trusted and merges on its own. (Under `local`, it returns
  to the builder in the same run instead.)
- **Revert now** (dev target only) — opens and merges a revert PR immediately, then files the
  fix-forward record. This is what makes skipping merge review safe: every dev merge is cheap to
  undo.

**No silent acceptance, no nagging.** Unanswered `accept:pending` never blocks anything and is
never auto-promoted to approved. Pending items are summarized in one digest (Dispatch's job), not
per-item reminders. "Nobody has looked at this" stays visible and true.

Verdicts do not feed an autonomy/trust ladder (non-goal). See *Builder notes* for the existing
`trust.js` consumers.

### 9. Stop switch

One command or label pauses all automatic building and merging for a project until the human lifts
it (proposed: label `auto:paused` on a pinned record, or a policy toggle set via a command — builder's
call). The human must be able to halt automation without understanding what it is currently doing.

### 10. Dispatch boundary (contract only)

**GitHub labels are the contract; neither project calls the other.**

1. claude-tweaks posts the packet on the record and applies `accept:pending`.
2. Dispatch sees the label (it already receives `issues` events, including `labeled`) and shows an
   acceptance item linking to the packet.
3. The human's verdict, from Dispatch, sets `accept:approved` or `accept:changes-requested` plus a
   comment carrying the note (and the fix-forward / revert-now choice).
4. claude-tweaks acts on the verdict (§8). The follow-up record's `auto:build` label fires
   Dispatch's existing `hygiene-dispatch` trigger.

This keeps Dispatch's stated non-goal ("no second copy of GitHub state"). The verdict comment format
must be machine-readable (a fenced marker block like the plugin's other marker comments) and
treated as untrusted input on read. The Dispatch-side design (an `acceptance` item kind on the
session-hub board, cross-node visibility) is a separate doc in the dispatch repo, written against
this contract.

**Who reacts to a Dispatch-given verdict?** Dispatch can trigger a claude-tweaks job on the
`labeled accept:changes-requested` event (same mechanism as the existing `auto:build` trigger);
in a session, `/accept` handles it directly. Both call the same verdict handler.

### 11. Merge authorization: trusted origin

**Decided by the maintainer:** in control mode, policy authorizes merging (and the fix-forward
record's `auto:build`) for any record whose **origin is trusted** and that carries no kept risk
flag. A record of untrusted origin never auto-merges and parks at `pending-review` as today.

This deliberately overturns #2734's ruling that no `policy.yml` value may authorize a merge
(`_shared/autonomy-ceiling.md`, "Orthogonal to the ceiling"), **for control mode only, and only
for trusted origin**. Record the reversal in `docs/decisions/` and rewrite that section, the
Manifesto's `merge-authorization` lever, and the Review Console's ungranted-member carve-out
(#1802, #1966) to match. Outside control mode the old rule stands unchanged.

**Why trusted origin is the line.** The risk that remains once risk flags and revert-now exist is
code no human intended reaching dev with nobody in the chain. Issue text is untrusted input that
can steer an agent. Provenance, not volume of automation, is what separates "the maintainer
started this" from "someone else's text started this".

**Trusted origin, defined:**

- A **root** record is trusted when its author is a trusted principal: the repo owner, plus logins
  listed in policy (proposed: `trusted-authors`). This is read from GitHub's author field, never
  from body text.
- A **derived** record (sub-issue, agent-filed follow-up, fix-forward) is trusted only if its whole
  ancestry back to a root is trusted. **An untrusted root taints every descendant**, even when the
  descendants were filed by the maintainer's own account, which is the account agents run as.
- Provenance is recorded at creation as a machine marker naming the parent, and verified by walking
  the GitHub-side links (sub-issue parent, `Origin:` reference corroborated by the referenced
  record's author). It is never asserted from an editable body line alone. A record whose chain
  cannot be verified counts as **untrusted** (fail closed).
- Externally authored issues never become trusted through later edits, labels or comments by a
  trusted principal. The maintainer makes one trusted by brainstorming or specifying it
  interactively, which creates a trusted root that supersedes the external one.

**Risk flags still win.** A trusted, flagged record still takes local acceptance before merge (§2).

**Builder requirement:** provenance checks need negative tests for each laundering path: external
root → agent-filed child; external root → maintainer-filed child; editable `Origin:` line pointing
at a trusted record; a broken or unverifiable chain.

## Phases

### Phase 1 — Contracts

Policy keys (`control-mode`, `acceptance-target`, deploy declaration, `owned-owners`, risk-path
globs), packet schema (run-dir JSON + rendered comment), verdict label set and verdict comment
marker. Label rename **expand** step: `accept:*` created and read alongside `demo:*` by every
consumer.

### Phase 2 — Packet production

Wrap-up produces the packet from existing material; adds the Couldn't test / Tried to break / Least
confident / Decisions-left-for-you sections; walkthrough recording runs automatically when a story
and local base URL exist; fact-validated narration; exposure handling.

### Phase 3 — `/accept`

`/demo` → `/accept` rewrite: automatic and on-demand entry, packet reuse/refresh, verdict question
per target, verdict handler (fix forward, revert now, local re-entry). `/demo` stays as a deprecated
alias with a recorded removal condition.

### Phase 4 — Targets and dev

`acceptance-target` resolution (policy → per-item override → risk-flag force), local stop-before-
merge path, dev path: bounded deploy wait, live check, dev smoke, "waiting for deploy" fallback and
freshness check on open.

### Phase 5 — Risk flags and tripwire

Intent-time classification in brainstorm/specify, flag recording on the record, proof requirement
in plans (plan-audit check), diff tripwire with monotonic escalation.

### Phase 6 — Autonomous middle

Console items carried into the packet instead of a stop; end-of-run residue resolve-or-file;
memory writes automatic; upstream filing ownership rule.

### Phase 7 — Control mode, trusted origin, init, stop switch

The single switch and what it implies; trusted-origin provenance and merge authorization (§11),
including the decision record reversing #2734 for control mode; `/init` setup questions; stop
switch.

### Phase 8 — Contract cleanup

Migrate remaining `demo:*` readers, then remove `demo:*` and the `/demo` alias once the removal
condition holds.

## Designer's calls (from the builder check)

Settled by the designer, not the maintainer; the maintainer may override any of them.

- **Scope when control mode is off.** Packet improvements (new sections, fact-validated narration,
  automatic recording, exposure handling) and the `/demo` → `/accept` rename are universal: they
  replace the Verification Brief for every project, migrated expand-contract. Everything that
  *removes a stop* — merging without a prompt, console items folded into the packet, automatic
  memory/upstream writes, the dev deploy wait, risk-flag forcing — happens only under control mode.
- **A `local` run does not stay alive waiting.** It ends parked at "awaiting local acceptance" with
  the PR open (the existing `pending-review` park shape), run dir archived, claim released.
  `/accept #N` recreates a worktree from the PR branch and starts the app from it. "Broken" starts a
  new run on the same PR branch through the existing halted-run resume path. "Same run" in §4 means
  same PR and branch, not a live process.
- **Acceptance granularity is the unit the human brainstormed.** For decomposed work, the packet
  and verdict live on the parent (the feature), extending today's parent-gate. Sub-issues get the
  agent's own checks only and merge normally. A sub-issue that carries a kept risk flag stops for
  its own local verdict. Otherwise the parent's acceptance runs once its last sub-issue has merged:
  on dev, or on local `main` when the target is `local`.
- **Headless shaping keeps detected risk flags.** When `/specify` or a refine runs with no human
  present, a detected category is kept (more caution, consistent with "machinery only adds
  caution"), and the record is marked so the flag is shown at the next human touchpoint, where it
  can be removed. Existing backlog records are not reclassified in bulk; they are classified when
  next shaped. In practice the classification hook is `/specify` (brainstorming is third-party).
- **`local-files` backend.** `/accept`, the packet and the interactive verdict work there, using the
  existing `acceptance:` field with the new vocabulary. Verdicts from Dispatch, revert-now, and the
  `dev` target's auto-merge are GitHub-only and say so when unavailable.
- **The canonical packet is the GitHub comment** (a marker block, like the plugin's other marker
  comments). The run-dir copy is a working copy and is not read after the run. `/accept` and
  Dispatch both read GitHub; deploy-status refreshes edit that comment. `/demo`'s no-record path
  for this session's unrecorded work is kept in `/accept`.

## Builder notes

- **`trust.js` and acceptance labels.** `bin/lib/issues/trust.js` builds a per-class trust table
  from `demo:*` verdicts, and its revert detector is reused by `merge-lane-breaker.js`. This design
  does not remove that machinery: the label rename migrates its reads like any other consumer.
  Whether `trust.js` should stop reading acceptance verdicts at all is a separate follow-up record,
  because the revert-detection half is a safety net worth keeping.
- **`oversight-floor.js`** currently skips `demo:pending` for low-risk records. In control mode
  every user-visible feature gets a packet; the builder decides whether below-floor items get a
  reduced packet or none, and records the call.
- **Policy key names** above are proposals; the builder may rename for consistency with
  `_shared/policy-schema.md`, keeping the meanings.
- **Video vs GIF.** Playwright CLI has no screencast operation (per `/walkthrough`); GIF from step
  screenshots is acceptable for v1.
