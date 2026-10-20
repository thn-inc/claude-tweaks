// tests/harness-refusal-drift-pin.test.js
//
// Keeps tools/upstream-drift/manifest.yml's `claude-code` entry in lockstep with
// plugin/bin/lib/hooks/harness-refusal.js (#3304). post-tool-use-failure.js and
// bash-prefilter.js recognize Claude Code's worktree-isolation refusal by its
// text; a reworded refusal would silently zero the wd-guard-refusal events
// friction-events.js counts. The manifest entry asserts each fragment against the
// installed binary, so a rewording surfaces as upstream drift instead.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkAssertions } = require('../tools/upstream-drift/checks');
const { loadManifest } = require('../tools/upstream-drift/manifest');
const { REFUSAL_FRAGMENTS, REFUSAL_SIGNATURE } = require('../plugin/bin/lib/hooks/harness-refusal');

const ROOT = path.join(__dirname, '..');
const manifest = loadManifest(path.join(ROOT, 'tools', 'upstream-drift', 'manifest.yml'));
const cc = manifest.dependencies.find((d) => d.name === 'claude-code');

function assertFragmentsPinned(entry, fragments) {
  const pinned = entry.assertions.map((a) => a['must-match']);
  for (const fragment of fragments) {
    assert.ok(
      pinned.some((m) => m.includes(fragment)),
      `no claude-code assertion's must-match contains the refusal fragment ${JSON.stringify(fragment)}`,
    );
  }
}

// Stand-in for the compiled binary: non-UTF-8 bytes plus the excerpt of 2.1.302's
// embedded source that carries the refusal. The em dash is the six-character
// backslash-u2014 sequence the minified binary holds, not the character itself.
function binaryStandIn(refusalSignature) {
  // Plain strings, not template literals: the excerpt's own ${...} must stay literal.
  const excerpt = 'function NI(e){return x?{noun:"This session",possessive:"a worktree-isolated session\'s"}:{noun:"This agent",possessive:"a worktree-isolated agent\'s"}}'
    + '\n'
    + 'b=(Ie,De)=>`${h} is isolated in the worktree ${s}, but this command ${Ie}. '
    + refusalSignature + ' \\u2014 ${y} git operations must target its own worktree. ${De}`';
  return Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x80, 0xff, 0x00, 0xc3, 0x28]), Buffer.from(excerpt, 'utf8')]);
}

function writeTemp(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refusal-drift-'));
  const file = path.join(dir, 'claude');
  fs.writeFileSync(file, bytes);
  return file;
}

test('AC1.1: the claude-code entry asserts every refusal fragment harness-refusal.js matches on', () => {
  assert.ok(cc, 'manifest.yml has no claude-code entry');
  assertFragmentsPinned(cc, REFUSAL_FRAGMENTS);
  assert.strictEqual(cc['installed-probe'].type, 'command');
  assert.strictEqual(cc['version-mode'], 'floor');
});

test('AC1.1 go-red: a fragment absent from the manifest fails the pin', () => {
  assert.throws(() => assertFragmentsPinned(cc, [...REFUSAL_FRAGMENTS, 'Declining to run it']));
});

test('AC1.1: a reworded refusal in the installed artifact is reported as assertion drift', () => {
  const intact = writeTemp(binaryStandIn(REFUSAL_SIGNATURE));
  assert.strictEqual(checkAssertions(cc, { root: intact }).status, 'ok');

  const reworded = writeTemp(binaryStandIn('Declining to run it'));
  const drifted = checkAssertions(cc, { root: reworded });
  assert.strictEqual(drifted.status, 'drift');
  // Results carry the assertion's claims and a detail naming the missing literal.
  const signature = drifted.results.find((r) => r.detail.includes('"Refusing to run it"'));
  assert.ok(signature, 'no result for the must-match "Refusing to run it" assertion');
  assert.strictEqual(signature.status, 'unmatched');
  assert.deepStrictEqual(
    drifted.results.filter((r) => r !== signature).map((r) => r.status),
    ['ok', 'ok'],
    'only the reworded fragment may drift',
  );
});

test('AC1.1: no installed Claude Code means skipped assertions, never drift', () => {
  assert.strictEqual(checkAssertions(cc, { runCommand: () => null }).status, 'skipped');
});

test('AC1.1: the reflect Friction lens transcript grep names the same signature', () => {
  const prose = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'reflect', 'full-mode.md'), 'utf8');
  assert.ok(prose.includes('`' + REFUSAL_SIGNATURE + '`'), 'reflect/full-mode.md does not name the refusal signature');
});
