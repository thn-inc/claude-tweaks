// tests/stale-claim-pr-cli.test.js — in-process tests for bin/stale-claim-pr.js's
// run(argv, deps), in tests/list-claims-cli.test.js's deps-injection style.
// claim-store.js's matcher, mcp-pr-shape.js's normalizer and pr-body.js's Resume
// parser have their own suites; this file pins the CLI's own decisions — the
// order of its steps, one verdict for both transports, and which exit code or
// verdict each failure source lands on (#4596).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs, realDeps } = require('../plugin/bin/stale-claim-pr');
const { classifyPriorRun } = require('../plugin/bin/dispatch-resume');
const { parseRepo } = require('../plugin/bin/lib/repo-resolve');
const { composePrEarlyBody, composeResumeLine } = require('../plugin/bin/lib/flow/pr-body');

const RUN = '2026-10-31T005940-record-4596';
const DIR = `/repo/.claude-tweaks/pipelines/${RUN}`;
const CLAIM = '/scratch/claim.json';
const LISTING = '/scratch/listing.json';
const PR_URL = 'https://github.com/acme/w/pull/7';
const MARKED = `claude-tweaks-run: ${RUN}\n\n### Spec summary\n`;
const ROOT = '/repo/.claude-tweaks/pipelines';
const DISPATCH = '`/claude-tweaks:dispatch resume #4596`';

function composed(extra = {}) {
  return composePrEarlyBody({
    runId: RUN, specSummary: 'a summary', target: '#4596', nextStep: 'review', runDir: DIR, ...extra,
  });
}
const RESUME = composeResumeLine({ runDir: DIR, target: '#4596', nextStep: 'review' });

function ghEntry({ url = PR_URL, body, isCrossRepository = false }) {
  return { url, body, isCrossRepository };
}
function mcpEntry({ url = PR_URL, body, fullName = 'acme/w' }) {
  return { html_url: url, body, head: { repo: fullName === null ? null : { full_name: fullName } } };
}

