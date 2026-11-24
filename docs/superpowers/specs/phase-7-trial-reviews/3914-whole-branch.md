### Strengths
- The change follows the record's ruling exactly. There is one `ROUTINE_DEFAULT_MODEL` constant (`tests/routine-template-schema.test.js:16`) and a `MODEL_OVERRIDES` map (`:17`, empty today). The non-empty check is replaced by an equality assertion against the default or against the template's own override (`:99-106`).
- The failure message names the template file and its actual value. That meets the record's gotcha that the next migration author must see which file was missed. Acceptance criterion 1 is met: a single drifted template fails its own per-template test, `${skillName}/routine-template.yml conforms to schema`, and the message names it.
- The stale-override test (`:139-146`) covers both stale cases the record names: an unknown template and a model equal to the default. It also requires a non-empty `reason`, a sensible addition. It builds the known-template set with the same `findTemplates()` the per-template loop uses, so the two cannot disagree about which templates exist.
- The doc row (`plugin/skills/_shared/routine-template-schema.md:20`) states all three parts of the rule: a shared default, a declared override with a reason, and a migration that updates every template in the same change. The row sits in the field table, outside the kernel block (lines 35-85), so no `kernel_version` bump is owed.
- All nine shipped templates already use `claude-sonnet-5-5`, so the tightened assertion passes today with no template edits and no `template_version` bumps. This matches the record's "no schema or parser change" approach, and live routine records are unaffected.
- The diff is small, with no unrelated changes.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
None

#### Minor (Nice to Have)
1. `tests/routine-template-schema.test.js:105`: the failure message is misleading when a template has an override entry but its model differs from that entry. The message always reads "but the shared default is '<default>' … or the template must declare a MODEL_OVERRIDES entry". For a template that already declares an override, both halves point the author the wrong way, because the expected value is the override's model. Fix: branch the message on whether an override exists, e.g. "model is 'X' but its MODEL_OVERRIDES entry declares 'Y'". This is the only failure path where the message steers the reader wrong.
2. `tests/routine-template-schema.test.js:99` and `:140-145`: the override lookup and the entry check are looser than they could be.
   - `MODEL_OVERRIDES[skillName]` is a plain-object lookup, so it would pick up inherited prototype keys. A skill named `constructor` or `toString` is unlikely, but `Object.hasOwn(MODEL_OVERRIDES, skillName)` is the precise form.
   - The stale-override test never checks that `entry.model` is a non-empty string. An entry such as `{ reason: 'x' }` passes `notEqual`, and the per-template test then fails comparing against `undefined`, with a message that does not mention the missing model.
   - Fix: add `assert.equal(typeof entry.model, 'string')` with a message naming the entry.
3. `tests/routine-template-schema.test.js:139-146`: with `MODEL_OVERRIDES = {}`, the stale-override test passes without running a single assertion. Acceptance criteria 2 and 3 (a matching override passes, a stale override fails) can only be confirmed by editing the constant by hand; no test shows either. The checker is short enough to verify by reading, so this is low risk. The fix is to pull the override check into a small function that takes the map as an argument, and test it against a stale fixture and a matching fixture.
4. `plugin/skills/_shared/routine-template-schema.md:20`: the shipped schema doc now points at `tests/routine-template-schema.test.js`, which is maintainer-side and not part of the `plugin/` payload (ADR 0015). The record asked for the rule in this row, and the rule's wording reads fine without the file. But an installed user who follows the pointer finds nothing. Consider wording it as "the plugin's schema test (`tests/…`, maintainer-side)" or similar.
5. Commit subject `test: Require shipped routine templates …` uses a conventional-commit prefix. CLAUDE.md asks hand-written feature-branch commits to use `{Verb} {what} — {detail}`. If the driver composed this subject, it is not an issue.

Declined to judge:
- Whether `release` (or any other template) should actually get a heavier model today: the record leaves `MODEL_OVERRIDES` empty on purpose.
- Running `npm test`: the review instructions forbid running the suite. I judged from code that all nine templates match the default, but acceptance criterion 5 has not been checked by running anything.

### Recommendations
- Make the failure message depend on whether an override exists (Minor 1). This is the only change that affects the stated goal, a clear signal to the next migration author.
- Optionally, extract the override validation into a function that takes the map as an argument, so the "stale entry fails" and "matching entry passes" behavior is proven by a test rather than only by reading the code.

### Assessment

**Ready to merge?** Yes

**Reasoning:** The implementation matches the record's ruling and deliverables exactly. A half-finished model migration now fails and names the template that was missed. Stale overrides are rejected, and the doc row states the rule. The remaining items are wording and hardening nits that do not affect correctness.

DONE
