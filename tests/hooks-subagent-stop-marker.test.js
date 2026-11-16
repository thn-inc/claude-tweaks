// tests/hooks-subagent-stop-marker.test.js — #5602: the SubagentStop hook appends
// a stop marker ({agentId, at, blocked, pending}) on every path, fail-safe.
// tests/hooks-subagent-stop.test.js is the characterization suite for what the
// hook returns; this file pins only the marker side effect and that the marker
// can never change the hook's answer.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const substop = require('../plugin/bin/lib/hooks/subagent-stop');
const contractRetries = require('../plugin/bin/lib/hooks/contract-retries');
const marker = require('../plugin/bin/lib/wait-for/marker');

// mkdtemp directories the fixtures create; every test removes them in t.after.
const tmpDirs = [];
function drainTmpDirs() {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

function mkRun() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-substop-m-'));
  tmpDirs.push(project);
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  return run;
}

const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
function agentCall(id, min) {
  return { type: 'assistant', timestamp: at(min), message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input: { description: `Lens ${id}` } }] } };
}
function launchAck(agentId, toolUseId, min) {
  return {
    type: 'user',
    timestamp: at(min),
    message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content: [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${agentId} (internal ID)` }] }] },
    toolUseResult: { isAsync: true, status: 'async_launched', agentId, description: `Lens ${toolUseId}`, canContinueAgent: true },
  };
}
function notification(agentId, toolUseId, min) {
  return {
    type: 'user',
    timestamp: at(min),
    message: { role: 'user', content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>` },
    origin: { kind: 'task-notification', producer: 'session-task', runId: 'r1' },
  };
}
function reply(text, min) {
  return { type: 'assistant', timestamp: at(min), message: { role: 'assistant', content: [{ type: 'text', text }] } };
}
const toLines = (entries) => entries.map((e) => JSON.stringify(e));
function writeTranscript(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-substop-mt-'));
  tmpDirs.push(dir);
  const f = path.join(dir, 'agent.jsonl');
  fs.writeFileSync(f, toLines(entries).join('\n') + '\n');
  return f;
}

