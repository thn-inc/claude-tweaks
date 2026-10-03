const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseDeclaredOverrides, baseSkillName, listPipelineRunDirs, collectSkillInvocations, detectBypasses,
} = require('../../../plugin/bin/lib/harness-health/override-bypass');
const { readText } = require('../../helpers/read-skill');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'harness-health-override-scan.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-override-bypass-')); }

function writeEvents(runDir, events) {
  fs.mkdirSync(runDir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), lines ? `${lines}\n` : '');
}

// #809's Gotchas: "the fix chosen here should be validated against this
// repo's own override as a real test case, not just a synthetic one" — read
// this checkout's own CLAUDE.md, not a copy, so a future edit to the
// Superpowers overrides paragraph is caught by this test rather than a
// frozen fixture going stale silently.
test('parseDeclaredOverrides recognizes this repo\'s own CLAUDE.md "Superpowers overrides" declaration', () => {
  const claudeMd = readText(path.join(REPO_ROOT, 'CLAUDE.md'));
  const overrides = parseDeclaredOverrides(claudeMd);
  assert.ok(
    overrides.some((o) => o.substitute === '/claude-tweaks:specify' && o.forbidden === '/superpowers:writing-plans'),
    `expected an override pairing /claude-tweaks:specify (substitute) with /superpowers:writing-plans ` +
    `(forbidden); got ${JSON.stringify(overrides)}`,
  );
});

test('parseDeclaredOverrides returns no overrides for prose with neither marker', () => {
  const text = 'This project uses `/claude-tweaks:build` for everything. No overrides declared here.';
  assert.deepStrictEqual(parseDeclaredOverrides(text), []);
});

test('parseDeclaredOverrides finds multiple overrides in the same document', () => {
  const text = [
    'First: route to `/claude-tweaks:a`, never `/other:b`.',
    'Second: routes to `/claude-tweaks:c`, never `/other:d`.',
  ].join('\n');
  assert.deepStrictEqual(parseDeclaredOverrides(text), [
    { substitute: '/claude-tweaks:a', forbidden: '/other:b' },
    { substitute: '/claude-tweaks:c', forbidden: '/other:d' },
  ]);
});

test('parseDeclaredOverrides does not pair a "never" across a sentence boundary', () => {
  const text = 'route to `/claude-tweaks:a`. Some unrelated sentence. Never `/other:b` on its own.';
  assert.deepStrictEqual(parseDeclaredOverrides(text), []);
});

test('baseSkillName strips a namespace prefix and a leading slash', () => {
  assert.strictEqual(baseSkillName('/superpowers:writing-plans'), 'writing-plans');
  assert.strictEqual(baseSkillName('superpowers:writing-plans'), 'writing-plans');
  assert.strictEqual(baseSkillName('writing-plans'), 'writing-plans');
  assert.strictEqual(baseSkillName('/writing-plans'), 'writing-plans');
});

test('detectBypasses flags a forbidden skill invoked with its substitute never invoked', () => {
  const overrides = [{ substitute: '/claude-tweaks:specify', forbidden: '/superpowers:writing-plans' }];
  const invocations = [
    { skill: 'superpowers:writing-plans', ts: '2026-08-01T00:00:00.000Z', runDir: '/run-a' },
    { skill: 'superpowers:writing-plans', ts: '2026-08-02T00:00:00.000Z', runDir: '/run-b' },
  ];
  const bypasses = detectBypasses({ overrides, invocations });
  assert.strictEqual(bypasses.length, 1);
  assert.strictEqual(bypasses[0].forbidden, '/superpowers:writing-plans');
  assert.strictEqual(bypasses[0].substitute, '/claude-tweaks:specify');
  assert.strictEqual(bypasses[0].forbiddenCount, 2);
  assert.strictEqual(bypasses[0].evidence.length, 2);
});

test('detectBypasses does not flag when the substitute was invoked anywhere in the evidence', () => {
  const overrides = [{ substitute: '/claude-tweaks:specify', forbidden: '/superpowers:writing-plans' }];
  const invocations = [
    { skill: 'claude-tweaks:specify', ts: '2026-08-01T00:00:00.000Z', runDir: '/run-a' },
    { skill: 'superpowers:writing-plans', ts: '2026-08-02T00:00:00.000Z', runDir: '/run-b' },
  ];
  assert.deepStrictEqual(detectBypasses({ overrides, invocations }), []);
});

