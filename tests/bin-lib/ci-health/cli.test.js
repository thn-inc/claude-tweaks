'use strict';
// Record #5161 — plugin/bin/ci-health.js's run(argv, deps): argument rules, the repo resolution,
// the exit codes, the fixed report lines (lib/ci-health/render.js) and threshold filing under
// --file, with every side effect injected. The fake runner branches on the `gh api` path
// (args[3]) and throws `unexpected …` on anything else. No test name carries an amount.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('../../helpers/read-skill');
const { installStub, STUB_SKIP } = require('../../helpers/path-stub');
const { run, realDeps, issueListArgs, issueCreateArgs, issueDeps } = require('../../../plugin/bin/ci-health');
const { BREACH_TITLE } = require('../../../plugin/bin/lib/ci-health/thresholds');

const NOW = new Date('2026-11-12T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const CI = '.github/workflows/ci.yml';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'ci-health');
const fixture = (name) => readText(path.join(FIXTURES, name));

const ORG = 'example-org/widgets';
const USER = 'example-user/widgets';
const ORG_BUDGETS = 'organizations/example-org/settings/billing/budgets';
const ORG_SUMMARY = 'organizations/example-org/settings/billing/usage/summary';
const USER_USAGE = 'users/example-user/settings/billing/usage';

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

let seq = 0;
function wfRun({ name = 'ci.yml', p = CI, event = 'pull_request', created, seconds, conclusion = 'success', branch = 'main' }) {
  seq += 1;
  const start = new Date(created).getTime();
  return {
    id: seq, name, path: p, event, status: 'completed', conclusion,
    head_branch: branch, head_sha: `sha-${seq}`,
    head_repository: { full_name: ORG }, repository: { full_name: ORG },
    created_at: iso(start), run_started_at: iso(start), updated_at: iso(start + seconds * 1000),
  };
}

// AC1.1: one week of pull_request runs on ci.yml — p50 800 s, p90 1300 s.
const ac1Runs = () => [600, 700, 800, 1200, 1300].map((seconds, i) =>
  wfRun({ created: NOW.getTime() - 3 * DAY + i * HOUR, seconds }));
const fullPage = (seconds = 1000) => Array.from({ length: 100 }, (_, i) =>
  wfRun({ created: NOW.getTime() - 2 * DAY + i * 60 * 1000, seconds }));

function ghError(stderr) {
  const err = new Error(`Command failed: gh api\n${stderr}`);
  err.stderr = stderr;
  return err;
}
const http = (status) => ghError(`gh: request failed (HTTP ${status})`);

// pages: one entry per runs page — an array of runs or an Error.
const runsRoute = (pages) => (args) => {
  const n = Number(args.find((a) => a.startsWith('page=')).slice('page='.length));
  const entry = pages[n - 1];
  if (entry === undefined) throw new Error('unexpected ' + args.join(' '));
  return entry instanceof Error ? entry : { total_count: 0, workflow_runs: entry };
};

function orgRoutes(slug, pages = [[]]) {
  return {
    [`repos/${slug}`]: fixture('repo-org.json'),
    [`repos/${slug}/actions/runs`]: runsRoute(pages),
    [ORG_BUDGETS]: fixture('org-budgets.json'),
    [ORG_SUMMARY]: fixture('org-usage-summary.json'),
  };
}

function userRoutes(pages = [[]]) {
  return {
    [`repos/${USER}`]: fixture('repo-user.json'),
    [`repos/${USER}/actions/runs`]: runsRoute(pages),
    [USER_USAGE]: fixture('user-usage.json'),
  };
}

function deps({ routes = orgRoutes(ORG), remote = `https://github.com/${ORG}.git`, ...overrides } = {}) {
  const out = { stdout: [], stderr: [], calls: [], pinned: [], remoteReads: 0, titles: [], created: [], workTypes: 0 };
  const d = {
    runner: (args) => {
      out.calls.push(args);
      if (args[0] !== 'api' || args[1] !== '--method' || args[2] !== 'GET') throw new Error('unexpected ' + args.join(' '));
      let entry = routes[args[3]];
      if (typeof entry === 'function') entry = entry(args);
      if (entry === undefined) throw new Error('unexpected ' + args.join(' '));
      if (entry instanceof Error) throw entry;
      return typeof entry === 'string' ? entry : JSON.stringify(entry);
    },
    remoteUrl: () => { out.remoteReads += 1; return `${remote}\n`; },
    pinGhHost: (spec) => { out.pinned.push(spec); },
    workTypes: () => { out.workTypes += 1; return 'labels'; },
    openIssueTitles: (slug) => { out.titles.push(slug); return []; },
    createIssue: (slug, issue) => { out.created.push({ slug, issue }); return { number: 42 }; },
    now: NOW,
    stdout: (s) => out.stdout.push(s),
    stderr: (s) => out.stderr.push(s),
    ...overrides,
  };
  return { d, out };
}

const lines = (out) => out.stdout.join('').split('\n').filter(Boolean);
const envelope = (out) => {
  assert.equal(out.stdout.length, 1, 'one stdout write');
  assert.ok(out.stdout[0].endsWith('\n') && !out.stdout[0].slice(0, -1).includes('\n'), '--json prints one line');
  return JSON.parse(out.stdout[0]);
};
const ciLine = (out) => lines(out).find((l) => l.startsWith('ci.yml ('));

test('--help exits 0 before any runner call or origin read', () => {
  const { d, out } = deps();
  assert.equal(run(['--help'], d), 0);
  assert.equal(out.stdout.join(''), 'usage: ci-health.js [--days N] [--repo owner/name] [--min-headroom-pct N] [--file] [--json] [--help|-h]\n');
  const short = deps();
  assert.equal(run(['-h'], short.d), 0);
  assert.equal(short.out.stdout.join(''), out.stdout.join(''));
  assert.equal(out.calls.length, 0);
  assert.equal(out.remoteReads, 0);
});

test('usage: each malformed invocation exits 2 with one stderr line, empty stdout and zero runner calls', () => {
  const cases = [
    ['--days', '0'], ['--days', 'abc'], ['--days'], ['--days', ''], ['--days', '401'], ['--days', '1.5'], ['--days', ' '],
    ['--days', '--json'], ['--min-headroom-pct', '101'], ['--min-headroom-pct'], ['--min-headroom-pct', ''],
    ['--min-headroom-pct', '-1'], ['--min-headroom-pct', ' '], ['--bogus'],
    ['--repo', '-evil/x'], ['--repo', 'acme/.'], ['--repo', 'acme/..'], ['--repo', './x'], ['--repo', '../x'],
    ['--repo'], ['--repo', ''], ['--repo', 'ghe.example.com/acme/widgets'], ['--repo', 'acme/x\nbilling: fake'],
  ];
  for (const argv of cases) {
    const { d, out } = deps();
    assert.equal(run(argv, d), 2, JSON.stringify(argv));
    assert.deepEqual(out.stdout, [], JSON.stringify(argv));
    assert.equal(out.stderr.length, 1, JSON.stringify(argv));
    assert.match(out.stderr[0], /^ci-health\.js: [^\n]*\n$/, JSON.stringify(argv));
    assert.equal(out.calls.length, 0, JSON.stringify(argv));
    assert.equal(out.remoteReads, 0, JSON.stringify(argv));
  }
});

test('origin: a non-github.com, unparsable or unreadable origin exits 2 with one stderr line and no runner call', () => {
  for (const remote of ['git@ghe.example.com:acme/widgets.git', 'ssh://git@acme.ghe.com/acme/widgets.git', 'garbage', 'https://github.com/-evil/widgets.git']) {
    const { d, out } = deps({ remote });
    assert.equal(run([], d), 2, remote);
    assert.deepEqual(out.stdout, [], remote);
    assert.equal(out.stderr.length, 1, remote);
    assert.equal(out.calls.length, 0, remote);
  }
  const ghe = deps({ remote: 'git@ghe.example.com:acme/widgets.git' });
  run([], ghe.d);
  assert.match(ghe.out.stderr[0], /origin remote is on ghe\.example\.com, not github\.com/);
  for (const remote of ['https://user:secret@example.com/x/y', 'https://user:secret@example.com/onlyone']) {
    const r = deps({ remote });
    assert.equal(run([], r.d), 2, remote);
    assert.equal(r.out.stderr.length, 1, remote);
    assert.doesNotMatch(r.out.stderr[0], /secret|user:/, remote);
  }
  const echoed = deps({ remote: 'https://user:secret@example.com/onlyone' });
  run([], echoed.d);
  assert.match(echoed.out.stderr[0], /origin remote is not a GitHub URL: https:\/\/example\.com\/onlyone$/m);
  const unreadable = deps({ remoteUrl: () => { throw new Error('fatal: not a git repository'); } });
  assert.equal(run([], unreadable.d), 2);
  assert.equal(unreadable.out.stderr.length, 1);
  assert.deepEqual(unreadable.out.calls, []);
});

test('--repo pins the github.com host, skips the origin read, and addresses every read at that slug', () => {
  const { d, out } = deps({ routes: orgRoutes('acme/widgets') });
  assert.equal(run(['--repo', 'acme/widgets', '--json'], d), 0);
  assert.deepEqual(out.pinned, [{ host: 'github.com' }]);
  assert.equal(out.remoteReads, 0);
  assert.equal(envelope(out).repo, 'acme/widgets');
  assert.deepEqual(out.calls[0], ['api', '--method', 'GET', 'repos/acme/widgets']);
  assert.deepEqual(out.calls[1], ['api', '--method', 'GET', 'repos/acme/widgets/actions/runs',
    '-f', 'created=>=2026-10-13', '-f', 'per_page=100', '-f', 'page=1']);
});

test('the origin path pins nothing and reads origin once; --days sets the window from now', () => {
  const { d, out } = deps();
  assert.equal(run(['--days', '7', '--json'], d), 0);
  assert.deepEqual(out.pinned, []);
  assert.equal(out.remoteReads, 1);
  const env = envelope(out);
  assert.equal(env.repo, ORG);
  assert.deepEqual(env.window, { days: 7, from: '2026-11-05' });
  assert.deepEqual(Object.keys(env), ['repo', 'window', 'truncated', 'ghAbsent', 'workflows', 'watchSeconds',
    'minHeadroomPct', 'billing', 'failures', 'breaches', 'filed', 'filingSkipped']);
  assert.equal(env.watchSeconds, 900);
  assert.equal(env.minHeadroomPct, 10);
  assert.equal(env.filed, null);
  assert.equal(env.filingSkipped, null);
});

test('AC1.1 render: the AC1 fixture renders its workflow line, over the merge-gate watch', () => {
  const { d, out } = deps({ routes: orgRoutes(ORG, [ac1Runs()]) });
  assert.equal(run([], d), 0);
  const all = lines(out);
  assert.equal(all[0], 'ci health: example-org/widgets, last 30 days (from 2026-10-13)');
  assert.equal(ciLine(out),
    'ci.yml (.github/workflows/ci.yml): 5 runs, p50 800s, p90 1300s — over the 900s merge-gate watch, trend insufficient, superseded 0 (n/a), cancelled 0');
  assert.ok(all.includes('breach: ci.yml (.github/workflows/ci.yml) p90 1300s over the 900s merge-gate watch'), all.join('\n'));
  assert.ok(all.includes('billing: Actions budget headroom 5% (floor 10%)'), all.join('\n'));
  assert.ok(all.includes('breach: Actions budget headroom 5% below the 10% floor'), all.join('\n'));
  assert.ok(!all.some((l) => /^(filed|not filed)/.test(l)), 'no filing line without --file');
});

test('AC1.1 render with no-work runs: a skipped run counts in runs and no-work, never in the percentiles', () => {
  const runs = [...ac1Runs(), wfRun({ created: NOW.getTime() - DAY, seconds: 5, conclusion: 'skipped' })];
  const text = deps({ routes: orgRoutes(ORG, [runs]) });
  assert.equal(run([], text.d), 0);
  assert.ok(ciLine(text.out).startsWith('ci.yml (.github/workflows/ci.yml): 6 runs, p50 800s, p90 1300s'), ciLine(text.out));
  assert.ok(ciLine(text.out).includes(', no-work 1'), ciLine(text.out));
  assert.ok(!ciLine(text.out).includes(', skipped '), ciLine(text.out));
  const json = deps({ routes: orgRoutes(ORG, [runs]) });
  assert.equal(run(['--json'], json.d), 0);
  const ci = envelope(json.out).workflows.find((w) => w.path === CI);
  assert.equal(ci.noWorkRuns, 1);
  assert.equal(ci.skippedRuns, 0);
  assert.equal(ci.runs, 6);
});

test('render: the trend, superseded share, skipped count and push suffix each render exactly', () => {
  const wf = (name) => ({ name, p: `.github/workflows/${name}` });
  const recent = (h) => NOW.getTime() - DAY + h * HOUR;
  const runs = [
    // --days 14 from 2026-10-29: two full weeks, five runs each, p50 100 s then 150 s.
    ...[0, 1, 2, 3, 4].map((i) => wfRun({ ...wf('trend.yml'), created: Date.parse('2026-10-30T00:00:00Z') + i * HOUR, seconds: 100 })),
    ...[0, 1, 2, 3, 4].map((i) => wfRun({ ...wf('trend.yml'), created: Date.parse('2026-11-06T00:00:00Z') + i * HOUR, seconds: 150 })),
    // Two runs on one feature branch: the older head is superseded by the newer one.
    wfRun({ ...wf('sup.yml'), branch: 'feature', created: recent(0), seconds: 60 }),
    wfRun({ ...wf('sup.yml'), branch: 'feature', created: recent(1), seconds: 60 }),
    // A completed run whose run_started_at is after its updated_at.
    wfRun({ ...wf('skip.yml'), created: recent(0), seconds: 60 }),
    wfRun({ ...wf('skip.yml'), created: recent(1), seconds: -5 }),
    // The repo's only push workflow, over ten distinct push shas.
    ...Array.from({ length: 10 }, (_, i) => wfRun({ ...wf('push.yml'), event: 'push', created: recent(i), seconds: 60 })),
  ];
  const { d, out } = deps({ routes: orgRoutes(ORG, [runs]) });
  assert.equal(run(['--days', '14'], d), 0);
  const all = lines(out);
  for (const expected of [
    'trend.yml (.github/workflows/trend.yml): 10 runs, p50 100s, p90 150s, trend rising 1.5, superseded 0 (n/a), cancelled 0',
    'sup.yml (.github/workflows/sup.yml): 2 runs, p50 60s, p90 60s, trend insufficient, superseded 1 (0.5), cancelled 0',
    'skip.yml (.github/workflows/skip.yml): 2 runs, p50 60s, p90 60s, trend insufficient, superseded 0 (n/a), cancelled 0, skipped 1',
    "push.yml (.github/workflows/push.yml): 10 runs, p50 60s, p90 60s, trend insufficient, superseded 0 (n/a), cancelled 0, runs on 100% of pushes (informational; a repo's only push workflow always reads 100%)",
  ]) assert.ok(all.includes(expected), `missing: ${expected}\n${all.join('\n')}`);
});

test('render: a p90 over the watch reads as over the merge-gate watch only on a pull_request workflow', () => {
  const slow = (event) => [0, 1, 2, 3, 4].map((i) =>
    wfRun({ name: `${event}.yml`, p: `.github/workflows/${event}.yml`, event, created: NOW.getTime() - DAY + i * HOUR, seconds: 1000 }));
  const { d, out } = deps({ routes: orgRoutes(ORG, [[...slow('push'), ...slow('schedule'), ...slow('pull_request')]]) });
  assert.equal(run([], d), 0);
  const all = lines(out);
  const tail = ', trend insufficient, superseded 0 (n/a), cancelled 0';
  assert.ok(all.includes(`push.yml (.github/workflows/push.yml): 5 runs, p50 1000s, p90 1000s${tail}`), all.join('\n'));
  assert.ok(all.includes(`schedule.yml (.github/workflows/schedule.yml): 5 runs, p50 1000s, p90 1000s${tail}`), all.join('\n'));
  assert.ok(all.includes(`pull_request.yml (.github/workflows/pull_request.yml): 5 runs, p50 1000s, p90 1000s — over the 900s merge-gate watch${tail}`), all.join('\n'));
});

for (const status of [404, 403, 410]) {
  test(`AC4.1 render / AC4.2: an org budgets read failing HTTP ${status} renders billing unavailable (${status}) and never "no budget"`, () => {
    const routes = { ...orgRoutes(ORG), [ORG_BUDGETS]: http(status) };
    const { d, out } = deps({ routes });
    assert.equal(run([], d), 0);
    const all = lines(out);
    assert.ok(all.includes(`billing unavailable (${status})`), all.join('\n'));
    for (const line of all) assert.doesNotMatch(line, /no (Actions )?budget|no spend/i);
  });
}

test('AC5.1: gh absent exits 2, both halves read unavailable from ghAbsent, nothing claims absence of data', () => {
  const absent = () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); };
  const json = deps({ runner: absent });
  assert.equal(run(['--json'], json.d), 2);
  const env = envelope(json.out);
  assert.equal(env.ghAbsent, true);
  assert.deepEqual(env.billing, { available: false, status: null, reason: 'owner type unreadable' });
  assert.deepEqual(env.failures, []);
  assert.deepEqual(env.workflows, []);
  const text = deps({ runner: absent });
  assert.equal(run([], text.d), 2);
  const all = lines(text.out);
  assert.ok(all.includes('runs unavailable (gh absent)'), all.join('\n'));
  assert.ok(all.includes('billing unavailable (gh absent)'), all.join('\n'));
  for (const line of all) assert.doesNotMatch(line, /no workflow runs|no Actions budget|headroom \d/);
});