// Fixture P: two launches, one completed, then a compliant reply -> pending 1.
const pEntries = () => [
  agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0),
  agentCall('toolu_2', 0), launchAck('a2', 'toolu_2', 1),
  notification('a1', 'toolu_1', 2),
  reply('Two lenses launched; one is back.\nSTATUS: DONE', 3),
];
// Fixture V: no launches, a non-compliant reply (first violation -> block).
const vEntries = () => [
  { type: 'assistant', timestamp: at(0), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_r', name: 'Read', input: {} }] } },
  { type: 'user', timestamp: at(0), message: { role: 'user', content: [{ tool_use_id: 'toolu_r', type: 'tool_result', content: 'ok' }] } },
  reply('Finished the task. No status line here.', 1),
];

function setup(t, name) {
  const sid = `marker-${name}-${process.pid}`;
  t.after(() => {
    drainTmpDirs();
    for (const p of [marker.stopsPath(sid), contractRetries.retriesPath(sid)]) {
      if (p) { try { fs.unlinkSync(p); } catch { /* already absent */ } }
    }
  });
  return sid;
}

function runHook(entries, input, ownedRun) {
  const run = mkRun();
  const transcript = typeof entries === 'string' ? entries : writeTranscript(entries);
  const out = substop.run({
    input: { agent_transcript_path: transcript, transcript_path: '/x/parent.jsonl', ...input },
    runDir: run,
    runState: null,
    ownedRun: ownedRun === undefined ? { dir: run, attribution: 'session' } : ownedRun,
    cwd: '/x',
  });
  return out;
}

test('AC8.1: a stop appends one marker line that reads back to the payload\'s agent_id and the fixture\'s pending count', (t) => {
  const sid = setup(t, 'p');
  const entries = pEntries();
  const out = runHook(entries, { session_id: sid, agent_id: 'agent-p' });
  assert.deepStrictEqual(out, {});
  const lines = toLines(entries);
  const expected = substop.countPendingDispatches(lines, lines.length - 1);
  assert.strictEqual(expected, 1);
  const { stops } = marker.readStops(sid);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(stops[0].agentId, 'agent-p');
  assert.strictEqual(stops[0].blocked, false);
  assert.strictEqual(stops[0].pending, expected);
  assert.strictEqual(typeof stops[0].at, 'number');
});

test('AC8.1: a blocked stop is marked blocked', (t) => {
  const sid = setup(t, 'v');
  const out = runHook(vEntries(), { session_id: sid, agent_id: 'agent-v' });
  assert.strictEqual(out.json.decision, 'block');
  const { stops } = marker.readStops(sid);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(stops[0].blocked, true);
  assert.strictEqual(stops[0].pending, 0);
});

test('AC8.2: a session with no owned run still gets its marker', (t) => {
  const sid = setup(t, 'norun');
  const out = runHook(pEntries(), { session_id: sid, agent_id: 'agent-p' }, {});
  assert.deepStrictEqual(out, {});
  const { stops } = marker.readStops(sid);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(stops[0].pending, 1);
});

test('AC8.2: a third-party agent type still gets its marker', (t) => {
  const sid = setup(t, 'thirdparty');
  const out = runHook(pEntries(), { session_id: sid, agent_id: 'agent-p', agent_type: 'code-simplifier:code-simplifier' });
  assert.deepStrictEqual(out, {});
  const { stops } = marker.readStops(sid);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(stops[0].pending, 1);
});

test('AC8.3: a throwing write changes nothing the hook returns', (t) => {
  const sidP = setup(t, 'throwp');
  const sidV = setup(t, 'throwv');
  const sidRef = setup(t, 'throwref');
  const ref = runHook(vEntries(), { session_id: sidRef, agent_id: 'agent-v' });
  t.mock.method(marker, 'appendStop', () => { throw new Error('disk'); });
  assert.deepStrictEqual(runHook(pEntries(), { session_id: sidP, agent_id: 'agent-p' }), {});
  const out = runHook(vEntries(), { session_id: sidV, agent_id: 'agent-v' });
  assert.strictEqual(out.json.decision, 'block');
  assert.strictEqual(out.json.reason, ref.json.reason);
  assert.strictEqual(marker.appendStop.mock.callCount(), 2, 'the mocked write was reached');
});

test('AC8.3: a marker.js load fault changes nothing the hook returns', (t) => {
  const sidP = setup(t, 'loadp');
  const sidV = setup(t, 'loadv');
  const orig = Module._load;
  t.mock.method(Module, '_load', function (request, ...rest) {
    if (/wait-for[\\/]marker$/.test(request)) throw new Error('load fault');
    return orig.call(this, request, ...rest);
  });
  assert.deepStrictEqual(runHook(pEntries(), { session_id: sidP, agent_id: 'agent-p' }), {});
  const out = runHook(vEntries(), { session_id: sidV, agent_id: 'agent-v' });
  assert.strictEqual(out.json.decision, 'block');
  assert.strictEqual(fs.existsSync(path.join(os.tmpdir(), `ct-agent-stops-${sidP}.jsonl`)), false);
  assert.strictEqual(fs.existsSync(path.join(os.tmpdir(), `ct-agent-stops-${sidV}.jsonl`)), false);
});

test('no marker when the payload lacks agent_id or agent_transcript_path, or the two transcript paths are equal', (t) => {
  const sidA = setup(t, 'noagent');
  const sidB = setup(t, 'notranscript');
  const sidC = setup(t, 'sametranscript');
  runHook(pEntries(), { session_id: sidA });
  runHook(pEntries(), { session_id: sidB, agent_id: 'agent-p', agent_transcript_path: undefined });
  const same = writeTranscript(pEntries());
  runHook(same, { session_id: sidC, agent_id: 'agent-p', transcript_path: same });
  for (const sid of [sidA, sidB, sidC]) {
    assert.strictEqual(fs.existsSync(marker.stopsPath(sid)), false, sid);
  }
});

test('an unreadable agent transcript writes pending null', (t) => {
  const sid = setup(t, 'unreadable');
  const out = runHook(path.join(os.tmpdir(), `ct-missing-${process.pid}.jsonl`), { session_id: sid, agent_id: 'agent-u' });
  assert.deepStrictEqual(out, {});
  const { stops } = marker.readStops(sid);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(stops[0].pending, null);
});

test('AC12.2: the hook writes no marker for a session id outside [A-Za-z0-9_-]', (t) => {
  const sid = `bad.id-${process.pid}`;
  t.after(drainTmpDirs);
  runHook(pEntries(), { session_id: sid, agent_id: 'agent-p' });
  assert.strictEqual(fs.existsSync(path.join(os.tmpdir(), `ct-agent-stops-bad.id-${process.pid}.jsonl`)), false);
});
