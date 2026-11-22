'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../tools/review-replay');
const { settleReply, agentIdentity, stripTree, transcriptEffort } = require('../../tools/review-replay/score');
const { resolveTiebreak } = require('../../plugin/bin/lib/tiebreak.js');
const { armLabel } = require('../../tools/review-replay/schema');
const { makeDeps, FINDINGS, reply, chunkReply, setup, MSGS_ONE, MSGS_EIGHT, fullSet } = require('./helpers');

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
      vsReference: null,
      cost: { agents: 4, requests: 8, output: 60, cacheRead: 1200, cacheCreate: 4000, seconds: 40 },
      recordedEffort: { unrecorded: 4 },
      effortFieldsDiffer: 0,
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
      recordedEffort: { unrecorded: 2 },
      effortFieldsDiffer: 0,
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
    assert.equal(r.json.arms.eight.vsReference, null, 'the reference arm has nothing to compare to');
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
    assert.equal(r.json.arms.one.vsReference, null);
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
    assert.deepEqual(r.json.unidentifiedCost, { agents: 1, requests: 2, output: 15, cacheRead: 300, cacheCreate: 1000, seconds: 10 });
  } finally {
    s.cleanup();
  }
});

test('unidentified-agent goes to at most as many prompts as there are unidentified agents; a never-started prompt beyond that is no-reply', async () => {
  const s = await setup();
  try {
    fullSet(s, {
      'ag-3': { label: armLabel('one', 1, 'run-b--0'), reply: reply('b1', 'confirmed'), messages: MSGS_ONE, seconds: 10, identity: false },
      'ag-4': null,
    });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.equal(r.json.unidentifiedAgents, 1);
    assert.deepEqual(r.json.arms.one.notJudgedByReason, { 'unidentified-agent': 1, 'no-reply': 1 });
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
    assert.deepEqual(r.json.unidentifiedCost, { agents: 2, requests: 2, output: 15, cacheRead: 300, cacheCreate: 1000, seconds: 10 }, 'a missing transcript adds an agent and no tokens');
  } finally {
    s.cleanup();
  }
});

