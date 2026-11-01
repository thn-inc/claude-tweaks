'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  postMerge, postMergeOne, prefetchPostMergePrStates, hasPostMergeMarker, takeClaim, MARKER_STEP, ATTEMPT_STEP, MAX_ATTEMPTS, CLOSE_WINDOW_MS, MERGE_GRACE_MS, CLAIM_STALE_MS, CLAIM_FILENAME,
} = require('../../../plugin/bin/lib/reconcile/post-merge');
const { formatEntry, parseEntry } = require('../../../plugin/bin/lib/log-decision/append');

// The real clock at load: claim-file mtimes the code writes are real, so `now` must agree with them.
const NOW = Date.now();
// Every temp checkout this file makes, removed once the file's tests are done.
const tempRoots = [];
test.after(() => { for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true }); });
const now = () => NOW;
const MERGED_AT = new Date(NOW - 60 * 60 * 1000).toISOString();
const merged = (mergedAt = MERGED_AT) => ({ number: 0, state: 'MERGED', mergedAt });

function git(root, ...args) {
  cp.execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true });
}

// A temp main checkout: a real git repo with an origin, a CLAUDE.md, and no run dirs yet.
// `origin`: true for the github.com default, a string for that URL, false for none.
function mainCheckout({ claudeMd = '## Work records\n\nwork-backend: github-issues\n', origin = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'post-merge-')));
  tempRoots.push(root);
  git(root, 'init', '-q');
  if (origin) git(root, 'remote', 'add', 'origin', origin === true ? 'git@github.com:acme/w.git' : origin);
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

function run(root, { prs, links, close, dryRun = false, extra = {} } = {}) {
  return postMerge({
    cwd: root,
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
    host: 'github.com',
    workLinks: 'body-text',
    riskFloor: 'high',
    gh: d.gh,
    selfInclude: false,
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
    skipped: [{ reason: 'invalid-risk-floor' }],
  });
  await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close });
  const marker = decisionsOf(dir).trim().split('\n').map(parseEntry).find((e) => e.location === MARKER_STEP);
  assert.match(marker.action, /; notes on #77: skipped untrusted comment by mallory; skipped step \(invalid-risk-floor\)\./);
});

test('summary marker bounds a skip detail that carries a whole gh stderr', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const close = fakeCloseParents({ closed: [], skipped: [{ parent: 5, reason: 'gh-failed', detail: `gh issue view 5: ${'502 Bad Gateway '.repeat(200)}` }] });
  await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close });
  const marker = decisionsOf(dir).trim().split('\n').map(parseEntry).find((e) => e.location === MARKER_STEP);
  assert.ok(marker.action.length < 700, `the marker line stays short (${marker.action.length} chars)`);
  assert.match(marker.action, /skipped #5 \(gh-failed: gh issue view 5: 502 Bad Gateway/);
  assert.match(marker.action, /…\)/);
});

