'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CONTEXT_CAP_TOKENS, CALLER_TAIL_BYTES, findAgentTranscript, hasInFlightGaugeCall, gauge, resolveTargetRecords,
} = require('../../../plugin/bin/lib/timing/context-gauge');
const { slugForCwd } = require('../../../plugin/bin/lib/timing/transcript');
const { run } = require('../../../plugin/bin/context-gauge');
const { gitRepo, harnessWorktreeOf } = require('../../helpers/git-fixtures');

// The developer's own CLAUDE_CONFIG_DIR must never redirect a lookup away from
// its fixture (#3458) — every lookup below passes its configDir explicitly.
delete process.env.CLAUDE_CONFIG_DIR;

// Trimmed from a real dispatched build+test call's subagent transcript
// (record #4151's run, Claude Code 2.1.302, observed 2026-10-25): the first
// user message plus the last 3 assistant turns and the tool_result lines
// between them, every text field redacted, cwd/gitBranch replaced. Its run id
// survives in the redacted prompt so identification can be probed on it too.
// Line 1 is one of the same file's api-request-blob user lines (message.role
// user, no timestamp), redacted and moved to the top — in the real file it
// comes later — so the timestamp filter decides which line is the first user
// message.
const REAL = path.join(__dirname, '..', '..', 'fixtures', 'context-gauge', 'dispatched-call-real.jsonl');
const REAL_RUN_ID = '2026-10-25T144531-record-4151';

const RUN_ID = '2026-10-25T162129-record-4027';
const SID = '0f3c9d2e-1b7a-4c55-9e21-7d4f0a6b8c13';
const CWD = '/Users/x/Code/repo/.claude/worktrees/wt';
const NOW = Date.parse('2026-10-25T18:00:00.000Z');

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(d);
  return d;
}

const userLine = (content, ts = '2026-10-25T17:00:00.000Z') => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content } });
// One assistant turn as Claude Code writes a subagent's: a streaming snapshot
// line, then the settled line, both under one message.id.
function turnLines(id, { input = 2, cacheRead = 0, cacheCreate = 0 }, ts = '2026-10-25T17:01:00.000Z') {
  const usage = (out) => ({ input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate, output_tokens: out });
  return [
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }], stop_reason: null, usage: usage(8) } }),
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: usage(400) } }),
  ];
}
const transcriptText = (lines) => `${lines.join('\n')}\n`;

// {configDir}/projects/{slug}/{sid}.jsonl + {sid}/subagents/, as observed.
function store({ main = true } = {}) {
  const configDir = tmp('ct-gauge-config-');
  const slugDir = path.join(configDir, 'projects', slugForCwd(CWD));
  const subagents = path.join(slugDir, SID, 'subagents');
  fs.mkdirSync(subagents, { recursive: true });
  const mainPath = path.join(slugDir, `${SID}.jsonl`);
  if (main) fs.writeFileSync(mainPath, transcriptText([userLine('top-level prompt'), ...turnLines('msg_main', { cacheRead: 90000 })]));
  return { configDir, slugDir, subagents, mainPath };
}

function agent(subagents, id, firstUser, mtimeSec, usage = { cacheRead: 1000 }) {
  const p = path.join(subagents, `agent-${id}.jsonl`);
  fs.writeFileSync(p, transcriptText([userLine(firstUser), ...turnLines(`msg_${id}`, usage)]));
  fs.utimesSync(p, mtimeSec, mtimeSec);
  return p;
}

const dispatchPrompt = (runId) => `Task scope: build+test.\nPIPELINE_RUN_DIR="/m/.claude-tweaks/pipelines/${runId}" /claude-tweaks:flow #4027 build,test auto`;

// The caller's in-flight call as Claude Code writes it before the tool runs:
// an assistant line with a Bash tool_use (shape from this session's own
// transcripts, 2026-10-25), and — once it completes — a user tool_result line.
const gaugeCommand = (runId) => `node "/p/bin/context-gauge.js" --run "/m/.claude-tweaks/pipelines/${runId}" --next-steps review,polish,wrap-up`;
const toolUseLine = (msgId, toolId, command, ts = '2026-10-25T17:05:00.000Z') => JSON.stringify({
  type: 'assistant', timestamp: ts, isSidechain: false,
  message: { id: msgId, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command, description: 'Measure context' } }], stop_reason: 'tool_use', usage: { input_tokens: 2, cache_read_input_tokens: 240000, cache_creation_input_tokens: 998, output_tokens: 90 } },
});
const toolResultLine = (toolId, ts = '2026-10-25T17:05:02.000Z') => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: '{}' }] } });
const attachmentLine = () => JSON.stringify({ type: 'attachment', timestamp: '2026-10-25T17:05:00.100Z', attachment: { type: 'hook_additional_context', content: ['x'] } });

// A transcript (main or agent) whose tail holds an in-flight gauge call.
function writeInFlight(p, firstUser, mtimeSec, { runId = RUN_ID, extra = [] } = {}) {
  fs.writeFileSync(p, transcriptText([userLine(firstUser), ...turnLines('msg_a', { cacheRead: 5000 }), toolUseLine('msg_b', 'toolu_gauge', gaugeCommand(runId)), ...extra]));
  if (mtimeSec !== undefined) fs.utimesSync(p, mtimeSec, mtimeSec);
  return p;
}
const find = (s, over = {}) => findAgentTranscript({ runId: RUN_ID, sessionId: SID, cwd: CWD, configDir: s.configDir, ...over });

