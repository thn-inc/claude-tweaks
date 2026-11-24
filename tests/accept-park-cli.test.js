'use strict';
// tests/accept-park-cli.test.js — bin/accept-park.js (#4615): decide, park and parked through
// the run(argv, deps) seam. gh, the node children (hooks.js, acceptance-packet.js), git and the
// claim release are in-memory fakes; the run dir is a real temp dir under a temp main-checkout
// root (a `.git` directory), so the anchoring check passes for real.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runCli } = require('./helpers/run-cli');
const { buildLine } = require('../plugin/bin/lib/station-events/emit');
const { renderPacket } = require('../plugin/bin/lib/wrap-up/packet-render');
const { parkStateOf } = require('../plugin/bin/lib/accept/park');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'accept-park.js');
const RUN_ID = '2026-11-16T10-00-00Z-accept-park';
const HEAD = 'abc1234def5678';
const BASE = '0123abcd'.repeat(5);
const ON = 'control-mode: on\n';
const DIFF_TIP = 'd'.repeat(40);
const MERGE_BASE = 'e'.repeat(40);
const GLOBS = 'risk-path-globs:\n  migrations: [migrations/**]\n';

const PACKET = renderPacket(
  { schemaVersion: 1, record: 7, partial: [], surface: null, allowedHosts: ['http://localhost:3000'], refused: [], facts: [
    { id: 'deploy:status', kind: 'deploy', status: 'passed', source: 'deploy', text: 'target: local', target: 'local', live: null },
  ] },
  { schemaVersion: 1, claims: [] },
).markdown;

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function packetComment(n, index = 1) {
  return {
    id: `IC_${n}_${index}`, url: `https://github.com/o/r/issues/${n}#issuecomment-${index}`, body: PACKET,
    authorAssociation: 'OWNER', createdAt: '2026-11-16T00:00:00Z',
  };
}

// The fake world: records (body, labels, comments), the node children, the worktree list and the
// claims. Every call is recorded; an unknown call shape throws, as real gh would refuse it.
function world({ policy, records = {}, worktrees, fail = {}, diff = 'M\0src/app.js\0', headMissing = 0 } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'accept-park-')));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, '.git'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  if (policy !== undefined) fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policy);
  const worktree = path.join(root, 'wt-7');
  const state = {
    root, runDir, worktree,
    records: Object.fromEntries(Object.entries(records).map(([n, r]) => [n, { body: '', labels: [], comments: [], ...r }])),
    edits: [],
    worktrees: worktrees ?? [root, worktree],
    claims: {},
    gh: [], spawn: [], git: [], release: [],
  };
  const record = (n) => {
    const r = state.records[n];
    if (!r) throw new Error(`HTTP 404: no issue ${n}`);
    return r;
  };
  // A string fails as gh and git do, its text on stderr; an Error is thrown as given.
  const failIf = (name) => {
    if (fail[name] instanceof Error) throw fail[name];
    if (fail[name] !== undefined) throw Object.assign(new Error(fail[name]), { stderr: `${fail[name]}\n`, status: 1 });
  };
  const gh = (args) => {
    state.gh.push(args);
    if (args[0] === 'api' && args[1] === 'graphql') {
      failIf('edit');
      const id = args.find((a) => a.startsWith('id=')).slice(3);
      const file = args.find((a) => a.startsWith('body=@')).slice(6);
      const comment = Object.values(state.records).flatMap((r) => r.comments).find((c) => c.id === id);
      comment.body = fs.readFileSync(file, 'utf8');
      return JSON.stringify({ data: { updateIssueComment: { issueComment: { id, url: comment.url } } } });
    }
    const at = args.indexOf('--repo');
    const call = at === -1 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
    const [noun, verb, n, flag, value] = call;
    if (noun === 'issue' && verb === 'view' && flag === '--json') {
      failIf(`view:${value}`);
      const r = record(n);
      const out = {};
      for (const field of value.split(',')) out[field] = field === 'labels' ? r.labels.map((name) => ({ name })) : r[field];
      return JSON.stringify(out);
    }
    if (noun === 'pr' && verb === 'view' && flag === '--json' && value === 'baseRefOid') {
      failIf('view:baseRefOid');
      return JSON.stringify({ baseRefOid: BASE });
    }
    if (noun === 'issue' && verb === 'edit' && flag === '--body-file') {
      failIf('bodyEdit');
      const r = record(n);
      r.body = fs.readFileSync(value, 'utf8');
      state.edits.push({ record: n, body: r.body });
      return '';
    }
    if (noun === 'issue' && verb === 'edit' && flag === '--add-label') {
      const r = record(n);
      if (!r.labels.includes(value)) r.labels.push(value);
      return '';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  const spawn = (script, args) => {
    const name = path.basename(script);
    state.spawn.push([name, ...args]);
    if (name === 'hooks.js' && args[0] === 'close-run') return { code: 0, stdout: '', stderr: '' };
    if (name === 'hooks.js' && args[0] === 'archive-run') {
      if (fail.archive) return { code: 0, stdout: `claude-tweaks: archive-run refused: ${fail.archive}\n`, stderr: '' };
      return { code: 0, stdout: `claude-tweaks: archived ${RUN_ID}\n`, stderr: '' };
    }
    if (name === 'acceptance-packet.js' && (args[0] === 'gather' || args[0] === 'render')) return { code: 0, stdout: '{}\n', stderr: '' };
    if (name === 'acceptance-packet.js' && args[0] === 'post') {
      failIf('post');
      const n = args[args.indexOf('--record') + 1];
      const r = record(n);
      r.comments.push(packetComment(n, r.comments.length + 1));
      const label = args[args.indexOf('--label') + 1];
      if (args.includes('--label') && !r.labels.includes(label)) r.labels.push(label);
      return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
    throw new Error(`unexpected spawn ${name} ${args.join(' ')}`);
  };
  const porcelain = () => state.worktrees.map((p) => `worktree ${p}\nHEAD ${'0'.repeat(40)}\nbranch refs/heads/x\n`).join('\n');
  let headMisses = headMissing;
  const git = (args) => {
    state.git.push(args);
    assert.deepEqual(args.slice(0, 2), ['-C', root]);
    const rest = args.slice(2);
    if (rest[0] === 'rev-parse' && rest[1] === '--verify') {
      if (headMisses > 0) {
        headMisses -= 1;
        throw new Error('');
      }
      return `${rest.at(-1).replace('^{commit}', '')}\n`;
    }
    if (rest[0] === 'fetch') {
      failIf(`fetch:${rest.at(-1)}`);
      return '';
    }
    if (rest.join(' ') === 'rev-parse --abbrev-ref origin/HEAD') return 'origin/main\n';
    if (rest[0] === 'merge-base') {
      failIf('mergeBase');
      return `${MERGE_BASE}\n`;
    }
    if (rest[0] === 'diff') {
      failIf('diff');
      return diff;
    }
    if (rest.join(' ') === 'worktree list --porcelain') return porcelain();
    if (rest[0] === 'worktree' && rest[1] === 'remove') {
      const target = rest.at(-1);
      if (!(rest[2] === '--force' && rest[3] === '--force')) throw new Error(`fatal: cannot remove a locked working tree, lock reason: drive.js record 7\nuse 'remove -f -f' to override or unlock first`);
      state.worktrees = state.worktrees.filter((p) => p !== target);
      return '';
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const releaseClaim = (opts) => {
    state.release.push(opts);
    const already = state.claims[opts.issueNumber] === 'released';
    state.claims[opts.issueNumber] = 'released';
    return {
      outcome: already ? 'already-released' : 'released', calls: [], commentPosted: true, labelsRemoved: [], labelsFailed: [], note: null,
      ...(already ? {} : { claimedAt: state.claimedAt || '2026-11-16T09:00:00.000Z' }),
    };
  };
  const deps = {
    mainRoot: root,
    gh,
    ghAvailable: () => true,
    pinGhHost: () => {},
    spawn,
    git,
    gitRunner: () => { throw new Error('gitRunner must not run in this test'); },
    releaseClaim,
    remoteUrl: () => 'https://github.com/o/r.git',
    tmpPath: (name) => path.join(root, name),
    now: () => Date.UTC(2026, 10, 16, 10, 0, 0),
    // #5902: realDeps carries the real emitter; undefined here is "no emission" unless a test records.
    stationEvent: undefined,
  };
  return { state, deps };
}

const call = (w, argv, extra = {}) => runCli(CLI, argv, { cwd: w.state.root, deps: { ...w.deps, ...extra } });
const parkArgv = (w, extra = []) => ['park', '--run', w.state.runDir, '--record', '7', '--pr', '12', '--head', HEAD, '--worktree', w.state.worktree, ...extra];
const issueViews = (w) => w.state.gh.filter((a) => a[0] === 'issue' && a[1] === 'view');
const decideArgv = (w, extra = [], records = '7') => ['decide', '--run', w.state.runDir, '--record', records, '--head', DIFF_TIP, ...extra];
// The old four-key decision shape: a decision without its tripwire field.
const withoutTripwire = ({ park, decisions }) => ({ park, decisions: decisions.map(({ tripwire, ...rest }) => rest) });
const gitCalls = (w, verb) => w.state.git.map((a) => a.slice(2)).filter((a) => a[0] === verb);

// ---- decide ----

test('AC2a.2: decide with control mode off reads no record', async () => {
  const w = world({ policy: 'acceptance-target: dev\n', records: { 7: { body: 'Risk-flags: auth\n' } } });
  const res = await call(w, ['decide', '--run', w.state.runDir, '--record', '7,8']);
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    park: false,
    decisions: [7, 8].map((record) => ({ record, consulted: false, park: false, target: null, reason: null })),
  });
  assert.equal(issueViews(w).length, 0);
  assert.equal(res.stdout.split('\n').filter(Boolean).length, 1);
});

test('AC2a.2: decide with no policy file at all reads no record', async () => {
  const w = world({ records: { 7: {} } });
  const res = await call(w, ['decide', '--run', w.state.runDir, '--record', '7'], { ghAvailable: () => { throw new Error('probed gh'); } });
  assert.equal(res.code, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).decisions[0].consulted, false);
  assert.equal(w.state.gh.length, 0);
});

test('decide parks a control-mode record with no flags and no override', async () => {
  const on = world({ policy: 'control-mode: on\n', records: { 7: { body: 'Plain body.\n' } } });
  const res = await call(on, decideArgv(on));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(withoutTripwire(JSON.parse(res.stdout)), { park: true, decisions: [{ record: 7, consulted: true, park: true, target: 'local', reason: 'default' }] });

  const dev = world({ policy: 'control-mode: on\nacceptance-target: dev\n', records: { 7: { body: 'Plain body.\n' } } });
  const devRes = await call(dev, decideArgv(dev));
  assert.equal(devRes.code, 0, devRes.stderr);
  assert.deepEqual(withoutTripwire(JSON.parse(devRes.stdout)), { park: false, decisions: [{ record: 7, consulted: true, park: false, target: 'dev', reason: 'policy' }] });
});

test('decide reads the override and the risk-flag lines from the record body', async () => {
  const policy = 'control-mode: on\nacceptance-target: dev\n';
  const w = world({ policy, records: {
    1: { body: 'Risk-flags: auth\n\n## Current State\n' },
    2: { body: 'Acceptance-target: local\n\n## Current State\n' },
    3: { body: 'Risk-flags: autth\n\n## Current State\n' },
    4: { body: 'Nothing here.\n' },
  } });
  const res = await call(w, decideArgv(w, [], '1,2,3,4'));
  assert.equal(res.code, 0, res.stderr);
  const { park, decisions } = JSON.parse(res.stdout);
  assert.equal(park, true);
  assert.deepEqual(decisions.map(({ record, park: p, target, reason }) => ({ record, park: p, target, reason })), [
    { record: 1, park: true, target: 'local', reason: 'risk-flag' },
    { record: 2, park: true, target: 'local', reason: 'item-override' },
    { record: 3, park: true, target: 'local', reason: 'risk-flag' },
    { record: 4, park: false, target: 'dev', reason: 'policy' },
  ]);
});

test('decide: an invalid acceptance-target value fails closed to local', async () => {
  const w = world({ policy: 'control-mode: on\nacceptance-target: staging\n', records: { 7: { body: '' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(withoutTripwire(JSON.parse(res.stdout)).decisions[0], { record: 7, consulted: true, park: true, target: 'local', reason: 'invalid-input' });
});

test('decide: a record that will not read exits 1 and its decision fails closed', async () => {
  const w = world({ policy: 'control-mode: on\nacceptance-target: dev\n', records: { 7: { body: '' } } });
  const res = await call(w, ['decide', '--run', w.state.runDir, '--record', '7,9']);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /#9/);
  const { decisions } = JSON.parse(res.stdout);
  assert.deepEqual(decisions[1], { record: 9, consulted: true, park: true, target: 'local', reason: 'invalid-input' });
});

test('decide: an unreadable policy file exits 1 with nothing printed', async () => {
  const w = world({ records: { 7: {} } });
  fs.mkdirSync(path.join(w.state.root, '.claude-tweaks', 'policy.yml'));
  const res = await call(w, ['decide', '--run', w.state.runDir, '--record', '7']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /policy\.yml/);
});

test('I1: decide without --run reads the repo-root policy.yml alone', async () => {
  const off = world({ policy: 'acceptance-target: dev\n', records: { 7: { body: 'Risk-flags: auth\n' } } });
  fs.writeFileSync(path.join(off.state.runDir, 'config.yml'), 'control-mode: on\n');
  const offRes = await call(off, ['decide', '--record', '7'], { ghAvailable: () => { throw new Error('probed gh'); } });
  assert.equal(offRes.code, 0, offRes.stderr);
  assert.deepEqual(JSON.parse(offRes.stdout), { park: false, decisions: [{ record: 7, consulted: false, park: false, target: null, reason: null }] });
  assert.equal(off.state.gh.length, 0, 'control mode off reads no record');

  const on = world({ policy: 'control-mode: on\n', records: { 7: { body: 'Plain body.\n' } } });
  const onRes = await call(on, ['decide', '--record', '7', '--head', DIFF_TIP]);
  assert.equal(onRes.code, 0, onRes.stderr);
  assert.deepEqual(withoutTripwire(JSON.parse(onRes.stdout)), { park: true, decisions: [{ record: 7, consulted: true, park: true, target: 'local', reason: 'default' }] });
});

test('decide: a --run outside the main checkout is refused with exit 3', async () => {
  const w = world({ policy: 'control-mode: on\n', records: { 7: {} } });
  const shadow = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'accept-park-shadow-')));
  tempDirs.push(shadow);
  fs.writeFileSync(path.join(shadow, '.git'), 'gitdir: /elsewhere\n');
  const res = await call(w, ['decide', '--run', shadow, '--record', '7']);
  assert.equal(res.code, 3);
  assert.equal(res.stdout, '');
  assert.equal(w.state.gh.length, 0);
});

test('#5830: decide, park and parked refuse a --run outside .claude-tweaks/pipelines with exit 3', async () => {
  const w = world({ policy: 'control-mode: on\n', records: { 7: {} } });
  const stray = path.join(w.state.root, 'plugin');
  fs.mkdirSync(stray, { recursive: true });
  // A config.yml the run's own agent could write must never be read from a directory that is no run.
  fs.writeFileSync(path.join(stray, 'config.yml'), 'control-mode: off\n');
  for (const argv of [
    ['decide', '--run', stray, '--record', '7'],
    ['park', '--run', stray, '--record', '7', '--pr', '12', '--head', HEAD, '--worktree', w.state.worktree],
    ['parked', '--record', '7', '--run', stray],
  ]) {
    const res = await call(w, argv);
    assert.equal(res.code, 3, `${argv[0]}: ${res.stderr}`);
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /not a pipeline run directory/);
  }
  assert.equal(w.state.gh.length, 0);
});

// ---- decide: the diff tripwire (#4619) ----

const TRIPWIRE_POLICY = `control-mode: on\nacceptance-target: dev\n${GLOBS}`;
const MIGRATION_DIFF = 'A\0migrations/001_add_users.sql\0';
const tripwireOf = (res, index = 0) => JSON.parse(res.stdout).decisions[index];

test('AC1.1: decide appends migrations, writes the tripwire line and parks', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n\n## Current State\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.equal(w.state.gh.filter((a) => a[0] === 'issue' && a[1] === 'edit').length, 1);
  assert.equal(w.state.edits.length, 1);
  assert.match(w.state.edits[0].body, /^Risk-flags: migrations$/m);
  assert.match(w.state.edits[0].body, /^Risk-flags-added-by-tripwire: migrations$/m);
  const decision = tripwireOf(res);
  assert.equal(decision.park, true);
  assert.equal(decision.target, 'local');
  assert.equal(decision.reason, 'risk-flag');
  assert.deepEqual(decision.tripwire.newFlags, ['migrations']);
  assert.equal(decision.tripwire.appendFailed, false);
  assert.match(decision.tripwire.lines[0], /^tripwire: the diff crosses migrations \(migrations\/\*\*: migrations\/001_add_users\.sql\)/);
});

