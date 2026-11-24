### Strengths
- The CLI change is small and placed where the record's Technical Approach asks for it (`plugin/bin/lib/express/cli.js:478-480`). `selectReviewSamples` still computes ordinals over the full merged set, so they never shift. The `--pr` filter runs on the due set before the `SAMPLES_MAX_REVIEWS` cap loop, so older due PRs cannot crowd out the one just merged. The reviewed-marker drop inside the loop is unchanged.
- `found` is added only when `--pr` is passed (`cli.js:490`), so the output of a plain `samples` run is unchanged. The new test checks this directly (`!('found' in h.json())`).
- `--pr` goes through the same `positiveInt` validation as `--every`, and `USAGE`, `VERB_FLAGS` and the `--help` test were all updated together.
- `express-lane.md`'s Post-merge sampling was rewritten cleanly. It names both paths and the `found: false` / non-zero exit / incomplete-review fallback, and it explains why a later drain still covers the PR (the marker is posted only when a review completes). The old drain-only sentence and its pin were removed, not left beside the new text.
- The new prose pins in `tests/dispatch-express-routing-prose.test.js` use `assertEachFactGoesRed`, so they can be shown to fail.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **`plugin/skills/flow/express-entry.md:25` — `/flow` cannot reach the review call it points to.** `express-prompt.md` lives in `plugin/skills/dispatch/`, but `/flow` names it as a bare filename. Elsewhere in this repo a bare filename means "in this skill's directory", so a `/flow` agent will look in `flow/` and not find it. The review call itself is also bound to dispatch context. Its preamble (`dispatch/express-prompt.md:78`) says "Dispatched from this session at Step 3's loop termination". It requires `{context-pack}` from `task-prompt.md`, another dispatch-directory file. It also makes the caller run the step-2 mint, the `mergeSha: null` case and close-run. Without that context, the `/flow` path will either fail to find the template or improvise the mint, context-pack and close-run steps.
   - Fix: write the reference as `dispatch/express-prompt.md`.
   - Update that template's preamble to name its two new callers: `/flow`'s express-entry and dispatch Step 5.
   - Say how `/flow` fills `{context-pack}` and `{minted-run-dir}`, and that `/flow` owns the mint and the close-run.
2. **`plugin/skills/dispatch/SKILL.md:250` — the new sentence also runs during a bare drain, not just the explicit form.** The Express lane paragraph is part of Step 5, which every group goes through, bare drain included. The record asks for the check only on the explicit `#N` / `#N,#M` path, and `express-lane.md` itself says the drain sweeps and an explicit dispatch checks its own PR. As written, a bare drain:
   - reviews each sampled express merge inline, in the middle of the drain;
   - then runs the end-of-drain sweep;
   - and on failure reports a PR as "left to the next drain's sweep" when this drain's own end sweep is about to cover it.

   Double reviews are prevented by the marker, so the cost is mostly mid-drain latency and a misleading report line. Fix: scope the sentence to the explicit forms ("In the `#N` / `#N,#M` forms, after a `merged` outcome…"), or state on purpose that drains do this too, and fix the wording for that case.
3. **`plugin/skills/flow/express-entry.md:25-34` — the order of the note and the sampling step contradicts itself.** The bullet first says to render the note and end the run. It then says to run sampling "before the run ends" and to name a failed PR "in the note". If the note is already rendered, the PR cannot be named in it, and the note template (lines 28-34) has no line for it. The record's Gotchas say the sampling comes after the outcome note. Fix: put the steps in order (note, then the `merged` sampling check, then end), and add an optional line to the template, such as `{merged, not reviewed: PR #{pr} left to the next drain's sweep}`. Alternatively, say the fallback line comes after the note.
4. **`tests/bin-lib/express/cli.test.js:724-746` — acceptance criterion 1 is not actually tested.** The criterion says #12 is selected "even when 3 older sampled PRs are also due". The fixture has only two due PRs (105 and 110), and the "hit" case asks for 105, the oldest. That passes whether the filter runs before or after the cap. For example, a version that took the first 3 due PRs and only then filtered to `--pr` would still pass. Fix: add a case with at least 4 due PRs (for example, extend `merges()` to 20 merges with `--every 5`, or use `--every 1`) where `--pr` names the newest, and assert it is returned and `capped` is false.
5. **`docs/skill-graph.md` — the new cross-skill edges are missing.** CLAUDE.md says every relationship between skills is stated once, in `docs/skill-graph.md`. This change adds two edges that are not recorded:
   - `/flow`'s express-entry now runs `dispatch/express-prompt.md`'s review call and `_shared/express-lane.md`'s Post-merge sampling from step 2. Row 395 still says "any other outcome renders the … note and ends the run".
   - Dispatch Step 5 now runs the sample review call. Rows 309 and 319 still say only "Step 3's loop termination runs the Post-merge sampling section".

   Fix: update those rows.

#### Minor (Nice to Have)
1. **`docs/plugin-structure.md:237` — stale description.** It still says the post-merge sample review call is the one "Step 3's loop termination dispatches". Add the foreground own-PR callers.
2. **Short command form.** `plugin/skills/flow/express-entry.md:25` and `plugin/skills/dispatch/SKILL.md:250` write `express-lane.js samples --pr {pr}` without the `node "${CLAUDE_PLUGIN_ROOT}/bin/"` prefix. `express-lane.md`'s step 1 uses the full form. The same paragraph in dispatch already uses the short form for `verify`, but `/flow` has no nearby full form to copy, so the full form would be clearer there.
3. **`plugin/skills/_shared/express-lane.md:51` — `mergeSha: null` is not covered on the foreground path.** Step 2 says to "name the PR in the sweep's reply and move on". The new fallback list does not include this case, so it is unclear whether the foreground session reports it as "left to the next drain's sweep". A later drain would hit the same null, so a separate wording such as "no merge sha" would be more accurate.
4. **`tests/express-lane-prose.test.js:85` — the pin covers only one of the three fallback cases.** It is named "found:false, non-zero exit and incomplete review…", but its regex is `On \`found: false\`[^\n]*"left to the next drain's sweep"`. Dropping "a non-zero exit" or "a review that does not complete" from the prose would still pass. Acceptance criterion 6 asks for all three cases to be pinned. The same applies to the flow and dispatch pins, which match the literal phrase including all three, so those are fine. Only the `express-lane.md` pin is loose.

**Declined to judge:**
- Whether `npm test` passes. I was told not to run the suite, so I did not verify it.
- Rebasing over #4364's edits to the same Post-merge sampling section. That depends on merge order, which is outside this diff.
- The redundant "only when `express-lane` resolves `true`" condition in `/flow`'s express path, which `/flow` Step 2.9 already guarantees. The record asks for it explicitly, so it is not a defect.

### Recommendations
- Treat `dispatch/express-prompt.md`'s sample review call as a template with several callers. One sentence on who mints the run dir, who fills `{context-pack}` and who runs close-run, written for each caller, would keep the `/flow` and dispatch paths from drifting.
- Add a prose pin that the `/flow` reference resolves to the dispatch directory. A bare filename here would fail only when an agent runs the step.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The CLI change is correct and matches the record's design. The prose wiring has gaps:
- `/flow` points to a review template in another skill's directory that it cannot find and has no instructions for filling.
- The dispatch sentence also applies to bare drains.
- The `/flow` note and the sampling step contradict each other on order.
- The one acceptance criterion about filtering before the cap is not tested in a way that could fail.

DONE_WITH_CONCERNS
