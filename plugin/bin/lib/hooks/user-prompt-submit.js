// bin/lib/hooks/user-prompt-submit.js — typed-slash-command ledger (log tier).
// Records a human-typed `/claude-tweaks:<skill>` first line as a
// `skill_invoked` typed event with `source: "user"` in the session's owned
// run's events.jsonl. Same meaning as skill-invocation.js's event: "the
// procedure was entered" — UserPromptSubmit fires when the prompt is
// submitted, BEFORE the skill's instructions execute; no completion semantics
// are implied.
//
// Why a second writer: skill-invocation.js (PostToolUse) sees only
// MODEL-initiated Skill tool calls — a typed slash command runs by direct
// content expansion with no Skill tool call at all (see its header (e)).
// Probe result (verified fact): the UserPromptSubmit payload's `prompt` is the
// RAW typed line — the slash command is expanded only AFTER this hook runs —
// so `/claude-tweaks:help` arrives here literally, not as skill content.
//
// Event shape: identical to the Skill-tool hook's, plus `source: "user"`. The
// existing writer is unchanged and never writes `source`, so ABSENCE of
// `source` on a `skill_invoked` line means model-initiated; no
// `source: "model"` value is ever written.
//
// Recording rules (a missed event is cheaper than a false one):
//   - only the namespaced form `/claude-tweaks:<skill>` — a bare `/<skill>`
//     collides with built-ins and other plugins and writes nothing;
//   - the FIRST line decides, from column 0 (leading whitespace disqualifies);
//     arguments and later lines are ignored; a trailing `\r` is tolerated;
//   - the name must be a shipped skill (`skills/<name>/SKILL.md`, resolved from
//     this module's own location) — a typo is not an invocation.
//
// A second, independent writer (#5584): recordTypedDispatch records the record
// numbers a `/claude-tweaks:dispatch #N[,#M]` or `… resume #N` first line names,
// with the payload's `prompt_id`, in the session's pointer file
// (bin/lib/issues/typed-command.js `writePointer`). It runs first, inside its
// own try/catch, before and apart from the `skill_invoked` writer and the
// ownedRun check, so a project with no run still writes. The pointer is a
// pointer, not a proof: this hook cannot tell who sent a prompt, so a
// scheduled or delivered line writes it too; authority comes only from the
// transcript row the prompt id names. The hook runs on every prompt, so the
// parser and writer modules load lazily, only for a first line that starts
// with `/claude-tweaks:dispatch` followed by a space or its end.
//
// Writes nothing apart from the one appendEvent and that pointer file.
// Offline-safe (no network, no git).
// NEVER writes stdout — any stdout would annotate or block the prompt — and
// never sets `json` or `exit`, so the dispatcher always exits 0.
'use strict';
const fs = require('fs');
const path = require('path');
const ctxLib = require('./context');

// Name charset excludes `/`, `.` and `:`, so a captured name can never escape
// the skills directory (`../help` fails to match at all).
const TYPED_SKILL_RE = /^\/claude-tweaks:([a-z0-9][a-z0-9-]*)(?=\s|$)/;

function parseTypedSkill(prompt) {
  if (typeof prompt !== 'string') return null;
  const firstLine = prompt.split('\n', 1)[0].replace(/\r$/, '');
  const m = TYPED_SKILL_RE.exec(firstLine);
  return m ? m[1] : null;
}

function skillExists(name, { skillsDir = path.resolve(__dirname, '..', '..', '..', 'skills') } = {}) {
  try {
    return fs.statSync(path.join(skillsDir, name, 'SKILL.md')).isFile();
  } catch {
    return false;
  }
}

const DISPATCH_COMMAND = '/claude-tweaks:dispatch';

// input -> true when the pointer was written. The cheap gate runs before any
// require; writePointer validates the session and prompt ids itself. The temp
// directory is `tmpdir`, else the one `env` names (#5377: `run` passes the
// context's env), which is os.tmpdir() for a real hook process and without `env`.
function recordTypedDispatch(input, { now = new Date(), tmpdir, env } = {}) {
  if (!input || typeof input.prompt !== 'string') return false;
  const firstLine = input.prompt.split('\n', 1)[0].replace(/\r$/, '');
  if (firstLine !== DISPATCH_COMMAND && !firstLine.startsWith(`${DISPATCH_COMMAND} `)) return false;
  const numbers = require('../issues/build-authority').parseTypedDispatch(firstLine);
  if (!numbers) return false;
  return require('../issues/typed-command').writePointer({
    sessionId: input.session_id, promptId: input.prompt_id, numbers, now,
    tmpdir: tmpdir || require('../session-tmp').envTmpdir(env),
  });
}

function run(ctx) {
  ctxLib.requireEnv(ctx);
  try { recordTypedDispatch(ctx.input, { env: ctx.env }); } catch { /* never breaks a session */ }
  const name = parseTypedSkill(ctx.input && ctx.input.prompt);
  if (!name || !skillExists(name)) return {};
  const ownedRun = ctx.ownedRun || {};
  if (!ownedRun.dir) return {}; // no run, or every run foreign-owned — drop, by design
  ctxLib.appendEvent(ownedRun.dir, 'skill_invoked', { skill: `claude-tweaks:${name}`, source: 'user' }, ownedRun.attribution);
  return {};
}

module.exports = { run, TYPED_SKILL_RE, parseTypedSkill, skillExists, recordTypedDispatch };
