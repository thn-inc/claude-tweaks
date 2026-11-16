'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../tools/review-replay');
const { splitChunkReply, settleReply, agentIdentity } = require('../../tools/review-replay/score');
const { armLabel } = require('../../tools/review-replay/schema');
const { ARCHIVE, makeDeps } = require('./helpers');

const ARMS = ['--arm', 'name=one,chunk=1,profile=fast', '--arm', 'name=eight,chunk=8,profile=fast'];

// The four replayable findings and the line and quote each tree file is rewritten to hold, so a reply can verify.
const FINDINGS = {
  a1: { id: 'aaaaaaaaaaa1', run: 'run-a', file: 'src/alpha.js', line: 10, quote: 'const alpha_marker = 1;' },
  a2: { id: 'aaaaaaaaaaa2', run: 'run-a', file: 'src/beta.js', line: 20, quote: 'const beta_marker = 2;' },
  b1: { id: 'bbbbbbbbbbb1', run: 'run-b', file: 'lib/one.js', line: 7, quote: 'const one_marker = 3;' },
  b2: { id: 'bbbbbbbbbbb2', run: 'run-b', file: 'lib/two.js', line: 8, quote: 'const two_marker = 4;' },
};

// A reply for one finding: the lines tiebreak.js parses, citing the file as the judge would.
function reply(key, verdict, { status = 'DONE', evidencePath = FINDINGS[key].file, last = true } = {}) {
  const f = FINDINGS[key];
  const lines = [`Verdict: ${verdict}`, `Evidence: ${evidencePath}:${f.line} "${f.quote}"`, 'Severity: medium', 'Recommendation: file'];
  if (last) lines.push(`STATUS: ${status}`);
  return lines.join('\n');
}
const chunkReply = (parts, status = 'DONE') => `${parts.map(([key, text]) => `### Finding ${FINDINGS[key].id}\n${text}`).join('\n\n')}\n\nSTATUS: ${status}`;