test('#4549: a closeFailed[] record holds its parent — it reaches Step 4.0b in unsettled, beside reopened, pendingClose and failed', async () => {
  const root = mainCheckout();
  addRun(root, '2026-10-30T090000-spec-1');
  // A PR merged into a non-default base: Step 4.0 closed #101 itself, could not close #106.
  const links = fakeClosingLinks({
    ...ENVELOPE, action: 'close-failed', closingSet: [101], nonDefaultBase: true, closed: [101],
    closeFailed: [{ issue: 106, error: 'boom' }, { issue: 107, error: 'no state field', stage: 'read' }],
  });
  const close = fakeCloseParents({ closed: [], skipped: [{ parent: 77, reason: 'sibling-unsettled' }] });
  await run(root, { prs: { 11: merged() }, links, close });
  assert.equal(close.calls.length, 1);
  assert.deepEqual(close.calls[0].closingSet, [101]);
  assert.deepEqual(close.calls[0].unsettled, [106, 107], 'both closeFailed[] entries (a failed close and a failed read) hold their parent');
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
    cwd: root, now, prStates: { byNumberAsync: async () => { throw new Error('boom'); } },
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
    const r = await postMerge({ cwd: root, now, prStates, deps: { gh: fakeGh, closingLinksRun: links, closeParents: fakeCloseParents() } });
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

test('merge grace boundary: a merge exactly MERGE_GRACE_MS old is still in grace; 1 ms later runs, strictly past the close window', async () => {
  const root = mainCheckout();
  const edge = addRun(root, '2026-10-30T090000-spec-1', { pr: 11 });
  const past = addRun(root, '2026-10-30T090001-spec-2', { pr: 12 });
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, {
    prs: {
      11: merged(new Date(NOW - MERGE_GRACE_MS).toISOString()),
      12: merged(new Date(NOW - MERGE_GRACE_MS - 1).toISOString()),
    },
    links,
    close: fakeCloseParents(),
  });
  const byPr = Object.fromEntries(r.entries.map((e) => [e.pr, e]));
  assert.deepEqual([byPr[11].action, byPr[11].reason], ['skipped', 'merge-grace']);
  assert.deepEqual(r.deferred, [edge]);
  assert.equal(byPr[12].action, 'ran');
  assert.deepEqual(links.calls.map((c) => c.argv[1]), [past]);
  // closing-links settles a still-open record only once now > mergedAt + window, so the window must
  // never outlast the grace: every run that gets here is strictly past it.
  assert.ok(CLOSE_WINDOW_MS <= MERGE_GRACE_MS);
});

test('deferred holds in-flight, claim-failed and network-failure runs only; marker-write-failed, gh-absent, dry-run, marked and OPEN are not', async () => {
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
  const claimFail = addRun(root, '2026-10-30T090009-spec-10', { pr: 20 });
  const failingWrite = (args) => {
    if (args.runDir === markerFail) throw new Error('disk full');
    return { file: '', created: false };
  };
  const r = await run(root, {
    prs: { 11: merged(), 12: 'network-failure', 13: merged(), 14: 'gh-absent', 15: merged(), 16: { number: 16, state: 'OPEN' }, 17: 'pr-not-found', 18: 'invalid-arguments', 20: merged() },
    links: fakeClosingLinks(ENVELOPE),
    close: fakeCloseParents(),
    extra: {
      appendEntries: failingWrite,
      takeClaim: (dir, nowMs) => (dir === claimFail ? { ok: false, reason: 'claim-failed' } : takeClaim(dir, nowMs)),
    },
  });
  const reasons = Object.fromEntries(r.entries.map((e) => [e.pr, e.reason || e.action]));
  assert.deepEqual(reasons, {
    11: 'in-flight', 12: 'network-failure', 13: 'marker-write-failed', 14: 'gh-absent', 17: 'pr-not-found', 18: 'invalid-arguments', 19: 'no-pr-state', 20: 'claim-failed',
  });
  assert.deepEqual(new Set(r.deferred), new Set([inFlight, network, claimFail]));
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

const entriesOf = (dir) => decisionsOf(dir).trim().split('\n').filter(Boolean).map(parseEntry);

test('M7: closing-links exit 5 (a gh failure) retries: an attempt line, never a marker, the run deferred; the bound then writes the marker', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const close = fakeCloseParents();
  const links = fakeClosingLinks(null, 5);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await run(root, { prs: { 11: merged() }, links, close });
    assert.deepEqual(r.entries, [{
      runDir: dir, pr: 11, action: 'skipped', reason: 'transient-failure', detail: 'Step 4.0 returned exit 5 (a gh failure)', attempt,
    }]);
    assert.deepEqual(r.deferred, [dir]);
    const lines = entriesOf(dir);
    assert.equal(lines.length, attempt);
    assert.ok(lines.every((e) => e.status === 'SKIP' && e.location === ATTEMPT_STEP));
    assert.match(lines[attempt - 1].action, new RegExp(`^condition: Step 4\\.0 returned exit 5 \\(a gh failure\\) \\(attempt ${attempt} of 3\\) → fallback: the next reconcile pass retries`));
    assert.equal(hasPostMergeMarker(decisionsOf(dir)), false, 'an attempt line is never a marker');
  }
  assert.equal(MAX_ATTEMPTS, 3);
  // The bound: with 3 attempt lines, the next failure writes the SKIP marker as any other failure does.
  const last = await run(root, { prs: { 11: merged() }, links, close });
  assert.deepEqual(last, { entries: [{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'exit 5', parentsClosed: 0, step40Failed: true }], deferred: [] });
  const marker = entriesOf(dir).at(-1);
  assert.equal(marker.status, 'SKIP');
  assert.equal(marker.location, MARKER_STEP);
  assert.match(marker.action, /^condition: Step 4\.0 returned exit 5, no closingSet → fallback: no parent closed; the tidy parent-gate backstop recovers them\./);
  assert.ok(hasPostMergeMarker(decisionsOf(dir)));
  // Done: a further pass calls nothing.
  assert.deepEqual(await run(root, { prs: { 11: merged() }, links, close }), { entries: [], deferred: [] });
  assert.equal(links.calls.length, MAX_ATTEMPTS + 1);
  assert.equal(close.calls.length, 0);
});

test('M7: a deterministic closing-links exit (2, 3) writes the marker at once and is not deferred', async () => {
  for (const code of [2, 3]) {
    const root = mainCheckout();
    const dir = addRun(root, '2026-10-30T090000-spec-1');
    const r = await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(null, code), close: fakeCloseParents() });
    assert.deepEqual(r, { entries: [{ runDir: dir, pr: 11, action: 'ran', closingLinks: `exit ${code}`, parentsClosed: 0, step40Failed: true }], deferred: [] });
    assert.ok(hasPostMergeMarker(decisionsOf(dir)));
    assert.equal(entriesOf(dir).filter((e) => e.location === ATTEMPT_STEP).length, 0);
  }
});

// Step 4.0's envelope when the PR's base or the default branch could not be read (#4549): no closingSet.
const BASE_UNCHECKED = {
  action: 'base-unchecked', pr: 11, candidates: [], willClose: [], reopened: [], failed: [], stillOpen: [], pendingClose: [],
  closedBefore: [], baseUnchecked: true, unchecked: [101, 102],
};

test('#4549: a base-unchecked envelope carries no closing set — Step 4.0b never runs, and the run retries like a gh failure; the bound then writes the SKIP marker', async () => {
  for (const envelope of [BASE_UNCHECKED, { ...BASE_UNCHECKED, action: 'reopen-failed', failed: [{ issue: 103, error: 'x' }] }]) {
    const root = mainCheckout();
    const dir = addRun(root, '2026-10-30T090000-spec-1');
    const close = fakeCloseParents();
    const links = fakeClosingLinks(envelope);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const r = await run(root, { prs: { 11: merged() }, links, close });
      assert.deepEqual(r.entries, [{
        runDir: dir, pr: 11, action: 'skipped', reason: 'transient-failure',
        detail: `Step 4.0 returned ${envelope.action} (the PR's base or the default branch could not be read)`, attempt,
      }]);
      assert.deepEqual(r.deferred, [dir]);
      assert.equal(hasPostMergeMarker(decisionsOf(dir)), false, 'an attempt line is never a marker');
    }
    const last = await run(root, { prs: { 11: merged() }, links, close });
    assert.deepEqual(last, { entries: [{ runDir: dir, pr: 11, action: 'ran', closingLinks: envelope.action, parentsClosed: 0, step40Failed: true }], deferred: [] });
    const marker = entriesOf(dir).at(-1);
    assert.equal(marker.status, 'SKIP');
    assert.equal(marker.location, MARKER_STEP);
    assert.match(marker.action, new RegExp(`^condition: Step 4\\.0 returned ${envelope.action}, no closingSet → fallback: no parent closed`));
    assert.equal(close.calls.length, 0, `${envelope.action}: Step 4.0b never runs without a closing set`);
  }
});

