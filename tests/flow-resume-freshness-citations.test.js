// tests/flow-resume-freshness-citations.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');
const FRAGMENT = '_shared/run-resume-freshness.md';

// The three resume paths named in #676's own Current State — a fresh
// citation site is a plan change, never an incidental grep hit, so this list
// is exhaustive by construction rather than discovered by a repo-wide scan.
const CALL_SITES = [
  // #2006 extracted wrap-up's "Resuming a halted Review Console" procedure
  // (including this citation) out of SKILL.md into its own sub-file to stay
  // under the 38 KB ceiling — the resume path's freshness-probe citation now
  // lives there instead.
  path.join(SKILLS_DIR, 'wrap-up', 'resume-halted-run.md'),
  // #852 extracted dispatch's "Confirm before resuming" procedure (including
  // this citation) out of SKILL.md into its own sub-file to stay under the
  // 40 KB ceiling — the resume path's freshness-probe citation now lives
  // there instead.
  path.join(SKILLS_DIR, 'dispatch', 'resume-confirmation.md'),
  path.join(SKILLS_DIR, 'flow', 'steps-and-gates.md'),
];

test('every resume path cites the run-resume-freshness fragment', () => {
  const offenders = [];
  for (const file of CALL_SITES) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(FRAGMENT)) offenders.push(path.relative(SKILLS_DIR, file));
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `these resume paths do not cite ${FRAGMENT}: ${offenders.join(', ')}`,
  );
});

test('every resume path also cites the check-resume-freshness CLI verb', () => {
  const offenders = [];
  for (const file of CALL_SITES) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('check-resume-freshness')) offenders.push(path.relative(SKILLS_DIR, file));
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `these resume paths do not invoke check-resume-freshness: ${offenders.join(', ')}`,
  );
});
