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
// Read-only apart from the one appendEvent. Offline-safe (no network, no git).
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

function run(ctx) {
  const name = parseTypedSkill(ctx.input && ctx.input.prompt);
  if (!name || !skillExists(name)) return {};
  const ownedRun = ctx.ownedRun || {};
  if (!ownedRun.dir) return {}; // no run, or every run foreign-owned — drop, by design
  ctxLib.appendEvent(ownedRun.dir, 'skill_invoked', { skill: `claude-tweaks:${name}`, source: 'user' }, ownedRun.attribution);
  return {};
}

module.exports = { run, TYPED_SKILL_RE, parseTypedSkill, skillExists };
