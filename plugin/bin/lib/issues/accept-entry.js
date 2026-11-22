// bin/lib/issues/accept-entry.js — the decisions /claude-tweaks:accept's entries make
// (#4613): what the automatic entry labels, which state a record's acceptance packet is
// in, how a stale packet is refreshed, and which labels a verdict adds and removes.
// bin/accept-entry.js is the CLI the skill prose calls.
//
// Refresh rewrites a closed list of fields, REFRESHABLE_FIELDS, and nothing else in a
// packet body: the Deploy status section, the Test guide section's links (the origin of
// every http(s) URL, and the `(link unverified: …)` suffix, dropped when the new deploy
// text reads confirmed live), and the Recording section's link. The Test guide is the field,
// whole: every http(s) URL in it gets the new origin, a third-party link a human added
// included, while a URL in any other section keeps its own. A section ends at the next `### `
// heading or a `---` line, so the poster footer and text a human appends below the packet are
// in no field; the Deploy status field ends at its stored `ref:` line. A packet is stale only when its Deploy
// status section carries a `ref: {sha}` line and the deploy source names another ref. No
// deploy-status source exists yet (a later record supplies one), so today every refresh
// reports its fields `unverified`; a packet written before the `ref:` line existed is
// `unverified` too, never stale.
//
// A field is `refreshed` when its source value is given: devBaseUrl for the Test guide's
// origins (a Test guide with no URL in it has nothing stale), recordingUrl for the
// Recording link when the section holds a link to replace. Any other field is `unverified`.
//
// A record is already decided when it carries an approved label, or a changes-requested label
// with no pending label beside it. Changes-requested plus a pending label is a rebuilt record
// awaiting re-acceptance, classified by its packet like any other.
//
// Pure: no fs, git or gh.
'use strict';

const { SECTIONS, WITHHELD_TEXT, DEPLOY_REF_SOURCE, isDeployRef } = require('../wrap-up/packet-contract');
const { dispositionState, APPROVAL_PROVENANCE_LABEL, APPROVAL_PROVENANCE_LABELS } = require('./acceptance');
const { LABELS } = require('./record-vocabulary');
const { TARGET_RE, parkFieldsOf } = require('../accept/park-grammar');
const { findCredentialInText } = require('../wrap-up/packet-links');

const PACKET_STATES = Object.freeze(['awaiting-local', 'waiting-for-deploy', 'live-on-dev', 'already-decided', 'no-packet', 'unhandled']);
const REFRESHABLE_FIELDS = Object.freeze(['deploy-status', 'test-guide-base-url', 'recording-link']);
const VERDICTS = Object.freeze(['approved', 'changes-requested', 'skip']);

const headingOf = (key) => SECTIONS.find((section) => section.key === key).heading;
const RECORDING = headingOf('recording');
const TEST_GUIDE = headingOf('test-guide');
const DEPLOY = headingOf('deploy');

