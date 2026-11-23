'use strict';
// Runs review lens briefs as headless `lens-reviewer` workers (#6000) and builds the reply
// shape `review-coordination.js settle-lens-replies` reads, the same shape
// `plugin/workflows/review-lens-fanout.js` returns: `{ started: true, lenses: [{lens,
// reviewers}], reviewers: [{lens, side, text, failed}] }`, in lens order then side A, B.
// `bin/review-lens-workers.js` is the CLI over it.
//
// Constants. LENS_WORKER_CONCURRENCY (4) workers run at once at most; each has a wall-clock
// ceiling of LENS_WORKER_TIMEOUT_MS (15 minutes). EXCLUDED_LENSES (`3f`) never reaches a
// worker: lens 3f's discrimination checks run tests in a scratch checkout, which a read-only
// role cannot do, so its sides fail with reason `excluded` before any worker starts and the
// worker-path dispatcher (#6003) routes it to the Task path.
//
// Every launch is `launchWorker` (worker.js) with role `lens-reviewer`, the reviewed worktree
// as `cwd`, the prompt `composeLensPrompt(bundleText, brief)` (the context bundle inlined, so
// nothing is written into the reviewed tree, plan review Q1), the admitted-forms note
// (`lensAdmittedFormsNote`) as the appended system prompt (Q2), the lens's own model, the
// role's effort from `roleLaunch('lens-reviewer', policy)` (Q3), `readPaths`, `attrSource`
// (the pinned git environment, roles.js), LENS_REPLY_SCHEMA and the wall-clock ceiling.
//
// Failure reasons (FAILURE_REASONS) never enter the reply: a failed side is `text: null,
// failed: true`, and its reason goes to the caller's `failures` (the CLI's stderr) and to the
// launcher's log (each `failures` entry also carries `detail`: the envelope's `detail` or the
// launch throw's message, worker-written text a caller neutralizes before printing). In order of
// precedence: `excluded` (EXCLUDED_LENSES); `platform` (the
// platform is not in SANDBOX_PROBED_PLATFORMS, where the role has no Bash, or the git in the
// reviewed worktree does not honour GIT_ATTR_SOURCE, which the pinned environment needs:
// `gitHonoursAttrSource`, checked once before any worker starts); `launch` (a `roleLaunch`
// throw fails every remaining side; a `launchWorker` throw or rejection fails that side alone;
// a non-ok envelope that is not `auth` or `timeout`); then `classifyFailure`'s envelope
// reasons. A reply of "No findings." is a reply, never `blank`.
//
// Auth-failure wording (`classifyFailure`'s `auth`), captured 2026-11-23 with Claude Code CLI
// 2.1.325 on macOS (darwin), no TTY: `claude -p --output-format json "x"` with
// CLAUDE_CONFIG_DIR set to an empty directory and only the worker's ENV_ALLOW names exited 1
// and printed a result object with `is_error: true`, `subtype: "success"` and
// `"result":"Not logged in · Please run /login"`, nothing on stderr (evidence:
// the run's `evidence/auth-failure.txt`). The launcher reads that as `fail`/`exit` with the
// result string as `detail`, so AUTH_FAILURE matches `detail`. No other wording was captured
// (an env-authenticated host's failure, #5259, was not): any other launch failure is `launch`,
// which is still `failed: true`.
//
// The launcher's log, WORKER_DISPATCHES_FILE (`worker-dispatches.jsonl`, defined in timing/transcript.js, which reads it) in the run directory,
// is appended, never rewritten: one JSON line per side as that side settles (not after all of
// them), launched or not, under `withLock` on `{runDir}/worker-dispatches.jsonl.lock` so two
// launcher runs on one run directory cannot interleave lines. The lock fails closed and never
// creates a missing run directory. A record is `{ kind: 'worker', launched, lens, side,
// description, agentType: 'lens-reviewer', metaModel, startTs, endTs, wallClockMs, failed,
// reason }`; `launched` is whether the runner was called for that side (false for `excluded`,
// `platform`, a `roleLaunch` throw and a `launchWorker` refusal, each with `startTs === endTs`
// and `wallClockMs: 0` when nothing was attempted). This module is the file's only writer.
// A launched record also carries the token fields timing reads (`kind: 'worker'` marks it as
// a headless worker, never a transcript-backed subagent): `agentId` (the envelope's session id,
// else `lens-{lens}-{side}-{startMs}`), `transcriptModel`, `parentAgentId` and `spawnDepth`
// (null), `tokens` (`{ input, output, cacheRead, cacheCreate }`), `firstTurnTokens`, `costUsd`,
// `notFound` and `workflowRunId` / `workflowPhase` (null). Usage source: the envelope's `usage`
// (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) is
// the total. With none (a timeout or a launch failure leaves no result object), `tokens` is the
// sum of the assistant rows of the worker's own transcript, which the launch's pre-minted session
// id (worker.js) names; `tokens` is null with `notFound: 'no usage in the worker envelope'` only
// when no transcript can be found or read either. `firstTurnTokens` is `readUsage`'s
// `contextTokens` of the worker's first assistant turn (input + cacheRead + cacheCreate, the
// context the worker opened with), read from that transcript (`locateTranscripts` over the
// canonical cwd, in the config dir of the env the worker ran with, then `readUsage`) and null
// when it cannot be found or read. Why the canonical path: on macOS a session whose cwd was under
// /tmp got a projects directory named `-private-tmp-…` (the realpath); a launch from a symlinked
// cwd was not itself observed. The config-dir
// fallback (HOME before USERPROFILE) is unprobed on win32 and moot today: off
// SANDBOX_PROBED_PLATFORMS no worker starts. `timing/transcript.js`'s `readWorkerDispatches`
// reads these lines into `timing.json` `dispatches`; a `launched: false` line is never a dispatch.
// An append that fails is returned in `logFailures` and never changes the reply. The run
// directory is never inside the reviewed worktree (the CLI refuses that), so this write keeps
// Q1.
//
// Termination. Each side's first runner call is its worker; that handle sits in `deps.active`
// (a Set the caller owns) while the side runs, so the caller can forward a signal to every
// running worker, as launch.js's `launchTracked` does for the driver. Once `deps.aborted()`
// is true no further side starts; a side never started writes no record.

