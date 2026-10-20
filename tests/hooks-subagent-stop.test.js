// tests/hooks-subagent-stop.test.js — #2265: dedicated coverage for
// subagent-stop.js's two-tier canonical/lenient status-line detection.
//
// Migration this pins: the canonical status signal moved from a bare-word
// FIRST line to a labeled trailing "STATUS: {WORD}" line (the reply's last
// non-empty line). The checker stays lenient about exact position — a bare
// or off-position status word within the first-or-last 3 non-empty lines is
// still accepted, logging only an informational event variant — which is
// what makes the format migration itself safe with no explicit transition
// period: an in-flight dispatch given an old-format prompt is still accepted
// by the checker that runs after this ships.
//
// Broader regression coverage for this hook (exemptions, ctx.ownedRun
// scoping, tool-call-only/narration-plus-tool-call last turns, the #750 bold
// "**Status:**" prefix, and the pre-#2265 test updates this migration made)
// lives in tests/hooks-log-modules.test.js — not duplicated here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const substop = require('../plugin/bin/lib/hooks/subagent-stop');
const contractRetries = require('../plugin/bin/lib/hooks/contract-retries');

function mkRun() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-substop-'));
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  return run;
}

// One tool_use block precedes the final text turn by default, so tests
// exercising the contract-violation/status-line detection (not #2345's own
// zero-tool-use-verdict) never also trip that unrelated check. Pass
// `{ toolUse: false }` for a test that specifically wants a zero-tool-use
// transcript.
function transcriptWithToolUse(lastText, { toolUse = true } = {}) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-substop-t-')), 'agent.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'task' }] } }),
  ];
  if (toolUse) {
    lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } }));
    lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }));
  }
  lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: lastText }] } }));
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

function callSubstop(lastText, opts = {}) {
  const { toolUse, ...extraInput } = opts;
  const run = mkRun();
  const out = substop.run({
    input: { agent_transcript_path: transcriptWithToolUse(lastText, { toolUse }), ...extraInput },
    runDir: run,
    runState: null,
    ownedRun: { dir: run, attribution: 'session' },
    cwd: '/x',
  });
  const eventsPath = path.join(run, 'events.jsonl');
  const events = fs.existsSync(eventsPath)
    ? fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];
  return { out, events };
}

const WORDS = ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'];

// AC1: canonical trailing "STATUS: {WORD}" — compliant, no event at all,
// for each of the four contract words.
for (const word of WORDS) {
  test(`AC1: a reply whose last non-empty line is exactly "STATUS: ${word}" is canonical-compliant, no event logged`, () => {
    const { out, events } = callSubstop(`Did the work.\nChecked twice.\nSTATUS: ${word}`);
    assert.deepStrictEqual(out, {}, 'canonical compliance returns no dispatcher-facing warning');
    assert.strictEqual(events.length, 0, 'canonical compliance logs nothing at all — not even an informational variant');
  });
}

// AC2: lenient fallback — the status word as the first token of one of the
// first-or-last 3 non-empty lines, but NOT the canonical trailing line —
// still compliant, but logs the informational variant (never a hard
// violation).
test('AC2: a status word as the first token of an early non-empty line (not the trailing canonical line) is lenient-compliant and logs the informational variant', () => {
  const { out, events } = callSubstop('DONE\nRan the full suite.\nEverything green.');
  assert.deepStrictEqual(out, {}, 'lenient compliance returns no dispatcher-facing warning');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'contract-violation');
  assert.strictEqual(events[0].variant, 'lenient', 'off-position compliance must log the lenient variant, never a hard violation');
});

// AC3: genuine violation — the status word appears nowhere in the reply at
// all. Logged with variant: 'violation' (#2344 — every logged
// contract-violation event now carries an explicit variant tag).
test('AC3: a status word absent from the reply entirely is a genuine violation, tagged variant: violation (#2344)', () => {
  const { out, events } = callSubstop('Looked into the issue.\nStill not sure what is causing it.\nWill keep digging.');
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'contract-violation');
  assert.strictEqual(events[0].variant, 'violation', 'a genuine violation must carry variant: violation');
});

// AC4: migration safety — an old-format reply (the bare status word as the
// literal FIRST line, no trailing "STATUS:" line anywhere) is STILL accepted
// by the new lenient fallback. This is what makes the migration itself safe
// with no explicit transition period: an in-flight dispatch given an
// old-format prompt, checked after this ships, is still accepted.
test('AC4: an old-format reply (bare status word as the literal first line, no trailing STATUS: line) is still accepted by the lenient fallback', () => {
  const { out, events } = callSubstop('DONE\nAll checks passed, nothing else to report.');
  assert.deepStrictEqual(out, {}, 'the old first-line format must still be accepted post-migration');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].variant, 'lenient');
});

// AC7: table-row exclusion — a findings-table row containing a matching word
// must not itself trigger a false lenient-compliant match when the reply's
// actual trailing status line is missing. Template A's own findings table
// sits in the reply's last few lines by construction, so without this
// exclusion a table cell that happens to contain one of the four words would
// be indistinguishable from a genuine trailing status line.
test('AC7: a findings-table row containing a matching word does not itself trigger a false lenient-compliant match when the real status line is missing', () => {
  const body = [
    '| Severity | Path:Line | Finding | Evidence |',
    '|---|---|---|---|',
    '| info | src/x.js:5 | Migration already DONE here | historical note only |',
  ].join('\n');
  const { out, events } = callSubstop(body);
  // No genuine trailing "STATUS: {WORD}" line exists, and the table row
  // (excluded from the lenient candidate window) must not supply one either
  // — this must fall through to a genuine violation, not a false
  // lenient-compliant match on the table cell's "DONE" text.
  assert.match(out.json.systemMessage, /status line/i, 'a table cell must never substitute for the real status line');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].variant, 'violation', 'must be a genuine violation, not a lenient match on table content');
});

