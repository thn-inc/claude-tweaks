'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const MOD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'residue');
const { UNRESOLVED_RESOLUTIONS, FAILED_OUTCOMES, MISSING_RESOLUTION, FILING_PENDING_RESOLUTION, unresolvedItems, splitMissing, readRunResidue, formatResidueLines, consoleResidueItems, consoleRerunCommand, DIGESTED_LINE_RE, digestLogRemedy, digestedFindings, pendingDigests, DIGEST_PENDING_RESOLUTION, RECHECK_APPROVED_RESOLUTION } = require(MOD);

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
  return scratchDir('console-residue-');
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
  const project = scratchDir('console-residue-legacy-');
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
  const project = scratchDir('console-residue-pr-');
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-10-25T100000-spec-4172');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  fs.writeFileSync(path.join(run, 'console.json'), JSON.stringify(PR_CONSOLE([['f1', 'filing-failed', 'filing failed — see decisions.md']])));
  const { runs } = require(path.join(MOD, '..', '..', 'hooks', 'session-residue')).scanUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(runs.map((r) => r.dir), [run]);
  assert.ok(runs[0].lines.some((l) => l.includes('f1 — staged: filing-failed')), runs[0].lines.join('\n'));
});

// #4170: a planned can't-tell filing (`console.json#filings`) with no `AUTO … filed as #N
// (work-fingerprint …)` line in decisions.md has no record behind it; it reads as
// `filing-pending` residue, derived at read time (never stored in console.json).
function plannedFilingConsole(dir, decisions, items) {
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({
    resolved: true,
    mode: 'auto-resolve',
    items: items || [{ id: 'tiebreak:aaaaaaaaaaaa', section: 'Low-confidence findings', resolution: 'filed', reason: 'r' }],
    filings: [{ item: 'tiebreak:aaaaaaaaaaaa', fingerprint: 'consolefinding-0123abcd', title: 't' }],
  }));
  if (decisions !== null) fs.writeFileSync(path.join(dir, 'decisions.md'), decisions);
}
const FILED_LINE = '- AUTO 10:00:00 — Queue write: tiebreak:aaaaaaaaaaaa filed as #501 (work-fingerprint consolefinding-0123abcd). Reversibility: n/a.';

test('AC3.1: a console whose planned can\'t-tell filing has no filed line reports it filing-pending (#4170)', () => {
  const dir = tmpRun();
  plannedFilingConsole(dir, '## /wrap-up\n');
  const r = readRunResidue(dir);
  assert.strictEqual(r.consoles.length, 1);
  assert.deepStrictEqual(r.consoles[0].items.map((i) => [i.id, i.resolution, i.section]), [['tiebreak:aaaaaaaaaaaa', 'filing-pending', 'Low-confidence findings']]);
  assert.deepStrictEqual(r.consoles[0].missing, []);
  assert.strictEqual(FILING_PENDING_RESOLUTION, 'filing-pending');
});

test('AC4.1: a filed or deduplicated planned filing reads resolved (#4170)', () => {
  for (const line of [FILED_LINE, FILED_LINE.replace('filed as #501', 'already filed as #77')]) {
    const dir = tmpRun();
    plannedFilingConsole(dir, `## /wrap-up\n${line}\n`);
    assert.deepStrictEqual(readRunResidue(dir).consoles, [], line);
  }
});

test('a SKIP or STAGED line naming the fingerprint is not filed evidence (#4170)', () => {
  for (const word of ['SKIP', 'STAGED']) {
    const dir = tmpRun();
    plannedFilingConsole(dir, `${FILED_LINE.replace('- AUTO ', `- ${word} `)}\n`);
    const { consoles } = readRunResidue(dir);
    assert.deepStrictEqual(consoles.map((c) => c.items.map((i) => i.resolution)), [['filing-pending']], word);
  }
});

test('an absent decisions.md fails closed: every planned filing is pending (#4170)', () => {
  const dir = tmpRun();
  plannedFilingConsole(dir, null);
  assert.deepStrictEqual(readRunResidue(dir).consoles.map((c) => c.items.map((i) => i.resolution)), [['filing-pending']]);
});