function fakeDeps(files, overrides = {}) {
  const calls = { gh: [], readFile: [], stdout: [], stderr: [], ghAvailable: 0, pipelinesRoot: 0, exists: 0 };
  return {
    calls,
    ghAvailable: () => { calls.ghAvailable++; return true; },
    remoteUrl: () => 'https://github.com/acme/w.git',
    parseRepo,
    gh: (args) => { calls.gh.push(args); throw new Error('gh must not be called'); },
    readFile: (p) => {
      calls.readFile.push(p);
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    pipelinesRoot: () => { calls.pipelinesRoot++; throw new Error('must not probe the run dir'); },
    exists: () => { calls.exists++; throw new Error('must not probe the run dir'); },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

const claimFile = (runId = RUN) => ({ [CLAIM]: JSON.stringify({ runId, claimedAt: '2026-10-31T00:00:00Z' }) });
const out = (deps) => deps.calls.stdout.join('');
const verdictOf = (deps) => JSON.parse(out(deps));

// One CLI run per transport: gh (a fake gh returning the gh-shaped listing, no
// --listing) and MCP (--listing naming a file of the MCP-shaped listing, gh
// throwing if touched).
function runBoth(entriesGh, entriesMcp, extraArgs = [], overrides = {}, files = {}) {
  const ghDeps = fakeDeps({ ...claimFile(), ...files }, {
    gh: (args) => { ghDeps.calls.gh.push(args); return JSON.stringify(entriesGh); }, ...overrides,
  });
  const ghCode = run(['--claim-file', CLAIM, ...extraArgs], ghDeps);
  const mcpDeps = fakeDeps({ ...claimFile(), ...files, [LISTING]: JSON.stringify(entriesMcp) }, overrides);
  const mcpCode = run(['--claim-file', CLAIM, '--listing', LISTING, ...extraArgs], mcpDeps);
  return { ghCode, mcpCode, gh: verdictOf(ghDeps), mcp: verdictOf(mcpDeps), ghDeps, mcpDeps };
}

const NO_MATCH = { match: false, link: null, failure: null };

// Run-dir seams over a set of present paths; the archive's run-state.json goes in through `files`.
const present = (...paths) => {
  const set = new Set(paths);
  return { pipelinesRoot: () => ROOT, exists: (p) => set.has(p) };
};
// ROOT-relative paths go through path.join, as the CLI builds them (a hand-written `/` breaks on win32).
const ROOT_RUN = path.join(ROOT, RUN);
const ROOT_STATE = path.join(ROOT_RUN, 'run-state.json');
const ARCHIVE_RUN = path.join(ROOT, 'archive', RUN);
const ARCHIVE_STATE = path.join(ARCHIVE_RUN, 'run-state.json');
const archiveState = (status) => ({ [ARCHIVE_STATE]: JSON.stringify({ status }) });
const RESUME_ARGS = ['--resume', '--issue', '4596'];
// runBoth over one PR body on both transports, with the --resume --issue args.
function runResume(body, overrides, files) {
  return runBoth([ghEntry({ body })], [mcpEntry({ body })], RESUME_ARGS, overrides, files);
}

test('AC2.1: gh- and MCP-shaped listings give the same verdict', () => {
  const unmarked = (i) => ({ url: `https://github.com/acme/w/pull/${i + 100}`, body: 'nothing here' });
  const rows = [
    {
      name: 'a matching same-repo PR',
      gh: [ghEntry({ body: MARKED })], mcp: [mcpEntry({ body: MARKED })],
      want: { match: true, link: PR_URL, failure: null },
    },
    {
      name: 'a fork PR carrying the marker',
      gh: [ghEntry({ body: MARKED, isCrossRepository: true })], mcp: [mcpEntry({ body: MARKED, fullName: 'evil/w' })],
      want: NO_MATCH,
    },
    {
      name: 'an inline marker mention only',
      gh: [ghEntry({ body: `see claude-tweaks-run: ${RUN} for context` })],
      mcp: [mcpEntry({ body: `see claude-tweaks-run: ${RUN} for context` })],
      want: NO_MATCH,
    },
    {
      name: 'a 1000-entry listing with no marked PR',
      gh: Array.from({ length: 1000 }, (_, i) => ghEntry({ ...unmarked(i) })),
      mcp: Array.from({ length: 1000 }, (_, i) => mcpEntry({ ...unmarked(i) })),
      failure: /1000-entry limit/,
    },
    {
      name: 'a malformed listing',
      gh: {}, mcp: {},
      want: { match: false, link: null, failure: 'open-PR listing is not an array' },
    },
  ];
  for (const row of rows) {
    const r = runBoth(row.gh, row.mcp);
    assert.equal(r.ghCode, 0, `${row.name}: gh exit`);
    assert.equal(r.mcpCode, 0, `${row.name}: mcp exit`);
    assert.deepEqual(r.gh, r.mcp, `${row.name}: one verdict on both transports`);
    if (row.want) assert.deepEqual(r.gh, row.want, row.name);
    else {
      assert.equal(r.gh.match, false, row.name);
      assert.equal(r.gh.link, null, row.name);
      assert.match(r.gh.failure, row.failure, row.name);
    }
  }
});

test('each transport reads only its own source', () => {
  const r = runBoth([ghEntry({ body: MARKED })], [mcpEntry({ body: MARKED })]);
  assert.deepEqual(r.ghDeps.calls.gh, [['pr', 'list', '--repo', 'acme/w', '--state', 'open',
    '--json', 'url,body,isCrossRepository', '--limit', '1000']]);
  assert.deepEqual(r.ghDeps.calls.readFile, [CLAIM]);
  assert.deepEqual(r.mcpDeps.calls.gh, []);
  assert.deepEqual(r.mcpDeps.calls.readFile, [CLAIM, LISTING]);
  assert.equal(r.mcpDeps.calls.ghAvailable, 0, 'a --listing run never probes gh');
});

test('the verdict is one JSON line with keys in contract order', () => {
  const r = runBoth([ghEntry({ body: composed() })], [mcpEntry({ body: composed() })], ['--resume']);
  assert.match(r.ghDeps.calls.stdout.join(''), /^\{"match":true,"link":"[^"]+","resume":"[^\n]+","failure":null\}\n$/);
  assert.deepEqual(Object.keys(r.gh), ['match', 'link', 'resume', 'failure']);
});

test('the verdict for a gone run dir keeps the contract key order', () => {
  const r = runResume(composed(), present());
  assert.match(r.ghDeps.calls.stdout.join(''), /^\{"match":true,"link":"[^"]+","resume":"`\/claude-tweaks:dispatch resume #4596`","failure":null\}\n$/);
  assert.deepEqual(Object.keys(r.gh), ['match', 'link', 'resume', 'failure']);
});

test('a listing file with a non-object entry is a failure, never a no-match', () => {
  for (const listing of [[42], [null]]) {
    const deps = fakeDeps({ ...claimFile(), [LISTING]: JSON.stringify(listing) });
    assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING], deps), 0);
    const v = verdictOf(deps);
    assert.equal(v.match, false);
    assert.match(v.failure, /entry 0 is not an object/);
  }
});

test('a listing file entry that is not a PR is a failure, never a no-match', () => {
  const deps = fakeDeps({ ...claimFile(), [LISTING]: JSON.stringify([{ message: 'Not Found', status: '404' }]) });
  assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING], deps), 0);
  assert.match(verdictOf(deps).failure, /entry 0 is not a PR/);
});

