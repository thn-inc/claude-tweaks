// tests/pipeline-cost-report/funnel.test.js
//
// #5914: tools/pipeline-cost-report/funnel.js tallies the driver's admission refusals over the open ready
// auto:build records. Fakes only — never spawns drive.js or gh.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { reasonKey, collectFunnel, readPluginVersion } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'funnel.js'));

const NOW = () => new Date('2026-11-19T10:00:00Z');
const gh = (count) => () => JSON.stringify(Array.from({ length: count }, (_, i) => ({ number: i + 1 })));
const verdict = (admitted, reasons = []) => JSON.stringify({ record: 0, admitted, reasons });
const deps = (verdicts) => ({
  gh: gh(verdicts.length),
  check: async (n) => {
    const v = verdicts[n - 1];
    if (v instanceof Error) throw v;
    return v;
  },
  now: NOW,
  pluginVersion: '1.2.3',
});
const run = (verdicts, simulate = []) => collectFunnel({ repo: 'o/r', simulate }, deps(verdicts));

test('reasonKey cuts only the heads that embed a value', () => {
  assert.strictEqual(reasonKey('protected path: a/b.js'), 'protected path');
  assert.strictEqual(reasonKey('merge-sensitive path: x'), 'merge-sensitive path');
  assert.strictEqual(reasonKey('typed command not accepted: launcher, x'), 'typed command not accepted');
  assert.strictEqual(reasonKey('size ceiling unreadable: ??'), 'size ceiling unreadable');
  assert.strictEqual(reasonKey('Key File limit unreadable: ??'), 'Key File limit unreadable');
  assert.strictEqual(reasonKey('express-driver value not recognised: foo'), 'express-driver value not recognised');
  assert.strictEqual(reasonKey('express-driver split: issue number is odd'), 'express-driver split: issue number is odd');
  assert.strictEqual(reasonKey('size is not low'), 'size is not low');
});

test('AC5.1: funnel prints the admitted count', async () => {
  const f = await run([verdict(true), verdict(true), verdict(false, ['size is not low']), verdict(false, ['size is not low']), verdict(false, ['size is not low'])]);
  assert.strictEqual(f.admitted, 2);
  assert.strictEqual(f.checked, 5);
  assert.strictEqual(f.runDate, '2026-11-19');
  assert.strictEqual(f.pluginVersion, '1.2.3');
});

test('AC5.2: one row per distinct refusal reason', async () => {
  const f = await run([verdict(false, ['size is not low', 'protected path: a/b.js']), verdict(false, ['protected path: c/d.js'])]);
  assert.deepStrictEqual(f.reasons, { 'size is not low': 1, 'protected path': 2 });
});

test('a record counts once per key even when a key repeats', async () => {
  const f = await run([verdict(false, ['protected path: a', 'protected path: b'])]);
  assert.deepStrictEqual(f.reasons, { 'protected path': 1 });
});

test('AC5.3: a named set admits every record whose every reason is in the set', async () => {
  const f = await run(
    [verdict(true), verdict(true), verdict(false, ['size is not low', 'protected path: a']), verdict(false, ['protected path: b']), verdict(false, ['size is not low', 'record lacks auto:build'])],
    [['size is not low', 'protected path']],
  );
  assert.deepStrictEqual(f.simulations, [{ set: ['size is not low', 'protected path'], unseen: [], admitted: 4 }]);
});

test('default simulations: one per distinct reason taken alone', async () => {
  const f = await run([verdict(true), verdict(false, ['a']), verdict(false, ['a', 'b']), verdict(false, ['b'])]);
  assert.deepStrictEqual(f.simulations, [{ set: ['a'], unseen: [], admitted: 2 }, { set: ['b'], unseen: [], admitted: 2 }]);
});

test('a simulated reason that never appears in the refusal tally is recorded as unseen', async () => {
  const f = await run([verdict(false, ['protected path: a'])], [['protected path', 'typo'], ['protected path']]);
  assert.deepStrictEqual(f.simulations, [
    { set: ['protected path', 'typo'], unseen: ['typo'], admitted: 1 },
    { set: ['protected path'], unseen: [], admitted: 1 },
  ]);
});