// #4679: a previous-release (#3949) run put a `drop` item in `filings`; its printed re-run is now the default
// selection, which digests it and logs the digested line, so that line must clear the filing too.
test('an old console whose `filings` holds a drop item clears on its digested line, and stays pending without it (#4679)', () => {
  const old = [{ id: 'tiebreak:aaaaaaaaaaaa', section: 'Low-confidence findings', resolution: 'filed', reason: 'r', tiebreak: { recommendation: 'drop' } }];
  const digestedLine = '- AUTO 10:00:00 — Queue write: tiebreak:aaaaaaaaaaaa digested (work-fingerprint consolefinding-0123abcd). Reversibility: n/a.';
  const dir = tmpRun();
  plannedFilingConsole(dir, `## /wrap-up\n${digestedLine}\n`, old);
  assert.deepStrictEqual(readRunResidue(dir).consoles, []);
  const dir2 = tmpRun();
  plannedFilingConsole(dir2, `## /wrap-up\n${digestedLine.replace('digested (', 'already digested (')}\n`, old);
  assert.deepStrictEqual(readRunResidue(dir2).consoles, [], 'an already-digested line clears it too');
  const dir3 = tmpRun();
  plannedFilingConsole(dir3, '## /wrap-up\n', old);
  assert.deepStrictEqual(readRunResidue(dir3).consoles.map((c) => c.items.map((i) => i.resolution)), [['filing-pending']], 'control: with no digested line it is still pending');
  const dir4 = tmpRun();
  plannedFilingConsole(dir4, `## /wrap-up\n${digestedLine.replace('consolefinding-0123abcd', 'consolefinding-ffffffff')}\n`, old);
  assert.deepStrictEqual(readRunResidue(dir4).consoles.map((c) => c.items.map((i) => i.resolution)), [['filing-pending']], 'a digested line for another fingerprint does not clear it');
});

test('a planned filing with no matching console item is still listed by its id (#4170)', () => {
  const dir = tmpRun();
  plannedFilingConsole(dir, '', []);
  const [c] = readRunResidue(dir).consoles;
  assert.deepStrictEqual(c.items.map((i) => ({ id: i.id, resolution: i.resolution })), [{ id: 'tiebreak:aaaaaaaaaaaa', resolution: 'filing-pending' }]);
});

test('AC3.1: formatResidueLines names the default-selection console-filings.js re-run for a filing-pending item (#4170)', () => {
  const dir = tmpRun();
  plannedFilingConsole(dir, '');
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.ok(lines.includes(`    re-run filing: node "/p/bin/console-filings.js" --run "${dir}" --existing <issues.json> --out-dir <dir> --digest-comments <comments.json>`), lines.join('\n'));
  assert.ok(!lines.some((l) => l.includes('--only')), 'the filing re-run keeps the unattended shape: no --only');
  assert.ok(lines.some((l) => l.startsWith('      (<issues.json>: gh issue list --state all --json number,body')), lines.join('\n'));
  // The remedy names the log line that clears a filing-pending item (FILED_LINE_RE), `deduped` re-run included.
  assert.ok(lines.some((l) => l.endsWith(`; file each printed \`file\` entry and log it as '{item} filed as #{n} (work-fingerprint {fp})', hand-log any \`logFailures\` item as '{item} already filed as #{n} (work-fingerprint {fp})' (the CLI logs each \`deduped\` entry itself; a \`drop\` item's re-run logs its digested line instead), via log-decision.js \`--run\` that console's dir, per wrap-up/review-console.md's Can't-tell filings)`)), lines.join('\n'));
});

test('a local-files backend names the local-store listing, no gh command, in the filing-pending hint (#4337)', () => {
  const dir = tmpRun();
  plannedFilingConsole(dir, '');
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p', backend: 'local-files' });
  assert.ok(lines.some((l) => l.startsWith("      (<issues.json>: the local store's records as [{number: id, body}];")), lines.join('\n'));
  assert.ok(!lines.some((l) => l.includes('gh issue list')), lines.join('\n'));
});

