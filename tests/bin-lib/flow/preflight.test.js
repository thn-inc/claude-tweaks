'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'flow', 'preflight');
const { ADOPTION_NOTES, PR_CONFLICT_NOTE, computeAdoption, parseChecklist, gatherPreflight, LEVER_KEYS, defaultDeps } = require(MOD);
const { execFileSync } = require('child_process');

// A fake main checkout with one run dir under .claude-tweaks/pipelines/.
function mainRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-preflight-'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-7');
  fs.mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}

const STAMP = JSON.stringify({ present: true, sha: 'abc', head: 'abc', dirty: false, scope: 'full', fullSha: 'abc', match: true, verifiedHead: true });
const CHANGED = JSON.stringify({ base: 'abc', files: ['src/a.js'] });
const PR_BODY = 'intro\n<!-- phases-start -->\n- [x] build\n- [x] test\n- [ ] review\n- [ ] polish\n- [ ] wrap-up\n<!-- phases-end -->\ntail';

function deps(fx, overrides = {}, calls = null) {
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    git: (args) => (args[0] === 'ls-tree' ? 'x/work/7-spec.md\0' : 'feat-branch\n'),
    execFile: (cmd, args, opts) => {
      if (calls) calls.push({ cmd, args, opts });
      if (cmd === 'gh') return JSON.stringify({ state: 'OPEN', isDraft: true, body: PR_BODY });
      if (args.includes('--stamp-status')) return STAMP;
      if (args.includes('--changed-files')) return CHANGED;
      throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
    },
    checkResumeFreshness: () => ({ safe: true, verdict: 'not-interrupted' }),
    checkStagedInventory: () => ({ checked: 2, missing: [] }),
    readRunState: (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8')); } catch { return null; } },
    resolvePolicy: (keys) => Object.fromEntries(keys.map((k) => [k, k === 'integration-branch' ? { value: 'main', source: 'default' } : { value: `v-${k}`, source: 'policy' }])),
    resolveTarget: ({ runDir }) => (fs.existsSync(runDir) ? { ok: true, dir: fs.realpathSync(runDir) } : { ok: false, reason: 'missing' }),
    now: () => Date.parse('2026-09-06T12:00:00Z'),
    ...overrides,
  };
}

function seedCase1(fx) {
  fs.writeFileSync(path.join(fx.runDir, 'config.yml'), 'mode: auto\nceremony-profile: standard\nscope-creep: add-to-plan\n');
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', pr: { number: 1901, branch: 'feat-branch' } }));
  fs.mkdirSync(path.join(fx.runDir, 'work'));
  fs.writeFileSync(path.join(fx.runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
}

test('AC2.1: a dispatched run dir carrying call 1\'s full bookend set adopts as case 1, not case 3 (#2912)', () => {
  const fx = mainRoot();
  seedCase1(fx);
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', dispatched: true, pr: { number: 1901, branch: 'feat-branch' } }));
  const claim = '## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.\n';
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), `${claim}\n## /build\n- AUTO 18:50:00 — Step 1: build started. Reversibility: high.\n`);
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx) });
  assert.strictEqual(a.case, 1);
});

test('case 1: anchored dir with config.yml → adopt, the case-1 literal, OK freshness/inventory, twelve levers with sources, stamp match, changed files (#1931 AC1)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const calls = [];
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review', 'polish', 'wrap-up'], cwd: fx.root, mainRoot: fx.root, deps: deps(fx, {}, calls) });
  assert.deepStrictEqual(pack.steps, ['review', 'polish', 'wrap-up']);
  assert.strictEqual(pack.mode, 'auto');
  assert.strictEqual(pack.adoption.ok, true);
  assert.strictEqual(pack.adoption.value.case, 1);
  assert.strictEqual(pack.adoption.value.note, ADOPTION_NOTES[1].replace('{path}', fs.realpathSync(fx.runDir)));
  assert.strictEqual(pack.freshness.value.verdict, 'OK');
  assert.match(pack.freshness.value.line, /resume freshness OK for 2026-09-06T000000-record-7 \(not-interrupted\)/);
  assert.strictEqual(pack.inventory.value.status, 'OK');
  assert.strictEqual(pack.levers.value.length, 12);
  for (const l of pack.levers.value) { assert.ok(LEVER_KEYS.includes(l.key)); assert.ok('value' in l && typeof l.source === 'string', l.key); }
  const ceremony = pack.levers.value.find((l) => l.key === 'ceremony-profile');
  assert.deepStrictEqual(ceremony, { key: 'ceremony-profile', value: 'standard', source: 'header' });
  assert.deepStrictEqual(pack.spec.value, { path: 'work/7-spec.md', present: true, record: 7, records: [7] });
  assert.strictEqual(pack.pr.value.number, 1901);
  assert.deepStrictEqual(pack.pr.value.checklist, [{ phase: 'build', done: true }, { phase: 'test', done: true }, { phase: 'review', done: false }, { phase: 'polish', done: false }, { phase: 'wrap-up', done: false }]);
  assert.strictEqual(pack.stamp.value.match, true);
  assert.ok(Array.isArray(pack.changedFiles.value.files));
  const stampCall = calls.find((c) => c.args.includes('--stamp-status'));
  const changedCall = calls.find((c) => c.args.includes('--changed-files'));
  const ghCall = calls.find((c) => c.cmd === 'gh');
  assert.strictEqual(stampCall.opts.cwd, '/w/tree');
  assert.strictEqual(changedCall.opts.cwd, '/w/tree');
  assert.strictEqual(ghCall.opts.cwd, fx.root);
});

