// tests/skill-load-gate-conformance.test.js — pins _shared/skill-load-gate.md (record #5605)
// to the gate it describes: the byte-pinned invocation line runs against the real CLI (AC9),
// the no-surface set in the md equals the exported constant, and the surfaces visual-review
// Step 0.5 names equal the two sets the gate's visual-review rule uses (AC13).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readText } = require('./helpers/read-skill');
const { sectionOf } = require('./helpers/conformance-asserts');
const { gitRepo, FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');
const {
  NO_SURFACE_SET,
  VISUAL_SIGNAL_SURFACES,
  VISUAL_NO_SIGNAL_SURFACES,
} = require('../plugin/bin/lib/skill-gate');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (...p) => readText(path.join(SKILLS, ...p));

const SHARED = read('_shared', 'skill-load-gate.md');
const VISUAL = read('visual-review', 'SKILL.md');

const SNIPPET = 'node "${CLAUDE_PLUGIN_ROOT}/bin/skill-gate.js" --skill <skill> [--mode <mode>] [--surface <value>] (--files "<a,b>" | --integration-branch <ref>) [--run "$PIPELINE_RUN_DIR" --section "/<caller-skill>" --step "<step name>"]';

const backticked = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// The single line inside the bash fence of a section.
function fencedLine(section) {
  const m = section.match(/```bash\n([^\n]*)\n```/);
  assert.ok(m, 'the section holds no one-line bash fence');
  return m[1];
}

// The backticked bullet entries between the no-surface-set markers, in order.
function noSurfaceEntries(text) {
  const m = text.match(/<!-- no-surface-set:start -->\n([\s\S]*?)\n<!-- no-surface-set:end -->/);
  assert.ok(m, 'the no-surface-set markers are missing');
  return m[1].split('\n').map((line) => {
    const e = line.match(/^- `([^`]+)`$/);
    assert.ok(e, `a no-surface-set line is not a backticked bullet: ${line}`);
    return e[1];
  });
}

function assertNoSurfaceSetEquals(text, constant) {
  assert.deepEqual(noSurfaceEntries(text), [...constant], 'the md no-surface set differs from the exported NO_SURFACE_SET');
}

// Step 0.5's Layer 2 bullet: the surfaces it names as a signal and as no signal.
function visualSurfaces(text) {
  const step = sectionOf(text, '## Step 0.5: Mode — `recommendation` (short-circuit)');
  const bullet = step.split('\n').find((l) => l.includes('**Layer 2**'));
  assert.ok(bullet, 'Step 0.5 has no Layer 2 bullet');
  const marker = 'is a signal on its own';
  assert.ok(bullet.includes(marker), 'the Layer 2 bullet no longer says "is a signal on its own"');
  const before = bullet.slice(0, bullet.indexOf(marker));
  const signal = backticked(before.slice(before.lastIndexOf('. ') + 2));
  const noSignal = bullet.match(/any other declared value \(([^)]*)\)/);
  assert.ok(noSignal, 'the Layer 2 bullet no longer names "any other declared value (...)"');
  return { signal: signal.sort(), noSignal: backticked(noSignal[1]).sort() };
}

function assertVisualSurfacesEqual(text, signalConst, noSignalConst) {
  const got = visualSurfaces(text);
  assert.deepEqual(got.signal, [...signalConst].sort(), 'Step 0.5 signal surfaces differ from VISUAL_SIGNAL_SURFACES');
  assert.deepEqual(got.noSignal, [...noSignalConst].sort(), 'Step 0.5 no-signal surfaces differ from VISUAL_NO_SIGNAL_SURFACES');
}

const bashAvailable = spawnSync('bash', ['-c', 'true']).status === 0;

test('AC9.1: the Invocation fence holds exactly the byte-pinned line', () => {
  assert.strictEqual(fencedLine(sectionOf(SHARED, '## Invocation')), SNIPPET);
});

test('AC9.2: the pinned line runs against the real CLI in a fixture repository', { skip: !bashAvailable && 'bash is not available', timeout: FIXTURE_TIMEOUT_MS * 2 }, () => {
  const main = gitRepo({ branch: 'main' });
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', 'r1');
  fs.mkdirSync(runDir, { recursive: true });
  const cmd = fencedLine(sectionOf(SHARED, '## Invocation'))
    .replace('<skill>', 'journeys')
    .replace(' [--mode <mode>]', '')
    .replace(' [--surface <value>]', '')
    .replace('(--files "<a,b>" | --integration-branch <ref>)', '--files "tests/a.test.js"')
    .replace('<caller-skill>', 'build')
    .replace('<step name>"]', 'Common Step 6"')
    .replace('[--run', '--run');
  assert.ok(!/[<\[\]]/.test(cmd.replace(/\$\{[^}]*\}/g, '')), `placeholders left in: ${cmd}`);
  const r = spawnSync('bash', ['-c', cmd], {
    cwd: main,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      PIPELINE_RUN_DIR: runDir,
      CLAUDE_PLUGIN_ROOT: path.join(ROOT, 'plugin').split(path.sep).join('/'),
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(['proceed', 'skip'].includes(out.decision), r.stdout);
  assert.equal(out.decision, 'skip');
  assert.equal(out.logged, true);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(log, /- SKIP \d\d:\d\d:\d\d — Common Step 6 \(skipped\): condition: .* → fallback: journeys not loaded\. Reversibility: n\/a\./);
});

test('AC13.1: the md no-surface set equals the exported NO_SURFACE_SET', () => {
  assertNoSurfaceSetEquals(SHARED, NO_SURFACE_SET);
  assert.ok(NO_SURFACE_SET.length > 0);
});

test('AC13.1 go-red: an entry on one side only fails the comparison', () => {
  const extra = SHARED.replace('<!-- no-surface-set:end -->', '- `spec/**`\n<!-- no-surface-set:end -->');
  assert.notEqual(extra, SHARED);
  assert.throws(() => assertNoSurfaceSetEquals(extra, NO_SURFACE_SET), /md no-surface set differs/);
  assert.throws(() => assertNoSurfaceSetEquals(SHARED, [...NO_SURFACE_SET, 'spec/**']), /md no-surface set differs/);
  const dropped = SHARED.replace('- `docs/plans/*-ledger.md`\n', '');
  assert.notEqual(dropped, SHARED);
  assert.throws(() => assertNoSurfaceSetEquals(dropped, NO_SURFACE_SET), /md no-surface set differs/);
});

test('AC13.2: Step 0.5 names the surfaces the gate\'s visual-review rule uses', () => {
  assertVisualSurfacesEqual(VISUAL, VISUAL_SIGNAL_SURFACES, VISUAL_NO_SIGNAL_SURFACES);
});

test('AC13.2 go-red: a surface changed on one side only fails the comparison', () => {
  const noDesktop = VISUAL.replace('`desktop` is a signal', 'desktop is a signal').replace('`mobile`, or `desktop`', '`mobile`, or desktop');
  assert.notEqual(noDesktop, VISUAL);
  assert.throws(() => assertVisualSurfacesEqual(noDesktop, VISUAL_SIGNAL_SURFACES, VISUAL_NO_SIGNAL_SURFACES), /signal surfaces differ/);
  const noTerminal = VISUAL.replace('`infra`, `terminal`', '`infra`');
  assert.notEqual(noTerminal, VISUAL);
  assert.throws(() => assertVisualSurfacesEqual(noTerminal, VISUAL_SIGNAL_SURFACES, VISUAL_NO_SIGNAL_SURFACES), /no-signal surfaces differ/);
  assert.throws(() => assertVisualSurfacesEqual(VISUAL, [...VISUAL_SIGNAL_SURFACES, 'kiosk'], VISUAL_NO_SIGNAL_SURFACES), /signal surfaces differ/);
  assert.throws(() => assertVisualSurfacesEqual(VISUAL, VISUAL_SIGNAL_SURFACES, [...VISUAL_NO_SIGNAL_SURFACES, 'kiosk']), /no-signal surfaces differ/);
});
