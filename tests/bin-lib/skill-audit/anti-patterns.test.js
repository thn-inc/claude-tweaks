'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  extractAntiPatternRows,
  bodyOutsideSection,
  rowIdentifiers,
  compareTables,
} = require('../../../plugin/bin/lib/skill-audit/anti-patterns.js');
const { listSkillDirs, KNOWN_SKILLS } = require('../../../plugin/bin/lib/skill-audit/skill-catalog.js');

const SAMPLE = [
  '# Some skill',
  '',
  '## Anti-Patterns',
  '',
  '| Pattern | Why It Fails |',
  '|---------|-------------|',
  '| Skipping the test gate | `TEST_PASSED=true` is the contract `/review` reads |',
  '| Bulk-resolving items | Each needs a per-item decision |',
  '',
  '## Relationship to Other Skills',
  '',
  '| Skill | Relationship |',
].join('\n');

test('extracts rows, skipping the header and rule rows', () => {
  const rows = extractAntiPatternRows(SAMPLE);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].pattern, 'Skipping the test gate');
  assert.strictEqual(rows[1].why, 'Each needs a per-item decision');
});

test('stops at the next ## heading', () => {
  const rows = extractAntiPatternRows(SAMPLE);
  assert.ok(rows.every((r) => !r.pattern.startsWith('Skill')));
});

test('runs to end of file when no heading follows', () => {
  const noTail = SAMPLE.split('\n## Relationship')[0];
  assert.strictEqual(extractAntiPatternRows(noTail).length, 2);
});

test('returns empty for a file with no Anti-Patterns section', () => {
  assert.deepStrictEqual(extractAntiPatternRows('# Nothing here\n\ntext'), []);
});

test('bodyOutsideSection removes the section', () => {
  const body = bodyOutsideSection(SAMPLE);
  assert.ok(!body.includes('Skipping the test gate'));
  assert.ok(body.includes('## Relationship to Other Skills'));
});

test('splitCells handles an escaped pipe inside a cell', () => {
  const md = [
    '## Anti-Patterns',
    '| Pattern | Why It Fails |',
    '|---|---|',
    '| Using `a \\| b` syntax | Breaks the table |',
  ].join('\n');
  const rows = extractAntiPatternRows(md);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].pattern, 'Using `a | b` syntax');
  assert.strictEqual(rows[0].why, 'Breaks the table');
});

test('rowIdentifiers picks up backticked anchors from both cells', () => {
  const rows = extractAntiPatternRows(SAMPLE);
  const ids = rowIdentifiers(rows[0]);
  assert.ok(ids.has('TEST_PASSED=true'));
  assert.ok(ids.has('/review'));
});

// ── The guard itself. Each of these must FAIL on the damage it describes, or it
// is not a check (IL-78). Every case below is the "damaged" direction.

test('compareTables reports a clean compression as lossless', () => {
  const before = extractAntiPatternRows(SAMPLE);
  const compressed = SAMPLE.replace(
    '| Skipping the test gate | `TEST_PASSED=true` is the contract `/review` reads |',
    '| Skipping the test gate | `TEST_PASSED=true` is what `/review` reads |',
  );
  const result = compareTables(before, extractAntiPatternRows(compressed));
  assert.strictEqual(result.evicted, 0);
  assert.deepStrictEqual(result.lostIdentifiers, []);
});

test('compareTables CATCHES an evicted row', () => {
  const before = extractAntiPatternRows(SAMPLE);
  const gutted = SAMPLE.replace(
    '| Bulk-resolving items | Each needs a per-item decision |\n',
    '',
  );
  const result = compareTables(before, extractAntiPatternRows(gutted));
  assert.strictEqual(result.countBefore, 2);
  assert.strictEqual(result.countAfter, 1);
  assert.strictEqual(result.evicted, 1, 'an evicted row must be reported');
});

test('compareTables CATCHES a dropped identifier inside a surviving row', () => {
  const before = extractAntiPatternRows(SAMPLE);
  // The row survives and still reads plausibly — but no longer names the
  // contract it governs. This is the failure a per-row reviewer waves through.
  const vague = SAMPLE.replace(
    '| Skipping the test gate | `TEST_PASSED=true` is the contract `/review` reads |',
    '| Skipping the test gate | The gate exists for a reason |',
  );
  const result = compareTables(before, extractAntiPatternRows(vague));
  assert.strictEqual(result.evicted, 0, 'row count is unchanged — count alone would pass');
  const lost = result.lostIdentifiers.map((l) => l.identifier).sort();
  assert.deepStrictEqual(lost, ['/review', 'TEST_PASSED=true']);
});

