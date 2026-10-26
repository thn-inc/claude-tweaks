// tests/harness-refusal-drift-pin.test.js
//
// Keeps tools/upstream-drift/manifest.yml's `claude-code` entry in lockstep with
// plugin/bin/lib/hooks/harness-refusal.js (#3304). post-tool-use-failure.js and
// bash-prefilter.js recognize Claude Code's worktree-isolation refusal by its
// text; a reworded refusal would silently zero the wd-guard-refusal events
// friction-events.js counts. The manifest entry asserts each fragment against the
// installed binary, so a rewording surfaces as upstream drift instead.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkAssertions } = require('../tools/upstream-drift/checks');
const { loadManifest } = require('../tools/upstream-drift/manifest');
const { REFUSAL_FRAGMENTS, REFUSAL_SIGNATURE } = require('../plugin/bin/lib/hooks/harness-refusal');
const { readText } = require('./helpers/read-skill');

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

// The em dash as the minified binary holds it: the six-character backslash-u2014
// sequence, not the character itself.
const DASH = '\\' + 'u2014';

// Stand-in for the compiled binary: non-UTF-8 bytes plus the excerpts of 2.1.302's
// embedded source that matter: the git-operations refusal template, one cwd-escape
// refusal template, and an unrelated message that carries the bare fragments
// elsewhere (which is why the fragment assertions alone cannot catch a targeted
// rewording). Plain strings, not template literals: the ${...} must stay literal.
function binaryStandIn({ gitVerb = 'Refusing', cwdVerb = 'Refusing' } = {}) {
  const excerpt = 'function NI(e){return x?{noun:"This session",possessive:"a worktree-isolated session\'s"}:{noun:"This agent",possessive:"a worktree-isolated agent\'s"}}'
    + '\n'
    + 'b=(Ie,De)=>`${h} is isolated in the worktree ${s}, but this command ${Ie}. '
    + gitVerb + ' to run it ' + DASH + ' ${y} git operations must target its own worktree. ${De}`'
    + '\n'
    + 'c=`${h} is isolated in the worktree ${b}, but this command\'s working directory (${d}) is in a different worktree (${w}). '
    + cwdVerb + ' to run it there ' + DASH + ' ${h} commands must run inside its own worktree. ${z}`'
    + '\n'
    + 'u=`This agent is isolated in the worktree ${x}, but its isolation context was lost. Refusing to run it.`';
  return Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x80, 0xff, 0x00, 0xc3, 0x28]), Buffer.from(excerpt, 'utf8')]);
}

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function writeTemp(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refusal-drift-'));
  tempDirs.push(dir);
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
  assert.throws(
    () => assertFragmentsPinned(cc, [...REFUSAL_FRAGMENTS, 'Declining to run it']),
    { name: 'AssertionError' },
  );
});

// Five assertions, by position: three fragments, then the two template anchors.
const GIT_ANCHOR = 3;
const CWD_ANCHOR = 4;

// Statuses of every assertion except the one at `index`.
function othersStatuses(result, index) {
  return result.results.filter((_, i) => i !== index).map((r) => r.status);
}

test('AC1.1: the intact stand-in satisfies all five assertions', () => {
  const result = checkAssertions(cc, { root: writeTemp(binaryStandIn()) });
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.results.map((r) => r.status), ['ok', 'ok', 'ok', 'ok', 'ok']);
});

test('AC1.1: rewording only the git-operations template is reported as drift on its anchor', () => {
  const drifted = checkAssertions(cc, { root: writeTemp(binaryStandIn({ gitVerb: 'Declining' })) });
  assert.strictEqual(drifted.status, 'drift');
  assert.match(drifted.results[GIT_ANCHOR].claims, /git-operations refusal/);
  assert.strictEqual(drifted.results[GIT_ANCHOR].status, 'unmatched');
  // The unrelated message still carries the bare fragments: only the anchor can see this.
  assert.deepStrictEqual(othersStatuses(drifted, GIT_ANCHOR), ['ok', 'ok', 'ok', 'ok']);
});

test('AC1.1: rewording only the cwd template is reported as drift on its anchor', () => {
  const drifted = checkAssertions(cc, { root: writeTemp(binaryStandIn({ cwdVerb: 'Declining' })) });
  assert.strictEqual(drifted.status, 'drift');
  assert.match(drifted.results[CWD_ANCHOR].claims, /cwd-escape refusals/);
  assert.strictEqual(drifted.results[CWD_ANCHOR].status, 'unmatched');
  assert.deepStrictEqual(othersStatuses(drifted, CWD_ANCHOR), ['ok', 'ok', 'ok', 'ok']);
});

test('AC1.1: no installed Claude Code means skipped assertions, never drift', () => {
  assert.strictEqual(checkAssertions(cc, { runCommand: () => null }).status, 'skipped');
});

test('AC1.1: the reflect Friction lens transcript grep names the same signature', () => {
  const prose = readText(path.join(ROOT, 'plugin', 'skills', 'reflect', 'full-mode.md'));
  assert.ok(prose.includes('`' + REFUSAL_SIGNATURE + '`'), 'reflect/full-mode.md does not name the refusal signature');
});
