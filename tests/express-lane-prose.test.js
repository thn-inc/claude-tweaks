'use strict';
// tests/express-lane-prose.test.js — #4025: pins the decisions plugin/skills/_shared/express-lane.md
// states (the express agent's procedure, which /dispatch and /flow cite by section name), the
// file's roster entry in _shared/ceremony-profile.md, and the express-review row in
// _shared/pr-run-comments.md's Comment kinds. All three are new prose in this change, so every
// go-red control mutates the live text in memory (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SHARED = path.join(__dirname, '..', 'plugin', 'skills', '_shared');
const EXPRESS = readText(path.join(SHARED, 'express-lane.md'));
const CEREMONY = readText(path.join(SHARED, 'ceremony-profile.md'));
const COMMENTS = readText(path.join(SHARED, 'pr-run-comments.md'));

const SECTIONS = ['## Eligibility', '## Procedure', '## Escalation', '## Outcomes', '## Post-merge sampling'];
const headingRe = (h) => new RegExp(`^${h}$`, 'm');

// One pattern per fact, each matching exactly once, so stripping it reports exactly itself.
const FACTS = [
  ...SECTIONS.map((h) => [headingRe(h), `heading ${h}`]),
  [/express-lane\.js" gate --issue \{n\} --run "\{run-dir\}"/, 'gate verb'],
  [/express-lane\.js" check --run "\{run-dir\}" --issue \{n\} --integration-branch \{ref\}/, 'check verb'],
  [/express-lane\.js" escalate --run "\{run-dir\}" --issue \{n\} --reason \{reason\} --detail-file "\{detail-file\}"/, 'escalate verb'],
  [/express-lane\.js" verify --run "\{run-dir\}" --issue \{n\}/, 'verify verb'],
  [/express-lane\.js" samples`/, 'samples verb'],
  [/merge-verification [^\n.]*never `off`/, 'AC4.1 prose: merge-verification never off'],
  [/Express merges require CI green/, 'AC4.1 prose: express merges require CI green'],
  [/`failing-test`, `out-of-bounds`, `gate-denial`, `express-error`/, 'the four escalation reasons'],
  [/only before the push/, 'escalation only before the push'],
  [/\*\*Commit the edit\*\*[^\n]*before any test/, 'commit before any test'],
  [/record-pr --run "\{run-dir\}" \{number\} \{url\}`, then `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/set-config\.js" --run "\{run-dir\}" --set \{configSet\}`/, 'set-config.js configSet right after record-pr'],
  [/`<!-- run-comment: express-review -->`/, 'express-review marker'],
  [/`bookkeepingPermissions\(ceiling\)\.consoleAutoResolve`/, 'consoleAutoResolve gates filing'],
  [/`merged` \| `armed` \| `pending-review` \| `express-escalated` \| `blocked`/, 'outcome vocabulary'],
];

const missingFacts = (text) => FACTS.filter(([re]) => !re.test(text)).map(([, fact]) => fact);

function assertSectionOrder(text, headings) {
  let last = -1;
  for (const h of headings) {
    const m = headingRe(h).exec(text);
    assert.ok(m, `missing ${h}`);
    assert.ok(m.index > last, `${h} is out of order`);
    last = m.index;
  }
}

// The text with the block under heading `a` moved above the block under heading `b`.
function moveAbove(text, a, b) {
  const blocks = text.split(/\n(?=## )/);
  const ia = blocks.findIndex((x) => x.startsWith(`${a}\n`));
  const ib = blocks.findIndex((x) => x.startsWith(`${b}\n`));
  assert.ok(ia !== -1 && ib !== -1, `${a} and ${b} must both head a block`);
  const [moved] = blocks.splice(ia, 1);
  blocks.splice(ib, 0, moved);
  return blocks.join('\n');
}

test('express-lane.md states every fact the express lane relies on', () => {
  assert.deepEqual(missingFacts(EXPRESS), []);
});

test('go-red control: stripping one fact reports exactly that fact', () => {
  for (const [re, fact] of FACTS) {
    const stripped = EXPRESS.replace(re, '');
    assert.notEqual(stripped, EXPRESS, `anchor for "${fact}" not found`);
    assert.deepEqual(missingFacts(stripped), [fact], `removing only "${fact}" must turn exactly that fact red`);
  }
});

test('express-lane.md carries its five sections in the order /dispatch and /flow cite them', () => {
  assertSectionOrder(EXPRESS, SECTIONS);
});

test('go-red control: each adjacent pair of sections swapped fails the order check', () => {
  for (let i = 0; i + 1 < SECTIONS.length; i++) {
    const permuted = moveAbove(EXPRESS, SECTIONS[i + 1], SECTIONS[i]);
    assert.notEqual(permuted, EXPRESS);
    assert.throws(() => assertSectionOrder(permuted, SECTIONS), { message: `${SECTIONS[i + 1]} is out of order` });
  }
});

const CEREMONY_ORDER = ['## Never skipped', '## Express lane', '## Mentions that are not skips'];

test('ceremony-profile.md carries ## Express lane right after ## Never skipped', () => {
  assertSectionOrder(CEREMONY, CEREMONY_ORDER);
});

test('go-red control: a missing or misplaced ## Express lane fails the roster check', () => {
  const removed = CEREMONY.replace(/^## Express lane$/m, '');
  assert.notEqual(removed, CEREMONY);
  assert.throws(() => assertSectionOrder(removed, CEREMONY_ORDER), { message: 'missing ## Express lane' });
  const permuted = moveAbove(CEREMONY, '## Express lane', '## Never skipped');
  assert.notEqual(permuted, CEREMONY);
  assert.throws(() => assertSectionOrder(permuted, CEREMONY_ORDER), { message: '## Express lane is out of order' });
});

function commentKinds(text) {
  const start = text.indexOf('\n## Comment kinds\n');
  assert.notEqual(start, -1, 'pr-run-comments.md lacks ## Comment kinds');
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

const KIND_ROW = /^\| `express-review` \|[^\n]*`_shared\/express-lane\.md`[^\n]*\| `<!-- run-comment: express-review -->`[^\n]*\|$/m;

test("pr-run-comments.md's Comment kinds lists express-review, posted per _shared/express-lane.md", () => {
  assert.match(commentKinds(COMMENTS), KIND_ROW);
});

test('go-red control: the Comment kinds check fails without the express-review row', () => {
  const removed = COMMENTS.replace(KIND_ROW, '');
  assert.notEqual(removed, COMMENTS);
  assert.doesNotMatch(commentKinds(removed), KIND_ROW);
});