test('a gh failure on one parent or one record in Step 4.0b is that parent\'s skip: the marker is written and the run is not deferred', async () => {
  for (const skip of [{ parent: 88, reason: 'gh-failed', detail: 'x' }, { issue: 102, reason: 'gh-failed', detail: 'x' }]) {
    const root = mainCheckout();
    const dir = addRun(root, '2026-10-30T090000-spec-1');
    const r = await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents({ closed: [], skipped: [skip] }) });
    assert.equal(r.entries[0].action, 'ran');
    assert.deepEqual(r.deferred, []);
    assert.ok(hasPostMergeMarker(decisionsOf(dir)));
  }
});

test('M7: hasPostMergeMarker never reads an attempt line as a marker', () => {
  const attempt = formatEntry({ status: 'SKIP', now: NOW, step: ATTEMPT_STEP, text: 'condition: x (attempt 1 of 3)', reversibility: 'n/a' });
  assert.equal(parseEntry(attempt).location, ATTEMPT_STEP);
  assert.equal(hasPostMergeMarker(attempt), false);
  assert.equal(hasPostMergeMarker(`${attempt}\n${attempt}\n${attempt}\n`), false);
});

test('K4: an exit-0 envelope with neither closingSet nor action is labelled unreadable and flagged step40Failed', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const r = await run(root, { prs: { 11: merged() }, links: fakeClosingLinks({ pr: 11, unexpected: true }), close: fakeCloseParents() });
  assert.deepEqual(r.entries, [{
    runDir: dir, pr: 11, action: 'ran', closingLinks: 'an unreadable envelope', parentsClosed: 0, step40Failed: true,
  }]);
  assert.match(decisionsOf(dir), /Step 4\.0 returned an unreadable envelope, no closingSet/);
});

test('M3: a multi-spec run whose Step 4.0b logged its marker in spec-N/decisions.md is done: no lookup, no call, not prefetched', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  fs.mkdirSync(path.join(dir, 'spec-2'));
  const marker = formatEntry({ status: 'AUTO', now: NOW, step: 'pr-first-merge Step 4.0b', spec: 2, text: 'closed parent #9', reversibility: 'high' });
  fs.writeFileSync(path.join(dir, 'spec-2', 'decisions.md'), `${marker}\n`);
  // A non-spec directory beside it carries the same marker; root2 below shows that one alone never counts.
  fs.mkdirSync(path.join(dir, 'staged'));
  fs.writeFileSync(path.join(dir, 'staged', 'decisions.md'), `${marker}\n`);
  const looked = [];
  const links = fakeClosingLinks(ENVELOPE);
  const r = await postMerge({
    cwd: root, now, prStates: { byNumberAsync: async (n) => { looked.push(n); return merged(); } },
    deps: { gh: fakeGh, closingLinksRun: links, closeParents: fakeCloseParents() },
  });
  assert.deepEqual(r, { entries: [], deferred: [] });
  assert.deepEqual(looked, []);
  assert.equal(links.calls.length, 0);
  const calls = [];
  await prefetchPostMergePrStates(root, { prefetch: async (arg) => { calls.push(arg); } });
  assert.deepEqual(calls[0].numbers, []);

  // The same marker in a non-spec directory does not mark the run.
  const root2 = mainCheckout();
  const dir2 = addRun(root2, '2026-10-30T090000-spec-1');
  fs.mkdirSync(path.join(dir2, 'staged'));
  fs.writeFileSync(path.join(dir2, 'staged', 'decisions.md'), `${marker}\n`);
  const r2 = await run(root2, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents() });
  assert.equal(r2.entries[0].action, 'ran');
});

test('M3: a spec-N marker appended between the first read and the claim stops the run under the claim', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  fs.mkdirSync(path.join(dir, 'spec-1'));
  const links = fakeClosingLinks(ENVELOPE);
  const marker = formatEntry({ status: 'SKIP', now: NOW, step: 'pr-first-merge Step 4.0b (skipped)', spec: 1, text: 'condition: no parent', reversibility: 'n/a' });
  const r = await run(root, {
    prs: { 11: merged() },
    links,
    close: fakeCloseParents(),
    extra: { beforeClaim: (d) => fs.writeFileSync(path.join(d, 'spec-1', 'decisions.md'), `${marker}\n`) },
  });
  assert.deepEqual(r, { entries: [], deferred: [] });
  assert.equal(links.calls.length, 0);
  assert.equal(decisionsOf(dir), '');
});