test('AC6.1: an empty window with --file exits 0, reports no runs and files nothing', () => {
  const json = deps({ routes: userRoutes([[]]), remote: `https://github.com/${USER}.git` });
  assert.equal(run(['--file', '--json'], json.d), 0);
  const env = envelope(json.out);
  assert.deepEqual(env.workflows, []);
  assert.deepEqual(env.breaches, []);
  assert.equal(env.filingSkipped, 'no breach');
  assert.deepEqual(json.out.created, []);
  const text = deps({ routes: userRoutes([[]]), remote: `https://github.com/${USER}.git` });
  assert.equal(run(['--file'], text.d), 0);
  assert.ok(lines(text.out).includes('no workflow runs in the last 30 days'), lines(text.out).join('\n'));
  // `no breach` stays in the envelope; a report with no breach: line prints no filing line.
  assert.ok(!lines(text.out).some((l) => /^(filed|not filed)/.test(l)), lines(text.out).join('\n'));
  assert.deepEqual(text.out.created, []);
});

test('AC7.1: a failed page 2 is a partial report — exit 0, page 1 workflows, the failure named', () => {
  const { d, out } = deps({ routes: orgRoutes(ORG, [fullPage(), http(500)]) });
  assert.equal(run(['--json'], d), 0);
  const env = envelope(out);
  assert.equal(env.workflows.reduce((sum, w) => sum + w.runs, 0), 100);
  assert.equal(env.failures[0].query, 'runs page 2');
  assert.equal(env.truncated, false);
});