const fs = require('node:fs');
const path = require('node:path');
const { withLock } = require('../file-lock');
const { canonicalRealpath } = require('../path-guard');
const { FINDING_LENS_CLASS } = require('../console/finding-path');
const { LENS_REPLY_SCHEMA, SANDBOX_PROBED_PLATFORMS, lensAdmittedFormsNote, gitHonoursAttrSource } = require('./roles');
const { launchWorker } = require('./worker');
const { roleLaunch } = require('./launch');
const { locateTranscripts, readUsage, WORKER_DISPATCHES_FILE } = require('../timing/transcript');

const LENS_WORKER_CONCURRENCY = 4;
const LENS_WORKER_TIMEOUT_MS = 900000;
const EXCLUDED_LENSES = Object.freeze(['3f']);
const FAILURE_REASONS = Object.freeze(['launch', 'auth', 'timeout', 'blank', 'platform', 'excluded', 'denied']);
const ROLE = 'lens-reviewer';
// See the header: the captured "Not logged in · Please run /login" result string.
const AUTH_FAILURE = /^Not logged in\b/;

// The workflow script's own checks and messages (review-lens-fanout.js `refusal`), so both
// producers refuse the same input the same way. The lens class is settle-lens-replies'.
const LENS_TOKEN = new RegExp(`^[${FINDING_LENS_CLASS}]+$`);
const blank = (v) => typeof v !== 'string' || v.trim() === '';

function inputRefusal(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return 'args must be an object';
  if (!Array.isArray(input.lenses) || input.lenses.length === 0) return 'lenses must be a non-empty array';
  const seen = new Set();
  for (const l of input.lenses) {
    if (typeof l?.lens !== 'string' || !LENS_TOKEN.test(l.lens)) {
      return 'lens must be one plain token of letters, digits, _ or -';
    }
    if (seen.has(l.lens)) return `lens ${l.lens} is named twice`;
    seen.add(l.lens);
    if (blank(l.brief)) return `lens ${l.lens} has no brief`;
    if (blank(l.model)) return `lens ${l.lens} has no model`;
    if (l.reviewers !== 1 && l.reviewers !== 2) return `lens ${l.lens} reviewers must be 1 or 2`;
  }
  return null;
}