test('the filing-pending hint keeps "; " before <comments.json> on both backends (#4337)', () => {
  for (const [backend, listing] of [
    ['github-issues', 'gh issue list --state all --json number,body --limit <N>'],
    ['local-files', "the local store's records as [{number: id, body}]"],
  ]) {
    const dir = tmpRun();
    plannedFilingConsole(dir, '');
    const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p', backend });
    assert.ok(lines.some((l) => l.startsWith(`      (<issues.json>: ${listing}; <comments.json>: the materiality digest's comments; `)), `${backend}:\n${lines.join('\n')}`);
  }
});

test('consoleRerunCommand is the default (unattended) selection, names no --only and omits node without a plugin root (#4679)', () => {
  assert.strictEqual(
    consoleRerunCommand({ consoleDir: '/r' }),
    'console-filings.js --run "/r" --existing <issues.json> --out-dir <dir> --digest-comments <comments.json>',
  );
  assert.strictEqual(
    consoleRerunCommand({ consoleDir: '/r', pluginRoot: '/p' }),
    'node "/p/bin/console-filings.js" --run "/r" --existing <issues.json> --out-dir <dir> --digest-comments <comments.json>',
  );
});

test('consoleResidueItems on a console with no filings equals unresolvedItems (#4170)', () => {
  assert.deepStrictEqual(consoleResidueItems(CONSOLE_2821).map((i) => i.id), unresolvedItems(CONSOLE_2821).map((i) => i.id));
});

test('the SessionStart banner scan lists a clean run whose console holds a planned filing with no record (#4170)', () => {
  const project = scratchDir('console-residue-filing-');
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-10-25T100000-spec-4170');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  plannedFilingConsole(run, '## /wrap-up\n');
  const { runs } = require(path.join(MOD, '..', '..', 'hooks', 'session-residue')).scanUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(runs.map((r) => r.dir), [run]);
  assert.ok(runs[0].lines.some((l) => l.includes('tiebreak:aaaaaaaaaaaa — Low-confidence findings: filing-pending')), runs[0].lines.join('\n'));
});

test('splitMissing never classifies a filing-pending item missing, even with a bare staged-file id (#4170)', () => {
  // planFilings only emits tiebreak:{id} ids, which carry a ':' and are never checkable; the guard is
  // pinned here with an id that would otherwise read as a plain staged filename with no file behind it.
  const items = [{ id: 'wrap-up-docs-9.md', section: 'Queue writes', resolution: FILING_PENDING_RESOLUTION, reason: 'r' }];
  const { items: kept, missing } = splitMissing(items, tmpRun(), () => false);
  assert.deepStrictEqual(kept.map((i) => i.id), ['wrap-up-docs-9.md']);
  assert.deepStrictEqual(missing, []);
  // Control: the same id as a pending item with no staged file is missing, so the guard is what holds the item.
  const pending = splitMissing([{ ...items[0], resolution: 'pending' }], tmpRun(), () => false);
  assert.deepStrictEqual(pending.missing.map((i) => i.id), ['wrap-up-docs-9.md']);
});