test('a failed runs read never files: page 2 failing with a p90 breach under --file creates nothing', () => {
  const json = deps({ routes: orgRoutes(ORG, [fullPage(1000), http(500)]) });
  assert.equal(run(['--file', '--json'], json.d), 0);
  const env = envelope(json.out);
  assert.ok(env.breaches.some((b) => b.kind === 'p90-over-watch'));
  assert.equal(env.filed, null);
  assert.equal(env.filingSkipped, 'runs read failed');
  assert.deepEqual(json.out.created, []);
  assert.deepEqual(json.out.titles, []);
  const text = deps({ routes: orgRoutes(ORG, [fullPage(1000), http(500)]) });
  assert.equal(run(['--file'], text.d), 0);
  assert.ok(lines(text.out).includes('not filed: runs read failed'), lines(text.out).join('\n'));
  assert.deepEqual(text.out.created, []);
});

test('a failed page 1 never files: HTTP 500 with a headroom-only breach under --file exits 2 and creates nothing', () => {
  const json = deps({ routes: orgRoutes(ORG, [http(500)]) });
  assert.equal(run(['--file', '--json'], json.d), 2);
  const env = envelope(json.out);
  assert.deepEqual(env.breaches, [{ kind: 'headroom-below-floor', headroomPct: 5, floor: 10 }]);
  assert.equal(env.filed, null);
  assert.equal(env.filingSkipped, 'runs read failed');
  assert.deepEqual(json.out.created, []);
  assert.deepEqual(json.out.titles, []);
  const text = deps({ routes: orgRoutes(ORG, [http(500)]) });
  assert.equal(run(['--file'], text.d), 2);
  assert.ok(lines(text.out).includes('not filed: runs read failed'), lines(text.out).join('\n'));
  assert.deepEqual(text.out.created, []);
});