test('CONTEXT_CAP_TOKENS is the 200k midpoint of #4027\'s measured curve', () => {
  assert.strictEqual(CONTEXT_CAP_TOKENS, 200000);
});

test('findAgentTranscript: of two agent transcripts, the newer whose first user message names the run id is chosen', () => {
  const s = store();
  agent(s.subagents, 'aold', 'an unrelated reviewer prompt', 1000);
  const newer = agent(s.subagents, 'anew', dispatchPrompt(RUN_ID), 2000);
  assert.deepStrictEqual(find(s), { path: newer, kind: 'subagent', identified: 'first-message' });
});

test('findAgentTranscript: the run id decides before recency, and recency decides between two matches', () => {
  const s = store();
  const older = agent(s.subagents, 'aold', dispatchPrompt(RUN_ID), 1000);
  agent(s.subagents, 'anew', 'an unrelated reviewer prompt', 2000);
  assert.deepStrictEqual(find(s), { path: older, kind: 'subagent', identified: 'first-message' }, 'a newer non-match never wins');
  const newest = agent(s.subagents, 'anewest', [{ type: 'text', text: dispatchPrompt(RUN_ID) }], 3000);
  assert.deepStrictEqual(find(s), { path: newest, kind: 'subagent', identified: 'first-message' }, 'array-of-text-blocks content counts too');
});

test('findAgentTranscript: only the FIRST user message counts — a later mention of the run id is not a match', () => {
  const s = store();
  const p = path.join(s.subagents, 'agent-alater.jsonl');
  fs.writeFileSync(p, transcriptText([userLine('an unrelated prompt'), ...turnLines('msg_x', {}), userLine(`later: ${RUN_ID}`)]));
  assert.deepStrictEqual(find(s), { path: s.mainPath, kind: 'main', identified: 'main' });
});

test('findAgentTranscript: no matching agent falls back to the main transcript; neither -> null', () => {
  const s = store();
  agent(s.subagents, 'aother', dispatchPrompt('2026-10-24T090000-record-1'), 1000);
  assert.deepStrictEqual(find(s), { path: s.mainPath, kind: 'main', identified: 'main' });
  const bare = store({ main: false });
  agent(bare.subagents, 'aother', 'unrelated', 1000);
  assert.strictEqual(find(bare), null);
  assert.strictEqual(find(s, { sessionId: undefined }), null, 'no session id -> nothing to look up');
  assert.strictEqual(find(s, { sessionId: '../escape' }), null, 'a malformed session id is never widened into a scan');
});

test('findAgentTranscript: the main transcript is found by file name when the cwd slug differs', () => {
  const s = store();
  const p = agent(s.subagents, 'anew', dispatchPrompt(RUN_ID), 2000);
  assert.deepStrictEqual(find(s, { cwd: '/somewhere/else' }), { path: p, kind: 'subagent', identified: 'first-message' });
});

test('findAgentTranscript: a symlinked agent transcript is never followed', { skip: process.platform === 'win32' }, () => {
  const s = store();
  const outside = tmp('ct-gauge-outside-');
  const target = path.join(outside, 'agent-evil.jsonl');
  fs.writeFileSync(target, transcriptText([userLine(dispatchPrompt(RUN_ID)), ...turnLines('msg_evil', {})]));
  fs.symlinkSync(target, path.join(s.subagents, 'agent-evil.jsonl'));
  assert.deepStrictEqual(find(s), { path: s.mainPath, kind: 'main', identified: 'main' });
});

test('caller identification: a top-level run whose main transcript holds the in-flight gauge call is measured, not a newer lens child naming the run id', () => {
  const s = store();
  writeInFlight(s.mainPath, 'top-level prompt', 1000);
  agent(s.subagents, 'alens', `Review lens 3a for run dir /m/.claude-tweaks/pipelines/${RUN_ID}`, 2000);
  assert.deepStrictEqual(find(s), { path: s.mainPath, kind: 'main', identified: 'in-flight' });
});

test('caller identification: a dispatched call is measured over its still-writing child that names the run id', () => {
  const s = store();
  const caller = writeInFlight(path.join(s.subagents, 'agent-acaller.jsonl'), dispatchPrompt(RUN_ID), 1000);
  // The child is newer and mid-turn (its own unanswered tool_use is not a gauge call).
  const child = path.join(s.subagents, 'agent-achild.jsonl');
  fs.writeFileSync(child, transcriptText([userLine(`Implement task 2 for ${RUN_ID}`), toolUseLine('msg_c', 'toolu_c', 'npm test > out.txt 2>&1')]));
  fs.utimesSync(child, 3000, 3000);
  fs.utimesSync(s.mainPath, 500, 500);
  assert.deepStrictEqual(find(s), { path: caller, kind: 'subagent', identified: 'in-flight' });
});

test('caller identification: nothing in flight falls back to the first-message match, and the CLI names the fallback in reason', async () => {
  const s = store();
  const answered = writeInFlight(path.join(s.subagents, 'agent-adone.jsonl'), dispatchPrompt(RUN_ID), 2000, { extra: [toolResultLine('toolu_gauge')] });
  assert.deepStrictEqual(find(s), { path: answered, kind: 'subagent', identified: 'first-message' });
  const fx = runFixture();
  const c = cli(fx, { env: { CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CONFIG_DIR: s.configDir } });
  assert.strictEqual(await run(['--run', fx.runDir], c.deps), 0);
  assert.strictEqual(c.json().transcript, answered);
  assert.strictEqual(c.json().reason, 'caller-not-identified: fell back to first-message match');
  const bare = store();
  const m = cli(fx, { env: { CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CONFIG_DIR: bare.configDir } });
  assert.strictEqual(await run(['--run', fx.runDir], m.deps), 0);
  assert.strictEqual(m.json().transcript, bare.mainPath);
  assert.strictEqual(m.json().reason, 'caller-not-identified: fell back to the main transcript');
});