// What packet-render.js writes: the Recording note with nothing recorded, and the suffix on a
// Test-guide link whose dev deploy is not confirmed live.
const NOT_RECORDED = 'not recorded';
const UNVERIFIED_LINK = '(link unverified: deploy not confirmed live)';
const NOT_CONFIRMED_RE = /\bnot confirmed live\b/;
const CONFIRMED_RE = /\bconfirmed live\b/;
// Any `ref:` line, which is never deploy content and never kept from a source's text; only
// one in the producer's grammar (packet-contract.js's DEPLOY_REF_SOURCE) is a stored ref, so
// a backticked, uppercase or withheld ref reads as none: unverified, never stale.
const REF_LINE_RE = /^ref:[ \t]*(\S+)$/;
const STORED_REF_RE = new RegExp(`^ref:[ \\t]*(${DEPLOY_REF_SOURCE})$`);
// An origin: scheme, then host and port up to the first character that ends one.
const ORIGIN_RE = /\bhttps?:\/\/[^\s/?#<>()[\]`'"]+/gi;
const AUTOLINK_RE = /<https?:\/\/[^\s<>]+>/gi;

// record-vocabulary.js has no LABELS entry for the accept:* batch marker, so it is named here
// and held to acceptance.js's list of the marker's spellings.
const ACCEPT_APPROVED_BATCH = 'accept:approved-batch';
if (!APPROVAL_PROVENANCE_LABELS.includes(ACCEPT_APPROVED_BATCH)) {
  throw new Error(`accept-entry: ${ACCEPT_APPROVED_BATCH} is not among acceptance.js's APPROVAL_PROVENANCE_LABELS`);
}
const PENDING = Object.freeze([LABELS.DEMO_PENDING, LABELS.ACCEPT_PENDING]);
const APPROVED = Object.freeze([LABELS.DEMO_APPROVED, LABELS.ACCEPT_APPROVED]);
const CHANGES_REQUESTED = Object.freeze([LABELS.DEMO_CHANGES_REQUESTED, LABELS.ACCEPT_CHANGES_REQUESTED]);
const BATCH_MARKERS = Object.freeze([APPROVAL_PROVENANCE_LABEL, ACCEPT_APPROVED_BATCH]);

const namesOf = (labels) => (Array.isArray(labels) ? labels.filter((name) => typeof name === 'string') : []);

function automaticLabelAction(labels) {
  return dispositionState(namesOf(labels)) === 'none' ? 'apply-pending' : 'none';
}

// The body's lines, each with its `\r` stripped, plus the eol each carried.
function splitLines(body) {
  return body.split('\n').map((raw) => (raw.endsWith('\r') ? { text: raw.slice(0, -1), eol: '\r' } : { text: raw, eol: '' }));
}
const joinLines = (lines) => lines.map(({ text, eol }) => `${text}${eol}`).join('\n');

// { start, end } line indexes of a `### {heading}` section's body (start inclusive, end
// exclusive), ending at the next `### ` heading, a `---` line (the poster footer's rule; the
// renderer escapes one in any section body) or the end of the body; null when absent.
const SECTION_END_RE = /^(?:### | {0,3}-{3,}[ \t]*$)/;
function sectionRange(lines, heading) {
  const at = lines.findIndex(({ text }) => text.trimEnd() === `### ${heading}`);
  if (at === -1) return null;
  let end = at + 1;
  while (end < lines.length && !SECTION_END_RE.test(lines[end].text)) end += 1;
  return { start: at + 1, end };
}

function sectionText(lines, heading) {
  const range = sectionRange(lines, heading);
  return range === null ? null : lines.slice(range.start, range.end).map(({ text }) => text).join('\n');
}

const unhandled = (detail, recording = false) => ({
  state: 'unhandled', recording, verdict: null, message: `accept: unhandled packet state (${detail}) — stopping`,
});

// A recording exists unless every item line of the section is the not-recorded note, bare or
// with the renderer's `not recorded: {reason}`; an indented line (failure, caption, redaction
// count) continues the item above it.
function recordingOf(lines) {
  const range = sectionRange(lines, RECORDING);
  if (range === null) return false;
  const items = lines.slice(range.start, range.end).map(({ text }) => text).filter((text) => text.trim() !== '' && !/^\s/.test(text));
  return items.some((text) => text.trimEnd() !== NOT_RECORDED && !text.startsWith(`${NOT_RECORDED}:`));
}

function devState(deployText, guideText) {
  const guide = guideText ?? '';
  if (NOT_CONFIRMED_RE.test(deployText) || guide.includes(UNVERIFIED_LINK)) return 'waiting-for-deploy';
  if (CONFIRMED_RE.test(deployText)) return 'live-on-dev';
  // Commands-only packets render no links, so a bare `target: dev` is live only with a link.
  ORIGIN_RE.lastIndex = 0;
  return ORIGIN_RE.test(guide) ? 'live-on-dev' : 'waiting-for-deploy';
}

// The recorded verdict that stops an on-demand walk, or null. A changes-requested record
// that also carries a pending label of either spelling was rebuilt and is awaiting
// re-acceptance, so it is not decided; an approved label decides whatever else is present.
function decidedVerdict(labels) {
  const names = namesOf(labels);
  const has = (spellings) => spellings.some((name) => names.includes(name));
  if (has(CHANGES_REQUESTED) && !has(PENDING)) return 'changes-requested';
  if (has(APPROVED)) return 'approved';
  return null;
}

function packetStateOf({ packet, labels } = {}) {
  const status = packet?.status;
  const lines = typeof packet?.body === 'string' ? splitLines(packet.body) : [];
  const recording = status === 'found' ? recordingOf(lines) : false;
  const verdict = decidedVerdict(labels);
  if (verdict !== null) return { state: 'already-decided', recording, verdict, message: null };
  if (status === 'none') return { state: 'no-packet', recording: false, verdict: null, message: null };
  if (status === 'unreadable') return unhandled('packet comment unreadable: non-current schema');
  if (status !== 'found') return unhandled('unknown packet status');

  const deployText = sectionText(lines, DEPLOY) ?? '';
  // The renderer writes the placeholder in place of deploy text the credential screen refused.
  const deployContent = deployText.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !REF_LINE_RE.test(line));
  if (deployContent.length > 0 && deployContent.every((line) => line === WITHHELD_TEXT)) {
    return unhandled('deploy status withheld', recording);
  }
  const target = TARGET_RE.exec(deployText)?.[1] ?? null;
  let state;
  if (target === null || target === 'local') state = 'awaiting-local';
  else if (target === 'dev') state = devState(deployText, sectionText(lines, TEST_GUIDE));
  else return unhandled(`deploy target: ${target}`, recording);
  return { state, recording, verdict: null, message: null };
}

// The stored ref and its line index, or null.
function storedRef(lines, range) {
  for (let index = range.start; index < range.end; index += 1) {
    const match = STORED_REF_RE.exec(lines[index].text.trim());
    if (match) return { ref: match[1], index };
  }
  return null;
}

// One commit spelled at two lengths: a short sha is a prefix of the full one. A source ref
// outside the grammar matches only itself.
function sameCommit(stored, ref) {
  if (!isDeployRef(ref)) return stored === ref;
  return stored.length <= ref.length ? ref.startsWith(stored) : stored.startsWith(ref);
}

// The Deploy status field replaced by the source's text and one `ref:` line. The renderer
// writes the stored ref line last, so the field runs from the section's first non-blank line
// through it: whatever follows it (a human's text, the poster footer) and the blank lines
// before the field stay, so the bytes around it do not move. It is written in packet-render.js's
// layout, the ref line a paragraph of its own under a blank line, whichever layout it replaces
// (an earlier render put the ref line directly under the text).
function replaceDeploy(lines, range, refIndex, source) {
  const eol = lines[range.start - 1].eol;
  let first = range.start;
  while (first < refIndex && lines[first].text.trim() === '') first += 1;
  const text = source.text.split(/\r?\n/).filter((line) => !REF_LINE_RE.test(line.trim()));
  while (text.length > 0 && text.at(-1).trim() === '') text.pop();
  const fresh = [...(text.length > 0 ? [...text, ''] : []), `ref: ${source.ref}`].map((line) => ({ text: line, eol }));
  return [...lines.slice(0, first), ...fresh, ...lines.slice(refIndex + 1)];
}

function mapSection(lines, heading, fn) {
  const range = sectionRange(lines, heading);
  if (range === null) return lines;
  return lines.map((line, index) => (index >= range.start && index < range.end ? { ...line, text: fn(line.text) } : line));
}

// A refresh writes only web links: any other scheme parses but has no origin to rewrite to.
function httpUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError(`not an http(s) URL: ${value}`);
  return url;
}