test('gh vanishing after page 1 is a failed runs read, never gh absent: --file with a p90 breach files nothing', () => {
  const enoent = () => Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' });
  // Page 1 answers; every later call (page 2, then billing) finds no gh.
  const vanishing = () => {
    const base = deps({ routes: orgRoutes(ORG, [fullPage(1000), fullPage(1000)]) });
    const answered = base.d.runner;
    let pageOneRead = false;
    base.d.runner = (args) => {
      if (pageOneRead) { base.out.calls.push(args); throw enoent(); }
      const out = answered(args);
      if (args.includes('page=1')) pageOneRead = true;
      return out;
    };
    return base;
  };
  const json = vanishing();
  assert.equal(run(['--file', '--json'], json.d), 0);
  const env = envelope(json.out);
  assert.equal(env.ghAbsent, false);
  assert.ok(env.breaches.some((b) => b.kind === 'p90-over-watch'));
  // The billing read gh vanished under is a query that did not complete, so failures[] names it.
  assert.deepEqual(env.failures.map((f) => f.query), ['runs page 2', 'billing budgets']);
  assert.equal(env.filed, null);
  assert.equal(env.filingSkipped, 'runs read failed');
  assert.deepEqual(json.out.created, []);
  const text = vanishing();
  assert.equal(run(['--file'], text.d), 0);
  const all = lines(text.out);
  assert.ok(all.includes('not filed: runs read failed'), all.join('\n'));
  assert.ok(all.includes('failed read: runs page 2: spawnSync gh ENOENT'), all.join('\n'));
  assert.ok(all.includes('failed read: billing budgets: spawnSync gh ENOENT'), all.join('\n'));
  assert.ok(!all.some((l) => l.includes('gh absent')), all.join('\n'));
  assert.deepEqual(text.out.created, []);
});

