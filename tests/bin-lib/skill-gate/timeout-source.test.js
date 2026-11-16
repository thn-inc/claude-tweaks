// tests/bin-lib/skill-gate/timeout-source.test.js — a source scan of the skill
// gate's two git call sites (record #5605): each `timeout:` option must be the
// shared getter, never a literal or a constant of the gate's own. Read over
// comment-stripped text, after a stripper-verdict check, per
// .claude/skills/bin-source-scan-conformance/SKILL.md. Recall limit: a
// `timeout` set through a spread or a computed key is not seen.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { readText } = require('../../helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');

const TIMEOUT_SITE = /\btimeout\s*:\s*([^,}\n]+)/g;
const SHARED_TIMEOUT = 'sharedPrimitives.GIT_TIMEOUT_MS';

function timeoutOffenders(raw) {
  const stripped = stripComments(raw);
  const verdict = stripperVerdict(raw, stripped);
  if (verdict !== 'ok') return { sites: 0, offenders: [STRIPPER_VERDICT_MESSAGES[verdict]] };
  const values = [...stripped.matchAll(TIMEOUT_SITE)].map((m) => m[1].trim());
  return { sites: values.length, offenders: values.filter((v) => v !== SHARED_TIMEOUT) };
}

test('git calls take their timeout from the shared getter, with no literal of their own', () => {
  for (const rel of [['plugin', 'bin', 'skill-gate.js'], ['plugin', 'bin', 'lib', 'skill-gate', 'index.js']]) {
    const { sites, offenders } = timeoutOffenders(readText(path.resolve(__dirname, '..', '..', '..', ...rel)));
    assert.equal(sites, 1, `${rel.join('/')}: the one git call site must pass timeout: ${SHARED_TIMEOUT}`);
    assert.deepEqual(offenders, [], rel.join('/'));
  }
});

test('timeout scan self-test: a literal, an indirect constant and a comment-only mention are told apart', () => {
  assert.deepEqual(timeoutOffenders(`const x = { timeout: ${SHARED_TIMEOUT} };`), { sites: 1, offenders: [] });
  assert.equal(timeoutOffenders('const x = { timeout: 30000 };').offenders.length, 1);
  assert.equal(timeoutOffenders('const T = 5;\nconst x = { timeout: T };').offenders.length, 1);
  // a comment naming the getter does not satisfy the scan, and one holding a literal is not a site
  assert.equal(timeoutOffenders(`// timeout: ${SHARED_TIMEOUT}\nconst x = { timeout: 5 };`).sites, 1);
  assert.deepEqual(timeoutOffenders(`// timeout: 5\nconst x = { timeout: ${SHARED_TIMEOUT} };`), { sites: 1, offenders: [] });
  // text the stripper verdict cannot judge (does not compile as CommonJS) is an offender, not a clean scan
  const unparseable = timeoutOffenders(`import x from 'y';\nconst o = { timeout: ${SHARED_TIMEOUT} };`);
  assert.equal(unparseable.sites, 0);
  assert.equal(unparseable.offenders.length, 1);
});
