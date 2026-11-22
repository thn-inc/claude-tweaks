// bin/lib/accept/park.js
// Pure: the local-acceptance park (#4615). decideAcceptanceRoute / decideSeries say whether a
// record's acceptance check parks for a human at the local worktree (never consulted with
// control mode off); writeParkDeployStatus / parkStateOf write and read the park's four fields
// in the acceptance packet's Deploy status section; isParkedForLocalAcceptance is the one
// predicate over a record's labels plus its packet, failing to 'unknown' when the packet is
// unreadable. The pending label is read through acceptanceOf, never named here. runPark is the
// ordered park executor over the five steps bin/accept-park.js park injects; it does no I/O of
// its own, and nothing else here does any.
'use strict';

const { resolveAcceptanceTarget } = require('./target');
const { acceptanceOf, normalizeLabelNames } = require('../issues/record-vocabulary');
const { PARK_REASON, TARGET_RE, REASON_LINE_RE, HEAD_LINE_RE, BASE_LINE_RE, parkFieldsOf } = require('./park-grammar');
const { DEPLOY, joinLines, sectionRange, splitLines } = require('../issues/accept-entry');

const HEAD_SHA_RE = /^[0-9a-f]{7,64}$/;
// The write replaces any `target:` line, a renderer's `target: dev, confirmed live` included.
const ANY_TARGET_LINE_RE = /^target:/;
const PARK_LINE_RES = [ANY_TARGET_LINE_RE, REASON_LINE_RE, HEAD_LINE_RE, BASE_LINE_RE];
// The diff tripwire's lines (#4619): a rewrite replaces every one, then writes the notes it was given.
const TRIPWIRE_LINE_RE = /^tripwire[ :]/;

// Control mode is on only for the boolean true: any other value never consults the resolver.
function decideAcceptanceRoute({ controlMode, keptRiskFlags, itemOverride, policyDefault, tripwire } = {}) {
  if (controlMode !== true) return { consulted: false, park: false, target: null, reason: null };
  const { target, reason } = resolveAcceptanceTarget({ keptRiskFlags, itemOverride, policyDefault, tripwire });
  return { consulted: true, park: target === 'local', target, reason };
}

// Each record is decided on its own; the series shares one PR, so any park parks the series.
function decideSeries(records) {
  if (!Array.isArray(records)) throw new TypeError('decideSeries: records must be an array');
  const decisions = records.map(({ record, input }) => ({ record, ...decideAcceptanceRoute(input ?? undefined) }));
  return { park: decisions.some((decision) => decision.park), decisions };
}

function parkStateOf(packetBody) {
  const none = { parked: false, target: null, reason: null, headSha: null, baseSha: null };
  if (typeof packetBody !== 'string') return none;
  const lines = splitLines(packetBody);
  const range = sectionRange(lines, DEPLOY);
  if (range === null) return none;
  const texts = lines.slice(range.start, range.end).map(({ text }) => text.trim());
  return parkFieldsOf(texts);
}

// Inside the Deploy status section only: exactly one 'target: local', `reason:`, `park-head:` and
// `park-base:` line (the PR's base oid at park time, so /accept's re-entry sees a moved base),
// written as a group at the section's start. Every other line, `ref:` included, stays.
function writeParkDeployStatus(packetBody, { headSha, baseSha, notes = [] } = {}) {
  if (typeof headSha !== 'string' || !HEAD_SHA_RE.test(headSha)) throw new TypeError(`park: headSha must be 7-64 lowercase hex: ${headSha}`);
  if (typeof baseSha !== 'string' || !HEAD_SHA_RE.test(baseSha)) throw new TypeError(`park: baseSha must be 7-64 lowercase hex: ${baseSha}`);
  if (typeof packetBody !== 'string') throw new TypeError('park: packet body must be a string');
  if (!Array.isArray(notes)) throw new TypeError('park: notes must be an array of strings');
  for (const note of notes) {
    if (typeof note !== 'string' || note === '' || /[\r\n]/.test(note)) throw new TypeError('park: a note must be one non-empty line');
    if (TARGET_RE.test(note)) throw new TypeError('park: a note must not carry a target: token (it would read as the packet\'s target)');
    if (!TRIPWIRE_LINE_RE.test(note)) throw new TypeError('park: a note must start with tripwire');
  }
  const lines = splitLines(packetBody);
  const range = sectionRange(lines, DEPLOY);
  if (range === null) throw new TypeError('park: packet has no Deploy status section');
  const eol = lines[range.start - 1].eol;
  const isParkLine = ({ text }) => PARK_LINE_RES.some((re) => re.test(text.trim())) || TRIPWIRE_LINE_RE.test(text.trim());
  const inSection = (index) => index >= range.start && index < range.end;
  const fresh = ['target: local', `reason: ${PARK_REASON}`, `park-head: ${headSha}`, `park-base: ${baseSha}`, ...notes].map((text) => ({ text, eol }));
  // The group leads the section, so the first TARGET_RE match packetStateOf finds is the one
  // written here. A blank line separates it from whatever follows: text, a `---` rule (which would
  // otherwise make the group a setext heading) or the next heading.
  const kept = lines.filter((line, index) => !(inSection(index) && isParkLine(line)));
  const next = kept[range.start] ?? null;
  if (next !== null && next.text.trim() !== '') fresh.push({ text: '', eol });
  const out = [...kept.slice(0, range.start), ...fresh, ...kept.slice(range.start)];
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

// The park, in its pinned order. Steps 1 and 2 put the park state on the record, so a failure
// there stops the park before the run is archived. Steps 3-5 are cleanup: each runs whatever the
// one before it did, and a failure there leaves the record parked (label plus packet) and is
// reported in `steps`. A step is `async () => ({ ok, detail })`; a throw is `ok: false`.
const PARK_STEPS = Object.freeze([
  { step: 1, name: 'postPacket' },
  { step: 2, name: 'writeDeployStatus' },
  { step: 3, name: 'archiveRun' },
  { step: 4, name: 'releaseClaim' },
  { step: 5, name: 'removeWorktree' },
]);
const STOPPING_STEPS = new Set([1, 2]);

async function runPark(steps = {}) {
  const missing = PARK_STEPS.filter(({ name }) => typeof steps[name] !== 'function').map(({ name }) => name);
  if (missing.length > 0) throw new TypeError(`runPark: missing step functions: ${missing.join(', ')}`);
  const results = [];
  for (const { step, name } of PARK_STEPS) {
    let ok = false;
    let detail = '';
    try {
      const result = await steps[name]();
      ok = result?.ok === true;
      detail = typeof result?.detail === 'string' ? result.detail : '';
    } catch (err) {
      detail = err && err.message ? err.message : String(err);
    }
    results.push({ step, name, ok, detail });
    if (!ok && STOPPING_STEPS.has(step)) return { outcome: 'park-failed', reason: PARK_REASON, steps: results };
  }
  return { outcome: 'parked', reason: PARK_REASON, steps: results };
}

module.exports = { PARK_REASON, HEAD_SHA_RE, runPark, decideAcceptanceRoute, decideSeries, writeParkDeployStatus, parkStateOf, isParkedForLocalAcceptance };
