'use strict';

// Pure (#4621): which repo a wrap-up upstream-feedback item may be filed into
// unattended. Under control mode, an item whose target repo is owned — its owner
// is the current repo's origin owner or an `owned-owners` entry — files; any
// other item holds with a reason and becomes a packet decision fact. Outside
// control mode the route is `unchanged` and the caller does what it always did.
//
// Ownership is a literal, case-insensitive string comparison and nothing else:
// no API call, no membership check, no redirect or rename following, and the
// authenticated gh account is never an input. Every owner input passes the
// owner grammar untrimmed before it is lower-cased, so no normalization (a
// trailing newline, a trailing dot, a homoglyph) can manufacture a match.
//
// Strings in, verdicts out: no git, no gh, no fs. The origin remote is read
// through repo-resolve's originSpecOf, never re-parsed here.
//
// decision-facts requires console/resolve lazily inside its functions, so the
// top-level require below is no cycle; SECTIONS is read lazily for the same reason.

const { originSpecOf } = require('../repo-resolve');
const { decisionFactFor } = require('../console/decision-facts');

// A bare `owner/name` target carries no host, so it names a github.com repo.
const TARGET_HOST = 'github.com';
const HOLD_REASONS = Object.freeze(['external', 'filing-failed', 'scrub-hit', 'owner-unresolved']);

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const TARGET_LINE_RE = /^<!-- upstream-target: (.*) -->$/;
const TITLE_PREFIX = 'Title: ';
const LINE_SPLIT_RE = /\r?\n/;
const WHITESPACE_RUN_RE = /\s+/g;
const NOT_A_LIST = '(owned-owners is not a list)';
// The hold reasons whose cause the human fixes before filing by hand.
const FIX_FIRST_REASONS = new Set(['filing-failed', 'scrub-hit']);

function isValidOwner(value) {
  return typeof value === 'string' && OWNER_RE.test(value);
}

// 'owner/name' -> { owner, name }, or null: exactly one '/', the owner in the
// owner grammar, the name in the name grammar and never '.' or '..'.
function parseTargetRepo(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (!isValidOwner(owner) || !NAME_RE.test(name) || name === '.' || name === '..') return null;
  return { owner, name };
}

// The resolved `owned-owners` value -> { owners, ignored }. Unset resolves to [],
// set to the raw comma string, malformed to [] (policy-schema). An array is taken
// as is; a string splits on ',' with only the whitespace around each comma trimmed
// (trimStart/trimEnd, so no backtracking regex) and empties dropped. An element
// outside the owner grammar is ignored, listed as String(element) for the caller's log.
function ownedOwnersList(value) {
  let elements;
  if (Array.isArray(value)) {
    elements = value;
  } else if (typeof value === 'string') {
    const parts = value.split(',');
    const last = parts.length - 1;
    elements = parts
      .map((part, i) => {
        const start = i > 0 ? part.trimStart() : part;
        return i < last ? start.trimEnd() : start;
      })
      .filter((part) => part !== '');
  } else {
    return { owners: [], ignored: [NOT_A_LIST] };
  }
  const owners = [];
  const ignored = [];
  for (const el of elements) {
    if (isValidOwner(el)) owners.push(el);
    else ignored.push(String(el));
  }
  return { owners, ignored };
}

function isOwnedRepo({ targetRepo, currentRepoOwner, ownedOwners } = {}) {
  const target = parseTargetRepo(targetRepo);
  if (!target) return false;
  const candidates = ownedOwnersList(ownedOwners).owners;
  if (isValidOwner(currentRepoOwner)) candidates.push(currentRepoOwner);
  const owner = target.owner.toLowerCase();
  return candidates.some((candidate) => candidate.toLowerCase() === owner);
}

// The origin remote URL -> { owner, host } (host normalized by originSpecOf), or
// null when the remote does not parse or its owner is outside the owner grammar.
function ownerContextFromOrigin(remoteUrl) {
  const spec = originSpecOf(remoteUrl);
  if (!spec || !isValidOwner(spec.owner)) return null;
  return { owner: spec.owner, host: spec.host };
}

