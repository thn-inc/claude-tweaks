// bin/lib/issues/build-authority.js
// The one rule for build authority (#5584): may this record be built, on its
// `auto:build` label or on a `/claude-tweaks:dispatch` command a person typed
// that named it? Pure: the environment, the terminal test and the transcript
// check's answer are all passed in; nothing here reads a file or writes a label.
//
// Three callers, none of which restates the rule: the queue pull's named path
// (bin/lib/dispatch/queue-pull.js `--named`), resume (dispatch-resume.js) and
// the driver's admission step (drive.js). A new caller calls
// resolveBuildAuthority and never reads the pointer or the transcript itself.
//
// resolveBuildAuthority({ number, labels, named, env, typedCommand, stdinIsTTY })
// -> { authority: 'label' | 'typed' | 'none', reasons: string[] }. The first row
// that matches is the answer:
//
//   | State                                                         | Answer                         |
//   |---------------------------------------------------------------|--------------------------------|
//   | `labels` is not an array                                      | none (labels-unreadable)       |
//   | labels carry `auto:build`                                     | label; nothing else is read    |
//   | the command did not name the record (`named !== true`)        | none (not-named)               |
//   | named, labels lack `ready`                                    | none (not-ready)               |
//   | named, labels carry `bot:blocked`, `bot:parked` or `parked`   | none (held)                    |
//   | named, ready, inside a session, every session condition holds | typed                          |
//   | named, ready, outside a session, every terminal condition     | typed                          |
//   | anything else                                                 | none, each failed condition    |
//
// Inside a session: `CLAUDECODE` or `CLAUDE_CODE_SESSION_ID` is set (any value
// but unset or empty, the same set-test the conditions use, so an odd value
// takes the stricter session path). Session conditions, each failure named:
//   1. CLAUDE_CODE_ENTRYPOINT is exactly `cli`               (entrypoint)
//   2. CLAUDE_CODE_SESSION_ATTENDED is exactly `1`           (not-attended)
//   3. CLAUDE_CODE_REMOTE unset or empty                     (remote)
//      CC_HUB_RUN unset or empty                             (hub-run)
//   4. when CC_POSTURE or CC_LAUNCHED_BY is set, CC_LAUNCHED_BY
//      is exactly `user`                                     (launcher)
//   5. the transcript check (`typedCommand`) answers typed   (its own reason
//      word, else not-typed) — asked only when 1-4 all hold, at most once.
// Terminal conditions (no session, so no transcript is read): stdin is a
// terminal (not-a-terminal), CI unset or empty (ci), conditions 3 and 4. A
// terminal on stdin is the only sign of a person left when there is no session
// to read a transcript from, and only drive.js is run this way: the queue pull
// and resume pass stdinIsTTY false, so outside a session they answer none.
// Conditions 3 and 4 still apply: a hub's or a launcher's run is not a person's.
//
// Every comparison is exact string equality: an unset, empty, other-case,
// trailing-space or trailing-newline value fails its condition. A value no
// probe listed reads as `none`, so a changed value takes the typed path away
// and never widens it.
'use strict';

const REASONS = Object.freeze([
  'not-named', 'not-ready', 'held', 'labels-unreadable', 'entrypoint', 'not-attended', 'remote',
  'hub-run', 'launcher', 'no-session-id', 'no-pointer', 'pointer-unreadable', 'pointer-other-session',
  'expired', 'no-transcript', 'transcript-unreadable', 'no-prompt-row', 'not-typed', 'other-command',
  'not-a-terminal', 'ci',
]);

// `#N` in a remedy is replaced with the record number by formatAuthorityLine.
const GRANT_REMEDY = 'grant it with /claude-tweaks:backlog refine #N';
const RETYPE_REMEDY = `${GRANT_REMEDY}, or type the command again`;
const REMEDIES = Object.freeze(Object.fromEntries(REASONS.map((word) => {
  if (word === 'not-ready') return [word, 'run /claude-tweaks:specify #N'];
  if (word === 'launcher') return [word, 'the launcher must export CC_LAUNCHED_BY=user (thn-inc/claude-user-config#50)'];
  if (word === 'expired' || word === 'no-pointer') return [word, RETYPE_REMEDY];
  if (word === 'held') return [word, 'clear bot:blocked, bot:parked or parked on #N once its trigger has fired, then type the command again'];
  if (word === 'labels-unreadable') return [word, "re-run once the record's labels can be read"];
  return [word, GRANT_REMEDY];
})));