test('a console with one filed and one unfiled planned filing reports only the unfiled one (#4170)', () => {
  const dir = tmpRun();
  const filed = { id: 'tiebreak:aaaaaaaaaaaa', section: 'Low-confidence findings', resolution: 'filed', reason: 'r' };
  const unfiled = { id: 'tiebreak:bbbbbbbbbbbb', section: 'Low-confidence findings', resolution: 'filed', reason: 'r' };
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({
    resolved: true,
    mode: 'auto-resolve',
    items: [filed, unfiled],
    filings: [
      { item: filed.id, fingerprint: 'consolefinding-0123abcd', title: 't' },
      { item: unfiled.id, fingerprint: 'consolefinding-4567ef01', title: 'u' },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'decisions.md'), `## /wrap-up\n${FILED_LINE}\n`);
  const { consoles } = readRunResidue(dir);
  assert.deepStrictEqual(consoles.map((c) => c.items.map((i) => [i.id, i.resolution])), [[['tiebreak:bbbbbbbbbbbb', 'filing-pending']]]);
});

// #4679: a planned can't-tell digest entry (`console.json#digests`) with no `AUTO … digested (work-fingerprint …)`
// line in decisions.md has not reached the materiality digest; it reads as `digest-pending`, derived at read time.
const DIGESTED_LINE = '- AUTO 10:00:00 — Queue write: tiebreak:bbbbbbbbbbbb digested (work-fingerprint consolefinding-4567ef01). Reversibility: n/a.';
function plannedDigestConsole(dir, decisions) {
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({
    resolved: true,
    mode: 'auto-resolve',
    items: [{ id: 'tiebreak:bbbbbbbbbbbb', section: 'Low-confidence findings', resolution: 'digested', reason: 'r' }],
    digests: [{ item: 'tiebreak:bbbbbbbbbbbb', fingerprint: 'consolefinding-4567ef01' }],
  }));
  if (decisions !== null) fs.writeFileSync(path.join(dir, 'decisions.md'), decisions);
}

test('DIGESTED_LINE_RE anchors on - AUTO (#4679)', () => {
  assert.ok(DIGESTED_LINE_RE.test(DIGESTED_LINE));
  assert.ok(DIGESTED_LINE_RE.test(DIGESTED_LINE.replace('digested (', 'already digested (')));
  assert.ok(!DIGESTED_LINE_RE.test(DIGESTED_LINE.replace('- AUTO ', '- STAGED ')));
  assert.ok(!DIGESTED_LINE_RE.test(DIGESTED_LINE.replace('- AUTO ', '- SKIP ')));
  // Negative wording and another step label are not evidence (the regex is anchored on the Queue-write line shape).
  assert.ok(!DIGESTED_LINE_RE.test(DIGESTED_LINE.replace('bbbbbbbbbbbb digested', 'bbbbbbbbbbbb not digested')));
  assert.ok(!DIGESTED_LINE_RE.test(DIGESTED_LINE.replace('bbbbbbbbbbbb digested', 'bbbbbbbbbbbb undigested')));
  assert.ok(!DIGESTED_LINE_RE.test(DIGESTED_LINE.replace('Queue write', 'Review Console')));
  assert.ok(!DIGESTED_LINE_RE.test(DIGESTED_LINE.replace('tiebreak:bbbbbbbbbbbb', 'two words')));
  // The exact line formatEntry writes matches, plain and deduped.
  const { formatEntry } = require(path.join(MOD, '..', '..', 'log-decision', 'append'));
  const real = (text) => formatEntry({ status: 'AUTO', now: new Date(2026, 9, 24, 10, 0, 0), step: 'Queue write', text, reversibility: 'n/a' });
  assert.ok(DIGESTED_LINE_RE.test(real('tiebreak:x digested (work-fingerprint consolefinding-4567ef01)')));
  assert.ok(DIGESTED_LINE_RE.test(real('tiebreak:x already digested (work-fingerprint consolefinding-4567ef01)')));
  const forged = DIGESTED_LINE.replace('- AUTO ', '- STAGED ').replace('4567ef01', '89abcdef');
  assert.deepStrictEqual([...digestedFindings(`${DIGESTED_LINE}\n${forged}\n`)], ['consolefinding-4567ef01']);
});

