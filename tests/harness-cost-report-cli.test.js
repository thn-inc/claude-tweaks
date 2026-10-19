// tests/harness-cost-report-cli.test.js — bin/harness-cost-report.js, the thin
// CLI over estimateHarnessCost()/flagHighToolCount() (#2741) that
// harness-health's harness cost-efficiency check shells out to, mirroring
// tests/context-cost-report-cli.test.js's shape for its sibling CLI.
// Exercised via the injectable run(argv, deps) seam (gh-api-module-pattern's
// convention for a CLI with no external process to fake) rather than
// spawning a subprocess.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../plugin/bin/harness-cost-report');
const { estimateHarnessCost, flagHighToolCount } = require('../plugin/bin/lib/skill-audit/harness-cost');
const { listSkillDirs } = require('../plugin/bin/lib/skill-audit/skill-catalog');

const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin');

function capture() {
  const out = { stdout: '', stderr: '' };
  const deps = {
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
  };
  return { out, deps };
}

test('--help prints usage and exits 0, without touching the plugin corpus', () => {
  const { out, deps } = capture();
  const code = run(['--help'], deps);
  assert.strictEqual(code, 0);
  assert.match(out.stdout, /^usage: harness-cost-report\.js/);
  assert.strictEqual(out.stderr, '');
});

test('an unknown flag is rejected with exit 2 and no stdout', () => {
  const { out, deps } = capture();
  const code = run(['--bogus'], deps);
  assert.strictEqual(code, 2);
  assert.strictEqual(out.stdout, '');
  assert.match(out.stderr, /unknown argument: --bogus/);
});

test('missing --plugin-root is rejected with exit 2', () => {
  const { out, deps } = capture();
  const code = run([], deps);
  assert.strictEqual(code, 2);
  assert.match(out.stderr, /--plugin-root <dir> is required/);
});

test('a non-numeric --ratio-threshold is rejected with exit 2', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', PLUGIN_ROOT, '--ratio-threshold', 'nope'], deps);
  assert.strictEqual(code, 2);
  assert.match(out.stderr, /--ratio-threshold must be a number/);
});

test('a repo-root path (no skills/ beneath it) surfaces an error on stderr, exit 2', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', path.join(__dirname, '..')], deps);
  assert.strictEqual(code, 2);
  assert.ok(out.stderr.startsWith('harness-cost-report.js: '), `expected a prefixed error, got: ${out.stderr}`);
});

test('--plugin-root <plugin/> emits one JSON line matching estimateHarnessCost() row-for-row', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', PLUGIN_ROOT], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(out.stderr, '');
  const lines = out.stdout.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, 'stdout must be exactly one JSON line');
  const report = JSON.parse(lines[0]);
  const expected = estimateHarnessCost(PLUGIN_ROOT);

  assert.strictEqual(report.totalSkills, listSkillDirs(PLUGIN_ROOT).length);
  assert.strictEqual(report.totalSkills, expected.totalSkills);
  assert.strictEqual(report.totalAgents, expected.totalAgents);
  assert.strictEqual(report.unscopedCount, expected.unscopedCount);
  assert.deepStrictEqual(report.entries, expected.entries);
  assert.deepStrictEqual(report.flagged, flagHighToolCount(expected.entries));
});

test('AC1.1: --plugin-root <plugin/> output includes qa-agent marked as an agent', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', PLUGIN_ROOT], deps);
  assert.strictEqual(code, 0);
  const report = JSON.parse(out.stdout.trim());
  const qa = report.entries.find((e) => e.name === 'qa-agent');
  assert.ok(qa, 'expected a qa-agent entry');
  assert.strictEqual(qa.kind, 'agent');
});

test('a high-tool-count agent is flagged like a skill', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cost-report-agent-'));
  fs.mkdirSync(path.join(root, 'skills', 's'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 's', 'SKILL.md'), '---\nname: s\nallowed-tools: Read\n---\nbody\n');
  fs.mkdirSync(path.join(root, 'agents'));
  fs.writeFileSync(
    path.join(root, 'agents', 'wide.md'),
    '---\nname: wide\ntools: Read, Write, Edit, Bash, Grep, Glob, Skill, Agent, WebFetch\n---\nbody\n',
  );
  const { out, deps } = capture();
  const code = run(['--plugin-root', root], deps);
  assert.strictEqual(code, 0);
  const report = JSON.parse(out.stdout.trim());
  assert.deepStrictEqual(report.flagged.map((e) => `${e.kind}:${e.name}`), ['agent:wide']);
  assert.strictEqual(report.totalAgents, 1);
  assert.strictEqual(report.unscopedAgentCount, 0);
});

test('an agent with no tools: line is counted in unscopedAgentCount, not unscopedCount', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cost-report-unscoped-agent-'));
  fs.mkdirSync(path.join(root, 'skills', 's'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 's', 'SKILL.md'), '---\nname: s\nallowed-tools: Read\n---\nbody\n');
  fs.mkdirSync(path.join(root, 'agents'));
  fs.writeFileSync(path.join(root, 'agents', 'open.md'), '---\nname: open\n---\nbody\n');
  const { out, deps } = capture();
  const code = run(['--plugin-root', root], deps);
  assert.strictEqual(code, 0);
  const report = JSON.parse(out.stdout.trim());
  assert.strictEqual(report.unscopedAgentCount, 1);
  assert.strictEqual(report.unscopedCount, 0);
});

test('--ratio-threshold 0 flags every skill or agent with a declared (non-null) tool count', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', PLUGIN_ROOT, '--ratio-threshold', '0'], deps);
  assert.strictEqual(code, 0);
  const report = JSON.parse(out.stdout.trim());
  const scopedCount = report.entries.filter((e) => e.toolCount !== null).length;
  assert.strictEqual(report.flagged.length, scopedCount);
});
