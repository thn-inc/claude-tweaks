'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { run, parseArgs } = require('../../tools/review-replay');
const { parseDecisions, matchVerdicts, readRun, listRuns } = require('../../tools/review-replay/archive');
const schema = require('../../tools/review-replay/schema');
const { ARCHIVE, HEAD_A, BASE_A, HEAD_C, makeDeps } = require('./helpers');

const RUN_A = path.join(ARCHIVE, 'run-a');
const RUN_B = path.join(ARCHIVE, 'run-b');

async function baseline(extra = []) {
  const deps = makeDeps();
  const code = await run({ argv: ['baseline', '--runs', ARCHIVE, ...extra], deps });
  return { code, deps, out: deps.logs.length ? JSON.parse(deps.logs.join('\n')) : null };
}

test('AC1.1: baseline reports both reviewed runs with verdicts, head, base and cost', async () => {
  const { code, out } = await baseline();
  assert.equal(code, 0);
  assert.deepEqual(out.runs.map((r) => r.run), ['run-a', 'run-b']);
  const a = out.runs[0];
  assert.deepEqual(a.match.matched, { confirmed: 1, refuted: 1, 'cant-tell': 1 });
  assert.equal(a.head, HEAD_A);
  assert.equal(a.base, BASE_A);
  const timing = JSON.parse(fs.readFileSync(path.join(RUN_A, 'timing.json'), 'utf8'));
  const tiebreakItems = timing.dispatches.items.filter((i) => /^Tiebreak/i.test(i.description)).length;
  assert.equal(tiebreakItems, 3);
  assert.equal(a.cost.tiebreakAgents, tiebreakItems);
  assert.deepEqual(a.cost, { lensAgents: 4, tiebreakAgents: 3, lensOut: 370, lensCc: 37, tbOut: 36, tbCc: 3006, tbCr: 306, tbSeconds: 5 });
  assert.deepEqual(a.lensAgents.map((l) => [l.lens, l.side]), [['3a', 'A'], ['3a', 'B'], ['3b', 'A'], ['3b', 'B']]);
  assert.equal(a.findings, undefined, 'finding claims stay out of the baseline output');
  assert.equal(out.runs[1].head, HEAD_C);
  assert.equal(out.runs[1].base, 'c'.repeat(40));
  assert.equal(out.runs[1].cost.tiebreakAgents, 1);
  assert.deepEqual(out.runs[1].lensAgents.map((l) => l.side), ['A']);
});

test('AC1.2: a run without reviews is excluded with reason no-review', async () => {
  const { out } = await baseline();
  assert.ok(out.excluded.some((e) => e.run === 'run-none' && e.reason === 'no-review'));
  assert.ok(!out.runs.some((r) => r.run === 'run-none'));
});

test('AC1.3: an unreadable decisions.md is reported with reason decisions-unreadable and excluded', async () => {
  const { code, out } = await baseline();
  assert.equal(code, 0);
  assert.deepEqual(out.excluded.find((e) => e.run === 'run-bad'), { run: 'run-bad', reason: 'decisions-unreadable' });
  assert.ok(!out.runs.some((r) => r.run === 'run-bad'));
});

test('a missing decisions.md is excluded with reason no-decisions', () => {
  const r = readRun(path.join(ARCHIVE, 'run-missing'), makeDeps());
  assert.equal(r.excluded, 'no-decisions');
});

test('matchVerdicts counts fallbackMatched, verdictsWithoutFinding and findingsWithoutVerdict', () => {
  const deps = makeDeps();
  const a = readRun(RUN_A, deps);
  const ma = matchVerdicts(a.findings, a.verdicts, a.failedJudges);
  assert.equal(ma.fallbackMatched, 0);
  assert.equal(ma.verdictsWithoutFinding, 1);
  assert.equal(ma.findingsWithoutVerdict, 0);
  assert.deepEqual([...ma.byId.entries()], [['aaaaaaaaaaa1', 'confirmed'], ['aaaaaaaaaaa2', 'refuted'], ['aaaaaaaaaaa3', 'cant-tell']]);
  const b = readRun(RUN_B, deps);
  const mb = matchVerdicts(b.findings, b.verdicts, b.failedJudges);
  assert.equal(mb.fallbackMatched, 2);
  assert.equal(mb.findingsWithoutVerdict, 0);
  assert.equal(mb.byId.get('bbbbbbbbbbb1'), 'confirmed');
  assert.equal(mb.byId.get('bbbbbbbbbbb2'), 'refuted');
  assert.equal(b.findings[1].severity, 'unknown');
});