test('M4: once the pass budget reads exceeded, every remaining run that would run skips budget-exhausted and is deferred', async () => {
  const root = mainCheckout();
  const first = addRun(root, '2026-10-30T090000-spec-1', { pr: 11 });
  const open = addRun(root, '2026-10-30T090001-spec-2', { pr: 12 });
  const second = addRun(root, '2026-10-30T090002-spec-3', { pr: 13 });
  const third = addRun(root, '2026-10-30T090003-spec-4', { pr: 14 });
  const links = fakeClosingLinks(ENVELOPE);
  const checks = [];
  // Exceeded as soon as one run's steps have run.
  const budgetExceeded = () => { checks.push(links.calls.length); return links.calls.length >= 1; };
  const r = await postMerge({
    cwd: root, now, budgetExceeded,
    prStates: fakePrStates({ 11: merged(), 12: { number: 12, state: 'OPEN' }, 13: merged(), 14: merged() }),
    deps: { gh: fakeGh, closingLinksRun: links, closeParents: fakeCloseParents() },
  });
  // The walk order is the run listing's, so which merged run goes first is not pinned: exactly one runs.
  const ran = r.entries.filter((e) => e.action === 'ran').map((e) => e.runDir);
  assert.equal(ran.length, 1);
  assert.equal(links.calls[0].argv[1], ran[0]);
  const exhausted = r.entries.filter((e) => e.reason === 'budget-exhausted').map((e) => e.runDir);
  assert.deepEqual(new Set([...ran, ...exhausted]), new Set([first, second, third]));
  assert.equal(r.entries.length, 3, 'an OPEN PR is not a run that would have run: no entry');
  assert.ok(!r.entries.some((e) => e.runDir === open));
  assert.deepEqual(new Set(r.deferred), new Set(exhausted));
  assert.equal(links.calls.length, 1);
  assert.deepEqual(checks, [0, 1, 1], 'checked before each run that would run, never mid-run');
  for (const dir of exhausted) assert.equal(decisionsOf(dir), '');

  // No predicate, or one that never trips: every run runs.
  const root2 = mainCheckout();
  addRun(root2, '2026-10-30T090000-spec-1', { pr: 11 });
  addRun(root2, '2026-10-30T090001-spec-2', { pr: 13 });
  const r2 = await run(root2, { prs: { 11: merged(), 13: merged() }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents() });
  assert.deepEqual(r2.entries.map((e) => e.action), ['ran', 'ran']);
});

test('step40Failed marks a non-zero exit and an unreadable exit-0 envelope, never a readable envelope without a closing set', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const unreadable = await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(null, 0), close: fakeCloseParents() });
  assert.deepEqual(unreadable.entries, [{
    runDir: dir, pr: 11, action: 'ran', closingLinks: 'an unreadable envelope', parentsClosed: 0, step40Failed: true,
  }]);
  const root2 = mainCheckout();
  const dir2 = addRun(root2, '2026-10-30T090000-spec-1');
  const notMerged = await run(root2, { prs: { 11: merged() }, links: fakeClosingLinks({ action: 'not-merged', state: 'OPEN' }), close: fakeCloseParents() });
  assert.deepEqual(notMerged.entries, [{ runDir: dir2, pr: 11, action: 'ran', closingLinks: 'not-merged', parentsClosed: 0 }]);
  // A fully successful run carries no flag either.
  const root3 = mainCheckout();
  addRun(root3, '2026-10-30T090000-spec-1');
  const ok = await run(root3, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents() });
  assert.ok(!('step40Failed' in ok.entries[0]));
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
    cwd: root, now, prStates: fakePrStates({ 11: merged() }),
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

test('a GitHub Enterprise origin hands Step 4.0b its host; a github.com origin hands it github.com', async () => {
  for (const [origin, host] of [
    ['git@ghe.example.com:acme/w.git', 'ghe.example.com'],
    ['https://ghe.example.com/acme/w.git', 'ghe.example.com'],
    ['https://github.com/acme/w.git', 'github.com'],
  ]) {
    const root = mainCheckout({ origin });
    addRun(root, '2026-10-30T090000-spec-1');
    const close = fakeCloseParents();
    await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close });
    assert.equal(close.calls.length, 1, origin);
    assert.deepEqual([close.calls[0].host, close.calls[0].owner, close.calls[0].repo], [host, 'acme', 'w'], origin);
  }
});

// A fresh checkout with one unmarked run and `policyText` as its policy.yml (null: no file).
function policyCheckout(policyText) {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  if (policyText !== null) fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policyText);
  return { root, dir };
}

test('an unreadable policy.yml skips Step 4.0b fail-closed: no close attempted, the skip named on the marker', async () => {
  const { root, dir } = policyCheckout(null);
  // A directory where the file belongs: the read fails EISDIR, an error that is not "no policy file".
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'policy.yml'));
  const links = fakeClosingLinks(ENVELOPE);
  const close = fakeCloseParents({ closed: [{ parent: 77, maxTier: 'low' }], skipped: [] });
  const r = await run(root, { prs: { 11: merged() }, links, close });
  assert.equal(links.calls.length, 1, 'Step 4.0 still runs');
  assert.equal(close.calls.length, 0, 'no below-floor close is attempted');
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0 }]);
  const lines = entriesOf(dir);
  assert.deepEqual(lines.map((e) => e.location), [MARKER_STEP], 'the marker only, no parent line');
  assert.match(lines[0].action, /; 0 parent\(s\) closed; skipped step \(unreadable-policy: \.claude-tweaks\/policy\.yml: EISDIR\)\./);
});

test('a risk-floor value policy.yml rejects skips Step 4.0b fail-closed, never the looser schema default', async () => {
  const { root, dir } = policyCheckout('risk-floor: hgih\nwork-links: native\n');
  const close = fakeCloseParents({ closed: [{ parent: 77, maxTier: 'low' }], skipped: [] });
  await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close });
  assert.equal(close.calls.length, 0, 'no below-floor close is attempted');
  const lines = entriesOf(dir);
  assert.deepEqual(lines.map((e) => e.location), [MARKER_STEP]);
  assert.match(lines[0].action, /; skipped step \(invalid-risk-floor: \.claude-tweaks\/policy\.yml risk-floor: "hgih"\)\./);
});