test('AC2.1: a declared crossing writes nothing', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: migrations\n\n## Current State\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.equal(w.state.gh.filter((a) => a[0] === 'issue' && a[1] === 'edit').length, 0);
  assert.deepEqual(tripwireOf(res).tripwire.newFlags, []);
  assert.equal(tripwireOf(res).reason, 'risk-flag');
});

test('AC7.1: no --head under control mode is could-not-run and parks', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, ['decide', '--run', w.state.runDir, '--record', '7']);
  assert.equal(res.code, 0, res.stderr);
  const decision = tripwireOf(res);
  assert.equal(decision.park, true);
  assert.equal(decision.reason, 'tripwire');
  assert.deepEqual(decision.tripwire.lines, ['tripwire could not run: no --head given']);
  assert.equal(w.state.git.length, 0);
});

test('AC7.1: a malformed risk-path-globs block is could-not-run', async () => {
  const w = world({ policy: 'control-mode: on\nacceptance-target: dev\nrisk-path-globs:\n  migrations: x\n', records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  const decision = tripwireOf(res);
  assert.equal(decision.tripwire.status, 'could-not-run');
  assert.equal(decision.reason, 'tripwire');
  assert.match(decision.tripwire.lines[0], /^tripwire could not run: risk-path-globs is not a map/);
});

test('AC7.1: a head missing after one fetch is could-not-run', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, headMissing: Infinity, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(gitCalls(w, 'fetch'), [['fetch', '--no-tags', 'origin', DIFF_TIP]]);
  const decision = tripwireOf(res);
  assert.equal(decision.reason, 'tripwire');
  assert.match(decision.tripwire.lines[0], /not available locally/);
  assert.equal(gitCalls(w, 'diff').length, 0);
});

test('a head present after the fetch runs the diff', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, headMissing: 1, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w, ['--base', 'origin/main']));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(gitCalls(w, 'fetch'), [['fetch', '--no-tags', 'origin', DIFF_TIP]]);
  assert.equal(gitCalls(w, 'diff').length, 1);
  assert.deepEqual(tripwireOf(res).tripwire.newFlags, ['migrations']);
});