// permissions: a bookkeepingPermissions(...) result; ownerContext: ownerContextFromOrigin's.
// The order is the contract: control mode first, then the target, then the owner context.
function upstreamFilingRoute({ permissions, targetRepo, ownerContext, ownedOwners } = {}) {
  const echo = typeof targetRepo === 'string' ? targetRepo : null;
  const verdict = (route, reason) => ({ route, reason, targetRepo: echo });
  if (!permissions || permissions.ownedUpstreamFiling !== true) return verdict('unchanged', null);
  if (!parseTargetRepo(targetRepo)) return verdict('hold', 'external');
  if (ownerContext == null) return verdict('hold', 'owner-unresolved');
  if (ownerContext.host !== TARGET_HOST) return verdict('hold', 'external');
  if (isOwnedRepo({ targetRepo, currentRepoOwner: ownerContext.owner, ownedOwners })) return verdict('file', null);
  return verdict('hold', 'external');
}

// A staged wrap-up-upstream-*.md file -> { targetRepo, title, body }. Line 1 is
// `<!-- upstream-target: {owner/name} -->`, line 2 `Title: {title}`, a blank line,
// then the body; lines split on /\r?\n/ (a Windows checkout may write CRLF). Each
// header is read from every line it appears on: one distinct value is the field,
// two distinct values are ambiguous and read null, none reads null. The body drops
// every header line and the one blank line directly after a run of them.
function parseStagedUpstream(text) {
  const lines = (typeof text === 'string' ? text : '').split(LINE_SPLIT_RE);
  const targets = new Set();
  const titles = new Set();
  const kept = [];
  let afterHeader = false;
  for (const line of lines) {
    const target = TARGET_LINE_RE.exec(line);
    if (target) targets.add(target[1]);
    else if (line.startsWith(TITLE_PREFIX)) titles.add(line.slice(TITLE_PREFIX.length));
    if (target || line.startsWith(TITLE_PREFIX)) {
      afterHeader = true;
      continue;
    }
    if (afterHeader && line.trim() === '') {
      afterHeader = false;
      continue;
    }
    afterHeader = false;
    kept.push(line);
  }
  const single = (values) => (values.size === 1 ? [...values][0] : null);
  return { targetRepo: single(targets), title: single(titles), body: kept.join('\n') };
}

const collapse = (s) => s.replace(WHITESPACE_RUN_RE, ' ').trim();

// A held item -> one packet decision fact (_shared/acceptance-packet.md's Decision
// facts table, plus `text`). id, kind, origin and evidenceRef come from decisionFactFor;
// summary names the target, the draft title and the hold reason; text adds the draft body.
function upstreamDecisionFact({ id, targetRepo, title, body, reason, detail, runDir, staged }) {
  const { SECTIONS } = require('../console/resolve');
  const base = decisionFactFor({ id, section: SECTIONS.UPSTREAM, resolution: 'filed', reason: '' }, { runDir, staged });
  const summary = collapse(
    `Upstream feedback ${id} held, not filed (${reason}): target ${targetRepo ?? 'unresolved'}`
    + (title ? `; draft "${title}"` : '')
    + (detail ? ` — ${detail}` : ''),
  );
  const text = collapse(summary + (body ? ` — draft: ${body}` : ''));
  const prefix = FIX_FIRST_REASONS.has(reason) ? 'fix the cause, then ' : '';
  return {
    id: base.id,
    kind: base.kind,
    origin: base.origin,
    summary,
    evidenceRef: base.evidenceRef,
    suggestedResolution: `${prefix}file the draft at ${base.evidenceRef} into ${targetRepo ?? 'its upstream repo'} yourself, or decline`,
    text,
  };
}

module.exports = {
  TARGET_HOST, HOLD_REASONS, isValidOwner, parseTargetRepo, ownedOwnersList, isOwnedRepo,
  ownerContextFromOrigin, upstreamFilingRoute, parseStagedUpstream, upstreamDecisionFact,
};