test('case 3: decisions.md content but no config.yml → the #1013-recovery literal with the computed backfills; case 2: empty dir → the minted literal (#1931 AC2)', () => {
  const fx = mainRoot();
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), '## /build\n- AUTO 10:00:00 — x. Reversibility: high.\n');
  const d = deps(fx, { git: (args) => (args[0] === 'ls-tree' ? '' : 'feat-branch\n') });
  const a3 = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: d });
  assert.strictEqual(a3.case, 3);
  assert.strictEqual(a3.note, ADOPTION_NOTES[3].replace('{path}', fs.realpathSync(fx.runDir)).replace('{worktree registration | PR-early lifecycle | materialize commit}', 'worktree registration, PR-early lifecycle, materialize commit'));
  assert.deepStrictEqual(a3.backfills, ['worktree registration', 'PR-early lifecycle', 'materialize commit']);
  const fx2 = mainRoot();
  const a2 = computeAdoption({ runDir: fx2.runDir, mainRoot: fx2.root, cwd: fx2.root, deps: d });
  assert.strictEqual(a2.case, 2);
  assert.strictEqual(a2.note, ADOPTION_NOTES[2].replace('{path}', fs.realpathSync(fx2.runDir)));
});

test('case 4: a missing dir and an unanchored dir each render the case-4 literal with the matching reason; case 5: unset → no note (#1931 AC2)', () => {
  const fx = mainRoot();
  const missing = path.join(fx.root, '.claude-tweaks', 'pipelines', 'nope');
  const a = computeAdoption({ runDir: missing, mainRoot: fx.root, cwd: fx.root, deps: deps(fx) });
  assert.strictEqual(a.case, 4);
  assert.strictEqual(a.note, ADOPTION_NOTES[4].replace('{path}', missing).replace('{does not exist | is not anchored to the main checkout}', 'does not exist'));
  const shadow = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-preflight-shadow-'));
  const b = computeAdoption({ runDir: shadow, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, { resolveTarget: () => ({ ok: false, reason: 'not-anchored' }) }) });
  assert.strictEqual(b.case, 4);
  assert.match(b.note, /is not anchored to the main checkout/);
  const c = computeAdoption({ runDir: null, mainRoot: fx.root, cwd: fx.root, deps: deps(fx) });
  assert.deepStrictEqual({ case: c.case, note: c.note }, { case: 5, note: null });
});

test('a BLOCKED freshness verdict propagates as data with the CLI line, and does not fail the pack (#1931 AC3)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const d = deps(fx, { checkResumeFreshness: () => ({ safe: false, verdict: 'BLOCKED', reason: 'worktree lock pid 4242 is live' }) });
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: d });
  assert.strictEqual(pack.freshness.ok, true);
  assert.strictEqual(pack.freshness.value.verdict, 'BLOCKED');
  assert.strictEqual(pack.freshness.value.line, 'claude-tweaks: resume freshness BLOCKED for 2026-09-06T000000-record-7 — run appears actively owned (worktree lock pid 4242 is live)');
  assert.strictEqual(pack.adoption.value.case, 1, 'adoption is computed independently; the skill decides to stop');
});

test('a staged-inventory MISMATCH renders the CLI line verbatim (#1931)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const d = deps(fx, { checkStagedInventory: () => ({ checked: 3, missing: ['staged/review-2.patch'] }) });
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: d });
  assert.strictEqual(pack.inventory.value.status, 'MISMATCH');
  assert.strictEqual(pack.inventory.value.line, 'claude-tweaks: staged inventory MISMATCH for 2026-09-06T000000-record-7 — 1 of 3 STAGED entries missing from staged/: staged/review-2.patch');
});

test('gh absent → pr.ok false with the error, every other field intact; no pr in run-state.json → pr.ok true with value null (#1931 AC4)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const d = deps(fx, { execFile: (cmd, args) => { if (cmd === 'gh') { const e = new Error('spawn gh ENOENT'); e.code = 'ENOENT'; throw e; } if (args.includes('--stamp-status')) return STAMP; return CHANGED; } });
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: d });
  assert.strictEqual(pack.pr.ok, false);
  assert.match(pack.pr.error, /gh-absent/);
  for (const k of ['adoption', 'freshness', 'inventory', 'levers', 'spec', 'stamp', 'changedFiles']) assert.strictEqual(pack[k].ok, true, k);
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active' }));
  const pack2 = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: deps(fx) });
  assert.deepStrictEqual(pack2.pr, { ...pack2.pr, ok: true, value: null });
});

test('a single lever failing to resolve degrades that entry only (#1931 Gotcha)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const d = deps(fx, { resolvePolicy: (keys) => Object.fromEntries(keys.map((k) => [k, k === 'model-stance' ? { error: 'unknown-key' } : { value: 'x', source: 'default' }])) });
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: d });
  assert.strictEqual(pack.levers.ok, true);
  const bad = pack.levers.value.find((l) => l.key === 'model-stance');
  assert.deepStrictEqual(bad, { key: 'model-stance', value: null, source: null, error: 'unknown-key' });
});

