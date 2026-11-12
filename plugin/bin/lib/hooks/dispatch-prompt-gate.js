// bin/lib/hooks/dispatch-prompt-gate.js — the dispatch-prompt fidelity gate (block tier, #4589).
// PreToolUse on the Agent tool (and `Task`, the name an older CLI may report): a
// /claude-tweaks:dispatch Task prompt must be byte-for-byte the file bin/dispatch-prompt.js last
// rendered for its call, and a prompt from the dispatching session that names one of its bound runs
// must carry that CLI's marker. docs/reference/pretooluse-agent-tool-probe.md measured the payload
// this reads (tool_name, the exact tool_input.prompt, session_id, agent_id on a nested call only).
//
// Direction: fails OPEN on every unprovable answer. The call it blocks is the dispatch itself, so a
// wrong deny strands a group while a wrong allow only falls back to the hand-filled prompt this
// record replaces. It acts only on a main-thread call — `agent_id` absent or empty — with a string
// `tool_input.prompt` and tool_name `Agent` or `Task`. A dispatching session that is itself a Task
// subagent (dispatch/sequential-execution.md's #447 shape) sends every call with an `agent_id` and
// is checked by neither rule: the accepted residual (spec Decision 4 Q1); its `cd` prefix is the one
// sanctioned edit. It denies only:
//   (A) mismatch — the prompt carries a MARKER_RE line naming run id R; R passes RUN_ID_RE; the main
//       checkout resolves; pipelines/ and pipelines/R both canonicalize, R is a directory and a
//       direct child of pipelines/; its dispatch-prompts.jsonl reads (or is ENOENT: nothing was
//       rendered for this run); and the LATEST parsed line whose `call` equals the marker's call
//       (malformed lines skipped) is absent or carries another digest. Only the last render for a
//       call is current (spec Decision 3), so an earlier render for the same call is a mismatch.
//   (B) missing marker — no MARKER_RE line; a non-empty session_id; the main checkout resolves;
//       readdirSync(pipelines/) succeeds; and some entry R (RUN_ID_RE, named anywhere in the prompt)
//       has a non-clean run-state that isDispatchTaskCall binds to this session.
// Fail-open conditions, each `{}` with no event: any other tool name; a non-string prompt; an
// agent_id; a load fault in task-prompt.js; a marker run id failing RUN_ID_RE; mainCheckoutRoot null
// or throwing; a pipelines/ or run dir that does not canonicalize; a run dir that is not a directory
// or not a direct child of pipelines/ (a symlink out, a traversal); a registry read failing with
// anything but ENOENT; a marker-less prompt with no session_id, no readable pipelines/, or naming no
// bound non-clean run of this session; and any throw.
//
// Runs read: neither ctx.runDir nor ctx.ownedRun. The dispatching session's cwd is the group's
// worktree, and its owned run is not necessarily the group's run. Rule (A) reads the run the marker
// names, {main}/.claude-tweaks/pipelines/{R}; rule (B) scans the main checkout's pipelines dir for
// runs this session bound. context.js's iterRunDirsWithState was not used: it reads every run's
// run-state.json (725 entries in this repo at authoring), and it falls back to the cwd's own,
// possibly worktree-local, pipelines dir when the main checkout is unresolved, which a deny must not
// read. Rule (B) reads a run-state only for an entry the prompt names.
//
// Each deny appends a `gate-denial` event (gate 'dispatch-prompt-fidelity', reason 'mismatch' or
// 'missing-marker') to the named run, unattributed (the run is named, not guessed). The deny outcome
// is pre-tool-use.js's denyResult, passed in by runInner, so this module never requires
// pre-tool-use.js. `deps` (test seams): fsImpl, mainCheckoutRoot, readRunState, loadTaskPrompt.
'use strict';
const fs = require('fs');
const path = require('path');
const ctxLib = require('./context');
const wtDetect = require('./worktree-detect');
const { canonicalRealpath, lstatType } = require('../path-guard');
const { isPathContained } = require('../shared-primitives');
const { isDispatchTaskCall } = require('../dispatch/task-call');

const GATE = 'dispatch-prompt-fidelity';

function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || '${CLAUDE_PLUGIN_ROOT}';
}

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

function testTag() {
  return process.env.CT_HOOKS_TEST_MODE === '1' ? { test: true } : null;
}

// The main checkout's canonical pipelines dir, or null when it cannot be proven.
function pipelinesDir(cwd, d) {
  if (!isNonEmptyString(cwd) || !path.isAbsolute(cwd)) return null;
  let main;
  try { main = d.mainCheckoutRoot(cwd); } catch { return null; }
  if (!isNonEmptyString(main)) return null;
  return canonicalRealpath(path.join(main, '.claude-tweaks', 'pipelines'), { fsImpl: d.fsImpl });
}

