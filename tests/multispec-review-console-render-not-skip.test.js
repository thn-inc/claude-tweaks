'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #642: the Auto-resolution short-circuit paragraph in
// skills/flow/multispec-review-console.md previously instructed both
// "render every section below as an informational report (nothing dropped)"
// AND "skip the console render and its AskUserQuestion entirely" in the same
// paragraph — a self-contradiction that made the audit surface vanish at
// `autonomy: unattended` (whichever clause the model followed, the operator
// saw either the full table or nothing). Fixed by aa7872c6 ("Fix
// consoleAutoResolve zero-render defect — rows stamped AUTO-RESOLVED",
// refs #714): the short-circuit now only skips the AskUserQuestion prompt,
// never the render. This test pins that the contradiction cannot reappear in
// either the multispec console or the single-spec wrap-up console (which
// carries the same short-circuit and was reworded in lockstep by the same
// commit, though its pre-fix wording never actually carried the offending
// clause).

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');
const WRAP_UP_REVIEW_CONSOLE = read('plugin', 'skills', 'wrap-up', 'review-console.md');

// Frozen bytes of the pre-fix paragraph (skills/flow/multispec-review-console.md
// at aa7872c6^), copied verbatim from `git show aa7872c6 -- skills/flow/multispec-review-console.md`.
// Never re-derive this from memory of the fix — see docs' "Project Conventions"
// on copying pinned literals from the edit's own source, not paraphrase.
const PRE_FIX_MULTISPEC_PARAGRAPH = 'When granted: render every section below as an informational report (nothing dropped), resolve every item per its stated default with **zero** `AskUserQuestion` calls — batch sections and `Q#`/`M#` as if Approve all had been chosen; `U#` resolves to **filed**, the one exception to its usual declined default (same rule the single-spec short-circuit states). Execute via "On approval" below; log one `AUTO {time} — Review Console: auto-resolved {item}. Reversibility: {…}.` line per item to the originating spec\'s `decisions.md` (or the parent\'s, for a parent-level item) instead of a user answer, retain every `staged/` file as a revert artifact rather than consuming it, and send **one** consolidated `PushNotification` for the whole run — not per spec, not per item — at the same point the single-spec auto-merge short-circuit sends its own FYI. Then proceed straight to Cleanup actions execution (Shared teardown below) and archive the parent run dir — skip the console render and its `AskUserQuestion` entirely.';

const SKIP_RENDER_CLAUSE = /skip the console render/;
const NOTHING_DROPPED_CLAUSE = /nothing dropped/;

test('the pre-fix fixture actually carries the contradiction (proves the absence check can go red)', () => {
  assert.match(PRE_FIX_MULTISPEC_PARAGRAPH, SKIP_RENDER_CLAUSE, 'fixture must contain the retired clause, or the live doesNotMatch below is vacuous');
  assert.match(PRE_FIX_MULTISPEC_PARAGRAPH, NOTHING_DROPPED_CLAUSE, 'fixture must also carry "nothing dropped" — the contradiction is both clauses in one paragraph');
});

test('multispec-review-console.md Auto-resolution short-circuit: renders, never skips the render', () => {
  assert.match(MULTISPEC_CONSOLE, NOTHING_DROPPED_CLAUSE, 'short-circuit paragraph must still promise a full render');
  assert.doesNotMatch(MULTISPEC_CONSOLE, SKIP_RENDER_CLAUSE, 'the retired "skip the console render" clause must not reappear');
});

test('wrap-up/review-console.md Auto-resolution short-circuit: renders, never skips the render', () => {
  assert.match(WRAP_UP_REVIEW_CONSOLE, NOTHING_DROPPED_CLAUSE, 'short-circuit paragraph must still promise a full render');
  assert.doesNotMatch(WRAP_UP_REVIEW_CONSOLE, SKIP_RENDER_CLAUSE, 'the retired "skip the console render" clause must not reappear');
});

// Deliverable 2 (#642): the short-circuit paragraph ends with a pointer to
// decisions.md/staged/ so the operator has something to inspect even though
// nothing prompted at `unattended`.
test('multispec-review-console.md short-circuit ends with a decisions.md/staged pointer', () => {
  assert.match(MULTISPEC_CONSOLE, /every touched `decisions\.md`[\s\S]{0,120}`staged\/\*\.md`/, 'must point the operator at decisions.md and staged/*.md');
});

test('wrap-up/review-console.md short-circuit ends with a decisions.md/staged pointer', () => {
  // #1932: console-resolve.js also writes console.json, so the pointer sentence now
  // enumerates decisions.md, console.json, and staged/* (broadened from staged/*.md
  // since a staged patch need not be markdown) — widened from the pre-#1932 pin.
  assert.match(WRAP_UP_REVIEW_CONSOLE, /absolute path to `decisions\.md`[\s\S]{0,80}`staged\/\*`/, 'must point the operator at decisions.md and staged/*');
});