test('no policy.yml at all (and a policy.yml without risk-floor) keeps the schema default: the close runs with risk-floor high', async () => {
  for (const policyText of [null, 'work-links: native\n']) {
    const { root } = policyCheckout(policyText);
    const close = fakeCloseParents();
    await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close });
    assert.equal(close.calls.length, 1, String(policyText));
    assert.equal(close.calls[0].riskFloor, 'high', String(policyText));
  }
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
  assert.deepEqual(r, { entries: [{ runDir: dir, pr: 11, action: 'skipped', reason: 'marker-write-failed', parentsClosed: 0 }], deferred: [] });
  assert.ok(!fs.existsSync(lockOf(dir)));
});

test('M8: a marker-write-failed entry still carries the parents Step 4.0b closed on GitHub', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const close = fakeCloseParents({ closed: [{ parent: 77, maxTier: 'low' }, { parent: 78, maxTier: 'medium' }], skipped: [] });
  const r = await run(root, {
    prs: { 11: merged() },
    links: fakeClosingLinks(ENVELOPE),
    close,
    extra: { appendEntries: () => { throw new Error('read-only'); } },
  });
  assert.deepEqual(r, { entries: [{ runDir: dir, pr: 11, action: 'skipped', reason: 'marker-write-failed', parentsClosed: 2 }], deferred: [] });
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

// #4032's batched lookup: postMerge dispatches ahead of archive's own warm-up, so without this
// prefetch every active run would cost one live `gh pr view` per pass.
test('prefetchPostMergePrStates: warms exactly the PR numbers postMerge would probe — unmarked, clean included, deduplicated', async () => {
  const root = mainCheckout();
  addRun(root, '2026-10-30T090001-spec-1', { pr: 11 });
  addRun(root, '2026-10-30T090002-spec-2', { pr: 12, status: 'clean' });
  addRun(root, '2026-10-30T090003-spec-3', { pr: 13, decisions: `${formatEntry({ status: 'AUTO', now: NOW, step: MARKER_STEP, text: 'done', reversibility: 'n/a' })}\n` });
  addRun(root, '2026-10-30T090004-spec-4', { pr: null });
  addRun(root, '2026-10-30T090005-spec-5', { pr: 11 });
  const calls = [];
  await prefetchPostMergePrStates(root, { prefetch: async (arg) => { calls.push(arg); } });
  assert.equal(calls.length, 1, 'one batched prefetch call');
  assert.deepEqual([...calls[0].numbers].sort(), [11, 12]);
});

test('prefetchPostMergePrStates: nothing is looked up for a project postMerge would skip, and a resolver without prefetch is tolerated', async () => {
  const other = mainCheckout({ claudeMd: '## Work records\n\nwork-backend: local-files\n' });
  addRun(other, '2026-10-30T090001-spec-1', { pr: 11 });
  const calls = [];
  await prefetchPostMergePrStates(other, { prefetch: async (arg) => { calls.push(arg); } });
  assert.deepEqual(calls, []);

  const root = mainCheckout();
  addRun(root, '2026-10-30T090001-spec-1', { pr: 11 });
  await assert.doesNotReject(prefetchPostMergePrStates(root, {}));
  await assert.doesNotReject(prefetchPostMergePrStates(root, null));
});

// ---- M6: end to end — the real postMerge, closing-links run() and closeBelowFloorParents; only gh is faked ----

// A merged PR #11 whose Fixes block names `fixes` (default #101); #101 and #102 are the sub-issues of parent
// #100 (native links). `live` is each sub-issue's state as GitHub reports it now, an hour after the merge.
// `base` is the PR's baseRefName against the default branch `main`: on another base Step 4.0 closes each
// still-open Fixes record itself (#4549), and a closed record then reads CLOSED/COMPLETED. A record in
// `closeErrors` makes that close call throw although the close landed (its live state still turns CLOSED).
function e2eWorld(live, { base = 'main', fixes = [101], closeErrors = [] } = {}) {
  const mergedAt = new Date(NOW - 60 * 60 * 1000).toISOString();
  const repository = { name: 'w', owner: { login: 'acme' } };
  const calls = [];
  const closedBy = new Set();
  const liveOf = (n) => (closedBy.has(n) ? { state: 'CLOSED', stateReason: 'COMPLETED' } : live[n]);
  const fixesBlock = fixes.map((n) => `Fixes #${n}`).join('\n');
  const gh = (args, input) => {
    const key = args.join(' ');
    calls.push({ key, input });
    if (key === 'pr view 11 --json state,mergedAt,body,closingIssuesReferences,url,mergeCommit,baseRefName') {
      return JSON.stringify({
        state: 'MERGED', mergedAt, url: 'https://github.com/acme/w/pull/11', mergeCommit: { oid: 'abcdef1' }, baseRefName: base,
        body: `<!-- claude-tweaks-run: 2026-10-30T090000-spec-101 -->\n\n<!-- fixes-start -->\n${fixesBlock}\n<!-- fixes-end -->\n`,
        closingIssuesReferences: base === 'main' ? fixes.map((number) => ({ number, repository })) : [],
      });
    }
    if (key === 'api repos/{owner}/{repo}/commits/abcdef1 --jq .commit.message') return `fix (#11)\n\n${fixesBlock}\n`;
    if (key === 'repo view github.com/acme/w --json defaultBranchRef -q .defaultBranchRef.name') return 'main\n';
    let m = /^issue view (10[12]) --json state,closedAt$/.exec(key);
    if (m) return JSON.stringify({ state: liveOf(Number(m[1])).state, closedAt: null });
    m = /^issue close (10[12]) --reason completed --comment /.exec(key);
    if (m) {
      closedBy.add(Number(m[1]));
      if (closeErrors.includes(Number(m[1]))) throw new Error('HTTP 502 after the close landed');
      return '';
    }
    if (args[0] === 'api' && args[1] === 'graphql') {
      if (args[3].startsWith('query={ __type')) return JSON.stringify({ data: { __type: { fields: [{ name: 'subIssues' }] } } });
      if (args[3].includes('subIssues(first:100)')) return JSON.stringify({ data: { repository: { i100: { number: 100, subIssues: { nodes: [{ number: 101 }, { number: 102 }], pageInfo: { hasNextPage: false } } } } } });
      const n = Number(/i(\d+):/.exec(args[3])[1]);
      return JSON.stringify({ data: { repository: { [`i${n}`]: { number: n, parent: { number: 100 } } } } });
    }
    if (key === 'api --paginate repos/acme/w/issues/100/sub_issues --jq .[].number') return '101\n102\n';
    m = /^issue view (10[12]) --repo acme\/w --json state,stateReason,labels,title,closedByPullRequestsReferences$/.exec(key);
    if (m) return JSON.stringify({ ...liveOf(Number(m[1])), title: `T${m[1]}`, labels: [{ name: 'risk:low' }], closedByPullRequestsReferences: [] });
    if (key === 'issue view 100 --repo acme/w --json labels -q [.labels[].name]') return JSON.stringify(['parent-issue']);
    if (key === 'issue view 100 --repo acme/w --json state,stateReason,comments') {
      const closedYet = calls.some((c) => c.key.startsWith('issue close 100'));
      return JSON.stringify({ state: closedYet ? 'CLOSED' : 'OPEN', stateReason: closedYet ? 'COMPLETED' : '', comments: [] });
    }
    if (key === 'api user --jq .login') return 'bot\n';
    if (key === 'issue comment 100 --repo acme/w --body-file -' || /^issue close 100 --repo acme\/w --reason /.test(key)) return '';
    throw new Error(`unexpected gh call: ${key}`);
  };
  return { gh, calls, mergedAt };
}

async function e2ePass(root, world) {
  return postMerge({
    cwd: root, now,
    prStates: { byNumberAsync: async () => ({ number: 11, state: 'MERGED', mergedAt: world.mergedAt }) },
    deps: { gh: world.gh },
  });
}

function e2eCheckout() {
  const root = mainCheckout();
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'risk-floor: high\nwork-links: native\n');
  const dir = addRun(root, '2026-10-30T090000-spec-101', { status: 'clean' });
  return { root, dir };
}

