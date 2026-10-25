'use strict';
// tests/tidy-console-backfill-conformance.test.js — pins /claude-tweaks:tidy --console-backfill (#3950):
// the procedure in plugin/skills/tidy/console-backfill.md, its routing from tidy/SKILL.md, the
// reference-card/frontmatter hint, the skill-graph row and the materiality-floor values it adds.
// Reads live prose because these files ARE the declared contract of the mode (skill-prose-conformance-tests,
// "read live prose only when the prose is the declared contract"); every assertion goes red against a
// doctored copy of the live text, matched to its own message.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { DEFER_REASONS } = require('../plugin/bin/lib/issues/record');
const { REFLECT_NO_DESTINATION } = require('../plugin/bin/lib/console/reflect-destination');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const PROC_REL = 'plugin/skills/tidy/console-backfill.md';
const collapse = (s) => s.replace(/\s+/g, ' ');

// The hint is the oracle: a literal here, not an import (docs/skill-authoring.md's mirror table).
const NEW_HINT = '[--scope=<name>[,<name>...]] [--dry-run] [--approve [run-dir]] [--console-backfill]';

// One entry per decision the procedure states. Non-global patterns over whitespace-collapsed text.
const FACTS = [
  ['apply --entries', /apply --entries/],
  ['resolve-tiebreak', /resolve-tiebreak/],
  ['step3-tiebreak.md', /step3-tiebreak\.md/],
  ['waves of 8', /waves of 8/],
  ['never writes console.json', /never writes `console\.json`/],
  ['needs:definition', /needs:definition/],
  ['auto:*', /auto:\*/],
  ['bot:*', /bot:\*/],
  ['re-dispatched once', /re-dispatched once/],
  ['step-8 order sentence', /dedup → file or digest → record ref → apply/],
  ['scope+approve rejected', /`--scope` and `--approve`[^\n]{0,80}rejected in combination/],
  ['dry-run re-implemented', /`--dry-run`[^\n]{0,80}re-implemented/],
  ['main session only', /no `Agent` tool[^\n]{0,120}stops and reports/],
  ['batch limit', /--limit 24/],
  ['stale-hash re-list once', /`stale-hash` means re-list once, never force/],
  ['re-list before every batch', /before EVERY batch/],
  ['Labels: none is no label', /`Labels: none`[^\n]{0,80}no label/],
  ['digest comment cap', /under 60,000 characters/],
  // R10: a prefiled finding settles without a verdict; verdicts persist across passes.
  ['prefiled finding needs no verdict', /comes back as a `reuse` with no verdict needed, and never as `awaitingVerdict`/],
  ['verdicts kept across passes', /kept across passes, keyed by item id/],
  ['verdicts file initialised by the write-json fence', /initialise `\{VERDICTS\}` with the write-json fence/],
  ['plan fence prints drop evidence', /`drops` lists each refuted finding with its evidence/],
  ['run stamp for fresh tiebreak files', /Take a run stamp with one plain call/],
  // R11: the dedup read is sized from the repo; a count at the cap is truncated.
  ['dedup read counted at the cap', /--limit 100000 --json number --jq length/],
  ['count equal to the cap is truncated', /equal to 100000 is truncated, not complete/],
  // R15: the existing-records read carries titles, so a proposal filed before the backfill dedups by exact title.
  ['dedup read carries number, title and body', /--state all --limit \{count \+ 100\} --json number,title,body > "\{EXISTING\}"/],
  // R12: GitHub Issues only.
  ['work-backend gate', /HELD — console backfill needs work-backend: github-issues; local-files support is tracked as the backlog record "Console backfill: settle Review Console residue under work-backend: local-files"/],
  // Minors.
  ['Type label on top of Labels', /On top of those, the Type row's expression/],
  ['first stale-hash exempt from the failed set', /except the first `stale-hash` refusal of an item/],
  ['no-defer-reason keeps the run PARTIAL', /reason `no-defer-reason`[^\n]{0,120}outcome stays `PARTIAL`/],
  ['landed, not applied report line', /landed, not applied: \{itemId\}/],
  ['fallback worktree torn down with git worktree remove', /`git worktree remove \{path\}`/],
];

function missingFacts(collapsed) {
  return FACTS.filter(([, re]) => !re.test(collapsed)).map(([name]) => name);
}

const idx = (t, needle) => t.indexOf(needle);
function dryRunBeforeMain(collapsed) {
  const a = idx(collapsed, 'list --dry-run');
  const b = idx(collapsed, 'list --main-sha');
  assert.notStrictEqual(a, -1, 'list --dry-run is missing');
  assert.notStrictEqual(b, -1, 'list --main-sha is missing');
  return a < b;
}

// AC6.1b: the procedure never writes console.json directly — only apply does. A line that pairs a
// Write/Edit verb, or a `>` redirect, with a path ending console.json is a write.
function consoleJsonWriteTargets(text) {
  return text.split('\n').filter((l) => /\b(?:Write|Edit)\b[^\n]*console\.json/.test(l) || />\s*"?[^\s"`]*console\.json/.test(l));
}

function assertProcedure(text) {
  const collapsed = collapse(text);
  assert.deepStrictEqual(missingFacts(collapsed), [], 'console-backfill.md no longer states these decisions');
  assert.ok(dryRunBeforeMain(collapsed), 'list --dry-run must appear before list --main-sha');
  assert.deepStrictEqual(consoleJsonWriteTargets(text), [], 'AC6.1b: the procedure never writes console.json directly');
}

const PROC = read(PROC_REL);

test('the procedure states every pinned decision, in order, and never writes console.json', () => {
  assertProcedure(PROC);
});

test('AC6.1b: the procedure never writes console.json directly', () => {
  assert.deepStrictEqual(consoleJsonWriteTargets(PROC), []);
});

test('go-red: stripping any one fact is reported as exactly that fact', () => {
  for (const [name, re] of FACTS) {
    const g = new RegExp(re.source, 'g');
    const doctored = collapse(PROC).replace(g, '');
    assert.notStrictEqual(doctored, collapse(PROC), `${name}: the strip matched nothing`);
    assert.deepStrictEqual(missingFacts(doctored), [name], `${name}: not reported as exactly itself`);
  }
});

test('go-red: the step-8 order sentence deleted makes assertProcedure throw', () => {
  const doctored = PROC.replace(/dedup\s+→\s+file or digest\s+→\s+record ref\s+→\s+apply/g, '');
  assert.notStrictEqual(doctored, PROC);
  assert.throws(() => assertProcedure(doctored), /step-8 order sentence/);
});

test('go-red: list --dry-run moved after list --main-sha is caught (permutation, not deletion)', () => {
  const collapsed = collapse(PROC);
  assert.ok(dryRunBeforeMain(collapsed));
  const permuted = `${collapsed.replace(/list --dry-run/g, 'list --summary-only')} list --dry-run`;
  assert.notStrictEqual(permuted, collapsed);
  assert.strictEqual(dryRunBeforeMain(permuted), false);
  assert.throws(() => assertProcedure(permuted), /list --dry-run must appear before list --main-sha/);
});

test('go-red: a Write or redirect aimed at console.json is caught, and the helper sees both forms', () => {
  assert.strictEqual(consoleJsonWriteTargets('Write the result to {dir}/console.json').length, 1);
  assert.strictEqual(consoleJsonWriteTargets('node x.js > {dir}/console.json').length, 1);
  assert.strictEqual(consoleJsonWriteTargets('`apply` never writes `console.json`; it rewrites the console').length, 0);
  const doctored = `${PROC}\nWrite the entries into {run-dir}/console.json by hand.\n`;
  assert.throws(() => assertProcedure(doctored), /AC6\.1b/);
});

test('the three routing surfaces carry the one hint', () => {
  const skill = read('plugin/skills/tidy/SKILL.md');
  assert.ok(skill.includes(`argument-hint: "${NEW_HINT}"`), 'frontmatter argument-hint');
  assert.ok(skill.includes(`\`$ARGUMENTS\` is parsed as \`${NEW_HINT}\``), 'input-parse-line');
  const card = read('plugin/skills/help/reference-card.md');
  const row = card.split('\n').find((l) => l.startsWith('| `/claude-tweaks:tidy` |'));
  assert.ok(row && row.includes(`\`${NEW_HINT.replace(/\|/g, '\\|')}\``), 'reference-card Takes cell');
});