test('an unreadable source tree exits 1 naming the run, instead of settling every reply as cant-tell', async () => {
  const s = await setup();
  try {
    fullSet(s);
    fs.rmSync(s.tree('run-b'), { recursive: true });
    const r = await s.score();
    assert.equal(r.code, 1);
    assert.equal(r.deps.logs.length, 0);
    assert.match(r.deps.errs.join('\n'), /source tree missing or not a directory: run-b \(/);
    assert.ok(r.deps.errs.join('\n').includes(s.tree('run-b')));
  } finally {
    s.cleanup();
  }
});

test('an archived cant-tell finding in the replayable set is tallied under byClass cant-tell', async () => {
  const s = await setup();
  try {
    fullSet(s, { 'ag-1': { label: armLabel('one', 1, 'run-a--0'), reply: reply('a1', 'cant-tell'), messages: MSGS_ONE, seconds: 10 } });
    const file = path.join(s.out, 'archived-verdicts.json');
    const archived = JSON.parse(fs.readFileSync(file, 'utf8'));
    archived.verdicts['run-a/aaaaaaaaaaa1'] = 'cant-tell';
    fs.writeFileSync(file, JSON.stringify(archived));
    const r = await s.score();
    assert.equal(r.code, 0);
    // one: a1 cant-tell=cant-tell agree; a2 confirmed vs refuted no; b1 agree; b2 agree.
    assert.deepEqual(r.json.arms.one.byClass, { confirmed: { agree: 1, n: 1 }, refuted: { agree: 1, n: 2 }, 'cant-tell': { agree: 1, n: 1 } });
    assert.deepEqual(r.json.arms.one.total, { agree: 3, n: 4 });
    // eight: a1 confirmed vs cant-tell no; a2 agree; b1 refuted vs confirmed no; b2 cant-tell vs refuted no.
    assert.deepEqual(r.json.arms.eight.byClass, { confirmed: { agree: 0, n: 1 }, refuted: { agree: 1, n: 2 }, 'cant-tell': { agree: 0, n: 1 } });
    assert.deepEqual(r.json.arms.eight.total, { agree: 1, n: 4 });
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

test('a transcript whose assistant messages repeat an id counts each id once, not once per streamed entry', async () => {
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

test('an agent transcript that exists but cannot be read leaves its agent unidentified, instead of aborting score', async () => {
  const s = await setup();
  try {
    fullSet(s);
    const file = path.join(s.transcripts, 'agent-ag-3.jsonl');
    fs.rmSync(file);
    fs.mkdirSync(file); // a directory where the transcript should be: readFileSync throws EISDIR
    const r = await s.score();
    assert.equal(r.code, 3, r.deps.errs.join('\n'));
    assert.equal(r.json.unidentifiedAgents, 1);
    assert.deepEqual(r.json.arms.one.notJudgedByReason, { 'unidentified-agent': 1 });
  } finally {
    s.cleanup();
  }
});

test('a run whose baseline cost is unknown (no timing.json) is left out of the baseline total and counted', async () => {
  const s = await setup();
  try {
    fullSet(s);
    const file = path.join(s.out, 'fixture.json');
    const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
    fixture.runs[1].baselineTiebreak = null;
    fs.writeFileSync(file, JSON.stringify(fixture));
    const r = await s.score();
    assert.equal(r.json.baselineRunsWithoutCost, 1);
    const whole = fixture.runs[0].baselineTiebreak;
    assert.deepEqual(r.json.baseline, { agents: whole.agents, out: whole.out, cc: whole.cc, cr: whole.cr, seconds: whole.seconds });
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

test('settleReply maps outcomes to verdicts: confirmed, drop -> refuted, cant-tell reasons -> cant-tell, any other reason -> null with that reason', async () => {
  const s = await setup();
  try {
    const tree = s.tree('run-a');
    const f = { id: FINDINGS.a1.id, lens: '3a', path: 'src/alpha.js', line: 10, claim: 'alpha claim', severity: 'medium', kind: 'unconfirmed' };
    const settle = (finding, text) => settleReply(finding, text, tree, { fs, resolveTiebreak });
    assert.deepEqual(settle(f, reply('a1', 'confirmed')), { verdict: 'confirmed', reason: 'confirmed by tiebreak' });
    assert.deepEqual(settle(f, reply('a1', 'refuted')), { verdict: 'refuted', reason: 'refuted by tiebreak' });
    assert.deepEqual(settle(f, reply('a1', 'cant-tell')), { verdict: 'cant-tell', reason: 'verdict:cant-tell' });
    assert.deepEqual(settle(f, reply('a1', 'confirmed', { status: 'BLOCKED' })), { verdict: null, reason: 'status:BLOCKED' });
    assert.deepEqual(settle(f, 'free prose'), { verdict: null, reason: 'could-not-parse' });
    assert.deepEqual(settle(f, reply('a1', 'confirmed', { evidencePath: 'src/other.js' })), { verdict: null, reason: 'evidence-path-mismatch' });
    assert.deepEqual(settle({ ...f, line: 'x' }, reply('a1', 'confirmed')), { verdict: null, reason: 'no-line' });
    assert.deepEqual(settle({ ...f, path: 'src/ti' + 'ebreak:x.js' }, reply('a1', 'confirmed')), { verdict: null, reason: 'bad-finding-field' });
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

test('a finding whose file is absent from its run tree is notJudged under file-absent-in-tree, not settled as cant-tell', async () => {
  const s = await setup();
  try {
    fullSet(s);
    fs.rmSync(path.join(s.tree('run-a'), 'src', 'alpha.js'));
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.deepEqual(r.json.arms.one.notJudgedByReason, { 'file-absent-in-tree': 1 });
    assert.deepEqual(r.json.arms.eight.notJudgedByReason, { 'file-absent-in-tree': 1 });
    assert.equal(r.json.arms.one.cantTell, 0);
    assert.deepEqual(r.json.arms.one.total, { agree: 2, n: 3 });
    assert.deepEqual(r.json.arms.eight.total, { agree: 1, n: 3 });
  } finally {
    s.cleanup();
  }
});

test('score reads tree files through deps.fs', async () => {
  const s = await setup();
  try {
    fullSet(s);
    const reads = [];
    const spy = { ...fs, readFileSync: (p, enc) => { reads.push(String(p)); return fs.readFileSync(p, enc); } };
    const r = await s.score([], { fs: spy });
    assert.equal(r.code, 0, r.deps.errs.join('\n'));
    assert.ok(reads.includes(path.join(s.tree('run-a'), 'src', 'alpha.js')), 'the evidence read went through deps.fs');
  } finally {
    s.cleanup();
  }
});

test('score requires tiebreak.js through deps.pluginRoot', async () => {
  const s = await setup();
  const stubRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-plugin-'));
  try {
    fs.mkdirSync(path.join(stubRoot, 'bin', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(stubRoot, 'bin', 'lib', 'tiebreak.js'), "exports.resolveTiebreak = () => ({ outcome: 'drop', reason: 'stub' });\nexports.splitChunkReply = (text, ids) => ({ status: null, blocks: new Map(ids.map((id) => [id, { state: 'ok', text }])) });\n");
    fs.mkdirSync(path.join(stubRoot, 'bin', 'lib', 'timing'), { recursive: true });
    const realTranscriptPath = path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'timing', 'transcript.js');
    fs.writeFileSync(path.join(stubRoot, 'bin', 'lib', 'timing', 'transcript.js'), `module.exports = require(${JSON.stringify(realTranscriptPath)});\n`);
    fullSet(s);
    const r = await s.score([], { pluginRoot: stubRoot });
    assert.equal(r.code, 0, r.deps.errs.join('\n'));
    assert.deepEqual(r.json.arms.one.total, { agree: 2, n: 4 }, 'every reply settled as refuted by the stub');
  } finally {
    fs.rmSync(stubRoot, { recursive: true, force: true });
    s.cleanup();
  }
});

test('stripTree settles the posix spelling of a backslash tree root', () => {
  assert.equal(stripTree('Evidence: C:/work/tree/src/alpha.js:10 "q"', 'C:\\work\\tree'), 'Evidence: src/alpha.js:10 "q"');
  assert.equal(stripTree('Evidence: /tmp/t/src/a.js:1', '/tmp/t'), 'Evidence: src/a.js:1');
});

test('vsReference compares each repeat with every reference repeat for that finding', async () => {
  const s = await setup({ arms: ['--arm', 'name=one,chunk=1,profile=fast', '--arm', 'name=eight,chunk=8,profile=fast,repeat=2'] });
  try {
    fullSet(s, {
      'ag-7': { label: armLabel('eight', 2, 'run-a--0'), reply: chunkReply([['a1', reply('a1', 'confirmed', { last: false })], ['a2', reply('a2', 'confirmed', { last: false })]]), messages: MSGS_EIGHT, seconds: 30 },
      'ag-8': { label: armLabel('eight', 2, 'run-b--0'), reply: chunkReply([['b1', reply('b1', 'confirmed', { last: false })], ['b2', reply('b2', 'refuted', { last: false })]]), messages: MSGS_EIGHT, seconds: 30 },
    });
    const r = await s.score();
    assert.equal(r.code, 0, r.deps.errs.join('\n'));
    // Repeat 1 agrees with the reference on 1 of 4 findings, repeat 2 on 4 of 4; neither repeat drops out.
    assert.deepEqual(r.json.arms.eight.vsReference, { agree: 5, n: 8 });
  } finally {
    s.cleanup();
  }
});

test('a streamed partial written after its final entry never lowers the id\'s counted usage', async () => {
  const s = await setup();
  try {
    fullSet(s);
    const file = path.join(s.transcripts, 'agent-ag-1.jsonl');
    const late = { type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: { id: 'm1', usage: { output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
    fs.appendFileSync(file, `${JSON.stringify(late)}\n`);
    const r = await s.score();
    assert.equal(r.json.arms.one.cost.requests, 8);
    assert.equal(r.json.arms.one.cost.output, 60, 'the late partial of output 1 never replaces the larger earlier count');
    assert.equal(r.json.arms.one.cost.cacheRead, 1200);
  } finally {
    s.cleanup();
  }
});

// Effort arm: four single-finding judges for `lo`; `over` overrides individual judges' effort fields.
const LO_ARMS = ['--arm', 'name=lo,chunk=1,profile=fast,effort=low'];
const ONE_MSG = [['m1', 10, 100, 1000]];
function loSet(s, over = {}) {
  const base = (key, id, verdict) => ({ label: armLabel('lo', 1, key), reply: reply(id, verdict), messages: ONE_MSG, seconds: 10, effort: 'low' });
  const judges = {
    'ag-1': base('run-a--0', 'a1', 'confirmed'),
    'ag-2': base('run-a--1', 'a2', 'confirmed'),
    'ag-3': base('run-b--0', 'b1', 'confirmed'),
    'ag-4': base('run-b--1', 'b2', 'refuted'),
  };
  for (const [id, o] of Object.entries(over)) judges[id] = { ...judges[id], ...o };
  const results = {};
  for (const [id, j] of Object.entries(judges)) {
    s.agent(id, j.label, j);
    if (j.reply !== undefined) results[id] = j.reply;
  }
  s.journal(Object.keys(judges), results);
}

test('#5990 AC4.1: a slot of an effort=low arm whose turns all recorded medium is notJudged under effort-mismatch, and score exits 3', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s, { 'ag-1': { effort: 'medium' } });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.deepEqual(r.json.arms.lo.notJudgedByReason, { 'effort-mismatch': 1 });
    assert.equal(r.json.arms.lo.judged, 3);
    assert.deepEqual(r.json.arms.lo.recordedEffort, { medium: 1, low: 3 });
  } finally {
    s.cleanup();
  }
});

test('#5990 AC4.2: the same slot with turns recording low is scored', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s);
    const r = await s.score();
    assert.equal(r.code, 0, r.deps.errs.join('\n'));
    assert.equal(r.json.arms.lo.notJudged, 0);
    assert.equal(r.json.arms.lo.judged, 4);
    assert.deepEqual(r.json.arms.lo.recordedEffort, { low: 4 });
  } finally {
    s.cleanup();
  }
});

test('#5990 AC5.1: a slot whose agent recorded no effort is effort-mismatch and counted unrecorded', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s, { 'ag-2': { effort: undefined } });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.deepEqual(r.json.arms.lo.notJudgedByReason, { 'effort-mismatch': 1 });
    assert.equal(r.json.arms.lo.recordedEffort.unrecorded, 1);
  } finally {
    s.cleanup();
  }
});

test('partial effort is unrecorded', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s, { 'ag-2': { effort: ['low', undefined] } });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.deepEqual(r.json.arms.lo.notJudgedByReason, { 'effort-mismatch': 1 });
    assert.equal(r.json.arms.lo.recordedEffort.unrecorded, 1);
  } finally {
    s.cleanup();
  }
});

test('turns that disagree are mixed and a mismatch', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s, { 'ag-2': { effort: ['low', 'medium'] } });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.deepEqual(r.json.arms.lo.notJudgedByReason, { 'effort-mismatch': 1 });
    assert.equal(r.json.arms.lo.recordedEffort.mixed, 1);
  } finally {
    s.cleanup();
  }
});

