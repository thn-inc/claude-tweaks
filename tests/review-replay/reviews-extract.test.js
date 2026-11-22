'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { run, makeWriteRepo } = require('../../tools/review-replay');
const schema = require('../../tools/review-replay/schema');
const { toPosix } = schema;
const { scratchDir } = require('../helpers/tmp-dir');
const { runWorkflow } = require('./helpers');
const { buildReviewsFixture, RUN, RUN_GONE } = require('./reviews-fixture');
const { unrewrittenPaths } = require('../../tools/review-replay/reviews-rewrite');

const REMOVED = '[run-directory path removed]';

const PLUGIN_ROOT = path.join(__dirname, '..', '..', 'plugin');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const gitIn = (cwd) => (...args) => execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8', windowsHide: true }).trim();

let fx;
let root;
before(() => {
  root = scratchDir('rr-reviews-');
  fx = buildReviewsFixture(root, { decisions: true, gone: true, repeat: true });
});

function makeDeps() {
  const logs = [];
  const errs = [];
  const git = (args) => execFileSync('git', args, { cwd: fx.mainRoot, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return { fs, git, writeRepo: makeWriteRepo(fx.mainRoot), pluginRoot: PLUGIN_ROOT, log: (s) => logs.push(s), err: (s) => errs.push(s), logs, errs };
}

let outN = 0;
// Runs extract-reviews into a fresh --out; `arms` replaces the one default arm.
async function extractReviews({ arms = ['--arm', 'name=haiku,profile=fast'], extra = [] } = {}) {
  outN += 1;
  const out = path.join(root, `out-${outN}`);
  const deps = makeDeps();
  const code = await run({ argv: ['extract-reviews', '--runs', fx.runsRoot, '--out', out, '--role', 'lens', '--transcripts', fx.transcripts, ...arms, ...extra], deps });
  const json = (name) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
  return { code, deps, out, json };
}

const memo = (f) => {
  let p;
  return () => (p || (p = f()));
};
const oneArm = memo(() => extractReviews());
const twoArms = memo(() => extractReviews({ arms: ['--arm', 'name=haiku,profile=fast', '--arm', 'name=sonnet,profile=standard'] }));

// Every file under `dir`, recursively, leaving out .git directories.
const filesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === '.git') return [];
  const full = path.join(dir, e.name);
  return e.isDirectory() ? filesUnder(full) : [full];
});
const read = (f) => fs.readFileSync(f, 'utf8');
const count = (text, needle) => text.split(needle).length - 1;
const ok = (x) => assert.equal(x.code, 0, x.deps.errs.join('\n'));

test('AC1.1/AC1.2: one clean repository per review with two commits and the archived file list', async () => {
  const x = await twoArms();
  ok(x);
  const repos = fs.readdirSync(path.join(x.out, 'repos')).filter((d) => fs.existsSync(path.join(x.out, 'repos', d, 'repo')));
  assert.deepEqual(repos, [`${RUN}--r1`]);
  const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
  assert.equal(fixture.repos.length, 1);
  const repo = fixture.repos[0];
  assert.equal(repo.path, path.join(x.out, 'repos', `${RUN}--r1`, 'repo'));
  assert.deepEqual([repo.archivedBase, repo.archivedHead], [fx.B, fx.H]);
  const inRepo = gitIn(repo.path);
  assert.equal(inRepo('log', '--format=%s'), 'head\nbase');
  const names = (stat) => stat.split('\n').slice(0, -1).map((l) => l.split('|')[0].trim());
  const replayed = names(inRepo('diff', `${repo.replayBase}...${repo.replayHead}`, '--stat'));
  assert.deepEqual(replayed, names(gitIn(fx.mainRoot)('diff', `${fx.B}...${fx.H}`, '--stat')));
  assert.deepEqual(replayed, ['src/a.js', 'src/b.js']);
  const manifest = x.json(schema.REVIEWS_MANIFEST_FILE);
  for (const arm of manifest.arms) for (const p of arm.prompts) assert.equal(p.repo, repo.path, `${arm.name} ${p.name}`);
});

