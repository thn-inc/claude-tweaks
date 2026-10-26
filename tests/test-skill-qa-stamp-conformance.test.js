'use strict';
// #3003: pins test/SKILL.md's QA-stamp routing and the corrected `affected`
// base-resolution clause, plus qa-reporting.md's Phase 5 stamp write. Each
// claim matches the live prose AND fails against the frozen pre-change text,
// so a green run proves the pattern can go red [IL-105].
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILL = readText(path.join(ROOT, 'plugin/skills/test/SKILL.md'));
const REPORTING = readText(path.join(ROOT, 'plugin/skills/test/qa-reporting.md'));

// Pre-change `affected` bullet clause (SKILL.md:121 before #3003).
const PRE_AFFECTED = "(`{ref}` via `_shared/integration-branch.md`; the stamp's `fullSha` wins whenever it is still an ancestor of HEAD, pipeline or not; `--integration-branch` is the fallback";
// Pre-change pipeline bullets' story-run wording — the FULL bullet 2 text as
// it read before #3003 added the stamp (git show 3bc6a522d:plugin/skills/test/SKILL.md:70),
// not a weak 60-char fragment (Minor 6): a frozen control this strong still
// fails every pattern below, which is what proves each pattern can go red.
const PRE_PIPELINE = "- `VERIFICATION_PASSED=true` + stories exist → skip verification, then **select stories by `source_files` ∩ the changed-file set** (`node \"${CLAUDE_PLUGIN_ROOT}/bin/verify.js\" --changed-files --integration-branch {ref}` — exit 1 means no base resolved: never treat it as an empty set, fall back to the full story set; exact repo-relative path match; a story with no `source_files` field is always included): one or more matches → run only those; zero matches → apply `design-wrapper/frontend-detection.md`'s Layer 3 sniff to the changed-file set, read once, regardless of the record's materialized `surface:` (#2745 — a `surface: web` header does not by itself mean this diff touched a UI file; a loader/route/config-only change on a web-surface record must not skip the sniff) — any UI trigger file → run the full story set (this is also what still covers #808's original concern: a brand-new UI feature whose stories don't carry `source_files` yet always touches at least one Layer-3-recognized file, so it still runs full); none → report `QA: skipped — no affected stories ({n} stories considered, {m} changed files)`, set `TEST_PASSED=true`, and log `AUTO {time} — QA scoped: 0/{n} stories affected by {m} changed file(s); skipped — no UI trigger file in diff. Reversibility: high.`. Every selection logs `AUTO {time} — QA scoped: {k}/{n} stories affected by {m} changed file(s). Reversibility: high.` The Design CLI gate (Step 1.5) still runs on a skip.";
// Pre-change Phase 5 report-files tail (qa-reporting.md before #3003).
const PRE_PHASE5 = '**`{RUN_DIR}/report.md`** — human-readable (same format as the report below).\n\n26. Present the aggregated results:';

function pinned(live, control, pattern, msg) {
  assert.match(live, pattern, msg);
  assert.doesNotMatch(control, pattern, 'pattern must NOT match the pre-change text (proves it can go red)');
}

test('affected bullet: an anchor equal to HEAD falls through under --integration-branch (#2486), and the old always-wins clause is gone', () => {
  assert.ok(!SKILL.includes('wins whenever it is still an ancestor of HEAD, pipeline or not'), 'the pre-#2486 always-wins clause must be removed');
  pinned(SKILL, PRE_AFFECTED, /an anchor equal to HEAD falls through to the integration-branch merge-base/, 'affected bullet must state the #2486 fall-through');
});

test('pipeline story selection consults the QA pass stamp before dispatching stories', () => {
  pinned(SKILL, PRE_PIPELINE, /bin\/qa-stamp\.js" --check --stories/, 'pipeline bullets must run qa-stamp.js --check');
  pinned(SKILL, PRE_PIPELINE, /QA: skipped — stories already passed at \{short-sha\}/, 'the skip report line must be pinned');
});

test('pipeline story runs route through qa-procedures.md, so Phase 5 always writes report.json', () => {
  pinned(SKILL, PRE_PIPELINE, /goes through `qa-procedures\.md` \(Phases 1-5\.5\), the only path that writes `\{RUN_DIR\}\/report\.json`/, 'pipeline bullets must route through qa-procedures.md');
});

test('the stamp-then-qa-procedures routing covers every story-run path, not just the scoped-match branch (Important 1)', () => {
  pinned(
    SKILL,
    PRE_PIPELINE,
    /the scoped match set, the Layer-3 full set, or the exit-1 full-set fallback — first passes this check, then goes through `qa-procedures\.md` \(Phases 1-5\.5\)/,
    'the QA pass stamp paragraph must state routing once for every story-run path this bullet selects, including the Layer-3 full set and the exit-1 fallback',
  );
});

test('the QA-skip path still passes the #3013 PR-check gate before TEST_PASSED', () => {
  assert.match(SKILL, /\*\*PR-check gate \(#3013\):\*\* before any bullet above sets `TEST_PASSED=true`/, 'PR-check gate bullet must stay below the pipeline bullets');
  const skipAt = SKILL.indexOf('QA: skipped — stories already passed at');
  assert.ok(skipAt >= 0, 'the QA-stamp skip line must be present');
  assert.ok(skipAt < SKILL.indexOf('**PR-check gate (#3013):**'), 'the QA-stamp skip must sit above the PR-check gate bullet, which applies to it');
});

test('qa-reporting.md Phase 5 writes the QA pass stamp after report.json in pipeline context', () => {
  pinned(REPORTING, PRE_PHASE5, /\*\*QA pass stamp \(pipeline runs, #3003\)\.\*\*[\s\S]{0,300}bin\/qa-stamp\.js" --write --report "\{RUN_DIR\}\/report\.json"/, 'Phase 5 must run qa-stamp.js --write');
});