test('one probe throwing degrades only its field, and the probes run concurrently (#1931)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const slow = (v) => new Promise((r) => setTimeout(() => r(v), 150));
  const d = deps(fx, {
    checkResumeFreshness: () => { throw new Error('probe exploded'); },
    execFile: (cmd, args) => { if (cmd === 'gh') return JSON.stringify({ state: 'OPEN', isDraft: true, body: PR_BODY }); return args.includes('--stamp-status') ? STAMP : CHANGED; },
  });
  let inFlight = 0;
  let maxInFlight = 0;
  const execFileAsync = async (cmd, args) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try { return await slow(d.execFile(cmd, args)); } finally { inFlight--; }
  };
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: { ...d, execFileAsync } });
  assert.strictEqual(pack.freshness.ok, false);
  assert.match(pack.freshness.error, /probe exploded/);
  assert.strictEqual(pack.pr.ok, true);
  assert.strictEqual(maxInFlight, 3, 'the three subprocess probes overlap');
});

test('a probe that never resolves is bounded by probeTimeoutMs, without blocking or leaking a timer for the others (#1931 parity with wrap-up/pack.js)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const d = deps(fx, {
    execFileAsync: async (cmd, args) => {
      if (args.includes('--stamp-status')) return new Promise(() => {}); // never resolves
      if (cmd === 'gh') return JSON.stringify({ state: 'OPEN', isDraft: true, body: PR_BODY });
      if (args.includes('--changed-files')) return CHANGED;
      throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
    },
  });
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: { ...d, probeTimeoutMs: 25 } });
  assert.strictEqual(pack.stamp.ok, false);
  assert.match(pack.stamp.error, /timeout after 25ms/);
  assert.strictEqual(pack.freshness.ok, true);
  assert.strictEqual(pack.inventory.ok, true);
  assert.strictEqual(pack.levers.ok, true);
  assert.strictEqual(pack.spec.ok, true);
  assert.strictEqual(pack.pr.ok, true);
  assert.strictEqual(pack.changedFiles.ok, true);
});

test('parseChecklist reads the phases span and ignores rows outside it (#1931 decision 7)', () => {
  assert.deepStrictEqual(parseChecklist('- [ ] stray\n<!-- phases-start -->\n- [x] build\n- [ ] test\n<!-- phases-end -->\n- [x] other'), [{ phase: 'build', done: true }, { phase: 'test', done: false }]);
  assert.deepStrictEqual(parseChecklist('no markers'), []);
});

test('parseChecklist accepts an uppercase `- [X]` tick (#1931 M4)', () => {
  assert.deepStrictEqual(
    parseChecklist('<!-- phases-start -->\n- [X] build\n- [x] test\n- [ ] review\n<!-- phases-end -->'),
    [{ phase: 'build', done: true }, { phase: 'test', done: true }, { phase: 'review', done: false }],
  );
});

test('ADOPTION_NOTES carry the four prose literals with their placeholders (#1931 AC5)', () => {
  assert.strictEqual(ADOPTION_NOTES[1], 'Resuming existing run directory: {path}');
  assert.strictEqual(ADOPTION_NOTES[2], 'Adopting minted run directory: {path}');
  assert.strictEqual(ADOPTION_NOTES[3], 'Recovering inherited run directory: {path} (missing config.yml; backfilled {worktree registration | PR-early lifecycle | materialize commit} before proceeding).');
  assert.strictEqual(ADOPTION_NOTES[4], 'PIPELINE_RUN_DIR was set to {path}, which {does not exist | is not anchored to the main checkout} — created a fresh run directory instead.');
});

test('case 3 with an empty backfill list renders `nothing` rather than an empty span (#1931 M2)', () => {
  const fx = mainRoot();
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), '## /build\n- AUTO 10:00:00 — x. Reversibility: high.\n');
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', pr: { number: 1901, branch: 'feat-branch' } }));
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx) });
  assert.strictEqual(a.case, 3);
  assert.deepStrictEqual(a.backfills, []);
  assert.strictEqual(a.note, ADOPTION_NOTES[3].replace('{path}', fs.realpathSync(fx.runDir)).replace('{worktree registration | PR-early lifecycle | materialize commit}', 'nothing'));
});

test('configValue tolerates a trailing `# comment` on a config.yml line (#1931 M3)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  fs.writeFileSync(path.join(fx.runDir, 'config.yml'), 'mode: auto   # FYI variant, no gate\nceremony-profile: fast-lane  # bundle-folded\n');
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: deps(fx) });
  assert.strictEqual(pack.mode, 'auto');
  assert.deepStrictEqual(pack.levers.value.find((l) => l.key === 'ceremony-profile'), { key: 'ceremony-profile', value: 'fast-lane', source: 'header' });
});

