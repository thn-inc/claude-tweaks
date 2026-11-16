// tests/skill-load-gate-conformance.test.js — pins _shared/skill-load-gate.md (record #5605)
// to the gate it describes: the byte-pinned invocation line runs against the real CLI (AC9),
// the no-surface set in the md equals the exported constant, and the surfaces visual-review
// Step 0.5 names equal the two sets the gate's visual-review rule uses (AC13). It also pins the
// seven caller steps that cite the gate (AC8) and the one Visual Review skip status (AC14).
// AC10 (three skill files no larger than on the merge base) is checked by `wc -c` at build time,
// not here: tests/skill-size-single-source.test.js forbids skill-size numbers outside budgets.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readText } = require('./helpers/read-skill');
const { sectionOf, lineStartingWith } = require('./helpers/conformance-asserts');
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

test('the gate-failure fallback names a labelled SKIP shape and keeps exit 3 out of the run dir', () => {
  assert.ok(SHARED.includes('--step "{step} (gate)"'));
  assert.ok(SHARED.includes('condition: skill-gate exit {n} → fallback: {skill} loaded'));
  assert.match(SHARED, /Exit 3 means the run directory is unanchored: report it only in the caller's own output, with no run-dir write/);
  assert.match(SHARED, /a path containing a comma is split/);
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
  const noDesktop = VISUAL.replace('`mobile`, or `desktop`', '`mobile`, or desktop');
  assert.notEqual(noDesktop, VISUAL);
  assert.throws(() => assertVisualSurfacesEqual(noDesktop, VISUAL_SIGNAL_SURFACES, VISUAL_NO_SIGNAL_SURFACES), /Step 0\.5 signal surfaces differ/);
  const noTerminal = VISUAL.replace('`infra`, `terminal`', '`infra`');
  assert.notEqual(noTerminal, VISUAL);
  assert.throws(() => assertVisualSurfacesEqual(noTerminal, VISUAL_SIGNAL_SURFACES, VISUAL_NO_SIGNAL_SURFACES), /no-signal surfaces differ/);
  assert.throws(() => assertVisualSurfacesEqual(VISUAL, [...VISUAL_SIGNAL_SURFACES, 'kiosk'], VISUAL_NO_SIGNAL_SURFACES), /Step 0\.5 signal surfaces differ/);
  assert.throws(() => assertVisualSurfacesEqual(VISUAL, VISUAL_SIGNAL_SURFACES, [...VISUAL_NO_SIGNAL_SURFACES, 'kiosk']), /no-signal surfaces differ/);
});

// --- AC8: the seven caller steps cite the gate before they invoke the skill ---

const GATE_CITE = '_shared/skill-load-gate.md';

// The text from a whole `### ` heading line to the next `### ` or `## ` heading (sectionOf stops
// only at `## `, so a `###` step would run on into its sibling steps).
function subsectionOf(text, heading) {
  const padded = `\n${text}\n`;
  const start = padded.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `heading not found: ${heading}`);
  const ends = ['\n### ', '\n## '].map((h) => padded.indexOf(h, start + 1)).filter((i) => i !== -1);
  return ends.length === 0 ? text.slice(start) : text.slice(start, Math.min(...ends) - 1);
}

const STEPS = [
  { name: 'build Common Step 1.7', file: ['build', 'SKILL.md'], slice: (t) => subsectionOf(t, '### Common Step 1.7: Design Pre-Build (frontend specs + terminal)'), invocation: 'design-wrapper pre-build', skill: 'design-wrapper', mode: 'pre-build' },
  { name: 'build Common Step 6', file: ['build', 'SKILL.md'], slice: (t) => subsectionOf(t, '### Common Step 6: User Journey Capture'), invocation: '/claude-tweaks:journeys', skill: 'journeys' },
  { name: 'test Step 1.5', file: ['test', 'design-gate.md'], slice: (t) => t, invocation: 'design-wrapper test', skill: 'design-wrapper', mode: 'test' },
  { name: 'review Step 6', file: ['review', 'code-mode-steps.md'], slice: (t) => sectionOf(t, '## Step 6: Visual Review'), invocation: '/claude-tweaks:visual-review', skill: 'visual-review' },
  { name: 'review Step 6.5', file: ['review', 'code-mode-steps.md'], slice: (t) => sectionOf(t, '## Step 6.5: Design Quality Pass (Impeccable)'), invocation: 'design-wrapper review', skill: 'design-wrapper', mode: 'review' },
  { name: 'flow polish', file: ['flow', 'steps-and-gates.md'], slice: (t) => subsectionOf(t, '### Polish-phase decision tree'), invocation: 'design-wrapper polish', skill: 'design-wrapper', mode: 'polish' },
  { name: 'flow survey', file: ['flow', 'survey.md'], slice: (t) => sectionOf(t, '## Survey procedure'), invocation: 'design-wrapper survey', skill: 'design-wrapper', mode: 'survey' },
];

