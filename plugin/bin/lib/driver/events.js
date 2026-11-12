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
//     issue, mention a user, open a code fence or break a line in a commit, PR body or event.

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

function neutralize(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/`/g, "'")
    .replace(/@/g, '@​')
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

function createEventSink({ stdout, appendFile }) {
  const emitted = [];
  let held = [];
  let eventsFile = null;

  function emit(event) {
    const line = JSON.stringify(event) + '\n';
    emitted.push(event);
    stdout(line);
    if (eventsFile === null) held.push(line);
    else appendFile(eventsFile, line);
  }

  function bindRunDir(runDir) {
    eventsFile = path.join(runDir, 'driver-events.jsonl');
    const pending = held;
    held = [];
    for (const line of pending) appendFile(eventsFile, line);
  }

  return { emit, bindRunDir, events: () => emitted.slice() };
}

module.exports = {
  STEP_NAMES, FINAL_STEP, STEP, OUTCOMES, STOP_CLASSES,
  outcomeFor, neutralize, normalizeTitle, createEventSink,
};
