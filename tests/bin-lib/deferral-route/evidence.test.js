'use strict';
// checkEvidence (#5933): the form-only evidence check behind policy key
// filed-record-evidence. `test:{path}` must be a regular file under the git top
// level, `ref:{id}` a #N or IL-N id. The fixture tree holds one target per guard
// so each guard is the only thing that can reject its own row.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  checkEvidence, EVIDENCE_KINDS, EVIDENCE_PROBLEMS, REF_ID_RE,
} = require('../../../plugin/bin/lib/deferral-route/evidence');
const { scratchDir, removeScratchDir } = require('../../helpers/tmp-dir');

const PARENT = scratchDir('ct-evidence-', { realpath: true });
after(() => removeScratchDir(PARENT));
const ROOT = path.join(PARENT, 'root');
fs.mkdirSync(path.join(ROOT, 'tests'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tests', 'example.test.js'), '// fixture\n');
fs.writeFileSync(path.join(ROOT, '%41.js'), '// fixture\n');
fs.writeFileSync(path.join(PARENT, 'outside.js'), '// fixture\n');

function trySymlink(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') return false;
    throw err;
  }
}
const HAS_LINKS = trySymlink(path.join(PARENT, 'outside.js'), path.join(ROOT, 'link.js'))
  && trySymlink(path.join(ROOT, 'tests', 'example.test.js'), path.join(ROOT, 'inlink.js'));

const TOPLINK = path.join(PARENT, 'toplink');
const HAS_TOPLINK = trySymlink(ROOT, TOPLINK);

const HAS_COLON_NAMES = process.platform !== 'win32';
if (HAS_COLON_NAMES) {
  fs.mkdirSync(path.join(ROOT, 'file:'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'file:', 'x.js'), '// fixture\n');
}

const check = (text, topLevel = ROOT) => checkEvidence(text, { topLevel });
const bad = (problem) => ({ valid: false, problem });

test('exports are frozen and match the contract', () => {
  assert.deepEqual([...EVIDENCE_KINDS], ['test', 'ref']);
  assert.ok(Object.isFrozen(EVIDENCE_KINDS));
  assert.ok(Object.isFrozen(EVIDENCE_PROBLEMS));
  assert.deepEqual([...EVIDENCE_PROBLEMS], [
    'empty', 'form', 'kind', 'empty-ref', 'ref-id', 'absolute', 'scheme', 'percent',
    'trailing-slash', 'no-top-level', 'missing', 'outside', 'not-a-file',
  ]);
  assert.ok(REF_ID_RE.test('#1') && REF_ID_RE.test('IL-9') && !REF_ID_RE.test('#'));
});

test('AC4.1 ref:#1234 and ref:IL-85 are valid', () => {
  assert.deepEqual(check('ref:#1234'), { valid: true, kind: 'ref', ref: '#1234' });
  assert.deepEqual(check('ref:IL-85'), { valid: true, kind: 'ref', ref: 'IL-85' });
  assert.deepEqual(check('ref:#1234', null), { valid: true, kind: 'ref', ref: '#1234' });
  assert.deepEqual(check('ref:IL-85', null), { valid: true, kind: 'ref', ref: 'IL-85' });
});

test('AC4.2 ref:soon is not valid', () => {
  for (const t of ['ref:soon', 'ref:#', 'ref:IL-', 'ref: #12', 'ref:#12x']) {
    assert.deepEqual(check(t), bad('ref-id'), t);
  }
});

test('AC3.1 test:../outside.js, test:missing.test.js and note:anything are invalid', () => {
  assert.deepEqual(check('test:../outside.js'), bad('outside'));
  assert.deepEqual(check('test:missing.test.js'), bad('missing'));
  assert.deepEqual(check('note:anything'), bad('kind'));
});

test('AC3.2 traversal, absolute, scheme, percent, trailing slash and an escaping symlink are invalid', (t) => {
  assert.deepEqual(check('test:a/../../outside.js'), bad('outside'));
  assert.deepEqual(check('test:/etc/passwd'), bad('absolute'));
  assert.deepEqual(check('test:file:///etc/passwd'), bad('scheme'));
  assert.deepEqual(check('test:%2e%2e/outside.js'), bad('percent'));
  assert.deepEqual(check('test:tests/'), bad('trailing-slash'));
  if (!HAS_LINKS) return t.skip('symlinks unavailable');
  assert.deepEqual(check('test:link.js'), bad('outside'));
});

test('AC12.1 a file-and-line pointer is not evidence', () => {
  assert.deepEqual(check('plugin/bin/example.js:10'), bad('kind'));
  assert.deepEqual(checkEvidence('plugin/bin/example.js:10', { topLevel: null }), bad('kind'));
});

test('AC2.2 test:tests/example.test.js inside the tree is valid', () => {
  assert.deepEqual(check('test:tests/example.test.js'), { valid: true, kind: 'test', ref: 'tests/example.test.js' });
});

test('form problems', () => {
  assert.deepEqual(check(''), bad('empty'));
  assert.deepEqual(check(undefined), bad('empty'));
  assert.deepEqual(check('nothing'), bad('form'));
  assert.deepEqual(check('TEST:tests/example.test.js'), bad('kind'));
  assert.deepEqual(check('test:'), bad('empty-ref'));
  assert.deepEqual(check('ref:'), bad('empty-ref'));
});

test('no top level makes test evidence invalid, ref evidence still valid', () => {
  assert.deepEqual(check('test:tests/example.test.js', null), bad('no-top-level'));
  assert.deepEqual(check('ref:#7', null), { valid: true, kind: 'ref', ref: '#7' });
});

test('review focus 5: an in-tree symlink to a file is valid, a directory is not a file', (t) => {
  assert.deepEqual(check('test:tests'), bad('not-a-file'));
  if (!HAS_LINKS) return t.skip('symlinks unavailable');
  assert.deepEqual(check('test:inlink.js'), { valid: true, kind: 'test', ref: 'inlink.js' });
});

test('a top level reached through a symlink is canonicalized before the containment check', (t) => {
  if (!HAS_TOPLINK || !HAS_LINKS) return t.skip('symlinks unavailable');
  assert.deepEqual(check('test:tests/example.test.js', TOPLINK), { valid: true, kind: 'test', ref: 'tests/example.test.js' });
  assert.deepEqual(check('test:inlink.js', TOPLINK), { valid: true, kind: 'test', ref: 'inlink.js' });
  assert.deepEqual(check('test:link.js', TOPLINK), bad('outside'));
});

test('guard discrimination: each test-path guard alone decides one existing in-tree target', (t) => {
  assert.deepEqual(check(`test:${path.join(ROOT, 'tests', 'example.test.js')}`), bad('absolute'));
  assert.deepEqual(check('test:%41.js'), bad('percent'));
  assert.deepEqual(check('test:tests/example.test.js/'), bad('trailing-slash'));
  assert.deepEqual(check('test:tests'), bad('not-a-file'));
  assert.deepEqual(check('test:../outside.js'), bad('outside'));
  if (HAS_COLON_NAMES) assert.deepEqual(check('test:file:/x.js'), bad('scheme'));
  else t.diagnostic('file: scheme row skipped on win32');
});
