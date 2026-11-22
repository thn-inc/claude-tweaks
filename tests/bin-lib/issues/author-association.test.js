'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  needsAssociation,
  buildAssociationQuery,
  fetchAuthorAssociations,
  attachAuthorAssociations,
  enrichRecords,
  enrichRecordsFile,
  warningLine,
} = require('../../../plugin/bin/lib/issues/author-association');
const { hasOriginLine } = require('../../../plugin/bin/lib/issues/provenance');
const { captureGhTimeout } = require('../../helpers/gh-timeout-probe');
const { chmodDenialSkip } = require('../../helpers/root');

// Fake runners are lazy functions inspecting `args` only when called, and throw
// on anything they do not handle so a wrong call fails loudly.
const isGraphQL = (args) => args[0] === 'api' && args[1] === 'graphql';
const isRepoView = (args) => args.join(' ') === 'repo view --json owner,name';
const numbersIn = (args) => {
  const q = args.find((a) => a.startsWith('query='));
  return [...q.matchAll(/i(\d+): issue\(number:\1\)\{ authorAssociation \}/g)].map((m) => Number(m[1]));
};
function answer(numbers, byNumber) {
  const repository = {};
  for (const n of numbers) repository[`i${n}`] = byNumber[n] === undefined ? null : { authorAssociation: byNumber[n] };
  return JSON.stringify({ data: { repository } });
}
function fakeRunner(byNumber, calls) {
  return (args) => {
    calls.push(args);
    if (isGraphQL(args)) return answer(numbersIn(args), byNumber);
    if (isRepoView(args)) return JSON.stringify({ name: 'r', owner: { id: 'X', login: 'o' } });
    throw new Error('unexpected ' + args.join(' '));
  };
}

const originRecord = (number, extra = {}) => ({ number, title: `t${number}`, labels: [], body: `Origin: wrap-up leftover from #1\n\nbody`, ...extra });

test('hasOriginLine matches a line-start Origin: line only', () => {
  assert.equal(hasOriginLine('Origin: ledger resolve gate'), true);
  assert.equal(hasOriginLine('intro\nOrigin:\nmore'), true);
  assert.equal(hasOriginLine('prose naming an Origin: line mid-sentence'), false);
  assert.equal(hasOriginLine(undefined), false);
  assert.equal(hasOriginLine(''), false);
});

test('needsAssociation: Origin line and unknown author trust only', () => {
  assert.equal(needsAssociation(originRecord(1)), true);
  assert.equal(needsAssociation(originRecord(1, { author: { login: 'app/x', is_bot: true } })), false, 'bots are already trusted');
  assert.equal(needsAssociation(originRecord(1, { authorAssociation: 'NONE' })), false, 'association already present');
  assert.equal(needsAssociation({ number: 1, body: 'no marker' }), false);
  assert.equal(needsAssociation(null), false);
});

test('buildAssociationQuery emits one alias per integer number and drops non-integers', () => {
  const q = buildAssociationQuery([4577, '7; x', -1, 1.5, 1e21, 12]);
  assert.match(q, /query\(\$owner:String!,\$repo:String!\)/);
  assert.match(q, /i4577: issue\(number:4577\)\{ authorAssociation \}/);
  assert.match(q, /i12: issue\(number:12\)\{ authorAssociation \}/);
  assert.equal((q.match(/issue\(number:/g) || []).length, 2);
  assert.doesNotMatch(q, /7; x|-1|1\.5|e\+21/);
  assert.equal(buildAssociationQuery([]), '');
  assert.equal(buildAssociationQuery(['7; x', 0]), '');
});

test('fetchAuthorAssociations batches 450 numbers as 200/200/50 with -f values', () => {
  const numbers = Array.from({ length: 450 }, (_, i) => i + 1);
  const byNumber = Object.fromEntries(numbers.map((n) => [n, 'MEMBER']));
  const calls = [];
  const out = fetchAuthorAssociations({ numbers, owner: 'o', repo: 'r', runner: fakeRunner(byNumber, calls) });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((a) => numbersIn(a).length), [200, 200, 50]);
  const chunks = [numbers.slice(0, 200), numbers.slice(200, 400), numbers.slice(400)];
  calls.forEach((args, i) => {
    assert.deepEqual(args, ['api', 'graphql', '-f', `query=${buildAssociationQuery(chunks[i])}`, '-f', 'owner=o', '-f', 'repo=r']);
    assert.equal(args.includes('-F'), false, 'never -F for resolved values');
  });
  assert.equal(out.byNumber.size, 450);
  assert.equal(out.failedBatches, 0);
});

