'use strict';
// #6060: /build reuses a plan reviewed at specify. Pins build/plan-reuse.md, runs its probe fence, and round-trips plan-store.js write → materialize → check.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');
const { originWithTwoClones, cleanGitEnv } = require('./helpers/git-fixtures');
const { runCliSync } = require('./helpers/run-cli');
const { composePlanLine, specHash } = require('../plugin/bin/lib/issues/plan-line');
const { composeFile, composeHeader } = require('../plugin/bin/lib/issues/materialize-format');
const { CHECK_ORDER } = require('../plugin/bin/lib/plan-store/check');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'plugin', 'skills', 'build', 'plan-reuse.md');
const PLAN_STORE = path.join(ROOT, 'plugin', 'bin', 'plan-store.js');
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');
const text = readText(FILE);

// The first ```bash fence after the `## Probe` heading.
function probeFenceOf(doc) {
  const m = /\n## Probe\n[\s\S]*?\n```bash\n([\s\S]*?)\n```/.exec(`\n${doc}`);
  if (!m) throw new Error('probe fence extraction is out of sync');
  return m[1];
}

const COMMIT = 'a'.repeat(40);
const LINE = composePlanLine({ record: 7, commit: COMMIT, specHash: 'b'.repeat(64) });
const SPEC = ['## Overview', 'The overview says one thing.', '', '## Non-Goals', 'Nothing else.', ''].join('\n');
const metaBody = (meta, rest) => ['Surface: infra', ...meta, '', rest].join('\n');
const fileWith = (body) => composeFile({ header: composeHeader({ record: 7, origin: 'human', ceremony: 'standard', grants: {} }), n: 7, title: 'T', body });

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-plan-reuse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Run the extracted fence under a shell with {spec} and {line-file} substituted by temp paths.
function runProbe(fence, specPath, lineFile, shell = ['bash', '--noprofile', '--norc']) {
  const script = fence.split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT).split('{spec}').join(specPath).split('{line-file}').join(lineFile);
  return spawnSync(shell[0], [...shell.slice(1), '-c', script], { encoding: 'utf8', env: { ...process.env, PLUGIN_ROOT } });
}

function probeOf(t, content, { specDir = '', shell } = {}) {
  const dir = scratch(t);
  const specParent = path.join(dir, specDir);
  fs.mkdirSync(specParent, { recursive: true });
  const spec = path.join(specParent, '6060-spec.md');
  const lineFile = path.join(dir, 'line.txt');
  fs.writeFileSync(spec, content);
  const r = runProbe(probeFenceOf(text), spec, lineFile, shell);
  return { r, lineFile, out: r.stdout.trim() };
}

const withLine = fileWith(metaBody([LINE], SPEC));

test('AC1.1: the probe reports absent for a spec with no Plan: line, or one only below the first ## heading', (t) => {
  const none = probeOf(t, fileWith(metaBody([], SPEC)));
  assert.strictEqual(none.r.status, 0, none.r.stderr);
  assert.strictEqual(none.out, '{"plan":"absent"}');
  assert.ok(!fs.existsSync(none.lineFile), 'line file must not be created');
  const quoted = probeOf(t, fileWith(metaBody([], `## Current State\n${LINE}\n\n${SPEC}`)));
  assert.strictEqual(quoted.r.status, 0, quoted.r.stderr);
  assert.strictEqual(quoted.out, '{"plan":"absent"}');
  assert.ok(!fs.existsSync(quoted.lineFile), 'line file must not be created');
});

test('AC2.1: the probe writes the Plan: line to the line file and prints its record and commit', (t) => {
  const expected = JSON.stringify({ plan: 'present', ok: true, record: 7, commit: COMMIT });
  const plain = probeOf(t, withLine);
  assert.strictEqual(plain.r.status, 0, plain.r.stderr);
  assert.strictEqual(plain.out, expected);
  assert.strictEqual(fs.readFileSync(plain.lineFile, 'utf8'), `${LINE}\n`);
  assert.strictEqual(probeOf(t, withLine.replace(/\n/g, '\r\n')).out, expected, 'CRLF spec');
  assert.strictEqual(probeOf(t, withLine, { specDir: "o'brien spec" }).out, expected, 'hostile spec path');
});