test('caller identification: the CLI reports no reason when the caller is identified', async () => {
  const s = store();
  const caller = writeInFlight(path.join(s.subagents, 'agent-acaller.jsonl'), 'a prompt that does not name the run', 1000);
  const fx = runFixture();
  const c = cli(fx, { env: { CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CONFIG_DIR: s.configDir } });
  assert.strictEqual(await run(['--run', fx.runDir], c.deps), 0);
  assert.deepStrictEqual(c.json(), { contextTokens: 240000 + 2 + 998, cap: 200000, over: true, transcript: caller, handoff: null, reason: null });
});

test('hasInFlightGaugeCall: answered, superseded, other-run and non-Bash calls do not count; hook lines and a parallel sibling\'s result after it do', () => {
  const dir = tmp('ct-gauge-flight-');
  const at = (name, lines) => { const p = path.join(dir, name); fs.writeFileSync(p, transcriptText(lines)); return p; };
  const head = [userLine('x')];
  const call = toolUseLine('msg_b', 'toolu_gauge', gaugeCommand(RUN_ID));
  assert.strictEqual(hasInFlightGaugeCall(at('plain', [...head, call]), RUN_ID), true);
  assert.strictEqual(hasInFlightGaugeCall(at('hook', [...head, call, attachmentLine()]), RUN_ID), true, 'a hook attachment after it');
  const sibling = toolUseLine('msg_b', 'toolu_sib', 'git status');
  assert.strictEqual(hasInFlightGaugeCall(at('parallel', [...head, call, sibling, toolResultLine('toolu_sib')]), RUN_ID), true, 'a sibling call of the same turn finished first');
  assert.strictEqual(hasInFlightGaugeCall(at('answered', [...head, call, toolResultLine('toolu_gauge')]), RUN_ID), false);
  assert.strictEqual(hasInFlightGaugeCall(at('moved-on', [...head, call, ...turnLines('msg_later', {})]), RUN_ID), false, 'a later turn means it already returned');
  assert.strictEqual(hasInFlightGaugeCall(at('other-run', [...head, toolUseLine('msg_b', 'toolu_gauge', gaugeCommand('2026-10-24T090000-record-1'))]), RUN_ID), false);
  assert.strictEqual(hasInFlightGaugeCall(at('not-gauge', [...head, toolUseLine('msg_b', 'toolu_x', `cat /m/.claude-tweaks/pipelines/${RUN_ID}/decisions.md`)]), RUN_ID), false);
  const blobEcho = JSON.stringify({ type: 'api-request-blob', message: JSON.parse(call).message });
  assert.strictEqual(hasInFlightGaugeCall(at('blob', [...head, blobEcho]), RUN_ID), false, 'an untimestamped api-request-blob echo is not a call');
});

test('hasInFlightGaugeCall reads only a bounded tail, never the whole file', () => {
  const dir = tmp('ct-gauge-tail-');
  const p = path.join(dir, 'big.jsonl');
  const pad = userLine('p'.repeat(4096));
  fs.writeFileSync(p, transcriptText([userLine('x'), ...Array(1024).fill(pad), toolUseLine('msg_b', 'toolu_gauge', gaugeCommand(RUN_ID))]));
  assert.ok(fs.statSync(p).size > 8 * CALLER_TAIL_BYTES);
  let read = 0;
  const spy = { ...fs, readSync: (...a) => { const n = fs.readSync(...a); read += n; return n; } };
  assert.strictEqual(hasInFlightGaugeCall(p, RUN_ID, { fsImpl: spy }), true);
  assert.ok(read <= CALLER_TAIL_BYTES, `read ${read} bytes`);
  // A call cut by the tail's start is not misread from a partial line.
  assert.strictEqual(hasInFlightGaugeCall(p, RUN_ID, { tailBytes: 200 }), false);
});

test('caller identification: two in-flight candidates resolve to the newest mtime', () => {
  const s = store();
  writeInFlight(s.mainPath, 'top-level prompt', 1000);
  const newer = writeInFlight(path.join(s.subagents, 'agent-anew.jsonl'), 'x', 2000);
  assert.deepStrictEqual(find(s), { path: newer, kind: 'subagent', identified: 'in-flight' });
});

test('gauge: contextTokens is the last turn\'s input + cache_read + cache_creation', async () => {
  const dir = tmp('ct-gauge-t-');
  const p = path.join(dir, 't.jsonl');
  fs.writeFileSync(p, transcriptText([userLine('x'), ...turnLines('m1', { input: 5, cacheRead: 300000, cacheCreate: 7 }), ...turnLines('m2', { input: 3, cacheRead: 120000, cacheCreate: 4000 })]));
  assert.deepStrictEqual(await gauge({ transcript: p }), { contextTokens: 124003 });
  const empty = path.join(dir, 'e.jsonl');
  fs.writeFileSync(empty, transcriptText([userLine('x')]));
  assert.deepStrictEqual(await gauge({ transcript: empty }), { contextTokens: null });
});

