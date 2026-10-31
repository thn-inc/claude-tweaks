'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  postMerge, hasPostMergeMarker, takeClaim, MARKER_STEP, CLOSE_WINDOW_MS, MERGE_GRACE_MS, CLAIM_STALE_MS, CLAIM_FILENAME,
} = require('../../../plugin/bin/lib/reconcile/post-merge');
const { formatEntry, parseEntry } = require('../../../plugin/bin/lib/log-decision/append');

// The real clock at load: claim-file mtimes the code writes are real, so `now` must agree with them.
const NOW = Date.now();
const now = () => NOW;
const MERGED_AT = new Date(NOW - 60 * 60 * 1000).toISOString();
const merged = (mergedAt = MERGED_AT) => ({ number: 0, state: 'MERGED', mergedAt });

function git(root, ...args) {
  cp.execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true });
}

// A temp main checkout: a real git repo with an origin, a CLAUDE.md, and no run dirs yet.
function mainCheckout({ claudeMd = '## Work records\n\nwork-backend: github-issues\n', origin = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'post-merge-')));
  git(root, 'init', '-q');
  if (origin) git(root, 'remote', 'add', 'origin', 'git@github.com:acme/w.git');
  if (claudeMd !== null) fs.writeFileSync(path.join(root, 'CLAUDE.md'), claudeMd);
  return root;
}

function addRun(root, runId, { pr = 11, status = 'in-progress', decisions } = {}) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(dir, { recursive: true });
  const state = { status };
  if (pr !== null) state.pr = { number: pr };
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  if (decisions !== undefined) fs.writeFileSync(path.join(dir, 'decisions.md'), decisions);
  return dir;
}

const decisionsOf = (dir) => {
  try { return fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'); } catch { return ''; }
};
const lockOf = (dir) => path.join(dir, CLAIM_FILENAME);

// prStates fake: `table` maps a PR number to its answer (object or failure string).
function fakePrStates(table) {
  return { byNumberAsync: async (n) => table[n] };
}

// A closing-links fake that prints `envelope` and exits `code`.
function fakeClosingLinks(envelope, code = 0) {
  const calls = [];
  const fn = (argv, d) => {
    calls.push({ argv, deps: d });
    if (envelope) d.stdout(`${JSON.stringify(envelope)}\n`);
    return code;
  };
  fn.calls = calls;
  return fn;
}

function fakeCloseParents(result = { closed: [], skipped: [] }) {
  const calls = [];
  const fn = (args) => { calls.push(args); return result; };
  fn.calls = calls;
  return fn;
}

const ENVELOPE = {
  action: 'nothing-closed', pr: 11, closingSet: [101, 102], reopened: [], pendingClose: [], failed: [],
};
const fakeGh = () => '';

function run(root, { prs, links, close, integration = 'main', dryRun = false, extra = {} } = {}) {
  return postMerge({
    cwd: root,
    integration,
    prStates: fakePrStates(prs),
    dryRun,
    now,
    deps: { gh: fakeGh, closingLinksRun: links, closeParents: close, ...extra },
  });
}

test('merged unmarked run: Step 4.0 argv, Step 4.0b arguments, parent line plus summary marker, entry ran', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const links = fakeClosingLinks({ ...ENVELOPE, action: 'reopened', reopened: [103], pendingClose: [104], failed: [{ issue: 105 }] });
  const close = fakeCloseParents({
    closed: [{ parent: 77, maxTier: 'low' }],
    skipped: [{ parent: 88, reason: 'above-floor' }, { issue: 102, reason: 'gh-failed', detail: 'boom' }],
  });
  const r = await run(root, { prs: { 11: merged() }, links, close });

  assert.deepEqual(r, {
    entries: [{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'reopened', parentsClosed: 1 }],
    deferred: [],
  });
  assert.equal(links.calls.length, 1);
  assert.deepEqual(links.calls[0].argv, [
    '--run', dir, '--mode', 'post-merge', '--settle-ms', '0', '--close-window-ms', String(CLOSE_WINDOW_MS),
  ]);
  const d = links.calls[0].deps;
  assert.equal(d.cwd(), root);
  assert.equal(d.mainRoot, root);
  assert.equal(d.ghAvailable(), true);
  assert.equal(typeof d.gh, 'function');

  assert.equal(close.calls.length, 1);
  assert.deepEqual(close.calls[0], {
    closingSet: [101, 102],
    unsettled: [103, 104, 105],
    mergingPr: 11,
    owner: 'acme',
    repo: 'w',
    workLinks: 'body-text',
    riskFloor: 'high',
    integrationBranch: 'main',
    gh: d.gh,
  });

  const lines = decisionsOf(dir).trim().split('\n').map(parseEntry);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].status, 'AUTO');
  assert.match(lines[0].action, /^closed parent #77 below the oversight floor \(risk:low, risk-floor high\)\. Reversibility: high \(gh issue reopen\)\.$/);
  assert.equal(lines[1].location, MARKER_STEP);
  assert.equal(lines[1].status, 'AUTO');
  assert.match(lines[1].action, /^ran Steps 4\.0 and 4\.0b for PR #11, merged after its session: closing links reopened; 1 parent\(s\) closed; skipped #88 \(above-floor\); skipped record #102 \(gh-failed: boom\)\. Reversibility: n\/a\.$/);
  assert.ok(!fs.existsSync(lockOf(dir)));
});