test('simulate names go through reasonKey', async () => {
  const f = await run([verdict(false, ['protected path: a/b.js'])], [['protected path: x']]);
  assert.deepStrictEqual(f.simulations, [{ set: ['protected path'], unseen: [], admitted: 1 }]);
});

test('a refused record with no reasons is never admitted by a set', async () => {
  const f = await run([verdict(false, [])], [['x']]);
  assert.strictEqual(f.simulations[0].admitted, 0);
});

test('unreadable: a check that throws, times out, or prints no admitted/reasons is unreadable', async () => {
  const timeout = Object.assign(new Error('spawn timed out'), { killed: true, signal: 'SIGTERM' });
  const f = await run([new Error('boom'), timeout, 'not json', '{"record":4}', verdict(true), verdict(false, ['a'])]);
  assert.strictEqual(f.unreadable, 4);
  assert.strictEqual(f.checked, 6);
  assert.strictEqual(f.admitted, 1);
  assert.deepStrictEqual(f.reasons, { a: 1 });
});

test('the verdict is the last non-empty stdout line', async () => {
  const f = await run(['warming up\n' + verdict(true) + '\n\n']);
  assert.strictEqual(f.admitted, 1);
});

test('at most 4 checks run at once, and all records are checked', async () => {
  let pending = 0;
  let peak = 0;
  const seen = [];
  const f = await collectFunnel({ repo: 'o/r', simulate: [] }, {
    gh: gh(12),
    check: async (n) => {
      pending++;
      peak = Math.max(peak, pending);
      seen.push(n);
      await new Promise((r) => setTimeout(r, 5));
      pending--;
      return verdict(true);
    },
    now: NOW,
    pluginVersion: 'v',
  });
  assert.strictEqual(peak, 4);
  assert.strictEqual(seen.length, 12);
  assert.strictEqual(f.admitted, 12);
});

test('gh is called with the list argv for the repo', async () => {
  let argv;
  await collectFunnel({ repo: 'o/r', simulate: [] }, { gh: (a) => { argv = a; return '[]'; }, check: async () => verdict(true), now: NOW, pluginVersion: 'v' });
  assert.deepStrictEqual(argv, ['issue', 'list', '--repo', 'o/r', '--state', 'open', '--label', 'ready', '--label', 'auto:build', '--limit', '1000', '--json', 'number']);
});