test('real-input probe: a trimmed real dispatched-call transcript measures the hand-computed sum, and is identified by its run id', async () => {
  // Last turn msg_011CgPCW739rrxPGMzX13SBF (two lines, same usage):
  // input_tokens 2 + cache_read_input_tokens 524028 + cache_creation_input_tokens 2221 = 526251.
  assert.deepStrictEqual(await gauge({ transcript: REAL }), { contextTokens: 526251 });
  const s = store();
  agent(s.subagents, 'adecoy', 'an unrelated prompt', 3000);
  const copy = path.join(s.subagents, 'agent-ad659849552e32806.jsonl');
  fs.copyFileSync(REAL, copy);
  fs.utimesSync(copy, 2000, 2000);
  assert.deepStrictEqual(findAgentTranscript({ runId: REAL_RUN_ID, sessionId: SID, cwd: CWD, configDir: s.configDir }), { path: copy, kind: 'subagent', identified: 'first-message' });
});

// A run dir under a real git main checkout, with its worktree recorded in
// run-state.json and the materialized spec committed inside that worktree at
// the run dir's relative path — the single-record layout /flow produces.
// config.yml is the shape /flow's Manifesto writes (this run's own, 2026-10-25); mode: null omits it.
const configYml = (mode) => `mode: ${mode}\nscope-creep: add-to-plan\noverlap: companion\nmerge-authorization: ask\nspec: 4027\ncreated: 2026-10-25T162129\n`;

function runFixture({ spec = 'worktree', specDirs = [], worktree = true, mode = 'auto' } = {}) {
  const root = gitRepo();
  created.push(root);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  if (mode !== null) fs.writeFileSync(path.join(runDir, 'config.yml'), configYml(mode));
  let wt = null;
  if (worktree) {
    wt = harnessWorktreeOf(root);
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ worktree: wt, status: 'active' }));
  }
  if (spec === 'worktree' && wt) {
    fs.mkdirSync(path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID, 'work'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID, 'work', '4027-spec.md'), '# spec\n');
  } else if (spec === 'run-dir') {
    fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'work', '4027-spec.md'), '# spec\n');
  }
  for (const n of specDirs) fs.mkdirSync(path.join(runDir, `spec-${n}`, 'work'), { recursive: true });
  return { root, runDir, wt };
}

function transcriptAt(dir, contextTokens) {
  const p = path.join(dir, 'agent-t.jsonl');
  fs.writeFileSync(p, transcriptText([userLine(dispatchPrompt(RUN_ID)), ...turnLines('m1', { cacheRead: 1000 }), ...turnLines('m2', { input: 2, cacheRead: contextTokens - 2 - 500, cacheCreate: 500 })]));
  return p;
}

function cli(fx, over = {}) {
  const out = []; const err = [];
  const deps = {
    cwd: () => fx.root,
    mainRoot: fx.root,
    env: {},
    now: () => NOW,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  return { out, err, deps, json: () => JSON.parse(out.join('')) };
}

const RESUME = (runDir, target, steps) => `PIPELINE_RUN_DIR="${runDir}" /claude-tweaks:flow "${target}" ${steps} auto`;

test('CLI: 250000 tokens is over the cap — handoff.json is written with nextSteps and the resume line', async () => {
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'test'], c.deps), 0, c.err.join(''));
  const handoffPath = path.join(fx.runDir, 'handoff.json');
  assert.deepStrictEqual(c.json(), { contextTokens: 250000, cap: 200000, over: true, transcript: t, handoff: handoffPath, reason: null });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(handoffPath, 'utf8')), {
    nextSteps: ['test'], contextTokens: 250000, cap: 200000, mode: 'auto', handoffCount: 1, writtenAt: '2026-10-25T18:00:00.000Z',
    resume: RESUME(fx.runDir, '#4027', 'test'),
  });
  assert.strictEqual(c.out.join('').split('\n').filter(Boolean).length, 1, 'one JSON line');
});

test('CLI: 150000 tokens is under the cap — over: false and no handoff.json', async () => {
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 150000);
  const c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'test'], c.deps), 0);
  assert.deepStrictEqual(c.json(), { contextTokens: 150000, cap: 200000, over: false, transcript: t, handoff: null, reason: null });
  assert.ok(!fs.readdirSync(fx.runDir).includes('handoff.json'));
});

test('CLI: --cap overrides CONTEXT_CAP_TOKENS', async () => {
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 150000);
  const c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--cap', '100000', '--next-steps', 'review,polish,wrap-up'], c.deps), 0);
  assert.strictEqual(c.json().over, true);
  assert.strictEqual(c.json().cap, 100000);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fx.runDir, 'handoff.json'), 'utf8')).nextSteps, ['review', 'polish', 'wrap-up']);
});

test('CLI: exactly at the cap is not over it', async () => {
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 200000);
  const c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'test'], c.deps), 0);
  assert.strictEqual(c.json().contextTokens, 200000);
  assert.strictEqual(c.json().over, false);
  assert.ok(!fs.readdirSync(fx.runDir).includes('handoff.json'));
});

test('CLI: over the cap without --next-steps reports over: true and writes nothing', async () => {
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t], c.deps), 0);
  assert.deepStrictEqual(c.json(), { contextTokens: 250000, cap: 200000, over: true, transcript: t, handoff: null, reason: null });
  assert.ok(!fs.readdirSync(fx.runDir).includes('handoff.json'));
});