test('summary marker names every closed parent untrusted-comment note and a step-wide skip', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const close = fakeCloseParents({
    closed: [{ parent: 77, maxTier: 'low', notes: ['skipped untrusted comment by mallory'] }],
    skipped: [{ reason: 'non-default-branch' }],
  });
  await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close });
  const marker = decisionsOf(dir).trim().split('\n').map(parseEntry).find((e) => e.location === MARKER_STEP);
  assert.match(marker.action, /; notes on #77: skipped untrusted comment by mallory; skipped step \(non-default-branch\)\./);
});

test('a second postMerge call on the same fixture calls neither fake again', async () => {
  const root = mainCheckout();
  addRun(root, '2026-10-30T090000-spec-1');
  const links = fakeClosingLinks(ENVELOPE);
  const close = fakeCloseParents();
  const first = await run(root, { prs: { 11: merged() }, links, close });
  const second = await run(root, { prs: { 11: merged() }, links, close });
  assert.equal(first.entries.length, 1);
  assert.deepEqual(second, { entries: [], deferred: [] });
  assert.equal(links.calls.length, 1);
  assert.equal(close.calls.length, 1);
});

test('a run that already holds a Step 4.0b entry (AUTO or the skipped SKIP line) is left alone', async () => {
  const root = mainCheckout();
  const auto = formatEntry({ status: 'AUTO', now: NOW, step: 'pr-first-merge Step 4.0b', spec: 5, text: 'closed parent #9', reversibility: 'high' });
  const skip = formatEntry({ status: 'SKIP', now: NOW, step: 'pr-first-merge Step 4.0b (skipped)', text: 'condition: no parent', reversibility: 'n/a' });
  const a = addRun(root, '2026-10-30T090000-spec-1', { pr: 11, decisions: `${auto}\n` });
  const b = addRun(root, '2026-10-30T090001-spec-2', { pr: 12, decisions: `${skip}\n` });
  const links = fakeClosingLinks(ENVELOPE);
  const close = fakeCloseParents();
  const r = await run(root, { prs: { 11: merged(), 12: merged() }, links, close });
  assert.deepEqual(r, { entries: [], deferred: [] });
  assert.equal(links.calls.length + close.calls.length, 0);
  assert.equal(decisionsOf(a), `${auto}\n`);
  assert.equal(decisionsOf(b), `${skip}\n`);
});

