'use strict';
// Event vocabulary for the pipeline driver (drive.js, record #5218).
//
// The step-name list below IS the event vocabulary: event lines carry `step` drawn from it
// (plus FINAL_STEP for the closing line). Fields may be added to an event, never renamed.
//
// This module holds three things and no step logic:
//   - the step, outcome and stop-class constants,
//   - the event sink (stdout line + {run-dir}/driver-events.jsonl),
//   - the neutralizers for text the headless worker controls, so that text cannot close an
//     issue (or backlink one), mention a user, open a code fence or an HTML comment, or break a
//     line in a commit, PR body or event.

const path = require('node:path');

const STEP_NAMES = Object.freeze([
  'policy', 'fetch', 'eligibility', 'admission', 'claim', 'run-dir', 'worktree', 'worker',
  'commit', 'test', 'check', 'push', 'pr', 'record-pr', 'set-config', 'summary', 'ci',
]);
const FINAL_STEP = 'final';

const STEP = Object.freeze(Object.fromEntries(
  STEP_NAMES.map((name) => [name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), name]),
));

const OUTCOMES = Object.freeze({
  PENDING_REVIEW: 'pending-review',
  EXPRESS_ESCALATED: 'express-escalated',
  BLOCKED: 'blocked',
  REFUSED: 'refused',
});

const STOP_CLASSES = Object.freeze({
  REFUSED: 'refused',
  CLAIM: 'claim',
  PRE_PUSH: 'pre-push',
  BLOCKED: 'blocked',
  NONE: 'none',
});

const OUTCOME_BY_CLASS = Object.freeze({
  [STOP_CLASSES.REFUSED]: OUTCOMES.REFUSED,
  [STOP_CLASSES.CLAIM]: OUTCOMES.BLOCKED,
  [STOP_CLASSES.PRE_PUSH]: OUTCOMES.EXPRESS_ESCALATED,
  [STOP_CLASSES.BLOCKED]: OUTCOMES.BLOCKED,
  [STOP_CLASSES.NONE]: OUTCOMES.PENDING_REVIEW,
});

function outcomeFor(stopClass) {
  if (typeof stopClass !== 'string' || !Object.prototype.hasOwnProperty.call(OUTCOME_BY_CLASS, stopClass)) {
    throw new Error(`unknown stop class: ${String(stopClass)}`);
  }
  return OUTCOME_BY_CLASS[stopClass];
}

const CLOSING_KEYWORDS = /\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b/gi;
const QUALIFIED_REF = /[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+/g;
const BARE_REF = /#\d+/g;
// An issue or PR URL on any host, with any tail (`/files`, `#issuecomment-…`): it backlinks
// like `#N`. Removed before the keywords, which could otherwise cut a path segment out of it.
// The tail stops before trailing punctuation (`)`, `.`, `,` …), which belongs to the sentence.
const URL_REF = /\bhttps?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/(?:issues|pull)\/\d+(?:[/#?]\S*[^\s)\].,;:!?'">])?/gi;
const GH_REF = /\bGH-\d+\b/gi;
// An HTML comment opener hides the rest of a rendered body; `<\!--` renders as the text `<!--`.
const COMMENT_OPENER = /<!--/g;

function neutralize(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(URL_REF, '')
    .replace(GH_REF, '')
    .replace(COMMENT_OPENER, '<\\!--')
    .replace(/`/g, "'")
    .replace(/@/g, '@\u200B')
    .replace(CLOSING_KEYWORDS, '')
    .replace(QUALIFIED_REF, '')
    .replace(BARE_REF, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(raw) {
  if (typeof raw !== 'string') return '';
  const firstLine = raw.split(/\r\n|\r|\n/)[0];
  // A removed trailing reference can leave a stranded " ." behind, so drop the whole tail.
  return neutralize(firstLine).replace(/(?:\s*\.)+\s*$/, '').trim();
}

// Every line reaches stdout at once. The file side is a queue: lines are held until the
// run directory is bound, then appended in order, each removed only once its append
// succeeds. A failed append never throws to the caller: the line stays queued and is
// tried again at the next emit, so the file stays an in-order prefix of stdout. The
// first failure is kept for fileError(), which the caller reports on the final line.
function createEventSink({ stdout, appendFile }) {
  const emitted = [];
  const held = [];
  let eventsFile = null;
  let firstError = null;

  function flush() {
    while (held.length > 0) {
      try {
        appendFile(eventsFile, held[0]);
      } catch (err) {
        if (firstError === null) firstError = (err && err.message) || String(err);
        return;
      }
      held.shift();
    }
  }

  function emit(event) {
    const line = JSON.stringify(event) + '\n';
    emitted.push(event);
    stdout(line);
    held.push(line);
    if (eventsFile !== null) flush();
  }

  function bindRunDir(runDir) {
    eventsFile = path.join(runDir, 'driver-events.jsonl');
    flush();
  }

  return { emit, bindRunDir, events: () => emitted.slice(), fileError: () => firstError };
}

module.exports = {
  STEP_NAMES, FINAL_STEP, STEP, OUTCOMES, STOP_CLASSES,
  outcomeFor, neutralize, normalizeTitle, createEventSink,
};