test('CLI: discovery through CLAUDE_CODE_SESSION_ID finds the agent transcript naming the run id', async () => {
  const fx = runFixture();
  const s = store();
  agent(s.subagents, 'aold', 'an unrelated prompt', 1000, { cacheRead: 10 });
  const mine = agent(s.subagents, 'anew', dispatchPrompt(RUN_ID), 2000, { input: 2, cacheRead: 249000, cacheCreate: 998 });
  const c = cli(fx, { cwd: () => fx.root, env: { CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CONFIG_DIR: s.configDir } });
  // The run dir's cwd slug is not the store's; the main transcript is found by file name.
  assert.strictEqual(await run(['--run', fx.runDir, '--next-steps', 'test'], c.deps), 0, c.err.join(''));
  assert.strictEqual(c.json().transcript, mine);
  assert.strictEqual(c.json().contextTokens, 250000);
  assert.strictEqual(c.json().over, true);
});

test('CLI: no transcript fails open — over: false, reason names the miss, exit 0, nothing written', async () => {
  const fx = runFixture();
  const empty = tmp('ct-gauge-config-');
  for (const env of [{}, { CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CONFIG_DIR: empty }]) {
    const c = cli(fx, { env });
    assert.strictEqual(await run(['--run', fx.runDir, '--next-steps', 'test'], c.deps), 0);
    const j = c.json();
    assert.strictEqual(j.over, false);
    assert.strictEqual(j.contextTokens, null);
    assert.strictEqual(j.transcript, null);
    assert.strictEqual(j.handoff, null);
    assert.match(j.reason, /^no transcript found/);
  }
  const c = cli(fx);
  await run(['--run', fx.runDir], c.deps);
  assert.match(c.json().reason, /CLAUDE_CODE_SESSION_ID is not set/);
  assert.ok(!fs.readdirSync(fx.runDir).includes('handoff.json'));
});

test('CLI: an unreadable or turnless --transcript fails open with the reason, exit 0', async () => {
  const fx = runFixture();
  const dir = tmp('ct-gauge-cli-');
  const missing = path.join(dir, 'nope.jsonl');
  let c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', missing, '--next-steps', 'test'], c.deps), 0);
  assert.deepStrictEqual(c.json(), { contextTokens: null, cap: 200000, over: false, transcript: missing, handoff: null, reason: `transcript not readable (ENOENT): ${missing}` });
  c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', dir, '--next-steps', 'test'], c.deps), 0);
  assert.match(c.json().reason, /^transcript not readable \(EISDIR\)/);
  const turnless = path.join(dir, 'u.jsonl');
  fs.writeFileSync(turnless, transcriptText([userLine('x')]));
  c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', turnless, '--next-steps', 'test'], c.deps), 0);
  assert.deepStrictEqual(c.json(), { contextTokens: null, cap: 200000, over: false, transcript: turnless, handoff: null, reason: `transcript has no assistant turn: ${turnless}` });
});

test('CLI: a failed handoff write is reported, never thrown — exit 0, handoff: null', async () => {
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const c = cli(fx, { writeFile: () => { const e = new Error('EACCES: simulated'); e.code = 'EACCES'; throw e; } });
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'test'], c.deps), 0);
  assert.strictEqual(c.json().over, true);
  assert.strictEqual(c.json().handoff, null);
  assert.match(c.json().reason, /^handoff\.json not written: EACCES: simulated/);
});

// #4027 Task 9 fix: the handoff bound lives in the gauge. handoff.json's handoffCount counts
// the run's handoffs (one run dir spans both dispatch calls); at HANDOFF_BOUND nothing is
// written, so a well-behaved agent continues in place and can never report a fourth handoff.
const { HANDOFF_BOUND } = require('../../../plugin/bin/lib/timing/context-gauge');
const readHandoff = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'handoff.json'), 'utf8'));

test('CLI: handoffCount increments from the existing handoff.json', async () => {
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  fs.writeFileSync(path.join(fx.runDir, 'handoff.json'), JSON.stringify({ nextSteps: ['test'], handoffCount: 2 }));
  const c = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'review,wrap-up'], c.deps), 0);
  assert.strictEqual(c.json().handoff, path.join(fx.runDir, 'handoff.json'));
  assert.strictEqual(readHandoff(fx.runDir).handoffCount, 3);
  assert.deepStrictEqual(readHandoff(fx.runDir).nextSteps, ['review', 'wrap-up']);
});

test('CLI: a missing, garbage, or count-less handoff.json counts as 0 handoffs', async () => {
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  for (const existing of [null, '{not json', '[]', JSON.stringify({ handoffCount: 'two' }), JSON.stringify({ handoffCount: -4 }), JSON.stringify({ nextSteps: ['test'] })]) {
    const fx = runFixture();
    if (existing !== null) fs.writeFileSync(path.join(fx.runDir, 'handoff.json'), existing);
    const c = cli(fx);
    assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'test'], c.deps), 0);
    assert.strictEqual(c.json().reason, null, String(existing));
    assert.strictEqual(readHandoff(fx.runDir).handoffCount, 1, String(existing));
  }
});

test('CLI: at the bound (3 earlier handoffs) nothing is written — over: true, handoff: null, continue in place', async () => {
  assert.strictEqual(HANDOFF_BOUND, 3);
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const prior = `${JSON.stringify({ nextSteps: ['wrap-up'], handoffCount: 3 })}\n`;
  fs.writeFileSync(path.join(fx.runDir, 'handoff.json'), prior);
  const writes = [];
  const c = cli(fx, { writeFile: (p, text) => writes.push([p, text]) });
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'polish,wrap-up'], c.deps), 0);
  assert.deepStrictEqual(c.json(), {
    contextTokens: 250000, cap: 200000, over: true, transcript: t, handoff: null,
    reason: 'handoff bound reached (3 handoffs this run): continue in place',
  });
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'handoff.json'), 'utf8'), prior);
});

