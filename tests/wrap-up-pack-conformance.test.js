'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

test('wrap-up SKILL.md calls wrap-up-pack.js --run exactly once, in Phase 3 (#1930 AC5)', () => {
  const skill = read('plugin/skills/wrap-up/SKILL.md');
  // The ledger-only `--print ledger` call is a narrowed re-count, not a second full pack (#3566).
  const fullPack = /wrap-up-pack\.js" --run "\$PIPELINE_RUN_DIR"(?! --print)/g;
  assert.strictEqual((skill.match(fullPack) || []).length, 1);
  const phase3 = skill.indexOf('## Phase 3');
  const phase4 = skill.indexOf('## Phase 4');
  fullPack.lastIndex = 0;
  const call = fullPack.exec(skill).index;
  assert.ok(phase3 < call && call < phase4, 'the call lives in Phase 3');
  const recount = skill.indexOf('wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --print ledger');
  assert.ok(phase3 < recount && recount < phase4, 'the ledger re-count call lives in Phase 3');
});

test('every pack-reading sub-file cites wrap-up-pack.json and states the absent-file fallback (#1930 AC5)', () => {
  for (const f of ['residue-sweep', 'unblocked-records', 'cleanup-procedures', 'review-console', 'auto-merge-short-circuit', 'summary-template']) {
    const t = read(`plugin/skills/wrap-up/${f}.md`);
    assert.ok(t.includes('wrap-up-pack.json'), `${f} cites the pack`);
    assert.ok(/absent/.test(t), `${f} states the absent-file fallback`);
  }
});

test('merge-check.md documents the --pack input and keeps the CLI path (#1930 AC6)', () => {
  const t = read('plugin/skills/assess-agent-autonomy/merge-check.md');
  assert.ok(t.includes('--pack'));
  assert.ok(t.includes('could-not-gather'));
  assert.ok(t.includes('bin/blast-radius.js'));
});

test('the pack keeps exactly the eight probe names the skill prose enumerates (#1930)', () => {
  const { PROBE_NAMES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'pack.js'));
  const skill = read('plugin/skills/wrap-up/SKILL.md');
  for (const n of PROBE_NAMES) assert.ok(skill.includes(`\`${n}\``), `SKILL.md names probe ${n}`);
  assert.strictEqual(PROBE_NAMES.length, 8);
  assert.ok(!PROBE_NAMES.includes('release'), 'the release probe was removed (#1930 review I5)');
  // The probe is gone (#1930 fix round 4), and #3310 removed its only
  // consumer, the pre-merge merge-size step.
  assert.ok(!PROBE_NAMES.includes('mergeSize'), 'the mergeSize probe was removed (#1930 fix round 4)');
  assert.ok(!skill.includes('`mergeSize`'), 'SKILL.md no longer enumerates mergeSize');
});

test('every pack field the pack produces has a prose consumer that reads it (#1930 review I5)', () => {
  const { PROBE_NAMES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'pack.js'));
  const corpus = [
    'plugin/skills/wrap-up/SKILL.md', 'plugin/skills/wrap-up/residue-sweep.md', 'plugin/skills/wrap-up/unblocked-records.md',
    'plugin/skills/wrap-up/cleanup-procedures.md', 'plugin/skills/wrap-up/review-console.md', 'plugin/skills/wrap-up/review-console-interactive.md',
    'plugin/skills/wrap-up/auto-merge-short-circuit.md', 'plugin/skills/wrap-up/summary-template.md',
  ].map(read).join('\n');
  for (const n of PROBE_NAMES) assert.ok(corpus.includes(`pack.${n}`), `no prose consumer reads pack.${n}`);
});

test('every inputs field a closing-keyword reader relies on is produced by resolveInputs and read by prose (#3399)', () => {
  const { resolveInputs } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'pack.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-3399-'));
  let inputs;
  try {
    const runDir = path.join(tmp, '.claude-tweaks', 'pipelines', 'r1');
    fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'work', '3399-spec.md'), '---\nrecord: 3399\n---\n');
    const deps = {
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
      resolvePolicy: () => ({}),
      git: () => { throw new Error('no git'); },
      ghSync: () => { throw new Error('no gh'); },
    };
    inputs = resolveInputs({ runDir, cwd: tmp, deps });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.ok(Array.isArray(inputs.closingRecords));
  assert.strictEqual(typeof inputs.parkedAtShaping, 'object');
  const corpus = ['cleanup-procedures-execution', 'execution-and-verification', 'review-console', 'cleanup-procedures']
    .map((f) => read(`plugin/skills/wrap-up/${f}.md`)).join('\n');
  for (const f of ['closingRecords', 'parkedAtShaping']) assert.ok(corpus.includes(`inputs.${f}`), `no prose consumer reads inputs.${f}`);
});