test('gh absent from runs page 1 on: the billing read it fails adds no failure row', () => {
  const base = deps();
  const answered = base.d.runner;
  // The repo read answers; runs page 1 and the billing read find no gh.
  base.d.runner = (args) => {
    if (args[3] === `repos/${ORG}`) return answered(args);
    base.out.calls.push(args);
    throw Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' });
  };
  assert.equal(run(['--json'], base.d), 2);
  const env = envelope(base.out);
  assert.equal(env.ghAbsent, true);
  assert.ok(base.out.calls.some((args) => args[3] === ORG_BUDGETS), 'the billing budgets read was attempted');
  assert.deepEqual(env.failures, []);
});

test('AC7.2: every call failing HTTP 500 exits 2', () => {
  const { d, out } = deps({ runner: () => { throw http(500); } });
  assert.equal(run([], d), 2);
  const all = lines(out);
  assert.ok(all.includes('runs unavailable (HTTP 500)'), all.join('\n'));
  assert.ok(all.includes('failed read: runs page 1: gh: request failed (HTTP 500)'), all.join('\n'));
});

test('AC7.2: every runs page failing exits 2 whatever billing returns, with the full report on stdout', () => {
  const { d, out } = deps({ routes: orgRoutes(ORG, [http(500)]) });
  assert.equal(run([], d), 2);
  const all = lines(out);
  assert.equal(all[0], 'ci health: example-org/widgets, last 30 days (from 2026-10-13)');
  assert.ok(all.includes('runs unavailable (HTTP 500)'), all.join('\n'));
  assert.ok(all.includes('billing: Actions budget headroom 5% (floor 10%)'), all.join('\n'));
  assert.ok(!all.includes('no workflow runs in the last 30 days'), all.join('\n'));
  assert.deepEqual(out.stderr, []);
});