test('AC7.2: absent risk-path-globs with acceptance-target dev resolves dev', async () => {
  const w = world({ policy: 'control-mode: on\nacceptance-target: dev\n', records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  const decision = tripwireOf(res);
  assert.equal(decision.park, false);
  assert.equal(decision.target, 'dev');
  assert.deepEqual(decision.tripwire.lines, ['tripwire: path globs not configured', 'tripwire: agent classification not run']);
});

test('AC7.6: a failed flag append still parks local and reports it', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, fail: { bodyEdit: 'HTTP 502' }, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stderr, /could not write the tripwire flags to #7 \(HTTP 502\)/);
  const decision = tripwireOf(res);
  assert.equal(decision.park, true);
  assert.equal(decision.tripwire.appendFailed, true);
  assert.ok(decision.tripwire.lines.includes('tripwire: the flag write failed (HTTP 502), so this run is local'), decision.tripwire.lines.join('\n'));
  assert.equal(fs.readdirSync(w.state.root).some((name) => name.includes('tripwire')), false, 'the temp body file is removed');
});

// Only the tripwire's own re-read asks for the body alone; the first read asks for more fields.
const rereadAs = (w, reread) => ({
  gh: (args) => {
    if (args[0] === 'issue' && args[1] === 'view' && args[4] === 'body') return reread(args);
    return w.deps.gh(args);
  },
});

test('a body re-read that fails names its reason, parks local and edits nothing', async () => {
  const cases = [
    ['issue view returned no body', () => '{}'],
    ['issue view returned no body', () => 'null'],
    ['issue view output unparseable', () => 'not json'],
    ['issue view output unparseable', () => ''],
    ['HTTP 502', () => { throw Object.assign(new Error(`Command failed: gh /secret/path`), { stderr: 'HTTP 502\n', status: 1 }); }],
  ];
  for (const [reason, reread] of cases) {
    const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n' } } });
    const res = await call(w, decideArgv(w), rereadAs(w, reread));
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stderr.includes(`could not write the tripwire flags to #7 (${reason})`), res.stderr);
    const decision = tripwireOf(res);
    assert.equal(decision.park, true);
    assert.equal(decision.tripwire.appendFailed, true);
    assert.ok(decision.tripwire.lines.includes(`tripwire: the flag write failed (${reason}), so this run is local`), decision.tripwire.lines.join('\n'));
    assert.equal(w.state.gh.some((a) => a[0] === 'issue' && a[1] === 'edit'), false, 'no edit after a failed re-read');
    assert.equal(res.stdout.includes('unknown error'), false);
  }
});

test('a body that gained the flags since the first read makes no gh issue edit call', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n' } } });
  let rereads = 0;
  const flagged = 'Risk-flags: migrations\nRisk-flags-added-by-tripwire: migrations\n\n## Current State\n';
  const res = await call(w, decideArgv(w), rereadAs(w, () => { rereads += 1; return JSON.stringify({ body: flagged }); }));
  assert.equal(res.code, 0, res.stderr);
  assert.equal(rereads, 1, 'the re-read ran');
  assert.equal(w.state.gh.some((a) => a[0] === 'issue' && a[1] === 'edit'), false);
  assert.ok(!tripwireOf(res).tripwire.appendFailed);
});

test('a CRLF stderr keeps no carriage return in the stderr line or the packet line', async () => {
  const stderr = 'HTTP 502\r\nhint: more\r\n';
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, fail: { bodyEdit: Object.assign(new Error('x'), { stderr, status: 1 }) }, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.ok(res.stderr.includes('(HTTP 502) — this run is local'), JSON.stringify(res.stderr));
  assert.ok(tripwireOf(res).tripwire.lines.includes('tripwire: the flag write failed (HTTP 502), so this run is local'), tripwireOf(res).tripwire.lines.join('\n'));
  assert.equal(res.stderr.includes('\r') || res.stdout.includes('\r'), false);
});

test('an absolute path in git stderr or a plain Error never reaches the packet line', async () => {
  const lock = "fatal: Unable to create '/Users/me/Code Workspaces/repo/.git/refs/remotes/origin/main.lock': File exists.";
  const failing = world({ policy: TRIPWIRE_POLICY, fail: { 'fetch:main': lock }, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(failing, decideArgv(failing));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(tripwireOf(res).tripwire.lines, ['tripwire could not run: git fetch of main failed: fatal: Unable to create \\<path\\>: File exists.']);
  assert.equal(JSON.stringify(res).includes('/Users/me'), false);

  const plain = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, fail: { bodyEdit: new Error('assertSlugs: not a slug at /Users/me/repo/x.js') }, records: { 7: { body: 'Risk-flags: none\n' } } });
  const plainRes = await call(plain, decideArgv(plain));
  assert.equal(plainRes.code, 0, plainRes.stderr);
  assert.ok(tripwireOf(plainRes).tripwire.lines.includes('tripwire: the flag write failed (assertSlugs: not a slug at \\<path\\>), so this run is local'), tripwireOf(plainRes).tripwire.lines.join('\n'));
  assert.equal(JSON.stringify(plainRes).includes('/Users/me'), false);
});

test('AC3.1: --classification auth adds auth via agent', async () => {
  const w = world({ policy: 'control-mode: on\nacceptance-target: dev\n', records: { 7: { body: 'Risk-flags: none\n' } } });
  const file = path.join(w.state.root, 'classification.json');
  fs.writeFileSync(file, JSON.stringify([{ category: 'auth', evidence: 'login handler changed' }]));
  const res = await call(w, decideArgv(w, ['--classification', file]));
  assert.equal(res.code, 0, res.stderr);
  const decision = tripwireOf(res);
  assert.deepEqual(decision.tripwire.newFlags, ['auth']);
  assert.deepEqual(decision.tripwire.crossed, [{ category: 'auth', via: 'agent', evidence: 'login handler changed' }]);
  assert.equal(decision.park, true);
  assert.match(w.state.edits[0].body, /^Risk-flags-added-by-tripwire: auth$/m);
});

test('--classification that will not read or parse is a malformed classification', async () => {
  const w = world({ policy: 'control-mode: on\nacceptance-target: dev\n', records: { 7: { body: 'Risk-flags: none\n' } } });
  const bad = path.join(w.state.root, 'bad.json');
  fs.writeFileSync(bad, '{not json');
  for (const file of [bad, path.join(w.state.root, 'absent.json')]) {
    const res = await call(w, decideArgv(w, ['--classification', file]));
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(tripwireOf(res).tripwire.lines, ['tripwire could not run: agent classification malformed']);
    assert.equal(tripwireOf(res).reason, 'tripwire');
  }
});

test('AC9.1: a trusted removal comment names the removal', async () => {
  const comment = (authorAssociation) => ({ body: 'Risk flag migrations removed by the maintainer during shaping', authorAssociation });
  const trusted = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n', comments: [comment('OWNER')] } } });
  const res = await call(trusted, decideArgv(trusted));
  assert.equal(res.code, 0, res.stderr);
  assert.ok(tripwireOf(res).tripwire.lines.some((line) => line.includes('you removed the migrations flag at intent')), tripwireOf(res).tripwire.lines.join('\n'));

  const untrusted = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n', comments: [comment('NONE')] } } });
  const other = await call(untrusted, decideArgv(untrusted));
  assert.equal(other.code, 0, other.stderr);
  assert.equal(tripwireOf(other).tripwire.lines.some((line) => line.includes('you removed')), false);
  assert.deepEqual(tripwireOf(other).tripwire.newFlags, ['migrations']);
});

test('two records share one diff', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: {
    1: { body: 'Risk-flags: migrations\n' },
    2: { body: 'Risk-flags: none\n' },
  } });
  const res = await call(w, decideArgv(w, [], '1,2'));
  assert.equal(res.code, 0, res.stderr);
  assert.equal(gitCalls(w, 'merge-base').length, 1);
  assert.equal(gitCalls(w, 'diff').length, 1);
  assert.deepEqual(tripwireOf(res, 0).tripwire.newFlags, []);
  assert.deepEqual(tripwireOf(res, 1).tripwire.newFlags, ['migrations']);
  assert.deepEqual(w.state.edits.map((edit) => edit.record), ['2']);
});