test('a clean-status run is processed too', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1', { status: 'clean' });
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: { 11: merged() }, links, close: fakeCloseParents() });
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].runDir, dir);
  assert.equal(r.entries[0].action, 'ran');
  assert.equal(links.calls.length, 1);
});

test('a run without a PR number is skipped silently', async () => {
  const root = mainCheckout();
  addRun(root, '2026-10-30T090000-spec-1', { pr: null });
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: {}, links, close: fakeCloseParents() });
  assert.deepEqual(r, { entries: [], deferred: [] });
  assert.equal(links.calls.length, 0);
});

test('an OPEN or CLOSED PR gives no entry and no call', async () => {
  const root = mainCheckout();
  addRun(root, '2026-10-30T090000-spec-1', { pr: 11 });
  addRun(root, '2026-10-30T090001-spec-2', { pr: 12 });
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: { 11: { number: 11, state: 'OPEN' }, 12: { number: 12, state: 'CLOSED' } }, links, close: fakeCloseParents() });
  assert.deepEqual(r, { entries: [], deferred: [] });
  assert.equal(links.calls.length, 0);
});

test('a prStates failure string gives a skipped entry with that reason and no marker', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: { 11: 'network-failure' }, links, close: fakeCloseParents() });
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'skipped', reason: 'network-failure' }]);
  assert.equal(links.calls.length, 0);
  assert.equal(decisionsOf(dir), '');
});

test('a prStates call that throws is a transient network-failure, never a crash', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const r = await postMerge({
    cwd: root, integration: 'main', now, prStates: { byNumberAsync: async () => { throw new Error('boom'); } },
    deps: { gh: fakeGh, closingLinksRun: fakeClosingLinks(ENVELOPE), closeParents: fakeCloseParents() },
  });
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'skipped', reason: 'network-failure' }]);
  assert.deepEqual(r.deferred, [dir]);
});

test('a missing or malformed prStates is a caller bug: failure no-pr-states up front, never a per-run network-failure', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const links = fakeClosingLinks(ENVELOPE);
  for (const prStates of [undefined, null, {}, { byNumberAsync: 'nope' }]) {
    const r = await postMerge({ cwd: root, integration: 'main', now, prStates, deps: { gh: fakeGh, closingLinksRun: links, closeParents: fakeCloseParents() } });
    assert.deepEqual(r, { entries: [], deferred: [], failure: 'no-pr-states' });
  }
  assert.equal(links.calls.length, 0);
  assert.equal(decisionsOf(dir), '');
});

test('merge grace: a merge 2 minutes old, or with no mergedAt, is skipped, untouched and deferred; 11 minutes runs', async () => {
  const root = mainCheckout();
  const fresh = addRun(root, '2026-10-30T090000-spec-1', { pr: 11 });
  const noStamp = addRun(root, '2026-10-30T090001-spec-2', { pr: 12 });
  const garbled = addRun(root, '2026-10-30T090002-spec-3', { pr: 13 });
  const old = addRun(root, '2026-10-30T090003-spec-4', { pr: 14 });
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, {
    prs: {
      11: merged(new Date(NOW - 2 * 60 * 1000).toISOString()),
      12: { number: 12, state: 'MERGED' },
      13: merged('not-a-date'),
      14: merged(new Date(NOW - 11 * 60 * 1000).toISOString()),
    },
    links,
    close: fakeCloseParents(),
  });
  const byPr = Object.fromEntries(r.entries.map((e) => [e.pr, e]));
  for (const pr of [11, 12, 13]) assert.deepEqual([byPr[pr].action, byPr[pr].reason], ['skipped', 'merge-grace']);
  assert.equal(byPr[14].action, 'ran');
  assert.equal(links.calls.length, 1);
  assert.equal(links.calls[0].argv[1], old);
  for (const dir of [fresh, noStamp, garbled]) assert.equal(decisionsOf(dir), '');
  assert.deepEqual(new Set(r.deferred), new Set([fresh, noStamp, garbled]));
  assert.equal(MERGE_GRACE_MS, 10 * 60 * 1000);
});