// Final review fix: only an in-flight or --transcript identification hands off. A fallback
// transcript may be another agent's context — for a dispatched call, `main` is the
// dispatcher's own — so over the cap it is measured and reported, but never handed off.
const NOT_IDENTIFIED_HANDOFF = 'handoff.json not written: the caller was not identified, so the measured transcript may be another agent\'s (only an in-flight or --transcript identification hands off)';

test('CLI: a fallback-identified transcript over the cap writes no handoff — over as measured, handoff: null, reason names the fallback', async () => {
  const first = store();
  const t = agent(first.subagents, 'anew', dispatchPrompt(RUN_ID), 2000, { input: 2, cacheRead: 249000, cacheCreate: 998 });
  const main = store();
  fs.writeFileSync(main.mainPath, transcriptText([userLine('top-level prompt'), ...turnLines('msg_main', { input: 2, cacheRead: 249000, cacheCreate: 998 })]));
  for (const [s, transcript, fallback] of [[first, t, 'fell back to first-message match'], [main, main.mainPath, 'fell back to the main transcript']]) {
    const fx = runFixture();
    const writes = [];
    const c = cli(fx, { env: { CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CONFIG_DIR: s.configDir }, writeFile: (p, text) => writes.push([p, text]) });
    assert.strictEqual(await run(['--run', fx.runDir, '--next-steps', 'review,polish,wrap-up'], c.deps), 0, c.err.join(''));
    assert.deepStrictEqual(c.json(), {
      contextTokens: 250000, cap: 200000, over: true, transcript, handoff: null,
      reason: `caller-not-identified: ${fallback}; ${NOT_IDENTIFIED_HANDOFF}`,
    }, fallback);
    assert.deepStrictEqual(writes, [], `${fallback}: nothing written`);
    assert.ok(!fs.readdirSync(fx.runDir).includes('handoff.json'), `${fallback}: no handoff.json`);
  }
});

test('CLI: target records — the run dir\'s work/ when no worktree is recorded; spec-{N}/ dirs for a multi-spec run; none found is reported', async () => {
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const own = runFixture({ spec: 'run-dir', worktree: false });
  let c = cli(own);
  assert.strictEqual(await run(['--run', own.runDir, '--transcript', t, '--next-steps', 'test,review'], c.deps), 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(own.runDir, 'handoff.json'), 'utf8')).resume, RESUME(own.runDir, '#4027', 'test,review'));

  // A multi-spec run's targets resolve in ascending order, but the gauge hands off a single record only
  // (--next-steps names one record's remaining steps; multi-spec handoff is #4358).
  const multi = runFixture({ spec: 'none', specDirs: [3817, 3926, 945] });
  assert.deepStrictEqual(resolveTargetRecords({ runDir: multi.runDir }), ['#945', '#3817', '#3926']);
  c = cli(multi);
  assert.strictEqual(await run(['--run', multi.runDir, '--transcript', t, '--next-steps', 'test'], c.deps), 0);
  assert.strictEqual(c.json().over, true);
  assert.strictEqual(c.json().handoff, null);
  assert.match(c.json().reason, /^handoff\.json not written: a multi-record run \(#945, #3817, #3926\) — handoff is single-record \(#4358\): continue in place$/);
  assert.ok(!fs.readdirSync(multi.runDir).includes('handoff.json'));

  const none = runFixture({ spec: 'none' });
  c = cli(none);
  assert.strictEqual(await run(['--run', none.runDir, '--transcript', t, '--next-steps', 'test'], c.deps), 0);
  assert.strictEqual(c.json().over, true);
  assert.strictEqual(c.json().handoff, null);
  assert.match(c.json().reason, /^handoff\.json not written: no target records/);
  assert.ok(!fs.readdirSync(none.runDir).includes('handoff.json'));
});

test('CLI: resume carries the run\'s mode — auto/confirm/hybrid resume as auto, interactive or no config.yml carry no mode token', async () => {
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const cases = [
    ['auto', ' auto'], ['confirm', ' auto'], ['hybrid', ' auto'], ['interactive', ''], [null, ''],
  ];
  for (const [mode, token] of cases) {
    const fx = runFixture({ mode });
    const c = cli(fx);
    assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'review,wrap-up'], c.deps), 0, c.err.join(''));
    const h = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'handoff.json'), 'utf8'));
    assert.strictEqual(h.mode, mode, String(mode));
    assert.strictEqual(h.resume, `PIPELINE_RUN_DIR="${fx.runDir}" /claude-tweaks:flow "#4027" review,wrap-up${token}`, String(mode));
  }
});

// Trimmed from a real multi-spec run's manifest.yml
// (archive/2026-10-22T110840-spec-3926-3817-3945-3947, phases dropped).
const MANIFEST = (runId, ids) => `multispec:\n  parent: .claude-tweaks/pipelines/${runId}/\n  specs:\n${ids.map((id) => `    - id: ${id}\n      status: pending\n      subdir: spec-${id}/\n`).join('')}`;

test('CLI: a multi-spec run with manifest.yml orders its targets by the manifest\'s specs; a spec dir it does not list goes after, ascending', async () => {
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const fx = runFixture({ spec: 'none', specDirs: [3817, 3926, 3945, 12, 7] });
  fs.writeFileSync(path.join(fx.runDir, 'manifest.yml'), MANIFEST(RUN_ID, [3926, 3817, 3945]));
  // The order is the resolver's (the CLI refuses a multi-record handoff, see above).
  assert.deepStrictEqual(resolveTargetRecords({ runDir: fx.runDir }), ['#3926', '#3817', '#3945', '#7', '#12']);
  // A manifest entry with no spec dir is not a target.
  assert.deepStrictEqual(resolveTargetRecords({ runDir: fx.runDir, manifest: { multispec: { parent: 'x', specs: [{ id: 99 }, { id: 3945 }] } } }), ['#3945', '#7', '#12', '#3817', '#3926']);
});