test('#5830: control mode on in config.yml only never reads the globs', async () => {
  const w = world({ policy: `acceptance-target: dev\n${GLOBS}`, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n' } } });
  fs.writeFileSync(path.join(w.state.runDir, 'config.yml'), 'control-mode: on\n');
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(withoutTripwire(JSON.parse(res.stdout)), { park: false, decisions: [{ record: 7, consulted: false, park: false, target: null, reason: null }] });
  assert.equal(w.state.gh.length, 0, 'control mode stays off: no record read');
  assert.equal(w.state.edits.length, 0);
});

test('a policy risk-categories extra is a category the tripwire can cross', async () => {
  const policy = 'control-mode: on\nacceptance-target: dev\nrisk-categories: payments\nrisk-path-globs:\n  payments: [payments/**]\n';
  const w = world({ policy, diff: 'M\0payments/charge.js\0', records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(tripwireOf(res).tripwire.newFlags, ['payments']);
  assert.match(w.state.edits[0].body, /^Risk-flags: payments$/m);
});

test('a derived base is fetched before merge-base', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  const argvs = w.state.git.map((a) => a.slice(2));
  const fetchAt = argvs.findIndex((a) => a.join(' ') === 'fetch --no-tags origin main');
  const mergeBaseAt = argvs.findIndex((a) => a[0] === 'merge-base');
  assert.ok(fetchAt !== -1 && fetchAt < mergeBaseAt, JSON.stringify(argvs));
  assert.deepEqual(argvs[mergeBaseAt], ['merge-base', '--end-of-options', 'origin/main', DIFF_TIP]);
});

test('integration-branch names the derived base', async () => {
  const w = world({ policy: `${TRIPWIRE_POLICY}integration-branch: develop\n`, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(gitCalls(w, 'fetch'), [['fetch', '--no-tags', 'origin', 'develop']]);
  assert.deepEqual(gitCalls(w, 'merge-base')[0], ['merge-base', '--end-of-options', 'origin/develop', DIFF_TIP]);
  assert.equal(gitCalls(w, 'rev-parse').some((a) => a.includes('--abbrev-ref')), false);
});

test('a failing base fetch is could-not-run; --base given makes no base fetch', async () => {
  const failing = world({ policy: TRIPWIRE_POLICY, fail: { 'fetch:main': 'fatal: unable to access origin\nsecond line' }, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(failing, decideArgv(failing));
  assert.equal(res.code, 0, res.stderr);
  assert.equal(tripwireOf(res).reason, 'tripwire');
  assert.deepEqual(tripwireOf(res).tripwire.lines, ['tripwire could not run: git fetch of main failed: fatal: unable to access origin']);
  assert.equal(gitCalls(failing, 'merge-base').length, 0);

  const given = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const ok = await call(given, decideArgv(given, ['--base', 'origin/main']));
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(gitCalls(given, 'fetch').length, 0);
  assert.equal(gitCalls(given, 'rev-parse').some((a) => a.includes('--abbrev-ref')), false);
});

test('a failed merge-base or diff names the step', async () => {
  const mb = world({ policy: TRIPWIRE_POLICY, fail: { mergeBase: 'fatal: no merge base' }, records: { 7: { body: 'Risk-flags: none\n' } } });
  const mbRes = await call(mb, decideArgv(mb));
  assert.deepEqual(tripwireOf(mbRes).tripwire.lines, ['tripwire could not run: git merge-base failed: fatal: no merge base']);
  const df = world({ policy: TRIPWIRE_POLICY, fail: { diff: 'fatal: bad object' }, records: { 7: { body: 'Risk-flags: none\n' } } });
  const dfRes = await call(df, decideArgv(df));
  assert.deepEqual(tripwireOf(dfRes).tripwire.lines, ['tripwire could not run: git diff failed: fatal: bad object']);
  const un = world({ policy: TRIPWIRE_POLICY, diff: 'Z\0x\0', records: { 7: { body: 'Risk-flags: none\n' } } });
  const unRes = await call(un, decideArgv(un));
  assert.deepEqual(tripwireOf(unRes).tripwire.lines, ['tripwire could not run: git diff output unparseable']);
  assert.equal(tripwireOf(unRes).reason, 'tripwire');
});

test('a failed packet-facts write exits 1 with the decision printed', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  fs.writeFileSync(path.join(w.state.runDir, 'packet-facts'), 'not a directory');
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 1);
  assert.equal(res.stdout.split('\n').filter(Boolean).length, 1);
  assert.equal(JSON.parse(res.stdout).decisions.length, 1);
  assert.match(res.stderr, /tripwire-7\.json/);
});

test('a re-run after an earlier append still states the crossing', async () => {
  const body = 'Risk-flags: migrations\nRisk-flags-added-by-tripwire: migrations\n\n## Current State\n';
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.equal(w.state.gh.filter((a) => a[0] === 'issue' && a[1] === 'edit').length, 0);
  assert.ok(tripwireOf(res).tripwire.lines.some((line) => line.startsWith('tripwire: the diff crosses migrations')), tripwireOf(res).tripwire.lines.join('\n'));
});

test('a flag append and then a re-run through the same body writes once', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n' } } });
  assert.equal((await call(w, decideArgv(w))).code, 0);
  const second = await call(w, decideArgv(w));
  assert.equal(second.code, 0, second.stderr);
  assert.equal(w.state.edits.length, 1);
  assert.ok(tripwireOf(second).tripwire.lines.some((line) => line.startsWith('tripwire: the diff crosses migrations')));
});

test('--run writes packet-facts/tripwire-{n}.json', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n' }, 8: { body: 'Risk-flags: migrations\n' } } });
  const res = await call(w, decideArgv(w, [], '7,8'));
  assert.equal(res.code, 0, res.stderr);
  for (const n of [7, 8]) {
    const written = JSON.parse(fs.readFileSync(path.join(w.state.runDir, 'packet-facts', `tripwire-${n}.json`), 'utf8'));
    assert.deepEqual(written, { record: n, lines: tripwireOf(res, n - 7).tripwire.lines });
  }
});

test('no packet-facts file for an unread record or without --run', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, ['decide', '--run', w.state.runDir, '--record', '7,9', '--head', DIFF_TIP]);
  assert.equal(res.code, 1);
  assert.equal(fs.existsSync(path.join(w.state.runDir, 'packet-facts', 'tripwire-7.json')), true);
  assert.equal(fs.existsSync(path.join(w.state.runDir, 'packet-facts', 'tripwire-9.json')), false);
  assert.equal(Object.hasOwn(JSON.parse(res.stdout).decisions[1], 'tripwire'), false);

  const bare = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const bareRes = await call(bare, ['decide', '--record', '7', '--head', DIFF_TIP]);
  assert.equal(bareRes.code, 0, bareRes.stderr);
  assert.equal(fs.existsSync(path.join(bare.state.runDir, 'packet-facts')), false);
});

test('the git argv carries --end-of-options and -z', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w, ['--base', 'origin/main']));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(gitCalls(w, 'rev-parse'), [['rev-parse', '--verify', '--quiet', '--end-of-options', `${DIFF_TIP}^{commit}`]]);
  assert.deepEqual(gitCalls(w, 'merge-base'), [['merge-base', '--end-of-options', 'origin/main', DIFF_TIP]]);
  assert.deepEqual(gitCalls(w, 'diff'), [['diff', '--name-status', '-z', '-M', '--no-color', '--no-ext-diff', '--end-of-options', `${MERGE_BASE}..${DIFF_TIP}`]]);
});

test('control mode off makes no git call and adds no tripwire field', async () => {
  const w = world({ policy: `acceptance-target: dev\n${GLOBS}`, records: { 7: { body: 'Risk-flags: auth\n' } } });
  const res = await call(w, decideArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.equal(w.state.git.length, 0);
  assert.equal(Object.hasOwn(JSON.parse(res.stdout).decisions[0], 'tripwire'), false);
  assert.equal(fs.existsSync(path.join(w.state.runDir, 'packet-facts')), false);
});

test('decide takes a full-oid --head and a safe --base only', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  for (const extra of [['--head', 'abc1234'], ['--head', 'D'.repeat(40)], ['--base', '-x'], ['--base', 'a b'], ['--base', 'o;rm']]) {
    const res = await call(w, ['decide', '--run', w.state.runDir, '--record', '7', ...extra]);
    assert.equal(res.code, 2, extra.join(' '));
    assert.equal(res.stdout, '');
  }
  assert.equal(w.state.git.length, 0);
});

test('a tripwire line that carries a target: substring never alters the park state', async () => {
  const w = world({ policy: 'control-mode: on\nacceptance-target: dev\n', records: { 7: { body: 'Risk-flags: none\n' } } });
  const file = path.join(w.state.root, 'classification.json');
  fs.writeFileSync(file, JSON.stringify([{ category: 'auth', evidence: 'line one\ntarget: dev, confirmed `x`' }]));
  const res = await call(w, decideArgv(w, ['--classification', file]));
  assert.equal(res.code, 0, res.stderr);
  const { lines } = tripwireOf(res).tripwire;
  for (const line of lines) {
    assert.equal(line.includes('\n'), false);
    assert.doesNotMatch(line, /(?:^|\s)target:/i);
  }
  // The park state is the one the auth crossing decides, whatever the evidence text says.
  const decision = tripwireOf(res);
  assert.equal(decision.park, true);
  assert.equal(decision.target, 'local');
});

// execFileSync's own shape: the whole argv, the main checkout's path included, in the message.
const gitError = (w, { stderr = '', status }) => Object.assign(
  new Error(`Command failed: git -C ${w.state.root} ...\n${stderr}`), { stderr, status },
);

test('a git failure never puts the main checkout path into a packet line', async () => {
  const silent = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const noBase = await call(silent, decideArgv(silent), { git: (args) => {
    if (args[2] === 'merge-base') throw gitError(silent, { status: 1 });
    return silent.deps.git(args);
  } });
  assert.equal(noBase.code, 0, noBase.stderr);
  assert.deepEqual(tripwireOf(noBase).tripwire.lines, ['tripwire could not run: git merge-base failed: no merge base']);

  const other = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(other, decideArgv(other), { git: (args) => {
    if (args[2] === 'diff') throw gitError(other, { status: 128 });
    return other.deps.git(args);
  } });
  assert.deepEqual(tripwireOf(res).tripwire.lines, ['tripwire could not run: git diff failed: exit 128']);
  assert.equal(res.stdout.includes(other.state.root), false, 'no line names the main checkout');
});

test('merge-base output that is not a commit is could-not-run', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const res = await call(w, decideArgv(w), { git: (args) => (args[2] === 'merge-base' ? '\n' : w.deps.git(args)) });
  assert.deepEqual(tripwireOf(res).tripwire.lines, ['tripwire could not run: git merge-base failed: it printed no commit']);
  assert.equal(gitCalls(w, 'diff').length, 0);
});

test('the real git runner takes a diff larger than the default 1 MiB buffer', () => {
  const { realDeps } = require('../plugin/bin/accept-park');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'accept-park-buffer-')));
  tempDirs.push(dir);
  const file = path.join(dir, 'big.txt');
  fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024));
  realDeps.git(['init', '-q', dir], { cwd: dir });
  const oid = realDeps.git(['-C', dir, 'hash-object', '-w', '--end-of-options', file], { cwd: dir }).trim();
  assert.equal(realDeps.git(['-C', dir, 'cat-file', 'blob', oid], { cwd: dir }).length, 2 * 1024 * 1024);
});

test('a fetch that hits a sibling\'s ref lock is retried once, after a pause', async () => {
  const lock = (w) => gitError(w, { stderr: "error: cannot lock ref 'refs/remotes/origin/main': is at a but expected b\n", status: 1 });
  const once = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n' } } });
  let locked = 1;
  const pauses = [];
  const res = await call(once, decideArgv(once), { sleep: (ms) => pauses.push(ms), git: (args) => {
    if (args[2] === 'fetch' && locked-- > 0) {
      once.state.git.push(args);
      throw lock(once);
    }
    return once.deps.git(args);
  } });
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(gitCalls(once, 'fetch'), [['fetch', '--no-tags', 'origin', 'main'], ['fetch', '--no-tags', 'origin', 'main']]);
  assert.deepEqual(pauses, [1000]);
  assert.deepEqual(tripwireOf(res).tripwire.newFlags, ['migrations']);

  const twice = world({ policy: TRIPWIRE_POLICY, records: { 7: { body: 'Risk-flags: none\n' } } });
  const stuck = await call(twice, decideArgv(twice), { sleep: () => {}, git: (args) => {
    if (args[2] === 'fetch') {
      twice.state.git.push(args);
      throw lock(twice);
    }
    return twice.deps.git(args);
  } });
  assert.equal(gitCalls(twice, 'fetch').length, 2, 'one retry, no more');
  assert.match(tripwireOf(stuck).tripwire.lines[0], /^tripwire could not run: git fetch of main failed: error: cannot lock ref/);

  const plain = world({ policy: TRIPWIRE_POLICY, fail: { 'fetch:main': 'fatal: unable to access origin' }, records: { 7: { body: 'Risk-flags: none\n' } } });
  await call(plain, decideArgv(plain), { sleep: () => assert.fail('a non-lock failure is not retried') });
  assert.equal(gitCalls(plain, 'fetch').length, 1);
});

