# Sweep, residue markers, and the headless/human seam across tidy · specify · backlog · dispatch

**Date:** 2026-08-26
**Origin:** brainstorm — "should /tidy also run backlog refine/grant?" → "what is the right
configuration of the cheap, frequent queue-hygiene units, and what happens at each one's
not-automatic moment?"
**Related:** #1317 (absorbed — its deliverable is Phase 1), #825 (marker removal authority —
Phase 2 gives `refine #N` that authority for `needs:*`), #762 (shared record-batch grammar —
Phases 4/5's `--budget` lands there), #1216 (residue filings invisible to backlog — the marker
in Phase 1 is the tracker-side channel that record can adopt), #1352 (grant's gh-absent gap —
inherited by `refine`'s headless posture after Phase 3, unchanged in scope).

## Problem

Four units keep the queue healthy and are cheap enough to run often — `/tidy`, `/specify next`,
`/backlog refine`, `/backlog grant` — plus `/dispatch next` to drain it. Today a human runs five
commands, two of them once *per record* (`specify next`, `dispatch next` each handle exactly
one), and the units' "I can't decide this alone" outcomes land in four different places: two
labels a list reads (`needs:definition`, `solution:unjustified`), a report row nobody sees after a
headless firing, and a run-dir `staged/` that a cloud Routine's sandbox discards. Two of the units
share a bug (#1317): a content-level "not an autonomous-build candidate" verdict is expressed as
"not shaped" (strip `ready`), so the record loops between `ready` and backlog forever.

The seam between "runs by itself" and "a human is owed a decision" is drawn per-unit, in
different vocabulary each time, and `refine` — whose labeling half needs no human in practice —
is human-only by contract because its *grant* half shares the mode.

## Design principle

> Every unit's non-automatic outcome is a **marker on the tracker**; `backlog attention` is the
> **one list** that reads every marker; each row carries **one launcher**; and the drain of all
> headless-safe work is **one command** whose close-out *is* that list.

The security seam does not move: `auto:*` origination still needs a present human's click, that
human's standing `unattended` policy, or the two-key headless opt-in through `grant-gate.js`'s
chain. What moves is everything that was never a grant.

## Target shape (after all phases)

```
/claude-tweaks:sweep            headless, zero questions: tidy → specify (drain) → backlog refine (headless)
                                close-out = the attention list, ending in the dispatch line
/claude-tweaks:backlog refine   human-present: one batch table over everything owed to you, one click
/claude-tweaks:dispatch         drain, --budget
```

| Surface | Before | After |
|---|---|---|
| `specify` | `next` = one record; `#N`, `#N,#M`, `#A-#B`, doc, topic | bare = drain to `--budget`; `next` deprecated alias; explicit forms unchanged |
| `dispatch` | bare = interactive pick; `next` = one group | bare = drain to `--budget`; `next` deprecated alias; `#N`/`#N,#M` unchanged; interactive pick retired |
| `backlog` | `refine` (human-only) · `grant` (headless) · `overview` · `attention` | `refine` (presence-switched: headless lanes alone, or the full batch with a human) · `overview` · `attention` — `grant` retired into `refine` |
| `tidy` | staged residue in `{run-dir}/staged/` only | record-scoped residue = marker; repo-scoped residue survives via the committed run dir; `--approve` re-enters it |
| markers | `needs:definition`, `solution:unjustified` | + `needs:decision` (one new label, one comment shape) |
| human list | `attention`: its current per-label fetches | `attention`: `needs:*` prefix, `solution:unjustified`, `bot:blocked`, ungranted `shaped:headless`, breaker banner, tidy row |
| launchers | one per row type | `specify #N` · `challenge #N` · `refine #N` |
| orchestrator | none (the cloud fleet is the only composition) | `/sweep` — thin, never claims/builds/merges |

Verbs retired: `specify next`, `dispatch next`, `backlog grant`, dispatch's bare interactive pick.
Added: one skill, one label, `--budget`, `refine #N`, `refine --reset-breaker`, `tidy --approve`.

## Decisions and their reasons

- **One marker, not two.** A grant refusal is a decision with its rationale in the comment. The
  worklist rule is stated once — headless units skip any record carrying a `needs:*` label — so no
  second label is needed to carry an exclusion semantic.
- **The comment is the interface.** Every unit that stamps `needs:decision` writes the same
  comment shape (Phase 1). `attention` renders its first line; `refine #N` renders its options.
  A future unit gets its residue channel by conforming, not by designing one.
- **`grant` mode folds into `refine`.** Both would call the same gate chain; the boundary is the
  chain and the two policy keys (`autonomy: unattended` + `grant-origination-enabled`), not the
  mode name. `refine` already switches on presence for its confirm gate (`refineAutoApply`); the
  same presence switch selects the lanes. The per-mode copies of the local-files stop paragraph
  become one.
- **`sweep` is a new thin skill, not `tidy`.** Tidy's policy vocabulary is aggressiveness tiers;
  backlog's is the autonomy ceiling; the wrapper reads both. Tidy is also at its size ceilings.
  A sixty-line orchestrator that owns neither vocabulary is simpler than tidy owning the ceiling.
  Its order is tidy → specify → refine (stale records leave before shaping/grant budget is spent
  on them) — deliberately *not* the cloud fleet's Sunday-last tidy.
- **The finders and dispatch stay out of `sweep`.** Health sweeps are an audit, not hygiene;
  dispatch claims and builds, which is exactly what disqualifies a skill from parenting a
  grant-writing unit (self-authorization). `sweep` ends with the dispatch line, never runs it.
- **Marker writes are bookkeeping, not dispositions.** Tidy's tier table rightly stages every
  outward disposition (close, park). A `needs:*` label + comment is the staging channel reaching
  the tracker — the class `_shared/autonomy-ceiling.md`'s bookkeeping table already grants at
  `trusted`+, and what `specify next` does with `needs:definition` today. One row there, no new
  contract concept.
- **No residue container issue, no dismissal file.** Run dirs are already tracked (reconcile
  commits them); tidy's housekeeping commit includes its own run dir, so repo-scoped residue
  survives the sandbox. Dismissal memory is not built: `step-6-auto.md`'s rule stands — a
  recurring staged item is a missing routing rule. For record-scoped residue the human's
  resolution comment bumps `updatedAt`, which *is* the staleness clock, so "keep" is durable for
  free.
- **Budget counts attempts.** A routed record cost a framing-guard call; the close-out reports
  `shaped / routed / failed` (specify) and `dispatched / skipped` (dispatch).

## Non-goals

- No change to `grant-gate.js`'s chain, the two-key opt-in, `fleet-daily-grant-cap`, the veto
  window, or the merge-lane breaker's trip conditions.
- No new routine templates; the cloud fleet keeps its rows, with row 10's prompt updated.
- No change to `overview` mode.
- Priority/Related synthesis stays in `refine` (it becomes headless-safe there — Phase 3); it does
  not move into tidy. An earlier draft of this design moved it; the fold-into-refine made that
  unnecessary.

---

## Phase 1 — `needs:decision`: the marker, the comment, the worklist rule (absorbs #1317)

**Deliverables**

- `_shared/work-record.md`: add `needs:decision` to the label taxonomy (family: Definition, alongside
  `needs:definition`), with meaning "a headless unit proposed an action it may not take alone —
  the proposal and its command are in the record's newest unresolved decision comment." Add the
  **decision-comment template**, defined once:

  ```
  <!-- needs-decision: {unit} -->
  ## Decision needed
  **Proposed:** {one line — the action}
  **Why:** {one line — the rationale, e.g. the grant-check RATIONALE}
  **Command:** `{paste-ready, fully-qualified}`
  ```

  and the **resolution rule**: a resolver prepends `**Resolved:** {choice} — {date}` to the
  comment and removes the label in the same step; a comment without that line is *unresolved*.
- Permission matrix: `needs:decision` (add + remove) for `/backlog refine`, `/tidy`, `/specify`
  (removal only, when shaping resolves it — this also closes #825's `needs:definition` gap in the
  same edit: shaping mode may remove any `needs:*` it resolves).
- **Worklist rule, stated once** in `_shared/work-record.md` and cited by consumers: a headless
  unit skips any open record carrying a `needs:*` label. Consumers to update: `grant-gate.js`'s
  candidate filter (`backlog-grant-gate.js`), `refine-mode.md` Step 1's worklist, `next-mode.md`'s
  eligibility `EXCLUDE` set (prefix, not the literal `needs:definition`), tidy's Step 1 shapes
  (skip re-proposing on a record with an unresolved decision comment).
- `_shared/autonomy-ceiling.md` bookkeeping-capabilities table: one row — `needs:*` label +
  decision comment, granted at `trusted`+, written by headless units as their residue channel.
- **#1317's fix**: `refine-mode.md` Step 3 / `refine-lanes.md` Grant lane — `RECOMMEND_BUILD:
  false` on a record that already carries `risk:*` + `size:*` and passes the body-shape check
  stamps `needs:decision` (comment: the RATIONALE, command: `/claude-tweaks:backlog refine #N`)
  and **keeps `ready`**. Flag-back is reserved for genuinely unscored / not spec-shaped records.
  Grant mode's gate-4 refusal (`grant-mode.md` Step 2 Phase B, until Phase 3 folds it) writes the
  same marker. Gates 1-3 refusals (origin, trust, ceiling, cap) write nothing — they are cheap,
  mechanical, and change on their own.
- `_shared/label-bootstrap.md`: the label.

**Acceptance criteria**

- A scored, spec-shaped record refused by grant-check ends the run carrying `ready` +
  `needs:decision` + one unresolved decision comment; a second refine run neither re-checks nor
  re-comments it.
- Every consumer listed above excludes `needs:*` records, verified by a conformance test that
  reads the live prose and the `EXCLUDE` set (skill-prose-conformance-tests convention, go-red
  proven).
- `#1317` closes as absorbed by this phase's record, not built standalone.

## Phase 2 — `attention` as the single list; `refine #N` and `refine --reset-breaker`

**Deliverables**

- `attention-mode.md`: fetches become `needs:*` (prefix — `gh issue list` has no prefix filter,
  so fetch open records once via `_shared/record-queue-fetch.md`'s snapshot and filter in the
  merge step, matching the file's own set-logic-in-node idiom), `solution:unjustified`,
  `bot:blocked`, and the existing ungranted-`shaped:headless` AND-fetch. That last one **stays**:
  a gate 1-3 refusal (trust class, cap, ceiling) writes no marker by design (Phase 1), so a
  headlessly-shaped record refused for those reasons is visible only through this fetch. Only a
  gate-4 content refusal arrives through the `needs:*` prefix; Step 2's dedupe keeps a record
  matching both in one row.
- Two non-record rows: a **breaker banner** at the top when `readBreakerState` reports
  `tripped: true` (by #N, reason, since; launcher `/claude-tweaks:backlog refine --reset-breaker`),
  and a **tidy row** when the newest `.claude-tweaks/pipelines/*-tidy-standalone/staged/` is
  non-empty (count; launcher `/claude-tweaks:tidy --approve`).
- Launchers collapse to three: `needs:definition` → `/claude-tweaks:specify #N`;
  `solution:unjustified` → `/claude-tweaks:challenge #N`; everything else (`needs:decision`,
  `bot:blocked`) → `/claude-tweaks:backlog refine #N`.
- `refine #N` (new argument form, `refine-mode.md`): human-present only. Reads the record's
  unresolved decision comments and its lane state; renders one batch table whose rows are the
  proposals (grant anyway / build myself / park / keep / close, plus re-authorize for
  `bot:blocked`); applies the choice, writes the resolution line, removes the marker. This is
  the authority #825 asked for, generalized to `needs:*`.
- `refine --reset-breaker`: jumps to `merge-lane-reset.md`'s question and exits — no sweep.
- Ranking unchanged (priority band, then age). Banner and tidy row render above the ranked list.

**Acceptance criteria**

- A record carrying `needs:decision` from any unit appears in `attention` with its comment's
  `Proposed:` line and the `refine #N` launcher.
- `refine #N` on such a record leaves it with no `needs:*` label, one resolved comment, and the
  chosen action applied — and a following headless `refine` re-admits it to the worklist.
- With the breaker tripped, `attention`'s first row is the banner; `refine --reset-breaker`
  asks exactly one question and writes exactly one `decisions.md` line.

## Phase 3 — Retire `backlog grant` into `refine`'s headless posture

**Deliverables**

- `refine-mode.md`: a **presence switch** at Step 0, mirroring `dispatch/SKILL.md`'s rule (a
  human typed it, or a skill invoked it on a human's behalf → human-present; a Routine firing or
  `/sweep` → headless). Headless posture runs the Priority, Related, Flag-back, and mechanical
  dependency-repair lanes and routes the Grant lane through `bin/backlog-grant-gate.js` + gate 4
  exactly as `grant-mode.md` Steps 0-5 do today (ceiling gate, breaker sweep, cap tracking,
  audit comment, `auto:merge` maturation hand-off unchanged). Re-authorize, breaker reset,
  `#N`, and the batch-confirm are human-present only. Judgment-required dependency repairs stamp
  `needs:decision` in either posture.
- `grant-mode.md` content moves under `refine-mode.md`'s headless section (or a
  `refine-headless.md` sub-file — the 40KB ceiling decides; `refine-mode.md` sits near it, see
  #845/#1442). `grant-mode.md` is deleted, not left as a stub.
- `backlog/SKILL.md`: `grant` removed from the argument grammar and Input table; one Preflight
  paragraph replaces the three mode-specific local-files stop paragraphs (same enumeration,
  once); the Component-Skill Contract rewords "human-only" as: *`refine`'s grant-originating and
  re-authorizing lanes require a present human or the two-key headless opt-in; `refine` may be
  invoked headlessly by a Routine or by `/sweep`, and by no skill that claims, builds, or
  merges.* Anti-Patterns rows referencing `grant` mode are re-pointed.
- `backlog/routine-template.yml`: prompt becomes `/claude-tweaks:backlog refine`; `routine/fleet.md`
  row 10 and the withheld-row wording follow. A firing below the two keys still runs the labeling
  lanes — the routine is no longer a pure no-op below `unattended`, which is the point.
- `_shared/work-record.md` permission matrix: the `/backlog grant` row merges into `/backlog
  refine`'s, with the headless-posture condition on its `auto:*` cell. `skill-graph.md`,
  `help/reference-card.md`, `README.md`, `docs/plugin-structure.md`: every `backlog grant`
  citation swept (grep the literal and its regex-escaped form; the `machine-grant-outlook.md`
  citations included).
- Expand-contract: `backlog grant` becomes a deprecated alias that **forces the headless
  posture regardless of presence** (exactly what `grant` did — no batch-confirm, no labeling
  lanes beyond the grant chain would be a behavior change, so the alias runs the full headless
  posture: labeling lanes plus grant chain), warn-tier notice, removal condition recorded in a
  `backlog/deprecated-aliases.md` mirroring dispatch's.

**Acceptance criteria**

- A headless `refine` at `supervised` applies priority/Related labels and originates no `auto:*`;
  at `unattended` + `grant-origination-enabled` it grants exactly the set `backlog grant` would
  have, with identical audit comments (`tests/grant-mode-*` suites re-pointed, not deleted).
- `evals/scenarios/backlog-refine-permission-matrix-compliance.yaml` still passes — the
  local-files stop and the never-self-grant rule are unchanged in effect.
- `grep -rn "backlog grant" plugin docs README.md` returns only the alias stub and its removal
  condition.

## Phase 4 — `specify` bare = drain with `--budget`

**Deliverables**

- `specify/SKILL.md` Input: bare `$ARGUMENTS` (no ref, path, or topic) resolves to **drain mode**:
  `next-mode.md`'s loop — claim → framing guard → shape or route → release — repeated over the
  ranked eligible set until `--budget <n|all>` attempts are spent or the set is empty. Default
  from a new policy key `specify-budget` (`_shared/policy-schema.md`, `bin/lib/policy-schema.js`,
  `_shared/work-record-config.md`; default 5). `--priority <band>` composes with bare exactly as
  it did with `next`.
- `next-mode.md`: Selection becomes "the ranked list", Claim/Guard/Shape/Release run per
  record; the per-record claim/release and the `needs:definition` routing are unchanged. A
  routed record is excluded from the rest of this run's set by the same `needs:*` rule (Phase 1).
  Close-out reports `shaped / routed / failed` with refs; headless firings keep the existing
  "render Next Actions only when a human is present" rule.
- `next` becomes a deprecated alias for `--budget 1`, warn-tier, removal condition in a
  `specify/deprecated-aliases.md`. `shaped:headless` stamping is unchanged (drain mode is the
  headless shaper).
- `specify/routine-template.yml` prompt drops `next`. `#762`'s shared grammar file, if it lands
  first, is where `--budget` is defined; otherwise `_shared/record-batch-input.md` is created
  here with just that flag and #762 extends it.

**Acceptance criteria**

- Bare `specify` with three eligible records and `--budget 2` shapes or routes exactly two,
  releases both claims, and its close-out names the third as remaining.
- `specify next` behaves as `specify --budget 1` and prints one deprecation notice.
- `tests/specify-next-mode.test.js` is re-pointed (loop, not single pick) and stays green.

## Phase 5 — `dispatch` bare = drain with `--budget`

**Deliverables**

- `dispatch/SKILL.md` Input: bare resolves to the headless drain — `next`'s select-and-dispatch,
  repeated over ranked groups until `--budget <n|all>` groups are dispatched or none remain.
  Default is the existing `dispatch-batch-size` key (no new key). `--priority` composes with
  bare. The interactive bare pick (Step 3's `AskUserQuestion`) is retired; a human choosing names
  the set (`#N,#M`) or pastes `overview`'s Dispatch line. `--batch-size` is folded into
  `--budget` as a deprecated alias (extending `deprecated-aliases.md`).
- Sequential-execution and claim semantics per group are unchanged (`sequential-execution.md`,
  `flow/claim-targets.md`); the drain is the existing `next` loop body run `n` times with the
  existing zero-eligible exit.
- `dispatch/routine-template.yml` prompt drops `next`; fleet row 11 follows. `backlog
  overview`'s Dispatch stage line and `refine`'s Next Actions dispatch line drop `next`.

**Acceptance criteria**

- Bare `dispatch --budget 2` with three authorized groups dispatches the top two by
  priority-then-age and exits with the third named as remaining; `--budget all` drains.
- `dispatch next` prints one deprecation notice and dispatches exactly one group.
- The self-filing headless self-report path (`_shared/headless-self-report.md`) fires for the
  bare form exactly as it did for `next`.

## Phase 6 — Tidy residue: markers for record-scoped findings, committed run dir for the rest

**Deliverables**

- `tidy/step-6-auto.md` routing table: every record-scoped row that resolves to **Stage** at the
  active tier (stale close, Defer, Absorb, Open parent gate on `github-issues`, the acceptance
  backstops' recommendations) additionally writes the Phase 1 marker + decision comment to the
  record under the bookkeeping carve-out — the staged file still lands in `{run-dir}/staged/`
  for `--approve`. Rows that Auto-apply are untouched. Always-surfaced no-op rows (`[scoring]`,
  `[blocked]`, `[legacy]`, unarmed PRs) write nothing — `[blocked]` is now an `attention` row on
  its own, and `[scoring]` resolves through the sweep (refine flag-back → specify drain).
- Loop safety: `step-1-records.md` shapes skip a record carrying an unresolved decision comment
  from the same unit (`<!-- needs-decision: tidy -->`) — one proposal at a time per record.
- Step 7.5 under `pr-first`: the housekeeping commit includes `{run-dir}` (`decisions.md`,
  `report.md`, `staged/`), so a cloud firing's residue survives. Under `local-merge` the commit
  already lands in the main checkout; no change.
- `tidy --approve [run-dir]`: re-enters Step 6's Approve over the named run's `staged/` (default:
  newest `*-tidy-standalone` with a non-empty `staged/`), renders the Approve section, and on
  approval runs Steps 7-7.5 and archives the run via `close-run`. Re-verifies every item's
  precondition fresh (`_shared/reverify-before-write.md`) — a staged item whose record was
  meanwhile closed or resolved is reported as `stale`, never applied.
- `bin/lib/hooks/session-start.js`: the unfinished-runs notice also lists standalone runs whose
  `staged/` is non-empty, with `tidy --approve` as the pointed command.

**Acceptance criteria**

- A headless `moderate` tidy that stages a stale-close proposal leaves the record with
  `needs:decision` + a decision comment naming `/claude-tweaks:tidy --approve`; the next tidy run
  does not re-stage it.
- A human "keep" resolved through `refine #N` leaves the record out of the next tidy's stale set
  (its `updatedAt` moved).
- After a `pr-first` headless tidy, `git show {merge-commit} --stat` lists the run dir's
  `staged/` files; `tidy --approve` in a later session finds them.

## Phase 7 — `/sweep`: the orchestrator and its parent contracts

**Deliverables**

- `plugin/skills/sweep/SKILL.md`. No `routine-template.yml` — the cloud fleet keeps its own
  rows; `sweep` is the on-demand form of the same composition. Runs, in order, `/claude-tweaks:tidy`
  (auto mode), `/claude-tweaks:specify` (bare, drain), `/claude-tweaks:backlog refine`
  (headless posture) — each as a component step under one run dir
  (`{ISO}-sweep-standalone`, `_shared/pipeline-run-dir.md`'s standalone fallback), one
  `decisions.md`. Between units it invalidates `_shared/record-queue-fetch.md`'s session
  snapshot (tidy mutates the queue the next two read). Close-out = `attention`'s render
  (invoked, not restated), followed by the Next Actions block whose recommended line is
  `/claude-tweaks:dispatch`. Accepts `--budget <n|all>` (forwarded to specify) and
  `--scope` (forwarded to tidy). Never claims, builds, or merges — stated as the invariant that
  makes it a legal parent of a grant-writing unit.
- **Parent contracts** (the paragraphs `tidy/SKILL.md`'s Component-Skill Contract says a future
  parent must write): `tidy`, `specify` (drain mode), and `backlog refine` (headless posture) each
  accept a `sweep` parent signal — `$PIPELINE_RUN_DIR` set to the sweep run dir — under which
  they suppress their own Next Actions block, log to the shared `decisions.md`, and return their
  close-out counts to the parent. `attention` needs none (read-only).
- `docs/skill-graph.md`: a `## sweep` section with edges to tidy, specify, backlog, attention,
  dispatch (line only), and `_shared/record-queue-fetch.md` (snapshot invalidation);
  reciprocal rows in the three children. `help` workflow diagram, `help/reference-card.md`,
  `README.md` artifact-lifecycle diagram, `docs/plugin-structure.md` skill table.
- Naming note: "sweep" is already a common noun in this repo (wrap-up's residue sweep, tidy's
  digest sweep, refine's grant sweep, the four health sweeps). As a *skill name* it is still
  unique; prose that says "the sweep" must say which. `/claude-tweaks:sweep` in actionable text,
  per the fully-qualified rule.

**Acceptance criteria**

- One `/claude-tweaks:sweep` invocation on a queue with a stale record, an unshaped record, and
  a grantable record ends with: the stale record marked or closed per tier, the unshaped record
  `ready` (or `needs:definition`), the grantable record `auto:build`, one run dir, one
  `decisions.md`, no `AskUserQuestion` calls, and a close-out whose first block is the attention
  list and whose recommended line is `/claude-tweaks:dispatch`.
- A record mutated by tidy is seen in its new state by specify and refine in the same run
  (snapshot invalidation proven by a test that stubs the snapshot file).
- `evals/`: a permission-matrix scenario asserting `sweep` never invokes `/flow`, `/build`, or
  `/dispatch`.

---

## Phase order and dependencies

```
Phase 1 (marker)  ─┬─► Phase 2 (attention, refine #N)  ─► Phase 3 (grant → refine)  ─┐
                   └─► Phase 6 (tidy residue)                                          ├─► Phase 7 (sweep)
Phase 4 (specify drain)  ────────────────────────────────────────────────────────────┤
Phase 5 (dispatch drain) ─ independent; not a sweep dependency ───────────────────────┘
```

Phases 4 and 5 are independent of 1-3 and of each other. Phase 7 needs 3, 4, and 6.

## Open questions resolved during brainstorming (recorded so they are not re-litigated)

- Should tidy absorb priority/Related? No — the fold of `grant` into `refine` makes `refine`
  headless-safe, which was the only reason to move it.
- Should `needs:grant` be a separate label? No — `needs:*` prefix exclusion plus the comment
  carries the distinction.
- Should the residue container be a standing issue or the digest? Neither — the run dir is
  tracked; commit it.
- Should `sweep` be a `routine fleet run` verb? No — `/routine` provisions cloud state; the
  wrapper needs its own parent contract and owns neither policy vocabulary.
- Should `sweep` include the health finders or dispatch? No — audit cost and the
  self-authorization rule respectively.
