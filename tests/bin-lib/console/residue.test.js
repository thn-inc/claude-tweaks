'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'residue');
const { UNRESOLVED_RESOLUTIONS, unresolvedItems, readRunResidue, formatResidueLines } = require(MOD);

// The items of the real archived #2821 console.json (#3370): 9 items, four of
// them unresolved — copied verbatim, including the `skills:undefined` ids.
const CONSOLE_2821 = {
  resolved: true,
  mode: 'auto-resolve',
  at: '2026-10-16T23:08:06.188Z',
  ceiling: 'unattended',
  items: [
    { id: 'ledger-record-brief-marker-multispec.md', section: 'Queue writes', resolution: 'apply', reason: 'pre-checked Apply default (batched-item-drill.md)' },
    { id: 'reflect-1.md', section: 'Pending review', resolution: 'pending', reason: 'non-tangential-category:convention' },
    { id: 'review-13-record.md', section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' },
    { id: 'review-debate-deviation.md', section: 'Contested findings', resolution: 'keep-staged', reason: 'debate inconclusive — no Approve-all default; never auto-applied' },
    { id: 'wrap-up-memory-1.md', section: 'Memory updates', resolution: 'apply', reason: 'pre-checked Apply default (batched-item-drill.md)' },
    { id: 'skills:undefined', section: 'Skill updates', resolution: 'applied', reason: 'applied (939fe9aac)' },
    { id: 'journeys:undefined', section: 'Journey updates', resolution: 'applied', reason: 'applied (be7ab5d22)' },
    { id: 'journeys:undefined', section: 'Journey updates', resolution: 'applied', reason: 'applied (e46b1577c)' },
    { id: 'decision:STAGED 01:00:20 — Step 3: full mode (wrap-up): pattern obs', section: 'Contested findings', resolution: 'keep-staged', reason: 'debate inconclusive — no Approve-all default; never auto-applied' },
  ],
  merge: { resolution: 'leave-open', reason: '#2821 lacks auto:merge' },
};

function tmpRun() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'console-residue-'));
}

function pendingItems(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `polish-suggestion-${i + 1}.md`, section: 'Pending review', resolution: 'pending', reason: 'r',
  }));
}

test('UNRESOLVED_RESOLUTIONS is exactly pending and keep-staged', () => {
  assert.deepStrictEqual([...UNRESOLVED_RESOLUTIONS].sort(), ['keep-staged', 'pending']);
});

test('unresolvedItems returns exactly the four pending/keep-staged items of the #2821 console', () => {
  assert.deepStrictEqual(unresolvedItems(CONSOLE_2821).map((i) => i.id), [
    'reflect-1.md',
    'review-13-record.md',
    'review-debate-deviation.md',
    'decision:STAGED 01:00:20 — Step 3: full mode (wrap-up): pattern obs',
  ]);
});

test('unresolvedItems ignores a PR-rendered console', () => {
  assert.deepStrictEqual(unresolvedItems({ items: [{ kind: 'q', summary: 'x' }] }), []);
  assert.deepStrictEqual(unresolvedItems(null), []);
  assert.deepStrictEqual(unresolvedItems({ items: 'nope' }), []);
});

test('readRunResidue skips an unparseable console.json and reads spec-*/console.json', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), '{nope');
  fs.mkdirSync(path.join(dir, 'spec-12'));
  fs.writeFileSync(path.join(dir, 'spec-12', 'console.json'), JSON.stringify({ items: pendingItems(1) }));
  const res = readRunResidue(dir);
  assert.strictEqual(res.dir, dir);
  assert.strictEqual(res.consoles.length, 1);
  assert.strictEqual(res.consoles[0].path, path.join(dir, 'spec-12', 'console.json'));
  assert.strictEqual(res.consoles[0].items.length, 1);
  assert.deepStrictEqual(res.unreadable, [path.join(dir, 'console.json')], 'an existing but unparseable console.json is reported, not silently dropped');
});

test('readRunResidue reports no unreadable console for an absent console.json or an absent run dir', () => {
  const dir = tmpRun();
  assert.deepStrictEqual(readRunResidue(dir).unreadable, []);
  assert.deepStrictEqual(readRunResidue(path.join(dir, 'missing')).unreadable, []);
});

test('readRunResidue omits a console with zero unresolved items and an absent run dir', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ items: [{ id: 'a', section: 's', resolution: 'apply', reason: 'r' }] }));
  assert.deepStrictEqual(readRunResidue(dir).consoles, []);
  assert.deepStrictEqual(readRunResidue(path.join(dir, 'missing')).consoles, []);
});

test('readRunResidue marks acknowledged', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ ...CONSOLE_2821, residueAcknowledgedAt: '2026-10-17T00:00:00Z' }));
  const [c] = readRunResidue(dir).consoles;
  assert.strictEqual(c.acknowledged, true);
  assert.strictEqual(c.path, path.join(dir, 'console.json'));
  assert.strictEqual(c.items.length, 4);

  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(CONSOLE_2821));
  assert.strictEqual(readRunResidue(dir).consoles[0].acknowledged, false);
});