test('a marked MCP entry with no head is a failure, never a no-match', () => {
  const noHead = { html_url: PR_URL, body: MARKED };
  const deps = fakeDeps({ ...claimFile(), [LISTING]: JSON.stringify([noHead]) });
  assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING], deps), 0);
  const v = verdictOf(deps);
  assert.equal(v.match, false);
  assert.equal(v.link, null);
  assert.match(v.failure, /entry 0 is not a PR/);
});

test('a null-body same-repo PR ahead of the marked one is skipped on both transports (REST returns null for an empty body)', () => {
  const nullBodyUrl = 'https://github.com/acme/w/pull/6';
  const r = runBoth(
    [ghEntry({ url: nullBodyUrl, body: null }), ghEntry({ body: MARKED })],
    [mcpEntry({ url: nullBodyUrl, body: null }), mcpEntry({ body: MARKED })],
  );
  for (const v of [r.gh, r.mcp]) assert.deepEqual(v, { match: true, link: PR_URL, failure: null });
});

test('a marked non-cross-repo entry whose url is another repo is a clean no-match (the same-repo url guard alone)', () => {
  const evil = 'https://github.com/evil/x/pull/1';
  const r = runBoth([ghEntry({ url: evil, body: MARKED })], [mcpEntry({ url: evil, body: MARKED, fullName: 'acme/w' })]);
  assert.deepEqual(r.gh, NO_MATCH);
  assert.deepEqual(r.mcp, NO_MATCH);
});

test('each failure source is a failure verdict at exit 0, never a throw or a no-match', () => {
  const garbage = '{not json';
  const cases = [
    { name: 'claim file unreadable', files: {}, args: ['--listing', LISTING], failure: /ENOENT/ },
    { name: 'claim file is not JSON', files: { [CLAIM]: garbage, [LISTING]: '[]' }, args: ['--listing', LISTING], failure: /JSON/ },
    { name: 'listing file unreadable', files: claimFile(), args: ['--listing', LISTING], failure: /ENOENT/ },
    { name: 'listing file is not JSON', files: { ...claimFile(), [LISTING]: garbage }, args: ['--listing', LISTING], failure: /JSON/ },
    {
      name: 'gh fails', files: claimFile(), args: [],
      deps: { gh: () => { throw new Error('gh: HTTP 502'); } }, failure: /HTTP 502/,
    },
    {
      name: 'gh output is not JSON', files: claimFile(), args: [],
      deps: { gh: () => garbage }, failure: /JSON/,
    },
    {
      name: 'normalizer refuses an entry', files: { ...claimFile(), [LISTING]: '["x"]' }, args: ['--listing', LISTING],
      failure: /entry 0 is not an object/,
    },
    {
      name: 'listing is not an array', files: { ...claimFile(), [LISTING]: '"x"' }, args: ['--listing', LISTING],
      failure: /not an array/,
    },
  ];
  for (const c of cases) {
    const deps = fakeDeps(c.files, c.deps || {});
    assert.equal(run(['--claim-file', CLAIM, ...c.args], deps), 0, `${c.name}: exit`);
    const v = verdictOf(deps);
    assert.equal(v.match, false, c.name);
    assert.equal(v.link, null, c.name);
    assert.match(v.failure, c.failure, c.name);
    assert.equal(deps.calls.stderr.length, 0, `${c.name}: failures are data on stdout`);
  }
});

test('AC3.1: a Resume line with a shell tail or a $( ) target yields resolve, never resume', () => {
  const edits = [
    ['a shell tail after the closing backtick', (b) => b.replace(RESUME, `${RESUME}; rm -rf ~`)],
    ['a shell tail inside the backticks', (b) => b.replace(RESUME, RESUME.replace(' review`', ' review; rm -rf ~`'))],
    ['a $( ) target', (b) => b.replace(RESUME, composeResumeLine({ runDir: DIR, target: '#1$(touch x)', nextStep: 'review' }))],
  ];
  for (const [name, edit] of edits) {
    const body = edit(composed());
    assert.notEqual(body, composed(), `${name}: the edit applied`);
    const r = runBoth([ghEntry({ body })], [mcpEntry({ body })], ['--resume']);
    for (const v of [r.gh, r.mcp]) {
      assert.equal(v.match, true, name);
      assert.equal(v.resolve, 'resume-line-shape', name);
      assert.equal('resume' in v, false, name);
    }
  }
});

test('--resume with the composed body yields resume equal to composeResumeLine', () => {
  const r = runBoth([ghEntry({ body: composed() })], [mcpEntry({ body: composed() })], ['--resume']);
  for (const v of [r.gh, r.mcp]) {
    assert.deepEqual(v, { match: true, link: PR_URL, resume: RESUME, failure: null });
    assert.equal('resolve' in v, false);
  }
});