test('partial: runs page 1 answers while the org budgets read fails HTTP 404 — exit 0, billing unavailable (404)', () => {
  const routes = { ...orgRoutes(ORG, [ac1Runs()]), [ORG_BUDGETS]: http(404) };
  const { d, out } = deps({ routes });
  assert.equal(run([], d), 0);
  assert.ok(lines(out).includes('billing unavailable (404)'), lines(out).join('\n'));
});

test('AC7.3: a truncated window renders the truncation line and never files, breaches and all', () => {
  const pages = Array.from({ length: 10 }, () => fullPage(1000));
  const json = deps({ routes: orgRoutes(ORG, pages) });
  assert.equal(run(['--file', '--json'], json.d), 0);
  const env = envelope(json.out);
  assert.equal(env.truncated, true);
  assert.ok(env.breaches.some((b) => b.kind === 'p90-over-watch'));
  assert.equal(env.filed, null);
  assert.equal(env.filingSkipped, 'window truncated');
  assert.deepEqual(json.out.created, []);
  const text = deps({ routes: orgRoutes(ORG, pages) });
  assert.equal(run(['--file'], text.d), 0);
  const all = lines(text.out);
  assert.ok(all.includes('window truncated at 1000 runs: statistics cover the newest runs only'), all.join('\n'));
  assert.ok(all.includes('not filed: window truncated'), all.join('\n'));
  assert.deepEqual(text.out.created, []);
});

test('AC7.7 render: a user-owned repo renders billing: no Actions budget to compare', () => {
  const { d, out } = deps({ routes: userRoutes([ac1Runs()]), remote: `https://github.com/${USER}.git` });
  assert.equal(run([], d), 0);
  assert.ok(lines(out).includes('billing: no Actions budget to compare'), lines(out).join('\n'));
});