test('an entry whose effort and perTurnEffort differ is counted in effortFieldsDiffer', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s, { 'ag-2': { effort: 'low', perTurnEffort: 'high' } });
    const r = await s.score();
    assert.equal(r.code, 0, r.deps.errs.join('\n'));
    assert.equal(r.json.arms.lo.effortFieldsDiffer, 1);
    assert.equal(r.json.arms.lo.judged, 4);
  } finally {
    s.cleanup();
  }
});

test('a slot with no reply stays no-reply, not effort-mismatch', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s, { 'ag-2': { effort: 'medium', reply: undefined } });
    const r = await s.score();
    assert.deepEqual(r.json.arms.lo.notJudgedByReason, { 'no-reply': 1 });
  } finally {
    s.cleanup();
  }
});

test('synthetic error entries between low turns do not make a judge unrecorded', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s, { 'ag-2': { synthetic: 2 } });
    const r = await s.score();
    assert.equal(r.code, 0, r.deps.errs.join('\n'));
    assert.equal(r.json.arms.lo.judged, 4);
    assert.deepEqual(r.json.arms.lo.recordedEffort, { low: 4 });
    assert.equal(r.json.arms.lo.effortFieldsDiffer, 0);
  } finally {
    s.cleanup();
  }
});

test('a judge whose only assistant entries are synthetic is unrecorded and a mismatch', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s, { 'ag-2': { messages: [], synthetic: 2 } });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.deepEqual(r.json.arms.lo.notJudgedByReason, { 'effort-mismatch': 1 });
    assert.equal(r.json.arms.lo.recordedEffort.unrecorded, 1);
  } finally {
    s.cleanup();
  }
});