function refreshPacket(body, source) {
  const unchangedUnverified = { body, refreshed: [], unverified: [...REFRESHABLE_FIELDS] };
  if (source === null || source === undefined) return unchangedUnverified;
  let lines = splitLines(body);
  const deployRange = sectionRange(lines, DEPLOY);
  const stored = deployRange === null ? null : storedRef(lines, deployRange);
  if (stored === null) return unchangedUnverified;
  // A packet parked for local acceptance (#4615) is not stale: its deploy source says nothing
  // about a check run in the worktree, and a refresh would erase the park fields.
  const deployTexts = lines.slice(deployRange.start, deployRange.end).map(({ text }) => text.trim());
  if (parkFieldsOf(deployTexts).parked) return unchangedUnverified;
  if (sameCommit(stored.ref, source.ref)) return { body, refreshed: [], unverified: [] };

  // The renderer screens the same field; text that ends the section early or carries a credential
  // would strand the stored ref line or publish the credential, so the refresh refuses it.
  if (source.text.split(/\r?\n/).some((line) => SECTION_END_RE.test(line)) || findCredentialInText(source.text)) {
    throw new TypeError('deploy text ends the Deploy status section or is credential-shaped');
  }
  const refreshed = ['deploy-status'];
  lines = replaceDeploy(lines, deployRange, stored.index, source);
  // The unverified-link suffix belongs to the Test guide field and follows the deploy text: a
  // source confirmed live drops it, one still not confirmed live keeps it.
  if (CONFIRMED_RE.test(source.text) && !NOT_CONFIRMED_RE.test(source.text)) {
    lines = mapSection(lines, TEST_GUIDE, (text) => text.split(` ${UNVERIFIED_LINK}`).join(''));
  }
  if (typeof source.devBaseUrl === 'string' && source.devBaseUrl !== '') {
    const origin = httpUrl(source.devBaseUrl).origin;
    // A function replacer: a `$` pattern in the value is data, not a replacement token.
    lines = mapSection(lines, TEST_GUIDE, (text) => text.replace(ORIGIN_RE, () => origin));
    refreshed.push('test-guide-base-url');
  }
  if (typeof source.recordingUrl === 'string' && source.recordingUrl !== '') {
    const recordingText = sectionText(lines, RECORDING);
    AUTOLINK_RE.lastIndex = 0;
    if (recordingText !== null && AUTOLINK_RE.test(recordingText)) {
      const link = `<${httpUrl(source.recordingUrl).href}>`;
      lines = mapSection(lines, RECORDING, (text) => text.replace(AUTOLINK_RE, () => link));
      refreshed.push('recording-link');
    }
  }
  return {
    body: joinLines(lines),
    refreshed,
    unverified: REFRESHABLE_FIELDS.filter((field) => !refreshed.includes(field)),
  };
}