// Companion to AC7: the SAME reply, with a genuine trailing status line
// appended after the table, is fully canonical-compliant — proving the
// table-row exclusion only screens candidates out of the lenient window, it
// never blocks the real canonical check on the reply's true last line.
test('AC7 companion: a findings table followed by a genuine trailing STATUS line is canonical-compliant', () => {
  const body = [
    '| Severity | Path:Line | Finding | Evidence |',
    '|---|---|---|---|',
    '| info | src/x.js:5 | Migration already DONE here | historical note only |',
    'STATUS: DONE',
  ].join('\n');
  const { out, events } = callSubstop(body);
  assert.deepStrictEqual(out, {});
  assert.strictEqual(events.length, 0, 'a genuine trailing STATUS line after a table is fully canonical, no event at all');
});

// #2344 AC1: a reply beginning with a verdict word from ANOTHER dispatch
// site's own declared contract (a review-lens/fix-verification reply) is
// still logged (never silently skipped — the aggregation layer decides
// friction, not the detector), but tagged variant: 'foreign-contract'
// instead of the genuine 'violation' tag.
for (const word of ['APPROVED', 'NEEDS_FIXES', 'ADDRESSED', 'VERIFIED']) {
  test(`#2344 AC1: a reply beginning with the foreign contract word "${word}" logs variant: foreign-contract, not a genuine violation`, () => {
    const { out, events } = callSubstop(`${word}\n\nNo material fixes found.`);
    assert.match(out.json.systemMessage, /status line/i, 'still returns the same dispatcher-facing warning shape');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'contract-violation');
    assert.strictEqual(events[0].variant, 'foreign-contract', `"${word}" must classify as foreign-contract, not a genuine violation`);
  });
}

// #2344 AC1's orthogonal case: an unrelated third vocabulary — not in the
// curated FOREIGN_CONTRACT_WORDS list — still grades as a genuine violation.
// Proves the classifier is a closed, curated list, not a general heuristic
// that would swallow any capitalized first line.
test('#2344 AC1 orthogonal case: an unrelated third vocabulary word still grades as a genuine violation', () => {
  const { out, events } = callSubstop('REJECTED\n\nThis is not one of the curated foreign-contract words.');
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].variant, 'violation', 'an unrecognized vocabulary word must still be graded as a genuine violation');
});

// #2345 AC3: a well-formed status line and findings table, with ZERO
// tool-use blocks anywhere in the transcript, logs a zero-tool-use-verdict
// event — independent of the reply's own status-line compliance.
test('#2345 AC3: a compliant reply with zero tool-use blocks in the transcript logs zero-tool-use-verdict', () => {
  const body = [
    '| Severity | Path:Line | Finding | Evidence |',
    '|---|---|---|---|',
    '| high | src/x.js:5 | Missing null check | direct read |',
    'STATUS: DONE',
  ].join('\n');
  const { out, events } = callSubstop(body, { toolUse: false });
  assert.deepStrictEqual(out, {}, 'the status line is fully canonical-compliant on its own terms');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'zero-tool-use-verdict');
});

// #2345 AC3's other direction: an otherwise-identical transcript WITH one
// tool-use block logs nothing (for this specific check — the reply is also
// canonical-compliant, so no contract-violation event fires either).
test('#2345 AC3: an otherwise-identical transcript with one tool-use block logs no zero-tool-use-verdict', () => {
  const body = [
    '| Severity | Path:Line | Finding | Evidence |',
    '|---|---|---|---|',
    '| high | src/x.js:5 | Missing null check | direct read |',
    'STATUS: DONE',
  ].join('\n');
  const { out, events } = callSubstop(body, { toolUse: true });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(events.length, 0, 'one tool-use block anywhere in the transcript must suppress zero-tool-use-verdict');
});

// zero-tool-use-verdict and contract-violation are independent signals — a
// non-compliant reply with zero tool calls logs BOTH events.
test('#2345: a non-compliant reply with zero tool-use blocks logs both zero-tool-use-verdict and contract-violation', () => {
  const { events } = callSubstop('Looked into the issue but ran out of time.', { toolUse: false });
  const types = events.map((e) => e.type).sort();
  assert.deepStrictEqual(types, ['contract-violation', 'zero-tool-use-verdict']);
});

// #1936: forced in-run retry, one shot per (session_id, agent_id). Live-
// confirmed (2026-09-20, Task 0) that SubagentStop's JSON output supports
// `{ decision: 'block', reason }`, which keeps the subagent running and
// delivers `reason` as its next instruction.
function cleanupRetries(sessionId) {
  const p = contractRetries.retriesPath(sessionId);
  if (p) { try { fs.unlinkSync(p); } catch { /* already absent */ } }
}

test('#1936: a first genuine violation for a known (session_id, agent_id) is blocked once, with a reason quoting the rule and the offending first line, and writes no contract-violation event yet', () => {
  const sessionId = `substop-retry-first-${process.pid}`;
  cleanupRetries(sessionId);
  const { out, events } = callSubstop('Looked into it.\nNot sure yet.\nWill keep digging.', {
    session_id: sessionId, agent_id: 'agent-a',
  });
  assert.strictEqual(out.json.decision, 'block');
  assert.match(out.json.reason, /STATUS: DONE/);
  assert.match(out.json.reason, /Looked into it\./, 'the reason must quote the offending first line');
  assert.strictEqual(events.length, 0, 'the forced-retry path does not log a contract-violation event on the first (blocked) violation');
  cleanupRetries(sessionId);
});

test('#1936: a second genuine violation for the SAME (session_id, agent_id) is no longer blocked — falls through to the warn-and-log path unchanged', () => {
  const sessionId = `substop-retry-second-${process.pid}`;
  cleanupRetries(sessionId);
  callSubstop('First bad reply, no status word at all.', { session_id: sessionId, agent_id: 'agent-b' });
  const { out, events } = callSubstop('Second bad reply, still no status word.', {
    session_id: sessionId, agent_id: 'agent-b',
  });
  assert.strictEqual(out.json.decision, undefined, 'the second violation by the same agent must not be blocked again');
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'contract-violation');
  cleanupRetries(sessionId);
});

test('#1936: an exempt agent_type is never blocked and never writes a retry-counter entry', () => {
  const sessionId = `substop-retry-exempt-${process.pid}`;
  cleanupRetries(sessionId);
  const { out, events } = callSubstop('No status word here at all.', {
    session_id: sessionId, agent_id: 'agent-c', agent_type: 'code-simplifier:code-simplifier',
  });
  assert.deepStrictEqual(out, {}, 'an exempt third-party agent is never governed by this contract');
  assert.strictEqual(events.length, 0);
  assert.deepStrictEqual(contractRetries.readRetried(sessionId), new Set(), 'an exempt agent must never be recorded in the retry counter');
});

