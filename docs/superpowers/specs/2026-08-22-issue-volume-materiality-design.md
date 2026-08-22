# Issue Volume: Materiality Floor, Digest Tier, and Birth-Rate Controls — Design

**Date:** 2026-08-22
**Status:** Approved (brainstorming session, 2026-08-22)
**Owner:** Thomas Holk Nielsen

## Problem

The plugin's issue birth rate has no floor. Measured over the 7 days ending 2026-08-22:
512 issues opened vs 385 closed (net +127/week; open backlog ~120 → 247). The backlog is
not rotting — only 15 of 247 open issues were older than 2 weeks — but the volume imposes
three combined costs: human attention at the refine/attention/demo gates, per-issue ceremony
overhead (shape/label/claim/PR per record), and semantic noise (the backlog stops reading as
"what are we building").

Root cause analysis from the audit:

- The **"No implicit deferrals"** philosophy (CLAUDE.md) plus "assume zero cost" obligates
  every review finding, wrap-up learning, and mid-run observation to become an issue. Issues
  are the only sanctioned container for anything not fixed immediately. 171 of the week's 512
  issues carried `by:capture`.
- **Decomposition is a smaller contributor than assumed**: 26 parents produced ~76 leaves
  (avg 2.9), but 6 of 26 parents had ≤1 sub-issue — pure ceremony (parent + one leaf for one
  unit of work).
- The executor **re-aggregates at the other end**: 335 multi-issue-ref commits in the same
  week; fast-lane routinely glues small issues into one run. Splits paid for and then undone.
- Size skew: 245 `size:low` + 194 `size:medium` vs 8 `size:high`; 147 `ceremony:fast-lane`.

## Decision summary

Three birth-side changes (Strategy A from the brainstorm), each independently shippable:

1. **Materiality floor + digest tier** — exhaust channels file individual issues only above
   a floor; below it, findings land as entries in a single rolling digest issue.
2. **Capture absorb-by-default** — when similarity to an existing record is high, absorbing
   into it becomes the recommended default instead of filing a new issue.
3. **Decomposition collapse rules** — `/specify` never creates a parent whose decomposition
   yields one unit; two-leaf decompositions keep a parent only when it does tracking work.

Explicit non-goals:

- **No record-schema change** (theme records / two-tier checklist model — Strategy B — was
  considered and dropped). Claims, labels, dispatch, fast-lane, `ready` all stay per-issue.
- **No re-planning of the gate-batching family** (Strategy C): #512 (overview funnel
  redesign), #732 (batch args), #1101 (per-stage batch commands) continue as already specced.
- **No change to the deferral gate's fix-now rules.** The floor never decides whether to fix
  — only which container a legitimately-deferred item lands in.

## Phase 1: Materiality-floor contract, digest bootstrap, tidy digest sweep

The container and its lifecycle must exist before anything routes into it.

### The contract: `plugin/skills/_shared/materiality-floor.md`

A new shared contract, created per the shared-contract-extraction discipline. Position in the
pipeline: applied **after** `_shared/deferral-gate.md`. An item first attempts fix-now; an
item that fails fix-now gets a valid `Defer-reason:`; only then does the floor route it.

**The floor.** An item routes to the digest when **all three** hold: it would be filed
`size:low` AND `priority:low` AND `risk:low`. Any elevated axis → ordinary issue, exactly as
today. Two unconditional overrides that always clear the floor regardless of scores:

- `Defer-reason: tangential` (new-capability ideas are intent, not polish residue — burying
  them in a digest would kill the capture funnel).
- Human-typed `/capture` input (a human typing an idea is intent, not exhaust — the floor
  applies to agent exhaust channels only; see Phase 2 adopter list).

**Digest entry format.** One line per item: `- [{area}] {one-line finding} — {file refs} —
Defer-reason: {value} — {run-id or skill}`. Entries carry enough context to be promoted to a
real issue later without re-deriving the finding.

### The container: single rolling digest issue

One pinned GitHub issue (label `digest`), append-only via comments — one comment per run,
listing that run's below-floor items. Chosen over a committed digest file (merge-conflict
magnet under this repo's parallel-worktree concurrency) and over per-domain digest issues
(proliferation defeats the purpose). Comment appends are concurrency-safe under parallel
sessions; writes route via `_shared/github-write-transport.md` like all other GitHub CRUD.
Bootstrap: created lazily by the first writer if absent (same bootstrap posture as label
bootstrap in `record.js`); `work-backend: local-files` projects use a
`specs/digest.md`-equivalent per the same contract section (single writer there — no
concurrency concern).

### Anti-graveyard: `/tidy` digest sweep

New tidy step, owning the digest lifecycle:

- **Cluster promotion:** when ≥3 entries touch the same area/subsystem, propose promoting the
  cluster to one real issue (spec-shaped, entries as its deliverable list); on approval the
  digest comments are marked promoted (edited with a `→ #N` suffix).
- **Expiry:** entries older than 90 days with no cluster are archived — rolled into a closing
  summary comment; when the digest issue grows past GitHub's practical comment ceiling, it is
  closed with a summary and a fresh digest issue is opened (the `digest` label + pin move).

### Deferral-gate coherence edit

`_shared/deferral-gate.md`'s "Bundle of small items" bad-reason bullet gains one clarifying
clause: batching is still never a reason to *skip a fix*; below-floor *deferred* items batch
into the digest by design, per `_shared/materiality-floor.md`. The conformance test
(`tests/deferral-gate-conformance.test.js`) is updated in the same change.

### CLAUDE.md amendment