test('render: a readable budgets body missing its array never reads as no budget; a later budgets page is named', () => {
  const missing = deps({ routes: { ...orgRoutes(ORG), [ORG_BUDGETS]: { has_next_page: false } } });
  assert.equal(run([], missing.d), 0);
  const all = lines(missing.out);
  assert.ok(all.includes('billing: Actions budget headroom unreadable (budgets response has no budgets array)'), all.join('\n'));
  for (const line of all) assert.doesNotMatch(line, /no Actions budget to compare/);
  const paged = { ...JSON.parse(fixture('org-budgets.json')), has_next_page: true };
  const more = deps({ routes: { ...orgRoutes(ORG), [ORG_BUDGETS]: paged } });
  assert.equal(run([], more.d), 0);
  assert.ok(lines(more.out).includes('billing: Actions budget headroom 5% (floor 10%) (first page of budgets only)'), lines(more.out).join('\n'));
});

test('AC8.1 via run: --file under work-types labels files once at the slug with type:task as a label', () => {
  const { d, out } = deps({ routes: orgRoutes(ORG, [ac1Runs()]), workTypes: () => 'labels' });
  assert.equal(run(['--file'], d), 0);
  assert.equal(out.created.length, 1);
  const { slug, issue } = out.created[0];
  assert.equal(slug, ORG);
  assert.equal(issue.title, BREACH_TITLE);
  for (const label of ['by:harness-health', 'risk:low', 'size:low', 'type:task']) assert.ok(issue.labels.includes(label), label);
  assert.equal(issue.type, null);
  assert.deepEqual(out.titles, [ORG]);
  assert.ok(lines(out).includes(`filed #42: ${BREACH_TITLE}`), lines(out).join('\n'));
});

test('AC8.1 via run: --file under native work types passes type task and no type:* label', () => {
  const { d, out } = deps({ routes: orgRoutes(ORG, [ac1Runs()]), workTypes: () => 'native' });
  assert.equal(run(['--file'], d), 0);
  assert.equal(out.created.length, 1);
  const { issue } = out.created[0];
  for (const label of ['by:harness-health', 'risk:low', 'size:low']) assert.ok(issue.labels.includes(label), label);
  assert.ok(!issue.labels.some((l) => l.startsWith('type:')), issue.labels.join(','));
  assert.equal(issue.type, 'task');
});

test('AC8.5: the same breach without --file calls no filing dep and never reads work types', () => {
  const { d, out } = deps({ routes: orgRoutes(ORG, [ac1Runs()]) });
  assert.equal(run([], d), 0);
  assert.deepEqual(out.created, []);
  assert.deepEqual(out.titles, []);
  assert.equal(out.workTypes, 0);
});

test('--file: an open issue with the title skips filing; a failed create is a failed read line and exit 0', () => {
  const dup = deps({ routes: orgRoutes(ORG, [ac1Runs()]), openIssueTitles: () => [BREACH_TITLE] });
  assert.equal(run(['--file'], dup.d), 0);
  assert.deepEqual(dup.out.created, []);
  assert.ok(lines(dup.out).includes('not filed: open issue exists'), lines(dup.out).join('\n'));
  const broken = deps({ routes: orgRoutes(ORG, [ac1Runs()]), createIssue: () => { throw ghError('could not add label: \'risk:low\' not found'); } });
  assert.equal(run(['--file'], broken.d), 0);
  const all = lines(broken.out);
  assert.ok(all.includes('failed read: file issue: could not add label: \'risk:low\' not found'), all.join('\n'));
  assert.ok(!all.some((l) => /^(filed|not filed)/.test(l)), all.join('\n'));
  const brokenJson = deps({ routes: orgRoutes(ORG, [ac1Runs()]), createIssue: () => { throw ghError('HTTP 422'); } });
  assert.equal(run(['--file', '--json'], brokenJson.d), 0);
  const env = envelope(brokenJson.out);
  assert.equal(env.filed, null);
  assert.equal(env.filingSkipped, null);
  assert.deepEqual(env.failures, [{ query: 'file issue', error: 'HTTP 422' }]);
});

test('--file: an unreadable open-title list files nothing and prints a failed read line, exit 0', () => {
  const unread = () => { throw ghError('HTTP 502: Bad Gateway'); };
  const text = deps({ routes: orgRoutes(ORG, [ac1Runs()]), openIssueTitles: unread });
  assert.equal(run(['--file'], text.d), 0);
  assert.deepEqual(text.out.created, []);
  const all = lines(text.out);
  assert.ok(all.includes('failed read: open issue titles: HTTP 502: Bad Gateway'), all.join('\n'));
  assert.ok(!all.some((l) => /^(filed|not filed)/.test(l)), all.join('\n'));
  const json = deps({ routes: orgRoutes(ORG, [ac1Runs()]), openIssueTitles: unread });
  assert.equal(run(['--file', '--json'], json.d), 0);
  assert.deepEqual(json.out.created, []);
  assert.deepEqual(envelope(json.out).failures, [{ query: 'open issue titles', error: 'HTTP 502: Bad Gateway' }]);
});

