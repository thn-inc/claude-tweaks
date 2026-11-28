'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parsePolicyModelConfig, readPolicyModelConfig, stripComment, modelProfilesEntry } = require('../../../plugin/bin/lib/model-profiles/policy-fragment');

const SAMPLE = [
  'worktree-always: true',
  'model-stance: economy',
  'model-ceiling: capable',
  'frontier-run-cap: 5',
  'model-profiles:',
  '  standard:',
  '    model: opus',
  '    effort: low',
  '  capable:',
  '    effort: medium',
  '',
].join('\n');

test('parses the four keys and ignores unrelated flat keys', () => {
  assert.deepStrictEqual(parsePolicyModelConfig(SAMPLE), {
    'model-stance': 'economy',
    'model-ceiling': 'capable',
    'frontier-run-cap': 5,
    'model-profiles': {
      standard: { model: 'opus', effort: 'low' },
      capable: { effort: 'medium' },
    },
  });
});

test('empty or absent input yields an empty object', () => {
  assert.deepStrictEqual(parsePolicyModelConfig(''), {});
  assert.deepStrictEqual(parsePolicyModelConfig('worktree-always: true\n'), {});
});

test('comments and trailing whitespace are tolerated', () => {
  const raw = 'model-stance: economy   # save money\n';
  assert.deepStrictEqual(parsePolicyModelConfig(raw), { 'model-stance': 'economy' });
});

test('non-integer frontier-run-cap throws naming the value', () => {
  assert.throws(() => parsePolicyModelConfig('frontier-run-cap: soon\n'), /soon/);
});

test('unknown sub-key under a model-profiles row throws naming the line', () => {
  const raw = 'model-profiles:\n  standard:\n    speed: fast\n';
  assert.throws(() => parsePolicyModelConfig(raw), /speed/);
});

// A leading integer followed by anything else is a misread policy file, not a
// value: parseInt alone would silently yield 5. Mutating the guard away leaves
// every test above green.
test('frontier-run-cap with trailing text throws rather than truncating', () => {
  assert.throws(() => parsePolicyModelConfig('frontier-run-cap: 5 agents\n'), /5 agents/);
});

// The dedent that closes a model-profiles block must be re-scanned as a flat
// key, not consumed. Both plausible off-by-ones here (skipping the dedented
// line, or never terminating the block) survive every test above.
test('a flat key after a model-profiles block is still parsed', () => {
  const raw = 'model-profiles:\n  standard:\n    effort: low\nmodel-ceiling: capable\n';
  assert.deepStrictEqual(parsePolicyModelConfig(raw), {
    'model-profiles': { standard: { effort: 'low' } },
    'model-ceiling': 'capable',
  });
});

test('stripComment cuts at the first # anywhere and drops a CRLF \\r (#4816)', () => {
  assert.strictEqual(stripComment('model-profiles:   # project overrides\r'), 'model-profiles:');
  assert.strictEqual(stripComment('  standard:  # x\r'), '  standard:');
  assert.strictEqual(stripComment('    model: opus#note'), '    model: opus');
  assert.strictEqual(stripComment('    effort: low'), '    effort: low');
  assert.strictEqual(stripComment('    effort: low\r'), '    effort: low');
});

test('modelProfilesEntry: present, absent and malformed', () => {
  assert.deepStrictEqual(modelProfilesEntry('model-profiles:\n  standard:\n    model: opus\n'), { value: { standard: { model: 'opus' } }, source: 'policy' });
  assert.deepStrictEqual(modelProfilesEntry(null), { value: null, source: 'default' });
  assert.deepStrictEqual(modelProfilesEntry('autonomy: trusted\n'), { value: null, source: 'default' });
  assert.deepStrictEqual(modelProfilesEntry('model-profiles:\n  standard:\n    speed: x\n'), { value: null, source: 'default', invalid: true });
});

// The resolve-policy CLI read `model-profiles: {}` as a present, empty block before the block-only
// reader (#5917); a header with an inline value still opens the block. Characterization.
test('modelProfilesEntry: a header with an inline value still opens the block (pre-#5917 result)', () => {
  assert.deepStrictEqual(modelProfilesEntry('model-profiles: {}\n'), { value: {}, source: 'policy' });
  assert.deepStrictEqual(modelProfilesEntry('model-profiles: {}\n  standard:\n    model: haiku\n'), { value: { standard: { model: 'haiku' } }, source: 'policy' });
});

test('modelProfilesEntry: header variants (CRLF, trailing comment, two blocks)', () => {
  const haiku = { value: { standard: { model: 'haiku' } }, source: 'policy' };
  assert.deepStrictEqual(modelProfilesEntry('model-profiles:\r\n  standard:\r\n    model: haiku\r\n'), haiku);
  assert.deepStrictEqual(modelProfilesEntry('model-profiles:   # note\n  standard:\n    model: haiku\n'), haiku);
  // The last block wins, as parsePolicyModelConfig's last-wins assignment did.
  assert.deepStrictEqual(
    modelProfilesEntry('model-profiles:\n  standard:\n    model: haiku\nmodel-profiles:\n  capable:\n    model: opus\n'),
    { value: { capable: { model: 'opus' } }, source: 'policy' },
  );
  // Only the last block is read, so a malformed first block no longer marks the key invalid.
  assert.deepStrictEqual(
    modelProfilesEntry('model-profiles:\n  standard:\n    speed: x\nmodel-profiles:\n  capable:\n    model: opus\n'),
    { value: { capable: { model: 'opus' } }, source: 'policy' },
  );
});

test('modelProfilesEntry: a malformed sibling key never marks the block invalid', () => {
  assert.deepStrictEqual(
    modelProfilesEntry('frontier-run-cap: abc\nmodel-profiles:\n  standard:\n    model: haiku\n'),
    { value: { standard: { model: 'haiku' } }, source: 'policy' },
  );
  assert.deepStrictEqual(modelProfilesEntry('frontier-run-cap: abc\n'), { value: null, source: 'default' });
  assert.deepStrictEqual(
    modelProfilesEntry('model-profiles:\n  standard:\n    effort: low\nfrontier-run-cap: 5 agents\n'),
    { value: { standard: { effort: 'low' } }, source: 'policy' },
  );
});

test('readPolicyModelConfig: a missing file is an empty policy, an unreadable or malformed one throws naming the path', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-fragment-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'policy.yml');
  assert.deepStrictEqual(readPolicyModelConfig(file), {});
  fs.writeFileSync(file, 'model-stance: economy\n');
  assert.deepStrictEqual(readPolicyModelConfig(file), { 'model-stance': 'economy' });
  fs.writeFileSync(file, 'frontier-run-cap: lots\n');
  assert.throws(() => readPolicyModelConfig(file), (err) => err.message.startsWith('malformed ' + file + ': ') && err.message.includes('frontier-run-cap'));
  assert.throws(() => readPolicyModelConfig(dir), (err) => err.message.startsWith('cannot read ' + dir + ': '));
});
