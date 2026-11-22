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
    for (const p of [marker.stopsPath(sid), contractRetries.retriesPath(sid, { env: process.env })]) {
      if (p) { try { fs.unlinkSync(p); } catch { /* already absent */ } }
    }
  });
  return sid;
}

// `env` is the hook context's environment (#5377): the marker and the retry file land under its temp directory.
function runHook(entries, input, ownedRun, env = process.env) {
  const run = mkRun();
  const transcript = typeof entries === 'string' ? entries : writeTranscript(entries);
  const out = substop.run({
    input: { agent_transcript_path: transcript, transcript_path: '/x/parent.jsonl', ...input },
    runDir: run,
    runState: null,
    ownedRun: ownedRun === undefined ? { dir: run, attribution: 'session' } : ownedRun,
    cwd: '/x',
    env,
  });
  return out;
}

test('#5377: the marker lands under the context env\'s temp directory, not the process\'s', (t) => {
  const sid = setup(t, 'envtmp');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-substop-env-'));
  tmpDirs.push(tmp);
  const out = runHook(pEntries(), { session_id: sid, agent_id: 'agent-p' }, undefined, { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(marker.readStops(sid, { tmpDir: tmp }).stops.length, 1);
  assert.strictEqual(fs.existsSync(marker.stopsPath(sid)), false);
});

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

// #5706: the marker has its own count from the same scan as the #3015 gate count.
// It skips a <task-notification> in three given-or-written shapes (the first user
// message, a toolUseResult line, an assistant line); the gate count stays null.
const QUOTE = 'Wait until every child\'s <task-notification> has arrived.';
function prompt(text, min) {
  return { type: 'user', timestamp: at(min), message: { role: 'user', content: text } };
}
function agentCallWithPrompt(id, promptText, min) {
  return { type: 'assistant', timestamp: at(min), message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input: { description: `Lens ${id}`, prompt: promptText } }] } };
}
function readCall(id, min) {
  return { type: 'assistant', timestamp: at(min), message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: {} }] } };
}
function toolResult(toolUseId, text, min, toolUseResult) {
  const entry = { type: 'user', timestamp: at(min), message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content: text }] } };
  if (toolUseResult !== undefined) entry.toolUseResult = toolUseResult;
  return entry;
}
function forkBoundary(directive, min) {
  return {
    type: 'user',
    timestamp: at(min),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fork', content: [{ type: 'text', text: 'Fork started — processing in background' }] }, { type: 'text', text: '<fork-boilerplate>\nYou are a worker fork.\n</fork-boilerplate>\n\nYour directive: ' + directive }] },
  };
}
const scanOf = (entries) => {
  const lines = toLines(entries);
  return substop.scanPendingDispatches(lines, lines.length - 1);
};
const gateOf = (entries) => {
  const lines = toLines(entries);
  return substop.countPendingDispatches(lines, lines.length - 1);
};

test('AC1.1: a first user message quoting <task-notification>, no launches, writes pending 0; the gate count is null', (t) => {
  const sid = setup(t, 'ac1');
  const entries = [prompt(QUOTE, 0), readCall('toolu_r', 1), toolResult('toolu_r', 'ok', 1, { stdout: 'ok' }), reply('Done.\nSTATUS: DONE', 2)];
  runHook(entries, { session_id: sid, agent_id: 'agent-ac1' }, {});
  const { stops } = marker.readStops(sid);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(stops[0].pending, 0);
  assert.strictEqual(gateOf(entries), null);
  assert.deepStrictEqual(scanOf(entries), { gate: null, marker: 0 });
});

test('AC1.1: the same prompt with an owned run and a non-compliant reply still writes pending 0 and grades as before', (t) => {
  const sid = setup(t, 'ac1blocked');
  const entries = [prompt(QUOTE, 0), readCall('toolu_r', 1), toolResult('toolu_r', 'ok', 1, { stdout: 'ok' }), reply('Finished, no status line.', 2)];
  const out = runHook(entries, { session_id: sid, agent_id: 'agent-ac1b' });
  assert.strictEqual(out.json.decision, 'block');
  const { stops } = marker.readStops(sid);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(stops[0].blocked, true);
  assert.strictEqual(stops[0].pending, 0);
});

test('AC2.1/AC2.2: the token in a tool-result line and in an assistant Agent call, two launches, one completion, writes pending 1; the gate count is null', (t) => {
  const sid = setup(t, 'ac2');
  const entries = [
    prompt('Do the task.', 0),
    agentCallWithPrompt('toolu_1', QUOTE, 0), launchAck('a1', 'toolu_1', 0),
    agentCall('toolu_2', 1), launchAck('a2', 'toolu_2', 1),
    notification('a1', 'toolu_1', 2),
    readCall('toolu_r', 3), toolResult('toolu_r', 'skill text: ' + QUOTE, 3, { stdout: QUOTE }),
    reply('One lens back.\nSTATUS: DONE', 4),
  ];
  runHook(entries, { session_id: sid, agent_id: 'agent-ac2' }, {});
  const { stops } = marker.readStops(sid);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(stops[0].pending, 1);
  assert.strictEqual(gateOf(entries), null);
});