// #1931 N1: a `#` is only a YAML comment introducer when whitespace precedes it.
// The first form of the M3 fix stripped an unspaced one too, truncating `a#b` to `a`.
test('configValue strips a whitespace-preceded comment but never an unspaced `#` inside the value (#1931 N1)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  fs.writeFileSync(path.join(fx.runDir, 'config.yml'), 'mode: a#b\nceremony-profile: fast-lane\n');
  const unspaced = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: deps(fx) });
  assert.strictEqual(unspaced.mode, 'a#b', 'an unspaced # is part of the value, not a comment');
  fs.writeFileSync(path.join(fx.runDir, 'config.yml'), 'mode: auto   # note\nceremony-profile: fast-lane\n');
  const spaced = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: deps(fx) });
  assert.strictEqual(spaced.mode, 'auto', 'a whitespace-preceded # introduces a comment');
});

test('the levers and the changed-files integration branch share ONE resolvePolicy call per pack (#1931 M5)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const policyCalls = [];
  const d = deps(fx, {
    resolvePolicy: (keys, runDir) => {
      policyCalls.push({ keys, runDir });
      return Object.fromEntries(keys.map((k) => [k, k === 'integration-branch' ? { value: 'develop', source: 'policy' } : { value: `v-${k}`, source: 'policy' }]));
    },
  });
  const calls = [];
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: { ...d, execFile: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return d.execFile(cmd, args, opts); } } });
  assert.strictEqual(policyCalls.length, 1, 'exactly one resolvePolicy call per pack');
  assert.ok(policyCalls[0].keys.includes('integration-branch'), 'integration-branch resolves in the levers call');
  assert.ok(policyCalls[0].keys.includes('merge-verification'));
  assert.strictEqual(pack.levers.value.length, 12, 'integration-branch is not a Manifesto lever');
  assert.ok(!pack.levers.value.some((l) => l.key === 'integration-branch'));
  const changedCall = calls.find((c) => c.args.includes('--changed-files'));
  assert.deepStrictEqual(changedCall.args.slice(-2), ['--integration-branch', 'develop']);
});

test('the spec probe falls back to a multi-spec parent\'s spec-{N}/work/ headers (#1931 I4)', async () => {
  const fx = mainRoot();
  fs.writeFileSync(path.join(fx.runDir, 'config.yml'), 'mode: auto\nceremony-profile: standard\n');
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', pr: { number: 1901, branch: 'feat-branch' } }));
  for (const n of ['spec-160', 'spec-9']) {
    fs.mkdirSync(path.join(fx.runDir, n, 'work'), { recursive: true });
    fs.writeFileSync(path.join(fx.runDir, n, 'work', `${n.slice(5)}-spec.md`), '---\n');
  }
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: deps(fx) });
  assert.deepStrictEqual(pack.spec.value, { path: null, present: true, record: null, records: [9, 160] });
});

test('the spec probe reports absent with an empty records list when neither work/ nor spec-{N}/work/ carries a header (#1931 I4)', async () => {
  const fx = mainRoot();
  fs.writeFileSync(path.join(fx.runDir, 'config.yml'), 'mode: auto\nceremony-profile: standard\n');
  const pack = await gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: deps(fx) });
  assert.deepStrictEqual(pack.spec.value, { path: null, present: false, record: null, records: [] });
});

test('specOnBranch falls back to a recursive spec-{N}/work/ listing when {run-dir}/work/ is empty on the branch (#1931 I4)', () => {
  const fx = mainRoot();
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), 'x\n');
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', pr: { number: 1, branch: 'feat-branch' } }));
  const seen = [];
  const rel = path.relative(fx.root, fs.realpathSync(fx.runDir)).split(path.sep).join('/');
  const d = deps(fx, {
    git: (args) => {
      seen.push(args);
      if (args[0] !== 'ls-tree') return 'feat-branch\n';
      // The direct `{rel}/work/` listing is legitimately empty for a parent;
      // only the recursive `{rel}/` listing carries the per-spec headers.
      if (args[args.length - 1] === `${rel}/work/`) return '';
      return `${rel}/spec-9/work/9-spec.md\0${rel}/spec-160/work/160-spec.md\0`;
    },
  });
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: d });
  assert.strictEqual(a.specMaterialized, true);
  const lsCalls = seen.filter((args) => args[0] === 'ls-tree');
  assert.strictEqual(lsCalls.length, 2, 'the direct listing runs first, the recursive fallback second');
  assert.ok(!lsCalls[0].includes('-r'), 'the direct {rel}/work/ listing is non-recursive');
  assert.ok(lsCalls[1].includes('-r'), 'the parent fallback must recurse — a bare {rel}/ listing returns TREE names only');
  assert.strictEqual(lsCalls[1][lsCalls[1].length - 1], `${rel}/`);
  assert.deepStrictEqual(lsCalls[0], ['ls-tree', '--name-only', '-z', '--end-of-options', 'feat-branch', '--', `${rel}/work/`]);
  assert.deepStrictEqual(lsCalls[1], ['ls-tree', '-r', '--name-only', '-z', '--end-of-options', 'feat-branch', '--', `${rel}/`]);
});