test('the diff is read before any record body, and the edit goes onto the body as it reads right before it', async () => {
  const w = world({ policy: TRIPWIRE_POLICY, diff: MIGRATION_DIFF, records: { 7: { body: 'Risk-flags: none\n\n## Current State\n' } } });
  const order = [];
  const res = await call(w, decideArgv(w), {
    git: (args) => { order.push('git'); return w.deps.git(args); },
    gh: (args) => {
      if (args[0] === 'issue' && args[1] === 'view') order.push('view');
      // A concurrent edit lands between the first read and the tripwire's edit.
      if (args[1] === 'view' && args[4] === 'body') w.state.records[7].body = 'Risk-flags: auth\nAcceptance-target: local\n\n## Current State\n';
      return w.deps.gh(args);
    },
  });
  assert.equal(res.code, 0, res.stderr);
  assert.ok(order.indexOf('view') > order.lastIndexOf('git'), order.join(','));
  assert.equal(w.state.edits.length, 1);
  assert.equal(w.state.edits[0].body, 'Risk-flags: migrations, auth\nRisk-flags-added-by-tripwire: migrations\nAcceptance-target: local\n\n## Current State\n');
});

test('a JSON null classification file is unreadable and forces local', async () => {
  const w = world({ policy: 'control-mode: on\nacceptance-target: dev\n', records: { 7: { body: 'Risk-flags: none\n' } } });
  const file = path.join(w.state.root, 'null.json');
  fs.writeFileSync(file, 'null');
  const res = await call(w, decideArgv(w, ['--classification', file]));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(tripwireOf(res).tripwire.lines, ['tripwire could not run: agent classification malformed']);
  assert.equal(tripwireOf(res).target, 'local');
  assert.equal(tripwireOf(res).reason, 'tripwire');
});

// ---- park ----

test('AC3.3: park leaves the PR open, applies accept:pending, writes the packet, archives, releases, removes the worktree', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 0, res.stderr);
  const result = JSON.parse(res.stdout);
  assert.equal(result.outcome, 'parked');
  assert.equal(result.reason, 'awaiting-local-acceptance');
  assert.deepEqual(result.steps.map((s) => s.ok), [true, true, true, true, true]);
  assert.equal(w.state.gh.some((a) => a[0] === 'pr' && (a[1] === 'merge' || a[1] === 'close')), false);
  assert.ok(w.state.gh.some((a) => a.join(' ').startsWith('issue edit 7 --add-label accept:pending')));
  const edits = w.state.gh.filter((a) => a[0] === 'api' && a[1] === 'graphql');
  assert.equal(edits.length, 1);
  const state = parkStateOf(w.state.records[7].comments[0].body);
  assert.deepEqual(state, { parked: true, target: 'local', reason: 'awaiting-local-acceptance', headSha: HEAD, baseSha: BASE });
  assert.deepEqual(w.state.gh.filter((a) => a[0] === 'pr'), [['pr', 'view', '12', '--json', 'baseRefOid']], 'the base is read once');
  assert.deepEqual(w.state.spawn.filter(([name]) => name === 'hooks.js'), [
    ['hooks.js', 'close-run', '--run', w.state.runDir],
    ['hooks.js', 'archive-run', '--run', w.state.runDir],
  ]);
  assert.equal(w.state.release.length, 1);
  assert.deepEqual(
    (({ issueNumber, runId, reason, link, owner, repo }) => ({ issueNumber, runId, reason, link, owner, repo }))(w.state.release[0]),
    { issueNumber: 7, runId: RUN_ID, reason: 'awaiting-local-acceptance', link: 'https://github.com/o/r/pull/12', owner: 'o', repo: 'r' },
  );
  const removes = w.state.git.filter((a) => a[2] === 'worktree' && a[3] === 'remove');
  assert.equal(removes.length, 1);
  assert.equal(removes[0].at(-1), w.state.worktree);
  const log = fs.readFileSync(path.join(w.state.runDir, 'decisions.md'), 'utf8');
  assert.match(log, new RegExp(`- AUTO \\d{2}:\\d{2}:\\d{2} — accept-park\\.js park: park: target local \\(awaiting-local-acceptance\\), head ${HEAD}; archiving run, releasing claim, removing worktree\\.`));
});

test('AC3.3: the decisions.md line lands before the run is closed and archived', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  let logBeforeClose = null;
  const spawn = (script, args) => {
    if (args[0] === 'close-run') logBeforeClose = fs.readFileSync(path.join(w.state.runDir, 'decisions.md'), 'utf8');
    return w.deps.spawn(script, args);
  };
  const res = await call(w, parkArgv(w), { spawn });
  assert.equal(res.code, 0, res.stderr);
  assert.match(logBeforeClose, /park: target local/);
});

test('AC3.4: after a park no worktree and no claim remain', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.equal(w.state.worktrees.includes(w.state.worktree), false);
  assert.deepEqual(w.state.claims, { 7: 'released' });
});

test('a failed close-run is a step-3 failure: archive-run never runs, steps 4-5 still do', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const spawn = (script, args) => {
    if (args[0] === 'close-run') {
      w.state.spawn.push([path.basename(script), ...args]);
      return { code: 1, stdout: '', stderr: 'claude-tweaks: --run path rejected: not terminal\n' };
    }
    return w.deps.spawn(script, args);
  };
  const res = await call(w, parkArgv(w), { spawn });
  assert.equal(res.code, 0, res.stderr);
  const result = JSON.parse(res.stdout);
  assert.equal(result.outcome, 'parked');
  assert.equal(result.steps[2].ok, false);
  assert.match(result.steps[2].detail, /close-run exited 1/);
  assert.equal(w.state.spawn.some(([, verb]) => verb === 'archive-run'), false);
  assert.deepEqual(result.steps.slice(3).map((s) => s.ok), [true, true]);
  assert.equal(w.state.release.length, 1);
});

test("archive-run's exit-0 refusal is a step-3 failure", async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } }, fail: { archive: 'console-unresolved' } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 0, res.stderr);
  const result = JSON.parse(res.stdout);
  assert.equal(result.outcome, 'parked');
  assert.equal(result.steps[2].ok, false);
  assert.match(result.steps[2].detail, /console-unresolved/);
  assert.equal(result.steps[3].ok, true);
  assert.equal(result.steps[4].ok, true);
  assert.equal(w.state.release.length, 1);
});

test('park with no packet posts one, then parks', async () => {
  const w = world({ records: { 7: { comments: [] } } });
  const res = await call(w, parkArgv(w, ['--repo', 'o/r']));
  assert.equal(res.code, 0, res.stderr);
  const packetCalls = w.state.spawn.filter(([name]) => name === 'acceptance-packet.js');
  assert.deepEqual(packetCalls.map((c) => c[1]), ['gather', 'render', 'post']);
  const [gather, render, post] = packetCalls;
  assert.deepEqual(gather.slice(2, 6), ['--record', '7', '--run', w.state.runDir]);
  const deployFile = gather[gather.indexOf('--deploy') + 1];
  assert.equal(gather[gather.indexOf('--out') + 1], render[render.indexOf('--facts') + 1]);
  assert.equal(render[render.indexOf('--out') + 1], post[post.indexOf('--body-file') + 1]);
  assert.equal(post[post.indexOf('--label') + 1], 'accept:pending');
  assert.equal(post[post.indexOf('--repo') + 1], 'o/r');
  // The temp inputs are removed once the post is done.
  assert.equal(fs.readdirSync(w.state.root).includes(path.basename(deployFile)), false);
  const edits = w.state.gh.filter((a) => a[0] === 'api' && a[1] === 'graphql');
  assert.equal(edits.length, 1);
  assert.equal(parkStateOf(w.state.records[7].comments[0].body).parked, true);
  assert.deepEqual(w.state.records[7].labels, ['accept:pending']);
});

test('park: the no-packet post gets a deploy file holding target local and a narrative the renderer accepts', async () => {
  const w = world({ records: { 7: { comments: [] } } });
  const seen = {};
  const spawn = (script, args) => {
    if (args[0] === 'gather') seen.deploy = JSON.parse(fs.readFileSync(args[args.indexOf('--deploy') + 1], 'utf8'));
    if (args[0] === 'render') seen.narrative = JSON.parse(fs.readFileSync(args[args.indexOf('--narrative') + 1], 'utf8'));
    return w.deps.spawn(script, args);
  };
  const res = await call(w, parkArgv(w), { spawn });
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(seen.deploy, { target: 'local' });
  assert.deepEqual(seen.narrative, { schemaVersion: 1, claims: [] });
});

test('park whose packet post fails stops at step 1 and archives nothing', async () => {
  const w = world({ records: { 7: { comments: [] } }, fail: { post: 'gh: HTTP 502' } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 1);
  const result = JSON.parse(res.stdout);
  assert.equal(result.outcome, 'park-failed');
  assert.equal(result.steps.length, 1);
  assert.match(result.steps[0].detail, /HTTP 502/);
  assert.equal(w.state.spawn.some(([name]) => name === 'hooks.js'), false);
  assert.equal(w.state.release.length, 0);
  assert.equal(w.state.git.length, 0);
});

test('park: an unreadable packet comment is a step-1 failure', async () => {
  const w = world({ records: { 7: { comments: [{ ...packetComment(7), body: PACKET.replace('acceptance-packet: v1', 'acceptance-packet: v9') }] } } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 1);
  assert.match(JSON.parse(res.stdout).steps[0].detail, /unreadable/);
});

test('park: a failed comment edit is a step-2 failure and archives nothing', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } }, fail: { edit: 'HTTP 500' } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 1);
  const result = JSON.parse(res.stdout);
  assert.deepEqual(result.steps.map((s) => s.ok), [true, false]);
  assert.equal(w.state.spawn.length, 0);
});

