'use strict';
const { test, before, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { run, makeWriteRepo } = require('../../tools/review-replay');
const schema = require('../../tools/review-replay/schema');
const { toPosix } = schema;
const { scratchDir } = require('../helpers/tmp-dir');
const { runWorkflow } = require('./helpers');
const { buildReviewsFixture, buildBranchFixture, RUN, RUN_GONE, RUN_BRANCH, cleanEnv } = require('./reviews-fixture');
const { unrewrittenPaths } = require('../../tools/review-replay/reviews-rewrite');
const { existsOnDisk } = require('../../tools/review-replay/reviews-extract');

const REMOVED = '[run-directory path removed]';

const PLUGIN_ROOT = path.join(__dirname, '..', '..', 'plugin');
const gitIn = (cwd) => (...args) => execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8', windowsHide: true }).trim();

let fx;
let root;
before(() => {
  root = scratchDir('rr-reviews-');
  fx = buildReviewsFixture(root, { decisions: true, gone: true, repeat: true });
});

// The deps for a run whose archived checkout is `mainRoot` (the shared fixture's, unless a test built its own).
function makeDeps(mainRoot = fx.mainRoot) {
  const logs = [];
  const errs = [];
  const git = (args) => execFileSync('git', args, { cwd: mainRoot, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return { fs, git, writeRepo: makeWriteRepo(mainRoot), pluginRoot: PLUGIN_ROOT, log: (s) => logs.push(s), err: (s) => errs.push(s), logs, errs };
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
    ...makeDeps(sx.mainRoot),
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
  const deps = makeDeps(tx.mainRoot);
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

test('a dead fixture-style checkout path in diff text does not exclude a slot', async () => {
  const dRoot = scratchDir('rr-reviews-dead-');
  const dx = buildReviewsFixture(dRoot);
  const line = "+  root: '/p/.claude-tweaks/pipelines/r1'";
  fs.appendFileSync(path.join(dx.runsRoot, RUN, 'review-ctx', 'context.md'), `${line}\n`);
  const out = path.join(dRoot, 'out');
  const deps = makeDeps(dx.mainRoot);
  const code = await run({ argv: ['extract-reviews', '--runs', dx.runsRoot, '--out', out, '--role', 'lens', '--transcripts', dx.transcripts, '--arm', 'name=haiku,profile=fast'], deps });
  assert.equal(code, 0, deps.errs.join('\n'));
  const fixture = JSON.parse(read(path.join(out, schema.REVIEWS_FIXTURE_FILE)));
  assert.deepEqual(fixture.excluded.filter((e) => e.reason === 'unrewritten-path'), []);
  assert.deepEqual(fixture.slots.map((s) => s.agentId), ['l3a-a', 'l3a-b', 'l3b-a']);
  assert.ok(read(path.join(out, 'repos', `${RUN}--r1`, '3a-a--context.md')).includes(`${line}\n`), 'the diff line is kept as text');
});

test('a slot ordinal counts every labelled dispatch, excluded ones included', async () => {
  const lRoot = scratchDir('rr-reviews-lead-');
  const lx = buildReviewsFixture(lRoot, { lead: true });
  const out = path.join(lRoot, 'out');
  const deps = makeDeps(lx.mainRoot);
  const code = await run({ argv: ['extract-reviews', '--runs', lx.runsRoot, '--out', out, '--role', 'lens', '--transcripts', lx.transcripts, '--arm', 'name=haiku,profile=fast'], deps });
  assert.equal(code, 0, deps.errs.join('\n'));
  const fixture = JSON.parse(read(path.join(out, schema.REVIEWS_FIXTURE_FILE)));
  const reasons = Object.fromEntries(fixture.excluded.map((e) => [e.agentId, e.reason]));
  assert.equal(reasons['l3a-a0'], 'report-unparsed');
  assert.equal(reasons['l3b-a0'], 'no-transcript');
  // Each first dispatch was excluded, so the slot after it is that lens side's second review: a re-review.
  assert.deepEqual(fixture.slots.map((s) => [s.name, s.ordinal]), [[`${RUN}/3a-a`, 2], [`${RUN}/3a-b`, 1], [`${RUN}/3b-a`, 2]]);
});

test('an excluded dispatch counts in the unit its prompt names, else the member that listed it', async () => {
  const mRoot = scratchDir('rr-reviews-mlead-');
  const mx = buildReviewsFixture(mRoot, { edges: true, memberLead: true });
  const out = path.join(mRoot, 'out');
  const deps = makeDeps(mx.mainRoot);
  const code = await run({ argv: ['extract-reviews', '--runs', mx.runsRoot, '--out', out, '--role', 'lens', '--transcripts', mx.transcripts, '--arm', 'name=haiku,profile=fast', '--lens', '3g,3i'], deps });
  assert.equal(code, 0, deps.errs.join('\n'));
  const fixture = JSON.parse(read(path.join(out, schema.REVIEWS_FIXTURE_FILE)));
  const reasons = Object.fromEntries(fixture.excluded.map((e) => [e.agentId, e.reason]));
  assert.deepEqual([reasons['e-m2-0'], reasons['e-m10-0']], ['report-unparsed', 'no-transcript']);
  assert.deepEqual(fixture.slots.map((s) => [s.agentId, s.unit, s.ordinal]), [['e-m2', `${RUN}/spec-2`, 2], ['e-m10', `${RUN}/spec-10`, 2]]);
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
  const deps = makeDeps(ex.mainRoot);
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

// Extracts from a fresh plain fixture whose root timing.json `tweak` changes; returns the fixture's excluded list
// (a run left with no slot exits 3 and reports it on stderr).
async function excludedAfter(prefix, tweak) {
  const tRoot = scratchDir(prefix);
  const tx = buildReviewsFixture(tRoot);
  tweak(path.join(tx.runsRoot, RUN, 'timing.json'));
  const out = path.join(tRoot, 'out');
  const deps = makeDeps(tx.mainRoot);
  const code = await run({ argv: ['extract-reviews', '--runs', tx.runsRoot, '--out', out, '--role', 'lens', '--transcripts', tx.transcripts, '--arm', 'name=haiku,profile=fast'], deps });
  return code === 0 ? JSON.parse(read(path.join(out, schema.REVIEWS_FIXTURE_FILE))).excluded : JSON.parse(deps.errs.join('\n')).excluded;
}

test('a run whose root timing.json cannot be parsed is excluded as timing-unreadable, not dropped', async () => {
  const excluded = await excludedAfter('rr-reviews-badtiming-', (f) => fs.writeFileSync(f, '{ not json'));
  assert.deepEqual(excluded, [{ run: RUN, reason: 'timing-unreadable' }]);
});

test('a run with no root timing.json is excluded as no-timing, not dropped', async () => {
  const excluded = await excludedAfter('rr-reviews-notiming-', (f) => fs.rmSync(f));
  assert.deepEqual(excluded, [{ run: RUN, reason: 'no-timing' }]);
});

test('a dispatch item that is not an object is excluded as timing-unreadable with its index', async () => {
  const excluded = await excludedAfter('rr-reviews-baditem-', (f) => {
    const timing = JSON.parse(read(f));
    timing.dispatches.items.splice(1, 0, 'not an object');
    fs.writeFileSync(f, JSON.stringify(timing));
  });
  assert.deepEqual(excluded.filter((e) => e.reason === 'timing-unreadable'), [{ run: RUN, index: 1, reason: 'timing-unreadable' }]);
});

test('the leak barrier treats a path it cannot stat as present and only ENOENT or ENOTDIR as absent', () => {
  const failing = (code) => existsOnDisk({ statSync: () => { throw Object.assign(new Error('x'), { code }); } });
  assert.equal(failing('EACCES')('/p/.claude/worktrees'), true);
  assert.equal(failing('EIO')('/p/.claude/worktrees'), true);
  assert.equal(failing('ENOENT')('/p/.claude/worktrees'), false);
  assert.equal(failing('ENOTDIR')('/p/.claude/worktrees'), false);
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

describe('branch roles', () => {
  const RUNB = RUN_BRANCH;
  // Extracts `role` from a fresh branch fixture built with `opts`, changed by `tweak(bx)` first when given.
  async function extractBranch(role, opts = {}, extra = [], tweak = null) {
    const bRoot = scratchDir('rr-branch-');
    const bx = buildBranchFixture(bRoot, opts);
    if (tweak) tweak(bx);
    const out = path.join(bRoot, 'out');
    const deps = makeDeps(bx.mainRoot);
    const code = await run({ argv: ['extract-reviews', '--runs', bx.runsRoot, '--out', out, '--role', role, '--transcripts', bx.transcripts, '--arm', 'name=a,profile=fast', ...extra], deps });
    const json = (name) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
    return { code, deps, out, json, bx };
  }
  const plainTask = memo(() => extractBranch('task'));
  const promptOf = (x, name, arm = 'a') => read(x.json(schema.REVIEWS_MANIFEST_FILE).arms.find((a) => a.name === arm).prompts.find((p) => p.name === name).file);

  test('--role task: one slot per task review, verdict and located items archived', async () => {
    const x = await plainTask();
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.equal(fixture.role, 'task');
    assert.deepEqual(fixture.slots.map((s) => [s.name.split('/').pop(), s.verdict, s.archivedTier]), [['task', 'approved', 'standard'], ['task.2', 'needs-fixes', 'capable']]);
    assert.deepEqual(fixture.slots.map((s) => [s.role, s.agentId, s.taskTier, s.at, s.baseFrom, s.taskAgentId]), [['task', 't1', null, null, null, null], ['task', 't2', null, null, null, null]]);
    assert.deepEqual(fixture.totals, { reviews: 2, byArchivedTier: { standard: 1, capable: 1 } });
    const reports = x.json(schema.REPORTS_FILE);
    assert.deepEqual(Object.keys(reports), ['schemaVersion', 'reports'], 'no confirmed or runRows for a branch role');
    const r = reports.reports[`${RUNB}/task.2`];
    assert.deepEqual(r.items.map((i) => [i.sev, i.path, i.line]), [['important', 'src/x.js', 10], ['minor', null, null]]);
    assert.equal(r.unlocated, 1);
    assert.deepEqual([r.role, r.run, r.verdict, r.itemsUnparsed, r.taskTier, r.at], ['task', RUNB, 'needs-fixes', false, null, null]);
    assert.ok(!JSON.stringify(reports).includes(x.bx.mainRoot), 'no archived path is stored');
    assert.deepEqual(reports.reports[`${RUNB}/task`].items, []);
    const slot = fixture.slots.find((s) => s.agentId === 't2');
    const repo = fixture.repos.find((p) => p.key === slot.repoKey);
    assert.deepEqual([repo.archivedBase, repo.archivedHead], [x.bx.T1, x.bx.T2]);
    const text = promptOf(x, `${RUNB}/task.2`);
    for (const needle of [x.bx.T1, x.bx.T2, x.bx.T1.slice(0, 7), '[Effort:', x.bx.mainRoot]) assert.ok(!text.includes(needle), `the prompt names ${needle}`);
    assert.ok(text.includes(`Base ${repo.replayBase}, Head ${repo.replayHead}.`), text);
    const manifest = x.json(schema.REVIEWS_MANIFEST_FILE);
    assert.deepEqual(schema.validateReviewsManifest(manifest), []);
    assert.deepEqual(manifest.arms.map((a) => a.name), ['a', 'control.standard.medium', 'control.capable.high']);
  });

  test('--role task: re-review dispatches are never slots', async () => {
    const x = await plainTask();
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.ok(![...fixture.slots, ...fixture.excluded].some((s) => s.agentId === 'rr2'));
    assert.ok(![...fixture.slots, ...fixture.excluded].some((s) => s.agentId === 'wb'), 'nor whole-branch dispatches');
  });

  test('AC6.1: a pointer prompt whose file is gone is excluded as prompt-file-gone and writes no prompt', async () => {
    const x = await extractBranch('task', { pointer: 'gone' });
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(fixture.excluded, [{ run: RUNB, agentId: 'tp', tier: 'standard', reason: 'prompt-file-gone' }]);
    assert.deepEqual(fixture.slots.map((s) => s.agentId), ['t1', 't2']);
    // Each slot is written once per user arm (one here) and once for its own control arm.
    const files = filesUnder(path.join(x.out, 'prompts'));
    assert.equal(files.length, fixture.slots.length * 2);
    const prompts = x.json(schema.REVIEWS_MANIFEST_FILE).arms.flatMap((a) => a.prompts);
    assert.equal(prompts.length, files.length);
    const slotOf = new Map(fixture.slots.map((s) => [s.name, s.agentId]));
    assert.ok(prompts.every((p) => slotOf.has(p.name) && slotOf.get(p.name) !== 'tp'), JSON.stringify(prompts.map((p) => p.name)));
    for (const f of files) assert.ok(!read(f).includes('task-2-review-prompt'), f);
  });

  test('an archived run reads a run input its archive directory lacks from the top-level run directory', async () => {
    const aRoot = scratchDir('rr-branch-archive-');
    const ax = buildBranchFixture(aRoot);
    const top = path.join(ax.runsRoot, RUNB);
    const archived = path.join(ax.runsRoot, 'archive', RUNB);
    fs.mkdirSync(path.dirname(archived), { recursive: true });
    fs.renameSync(top, archived);
    // As an archived run is kept: timing.json under archive/{run}, work/ left at the top-level {run}.
    fs.mkdirSync(top);
    fs.renameSync(path.join(archived, 'work'), path.join(top, 'work'));
    const extractAt = async (name) => {
      const out = path.join(aRoot, name);
      const deps = makeDeps(ax.mainRoot);
      const code = await run({ argv: ['extract-reviews', '--runs', ax.runsRoot, '--out', out, '--role', 'whole-branch', '--transcripts', ax.transcripts, '--arm', 'name=a,profile=fast', '--select', RUNB], deps });
      return { code, deps, out };
    };
    const x = await extractAt('out');
    assert.equal(x.code, 0, x.deps.errs.join('\n'));
    const fixture = JSON.parse(read(path.join(x.out, schema.REVIEWS_FIXTURE_FILE)));
    assert.deepEqual(fixture.slots.map((s) => s.agentId), ['wb']);
    const copy = path.join(x.out, 'repos', `${RUNB}--r1`, 'whole-branch--7-spec.md');
    assert.equal(read(copy), read(path.join(top, 'work', '7-spec.md')));
    // Absent from both directories, the input is gone.
    fs.rmSync(path.join(top, 'work'), { recursive: true });
    const y = await extractAt('out-gone');
    assert.equal(y.code, 3);
    assert.deepEqual(JSON.parse(y.deps.errs.join('\n')).excluded, [{ run: RUNB, agentId: 'wb', tier: 'capable', reason: 'run-input-gone' }]);
  });

  test('--role task: a pointer prompt whose file exists replays that file', async () => {
    const x = await extractBranch('task', { pointer: 'present' });
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(fixture.slots.map((s) => [s.name, s.agentId]), [[`${RUNB}/task`, 't1'], [`${RUNB}/task.2`, 't2'], [`${RUNB}/task.3`, 'tp']]);
    const text = promptOf(x, `${RUNB}/task.3`);
    assert.ok(!text.includes('it is your prompt'), text);
    assert.equal(text, promptOf(x, `${RUNB}/task.2`), 'the pointer file\'s text, rewritten as t2\'s own prompt is');
  });

  test('--role task: a pointer whose file carries its own sha pair replays the file, whatever range the pointer names', async () => {
    const x = await extractBranch('task', { pointer: 'present', pointerShas: true });
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    const tp = fixture.slots.find((s) => s.agentId === 'tp');
    const repo = fixture.repos.find((p) => p.key === tp.repoKey);
    assert.deepEqual([repo.archivedBase, repo.archivedHead], [x.bx.T1, x.bx.T2], 'the range is the file\'s');
    assert.equal(promptOf(x, tp.name), promptOf(x, `${RUNB}/task.2`));
  });

  test('--role task: a prompt citing a file with no sha pair while naming its own range replays the original prompt', async () => {
    const x = await extractBranch('task', { hybrid: true });
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(fixture.slots.map((s) => [s.name, s.agentId]), [[`${RUNB}/task`, 't1'], [`${RUNB}/task.2`, 't2'], [`${RUNB}/task.3`, 'th']]);
    const repo = fixture.repos.find((p) => p.key === fixture.slots[2].repoKey);
    assert.deepEqual([repo.archivedBase, repo.archivedHead], [x.bx.T1, x.bx.T2]);
    const text = promptOf(x, `${RUNB}/task.3`);
    assert.ok(text.startsWith('Follow the reviewer instructions in this file exactly:\n'), text);
    assert.ok(text.includes(`Base ${repo.replayBase}, Head ${repo.replayHead}.`), text);
    assert.ok(!text.includes('TEMPLATE-TEXT'), 'not the cited file\'s text');
  });

  test('--role whole-branch: one slot, items archived, prompt rewritten', async () => {
    const x = await extractBranch('whole-branch');
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(fixture.slots.map((s) => [s.name, s.agentId, s.role, s.verdict, s.archivedTier, s.archivedEffort]), [[`${RUNB}/whole-branch`, 'wb', 'whole-branch', null, 'capable', 'high']]);
    assert.deepEqual(fixture.excluded, []);
    const r = x.json(schema.REPORTS_FILE).reports[`${RUNB}/whole-branch`];
    assert.deepEqual(r.items.map((i) => [i.sev, i.path, i.line]), [['minor', 'src/y.js', 2]]);
    assert.equal(r.unlocated, 0);
    const repo = fixture.repos[0];
    assert.deepEqual([fixture.repos.length, repo.archivedBase, repo.archivedHead], [1, x.bx.B, x.bx.F]);
    const text = promptOf(x, `${RUNB}/whole-branch`);
    assert.ok(text.includes(`Base ${repo.replayBase} (the review base). Head ${repo.replayHead}.`), text);
    assert.ok(text.includes('## What Was Implemented'), text);
    for (const needle of [x.bx.B, x.bx.F, '[Effort:', x.bx.mainRoot]) assert.ok(!text.includes(needle), `the prompt names ${needle}`);
    const spec = path.join(x.out, 'repos', `${RUNB}--r1`, 'whole-branch--7-spec.md');
    assert.ok(text.includes(`Spec: ${toPosix(spec)}`), text);
    assert.equal(read(spec), read(path.join(x.bx.runsRoot, RUNB, 'work', '7-spec.md')));
  });

  const plainTvb = memo(() => extractBranch('task-vs-branch'));
  const lsTree = (cwd, rev) => gitIn(cwd)('ls-tree', '-r', rev);
  const repoOf = (x, s) => x.json(schema.REVIEWS_FIXTURE_FILE).repos.find((r) => r.key === s.repoKey);
  // Replaces agent `id`'s archived reply in the branch fixture's transcripts.
  const setReply = (bx, id, text) => {
    const file = path.join(bx.transcripts, 'slug', 'sess', 'subagents', `agent-${id}.jsonl`);
    const lines = read(file).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    lines[1].message.content[0].text = text;
    fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  };

  test('AC1.1 AC1.2 AC1.3: one task-head slot, its repository head tree is T2, not F (git ls-tree -r)', async () => {
    const x = await plainTvb();
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.equal(fixture.role, 'task-vs-branch');
    const head = fixture.slots.filter((s) => s.at === 'task-head');
    assert.equal(head.length, 1);
    assert.deepEqual([head[0].name, head[0].taskAgentId, head[0].agentId], [`${RUNB}/task-vs-branch`, 't2', 'wb']);
    const repo = repoOf(x, head[0]).path;
    assert.equal(lsTree(repo, 'HEAD'), lsTree(x.bx.mainRoot, x.bx.T2));
    assert.notEqual(lsTree(repo, 'HEAD'), lsTree(x.bx.mainRoot, x.bx.F));
    assert.equal(lsTree(repo, 'HEAD~1'), lsTree(x.bx.mainRoot, x.bx.B), 'the base is the whole-branch prompt\'s');
  });

  test('AC2.1: the slot prompt is the whole-branch prompt with replay shas, no task prompt or reply text', async () => {
    const x = await plainTvb();
    ok(x);
    const slot = x.json(schema.REVIEWS_FIXTURE_FILE).slots.find((s) => s.at === 'task-head');
    const repo = repoOf(x, slot);
    const text = promptOf(x, slot.name);
    for (const needle of ['You are a Senior Code Reviewer', '## What Was Implemented', `Base ${repo.replayBase} (the review base). Head ${repo.replayHead}.`]) assert.ok(text.includes(needle), `the prompt lacks ${needle}`);
    for (const needle of ['a broad whole-branch review happens separately', 'null deref when y is unset', 'Task quality', x.bx.B, x.bx.F, x.bx.T2, '[Effort:', x.bx.mainRoot]) assert.ok(!text.includes(needle), `the prompt names ${needle}`);
  });

  test('AC7.1 (extract half): two slots for the Needs fixes review, task head and final head', async () => {
    const x = await plainTvb();
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(fixture.slots.map((s) => [s.name, s.role, s.at, s.baseFrom, s.taskAgentId, s.taskTier, s.verdict, s.archivedTier, s.archivedEffort]), [
      [`${RUNB}/task-vs-branch`, 'task-vs-branch', 'task-head', 'whole-branch', 't2', 'capable', 'needs-fixes', 'capable', 'high'],
      [`${RUNB}/task-vs-branch--final`, 'task-vs-branch', 'final-head', 'whole-branch', 't2', 'capable', 'needs-fixes', 'capable', 'high'],
    ]);
    const final = fixture.slots[1];
    assert.equal(lsTree(repoOf(x, final).path, 'HEAD'), lsTree(x.bx.mainRoot, x.bx.F));
    assert.deepEqual([repoOf(x, final).archivedBase, repoOf(x, final).archivedHead], [x.bx.B, x.bx.F]);
    const reports = x.json(schema.REPORTS_FILE).reports;
    for (const s of fixture.slots) {
      const r = reports[s.name];
      // The task review's Critical and Important items only: its unlocated Minor item is not an archived finding here.
      assert.deepEqual(r.items.map((i) => [i.sev, i.path, i.line]), [['important', 'src/x.js', 10]]);
      assert.deepEqual([r.role, r.verdict, r.itemsUnparsed, r.unlocated, r.taskTier, r.at], ['task-vs-branch', 'needs-fixes', false, 0, 'capable', s.at]);
    }
    assert.deepEqual(fixture.excluded, []);
    assert.deepEqual(fixture.totals, { reviews: 1, slots: 2, byTaskTier: { capable: 1 }, notQualifying: 1 });
  });

  test('the re-review range ending after the fix is not read as the pre-fix head', async () => {
    const x = await plainTvb();
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.ok(![...fixture.slots, ...fixture.excluded].some((s) => s.agentId === 'rr2' || s.taskAgentId === 'rr2'));
    const head = fixture.slots.find((s) => s.at === 'task-head');
    assert.equal(repoOf(x, head).archivedHead, x.bx.T2);
    assert.equal(lsTree(repoOf(x, head).path, 'HEAD'), lsTree(x.bx.mainRoot, x.bx.T2));
  });

  test('catch-up base: whole-branch base not an ancestor of the task head → merge-base', async () => {
    const x = await extractBranch('task-vs-branch', { catchUp: true });
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    const [head, final] = fixture.slots;
    assert.deepEqual([head.at, head.baseFrom, final.at, final.baseFrom], ['task-head', 'merge-base', 'final-head', 'whole-branch']);
    assert.deepEqual([repoOf(x, head).archivedBase, repoOf(x, head).archivedHead], [x.bx.B, x.bx.T2]);
    assert.equal(lsTree(repoOf(x, head).path, 'HEAD~1'), lsTree(x.bx.mainRoot, x.bx.B));
    assert.deepEqual([repoOf(x, final).archivedBase, repoOf(x, final).archivedHead], [x.bx.M, x.bx.W]);
    // The prompt still names the whole-branch shas, each mapped to the replay's.
    const text = promptOf(x, head.name);
    assert.ok(text.includes(`Base ${repoOf(x, head).replayBase} (the review base). Head ${repoOf(x, head).replayHead}.`), text);
  });

  // Extracts task-vs-branch with the git seam failing the `git merge-base` calls on the task head T2 that `fail` names
  // by mode ('--is-ancestor', or the plain 'merge-base'), each with the exit status it maps to.
  async function extractFailingMergeBase(fail) {
    const bRoot = scratchDir('rr-branch-mb-');
    const bx = buildBranchFixture(bRoot);
    const deps = makeDeps(bx.mainRoot);
    const real = deps.git;
    deps.git = (args) => {
      const mode = args[1] === '--is-ancestor' ? '--is-ancestor' : 'merge-base';
      if (args[0] === 'merge-base' && args[args.length - 1] === bx.T2 && fail[mode] !== undefined) throw Object.assign(new Error(`git exited ${fail[mode]}`), { status: fail[mode] });
      return real(args);
    };
    const out = path.join(bRoot, 'out');
    const code = await run({ argv: ['extract-reviews', '--runs', bx.runsRoot, '--out', out, '--role', 'task-vs-branch', '--transcripts', bx.transcripts, '--arm', 'name=a,profile=fast'], deps });
    const json = (name) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
    return { code, deps, json, bx };
  }

  test('a whole-branch base with no merge base with the task head excludes the review as no-merge-base', async () => {
    // Neither an ancestor nor sharing a merge base: both calls exit 1.
    const x = await extractFailingMergeBase({ '--is-ancestor': 1, 'merge-base': 1 });
    assert.equal(x.code, 3);
    assert.deepEqual(JSON.parse(x.deps.errs.join('\n')).excluded, [{ run: RUNB, agentId: 't2', tier: 'capable', reason: 'no-merge-base' }]);
  });

  test('--is-ancestor exit 1 takes the merge-base path', async () => {
    const x = await extractFailingMergeBase({ '--is-ancestor': 1 });
    ok(x);
    const head = x.json(schema.REVIEWS_FIXTURE_FILE).slots.find((s) => s.at === 'task-head');
    assert.equal(head.baseFrom, 'merge-base');
    assert.equal(x.json(schema.REVIEWS_FIXTURE_FILE).repos.find((r) => r.key === head.repoKey).archivedBase, x.bx.B);
  });

  test('a merge-base failure other than exit 1 fails the extract, not a no-merge-base row', async () => {
    // The plain merge-base call is reached only after --is-ancestor says "not an ancestor" (exit 1).
    for (const fail of [{ '--is-ancestor': 128 }, { '--is-ancestor': 1, 'merge-base': 128 }]) {
      const x = await extractFailingMergeBase(fail);
      assert.equal(x.code, 1, JSON.stringify(fail));
      assert.ok(x.deps.errs.join('\n').includes('git exited 128'), x.deps.errs.join('\n'));
    }
  });

  test('no usable whole-branch prompt excludes the task reviews', async () => {
    for (const opts of [{ noWholeBranch: true }, { wbUnusableFirst: true }]) {
      const x = await extractBranch('task-vs-branch', opts);
      assert.equal(x.code, 3, JSON.stringify(opts));
      const err = JSON.parse(x.deps.errs.join('\n'));
      assert.deepEqual(err.excluded, [{ run: RUNB, agentId: 't2', tier: 'capable', reason: 'no-whole-branch-prompt' }], JSON.stringify(opts));
      assert.deepEqual(err.shortfall.available, { reviews: 0, slots: 0, byTaskTier: {}, notQualifying: 1 });
    }
  });

  test('an Approved review and a Minor-only Needs fixes review yield no slot and no exclusion, and count in totals.notQualifying', async () => {
    // t2's reply with its Important item dropped: Needs fixes over one Minor item.
    const x = await extractBranch('task-vs-branch', {}, [], (bx) => setReply(bx, 't2', '### Issues\n#### Minor\n- naming could be clearer\n\nTask quality: Needs fixes'));
    assert.equal(x.code, 3);
    const err = JSON.parse(x.deps.errs.join('\n'));
    assert.deepEqual(err.excluded, []);
    assert.deepEqual(err.shortfall.available, { reviews: 0, slots: 0, byTaskTier: {}, notQualifying: 2 });
  });

  test('an Approved review listing an Important item is not qualifying', async () => {
    const x = await extractBranch('task-vs-branch', {}, [], (bx) => setReply(bx, 't1', '#### Important\n- src/y.js:3 unused\n\nTask quality: Approved'));
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(fixture.slots.map((s) => s.taskAgentId), ['t2', 't2']);
    assert.equal(fixture.totals.notQualifying, 1);
  });

  test('qualification is read before the prompt and tier: an Approved review whose pointer file is gone, or with no tier, is notQualifying, not excluded', async () => {
    const approved = 'The change is small and correct.\n\nTask quality: Approved';
    const x = await extractBranch('task-vs-branch', { pointer: 'gone' }, [], (bx) => {
      setReply(bx, 'tp', approved);
      const f = path.join(bx.runsRoot, RUNB, 'timing.json');
      const timing = JSON.parse(read(f));
      delete timing.dispatches.items.find((i) => i.agentId === 't1').tier;
      fs.writeFileSync(f, JSON.stringify(timing));
    });
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(fixture.excluded, []);
    assert.deepEqual(fixture.totals, { reviews: 1, slots: 2, byTaskTier: { capable: 1 }, notQualifying: 2 });
    // A qualifying review whose pointer file is gone is still excluded.
    const y = await extractBranch('task-vs-branch', { pointer: 'gone' });
    ok(y);
    const yFixture = y.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(yFixture.excluded, [{ run: RUNB, agentId: 'tp', tier: 'standard', reason: 'prompt-file-gone' }]);
    assert.equal(yFixture.totals.notQualifying, 1);
  });

  test('a second qualifying review is task-vs-branch.2, its taskTier its own, its archived tier the whole-branch review\'s', async () => {
    const x = await extractBranch('task-vs-branch', { pointer: 'present' });
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(fixture.slots.map((s) => [s.name, s.at, s.taskAgentId, s.taskTier, s.archivedTier]), [
      [`${RUNB}/task-vs-branch`, 'task-head', 't2', 'capable', 'capable'],
      [`${RUNB}/task-vs-branch--final`, 'final-head', 't2', 'capable', 'capable'],
      [`${RUNB}/task-vs-branch.2`, 'task-head', 'tp', 'standard', 'capable'],
      [`${RUNB}/task-vs-branch.2--final`, 'final-head', 'tp', 'standard', 'capable'],
    ]);
    // Same (run, base, head) as t2's: the repositories are shared.
    assert.equal(fixture.repos.length, 2);
    assert.deepEqual(fixture.totals, { reviews: 2, slots: 4, byTaskTier: { capable: 1, standard: 1 }, notQualifying: 1 });
  });

  test('--min-reviews counts task reviews, not slots', async () => {
    const x = await extractBranch('task-vs-branch', { pointer: 'present' }, ['--min-reviews', '3']);
    assert.equal(x.code, 3, 'two task reviews, four slots');
    assert.deepEqual(JSON.parse(x.deps.errs.join('\n')).shortfall.available, { reviews: 2, slots: 4, byTaskTier: { capable: 1, standard: 1 }, notQualifying: 1 });
    ok(await extractBranch('task-vs-branch', { pointer: 'present' }, ['--min-reviews', '2']));
  });

  test('the whole-branch review\'s own reply is never read: an unparseable one still supplies the prompt', async () => {
    const x = await extractBranch('task-vs-branch', {}, [], (bx) => setReply(bx, 'wb', 'I looked around.'));
    ok(x);
    assert.deepEqual(x.json(schema.REVIEWS_FIXTURE_FILE).slots.map((s) => s.taskAgentId), ['t2', 't2']);
  });

  test('a whole-branch prompt that fails the leak barrier excludes the task reviews as no-whole-branch-prompt', async () => {
    const bRoot = scratchDir('rr-branch-moved-');
    const bx = buildBranchFixture(bRoot);
    // mainRoot is derived from --runs: moved, the whole-branch prompt's spec path is no longer a run input to rewrite.
    const moved = path.join(bRoot, 'moved', 'repo', '.claude-tweaks', 'pipelines');
    fs.cpSync(bx.runsRoot, moved, { recursive: true });
    const deps = makeDeps(bx.mainRoot);
    const code = await run({ argv: ['extract-reviews', '--runs', moved, '--out', path.join(bRoot, 'out'), '--role', 'task-vs-branch', '--transcripts', bx.transcripts, '--arm', 'name=a,profile=fast'], deps });
    assert.equal(code, 3, deps.errs.join('\n'));
    assert.deepEqual(JSON.parse(deps.errs.join('\n')).excluded, [{ run: RUNB, agentId: 't2', tier: 'capable', reason: 'no-whole-branch-prompt' }]);
  });

  test('a bold-label Needs fixes review (boldLabel fixture, t3) is excluded as items-unparsed', async () => {
    const x = await extractBranch('task-vs-branch', { boldLabel: true });
    ok(x);
    const fixture = x.json(schema.REVIEWS_FIXTURE_FILE);
    assert.deepEqual(fixture.excluded, [{ run: RUNB, agentId: 't3', tier: 'standard', reason: 'items-unparsed' }]);
    assert.deepEqual(fixture.slots.map((s) => [s.name, s.taskAgentId]), [[`${RUNB}/task-vs-branch`, 't2'], [`${RUNB}/task-vs-branch--final`, 't2']]);
  });

  test('--lens with a branch role exits 2', async () => {
    const x = await extractBranch('task', {}, ['--lens', '3a']);
    assert.equal(x.code, 2);
    assert.ok(x.deps.errs.join('\n').includes('--lens applies to --role lens only'), x.deps.errs.join('\n'));
    const y = await extractBranch('whole-branch', {}, ['--max-per-lens', '1']);
    assert.equal(y.code, 2);
    assert.ok(y.deps.errs.join('\n').includes('--max-per-lens applies to --role lens only'), y.deps.errs.join('\n'));
  });
});