test('--resume on a body with the marker but no Resume heading yields no-resume-line', () => {
  const r = runBoth([ghEntry({ body: MARKED })], [mcpEntry({ body: MARKED })], ['--resume']);
  for (const v of [r.gh, r.mcp]) {
    assert.deepEqual(v, { match: true, link: PR_URL, resolve: 'no-resume-line', failure: null });
  }
});

test('--resume on a Resume heading with nothing under it yields no-resume-line', () => {
  const body = `${MARKED}\n### Resume\n\n`;
  const r = runBoth([ghEntry({ body })], [mcpEntry({ body })], ['--resume']);
  assert.equal(r.gh.resolve, 'no-resume-line');
});

test("--resume on another run's Resume line yields resume-line-shape", () => {
  const other = composeResumeLine({ runDir: '/repo/.claude-tweaks/pipelines/2026-10-31T000000-other', target: '#1', nextStep: 'review' });
  const body = composed().replace(RESUME, other);
  const r = runBoth([ghEntry({ body })], [mcpEntry({ body })], ['--resume']);
  assert.equal(r.gh.resolve, 'resume-line-shape');
  assert.equal('resume' in r.gh, false);
});

test('without --resume a match carries neither resume nor resolve; --resume on a no-match adds neither', () => {
  const plain = runBoth([ghEntry({ body: composed() })], [mcpEntry({ body: composed() })]);
  assert.deepEqual(plain.gh, { match: true, link: PR_URL, failure: null });
  const none = runBoth([], [], ['--resume']);
  assert.deepEqual(none.gh, NO_MATCH);
  assert.deepEqual(none.mcp, NO_MATCH);
});

test('an invalid runId is a clean no-match and never lists PRs', () => {
  const deps = fakeDeps({ [CLAIM]: JSON.stringify({ runId: '../etc' }) });
  assert.equal(run(['--claim-file', CLAIM], deps), 0);
  assert.deepEqual(verdictOf(deps), NO_MATCH);
  assert.deepEqual(deps.calls.gh, []);
  assert.deepEqual(deps.calls.readFile, [CLAIM]);
  assert.equal(deps.calls.ghAvailable, 0);
  const viaListing = fakeDeps({ [CLAIM]: JSON.stringify({ runId: '../etc' }) });
  assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING], viaListing), 0);
  assert.deepEqual(verdictOf(viaListing), NO_MATCH);
  assert.deepEqual(viaListing.calls.readFile, [CLAIM], 'the listing file is never read');
});

test('a claim blob with no runId is a clean no-match', () => {
  const deps = fakeDeps({ [CLAIM]: JSON.stringify({ claimedAt: 'x' }) });
  assert.equal(run(['--claim-file', CLAIM], deps), 0);
  assert.deepEqual(verdictOf(deps), NO_MATCH);
  assert.deepEqual(deps.calls.gh, []);
});

test('gh absent without --listing exits 2 naming --listing; with --listing it never probes gh', () => {
  const absent = fakeDeps(claimFile(), { ghAvailable: () => false });
  assert.equal(run(['--claim-file', CLAIM], absent), 2);
  assert.match(absent.calls.stderr.join(''), /--listing/);
  assert.equal(out(absent), '');
  const viaListing = fakeDeps({ ...claimFile(), [LISTING]: '[]' }, {
    ghAvailable: () => { throw new Error('must not probe gh'); },
  });
  assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING], viaListing), 0);
  assert.deepEqual(verdictOf(viaListing), NO_MATCH);
});

test('a throwing ghAvailable probe is the gh-absent exit 2, not an uncaught throw', () => {
  const deps = fakeDeps(claimFile(), { ghAvailable: () => { throw new Error('probe blew up'); } });
  assert.equal(run(['--claim-file', CLAIM], deps), 2);
});

test('an unresolved repo exits 3 naming --repo, with no stdout; --repo resolves it', () => {
  const files = { ...claimFile(), [LISTING]: '[]' };
  const none = fakeDeps(files, { remoteUrl: () => { throw new Error('no such remote'); } });
  assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING], none), 3);
  assert.match(none.calls.stderr.join(''), /--repo/);
  assert.equal(out(none), '');
  const unparseable = fakeDeps(files, { remoteUrl: () => 'not a url' });
  assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING], unparseable), 3);
  const withRepo = fakeDeps(files, { remoteUrl: () => { throw new Error('no such remote'); } });
  assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING, '--repo', 'acme/w'], withRepo), 0);
});

