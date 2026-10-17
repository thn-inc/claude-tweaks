// tests/specify-near-duplicate-prose.test.js
//
// Pins record #1944's prose wiring: shaping-mode.md must run the
// near-duplicate finder before composition and route a ready+in-flight
// candidate to needs:decision; next-mode-shape.md must cite the same step
// for the headless drain; dispatch/queue-pull-script.md and SKILL.md must
// carry the cross-group warning. The mechanical half (the three signals,
// exclusions, thresholds) is pinned separately in
// tests/bin-lib/issues/near-duplicate.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SHAPING_MODE = read('plugin/skills/specify/shaping-mode.md');
// Actions Performed moved to shaping-mode-readback.md (#2841's split).
const SHAPING_STAMPING = read('plugin/skills/specify/shaping-mode-stamping.md') + read('plugin/skills/specify/shaping-mode-readback.md');
const NEXT_MODE_SHAPE = read('plugin/skills/specify/next-mode-shape.md');
const QUEUE_PULL = read('plugin/skills/dispatch/queue-pull-script.md');
const DISPATCH_SKILL = read('plugin/skills/dispatch/SKILL.md');

test('shaping-mode.md runs the near-duplicate check before composition and cites the module', () => {
  assert.match(SHAPING_MODE, /Near-duplicate candidate check \(#1944\), also before composition/);
  assert.match(SHAPING_MODE, /findNearDuplicates/);
  assert.match(SHAPING_MODE, /bin\/lib\/issues\/near-duplicate\.js/);
  const idx = SHAPING_MODE.indexOf('Near-duplicate candidate check');
  const dependencyIdx = SHAPING_MODE.indexOf('### Dependency-narration check');
  assert.ok(idx !== -1 && dependencyIdx !== -1);
  assert.ok(idx < dependencyIdx, 'near-duplicate check must land before the dependency-narration check, both before composition');
});

test('shaping-mode.md renders a three-column candidate table and appends to Related', () => {
  assert.match(SHAPING_MODE, /\|\s*Record\s*\|\s*Score\s*\|\s*Signals\s*\|/);
  assert.match(SHAPING_MODE, /\*\*Related:\*\*/);
});

test('shaping-mode.md routes a ready+in-flight candidate to needs:decision with an Absorb proposal, never composing', () => {
  assert.match(SHAPING_MODE, /stop shaping this record here/);
  assert.match(SHAPING_MODE, /needs:decision/);
  assert.match(SHAPING_MODE, /<!-- needs-decision: specify -->/);
  assert.match(SHAPING_MODE, /Absorb into #\{candidate\}/);
});

test('shaping-mode-readback.md\'s Actions Performed outcome vocabulary includes the refusal', () => {
  assert.match(SHAPING_STAMPING, /refused — proposed Absorb into #\{candidate\}/);
});

test('next-mode-shape.md cites the near-duplicate check for the headless drain and files the refusal into the failed bucket', () => {
  assert.match(NEXT_MODE_SHAPE, /Near-duplicate candidate check also runs headlessly \(#1944\)/);
  const section = NEXT_MODE_SHAPE.slice(NEXT_MODE_SHAPE.indexOf('Near-duplicate candidate check also runs headlessly'));
  assert.match(section.slice(0, 600), /`failed`\s+bucket/);
});

test('dispatch/queue-pull-script.md runs the cross-group near-duplicate warning after the cross-PR overlap block', () => {
  assert.match(QUEUE_PULL, /#1944: cross-group near-duplicate candidate warning/);
  assert.match(QUEUE_PULL, /findNearDuplicates/);
  const crossPrIdx = QUEUE_PULL.indexOf('#1579: cross-PR root-cause overlap report');
  const nearDupIdx = QUEUE_PULL.indexOf('#1944: cross-group near-duplicate candidate warning');
  assert.ok(crossPrIdx !== -1 && nearDupIdx !== -1);
  assert.ok(crossPrIdx < nearDupIdx, 'the cross-group warning runs after the cross-PR overlap report');
  assert.match(QUEUE_PULL, /near-duplicate candidates across groups/);
});

test('dispatch/SKILL.md Step 3 documents the near-duplicate candidate warning as non-gating', () => {
  assert.match(DISPATCH_SKILL, /Near-duplicate candidate warning \(refs #1944\)/);
  assert.match(DISPATCH_SKILL, /Warning\s+only, never a gate/);
});

test('the cited module actually exports findNearDuplicates', () => {
  const mod = require('../plugin/bin/lib/issues/near-duplicate');
  assert.strictEqual(typeof mod.findNearDuplicates, 'function');
});

test('shaping-mode.md decides refusal with shapingRefusal, not bot:in-progress (#3141)', () => {
  const start = SHAPING_MODE.indexOf('Near-duplicate candidate check (#1944)');
  const end = SHAPING_MODE.indexOf('### Dependency-narration check', start);
  assert.ok(start !== -1 && end !== -1, 'Near-duplicate section anchors must exist');
  const section = SHAPING_MODE.slice(start, end);
  assert.match(section, /shapingRefusal/);
  assert.match(section, /buildShapingState/);
  assert.match(section, /title-similarity/);
  assert.match(section, /classifyClaimBlob/);
  assert.doesNotMatch(section, /carries `bot:in-progress` or has an open linked PR/);
  assert.doesNotMatch(section, /in-flight build \(open PR \/ `bot:in-progress`\)/);
  assert.match(section, /\*\*Why:\*\* near-duplicate finder found `title-similarity` against #\{candidate\}.*\{evidence\}/s);
});

test('the shaping-mode.md refusal fence runs and refuses nothing when no hit is title-similar and ready (#3141)', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const open = 'node -e "\n';
  const close = '" "$NEAR_DUP_HITS" "$NEAR_DUP_SNAPSHOT"\n';
  const start = SHAPING_MODE.indexOf(open);
  const end = SHAPING_MODE.indexOf(close, start);
  assert.ok(start !== -1 && end !== -1, 'refusal fence anchors must exist');
  const code = SHAPING_MODE.slice(start + open.length, end).split('${CLAUDE_PLUGIN_ROOT}').join(path.join(ROOT, 'plugin'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'near-dup-fence-'));
  const hits = path.join(dir, 'hits.json');
  const snapshot = path.join(dir, 'snapshot.json');
  // Neither hit qualifies (#2552 has no title-similarity, #9 is not ready),
  // so the fence makes no claim or GraphQL read — this runs offline.
  fs.writeFileSync(hits, JSON.stringify([
    { number: 2552, title: "Don't duplicate", signals: ['body-anchor-overlap'] },
    { number: 9, title: "It's similar", signals: ['title-similarity'] },
  ]));
  fs.writeFileSync(snapshot, JSON.stringify([
    { number: 2552, labels: ['ready', 'bot:in-progress'] },
    { number: 9, labels: [{ name: 'parked' }] },
  ]));
  const out = execFileSync(process.execPath, ['-e', code, hits, snapshot], { encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(out.trim()), { refuse: false });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('next-mode-shape.md describes the same refusal condition (#3141)', () => {
  const start = NEXT_MODE_SHAPE.indexOf('Near-duplicate candidate check also runs headlessly');
  assert.ok(start !== -1);
  const section = NEXT_MODE_SHAPE.slice(start, start + 900);
  assert.match(section, /shapingRefusal/);
  assert.match(section, /title-similar/);
});

function refusalFenceBody() {
  const open = 'node -e "\n';
  const close = '" "$NEAR_DUP_HITS" "$NEAR_DUP_SNAPSHOT"\n';
  const start = SHAPING_MODE.indexOf(open);
  const end = SHAPING_MODE.indexOf(close, start);
  assert.ok(start !== -1 && end !== -1, 'refusal fence anchors must exist');
  return { fence: SHAPING_MODE.slice(start + open.length, end), end };
}

test('AC1.1: the shaping-mode refusal fence reads claims through createClaimReader and reports failed reads as unreadable (#3393)', () => {
  const { fence, end } = refusalFenceBody();
  assert.match(fence, /createClaimReader\(\)/);
  assert.doesNotMatch(fence, /readClaimBlob\(/);
  assert.doesNotMatch(fence, /'repo', 'view'/);
  assert.match(fence, /unreadable/);
  assert.doesNotMatch(fence, /"/, 'the fence body sits inside a double-quoted shell string');
  assert.doesNotMatch(fence.split('${CLAUDE_PLUGIN_ROOT}').join(''), /\$/, 'the fence body must not contain $ beyond ${CLAUDE_PLUGIN_ROOT}');
  assert.doesNotMatch(fence, /`/, 'the fence body must not contain a backtick');
  assert.match(SHAPING_MODE.slice(end, end + 1500), /`unreadable`/);
});

test('AC1.1: an unreadable claim is reported on the output and the happy path stays { refuse: false } (#3393)', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const code = refusalFenceBody().fence.split('${CLAUDE_PLUGIN_ROOT}').join(path.join(ROOT, 'plugin'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'near-dup-unreadable-'));
  const hits = path.join(dir, 'hits.json');
  const snapshot = path.join(dir, 'snapshot.json');
  // #7 is title-similar and ready, so the fence reads its claim. An empty PATH makes gh and git
  // unavailable: the slug is unresolved and the git leg fails, so the read is a failure, never an
  // absent claim, and #7 is reported as unreadable while staying not in flight.
  try {
    fs.writeFileSync(hits, JSON.stringify([{ number: 7, title: 'Similar', signals: ['title-similarity'] }]));
    fs.writeFileSync(snapshot, JSON.stringify([{ number: 7, labels: ['ready'] }]));
    const out = execFileSync(process.execPath, ['-e', code, hits, snapshot], { encoding: 'utf8', env: { ...process.env, PATH: dir } });
    assert.deepStrictEqual(JSON.parse(out.trim()), { refuse: false, unreadable: [7] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