test('digestLogRemedy names a paste-ready command whose logged line DIGESTED_LINE_RE accepts (#4679)', () => {
  const DIGEST_LOG_REMEDY = digestLogRemedy({ consoleDir: '/c dir', pluginRoot: '/p' });
  assert.ok(!/\{plugin-root\}|\{console dir\}/.test(DIGEST_LOG_REMEDY), 'no unfilled placeholder besides {item} and {fp}');
  assert.ok(DIGEST_LOG_REMEDY.includes('node "/p/bin/log-decision.js" --run "/c dir"'), DIGEST_LOG_REMEDY);
  assert.ok(digestLogRemedy({ consoleDir: '/c' }).includes('`log-decision.js --run "/c"'), 'bare CLI without a plugin root');
  const { formatEntry } = require(path.join(MOD, '..', '..', 'log-decision', 'append'));
  const flag = (name) => new RegExp(`${name} (?:"([^"]+)"|'([^']+)'|(\\S+))`).exec(DIGEST_LOG_REMEDY);
  const val = (name) => { const m = flag(name); assert.ok(m, `the remedy names ${name}`); return m[1] ?? m[2] ?? m[3]; };
  assert.ok(!/--spec \S/.test(DIGEST_LOG_REMEDY.replace('(no `--spec`)', '')), 'the remedy passes no --spec');
  const line = formatEntry({
    status: val('--status'), now: new Date(2026, 9, 24, 10, 0, 0), step: val('--step'),
    text: val('--text').replace('{item}', 'tiebreak:x').replace('{fp}', 'consolefinding-4567ef01'), reversibility: val('--reversibility'),
  });
  assert.ok(DIGESTED_LINE_RE.test(line), line);
  assert.strictEqual(val('--step'), 'Queue write');
});

test('pendingDigests: console.json without digests yields none (#4679)', () => {
  assert.deepStrictEqual(pendingDigests(CONSOLE_2821, ''), []);
  assert.deepStrictEqual(pendingDigests(null, ''), []);
});

test('pendingDigests: a digests entry with no digested line is digest-pending (#4679)', () => {
  const dir = tmpRun();
  plannedDigestConsole(dir, '## /wrap-up\n');
  const [c] = readRunResidue(dir).consoles;
  assert.deepStrictEqual(c.items.map((i) => [i.id, i.resolution, i.section]), [['tiebreak:bbbbbbbbbbbb', DIGEST_PENDING_RESOLUTION, 'Low-confidence findings']]);
  assert.deepStrictEqual(c.missing, []);
  assert.strictEqual(DIGEST_PENDING_RESOLUTION, 'digest-pending');
  assert.strictEqual(c.items[0].reason, "planned can't-tell digest entry has no digested line in decisions.md");
  // An absent decisions.md fails closed.
  const dir2 = tmpRun();
  plannedDigestConsole(dir2, null);
  assert.deepStrictEqual(readRunResidue(dir2).consoles.map((x) => x.items.map((i) => i.resolution)), [[DIGEST_PENDING_RESOLUTION]]);
});

test('a digested or already-digested AUTO line clears it (#4679)', () => {
  for (const line of [DIGESTED_LINE, DIGESTED_LINE.replace('digested (', 'already digested (')]) {
    const dir = tmpRun();
    plannedDigestConsole(dir, `## /wrap-up\n${line}\n`);
    assert.deepStrictEqual(readRunResidue(dir).consoles, [], line);
  }
  for (const word of ['SKIP', 'STAGED']) {
    const dir = tmpRun();
    plannedDigestConsole(dir, `${DIGESTED_LINE.replace('- AUTO ', `- ${word} `)}\n`);
    assert.deepStrictEqual(readRunResidue(dir).consoles.map((c) => c.items.map((i) => i.resolution)), [[DIGEST_PENDING_RESOLUTION]], word);
  }
});

test('a filed line clears a digest-pending entry too: an existing record wins over a digest (#4679)', () => {
  const dir = tmpRun();
  plannedDigestConsole(dir, `## /wrap-up\n- AUTO 10:00:00 — Queue write: tiebreak:bbbbbbbbbbbb filed as #77 (work-fingerprint consolefinding-4567ef01). Reversibility: n/a.\n`);
  assert.deepStrictEqual(readRunResidue(dir).consoles, []);
  assert.strictEqual(pendingDigests({ digests: [{ item: 'tiebreak:bbbbbbbbbbbb', fingerprint: 'consolefinding-4567ef01' }] }, '').length, 1, 'with no filed line the entry is still pending');
});

