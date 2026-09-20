// tests/bin-lib/verify/snippet-conformance.test.js
// Pins verification.md's embedded verify.js invocations — both the canonical
// (unscoped) invocation and the scoped re-verify invocation — to the CLI's
// real arg parser (#892 AC8, #1923): a flag drift in either direction turns
// this red.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const DOC = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'test', 'verification.md'), 'utf8');
const { parseArgs, UsageError } = require(
  path.join(ROOT, 'plugin', 'bin', 'lib', 'verify', 'args.js'));

// The one fenced bash block that RUNS bin/verify.js with the canonical
// (unscoped) --cmd set; the scoped re-verify invocation is pinned separately
// by extractScopedSnippet() below, and the --stamp-status read block by
// extractStampStatusSnippet().
function extractSnippet() {
  const blocks = [...DOC.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const hits = blocks.filter((b) => b.includes('bin/verify.js') && b.includes('--cmd') && !b.includes('--scope'));
  assert.strictEqual(hits.length, 1,
    `expected exactly one fenced canonical (unscoped) bin/verify.js --cmd invocation, found ${hits.length}`);
  return hits[0].trim();
}

// The one fenced bash block that runs bin/verify.js with --scope (#1923's
// scoped re-verify invocation).
function extractScopedSnippet() {
  const blocks = [...DOC.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const hits = blocks.filter((b) => b.includes('bin/verify.js') && b.includes('--scope'));
  assert.strictEqual(hits.length, 1,
    `expected exactly one fenced bin/verify.js --scope invocation, found ${hits.length}`);
  return hits[0].trim();
}

function extractStampStatusSnippet() {
  const blocks = [...DOC.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const hits = blocks.filter((b) => b.includes('bin/verify.js') && b.includes('--stamp-status'));
  assert.strictEqual(hits.length, 1,
    `expected exactly one fenced bin/verify.js --stamp-status invocation, found ${hits.length}`);
  return hits[0].trim();
}

// Tokenize the snippet's argv after the script path: an argv word is a run of
// non-whitespace where a quoted span may sit anywhere inside it (shell joins
// adjacent quoted/unquoted segments into one word, e.g. name="value with spaces"),
// so quotes are stripped from the whole word rather than only its edges; $(...)
// inside a word collapses to one dummy-substituted value.
function snippetArgv(snippet) {
  assert.ok(!snippet.includes(';') && !snippet.includes('&&') && !snippet.includes('|'),
    'AC8: the invocation must be one plain command — no ;, && or pipes');
  const afterScript = snippet.split('bin/verify.js"')[1];
  assert.ok(afterScript, 'snippet must invoke ".../bin/verify.js"');
  const tokens = afterScript.match(/(?:"[^"]*"|\S)+/g) || [];
  return tokens.map((t) => t.replace(/"/g, '').replace(/\$\([^)]*\)/g, '/dummy'));
}

test('the embedded snippet parses clean through the real arg parser (AC8)', () => {
  const argv = snippetArgv(extractSnippet());
  const parsed = parseArgs(argv);
  assert.ok(parsed.cmds.length >= 1, 'snippet must pass at least one --cmd');
});

test('negative control: the parser rejects an unknown flag, so drift turns this suite red', () => {
  assert.throws(() => parseArgs(['--not-a-real-flag']), UsageError);
});

test('the snippet tokenizer itself can go red on an injected unknown flag', () => {
  const mutated = extractSnippet() + ' --bogus';
  assert.throws(() => parseArgs(snippetArgv(mutated)), UsageError);
});

test('the retired capture recipe is gone from verification.md (AC8/AC11)', () => {
  assert.ok(!/verify-test\.log/.test(DOC), 'verify-test.log recipe still present');
  assert.ok(!/Capture, never stream/i.test(DOC), '"Capture, never stream" heading still present');
  assert.ok(!/LOG=/.test(DOC), 'LOG= capture recipe still present');
});

test('the canonical invocation carries no $(git rev-parse ...) substitution — the runner resolves its own paths (#1921 AC5)', () => {
  assert.ok(!extractSnippet().includes('$(git rev-parse'), 'Step 2 invocation still substitutes a git dir');
});

test('the --stamp-status read block parses clean through the real arg parser (#1921)', () => {
  const argv = snippetArgv(extractStampStatusSnippet());
  const parsed = parseArgs(argv);
  assert.strictEqual(parsed.stampStatus, true);
});

test('the scoped re-verify invocation parses clean through the real arg parser and names every required flag (#1923)', () => {
  const argv = snippetArgv(extractScopedSnippet().replace('{ref}', 'main'));
  const parsed = parseArgs(argv);
  assert.strictEqual(parsed.scope, '.claude-tweaks/verify-scope.json');
  assert.strictEqual(parsed.integrationBranch, 'main');
  assert.ok(parsed.cmds.length >= 1, 'the scoped invocation must still pass the full --cmd set');
  assert.ok(!extractScopedSnippet().includes('$(git rev-parse'), 'the scoped invocation must not substitute a git dir');
});

test('the scoped snippet tokenizer can go red on an injected unknown flag (#1923)', () => {
  const mutated = extractScopedSnippet().replace('{ref}', 'main') + ' --bogus';
  assert.throws(() => parseArgs(snippetArgv(mutated)), UsageError);
});

test('agents never write the stamp: no redirect into claude-tweaks-verify-pass remains, and the foreground rule is stated (#1921 AC6)', () => {
  assert.ok(!/>\s*"?\$\(git rev-parse --git-dir\)\/claude-tweaks-verify-pass/.test(DOC), 'a write into the bare stamp file remains');
  assert.ok(!/git rev-parse HEAD > /.test(DOC), 'the agent-side stamp write command remains');
  assert.ok(DOC.includes('run_in_background'), 'the foreground rule must name run_in_background');
});
