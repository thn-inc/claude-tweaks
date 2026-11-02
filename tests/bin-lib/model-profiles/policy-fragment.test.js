'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parsePolicyModelConfig, stripComment } = require('../../../plugin/bin/lib/model-profiles/policy-fragment');

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
});