test('deferred holds in-flight and network-failure runs only; marker-write-failed, gh-absent, dry-run, marked and OPEN are not', async () => {
  const root = mainCheckout();
  const inFlight = addRun(root, '2026-10-30T090000-spec-1', { pr: 11 });
  fs.writeFileSync(lockOf(inFlight), '');
  fs.utimesSync(lockOf(inFlight), NOW / 1000, NOW / 1000);
  const network = addRun(root, '2026-10-30T090001-spec-2', { pr: 12 });
  const markerFail = addRun(root, '2026-10-30T090002-spec-3', { pr: 13 });
  const ghAbsent = addRun(root, '2026-10-30T090003-spec-4', { pr: 14 });
  const marked = addRun(root, '2026-10-30T090004-spec-5', { pr: 15, decisions: `${formatEntry({ status: 'AUTO', now: NOW, step: MARKER_STEP, text: 'ran', reversibility: 'n/a' })}\n` });
  const open = addRun(root, '2026-10-30T090005-spec-6', { pr: 16 });
  // Definitive lookup failures stay visible to archive's stuck-run surfacing: skipped, never deferred (R5).
  const notFound = addRun(root, '2026-10-30T090006-spec-7', { pr: 17 });
  const invalidArgs = addRun(root, '2026-10-30T090007-spec-8', { pr: 18 });
  const noState = addRun(root, '2026-10-30T090008-spec-9', { pr: 19 });
  const failingWrite = (args) => {
    if (args.runDir === markerFail) throw new Error('disk full');
    return { file: '', created: false };
  };
  const r = await run(root, {
    prs: { 11: merged(), 12: 'network-failure', 13: merged(), 14: 'gh-absent', 15: merged(), 16: { number: 16, state: 'OPEN' }, 17: 'pr-not-found', 18: 'invalid-arguments' },
    links: fakeClosingLinks(ENVELOPE),
    close: fakeCloseParents(),
    extra: { appendEntries: failingWrite },
  });
  const reasons = Object.fromEntries(r.entries.map((e) => [e.pr, e.reason || e.action]));
  assert.deepEqual(reasons, {
    11: 'in-flight', 12: 'network-failure', 13: 'marker-write-failed', 14: 'gh-absent', 17: 'pr-not-found', 18: 'invalid-arguments', 19: 'no-pr-state',
  });
  assert.deepEqual(new Set(r.deferred), new Set([inFlight, network]));
  assert.ok(![ghAbsent, marked, open, notFound, invalidArgs, noState].some((d) => r.deferred.includes(d)));

  const dry = await run(root, { prs: { 12: merged() }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents(), dryRun: true });
  assert.deepEqual(dry.entries.find((e) => e.runDir === network).reason, 'dry-run');
  assert.ok(!dry.deferred.includes(network));
});

test('claim: a fresh lock file means in-flight, no fake is called and the lock stays', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  fs.writeFileSync(lockOf(dir), '');
  fs.utimesSync(lockOf(dir), (NOW - 60 * 1000) / 1000, (NOW - 60 * 1000) / 1000);
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: { 11: merged() }, links, close: fakeCloseParents() });
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'skipped', reason: 'in-flight' }]);
  assert.equal(links.calls.length, 0);
  assert.ok(fs.existsSync(lockOf(dir)));
});

test('claim: a lock 11 minutes old is taken over, the run proceeds and no lock remains', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  fs.writeFileSync(lockOf(dir), '');
  const stale = (NOW - 11 * 60 * 1000) / 1000;
  fs.utimesSync(lockOf(dir), stale, stale);
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: { 11: merged() }, links, close: fakeCloseParents() });
  assert.equal(r.entries[0].action, 'ran');
  assert.equal(links.calls.length, 1);
  assert.ok(!fs.existsSync(lockOf(dir)));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.stale-')), []);
  assert.equal(CLAIM_STALE_MS, 10 * 60 * 1000);
});

