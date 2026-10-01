'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-agent-trust-'));
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const {
  scanAgentTrustScope,
  candidatesAgentTrustScope,
  AUTONOMY_ELEVATED,
} = require('../../../plugin/bin/lib/code-health/candidates-agent-trust-scope');

// ── Negative fixture: no policy.yml at all ──────────────────────────────

test('no .claude-tweaks/policy.yml: not applicable, zero candidates', () => {
  const root = tmp();
  const result = scanAgentTrustScope(root);
  assert.equal(result.notApplicable, true);
  assert.match(result.notApplicableReason, /no \.claude-tweaks\/policy\.yml/);
  assert.deepStrictEqual(result.candidates, []);
  assert.equal(result.discoveryFailed, false);
});

// ── Autonomy not elevated: zero candidates, applicable ──────────────────

test('autonomy not unattended/trusted: zero candidates, not notApplicable', () => {
  const root = tmp();
  write(root, '.claude-tweaks/policy.yml', 'autonomy: default\n');
  const result = scanAgentTrustScope(root);
  assert.equal(result.notApplicable, false);
  assert.deepStrictEqual(result.candidates, []);
});

test('policy.yml with no autonomy key at all: zero candidates', () => {
  const root = tmp();
  write(root, '.claude-tweaks/policy.yml', 'work-backend: github-issues\n');
  const result = scanAgentTrustScope(root);
  assert.equal(result.notApplicable, false);
  assert.deepStrictEqual(result.candidates, []);
});

// ── Elevated autonomy, no settings.json at all: all three fire, anchored
//    to the policy file (the only file that exists) ─────────────────────

test('unattended + no settings.json: three findings anchored to policy.yml', () => {
  const root = tmp();
  write(root, '.claude-tweaks/policy.yml', 'autonomy: unattended\n');
  const result = scanAgentTrustScope(root);
  assert.equal(result.notApplicable, false);
  assert.equal(result.candidates.length, 3);
  const kinds = result.candidates.map((c) => c.kind).sort();
  assert.deepStrictEqual(kinds, ['credential-scope', 'network-egress', 'registry-access']);
  for (const c of result.candidates) {
    assert.equal(c.file, '.claude-tweaks/policy.yml');
  }
});

// ── Elevated autonomy + settings.json present but empty deny list ───────

test('unattended + settings.json with no permissions.deny: three findings anchored to settings.json', () => {
  const root = tmp();
  write(root, '.claude-tweaks/policy.yml', 'autonomy: unattended\n');
  write(root, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Read(node_modules/**)'] } }));
  const result = scanAgentTrustScope(root);
  assert.equal(result.candidates.length, 3);
  for (const c of result.candidates) {
    assert.equal(c.file, '.claude/settings.json');
  }
});

// ── Elevated autonomy + settings.json whose deny list covers all three ──

test('unattended + settings.json covering all three dimensions: zero candidates', () => {
  const root = tmp();
  write(root, '.claude-tweaks/policy.yml', 'autonomy: unattended\n');
  write(root, '.claude/settings.json', JSON.stringify({
    permissions: {
      deny: [
        'Bash(npm publish:*)',
        'WebFetch',
        'Bash(curl:*)',
        'Read(.env)',
        'Read(**/credentials/**)',
      ],
    },
  }));
  const result = scanAgentTrustScope(root);
  assert.deepStrictEqual(result.candidates, []);
});

// ── Partial coverage: only network-egress is denied ─────────────────────

test('trusted + deny covers only network-egress: the other two dimensions still fire', () => {
  const root = tmp();
  write(root, '.claude-tweaks/policy.yml', 'autonomy: trusted\n');
  write(root, '.claude/settings.json', JSON.stringify({
    permissions: { deny: ['WebFetch', 'Bash(curl:*)', 'Bash(wget:*)'] },
  }));
  const result = scanAgentTrustScope(root);
  const kinds = result.candidates.map((c) => c.kind).sort();
  assert.deepStrictEqual(kinds, ['credential-scope', 'registry-access']);
});

// ── Unparseable settings.json: skipped, falls back to policy.yml anchor ─

test('unparseable settings.json: skipped, candidates still fire anchored to policy.yml', () => {
  const root = tmp();
  write(root, '.claude-tweaks/policy.yml', 'autonomy: unattended\n');
  write(root, '.claude/settings.json', '{ not valid json');
  const result = scanAgentTrustScope(root);
  assert.equal(result.skippedFiles.length, 1);
  assert.equal(result.skippedFiles[0].file, '.claude/settings.json');
  assert.equal(result.candidates.length, 3);
  for (const c of result.candidates) {
    assert.equal(c.file, '.claude-tweaks/policy.yml');
  }
});

// ── candidatesAgentTrustScope is the bare-array convenience wrapper ─────

test('candidatesAgentTrustScope returns the bare candidates array', () => {
  const root = tmp();
  write(root, '.claude-tweaks/policy.yml', 'autonomy: unattended\n');
  const candidates = candidatesAgentTrustScope(root);
  assert.equal(candidates.length, 3);
});

test('AUTONOMY_ELEVATED names exactly the two unattended-style levels', () => {
  assert.deepStrictEqual([...AUTONOMY_ELEVATED].sort(), ['trusted', 'unattended']);
});

// ── Reverting the fix: a naive "always flag" implementation would not
//    discriminate the not-applicable / non-elevated cases from the
//    elevated-with-gap case. Confirm each distinguishing input path above
//    takes a materially different code path (checked structurally): the
//    not-applicable check short-circuits before any candidate push, and the
//    autonomy gate short-circuits the dimension checks entirely. ─────────

test('discrimination: notApplicable and non-elevated paths never reach candidate generation', () => {
  const root = tmp();
  // No policy.yml: notApplicable short-circuit.
  assert.deepStrictEqual(scanAgentTrustScope(root).candidates, []);
  // Policy present, autonomy absent: falls through the elevated-check guard.
  write(root, '.claude-tweaks/policy.yml', 'mode: auto\n');
  assert.deepStrictEqual(scanAgentTrustScope(root).candidates, []);
});