const PREFIX = '/claude-tweaks:dispatch ';
const LIST_CHARS_RE = /^[ #0-9,]+$/;
const ELEMENT_RE = /^#?[1-9][0-9]*$/;
const RESUME_RE = /^resume +#?([1-9][0-9]*)$/;

function positiveSafe(digits) {
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// firstLine -> number[] | null. The whole grammar of a typed dispatch line
// that names records: `/claude-tweaks:dispatch` at column 0, one space, then a
// record list (`#N`, `#N,#M,…`, `#` optional) or `resume #N`. Trailing spaces
// and one trailing `\r` are ignored. Every other form (`next`, `--budget`,
// `close-out`, `--settle-parked`, a trailing token, an empty rest) is null, so
// it records nothing and the label stays required. The list is read with
// parseExplicitIssueList, the dispatch skill's own list parser; each element
// must also be a plain positive decimal, which refuses the forms that parser's
// Number() reads leniently (`0x0c`, `1e1`, `12.0`, `# 12`).
function parseTypedDispatch(firstLine) {
  if (typeof firstLine !== 'string') return null;
  let end = firstLine.length;
  while (end > 0 && firstLine.charCodeAt(end - 1) === 32) end -= 1;
  if (end > 0 && firstLine.charCodeAt(end - 1) === 13) end -= 1;
  while (end > 0 && firstLine.charCodeAt(end - 1) === 32) end -= 1;
  const line = firstLine.slice(0, end);
  if (!line.startsWith(PREFIX)) return null;
  let start = PREFIX.length;
  while (start < line.length && line.charCodeAt(start) === 32) start += 1;
  const rest = line.slice(start);
  if (rest === '') return null;

  const resume = RESUME_RE.exec(rest);
  if (resume) {
    const n = positiveSafe(resume[1]);
    return n === null ? null : [n];
  }
  if (!LIST_CHARS_RE.test(rest)) return null;
  const { parseExplicitIssueList } = require('./grouping');
  const { numbers, invalid } = parseExplicitIssueList(rest);
  if (invalid.length !== 0 || numbers.length === 0) return null;
  for (const el of rest.split(',')) {
    const t = el.trim();
    if (!ELEMENT_RE.test(t) || positiveSafe(t.replace(/^#/, '')) === null) return null;
  }
  return numbers;
}

function isSet(v) {
  return v !== undefined && v !== '';
}

function launcherFails(env) {
  if (!isSet(env.CC_POSTURE) && !isSet(env.CC_LAUNCHED_BY)) return false;
  return env.CC_LAUNCHED_BY !== 'user';
}

// The transcript check's answer: `typed` only when it is an object whose
// `answer` is exactly 'typed'; any other answer is none, with its `reason` when
// that is a known reason word, else not-typed. A thunk that throws answers none
// with transcript-unreadable, so one record's failed read cannot abort a
// caller's drain and is never read as an acceptance.
function readTypedAnswer(typedCommand) {
  let ans;
  try {
    ans = typeof typedCommand === 'function' ? typedCommand() : typedCommand;
  } catch {
    return { authority: 'none', reasons: ['transcript-unreadable'] };
  }
  if (ans !== null && typeof ans === 'object' && ans.answer === 'typed') return { authority: 'typed', reasons: [] };
  const reason = ans !== null && typeof ans === 'object' && REASONS.includes(ans.reason) ? ans.reason : 'not-typed';
  return { authority: 'none', reasons: [reason] };
}

function resolveBuildAuthority({ labels, named, env, typedCommand, stdinIsTTY } = {}) {
  if (!Array.isArray(labels)) return { authority: 'none', reasons: ['labels-unreadable'] };
  const { normalizeLabelNames, parseRecordFacets, LABELS } = require('./record');
  const facets = parseRecordFacets(labels);
  if (facets.grants.build) return { authority: 'label', reasons: [] };
  if (named !== true) return { authority: 'none', reasons: ['not-named'] };
  const names = normalizeLabelNames(labels);
  if (!names.includes(LABELS.READY)) return { authority: 'none', reasons: ['not-ready'] };
  if (facets.bot.blocked || facets.bot.parked || names.includes(LABELS.PARKED)) {
    return { authority: 'none', reasons: ['held'] };
  }

  const e = env !== null && typeof env === 'object' ? env : {};
  const inSession = isSet(e.CLAUDECODE) || isSet(e.CLAUDE_CODE_SESSION_ID);
  const failed = [];
  if (inSession) {
    if (e.CLAUDE_CODE_ENTRYPOINT !== 'cli') failed.push('entrypoint');
    if (e.CLAUDE_CODE_SESSION_ATTENDED !== '1') failed.push('not-attended');
  } else {
    if (stdinIsTTY !== true) failed.push('not-a-terminal');
    if (isSet(e.CI)) failed.push('ci');
  }
  if (isSet(e.CLAUDE_CODE_REMOTE)) failed.push('remote');
  if (isSet(e.CC_HUB_RUN)) failed.push('hub-run');
  if (launcherFails(e)) failed.push('launcher');
  if (failed.length > 0) return { authority: 'none', reasons: failed };
  return inSession ? readTypedAnswer(typedCommand) : { authority: 'typed', reasons: [] };
}

// The remedy for a refusal's first reason word, `#N` replaced with the record number. With no word, or
// one the table does not list, `fallback` (already naming the record) is the remedy: the queue pull
// falls back to the grant, resume to a re-grant, which is why the fallback is the caller's.
function remedyFor(words, number, fallback) {
  const first = Array.isArray(words) ? words[0] : undefined;
  return Object.hasOwn(REMEDIES, first) ? REMEDIES[first].split('#N').join(`#${number}`) : fallback;
}

// The one line a caller prints for a named record without the label; null for
// a `label` answer, which prints nothing. A `none` answer with no reason words
// prints the fixed line with the grant remedy, never an empty `()`.
function formatAuthorityLine(number, { authority, reasons } = {}) {
  if (authority === 'label') return null;
  const head = `#${number} has no auto:build label — `;
  if (authority === 'typed') return `${head}built on the typed /claude-tweaks:dispatch command`;
  const words = Array.isArray(reasons) ? reasons : [];
  const remedy = remedyFor(words, number, GRANT_REMEDY.split('#N').join(`#${number}`));
  const named = words.length > 0 ? ` (${words.join(', ')})` : '';
  return `${head}not built: typed command not accepted${named}; ${remedy} (a typed command with any other argument records nothing)`;
}

module.exports = { REASONS, REMEDIES, parseTypedDispatch, resolveBuildAuthority, formatAuthorityLine, remedyFor };