test('claim: a closing-links runner that throws leaves no lock, no marker, and later runs still process', async () => {
  const root = mainCheckout();
  const bad = addRun(root, '2026-10-30T090000-spec-1', { pr: 11 });
  const good = addRun(root, '2026-10-30T090001-spec-2', { pr: 12 });
  let n = 0;
  const links = (argv, d) => {
    n += 1;
    if (argv[1] === bad) throw new Error('kaboom');
    d.stdout(`${JSON.stringify(ENVELOPE)}\n`);
    return 0;
  };
  const r = await run(root, { prs: { 11: merged(), 12: merged() }, links, close: fakeCloseParents() });
  const byPr = Object.fromEntries(r.entries.map((e) => [e.pr, e]));
  assert.deepEqual([byPr[11].action, byPr[11].reason, byPr[11].detail], ['skipped', 'error', 'kaboom']);
  assert.equal(byPr[12].action, 'ran');
  assert.equal(n, 2);
  assert.ok(!fs.existsSync(lockOf(bad)));
  assert.ok(!fs.existsSync(lockOf(good)));
  assert.equal(decisionsOf(bad), '');
  assert.ok(!r.deferred.includes(bad));
});

test('marker re-read under the claim: a marker appended after the first read stops the run before any fake', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const links = fakeClosingLinks(ENVELOPE);
  const close = fakeCloseParents();
  const marker = formatEntry({ status: 'AUTO', now: NOW, step: MARKER_STEP, text: 'ran elsewhere', reversibility: 'n/a' });
  const r = await run(root, {
    prs: { 11: merged() },
    links,
    close,
    extra: { beforeClaim: (d) => fs.appendFileSync(path.join(d, 'decisions.md'), `${marker}\n`) },
  });
  assert.deepEqual(r, { entries: [], deferred: [] });
  assert.equal(links.calls.length + close.calls.length, 0);
  assert.equal(decisionsOf(dir), `${marker}\n`);
  assert.ok(!fs.existsSync(lockOf(dir)));
});

test('closing-links exit 5 writes a SKIP marker naming exit 5 and never calls closeParents', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const close = fakeCloseParents();
  const r = await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(null, 5), close });
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'exit 5', parentsClosed: 0 }]);
  assert.equal(close.calls.length, 0);
  const entry = parseEntry(decisionsOf(dir).trim());
  assert.equal(entry.status, 'SKIP');
  assert.equal(entry.location, MARKER_STEP);
  assert.match(entry.action, /^condition: Step 4\.0 returned exit 5, no closingSet → fallback: no parent closed; the tidy parent-gate backstop recovers them\./);
  assert.ok(hasPostMergeMarker(decisionsOf(dir)));
});

test('an exit-0 envelope with no closingSet (not-merged) is a SKIP marker naming its action', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const close = fakeCloseParents();
  await run(root, { prs: { 11: merged() }, links: fakeClosingLinks({ action: 'not-merged', state: 'OPEN' }), close });
  assert.equal(close.calls.length, 0);
  assert.match(decisionsOf(dir), /Step 4\.0 returned not-merged, no closingSet/);
});

test('R1: closedAfterWindow records are subtracted from the set closeParents receives', async () => {
  const root = mainCheckout();
  addRun(root, '2026-10-30T090000-spec-1');
  const close = fakeCloseParents();
  const links = fakeClosingLinks({ ...ENVELOPE, closingSet: [101, 102, 103], closedAfterWindow: [102] });
  await run(root, { prs: { 11: merged() }, links, close });
  assert.deepEqual(close.calls[0].closingSet, [101, 103]);
});

test('R2: a null integration skips with integration-unknown before Step 4.0, writes no marker and is not deferred', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: { 11: merged() }, links, close: fakeCloseParents(), integration: null });
  assert.deepEqual(r, { entries: [{ runDir: dir, pr: 11, action: 'skipped', reason: 'integration-unknown' }], deferred: [] });
  assert.equal(links.calls.length, 0);
  assert.equal(decisionsOf(dir), '');
});