test('readPluginVersion reads .claude-plugin/plugin.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-fn-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude-plugin'));
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{"version":"9.9.9"}');
    assert.strictEqual(readPluginVersion(dir), '9.9.9');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- driver activity (#6012): driverRuns and dispatchFirings ----
const { collectDriverRuns, collectDispatchFirings } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'funnel.js'));
const { listRuns } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'runs.js'));
const { fillRunManifest, LANES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'run-manifest', 'write.js'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-fn-act-'));
const mkRun = (pipes, rel, { events = true, lane = null } = {}) => {
  const dir = path.join(pipes, ...rel.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  if (events) fs.writeFileSync(path.join(dir, 'driver-events.jsonl'), '{}\n');
  if (lane) fillRunManifest(dir, { lane });
  return dir;
};
const driverFixture = () => {
  const pipes = tmp();
  mkRun(pipes, '2026-11-12T190721-drive-4351');
  mkRun(pipes, 'archive/2026-11-19T090000-record-5270', { lane: 'driver' });
  mkRun(pipes, 'archive/2026-11-15T090000-record-5300');
  return pipes;
};
const WINDOW = { since: '2026-11-08', until: '2026-11-21' };

test('AC1.1: driverRuns counts standalone and dispatch-routed runs in the window', () => {
  const pipes = driverFixture();
  try {
    assert.deepStrictEqual(collectDriverRuns({ runs: listRuns(pipes).runs, ...WINDOW }), { total: 3, dispatchRouted: 1, standalone: 2, last: '2026-11-19', unreadable: 0 });
  } finally {
    fs.rmSync(pipes, { recursive: true, force: true });
  }
});

test('out-of-window run: a driver run dated before since is not counted and does not set last', () => {
  const pipes = driverFixture();
  try {
    mkRun(pipes, '2026-11-01T000000-drive-1');
    mkRun(pipes, '2026-11-25T000000-drive-2');
    assert.deepStrictEqual(collectDriverRuns({ runs: listRuns(pipes).runs, ...WINDOW }), { total: 3, dispatchRouted: 1, standalone: 2, last: '2026-11-19', unreadable: 0 });
  } finally {
    fs.rmSync(pipes, { recursive: true, force: true });
  }
});

test('window bounds are inclusive: runs dated exactly since and exactly until are counted', () => {
  const pipes = driverFixture();
  try {
    mkRun(pipes, '2026-11-08T000000-drive-8');
    mkRun(pipes, '2026-11-21T235959-drive-21');
    assert.deepStrictEqual(collectDriverRuns({ runs: listRuns(pipes).runs, ...WINDOW }), { total: 5, dispatchRouted: 1, standalone: 4, last: '2026-11-21', unreadable: 0 });
  } finally {
    fs.rmSync(pipes, { recursive: true, force: true });
  }
});

test('corrupt manifest: counts standalone and adds one to unreadable', () => {
  const pipes = driverFixture();
  try {
    fs.writeFileSync(path.join(pipes, 'archive', '2026-11-19T090000-record-5270', 'manifest.json'), '{');
    assert.deepStrictEqual(collectDriverRuns({ runs: listRuns(pipes).runs, ...WINDOW }), { total: 3, dispatchRouted: 0, standalone: 3, last: '2026-11-19', unreadable: 1 });
  } finally {
    fs.rmSync(pipes, { recursive: true, force: true });
  }
});

test('a non-driver lane manifest counts standalone, without unreadable', () => {
  const pipes = tmp();
  try {
    const other = LANES.find((l) => l !== 'driver' && l !== 'unknown');
    mkRun(pipes, '2026-11-19T090000-record-1', { lane: other });
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(pipes, '2026-11-19T090000-record-1', 'manifest.json'), 'utf8')).lane, other);
    assert.deepStrictEqual(collectDriverRuns({ runs: listRuns(pipes).runs, ...WINDOW }), { total: 1, dispatchRouted: 0, standalone: 1, last: '2026-11-19', unreadable: 0 });
  } finally {
    fs.rmSync(pipes, { recursive: true, force: true });
  }
});

test('a -drive-N run name is standalone even when its manifest says lane driver', () => {
  const pipes = tmp();
  try {
    mkRun(pipes, '2026-11-18T000000-drive-7', { lane: 'driver' });
    assert.deepStrictEqual(collectDriverRuns({ runs: listRuns(pipes).runs, ...WINDOW }), { total: 1, dispatchRouted: 0, standalone: 1, last: '2026-11-18', unreadable: 0 });
  } finally {
    fs.rmSync(pipes, { recursive: true, force: true });
  }
});

test('a run directory without driver-events.jsonl is not a driver run', () => {
  const pipes = tmp();
  try {
    mkRun(pipes, '2026-11-18T000000-spec-1', { events: false, lane: 'driver' });
    assert.deepStrictEqual(collectDriverRuns({ runs: listRuns(pipes).runs, ...WINDOW }), { total: 0, dispatchRouted: 0, standalone: 0, last: null, unreadable: 0 });
  } finally {
    fs.rmSync(pipes, { recursive: true, force: true });
  }
});