const writesOf = (calls) => calls.filter((c) => /^issue (comment|close|reopen) /.test(c.key));
const parentWritesOf = (calls) => writesOf(calls).filter((c) => / 100 /.test(c.key));

test('M6 end to end: an armed merge\'s last sub-issue closes its below-floor parent once — one comment, one close, the parent line and the marker; a second pass does nothing', async () => {
  const { root, dir } = e2eCheckout();
  const world = e2eWorld({ 101: { state: 'CLOSED', stateReason: 'COMPLETED' }, 102: { state: 'CLOSED', stateReason: 'COMPLETED' } });
  const first = await e2ePass(root, world);
  assert.deepEqual(first, { entries: [{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 1 }], deferred: [] });
  const writes = writesOf(world.calls);
  assert.deepEqual(writes.map((c) => c.key), ['issue comment 100 --repo acme/w --body-file -', 'issue close 100 --repo acme/w --reason completed']);
  assert.ok(writes[0].input.startsWith('## Closed below the oversight floor\n'));
  assert.ok(writes[0].input.includes('- #101 T101 — closed by PR #11'), 'the merging PR names the closing record on the listing');
  const lines = entriesOf(dir);
  assert.deepEqual(lines.map((e) => [e.status, e.location]), [['AUTO', 'reconcile post-merge parent-close'], ['AUTO', MARKER_STEP]]);
  assert.match(lines[0].action, /^closed parent #100 below the oversight floor \(risk:low, risk-floor high\)\./);
  assert.match(lines[1].action, /^ran Steps 4\.0 and 4\.0b for PR #11, merged after its session: closing links nothing-closed; 1 parent\(s\) closed\./);
  assert.ok(!fs.existsSync(lockOf(dir)));

  const before = world.calls.length;
  const second = await e2ePass(root, world);
  assert.deepEqual(second, { entries: [], deferred: [] });
  assert.equal(world.calls.length, before, 'the second pass makes no gh call at all');
});

test('M6 end to end (I1): a closing record a human reopened after the merge keeps its parent open — no comment, no close', async () => {
  const { root, dir } = e2eCheckout();
  const world = e2eWorld({ 101: { state: 'OPEN', stateReason: 'REOPENED' }, 102: { state: 'CLOSED', stateReason: 'COMPLETED' } });
  const r = await e2ePass(root, world);
  assert.deepEqual(r, { entries: [{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0 }], deferred: [] });
  assert.deepEqual(writesOf(world.calls), []);
  const lines = entriesOf(dir);
  assert.deepEqual(lines.map((e) => e.location), [MARKER_STEP]);
  assert.match(lines[0].action, /0 parent\(s\) closed; skipped #100 \(incomplete\)\./);
});

test('#4549 end to end: an armed merge into a non-default base — the late Step 4.0 closes the Fixes record itself and Step 4.0b closes the parent, with no default-branch gate', async () => {
  const { root, dir } = e2eCheckout();
  const world = e2eWorld({ 101: { state: 'OPEN', stateReason: '' }, 102: { state: 'CLOSED', stateReason: 'COMPLETED' } }, { base: 'develop' });
  const r = await e2ePass(root, world);
  assert.deepEqual(r, { entries: [{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'closed', parentsClosed: 1 }], deferred: [] });
  const writes = writesOf(world.calls).map((c) => c.key);
  assert.match(writes[0], /^issue close 101 --reason completed --comment /, 'Step 4.0 closes the Fixes record itself');
  assert.deepEqual(writes.slice(1), ['issue comment 100 --repo acme/w --body-file -', 'issue close 100 --repo acme/w --reason completed']);
  assert.ok(!world.calls.some((c) => c.key === 'repo view --json defaultBranchRef -q .defaultBranchRef.name'), 'Step 4.0b reads no default branch');
  const locations = entriesOf(dir).map((e) => e.location);
  assert.ok(locations.includes('reconcile post-merge parent-close'), `the parent line is logged: ${locations.join(' | ')}`);
  assert.equal(locations.at(-1), MARKER_STEP, 'the marker is written last');
});

test('#4549 end to end: a Fixes record Step 4.0 could not close (closeFailed[]) keeps its parent open even when its close landed', async () => {
  const { root, dir } = e2eCheckout();
  const world = e2eWorld(
    { 101: { state: 'OPEN', stateReason: '' }, 102: { state: 'OPEN', stateReason: '' } },
    { base: 'develop', fixes: [101, 102], closeErrors: [102] },
  );
  const r = await e2ePass(root, world);
  assert.deepEqual(r, { entries: [{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'close-failed', parentsClosed: 0 }], deferred: [] });
  assert.deepEqual(parentWritesOf(world.calls), [], 'no comment and no close on the parent');
  const marker = entriesOf(dir).find((e) => e.location === MARKER_STEP);
  assert.match(marker.action, /0 parent\(s\) closed; skipped #100 \(sibling-unsettled\)\./);
});

// postMergeOne (#4692): the one guarded single-run path merge mode's already-merged route drives.
const oneArgs = (root, dir, { prs, links, close, takeClaimFn, extra = {} } = {}) => ({
  runDir: dir,
  cwd: root,
  prStates: fakePrStates(prs),
  now,
  deps: {
    gh: fakeGh, closingLinksRun: links, closeParents: close, ...(takeClaimFn ? { takeClaim: takeClaimFn } : {}), ...extra,
  },
});

// A run dir under archive/, the place postMerge never walks.
function addArchivedRun(root, runId, { pr = 11, config } = {}) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'clean', worktree: null, pr: { number: pr } }));
  if (config !== undefined) fs.writeFileSync(path.join(dir, 'config.yml'), config);
  return dir;
}

