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
// through repo-resolve's originSpecOf, never re-parsed here. The packet fact a held
// item becomes is built in console/decision-facts.js (upstreamDecisionFact), so this
// module reaches nothing under console/.

const { originSpecOf } = require('../repo-resolve');

// A bare `owner/name` target carries no host, so it names a github.com repo.
const TARGET_HOST = 'github.com';
// The one repo wrap-up's upstream feedback is filed into: `/claude-tweaks:feedback` files against it and nowhere
// else (feedback/SKILL.md's `--repo`). The staged draft's `upstream-target` header is an agent-written claim, so the
// two callers that route a staged draft pass this as `filingTarget` and a header naming any other repo is held;
// tests/control-mode-console-prose.test.js pins this literal to the skill's `--repo` and to the header layout.
const UPSTREAM_FILING_TARGET = 'thn-inc/claude-tweaks';
const HOLD_REASONS = Object.freeze(['external', 'filing-failed', 'scrub-hit', 'owner-unresolved']);

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const TARGET_LINE_RE = /^<!-- upstream-target: (.*) -->$/;
const TITLE_PREFIX = 'Title: ';
const LINE_SPLIT_RE = /\r?\n/;
const NOT_A_LIST = '(owned-owners is not a list)';

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
    else ignored.push(printable(el));
  }
  return { owners, ignored };
}

// String(el), total: an element with no primitive form (Object.create(null)) falls back to
// its Object.prototype.toString tag, and one that refuses even that (a revoked proxy) to a marker.
function printable(el) {
  for (const show of [String, (v) => Object.prototype.toString.call(v)]) {
    try {
      return show(el);
    } catch {
      // try the next form
    }
  }
  return '(unprintable)';
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
// filingTarget (optional): the one repo the item will actually be filed into. A target that names any other
// repo is held as `external` — ownership is judged for where the issue lands, never for what a draft claims.
// The order is the contract: control mode first, then the target, then the owner context.
function upstreamFilingRoute({ permissions, targetRepo, ownerContext, ownedOwners, filingTarget } = {}) {
  const echo = typeof targetRepo === 'string' ? targetRepo : null;
  const verdict = (route, reason) => ({ route, reason, targetRepo: echo });
  if (!permissions || permissions.ownedUpstreamFiling !== true) return verdict('unchanged', null);
  const target = parseTargetRepo(targetRepo);
  if (!target) return verdict('hold', 'external');
  if (filingTarget !== undefined && `${target.owner}/${target.name}`.toLowerCase() !== String(filingTarget).toLowerCase()) return verdict('hold', 'external');
  if (ownerContext == null) return verdict('hold', 'owner-unresolved');
  if (ownerContext.host !== TARGET_HOST) return verdict('hold', 'external');
  if (isOwnedRepo({ targetRepo, currentRepoOwner: ownerContext.owner, ownedOwners })) return verdict('file', null);
  return verdict('hold', 'external');
}

const isBlank = (line) => line.trim() === '';
const isHeaderLine = (line) => TARGET_LINE_RE.test(line) || line.startsWith(TITLE_PREFIX);
const single = (values) => (values.size === 1 ? [...values][0] : null);

// A staged wrap-up-upstream-*.md file -> { targetRepo, title, body }. Line 1 is
// `<!-- upstream-target: {owner/name} -->`, line 2 `Title: {title}`, a blank line,
// then the body; lines split on /\r?\n/ (a Windows checkout may write CRLF).
// Headers are read only from the leading header block: leading blank lines, then
// consecutive header lines, ending at the first line that is not a header (the blank
// separator included). A body line that looks like a header, the first one after the
// separator included, is body text, never read or removed. In the block, one distinct
// value is the field; two distinct values are ambiguous and read null, as does a target
// marker anywhere in the body naming a different repo (the marker stays in the body).
// The body is everything after the block, less the one blank line after it.
function parseStagedUpstream(text) {
  const lines = (typeof text === 'string' ? text : '').split(LINE_SPLIT_RE);
  // The block is the leading blank lines, then consecutive header lines; with no header it is empty.
  let first = 0;
  while (first < lines.length && isBlank(lines[first])) first++;
  let end = first;
  while (end < lines.length && isHeaderLine(lines[end])) end++;
  if (end === first) end = 0;
  const targets = new Set();
  const titles = new Set();
  for (const line of lines.slice(0, end)) {
    const target = TARGET_LINE_RE.exec(line);
    if (target) targets.add(target[1]);
    else if (line.startsWith(TITLE_PREFIX)) titles.add(line.slice(TITLE_PREFIX.length));
  }
  const rest = lines.slice(end > 0 && end < lines.length && isBlank(lines[end]) ? end + 1 : end);
  let targetRepo = single(targets);
  // A marker in the body naming another repo makes the target ambiguous.
  if (targetRepo !== null && rest.some((line) => {
    const marker = TARGET_LINE_RE.exec(line);
    return marker !== null && marker[1] !== targetRepo;
  })) targetRepo = null;
  return { targetRepo, title: single(titles), body: rest.join('\n') };
}

module.exports = {
  TARGET_HOST, UPSTREAM_FILING_TARGET, HOLD_REASONS, isValidOwner, parseTargetRepo, ownedOwnersList, isOwnedRepo,
  ownerContextFromOrigin, upstreamFilingRoute, parseStagedUpstream,
};