test('a non-github.com host is the failure verdict, never a clean no-match, and nothing is read', () => {
  const ghes = 'https://ghe.example.com/acme/w/pull/7';
  const files = { ...claimFile(), [LISTING]: JSON.stringify([ghEntry({ url: ghes, body: MARKED })]) };
  const want = { match: false, link: null, failure: 'stale-claim matching supports github.com only' };
  const sources = [
    ['--repo host/owner/name', ['--repo', 'ghe.example.com/acme/w'], undefined],
    ['a GHES https origin', [], { remoteUrl: () => 'https://ghe.example.com/acme/w.git' }],
    ['a GHES ssh origin', [], { remoteUrl: () => 'git@ghe.example.com:acme/w.git' }],
  ];
  for (const [name, extra, overrides] of sources) {
    const deps = fakeDeps(files, overrides || {});
    assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING, ...extra], deps), 0, name);
    assert.deepEqual(verdictOf(deps), want, name);
    assert.deepEqual(deps.calls.readFile, [], `${name}: no claim or listing read`);
    assert.deepEqual(deps.calls.gh, [], `${name}: no gh call`);
    assert.equal(deps.calls.ghAvailable, 0, `${name}: no gh probe`);
  }
  const ghDeps = fakeDeps(claimFile(), { remoteUrl: () => 'https://ghe.example.com/acme/w.git' });
  assert.equal(run(['--claim-file', CLAIM], ghDeps), 0);
  assert.deepEqual(verdictOf(ghDeps), want);
  assert.deepEqual(ghDeps.calls.gh, [], 'the gh path never lists a GHES repo either');
  assert.equal(ghDeps.calls.ghAvailable, 0, 'the gh path never probes gh for a GHES repo');
  assert.deepEqual(ghDeps.calls.readFile, [], 'the gh path reads no claim file for a GHES repo');
  const explicit = fakeDeps({ ...claimFile(), [LISTING]: JSON.stringify([ghEntry({ body: MARKED })]) });
  assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING, '--repo', 'github.com/acme/w'], explicit), 0);
  assert.equal(verdictOf(explicit).match, true, 'an explicit github.com host still matches');
});

test('--repo owner/name is the repo the same-repo check runs against', () => {
  const body = MARKED;
  const deps = fakeDeps({ ...claimFile(), [LISTING]: JSON.stringify([ghEntry({ url: 'https://github.com/other/x/pull/3', body })]) },
    { remoteUrl: () => { throw new Error('no remote'); } });
  assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING, '--repo', 'other/x'], deps), 0);
  assert.deepEqual(verdictOf(deps), { match: true, link: 'https://github.com/other/x/pull/3', failure: null });
});

test('AC1.1: an archived run dir yields the dispatch resume line', () => {
  const r = runResume(composed(),
    present(ARCHIVE_RUN), archiveState('clean'));
  for (const v of [r.gh, r.mcp]) assert.deepEqual(v, { match: true, link: PR_URL, resume: DISPATCH, failure: null });
  assert.equal(r.ghCode, 0);
  assert.equal(r.mcpCode, 0);
});

test('AC1.1: an absent run dir yields the dispatch resume line', () => {
  const r = runResume(composed(), present());
  for (const v of [r.gh, r.mcp]) assert.deepEqual(v, { match: true, link: PR_URL, resume: DISPATCH, failure: null });
});

test('AC1.1: a real archive wins over a root dir that holds run-state.json', () => {
  const r = runResume(composed(),
    present(ROOT_RUN, ROOT_STATE, ARCHIVE_RUN), archiveState('clean'));
  for (const v of [r.gh, r.mcp]) assert.deepEqual(v, { match: true, link: PR_URL, resume: DISPATCH, failure: null });
});

test('AC1.1: the dispatch line names the claim\'s own issue, not a fixed number', () => {
  const runId = '2026-10-31T010000-record-4597';
  const body = composePrEarlyBody({
    runId, specSummary: 'a summary', target: '#4597', nextStep: 'review',
    runDir: `/repo/.claude-tweaks/pipelines/${runId}`,
  });
  const args = ['--claim-file', CLAIM, '--resume', '--issue', '4597'];
  const ghDeps = fakeDeps(claimFile(runId), { ...present(), gh: () => JSON.stringify([ghEntry({ body })]) });
  assert.equal(run(args, ghDeps), 0);
  const mcpDeps = fakeDeps({ ...claimFile(runId), [LISTING]: JSON.stringify([mcpEntry({ body })]) }, present());
  assert.equal(run([...args, '--listing', LISTING], mcpDeps), 0);
  for (const d of [ghDeps, mcpDeps]) {
    assert.deepEqual(verdictOf(d), { match: true, link: PR_URL, resume: '`/claude-tweaks:dispatch resume #4597`', failure: null });
  }
});

test('AC1.1: a gone run dir supersedes resolve', () => {
  const r = runResume(MARKED, present());
  for (const v of [r.gh, r.mcp]) {
    assert.equal(v.resume, DISPATCH);
    assert.equal('resolve' in v, false);
  }
});