test('fetchAuthorAssociations reads a partial NOT_FOUND answer from the thrown stdout', () => {
  const runner = (args) => {
    if (!isGraphQL(args)) throw new Error('unexpected ' + args.join(' '));
    const err = new Error('Command failed: gh api graphql');
    err.status = 1;
    err.stdout = JSON.stringify({
      data: { repository: { i1: { authorAssociation: 'MEMBER' }, i2: null } },
      errors: [{ type: 'NOT_FOUND', path: ['repository', 'i2'], message: 'Could not resolve to an Issue with the number of 2.' }],
    });
    throw err;
  };
  const out = fetchAuthorAssociations({ numbers: [1, 2], owner: 'o', repo: 'r', runner });
  assert.equal(out.byNumber.get(1), 'MEMBER');
  assert.equal(out.byNumber.has(2), false);
  assert.equal(out.failedBatches, 0);
  assert.equal(out.unresolved, 1, 'the null alias is counted, not silently dropped');
});

test('a batch that throws with no parseable stdout counts as failed; the other batch still maps', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (!isGraphQL(args)) throw new Error('unexpected ' + args.join(' '));
    const ns = numbersIn(args);
    if (ns.includes(1)) throw Object.assign(new Error('HTTP 502'), { stdout: '' });
    return answer(ns, { 3: 'OWNER', 4: 'NONE' });
  };
  const out = fetchAuthorAssociations({ numbers: [1, 2, 3, 4], owner: 'o', repo: 'r', runner, batchSize: 2 });
  assert.equal(calls.length, 2);
  assert.equal(out.failedBatches, 1);
  assert.equal(out.unresolved, 0, 'a failed batch is counted once as a batch, not per alias');
  assert.equal(out.firstCause, 'HTTP 502');
  assert.deepEqual([...out.byNumber.entries()], [[3, 'OWNER'], [4, 'NONE']]);
});

test('an answer with no data.repository counts as a failed batch', () => {
  const runner = (args) => {
    if (!isGraphQL(args)) throw new Error('unexpected ' + args.join(' '));
    return JSON.stringify({ data: null, errors: [{ type: 'RATE_LIMITED' }] });
  };
  const out = fetchAuthorAssociations({ numbers: [1], owner: 'o', repo: 'r', runner });
  assert.equal(out.failedBatches, 1);
  assert.equal(out.firstCause, 'no data.repository in the answer');
  assert.equal(out.byNumber.size, 0);
});

test('the first failed batch keeps its cause: stderr first, bounded to 300 characters', () => {
  const runner = (args) => {
    if (!isGraphQL(args)) throw new Error('unexpected ' + args.join(' '));
    throw Object.assign(new Error('Command failed: gh api graphql -f owner=o'), { stderr: `HTTP 403: rate limit\n${'x'.repeat(400)}`, stdout: '' });
  };
  const out = fetchAuthorAssociations({ numbers: [1, 2], owner: 'o', repo: 'r', runner, batchSize: 1 });
  assert.equal(out.failedBatches, 2);
  assert.match(out.firstCause, /^HTTP 403: rate limit x+$/);
  assert.equal(out.firstCause.length, 300);
});