test('a slot of two identified agents, one low with a reply and one medium without, is effort-mismatch', async () => {
  const s = await setup({ arms: LO_ARMS });
  try {
    loSet(s);
    s.agent('ag-5', armLabel('lo', 1, 'run-a--0'), { messages: ONE_MSG, seconds: 10, effort: 'medium' });
    s.journal(['ag-1', 'ag-2', 'ag-3', 'ag-4', 'ag-5'], { 'ag-1': reply('a1', 'confirmed'), 'ag-2': reply('a2', 'confirmed'), 'ag-3': reply('b1', 'confirmed'), 'ag-4': reply('b2', 'refuted') });
    const r = await s.score();
    assert.equal(r.code, 3);
    assert.deepEqual(r.json.arms.lo.notJudgedByReason, { 'effort-mismatch': 1 });
    assert.deepEqual(r.json.arms.lo.recordedEffort, { low: 4, medium: 1 });
  } finally {
    s.cleanup();
  }
});

test('an arm with null effort is never checked but still reports recordedEffort', async () => {
  const s = await setup();
  try {
    fullSet(s);
    const r = await s.score();
    assert.equal(r.code, 0, r.deps.errs.join('\n'));
    assert.deepEqual(r.json.arms.one.recordedEffort, { unrecorded: 4 });
  } finally {
    s.cleanup();
  }
});

