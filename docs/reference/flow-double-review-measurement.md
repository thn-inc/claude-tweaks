# /flow's double whole-branch review — measurement and decision (#3381)

`/flow` reviews each branch twice. Inside `/build`, SDD runs a final whole-branch review on the
Capable tier, then a fix wave and a scoped re-review. After that, `/claude-tweaks:review`'s lens
fan-out runs on the same diff. This file measures what SDD's final stage costs and whether `/review`
finds the same Important and Critical defects. It then applies #3381's pre-decided rule to choose one
of three outcomes.

**Decision: Outcome 3. Keep both reviews unchanged.** The pooled cost share is 18.8%, which exceeds
15%. The pooled overlap is 0 of 4, or 0%. Even under the looser reading below, which ignores severity,
it is 1 of 4 (25%). Both readings are under half. The rule makes a high cost share with low overlap
Outcome 3 on purpose: the two reviews catch different defects.

This file is maintainer-side: `docs/` is not part of the plugin payload and does not ship
(`docs/decisions/0015-plugin-payload-boundary-is-the-plugin-subtree.md`).

## Qualifying runs

A run qualifies when all of the following hold:

- It is a `/flow` run on this machine and repository.
- Its plan has two or more tasks per `node plugin/bin/plan-audit.js {plan} --count-tasks`, run on the
  plan file as committed at SDD's reviewed commit.