test('postMergeOne processes an archive/{run-id} dir postMerge never walks', async () => {
  const root = mainCheckout();
  const dir = addArchivedRun(root, '2026-01-01T000000-spec-9');
  const links = fakeClosingLinks(ENVELOPE);
  const close = fakeCloseParents();
  const entry = await postMergeOne(oneArgs(root, dir, { prs: { 11: merged() }, links, close }));
  assert.equal(entry.action, 'ran');
  assert.equal(entry.runDir, dir);
  assert.deepEqual(links.calls[0].argv, [
    '--run', dir, '--mode', 'post-merge', '--settle-ms', '0', '--close-window-ms', String(CLOSE_WINDOW_MS),
  ]);
  assert.ok(hasPostMergeMarker(decisionsOf(dir)));
  assert.ok(!fs.existsSync(lockOf(dir)), 'the claim is released');
  const loop = await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents() });
  assert.deepEqual(loop, { entries: [], deferred: [] });
});

test('AC5.1: postMergeOne returns already-done when the marker is present', async () => {
  const root = mainCheckout();
  const marker = formatEntry({ status: 'AUTO', now: NOW, step: MARKER_STEP, text: 'ran Steps 4.0 and 4.0b', reversibility: 'n/a' });
  const dir = addRun(root, '2026-10-30T090000-spec-1', { decisions: `${marker}\n` });
  const links = fakeClosingLinks(ENVELOPE);
  const entry = await postMergeOne(oneArgs(root, dir, { prs: { 11: merged() }, links, close: fakeCloseParents() }));
  assert.deepEqual(entry, { runDir: dir, pr: 11, action: 'skipped', reason: 'already-done' });
  assert.equal(links.calls.length, 0);
});

test('postMergeOne reads a multi-spec spec-*/decisions.md marker', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  fs.mkdirSync(path.join(dir, 'spec-4'));
  const marker = formatEntry({ status: 'AUTO', now: NOW, step: 'pr-first-merge Step 4.0b', spec: 4, text: 'closed parent #9', reversibility: 'high' });
  fs.writeFileSync(path.join(dir, 'spec-4', 'decisions.md'), `${marker}\n`);
  const links = fakeClosingLinks(ENVELOPE);
  const entry = await postMergeOne(oneArgs(root, dir, { prs: { 11: merged() }, links, close: fakeCloseParents() }));
  assert.equal(entry.reason, 'already-done');
  assert.equal(links.calls.length, 0);
});