test('a finding with neither a verdict nor a failed judge counts as findingsWithoutVerdict', () => {
  const findings = [{ id: 'x1', lens: '3a', path: 'p.js', line: 1 }];
  assert.equal(matchVerdicts(findings, []).findingsWithoutVerdict, 1);
});

test('a finding with a null id matches no id-less verdict by id', () => {
  const findings = [{ id: null, lens: '3a', path: 'p.js', line: 1 }, { id: 'x2', lens: '3b', path: 'q.js', line: 2 }];
  const verdicts = [{ id: null, lens: '3z', path: 'z.js', line: 9, verdict: 'confirmed' }];
  const m = matchVerdicts(findings, verdicts);
  assert.equal(m.byId.size, 0);
  assert.equal(m.fallbackMatched, 0);
  assert.equal(m.verdictsWithoutFinding, 1);
  assert.equal(m.findingsWithoutVerdict, 2);
});

test('two findings at one lens/path/line each take their own verdict line; a missing one is findingsWithoutVerdict', () => {
  const findings = [{ id: 'x1', lens: '3a', path: 'p.js', line: 1 }, { id: 'x2', lens: '3a', path: 'p.js', line: 1 }];
  const at = (verdict) => ({ id: null, lens: '3a', path: 'p.js', line: 1, verdict });
  const two = matchVerdicts(findings, [at('confirmed'), at('refuted')]);
  assert.deepEqual([...two.byId.entries()], [['x1', 'confirmed'], ['x2', 'refuted']]);
  assert.equal(two.fallbackMatched, 2);
  assert.equal(two.findingsWithoutVerdict, 0);
  const one = matchVerdicts(findings, [at('confirmed')]);
  assert.deepEqual([...one.byId.keys()], ['x1']);
  assert.equal(one.findingsWithoutVerdict, 1);
  const judge = { id: null, lens: '3a', path: 'p.js', line: 1, reason: 'status:DONE' };
  const failed = matchVerdicts(findings, [], [judge]);
  assert.deepEqual(failed.failedJudgeByReason, { 'status:DONE': 1 });
  assert.equal(failed.findingsWithoutVerdict, 1);
});

test('a malformed review-findings.json is findings-unreadable in why; an absent one is not', () => {
  const garble = (file, text) => ({
    ...fs,
    readFileSync: (p, enc) => (String(p).endsWith(file) ? text : fs.readFileSync(p, enc)),
  });
  const bad = readRun(RUN_A, makeDeps({ fs: garble('review-findings.json', '{not json') }));
  assert.equal(bad.findings, null);
  assert.ok(bad.why.includes('findings-unreadable'));
  const notArray = readRun(RUN_A, makeDeps({ fs: garble('review-findings.json', '{"a":1}') }));
  assert.ok(notArray.why.includes('findings-unreadable'));
  const nullElement = readRun(RUN_A, makeDeps({ fs: garble('review-findings.json', '[null]') }));
  assert.equal(nullElement.findings, null);
  assert.ok(nullElement.why.includes('findings-unreadable'), 'a null element excludes the run with a reason instead of throwing');
  const absent = readRun(path.join(ARCHIVE, 'run-b'), makeDeps({ fs: { ...fs, readFileSync: (p, enc) => { if (String(p).endsWith('review-findings.json')) { const e = new Error('gone'); e.code = 'ENOENT'; throw e; } return fs.readFileSync(p, enc); } } }));
  assert.equal(absent.findings, null);
  assert.ok(!absent.why.includes('findings-unreadable'));
  assert.ok(schema.EXCLUSION_REASONS.includes('findings-unreadable'));
});