test('I3: a base that will not read is a step-2 failure and archives nothing', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } }, fail: { 'view:baseRefOid': 'HTTP 502' } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 1);
  const result = JSON.parse(res.stdout);
  assert.deepEqual(result.steps.map((s) => s.ok), [true, false]);
  assert.match(result.steps[1].detail, /HTTP 502/);
  assert.equal(w.state.spawn.length, 0);
});

test('park removes a locked worktree', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 0, res.stderr);
  const step5 = JSON.parse(res.stdout).steps[4];
  assert.equal(step5.ok, true);
  assert.equal(w.state.worktrees.includes(w.state.worktree), false);
});

test('park: a worktree git no longer lists is already gone', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  w.state.worktrees = [w.state.root];
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).steps[4], { step: 5, name: 'removeWorktree', ok: true, detail: 'already gone' });
  assert.equal(w.state.git.filter((a) => a[3] === 'remove').length, 0);
});

test('a multi-record park writes park state only on the records passed', async () => {
  const w = world({ records: { 1: { comments: [packetComment(1)] }, 2: { comments: [packetComment(2)] } } });
  const res = await call(w, ['park', '--run', w.state.runDir, '--record', '2', '--claimed', '1,2', '--pr', '12', '--head', HEAD, '--worktree', w.state.worktree]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(parkStateOf(w.state.records[1].comments[0].body).parked, false);
  assert.equal(parkStateOf(w.state.records[2].comments[0].body).parked, true);
  assert.deepEqual(w.state.records[1].labels, []);
  assert.deepEqual(w.state.records[2].labels, ['accept:pending']);
  assert.deepEqual(w.state.release.map((r) => r.issueNumber), [1, 2]);
});

test('park: a label already pending in either spelling is not added again', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)], labels: ['demo:pending'] } } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.equal(w.state.gh.some((a) => a[1] === 'edit'), false);
});

test('--worktree-mode caller does not remove the worktree', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const res = await call(w, parkArgv(w, ['--worktree-mode', 'caller']));
  assert.equal(res.code, 0, res.stderr);
  const step5 = JSON.parse(res.stdout).steps[4];
  assert.equal(step5.ok, true);
  assert.match(step5.detail, /^caller-removes /);
  assert.equal(w.state.git.length, 0);
});

test('park: a failed claim release is reported and the worktree is still removed', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const releaseClaim = () => ({ outcome: 'skipped-not-owner', holder: 'other-run', calls: [], labelsRemoved: [], labelsFailed: [] });
  const res = await call(w, parkArgv(w), { releaseClaim });
  assert.equal(res.code, 0, res.stderr);
  const result = JSON.parse(res.stdout);
  assert.equal(result.steps[3].ok, false);
  assert.match(result.steps[3].detail, /skipped-not-owner/);
  assert.equal(result.steps[4].ok, true);
});

test('park: gh absent exits 4 before any write', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const res = await call(w, parkArgv(w), { ghAvailable: () => false });
  assert.equal(res.code, 4);
  assert.equal(res.stdout, '');
  assert.equal(w.state.gh.length + w.state.spawn.length + w.state.git.length, 0);
});

test('park: a --run that does not exist is refused with exit 3', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const res = await call(w, ['park', '--run', path.join(w.state.root, 'nope'), '--record', '7', '--pr', '12', '--head', HEAD, '--worktree', w.state.worktree]);
  assert.equal(res.code, 3);
  assert.equal(w.state.gh.length, 0);
});

test('park: a relative --run and --worktree resolve against the injected cwd', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const res = await call(w, ['park', '--run', path.relative(w.state.root, w.state.runDir), '--record', '7', '--pr', '12', '--head', HEAD, '--worktree', 'wt-7']);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(w.state.worktrees.includes(w.state.worktree), false);
  assert.deepEqual(w.state.spawn.find(([, verb]) => verb === 'archive-run'), ['hooks.js', 'archive-run', '--run', w.state.runDir]);
});

// ---- parked ----

test('parked exit codes', async () => {
  const parkedBody = require('../plugin/bin/lib/accept/park').writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE }).body;
  const cases = [
    { records: { 7: { labels: ['accept:pending'], comments: [{ ...packetComment(7), body: parkedBody }] } }, code: 0, out: 'parked' },
    { records: { 7: { labels: ['accept:pending'], comments: [packetComment(7)] } }, code: 5, out: 'not-parked' },
    { records: { 7: { labels: [], comments: [] } }, code: 5, out: 'not-parked' },
    { records: {}, code: 6, out: 'unknown' },
  ];
  for (const { records, code, out } of cases) {
    const w = world({ policy: ON, records });
    const res = await call(w, ['parked', '--record', '7']);
    assert.equal(res.code, code, out);
    assert.equal(res.stdout, `${out}\n`);
  }
});

test('parked maps an unreadable packet to unknown', async () => {
  const w = world({ policy: ON, records: { 7: { labels: ['accept:pending'], comments: [packetComment(7)] } }, fail: { 'view:labels,comments': 'HTTP 502' } });
  const res = await call(w, ['parked', '--record', '7']);
  assert.equal(res.code, 6);
  assert.equal(res.stdout, 'unknown\n');
});

// AC2a: control mode off is today's merge path — no gh call, never a no-merge exit.
const throwingGh = { gh: () => { throw new Error('HTTP 502'); }, ghAvailable: () => { throw new Error('probed gh'); } };

test('AC2a: parked with control mode off is not-parked with zero gh calls, with and without --run', async () => {
  for (const policy of [undefined, 'acceptance-target: local\n', 'control-mode: off\n']) {
    const w = world({ policy, records: {} });
    let ghCalls = 0;
    const count = { gh: (args) => { ghCalls += 1; return throwingGh.gh(args); }, ghAvailable: () => { ghCalls += 1; return throwingGh.ghAvailable(); } };
    for (const argv of [['parked', '--record', '7'], ['parked', '--record', '7', '--run', w.state.runDir]]) {
      const res = await call(w, argv, count);
      assert.equal(res.code, 5, `${policy} ${argv.join(' ')}: ${res.stderr}`);
      assert.equal(res.stdout, 'not-parked\n');
    }
    assert.equal(ghCalls, 0);
  }
});

test('parked with control mode on and a failing gh is unknown, with and without --run', async () => {
  const w = world({ policy: ON, records: {} });
  for (const argv of [['parked', '--record', '7'], ['parked', '--record', '7', '--run', w.state.runDir]]) {
    const res = await call(w, argv, { gh: throwingGh.gh });
    assert.equal(res.code, 6, argv.join(' '));
    assert.equal(res.stdout, 'unknown\n');
  }
});

test("#5830: parked --run: the run's config.yml never outranks policy.yml for control-mode", async () => {
  const w = world({ policy: 'control-mode: off\n', records: {} });
  fs.writeFileSync(path.join(w.state.runDir, 'config.yml'), 'control-mode: on\n');
  const withRun = await call(w, ['parked', '--record', '7', '--run', w.state.runDir], throwingGh);
  assert.equal(withRun.code, 5);
  assert.equal(withRun.stdout, 'not-parked\n');
  const withoutRun = await call(w, ['parked', '--record', '7'], throwingGh);
  assert.equal(withoutRun.code, 5);
});

test('#5830: parked --run keeps the project value when the run config says control-mode off', async () => {
  const w = world({ policy: ON, records: {} });
  fs.writeFileSync(path.join(w.state.runDir, 'config.yml'), 'control-mode: off\n');
  const res = await call(w, ['parked', '--record', '7', '--run', w.state.runDir], { gh: throwingGh.gh });
  assert.equal(res.code, 6);
  assert.equal(res.stdout, 'unknown\n');
});

test('parked: an unreadable policy file is unknown; a refused --run exits 3', async () => {
  const w = world({ records: {} });
  fs.mkdirSync(path.join(w.state.root, '.claude-tweaks', 'policy.yml'));
  const res = await call(w, ['parked', '--record', '7'], throwingGh);
  assert.equal(res.code, 6);
  assert.equal(res.stdout, 'unknown\n');
  const refused = await call(world({ policy: ON }), ['parked', '--record', '7', '--run', path.join(w.state.root, 'nope')], throwingGh);
  assert.equal(refused.code, 3);
  assert.equal(refused.stdout, '');
});

test('parked: gh absent is unknown', async () => {
  const w = world({ policy: ON, records: {} });
  const res = await call(w, ['parked', '--record', '7'], { ghAvailable: () => false });
  assert.equal(res.code, 6);
  assert.equal(res.stdout, 'unknown\n');
});

test('an unexpected throw fails closed: parked unknown, decide 1', async () => {
  const w = world({ policy: 'control-mode: on\n', records: { 7: {} } });
  const boom = () => { throw new Error('probe exploded'); };
  const parked = await call(w, ['parked', '--record', '7'], { ghAvailable: boom });
  assert.equal(parked.code, 6);
  assert.equal(parked.stdout, 'unknown\n');
  assert.match(parked.stderr, /probe exploded/);
  const decide = await call(w, ['decide', '--run', w.state.runDir, '--record', '7'], { ghAvailable: boom });
  assert.equal(decide.code, 1);
});

// ---- reenter, reenter-check, reenter-remove ----

const TIP = 'f'.repeat(40);

// A fake gh/git over the world's records: `pr view`, plus the reentry git calls recorded.
function reentryWorld(extra = {}) {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const baseGh = w.deps.gh;
  const ghCalls = [];
  const gh = (args) => {
    if (args[0] === 'pr') {
      ghCalls.push(args);
      if (extra.prFails) throw new Error('HTTP 404: no pull request');
      return JSON.stringify({ headRefName: 'feat/x', headRefOid: extra.prHead ?? TIP, baseRefOid: extra.base ?? BASE });
    }
    return baseGh(args);
  };
  const gitCalls = [];
  const git = (args, opts) => {
    gitCalls.push({ args, opts });
    const rest = args.slice(2);
    if (rest[0] === 'rev-parse') return `${extra.head ?? TIP}\n`;
    if (rest.includes('status')) return extra.porcelain ?? '';
    if (rest.join(' ') === 'worktree list --porcelain') return extra.listed ?? '';
    return '';
  };
  w.deps.gh = gh;
  w.deps.git = git;
  return { w, ghCalls, gitCalls };
}