test('#1936: a counter-write failure is treated as already-retried, falling through to the warn-and-log path rather than blocking', (t) => {
  const sessionId = `substop-retry-writefail-${process.pid}`;
  cleanupRetries(sessionId);
  t.mock.method(contractRetries, 'recordRetry', () => false);
  const { out, events } = callSubstop('No status word here either.', { session_id: sessionId, agent_id: 'agent-d' });
  assert.strictEqual(out.json.decision, undefined, 'a failed counter write must never itself cause a block');
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(events.length, 1);
});

test('#1936: a compliant reply is never blocked and writes no retry-counter entry', () => {
  const sessionId = `substop-retry-compliant-${process.pid}`;
  cleanupRetries(sessionId);
  const { out, events } = callSubstop('All good.\nSTATUS: DONE', { session_id: sessionId, agent_id: 'agent-e' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(events.length, 0);
  assert.deepStrictEqual(contractRetries.readRetried(sessionId), new Set(), 'a compliant reply must never touch the retry counter');
});

// #2714: a nested dispatcher's own interim progress-update reply (more async
// work still pending) must not be graded as a final reply at all — no event,
// not even the informational 'lenient' variant — when it carries the
// INTERIM_STATUS marker as its trailing line, regardless of what preceded it
// in the transcript (the gap #2041's narrower immediately-preceding-signal
// filter leaves open).
test('#2714 AC1: a reply ending with INTERIM_STATUS: logs no contract-violation event at all', () => {
  const { out, events } = callSubstop('2 of 8 back. Lens 3b-b surfaced two HIGH findings.\nINTERIM_STATUS: waiting on 6 more lens agents');
  assert.deepStrictEqual(out, {}, 'an interim progress reply must never produce a dispatcher-facing warning');
  assert.strictEqual(events.length, 0, 'an interim progress reply must log nothing at all — not even the lenient variant');
});

test('#2714 AC1: the INTERIM_STATUS marker is recognized even with zero tool-use blocks in the transcript (no zero-tool-use-verdict either)', () => {
  const { out, events } = callSubstop('Still waiting on nested agents.\nINTERIM_STATUS: 3 of 8 back', { toolUse: false });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(events.length, 0, 'an interim checkpoint is not graded at all, so it must not log zero-tool-use-verdict either (same posture as asyncWaitCheckpoint)');
});

test('#2714 AC2: a final reply with no status line and no INTERIM_STATUS marker still produces exactly one genuine contract-violation — the fix narrows false positives without weakening real detection', () => {
  const { out, events } = callSubstop('Finished the task. No status line here.');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'contract-violation');
  assert.strictEqual(events[0].variant, 'violation');
  assert.match(out.json.systemMessage, /status line/i);
});

test('#2714: isInterimProgressReply recognizes the marker only as the trailing line, not mid-reply', () => {
  assert.strictEqual(substop.isInterimProgressReply('Progress note.\nINTERIM_STATUS: 2 of 8 back'), true);
  assert.strictEqual(substop.isInterimProgressReply('INTERIM_STATUS: 2 of 8 back\nMore narration after it.'), false, 'the marker must be the reply\'s LAST non-empty line, same positional rule as the canonical STATUS: line');
  assert.strictEqual(substop.isInterimProgressReply('No marker at all.\nSTATUS: DONE'), false);
  assert.strictEqual(substop.isInterimProgressReply(''), false);
});

// #3015 fixtures — line shapes copied from live transcripts (subagents/agent-a39fe70648c970fc6.jsonl,
// flow-spec-3573 main transcript): launch ack = toolUseResult.isAsync + agentId + tool_use_id;
// completion = origin.kind 'task-notification' with a string <task-notification> body.
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
function notificationBody(agentId, toolUseId, status) {
  return `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>/tmp/x/tasks/${agentId}.output</output-file>\n<status>${status}</status>\n<summary>Agent "Lens" finished</summary>\n</task-notification>`;
}
function notification(agentId, toolUseId, min, status = 'completed') {
  return {
    type: 'user',
    timestamp: at(min),
    message: { role: 'user', content: notificationBody(agentId, toolUseId, status) },
    origin: { kind: 'task-notification', producer: 'session-task', runId: 'r1' },
  };
}
// An intervening tool call (assistant tool_use + user tool_result) — defeats the #2041 immediately-preceding-signal filter.
function readCall(min) {
  return [
    { type: 'assistant', timestamp: at(min), message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_read${min}`, name: 'Read', input: {} }] } },
    { type: 'user', timestamp: at(min), message: { role: 'user', content: [{ tool_use_id: `toolu_read${min}`, type: 'tool_result', content: 'ok' }] } },
  ];
}
function reply(text, min) {
  const e = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } };
  if (min !== undefined) e.timestamp = at(min);
  return e;
}
const toLines = (entries) => entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e)));
function writeTranscript(entries) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-substop-p-')), 'agent.jsonl');
  fs.writeFileSync(f, toLines(entries).join('\n') + '\n');
  return f;
}
function runOn(transcriptPath, extraInput = {}) {
  const run = mkRun();
  const out = substop.run({
    input: { agent_transcript_path: transcriptPath, ...extraInput },
    runDir: run,
    runState: null,
    ownedRun: { dir: run, attribution: 'session' },
    cwd: '/x',
  });
  const eventsPath = path.join(run, 'events.jsonl');
  const events = fs.existsSync(eventsPath)
    ? fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];
  return { out, events };
}
const launches3 = () => [
  agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0),
  agentCall('toolu_2', 0), launchAck('a2', 'toolu_2', 1),
  agentCall('toolu_3', 1), launchAck('a3', 'toolu_3', 1),
];
// The other completion carrier (Claude Code 2.1.283+): an `attachment` line of type
// `queued_command` whose string `prompt` is the <task-notification> body — shape of REAL_QUEUED_COMPLETION below.
function queuedNotification(agentId, toolUseId, min, status = 'completed') {
  return {
    isSidechain: true,
    attachment: { type: 'queued_command', prompt: notificationBody(agentId, toolUseId, status), source_uuid: 's1', commandMode: 'task-notification', timestamp: at(min) },
    type: 'attachment',
    timestamp: at(min),
  };
}
// Verbatim live-transcript lines (long irrelevant values truncated with "…", cwd/branch shortened;
// structure and field names untouched). Launch ack + attachment completion: baymax-medical-helper
// 1fc83941…/subagents/agent-a5b308ad6074b371c.jsonl lines 37, 69 (2.1.283). Origin completion:
// dispatch d5d616b3…/subagents/agent-a39fe70648c970fc6.jsonl line 28 (2.1.258). Request echo:
// claude-tweaks 6b6344d1…/subagents/agent-a8945b482a82c0b88.jsonl line 1035 (2.1.302). Fork
// boundary: baymax-medical-helper aa192475…/subagents/agent-a05d5ba4d92af7570.jsonl line 667.
const REAL_LAUNCH_ACK = String.raw`{"parentUuid":"3f38248b-d459-45b0-877d-a53d8eedd4e4","isSidechain":true,"promptId":"362fd658-03d6-4a30-ac23-368a78adec65","agentId":"a5b308ad6074b371c","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01PeYxVRzyqqVvPEZeAmKXxv","type":"tool_result","content":[{"type":"text","text":"Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: a85038b4cf4ed1e1b (internal ID - do not mention to user. Use SendMessage with to: 'a85038b4cf4ed1e1b', summary: '<5-10 word recap>' to continue this agent.)\n…"}]}]},"uuid":"c4272f46-5b4c-4780-9637-018fdd9f282d","timestamp":"2026-10-01T14:55:15.609Z","toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"a85038b4cf4ed1e1b","description":"Impeccable Assessment B detector","resolvedModel":"claude-opus-5-5","prompt":"You are Assessment B (Detector evidence) …","outputFile":"/tmp/x/tasks/a85038b4cf4ed1e1b.output","canReadOutputFile":true},"sourceToolAssistantUUID":"3f38248b-d459-45b0-877d-a53d8eedd4e4","userType":"external","entrypoint":"cli","cwd":"/x/wt","sessionId":"1fc83941-5f74-4403-9035-5ab510331868","version":"2.1.283","gitBranch":"wt","slug":"enchanted-swimming-sloth"}`;
const REAL_QUEUED_COMPLETION = String.raw`{"parentUuid":"8210561e-ea27-4abd-bdbe-eb50781d7e2a","isSidechain":true,"agentId":"a5b308ad6074b371c","attachment":{"type":"queued_command","prompt":"<task-notification>\n<task-id>a85038b4cf4ed1e1b</task-id>\n<tool-use-id>toolu_01PeYxVRzyqqVvPEZeAmKXxv</tool-use-id>\n<output-file>/tmp/x/tasks/a85038b4cf4ed1e1b.output</output-file>\n<status>completed</status>\n<summary>Agent \"Impeccable Assessment B detector\" finished</summary>\n<result>The detector found nothing in either file.…</result>\n</task-notification>","source_uuid":"54e9f1da-a528-411a-a29d-b00782fe28c4","commandMode":"task-notification","timestamp":"2026-10-01T14:55:50.803Z","usage":{"totalTokens":75340,"toolUses":7,"durationMs":35202}},"type":"attachment","uuid":"644e4d9b-01e3-4ea1-b259-6dc5471d95f3","timestamp":"2026-10-01T14:55:50.803Z","rendered":[{"content":"<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\n…\n\n<task-notification>\n<task-id>a85038b4cf4ed1e1b</task-id>\n<tool-use-id>toolu_01PeYxVRzyqqVvPEZeAmKXxv</tool-use-id>\n<output-file>/tmp/x/tasks/a85038b4cf4ed1e1b.output</output-file>\n<status>completed</status>\n<summary>Agent \"Impeccable Assessment B detector\" finished</summary>\n<result>The detector found nothing in either file.…</result>\n</task-notification>\n</system-reminder>"}],"renderedInHumanTurn":[{"content":"<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\n…\n\n<task-notification>\n<task-id>a85038b4cf4ed1e1b</task-id>\n<tool-use-id>toolu_01PeYxVRzyqqVvPEZeAmKXxv</tool-use-id>\n<output-file>/tmp/x/tasks/a85038b4cf4ed1e1b.output</output-file>\n<status>completed</status>\n<summary>Agent \"Impeccable Assessment B detector\" finished</summary>\n<result>The detector found nothing in either file.…</result>\n</task-notification>\n</system-reminder>"}],"userType":"external","entrypoint":"cli","cwd":"/x/wt","sessionId":"1fc83941-5f74-4403-9035-5ab510331868","version":"2.1.283","gitBranch":"wt","slug":"enchanted-swimming-sloth"}`;
const REAL_ORIGIN_COMPLETION = String.raw`{"parentUuid":"212769c3-42bb-4452-95e5-1da66f13e619","isSidechain":true,"promptId":"180b1323-4996-4561-a523-f59d288449b0","agentId":"a39fe70648c970fc6","type":"user","message":{"role":"user","content":"[SYSTEM NOTIFICATION - NOT USER INPUT]\n…\n\n<task-notification>\n<task-id>a8f3ba2495443dea5</task-id>\n<tool-use-id>toolu_016xwSa23pdEq8WP2bRyYjCU</tool-use-id>\n<output-file>/tmp/x/tasks/a8f3ba2495443dea5.output</output-file>\n<status>completed</status>\n<summary>Agent \"Simplify ingest digest/nudge/MCP code\" finished</summary>\n<result>DONE…</result>\n</task-notification>"},"isMeta":true,"uuid":"130fd539-eb7c-49d1-97ee-e496ebf78a3f","timestamp":"2026-09-20T11:52:35.832Z","origin":{"kind":"task-notification"},"userType":"external","entrypoint":"cli","cwd":"/x/wt","sessionId":"d5d616b3-ffa6-45a6-acd6-097b23d9c92c","version":"2.1.258","gitBranch":"wt","slug":"polished-humming-toast"}`;
const REAL_REQUEST_ECHO = String.raw`{"type":"api-request-blob","sessionId":"6b6344d1-5440-49a8-9359-810434f050c3","agentId":"a8945b482a82c0b88","hash":"8bc7e21899d5766f95d9c31289ecdd2f386381fea96b51c43e579eae9559da4f","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\n…\n\n<task-notification>\n<task-id>b8v2jr81f</task-id>\n<summary>Monitor event: \"Heartbeat while three curation judges run\"</summary>\n<event>tick 2</event>\n…\n</task-notification>\n</system-reminder>"}]}}`;
const REAL_FORK_BOUNDARY = String.raw`{"parentUuid":"e2997cc1-acbc-46e4-8ffa-6454832ead08","isSidechain":true,"promptId":"51991eaf-5338-459e-a5c6-691afa1c4206","agentId":"a05d5ba4d92af7570","type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01Ft2tbGZst7Hr7fd8MRdivT","content":[{"type":"text","text":"Fork started — processing in background"}]},{"type":"text","text":"<fork-boilerplate>\nYou are a worker fork. The transcript above is the parent's history — inherited reference, not your situation. You are NOT a continuation of that agent. Execute ONE directive, then stop.\n…\n</fork-boilerplate>\n\nYour directive: Do nothing. Immediately reply with the single word: ok"}]},"uuid":"6d030b96-fc20-4ad2-867f-f49c4bfe6ba9","timestamp":"2026-09-20T16:03:10.432Z","userType":"external","entrypoint":"cli","cwd":"/x/wt","sessionId":"aa192475-4a04-481f-94d4-a508d603d0a1","version":"2.1.258","gitBranch":"wt"}`;
// Verbatim (#3589): claude-tweaks 6ccd43b3…/subagents/agent-a0d130f6ef719c4f1.jsonl lines 373 (launch ack), 379 (queued_command completion), 380 (reply), Claude Code 2.1.283.
const REAL_FIXWAVE_LAUNCH_ACK = String.raw`{"parentUuid":"688f4e60-0c34-4c38-9675-08df17a4fd4d","isSidechain":true,"promptId":"be747add-faf6-4cba-9a89-472d390ef066","agentId":"a0d130f6ef719c4f1","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01LRjPGMY1pkGPJjnsn8jBS4","type":"tool_result","content":[{"type":"text","text":"Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: a66c5eb4351b3033a (internal ID - do not mention to user. Use SendMessage with to: 'a66c5eb4351b3033a', summary: '<5-10 word recap>' to continue this agent.)\n…"}]}]},"uuid":"86c11e53-a7e1-49fe-903f-ce96f3cb9459","timestamp":"2026-10-04T18:48:37.374Z","toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"a66c5eb4351b3033a","description":"Final-review fix wave #2866","resolvedModel":"claude-sonnet-5","prompt":"You are fixing the findings of a whole-branch code review for record #2866 …","outputFile":"/tmp/x/tasks/a66c5eb4351b3033a.output","canReadOutputFile":true},"sourceToolAssistantUUID":"688f4e60-0c34-4c38-9675-08df17a4fd4d","userType":"external","entrypoint":"cli","cwd":"/x/wt","sessionId":"6ccd43b3-f322-4848-b923-9c7fc33d8c03","version":"2.1.283","gitBranch":"wt","slug":"idempotent-whistling-peach"}`;
const REAL_FIXWAVE_QUEUED_COMPLETION = String.raw`{"parentUuid":"df7a3ca1-5859-4965-ad17-8314718b521e","isSidechain":true,"agentId":"a0d130f6ef719c4f1","attachment":{"type":"queued_command","prompt":"<task-notification>\n<task-id>a66c5eb4351b3033a</task-id>\n<tool-use-id>toolu_01LRjPGMY1pkGPJjnsn8jBS4</tool-use-id>\n<output-file>/tmp/x/tasks/a66c5eb4351b3033a.output</output-file>\n<status>completed</status>\n<summary>Agent \"Final-review fix wave #2866\" finished</summary>\n<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.</note>\n<result>Status: DONE…</result>\n</task-notification>","source_uuid":"d419d573-d8ab-4fc2-9872-c293d3331acc","commandMode":"task-notification","timestamp":"2026-10-04T19:01:09.389Z","usage":{"totalTokens":140114,"toolUses":54,"durationMs":752026}},"type":"attachment","uuid":"515fe6b3-5307-4197-a926-2440eb5127ad","timestamp":"2026-10-04T19:01:09.389Z","rendered":[{"content":"<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\n…\n\n<task-notification>\n<task-id>a66c5eb4351b3033a</task-id>\n<tool-use-id>toolu_01LRjPGMY1pkGPJjnsn8jBS4</tool-use-id>\n<status>completed</status>\n…\n</task-notification>\n</system-reminder>"}],"renderedInHumanTurn":[{"content":"<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\n…\n\n<task-notification>\n<task-id>a66c5eb4351b3033a</task-id>\n<tool-use-id>toolu_01LRjPGMY1pkGPJjnsn8jBS4</tool-use-id>\n<status>completed</status>\n…\n</task-notification>\n</system-reminder>"}],"userType":"external","entrypoint":"cli","cwd":"/x/wt","sessionId":"6ccd43b3-f322-4848-b923-9c7fc33d8c03","version":"2.1.283","gitBranch":"wt","slug":"idempotent-whistling-peach"}`;
const REAL_FIXWAVE_REPLY = String.raw`{"parentUuid":"515fe6b3-5307-4197-a926-2440eb5127ad","isSidechain":true,"agentId":"a0d130f6ef719c4f1","message":{"model":"claude-opus-5-5","id":"msg_011CfhiLLVbY6uED7fzTpwnF","type":"message","role":"assistant","content":[{"type":"text","text":"Now the one scoped re-review of the fix wave."}],"container":null,"stop_reason":null,"stop_sequence":null,"stop_details":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":1223,"cache_read_input_tokens":346743,"cache_creation":{"ephemeral_5m_input_tokens":1223,"ephemeral_1h_input_tokens":0},"output_tokens":35,"service_tier":"standard","inference_geo":"not_available"},"input_transformations":[],"diagnostics":null,"context_management":null},"apiBlockIndex":0,"requestId":"req_011CfhiLLBVbyPhjBgCsv7uY","attributionAgent":"general-purpose","attributionSkill":"claude-tweaks:challenge","attributionPlugin":"claude-tweaks","type":"assistant","uuid":"0057454a-4f1e-4aea-b077-37d293ed88ba","timestamp":"2026-10-04T19:01:14.157Z","advisorModel":"claude-opus-5-5","effort":"high","perTurnEffort":"high","userType":"external","entrypoint":"cli","cwd":"/x/wt","sessionId":"6ccd43b3-f322-4848-b923-9c7fc33d8c03","version":"2.1.283","gitBranch":"wt","slug":"idempotent-whistling-peach"}`;

test('#3015 AC1.1: a yield after intervening tool calls while 2 of 3 launched Agent dispatches are pending is not blocked and logs nothing', () => {
  const sessionId = `cr-3015-ac1-${process.pid}`;
  cleanupRetries(sessionId);
  const p = writeTranscript([
    ...launches3(), notification('a1', 'toolu_1', 3), ...readCall(4),
    reply('Lens 1 back; waiting on lenses 2 and 3.', 5),
  ]);
  const { out, events } = runOn(p, { session_id: sessionId, agent_id: 'parent-1' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(events.length, 0);
  assert.strictEqual(contractRetries.readRetried(sessionId).has('parent-1'), false, 'no forced STATUS retry while dispatches are pending');
  cleanupRetries(sessionId);
});

test('#3015 AC2.1: the same transcript with every launched dispatch completed, ending in a non-compliant reply, is still blocked', () => {
  const sessionId = `cr-3015-ac2-${process.pid}`;
  cleanupRetries(sessionId);
  const p = writeTranscript([
    ...launches3(), notification('a1', 'toolu_1', 3), notification('a2', 'toolu_2', 3), notification('a3', 'toolu_3', 3),
    ...readCall(4), reply('All lenses back; folded the findings in.', 5),
  ]);
  const { out } = runOn(p, { session_id: sessionId, agent_id: 'parent-2' });
  assert.strictEqual(out.json.decision, 'block');
  cleanupRetries(sessionId);
});

test('#3015 AC3.1: INTERIM_STATUS and immediately-after-async-signal replies behave as today', () => {
  const sessionId = `cr-3015-ac3-${process.pid}`;
  cleanupRetries(sessionId);
  const done = [...launches3(), notification('a1', 'toolu_1', 3), notification('a2', 'toolu_2', 3), notification('a3', 'toolu_3', 3), ...readCall(4)];
  // (a) all completed, INTERIM_STATUS trailing line
  let r = runOn(writeTranscript([...done, reply('Drafting.\nINTERIM_STATUS: drafting the summary', 5)]), { session_id: sessionId, agent_id: 'p3a' });
  assert.deepStrictEqual(r.out, {});
  assert.strictEqual(r.events.length, 0);
  // (b) one launch still pending, reply immediately after the launch ack (#2041 and #3015 both skip it)
  r = runOn(writeTranscript([agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), reply('Launched; waiting.', 1)]), { session_id: sessionId, agent_id: 'p3b' });
  assert.deepStrictEqual(r.out, {});
  assert.strictEqual(r.events.length, 0);
  // (b2) nothing pending, reply immediately after the last completion notification: only the #2041 signal exempts it
  r = runOn(writeTranscript([agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), notification('a1', 'toolu_1', 1), reply('Lens back; summarising.', 2)]), { session_id: sessionId, agent_id: 'p3b2' });
  assert.deepStrictEqual(r.out, {});
  assert.strictEqual(r.events.length, 0);
  // (c) all completed, canonical status
  r = runOn(writeTranscript([...done, reply('Done.\nSTATUS: DONE', 5)]), { session_id: sessionId, agent_id: 'p3c' });
  assert.deepStrictEqual(r.out, {});
  assert.strictEqual(r.events.length, 0);
  cleanupRetries(sessionId);
});

test('#3015 AC4.1: live-transcript lines — verbatim launch ack, attachment- and origin-shaped completions, request echo (the origin case pairs a helper-built launch with the verbatim completion)', () => {
  const replyAt = (iso) => JSON.stringify({ ...reply('x'), timestamp: iso });
  const bayReply = replyAt('2026-10-01T14:57:21.835Z');
  assert.strictEqual(substop.countPendingDispatches([REAL_LAUNCH_ACK, bayReply], 1), 1, 'the real launch ack is a pending launch');
  assert.strictEqual(substop.countPendingDispatches([REAL_LAUNCH_ACK, REAL_QUEUED_COMPLETION, bayReply], 2), 0, 'the real queued_command attachment completes it');
  const originLaunch = JSON.stringify(launchAck('a8f3ba2495443dea5', 'toolu_016xwSa23pdEq8WP2bRyYjCU', 0));
  assert.strictEqual(substop.countPendingDispatches([originLaunch, REAL_ORIGIN_COMPLETION, replyAt(at(5))], 2), 0, 'the real origin-shaped notification completes its launch');
  assert.strictEqual(substop.countPendingDispatches([REAL_LAUNCH_ACK, REAL_REQUEST_ECHO, bayReply], 2), 1, 'a request echo is a recognized carrier (not indeterminate) and its unrelated ids complete nothing');
  // A request echo repeating this launch's notification completes it (the echo's task-id swapped for the launch's agentId).
  const echoOfLaunch = REAL_REQUEST_ECHO.replace('b8v2jr81f', 'a85038b4cf4ed1e1b');
  assert.strictEqual(substop.countPendingDispatches([REAL_LAUNCH_ACK, echoOfLaunch, bayReply], 2), 0, 'a request echo carrying the launch\'s id completes it');
});

test('#3015 bound: a launch older than 60 minutes with no completion no longer exempts a non-compliant reply', () => {
  const sessionId = `cr-3015-bound-${process.pid}`;
  cleanupRetries(sessionId);
  const mk = (replyMin) => [agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), ...readCall(replyMin - 1), reply('Done with everything.', replyMin)];
  const { out } = runOn(writeTranscript(mk(62)), { session_id: sessionId, agent_id: 'parent-bound' });
  assert.strictEqual(out.json.decision, 'block');
  const lines59 = toLines(mk(59));
  assert.strictEqual(substop.countPendingDispatches(lines59, lines59.length - 1), 1);
  // Exactly at the bound the launch still counts (the cutoff is strictly older than 60 minutes).
  const lines60 = toLines(mk(60));
  assert.strictEqual(substop.countPendingDispatches(lines60, lines60.length - 1), 1);
  cleanupRetries(sessionId);
});

test('#3015 countPendingDispatches: correlates a completion by tool-use-id alone', () => {
  const lines = toLines([agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), notification('other', 'toolu_1', 1), reply('x', 2)]);
  assert.strictEqual(substop.countPendingDispatches(lines, 3), 0);
});