test('defaultDeps().resolvePolicy applies computeDerivedDefaults, so merge-verification resolves to a value with no policy.yml (#1931 I2)', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-preflight-derived-')));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-7');
  fs.mkdirSync(runDir, { recursive: true });
  assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'policy.yml')), 'the fixture deliberately has no policy.yml');
  const resolved = defaultDeps(root).resolvePolicy(['merge-verification', 'integration-model'], runDir);
  assert.strictEqual(typeof resolved['merge-verification'].value, 'string', `merge-verification must be derived, got ${JSON.stringify(resolved['merge-verification'])}`);
  assert.strictEqual(typeof resolved['integration-model'].value, 'string', `integration-model must be derived, got ${JSON.stringify(resolved['integration-model'])}`);
});

// #2861: /flow Step 2.8 logs its claim to decisions.md BEFORE Step 3 runs this
// classifier, so a freshly minted dir is never byte-empty by the time it is read.
const NO_SPEC = { git: (args) => (args[0] === 'ls-tree' ? '' : 'feat-branch\n') };
const CLAIM_ONLY = '## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.\n';
// #3242: a compliant dispatched call 1 logs both the Step 2.8 claim above and
// a Step 1.8 ledger line before Step 3 runs.
const LEDGER_LINE = '- AUTO 18:42:10 — Step 1.8: flow: created open-items ledger docs/plans/2026-09-06-record-7-ledger.md. Reversibility: n/a.\n';
const CLAIM_AND_LEDGER = `${CLAIM_ONLY}${LEDGER_LINE}`;

function adoptionFor(decisions, extra = {}) {
  const fx = mainRoot();
  if (decisions !== null) fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), decisions);
  for (const [name, text] of Object.entries(extra)) fs.writeFileSync(path.join(fx.runDir, name), text);
  return { fx, a: computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, NO_SPEC) }) };
}

test('a decisions.md holding only Step 2.8 claim-log lines classifies as case 2, single-target and batch forms (#2861 AC1)', () => {
  const batch = '## /flow\n- AUTO 02:30:28 — Step 2.8: Claimed all 2 targets under run 2026-09-06T000000-record-7 (claim-targets.js exit 0). Reversibility: high.\n';
  for (const text of [CLAIM_ONLY, batch]) {
    const { fx, a } = adoptionFor(text);
    assert.strictEqual(a.case, 2, text);
    assert.strictEqual(a.hasOtherContent, false);
    assert.deepStrictEqual(a.backfills, []);
    assert.strictEqual(a.note, ADOPTION_NOTES[2].replace('{path}', fs.realpathSync(fx.runDir)));
  }
});

test('the claim line the real log-decision CLI writes from claim-targets.md\'s argv classifies as case 2 (#2861 AC1, writer-generated)', () => {
  const fx = mainRoot();
  fs.mkdirSync(path.join(fx.root, '.git'));
  const logDecision = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'log-decision.js'));
  const code = logDecision.run(
    ['--run', fx.runDir, '--status', 'AUTO', '--section', '/flow', '--step', 'Step 2.8', '--reversibility', 'high', '--text', 'claimed #7 (bin/claim-targets.js, transport: git)'],
    { now: () => Date.parse('2026-09-06T12:00:00Z'), cwd: () => fx.root, mainRoot: fx.root, stdout: () => {}, stderr: () => {} },
  );
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(fs.readdirSync(fx.runDir), ['decisions.md'], 'the writer leaves nothing but decisions.md behind (no lock residue)');
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, NO_SPEC) });
  assert.strictEqual(a.case, 2);
});

test('a missing, empty, or whitespace-only decisions.md still classifies as case 2 (#2861, unchanged)', () => {
  for (const text of [null, '', '  \n\n']) assert.strictEqual(adoptionFor(text).a.case, 2, JSON.stringify(text));
});

test('any non-claim decisions.md content still classifies as case 3 with the same backfills as before (#2861 AC2)', () => {
  const mixed = `${CLAIM_ONLY}- AUTO 18:42:16 — Manifesto: design-critique resolved to auto (source: default). Reversibility: n/a.\n`;
  const headerOnly = '# Auto-Decision Log — pipeline 2026-09-06T000000-record-7\n\nPipeline config snapshot:\n- mode: auto\n';
  const unparseable = `${CLAIM_ONLY}Step 2.8: claimed #7\n`;
  for (const text of [mixed, headerOnly, '## /flow\n', unparseable, '## /build\n- AUTO 10:00:00 — x. Reversibility: high.\n', 'x\n']) {
    const { a } = adoptionFor(text);
    assert.strictEqual(a.case, 3, JSON.stringify(text));
    assert.strictEqual(a.hasOtherContent, true);
    assert.deepStrictEqual(a.backfills, ['worktree registration', 'PR-early lifecycle', 'materialize commit']);
  }
});

test('a decisions.md that exists but cannot be read is content, never a fresh mint (#2861)', () => {
  const fx = mainRoot();
  const readFile = (p) => {
    if (path.basename(p) === 'decisions.md') {
      const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e;
    }
    return fs.readFileSync(p, 'utf8');
  };
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, { ...NO_SPEC, readFile }) });
  assert.strictEqual(a.case, 3);
  assert.strictEqual(a.hasOtherContent, true);
});

