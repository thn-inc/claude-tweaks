'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'residue');
const { UNRESOLVED_RESOLUTIONS, FAILED_OUTCOMES, MISSING_RESOLUTION, unresolvedItems, splitMissing, readRunResidue, formatResidueLines } = require(MOD);

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

// #3772: an unresolved item whose staged file is gone is `missing`, not residue,
// so a fixture modelling a live item must give it the staged file it names.
function stageItems(consoleDir, items) {
  for (const { id } of items) {
    if (typeof id !== 'string' || id === '' || id.startsWith('decision:')) continue;
    fs.mkdirSync(path.join(consoleDir, 'staged'), { recursive: true });
    fs.writeFileSync(path.join(consoleDir, 'staged', id), 'x');
  }
}

test('UNRESOLVED_RESOLUTIONS is exactly pending and keep-staged', () => {
  assert.deepStrictEqual([...UNRESOLVED_RESOLUTIONS].sort(), ['keep-staged', 'pending']);
});

// #3949 AC3: a console.json written before `dropped`/`filed` existed holds its
// contested findings as `keep-staged`; they must keep counting as residue on both
// the run-level reader and the session-start banner scan.
test('AC3: a legacy console.json keep-staged item still counts in readRunResidue and scanUnresolvedConsoles', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'console-residue-legacy-'));
  const run = path.join(project, '.claude-tweaks', 'pipelines', 'archive', '2026-10-16T210949-spec-2821');
  fs.mkdirSync(path.join(run, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(run, 'staged', 'review-debate-deviation.md'), 'x');
  fs.writeFileSync(path.join(run, 'console.json'), JSON.stringify({
    resolved: true, mode: 'auto-resolve',
    items: [{ id: 'review-debate-deviation.md', section: 'Contested findings', resolution: 'keep-staged', reason: 'debate inconclusive — no Approve-all default; never auto-applied' }],
  }));
  const [c] = readRunResidue(run).consoles;
  assert.deepStrictEqual(c.items.map((i) => i.resolution), ['keep-staged']);
  assert.strictEqual(c.acknowledged, false);
  const { runs } = require(path.join(MOD, '..', '..', 'hooks', 'session-residue')).scanUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(runs.map((r) => r.dir), [run]);
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
  stageItems(path.join(dir, 'spec-12'), pendingItems(1));
  const res = readRunResidue(dir);
  assert.strictEqual(res.dir, dir);
  assert.strictEqual(res.consoles.length, 1);
  assert.strictEqual(res.consoles[0].path, path.join(dir, 'spec-12', 'console.json'));
  assert.strictEqual(res.consoles[0].items.length, 1);
  assert.deepStrictEqual(res.unreadable, [path.join(dir, 'console.json')], 'an existing but unparseable console.json is reported, not silently dropped');
});

test('readRunResidue reports a spec console.json holding JSON null as unreadable instead of throwing', () => {
  const dir = tmpRun();
  fs.mkdirSync(path.join(dir, 'spec-12'));
  fs.writeFileSync(path.join(dir, 'spec-12', 'console.json'), 'null');
  const res = readRunResidue(dir);
  assert.deepStrictEqual(res.consoles, []);
  assert.deepStrictEqual(res.unreadable, [path.join(dir, 'spec-12', 'console.json')]);
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
  stageItems(dir, unresolvedItems(CONSOLE_2821));
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
  fs.writeFileSync(path.join(dir, 'staged', 'review-debate-deviation.md'), 'x');
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  // #3772: reflect-1.md has no staged file, so it is `missing` — named once, not counted.
  assert.strictEqual(lines[0], `- ${path.basename(dir)}: 3 item(s) no human has reviewed (console.json)`);
  assert.ok(lines.includes('  - review-13-record.md — Pending review: pending (unmapped-prefix)'));
  assert.ok(!lines.some((l) => l.startsWith('  - reflect-1.md')));
  assert.ok(lines.some((l) => l.startsWith('  not counted — ') && l.includes(path.join('staged', 'reflect-1.md'))), lines.join('\n'));
  assert.ok(lines.includes(`    cat "${path.join(dir, 'staged', 'review-13-record.md')}"`));
  assert.ok(!lines.some((l) => l.trimStart().startsWith('cat ') && l.includes('reflect-1.md')));
  assert.strictEqual(lines.filter((l) => l.trimStart().startsWith('cat ')).length, 2);
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
  stageItems(dir, pendingItems(7));
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
  stageItems(dir, pendingItems(4));
  stageItems(path.join(dir, 'spec-2'), pendingItems(4));
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
  stageItems(dir, pendingItems(6));
  stageItems(path.join(dir, 'spec-2'), pendingItems(1));
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

// #3772: an item whose staged file has vanished since the console resolved is
// `missing` — nothing a human can review — so it is neither counted nor listed
// as residue, only named once.
function mixedConsole() {
  const dir = tmpRun();
  const items = [
    { id: 'wrap-up-docs-1.md', section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' },
    { id: 'polish-suggestion-1.md', section: 'Pending review', resolution: 'pending', reason: 'r' },
  ];
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ items }));
  stageItems(dir, items.slice(1));
  return dir;
}