test('AC3.1: a Plan: line that does not parse is reported present but not ok', (t) => {
  const garbage = probeOf(t, fileWith(metaBody(['Plan:garbage'], SPEC)));
  assert.strictEqual(garbage.out, '{"plan":"present","ok":false,"reason":"shape"}');
  const badCommit = probeOf(t, fileWith(metaBody([`Plan: refs/claude-tweaks/plans/7 nothex spec-sha256:${'b'.repeat(64)}`], SPEC)));
  assert.strictEqual(badCommit.out, '{"plan":"present","ok":false,"reason":"bad-commit"}');
});

test('the probe fence runs the same under zsh -f', (t) => {
  if (spawnSync('zsh', ['--version']).error) return t.skip('zsh not on PATH');
  const p = probeOf(t, withLine, { shell: ['zsh', '-f'] });
  assert.strictEqual(p.r.status, 0, p.r.stderr);
  assert.strictEqual(p.out, JSON.stringify({ plan: 'present', ok: true, record: 7, commit: COMMIT }));
});

test('go-red: dropping the heading bound makes a quoted Plan: line read as the record line', (t) => {
  const fence = probeFenceOf(text);
  const doctored = fence.replace('lines.slice(0,end===-1?lines.length:end)', 'lines');
  assert.notStrictEqual(doctored, fence);
  const dir = scratch(t);
  const spec = path.join(dir, 'spec.md');
  fs.writeFileSync(spec, fileWith(metaBody([], `## Current State\n${LINE}\n\n${SPEC}`)));
  const r = runProbe(doctored, spec, path.join(dir, 'line.txt'));
  assert.match(r.stdout, /"plan":"present"/);
});

test('AC2.1/AC3.1: a stored plan checks valid against the materialized spec, and an edited spec fails hash', (t) => {
  const fx = originWithTwoClones('ct-plan-reuse-');
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const env = cleanGitEnv(fx.env);
  const BASENAME = '2026-11-22-plan-reuse-7.md';
  const PLAN = ['# Plan', '', '### Task 1: x', '', '**Files:**', '- Modify: `base`', '', 'Body.', ''].join('\n');
  const specBody = ['Surface: infra', '', SPEC].join('\n');
  fs.mkdirSync(path.join(fx.work, 'p'), { recursive: true });
  fs.mkdirSync(path.join(fx.work, 'work'), { recursive: true });
  fs.writeFileSync(path.join(fx.work, 'p', BASENAME), PLAN);
  fs.writeFileSync(path.join(fx.work, 'spec.md'), specBody);
  const w = runCliSync(PLAN_STORE, ['write', '--record', '7', '--plan-file', `p/${BASENAME}`, '--base', 'HEAD', '--spec-file', 'spec.md'], { cwd: fx.work, env });
  assert.strictEqual(w.code, 0, w.stderr);
  const { commit } = JSON.parse(w.stdout);
  assert.strictEqual(specHash(specBody), specHash(fileWith(specBody)), 'materialize does not change the hash');
  const line = composePlanLine({ record: 7, commit, specHash: specHash(specBody) });
  const materialized = fileWith(['Surface: infra', line, '', SPEC].join('\n'));
  assert.ok(materialized.includes(`\n${line}\n`), 'composeFile keeps the Plan: line');
  const specPath = path.join(fx.work, 'work', '7-spec.md');
  fs.writeFileSync(specPath, materialized);

  const lineFile = path.join(fx.work, 'line.txt');
  const probe = runProbe(probeFenceOf(text), specPath, lineFile);
  assert.strictEqual(probe.stdout.trim(), JSON.stringify({ plan: 'present', ok: true, record: 7, commit }), probe.stderr);
  const check = () => runCliSync(PLAN_STORE, ['check', '--line-file', lineFile, '--spec-file', specPath, '--base', 'HEAD'], { cwd: fx.work, env });
  const ok = check();
  assert.strictEqual(ok.code, 0, ok.stderr);
  assert.strictEqual(ok.stdout.trim(), '{"valid":true,"failed":null}');

  fs.writeFileSync(specPath, materialized.replace('The overview says one thing.', 'The overview now says another.'));
  const bad = check();
  assert.strictEqual(bad.code, 1);
  assert.strictEqual(bad.stdout.trim(), '{"valid":false,"failed":"hash"}');
});