test('every shipped skill has a parseable Anti-Patterns table', () => {
  const skillsDir = path.join(__dirname, '..', '..', '..', 'plugin', 'skills');
  // listSkillDirs resolves `skills/` directly beneath the root it is given —
  // that root is the plugin payload root (`plugin/`), not the repo root.
  const pluginRoot = path.join(__dirname, '..', '..', '..', 'plugin');
  const names = listSkillDirs(pluginRoot);
  // Directory-derived, not a hard-coded `33` -- see skill-catalog.js.
  assert.ok(names.length >= 30, `expected the whole skill corpus, found ${names.length}`);
  for (const known of KNOWN_SKILLS) {
    assert.ok(names.includes(known), `corpus is missing a known skill: ${known}`);
  }

  let total = 0;
  for (const name of names) {
    const md = fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
    const rows = extractAntiPatternRows(md);
    assert.ok(rows.length > 0, `${name}/SKILL.md has no Anti-Pattern rows`);
    for (const row of rows) {
      assert.ok(row.pattern.length > 0, `${name}:${row.line} has an empty Pattern cell`);
      assert.ok(row.why.length > 0, `${name}:${row.line} has an empty Why cell`);
    }
    total += rows.length;
  }
  // Live corpus measurement. Phase 3 compresses these rows in place, so this
  // number must not move unrecorded — a change here means a row was evicted,
  // which is the one thing the compression is forbidden to do. Moving it is
  // allowed only alongside evidence that the eviction was deliberate:
  //
  //   347 -> 345, merge of the v6.36.0 legacy purge. Two rows removed upstream,
  //   both about retired legacy config: init's "Silently rewriting a legacy
  //   `backlog-backend` flag to `work-backend`" and tidy's "Relabeling a
  //   legacy-taxonomy record instead of flagging it". Verified against the
  //   merge base — both are present at the base and absent from the upstream
  //   side, so they were deleted by the purge, not lost in conflict resolution.
  //
  //   345 -> 347, v6.42.0 (#132). Two rows ADDED to routine/SKILL.md, none
  //   evicted: "Letting a routine's target branch default to the repo's GitHub
  //   default..." and "Editing a `routine-template.yml` without bumping its
  //   `template_version`". Confirmed additive for this corpus: `git diff --
  //   'skills/*/SKILL.md' | grep -E '^-\|'` is empty across the change set, so
  //   no Anti-Pattern row was evicted anywhere. (The change set does delete one
  //   `|` row overall — the `prompt` field row in _shared/routine-template-
  //   schema.md, replaced by an updated one — but that file has no SKILL.md and
  //   this count never saw it.)
  //
  //   345 -> 352, addition of `skills/feedback/SKILL.md` (learning-routing plan,
  //   Task 2). A wholly new skill, not a compression pass — its Anti-Patterns
  //   table contributes 7 rows and nothing elsewhere in the corpus lost a row.
  //
  //   352 -> 351, removal of `skills/feedback/SKILL.md`'s "Dropping a payload
  //   when `gh` fails" row (learning-routing plan, Task 6b, Step 6). The row's
  //   Why-column named a retry queue that never existed — no `bin/feedback.js`,
  //   nothing drains it — so the row was deleted rather than reworded, per the
  //   task brief's explicit instruction. feedback/SKILL.md now contributes 6
  //   rows (was 7); no other row in the corpus was touched.
  //
  //   -> 353, merge of origin/main into the learning-routing branch. The two
  //   preceding entries are the two sides of that merge, both measured against
  //   the same 345 base: upstream added 2 (routine), this branch added 6 net
  //   (feedback's 7 minus its 1 removed). 345 + 2 + 6 = 353. Neither side's own
  //   total is correct after the merge — 347 and 351 each omit the other's
  //   additions — so this number is derived from both, not picked from one.
  //
  //   353 -> 354, acceptance-disposition backstop. One row ADDED to demo/
  //   SKILL.md: "Writing a reconstruction's `### Confirmed` as though someone
  //   watched the work", guarding the new closing-commit brief path. The same
  //   change set rewords demo's "Re-deriving 'how do I test this' from the
  //   diff" row to "...when a brief already exists" — a reword, not an
  //   eviction: `git diff -- 'skills/*/SKILL.md' | grep -E '^-\|'` returns that
  //   one line and its replacement is present in the same table. Net +1.
  //
  //   354 -> 356, supervised trust table (Task 3). Two rows ADDED, none
  //   evicted: help/SKILL.md gains "Deriving a recommendation, grant, or 'next
  //   step' from the Trust Table's verdicts" (guards Stage 4.8's read-only
  //   contract) and backlog/SKILL.md gains "Deriving a grant, priority bump,
  //   or 'next step' from `overview` mode's Trust Table" (guards the same
  //   contract for `/backlog overview`'s new Step 1.5). Verified:
  //   `git diff -- 'skills/*/SKILL.md' | grep -E '^-\|'` is empty; the same
  //   diff's `^\+\|` lines are exactly these two new rows. Net +2.
  //
  //   356 -> 358, retirement of design-wrapper's auto-fit / issue-driven
  //   dispatch tables (#147). Two rows ADDED to design-wrapper/SKILL.md, both
  //   guarding the suggestion-driven model that replaced the keyword tables:
  //   "Deriving a polish command from a finding's `category`, `rule`, or
  //   `description`" and "Dropping an audit finding that has no `suggestion`".
  //   The same change set rewords that table's "Running `polish` when the audit
  //   cache is absent" row to name the new vocabulary — a reword, not an
  //   eviction: its replacement is present in the same table. The other `-|`
  //   lines in this change set are Input/Flags/availability rows, which this
  //   parser does not read. Net +2.
  //
  //   Both change sets above landed concurrently and each moved this number
  //   354 -> 356 independently, adding a DIFFERENT pair of rows. The counter
  //   therefore merged without conflict at the wrong value — same literal from
  //   the same base — while the two comment blocks did conflict. Correct total
  //   is 354 + 2 + 2 = 358, confirmed by running the parser, not by arithmetic
  //   alone.
  //
  //   358 -> 359, the autonomy governor (Phase 3). One row ADDED to backlog/
  //   SKILL.md: "Treating `refine`'s `Trust` column as the reason to grant, or
  //   withholding a grant because a class reads `insufficient evidence`". The
  //   same change set rewords two existing rows in that table rather than
  //   evicting them — the machinery-originates-no-grant row, which now names the
  //   autonomy ceiling's shut-by-default exception, and the overview Trust Table
  //   row, whose old rationale ("the `autonomy` policy lever has no consumer
  //   yet") this phase made false. Verified: `git diff -- 'skills/*/SKILL.md' |
  //   grep -E '^-\|'` returns exactly those two lines and both replacements are
  //   present in the same table. Measured with the parser, not derived. Net +1.
  //
  //   358 -> 359, wrap-up of the #163/#164 fix (6.51.1). One row ADDED to
  //   routine/SKILL.md: "Editing the canonical preamble in
  //   `_shared/routine-template-schema.md` and treating the suite's green as
  //   confirmation". The adjacent row it sits under covers editing a single
  //   template; neither covered the shared preamble, whose edit obligates all
  //   six templates plus six `template_version` bumps —
  //   tests/routine-template-schema.test.js enforces the byte-identical
  //   fan-out but only asserts `template_version` is a positive integer, never
  //   that it incremented. No row evicted: `git diff -- 'skills/*/SKILL.md' |
  //   grep -E '^-\|'` is empty for this change set. Net +1.
  //
  //   358 -> 361, Impeccable's direction contract at the acceptance gate (#152).
  //   Three rows ADDED to demo/SKILL.md, none evicted, all guarding the new
  //   `### The design contract this was built against` section in Step 2:
  //   "Summarizing, re-wording, or reordering the direction contract's five
  //   blocks", "Rendering the design-contract heading when no contract resolved,
  //   or with only the blocks that parsed", and "Dropping a malformed contract
  //   silently because the section is omitted either way". Verified:
  //   `git diff origin/main -- 'skills/*/SKILL.md' | grep -E '^-\|'` is empty,
  //   and the same diff's `^\+\|` lines are exactly these three. Net +3.
  //
  //   358 -> 362, `doctor` mode routing Impeccable's design-record findings
  //   into /tidy (#150). Four rows ADDED to design-wrapper/SKILL.md, none
  //   evicted: "Passing `--fix` to `doctor.mjs`", "Passing any flag but
  //   `--json` to `doctor.mjs`", "Collapsing `route`/`mention`/`auto` into
  //   claude-tweaks' severity words in the wrapper's return", and "Running
  //   Layer 3's file sniff before `doctor`". Verified rather than assumed, in
  //   both directions: `git diff origin/main...HEAD -- 'skills/*/SKILL.md' |
  //   grep -E '^-\|'` is empty, and the same diff's `^\+\|` lines are these
  //   four plus four Input/availability/Next-Actions rows this parser does not
  //   read. The concurrent merge from origin/main that landed in the same
  //   branch added no table rows at all (checked separately, since the 356 ->
  //   358 entry above records what happens when a merge's contribution is
  //   assumed to be zero without looking). Net +4.
  //
  //   -> 365, merge of #150 into #152. The two entries above are the two sides
  //   of that merge, both measured against the same 358 base: #150 added 4
  //   (design-wrapper's doctor rows), #152 added 3 (demo's direction-contract
  //   rows). 358 + 4 + 3 = 365. This is `[IL-99]` firing exactly as recorded:
  //   `.claude-plugin/plugin.json` had no textual conflict at all — both
  //   branches independently bumped to 6.52.0, so the field resolved to the
  //   same string either way and only the two comment blocks here conflicted,
  //   which is what surfaced the collision. Neither side's literal is correct
  //   after the merge (361 and 362 each omit the other's rows), so this number
  //   was re-derived by RUNNING the parser on the merged tree, not by adding
  //   these comment blocks together — the arithmetic agreeing is a coincidence
  //   worth having but not the evidence.
  //
  //   -> 366, merge of origin/main (6.53.0) into the autonomy-governor branch.
  //   Third occurrence of `[IL-99]` on this counter, and the second where the
  //   comment blocks are what surfaced it: this branch went 358 -> 359, upstream
  //   went 358 -> 365, and both literals are wrong afterward. Re-derived by
  //   RUNNING the parser on the merged tree — 366 — not by adding 1 and 7 to the
  //   shared base. The arithmetic happens to agree here, which is exactly the
  //   coincidence the entry above warns is not evidence.
  //
  //   365 -> 370, native surface routing (#151). Five rows ADDED to design-
  //   wrapper/SKILL.md, none evicted, all guarding the new web-vs-native track
  //   resolution: "Running the Impeccable CLI or `live` on a native surface",
  //   "Returning `pass` from `test` mode on a native surface", "Dispatching
  //   native work without naming `ios`, `android`, or `adaptive`", "Letting
  //   `setup.platform` silently overrule an explicit `Surface:`", and "Running
  //   Layer 3's web-only sniff against a declared native surface". Verified in
  //   both directions: `git diff origin/main...HEAD -- 'skills/*/SKILL.md' |
  //   grep -E '^-\|'` is empty, and 370 was read off the parser run against the
  //   working tree, not computed as 365 + 5 — the arithmetic agreeing is a
  //   check, not the evidence (`[IL-99]`). A concurrent lane is editing
  //   design-wrapper/modes/review.md this wave; mode sub-files carry no
  //   Anti-Patterns table and this parser only reads `skills/*/SKILL.md`, so
  //   that lane cannot move this number without touching a SKILL.md itself.
  //
  //   -> 371, second merge of origin/main (6.54.0) into the autonomy-governor
  //   branch. Fourth `[IL-99]` occurrence on this counter in one wave: this
  //   branch stood at 366, upstream at 370, both measured from a 365 base that
  //   only one of them still shares. Re-derived by RUNNING the parser on the
  //   merged tree. Note the arithmetic does NOT agree this time — 366 + 5 = 371
  //   works only because upstream's five rows and this branch's one row are
  //   disjoint, which is a fact about the diff and not something the two
  //   literals could have told anyone. That is the whole reason this entry
  //   records a measurement rather than a sum.
  //
  //   370 -> 371, merge of origin/main into the #163/#164 wrap-up branch. The
  //   two entries above are the two sides of that merge, both measured against
  //   the same 358 base: this branch added 1 (routine), upstream added 12
  //   across 6.52.0-6.55.0. Neither side's own literal is correct afterward —
  //   359 and 370 each omit the other's contribution, and because both sides
  //   moved the SAME line from the SAME base, git surfaced this as a conflict
  //   only in the comment block; had the two totals happened to coincide it
  //   would have merged silently at the wrong value, which is exactly [IL-99].
  //   371 was read off the parser run against the merged working tree, not
  //   computed as 370 + 1 — the arithmetic agreeing is a check, not the
  //   evidence. `git diff --diff-filter=M -- 'skills/*/SKILL.md' |
  //   grep -cE '^-\|'` returns 0 across the merge, so nothing was evicted.
  //
  //   -> 372, merging both of the above into one tree. This is the textbook
  //   `[IL-99]` case, and it is worth being precise about why. Two independent
  //   branches each took a 358 -> 359 step, each added a DIFFERENT row (this
  //   branch's backlog Trust-column row; the other's routine shared-preamble
  //   row), and each then merged a different span of upstream and landed on the
  //   same literal 371. Because the literals coincided, `assert.strictEqual(
  //   total, 371)` was **not part of the conflict at all** — git merged that
  //   line silently and left it wrong by exactly the other side's one row. Only
  //   the two comment blocks conflicted, and reading them is what prompted the
  //   re-measurement. 372 was read off the parser against the merged tree. The
  //   arithmetic that would have "confirmed" 371 was available and agreed with
  //   both sides; it was wrong. Nothing evicted: `git diff --diff-filter=M --
  //   'skills/*/SKILL.md' | grep -cE '^-\|'` is 0 across the merge.
  //   372 -> 374, #190 (routine record freshness). Two rows added to
  //   skills/routine/SKILL.md: reading `.claude-tweaks/routines/*.yml` straight
  //   from the working checkout, and gating a stop on "behind" rather than on a
  //   verified comparison. A third `+|` line in that diff is the pre-existing
  //   duplicate-routine row edited in place, not an addition — net +2, which is
  //   why the raw added-line count (3) and the delta (2) disagree.
  //   Measured, not summed: `extractAntiPatternRows` run over every
  //   `git show HEAD:skills/*/SKILL.md` gave 372 and over the working tree gave
  //   374. Nothing evicted — the diff's only `^-\|` line is that edited row,
  //   whose replacement is present.
  //
  //   374 -> 368, the wrap-up phase-architecture consolidation. The FIRST
  //   deliberate eviction on this counter since the v6.36.0 legacy purge, and
  //   the only entry here that removes more rows than it adds. Rewriting
  //   wrap-up/SKILL.md's 17 numbered steps as four phases + a curation registry
  //   + a code engine retired nine per-step curation guards and added three
  //   engine-era ones: net -6, entirely in that one file.
  //   Measured, not summed, per-file across `origin/main...HEAD`:
  //   origin/main totals 374 (so the literal above was right there) and HEAD
  //   totals 368; the ONLY file with a nonzero delta is wrap-up/SKILL.md,
  //   19 -> 13. No other skill moved, so nothing was lost in conflict
  //   resolution while this branch merged upstream.
  //   The eviction is legitimate because the hazards were not dropped, they
  //   moved from prose guard to mechanism — `bin/lib/wrap-up/` now enforces
  //   what these nine rows used to ask the model to remember. Removed:
  //   "Scanning the entire skill library every wrap-up" (scope selection is
  //   engine-owned), "Skipping skill curation because nothing was
  //   ledger-tagged" and "Gating skill-curation.md's read on `.claude/skills/
  //   *.md` alone" (registry.js evaluates that gate), "Skipping doc curation
  //   because nothing was directly touched", the three "Declaring 'no X
  //   updates needed' with no logged scan scope" rows and "Letting a closed
  //   sub-file gate suppress the step's `SCANNED` summary line" (engine-plan.js
  //   pre-resolves every closed row and writes its SCANNED line before the
  //   model reads anything), and "Mixing skill updates into the doc/CLAUDE.md
  //   batch table" (engine-render.js's SECTION_SPECS emits one section per
  //   rowId). Added: "Skipping a registry row because its gate looks obviously
  //   closed", "Composing the Phase 2 trace or SCANNED lines by hand when the
  //   engine is available", "Treating engine failure as permission to skip
  //   curation" — the three hazards the mechanism itself introduces.
  //
  //   368 -> 369, code-health's `focus=dead-code` scoping mode. One row added
  //   to code-health/SKILL.md ("Treating a focus-mode candidate set as fully
  //   read"), covering the hazard focus mode introduces and generalist mode
  //   does not: a generator's candidate set is repo-wide, so Step 3's 60 KB
  //   read budget defers most of it, and a clean-looking result can mean the
  //   judge never saw the candidate rather than that the candidate was fine.
  //   Nothing evicted — the only `^+\|` line in the diff is that row.
  //
  //   369 -> 370, #269 (backlog grant mode: headless machine-grant unit).
  //   backlog/SKILL.md's existing "granting from anything but an interactive
  //   human session" row was rewritten to scope it to `refine` mode
  //   specifically (a new `grant` mode is the one deliberate machine-origination
  //   path this leaf adds) and a second row was added covering `grant` mode's
  //   own hazard ("granting on any record whose gate chain hasn't fully
  //   cleared, or on a human-filed record"). One row's text changed in place
  //   (not an eviction — the pattern column still parses to one row, same
  //   `^-\|`/`^+\|` pairing `extractAntiPatternRows` treats as a same-slot
  //   edit) and one row was net-added: 369 + 1 = 370. The only file with a
  //   nonzero delta is backlog/SKILL.md.
  //
  //   370 -> 373, demo's show-first walkthrough rewrite around the observation
  //   plan (refs #324). One row in demo/SKILL.md reworded in place — "Handing
  //   over 'Give me the steps' instructions without running the pre-flight
  //   first" -> "Handing the human an entry point without Prepare/Validate
  //   having run" (not an eviction: the replacement is present in the same
  //   table, same slot) — plus three rows ADDED, all guarding the new
  //   Prepare -> Validate -> Show -> Verdict show-first flow: "Asking for the
  //   verdict before Prepare/Validate/Show have run", "Blocking the
  //   walkthrough on a stale `flow` Inspect pointer instead of stating it and
  //   continuing", and "Skipping Validate and handing the human an unverified
  //   URL". Verified: `git diff origin/main...HEAD -- 'skills/*/SKILL.md' |
  //   grep -E '^-\|'` returns exactly the one reworded line, and the same
  //   diff's `^\+\|` lines are that line's replacement plus these three new
  //   rows — no other file in the corpus has a nonzero delta. Net +3. Measured
  //   by running the parser against the working tree, not summed.
  //
  //   373 -> 375, design-wrapper explore mode (refs #377). Two rows ADDED to
  //   design-wrapper/SKILL.md, both guarding the new explore mode: "Invoking
  //   `explore` mode from an auto-mode or `$PIPELINE_RUN_DIR`-set context"
  //   (interactive-only, same reasoning as `live`) and "The wrapper writing
  //   `DESIGN.md` itself after an `explore` pick" (upstream `document --seed`
  //   is the only writer). Verified: `git diff origin/main...HEAD --
  //   'skills/*/SKILL.md' | grep -E '^-\|'` returns nothing, and the same
  //   diff's `^\+\|` Anti-Patterns lines are exactly these two rows — no
  //   other file in the corpus has a nonzero delta. Net +2. Measured by
  //   running the parser against the working tree, not summed.
  //
  //   375 -> 371, retiring skills/version/ (refs #398). The version lookup
  //   folded directly into /help (Stage 0 of status-scan.md); the standalone
  //   skill and its whole four-row Anti-Patterns table were deleted, not
  //   edited, so this is a pure eviction with no replacement rows anywhere.
  //   Verified: `git diff origin/main...HEAD -- 'skills/*/SKILL.md' | grep -E
  //   '^-\|'` returns exactly version/SKILL.md's four rows ("Hardcoding the
  //   version in skill content", "Adding decision prompts or finding gates",
  //   "Bumping the version inside this skill", "Padding the output with
  //   announcements like \"Here's the version!\""), and the same diff has no
  //   `^\+\|` Anti-Patterns lines at all — no other file in the corpus has a
  //   nonzero delta. Net -4. Measured by running the parser against the
  //   working tree, not summed.
  //
  //   375 -> 369, assess-agent-autonomy router+mode-sub-file split (#395).
  //   Not an eviction — a relocation this test's SKILL.md-only scan can't
  //   see: assess-agent-autonomy/SKILL.md went from 9 rows to 3 (the three
  //   genuinely cross-mode ones), and the other 6 moved verbatim into the
  //   mode's own sub-file — 5 into merge-check.md, 1 into failure-check.md
  //   (grant-check.md and ceremony-check.md gained none; no row in either
  //   was mode-exclusive). Same precedent already covers browse's
  //   agent-browser-reference.md, flow's multispec-review-console.md, and
  //   routine's fleet.md, each carrying its own Anti-Patterns table this
  //   count has never included. Verified with the real parser (not
  //   grep, which also matches this file's other tables):
  //   `extractAntiPatternRows` on `git show HEAD^:skills/assess-agent-
  //   autonomy/SKILL.md` returns 9, on the new SKILL.md returns 3; the 6
  //   moved rows are byte-identical (modulo heading level) in their new
  //   sub-file. 375 - 6 = 369.
  //
  //   -> 365, merge of origin/main (#395) into the #398 branch. The two
  //   entries above are the two sides of that merge, both measured against
  //   the same 375 base: #398 evicted 4 rows via retirement (version), #395
  //   evicted 6 via relocation (assess-agent-autonomy). Neither side's own
  //   literal (371, 369) is correct after the merge — each omits the other's
  //   eviction — so this number was re-derived by RUNNING the parser on the
  //   merged tree, not by subtracting both deltas from 375, though the
  //   arithmetic happens to agree here (375 - 4 - 6 = 365) — the same
  //   `[IL-99]` pattern recorded above.
  //
  //   365 -> 368, design-wrapper review Step 3.8 critic dispatch (#598).
  //   Three rows appended to design-wrapper/SKILL.md's Anti-Patterns table
  //   (treating a craft critic as a third-party agent; dispatching one on the
  //   native track; inferring the motion signal from file content). No other
  //   file's table changed in that diff. Measured by running this test's own
  //   parser against the working tree (actual 368), not by adding 3 to 365.
  //
  //   368 -> 369, decisions pushback routing (#599). One row appended to
  //   design-wrapper/SKILL.md's Anti-Patterns table (writing a decisions
  //   finding into the polish cache). Measured by running this test's parser
  //   against the working tree (actual 369), not by adding 1 to 368.
  //
  //   365 -> 369, addition of `skills/routine-kickoff/SKILL.md` (#528). A
  //   wholly new skill, not a compression pass — its Anti-Patterns table
  //   contributes 4 rows ("Deriving the plugin root from step 2's
  //   plugin-list output", "Falling back to manual execution on any
  //   invocation failure", "Executing `dispatch` or `tidy` manually on the
  //   fallback path", "Restating the kernel's contents ... here") and
  //   nothing elsewhere in the corpus lost a row. Verified:
  //   `git diff origin/main...HEAD -- 'skills/*/SKILL.md' | grep -E '^-\|'`
  //   returns only two rows from `routine`/SKILL.md's `fleet` sub-table
  //   (not an Anti-Patterns table — this parser only reads the section
  //   between `## Anti-Patterns` and the next `## ` heading, so those rows
  //   are outside its scope regardless). Measured by running the parser
  //   against the working tree, not derived by adding 4 to 365 — the
  //   arithmetic agreeing here is a check, not the evidence (`[IL-99]`).
  //
  //   369 -> 369, routine-kickoff cross-reference cleanup (#530). One row
  //   in `routine/SKILL.md`'s Anti-Patterns table was reworded ("Editing the
  //   canonical preamble in `_shared/routine-template-schema.md`..." became
  //   "Editing the kernel ... without bumping `kernel_version`...") to match
  //   the post-#529 kernel/kickoff split; no row was added or removed.
  //   Verified: `git diff <pre-#530-commit> -- 'skills/*/SKILL.md' | grep -E
  //   '^[-+]\|'` (the #530 change in isolation, not the whole branch since
  //   origin/main, which also carries #528/#529's own row deltas) returns
  //   exactly one `-` line and one `+` line, both from the same table
  //   position. Re-run of the parser against the working tree confirms 369,
  //   unchanged.
  //
  //   -> MEASURED, merge of origin/main (#528/#530 routine-kickoff) into the
  //   #597-601 branch. Both sides independently reached 369 from 365 — ours
  //   via design-wrapper (+3 #598, +1 #599), theirs via routine-kickoff (+4
  //   #528). Neither side's 369 covers the other's rows, so the value below
  //   was re-derived by RUNNING the parser on the merged tree — the same
  //   [IL-99] rule the 365 entry above records.
  //
  //   373 -> 376, bare-`#N` evidence-or-accept-risk mode (#726) merged with
  //   origin/main (#745 worktree-flow-spec-716). Own-branch side: three rows
  //   ADDED to skills/challenge/SKILL.md's Anti-Patterns table guarding the
  //   new bare-`#N` mode ("Dispatching the bare-`#N` evidence search to
  //   subagents", "Escalating the evidence search past its stated caps 'to be
  //   thorough'", "Treating `solution:unjustified` as a gate in the bare-`#N`
  //   mode"). Verified: `git diff origin/main...HEAD -- 'skills/*/SKILL.md' |
  //   grep -E '^[-+]\|'` returns exactly these three `+` lines, all inside
  //   challenge/SKILL.md's `## Anti-Patterns` section (line 121) — no other
  //   file in that diff has a nonzero delta. origin/main side: net zero —
  //   `git diff cd4261dd...origin/main -- 'skills/*/SKILL.md' | grep -E
  //   '^[-+]\|'` returns one line reworded in place inside demo/SKILL.md's
  //   Anti-Patterns table (no row count change) plus one row added to
  //   specify/SKILL.md's `## Next Actions` table (line 109, before the `##
  //   Anti-Patterns` heading at line 123) — out of this parser's scope, same
  //   precedent as routine-kickoff's #528 entry above. Measured by RUNNING
  //   the parser on the merged working tree (actual 376), not by adding 3 to
  //   373 — the arithmetic agreeing here is a check, not the evidence
  //   (`[IL-99]`).
  //
  //   376 -> 379, deepen decline-memory + collapse fast lane. Three rows ADDED
  //   to skills/deepen/SKILL.md's Anti-Patterns table ("Staging a deepen-kind
  //   candidate as a `.patch` in `auto` mode", "Suppressing a previously
  //   declined candidate", "Walking collapse candidates through the
  //   per-candidate design conversation"). Verified: `git diff -- 'plugin/
  //   skills/*/SKILL.md' | grep -E '^[-+]\|'` returns exactly these three `+`
  //   lines and no `-` lines (simplify/SKILL.md's edit in the same change is
  //   an Input-section numbered-list item, not a table row). Measured by
  //   RUNNING the parser on the working tree (actual 379), not by adding 3 to
  //   376 (`[IL-99]`).
  //
  //   379 -> 381, /stories maintainer-objective fixes (agent-browser drift +
  //   Target Environment Guard) merged with origin/main (deepen's +3 above —
  //   both sides moved this pin from 376 independently). Own-branch side: two
  //   rows ADDED to stories/SKILL.md's Anti-Patterns table ("Running an
  //   action-less `find` as an existence probe", "Generating negative stories
  //   against a non-local target without acknowledgment"); three rows reworded
  //   in place with no count change (two in stories/SKILL.md, one in
  //   visual-review/SKILL.md — trace record-then-stop model). Measured by
  //   RUNNING the parser on the merged working tree (actual 381), not by
  //   adding 2 to 379 — the arithmetic agreeing here is a check, not the
  //   evidence (`[IL-99]`).
  //
  //   381 -> 382, #889 (assess-agent-autonomy transport-aware gathers) merged
  //   with origin/main (deepen's +3 and stories' +2 above — both sides moved
  //   this pin from 376 independently). Own-branch side: one row ADDED to
  //   skills/assess-agent-autonomy/SKILL.md's Anti-Patterns table ("Rendering
  //   a conservative verdict with a content-judgment-style rationale when the
  //   gather itself failed"). Verified on the own-branch range:
  //   `git diff ee665fb8...HEAD -- 'plugin/skills/*/SKILL.md' | grep -E
  //   '^[-+]\|'` returned exactly that one `+` line. Measured by RUNNING the
  //   parser on the merged working tree (actual 382), not by adding 1 to 381
  //   — the arithmetic agreeing here is a check, not the evidence (`[IL-99]`).
  //
  //   382 -> 383, #1194 (demo full-verification pointer). Own-branch side: one
  //   row ADDED to demo/SKILL.md's Anti-Patterns table ("Handing a sub-issue's
  //   `cli`/`diff` plan to a human as if the slice were the feature"), already
  //   committed by the time this pin was bumped (`b795ca58`), so the row's own
  //   commit rather than a bare working-tree `git diff` is the evidence:
  //   `git show b795ca58 -- 'plugin/skills/*/SKILL.md' | grep -E '^[-+]\|'`
  //   returns exactly this one `+` line and no `-` lines. Measured by RUNNING
  //   the parser on the working tree (actual 383), not by adding 1 to 382 —
  //   the arithmetic agreeing here is a check, not the evidence (`[IL-99]`).
  //
  //   383 -> 384, #1492 added dispatch's "Re-selecting a Settle-failed group
  //   within the same drain firing" row. Verified: `git diff d05746546..HEAD --
  //   plugin/skills/dispatch/SKILL.md | grep "^+.*|"` shows one Anti-Patterns
  //   row added inside the `## Anti-Patterns` section (the other `+`/`-` lines
  //   in that diff are argument-hint, Input-table, and Configuration-table
  //   rows, outside this parser's section scope) and no row evicted.
  //
  //   384 -> 385, #1489 added backlog/SKILL.md's "A scheduled Routine firing
  //   `refine #N` or `refine --reset-breaker`" row. Verified:
  //   `git show d18e0c871 -- 'plugin/skills/*/SKILL.md' | grep -E '^[-+]\|'`
  //   returns exactly this one `+` line and no `-` lines. The #1489 fix-wave's
  //   own edits (backlog/SKILL.md's Preflight/description prose,
  //   attention-mode.md, refine-record.md) touched no Anti-Patterns table —
  //   confirmed by `git diff <fix-wave-base>..HEAD -- plugin/skills/backlog/
  //   {SKILL,attention-mode,refine-record}.md | grep -E '^[-+]\|'` showing no
  //   hits inside any `## Anti-Patterns` section. Measured by RUNNING the
  //   parser on the working tree (actual 385), not by adding 1 to 384 — the
  //   arithmetic agreeing here is a check, not the evidence (`[IL-99]`).
  //
  //   385 -> 391, #1494 added `plugin/skills/sweep/SKILL.md` (new sweep
  //   orchestrator skill — Task 1). A wholly new skill, not a compression
  //   pass: its Anti-Patterns table contributes 6 rows ("Invoking
  //   `/claude-tweaks:dispatch`, `/claude-tweaks:flow`, or
  //   `/claude-tweaks:build` from sweep", "Inferring parent invocation from
  //   `$PIPELINE_RUN_DIR` in a child", "Restating attention's
  //   fetch/merge/rank logic in the close-out", "Skipping the between-step
  //   snapshot invalidations", "Continuing past a failed step", "Adding a
  //   mode keyword or per-record targeting") and nothing elsewhere in the
  //   corpus lost a row. Measured by RUNNING the parser on the working tree
  //   (actual 391), not by adding 6 to 385 — the arithmetic agreeing here is
  //   a check, not the evidence (`[IL-99]`).
  //
  //   391 -> 398, #1704 (new `/claude-tweaks:intake` skill), merged with
  //   origin/main (#1492/#1489/#1494's own +8 above, moved this pin from 383
  //   independently). Own-branch side: a brand-new SKILL.md, not a diff to an
  //   existing one — its own `## Anti-Patterns` table ships with exactly
  //   seven rows ("Filing a fragment as spec-shaped", "Running a second
  //   nudge round", "Silently omitting a dropped fragment", "Fetching a URL
  //   to see what it is", "Restating a skill edge inside this file", "Adding
  //   an intake-side routing prompt on top of `/claude-tweaks:capture`'s
  //   `--route=keep`", "Filing an upstream issue from an uncertain repo
  //   identity"). Measured by RUNNING the parser on the merged working tree
  //   (actual 398), not by adding 7 to 391 (`[IL-99]`).
  //
  //   398 -> 403, #44 (new `/claude-tweaks:pipeline-smoke-test` skill). A
  //   brand-new SKILL.md, not a diff to an existing one — its own
  //   `## Anti-Patterns` table ships with exactly five rows ("Simulating the
  //   claim race within one conversation", "Trusting a stage process's own
  //   stdout as verification", "Running this as part of an unattended
  //   `/flow`/`/dispatch` firing", "Reporting cleanup success from Step 5's
  //   exit code alone", "Leaving the test issue open after a failed run for
  //   debugging"). Measured by RUNNING the parser on the working tree (actual
  //   403), not by adding 5 to 398 (`[IL-99]`).
  //
  //   403 -> 411, #2256 (new `/claude-tweaks:release` skill). A brand-new
  //   SKILL.md, not a diff to an existing one — its own `## Anti-Patterns`
  //   table ships with the rows "Running the engine without Step 3's
  //   review", "Treating a missing hook run as success at Step 6",
  //   "Rendering a release recommendation or a shipped-record row from an
  //   unverified premise", "Honouring `--allow-blocking` under `--train`",
  //   "Reading `integration-model` afresh instead of the pack's `engine`
  //   field", "Reporting a landed-but-unverified release as `HELD`",
  //   "Continuing past a degraded `engine`, `unreleased` or
  //   `proposedVersion` field", and the `failed`-vs-`PARTIAL` row. Measured
  //   by RUNNING the parser on the working tree (actual 411), not by adding
  //   the row count to 403 (`[IL-99]`).
  assert.strictEqual(total, 411);
});