function composeLensPrompt(bundleText, brief) {
  return '<review-context>\n' + bundleText + '\n</review-context>\n\n' + brief;
}

// A permission denial for a git command (spec AC9): a Bash denial with any segment of its
// command that, once its leading `NAME=value` assignments are dropped and it is trimmed, is
// `git` or starts with `git` and whitespace. Segments split on `;`, `&`, `|`, a line break,
// `(`, `)` and a backtick, so `cd src && git log`, `true; git diff` and `$(git ...)` count.
// Over-splitting (a `2>&1`, a separator inside quotes) can only add a segment, so it errs
// toward `denied`, a failed side. A denial of any other tool leaves the side's outcome alone.
// One forward pass, no regex over the command (regex-scan-linearity).
const SEGMENT_SEPARATORS = new Set([';', '&', '|', '\n', '\r', '(', ')', '`']);
const isNameStart = (c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_';
const isNameChar = (c) => isNameStart(c) || (c >= '0' && c <= '9');
const isSpace = (c) => c === ' ' || c === '\t';

// A segment past its leading `NAME=value` assignments (a quoted value may hold spaces); an
// unterminated quote leaves nothing, since no command follows it.
function afterAssignments(segment) {
  let i = 0;
  for (;;) {
    while (i < segment.length && isSpace(segment[i])) i += 1;
    if (!isNameStart(segment[i])) return segment.slice(i);
    let j = i + 1;
    while (j < segment.length && isNameChar(segment[j])) j += 1;
    if (segment[j] !== '=') return segment.slice(i);
    j += 1;
    while (j < segment.length && !isSpace(segment[j])) {
      if (segment[j] === '"' || segment[j] === "'") {
        const close = segment.indexOf(segment[j], j + 1);
        if (close === -1) return '';
        j = close + 1;
      } else j += 1;
    }
    i = j;
  }
}

function isGitSegment(segment) {
  const command = afterAssignments(segment).trim();
  return command === 'git' || (command.startsWith('git') && /\s/.test(command[3]));
}

function isGitDenial(denial) {
  if (!denial || typeof denial !== 'object' || denial.tool_name !== 'Bash') return false;
  const command = denial.tool_input && denial.tool_input.command;
  if (typeof command !== 'string') return false;
  let start = 0;
  for (let i = 0; i <= command.length; i += 1) {
    if (i === command.length || SEGMENT_SEPARATORS.has(command[i])) {
      if (isGitSegment(command.slice(start, i))) return true;
      start = i + 1;
    }
  }
  return false;
}

// envelope -> null (a reply) | one of the envelope reasons. See the header for `auth`.
function classifyFailure(envelope) {
  if (!envelope || typeof envelope !== 'object') return 'launch';
  if (envelope.status === 'timeout') return 'timeout';
  if (envelope.status !== 'ok') return typeof envelope.detail === 'string' && AUTH_FAILURE.test(envelope.detail) ? 'auth' : 'launch';
  if (Array.isArray(envelope.denials) && envelope.denials.some(isGitDenial)) return 'denied';
  const text = envelope.result && envelope.result.text;
  if (typeof text !== 'string' || text.trim() === '') return 'blank';
  return null;
}

const NO_USAGE = 'no usage in the worker envelope';
const num = (v) => Number(v) || 0;

// envelope usage -> the dispatch `tokens` shape, or null when the envelope carried none.
function tokensOf(usage) {
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return null;
  return { input: num(usage.input_tokens), output: num(usage.output_tokens), cacheRead: num(usage.cache_read_input_tokens), cacheCreate: num(usage.cache_creation_input_tokens) };
}

// The worker's own transcript -> `{ firstTurnTokens, tokens }`: its first assistant turn's
// context tokens and the sum of its assistant rows' usage (readUsage zeroes a turn's repeat
// rows, so the sum counts each turn once), or null when the transcript cannot be found or
// read (best effort: the envelope totals stand without it).
async function transcriptUsageOf({ cwd, sessionId, env, locate, readRows }) {
  if (typeof sessionId !== 'string') return null;
  // The worker's config dir, from the env it ran with (never this process's): CLAUDE_CONFIG_DIR, else HOME/USERPROFILE + .claude.
  const home = env && (env.HOME || env.USERPROFILE);
  const configDir = env && env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : (home ? path.join(home, '.claude') : null);
  if (configDir === null) return null;
  try {
    // Claude Code names the transcript directory after the canonical cwd (probe note in the header).
    const found = locate({ cwd: canonicalRealpath(cwd) || cwd, sessionId, configDir });
    if (!Array.isArray(found) || found.length === 0) return null;
    const rows = await readRows(found[0].path);
    const assistant = rows.filter((r) => r.role === 'assistant');
    const first = assistant.find((r) => r.turnStart);
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
    for (const r of assistant) {
      tokens.input += num(r.inputTokens);
      tokens.output += num(r.outputTokens);
      tokens.cacheRead += num(r.cacheRead);
      tokens.cacheCreate += num(r.cacheCreate);
    }
    return { firstTurnTokens: first ? first.contextTokens : null, tokens };
  } catch {
    return null;
  }
}

// One side's log line, appended under the lock (see the header). `appendFile` is a seam so a
// test can act between the lock's acquisition and the write.
function appendWorkerRecord(runDir, record, { env = process.env, appendFile = fs.appendFileSync } = {}) {
  const file = path.join(runDir, WORKER_DISPATCHES_FILE);
  return withLock(file + '.lock', () => appendFile(file, JSON.stringify(record) + '\n'), { failClosed: true, env, createParent: false });
}

function errorText(err) {
  return err && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err);
}