test('AC3.1: the token in a later user message that is not the first, has no toolUseResult and is no carrier, writes pending null; the gate count is null', (t) => {
  const sid = setup(t, 'ac3');
  const entries = [
    prompt('Do the task.', 0), agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0),
    prompt('relayed: ' + QUOTE, 1),
    reply('x\nSTATUS: DONE', 2),
  ];
  runHook(entries, { session_id: sid, agent_id: 'agent-ac3' }, {});
  const { stops } = marker.readStops(sid);
  assert.strictEqual(stops.length, 1);
  assert.strictEqual(stops[0].pending, null);
  assert.strictEqual(gateOf(entries), null);
  assert.deepStrictEqual(scanOf(entries), { gate: null, marker: null });
});

test('RF1: a non-user line before the prompt does not move the first user message', () => {
  const entries = [{ type: 'summary', summary: 's', leafUuid: 'u' }, prompt(QUOTE, 0), reply('ok\nSTATUS: DONE', 1)];
  assert.deepStrictEqual(scanOf(entries), { gate: null, marker: 0 });
});

test('RF2: a tool error result (string toolUseResult) quoting the token is skipped', () => {
  const entries = [prompt('Do it.', 0), readCall('toolu_r', 1), toolResult('toolu_r', QUOTE, 1, 'Error: ' + QUOTE), reply('ok\nSTATUS: DONE', 2)];
  assert.deepStrictEqual(scanOf(entries), { gate: null, marker: 0 });
});

test('RF3: a tool_result line without toolUseResult quoting the token is null in both counts', () => {
  const entries = [prompt('Do it.', 0), readCall('toolu_r', 1), toolResult('toolu_r', QUOTE, 1), reply('ok\nSTATUS: DONE', 2)];
  assert.deepStrictEqual(scanOf(entries), { gate: null, marker: null });
});

test('RF4: <fork-boilerplate> quoted in the first user message is null in both counts', () => {
  const entries = [prompt('Never write <fork-boilerplate> yourself.', 0), reply('ok\nSTATUS: DONE', 1)];
  assert.deepStrictEqual(scanOf(entries), { gate: null, marker: null });
});

test('RF5: a fork whose inherited parent prompt and own directive quote the token counts only its own launches', () => {
  const entries = [
    prompt(QUOTE, 0), agentCall('toolu_p', 0), launchAck('ap', 'toolu_p', 0),
    forkBoundary(QUOTE, 1), agentCall('toolu_f', 2), launchAck('af', 'toolu_f', 2),
    reply('ok\nSTATUS: DONE', 3),
  ];
  assert.deepStrictEqual(scanOf(entries), { gate: null, marker: 1 });
});

test('RF6: a relayed user message right after a fork boundary that opens the transcript is not the prompt', () => {
  const entries = [forkBoundary('x', 0), prompt('relayed: ' + QUOTE, 1), reply('ok\nSTATUS: DONE', 2)];
  assert.deepStrictEqual(scanOf(entries), { gate: null, marker: null });
});

test('RF7: a skipped token line does not end the scan — a later indeterminate shape still nulls the marker', () => {
  // The prompt quotes the token (skipped), then one launch is left pending; `mid` is what follows it.
  const head = toLines([prompt(QUOTE, 0), agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0)]);
  const tail = toLines([reply('ok\nSTATUS: DONE', 5)]);
  const scanWith = (mid) => {
    const lines = [...head, ...mid, ...tail];
    return substop.scanPendingDispatches(lines, lines.length - 1);
  };
  const idlessLaunch = { type: 'user', timestamp: at(2), message: { role: 'user', content: [{ type: 'text', text: 'launched' }] }, toolUseResult: { isAsync: true, status: 'async_launched' } };
  assert.deepStrictEqual(scanWith([]), { gate: null, marker: 1 }, 'control: nothing indeterminate after the skip');
  assert.deepStrictEqual(scanWith(toLines([prompt('relayed: ' + QUOTE, 2)])), { gate: null, marker: null }, 'a relayed message quoting the token');
  assert.deepStrictEqual(scanWith(['not json']), { gate: null, marker: null }, 'an unparseable line');
  assert.deepStrictEqual(scanWith(toLines([idlessLaunch])), { gate: null, marker: null }, 'a launch with no ids');
});
