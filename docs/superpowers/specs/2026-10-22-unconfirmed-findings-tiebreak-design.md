# Design: settle unconfirmed review findings with an agent tiebreak

**Status:** design, approved in conversation (2026-10-22), pending written-doc approval.
**Next step:** `/claude-tweaks:specify` on this doc.
**Sibling project (not in scope):** run-directory cleanup (liveness signal, safe auto-close of dead runs, the tracked `work/{N}-spec.md` shells — #3855). Brainstormed separately, after this one.

## Intent

The maintainer should never have to judge a review finding that an agent could judge by reading the code. Today every finding only one agent reported, and every finding a cross-lens debate couldn't settle, gets staged as `keep-staged` in the Review Console. If nobody is present, which is the normal case for Routines and dispatched builds, it ends up in the SessionStart residue banner on every later session. The 2026-10-20 audit counted **323 such items across 126 runs**, acknowledged in bulk. Bulk acknowledgement is a cost paid with no benefit: in the run-#3642 example, the staged file already carries the writing agent's own verdict on almost every finding ("no behavior defect", "deliberate scope", "already ledger row 7, accepted").

**Target experience (maintainer's words, paraphrased):** a session start shows nothing on a normal day. When a session or run is done and wrapped up, the slate is clean, with nothing carried over. A finding reaches the human only when it needs human judgment, and then at the end of a run, not at the start of the next session.

**Guiding principle (agreed):** settle findings aggressively. A wrong drop is cheap here: these findings already got one reviewer's "no" out of two, they're mostly low severity, and later reviews and tests often catch a real bug. Run closing (the sibling project) is the opposite, conservative.

## Goals

1. Every `unconfirmed` and every debate-`contested` finding gets an independent agent tiebreak verdict before routing, at every review effort tier, in every mode (`auto`, `confirm`, `hybrid`, `interactive`), dispatched or not.
2. **Clean-slate rule:** a finished run leaves no `pending` or `keep-staged` item behind. Every staged item reaches a final outcome before archive. `keep-staged` is retired as a resolution for new runs.
3. What reaches the human is only "can't tell" findings of severity ≥ medium. They arrive at the run's own Review Console when a human is present. When no human is present, they become backlog records the human meets via `/claude-tweaks:backlog attention`.
4. Reflect `observation`/`convention` items get a real consumer, so they stop counting as residue merely because nothing processes them.
5. The existing backlog of unreviewed console items is settled once by the same tiebreak, so the maintainer starts from a clean slate.

## Non-goals

- Run-directory lifecycle, the stale-runs banner, or the `work/` shells (sibling project).
- Changing how reproduction pairs match (`categoriseReproduction`, thresholds, ±2/±5 bands).
- Changing confirmed-finding routing (`review/step3-routing.md`) beyond adding the tiebreak's confirmed findings as a new input.
- Retiring the SessionStart console-residue banner. It stays as the safety net: if it ever shows something for a run created after this ships, the clean-slate rule was broken, and that is a bug.

## Anti-goals (would be failure even if it "works")

- **A tiebreak that fails open.** A missing, malformed, timed-out, or evidence-free verdict must resolve to "can't tell", never to refuted or dropped (IL-50: `resolveRefutation` once resolved malformed verdicts to `confirmed`, and a new resolver must fail toward scrutiny).
- **Dropping on a claim without evidence.** A refutation must quote the live code that disproves the finding. A confirmation must quote the code that shows the defect (IL-144: a false "duplicated" premise acted on without a grep deleted real content).
- **Auto-applying a code fix on the strength of the tiebreak alone.** A confirmed finding enters normal Step 3 routing and gets exactly the treatment any pair-confirmed finding gets, no more (IL-142: single-agent findings have been wrong).
- **A new mid-flow stop in `auto` mode.** The tiebreak is policy-driven automation logged to `decisions.md`; only the existing bookend stops remain (`_shared/auto-mode-contract.md`'s strict rule).
- **Moving the nag instead of removing it.** Filing every can't-tell item as a backlog record, including low-severity ones, would just relocate the noise.

## Constraints

- **Expand-contract.** `console.json` is a shared contract, along with `keep-staged`, the Low-confidence/Contested section stances, and the residue scanner. Installed builds read it in this repo's archived runs **and in every consumer project's archives**. New runs stop producing `keep-staged`. Readers keep classifying a legacy `keep-staged` item as unresolved, permanently. Doing so reads old data correctly; it is not a compatibility shim. Removing it would make an un-backfilled consumer archive silently stop counting as residue, which is fail-open. So there is no reader-removal phase. *(Builder-check answer, my call.)*
- **Auto-mode contract floors** (`_shared/auto-mode-contract.md`, "Reversibility / confidence floors; severity ceiling"). This design amends the contract for exactly one decision, **dropping a finding the tiebreak refuted with quoted evidence**:
  - The drop counts as `Confidence: high`.
  - It is exempt from the findings severity ceiling, at every severity and in every mode (`auto`, `confirm`, `hybrid`, `interactive`). It is reversible because the evidence line is kept in `decisions.md`.
  - Refuted findings of `high`/`critical` severity are also listed in the run's Review Console as a read-only "Dropped by tiebreak" block (no click, no decision), so the human can spot a bad drop. `low`/`medium` drops are only logged. *(Maintainer decision.)*
  - The amendment does **not** loosen the severity ceiling for *applying* fixes.
- **Work-record creation is on auto's "never silenced" list.** Filing a can't-tell record with no human present must ride the existing `autonomy: unattended` `consoleAutoResolve` / queue-write capability (`_shared/autonomy-ceiling.md`), not a new bypass. A run below that ceiling with no human present has not "finished" until its console is resolved: it waits at the console, as today, and leaves no residue.
- **Subagent contract.** The tiebreak is a new dispatch site: minimal input, status line, a literal output template inlined in the prompt, and a model profile (`plugin/skills/_shared/subagent-output-contract.md`). It is a fan-out over findings, so `Frontier` is not allowed.
- **Dispatched reviewers can't nest dispatches (#3817).** The tiebreak must run where Task dispatch is possible. On `/dispatch`, the second Task call runs `review,polish,wrap-up` inside one agent (`dispatch/SKILL.md` Step 5), so that agent's console resolves before any outside caller could act. Whatever mechanism the builder picks, **the tiebreak's verdicts must be in place before that run's Review Console resolves**. A dispatched run's console must never see an un-tiebroken finding. Before choosing a mechanism, probe whether a dispatched agent can itself dispatch.
- **Cross-references.** New or changed skill edges go in `docs/skill-graph.md` only.

## Decided (by the maintainer, in conversation)

- Settle findings aggressively and close runs conservatively.
- An independent agent decides each unconfirmed finding: confirm, refute, or can't tell. Only can't-tell findings of severity ≥ medium reach the human.
- Findings reach the human at the end of a run, not at session start.
- Clean slate: a wrapped-up run carries nothing over.
- A human-present console gets an Approve-all default for these items, using the tiebreak's recommendation.
- No human present → can't-tell findings become backlog records.
- The existing pile is settled once by the tiebreak, not read by hand. **This includes consoles already bulk-acknowledged**, because that acknowledgement wasn't a review.
- A refuted finding is dropped at any severity. High and critical drops are also shown read-only in the run's console.
- Findings first; run cleanup is a separate, later project.

## Design

### Phase 1 — The tiebreak in `/review`

**Where:** a new step in `plugin/skills/review/`. It runs after all of these have run: reproduction categorisation, the absence-claim ground-truth check, the 3f vacuity downgrade, medium-tier cross-lens corroboration, the high+ cross-lens debate, and the xhigh/max Per-Candidate Refutation Pass and gap sweep.

Interaction with the xhigh/max passes *(my call)*:
- A finding the refutation agent refuted **with quoted evidence** counts as a tiebreak `refuted` verdict. It is dropped under the same rules and not re-tiebroken.
- A refutation that failed or carried no evidence leaves its finding `unconfirmed`, so the finding gets a tiebreak.
- Gap-sweep findings are single-source by design, so they get a tiebreak like any other `unconfirmed` finding.
- The refutation agent's output template gains the same evidence-quote requirement. Its input is whatever is still `unconfirmed` or `contested` after those passes. That includes same-location/different-substance pairs (`nearLocation`, #3815), each judged as its own finding. At `low` tier, where every finding is single-read and therefore `unconfirmed`, the tiebreak replaces the main reviewer's per-finding direct verification.

**Dispatch:** one tiebreak agent per finding, run in parallel, under the subagent contract. The model profile is `Capable` (my call: this agent's verdict is the last line before a drop, so it gets more capability than the `Fast`/`Standard` lens agents). Input:
- the finding's claim, severity, and cited `path:line`;
- the diff scope;
- for a contested finding, the two positions as stated;
- **not** the reporting agent's evidence chain or reasoning. My call: the tiebreak reads the code itself so its verdict counts as independent evidence, not an echo.

**Output** (a template defined in the prompt; the builder writes it):
- `Verdict: confirmed | refuted | cant-tell`
- `Evidence:` a verbatim quote of the live code at a stated `path:line`, required for `confirmed` and `refuted`.
- `Severity:` the tiebreak's own assessment.
- `Recommendation:` either `file` (open a backlog record) or `drop`, plus a one-line reason. This becomes the console default. *My call:* "fix" is not an option, because most of these items have no staged patch and the run is past its fix wave. A real fix lands through the filed record.
- the status line.

**Resolution rules** (deterministic; Node-side alongside `coordination.js`, the builder decides where exactly):
- `confirmed` with evidence → the finding becomes `confirmed` and enters Step 3 routing like a pair-confirmed finding. The severity is the lower of the reporter's and the tiebreak's. The log line reuses the existing `AUTO … Confirmed.` shape, so #3772's STAGED-then-AUTO suppression in `console/resolve.js` keeps working.
- `refuted` with evidence → dropped at any severity. One `AUTO` line in `decisions.md` carries the quoted evidence. `high`/`critical` drops also appear in the console's read-only "Dropped by tiebreak" block; otherwise there is no console row.
- **Severity used for the can't-tell threshold** *(my call, fail toward scrutiny)*: the higher of the reporter's and the tiebreak's severity. If the tiebreak gave none (a malformed reply), the reporter's applies. If neither is known, as with legacy items, `medium` applies.
- `cant-tell`, *or* any verdict without the required evidence, *or* a malformed reply, *or* a non-`DONE` status → can't-tell (fail toward scrutiny).
- Can't-tell with severity `low` → digest, via `_shared/materiality-floor.md`'s existing path, with a `Defer-reason:` stating that the tiebreak couldn't tell. No console row.
- Can't-tell with severity ≥ `medium` → staged for the Review Console as a decision item carrying the tiebreak's recommendation (Phase 2).

**The direct-verification override** (`step3-lens-dispatch.md`, "Direct-verification override") is superseded by the tiebreak as the path that settles a finding. The builder decides whether to retire it outright or keep it as an interactive-only shortcut, under expand-contract.

**Dispatched reviewers (#3817):** see the dispatch constraint above. The builder picks the mechanism; the invariant is fixed.

**Standalone `/review`** (no pipeline run dir) *(my call)*: it is interactive by nature. Verdict lines go to the run dir when one resolves, otherwise into the review report. Can't-tell findings of severity ≥ medium appear in the review's own closing output, with the tiebreak's recommendation, for the user to act on in that session. Nothing is staged, so nothing is left behind.

**Mechanized check** *(my call)*: the review writes its post-pass finding list to the run dir as a machine-readable artifact. That gives a denominator. A check at wrap-up/archive time then refuses to archive a run where some listed finding lacks a verdict line. Unit tests cover the check itself.

### Phase 2 — Review Console: no item outlives its run

- **Low-confidence and Contested sections** (`console/resolve.js` `SECTION_STANCES`, `wrap-up/console-template.md`, `wrap-up/review-console.md`). These now hold only can't-tell findings of severity ≥ medium, each with a recommendation. They gain an Approve-all default: the tiebreak's recommendation, whether that's fix, file as a record, or drop. The human overrides per row. `keep-staged` is no longer a resolution new runs produce.
- **No human present** (`consoleAutoResolve` at `autonomy: unattended`): each such item is filed as a backlog record through the existing queue-write path. The record carries the finding, the tiebreak's evidence and recommendation, and a decision label (the builder picks from the existing `needs:*` vocabulary; it must show in `/claude-tweaks:backlog attention`). The body is spec-shaped (Current State / Deliverables / Acceptance Criteria), per CLAUDE.md's no-implicit-deferrals rule. Records are deduplicated by finding fingerprint, so a re-run doesn't file twins.
- **Reflect `observation`/`convention` items** (`resolve.js`'s non-tangential reroute to Pending review, #2473). These get a consumer instead of `pending`. My call: route them into the existing Skill-updates curation section, which already has an Approve-all default and is where `/reflect` says most of them belong. The builder verifies that section's consumer can take a `reflect-*` file, or adds the consumer.
- **Every staged-item producer gets a final outcome** *(my call; the clean-slate rule requires it)*. The builder check counted the existing residue: 445 unresolved items in total. 191 are findings and 149 are reflect items. The other 105 are `pending` items with an `unmapped-prefix` reason (for example `premise-satisfied-*`, and a misspelled `wrap-up-docs-*`), plus `shadow-dup-*` items. Two changes follow, absorbing open #3488:
  - Every staged-id prefix a producer writes maps to a console section that has a final-outcome default.
  - `stage-item.js` refuses an unknown prefix (it currently warns), so a new producer can't silently create residue.
- **Archive guard:** a run whose `console.json` still holds an unresolved item does not archive. This already holds for pending staged items (#3668, #3370). The change is that, with `keep-staged` retired, the guard now covers every item.

### Phase 3 — Settle the existing pile once, then contract

- **A shipped `plugin/bin` CLI** *(my call: consumer projects have the same residue)*. It walks every closed or archived run whose `console.json` holds `pending`/`keep-staged` items, **including consoles already acknowledged** (maintainer decision; `scanUnresolvedConsoles` skips those, so the backfill needs its own walk). For each item it settles the item and then **rewrites that item's resolution in `console.json`** to its final outcome, with an audit line. Adding an acknowledgement stamp alone is not enough. When every item in a console is settled, the run is acknowledged.
- **How items are settled:**
  - Findings get the Phase 1 tiebreak against **current `main`**: the code has moved, so the question becomes "is this still a problem today?". Filing happens directly, since no console is present.
  - A legacy line bundling several findings is split into one tiebreak per finding.
  - A legacy item with no recoverable claim text (only `finding {path}:{line} not reproduced`) has nothing to judge. It goes to the digest with a `Defer-reason:` saying no claim was recorded, *(my call)* so it doesn't fall back to the nag.
  - Reflect items go through the Phase 2 reroute.
  - Other producers' items get their newly mapped Phase 2 outcome.
- **Scale:** the 2026-10-22 count is 445 items across 185 runs, of which 156 runs are acknowledged. The CLI must be resumable and idempotent: re-running it skips settled items, and it reports filed records, drops, and digest entries.
- The SessionStart console-residue banner stays, as the safety net described under Non-goals. Once the backfill has run, the banner shows nothing for this repo.

## Success criteria

- For every run created after Phase 2 ships, `decisions.md` holds exactly one tiebreak verdict line per finding that was `unconfirmed` or `contested` after the earlier passes. A test-enforced mechanism checks this, not prose alone.
- A finished run's `console.json` holds zero `pending`/`keep-staged` items.
- The SessionStart console-residue banner shows nothing for any run created after Phase 2 ships.
- After Phase 3, this repo's banner shows nothing, no `console.json` here holds a `pending`/`keep-staged` resolution, and the backfill's report lists every filed record, drop, and digest entry.
- `stage-item.js` refuses an unmapped prefix.
- Malformed, evidence-free, and non-`DONE` tiebreak replies are covered by tests that prove they resolve to can't-tell (each test shown red against a fail-open variant).

## Left to the builder

- The exact step placement and file layout inside `plugin/skills/review/`, and where the resolution code lives in `plugin/bin/lib/`.
- The tiebreak output template's precise fields and wording.
- Retire versus keep-as-shortcut for the direct-verification override.
- The dispatched-reviewer mechanism (#3817), within the invariant stated under Constraints.
- The backlog record's label and dedup fingerprint, reusing existing vocabulary and fingerprint helpers.
- Which console section each currently unmapped prefix maps to.
- How to split the phases into records at `/claude-tweaks:specify` time.

## Related open issues

#3488 (map or exempt every staged-id producer, absorbed by Phase 2), #3815 (near-location lines dropped by the console regex, which the tiebreak absorbs), #3816 (coordination item-id collisions, which affect any per-item verdict keyed on those ids), #3788 (residue banner versus the never-run rule), #3817 (dispatched reviewer at medium and above), #3206 (cross-lens convergence below high, likely stale since #3604), #1426 (digest).