// Runs extract into a fresh dir and rewrites the tree files; returns paths and the writers for journal and transcripts.
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-score-'));
  const out = path.join(root, 'out');
  const transcripts = path.join(root, 'workflow');
  fs.mkdirSync(transcripts);
  const deps = makeDeps();
  const code = await run({ argv: ['extract', '--runs', ARCHIVE, '--out', out, ...ARMS], deps });
  assert.equal(code, 0, deps.errs.join('\n'));
  for (const f of Object.values(FINDINGS)) {
    const body = Array.from({ length: f.line - 1 }, (_, i) => `// pad ${i + 1}`);
    body.push(f.quote);
    fs.writeFileSync(path.join(out, 'trees', f.run, f.file), `${body.join('\n')}\n`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const promptFor = (arm, name) => manifest.arms.find((a) => a.name === arm).prompts.find((p) => p.name === name);
  const jsonl = (file, entries) => fs.writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);

  // An agent's transcript: the identity prompt first, then assistant messages [id, output, cacheRead, cacheCreate], each
  // preceded by a streamed partial of the same id carrying a smaller output count.
  function agent(agentId, label, { messages = [], seconds = 0, identity = true, prompt } = {}) {
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const text = prompt === undefined ? `Replay judge ${label}.\n\nThe finding follows.` : prompt;
    const entries = [{ type: 'user', timestamp: new Date(t0).toISOString(), message: { role: 'user', content: identity ? text : 'no identity here' } }];
    messages.forEach(([id, o, cr, cc], i) => {
      const at = new Date(t0 + (i + 1) * seconds * 1000 / Math.max(messages.length, 1)).toISOString();
      entries.push({ type: 'assistant', timestamp: at, message: { id, usage: { output_tokens: 1, cache_read_input_tokens: cr, cache_creation_input_tokens: cc } } });
      entries.push({ type: 'assistant', timestamp: at, message: { id, usage: { output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc } } });
    });
    jsonl(path.join(transcripts, `agent-${agentId}.jsonl`), entries);
  }
  const journal = (startedIds, results) => jsonl(path.join(transcripts, 'journal.jsonl'), [
    ...startedIds.map((agentId) => ({ type: 'started', agentId })),
    ...Object.entries(results).map(([agentId, result]) => ({ type: 'result', agentId, result })),
  ]);
  const score = async (extra = []) => {
    const d = makeDeps();
    const code = await run({ argv: ['score', '--out', out, '--transcripts', transcripts, ...extra], deps: d });
    return { code, deps: d, json: d.logs.length > 0 ? JSON.parse(d.logs.join('\n')) : null };
  };
  const tree = (name) => path.join(out, 'trees', name);
  return { root, out, transcripts, promptFor, agent, journal, score, tree, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const MSGS_ONE = [['m1', 10, 100, 1000], ['m2', 5, 200, 0]];
const MSGS_EIGHT = [['m1', 20, 50, 500], ['m2', 7, 60, 0]];

// The full happy-path set: four single-finding judges for arm one, two chunk judges for arm eight.
function fullSet(s, overrides = {}) {
  const judges = {
    'ag-1': { label: armLabel('one', 1, 'run-a--0'), reply: reply('a1', 'confirmed'), messages: MSGS_ONE, seconds: 10 },
    'ag-2': { label: armLabel('one', 1, 'run-a--1'), reply: reply('a2', 'confirmed'), messages: MSGS_ONE, seconds: 10 },
    'ag-3': { label: armLabel('one', 1, 'run-b--0'), reply: reply('b1', 'confirmed'), messages: MSGS_ONE, seconds: 10 },
    'ag-4': { label: armLabel('one', 1, 'run-b--1'), reply: reply('b2', 'refuted'), messages: MSGS_ONE, seconds: 10 },
    'ag-5': { label: armLabel('eight', 1, 'run-a--0'), reply: chunkReply([['a1', reply('a1', 'confirmed', { last: false })], ['a2', reply('a2', 'refuted', { last: false })]]), messages: MSGS_EIGHT, seconds: 30 },
    'ag-6': { label: armLabel('eight', 1, 'run-b--0'), reply: chunkReply([['b1', reply('b1', 'refuted', { last: false })], ['b2', reply('b2', 'cant-tell', { last: false })]]), messages: MSGS_EIGHT, seconds: 30 },
    ...overrides,
  };
  const results = {};
  for (const [id, j] of Object.entries(judges)) {
    if (j === null) continue;
    s.agent(id, j.label, j);
    if (j.reply !== undefined) results[id] = j.reply;
  }
  s.journal(Object.keys(judges).filter((id) => judges[id] !== null), results);
}

test('AC3.1/AC3.2: score prints agreement in total, per verdict class and per severity, and agents and tokens per arm', async () => {
  const s = await setup();
  try {
    fullSet(s);
    const r = await s.score();
    assert.equal(r.code, 0, r.deps.errs.join('\n'));
    assert.equal(r.json.findings, 4);
    assert.equal(r.json.reference, 'one');
    assert.equal(r.json.unidentifiedAgents, 0);
    assert.deepEqual(r.json.counts.failedJudgeByReason, { 'status:DONE': 1 });
    assert.deepEqual(r.json.baseline, { agents: 4, out: 43, cc: 3706, cr: 376, seconds: 8 });

    assert.deepEqual(r.json.arms.one, {
      judged: 4,
      notJudged: 0,
      notJudgedByReason: {},
      cantTell: 0,
      total: { agree: 3, n: 4 },
      byClass: { confirmed: { agree: 2, n: 2 }, refuted: { agree: 1, n: 2 }, 'cant-tell': { agree: 0, n: 0 } },
      bySeverity: { medium: { agree: 1, n: 1 }, low: { agree: 0, n: 1 }, high: { agree: 1, n: 1 }, unknown: { agree: 1, n: 1 } },
      vsReference: { agree: 4, n: 4 },
      cost: { agents: 4, requests: 8, output: 60, cacheRead: 1200, cacheCreate: 4000, seconds: 40 },
    });
    assert.deepEqual(r.json.arms.eight, {
      judged: 4,
      notJudged: 0,
      notJudgedByReason: {},
      cantTell: 1,
      total: { agree: 2, n: 4 },
      byClass: { confirmed: { agree: 1, n: 2 }, refuted: { agree: 1, n: 2 }, 'cant-tell': { agree: 0, n: 0 } },
      bySeverity: { medium: { agree: 1, n: 1 }, low: { agree: 1, n: 1 }, high: { agree: 0, n: 1 }, unknown: { agree: 0, n: 1 } },
      vsReference: { agree: 1, n: 4 },
      cost: { agents: 2, requests: 4, output: 54, cacheRead: 220, cacheCreate: 1000, seconds: 60 },
    });
  } finally {
    s.cleanup();
  }
});

test('--reference picks the arm every other arm is compared to, and an unknown arm exits 2', async () => {
  const s = await setup();
  try {
    fullSet(s);
    const r = await s.score(['--reference', 'eight']);
    assert.equal(r.code, 0);
    assert.equal(r.json.reference, 'eight');
    assert.deepEqual(r.json.arms.eight.vsReference, { agree: 4, n: 4 });
    assert.deepEqual(r.json.arms.one.vsReference, { agree: 1, n: 4 });
    const bad = await s.score(['--reference', 'nope']);
    assert.equal(bad.code, 2);
    assert.match(bad.deps.errs.join('\n'), /--reference: no arm "nope"/);
    assert.equal(bad.deps.logs.length, 0);
  } finally {
    s.cleanup();
  }
});

test('AC4.1: a results file missing one judge\'s reply leaves that judge\'s findings notJudged and scores the rest', async () => {
  const s = await setup();
  try {
    fullSet(s, { 'ag-2': { label: armLabel('one', 1, 'run-a--1'), messages: MSGS_ONE, seconds: 10 } });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.equal(r.json.arms.one.judged, 3);
    assert.equal(r.json.arms.one.notJudged, 1);
    assert.deepEqual(r.json.arms.one.notJudgedByReason, { 'no-reply': 1 });
    assert.deepEqual(r.json.arms.one.total, { agree: 3, n: 3 });
    assert.equal(r.json.arms.eight.notJudged, 0);
    assert.deepEqual(r.json.arms.one.vsReference, { agree: 3, n: 3 });
    assert.deepEqual(r.json.arms.eight.vsReference, { agree: 1, n: 3 });
  } finally {
    s.cleanup();
  }
});

test('AC4.2: a chunk reply that names a finding id twice leaves that finding notJudged and scores the others', async () => {
  const s = await setup();
  try {
    fullSet(s, {
      'ag-5': {
        label: armLabel('eight', 1, 'run-a--0'),
        reply: chunkReply([['a1', reply('a1', 'confirmed', { last: false })], ['a2', reply('a2', 'refuted', { last: false })], ['a1', reply('a1', 'refuted', { last: false })]]),
        messages: MSGS_EIGHT,
        seconds: 30,
      },
    });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.equal(r.json.arms.eight.judged, 3);
    assert.deepEqual(r.json.arms.eight.notJudgedByReason, { 'chunk-split': 1 });
    assert.deepEqual(r.json.arms.eight.total, { agree: 1, n: 3 });
    assert.deepEqual(r.json.arms.eight.byClass.refuted, { agree: 1, n: 2 });
    assert.deepEqual(r.json.arms.eight.byClass.confirmed, { agree: 0, n: 1 });
  } finally {
    s.cleanup();
  }
});

test('a chunk reply with no section for one id leaves that finding notJudged under chunk-split', async () => {
  const s = await setup();
  try {
    fullSet(s, { 'ag-6': { label: armLabel('eight', 1, 'run-b--0'), reply: chunkReply([['b1', reply('b1', 'confirmed', { last: false })]]), messages: MSGS_EIGHT, seconds: 30 } });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.deepEqual(r.json.arms.eight.notJudgedByReason, { 'chunk-split': 1 });
    assert.deepEqual(r.json.arms.eight.total, { agree: 3, n: 3 });
  } finally {
    s.cleanup();
  }
});

test('a started agent with no result counts notJudged and its tokens still total', async () => {
  const s = await setup();
  try {
    fullSet(s, { 'ag-4': { label: armLabel('one', 1, 'run-b--1'), messages: MSGS_ONE, seconds: 10 } });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.equal(r.json.arms.one.notJudged, 1);
    assert.deepEqual(r.json.arms.one.notJudgedByReason, { 'no-reply': 1 });
    assert.deepEqual(r.json.arms.one.cost, { agents: 4, requests: 8, output: 60, cacheRead: 1200, cacheCreate: 4000, seconds: 40 });
  } finally {
    s.cleanup();
  }
});

test('a prompt no agent was started for is notJudged under no-reply', async () => {
  const s = await setup();
  try {
    fullSet(s, { 'ag-3': null });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.deepEqual(r.json.arms.one.notJudgedByReason, { 'no-reply': 1 });
    assert.equal(r.json.arms.one.cost.agents, 3);
  } finally {
    s.cleanup();
  }
});

test('a reply settling with reason status:BLOCKED or no-evidence is notJudged under that reason, while evidence-unverified settles as cant-tell', async () => {
  const s = await setup();
  try {
    const noEvidence = 'Verdict: confirmed\nSeverity: medium\nSTATUS: DONE';
    const unverified = reply('b2', 'confirmed').replace(FINDINGS.b2.quote, 'a quote that is nowhere in the file');
    fullSet(s, {
      'ag-1': { label: armLabel('one', 1, 'run-a--0'), reply: reply('a1', 'confirmed', { status: 'BLOCKED' }), messages: MSGS_ONE, seconds: 10 },
      'ag-2': { label: armLabel('one', 1, 'run-a--1'), reply: noEvidence, messages: MSGS_ONE, seconds: 10 },
      'ag-4': { label: armLabel('one', 1, 'run-b--1'), reply: unverified, messages: MSGS_ONE, seconds: 10 },
    });
    const r = await s.score();
    assert.equal(r.code, 3);
    const one = r.json.arms.one;
    assert.deepEqual(one.notJudgedByReason, { 'status:BLOCKED': 1, 'no-evidence': 1 });
    assert.equal(one.judged, 2);
    assert.equal(one.cantTell, 1);
    assert.deepEqual(one.total, { agree: 1, n: 2 });
    assert.deepEqual(one.byClass['cant-tell'], { agree: 0, n: 0 });
    assert.deepEqual(one.byClass.refuted, { agree: 0, n: 1 });
  } finally {
    s.cleanup();
  }
});

test('an agent whose transcript carries no Replay judge identity line is counted in unidentifiedAgents and its findings stay notJudged', async () => {
  const s = await setup();
  try {
    fullSet(s, { 'ag-3': { label: armLabel('one', 1, 'run-b--0'), reply: reply('b1', 'confirmed'), messages: MSGS_ONE, seconds: 10, identity: false } });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.equal(r.json.unidentifiedAgents, 1);
    assert.deepEqual(r.json.arms.one.notJudgedByReason, { 'unidentified-agent': 1 });
    assert.equal(r.json.arms.one.judged, 3);
    assert.equal(r.json.arms.one.cost.agents, 3, 'an unidentified agent belongs to no arm\'s cost');
  } finally {
    s.cleanup();
  }
});

test('a started agent with no transcript file, or an identity label that names no replay slot, is unidentified', async () => {
  const s = await setup();
  try {
    fullSet(s, {
      'ag-3': { label: armLabel('one', 1, 'run-b--0'), reply: reply('b1', 'confirmed'), messages: MSGS_ONE, seconds: 10 },
      'ag-4': { label: 'not-an-arm-label', reply: reply('b2', 'refuted'), messages: MSGS_ONE, seconds: 10 },
    });
    fs.rmSync(path.join(s.transcripts, 'agent-ag-3.jsonl'));
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.equal(r.json.unidentifiedAgents, 2);
    assert.deepEqual(r.json.arms.one.notJudgedByReason, { 'unidentified-agent': 2 });
  } finally {
    s.cleanup();
  }
});

test('a reply citing the absolute tree path settles as the repo-relative path', async () => {
  const s = await setup();
  try {
    const abs = (key) => `${s.tree(FINDINGS[key].run)}/${FINDINGS[key].file}`;
    fullSet(s, {
      'ag-1': { label: armLabel('one', 1, 'run-a--0'), reply: reply('a1', 'confirmed', { evidencePath: abs('a1') }), messages: MSGS_ONE, seconds: 10 },
      'ag-5': {
        label: armLabel('eight', 1, 'run-a--0'),
        reply: chunkReply([['a1', reply('a1', 'confirmed', { last: false, evidencePath: abs('a1') })], ['a2', reply('a2', 'refuted', { last: false, evidencePath: abs('a2') })]]),
        messages: MSGS_EIGHT,
        seconds: 30,
      },
    });
    const r = await s.score();
    assert.equal(r.code, 0, JSON.stringify(r.json && r.json.arms));
    assert.deepEqual(r.json.arms.one.total, { agree: 3, n: 4 });
    assert.deepEqual(r.json.arms.eight.total, { agree: 2, n: 4 });
  } finally {
    s.cleanup();
  }
});

test('a transcript whose assistant messages repeat an id counts each id once at its largest usage', async () => {
  const s = await setup();
  try {
    fullSet(s);
    const r = await s.score();
    assert.equal(r.json.arms.one.cost.requests, 8);
    assert.equal(r.json.arms.one.cost.output, 60, 'the streamed partial of output 1 never adds to the final count');
  } finally {
    s.cleanup();
  }
});

test('score exits 2 when --out or --transcripts is missing', async () => {
  const deps = makeDeps();
  assert.equal(await run({ argv: ['score', '--out', '/nowhere'], deps }), 2);
  assert.match(deps.errs.join('\n'), /score requires --transcripts/);
  const deps2 = makeDeps();
  assert.equal(await run({ argv: ['score', '--transcripts', '/nowhere'], deps: deps2 }), 2);
  assert.match(deps2.errs.join('\n'), /score requires --out/);
});

test('splitChunkReply: sections start at a header line, the last non-empty line follows each section, and a repeated or absent id maps to null', () => {
  const ids = ['aaaaaaaaaaa1', 'aaaaaaaaaaa2', 'aaaaaaaaaaa3'];
  const text = ['intro', '### Finding aaaaaaaaaaa1', 'Verdict: confirmed', '', '## Finding aaaaaaaaaaa2', 'Verdict: refuted', '### Finding aaaaaaaaaaa2', 'Verdict: confirmed', '', 'STATUS: DONE'].join('\n');
  const got = splitChunkReply(text, ids);
  assert.deepEqual([...got.keys()], ids);
  assert.equal(got.get('aaaaaaaaaaa1'), 'Verdict: confirmed\nSTATUS: DONE');
  assert.equal(got.get('aaaaaaaaaaa2'), null, 'two sections');
  assert.equal(got.get('aaaaaaaaaaa3'), null, 'no section');
  const crlf = splitChunkReply('### Finding aaaaaaaaaaa1\r\nVerdict: confirmed\r\nSTATUS: DONE\r\n', ['aaaaaaaaaaa1']);
  assert.equal(crlf.get('aaaaaaaaaaa1'), 'Verdict: confirmed\nSTATUS: DONE');
});

test('settleReply maps outcomes to verdicts: confirmed, drop -> refuted, cant-tell reasons -> cant-tell, any other reason -> null with that reason', async () => {
  const s = await setup();
  try {
    const tree = s.tree('run-a');
    const f = { id: FINDINGS.a1.id, lens: '3a', path: 'src/alpha.js', line: 10, claim: 'alpha claim', severity: 'medium', kind: 'unconfirmed' };
    assert.deepEqual(settleReply(f, reply('a1', 'confirmed'), tree), { verdict: 'confirmed', reason: 'confirmed by tiebreak' });
    assert.deepEqual(settleReply(f, reply('a1', 'refuted'), tree), { verdict: 'refuted', reason: 'refuted by tiebreak' });
    assert.deepEqual(settleReply(f, reply('a1', 'cant-tell'), tree), { verdict: 'cant-tell', reason: 'verdict:cant-tell' });
    assert.deepEqual(settleReply(f, reply('a1', 'confirmed', { status: 'BLOCKED' }), tree), { verdict: null, reason: 'status:BLOCKED' });
    assert.deepEqual(settleReply(f, 'free prose', tree), { verdict: null, reason: 'could-not-parse' });
    assert.deepEqual(settleReply(f, reply('a1', 'confirmed', { evidencePath: 'src/other.js' }), tree), { verdict: null, reason: 'evidence-path-mismatch' });
    assert.deepEqual(settleReply({ ...f, line: 'x' }, reply('a1', 'confirmed'), tree), { verdict: null, reason: 'no-line' });
    assert.deepEqual(settleReply({ ...f, path: 'src/ti' + 'ebreak:x.js' }, reply('a1', 'confirmed'), tree), { verdict: null, reason: 'bad-finding-field' });
  } finally {
    s.cleanup();
  }
});

test('agentIdentity reads the label from the first user entry, as a string or as text blocks, and nothing else', () => {
  const line = (e) => JSON.stringify(e);
  const label = armLabel('one', 2, 'run-a--0');
  assert.equal(agentIdentity(line({ type: 'user', message: { content: `Replay judge ${label}.\nrest` } })), label);
  assert.equal(agentIdentity(line({ type: 'user', message: { content: [{ type: 'text', text: 'preamble' }, { type: 'text', text: `Replay judge ${label}.` }] } })), label);
  assert.equal(agentIdentity([line({ type: 'assistant', message: {} }), line({ type: 'user', message: { content: `Replay judge ${label}.` } })].join('\n')), label);
  assert.equal(agentIdentity([line({ type: 'user', message: { content: 'no identity' } }), line({ type: 'user', message: { content: `Replay judge ${label}.` } })].join('\n')), null, 'only the first user entry counts');
  assert.equal(agentIdentity(''), null);
  assert.equal(agentIdentity('not json'), null);
});

test('the chunk adapter must go once tiebreak.js exports a chunk splitter', () => {
  assert.ok(!Object.keys(require('../../plugin/bin/lib/tiebreak.js')).some((k) => /chunk|split/i.test(k)), 'remove the review-replay chunk adapter: #5540 has landed');
});