test('AC2.1/AC2.2: no prompt names an archived sha or a fixture path', async () => {
  const x = await twoArms();
  ok(x);
  const { replayBase, replayHead } = x.json(schema.REVIEWS_FIXTURE_FILE).repos[0];
  const prompts = x.json(schema.REVIEWS_MANIFEST_FILE).arms.flatMap((a) => a.prompts);
  assert.ok(prompts.length > 0);
  for (const p of prompts) {
    const text = read(p.file);
    for (const needle of [fx.B, fx.H, fx.B.slice(0, 7), fx.worktree, fx.mainRoot]) assert.ok(!text.includes(needle), `${p.file} names ${needle}`);
    assert.ok(text.includes(toPosix(p.repo)), `${p.file} names its repo`);
    assert.ok(text.includes(replayBase) && text.includes(replayHead), `${p.file} names the replay shas`);
  }
});

test('AC3.1/AC3.2/AC3.3: decisions.md and a gone run input are excluded', async () => {
  const x = await oneArm();
  ok(x);
  const { excluded } = x.json(schema.REVIEWS_FIXTURE_FILE);
  const reasonOf = (agentId) => excluded.filter((e) => e.agentId === agentId).map((e) => e.reason);
  assert.deepEqual(reasonOf('l3c-a'), ['unknown-run-input']);
  assert.deepEqual(reasonOf('l3d-a'), ['run-input-gone']);
  assert.deepEqual(excluded.find((e) => e.agentId === 'l3c-a'), { run: RUN, agentId: 'l3c-a', lens: '3c', side: 'a', reason: 'unknown-run-input' });
  assert.deepEqual(reasonOf('impl-1'), [], 'a dispatch that is not a lens reviewer is never an exclusion');
  assert.equal(excluded[0].run, RUN_GONE, 'runs are read newest first');
  const promptFiles = filesUnder(path.join(x.out, 'prompts')).map((f) => path.relative(x.out, f));
  assert.ok(promptFiles.length > 0);
  for (const f of promptFiles) assert.ok(!f.includes('3c-a') && !f.includes(RUN_GONE), f);
  assert.ok(!fs.existsSync(path.join(x.out, 'scratch', 'haiku', RUN_GONE)));
});

test('AC4.1/AC4.2: no archived row text or tiebreak line reaches a prompt, repo or copy', async () => {
  const x = await oneArm();
  ok(x);
  const files = [...filesUnder(path.join(x.out, 'prompts')), ...filesUnder(path.join(x.out, 'repos'))];
  assert.ok(files.length > 0);
  for (const f of files) {
    const text = read(f);
    for (const needle of ['archived-row-alpha', 'archived-row-beta', 'confirmed by tiebreak']) assert.ok(!text.includes(needle), `${f} holds ${needle}`);
  }
  const copies = fs.readdirSync(path.join(x.out, 'repos')).flatMap((d) => fs.readdirSync(path.join(x.out, 'repos', d))
    .filter((n) => n.includes('--')).map((n) => path.join(x.out, 'repos', d, n)));
  assert.ok(copies.some((c) => c.endsWith('3a-a--context.md')), copies.join('\n'));
  assert.ok(copies.some((c) => c.endsWith('3a-a--9-spec.md')), copies.join('\n'));
  for (const c of copies) {
    const text = read(c);
    assert.equal(count(text, fx.mainRoot), 0, c);
    assert.equal(count(text, `.claude-tweaks/pipelines/${RUN}`), 0, c);
  }
  const context = read(copies.find((c) => c.endsWith('3a-a--context.md')));
  assert.ok(context.includes('+see .claude-tweaks/pipelines/2025-01-01T000000-spec-1/decisions.md\n'), context);
  assert.ok(context.includes(`Spec: ${toPosix(copies.find((c) => c.endsWith('3a-a--9-spec.md')))}\n`), 'the bundle names the slot copy of the spec');
  for (const label of ['Verdicts', 'Worktree verdicts', 'Earlier run']) assert.ok(context.includes(`${label}: ${REMOVED}\n`), `${label}:\n${context}`);
  const { excluded } = x.json(schema.REVIEWS_FIXTURE_FILE);
  assert.deepEqual(excluded.filter((e) => e.reason === 'unrewritten-path'), []);
});

