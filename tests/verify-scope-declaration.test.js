// tests/verify-scope-declaration.test.js — pins this repo's own
// .claude-tweaks/verify-scope.json (#1924): it parses, no source path maps
// to [], and the engine classifies the two canonical deltas as the parent
// design intends (ledger rows → none, skill prose → full). Reads the live
// file deliberately — the declaration IS the contract.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const DECL = path.join(REPO_ROOT, '.claude-tweaks', 'verify-scope.json');
const { readDeclaration } = require(path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'verify', 'declaration.js'));
const { selectScope } = require(path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'verify', 'scope.js'));
const { BOOKKEEPING_RULES } = require(path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'init', 'verify-scope-starter.js'));
const STAMP = { sha: 'a'.repeat(40), fullSha: 'a'.repeat(40), scope: 'full' };

test('this repo declares its own verify scope and it passes readDeclaration (#1924 AC5)', () => {
  assert.ok(fs.existsSync(DECL), 'missing .claude-tweaks/verify-scope.json');
  const r = readDeclaration(DECL);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.decl.suites, ['tests']);
  for (const rule of r.decl.rules) assert.ok(rule.suites === '*' || (Array.isArray(rule.suites) && rule.suites.length === 0), `rule ${rule.match} must be "*" or []`);
  for (const rule of r.decl.rules) {
    if (/^(plugin|tests|tools)\//.test(rule.match)) assert.strictEqual(rule.suites, '*', `${rule.match} must map to every suite`);
  }
});

test('a ledger-row delta resolves to none; a skill-prose delta resolves to full (#1924 AC5)', () => {
  const { decl } = readDeclaration(DECL);
  const sel = (files) => selectScope({ decl, files, stamp: STAMP });
  assert.strictEqual(sel(['docs/plans/2026-09-05-spec-1921-ledger.md']).mode, 'none');
  assert.strictEqual(sel(['.claude-tweaks/pipelines/2026-09-05T193518-x/spec-1/work/1-spec.md']).mode, 'none');
  assert.strictEqual(sel(['plugin/skills/test/SKILL.md']).mode, 'full');
  assert.strictEqual(sel(['plugin/bin/verify.js', 'docs/plans/x-ledger.md']).mode, 'full');
  assert.strictEqual(sel(['docs/skill-graph.md']).mode, 'full');
  assert.deepStrictEqual(sel(['docs/skill-graph.md']).unmatched, ['docs/skill-graph.md']);
});

test('every rule with suites:[] is one of the bookkeeping-only globs — no source tree can ever be mapped to nothing (#1924 A8)', () => {
  const { decl } = readDeclaration(DECL);
  for (const rule of decl.rules) {
    if (Array.isArray(rule.suites) && rule.suites.length === 0) {
      assert.ok(BOOKKEEPING_RULES.includes(rule.match), `${rule.match} maps to no suite but is not a bookkeeping rule`);
    }
  }
});

test('init/SKILL.md lists Step 6.6 and its sub-file exists (#1924)', () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'plugin', 'skills', 'init', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('### Step 6.6: Verify-Scope Starter'));
  assert.ok(skill.includes('bootstrap/step-06-6-verify-scope.md'));
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'plugin', 'skills', 'init', 'bootstrap', 'step-06-6-verify-scope.md')));
});