test('AC3.1: readRunResidue does not count a pending item whose staged file is absent (#3772)', () => {
  const dir = mixedConsole();
  const [c] = readRunResidue(dir).consoles;
  assert.deepStrictEqual(c.items.map((i) => i.id), ['polish-suggestion-1.md']);
  assert.strictEqual(c.missing.length, 1);
  assert.strictEqual(c.missing[0].id, 'wrap-up-docs-1.md');
  assert.strictEqual(c.missing[0].resolution, MISSING_RESOLUTION);
  assert.strictEqual(c.missing[0].resolution, 'missing');
  assert.strictEqual(c.missing[0].reason, 'staged file absent (was pending)');
});

test('AC3.2: a console whose only unresolved items are missing is not residue (#3772)', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ items: [
    { id: 'wrap-up-docs-1.md', section: 'Pending review', resolution: 'pending', reason: 'r' },
    { id: 'wrap-up-docs-2.md', section: 'Contested findings', resolution: 'keep-staged', reason: 'r' },
  ] }));
  assert.deepStrictEqual(readRunResidue(dir).consoles, []);
});

test('AC3.3: formatResidueLines counts present items only and names missing ones in one line (#3772)', () => {
  const dir = mixedConsole();
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.strictEqual(lines[0], `- ${path.basename(dir)}: 1 item(s) no human has reviewed (console.json)`);
  const notCounted = lines.filter((l) => l.startsWith('  not counted — staged file(s) no longer on disk: '));
  assert.strictEqual(notCounted.length, 1, lines.join('\n'));
  assert.ok(notCounted[0].includes(path.join('staged', 'wrap-up-docs-1.md')), notCounted[0]);
  assert.ok(!lines.some((l) => l.startsWith('  - wrap-up-docs-1.md')), lines.join('\n'));
  assert.ok(lines.includes('  - polish-suggestion-1.md — Pending review: pending (r)'));
  assert.strictEqual(lines[lines.length - 1], `  mark reviewed: node "/p/bin/console-residue.js" --ack --run "${dir}"`);
});

test('formatResidueLines names the missing items of every console once per run, after the overflow line (#3772)', () => {
  const dir = mixedConsole();
  fs.mkdirSync(path.join(dir, 'spec-2'));
  const specItems = [{ id: 'wrap-up-docs-2.md', section: 'Pending review', resolution: 'pending', reason: 'r' }, ...pendingItems(6)];
  fs.writeFileSync(path.join(dir, 'spec-2', 'console.json'), JSON.stringify({ items: specItems }));
  stageItems(path.join(dir, 'spec-2'), specItems.slice(1));
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  const notCounted = lines.filter((l) => l.startsWith('  not counted'));
  assert.strictEqual(notCounted.length, 1, lines.join('\n'));
  assert.ok(notCounted[0].includes(path.join('staged', 'wrap-up-docs-1.md')) && notCounted[0].includes(path.join('spec-2', 'staged', 'wrap-up-docs-2.md')), notCounted[0]);
  assert.ok(lines.indexOf(notCounted[0]) > lines.findIndex((l) => l.startsWith('  … and ')), lines.join('\n'));
  assert.ok(lines.indexOf(notCounted[0]) < lines.length - 1, 'before the mark-reviewed line');
});

test('a console with only missing items is not residue but its items are named when another console is listed (#3772)', () => {
  const dir = mixedConsole();
  fs.mkdirSync(path.join(dir, 'spec-2'));
  fs.writeFileSync(path.join(dir, 'spec-2', 'console.json'), JSON.stringify({ items: [{ id: 'wrap-up-docs-2.md', section: 'Pending review', resolution: 'pending', reason: 'r' }] }));
  const found = readRunResidue(dir);
  assert.deepStrictEqual(found.consoles.map((c) => c.path), [path.join(dir, 'console.json')]);
  assert.deepStrictEqual(found.missingOnly.map((c) => [c.path, c.acknowledged, c.missing.map((m) => m.id)]), [[path.join(dir, 'spec-2', 'console.json'), false, ['wrap-up-docs-2.md']]]);
  const notCounted = formatResidueLines(found, { pluginRoot: '/p' }).filter((l) => l.startsWith('  not counted'));
  assert.strictEqual(notCounted.length, 1, notCounted.join('\n'));
  assert.ok(notCounted[0].includes(path.join('staged', 'wrap-up-docs-1.md')) && notCounted[0].includes(path.join('spec-2', 'staged', 'wrap-up-docs-2.md')), notCounted[0]);
});

test('a run with only missing-only consoles yields no consoles and renders nothing (#3772)', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ items: [{ id: 'wrap-up-docs-1.md', resolution: 'pending' }] }));
  fs.mkdirSync(path.join(dir, 'spec-2'));
  fs.writeFileSync(path.join(dir, 'spec-2', 'console.json'), JSON.stringify({ items: [{ id: 'wrap-up-docs-2.md', resolution: 'keep-staged' }] }));
  const found = readRunResidue(dir);
  assert.deepStrictEqual(found.consoles, []);
  assert.strictEqual(found.missingOnly.length, 2);
  assert.deepStrictEqual(formatResidueLines(found, { pluginRoot: '/p' }), []);
});