test('claim-log-only decisions.md beside a non-empty events.jsonl is still case 3; with config.yml it is still case 1 (#2861)', () => {
  assert.strictEqual(adoptionFor(CLAIM_ONLY, { 'events.jsonl': '{"event":"x"}\n' }).a.case, 3);
  const withConfig = adoptionFor(CLAIM_ONLY, { 'config.yml': 'mode: auto\n' }).a;
  assert.strictEqual(withConfig.case, 1);
  assert.strictEqual(withConfig.hasOtherContent, false);
});

// Ledger row 1: a sibling session's fallback-attributed skill_invoked write
// landing in a freshly minted dir's events.jsonl must not flip adoption to
// case 3 on its own.
test('events.jsonl holding only fallback-attributed lines does not count as other-run content → case 2 (ledger row 1)', () => {
  const fallbackOnly = '{"type":"skill_invoked","skill":"claude-tweaks:build","ts":"2026-09-06T12:01:00.000Z","attribution":"fallback"}\n';
  const { fx, a } = adoptionFor(null, { 'events.jsonl': fallbackOnly });
  assert.strictEqual(a.case, 2, `expected case 2, got case ${a.case}`);
  assert.strictEqual(a.hasOtherContent, false);
  assert.strictEqual(a.note, ADOPTION_NOTES[2].replace('{path}', fs.realpathSync(fx.runDir)));
});

test('events.jsonl mixing a fallback-attributed line with one non-fallback line still counts as other-run content → case 3 (unchanged)', () => {
  const mixed = '{"type":"skill_invoked","skill":"claude-tweaks:build","ts":"2026-09-06T12:01:00.000Z","attribution":"fallback"}\n'
    + '{"type":"skill_invoked","skill":"claude-tweaks:test","ts":"2026-09-06T12:02:00.000Z"}\n';
  const { a } = adoptionFor(null, { 'events.jsonl': mixed });
  assert.strictEqual(a.case, 3, `expected case 3, got case ${a.case}`);
  assert.strictEqual(a.hasOtherContent, true);
});

test('an unparseable events.jsonl line counts as other-run content → case 3 (fail toward the cautious case)', () => {
  const { a } = adoptionFor(null, { 'events.jsonl': 'not json\n' });
  assert.strictEqual(a.case, 3, `expected case 3, got case ${a.case}`);
  assert.strictEqual(a.hasOtherContent, true);
});

test('AC2.1: claim-log-only decisions.md beside fallback-only events.jsonl → case 2 (#3363)', () => {
  const fallbackOnly = '{"type":"skill_invoked","skill":"claude-tweaks:build","ts":"2026-09-06T12:01:00.000Z","attribution":"fallback"}\n'
    + '{"type":"skill_invoked","skill":"claude-tweaks:test","ts":"2026-09-06T12:02:00.000Z","attribution":"fallback"}\n';
  const { a } = adoptionFor(CLAIM_ONLY, { 'events.jsonl': fallbackOnly });
  assert.strictEqual(a.case, 2, `expected case 2, got case ${a.case}`);
  assert.strictEqual(a.hasOtherContent, false);
});

// #3665: degraded Step 2.8 bookkeeping is still a fresh mint — computeAdoption
// inherits the widened claim-log-only class from classifyDecisions.
const OVERLAP_SKIP_LINE = '- SKIP 18:42:05 — Step 2.8 file-overlap warning (skipped): condition: preflight-records.js exited non-zero or gh unavailable → fallback: overlap warning not computed; claim proceeds on the named targets only. Reversibility: n/a.\n';
const DEGRADED_SKIP_LINE = "- SKIP 18:42:07 — Step 2.8 bot:in-progress projection (degraded): condition: label still absent on #7 after one mergeLabelNames retry → fallback: claim kept; dispatch's label pre-filter will not see this hold. Reversibility: n/a.\n";
const PARAPHRASED_ONLY = '## /flow\n- AUTO 07:42:07 — spec #7 — flow/claim-targets: Claimed issue #7 for this run (claims-registry blob write, state: absent -> live). Reversibility: high.\n';
const DEGRADED_MINTS = [
  ['overlap-skip', `${CLAIM_ONLY}${OVERLAP_SKIP_LINE}`],
  ['degraded-projection-skip', `${CLAIM_ONLY}${DEGRADED_SKIP_LINE}`],
  ['paraphrased-claim', PARAPHRASED_ONLY],
];

for (const [kind, text] of DEGRADED_MINTS) {
  test(`AC: degraded Step 2.8 mint (${kind}) beside fallback-only events.jsonl → case 2, not case 3 (#3665)`, () => {
    const fallbackOnly = '{"type":"skill_invoked","skill":"claude-tweaks:build","ts":"2026-09-06T12:01:00.000Z","attribution":"fallback"}\n'
      + '{"type":"skill_invoked","skill":"claude-tweaks:test","ts":"2026-09-06T12:02:00.000Z","attribution":"fallback"}\n';
    const { a } = adoptionFor(text, { 'events.jsonl': fallbackOnly });
    assert.strictEqual(a.case, 2, `expected case 2, got case ${a.case}`);
    assert.strictEqual(a.hasOtherContent, false);
    assert.deepStrictEqual(a.backfills, []);
  });
}