test('AC4: with --out under the main checkout, no copy keeps the archived run\'s own directory', async () => {
  const out = path.join(fx.mainRoot, 'replay-out');
  const deps = makeDeps();
  const code = await run({ argv: ['extract-reviews', '--runs', fx.runsRoot, '--out', out, '--role', 'lens', '--transcripts', fx.transcripts, '--arm', 'name=haiku,profile=fast'], deps });
  try {
    assert.equal(code, 0, deps.errs.join('\n'));
    const fixture = JSON.parse(read(path.join(out, schema.REVIEWS_FIXTURE_FILE)));
    assert.deepEqual(fixture.excluded.filter((e) => e.reason === 'unrewritten-path'), []);
    assert.equal(fixture.slots.length, 4);
    const repoDir = path.join(out, 'repos', `${RUN}--r1`);
    const copies = fs.readdirSync(repoDir).filter((n) => n.includes('--')).map((n) => path.join(repoDir, n));
    const prompts = JSON.parse(read(path.join(out, schema.REVIEWS_MANIFEST_FILE))).arms.flatMap((a) => a.prompts.map((p) => p.file));
    for (const f of [...copies, ...prompts]) {
      const text = read(f);
      assert.equal(count(text, `.claude-tweaks/pipelines/${RUN}`), 0, f);
      assert.equal(count(text, toPosix(fx.mainRoot)), count(text, `${toPosix(out)}/`), `${f}: the main checkout is named only as the output directory`);
      assert.deepEqual(unrewrittenPaths(text, { mainRoot: fx.mainRoot, runName: RUN, outDir: out }), [], f);
    }
    const context = read(path.join(repoDir, '3a-a--context.md'));
    for (const label of ['Verdicts', 'Worktree verdicts', 'Earlier run']) assert.ok(context.includes(`${label}: ${REMOVED}\n`), `${label}:\n${context}`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('--lens takes a lens name as the slots name it', async () => {
  const x = await extractReviews({ extra: ['--lens', 'security', '--max-per-lens', '1'] });
  ok(x);
  const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
  assert.deepEqual(fixture.slots.map((s) => s.name), [`${RUN}/3b-a`]);
  assert.deepEqual(fixture.requested.lens, ['3b']);
});

test('a written text that fails the leak check after its shas are mapped is a runtime failure', async () => {
  // A replay head whose text, spliced after the bundle's own prefix, spells the main checkout out: check 8 (run on the
  // archived shas) cannot see it, so only the write-time check stands between it and a written copy.
  const sRoot = scratchDir('rr-reviews-splice-');
  const sx = buildReviewsFixture(sRoot);
  const bundle = path.join(sx.runsRoot, RUN, 'review-ctx', 'context.md');
  fs.appendFileSync(bundle, `Spliced: ${path.dirname(sx.mainRoot)}/${sx.H}\n`);
  const tail = path.basename(sx.mainRoot);
  const real = makeWriteRepo(sx.mainRoot);
  const out = path.join(sRoot, 'out');
  const deps = {
    ...makeDeps(),
    git: (args) => execFileSync('git', args, { cwd: sx.mainRoot, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
    writeRepo: (...args) => ({ ...real(...args), head: tail }),
  };
  const code = await run({ argv: ['extract-reviews', '--runs', sx.runsRoot, '--out', out, '--role', 'lens', '--transcripts', sx.transcripts, '--arm', 'name=haiku,profile=fast'], deps });
  assert.equal(code, 1);
  assert.match(deps.errs.join('\n'), /still names .* after its shas were mapped/);
  assert.match(deps.errs.join('\n'), /is now partial; remove it before re-running extract-reviews/);
  assert.ok(!fs.existsSync(path.join(out, schema.REVIEWS_MANIFEST_FILE)));
});

test('archived rows are stored repo-relative', async () => {
  const x = await oneArm();
  ok(x);
  const reports = x.json(schema.REPORTS_FILE);
  assert.equal(reports.schemaVersion, schema.SCHEMA_VERSION);
  const b = reports.reports[`${RUN}/3b-a`];
  assert.deepEqual(b.rows, [{ sev: 'medium', path: 'src/b.js', line: 4 }]);
  assert.deepEqual([b.lens, b.side, b.run, b.unitKey], ['3b', 'a', RUN, RUN]);
  assert.deepEqual(reports.reports[`${RUN}/3a-a`].counts, { critical: 0, high: 1, medium: 0, low: 0, info: 0, overflow: 0 });
  assert.deepEqual(reports.reports[`${RUN}/3a-b`].rows, []);
  assert.ok(reports.runRows[RUN].some((r) => r.lens === '3c' && r.path === 'src/b.js' && r.line === 7), JSON.stringify(reports.runRows));
  assert.ok(reports.runRows[RUN].some((r) => r.lens === '3b' && r.path === 'src/b.js' && r.line === 4));
  assert.deepEqual(reports.confirmed[RUN], {
    '3a': { findings: [{ path: 'src/a.js', line: 10, how: 'pair' }], unlocated: 0 },
    '3b': { findings: [{ path: 'src/b.js', line: 4, how: 'tiebreak' }], unlocated: 0 },
  });
});

test('l3b-b is excluded as report-unparsed', async () => {
  const x = await oneArm();
  ok(x);
  const { excluded, slots } = x.json(schema.REVIEWS_FIXTURE_FILE);
  assert.deepEqual(excluded.find((e) => e.agentId === 'l3b-b'), { run: RUN, agentId: 'l3b-b', lens: '3b', side: 'b', reason: 'report-unparsed' });
  assert.ok(!slots.some((s) => s.agentId === 'l3b-b'));
});

test('AC9.1: one --arm writes the user arm and control', async () => {
  const x = await oneArm();
  ok(x);
  const manifest = x.json(schema.REVIEWS_MANIFEST_FILE);
  assert.deepEqual(manifest.arms.map((a) => a.name), ['haiku', 'control']);
  const [haiku, control] = manifest.arms;
  assert.deepEqual([haiku.profile, haiku.model, haiku.effort, haiku.repeat], ['fast', 'haiku', null, 1]);
  assert.deepEqual([control.profile, control.model, control.effort, control.repeat], ['standard', 'sonnet', 'medium', 1]);
  assert.deepEqual(control.prompts.map((p) => p.name), haiku.prompts.map((p) => p.name));
  assert.equal(manifest.kind, schema.REVIEWS_KIND);
  assert.deepEqual(schema.validateReviewsManifest(manifest), []);
  const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
  assert.deepEqual(fixture.slots.map((s) => [s.name, s.archivedTier, s.archivedEffort, s.controlArm, s.unit, s.repoKey]), [
    [`${RUN}/3a-a`, 'standard', 'medium', 'control', RUN, `${RUN}--r1`],
    [`${RUN}/3a-b`, 'standard', 'medium', 'control', RUN, `${RUN}--r1`],
    [`${RUN}/3b-a`, 'standard', 'medium', 'control', RUN, `${RUN}--r1`],
    [`${RUN}/3a-a.2`, 'standard', 'medium', 'control', RUN, `${RUN}--r1`],
  ]);
  assert.deepEqual(fixture.totals, { reviews: 4, byLens: { '3a': 3, '3b': 1 } });
  assert.equal(haiku.prompts[0].file, path.join(x.out, 'prompts', 'haiku', RUN, '3a-a.md'));
  assert.deepEqual(Object.keys(haiku.prompts[0]), schema.REVIEWS_PROMPT_KEYS);
});

test('a repeated lens/side dispatch gets its own slot', async () => {
  const x = await oneArm();
  ok(x);
  const names = x.json(schema.REVIEWS_MANIFEST_FILE).arms[0].prompts.map((p) => p.name);
  assert.ok(names.includes(`${RUN}/3a-a`) && names.includes(`${RUN}/3a-a.2`), names.join(', '));
  const slots = x.json(schema.REVIEWS_FIXTURE_FILE).slots;
  assert.deepEqual(slots.filter((s) => s.lens === '3a' && s.side === 'a').map((s) => s.agentId), ['l3a-a', 'l3a-a2']);
  assert.deepEqual(slots.map((s) => [s.name, s.ordinal]), [[`${RUN}/3a-a`, 1], [`${RUN}/3a-b`, 1], [`${RUN}/3b-a`, 1], [`${RUN}/3a-a.2`, 2]]);
});

test('a slot ordinal counts within its unit: a member\'s first review of a lens side is ordinal 1', async () => {
  const tRoot = scratchDir('rr-reviews-twin-');
  const tx = buildReviewsFixture(tRoot, { edges: true, twin: true });
  const out = path.join(tRoot, 'out');
  const deps = { ...makeDeps(), git: (args) => execFileSync('git', args, { cwd: tx.mainRoot, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }), writeRepo: makeWriteRepo(tx.mainRoot) };
  const code = await run({ argv: ['extract-reviews', '--runs', tx.runsRoot, '--out', out, '--role', 'lens', '--transcripts', tx.transcripts, '--arm', 'name=haiku,profile=fast', '--lens', '3g'], deps });
  assert.equal(code, 0, deps.errs.join('\n'));
  const { slots } = JSON.parse(read(path.join(out, schema.REVIEWS_FIXTURE_FILE)));
  assert.deepEqual(slots.map((s) => [s.name, s.unit, s.ordinal]), [[`${RUN}/3g-a`, `${RUN}/spec-2`, 1], [`${RUN}/3g-a.2`, `${RUN}/spec-10`, 1]]);
});

test('--select in any order still reads runs newest first', async () => {
  const y = await oneArm();
  for (const select of [`${RUN},${RUN_GONE}`, `${RUN_GONE},${RUN}`]) {
    const x = await extractReviews({ extra: ['--select', select] });
    ok(x);
    const { excluded } = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.equal(excluded[0].run, RUN_GONE, select);
    assert.deepEqual(excluded, y.json(schema.REVIEWS_FIXTURE_FILE).excluded, select);
  }
});

test('with --runs moved away from the archived checkout, every slot is excluded as unrewritten-path', async () => {
  // A copy of the runs root under another main checkout: mainRoot is derived from --runs, so it no longer matches the
  // archived prompts' paths and nothing in them is rewritten. The barrier must still see the original worktree.
  const moved = path.join(root, 'moved', 'repo', '.claude-tweaks', 'pipelines');
  fs.cpSync(fx.runsRoot, moved, { recursive: true });
  const out = path.join(root, 'out-moved');
  const deps = makeDeps();
  const code = await run({ argv: ['extract-reviews', '--runs', moved, '--out', out, '--role', 'lens', '--transcripts', fx.transcripts, '--arm', 'name=haiku,profile=fast'], deps });
  assert.equal(code, 3, deps.errs.join('\n'));
  const { excluded } = JSON.parse(deps.errs.join('\n'));
  assert.deepEqual(Object.fromEntries(excluded.map((e) => [e.agentId, e.reason])), {
    'l3a-a': 'unrewritten-path', 'l3a-b': 'unrewritten-path', 'l3b-a': 'unrewritten-path', 'l3a-a2': 'unrewritten-path',
    'l3b-b': 'report-unparsed', 'l3c-a': 'unknown-run-input', 'l3d-a': 'run-input-gone',
  });
  assert.ok(!fs.existsSync(out), 'no prompt is written');
});

test('AC7.1: the workflow launches one agent per arm × repeat × prompt', async () => {
  const x = await extractReviews({ arms: ['--arm', 'name=haiku,profile=fast,repeat=2', '--arm', 'name=sonnet,profile=standard,effort=low'] });
  ok(x);
  const manifest = x.json(schema.REVIEWS_MANIFEST_FILE);
  const { calls } = await runWorkflow(manifest);
  assert.equal(calls.length, manifest.arms.reduce((n, a) => n + a.prompts.length * a.repeat, 0));
  assert.ok(calls.length > 0);
  const byName = new Map(manifest.arms.map((a) => [a.name, a]));
  for (const c of calls) {
    const arm = byName.get(c.opts.label.split('|')[0]);
    assert.equal(c.opts.model, arm.model);
    assert.equal(c.opts.effort === undefined ? null : c.opts.effort, arm.effort);
  }
  assert.deepEqual(manifest.arms.map((a) => [a.name, a.effort, a.repeat]), [['haiku', null, 2], ['sonnet', 'low', 1], ['control', 'medium', 1]]);
});

test('the effort line is gone and the scratch is a new empty directory', async () => {
  const x = await oneArm();
  ok(x);
  const prompts = x.json(schema.REVIEWS_MANIFEST_FILE).arms.flatMap((a) => a.prompts);
  for (const p of prompts) assert.ok(!read(p.file).includes('[Effort:'), p.file);
  const haiku = x.json(schema.REVIEWS_MANIFEST_FILE).arms[0].prompts[0];
  const scratch = /SCRATCH: (\S+)/.exec(read(haiku.file))[1];
  assert.equal(scratch, toPosix(path.join(x.out, 'scratch', 'haiku', RUN, '3a-a', '3a-a')));
  assert.ok(fs.statSync(scratch).isDirectory());
  assert.deepEqual(fs.readdirSync(scratch), []);
});

test('--arm name=control,profile=fast exits 2', async () => {
  const x = await extractReviews({ arms: ['--arm', 'name=control,profile=fast'] });
  assert.equal(x.code, 2);
  assert.ok(!fs.existsSync(x.out));
  const y = await extractReviews({ arms: ['--arm', 'name=control.standard.medium,profile=fast'] });
  assert.equal(y.code, 2);
});

test('--arm name=x,chunk=2,profile=fast exits 2', async () => {
  const x = await extractReviews({ arms: ['--arm', 'name=x,chunk=2,profile=fast'] });
  assert.equal(x.code, 2);
  assert.match(x.deps.errs.join('\n'), /--arm: chunk does not apply to extract-reviews/);
});

test('--min-reviews 99 exits 3 and writes no manifest', async () => {
  const x = await extractReviews({ extra: ['--min-reviews', '99'] });
  assert.equal(x.code, 3);
  assert.ok(!fs.existsSync(path.join(x.out, schema.REVIEWS_MANIFEST_FILE)));
  assert.ok(!fs.existsSync(x.out));
  const report = JSON.parse(x.deps.errs.join('\n'));
  assert.deepEqual(report.shortfall, { requested: { minReviews: 99 }, available: { reviews: 4, byLens: { '3a': 3, '3b': 1 } } });
  assert.ok(report.excluded.some((e) => e.agentId === 'l3b-b'));
});

test('--lens and --max-per-lens select slots in run order without adding exclusions', async () => {
  const x = await extractReviews({ extra: ['--lens', '3a', '--max-per-lens', '1'] });
  ok(x);
  const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
  assert.deepEqual(fixture.slots.map((s) => s.name), [`${RUN}/3a-a`]);
  assert.deepEqual(Object.keys(x.json(schema.REPORTS_FILE).reports), [`${RUN}/3a-a`]);
  assert.deepEqual(Object.keys(x.json(schema.REPORTS_FILE).confirmed[RUN]), ['3a']);
  assert.ok(x.json(schema.REPORTS_FILE).runRows[RUN].some((r) => r.lens === '3b'), 'runRows keep every parsed dispatch');
  assert.deepEqual(fixture.excluded.map((e) => e.agentId).sort(), ['l3b-b', 'l3c-a', 'l3d-a']);
  assert.deepEqual(fixture.requested, { lens: ['3a'], maxPerLens: 1 });
});

test('the other exclusion reasons, a control arm per archived tier and effort, origin refs and a member unit', async () => {
  const eRoot = scratchDir('rr-reviews-edges-');
  const ex = buildReviewsFixture(eRoot, { edges: true });
  const out = path.join(eRoot, 'out');
  const deps = { ...makeDeps(), git: (args) => execFileSync('git', args, { cwd: ex.mainRoot, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }), writeRepo: makeWriteRepo(ex.mainRoot) };
  const code = await run({ argv: ['extract-reviews', '--runs', ex.runsRoot, '--out', out, '--role', 'lens', '--transcripts', ex.transcripts, '--arm', 'name=haiku,profile=fast'], deps });
  assert.equal(code, 0, deps.errs.join('\n'));
  const json = (name) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
  const fixture = json(schema.REVIEWS_FIXTURE_FILE);
  const reasons = Object.fromEntries(fixture.excluded.map((e) => [e.agentId, e.reason]));
  assert.deepEqual(reasons, {
    'l3b-b': 'report-unparsed', 'e-tier': 'no-archived-tier', 'e-notx': 'no-transcript', 'e-nosha': 'no-sha-range',
    'e-gone': 'commit-not-in-clone', 'e-leak': 'unrewritten-path', 'e-noside': 'unlabelled-dispatch',
  });
  const manifest = json(schema.REVIEWS_MANIFEST_FILE);
  assert.deepEqual(manifest.arms.map((a) => [a.name, a.profile, a.model, a.effort, a.prompts.map((p) => p.name)]), [
    ['haiku', 'fast', 'haiku', null, ['3a-a', '3a-b', '3b-a', '3f-a', '3h-a', '3g-a', '3i-a'].map((n) => `${RUN}/${n}`)],
    ['control.standard.medium', 'standard', 'sonnet', 'medium', ['3a-a', '3a-b', '3b-a', '3g-a', '3i-a'].map((n) => `${RUN}/${n}`)],
    ['control.fast.low', 'fast', 'haiku', 'low', [`${RUN}/3f-a`]],
    ['control.standard.high', 'standard', 'sonnet', 'high', [`${RUN}/3h-a`]],
  ]);
  assert.deepEqual(schema.validateReviewsManifest(manifest), []);
  const repo = fixture.repos[0];
  assert.equal(fixture.repos.length, 1);
  assert.equal(gitIn(repo.path)('rev-parse', 'refs/remotes/origin/main'), repo.replayBase, 'the origin/main a prompt names resolves to the replay base');
  const m2 = fixture.slots.find((s) => s.agentId === 'e-m2');
  assert.equal(m2.unit, `${RUN}/spec-2`);
  const reports = json(schema.REPORTS_FILE);
  assert.equal(reports.reports[`${RUN}/3g-a`].unitKey, `${RUN}/spec-2`);
  assert.deepEqual(reports.confirmed[`${RUN}/spec-2`], { '3g': { findings: [{ path: 'src/b.js', line: 2, how: 'pair' }], unlocated: 0 } });
  assert.deepEqual(reports.confirmed[`${RUN}/spec-10`], { '3i': { findings: [], unlocated: 0, confirmedSource: 'missing' } }, 'a member with no decisions.md says so');
  const m2Prompt = read(manifest.arms[0].prompts.find((p) => p.name === `${RUN}/3g-a`).file);
  assert.ok(m2Prompt.includes(toPosix(path.join(out, 'repos', `${RUN}--r1`, '3g-a--context.md'))), m2Prompt);
  assert.equal(read(path.join(out, 'repos', `${RUN}--r1`, '3g-a--context.md')), `Member bundle at ${repo.replayHead}\n`);
  for (const p of manifest.arms.flatMap((a) => a.prompts)) assert.ok(!read(p.file).includes(ex.mainRoot), p.file);
});

test('an unknown --role exits 2', async () => {
  const deps = makeDeps();
  const code = await run({ argv: ['extract-reviews', '--runs', fx.runsRoot, '--out', path.join(root, 'out-role'), '--role', 'judge', '--transcripts', fx.transcripts, '--arm', 'name=haiku,profile=fast'], deps });
  assert.equal(code, 2);
  assert.match(deps.errs.join('\n'), /--role/);
});

test('USAGE names both new commands', async () => {
  const deps = makeDeps();
  const code = await run({ argv: [], deps });
  assert.equal(code, 2);
  const err = deps.errs.join('\n');
  assert.ok(err.includes('extract-reviews --runs <root> --out <dir> --role lens'), err);
  assert.ok(err.includes('score-reviews --out <dir> --transcripts <workflow dir>'), err);
});