async function runLensWorkers(input, deps = {}) {
  const {
    lenses, runDir, cwd, bundleText, readPaths, attrSource, settingsDir,
    platform = process.platform, policy, env = process.env, now = Date.now,
  } = input;
  // No default runner: a missing one is a caller bug, refused once rather than as a launch failure per side.
  if (typeof deps.runner !== 'function') throw new TypeError('deps.runner is required');
  const launch = deps.launchWorker || launchWorker;
  const resolveLaunch = deps.roleLaunch || roleLaunch;
  const append = deps.appendRecord || ((dir, record) => appendWorkerRecord(dir, record, { env }));
  const aborted = deps.aborted || (() => false);
  const locate = deps.locateTranscripts || locateTranscripts;
  const readRows = deps.readUsage || readUsage;
  const active = deps.active || new Set();
  const iso = (ms) => new Date(ms).toISOString();

  const slots = lenses.flatMap((l) => (l.reviewers === 2 ? ['A', 'B'] : ['A']).map((side) => ({ lens: l.lens, brief: l.brief, model: l.model, side })));
  const outcomes = new Array(slots.length);
  const failures = [];
  const records = [];
  const logFailures = [];

  const settle = (i, { text, reason, detail = null, launched, startMs, endMs, envelope = null, transcript = null }) => {
    const slot = slots[i];
    const failed = reason !== null;
    outcomes[i] = { lens: slot.lens, side: slot.side, text: failed ? null : text, failed };
    if (failed) failures.push({ i, lens: slot.lens, side: slot.side, reason, detail });
    const record = {
      kind: 'worker', launched, lens: slot.lens, side: slot.side, description: `lens ${slot.lens} ${slot.side}`,
      agentType: ROLE, metaModel: slot.model, startTs: iso(startMs), endTs: iso(endMs), wallClockMs: endMs - startMs, failed, reason,
    };
    if (launched) {
      const sessionId = envelope && typeof envelope.sessionId === 'string' ? envelope.sessionId : null;
      // The envelope's usage is the total; with none (a timeout, a launch failure) the
      // worker's transcript, when one exists, is summed instead.
      const tokens = tokensOf(envelope && envelope.usage) || (transcript && transcript.tokens);
      Object.assign(record, {
        agentId: sessionId || `lens-${slot.lens}-${slot.side}-${startMs}`, transcriptModel: null, parentAgentId: null, spawnDepth: null,
        tokens, firstTurnTokens: transcript ? transcript.firstTurnTokens : null, costUsd: envelope && typeof envelope.costUsd === 'number' ? envelope.costUsd : null,
        notFound: tokens === null ? NO_USAGE : null, workflowRunId: null, workflowPhase: null,
      });
    }
    records.push(record);
    try {
      append(runDir, record);
    } catch (err) {
      logFailures.push({ lens: slot.lens, side: slot.side, reason: errorText(err) });
    }
  };
  const failUnlaunched = (i, reason) => {
    const t = now();
    settle(i, { text: null, reason, launched: false, startMs: t, endMs: t });
  };

  const pending = [];
  slots.forEach((slot, i) => {
    if (EXCLUDED_LENSES.includes(slot.lens)) failUnlaunched(i, 'excluded');
    else pending.push(i);
  });

  let blocker = null;
  if (pending.length > 0) {
    if (!SANDBOX_PROBED_PLATFORMS.includes(platform)) blocker = 'platform';
    else {
      const honours = typeof input.gitHonoursAttrSource === 'boolean'
        ? input.gitHonoursAttrSource
        : (deps.gitHonoursAttrSource || gitHonoursAttrSource)({ cwd, env });
      if (honours !== true) blocker = 'platform';
    }
  }
  let effort;
  if (blocker === null && pending.length > 0) {
    try {
      effort = resolveLaunch(ROLE, policy).effort;
    } catch {
      blocker = 'launch';
    }
  }
  if (blocker !== null) {
    for (const i of pending) failUnlaunched(i, blocker);
    pending.length = 0;
  }

  const claudeMdText = lensAdmittedFormsNote();
  const runSide = async (i) => {
    const slot = slots[i];
    let launched = false;
    let handle = null;
    const runner = (call) => {
      const h = deps.runner(call);
      if (!launched) {
        launched = true;
        handle = h;
        active.add(h);
      }
      return h;
    };
    const startMs = now();
    let reason;
    let text = null;
    let detail = null;
    let envelope = null;
    try {
      envelope = await launch({
        role: ROLE, cwd, prompt: composeLensPrompt(bundleText, slot.brief), claudeMdText, model: slot.model, effort,
        readPaths, attrSource, schema: LENS_REPLY_SCHEMA, ceilings: { wallClockMs: LENS_WORKER_TIMEOUT_MS },
        settingsDir, platform, env,
      }, { runner, ...(deps.timers ? { timers: deps.timers } : {}) });
      reason = classifyFailure(envelope);
      if (reason === null) text = envelope.result.text;
      else if (envelope && typeof envelope.detail === 'string') detail = envelope.detail;
    } catch (err) {
      reason = 'launch';
      detail = errorText(err);
    } finally {
      if (handle !== null) active.delete(handle);
    }
    const endMs = now();
    const transcript = launched ? await transcriptUsageOf({ cwd, sessionId: envelope && envelope.sessionId, env, locate, readRows }) : null;
    settle(i, { text, reason, detail, launched, startMs, endMs, envelope, transcript });
  };

  let next = 0;
  const lane = async () => {
    while (next < pending.length && !aborted()) {
      const i = pending[next];
      next += 1;
      await runSide(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LENS_WORKER_CONCURRENCY, pending.length) }, lane));

  // A side an abort kept from starting is failed; Array.from visits the holes `map` would skip.
  const reviewers = Array.from(outcomes, (o, i) => o || { lens: slots[i].lens, side: slots[i].side, text: null, failed: true });
  return {
    reply: { started: true, lenses: lenses.map((l) => ({ lens: l.lens, reviewers: l.reviewers })), reviewers },
    failures: failures.sort((a, b) => a.i - b.i).map(({ lens, side, reason, detail }) => ({ lens, side, reason, detail })),
    records,
    logFailures,
  };
}

module.exports = {
  LENS_WORKER_CONCURRENCY, LENS_WORKER_TIMEOUT_MS, EXCLUDED_LENSES, FAILURE_REASONS, WORKER_DISPATCHES_FILE,
  inputRefusal, composeLensPrompt, classifyFailure, appendWorkerRecord, runLensWorkers,
};