function latestLineFor(text, call) {
  let latest = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o && typeof o === 'object' && o.call === call) latest = o;
  }
  return latest;
}

function checkMismatch(ctx, prompt, marker, tp, d, deny) {
  const [, runId, call] = marker;
  if (!ctxLib.RUN_ID_RE.test(runId)) return {};
  const pipes = pipelinesDir(ctx.cwd, d);
  if (!pipes) return {};
  const real = canonicalRealpath(path.join(pipes, runId), { fsImpl: d.fsImpl });
  if (!real) return {};
  if (lstatType(real, { fsImpl: d.fsImpl }).type !== 'directory') return {};
  if (!isPathContained(real, pipes) || path.dirname(real) !== pipes) return {};
  let text;
  try {
    text = d.fsImpl.readFileSync(path.join(real, tp.REGISTRY_FILE), 'utf8');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') return {};
    text = '';
  }
  const latest = latestLineFor(text, call);
  const current = latest !== null && latest.sha256 === tp.promptDigest(prompt);
  if (current) return {};
  const parts = latest && isNonEmptyString(latest.out) && Number.isInteger(latest.chunks) && latest.chunks > 0
    ? `"${latest.out}.part1".."${latest.out}.part${latest.chunks}"`
    : 'the files dispatch-prompt.js wrote';
  ctxLib.appendEvent(real, 'gate-denial', { tool: ctx.input.tool_name, gate: GATE, reason: 'mismatch', ...testTag() });
  return deny(
    `claude-tweaks: this dispatch Task prompt for run ${runId} is not byte-for-byte the prompt ` +
    `bin/dispatch-prompt.js last rendered for its ${call} call (#4589). Resend it unchanged once — cat each of ` +
    `${parts} and pass them joined in order by one newline; never edit or re-type it by hand. A second deny ` +
    `takes two-call-gate.md section 2's terminal path.`,
  );
}

function checkMissingMarker(ctx, prompt, d, deny) {
  const sessionId = ctx.input.session_id;
  if (!isNonEmptyString(sessionId)) return {};
  const pipes = pipelinesDir(ctx.cwd, d);
  if (!pipes) return {};
  let names;
  try { names = d.fsImpl.readdirSync(pipes); } catch { return {}; }
  for (const name of names) {
    if (typeof name !== 'string' || !ctxLib.RUN_ID_RE.test(name) || !prompt.includes(name)) continue;
    const runDir = path.join(pipes, name);
    const state = d.readRunState(runDir);
    if (!state || typeof state !== 'object' || state.status === 'clean') continue;
    if (!isDispatchTaskCall({ runState: state, sessionId })) continue;
    ctxLib.appendEvent(runDir, 'gate-denial', { tool: ctx.input.tool_name, gate: GATE, reason: 'missing-marker', ...testTag() });
    return deny(
      `claude-tweaks: this Agent prompt names run ${name}, which this session dispatched, but carries no ` +
      `dispatch-prompt.js marker (#4589). A /claude-tweaks:dispatch Task prompt is rendered with ` +
      `node "${pluginRoot()}/bin/dispatch-prompt.js" (dispatch SKILL.md Step 5) and passed unchanged — never ` +
      `fill task-prompt.md by hand.`,
    );
  }
  return {};
}

function checkDispatchPromptGate(ctx, deps = {}, deny) {
  try {
    const input = ctx && ctx.input;
    if (!input || (input.tool_name !== 'Agent' && input.tool_name !== 'Task')) return {};
    if (input.agent_id !== undefined && input.agent_id !== null && input.agent_id !== '') return {};
    const prompt = input.tool_input && input.tool_input.prompt;
    if (typeof prompt !== 'string') return {};
    if (typeof deny !== 'function') return {};
    const d = {
      fsImpl: deps.fsImpl || fs,
      mainCheckoutRoot: deps.mainCheckoutRoot || wtDetect.mainCheckoutRoot,
      readRunState: deps.readRunState || ctxLib.readRunState,
      loadTaskPrompt: deps.loadTaskPrompt || (() => require('../dispatch/task-prompt')),
    };
    let tp;
    try { tp = d.loadTaskPrompt(); } catch { return {}; }
    const marker = tp.MARKER_RE.exec(prompt);
    return marker ? checkMismatch(ctx, prompt, marker, tp, d, deny) : checkMissingMarker(ctx, prompt, d, deny);
  } catch {
    return {};
  }
}

module.exports = { checkDispatchPromptGate, GATE };