test('AC2.1: a present run dir keeps the PR body\'s resume line', () => {
  const r = runResume(composed(), present(ROOT_RUN));
  for (const v of [r.gh, r.mcp]) assert.deepEqual(v, { match: true, link: PR_URL, resume: RESUME, failure: null });
});

test('a present run dir keeps resolve when the PR body has no usable Resume line', () => {
  const r = runResume(MARKED, present(ROOT_RUN));
  for (const v of [r.gh, r.mcp]) assert.deepEqual(v, { match: true, link: PR_URL, resolve: 'no-resume-line', failure: null });
});

test('an archiving-marker archive beside a present root is not gone', () => {
  const r = runResume(composed(),
    present(ROOT_RUN, ROOT_STATE, ARCHIVE_RUN), archiveState('archiving'));
  for (const v of [r.gh, r.mcp]) assert.equal(v.resume, RESUME);
});

test('an archive with a missing, unreadable or non-object run-state beside an absent root is gone', () => {
  for (const files of [{}, { [ARCHIVE_STATE]: '{not json' }, { [ARCHIVE_STATE]: '[]' }]) {
    const r = runResume(composed(),
      present(ARCHIVE_RUN), files);
    for (const v of [r.gh, r.mcp]) assert.equal(v.resume, DISPATCH, JSON.stringify(files));
  }
});

test('an archive with an unreadable or non-object run-state beside a present root holding run-state.json is not gone', () => {
  for (const state of ['{not json', '[]']) {
    const r = runResume(composed(),
      present(ROOT_RUN, ROOT_STATE, ARCHIVE_RUN), { [ARCHIVE_STATE]: state });
    for (const v of [r.gh, r.mcp]) assert.equal(v.resume, RESUME, state);
  }
});

test('AC1.1: a root dir with no run-state.json beside an archive dir is gone, whatever the archive holds (late-write stub rule)', () => {
  for (const status of ['archiving', 'clean']) {
    const r = runResume(composed(),
      present(ROOT_RUN, ARCHIVE_RUN), archiveState(status));
    for (const v of [r.gh, r.mcp]) assert.equal(v.resume, DISPATCH, status);
  }
});

test('a root dir holding run-state.json beside an archiving archive is not gone', () => {
  const r = runResume(composed(),
    present(ROOT_RUN, ROOT_STATE, ARCHIVE_RUN), archiveState('archiving'));
  for (const v of [r.gh, r.mcp]) assert.equal(v.resume, RESUME);
});

test('AC1.1: a gone run dir whose slug is not record-{n} is resolve run-dir-gone, never the dispatch line', () => {
  const direct = '2026-10-30T200217-spec-4596';
  const dispatched = '2026-10-31T005940-record-4597';
  for (const runId of [direct, dispatched]) {
    const body = composePrEarlyBody({
      runId, specSummary: 'a summary', target: '#4596', nextStep: 'review',
      runDir: `/repo/.claude-tweaks/pipelines/${runId}`,
    });
    const files = claimFile(runId);
    const ghDeps = fakeDeps(files, { ...present(), gh: () => JSON.stringify([ghEntry({ body })]) });
    assert.equal(run(['--claim-file', CLAIM, ...RESUME_ARGS], ghDeps), 0, runId);
    const mcpDeps = fakeDeps({ ...files, [LISTING]: JSON.stringify([mcpEntry({ body })]) }, present());
    assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING, ...RESUME_ARGS], mcpDeps), 0, runId);
    for (const d of [ghDeps, mcpDeps]) {
      assert.deepEqual(verdictOf(d), { match: true, link: PR_URL, resolve: 'run-dir-gone', failure: null }, runId);
      assert.equal('resume' in verdictOf(d), false, runId);
    }
  }
});

