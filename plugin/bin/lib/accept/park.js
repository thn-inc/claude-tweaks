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
const { PARK_REASON, REASON_LINE_RE, HEAD_LINE_RE, parkFieldsOf } = require('./park-grammar');
const { DEPLOY, joinLines, sectionRange, splitLines } = require('../issues/accept-entry');

const HEAD_SHA_RE = /^[0-9a-f]{7,64}$/;
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

function parkStateOf(packetBody) {
  const none = { parked: false, target: null, reason: null, headSha: null };
  if (typeof packetBody !== 'string') return none;
  const lines = splitLines(packetBody);
  const range = sectionRange(lines, DEPLOY);
  if (range === null) return none;
  const texts = lines.slice(range.start, range.end).map(({ text }) => text.trim());
  return parkFieldsOf(texts);
}

// Inside the Deploy status section only: exactly one 'target: local', `reason:` and `park-head:`
// line, written as a group at the section's start. Every other line, `ref:` included, stays.
function writeParkDeployStatus(packetBody, { headSha } = {}) {
  if (typeof headSha !== 'string' || !HEAD_SHA_RE.test(headSha)) throw new TypeError(`park: headSha must be 7-64 lowercase hex: ${headSha}`);
  if (typeof packetBody !== 'string') throw new TypeError('park: packet body must be a string');
  const lines = splitLines(packetBody);
  const range = sectionRange(lines, DEPLOY);
  if (range === null) throw new TypeError('park: packet has no Deploy status section');
  const eol = lines[range.start - 1].eol;
  const isParkLine = ({ text }) => PARK_LINE_RES.some((re) => re.test(text.trim()));
  const inSection = (index) => index >= range.start && index < range.end;
  const fresh = ['target: local', `reason: ${PARK_REASON}`, `park-head: ${headSha}`].map((text) => ({ text, eol }));
  // The group leads the section, so the first TARGET_RE match packetStateOf finds is the one
  // written here. A blank line separates it from whatever follows: text, a `---` rule (which would
  // otherwise make the group a setext heading) or the next heading.
  const kept = lines.filter((line, index) => !(inSection(index) && isParkLine(line)));
  const keptStart = range.start;
  const next = kept[keptStart] ?? null;
  if (next !== null && next.text.trim() !== '') fresh.push({ text: '', eol });
  const out = [...kept.slice(0, keptStart), ...fresh, ...kept.slice(keptStart)];
  const body = joinLines(out);
  return { body, changed: body !== packetBody };
}

function isParkedForLocalAcceptance({ labels, packet } = {}) {
  const status = packet?.status;
  if (status !== 'found' && status !== 'none') return 'unknown';
  if (status === 'found' && typeof packet.body !== 'string') return 'unknown';
  if (acceptanceOf(normalizeLabelNames(labels)) !== 'pending') return 'not-parked';
  const state = parkStateOf(packet.body);
  return state.target === 'local' && state.reason === PARK_REASON ? 'parked' : 'not-parked';
}

module.exports = { PARK_REASON, decideAcceptanceRoute, decideSeries, writeParkDeployStatus, parkStateOf, isParkedForLocalAcceptance };