test('SKILL.md routes --console-backfill to console-backfill.md', () => {
  const body = collapse(read('plugin/skills/tidy/SKILL.md')).split('## Scope Selection')[0];
  const ROUTE = /`--console-backfill`[\s\S]{0,300}`console-backfill\.md`/;
  assert.match(body, ROUTE);
  assert.doesNotMatch(body.replace(/`console-backfill\.md`/g, ''), ROUTE, 'the pattern must go red without the file name');
});

test('materiality-floor.md documents the three console-backfill values and reflect-no-destination as Entry-format values, outside DEFER_REASONS', () => {
  const floor = read('plugin/skills/_shared/materiality-floor.md');
  const at = floor.indexOf('### Console backfill values');
  const prev = floor.indexOf("### Tiebreak can't-tell value");
  const next = floor.indexOf('### Digest URL and count surfacing');
  assert.ok(prev !== -1 && at > prev && next > at, 'subsection sits between Tiebreak can\'t-tell value and Digest URL and count surfacing');
  const section = floor.slice(at, next);
  for (const v of ['console-backfill-no-claim', 'console-backfill-unmapped-kind', 'console-backfill-confirmed-low', REFLECT_NO_DESTINATION]) {
    assert.ok(section.includes(`\`${v}\``), `${v} is named`);
    assert.ok(!DEFER_REASONS.includes(v), `${v} must not be in DEFER_REASONS`);
  }
  assert.match(collapse(section), /Deliberately \*\*not\*\* in `DEFER_REASONS`/);
  assert.ok(!section.includes('### ', 4), 'the slice holds one subsection');
});

