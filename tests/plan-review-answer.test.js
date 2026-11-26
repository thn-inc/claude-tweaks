'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { QUESTION_MARKER } = require('../plugin/bin/lib/issues/plan-review-answers');

const CLI = path.resolve(__dirname, '..', 'plugin', 'bin', 'plan-review-answer.js');
const SLUG = 'o/r';

let seq = 0;
function comment(body, createdAt, over = {}) {
  seq += 1;
  const c = {
    body,
    createdAt,
    url: `https://github.com/o/r/issues/7#issuecomment-${1000 + seq}`,
    author: { login: 'maintainer' },
    authorAssociation: 'OWNER',
    ...over,
  };
  return c;
}
const question = (over = {}) => comment(`${QUESTION_MARKER}\n**Question 1. Which?**`, '2026-11-26T10:00:00Z', over);
const reply = (text, over = {}) => comment(text, '2026-11-26T11:00:00Z', over);

const BODY = '## Current State\n\nSomething.\n\n## Original request\n\nBuild it.\n';

// A fake gh + tmp seam over one mutable issue. Records every argv; an `edit` applies the body file
// to the issue unless `editNoop` (the write "succeeds" but the read-back sees no change).
function fixture({ comments, body = BODY, labels = [], failEdit = false, editNoop = false, failReadAt = 0, noGh = false } = {}) {
  const state = { body, labels: labels.map((name) => ({ name })), comments };
  const calls = [];
  const files = new Map();
  const removed = [];
  let views = 0;
  const gh = (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(' ');
    if (key === 'repo view') return `${SLUG}\n`;
    if (key === 'issue view') {
      views += 1;
      if (failReadAt === views) throw new Error('read blew up');
      return JSON.stringify({ body: state.body, labels: state.labels, comments: state.comments });
    }
    if (key === 'issue edit') {
      if (failEdit) throw new Error('edit blew up');
      const file = args[args.indexOf('--body-file') + 1];
      if (!editNoop) state.body = files.get(file);
      return '';
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const out = [];
  const err = [];
  const deps = {
    ghAvailable: () => !noGh,
    gh,
    tmpPath: (name) => `/fake/tmp/${name}`,
    writeFile: (file, text) => { files.set(file, text); },
    removeFile: (file) => { removed.push(file); },
  };
  const edits = () => calls.filter((a) => a[0] === 'issue' && a[1] === 'edit');
  return { state, calls, files, removed, deps, edits, out, err };
}

function run(fx, argv) {
  const r = runCliSync(CLI, argv, { deps: fx.deps });
  const line = r.stdout.trim() === '' ? null : JSON.parse(r.stdout.trim().split('\n').pop());
  return { ...r, json: line };
}

test('AC3.1: answered with one pending reply issues exactly one gh issue edit carrying --body-file and --remove-label needs:answer, exit 0', () => {
  const q = question();
  const a = reply('/answer go with A');
  const fx = fixture({ comments: [q, a], labels: ['needs:answer', 'x'] });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 0);
  const edits = fx.edits();
  assert.equal(edits.length, 1);
  assert.ok(edits[0].includes('--body-file'));
  const i = edits[0].indexOf('--remove-label');
  assert.notEqual(i, -1);
  assert.equal(edits[0][i + 1], 'needs:answer');
  assert.deepEqual(edits[0].slice(0, 5), ['issue', 'edit', '7', '--repo', SLUG]);
  assert.deepEqual(r.json.ingested, [a.url]);
  assert.equal(r.json.state, 'answered');
  assert.equal(r.json.issue, 7);
  assert.equal(r.json.question, q.url);
  assert.deepEqual(r.json.replies, [a.url]);
  assert.ok(fx.state.body.includes(a.url));
  assert.equal(fx.removed.length, 1, 'the body file is removed after');
});

test('answered without the label present edits without --remove-label', () => {
  const fx = fixture({ comments: [question(), reply('/answer A')], labels: ['other'] });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 0);
  assert.equal(fx.edits().length, 1);
  assert.equal(fx.edits()[0].includes('--remove-label'), false);
});

test('AC3.2: an already-ingested reply issues no edit and exits 0', () => {
  const a = reply('/answer A');
  const fx = fixture({ comments: [question(), a], body: `${BODY}\nSee ${a.url}\n` });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 0);
  assert.equal(fx.edits().length, 0);
  assert.deepEqual(r.json.ingested, []);
  assert.equal(r.json.state, 'answered');
  assert.deepEqual(r.json.replies, [a.url]);
});

test('AC3.3: unanswered exits 3 with no edit', () => {
  const fx = fixture({ comments: [question()] });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 3);
  assert.equal(fx.edits().length, 0);
  assert.equal(r.json.state, 'unanswered');
});

test('AC3.3: no-question exits 3 with no edit', () => {
  const fx = fixture({ comments: [reply('/answer A')] });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 3);
  assert.equal(fx.edits().length, 0);
  assert.equal(r.json.state, 'no-question');
  assert.equal(r.json.question, null);
});

test('an untrusted /answer reply is never ingested', () => {
  for (const association of ['CONTRIBUTOR', 'NONE', undefined]) {
    const fx = fixture({ comments: [question(), reply('/answer evil', { authorAssociation: association })] });
    const r = run(fx, ['--issue', '7']);
    assert.equal(r.code, 3, String(association));
    assert.equal(fx.edits().length, 0);
    assert.equal(r.json.state, 'unanswered');
  }
});