- Its `config.yml` says `ceremony-profile: standard`.
- It was made after #3386 merged (2026-10-17), so its run directory holds `sdd-final-review.md`. It
  was also made after the plan-review record (#3377, merged 2026-10-20) and the per-task-tier record
  (#3378, merged 2026-10-21). All seven runs below are later than all three merges.
- Its run directory holds both `sdd-final-review.md` (#3386) and a `timing.json` with a `dispatches`
  block (#3375). A run missing either does not qualify. No finding was reconstructed from memory or
  narration.

**Selection.** The candidates were every run directory under `.claude-tweaks/pipelines/` (live and
`archive/`) that holds an `sdd-final-review.md`: 600 of them on 2026-11-25. I walked them newest
first. I stopped at the first point where at least three runs qualified **and** the pooled SDD
Important/Critical count reached the rule's minimum of 4. Before that point the count was too low to
decide; stopping later would only have added runs. The stopping rule depends on SDD's findings alone,
never on `/review`'s, so it cannot steer the overlap. Three runs were skipped on the way:

| Run | Why it did not qualify |
|---|---|
| `2026-11-25T091622-record-5463` (`spec-5463`) | `ceremony-profile: fast-lane` |
| `2026-11-25T090555-record-6102` | no `timing.json` (the run had not reached wrap-up when measured) |
| `2026-11-25T075109-record-4747` | `ceremony-profile: fast-lane` |

| # | Run directory | Record | Plan tasks | Reviewed commit (SDD) | Package base |
|---|---|---|---|---|---|
| 1 | `archive/2026-11-25T084251-record-5148` | #5148 | 3 | `918142bde78f4a9facccc87d06259c16acffa0bc` | `913ed4018b13f835b7b71ae429e5d4462cd80ac2` |
| 2 | `archive/2026-11-25T080509-record-6222` | #6222 | 2 | `c49fe6bc90042eb950954d9dafa1c25644860416` | `0614127246b31aac43d47cb42cea3365c456a58e` |
| 3 | `archive/2026-11-25T075757-record-5800` | #5800 | 3 | `a81626337ea540982e4d161d8f41fa948e3889d6` | `d8e2f614190be4a3714e21211bbd33bce71cc8c7` |
| 4 | `2026-11-25T074831-record-4118` | #4118 | 4 | `e2e813f98b1ff7153616029ee0f654fe3fd98331` | `d8e2f614190be4a3714e21211bbd33bce71cc8c7` |
| 5 | `archive/2026-11-25T074303-record-5075` | #5075 | 2 | `464988f66b3a8b2ab6d5f6835e5129a39fc06a2e` | `68608178fa207fe6226f8463be69169c42115801` |
| 6 | `archive/2026-11-25T073550-record-5668` | #5668 | 3 | `d56be5bbf2c6e01d65b7a311cf709f4d3a08cc44` | `3ecfb9509c852c68a95fd5e782dae2bfc0cbd624` |
| 7 | `archive/2026-11-24T144947-record-6152` | #6152 | 5 | `fdd52ed2a5730a3adfcc464f36165560d295d989` | `c6f7915151a818b6e2da31342c1af57fd6f99988` |

Each run is a dispatched two-call run: a `build,test` Task call, then a `review,polish,wrap-up` Task
call. The plan-review and per-task-tier records had both merged before every run, so their effect is
already in these numbers. The plan review in particular should already have removed some spec-level
findings from SDD's final review.

## Measurement basis

**Cost.** All cost numbers come from each run's `timing.json` `dispatches.items`, the per-dispatch
telemetry `phase-timing.js` writes (#3375). Tokens are counted, not priced.

- **Build-phase agent-seconds.** The sum of `wallClockMs` over every direct child dispatch of the
  run's `build,test` Task call. That is the dispatches whose `parentAgentId` is that call's
  `agentId`: the plan review, the implementers, the task reviews and re-reviews, SDD's final stage,
  and `/build`'s simplify dispatch. The Task call's own span is excluded, because it is the
  orchestrator that contains its children's time. Dispatches by other sessions in the same window are
  excluded too; one example is run 6's unrelated `Close out and merge PR 6276`. Overlapping
  dispatches count in full: `agent-seconds sum spans with overlap kept`, the same convention
  `phase-timing.js --markdown` prints.
- **SDD's final stage.** The child dispatches from the start of the whole-branch review to the last
  SDD dispatch, selected by start timestamp. The last SDD dispatch is the last one before `/build`
  Common Step 3's `Simplify …` dispatch. The `whole-branch review` role marks only where the window
  starts; the fix wave has no role of its own (`unlabelled`). Every run's window holds exactly the
  final review, the fix wave and the scoped re-review(s). The main-thread controller's own time in
  those minutes is not a dispatch, so it is in neither the numerator nor the denominator.
- **Token shares.** The same two sets of dispatches, measured in output tokens and in total tokens
  (input + output + cache read + cache create).

**Findings.** SDD's Important and Critical findings come verbatim from each run's
`sdd-final-review.md`. `/review`'s findings come from re-running `/review`'s code-mode Step 3 against
SDD's reviewed commit:

- **The comparison basis for defects SDD's fix wave fixed.** `/review` judged the same pre-fix-wave
  state SDD judged: a scratch clone checked out detached at the reviewed commit, diffed against
  SDD's package base. So any defect SDD's fix wave later fixed was still in the code for `/review` to
  find. Nothing SDD found is lost to the comparison because it had already been fixed. The runs'
  own production `/review` passes ran after the fix wave, so they could not serve as this basis.
- **Procedure version.** The installed plugin build, 6.179.0, was used, not the build each run
  shipped with. The question is whether today's `/review` can replace SDD's final review.
- **Policy.** `review-lens-selection: tier`, `review-lens-dispatch: task`, and no `review-effort`
  override. These are the project's resolved values.
- **Tier and lenses.** The `review-effort` tier was derived per `review-effort-derivation.md` from
  the record's labels and the diff heuristic. Every lens that tier allows was dispatched as a
  reproduction pair. Lens 3h was skipped in all seven runs, because no QA data exists. Each finding
  then went through `categorise-reproduction` (standalone form), the absence-claim ground-truth
  check, and Step 3.7's tiebreak, and ended with `/review`'s own final disposition and severity.
- **Not run.** Steps 3.5 (debate) and 3.6 (gap sweep) were not run. The record compares the findings
  `/review`'s lenses produce, so these numbers are a lens-only reading. A gap sweep can add findings
  that no lens reported, so the full `/review` could find somewhat more than measured here.
- **Independence.** The re-run agents never saw SDD's review, any PR comment, or any decisions log.
  One agent per run orchestrated the lens fan-out under the installed `step3-lens-dispatch.md`. Its
  report is the source of each `/review` finding below.

**Severity mapping and overlap.** SDD "Important" maps to `/review` `high`, and SDD "Critical" maps to
`critical`. A finding overlaps when it is the same defect, meaning fixing one fixes the other. Each
SDD finding was judged against `/review`'s full finding list, all severities, and every judgment is
recorded below so a reader can re-check it. Two readings are reported:

- **Severity-mapped (the rule's reading).** An SDD Important/Critical finding overlaps only when
  `/review` reported the same defect at `high` or `critical`.
- **Defect-only (looser).** An SDD Important/Critical finding overlaps when `/review` reported the
  same defect at any severity.

## Per-run results

### Cost

| # | Record | Build dispatches | Build agent-s | Final-stage agent-s | Share (agent-s) | Share (output tokens) | Share (total tokens) |
|---|---|---|---|---|---|---|---|
| 1 | #5148 | 12 | 1642 | 378 | 23.0% | 25.8% | 29.9% |
| 2 | #6222 | 9 | 1275 | 483 | 37.9% | 31.0% | 35.5% |
| 3 | #5800 | 13 | 2398 | 353 | 14.7% | 19.2% | 17.7% |
| 4 | #4118 | 16 | 3459 | 814 | 23.5% | 25.5% | 29.8% |
| 5 | #5075 | 12 | 2579 | 356 | 13.8% | 22.8% | 20.1% |
| 6 | #5668 | 14 | 3205 | 481 | 15.0% | 30.5% | 28.6% |
| 7 | #6152 | 17 | 2632 | 368 | 14.0% | 19.7% | 17.5% |
| | **Pooled** | 93 | **17190** | **3233** | **18.8%** | 25.1% | 25.4% |

These are the final-stage dispatches each run counted, in its own descriptions:

| # | Final-stage dispatches |
|---|---|
| 1 | `Final whole-branch review #5148`, `Final-review fix wave #5148`, `Re-review final fix wave` |
| 2 | `Whole-branch review for record 6222`, `Fix wave: final review minors`, `Re-review final fix wave` |
| 3 | `Whole-branch review of record 5800`, `Fix wave: verify.js help text`, `Re-review final fix wave` |
| 4 | `Final whole-branch review #4118`, `Final-review fix wave #4118`, `Re-review final fix wave #4118`, `Re-review residual fix #4118` |
| 5 | `Final whole-branch review 5075`, `Fix wave for final review 5075`, `Re-review final-review fix wave` |
| 6 | `Final whole-branch review`, `Fix wave for final review findings`, `Re-review final fix wave` |
| 7 | `Final whole-branch review #6152`, `Fix wave for final review findings`, `Re-review final-review fix wave` |

Runs 2 and 6 show the cost does not depend on findings. Run 2's final review found no Important
finding, only five Minor ones, yet its fix wave and re-review took 316 of the 483 agent-seconds.

### Findings

`/review` counts are final, after its own pairing and tiebreak, and exclude dropped findings. Info
findings are not counted.

| # | Record | `/review` tier | SDD Critical | SDD Important | `/review` critical | `/review` high | `/review` medium | `/review` low |
|---|---|---|---|---|---|---|---|---|
| 1 | #5148 | high | 0 | 0 | 0 | 0 | 5 | 8 |
| 2 | #6222 | max | 0 | 0 | 0 | 0 | 2 | 7 |
| 3 | #5800 | high | 0 | 1 | 0 | 0 | 0 | 2 |
| 4 | #4118 | high | 0 | 1 | 0 | 0 | 0 | 12 |
| 5 | #5075 | high | 0 | 1 | 0 | 0 | 2 | 10 |
| 6 | #5668 | high | 0 | 0 | 0 | 0 | 0 | 11 |
| 7 | #6152 | high | 0 | 1 | 0 | 0 | 2 | 1 |
| | **Pooled** | | **0** | **4** | **0** | **0** | 11 | 51 |

`/review` reported no `high` or `critical` finding in any of the seven runs.

### Overlap, per SDD Important/Critical finding

| Run | SDD finding (verbatim summary) | Closest `/review` finding | Same defect? | Severity-mapped | Defect-only |
|---|---|---|---|---|---|
| 3 (#5800) | Important 1: `plugin/bin/lib/verify/args.js:35`: the `--help`/USAGE text and the `EXIT_NO_VERDICT` comment still say a `--scope` run exits 3 only under `localRuns: "on-request"`, but `head-not-pushed` now exits 3 under any declaration | None on `args.js` or the USAGE text. `/review`'s four findings were about `verify.js:1007`'s duplicated stop rule, unsanitized fallback text, colliding AC labels, and a `tree-state-unreadable` coverage gap. | No | no | no |
| 4 (#4118) | Important 1: `plugin/skills/capture/SKILL.md:358`: the payload example always includes the `ceremony` key, and `recordPayload({ceremony: null})` throws, so the no-verdict path could block the filing | `capture/SKILL.md:343` (3b, low, unconfirmed): the `ceremony:*` label is trust-relevant, and the prose never says a verdict may only lower ceremony | No. That finding is about who can set a label; SDD's is about a `null` key that throws. Fixing either leaves the other. | no | no |
| 5 (#5075) | Important 1: no committed test pins chaining, which is what the Decision chose Reading B for; narrowing `scopedPassBase` to `scope === 'scoped'` would keep the suite green | `plugin/bin/lib/verify/changed-files.js:63` (3f, **medium**, tiebreak-upheld): chaining (Reading B: a `none` stamp anchors the next bookkeeping-only shortcut) has no test; a regression that rejects `none` anchors would pass | **Yes.** One test that anchors on a `none` stamp fixes both. | no (`medium`, not `high`) | **yes** |
| 7 (#6152) | Important 1: `docs/reference/station-events.md:147`: the Outcomes section reads as if the file never holds retired values, but older lines do; readers must be told the legacy mapping | `docs/journeys/read-a-records-station-events-from-the-main-checkout-5902.md:65`/`:79` (3a, medium, tiebreak-upheld): the journey still says retired outcomes stay accepted until #6152 | No. Both concern retired outcomes, but SDD's is a missing reader note in the reference doc, while `/review`'s is a stale claim in a journey file. Fixing either file leaves the other wrong. | no | no |

Runs 1 (#5148), 2 (#6222) and 6 (#5668) had no SDD Important/Critical finding. They stay in the cost
totals and are excluded from the overlap fraction.

| Run | Severity-mapped overlap | Defect-only overlap |
|---|---|---|
| 3 (#5800) | 0/1 | 0/1 |
| 4 (#4118) | 0/1 | 0/1 |
| 5 (#5075) | 0/1 | 1/1 |
| 7 (#6152) | 0/1 | 0/1 |
| **Pooled** | **0/4 = 0%** | **1/4 = 25%** |

## Decision

The rule from #3381, applied to the pooled numbers:

| Input | Value | Test |
|---|---|---|
| Qualifying runs | 7 | at least 3: met |
| Pooled SDD Important/Critical | 4 | at least 4: met, so the data is sufficient |
| Pooled cost share (agent-seconds) | 3233 / 17190 = **18.8%** | over 15%: yes |
| Pooled overlap (severity-mapped) | 0 / 4 = **0%** | at least half: no |
| Pooled overlap (defect-only) | 1 / 4 = 25% | at least half: no |

- Outcome 1 needs a cost share over 15% **and** an overlap of at least half. The cost condition is
  met; the overlap condition is not.
- Outcome 2 needs an overlap of at least half. That is not met.
- **Outcome 3 applies: keep both reviews unchanged.** The data is not the limit here; it is
  sufficient. SDD's final stage costs about a fifth of the build's dispatched agent time, but
  `/review` independently found none of SDD's four Important findings at a matching severity, and
  only one at any severity. Removing SDD's final review under `/flow` would have shipped three of
  those four defects past `/review`. The share in output and total tokens is about a quarter (25.1%
  and 25.4%). That makes the cost condition stronger, not the overlap, and does not change the
  outcome.

Per Outcome 3, nothing else changes: no skill text, no `_shared/ceremony-profile.md` roster row, and
no `plugin/skills/build/dispatch.md` text.

## Observations outside the rule

These do not change the outcome. They are recorded because they bear on any later revisit.

- **In production, `/review` was weaker than this measurement.** In `timing.json`, only run 6 (#5668)
  shows `lens reviewer` dispatches in its second call: 3a, 3b, 3c and 3f, paired, at its derived
  `medium` tier. Run 2's own `/review` logged `single-read coverage by the reviewing agent, no lens
  subagents` (its `decisions.md`). So the full lens fan-out measured here is an upper bound on what
  these runs' production `/review` passes covered.
- **The two reviews catch different kinds of defect.** SDD's four Important findings were a stale
  public help text, a payload example that throws on a `null` key, a missing chaining test, and a
  missing legacy-reader note in a contract doc. All four are cross-file or spec-level judgments about
  the whole branch. `/review`'s per-lens checklists produced more findings in total, but they were
  medium and low local findings: duplicated rules, missing comments, coverage gaps, stale journeys.
- **How to re-measure.** Repeat with the same rule once SDD's final-review prompt, `/review`'s lens
  set, or the review-effort derivation changes materially. Re-running `/review` at a reviewed commit
  needs that commit's objects to still exist: run 7's reviewed commit had to be fetched into the
  scratch clone explicitly, because no ref reached it.