test('splitMissing never classifies a digest-pending item missing (#4679)', () => {
  const items = [{ id: 'wrap-up-docs-9.md', section: 'Queue writes', resolution: DIGEST_PENDING_RESOLUTION, reason: 'r' }];
  const { items: kept, missing } = splitMissing(items, tmpRun(), () => false);
  assert.deepStrictEqual(kept.map((i) => i.id), ['wrap-up-docs-9.md']);
  assert.deepStrictEqual(missing, []);
});

test('formatResidueLines names the digest re-run for a digest-pending item (#4679)', () => {
  const dir = tmpRun();
  plannedDigestConsole(dir, '');
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  const cmd = `node "/p/bin/console-filings.js" --run "${dir}" --existing <issues.json> --out-dir <dir> --digest-comments <comments.json>`;
  assert.strictEqual(consoleRerunCommand({ consoleDir: dir, pluginRoot: '/p' }), cmd);
  assert.ok(lines.includes(`    re-run digest: ${cmd}`), lines.join('\n'));
  assert.ok(!lines.some((l) => l.includes('--only')), 'the digest re-run names no --only');
});

test('a console with both pending kinds prints the one re-run command once, and each kind\'s remedy once (#4679)', () => {
  const dir = tmpRun();
  plannedFilingConsole(dir, '');
  const cj = JSON.parse(fs.readFileSync(path.join(dir, 'console.json'), 'utf8'));
  cj.items.push({ id: 'tiebreak:bbbbbbbbbbbb', section: 'Low-confidence findings', resolution: 'digested', reason: 'r' });
  cj.digests = [{ item: 'tiebreak:bbbbbbbbbbbb', fingerprint: 'consolefinding-4567ef01' }];
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(cj));
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  const cmd = consoleRerunCommand({ consoleDir: dir, pluginRoot: '/p' });
  assert.strictEqual(lines.filter((l) => l.includes(cmd)).length, 1, lines.join('\n'));
  assert.strictEqual(lines.filter((l) => l.includes('log-decision.js')).length, 2, 'each kind keeps its own log remedy');
  assert.strictEqual(lines.filter((l) => l.includes('gh issue list')).length, 1);
  assert.ok(lines.some((l) => l.startsWith('      (same re-run; <comments.json>')), lines.join('\n'));
});

test('two filing-pending items in one console print the re-run command once (#4679)', () => {
  const dir = tmpRun();
  plannedFilingConsole(dir, '');
  const cj = JSON.parse(fs.readFileSync(path.join(dir, 'console.json'), 'utf8'));
  cj.items.push({ id: 'tiebreak:cccccccccccc', section: 'Low-confidence findings', resolution: 'filed', reason: 'r' });
  cj.filings.push({ item: 'tiebreak:cccccccccccc', fingerprint: 'consolefinding-89abcdef', title: 'u' });
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(cj));
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.strictEqual(lines.filter((l) => l.includes(consoleRerunCommand({ consoleDir: dir, pluginRoot: '/p' }))).length, 1, lines.join('\n'));
});

test('a console with both a pending filing and a pending digest reports both (#4679)', () => {
  const dir = tmpRun();
  plannedFilingConsole(dir, '');
  const cj = JSON.parse(fs.readFileSync(path.join(dir, 'console.json'), 'utf8'));
  cj.digests = [{ item: 'tiebreak:bbbbbbbbbbbb', fingerprint: 'consolefinding-4567ef01' }];
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(cj));
  assert.deepStrictEqual(readRunResidue(dir).consoles.map((c) => c.items.map((i) => [i.id, i.resolution])), [[['tiebreak:aaaaaaaaaaaa', 'filing-pending'], ['tiebreak:bbbbbbbbbbbb', 'digest-pending']]]);
});