test('detectBypasses does not flag when the forbidden skill was never invoked', () => {
  const overrides = [{ substitute: '/claude-tweaks:specify', forbidden: '/superpowers:writing-plans' }];
  const invocations = [{ skill: 'claude-tweaks:build', ts: '2026-08-01T00:00:00.000Z', runDir: '/run-a' }];
  assert.deepStrictEqual(detectBypasses({ overrides, invocations }), []);
});

test('detectBypasses matches a bare invocation (no namespace) against a qualified substitute', () => {
  const overrides = [{ substitute: '/claude-tweaks:specify', forbidden: '/superpowers:writing-plans' }];
  const invocations = [
    { skill: 'writing-plans', ts: '2026-08-01T00:00:00.000Z', runDir: '/run-a' },
    { skill: 'specify', ts: '2026-08-02T00:00:00.000Z', runDir: '/run-b' },
  ];
  assert.deepStrictEqual(detectBypasses({ overrides, invocations }), []);
});

test('listPipelineRunDirs lists both active and archived run directories', () => {
  const root = tmp();
  const base = path.join(root, '.claude-tweaks', 'pipelines');
  fs.mkdirSync(path.join(base, '2026-08-01T000000-record-1'), { recursive: true });
  fs.mkdirSync(path.join(base, 'archive', '2026-07-01T000000-record-2'), { recursive: true });
  const dirs = listPipelineRunDirs(root).sort();
  assert.deepStrictEqual(dirs, [
    path.join(base, '2026-08-01T000000-record-1'),
    path.join(base, 'archive', '2026-07-01T000000-record-2'),
  ].sort());
});

test('listPipelineRunDirs returns an empty array when no pipelines directory exists', () => {
  assert.deepStrictEqual(listPipelineRunDirs(tmp()), []);
});

test('collectSkillInvocations reads skill_invoked events and ignores other event types', () => {
  const root = tmp();
  const runDir = path.join(root, 'run-a');
  writeEvents(runDir, [
    { type: 'skill_invoked', skill: 'claude-tweaks:build', ts: '2026-08-01T00:00:00.000Z' },
    { type: 'something_else', skill: 'ignored', ts: '2026-08-01T00:00:01.000Z' },
    { type: 'skill_invoked', skill: 'claude-tweaks:test', ts: '2026-08-01T00:00:02.000Z' },
  ]);
  const invocations = collectSkillInvocations([runDir]);
  assert.deepStrictEqual(invocations.map((i) => i.skill), ['claude-tweaks:build', 'claude-tweaks:test']);
});

test('collectSkillInvocations tolerates a missing events.jsonl', () => {
  assert.deepStrictEqual(collectSkillInvocations([path.join(tmp(), 'no-such-run')]), []);
});

test('CLI end-to-end: a bypassed override in a fixture CLAUDE.md is reported', () => {
  const root = tmp();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    'route to `/claude-tweaks:specify`, never `/superpowers:writing-plans`.\n',
  );
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T000000-record-1');
  writeEvents(runDir, [{ type: 'skill_invoked', skill: 'superpowers:writing-plans', ts: '2026-08-01T00:00:00.000Z' }]);

  const out = execFileSync('node', [CLI, '--root', root], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.overrides.length, 1);
  assert.strictEqual(parsed.bypasses.length, 1);
  assert.strictEqual(parsed.bypasses[0].forbidden, '/superpowers:writing-plans');
});

test('CLI end-to-end: no bypass when the substitute was invoked', () => {
  const root = tmp();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    'route to `/claude-tweaks:specify`, never `/superpowers:writing-plans`.\n',
  );
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T000000-record-1');
  writeEvents(runDir, [{ type: 'skill_invoked', skill: 'claude-tweaks:specify', ts: '2026-08-01T00:00:00.000Z' }]);

  const out = execFileSync('node', [CLI, '--root', root], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.bypasses.length, 0);
});

test('CLI end-to-end: no CLAUDE.md declares nothing and reports no bypasses', () => {
  const root = tmp();
  const out = execFileSync('node', [CLI, '--root', root], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.deepStrictEqual(parsed, { overrides: [], bypasses: [] });
});

test('CLI rejects an unknown argument', () => {
  const result = spawnSync('node', [CLI, '--bogus'], { encoding: 'utf8' });
  assert.notStrictEqual(result.status, 0);
});
