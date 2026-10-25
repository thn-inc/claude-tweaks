// plugin/bin/lib/console/reflect-destination.js — the destination line a /reflect observation or
// convention finding carries, parsed once for every consumer (#4168): the Review Console's
// classifier (resolve.js) decides from the same parse the applier acts on, so the two cannot
// disagree about what a finding file asks for. Pure: no read, no write. It must not require
// ./resolve — resolve.js requires this module.
//
// Grammar:
//   **Destination:** edit {repo-relative .md path}   — a CLAUDE.md, a path under a `skills`
//                                                      or `rules` directory; no `..`, no absolute
//                                                      path, no backslash
//   **Destination:** record                          — needs a `## Record proposal` section:
//                                                      a `Key: value` header block (Title, Type,
//                                                      Labels, Defer-reason), a blank line, then
//                                                      the record body
//   **Destination:** decline {reason}                — the reason is the rest of the line
// No destination line is the legacy shape (`none`); two lines, or a value outside the grammar,
// is `invalid` with a `why`.
'use strict';

const { DEFER_REASONS } = require('../issues/record');
const { digestTextOf } = require('./staged-digest-text');

const DESTINATION_VERBS = Object.freeze(['edit', 'record', 'decline']);
const RECORD_PROPOSAL_HEADING = '## Record proposal';
const APPLICABLE_CATEGORIES = Object.freeze(['observation', 'convention']);
// The digest Defer-reason token a legacy reflect finding (no destination line) is disposed under.
const REFLECT_NO_DESTINATION = 'reflect-no-destination';

const RECORD_TYPES = ['bug', 'feature', 'task'];

// The `**Category:**` token a staged finding file carries — what the /reflect convention writes on
// a staged finding. `null` when the text carries no such line — including every caller that passes
// no text at all (unknown by design; never routed off it).
function parseCategory(text) {
  if (!text) return null;
  const m = /^\*\*Category:\*\*\s*(\S+)/m.exec(text);
  return m ? m[1] : null;
}

// A reflect finding file whose category is one the console consumer applies (observation or convention).
function isApplicableReflect(name, text) {
  if (!String(name).startsWith('reflect-')) return false;
  const category = parseCategory(text);
  return category !== null && APPLICABLE_CATEGORIES.includes(category.toLowerCase());
}

function validEditTarget(target) {
  if (target.startsWith('/') || /^[A-Za-z]:/.test(target) || target.includes('\\')) return false;
  const segments = target.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s === '.git' || s === 'node_modules')) return false;
  if (!target.endsWith('.md')) return false;
  return segments[segments.length - 1] === 'CLAUDE.md' || segments.includes('skills') || segments.includes('rules');
}

function parseRecordProposal(text) {
  const lines = text.split('\n');
  const heading = lines.findIndex((l) => l.replace(/\r$/, '') === RECORD_PROPOSAL_HEADING);
  if (heading < 0) return null;
  let i = heading + 1;
  while (i < lines.length && lines[i].trim() === '') i++;
  const header = {};
  for (; i < lines.length && lines[i].trim() !== ''; i++) {
    const m = /^([A-Za-z][A-Za-z-]*):[ \t]*(.*?)[ \t\r]*$/.exec(lines[i]);
    if (m && !Object.hasOwn(header, m[1].toLowerCase())) header[m[1].toLowerCase()] = m[2];
  }
  const body = lines.slice(i + 1).join('\n');
  const title = header.title || '';
  if (title === '' || !RECORD_TYPES.includes(header.type) || body.trim() === '') return null;
  const rawLabels = header.labels === undefined ? '' : header.labels;
  const labels = rawLabels === 'none' ? [] : rawLabels.split(',').map((s) => s.trim()).filter(Boolean);
  const deferReason = header['defer-reason'] === undefined ? null : header['defer-reason'];
  return { title, type: header.type, labels, deferReason, body };
}

// The destination a finding file names: { kind: 'none' } | { kind: 'edit', target } |
// { kind: 'decline', reason } | { kind: 'record', proposal } | { kind: 'invalid', why }.
function parseReflectDestination(text) {
  const values = [...String(text).matchAll(/^\*\*Destination:\*\*[ \t]*(.*?)[ \t]*$/gm)].map((m) => m[1]);
  if (values.length === 0) return { kind: 'none' };
  if (values.length > 1) return { kind: 'invalid', why: 'multiple-destination-lines' };
  const value = values[0];

  const edit = /^edit[ \t]+(\S+)$/.exec(value);
  if (edit) return validEditTarget(edit[1]) ? { kind: 'edit', target: edit[1] } : { kind: 'invalid', why: 'edit-target' };

  if (value === 'record') {
    const proposal = parseRecordProposal(String(text));
    return proposal ? { kind: 'record', proposal } : { kind: 'invalid', why: 'record-proposal' };
  }

  const decline = /^decline[ \t]+(.+)$/.exec(value);
  if (decline) return { kind: 'decline', reason: decline[1].trim() };
  if (value === 'decline') return { kind: 'invalid', why: 'decline-reason' };

  return { kind: 'invalid', why: 'unknown-destination' };
}

// null when the proposal's Defer-reason is one the record gate accepts, else the offending value ('absent' when none).
function deferReasonProblem(proposal) {
  const reason = proposal.deferReason;
  if (reason === null || reason === undefined || reason === '') return 'absent';
  return DEFER_REASONS.includes(reason) ? null : reason;
}

// The finding's own `## Finding` text as one line — the description a record or a decline write
// cites. Falls back to the digest text when the section is absent or empty.
function findingDescription(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Finding\s*$/i.test(l));
  if (start >= 0) {
    const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    const section = lines.slice(start + 1, next < 0 ? lines.length : next).join(' ').replace(/\s+/g, ' ').trim();
    if (section) return section;
  }
  return digestTextOf(text);
}

module.exports = {
  DESTINATION_VERBS, RECORD_PROPOSAL_HEADING, APPLICABLE_CATEGORIES, REFLECT_NO_DESTINATION,
  parseCategory, isApplicableReflect, parseReflectDestination, deferReasonProblem, findingDescription,
};