test('#3015 countPendingDispatches: correlates a completion by agent id alone', () => {
  const lines = toLines([agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), notification('a1', 'other', 1), reply('x', 2)]);
  assert.strictEqual(substop.countPendingDispatches(lines, 3), 0);
});

test('#3015 countPendingDispatches: a plain (non-async) tool result is not a launch, so a non-compliant reply after it is still blocked', () => {
  const plainResult = { type: 'user', timestamp: at(1), message: { role: 'user', content: [{ tool_use_id: 'toolu_bash1', type: 'tool_result', content: 'ok' }] }, toolUseResult: { stdout: 'ok', stderr: '', interrupted: false } };
  const entries = [agentCall('toolu_bash1', 0), plainResult, reply('Done with everything.', 2)];
  assert.strictEqual(substop.countPendingDispatches(toLines(entries), entries.length - 1), 0);
  const sessionId = `cr-3015-plain-${process.pid}`;
  cleanupRetries(sessionId);
  const { out } = runOn(writeTranscript(entries), { session_id: sessionId, agent_id: 'parent-plain' });
  assert.strictEqual(out.json.decision, 'block');
  cleanupRetries(sessionId);
});

test('#3015 countPendingDispatches: a background-Bash notification does not complete an unrelated agent launch', () => {
  const lines = toLines([agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), notification('bash9', 'toolu_bash9', 1), reply('x', 2)]);
  assert.strictEqual(substop.countPendingDispatches(lines, 3), 1);
});

