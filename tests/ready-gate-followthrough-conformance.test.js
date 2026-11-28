'use strict';

// blocker-surface-parity rule 7, after #6374's ready gate: a shape or planning answer the gate stops
// leaves the record without `ready`, so the steps after it must agree. The shaping read-back must
// not fail on the missing label, and bare drain must not pick the stamped record up again.
// (planning-hold.js's read-back is pinned in tests/bin-lib/issues/planning-hold-readback.test.js.)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const flat = (rel) => read(rel).replace(/\s+/g, ' ');

test('the shaping read-back expects ready absent when the Ready gate dropped it', () => {
  const src = flat('plugin/skills/specify/shaping-mode-readback.md');
  assert.ok(src.includes("- `ready` is present (absent instead when `shaping-mode-stamping.md`'s Ready gate exited 1, which dropped it)"));
  assert.ok(src.includes('added `ready` (or `ready withheld — {reasons}` when the Ready gate exited 1)'));
});

test("the planning answer's (d) Ready leaves the outcome to the read-back", () => {
  const src = flat('plugin/skills/specify/planning-answer.md');
  assert.ok(src.includes('on exit 1 add nothing (the read-back expects `ready` absent then, and its outcome names the gate\'s `reasons`)'));
});

// next-mode.md's bare-drain filter fence, extracted and run over a fixture in $RAW's place.
const DRAIN_FENCE = /node -e "\r?\n  const records = require\('\$RAW'\);[\s\S]*?\r?\n" > "\$CANDIDATES"/;

test('bare drain skips a record an earlier drain shaped, ready or not', (t) => {
  const m = DRAIN_FENCE.exec(read('plugin/skills/specify/next-mode.md'));
  assert.ok(m, 'the bare-drain filter fence moved: extraction pattern is out of sync');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-shaped-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const posix = (p) => p.split(path.sep).join('/');
  const raw = posix(path.join(dir, 'raw.json'));
  const out = posix(path.join(dir, 'candidates.json'));
  const rec = (number, labels) => ({ number, title: `t${number}`, labels: labels.map((name) => ({ name })), createdAt: '2026-01-01T00:00:00Z', body: '' });
  // #1: shaped by a drain, the Ready gate kept `ready` off. #2: never shaped. #3: shaped and ready.
  fs.writeFileSync(raw, JSON.stringify([rec(1, ['shaped:headless', 'size:low']), rec(2, ['size:low']), rec(3, ['shaped:headless', 'ready'])]));
  const r = spawnSync('bash', ['-c', m[0]], {
    env: { ...process.env, RAW: raw, CANDIDATES: out, CLAUDE_PLUGIN_ROOT: posix(path.join(ROOT, 'plugin')) },
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).map((c) => c.number), [2]);
});