test('--json: a filed breach carries filed {title, number} and a null filingSkipped', () => {
  const { d, out } = deps({ routes: orgRoutes(ORG, [ac1Runs()]) });
  assert.equal(run(['--file', '--json'], d), 0);
  const env = envelope(out);
  assert.deepEqual(env.filed, { title: BREACH_TITLE, number: 42 });
  assert.equal(env.filingSkipped, null);
});

test('render keeps one line per workflow: a workflow name carrying a newline is collapsed', () => {
  const runs = ac1Runs().map((r) => ({ ...r, name: 'ci\nbilling: Actions budget headroom 99% (floor 10%)' }));
  const { d, out } = deps({ routes: orgRoutes(ORG, [runs]) });
  assert.equal(run([], d), 0);
  const all = lines(out);
  assert.ok(!all.includes('billing: Actions budget headroom 99% (floor 10%)'), all.join('\n'));
  assert.ok(all.some((l) => l.startsWith('ci billing: Actions budget headroom 99% (floor 10%) (.github/workflows/ci.yml): 5 runs')), all.join('\n'));
});

test('realDeps argv pins: the open-title list and the create argv per type branch', () => {
  assert.deepEqual(issueListArgs('acme/widgets'),
    ['issue', 'list', '--repo', 'acme/widgets', '--label', 'by:harness-health', '--state', 'open', '--json', 'title', '--limit', '500']);
  const native = issueCreateArgs('acme/widgets', { title: BREACH_TITLE, labels: ['by:harness-health', 'risk:low', 'size:low'], type: 'task' });
  assert.deepEqual(native.slice(0, 8), ['issue', 'create', '--repo', 'acme/widgets', '--title', BREACH_TITLE, '--body-file', '-']);
  assert.deepEqual(native.slice(8), ['--label', 'by:harness-health', '--label', 'risk:low', '--label', 'size:low', '--type', 'task']);
  const labels = issueCreateArgs('acme/widgets', { title: BREACH_TITLE, labels: ['by:harness-health', 'risk:low', 'size:low', 'type:task'], type: null });
  assert.deepEqual(labels.slice(-4), ['--label', 'size:low', '--label', 'type:task']);
  assert.ok(!labels.includes('--type'));
});

test('realDeps issue seam: titles parsed from the list, the body piped on stdin, the number read from the URL', () => {
  const calls = [];
  const runner = (args, opts) => {
    calls.push({ args, opts });
    if (args[1] === 'list') return JSON.stringify([{ title: BREACH_TITLE }, { title: 'other' }]);
    if (args[1] === 'create') return opts && opts.input === 'BODY' ? 'https://github.com/acme/widgets/issues/77\n' : 'no url\n';
    throw new Error('unexpected ' + args.join(' '));
  };
  const seam = issueDeps(runner);
  assert.deepEqual(seam.openIssueTitles('acme/widgets'), [BREACH_TITLE, 'other']);
  assert.deepEqual(calls[0].args, issueListArgs('acme/widgets'));
  const issue = { title: BREACH_TITLE, body: 'BODY', labels: ['by:harness-health'], type: 'task' };
  assert.deepEqual(seam.createIssue('acme/widgets', issue), { number: 77 });
  assert.deepEqual(calls[1].args, issueCreateArgs('acme/widgets', issue));
  assert.deepEqual(calls[1].opts, { input: 'BODY' });
  assert.deepEqual(seam.createIssue('acme/widgets', { ...issue, body: 'other' }), { number: null });
});

// A real 100-run page is several MiB; execFileSync's 1 MiB default buffer fails it with ENOBUFS.
test('realDeps.runner reads a gh answer past the 1 MiB default buffer', { skip: STUB_SKIP }, () => {
  const restore = installStub('gh', '#!/bin/sh\nhead -c 2097152 /dev/zero | tr "\\000" x\n');
  try {
    assert.equal(realDeps.runner(['api', '--method', 'GET', 'repos/acme/widgets/actions/runs']).length, 2097152);
  } finally {
    restore();
  }
});