test('a digested status:DONE tiebreak line is a failed judge counted by reason, not a cant-tell verdict', () => {
  const a = readRun(RUN_A, makeDeps());
  const m = matchVerdicts(a.findings, a.verdicts, a.failedJudges);
  assert.deepEqual(m.failedJudgeByReason, { 'status:DONE': 1 });
  assert.equal(m.byId.has('aaaaaaaaaaa4'), false);
  assert.deepEqual([...m.failedJudgeIds], ['aaaaaaaaaaa4']);
  assert.equal(a.verdicts.filter((v) => v.verdict === 'cant-tell').length, 1);

  const text = [
    '- AUTO 1 — Tiebreak tiebreak:aaaaaaaaaaa5: lens "3a" finding x.js:1 digested: evidence-unverified. Severity: low.',
    '- AUTO 2 — Tiebreak tiebreak:aaaaaaaaaaa6: lens "3b" finding y.js:2 console: no-evidence.',
  ].join('\n');
  const p = parseDecisions(text);
  assert.deepEqual(p.verdicts, [{ id: 'aaaaaaaaaaa5', lens: '3a', path: 'x.js', line: 1, verdict: 'cant-tell' }]);
  assert.deepEqual(p.failedJudges, [{ id: 'aaaaaaaaaaa6', lens: '3b', path: 'y.js', line: 2, reason: 'no-evidence' }]);
});