const FACTS = [
  [/--values plan-at-specify/, 'gate names the policy read'],
  [/prints `on`/, 'gate fires only on on'],
  [/plan-store\.js" check --line-file "\{line-file\}" --spec-file "\{spec\}" --base \{base\}/, 'check invocation'],
  [/git merge-base HEAD origin\/\{integration-branch\}/, 'base resolution'],
  [/plan-store\.js" read --record \{n\} --commit \{commit\} --out/, 'read invocation'],
  [/plan-audit\.js" "\{read-path\}" --spec "\{spec\}" --repo-root/, 'audit invocation'],
  [/Add the plan reviewed at specify \(\{commit\}\)/, 'commit subject'],
  [/--step "Spec Step 3" --text "condition: plan reviewed at specify \(\{commit\}\)/, 'Spec Step 3 SKIP'],
  [/--step "Common Step 1\.6 \(plan review\)" --text "condition: plan reviewed at specify \(\{commit\}\)/, 'Common Step 1.6 SKIP'],
  [/--status AUTO[^\n]*--step "Spec Step 2 \(plan reuse\)"/, 'reuse AUTO line'],
  [/condition: plan-reuse failed: \{reason\}/, 'failure SKIP'],
  [/names another record/, 'record mismatch fails ref'],
  [/`Settled at planning:`[^\n]*`Decided by the user at planning:`/, 'planning-decision lines feed the re-plan'],
  [/planning decision departed:/, 'departure log'],
  [/ASSUMPTION — verify at build:/, 'premise probes still run'],
  [/logs nothing/, 'absent line logs nothing (AC1.1)'],
  [/Common Step 1\.5 runs as today/, 'plan audit still runs'],
  [/infrastructure fault[^\n]*log no reuse verdict/, 'non-zero probe exit stops, logs no verdict'],
  [/\.claude-tweaks\/pipelines\/\{run-id\}\/work\/\{n\}-spec\.md/, 'spec path is the worktree run-dir copy'],
  [/`\{worktree\}` is the worktree root/, 'worktree defined'],
  [/neither re-probes nor re-logs/, 'premise probes not repeated at Spec Step 3'],
];

test('AC2.2/AC3.1: plan-reuse.md states every check, log line and failure reason', () => {
  const missing = missingFactsOf(FACTS);
  assert.deepStrictEqual(missing(text), []);
  assertEachPatternGoesRed(text, FACTS, missing);
});

test('AC3.1: every failure reason is named in ## A check failed', () => {
  const REASON_FACTS = [
    [/`malformed Plan line`/, 'malformed reason'],
    [/`plan-audit`/, 'plan-audit reason'],
    [/`premise`/, 'premise reason'],
  ];
  const missing = missingFactsOf(REASON_FACTS);
  const section = sectionOf(text, '## A check failed');
  assert.deepStrictEqual(missing(section), []);
  assertEachPatternGoesRed(section, REASON_FACTS, missing);
  for (const c of CHECK_ORDER) assert.ok(section.includes(`\`${c}\``), `reason ${c} missing`);
});

test('AC5.1: plan-reuse.md says a resumed build takes the existing-plan branch and never re-runs this check', () => {
  const section = () => sectionOf(text, '## Resumed build');
  assert.match(section(), /existing-plan branch/);
  assert.match(section(), /never runs again/);
  const moved = text.replace(/[^\n]*never runs again[^\n]*/, '').replace('## Probe\n', '## Probe\nThis file never runs again for a resumed build; the existing-plan branch decides.\n');
  assert.notStrictEqual(moved, text);
  const inSection = sectionOf(moved, '## Resumed build');
  assert.throws(() => assert.match(inSection, /never runs again/), /never runs again/);
});