test('resolveTargetRecords: worktree copy first, then the run dir; spec-{N}/ wins over work/', () => {
  const fx = runFixture({ spec: 'worktree' });
  assert.deepStrictEqual(resolveTargetRecords({ runDir: fx.runDir, worktree: fx.wt, gitRoot: fx.root }), ['#4027']);
  assert.strictEqual(resolveTargetRecords({ runDir: fx.runDir, worktree: null, gitRoot: fx.root }), null, 'the run dir itself has no work/ here');
  fs.mkdirSync(path.join(fx.runDir, 'spec-12'));
  fs.writeFileSync(path.join(fx.runDir, 'spec-13'), 'a file, not a spec dir');
  assert.deepStrictEqual(resolveTargetRecords({ runDir: fx.runDir, worktree: fx.wt, gitRoot: fx.root }), ['#12']);
});

test('CLI: malformed invocations exit 2 and write nothing', async () => {
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const cases = [
    [],
    ['--run'],
    ['--run', ''],
    ['--run', fx.runDir, '--cap'],
    ['--run', fx.runDir, '--cap', '0'],
    ['--run', fx.runDir, '--cap', '-5'],
    ['--run', fx.runDir, '--cap', '12k'],
    ['--run', fx.runDir, '--next-steps'],
    ['--run', fx.runDir, '--next-steps', ''],
    ['--run', fx.runDir, '--next-steps', '--cap'],
    ['--run', fx.runDir, '--next-steps', 'tset'],
    ['--run', fx.runDir, '--next-steps', 'test,,review'],
    ['--run', fx.runDir, '--next-steps', 'test,'],
    ['--run', fx.runDir, '--next-steps', 'Test'],
    ['--run', fx.runDir, '--transcript'],
    ['--run', fx.runDir, '--bogus', 'x'],
    ['--run', fx.runDir, 'constructor'],
    ['--run', path.join(fx.runDir, 'nope')],
    ['--run', path.join(fx.root, '.claude-tweaks')],
  ];
  for (const argv of cases) {
    const c = cli(fx);
    assert.strictEqual(await run(argv, c.deps), 2, JSON.stringify(argv));
    assert.strictEqual(c.out.join(''), '', JSON.stringify(argv));
  }
  assert.ok(!fs.readdirSync(fx.runDir).includes('handoff.json'));
  // a well-formed call on the same fixture still succeeds (the cases above are not all-red by accident)
  const ok = cli(fx);
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'review-console'], ok.deps), 0);
});

test('CLI: --run is anchored strictly — outside every checkout and a worktree-local shadow both exit 2', async () => {
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const outside = tmp('ct-gauge-outside-');
  const outRun = path.join(outside, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(outRun, { recursive: true });
  for (const mainRoot of [undefined, gitRepo()]) {
    if (mainRoot) created.push(mainRoot);
    const c = cli({ root: outside }, { mainRoot });
    assert.strictEqual(await run(['--run', outRun, '--transcript', t, '--next-steps', 'test'], c.deps), 2, String(mainRoot));
    assert.match(c.err.join(''), /not anchored under the main checkout/);
    assert.deepStrictEqual(fs.readdirSync(outRun), []);
  }
  const fx = runFixture();
  // A real run dir of ANOTHER main checkout than the injected mainRoot is refused too.
  const otherMain = gitRepo();
  created.push(otherMain);
  const foreign = cli(fx, { mainRoot: otherMain });
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'test'], foreign.deps), 2);
  assert.ok(!fs.readdirSync(fx.runDir).includes('handoff.json'));
  const shadow = path.join(fx.wt, '.claude-tweaks', 'pipelines', RUN_ID);
  const before = fs.readdirSync(shadow).sort();
  const c = cli(fx, { cwd: () => fx.wt, mainRoot: undefined });
  assert.strictEqual(await run(['--run', shadow, '--transcript', t, '--next-steps', 'test'], c.deps), 2);
  assert.deepStrictEqual(fs.readdirSync(shadow).sort(), before, 'the shadow is untouched');
  // The same call against the main-checkout run dir, from the worktree cwd, is accepted.
  const ok = cli(fx, { cwd: () => fx.wt, mainRoot: undefined });
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', t, '--next-steps', 'test'], ok.deps), 0, ok.err.join(''));
  assert.strictEqual(ok.json().handoff, path.join(fx.runDir, 'handoff.json'));
});

test('CLI: a --run whose basename is not a run id exits 2', async () => {
  const fx = runFixture({ specDirs: [12] });
  const c = cli(fx);
  assert.strictEqual(await run(['--run', path.join(fx.runDir, 'spec-12'), '--next-steps', 'test'], c.deps), 2);
  assert.match(c.err.join(''), /not a run id/);
});