test('transcriptEffort classifies a transcript as one value, mixed or unrecorded', () => {
  const t = (...entries) => entries.map((e) => JSON.stringify(e)).join('\n');
  const a = (effort, perTurnEffort) => ({ type: 'assistant', ...(effort === undefined ? {} : { effort }), ...(perTurnEffort === undefined ? {} : { perTurnEffort }) });
  assert.deepEqual(transcriptEffort(t({ type: 'user' })), { effort: 'unrecorded', fieldsDiffer: false });
  assert.deepEqual(transcriptEffort(t(a('low'), a('low'))), { effort: 'low', fieldsDiffer: false });
  assert.deepEqual(transcriptEffort(t(a('low'), a('high'))), { effort: 'mixed', fieldsDiffer: false });
  assert.deepEqual(transcriptEffort(t(a('low'), a(undefined))), { effort: 'unrecorded', fieldsDiffer: false });
  assert.deepEqual(transcriptEffort(t(a('low', 'high'))), { effort: 'low', fieldsDiffer: true });
  const syn = { type: 'assistant', perTurnEffort: 'high', isApiErrorMessage: true, message: { model: '<synthetic>' } };
  assert.deepEqual(transcriptEffort(t(a('low'), syn, a('low'))), { effort: 'low', fieldsDiffer: false });
  assert.deepEqual(transcriptEffort(t({ type: 'user' }, syn)), { effort: 'unrecorded', fieldsDiffer: false });
});