// transcript fixtures
const tline = (o) => JSON.stringify(o);
const dispatchLines = (ts, { route = false, version = null } = {}) => [
  tline({ type: 'assistant', timestamp: ts, cwd: '/w/repo', message: { id: 'm1', model: 'claude-sonnet-5', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'claude-tweaks:dispatch' } }] } }),
  ...(version ? [tline({ type: 'attachment', timestamp: ts, attachment: { text: `claude-tweaks v${version} @ /x` } })] : []),
  ...(route ? [tline({ type: 'assistant', timestamp: ts, message: { id: 'm2', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node "/p/bin/drive.js" --check 5270' } }] } })] : []),
];
const writeT = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
};
const firingFixture = () => {
  const projects = tmp();
  writeT(path.join(projects, 'slug', 'a.jsonl'), dispatchLines('2026-11-19T09:00:00Z', { route: true, version: '6.175.0' }));
  writeT(path.join(projects, 'slug', 'b.jsonl'), dispatchLines('2026-11-19T10:00:00Z'));
  return projects;
};
const FIRINGS = { total: 2, reachedRoute: 1, byPluginVersion: { '6.175.0': 1, unknown: 1 }, unreadable: 0 };

test('AC2.1: dispatchFirings counts dispatch sessions, the route reached, and plugin versions', async () => {
  const projects = firingFixture();
  try {
    assert.deepStrictEqual(await collectDispatchFirings({ roots: [projects], ...WINDOW }), FIRINGS);
  } finally {
    fs.rmSync(projects, { recursive: true, force: true });
  }
});

test('a subagent transcript and a non-dispatch session are not dispatch firings', async () => {
  const projects = firingFixture();
  try {
    writeT(path.join(projects, 'slug', 'a', 'subagents', 'agent-x.jsonl'), dispatchLines('2026-11-19T09:00:00Z', { route: true }));
    writeT(path.join(projects, 'slug', 'c.jsonl'), [tline({ type: 'assistant', timestamp: '2026-11-19T09:00:00Z', message: { id: 'm', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'claude-tweaks:flow' } }] } })]);
    assert.deepStrictEqual(await collectDispatchFirings({ roots: [projects], ...WINDOW }), FIRINGS);
  } finally {
    fs.rmSync(projects, { recursive: true, force: true });
  }
});

test('firing window is the first timestamped line', async () => {
  const projects = firingFixture();
  try {
    writeT(path.join(projects, 'slug', 'd.jsonl'), [...dispatchLines('2026-11-07T23:00:00Z'), tline({ type: 'user', timestamp: '2026-11-09T00:00:00Z', message: { content: 'x' } })]);
    writeT(path.join(projects, 'slug', 'e.jsonl'), dispatchLines('2026-11-22T00:00:00Z'));
    assert.deepStrictEqual(await collectDispatchFirings({ roots: [projects], ...WINDOW }), FIRINGS);
    writeT(path.join(projects, 'slug', 'f.jsonl'), dispatchLines('2026-11-21T23:59:00Z'));
    assert.strictEqual((await collectDispatchFirings({ roots: [projects], ...WINDOW })).total, 3);
    writeT(path.join(projects, 'slug', 'g.jsonl'), dispatchLines('2026-11-08T00:00:00Z'));
    assert.strictEqual((await collectDispatchFirings({ roots: [projects], ...WINDOW })).total, 4);
  } finally {
    fs.rmSync(projects, { recursive: true, force: true });
  }
});

test('firing scope: match and root narrow the count like collectSpend', async () => {
  const projects = firingFixture();
  try {
    assert.strictEqual((await collectDispatchFirings({ roots: [projects], ...WINDOW, match: 'nope' })).total, 0);
    assert.strictEqual((await collectDispatchFirings({ roots: [projects], ...WINDOW, match: 'repo' })).total, 2);
    assert.strictEqual((await collectDispatchFirings({ roots: [projects], ...WINDOW, root: '/elsewhere' })).total, 0);
    assert.strictEqual((await collectDispatchFirings({ roots: [projects], ...WINDOW, root: '/w/repo' })).total, 2);
  } finally {
    fs.rmSync(projects, { recursive: true, force: true });
  }
});