"No implicit deferrals" gains the third sanctioned outcome (rule + one why-clause, per the
project's CLAUDE.md conciseness convention): *do it now, file a backlog record, or — below the
materiality floor — log it to the digest per `_shared/materiality-floor.md`; the floor keeps
the backlog's issue population meaningful.*

### Acceptance criteria

- `_shared/materiality-floor.md` exists, states the all-three-axes floor, both overrides, the
  entry format, and the container definition for both backends.
- `docs/skill-graph.md` carries the new contract's edges (tidy + Phase 2 adopters), stated once.
- Tidy's digest sweep step exists with both promotion and expiry procedures.
- Deferral-gate bullet amended; conformance suite green.
- CLAUDE.md amendment landed.
- A conformance test pins the floor definition (the three label values and the two overrides)
  between the contract file and any code twin introduced.

## Phase 2: Adopter migration (exhaust channels)

Each adopter cites the contract instead of restating it, at the exact point where it currently
files a record for a deferred finding:

- `skills/review/step3-routing.md` (Defer / Capture branches)
- `skills/wrap-up/residue-sweep.md` and `skills/wrap-up/leftover-routing.md`
- The four health sweeps: code-health, docs-health, harness-health, journey-health (their
  issue-filing steps; their existing dedup logic runs first — an item matching an existing
  issue still updates that issue, floor or no floor)
- `skills/visual-review/browser-review.md` (Findings & Ideas Defer routing)
- `skills/reflect/full-mode.md` and `skills/reflect/hindsight-mode.md`

Explicitly **not** adopters: `/capture`'s human-typed path (intent, not exhaust) and
`/specify` (it shapes and decomposes; it does not file findings).

Auto-mode posture: routing to digest is an `AUTO` decision logged per
`_shared/auto-decision-log.md` when a run directory resolves (`DIGEST {time} — {item} routed
below floor ({defer-reason}). Reversibility: high (promotable via tidy).`). It is bookkeeping,
not decision-worthy — no Review Console row per digest entry; the run's digest comment link
appears once in the wrap-up summary.

### Acceptance criteria

- Every adopter's filing step cites `_shared/materiality-floor.md`; no adopter restates the
  floor's definition (conformance grep pins citation-not-restatement, per the
  shared-contract-extraction retirement-sweep discipline).
- A below-floor finding produced by a review/wrap-up run lands as a digest comment, not an
  issue; an at-floor finding still files exactly as today.
- Health-sweep dedup ordering preserved: existing-issue match beats digest routing.

## Phase 3: Specify decomposition collapse rules

In `skills/specify/decomposition-mode.md`, after Step 2 sizing produces the work-unit list:

- **1 unit → always collapse.** No parent. Shape in place when the entry was a record
  (`$ORIGIN_RECORD_NUM` path), else create one ready record directly from the design doc. The
  design doc link goes on the record itself. No exceptions, including strangler-fig shapes
  that degenerate to one unit.
- **2 units, independent (no `Blocked by` edge, no file overlap):** collapse the parent —
  create two ready records linked via `Related:`. **2 units, dependency-ordered** (a
  `Blocked by` edge or the strangler-fig `early-production` flag-then-remove shape): keep the
  parent — it is the completion tracker for the sequence.
- **3+ units → unchanged.**
- `--granularity` never overrides collapse: the flag tunes sizing targets, not ceremony. A
  `fine` run yielding 1 unit still collapses.
- The collapse decision (taken or not, and why) is announced in Step 9's summary and logged
  per `_shared/auto-decision-log.md` when a run directory resolves.

The parent-record guard in `specify/SKILL.md` case 1 is unaffected — it protects existing
parents; this phase only changes when new parents come into existence.

### Acceptance criteria

- Decomposition of a design doc yielding one unit produces exactly one record and zero
  parents (test asserts record count and absence of `parent-issue`).
- Two independent units → two records, `Related:` cross-links, no parent; two
  dependency-ordered units (incl. strangler-fig `early-production`) → parent kept (tests
  cover both branches).
- `--granularity fine` on a one-unit doc still collapses (test).
- Step 9 summary names the collapse outcome.

## Phase 4: Capture absorb-by-default

In `skills/capture/SKILL.md`'s routing (the existing "Absorb into record {N}" conditional
option 3):

- **Interactive:** when similarity is high — an existing open record covers the **same
  file/subsystem AND the same kind of change** — absorb becomes the *recommended* option
  (option 1, "(Recommended)"); new-issue remains one click away. Nothing is silently merged.
- **Absorb mechanics:** the capture lands as a body-append (or comment) on the existing
  record; the existing record's `size:`/`priority:` labels are re-scored upward when the
  addition changes them; the absorb is named in output.
- **Headless (`--chained` / auto):** absorb only at the high bar (same file + same change
  kind, both established from the existing record's body/refs); anything ambiguous files
  fresh — a wrong auto-merge is invisible, a duplicate is visible and mergeable later. Every
  headless absorb logged per `_shared/auto-decision-log.md`.

### Acceptance criteria

- High-similarity interactive capture presents absorb as the recommended first option; low
  similarity keeps today's ordering (tests pin the option ordering rule's prose).
- Headless absorb happens only at the stated high bar; the ambiguous case files a new record
  (test covers both).
- Every absorb (interactive or headless) is named in output; headless ones are logged.

## Rollout order and dependencies

Phase 1 → Phase 2 (the container must exist before anything routes to it). Phases 3 and 4
are independent of each other and of Phases 1–2; each phase is independently shippable and
versioned per the normal release convention.

## Success measure

Re-run the birth-rate audit ~2 weeks after Phase 2 ships: weekly issues-opened should drop
materially (directional target: 30–40% of exhaust-channel filings routed to digest, based on
the size/priority/risk label distribution), with no growth in the >2-week-old open cohort
(i.e., attention cost falls without the backlog starting to rot).