test('splitMissing never classifies a decision: item, an engine-row id, an id-less item or a non-basename id as missing (#3772)', () => {
  const never = () => false;
  const items = [
    { id: 'decision:STAGED 01:00:20 — x', resolution: 'keep-staged' },
    { resolution: 'pending' },
    { id: '', resolution: 'pending' },
    { id: 42, resolution: 'pending' },
    { id: '../escape.md', resolution: 'pending' },
    { id: 'sub/file.md', resolution: 'pending' },
    { id: 'docs:CLAUDE.md', resolution: 'keep-staged' },
  ];
  assert.deepStrictEqual(splitMissing(items, '/c', never), { items, missing: [] });
  const gone = { id: 'gone.md', section: 's', resolution: 'keep-staged', reason: 'r' };
  const here = { id: 'here.md', resolution: 'pending' };
  const seen = [];
  const exists = (p) => { seen.push(p); return p === path.join('/c', 'staged', 'here.md'); };
  const split = splitMissing([gone, here], '/c', exists);
  assert.deepStrictEqual(split.items, [here]);
  assert.deepStrictEqual(split.missing, [{ ...gone, resolution: 'missing', reason: 'staged file absent (was keep-staged)' }]);
  assert.deepStrictEqual(seen, [path.join('/c', 'staged', 'gone.md'), path.join('/c', 'staged', 'here.md')]);
});

// #4172: a PR-rendered console carries no staged files, so its failed outcomes
// are residue by their `outcome` field alone (`executed`/`dropped`/`declined`/`reversed` never are).
const PR_CONSOLE = (outcomes, extra = {}) => ({
  prNumber: 42, commentIds: ['IC_1'], executedAt: '2026-10-25T10:00:00.000Z', resolved: false,
  items: outcomes.map(([id, outcome, note]) => ({ id, kind: 'staged', summary: `s-${id}`, outcome, ...(note ? { note } : {}) })),
  ...extra,
});

test('FAILED_OUTCOMES is exactly filing-failed and reverse-failed (#4172)', () => {
  assert.deepStrictEqual([...FAILED_OUTCOMES].sort(), ['filing-failed', 'reverse-failed']);
});

test('AC1.1: an executed PR console holding a filing-failed item is residue, never missing (#4172)', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(PR_CONSOLE([
    ['1', 'executed'], ['f1', 'filing-failed', 'filing failed — see decisions.md'], ['d1', 'dropped', 'dropped — nothing filed'],
  ])));
  const { consoles } = readRunResidue(dir);
  assert.strictEqual(consoles.length, 1);
  assert.deepStrictEqual(consoles[0].items.map((i) => [i.id, i.resolution, i.section, i.reason]), [['f1', 'filing-failed', 'staged', 'filing failed — see decisions.md']]);
  assert.deepStrictEqual(consoles[0].missing, []);
  assert.strictEqual(consoles[0].acknowledged, false);
});

test('#4172: a reverse-failed ruling item is residue (#4172)', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(PR_CONSOLE([['r1', 'reverse-failed', 'reverse not filed — see decisions.md']])));
  assert.deepStrictEqual(readRunResidue(dir).consoles[0].items.map((i) => i.resolution), ['reverse-failed']);
});

test('AC2.1: an executed PR console with only executed/dropped/declined/reversed items is not residue (#4172)', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(PR_CONSOLE([
    ['1', 'executed'], ['d1', 'dropped'], ['x', 'declined'], ['r1', 'reversed'],
  ])));
  assert.deepStrictEqual(readRunResidue(dir).consoles, []);
});

test('#4172: a spec-N PR console with a filing-failed item is residue for the parent run (#4172)', () => {
  const dir = tmpRun();
  fs.mkdirSync(path.join(dir, 'spec-12'));
  fs.writeFileSync(path.join(dir, 'spec-12', 'console.json'), JSON.stringify(PR_CONSOLE([['f1', 'filing-failed', 'n']])));
  assert.deepStrictEqual(readRunResidue(dir).consoles.map((c) => path.relative(dir, c.path)), [path.join('spec-12', 'console.json')]);
});

test('#4172: formatResidueLines names a filing-failed PR item with its note (#4172)', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(PR_CONSOLE([['f1', 'filing-failed', 'filing failed — see decisions.md']])));
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.ok(lines.includes('  - f1 — staged: filing-failed (filing failed — see decisions.md)'), lines.join('\n'));
});

test('AC1.1: the SessionStart banner scan lists a clean run whose PR console holds a filing-failed item (#4172)', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'console-residue-pr-'));
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-10-25T100000-spec-4172');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  fs.writeFileSync(path.join(run, 'console.json'), JSON.stringify(PR_CONSOLE([['f1', 'filing-failed', 'filing failed — see decisions.md']])));
  const { runs } = require(path.join(MOD, '..', '..', 'hooks', 'session-residue')).scanUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(runs.map((r) => r.dir), [run]);
  assert.ok(runs[0].lines.some((l) => l.includes('f1 — staged: filing-failed')), runs[0].lines.join('\n'));
});