const liveStep = (step) => step.slice(read(...step.file));

// `--flag value` as a whole token, so `--skill design-wrapper-x` does not pass for `design-wrapper`.
const namesFlag = (text, flag, value) => new RegExp(`${flag} ${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(text);

function assertStep(text, step) {
  const cite = text.indexOf(GATE_CITE);
  const invoke = text.indexOf(step.invocation);
  assert.ok(cite >= 0 && invoke >= 0 && cite < invoke, `${step.name}: gate citation must precede the first '${step.invocation}'`);
  assert.ok(namesFlag(text, '--skill', step.skill) && (!step.mode || namesFlag(text, '--mode', step.mode)), `${step.name}: names --skill/--mode`);
  assert.ok(/on `?skip`?[^.]*\bnot invoke/i.test(text) || /skill is not (invoked|loaded) on `?skip/i.test(text), `${step.name}: says the skill is not invoked on skip`);
}

test('AC8.1: each of the seven steps cites the gate before invoking its skill', () => {
  for (const step of STEPS) assertStep(liveStep(step), step);
});

test('AC8.2 go-red: removing the citation from one step turns only that step red', () => {
  for (const step of STEPS) {
    const live = liveStep(step);
    const doctored = live.split(GATE_CITE).join('');
    assert.notEqual(doctored, live, `${step.name}: no citation to remove`);
    const escaped = step.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.throws(() => assertStep(doctored, step), { message: new RegExp(`^${escaped}: `) });
    for (const other of STEPS.filter((s) => s !== step)) assertStep(liveStep(other), other);
  }
});

const NO_FLOW_INVOCATION = [/design-wrapper polish </, /design-wrapper survey </];
const MERGE_BASE = '026e203f3';
const hasMergeBase = spawnSync('git', ['-C', ROOT, 'cat-file', '-e', `${MERGE_BASE}^{commit}`], { stdio: 'ignore', windowsHide: true }).status === 0;

test('AC8.3/AC8.4: flow/SKILL.md holds no design-wrapper polish or survey invocation', () => {
  const flow = read('flow', 'SKILL.md');
  for (const re of NO_FLOW_INVOCATION) assert.doesNotMatch(flow, re);
});

test('AC8.3/AC8.4 control: the same patterns match flow/SKILL.md on the merge base', { skip: !hasMergeBase && `${MERGE_BASE} is not in the object store` }, () => {
  const r = spawnSync('git', ['-C', ROOT, 'show', `${MERGE_BASE}:plugin/skills/flow/SKILL.md`], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  for (const re of NO_FLOW_INVOCATION) assert.match(r.stdout, re);
});

// --- AC14: one Visual Review skip status across review Step 6, the summary template and wrap-up ---

const STATUS = 'Skipped — no UI changes';

function assertStatusSites({ step6, template, brief }) {
  assert.ok(step6.includes(STATUS), 'review Step 6 must write the gate-skip status');
  const status = lineStartingWith(sectionOf(template, '### Visual Review'), '- **Status:**');
  assert.ok(status.includes(STATUS), "review-summary-template.md's Visual Review status list must carry the status");
  assert.ok(lineStartingWith(brief, `| \`${STATUS}\``).includes(STATUS), "verification-brief.md's Step 2.5 row must read the status");
}

const statusSites = () => ({
  step6: sectionOf(read('review', 'code-mode-steps.md'), '## Step 6: Visual Review'),
  template: read('review', 'review-summary-template.md'),
  brief: read('wrap-up', 'verification-brief.md'),
});

test('AC14.1: review Step 6, the summary template and verification-brief Step 2.5 share one status string', () => {
  assertStatusSites(statusSites());
});

test('AC14.1 go-red: changing the status in any one of the three alone fails', () => {
  const messages = { step6: /review Step 6 must write/, template: /status list must carry/, brief: /Step 2\.5 row must read/ };
  const live = statusSites();
  for (const key of Object.keys(messages)) {
    const altered = live[key].split(STATUS).join('Skipped — no UI change');
    assert.notEqual(altered, live[key]);
    assert.throws(() => assertStatusSites({ ...live, [key]: altered }), { message: messages[key] });
  }
});