test('reenter prints the re-entry result with the packet park head, and fences its git operands', async () => {
  const { w, ghCalls, gitCalls } = reentryWorld();
  const res = await call(w, ['reenter', '--record', '7', '--pr', '12']);
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.worktree, path.join(w.state.root, '.claude', 'worktrees', 'accept-7'));
  assert.equal(out.headRefName, 'feat/x');
  assert.equal(out.prHead, TIP);
  assert.equal(out.head, TIP);
  assert.equal(out.parkHead, null, 'the fixture packet carries no park-head, so the PR counts as moved');
  assert.equal(out.moved, true);
  assert.deepEqual(ghCalls, [['pr', 'view', '12', '--json', 'headRefName,headRefOid,baseRefOid']]);
  assert.deepEqual(gitCalls[0].args, ['-C', w.state.root, 'worktree', 'list', '--porcelain']);
  assert.deepEqual(gitCalls[1].args, ['-C', w.state.root, 'fetch', '--end-of-options', 'origin', 'feat/x']);
  assert.equal(gitCalls[1].opts.cwd, w.state.root);
});

test('reenter reads a parked packet head and reports an unmoved PR', async () => {
  const { w, ghCalls } = reentryWorld();
  const { writeParkDeployStatus } = require('../plugin/bin/lib/accept/park');
  w.state.records[7].comments[0].body = writeParkDeployStatus(PACKET, { headSha: TIP, baseSha: BASE }).body;
  const res = await call(w, ['reenter', '--record', '7', '--pr', '12', '--repo', 'o/r']);
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.parkHead, TIP);
  assert.equal(out.parkBase, BASE);
  assert.equal(out.prBase, BASE);
  assert.equal(out.moved, false);
  assert.deepEqual(ghCalls, [['pr', 'view', '12', '--json', 'headRefName,headRefOid,baseRefOid', '--repo', 'o/r']]);
});

test('I3: reenter counts a moved base, or a packet with no park-base, as moved', async () => {
  const { writeParkDeployStatus } = require('../plugin/bin/lib/accept/park');
  const moved = reentryWorld({ base: 'c'.repeat(40) });
  moved.w.state.records[7].comments[0].body = writeParkDeployStatus(PACKET, { headSha: TIP, baseSha: BASE }).body;
  const res = await call(moved.w, ['reenter', '--record', '7', '--pr', '12']);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).moved, true, 'the base moved since the park');

  const legacy = reentryWorld();
  legacy.w.state.records[7].comments[0].body = writeParkDeployStatus(PACKET, { headSha: TIP, baseSha: BASE }).body.replace(/\npark-base: \S+/, '');
  const old = await call(legacy.w, ['reenter', '--record', '7', '--pr', '12']);
  assert.equal(old.code, 0, old.stderr);
  const out = JSON.parse(old.stdout);
  assert.equal(out.parkHead, TIP);
  assert.equal(out.parkBase, null);
  assert.equal(out.moved, true, 'no park-base fails closed');
});

test('reenter: a stale directory exits 7 and touches nothing', async () => {
  const { w, gitCalls, ghCalls } = reentryWorld();
  fs.mkdirSync(path.join(w.state.root, '.claude', 'worktrees', 'accept-7'), { recursive: true });
  const res = await call(w, ['reenter', '--record', '7', '--pr', '12']);
  assert.equal(res.code, 7);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /stale accept directory/);
  assert.equal(gitCalls.length + ghCalls.length, 0);
});

test('reenter: a PR view failure exits 1; gh absent exits 4 before any call', async () => {
  const failing = reentryWorld({ prFails: true });
  const res = await call(failing.w, ['reenter', '--record', '7', '--pr', '12']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.equal(failing.gitCalls.some(({ args }) => args.includes('fetch') || args.includes('add')), false);
  const absent = reentryWorld();
  const none = await call(absent.w, ['reenter', '--record', '7', '--pr', '12'], { ghAvailable: () => false });
  assert.equal(none.code, 4);
  assert.equal(absent.gitCalls.length + absent.ghCalls.length, 0);
});

test('reenter-check: exit 0 when HEAD matches and the tree is clean, 8 when modified or moved', async () => {
  const clean = reentryWorld();
  const wt = path.join(clean.w.state.root, 'wt-x');
  const ok = await call(clean.w, ['reenter-check', '--worktree', wt, '--expect-head', TIP]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { ok: true, head: TIP, dirty: [] });
  assert.deepEqual(clean.gitCalls[0].args.slice(0, 2), ['-C', wt]);

  const dirty = reentryWorld({ porcelain: ' M a.txt\0' });
  const bad = await call(dirty.w, ['reenter-check', '--worktree', wt, '--expect-head', TIP]);
  assert.equal(bad.code, 8);
  assert.deepEqual(JSON.parse(bad.stdout), { ok: false, head: TIP, dirty: ['a.txt'] });

  const moved = reentryWorld({ head: 'a'.repeat(40) });
  assert.equal((await call(moved.w, ['reenter-check', '--worktree', wt, '--expect-head', TIP])).code, 8);

  const broken = reentryWorld();
  broken.w.deps.git = () => { throw new Error('fatal: not a git repository'); };
  const failed = await call(broken.w, ['reenter-check', '--worktree', wt, '--expect-head', TIP]);
  assert.equal(failed.code, 1);
  assert.equal(failed.stdout, '');
});

const acceptWt = (w, n = 9) => path.join(w.state.root, '.claude', 'worktrees', `accept-${n}`);
const listing = (wt) => `worktree ${wt}\nHEAD ${TIP}\ndetached\n\n`;
const removeArgv = (w, wt = acceptWt(w)) => ['reenter-remove', '--worktree', wt];

test('reenter-remove removes a listed accept worktree, reports an unlisted one, and exits 1 on a git failure', async () => {
  const listed = reentryWorld();
  const wt = acceptWt(listed.w);
  listed.w.deps.git = (args, opts) => {
    listed.gitCalls.push({ args, opts });
    return args.includes('list') ? listing(wt) : '';
  };
  const res = await call(listed.w, removeArgv(listed.w), { realpath: (p) => p });
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { removed: true });
  assert.deepEqual(listed.gitCalls.at(-1).args, ['-C', listed.w.state.root, 'worktree', 'remove', '--force', '--end-of-options', wt]);

  const gone = reentryWorld({ listed: '' });
  const none = await call(gone.w, removeArgv(gone.w), { realpath: (p) => p });
  assert.equal(none.code, 0);
  assert.deepEqual(JSON.parse(none.stdout), { removed: false });

  const failing = reentryWorld();
  const failWt = acceptWt(failing.w);
  failing.w.deps.git = (args) => {
    if (args.includes('remove')) throw new Error('fatal: cannot remove');
    return listing(failWt);
  };
  const failed = await call(failing.w, removeArgv(failing.w), { realpath: (p) => p });
  assert.equal(failed.code, 1);
});

test('reenter-remove refuses a worktree that is not accept-<n> directly under .claude/worktrees (exit 2)', async () => {
  const w = reentryWorld();
  const { root } = w.w.state;
  const outside = [
    path.join(root, 'wt-7'),
    path.join(root, '.claude', 'worktrees', 'feat'),
    path.join(root, '.claude', 'worktrees', 'accept-x'),
    path.join(root, '.claude', 'worktrees', 'sub', 'accept-1'),
    path.join(os.tmpdir(), 'accept-1'),
  ];
  for (const target of outside) {
    const res = await call(w.w, removeArgv(w.w, target), { realpath: (p) => p });
    assert.equal(res.code, 2, target);
    assert.match(res.stderr, /not an accept-<n> worktree/);
  }
  assert.equal(w.gitCalls.length, 0, 'git never ran');
});

// ---- invocation ----

test('malformed invocations exit 2', async () => {
  const w = world({ records: { 7: {} } });
  const run = w.state.runDir;
  const argvs = [
    [],
    ['bogus'],
    ['decide', '--run', run],
    ['decide', '--run', run, '--record', '7,x'],
    ['decide', '--run', run, '--record', '0'],
    ['decide', '--run', run, '--record', '7,7'],
    ['decide', '--run', run, '--record'],
    ['decide', '--run', run, '--record', '7', '--repo', '../r'],
    ['park', '--run', run, '--pr', '12', '--head', HEAD, '--worktree', '/w'],
    ['park', '--run', run, '--record', '7', '--pr', 'twelve', '--head', HEAD, '--worktree', '/w'],
    ['park', '--run', run, '--record', '7', '--pr', '12', '--head', 'NOTHEX', '--worktree', '/w'],
    ['park', '--run', run, '--record', '7', '--pr', '12', '--head', 'abc', '--worktree', '/w'],
    ['park', '--run', run, '--record', '7', '--pr', '12', '--head', HEAD, '--worktree', '-x'],
    ['park', '--run', run, '--record', '7', '--pr', '12', '--head', HEAD, '--worktree', '/w', '--worktree-mode', 'keep'],
    ['park', '--run', run, '--record', '7', '--pr', '12', '--head', HEAD],
    ['parked', '--record', '7,8'],
    ['parked', '--record', '7', '--run'],
    ['parked', '--record', '7', '--head', HEAD],
    ['reenter', '--record', '7'],
    ['reenter', '--pr', '12'],
    ['reenter', '--record', '7,8', '--pr', '12'],
    ['reenter', '--record', '7', '--pr', 'x'],
    ['reenter-check', '--worktree', '/w'],
    ['reenter-check', '--expect-head', HEAD],
    ['reenter-check', '--worktree', '/w', '--expect-head', 'NOTHEX'],
    ['reenter-check', '--worktree', '-x', '--expect-head', HEAD],
    ['reenter-remove'],
    ['reenter-remove', '--worktree', '/w', '--repo', 'o/r'],
    ['decide', '--run', run, '--record', '7', 'constructor', 'x'],
  ];
  for (const argv of argvs) {
    const res = await call(w, argv);
    assert.equal(res.code, 2, argv.join(' '));
    assert.equal(res.stdout, '', argv.join(' '));
  }
  assert.equal(w.state.gh.length + w.state.spawn.length + w.state.git.length, 0);
});