test('formatResidueLines names every item, cats only existing staged files, ends with the ack command', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(CONSOLE_2821));
  fs.mkdirSync(path.join(dir, 'staged'));
  fs.writeFileSync(path.join(dir, 'staged', 'review-13-record.md'), 'x');
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.strictEqual(lines[0], `- ${path.basename(dir)}: 4 item(s) no human has reviewed (console.json)`);
  assert.ok(lines.includes('  - review-13-record.md — Pending review: pending (unmapped-prefix)'));
  assert.ok(lines.includes('  - reflect-1.md — Pending review: pending (non-tangential-category:convention)'));
  assert.ok(lines.includes(`    cat "${path.join(dir, 'staged', 'review-13-record.md')}"`));
  assert.ok(!lines.some((l) => l.trimStart().startsWith('cat ') && l.includes('reflect-1.md')));
  assert.strictEqual(lines.filter((l) => l.trimStart().startsWith('cat ')).length, 1);
  assert.strictEqual(lines[lines.length - 1], `  mark reviewed: node "/p/bin/console-residue.js" --ack --run "${dir}"`);
});

test('formatResidueLines points a spec-level item at spec-N/staged and names the relative console path', () => {
  const dir = tmpRun();
  fs.mkdirSync(path.join(dir, 'spec-12', 'staged'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec-12', 'console.json'), JSON.stringify({ items: pendingItems(1) }));
  fs.writeFileSync(path.join(dir, 'spec-12', 'staged', 'polish-suggestion-1.md'), 'x');
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.ok(lines[0].endsWith(`(${path.join('spec-12', 'console.json')})`));
  assert.ok(lines.includes(`    cat "${path.join(dir, 'spec-12', 'staged', 'polish-suggestion-1.md')}"`));
});

test('formatResidueLines caps items at maxItems', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ items: pendingItems(7) }));
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p', maxItems: 5 });
  assert.strictEqual(lines.filter((l) => l.startsWith('  - ')).length, 5);
  assert.ok(lines.includes(`  … and 2 more — see "${path.join(dir, 'console.json')}"`));
  assert.ok(lines[0].includes('7 item(s)'));
});

test('formatResidueLines renders nothing for a run with no residue', () => {
  assert.deepStrictEqual(formatResidueLines({ dir: '/x', consoles: [] }, { pluginRoot: '/p' }), []);
});

test('formatResidueLines caps item lines per run, across consoles: 2 consoles x 4 items show 5 plus the overflow (#3370 F2)', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ items: pendingItems(4) }));
  fs.mkdirSync(path.join(dir, 'spec-2'));
  fs.writeFileSync(path.join(dir, 'spec-2', 'console.json'), JSON.stringify({ items: pendingItems(4) }));
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.strictEqual(lines[0], `- ${path.basename(dir)}: 8 item(s) no human has reviewed`);
  assert.strictEqual(lines.filter((l) => l.startsWith('- ')).length, 1, 'one header per run');
  assert.strictEqual(lines.filter((l) => l.startsWith('  - ')).length, 5);
  const specConsoleLine = `  (${path.join('spec-2', 'console.json')})`;
  assert.deepStrictEqual(lines.filter((l) => l.startsWith('  (')), ['  (console.json)', specConsoleLine]);
  assert.strictEqual(lines[lines.indexOf(specConsoleLine) + 1],'  - polish-suggestion-1.md — Pending review: pending (r)');
  assert.ok(lines.includes(`  … and 3 more — see "${dir}"`));
  assert.strictEqual(lines.filter((l) => l.includes('--ack --run')).length, 1);
  assert.strictEqual(lines[lines.length - 1], `  mark reviewed: node "/p/bin/console-residue.js" --ack --run "${dir}"`);
});

test('formatResidueLines omits the sub-line of a console the per-run cap cut off entirely (#3370 F2)', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ items: pendingItems(6) }));
  fs.mkdirSync(path.join(dir, 'spec-2'));
  fs.writeFileSync(path.join(dir, 'spec-2', 'console.json'), JSON.stringify({ items: pendingItems(1) }));
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.ok(!lines.includes('  (spec-2/console.json)'), lines.join('\n'));
  assert.ok(lines.includes(`  … and 2 more — see "${dir}"`), lines.join('\n'));
});

test('formatResidueLines renders an item without an id as (no id), with — for missing fields and no cat line (#3370 M2)', () => {
  const dir = tmpRun();
  fs.mkdirSync(path.join(dir, 'staged'));
  fs.writeFileSync(path.join(dir, 'staged', 'polish-suggestion-1.md'), 'x');
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ items: [{ resolution: 'pending' }, ...pendingItems(1)] }));
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.ok(lines[0].includes('2 item(s)'));
  assert.ok(lines.includes('  - (no id) — —: pending (—)'), lines.join('\n'));
  assert.ok(!lines.some((l) => l.includes('undefined')), lines.join('\n'));
  assert.deepStrictEqual(lines.filter((l) => l.trimStart().startsWith('cat ')), [`    cat "${path.join(dir, 'staged', 'polish-suggestion-1.md')}"`]);
});

test('formatResidueLines points a decision: item at decisions.md, never a cat line, and only when decisions.md exists (#3370 M1)', () => {
  const dir = tmpRun();
  const id = 'decision:STAGED 01:00:20 — Step 3: full mode (wrap-up): pattern obs';
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ items: [{ id, section: 'Contested findings', resolution: 'keep-staged', reason: 'r' }] }));
  assert.ok(!formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' }).some((l) => l.startsWith('    ')));
  fs.writeFileSync(path.join(dir, 'decisions.md'), '');
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.ok(lines.includes(`    see "${path.join(dir, 'decisions.md')}"`), lines.join('\n'));
  assert.ok(!lines.some((l) => l.trimStart().startsWith('cat ')));
});