test('R2: the default gh runs through the timed wrapper with cwd at the main checkout, and risk-floor/work-links come from policy.yml', async (t) => {
  const root = mainCheckout();
  addRun(root, '2026-10-30T090000-spec-1');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'risk-floor: medium\nwork-links: native\n');
  const seen = [];
  const realExec = cp.execFileSync;
  // Only `gh` is faked; the git probes (remote slug, main checkout) keep running for real.
  t.mock.method(cp, 'execFileSync', (file, args, opts) => {
    if (file !== 'gh') return realExec(file, args, opts);
    seen.push({ file, args, opts });
    return 'out';
  });
  let received;
  const close = (args) => { received = args; args.gh(['issue', 'view', '7'], 'body'); return { closed: [], skipped: [] }; };
  await postMerge({
    cwd: root, integration: 'main', now, prStates: fakePrStates({ 11: merged() }),
    deps: { closingLinksRun: fakeClosingLinks(ENVELOPE), closeParents: close },
  });
  assert.equal(received.riskFloor, 'medium');
  assert.equal(received.workLinks, 'native');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].file, 'gh');
  assert.deepEqual(seen[0].args, ['issue', 'view', '7']);
  assert.equal(seen[0].opts.cwd, root);
  assert.equal(seen[0].opts.input, 'body');
  assert.equal(seen[0].opts.windowsHide, true);
  assert.equal(typeof seen[0].opts.timeout, 'number');
});

test('dryRun: a merged unmarked run past the grace window gives dry-run and writes nothing, the claim included', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1', { decisions: '# Decisions\n' });
  const before = fs.readFileSync(path.join(dir, 'decisions.md'));
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: { 11: merged() }, links, close: fakeCloseParents(), dryRun: true });
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'skipped', reason: 'dry-run' }]);
  assert.equal(links.calls.length, 0);
  assert.ok(before.equals(fs.readFileSync(path.join(dir, 'decisions.md'))));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['decisions.md', 'run-state.json']);
});

test('marker-write-failed: the entry says so and the run is not deferred', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const r = await run(root, {
    prs: { 11: merged() },
    links: fakeClosingLinks(ENVELOPE),
    close: fakeCloseParents(),
    extra: { appendEntries: () => { throw new Error('read-only'); } },
  });
  assert.deepEqual(r, { entries: [{ runDir: dir, pr: 11, action: 'skipped', reason: 'marker-write-failed' }], deferred: [] });
  assert.ok(!fs.existsSync(lockOf(dir)));
});

test('gh-absent from prStates: skipped/gh-absent, no marker, not deferred', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const r = await run(root, { prs: { 11: 'gh-absent' }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents() });
  assert.deepEqual(r, { entries: [{ runDir: dir, pr: 11, action: 'skipped', reason: 'gh-absent' }], deferred: [] });
  assert.equal(decisionsOf(dir), '');
});

test('no CLAUDE.md, or another work-backend: not-github-issues, no calls', async () => {
  for (const claudeMd of [null, '## Work records\n\nwork-backend: local-files\n']) {
    const root = mainCheckout({ claudeMd });
    addRun(root, '2026-10-30T090000-spec-1');
    const links = fakeClosingLinks(ENVELOPE);
    const r = await run(root, { prs: { 11: merged() }, links, close: fakeCloseParents() });
    assert.deepEqual(r, { entries: [], deferred: [], failure: 'not-github-issues' });
    assert.equal(links.calls.length, 0);
  }
});

test('no origin remote: failure no-remote, deferred still an empty array', async () => {
  const root = mainCheckout({ origin: false });
  addRun(root, '2026-10-30T090000-spec-1');
  const r = await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents() });
  assert.deepEqual(r, { entries: [], deferred: [], failure: 'no-remote' });
});