test('AC5.1: a run directory that vanishes or a transcript that fails to parse adds to unreadable and is not counted', async () => {
  const pipes = driverFixture();
  const projects = firingFixture();
  try {
    const runs = listRuns(pipes).runs;
    const gone = runs.find((r) => r.name.includes('record-5270')).dir;
    const fsImpl = {
      ...fs,
      readdirSync: (p, o) => {
        if (p === gone) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        return fs.readdirSync(p, o);
      },
    };
    assert.deepStrictEqual(collectDriverRuns({ runs, ...WINDOW }, { fsImpl }), { total: 2, dispatchRouted: 0, standalone: 2, last: '2026-11-15', unreadable: 1 });
    fs.writeFileSync(path.join(projects, 'slug', 'bad.jsonl'), 'not json\n');
    assert.deepStrictEqual(await collectDispatchFirings({ roots: [projects], ...WINDOW }), { ...FIRINGS, unreadable: 1 });
  } finally {
    fs.rmSync(pipes, { recursive: true, force: true });
    fs.rmSync(projects, { recursive: true, force: true });
  }
});

test('collectFunnel returns driverRuns and dispatchFirings, or { error } when given one', async () => {
  const pipes = driverFixture();
  const projects = firingFixture();
  try {
    const base = await run([verdict(true)]);
    const ok = await collectFunnel({ repo: 'o/r', runs: listRuns(pipes), roots: [projects], since: '2026-11-08', until: '2026-11-21' }, deps([verdict(true)]));
    assert.deepStrictEqual(ok.driverRuns, { total: 3, dispatchRouted: 1, standalone: 2, last: '2026-11-19', unreadable: 0 });
    assert.deepStrictEqual(ok.dispatchFirings, FIRINGS);
    const bad = await collectFunnel({ repo: 'o/r', runs: { error: 'x' }, scopeError: 'y' }, deps([verdict(true)]));
    assert.deepStrictEqual(bad.driverRuns, { error: 'x' });
    assert.deepStrictEqual(bad.dispatchFirings, { error: 'y' });
    for (const k of ['checked', 'admitted', 'unreadable', 'reasons', 'simulations', 'runDate', 'pluginVersion']) assert.deepStrictEqual(bad[k], base[k]);
  } finally {
    fs.rmSync(pipes, { recursive: true, force: true });
    fs.rmSync(projects, { recursive: true, force: true });
  }
});

// ---- driver activity through the CLI (#6012): the Driver runs / Dispatch firings lines and the flag line ----
const { run: cliRun } = require(path.join(ROOT, 'tools', 'pipeline-cost-report.js'));

const FLAG = (t, r) => `Admitted records were not driven: ${t} dispatch firings in the window, ${r} reached the driver route.`;
const NOT_DRIVEN = 'Admitted records were not driven';

// A main checkout, a projects root with AC2's two dispatch sessions (cwd = the main checkout) and a pipelines dir with
// AC1's runs (or an empty one); `admitted` records are listed and the check admits them all.
const cliFixture = ({ admitted = 15, runs = true, sessions = true } = {}) => {
  const main = tmp();
  const projects = tmp();
  const pipes = runs ? driverFixture() : tmp();
  if (sessions) {
    const at = (ts, o) => dispatchLines(ts, o).map((l) => l.split('/w/repo').join(main));
    writeT(path.join(projects, 'slug', 'a.jsonl'), at('2026-11-19T09:00:00Z', { route: true, version: '6.175.0' }));
    writeT(path.join(projects, 'slug', 'b.jsonl'), at('2026-11-19T10:00:00Z'));
  }
  const logs = [];
  const errs = [];
  const home = tmp();
  const cleanup = () => {
    for (const d of [main, projects, pipes, home]) fs.rmSync(d, { recursive: true, force: true });
  };
  const base = ['--since', '2026-11-08', '--until', '2026-11-21', '--projects', projects, '--pipelines', pipes, '--section', 'funnel'];
  const depsFor = (extra = {}) => ({
    gh: (args) => (args[0] === 'repo' ? 'o/r\n' : JSON.stringify(Array.from({ length: admitted }, (_, i) => ({ number: i + 1 })))),
    check: async () => verdict(true),
    now: () => new Date('2026-11-21T12:00:00Z'),
    pluginVersion: () => '9.9.9',
    git: () => path.join(main, '.git'),
    cwd: main,
    home,
    log: (s) => logs.push(s),
    err: (s) => errs.push(s),
    ...extra,
  });
  return { main, projects, pipes, logs, errs, base, depsFor, cleanup };
};
const gitFails = () => {
  throw new Error('not a git repository');
};