test('a degraded Step 2.8 mint plus a Manifesto line is still case 3 (#3665)', () => {
  const mixed = `${CLAIM_ONLY}${OVERLAP_SKIP_LINE}- AUTO 18:42:16 — Manifesto: design-critique resolved to auto (source: default). Reversibility: n/a.\n`;
  const { a } = adoptionFor(mixed);
  assert.strictEqual(a.case, 3, `expected case 3, got case ${a.case}`);
});

test('AC3.1: an env- or session-attributed (untagged) events.jsonl line is still other-run content (#3363)', () => {
  const fallbackLine = '{"type":"skill_invoked","skill":"claude-tweaks:build","ts":"2026-09-06T12:01:00.000Z","attribution":"fallback"}\n';
  for (const other of [
    '{"type":"skill_invoked","skill":"claude-tweaks:build","ts":"2026-09-06T12:01:00.000Z"}\n',
    '{"type":"commit","ts":"2026-09-06T12:01:00.000Z","attribution":"session"}\n',
  ]) {
    const { a } = adoptionFor(CLAIM_ONLY, { 'events.jsonl': fallbackLine + other });
    assert.strictEqual(a.hasOtherContent, true, other);
  }
});

test('AC 2: dispatched call 1 (dispatched: true, no pr, no config) with Step 1.8 ledger line → case 2', () => {
  const fx = mainRoot();
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), CLAIM_AND_LEDGER);
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', dispatched: true }));
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, NO_SPEC) });
  assert.strictEqual(a.case, 2, `expected case 2, got case ${a.case}`);
  assert.deepStrictEqual(a.backfills, []);
  assert.strictEqual(a.note, ADOPTION_NOTES[2].replace('{path}', fs.realpathSync(fx.runDir)));
});

test('AC 3: dispatched call 1 with pr recorded → case 3 (repair path unchanged)', () => {
  const fx = mainRoot();
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), CLAIM_AND_LEDGER);
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', dispatched: true, pr: { number: 1, url: 'u', branch: 'b' } }));
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, NO_SPEC) });
  assert.strictEqual(a.case, 3, `expected case 3 with pr, got case ${a.case}`);
  // When pr is present, 'PR-early lifecycle' is NOT added to backfills; only 'materialize commit' is
  assert.deepStrictEqual(a.backfills, ['materialize commit']);
});

test('AC 4: same fixture without dispatched: true → case 3 with same backfills as today', () => {
  const fx = mainRoot();
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), CLAIM_AND_LEDGER);
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active' }));
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, NO_SPEC) });
  assert.strictEqual(a.case, 3, `expected case 3 without dispatched flag, got case ${a.case}`);
  // When worktree is present but no pr, we get PR-early lifecycle + materialize commit
  assert.deepStrictEqual(a.backfills, ['PR-early lifecycle', 'materialize commit']);
});

test('AC 5: unreadable or malformed run-state.json → case 3; a throwing readRunState propagates', () => {
  // Test 1: malformed JSON — defaultDeps.readRunState catches and returns null
  const fx1 = mainRoot();
  fs.writeFileSync(path.join(fx1.runDir, 'decisions.md'), CLAIM_AND_LEDGER);
  fs.writeFileSync(path.join(fx1.runDir, 'run-state.json'), '{not json');
  const a1 = computeAdoption({ runDir: fx1.runDir, mainRoot: fx1.root, cwd: fx1.root, deps: deps(fx1, NO_SPEC) });
  assert.strictEqual(a1.case, 3, 'malformed JSON (caught by readRunState) should fall through to case 3');
  assert.deepStrictEqual(a1.backfills, ['worktree registration', 'PR-early lifecycle', 'materialize commit']);

  // Test 2: readRunState throws — propagates to caller (gatherPreflight's wrapProbe catches it)
  const fx2 = mainRoot();
  fs.writeFileSync(path.join(fx2.runDir, 'decisions.md'), CLAIM_AND_LEDGER);
  fs.writeFileSync(path.join(fx2.runDir, 'run-state.json'), '{}');
  const d2 = deps(fx2, {
    ...NO_SPEC,
    readRunState: () => { throw new Error('read failed'); },
  });
  assert.throws(
    () => computeAdoption({ runDir: fx2.runDir, mainRoot: fx2.root, cwd: fx2.root, deps: d2 }),
    /read failed/,
    'throwing readRunState should propagate uncaught from computeAdoption',
  );
});

test('falsy-but-not-true dispatched value → case 3 (strict === true check)', () => {
  const fx = mainRoot();
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), CLAIM_AND_LEDGER);

  // Test with string "true"
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', dispatched: 'true' }));
  const a1 = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, NO_SPEC) });
  assert.strictEqual(a1.case, 3, 'string "true" should not match case 2');

  // Test with number 1
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', status: 'active', dispatched: 1 }));
  const a2 = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, NO_SPEC) });
  assert.strictEqual(a2.case, 3, 'number 1 should not match case 2');
});

// #3014: the pr probe reports mergeability so /flow can warn that CI will not
// run on a CONFLICTING run PR (GitHub suppresses workflow runs on a dirty one).
function ghView(extra) {
  return { state: 'OPEN', isDraft: false, body: PR_BODY, ...extra };
}