test('--help prints usage and exits 0', async () => {
  const w = world();
  const res = await call(w, ['--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /accept-park\.js decide/);
  assert.match(res.stdout, /accept-park\.js park/);
  assert.match(res.stdout, /accept-park\.js parked/);
});

test('script entry: --help exits 0 and a malformed call exits 2', () => {
  const { spawnCli } = require('./helpers/run-cli');
  const help = spawnCli(CLI, ['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /accept-park\.js parked/);
  const bad = spawnCli(CLI, ['parked']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--record is required/);
});

test('the acceptance-target key is wired', () => {
  assert.doesNotMatch(POLICY_KEYS.find((k) => k.key === 'acceptance-target').summary, /^Not yet used/);
});

// ---- park: tripwire lines (#4619) ----

const TRIPWIRE_LINE = 'tripwire: the diff crosses migrations (migrations/\\*\\*: migrations/001.sql), which nobody flagged, so this run is local';
const writeTripwireFile = (w, content, n = 7) => {
  const dir = path.join(w.state.runDir, 'packet-facts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `tripwire-${n}.json`), content);
};

test('park writes the run\'s tripwire lines into the packet', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  writeTripwireFile(w, JSON.stringify({ record: 7, lines: [TRIPWIRE_LINE, 'tripwire: second'] }));
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 0, res.stderr);
  const body = w.state.records[7].comments[0].body;
  assert.ok(body.split('\n').includes(TRIPWIRE_LINE));
  assert.ok(body.split('\n').includes('tripwire: second'));
  assert.deepEqual(parkStateOf(body), { parked: true, target: 'local', reason: 'awaiting-local-acceptance', headSha: HEAD, baseSha: BASE });
});

test('park with an empty tripwire lines list removes an earlier tip\'s lines', async () => {
  const stale = require('../plugin/bin/lib/accept/park').writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: ['tripwire: stale'] }).body;
  const w = world({ records: { 7: { comments: [{ ...packetComment(7), body: stale }] } } });
  writeTripwireFile(w, JSON.stringify({ record: 7, lines: [] }));
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.doesNotMatch(w.state.records[7].comments[0].body, /tripwire/);
});

test('an unparseable tripwire file fails step 2', async () => {
  for (const content of ['{not json', JSON.stringify({ record: 7, lines: 'tripwire: x' }), JSON.stringify({ record: 7, lines: [4] }), JSON.stringify({ record: 7 }), 'null']) {
    const w = world({ records: { 7: { comments: [packetComment(7)] } } });
    writeTripwireFile(w, content);
    const res = await call(w, parkArgv(w));
    assert.equal(res.code, 1, content);
    const result = JSON.parse(res.stdout);
    assert.equal(result.outcome, 'park-failed');
    assert.deepEqual(result.steps.map((s) => s.ok), [true, false]);
    assert.match(result.steps[1].detail, /tripwire lines unreadable: /);
    assert.equal(w.state.spawn.length, 0, 'nothing archived');
    assert.equal(w.state.gh.filter((a) => a[0] === 'api' && a[1] === 'graphql').length, 0, 'no edit');
  }
});

test('a tripwire file written for another record fails step 2', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  writeTripwireFile(w, JSON.stringify({ record: 8, lines: [TRIPWIRE_LINE] }));
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 1);
  const result = JSON.parse(res.stdout);
  assert.deepEqual(result.steps.map((s) => s.ok), [true, false]);
  assert.match(result.steps[1].detail, /tripwire lines unreadable: the file is for record 8, not #7/);
  assert.doesNotMatch(w.state.records[7].comments[0].body, /tripwire/);
});

test('a tripwire file the park cannot read for another reason fails step 2 with the reason', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  writeTripwireFile(w, '{}');
  const res = await call(w, parkArgv(w), { readFile: (file) => {
    if (file.endsWith('tripwire-7.json')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    return fs.readFileSync(file, 'utf8');
  } });
  assert.equal(res.code, 1);
  assert.match(JSON.parse(res.stdout).steps[1].detail, /tripwire lines unreadable: EACCES/);
});

test('no tripwire file parks as before', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const res = await call(w, parkArgv(w));
  assert.equal(res.code, 0, res.stderr);
  assert.doesNotMatch(w.state.records[7].comments[0].body, /tripwire/);
  assert.deepEqual(JSON.parse(res.stdout).steps.map((s) => s.ok), [true, true, true, true, true]);
});

// ---- station events (#5902) ----

const recorder = () => {
  const events = [];
  return { events, stationEvent: (e) => { events.push(e); } };
};
const SESSION_ENV = { CLAUDE_CODE_SESSION_ID: 'sess-park' };

test('#5902: realDeps wires a stationEvent emitter, so the real entry point emits', () => {
  const { realDeps } = require('../plugin/bin/accept-park');
  assert.equal(typeof realDeps.stationEvent, 'function', 'stationEvent is wired');
});

test('#5902: postPacket adding accept:pending records one entered accept event', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const rec = recorder();
  const res = await call(w, parkArgv(w), { stationEvent: rec.stationEvent, env: SESSION_ENV });
  assert.equal(res.code, 0, res.stderr);
  const entered = rec.events.filter((e) => e.station === 'accept');
  assert.deepEqual(entered, [{
    kind: 'entered', station: 'accept', recordNumber: 7, repoName: 'o/r', lane: 'unknown', runId: RUN_ID, sessionId: 'sess-park',
    payload: { label: 'accept:pending' }, discriminator: `accept-pending:7:${RUN_ID}`,
  }]);
});

test('#5902: postPacket posting a fresh packet records one entered accept event', async () => {
  const w = world({ records: { 7: { comments: [] } } });
  const rec = recorder();
  const res = await call(w, parkArgv(w), { stationEvent: rec.stationEvent });
  assert.equal(res.code, 0, res.stderr);
  assert.equal(rec.events.filter((e) => e.kind === 'entered' && e.station === 'accept').length, 1);
});

test('#5902: postPacket with the pending label already present records no accept event', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)], labels: ['accept:pending'] } } });
  const rec = recorder();
  const res = await call(w, parkArgv(w), { stationEvent: rec.stationEvent });
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(rec.events.filter((e) => e.station === 'accept'), []);
});

test('#5902: a park whose claim release returns released records one exited build event', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const rec = recorder();
  const res = await call(w, parkArgv(w), { stationEvent: rec.stationEvent, env: SESSION_ENV });
  assert.equal(res.code, 0, res.stderr);
  const exited = rec.events.filter((e) => e.station === 'build');
  assert.deepEqual(exited, [{
    kind: 'exited', station: 'build', outcome: 'passed', recordNumber: 7, repoName: 'o/r', lane: 'unknown', runId: RUN_ID,
    sessionId: 'sess-park', payload: { reason: 'awaiting-local-acceptance', actor: 'script' }, discriminator: `release:${RUN_ID}:2026-11-16T09:00:00.000Z`,
  }]);
  assert.ok(buildLine(exited[0]), 'the park exit line is accepted by the emitter');
});

test('#5902: the park release discriminator names the released claim instance', async () => {
  const keyFor = async (claimedAt) => {
    const w = world({ records: { 7: { comments: [packetComment(7)] } } });
    w.state.claimedAt = claimedAt;
    const rec = recorder();
    const res = await call(w, parkArgv(w), { stationEvent: rec.stationEvent });
    assert.equal(res.code, 0, res.stderr);
    return rec.events.find((e) => e.kind === 'exited').discriminator;
  };
  const first = await keyFor('2026-11-16T09:00:00.000Z');
  assert.equal(first, await keyFor('2026-11-16T09:00:00.000Z'), 'a replay keys the same');
  assert.notEqual(first, await keyFor('2026-11-16T09:30:00.000Z'), 'a re-claim by the same run keys differently');
});

test('#5902: an already-released claim records no exited build event', async () => {
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  w.state.claims[7] = 'released';
  const rec = recorder();
  const res = await call(w, parkArgv(w), { stationEvent: rec.stationEvent });
  assert.equal(res.code, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).steps[3].detail, '#7: already-released');
  assert.deepEqual(rec.events.filter((e) => e.station === 'build'), []);
});

// Each run builds its own temp root. Its stdout is JSON, so on Windows the root appears with doubled
// backslashes: replace the raw form and the JSON-escaped form, or the two runs never compare equal.
const stripRoots = (text, ...roots) => roots.reduce(
  (acc, root) => acc.split(root).join('ROOT').split(JSON.stringify(root).slice(1, -1)).join('ROOT'),
  text,
);

test('#5902: a throwing stationEvent leaves the park stdout and exit code unchanged', async () => {
  const plain = world({ records: { 7: { comments: [packetComment(7)] } } });
  const base = await call(plain, parkArgv(plain));
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  let calls = 0;
  const res = await call(w, parkArgv(w), { stationEvent: () => { calls += 1; throw new Error('emitter exploded'); } });
  assert.equal(calls, 2, 'both emissions were attempted');
  assert.equal(res.code, base.code);
  const strip = (s) => stripRoots(s, plain.state.root, w.state.root);
  assert.equal(strip(res.stdout), strip(base.stdout));
  assert.equal(res.stderr, base.stderr);
});

test('#5902: a recording stationEvent leaves the park stdout and exit code unchanged', async () => {
  const plain = world({ records: { 7: { comments: [packetComment(7)] } } });
  const base = await call(plain, parkArgv(plain));
  const w = world({ records: { 7: { comments: [packetComment(7)] } } });
  const rec = recorder();
  const res = await call(w, parkArgv(w), { stationEvent: rec.stationEvent });
  assert.equal(rec.events.length, 2, 'both emissions were recorded');
  assert.equal(res.code, base.code);
  const strip = (s) => stripRoots(s, plain.state.root, w.state.root);
  assert.equal(strip(res.stdout), strip(base.stdout));
  assert.equal(res.stderr, base.stderr);
});