test('the real binary: exit 0 with one JSON line on a measured call, exit 2 on a malformed one', () => {
  const { spawnSync } = require('child_process');
  const BIN = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'context-gauge.js');
  const fx = runFixture();
  const t = transcriptAt(tmp('ct-gauge-cli-'), 250000);
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  const ok = spawnSync(process.execPath, [BIN, '--run', fx.runDir, '--transcript', t, '--next-steps', 'test'], { cwd: fx.root, env, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.strictEqual(JSON.parse(ok.stdout).handoff, path.join(fx.runDir, 'handoff.json'));
  const bad = spawnSync(process.execPath, [BIN, '--run', fx.runDir, '--cap', 'zero'], { cwd: fx.root, env, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(bad.status, 2);
  assert.strictEqual(bad.stdout, '');
});

test('CLI: --help prints usage and exits 0 without touching anything', async () => {
  const fx = runFixture();
  const c = cli(fx);
  assert.strictEqual(await run(['--help'], c.deps), 0);
  assert.match(c.out.join(''), /^usage: context-gauge\.js --run <run-dir>/);
  assert.ok(!fs.readdirSync(fx.runDir).includes('handoff.json'));
});

// Review fix (#4027, lens 3d): gauge() answers from the transcript's tail, because the file is
// largest exactly when the gauge matters. The whole-file stream is the fallback.
function countingFs() {
  const calls = { streams: 0 };
  return { calls, fsImpl: { ...fs, createReadStream: (...a) => { calls.streams += 1; return fs.createReadStream(...a); } } };
}

test('gauge: a transcript larger than the tail window is answered from its tail — the file is never streamed', async () => {
  const dir = tmp('ct-gauge-t-');
  const p = path.join(dir, 'big.jsonl');
  const early = [];
  for (let i = 0; i < 300; i++) early.push(...turnLines(`old${i}`, { cacheRead: 999999 }));
  fs.writeFileSync(p, transcriptText([userLine('x'), ...early, ...turnLines('last', { input: 3, cacheRead: 120000, cacheCreate: 4000 })]));
  assert.ok(fs.statSync(p).size > 64 * 1024, 'the fixture is larger than the window below');
  const tail = countingFs();
  assert.deepStrictEqual(await gauge({ transcript: p, fsImpl: tail.fsImpl, tailBytes: 16 * 1024 }), { contextTokens: 124003 });
  assert.strictEqual(tail.calls.streams, 0, 'answered from the tail window');
  // The same answer from the whole-file read (a 1-byte window holds no complete line, so it falls back).
  const full = countingFs();
  assert.deepStrictEqual(await gauge({ transcript: p, fsImpl: full.fsImpl, tailBytes: 1 }), { contextTokens: 124003 });
  assert.strictEqual(full.calls.streams, 1, 'an empty window streams the file');
});

test('gauge: per message.id the tail takes each usage field\'s max — a streaming snapshot then the settled line — like the whole-file read', async () => {
  const dir = tmp('ct-gauge-t-');
  const p = path.join(dir, 'snap.jsonl');
  const line = (usage) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-25T17:01:00.000Z', message: { id: 'm9', role: 'assistant', content: [], usage } });
  fs.writeFileSync(p, transcriptText([
    userLine('x'),
    line({ input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 8 }),
    line({ input_tokens: 2, cache_read_input_tokens: 120000, cache_creation_input_tokens: 4000, output_tokens: 400 }),
  ]));
  assert.deepStrictEqual(await gauge({ transcript: p }), { contextTokens: 124002 });
  assert.deepStrictEqual(await gauge({ transcript: p, tailBytes: 1 }), { contextTokens: 124002 });
});

test('gauge: a tail window with no assistant message falls back to the whole file', async () => {
  const dir = tmp('ct-gauge-t-');
  const p = path.join(dir, 'huge-last.jsonl');
  fs.writeFileSync(p, transcriptText([userLine('x'), ...turnLines('m1', { input: 3, cacheRead: 120000, cacheCreate: 4000 }), userLine('y'.repeat(64 * 1024))]));
  const c = countingFs();
  assert.deepStrictEqual(await gauge({ transcript: p, fsImpl: c.fsImpl, tailBytes: 16 * 1024 }), { contextTokens: 124003 });
  assert.strictEqual(c.calls.streams, 1, 'the window held only the tail of one user line');
});

// Review fix (#4027, lenses 3c/3e): a gauge that cannot work must not read as a run that stayed under the cap.
test('CLI: every non-null reason is logged as a SKIP; a clean measurement logs nothing; a failing log never changes the result', async () => {
  const fx = runFixture();
  const logged = [];
  const appendDecision = (runDir, entry) => logged.push([runDir, entry]);
  let c = cli(fx, { env: {}, appendDecision });
  assert.strictEqual(await run(['--run', fx.runDir], c.deps), 0);
  assert.strictEqual(logged.length, 1);
  assert.strictEqual(logged[0][0], fs.realpathSync(fx.runDir));
  assert.match(logged[0][1], /^- SKIP \d{2}:\d{2}:\d{2} — Step 4 context cap: condition: context-gauge no transcript found: CLAUDE_CODE_SESSION_ID is not set \(pass --transcript <path>\) → fallback: continue in this agent\. Reversibility: n\/a\.$/);

  logged.length = 0;
  const under = transcriptAt(tmp('ct-gauge-cli-'), 150000);
  c = cli(fx, { appendDecision });
  assert.strictEqual(await run(['--run', fx.runDir, '--transcript', under, '--next-steps', 'test'], c.deps), 0);
  assert.strictEqual(c.json().reason, null);
  assert.deepStrictEqual(logged, [], 'a measurement with no reason logs nothing');

  c = cli(fx, { env: {}, appendDecision: () => { throw new Error('lock timeout'); } });
  assert.strictEqual(await run(['--run', fx.runDir], c.deps), 0);
  assert.match(c.json().reason, /CLAUDE_CODE_SESSION_ID is not set/);
});