test('postMergeOne runs inside MERGE_GRACE_MS under the claim with the in-session parameters', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const links = fakeClosingLinks(ENVELOPE);
  const close = fakeCloseParents();
  let claims = 0;
  const takeClaimFn = (d, nowMs) => { claims += 1; return takeClaim(d, nowMs); };
  const entry = await postMergeOne(oneArgs(root, dir, {
    prs: { 11: merged(new Date(NOW - 60 * 1000).toISOString()) }, links, close, takeClaimFn,
  }));
  assert.equal(entry.action, 'ran');
  assert.equal(claims, 1);
  assert.deepEqual(links.calls[0].argv, ['--run', dir, '--mode', 'post-merge']);
  assert.equal(close.calls[0].selfInclude, true);
  assert.ok(hasPostMergeMarker(decisionsOf(dir)));
  assert.ok(!fs.existsSync(lockOf(dir)));
});

test('postMergeOne surfaces Step 4.0\'s record lists; postMerge entries never carry them', async () => {
  const envelope = {
    action: 'reopen-failed', closingSet: [101], failed: [{ issue: 105, error: 'x' }], closeFailed: [], pendingClose: [106], reopened: [],
  };
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const entry = await postMergeOne(oneArgs(root, dir, { prs: { 11: merged() }, links: fakeClosingLinks(envelope), close: fakeCloseParents() }));
  assert.deepEqual(entry.records, { failed: [105], closeFailed: [], pendingClose: [106], unchecked: [] });
  const other = mainCheckout();
  addRun(other, '2026-10-30T090000-spec-1');
  const loop = await run(other, { prs: { 11: merged() }, links: fakeClosingLinks(envelope), close: fakeCloseParents() });
  assert.equal(loop.entries.length, 1);
  assert.ok(!('records' in loop.entries[0]));
});

test('postMergeOne names the merge re-run in an archived run\'s retry line, the reconcile pass in a live one\'s', async () => {
  const root = mainCheckout();
  const archived = addArchivedRun(root, '2026-01-01T000000-spec-9', { config: 'mode: auto\nspec: 9\n' });
  const entry = await postMergeOne(oneArgs(root, archived, { prs: { 11: merged() }, links: fakeClosingLinks(null, 5), close: fakeCloseParents() }));
  assert.equal(entry.reason, 'transient-failure');
  const line = entriesOf(archived).find((e) => e.location === ATTEMPT_STEP).action;
  assert.match(line, /the next \/claude-tweaks:wrap-up #9 merge retries Steps 4\.0 and 4\.0b; after 3 attempts the tidy parent-gate backstop recovers the parent/);
  assert.doesNotMatch(line, /reconcile pass/);

  const noSpec = addArchivedRun(root, '2026-01-02T000000-spec-8');
  await postMergeOne(oneArgs(root, noSpec, { prs: { 11: merged() }, links: fakeClosingLinks(null, 5), close: fakeCloseParents() }));
  const bare = entriesOf(noSpec).find((e) => e.location === ATTEMPT_STEP).action;
  assert.match(bare, /the next \/claude-tweaks:wrap-up merge retries Steps 4\.0 and 4\.0b/);

  const live = addRun(root, '2026-10-30T090000-spec-1');
  await postMergeOne(oneArgs(root, live, { prs: { 11: merged() }, links: fakeClosingLinks(null, 5), close: fakeCloseParents() }));
  assert.match(entriesOf(live).find((e) => e.location === ATTEMPT_STEP).action, /the next reconcile pass retries Steps 4\.0 and 4\.0b/);
});

test('postMergeOne returns in-flight when the claim is held', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const links = fakeClosingLinks(ENVELOPE);
  const entry = await postMergeOne(oneArgs(root, dir, {
    prs: { 11: merged() }, links, close: fakeCloseParents(), takeClaimFn: () => ({ ok: false, reason: 'in-flight' }),
  }));
  assert.deepEqual(entry, { runDir: dir, pr: 11, action: 'skipped', reason: 'in-flight' });
  assert.equal(links.calls.length, 0);
});

test('postMergeOne returns no-pr and not-merged', async () => {
  const root = mainCheckout();
  const noPr = addRun(root, '2026-10-30T090000-spec-1', { pr: null });
  const open = addRun(root, '2026-10-30T090001-spec-2', { pr: 12 });
  const links = fakeClosingLinks(ENVELOPE);
  const a = await postMergeOne(oneArgs(root, noPr, { prs: {}, links, close: fakeCloseParents() }));
  assert.deepEqual(a, { runDir: noPr, pr: null, action: 'skipped', reason: 'no-pr' });
  const b = await postMergeOne(oneArgs(root, open, { prs: { 12: { number: 12, state: 'OPEN' } }, links, close: fakeCloseParents() }));
  assert.deepEqual(b, { runDir: open, pr: 12, action: 'skipped', reason: 'not-merged', detail: 'OPEN' });
  assert.equal(links.calls.length, 0);
});

test('postMergeOne reports setup failures with pr null', async () => {
  const dir = '/nonexistent/run';
  const base = { runDir: dir, now, deps: {} };
  const wrongBackend = mainCheckout({ claudeMd: '## Work records\n\nwork-backend: local\n' });
  assert.deepEqual(await postMergeOne({ ...base, cwd: wrongBackend, prStates: fakePrStates({}) }), { runDir: dir, pr: null, action: 'skipped', reason: 'not-github-issues' });
  const noRemote = mainCheckout({ origin: false });
  assert.deepEqual(await postMergeOne({ ...base, cwd: noRemote, prStates: fakePrStates({}) }), { runDir: dir, pr: null, action: 'skipped', reason: 'no-remote' });
  const ok = mainCheckout();
  assert.deepEqual(await postMergeOne({ ...base, cwd: ok, prStates: null }), { runDir: dir, pr: null, action: 'skipped', reason: 'no-pr-states' });
});