test('#3015 countPendingDispatches: returns null for an id-less task-notification, a launch with no ids, an unparseable prior line, and a missing timestamp', () => {
  const idless = { ...notification('a1', 'toolu_1', 1), message: { role: 'user', content: '<task-notification>\n<status>completed</status>\n</task-notification>' } };
  const idlessEntries = [agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), idless, ...readCall(2), reply('Done with everything.', 3)];
  assert.strictEqual(substop.countPendingDispatches(toLines(idlessEntries), idlessEntries.length - 1), null);

  const noIds = { type: 'user', timestamp: at(1), message: { role: 'user', content: 'plain' }, toolUseResult: { isAsync: true, status: 'async_launched' } };
  assert.strictEqual(substop.countPendingDispatches(toLines([noIds, reply('x', 2)]), 1), null);

  assert.strictEqual(substop.countPendingDispatches(toLines([launchAck('a1', 'toolu_1', 0), 'not json {', reply('x', 2)]), 2), null);

  const noTs = launchAck('a1', 'toolu_1', 0); delete noTs.timestamp;
  assert.strictEqual(substop.countPendingDispatches(toLines([noTs, reply('x', 2)]), 1), null);

  // A reply with no timestamp cannot be aged against a still-pending launch.
  assert.strictEqual(substop.countPendingDispatches(toLines([launchAck('a1', 'toolu_1', 0), reply('x')]), 1), null);

  // run(): an indeterminate shape falls back to today's grading, never a blanket exemption.
  const sessionId = `cr-3015-null-${process.pid}`;
  cleanupRetries(sessionId);
  const { out } = runOn(writeTranscript(idlessEntries), { session_id: sessionId, agent_id: 'parent-null' });
  assert.strictEqual(out.json.decision, 'block');
  cleanupRetries(sessionId);
});