test('hasPostMergeMarker: the merging session location and this check match; other steps and prose do not', () => {
  const line = (step, spec) => formatEntry({ status: 'AUTO', now: NOW, step, spec, text: 'x', reversibility: 'n/a' });
  assert.equal(hasPostMergeMarker(line('pr-first-merge Step 4.0b', 4599)), true);
  assert.equal(hasPostMergeMarker(line('pr-first-merge Step 4.0b (skipped)')), true);
  assert.equal(hasPostMergeMarker(line(MARKER_STEP)), true);
  assert.equal(hasPostMergeMarker(line('pr-first-merge Step 4.1', 4599)), false);
  assert.equal(hasPostMergeMarker(line('reconcile post-merge parent-close')), false);
  assert.equal(hasPostMergeMarker('## reconcile post-merge\nreconcile post-merge: a note\n'), false);
  assert.equal(hasPostMergeMarker(''), false);
  assert.equal(hasPostMergeMarker(undefined), false);
});

// takeClaim with fs wrappers: each hook runs just before the real call, simulating a second taker.
function racingFs(hooks) {
  const wrapped = { ...fs };
  for (const [name, hook] of Object.entries(hooks)) {
    wrapped[name] = (...args) => { hook(...args); return fs[name](...args); };
  }
  return wrapped;
}

function staleLock(dir) {
  fs.writeFileSync(lockOf(dir), '');
  const old = (NOW - 11 * 60 * 1000) / 1000;
  fs.utimesSync(lockOf(dir), old, old);
}

test('R3 two takeovers: the taker that loses the rename skips in-flight and leaves the winner lock alone', () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  staleLock(dir);
  let winner;
  const fsApi = racingFs({
    renameSync: () => {
      // The other taker completes its whole takeover first.
      winner = takeClaim(dir, NOW);
    },
  });
  const loser = takeClaim(dir, NOW, fsApi);
  assert.deepEqual(winner, { ok: true });
  assert.deepEqual(loser, { ok: false, reason: 'in-flight' });
  assert.ok(fs.existsSync(lockOf(dir)), 'the winner still holds the lock');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.stale-')), []);
});

test('R3 two takeovers: a taker whose retry create hits EEXIST skips in-flight and leaves the other lock alone', () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  staleLock(dir);
  let unlinked = false;
  const fsApi = racingFs({
    unlinkSync: () => { unlinked = true; },
    openSync: (p, flags) => {
      // After our rename and unlink, another taker creates the lock before our single retry.
      if (unlinked && flags === 'wx') fs.closeSync(fs.openSync(p, 'wx'));
    },
  });
  const r = takeClaim(dir, NOW, fsApi);
  assert.deepEqual(r, { ok: false, reason: 'in-flight' });
  assert.ok(fs.existsSync(lockOf(dir)));
});

test('R3: another taker renamed the stale lock aside but has not recreated it yet: our rename hits ENOENT, in-flight', () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  staleLock(dir);
  const elsewhere = path.join(dir, 'taken.aside');
  const fsApi = racingFs({ renameSync: (from) => fs.renameSync(from, elsewhere) });
  assert.deepEqual(takeClaim(dir, NOW, fsApi), { ok: false, reason: 'in-flight' });
  assert.ok(!fs.existsSync(lockOf(dir)), 'we created nothing of our own');
});

test('takeClaim: the holder released the lock between our create and our stat: in-flight', () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  fs.writeFileSync(lockOf(dir), '');
  const fsApi = racingFs({ statSync: (p) => { if (p === lockOf(dir)) fs.unlinkSync(p); } });
  assert.deepEqual(takeClaim(dir, NOW, fsApi), { ok: false, reason: 'in-flight' });
});

test('takeClaim: a non-EEXIST create error is claim-failed', () => {
  const root = mainCheckout();
  const missing = path.join(root, 'no-such-run-dir');
  assert.deepEqual(takeClaim(missing, NOW), { ok: false, reason: 'claim-failed' });
});