// Approved-but-unexecuted re-check proposal (#6284): read-time residue, never stored.
function recheckConsole(dir, items, staged = {}) {
  fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
  for (const [name, text] of Object.entries(staged)) fs.writeFileSync(path.join(dir, 'staged', name), text);
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ resolved: true, mode: 'confirm', items }));
}
const recheckItem = (n, resolution, pr = '77') => ({
  id: `followup-recheck-${n}.md`, section: 'Queue writes', resolution, reason: 'followup-recheck-approved', approval: { at: '2026-11-25T10:00:00.000Z', pr },
});
const recheckStaged = (n, action = 'close') => `Target: #${n}\nAction: ${action}\nBody-hash: ${'a'.repeat(64)}\nUpdated-at: 2026-11-25T09:00:00Z\n\n## Comment\nDone.\n`;

test('AC7.2: console-residue.js --run lists an approved unexecuted followup-recheck item naming #n and PR #p', () => {
  const dir = tmpRun();
  recheckConsole(dir, [recheckItem(412, 'pending')], { 'followup-recheck-412.md': recheckStaged(412, 'narrow') });
  const r = readRunResidue(dir);
  assert.deepStrictEqual(r.consoles[0].items.map((i) => [i.id, i.resolution, i.reason]), [['followup-recheck-412.md', RECHECK_APPROVED_RESOLUTION, 'approved #412 narrow waits on PR #77']]);
  assert.strictEqual(RECHECK_APPROVED_RESOLUTION, 'recheck-approved');
  assert.deepStrictEqual(r.consoles[0].missing, []);
});

test('an approved followup-recheck item whose staged file is gone is still residue, never missing, and a local merge is named so', () => {
  const dir = tmpRun();
  recheckConsole(dir, [recheckItem(9, 'pending', 'local')]);
  const r = readRunResidue(dir);
  assert.deepStrictEqual(r.consoles[0].items.map((i) => [i.resolution, i.reason]), [[RECHECK_APPROVED_RESOLUTION, 'approved #9 re-check proposal waits on local merge']]);
  assert.deepStrictEqual(r.consoles[0].missing, []);
});

test('AC16.1: that line carries the paste-ready execute command', () => {
  const dir = tmpRun();
  recheckConsole(dir, [recheckItem(412, 'pending'), recheckItem(9, 'pending', 'local')], { 'followup-recheck-412.md': recheckStaged(412) });
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.ok(lines.includes(`    execute: node "/p/bin/recheck-followups.js" execute --run "${dir}" --id followup-recheck-412.md`), lines.join('\n'));
  const at = lines.indexOf(`    execute: node "/p/bin/recheck-followups.js" execute --run "${dir}" --id followup-recheck-9.md --local-merged`);
  assert.ok(at !== -1, lines.join('\n'));
  assert.strictEqual(lines[at + 1], '    # local merge: run it only after the push landed');
  assert.ok(!lines.some((l) => l.includes('re-run ')), 'no console-filings re-run for this kind');
});

test('C1: an unapproved pending followup-recheck item (the unattended human-call) prints a paste-ready approve line, then its execute line', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ pr: { number: 12 } }));
  recheckConsole(dir, [{ id: 'followup-recheck-5.md', section: 'Queue writes', resolution: 'pending', reason: 'followup-recheck-human-call' }], { 'followup-recheck-5.md': recheckStaged(5) });
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  const approveAt = lines.indexOf(`    approve: node "/p/bin/recheck-followups.js" approve --run "${dir}" --id followup-recheck-5.md`);
  const executeAt = lines.indexOf(`    then after the merge: node "/p/bin/recheck-followups.js" execute --run "${dir}" --id followup-recheck-5.md`);
  assert.ok(approveAt !== -1, lines.join('\n'));
  assert.ok(executeAt > approveAt, lines.join('\n'));
  assert.ok(!lines.some((l) => l.includes('--pr')), 'approve derives the PR from the run itself');
  assert.ok(lines.some((l) => l.includes('--ack')), 'the ack line still prints');
});