test('an untrusted question reads no-question', () => {
  const fx = fixture({ comments: [question({ authorAssociation: 'NONE' }), reply('/answer A')] });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 3);
  assert.equal(r.json.state, 'no-question');
});

test('AC3.4: a failed edit exits 4', () => {
  const fx = fixture({ comments: [question(), reply('/answer A')], failEdit: true });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 4);
  assert.equal(fx.removed.length, 1, 'the body file is still removed');
});

test('AC3.4: a read-back missing the reply URL exits 4', () => {
  const fx = fixture({ comments: [question(), reply('/answer A')], editNoop: true });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 4);
});

test('AC3.4: a read-back citing the URL twice exits 4', () => {
  const a = reply('/answer A');
  const fx = fixture({ comments: [question(), a] });
  const edit = fx.deps.gh;
  fx.deps.gh = (args) => {
    const res = edit(args);
    if (args[0] === 'issue' && args[1] === 'edit') fx.state.body += `\n${a.url}\n`;
    return res;
  };
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 4);
});

test('AC3.4: a failed first read exits 4', () => {
  const fx = fixture({ comments: [question()], failReadAt: 1 });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 4);
  assert.equal(fx.edits().length, 0);
});

test('AC3.4: a failed read-back read exits 4', () => {
  const fx = fixture({ comments: [question(), reply('/answer A')], failReadAt: 2 });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 4);
});

test('AC3.5: --check never edits', () => {
  const a = reply('/answer A');
  const fx = fixture({ comments: [question(), a], labels: ['needs:answer'] });
  const r = run(fx, ['--issue', '7', '--check']);
  assert.equal(r.code, 0);
  assert.equal(fx.edits().length, 0);
  assert.deepEqual(r.json.ingested, []);
  assert.deepEqual(r.json.replies, [a.url]);
  assert.equal(fx.files.size, 0);
});

test('the JSON line carries questionCreatedAt', () => {
  const q = question();
  const r1 = run(fixture({ comments: [q] }), ['--issue', '7']);
  assert.equal(r1.json.questionCreatedAt, '2026-11-26T10:00:00Z');
  const r2 = run(fixture({ comments: [] }), ['--issue', '7']);
  assert.equal(r2.json.questionCreatedAt, null);
});

test('an append over 65,536 characters writes nothing and exits 4', () => {
  const fx = fixture({ comments: [question(), reply('/answer A')], body: `${BODY}${'x'.repeat(65536)}` });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 4);
  assert.equal(fx.edits().length, 0);
  assert.equal(fx.files.size, 0);
});

test('a result that lands at exactly 65,536 characters is written', () => {
  const a = reply('/answer A');
  const probe = fixture({ comments: [question(), a] });
  run(probe, ['--issue', '7']);
  const grown = probe.state.body.length;
  const pad = 65536 - grown;
  const fx = fixture({ comments: [question(), a], body: `${BODY}${'x'.repeat(pad)}` });
  const r = run(fx, ['--issue', '7']);
  assert.equal(r.code, 0);
  assert.equal(fx.edits().length, 1);
});

test('usage errors exit 2', () => {
  for (const argv of [[], ['--issue'], ['--issue', '0'], ['--issue', 'abc'], ['--issue', '1.5'], ['--issue', '7', '--bogus'], ['--issue', '']]) {
    const fx = fixture({ comments: [] });
    const r = runCliSync(CLI, argv, { deps: fx.deps });
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.equal(fx.calls.length, 0);
  }
});

test('--help prints usage and exits 0 without probing gh', () => {
  const fx = fixture({ comments: [], noGh: true });
  const r = runCliSync(CLI, ['--help'], { deps: fx.deps });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--issue/);
});

test('gh absent exits 2', () => {
  const fx = fixture({ comments: [], noGh: true });
  const r = runCliSync(CLI, ['--issue', '7'], { deps: fx.deps });
  assert.equal(r.code, 2);
});

test('an unresolvable repo slug exits 2', () => {
  const fx = fixture({ comments: [] });
  const gh = fx.deps.gh;
  fx.deps.gh = (args) => { if (args[0] === 'repo') throw new Error('no repo'); return gh(args); };
  const r = runCliSync(CLI, ['--issue', '7'], { deps: fx.deps });
  assert.equal(r.code, 2);
});

test('the issue read asks for body, labels and comments', () => {
  const fx = fixture({ comments: [] });
  run(fx, ['--issue', '7']);
  const view = fx.calls.find((a) => a[0] === 'issue' && a[1] === 'view');
  assert.deepEqual(view, ['issue', 'view', '7', '--repo', SLUG, '--json', 'body,labels,comments']);
});

test('realDeps carries the gh, ghAvailable and file seams', () => {
  const { realDeps } = require(CLI);
  for (const k of ['gh', 'ghAvailable', 'tmpPath', 'writeFile', 'removeFile', 'stdout', 'stderr']) {
    assert.equal(typeof realDeps[k], 'function', k);
  }
});

test('script entry: --help exits 0 and a missing --issue exits 2', () => {
  const ok = spawnCli(CLI, ['--help'], { env: { ...process.env } });
  assert.equal(ok.code, 0);
  const bad = spawnCli(CLI, [], { env: { ...process.env } });
  assert.equal(bad.code, 2);
});