test('#3015 AC2.2: every completion delivered as a queued_command attachment, ending in a non-compliant reply, is still blocked', () => {
  const sessionId = `cr-3015-ac2att-${process.pid}`;
  cleanupRetries(sessionId);
  const entries = [
    ...launches3(), queuedNotification('a1', 'toolu_1', 3), queuedNotification('a2', 'toolu_2', 3), queuedNotification('a3', 'toolu_3', 3),
    ...readCall(4), reply('All lenses back; folded the findings in.', 5),
  ];
  // block alone is also what an unrecognized carrier (null) yields — pin that the carrier IS recognized (count 0, not null).
  assert.strictEqual(substop.countPendingDispatches(toLines(entries), entries.length - 1), 0);
  const { out } = runOn(writeTranscript(entries), { session_id: sessionId, agent_id: 'parent-2att' });
  assert.strictEqual(out.json.decision, 'block');
  cleanupRetries(sessionId);
});

test('#3015 AC1.2: a yield while one launch is pending and the others completed via queued_command attachments is not blocked and logs nothing', () => {
  const sessionId = `cr-3015-ac1att-${process.pid}`;
  cleanupRetries(sessionId);
  const p = writeTranscript([
    ...launches3(), queuedNotification('a1', 'toolu_1', 3), queuedNotification('a2', 'toolu_2', 3), ...readCall(4),
    reply('Lenses 1 and 2 back; waiting on lens 3.', 5),
  ]);
  const { out, events } = runOn(p, { session_id: sessionId, agent_id: 'parent-1att' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(events.length, 0);
  assert.strictEqual(contractRetries.readRetried(sessionId).has('parent-1att'), false);
  cleanupRetries(sessionId);
});

test('#3015 fork: a worker fork does not inherit its parent\'s pending launches — only its own launches after the boundary count', () => {
  const sessionId = `cr-3015-fork-${process.pid}`;
  cleanupRetries(sessionId);
  const forkEntries = [...launches3(), REAL_FORK_BOUNDARY, reply('ok', 5)];
  assert.strictEqual(substop.countPendingDispatches(toLines(forkEntries), forkEntries.length - 1), 0);
  const { out } = runOn(writeTranscript(forkEntries), { session_id: sessionId, agent_id: 'fork-1' });
  assert.strictEqual(out.json.decision, 'block', 'the fork\'s own non-compliant final reply is graded');
  const own = [...launches3(), REAL_FORK_BOUNDARY, agentCall('toolu_f1', 4), launchAck('f1', 'toolu_f1', 4), ...readCall(5), reply('x', 6)];
  assert.strictEqual(substop.countPendingDispatches(toLines(own), own.length - 1), 1, 'a launch after the boundary is the fork\'s own');
  cleanupRetries(sessionId);
});

test('#3015 countPendingDispatches: fails closed (null) on <task-notification> or <fork-boilerplate> in an unrecognized carrier, and on an id-less queued_command', () => {
  const quoted = (text) => ({ type: 'user', timestamp: at(2), message: { role: 'user', content: [{ tool_use_id: 'toolu_q', type: 'tool_result', content: text }] } });
  const tn = [agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), quoted('<task-notification>\n<task-id>a9</task-id>\n</task-notification>'), reply('x', 3)];
  assert.strictEqual(substop.countPendingDispatches(toLines(tn), tn.length - 1), null);
  const fb = [agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), quoted('<fork-boilerplate>\nquoted\n</fork-boilerplate>'), reply('x', 3)];
  assert.strictEqual(substop.countPendingDispatches(toLines(fb), fb.length - 1), null);
  const idless = queuedNotification('a1', 'toolu_1', 2);
  idless.attachment.prompt = '<task-notification>\n<status>completed</status>\n</task-notification>';
  const iq = [agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), idless, reply('x', 3)];
  assert.strictEqual(substop.countPendingDispatches(toLines(iq), iq.length - 1), null);
  // run(): the unrecognized-carrier transcript grades as today.
  const sessionId = `cr-3015-unrec-${process.pid}`;
  cleanupRetries(sessionId);
  const { out } = runOn(writeTranscript([...tn.slice(0, -1), ...readCall(3), reply('Done with everything.', 4)]), { session_id: sessionId, agent_id: 'parent-unrec' });
  assert.strictEqual(out.json.decision, 'block');
  cleanupRetries(sessionId);
});