test('C1: the execute line of an unapproved proposal in a local-merge run (config pin, or no PR) carries --local-merged', () => {
  for (const [state, config] of [[{ pr: { number: 12 } }, 'integration-model: local-merge\n'], [{ status: 'closed', worktree: null }, null]]) {
    const dir = tmpRun();
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
    if (config) fs.writeFileSync(path.join(dir, 'config.yml'), config);
    recheckConsole(dir, [{ id: 'followup-recheck-5.md', section: 'Queue writes', resolution: 'pending', reason: 'followup-recheck-human-call' }], { 'followup-recheck-5.md': recheckStaged(5) });
    const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
    const at = lines.indexOf(`    then after the merge: node "/p/bin/recheck-followups.js" execute --run "${dir}" --id followup-recheck-5.md --local-merged`);
    assert.ok(at !== -1, lines.join('\n'));
    assert.strictEqual(lines[at + 1], '    # local merge: run it only after the push landed');
  }
});

// AC16 (#6284): every approve/execute command the residue prints must paste and parse whole. `bash -n` checks the
// syntax only; it runs nothing.
const BASH = (() => {
  try { return require('child_process').spawnSync('bash', ['--version'], { windowsHide: true, stdio: 'ignore' }).status === 0; } catch { return false; }
})();
test('AC16: every re-check approve and execute command line the residue prints passes bash -n', { skip: !BASH && 'bash is not available' }, () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'config.yml'), 'integration-model: local-merge\n');
  recheckConsole(dir, [
    { id: 'followup-recheck-5.md', section: 'Queue writes', resolution: 'pending', reason: 'followup-recheck-human-call' },
    recheckItem(9, 'pending', 'local'),
    recheckItem(412, 'pending'),
    { id: 'q-2', resolution: 'pending', stagedFile: 'followup-recheck-8.md', approval: { at: 'then', pr: 'local' } },
  ], { 'followup-recheck-5.md': recheckStaged(5), 'followup-recheck-412.md': recheckStaged(412), 'followup-recheck-8.md': recheckStaged(8) });
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p lugin', maxItems: 10 });
  const commands = lines.map((l) => /^ {4}(?:approve|execute|then after the merge): (.*)$/.exec(l)).filter(Boolean).map((m) => m[1]);
  assert.strictEqual(commands.length, 5, lines.join('\n'));
  for (const cmd of commands) {
    const r = require('child_process').spawnSync('bash', ['-n', '-c', cmd], { windowsHide: true, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${cmd}\n${r.stderr}`);
  }
});

test('I3: an approved PR-console q-N row reads its staged id from stagedFile for its reason and its execute line', () => {
  const dir = tmpRun();
  recheckConsole(dir, [{ id: 'q-2', kind: 'x', resolution: 'pending', stagedFile: 'followup-recheck-412.md', approval: { at: 'then', pr: '77' } }], { 'followup-recheck-412.md': recheckStaged(412, 'narrow') });
  const r = readRunResidue(dir);
  assert.deepStrictEqual(r.consoles[0].items.map((i) => [i.id, i.resolution, i.reason]), [['q-2', RECHECK_APPROVED_RESOLUTION, 'approved #412 narrow waits on PR #77']]);
  const lines = formatResidueLines(r, { pluginRoot: '/p' });
  assert.ok(lines.includes(`    cat "${path.join(dir, 'staged', 'followup-recheck-412.md')}"`), lines.join('\n'));
  assert.ok(lines.includes(`    execute: node "/p/bin/recheck-followups.js" execute --run "${dir}" --id followup-recheck-412.md`), lines.join('\n'));
});

test('an applied or dropped followup-recheck item is not residue', () => {
  const dir = tmpRun();
  recheckConsole(dir, [recheckItem(1, 'applied'), recheckItem(2, 'dropped'), { id: 'followup-recheck-3.md', section: 'Queue writes', resolution: 'pending', reason: 'other' }]);
  assert.deepStrictEqual(consoleResidueItems(JSON.parse(fs.readFileSync(path.join(dir, 'console.json'), 'utf8'))).map((i) => i.id), ['followup-recheck-3.md']);
});