test('skill-graph.md has a /review row under /tidy naming the tiebreak template and resolver', () => {
  const graph = read('docs/skill-graph.md');
  const start = graph.indexOf('\n## tidy\n');
  const end = graph.indexOf('\n## visual-review\n');
  assert.ok(start !== -1 && end > start);
  const row = graph.slice(start, end).split('\n').find((l) => l.startsWith('| `/review` |'));
  assert.ok(row, 'a /review row exists under ## tidy');
  assert.ok(row.includes('step3-tiebreak.md') && row.includes('resolve-tiebreak'), row);
});

// --- The three node -e fences are executed, not just matched (docs/skill-authoring.md, Executable snippets) ---
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function fenceWith(token) {
  const fences = [...PROC.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((m) => m[1]).filter((f) => f.includes('node -e'));
  const hits = fences.filter((f) => f.includes(token));
  assert.strictEqual(hits.length, 1, `exactly one node -e fence carries ${token} (extraction out of sync with the doc)`);
  return hits[0].trim();
}

function runFence(fence, vars) {
  let cmd = fence;
  for (const [k, v] of Object.entries(vars)) cmd = cmd.split(`{${k}}`).join(v);
  return spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
}

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-backfill-prose-'));
}

test('filter fence: drops the failed set, counts the list and what is eligible, writes the filtered work list', () => {
  const dir = scratch();
  try {
    const items = ['a', 'b', 'c'].map((id, n) => ({ itemId: `bf:${id}`, kind: 'no-claim', itemHash: `h${n}` }));
    const wl = { mainSha: 's', runs: [{ runDir: 'r1', items: items.slice(0, 2) }, { runDir: 'r2', items: items.slice(2) }] };
    fs.writeFileSync(path.join(dir, 'w.json'), JSON.stringify(wl));
    const fence = fenceWith('eligible');
    const r = runFence(fence, { WORKLIST: path.join(dir, 'w.json'), BATCHLIST: path.join(dir, 'b.json'), 'failed-itemIds': 'bf:b' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), { remaining: 3, eligible: 2 });
    const cut = JSON.parse(fs.readFileSync(path.join(dir, 'b.json'), 'utf8'));
    assert.deepStrictEqual(cut.runs.map((x) => x.items.map((i) => i.itemHash)), [['h0'], ['h2']]);
    assert.strictEqual(cut.mainSha, 's');
    // Everything failed: eligible 0 with a non-empty remaining is the "stop, items remain" signal.
    const all = runFence(fence, { WORKLIST: path.join(dir, 'w.json'), BATCHLIST: path.join(dir, 'b2.json'), 'failed-itemIds': 'bf:a bf:b bf:c' });
    assert.deepStrictEqual(JSON.parse(all.stdout), { remaining: 3, eligible: 0 });
    // Nothing failed: the list passes through whole.
    const none = runFence(fence, { WORKLIST: path.join(dir, 'w.json'), BATCHLIST: path.join(dir, 'b3.json'), 'failed-itemIds': '' });
    assert.deepStrictEqual(JSON.parse(none.stdout), { remaining: 3, eligible: 3 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('plan fence: prints the fields the procedure acts on from the real CLI plan, drops and file paths included', () => {
  const { run } = require('../plugin/bin/console-backfill');
  const dir = scratch();
  try {
    const mk = (n, over) => ({
      itemId: `bf:${n}`, itemHash: `h${n}`, kind: 'finding', section: 'Low-confidence findings', consoleDir: '/x/pipelines/2026-10-24T090000-spec-12', storedIndices: [0],
      finding: { lens: '3a', path: `src/f${n}.js`, line: 9, reporterSeverity: 'medium', kind: 'unconfirmed' }, claimText: `claim number ${n}`, context: 'ctx', ...over,
    });
    const wl = { mainSha: 'abc', runs: [{ runDir: '/x/pipelines/archive/run-0', items: [mk(1), mk(2), mk(3)] }] };
    const evidence = { path: 'src/f2.js', line: 9, quote: 'guard(x);' };
    const verdicts = {
      'bf:1': { outcome: 'console', severity: 'medium', evidence: null, reason: 'verdict:cant-tell', recommendation: 'file' },
      'bf:2': { outcome: 'drop', severity: 'medium', evidence, reason: 'refuted by tiebreak', recommendation: null },
    };
    fs.writeFileSync(path.join(dir, 'w.json'), JSON.stringify(wl));
    fs.writeFileSync(path.join(dir, 'v.json'), JSON.stringify(verdicts));
    let out = '';
    const code = run(['dispose', '--work-list', path.join(dir, 'w.json'), '--verdicts', path.join(dir, 'v.json'), '--out-dir', path.join(dir, 'filings')], { stdout: (s) => { out += s; }, stderr: () => {} });
    assert.strictEqual(code, 0);
    fs.writeFileSync(path.join(dir, 'p.json'), out);
    const plan = JSON.parse(out);
    const r = runFence(fenceWith('digestLines'), { PLAN: path.join(dir, 'p.json') });
    assert.strictEqual(r.status, 0, r.stderr);
    const printed = JSON.parse(r.stdout);
    assert.strictEqual(printed.dispositions, 2);
    assert.strictEqual(printed.file.length, 1);
    assert.strictEqual(printed.file[0].path, plan.file[0].path, 'the fence reads the key the CLI emits');
    assert.ok(fs.existsSync(printed.file[0].path), 'file[].path is the proposal file');
    assert.deepStrictEqual(printed.drops, [{ itemId: 'bf:2', ref: 'src/f2.js:9 "guard(x);"' }]);
    assert.deepStrictEqual(printed.awaitingVerdict, ['bf:3']);
    assert.strictEqual(printed.digestLines, 0);
    assert.ok(r.stdout.split('\n').length > 1, 'pretty-printed, so it is readable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('write-json fence: writes the given JSON over an existing file with no Write tool involved', () => {
  const dir = scratch();
  try {
    const target = path.join(dir, 'v.json');
    fs.writeFileSync(target, '{"stale":true}');
    const fence = fenceWith('writeFileSync(process.argv[1],process.argv[2])');
    assert.strictEqual(runFence(fence, { path: target, json: '{}' }).status, 0);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '{}');
    assert.strictEqual(runFence(fence, { path: target, json: '{"bf:a":"#7","bf:b":"https://example.test/c/1"}' }).status, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { 'bf:a': '#7', 'bf:b': 'https://example.test/c/1' });
    assert.ok(!/[`$]/.test(fence), 'no $ or backtick, so bash expands nothing in the double-quoted program');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('awaiting fence: lists the awaiting findings with a file-safe name, capped at n', () => {
  const dir = scratch();
  try {
    const mk = (id) => ({ itemId: id, kind: 'finding', finding: { lens: '3a', path: 'x.js', line: 1, reporterSeverity: 'high', kind: 'unconfirmed' }, claimText: `claim ${id}`, context: 'ctx' });
    const wl = { runs: [{ runDir: 'r1', items: [mk('bf:a:1'), { itemId: 'bf:z', kind: 'no-claim' }] }, { runDir: 'r2', items: [mk('bf:b'), mk('bf:c')] }] };
    fs.writeFileSync(path.join(dir, 'w.json'), JSON.stringify(wl));
    fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify({ awaitingVerdict: ['bf:a:1', 'bf:b', 'bf:c'] }));
    const fence = fenceWith('want.has');
    const vars = { BATCHLIST: path.join(dir, 'w.json'), PLAN: path.join(dir, 'p.json'), AWAITING: path.join(dir, 'aw.json') };
    assert.strictEqual(runFence(fence, vars).status, 0);
    const out = JSON.parse(fs.readFileSync(vars.AWAITING, 'utf8'));
    assert.deepStrictEqual(out.map((i) => [i.itemId, i.name]), [['bf:a:1', 'a_1'], ['bf:b', 'b'], ['bf:c', 'c']]);
    assert.strictEqual(out[0].claimText, 'claim bf:a:1');
    assert.ok(fence.includes(' 24 '), 'the fence passes the cap 24');
    runFence(fence.replace(' 24 ', ' 2 '), vars);
    assert.strictEqual(JSON.parse(fs.readFileSync(vars.AWAITING, 'utf8')).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verdict-merge fence: adds the verdicts it finds, keeps earlier ones, names the missing', () => {
  const dir = scratch();
  try {
    const tb = path.join(dir, 'tb');
    fs.mkdirSync(tb);
    fs.writeFileSync(path.join(tb, 'a-verdict.json'), JSON.stringify({ outcome: 'drop', severity: 'low' }));
    fs.writeFileSync(path.join(tb, 'b-verdict.json'), '');
    fs.writeFileSync(path.join(dir, 'aw.json'), JSON.stringify([{ itemId: 'bf:a', name: 'a' }, { itemId: 'bf:b', name: 'b' }, { itemId: 'bf:c', name: 'c' }]));
    fs.writeFileSync(path.join(dir, 'v.json'), JSON.stringify({ 'bf:x': { outcome: 'digest' } }));
    const r = runFence(fenceWith('no outcome'), { VERDICTS: path.join(dir, 'v.json'), TBDIR: tb, AWAITING: path.join(dir, 'aw.json') });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), { added: ['bf:a'], missing: ['bf:b', 'bf:c'] });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'v.json'), 'utf8')), { 'bf:x': { outcome: 'digest' }, 'bf:a': { outcome: 'drop', severity: 'low' } });
    // A first pass with no verdicts file yet starts from {}.
    fs.rmSync(path.join(dir, 'v.json'));
    runFence(fenceWith('no outcome'), { VERDICTS: path.join(dir, 'v.json'), TBDIR: tb, AWAITING: path.join(dir, 'aw.json') });
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'v.json'), 'utf8'))), ['bf:a']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('digest fence: chunks the lines under the cap and maps each chunk to its items', () => {
  const dir = scratch();
  try {
    const mk = (id) => ({ itemId: id, action: 'digest', digest: { line: `- line for ${id}` } });
    const plan = { dispositions: [mk('bf:1'), mk('bf:2'), mk('bf:3'), mk('bf:dup')], digest: { lines: ['- line for bf:1', '- line for bf:2', '- line for bf:3'], duplicates: ['bf:dup'] } };
    fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify(plan));
    const fence = fenceWith('digest-');
    const vars = { PLAN: path.join(dir, 'p.json'), DIGESTDIR: path.join(dir, 'd') };
    const whole = JSON.parse(runFence(fence, vars).stdout);
    assert.deepStrictEqual(whole.map((c) => c.itemIds), [['bf:1', 'bf:2', 'bf:3']]);
    assert.strictEqual(fs.readFileSync(whole[0].path, 'utf8'), '- line for bf:1\n- line for bf:2\n- line for bf:3\n');
    // A cap that fits two lines splits the batch in two; 60000 is the fence's own literal.
    assert.ok(fence.includes(' 60000'), 'the fence passes the 60,000 cap');
    const split = JSON.parse(runFence(fence.replace(' 60000', ' 40'), vars).stdout);
    assert.deepStrictEqual(split.map((c) => c.itemIds), [['bf:1', 'bf:2'], ['bf:3']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('settle fence: fills refs, resolves a same-batch twin, leaves a ref-less item out as unsettled', () => {
  const dir = scratch();
  try {
    const e = (itemId, ref) => ({ runDir: 'r', itemId, itemHash: 'h', outcome: 'filed', source: 'tiebreak', ref });
    const plan = { reuse: [{ itemId: 'bf:twin', number: null, sameAs: 'bf:new' }], entries: [e('bf:new', null), e('bf:twin', null), e('bf:old', '#7'), e('bf:failed', null), e('bf:dig', null)] };
    fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify(plan));
    fs.writeFileSync(path.join(dir, 'r.json'), JSON.stringify({ 'bf:new': '#42', 'bf:dig': 'https://example.test/c/1' }));
    const r = runFence(fenceWith('unsettled'), { PLAN: path.join(dir, 'p.json'), REFS: path.join(dir, 'r.json'), ENTRIES: path.join(dir, 'e.json') });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), { entries: 4, unsettled: ['bf:failed'] });
    const entries = JSON.parse(fs.readFileSync(path.join(dir, 'e.json'), 'utf8'));
    assert.deepStrictEqual(entries.map((x) => [x.itemId, x.ref]), [['bf:new', '#42'], ['bf:twin', '#42'], ['bf:old', '#7'], ['bf:dig', 'https://example.test/c/1']]);
    // No refs file at all (a pass that filed nothing): only the plan's own refs settle, nothing throws.
    const none = runFence(fenceWith('unsettled'), { PLAN: path.join(dir, 'p.json'), REFS: path.join(dir, 'absent.json'), ENTRIES: path.join(dir, 'e2.json') });
    assert.strictEqual(none.status, 0, none.stderr);
    assert.deepStrictEqual(JSON.parse(none.stdout), { entries: 1, unsettled: ['bf:new', 'bf:twin', 'bf:failed', 'bf:dig'] });
    // M1: a same-pass digest repeat takes the comment URL its twin's line was posted in.
    fs.writeFileSync(path.join(dir, 'p3.json'), JSON.stringify({ ...plan, entries: [...plan.entries, e('bf:dig2', null)], digest: { lines: [], duplicates: ['bf:dig2'], sameAs: [{ itemId: 'bf:dig2', sameAs: 'bf:dig' }] } }));
    const twin = runFence(fenceWith('unsettled'), { PLAN: path.join(dir, 'p3.json'), REFS: path.join(dir, 'r.json'), ENTRIES: path.join(dir, 'e3.json') });
    assert.strictEqual(twin.status, 0, twin.stderr);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'e3.json'), 'utf8')).map((x) => [x.itemId, x.ref]).slice(-1), [['bf:dig2', 'https://example.test/c/1']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