test('warningLine is empty on a clean result and names every gap kind otherwise', () => {
  assert.equal(warningLine({ failedBatches: 0, unresolved: 0, firstCause: null, skipped: null }), '');
  assert.equal(warningLine({ failedBatches: 0, skipped: null }), '');
  const line = warningLine({ failedBatches: 1, unresolved: 2, firstCause: 'HTTP 502', skipped: null });
  assert.match(line, /\(1 batch\(es\) failed; first cause: HTTP 502; 2 issue\(s\) with no association in the answer\)/);
  assert.match(warningLine({ failedBatches: 0, unresolved: 1, skipped: null }), /\(1 issue\(s\) with no association in the answer\)/);
});

test('attachAuthorAssociations returns a new array and leaves unmatched records untouched', () => {
  const a = originRecord(1);
  const b = originRecord(2);
  const input = [a, b];
  const out = attachAuthorAssociations(input, new Map([[1, 'CONTRIBUTOR']]));
  assert.notEqual(out, input);
  assert.deepEqual(out[0], { ...a, authorAssociation: 'CONTRIBUTOR' });
  assert.equal(a.authorAssociation, undefined, 'input record is not mutated');
  assert.equal(out[1], b);
});

test('enrichRecords queries only non-bot Origin records and attaches the association', () => {
  const plain = { number: 3, title: 'plain', labels: [], body: 'no marker here' };
  const bot = originRecord(2, { author: { login: 'app/bot', is_bot: true } });
  const records = [originRecord(1), bot, plain];
  const snapshotOfPlain = JSON.parse(JSON.stringify(plain));
  const calls = [];
  const out = enrichRecords(records, { owner: 'o', repo: 'r', runner: fakeRunner({ 1: 'NONE', 2: 'MEMBER', 3: 'MEMBER' }, calls) });
  assert.equal(calls.length, 1);
  assert.deepEqual(numbersIn(calls[0]), [1]);
  assert.equal(out.records[0].authorAssociation, 'NONE');
  assert.equal(out.records[1], bot);
  assert.deepEqual(out.records[2], snapshotOfPlain);
  assert.equal(out.failedBatches, 0);
  assert.equal(out.skipped, null);
});

test('enrichRecords makes no call when no record needs an association', () => {
  const calls = [];
  const records = [{ number: 3, body: 'no marker' }];
  const out = enrichRecords(records, { runner: fakeRunner({}, calls) });
  assert.equal(calls.length, 0);
  assert.deepEqual(out, { records, failedBatches: 0, skipped: null });
});

test('enrichRecords resolves owner/repo from repo view when neither is passed', () => {
  const calls = [];
  const out = enrichRecords([originRecord(9)], { runner: fakeRunner({ 9: 'OWNER' }, calls) });
  assert.deepEqual(calls[0], ['repo', 'view', '--json', 'owner,name']);
  assert.deepEqual(calls[1].slice(-4), ['-f', 'owner=o', '-f', 'repo=r']);
  assert.equal(out.records[0].authorAssociation, 'OWNER');
});

test('enrichRecords returns the records unchanged as repo-unresolved when repo view throws', () => {
  const records = [originRecord(9)];
  const before = JSON.parse(JSON.stringify(records));
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isRepoView(args)) throw new Error('not a git repository');
    throw new Error('unexpected ' + args.join(' '));
  };
  const out = enrichRecords(records, { runner });
  assert.equal(out.skipped, 'repo-unresolved');
  assert.equal(out.failedBatches, 0);
  assert.deepEqual(out.records, before);
  assert.equal(calls.length, 1);
});

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'author-assoc-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'records.json');
  fs.writeFileSync(file, content);
  return file;
}

test('enrichRecordsFile round-trips a snapshot file and stays quiet on a clean run', () => {
  const file = tempFile(JSON.stringify([originRecord(5), { number: 6, body: 'x' }]));
  const lines = [];
  const out = enrichRecordsFile(file, { owner: 'o', repo: 'r', runner: fakeRunner({ 5: 'MEMBER' }, []), stderr: (s) => lines.push(s) });
  assert.equal(out.skipped, null);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written[0].authorAssociation, 'MEMBER');
  assert.deepEqual(written[1], { number: 6, body: 'x' });
  assert.deepEqual(lines, []);
});

