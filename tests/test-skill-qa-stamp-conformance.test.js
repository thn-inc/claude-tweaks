'use strict';
// #3003: pins test/SKILL.md's QA-stamp routing and the corrected `affected`
// base-resolution clause, plus qa-reporting.md's Phase 5 stamp write. Each
// claim matches the live prose AND fails against the frozen pre-change text,
// so a green run proves the pattern can go red [IL-105].
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILL = fs.readFileSync(path.join(ROOT, 'plugin/skills/test/SKILL.md'), 'utf8');
const REPORTING = fs.readFileSync(path.join(ROOT, 'plugin/skills/test/qa-reporting.md'), 'utf8');

// Pre-change `affected` bullet clause (SKILL.md:121 before #3003).
const PRE_AFFECTED = "(`{ref}` via `_shared/integration-branch.md`; the stamp's `fullSha` wins whenever it is still an ancestor of HEAD, pipeline or not; `--integration-branch` is the fallback";
// Pre-change pipeline bullets' story-run wording (SKILL.md:70 before #3003).
const PRE_PIPELINE = 'one or more matches → run only those; zero matches → apply';
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
  pinned(SKILL, PRE_PIPELINE, /run those stories through `qa-procedures\.md` \(Phases 1-5\.5\)/, 'pipeline bullets must route through qa-procedures.md');
});

test('the QA-skip path still passes the #3013 PR-check gate before TEST_PASSED', () => {
  assert.match(SKILL, /\*\*PR-check gate \(#3013\):\*\* before any bullet above sets `TEST_PASSED=true`/, 'PR-check gate bullet must stay below the pipeline bullets');
  assert.ok(SKILL.indexOf('QA: skipped — stories already passed at') < SKILL.indexOf('**PR-check gate (#3013):**'), 'the QA-stamp skip must sit above the PR-check gate bullet, which applies to it');
});

test('qa-reporting.md Phase 5 writes the QA pass stamp after report.json in pipeline context', () => {
  pinned(REPORTING, PRE_PHASE5, /\*\*QA pass stamp \(pipeline runs, #3003\)\.\*\*[\s\S]{0,300}bin\/qa-stamp\.js" --write --report "\{RUN_DIR\}\/report\.json"/, 'Phase 5 must run qa-stamp.js --write');
});