test('AC3.1: admitted records with only standalone runs print the flag line with the fixture counts', async () => {
  const f = cliFixture({ runs: false });
  try {
    mkRun(f.pipes, '2026-11-12T190721-drive-4351');
    assert.strictEqual(await cliRun({ argv: f.base, deps: f.depsFor() }), 0);
    const md = f.logs.join('\n');
    assert.ok(md.includes(FLAG(2, 1)), md);
    assert.ok(md.includes('Driver runs: 1 (0 dispatch-routed, 1 standalone); last 2026-11-12; unreadable: 0.'), md);
  } finally {
    f.cleanup();
  }
});

test('AC3.2: one dispatch-routed run in the window silences the flag line', async () => {
  const f = cliFixture({ runs: false });
  try {
    mkRun(f.pipes, '2026-11-12T190721-drive-4351');
    mkRun(f.pipes, 'archive/2026-11-19T090000-record-5270', { lane: 'driver' });
    assert.strictEqual(await cliRun({ argv: f.base, deps: f.depsFor() }), 0);
    const md = f.logs.join('\n');
    assert.ok(!md.includes(NOT_DRIVEN), md);
    assert.ok(md.includes('Driver runs: 2 (1 dispatch-routed, 1 standalone)'), md);
  } finally {
    f.cleanup();
  }
});

test('AC4.1: --json carries driverRuns and dispatchFirings with the Markdown figures', async () => {
  const f = cliFixture();
  try {
    assert.strictEqual(await cliRun({ argv: [...f.base, '--json'], deps: f.depsFor() }), 0);
    const json = JSON.parse(f.logs.join('\n'));
    assert.deepStrictEqual(json.funnel.driverRuns, { total: 3, dispatchRouted: 1, standalone: 2, last: '2026-11-19', unreadable: 0 });
    assert.deepStrictEqual(json.funnel.dispatchFirings, FIRINGS);
    f.logs.length = 0;
    assert.strictEqual(await cliRun({ argv: f.base, deps: f.depsFor() }), 0);
    const md = f.logs.join('\n');
    assert.ok(md.includes('Driver runs: 3 (1 dispatch-routed, 2 standalone); last 2026-11-19; unreadable: 0.'), md);
    assert.ok(md.includes('Dispatch firings: 2; reached the driver route: 1; by plugin version: 6.175.0 1, unknown 1; unreadable: 0.'), md);
  } finally {
    f.cleanup();
  }
});

test('AC5.1: an unparseable transcript adds to the report unreadable figure and the run exits 0', async () => {
  const f = cliFixture();
  try {
    fs.writeFileSync(path.join(f.projects, 'slug', 'bad.jsonl'), 'not json\n');
    assert.strictEqual(await cliRun({ argv: [...f.base, '--json'], deps: f.depsFor() }), 0);
    const json = JSON.parse(f.logs.join('\n'));
    assert.strictEqual(json.funnel.dispatchFirings.unreadable, 1);
    assert.strictEqual(json.unreadable, 1);
    assert.strictEqual(json.funnel.unreadable, 0);
  } finally {
    f.cleanup();
  }
});

test('AC6.1: admitted records with no run dirs and no transcripts print the zero flag line', async () => {
  const f = cliFixture({ runs: false, sessions: false });
  try {
    assert.strictEqual(await cliRun({ argv: f.base, deps: f.depsFor() }), 0);
    const md = f.logs.join('\n');
    assert.ok(md.includes(FLAG(0, 0)), md);
    assert.ok(md.includes('Driver runs: 0 (0 dispatch-routed, 0 standalone); last none; unreadable: 0.'), md);
    assert.ok(md.includes('Dispatch firings: 0; reached the driver route: 0; by plugin version: none; unreadable: 0.'), md);
  } finally {
    f.cleanup();
  }
});