// The labels each verdict removes when present, in removal order.
function removalCandidates(verdict, batch) {
  if (verdict === 'approved') {
    return [
      ...PENDING, LABELS.DEMO_CHANGES_REQUESTED, LABELS.ACCEPT_CHANGES_REQUESTED, LABELS.DEMO_APPROVED,
      // A batch approve keeps (and adds) the accept:* marker; its demo:* twin goes either way.
      ...(batch ? [APPROVAL_PROVENANCE_LABEL] : BATCH_MARKERS),
    ];
  }
  return [
    ...PENDING, LABELS.DEMO_APPROVED, LABELS.ACCEPT_APPROVED, ...BATCH_MARKERS, LABELS.DEMO_CHANGES_REQUESTED,
  ];
}

function verdictLabelEdits(labels, verdict, { batch = false } = {}) {
  if (!VERDICTS.includes(verdict)) throw new TypeError(`unknown verdict: ${verdict}`);
  if (verdict === 'skip') return { add: [], remove: [] };
  const present = new Set(namesOf(labels));
  const add = verdict === 'approved'
    ? [LABELS.ACCEPT_APPROVED, ...(batch ? [ACCEPT_APPROVED_BATCH] : [])]
    : [LABELS.ACCEPT_CHANGES_REQUESTED];
  // `gh issue edit --remove-label` on an absent label fails the whole edit.
  return { add, remove: removalCandidates(verdict, batch).filter((name) => present.has(name)) };
}

module.exports = {
  automaticLabelAction,
  DEPLOY,
  joinLines,
  PACKET_STATES,
  packetStateOf,
  REFRESHABLE_FIELDS,
  refreshPacket,
  sectionRange,
  splitLines,
  VERDICTS,
  verdictLabelEdits,
};