test('#3015 countPendingDispatches: an origin-shaped notification with no message, or a message with no content, is indeterminate (null)', () => {
  const noMessage = notification('a1', 'toolu_1', 1); delete noMessage.message;
  const noContent = notification('a1', 'toolu_1', 1); delete noContent.message.content;
  for (const drifted of [noMessage, noContent]) {
    const entries = [agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), drifted, reply('x', 2)];
    assert.strictEqual(substop.countPendingDispatches(toLines(entries), entries.length - 1), null);
  }
});

test('#3015 countPendingDispatches: a queued_command prompt without <task-notification> (a relayed message) is not a completion carrier and is ignored', () => {
  const relay = queuedNotification('a1', 'toolu_1', 1);
  relay.attachment.prompt = 'Please also check the README.';
  delete relay.attachment.commandMode;
  const entries = [agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0), relay, reply('x', 2)];
  assert.strictEqual(substop.countPendingDispatches(toLines(entries), entries.length - 1), 1);
});

test('#3589 AC1.1: a non-compliant reply right after a verbatim queued_command completion (nothing pending) is not blocked and logs nothing', () => {
  const sessionId = `cr-3589-ac1-${process.pid}`;
  cleanupRetries(sessionId);
  const entries = [REAL_FIXWAVE_LAUNCH_ACK, REAL_FIXWAVE_QUEUED_COMPLETION, REAL_FIXWAVE_REPLY];
  assert.strictEqual(substop.countPendingDispatches(toLines(entries), 2), 0, 'nothing pending: only the #2041 signal can exempt the reply');
  const { out, events } = runOn(writeTranscript(entries), { session_id: sessionId, agent_id: 'fixwave-1' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(events.length, 0);
  assert.strictEqual(contractRetries.readRetried(sessionId).has('fixwave-1'), false, 'no forced STATUS retry for a reply reacting to a queued completion');
  cleanupRetries(sessionId);
});

test('#3589 AC2.1: the same completion followed by other tool calls, nothing pending, ending in a non-compliant reply, is still blocked', () => {
  const sessionId = `cr-3589-ac2-${process.pid}`;
  cleanupRetries(sessionId);
  const readCallAt = (id, iso) => [
    { type: 'assistant', timestamp: iso, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: {} }] } },
    { type: 'user', timestamp: iso, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'ok' }] } },
  ];
  const finalReply = { type: 'assistant', timestamp: '2026-10-04T19:02:30.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Re-review done; folded the findings in.' }] } };
  const entries = [REAL_FIXWAVE_LAUNCH_ACK, REAL_FIXWAVE_QUEUED_COMPLETION, ...readCallAt('toolu_read_3589', '2026-10-04T19:02:00.000Z'), finalReply];
  assert.strictEqual(substop.countPendingDispatches(toLines(entries), entries.length - 1), 0, 'nothing pending, so the block is down to the reply\'s own non-compliance');
  const { out } = runOn(writeTranscript(entries), { session_id: sessionId, agent_id: 'fixwave-2' });
  assert.strictEqual(out.json.decision, 'block');
  cleanupRetries(sessionId);
});

test('#3589 isAsyncWaitSignal: true for a queued_command task-notification, false for a relayed queued_command and for an api-request-blob echo', () => {
  assert.strictEqual(substop.isAsyncWaitSignal(JSON.parse(REAL_FIXWAVE_QUEUED_COMPLETION)), true);
  assert.strictEqual(substop.isAsyncWaitSignal(queuedNotification('a1', 'toolu_1', 1)), true);
  const relay = queuedNotification('a1', 'toolu_1', 1);
  relay.attachment.prompt = 'Please also check the README.';
  assert.strictEqual(substop.isAsyncWaitSignal(relay), false);
  assert.strictEqual(substop.isAsyncWaitSignal(JSON.parse(REAL_REQUEST_ECHO)), false, 'a request echo repeats notifications already delivered; it is not a checkpoint');
});