test('no admitted records: no flag line even with no driver runs', async () => {
  const f = cliFixture({ admitted: 0, runs: false, sessions: false });
  try {
    assert.strictEqual(await cliRun({ argv: f.base, deps: f.depsFor() }), 0);
    assert.ok(!f.logs.join('\n').includes(NOT_DRIVEN));
  } finally {
    f.cleanup();
  }
});

test('foreign dispatch session: one outside the main checkout is not counted under the default scope', async () => {
  const f = cliFixture();
  try {
    writeT(path.join(f.projects, 'other', 'x.jsonl'), dispatchLines('2026-11-19T11:00:00Z').map((l) => l.split('/w/repo').join(`${f.main}-marketplace`)));
    assert.strictEqual(await cliRun({ argv: [...f.base, '--json'], deps: f.depsFor() }), 0);
    assert.strictEqual(JSON.parse(f.logs.join('\n')).funnel.dispatchFirings.total, 2);
    f.logs.length = 0;
    assert.strictEqual(await cliRun({ argv: [...f.base, '--all-projects', '--json'], deps: f.depsFor() }), 0);
    assert.strictEqual(JSON.parse(f.logs.join('\n')).funnel.dispatchFirings.total, 3);
  } finally {
    f.cleanup();
  }
});

test('dispatch firings are counted once when a projects root is passed twice through a symlink', async () => {
  const f = cliFixture();
  const linkDir = tmp();
  try {
    const link = path.join(linkDir, 'link');
    fs.symlinkSync(f.projects, link);
    assert.strictEqual(await cliRun({ argv: [...f.base, '--projects', link, '--json'], deps: f.depsFor() }), 0);
    assert.strictEqual(JSON.parse(f.logs.join('\n')).funnel.dispatchFirings.total, 2);
  } finally {
    fs.rmSync(linkDir, { recursive: true, force: true });
    f.cleanup();
  }
});

test('pipelines unavailable: prints Driver runs: unavailable, no flag line, exit unchanged', async () => {
  const f = cliFixture();
  try {
    const argv = f.base.filter((a, i, all) => a !== '--pipelines' && all[i - 1] !== '--pipelines');
    assert.strictEqual(await cliRun({ argv: [...argv, '--all-projects'], deps: f.depsFor({ git: gitFails }) }), 0);
    const md = f.logs.join('\n');
    assert.ok(md.includes('Driver runs: unavailable — cannot resolve the pipelines directory'), md);
    assert.ok(md.includes('Dispatch firings: 2;'), md);
    assert.ok(!md.includes(NOT_DRIVEN), md);
  } finally {
    f.cleanup();
  }
});

test('unresolvable main checkout: Dispatch firings unavailable, funnel still renders', async () => {
  const f = cliFixture();
  try {
    assert.strictEqual(await cliRun({ argv: f.base, deps: f.depsFor({ git: gitFails }) }), 0);
    const md = f.logs.join('\n');
    assert.ok(md.includes('Dispatch firings: unavailable — cannot resolve the main checkout (not a git repository); pass --match <substring> or --all-projects'), md);
    assert.ok(!md.includes(NOT_DRIVEN), md);
  } finally {
    f.cleanup();
  }
});

test('plugin versions are listed in numeric version order, not by text or first sight', async () => {
  const f = cliFixture();
  try {
    writeT(path.join(f.projects, 'slug', 'c.jsonl'), dispatchLines('2026-11-19T11:00:00Z', { version: '6.100.0' }).map((l) => l.split('/w/repo').join(f.main)));
    writeT(path.join(f.projects, 'slug', 'g.jsonl'), dispatchLines('2026-11-19T12:00:00Z', { version: '6.99.0' }).map((l) => l.split('/w/repo').join(f.main)));
    assert.strictEqual(await cliRun({ argv: f.base, deps: f.depsFor() }), 0);
    assert.ok(f.logs.join('\n').includes('by plugin version: 6.99.0 1, 6.100.0 1, 6.175.0 1, unknown 1;'), f.logs.join('\n'));
  } finally {
    f.cleanup();
  }
});

