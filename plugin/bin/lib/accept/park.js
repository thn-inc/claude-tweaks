// bin/lib/accept/park.js
// Pure: the local-acceptance park (#4615). decideAcceptanceRoute / decideSeries say whether a
// record's acceptance check parks for a human at the local worktree (never consulted with
// control mode off); writeParkDeployStatus / parkStateOf write and read the park's three fields
// in the acceptance packet's Deploy status section; isParkedForLocalAcceptance is the one
// predicate over a record's labels plus its packet, failing to 'unknown' when the packet is
// unreadable. The pending label is read through acceptanceOf, never named here. No I/O.
'use strict';

const { resolveAcceptanceTarget } = require('./target');
const { acceptanceOf, normalizeLabelNames } = require('../issues/record-vocabulary');
const { DEPLOY, joinLines, sectionRange, splitLines } = require('../issues/accept-entry');

const PARK_REASON = 'awaiting-local-acceptance';

const HEAD_SHA_RE = /^[0-9a-f]{7,64}$/;
const TARGET_LINE_RE = /^target:[ \t]*(\S+)$/;
const REASON_LINE_RE = /^reason:[ \t]*(\S+)$/;
const HEAD_LINE_RE = /^park-head:[ \t]*(\S+)$/;
// The write replaces any `target:` line, a renderer's `target: dev, confirmed live` included.
const ANY_TARGET_LINE_RE = /^target:/;
const PARK_LINE_RES = [ANY_TARGET_LINE_RE, REASON_LINE_RE, HEAD_LINE_RE];

// Control mode is on only for the boolean true: any other value never consults the resolver.
function decideAcceptanceRoute({ controlMode, keptRiskFlags, itemOverride, policyDefault } = {}) {
  if (controlMode !== true) return { consulted: false, park: false, target: null, reason: null };
  const { target, reason } = resolveAcceptanceTarget({ keptRiskFlags, itemOverride, policyDefault });
  return { consulted: true, park: target === 'local', target, reason };
}

// Each record is decided on its own; the series shares one PR, so any park parks the series.
function decideSeries(records) {
  if (!Array.isArray(records)) throw new TypeError('decideSeries: records must be an array');
  const decisions = records.map(({ record, input }) => ({ record, ...decideAcceptanceRoute(input ?? undefined) }));
  return { park: decisions.some((decision) => decision.park), decisions };
}

const firstMatch = (texts, re) => {
  for (const text of texts) {
    const match = re.exec(text);
    if (match) return match[1];
  }
  return null;
};

function parkStateOf(packetBody) {
  const none = { parked: false, target: null, reason: null, headSha: null };
  if (typeof packetBody !== 'string') return none;
  const lines = splitLines(packetBody);
  const range = sectionRange(lines, DEPLOY);
  if (range === null) return none;
  const texts = lines.slice(range.start, range.end).map(({ text }) => text.trim());
  const target = firstMatch(texts, TARGET_LINE_RE);
  const reason = firstMatch(texts, REASON_LINE_RE);
  return { parked: target === 'local' && reason === PARK_REASON, target, reason, headSha: firstMatch(texts, HEAD_LINE_RE) };
}

// Inside the Deploy status section only: exactly one 'target: local', `reason:` and `park-head:`
// line, written where the first target line stood (at the section's start when it had none).
// Every other line, `ref:` included, stays.
function writeParkDeployStatus(packetBody, { headSha } = {}) {
  if (typeof headSha !== 'string' || !HEAD_SHA_RE.test(headSha)) throw new TypeError(`park: headSha must be 7-64 lowercase hex: ${headSha}`);
  if (typeof packetBody !== 'string') throw new TypeError('park: packet body must be a string');
  const lines = splitLines(packetBody);
  const range = sectionRange(lines, DEPLOY);
  if (range === null) throw new TypeError('park: packet has no Deploy status section');
  const eol = lines[range.start - 1].eol;
  const isParkLine = ({ text }) => PARK_LINE_RES.some((re) => re.test(text.trim()));
  const firstTarget = lines.findIndex((line, index) => index >= range.start && index < range.end && ANY_TARGET_LINE_RE.test(line.text.trim()));
  const at = firstTarget === -1 ? range.start : firstTarget;
  const fresh = ['target: local', `reason: ${PARK_REASON}`, `park-head: ${headSha}`].map((text) => ({ text, eol }));
  const out = [];
  lines.forEach((line, index) => {
    if (index === at) out.push(...fresh);
    if (index >= range.start && index < range.end && isParkLine(line)) return;
    out.push(line);
  });
  if (at >= lines.length) out.push(...fresh);
  const body = joinLines(out);
  return { body, changed: body !== packetBody };
}

function isParkedForLocalAcceptance({ labels, packet } = {}) {
  const status = packet?.status;
  if (status !== 'found' && status !== 'none') return 'unknown';
  if (acceptanceOf(normalizeLabelNames(labels)) !== 'pending') return 'not-parked';
  const state = parkStateOf(packet.body);
  return state.target === 'local' && state.reason === PARK_REASON ? 'parked' : 'not-parked';
}

module.exports = { PARK_REASON, decideAcceptanceRoute, decideSeries, writeParkDeployStatus, parkStateOf, isParkedForLocalAcceptance };