test('enrichRecordsFile leaves a non-JSON file untouched and returns skipped without throwing', () => {
  const file = tempFile('not json');
  const lines = [];
  const calls = [];
  const out = enrichRecordsFile(file, { runner: fakeRunner({}, calls), stderr: (s) => lines.push(s) });
  assert.equal(typeof out.skipped, 'string');
  assert.equal(fs.readFileSync(file, 'utf8'), 'not json');
  assert.equal(calls.length, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /author-association enrichment incomplete/);
});

test('enrichRecordsFile writes exactly one warning line when a batch fails', () => {
  // Pretty-printed, so a rewrite (always compact) would change the bytes.
  const file = tempFile(JSON.stringify([originRecord(5)], null, 2));
  const before = fs.readFileSync(file, 'utf8');
  const lines = [];
  const runner = (args) => {
    if (isGraphQL(args)) throw new Error('HTTP 502');
    throw new Error('unexpected ' + args.join(' '));
  };
  const out = enrichRecordsFile(file, { owner: 'o', repo: 'r', runner, stderr: (s) => lines.push(s) });
  assert.equal(out.failedBatches, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /author-association enrichment incomplete \(1 batch\(es\) failed; first cause: HTTP 502\)/);
  assert.equal(lines[0].split('\n').filter(Boolean).length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing attached, nothing written');
});

test('enrichRecordsFile names repo-unresolved on one warning line and leaves the file untouched', () => {
  const file = tempFile(JSON.stringify([originRecord(5)], null, 2));
  const before = fs.readFileSync(file, 'utf8');
  const lines = [];
  const runner = (args) => {
    if (isRepoView(args)) throw new Error('not a git repository');
    throw new Error('unexpected ' + args.join(' '));
  };
  const out = enrichRecordsFile(file, { runner, stderr: (s) => lines.push(s) });
  assert.equal(out.skipped, 'repo-unresolved');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /author-association enrichment incomplete \(skipped: repo-unresolved\)/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('enrichRecordsFile reports write-failed when the snapshot cannot be written back', chmodDenialSkip('root ignores a read-only file mode'), () => {
  const file = tempFile(JSON.stringify([originRecord(5)], null, 2));
  const before = fs.readFileSync(file, 'utf8');
  fs.chmodSync(file, 0o444);
  const lines = [];
  try {
    const out = enrichRecordsFile(file, { owner: 'o', repo: 'r', runner: fakeRunner({ 5: 'MEMBER' }, []), stderr: (s) => lines.push(s) });
    assert.equal(out.skipped, 'write-failed');
    assert.equal(out.records[0].authorAssociation, 'MEMBER', 'the enriched records are still returned');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /author-association enrichment incomplete \(skipped: write-failed\)/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    fs.chmodSync(file, 0o644);
  }
});

// 10000 is below GH_BATCH_TIMEOUT_MS's 30000 floor, so the two bounds differ.
function runnerTimeout(args) {
  const modulePath = require.resolve('../../../plugin/bin/lib/issues/author-association');
  return captureGhTimeout({
    envValue: '10000',
    modulePaths: [modulePath],
    exercise: (setEnv) => {
      setEnv();
      require(modulePath).defaultRunner(args);
    },
  });
}

test('defaultRunner bounds api graphql by GH_BATCH_TIMEOUT_MS and repo view by GH_TIMEOUT_MS', () => {
  assert.equal(runnerTimeout(['api', 'graphql', '-f', 'query=q', '-f', 'owner=o', '-f', 'repo=r']), 30000);
  assert.equal(runnerTimeout(['repo', 'view', '--json', 'owner,name']), 10000);
});

test('hasOriginLine ignores fenced and absorbed Origin lines (#4502)', () => {
  assert.equal(hasOriginLine('```\nOrigin: quoted\n```'), false);
  assert.equal(hasOriginLine('## Absorbed: d — x\nOrigin: absorbed'), false);
  assert.equal(hasOriginLine('## Original request\nOrigin: own'), true);
});