// The CLI's "gone" verdict mirrors dispatch-resume.js's classifyPriorRun archived/absent classes
// (#4673 review): drive both over one world matrix so a change to either rule the other does not
// follow goes red. A live root world needs no owner probes — a run-state.json without an owner block
// classifies dead-owner, never archived or absent.
test('the CLI\'s gone verdict agrees with dispatch-resume classifyPriorRun on archived or absent', () => {
  const state = (status) => JSON.stringify({ status });
  const worlds = [
    { name: 'nothing present', dirs: [], files: {} },
    { name: 'live root, no archive', dirs: [ROOT_RUN], files: { [ROOT_STATE]: state('active') } },
    { name: 'root dir without run-state.json, no archive', dirs: [ROOT_RUN], files: {} },
    { name: 'real archive, absent root', dirs: [ARCHIVE_RUN], files: { [ARCHIVE_STATE]: state('clean') } },
    { name: 'real archive beside a live root', dirs: [ROOT_RUN, ARCHIVE_RUN], files: { [ARCHIVE_STATE]: state('clean'), [ROOT_STATE]: state('active') } },
    { name: 'real archive beside a root stub', dirs: [ROOT_RUN, ARCHIVE_RUN], files: { [ARCHIVE_STATE]: state('clean') } },
    { name: 'archiving marker beside a live root', dirs: [ROOT_RUN, ARCHIVE_RUN], files: { [ARCHIVE_STATE]: state('archiving'), [ROOT_STATE]: state('active') } },
    { name: 'archiving marker, absent root', dirs: [ARCHIVE_RUN], files: { [ARCHIVE_STATE]: state('archiving') } },
    { name: 'archiving marker beside a root stub', dirs: [ROOT_RUN, ARCHIVE_RUN], files: { [ARCHIVE_STATE]: state('archiving') } },
    { name: 'unparseable archive state beside a live root', dirs: [ROOT_RUN, ARCHIVE_RUN], files: { [ARCHIVE_STATE]: '{not json', [ROOT_STATE]: state('active') } },
    { name: 'non-object archive state beside a live root', dirs: [ROOT_RUN, ARCHIVE_RUN], files: { [ARCHIVE_STATE]: '[]', [ROOT_STATE]: state('active') } },
    { name: 'non-object archive state, absent root', dirs: [ARCHIVE_RUN], files: { [ARCHIVE_STATE]: '[]' } },
  ];
  for (const w of worlds) {
    const paths = new Set([...w.dirs, ...Object.keys(w.files)]);
    const readFile = (p) => {
      if (!(p in w.files)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return w.files[p];
    };
    const readdir = (dir) => Object.keys(w.files).filter((f) => path.dirname(f) === dir).map((f) => path.basename(f));
    const classified = classifyPriorRun({ root: ROOT, deps: { exists: (p) => paths.has(p), readFile, readdir } }, RUN).priorRunDir;
    const dispatchGone = classified === 'archived' || classified === 'absent';
    const r = runResume(composed(), { pipelinesRoot: () => ROOT, exists: (p) => paths.has(p) }, w.files);
    for (const v of [r.gh, r.mcp]) assert.equal(v.resume === DISPATCH, dispatchGone, `${w.name}: dispatch resume classified ${classified}`);
  }
});

test('an unresolved main checkout keeps the PR body\'s resume line', () => {
  const r = runResume(composed(),
    { pipelinesRoot: () => null, exists: () => false });
  for (const v of [r.gh, r.mcp]) assert.deepEqual(v, { match: true, link: PR_URL, resume: RESUME, failure: null });
});

test('a throwing run-dir probe keeps the PR body\'s resume line', () => {
  const r = runResume(composed(),
    { pipelinesRoot: () => ROOT, exists: () => { throw new Error('EACCES'); } });
  for (const v of [r.gh, r.mcp]) assert.deepEqual(v, { match: true, link: PR_URL, resume: RESUME, failure: null });
});

test('--issue without --resume is a malformed invocation that probes nothing; --issue on a no-match never probes the run dir', () => {
  const deps = fakeDeps(claimFile());
  assert.equal(run(['--claim-file', CLAIM, '--issue', '4596'], deps), 1);
  assert.match(deps.calls.stderr.join(''), /--issue requires --resume/);
  assert.match(deps.calls.stderr.join(''), /usage: stale-claim-pr\.js/);
  assert.equal(out(deps), '');
  assert.equal(deps.calls.readFile.length, 0);
  assert.equal(deps.calls.pipelinesRoot, 0);
  assert.equal(deps.calls.exists, 0);
  const none = runBoth([], [], RESUME_ARGS);
  assert.deepEqual(none.gh, NO_MATCH);
  assert.deepEqual(none.mcp, NO_MATCH);
  for (const d of [none.ghDeps, none.mcpDeps]) {
    assert.equal(d.calls.pipelinesRoot, 0);
    assert.equal(d.calls.exists, 0);
  }
});

test('--resume without --issue never probes the run dir', () => {
  const r = runBoth([ghEntry({ body: composed() })], [mcpEntry({ body: composed() })], ['--resume']);
  for (const d of [r.ghDeps, r.mcpDeps]) {
    assert.equal(d.calls.pipelinesRoot, 0);
    assert.equal(d.calls.exists, 0);
  }
  assert.equal(r.gh.resume, RESUME);
});

test('malformed invocations exit 1 with usage on stderr and no stdout', () => {
  const POSITIVE_INT = /--issue requires a positive integer/;
  const bad = [
    ['no --claim-file', []],
    ['an unknown flag', ['--claim-file', CLAIM, '--bogus']],
    ['--listing with no value', ['--claim-file', CLAIM, '--listing']],
    ['--claim-file with no value', ['--claim-file']],
    ['--repo with no value', ['--claim-file', CLAIM, '--repo']],
    ['a flag in place of a value', ['--claim-file', '--resume']],
    ['an empty value', ['--claim-file', '']],
    // Every --issue value row carries --resume, so the value check is what rejects it, not the --resume requirement.
    ['--issue with no value', ['--claim-file', CLAIM, '--resume', '--issue'], POSITIVE_INT],
    ['--issue 0', ['--claim-file', CLAIM, '--resume', '--issue', '0'], POSITIVE_INT],
    ['--issue -3', ['--claim-file', CLAIM, '--resume', '--issue', '-3'], POSITIVE_INT],
    ['--issue 12x', ['--claim-file', CLAIM, '--resume', '--issue', '12x'], POSITIVE_INT],
    ['--issue abc', ['--claim-file', CLAIM, '--resume', '--issue', 'abc'], POSITIVE_INT],
    ['--issue 400 digits (Infinity)', ['--claim-file', CLAIM, '--resume', '--issue', '9'.repeat(400)], POSITIVE_INT],
    ['--issue past Number.MAX_SAFE_INTEGER', ['--claim-file', CLAIM, '--resume', '--issue', '9007199254740993'], POSITIVE_INT],
    ['--issue without --resume', ['--claim-file', CLAIM, '--issue', '4596'], /--issue requires --resume/],
  ];
  for (const [name, argv, message] of bad) {
    const deps = fakeDeps(claimFile());
    assert.equal(run(argv, deps), 1, name);
    if (message) assert.match(deps.calls.stderr.join(''), message, name);
    assert.match(deps.calls.stderr.join(''), /usage: stale-claim-pr\.js/, name);
    assert.equal(out(deps), '', name);
    assert.equal(deps.calls.readFile.length, 0, `${name}: nothing read`);
  }
});

test('AC1.1: the real pipelinesRoot and exists resolve an archived run in a temp repo from the cwd', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-claim-pr-'));
  const cwd = process.cwd();
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    const archive = path.join(tmp, '.claude-tweaks', 'pipelines', 'archive', RUN);
    fs.mkdirSync(archive, { recursive: true });
    fs.writeFileSync(path.join(archive, 'run-state.json'), JSON.stringify({ status: 'clean' }));
    const files = { ...claimFile(), [LISTING]: JSON.stringify([ghEntry({ body: composed() })]) };
    const deps = fakeDeps(files, { pipelinesRoot: realDeps.pipelinesRoot, exists: realDeps.exists,
      readFile: (p) => (p in files ? files[p] : realDeps.readFile(p)) });
    process.chdir(tmp);
    assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING, ...RESUME_ARGS], deps), 0);
    assert.deepEqual(verdictOf(deps), { match: true, link: PR_URL, resume: DISPATCH, failure: null });
    // The same temp repo with the run dir present (run-state.json and no archive) keeps the PR body's line.
    fs.rmSync(path.join(tmp, '.claude-tweaks', 'pipelines', 'archive'), { recursive: true });
    const root = path.join(tmp, '.claude-tweaks', 'pipelines', RUN);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'run-state.json'), JSON.stringify({ status: 'running' }));
    const live = fakeDeps(files, { pipelinesRoot: realDeps.pipelinesRoot, exists: realDeps.exists });
    assert.equal(run(['--claim-file', CLAIM, '--listing', LISTING, ...RESUME_ARGS], live), 0);
    assert.equal(verdictOf(live).resume, RESUME);
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--help prints usage and probes nothing', () => {
  const deps = fakeDeps(claimFile(), {
    ghAvailable: () => { throw new Error('must not probe gh'); },
    remoteUrl: () => { throw new Error('must not read the remote'); },
  });
  assert.equal(run(['--help'], deps), 0);
  assert.match(out(deps), /usage: stale-claim-pr\.js/);
  assert.equal(deps.calls.readFile.length, 0);
  // parseArgs runs before run() checks help, so --help beside a bare --issue must not trip the --resume requirement.
  const withIssue = fakeDeps(claimFile());
  assert.equal(run(['--issue', '4596', '--help'], withIssue), 0);
  assert.match(out(withIssue), /usage: stale-claim-pr\.js/);
  assert.equal(withIssue.calls.stderr.length, 0);
});

test('parseArgs reads the documented flags', () => {
  assert.deepEqual(parseArgs(['--claim-file', 'c', '--listing', 'l', '--repo', 'a/b', '--resume', '--issue', '7']),
    { claimFile: 'c', listing: 'l', repo: 'a/b', resume: true, issue: 7, help: false });
  assert.deepEqual(parseArgs(['--claim-file', 'c']),
    { claimFile: 'c', listing: null, repo: null, resume: false, issue: null, help: false });
});