test('a corrupt run manifest adds to the report unreadable figure, not the funnel one', async () => {
  const f = cliFixture();
  try {
    fs.writeFileSync(path.join(f.pipes, 'archive', '2026-11-19T090000-record-5270', 'manifest.json'), '{');
    assert.strictEqual(await cliRun({ argv: [...f.base, '--json'], deps: f.depsFor() }), 0);
    const json = JSON.parse(f.logs.join('\n'));
    assert.strictEqual(json.funnel.driverRuns.unreadable, 1);
    assert.strictEqual(json.funnel.unreadable, 0);
    assert.strictEqual(json.unreadable, 1);
  } finally {
    f.cleanup();
  }
});

test('unavailable firings print no flag line even when no run was dispatch-routed', async () => {
  const f = cliFixture({ runs: false });
  try {
    mkRun(f.pipes, '2026-11-12T190721-drive-4351');
    assert.strictEqual(await cliRun({ argv: f.base, deps: f.depsFor({ git: gitFails }) }), 0);
    const md = f.logs.join('\n');
    assert.ok(md.includes('Dispatch firings: unavailable'), md);
    assert.ok(!md.includes(NOT_DRIVEN) && !md.includes('undefined'), md);
  } finally {
    f.cleanup();
  }
});

test('F1: --section funnel counts an unresolvable --projects root in unreadable', async () => {
  const f = cliFixture();
  try {
    const missing = path.join(f.main, 'no-such-projects-root');
    const argv = ['--since', '2026-11-08', '--until', '2026-11-21', '--projects', missing, '--pipelines', f.pipes, '--section', 'funnel', '--json'];
    assert.strictEqual(await cliRun({ argv, deps: f.depsFor() }), 0);
    assert.strictEqual(JSON.parse(f.logs.join('\n')).unreadable, 1);
  } finally {
    f.cleanup();
  }
});

test('F4: under a shared transcript cache each main transcript is scanned once across spend and the funnel', async () => {
  const { collectSpend } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'spend.js'));
  const projects = firingFixture();
  try {
    fs.writeFileSync(path.join(projects, 'slug', 'bad.jsonl'), 'not json\n');
    const args = { roots: [projects], since: new Date('2026-11-08T00:00:00Z'), until: new Date('2026-11-21T00:00:00Z') };
    const fargs = { roots: [projects], ...WINDOW };
    const counted = () => {
      const opens = {};
      return { opens, fsImpl: { ...fs, createReadStream: (f, o) => { opens[f] = (opens[f] || 0) + 1; return fs.createReadStream(f, o); } } };
    };
    const plain = counted();
    const spendPlain = await collectSpend(args, { fsImpl: plain.fsImpl });
    const firingsPlain = await collectDispatchFirings(fargs, { fsImpl: plain.fsImpl });
    assert.ok(Object.values(plain.opens).every((n) => n === 2), JSON.stringify(plain.opens));

    const shared = counted();
    const transcriptCache = new Map();
    const spendCached = await collectSpend(args, { fsImpl: shared.fsImpl, transcriptCache });
    const firingsCached = await collectDispatchFirings(fargs, { fsImpl: shared.fsImpl, transcriptCache });
    assert.strictEqual(Object.keys(shared.opens).length, 3);
    assert.ok(Object.values(shared.opens).every((n) => n === 1), JSON.stringify(shared.opens));
    assert.deepStrictEqual(firingsCached, firingsPlain);
    assert.deepStrictEqual(spendCached, spendPlain);
    assert.strictEqual(firingsCached.unreadable, 1);
    assert.ok([...transcriptCache.values()].every((v) => v.error === true || !('requests' in v)));
  } finally {
    fs.rmSync(projects, { recursive: true, force: true });
  }
});