test('parseDecisions ignores Console item lines, keeps reproduced pairs and fix commits, and splits CRLF', () => {
  const p = parseDecisions(fs.readFileSync(path.join(RUN_A, 'decisions.md'), 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(p.verdicts.filter((v) => v.path === 'src/alpha.js').length, 1);
  assert.deepEqual(p.pairConfirmed, [{ lens: '3a', path: 'src/pair.js', line: 5 }]);
  assert.deepEqual(p.fixCommits, ['1111111']);
  assert.equal(p.hasReview, true);
  const none = parseDecisions('- AUTO 1 — Reproduction: lens "3a" finding a.js:1 not reproduced. Staged.');
  assert.equal(none.hasReview, true);
  assert.deepEqual(none.pairConfirmed, []);
});

test('a verdict-looking line quoted inside an Evidence clause is not a verdict, and does not hide the line that quotes it', () => {
  const quoted = 'see lens "3a" finding b.js:2 confirmed by tiebreak:aaaaaaaaaaa8 and Console item 3';
  const text = `- AUTO 1 — Tiebreak tiebreak:aaaaaaaaaaa7: lens "3b" finding a.js:1 dropped: refuted by tiebreak. Evidence: a.js:1 "${quoted}". Severity: low. Reversibility: high.`;
  assert.deepEqual(parseDecisions(text).verdicts, [{ id: 'aaaaaaaaaaa7', lens: '3b', path: 'a.js', line: 1, verdict: 'refuted' }]);
});

test('a run whose decisions.md names no fix commit has no head, with why no-fix-commit', () => {
  const real = fs.readFileSync(path.join(RUN_A, 'decisions.md'), 'utf8');
  const noFix = real.split('\n').filter((l) => !l.includes('Step 3 Routing: applied')).join('\n');
  assert.notEqual(noFix, real);
  const deps = makeDeps({ fs: { ...fs, readFileSync: (p, enc) => (String(p).endsWith('decisions.md') ? noFix : fs.readFileSync(p, enc)) } });
  const r = readRun(RUN_A, deps);
  assert.equal(r.head, null);
  assert.ok(r.why.includes('no-fix-commit'));
});

test('listRuns throws for a root it cannot read, and skips only an absent archive directory under it', () => {
  assert.throws(() => listRuns(path.join(ARCHIVE, 'no-such-root'), fs), { code: 'ENOENT' });
  const noArchive = listRuns(RUN_A, fs).map((d) => path.basename(d));
  assert.ok(noArchive.includes('context'), 'a root with no archive subdirectory lists its own directories');
});

test('readRun returns the run\'s context/review-dispatch.md text as dispatchBundle, null for a run without one', () => {
  const deps = makeDeps();
  const a = readRun(RUN_A, deps);
  assert.match(a.dispatchBundle, /^`READ-ONLY REVIEW: /m);
  assert.match(a.dispatchBundle, /^`SHELL DISCIPLINE: /m);
  assert.equal(readRun(RUN_B, deps).dispatchBundle, null);
  assert.deepEqual(a.specFiles, ['work/101-spec.md']);
});

test('readRun records why a head or base is missing instead of guessing', () => {
  const noCommit = readRun(RUN_A, makeDeps({ git: () => { throw new Error('unknown'); } }));
  assert.equal(noCommit.head, null);
  assert.deepEqual(noCommit.why, ['fix-commit-not-in-clone']);
  assert.equal(noCommit.excluded, null);
  assert.equal(readRun(RUN_A, makeDeps()).base, BASE_A);
});

test('listRuns returns run directories under the root and its archive subdirectory, sorted by basename', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rr-list-'));
  try {
    fs.mkdirSync(path.join(root, 'archive', 'run-b'), { recursive: true });
    fs.mkdirSync(path.join(root, 'run-c'));
    fs.mkdirSync(path.join(root, 'run-a'));
    fs.writeFileSync(path.join(root, 'stray.txt'), 'x');
    assert.deepEqual(listRuns(root, fs).map((d) => path.basename(d)), ['run-a', 'run-b', 'run-c']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('baseline --select runs only the named runs in the given order and rejects an unknown name', async () => {
  const { code, out } = await baseline(['--select', 'run-b,run-a']);
  assert.equal(code, 0);
  assert.deepEqual(out.runs.map((r) => r.run), ['run-b', 'run-a']);
  const bad = makeDeps();
  assert.equal(await run({ argv: ['baseline', '--runs', ARCHIVE, '--select', 'run-nope'], deps: bad }), 2);
  assert.match(bad.errs.join('\n'), /run-nope/);
});

test('parseArgs rejects an unknown subcommand with exit 2', async () => {
  assert.match(parseArgs(['frobnicate']).error, /unknown command: frobnicate/);
  assert.match(parseArgs([]).error, /command is required/);
  assert.match(parseArgs(['baseline']).error, /--runs/);
  assert.match(parseArgs(['baseline', '--runs']).error, /requires a value/);
  assert.match(parseArgs(['baseline', '--runs', 'x', '--bogus']).error, /unknown argument/);
  const deps = makeDeps();
  assert.equal(await run({ argv: ['frobnicate'], deps }), 2);
  assert.match(deps.errs.join('\n'), /usage:/);
});

test('schema: armLabel round-trips through parseArmLabel, IDENTITY_RE reads the label, validateManifest names problems', () => {
  const label = schema.armLabel('one', 2, 'run-a--0');
  assert.equal(label, 'one|2|run-a--0');
  assert.deepEqual(schema.parseArmLabel(label), { arm: 'one', repeat: 2, name: 'run-a--0' });
  assert.equal(schema.parseArmLabel('no pipes'), null);
  assert.equal(schema.IDENTITY_RE.exec(`Replay judge ${label}.\nrest`)[1], label);
  const arm = { name: 'one', chunk: 2, profile: 'fast', model: 'haiku', effort: 'low', repeat: 1, prompts: [{ file: '/p', name: 'n', run: 'run-a', findingIds: ['x'] }] };
  const manifest = { schemaVersion: 1, template: { path: 't', sha1: 's' }, arms: [arm] };
  assert.deepEqual(schema.validateManifest(manifest), []);
  const problems = schema.validateManifest({ ...manifest, arms: [{ ...arm, repeat: 0, extra: 1, prompts: [{ file: '/p' }] }], schemaVersion: 2 });
  assert.ok(problems.some((p) => /schemaVersion/.test(p)));
  assert.ok(problems.some((p) => /repeat must be a positive integer/.test(p)));
  assert.ok(problems.some((p) => /unknown key extra/.test(p)));
  assert.ok(problems.some((p) => /missing key findingIds/.test(p)));
  assert.ok(schema.validateManifest(null).length > 0);
});