async function prPack(fx, view, overrides = {}, calls = null) {
  const base = deps(fx);
  const execFile = (cmd, args, opts) => {
    if (cmd !== 'gh') return base.execFile(cmd, args, opts);
    if (calls) calls.push({ cmd, args, opts });
    return JSON.stringify(view);
  };
  return gatherPreflight({ runDir: fx.runDir, steps: ['review'], cwd: fx.root, mainRoot: fx.root, deps: { ...base, execFile, ...overrides } });
}

// Policy resolver whose integration-branch entry is `entry`; every other key resolves to a default.
function policyWithIntegrationBranch(entry) {
  return { resolvePolicy: (keys) => Object.fromEntries(keys.map((k) => [k, k === 'integration-branch' ? entry : { value: 'x', source: 'default' }])) };
}

test('pr probe: a CONFLICTING PR carries mergeable, mergeStateStatus and the conflict note (#3014)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const calls = [];
  const pack = await prPack(fx, ghView({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), {}, calls);
  const ghCall = calls.find((c) => c.cmd === 'gh');
  assert.strictEqual(ghCall.args[ghCall.args.indexOf('--json') + 1], 'state,isDraft,body,mergeable,mergeStateStatus');
  assert.strictEqual(pack.pr.ok, true);
  assert.strictEqual(pack.pr.value.mergeable, 'CONFLICTING');
  assert.strictEqual(pack.pr.value.mergeStateStatus, 'DIRTY');
  assert.strictEqual(pack.pr.value.conflictNote, 'Run PR #1901 is CONFLICTING with main — CI will not run on it until the conflict is resolved.');
  assert.strictEqual(pack.pr.value.conflictNote, PR_CONFLICT_NOTE.replace('{n}', '1901').replace('{integration branch}', 'main'));
  // existing keys untouched
  assert.strictEqual(pack.pr.value.number, 1901);
  assert.strictEqual(pack.pr.value.branch, 'feat-branch');
  assert.strictEqual(pack.pr.value.state, 'OPEN');
  assert.strictEqual(pack.pr.value.isDraft, false);
  assert.strictEqual(pack.pr.value.checklist.length, 5);
});

test('pr probe: a gh response omitting both fields yields nulls and ok: true (#3014)', async () => {
  const fx = mainRoot();
  seedCase1(fx);
  const pack = await prPack(fx, { state: 'OPEN', isDraft: true, body: PR_BODY });
  assert.strictEqual(pack.pr.ok, true);
  assert.strictEqual(pack.pr.value.mergeable, null);
  assert.strictEqual(pack.pr.value.mergeStateStatus, null);
  assert.strictEqual(pack.pr.value.conflictNote, null);
});

test('pr probe: MERGEABLE, UNKNOWN, a non-string mergeable, DIRTY-with-MERGEABLE, and a non-OPEN PR still reading CONFLICTING all produce no conflict note (#3014)', async () => {
  for (const extra of [
    { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' },
    { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' },
    { mergeable: 7, mergeStateStatus: null },
    { mergeable: 'MERGEABLE', mergeStateStatus: 'DIRTY' },
    // pr-merge-state.js excludes non-OPEN PRs: a stale CONFLICTING/DIRTY on a
    // closed or merged PR is no signal for the run.
    { state: 'CLOSED', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' },
    { state: 'MERGED', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' },
  ]) {
    const fx = mainRoot();
    seedCase1(fx);
    const pack = await prPack(fx, ghView(extra));
    assert.strictEqual(pack.pr.ok, true, JSON.stringify(extra));
    assert.strictEqual(pack.pr.value.conflictNote, null, JSON.stringify(extra));
    if (typeof extra.mergeable !== 'string') assert.strictEqual(pack.pr.value.mergeable, null);
  }
});

test('pr probe: the conflict note names the resolved integration branch, falling back to main (#3014)', async () => {
  const conflicting = ghView({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
  const fx = mainRoot();
  seedCase1(fx);
  const develop = await prPack(fx, conflicting, policyWithIntegrationBranch({ value: 'develop', source: 'policy' }));
  assert.match(develop.pr.value.conflictNote, /with develop —/);
  const unresolved = await prPack(fx, conflicting, policyWithIntegrationBranch({ error: 'unknown-key' }));
  assert.match(unresolved.pr.value.conflictNote, /with main —/);
  const throwing = await prPack(fx, conflicting, { resolvePolicy: () => { throw new Error('policy exploded'); } });
  assert.strictEqual(throwing.pr.ok, true, 'a policy failure must not cost the PR fact');
  assert.match(throwing.pr.value.conflictNote, /with main —/);
});

test('pr probe: a branch name carrying String.replace patterns renders literally in the conflict note (#3014)', async () => {
  const conflicting = ghView({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
  const fx = mainRoot();
  seedCase1(fx);
  for (const branch of ['rel/$&-x', "rel/$'-x", 'rel/$`-x', 'rel/$1-x']) {
    const pack = await prPack(fx, conflicting, policyWithIntegrationBranch({ value: branch, source: 'policy' }));
    assert.strictEqual(pack.pr.value.conflictNote, `Run PR #1901 is CONFLICTING with ${branch} — CI will not run on it until the conflict is resolved.`, branch);
  }
});
