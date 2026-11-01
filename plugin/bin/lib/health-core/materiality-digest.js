// bin/lib/health-core/materiality-digest.js
// Dedup mechanism for _shared/materiality-floor.md's digest (#1279) — the materiality-digest
// analog of digest.js's expandDigestFingerprints/appendDigestEntries for the pre-existing
// drain-rate cap digest. A below-floor finding that a scheduled sweep re-encounters on every
// firing must fold into its existing entry, never append a fresh one — otherwise
// tidy/digest-sweep.md's cluster-promotion threshold (>=3 entries sharing the same {area})
// spuriously fires on repeated firings of one genuinely-low-value finding, inverting the
// contract's whole purpose (reducing issue volume for low-materiality findings).
//
// Pure — no I/O, no gh calls, no network. The routing skill (review/step3-routing.md,
// wrap-up/residue-sweep.md, the four health sweeps, ...) calls isMaterialityDuplicate before
// appending a new entry, and materialityEntryLine to compose the line it appends. Dedup reads
// only trusted fingerprint sources (#3766): a github-issues caller passes comment objects, and
// only OWNER/MEMBER/COLLABORATOR comments (issues/comment-trust.js) can suppress a finding.
// The carry-over helpers (selectCarryOverEntries, planCarryOver, materialityEntryDate,
// classifyRolloverResume) plan a digest container rollover (#4848); tidy/digest-sweep.md's
// Container rollover procedure is their caller.
'use strict';

const { fingerprintFromBasis, normalizeText, parseMarkerFingerprints } = require('./fingerprint');
const {
  commentAssociation, isTrustedComment, untrustedSkipNote,
} = require('../issues/comment-trust');

const MATERIALITY_MARKER_PREFIX = 'materiality-fingerprint';
const MATERIALITY_FIRST_SEEN_PREFIX = 'materiality-first-seen';
const DIGEST_REPLACEMENT_PREFIX = 'digest-rollover-of';

const ENTRY_LINE = /^- \[[^\]]+\] /;
// A mark is trailing only when nothing but HTML comments follows it: `→` inside a finding stays live.
const TRAILING_MARK = /\s*(→ (?:expired|#?\d+))((?:\s*<!--(?:(?!-->).)*-->)*)\s*$/;
const RUN_ID_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(?:-|$)/;
// The markers a dedup or sweep reads. A fixed list: the container's comments also hold agent-claim markers.
const DEDUP_MARKER = /<!-- (?:materiality-fingerprint|consolebackfill-item): \S+? -->/g;
const FIRST_SEEN_MARKER = new RegExp(`<!-- ${MATERIALITY_FIRST_SEEN_PREFIX}: (\\S+?) -->`, 'g');
const FIRST_SEEN_STRIP = new RegExp(`\\s*<!-- ${MATERIALITY_FIRST_SEEN_PREFIX}: \\S+? -->`, 'g');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DEFAULT_MAX_CHARS = 60000;
// Room each carried entry line keeps for a marker edit: a space, then `→ expired` (9 characters, 10
// with the space) or `→ #` and up to ten digits (13 characters, 14 with the space).
const MARK_RESERVE = 14;
const TOMBSTONE_HEADER = 'Fingerprint-only tombstones: promoted or expired findings kept for dedup (tidy/digest-sweep.md\'s Container rollover).';

// A bare-string array element is the pre-#3766 contract shape (`.comments[].body`): it has no
// author association to check, so it stays untrusted, but its note names the caller's contract
// violation rather than reading like an ordinary untrusted comment.
const BARE_STRING_SKIP_NOTE = 'skipped bare-string digest element — caller passed comment bodies, not comment objects (no author association to check)';

// { area, finding, fileRefs } -> stable fingerprint string, matching materiality-floor.md's
// Entry format fields. fileRefs is normalized (comma-split, trimmed, sorted, deduped) so the
// same set of files listed in a different order or with incidental whitespace differences
// still produces the same fingerprint; `finding` is run through normalizeText (collapse
// whitespace, lowercase) for the same reason expandDigestFingerprints's sibling module
// normalizes descriptions — cosmetic rewording of the same underlying finding must not mint a
// new id. `area` is compared case-insensitively but NOT normalized beyond that in
// materiality-floor.md's own contract (exact-match grouping key) — trimming/lowercasing here
// only guards against incidental casing/whitespace, never semantic variants.
function materialityFingerprint({ area, finding, fileRefs } = {}) {
  const normalizedFileRefs = [...new Set(
    String(fileRefs || '').split(',').map((f) => f.trim()).filter(Boolean),
  )].sort().join(',');
  return fingerprintFromBasis('materiality', [
    String(area || '').trim().toLowerCase(),
    normalizeText(finding || ''),
    normalizedFileRefs,
  ]);
}

// Extracts every embedded materiality-fingerprint marker from a digest issue's comment/body
// text. Returns every marker regardless of whether that entry has since been promoted or
// expired (a trailing `→ {id}`/`→ expired` marker sits on the same line, after this one) —
// dedup must still recognize a still-active entry as already-present; promoted/expired
// filtering is tidy/digest-sweep.md's own concern at sweep time, not this function's.
function parseMaterialityFingerprints(text) {
  return parseMarkerFingerprints(text, MATERIALITY_MARKER_PREFIX);
}

// entry: { area, finding, fileRefs, deferReason, provenance }. Composes one Entry-format line
// per materiality-floor.md's `## Entry format` section, with the dedup marker appended —
// mirrors digest.js's digestEntryLine, one marker per line, machine-parseable via
// parseMaterialityFingerprints above.
function materialityEntryLine(entry) {
  const fp = materialityFingerprint(entry);
  const {
    area, finding, fileRefs, deferReason, provenance,
  } = entry || {};
  return `- [${area}] ${finding} — ${fileRefs} — Defer-reason: ${deferReason} — ${provenance} <!-- ${MATERIALITY_MARKER_PREFIX}: ${fp} -->`;
}

// existingTexts: the digest container's already-posted comments (github-issues: an array of
// comment objects — `gh --json comments` elements or REST/MCP comments, each with its body and
// author association) or its current file body (local-files: a string, single-writer and so
// trusted). Returns { texts, skipped }. texts are the bodies a dedup may read: a string passes
// through; for an array, each comment passing isTrustedComment contributes its body. A bare
// string array element has no association, so it is dropped (fail closed). skipped holds one
// note line per dropped element whose body carries a materiality-fingerprint marker (an
// untrustedSkipNote for a comment object, BARE_STRING_SKIP_NOTE for a bare string), so the
// caller can name what it ignored (#3766).
function trustedMaterialityTexts(existingTexts) {
  if (existingTexts === null || existingTexts === undefined) return { texts: [], skipped: [] };
  if (typeof existingTexts === 'string') return { texts: [existingTexts], skipped: [] };
  const texts = [];
  const skipped = [];
  for (const el of [].concat(existingTexts)) {
    if (isTrustedComment(el)) {
      texts.push(el.body);
      continue;
    }
    if (typeof el === 'string') {
      if (parseMaterialityFingerprints(el).length > 0) skipped.push(BARE_STRING_SKIP_NOTE);
      continue;
    }
    if (parseMaterialityFingerprints(el && el.body).length > 0) skipped.push(untrustedSkipNote(el));
  }
  return { texts, skipped };
}

// existingTexts: see trustedMaterialityTexts. entry: the candidate about to be routed. Returns
// true when an entry with the same fingerprint is already present in a trusted text, meaning the
// caller must NOT append a duplicate and must NOT count it a second time toward
// cluster-promotion's >=3 threshold. A marker in an untrusted comment never counts (#3766).
function isMaterialityDuplicate(existingTexts, entry) {
  const fp = materialityFingerprint(entry);
  const seen = new Set();
  for (const text of trustedMaterialityTexts(existingTexts).texts) {
    for (const found of parseMaterialityFingerprints(text)) seen.add(found);
  }
  return seen.has(fp);
}

// --- Container rollover carry-over (#4848) ---------------------------------------------------
//
// Rolling the digest over closes a full issue and opens a replacement. These helpers decide what
// the replacement must hold so clustering, expiry and dedup behave as before: every trusted live
// entry (with its original timestamp as a first-seen marker), and a marker-only tombstone for
// every promoted or expired entry, so a rollover never changes what dedup suppresses. All of it
// is planned from comment objects the caller fetched; nothing here reads or writes an issue.

class CarryOverInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CarryOverInputError';
  }
}

// ISO-8601 with a zone, the shape GitHub returns and this module writes. Anything else is not a
// date a marker may carry.
function parseIso(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

function createdAtOf(comment) {
  for (const value of [comment.createdAt, comment.created_at]) {
    if (typeof value === 'string') return value;
  }
  return null;
}

// comments: the digest issue's comments as one flat array of comment objects (`gh issue view
// --json comments --jq .comments`, or REST). Any other shape is refused rather than read as
// empty: a paged, wrapped or bare-body read would otherwise plan a rollover that carries
// nothing. Returns { lines, skipped }: every line of every trusted comment in order, and one
// note per untrusted comment that holds a fingerprint marker.
function readTrustedLines(comments, label) {
  if (!Array.isArray(comments)) {
    throw new CarryOverInputError(`${label}: expected one flat array of comment objects, got ${comments === null ? 'null' : typeof comments}`);
  }
  const lines = [];
  const skipped = [];
  comments.forEach((comment, index) => {
    const where = `${label}[${index}]`;
    if (!comment || typeof comment !== 'object' || Array.isArray(comment)) {
      throw new CarryOverInputError(`${where}: not a comment object`);
    }
    if (typeof comment.body !== 'string') throw new CarryOverInputError(`${where}: no string body`);
    if (commentAssociation(comment) === null) throw new CarryOverInputError(`${where}: no author association`);
    const createdAt = createdAtOf(comment);
    if (parseIso(createdAt) === null) throw new CarryOverInputError(`${where}: no parseable createdAt`);
    if (!isTrustedComment(comment)) {
      if (parseMaterialityFingerprints(comment.body).length > 0) skipped.push(untrustedSkipNote(comment));
      return;
    }
    for (const text of comment.body.split(/\r?\n/)) lines.push({ text, createdAt, comment });
  });
  return { lines, skipped };
}

// One digest line, read for carry-over. entry: an Entry-format line. marked: it ends in a
// `→ expired` / `→ #N` mark (only HTML comments may follow). key: the fingerprint, else the
// line without its first-seen marker and mark. markers: the dedup markers on the line.
function describeLine(text) {
  const markers = text.match(DEDUP_MARKER) || [];
  if (!ENTRY_LINE.test(text)) return { entry: false, markers };
  const trailing = TRAILING_MARK.exec(text);
  const unmarked = trailing ? text.replace(TRAILING_MARK, (_all, _mark, comments) => comments) : text;
  const [fingerprint = null] = parseMaterialityFingerprints(text);
  const key = fingerprint !== null ? fingerprint : unmarked.replace(FIRST_SEEN_STRIP, '').trim();
  return {
    entry: true, marked: trailing !== null, mark: trailing ? trailing[1] : null, key, fingerprint, markers,
  };
}

function firstSeenDate(text) {
  for (const found of String(text).matchAll(FIRST_SEEN_MARKER)) {
    const date = parseIso(found[1]);
    if (date) return date;
  }
  return null;
}

function runIdDate(provenance) {
  const m = RUN_ID_DATE.exec(provenance);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const intact = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    && date.getUTCHours() === h && date.getUTCMinutes() === mi && date.getUTCSeconds() === s;
  return intact ? date : null;
}

// The date an entry's age is measured from: a run-id in its provenance (UTC), else its
// first-seen marker, else the date of the comment holding it, else null. The first-seen marker
// is what survives a rollover, when the comment date becomes the rollover's.
function materialityEntryDate(line, commentCreatedAt) {
  const text = String(line || '');
  const cut = text.lastIndexOf(' — ');
  const provenance = cut === -1 ? '' : text.slice(cut + 3).replace(/<!--.*?-->/g, '').replace(TRAILING_MARK, '').trim();
  return runIdDate(provenance) || firstSeenDate(text) || parseIso(commentCreatedAt) || null;
}

function stampFirstSeen(text, createdAt) {
  return firstSeenDate(text) ? text : `${text} <!-- ${MATERIALITY_FIRST_SEEN_PREFIX}: ${createdAt} -->`;
}

// Distinct trusted live entries of a read, in order, ready to post.
function liveEntriesOf(lines) {
  const entries = new Map();
  for (const { text, createdAt } of lines) {
    const d = describeLine(text);
    if (!d.entry || d.marked || entries.has(d.key)) continue;
    entries.set(d.key, { line: stampFirstSeen(text, createdAt), key: d.key, fingerprint: d.fingerprint });
  }
  return [...entries.values()];
}

// comments: the digest issue's comments (see readTrustedLines). Returns the trusted live
// entries to carry, { entries: [{ line, key, fingerprint }], skipped }. line is the line to
// post, first-seen marker included; a trusted line already marked `→ …` is not an entry.
function selectCarryOverEntries(comments) {
  const { lines, skipped } = readTrustedLines(comments, 'comments');
  return { entries: liveEntriesOf(lines), skipped };
}

function commentIdOf(comment) {
  for (const url of [comment.url, comment.html_url]) {
    const m = typeof url === 'string' ? /issuecomment-(\d+)/.exec(url) : null;
    if (m) return m[1];
  }
  if (Number.isInteger(comment.id) || (typeof comment.id === 'string' && /^\d+$/.test(comment.id))) return String(comment.id);
  throw new CarryOverInputError('a comment needing a marker edit has no issuecomment url or numeric id');
}

// Packs lines into bodies of at most maxChars, splitting only at line boundaries; a single line
// over the cap gets a body of its own. header, when given, opens every body. reserve: characters
// each line may still grow by (a marker edit appends a `→` mark to an entry line), counted against
// the cap up front so a later edit cannot push a body of two or more lines past it. A body of one
// line cannot be split further, so a line over the cap, or within `reserve` of it, can still exceed
// it.
function packBodies(lines, maxChars, header, reserve = 0) {
  const bodies = [];
  let current = header ? [header] : [];
  let length = header ? header.length : 0;
  let count = 0;
  const flush = () => {
    if (count > 0) bodies.push(current.join('\n'));
    current = header ? [header] : [];
    length = header ? header.length : 0;
    count = 0;
  };
  for (const line of lines) {
    const added = (current.length > 0 ? 1 : 0) + line.length;
    if (count > 0 && length + added + reserve * (count + 1) > maxChars) flush();
    length += (current.length > 0 ? 1 : 0) + line.length;
    current.push(line);
    count += 1;
  }
  flush();
  return bodies;
}

// Plans carrying the old digest container's comments into the new one. Re-runnable: it compares
// the old side with what the new side already holds, and plans only what is missing.
//   oldComments / newComments: flat comment-object arrays (see readTrustedLines); the new side
//     may be empty. oldCommentCount: the old issue's true comment count (REST `.comments`), which
//     must equal oldComments.length so a truncated read is refused, not planned as complete.
//   live: distinct trusted live entries on the old side. carried: those present on a trusted
//     entry line of the new side (live or marked). pending: the lines still to post.
//   tombstones: marker-only lines for promoted/expired entries, each holding every dedup marker
//     its source line carried that no live line or earlier tombstone holds. tombstonesCarried /
//     tombstonesPending: how many are on the new side, and the missing-marker lines still to post.
//   markerEdits: bodies for new-side comments whose carried copy lacks the `→` mark its old line
//     gained, for a key with no live line left on the old side.
//   bodies: what to post now, pending entries then tombstones, each under maxChars.
//   verified: nothing pending, no marker edit, both counts match.
function planCarryOver(oldComments, newComments, { oldCommentCount, maxChars = DEFAULT_MAX_CHARS } = {}) {
  const oldSide = readTrustedLines(oldComments, 'old comments');
  if (oldComments.length === 0) throw new CarryOverInputError('old comments: empty — nothing to plan from');
  if (!Number.isInteger(oldCommentCount) || oldCommentCount !== oldComments.length) {
    throw new CarryOverInputError(`oldCommentCount ${String(oldCommentCount)} does not equal the ${oldComments.length} old comments read — a truncated or partial read`);
  }
  if (!Number.isInteger(maxChars) || maxChars <= 0) throw new CarryOverInputError(`maxChars ${String(maxChars)} is not a positive integer`);
  const newSide = readTrustedLines(newComments, 'new comments');

  const oldLines = oldSide.lines.map((l) => ({ ...l, d: describeLine(l.text) }));
  const live = liveEntriesOf(oldSide.lines);
  const liveKeys = new Set(live.map((e) => e.key));
  // Markers on the lines that get carried live. A later live line sharing a key is not carried, so
  // its other markers (a consolebackfill-item) are tombstoned below, not assumed held.
  const liveMarkers = new Set(live.flatMap((e) => e.line.match(DEDUP_MARKER) || []));

  const tombstones = [];
  const taken = new Set();
  const marks = new Map();
  const carriedKeys = new Set();
  let unfingerprintedMarked = 0;
  for (const { d } of oldLines) {
    if (d.entry && !d.marked && !carriedKeys.has(d.key)) {
      carriedKeys.add(d.key);
      continue;
    }
    if (d.marked && d.fingerprint === null) unfingerprintedMarked += 1;
    if (d.marked && !liveKeys.has(d.key) && !marks.has(d.key)) marks.set(d.key, d.mark);
    const rest = d.markers.filter((m) => !liveMarkers.has(m) && !taken.has(m));
    for (const m of rest) taken.add(m);
    if (rest.length > 0) tombstones.push(rest);
  }

  const newLines = newSide.lines.map((l) => ({ ...l, d: describeLine(l.text) }));
  const newEntryKeys = new Set(newLines.filter(({ d }) => d.entry).map(({ d }) => d.key));
  const newMarkers = new Set(newLines.flatMap(({ d }) => d.markers));

  // A selected live entry whose key the new side already holds, but on a line missing some of its
  // markers: the selection moved after the copy was posted (the first live line was promoted, so a
  // later duplicate with an extra marker is now the one carried). Those markers are tombstoned
  // rather than assumed to be on the new side.
  const newEntryMarkers = new Map();
  for (const { d } of newLines) {
    if (!d.entry) continue;
    if (!newEntryMarkers.has(d.key)) newEntryMarkers.set(d.key, new Set());
    for (const m of d.markers) newEntryMarkers.get(d.key).add(m);
  }
  for (const e of live) {
    if (!newEntryMarkers.has(e.key)) continue;
    const rest = (e.line.match(DEDUP_MARKER) || []).filter((m) => !newEntryMarkers.get(e.key).has(m) && !taken.has(m));
    for (const m of rest) taken.add(m);
    if (rest.length > 0) tombstones.push(rest);
  }

  const pendingEntries = live.filter((e) => !newEntryKeys.has(e.key));
  const pending = pendingEntries.map((e) => e.line);
  const tombstonesPending = [];
  let tombstonesCarried = 0;
  for (const markers of tombstones) {
    const missing = markers.filter((m) => !newMarkers.has(m));
    if (missing.length === 0) tombstonesCarried += 1;
    else tombstonesPending.push(missing.join(' '));
  }

  const markerEdits = [];
  const edited = new Set();
  for (const { comment } of newLines) {
    if (edited.has(comment)) continue;
    edited.add(comment);
    let changed = false;
    const body = comment.body.split('\n').map((raw) => {
      const cr = raw.endsWith('\r') ? '\r' : '';
      const text = cr ? raw.slice(0, -1) : raw;
      const d = describeLine(text);
      if (!d.entry || d.marked || !marks.has(d.key)) return raw;
      changed = true;
      return `${text} ${marks.get(d.key)}${cr}`;
    }).join('\n');
    if (changed) markerEdits.push({ commentId: commentIdOf(comment), body });
  }

  const bodies = [
    ...packBodies(pending, maxChars, undefined, MARK_RESERVE),
    ...packBodies(tombstonesPending, maxChars, TOMBSTONE_HEADER),
  ];
  const carried = live.length - pendingEntries.length;
  return {
    live: live.length,
    carried,
    pending,
    tombstones: tombstones.length,
    tombstonesCarried,
    tombstonesPending,
    unfingerprintedMarked,
    markerEdits,
    bodies,
    verified: pending.length === 0 && tombstonesPending.length === 0 && markerEdits.length === 0
      && carried === live.length && tombstonesCarried === tombstones.length,
    skipped: [...oldSide.skipped, ...newSide.skipped],
  };
}

// The line a replacement digest issue's body holds so a resume can tell it from an issue that is
// merely titled like one (#4848). The title never identifies a replacement.
function digestReplacementMarker(oldNumber) {
  return `<!-- ${DIGEST_REPLACEMENT_PREFIX}: ${oldNumber} -->`;
}

function hasDigestLabel(issue) {
  return Array.isArray(issue.labels) && issue.labels.some((l) => (typeof l === 'string' ? l : l && l.name) === 'digest');
}

// candidates: REST issue objects ({ number, body, author_association, state, labels: [{ name }] });
// oldIssue: the issue being rolled over. A candidate is a replacement only when a trusted author's
// body holds the marker for oldIssue.number as a whole line. Returns { state, replacement, extras }:
// none (no replacement, or the old issue is closed and neither issue holds the label — a past
// generation), resume (carry on), stalled (the old issue is open and the digest label sits on
// neither issue — a human finishes the move), finished (old closed, replacement labeled).
// replacement is the lowest-numbered match; extras are the others, ascending.
function classifyRolloverResume(candidates, oldIssue) {
  if (!Array.isArray(candidates)) throw new CarryOverInputError('candidates: expected an array of issue objects');
  if (!oldIssue || typeof oldIssue !== 'object' || Array.isArray(oldIssue) || !Number.isInteger(oldIssue.number)) {
    throw new CarryOverInputError('oldIssue: expected an issue object with an integer number');
  }
  if (typeof oldIssue.state !== 'string' || oldIssue.state === '') {
    throw new CarryOverInputError('oldIssue: no state — cannot tell an open issue from a closed one');
  }
  candidates.forEach((c, index) => {
    if (commentAssociation(c) === null) throw new CarryOverInputError(`candidates[${index}]: no author association`);
  });
  const marker = digestReplacementMarker(oldIssue.number);
  const matches = candidates
    .filter((c) => Number.isInteger(c.number) && c.number !== oldIssue.number
      && isTrustedComment(c) && typeof c.body === 'string'
      && c.body.split(/\r?\n/).some((l) => l.trim() === marker))
    .sort((a, b) => a.number - b.number);
  if (matches.length === 0) return { state: 'none', replacement: null, extras: [] };
  const [chosen, ...others] = matches;
  const extras = others.map((c) => c.number);
  const oldHas = hasDigestLabel(oldIssue);
  const newHas = hasDigestLabel(chosen);
  const oldOpen = String(oldIssue.state).toLowerCase() === 'open';
  // A replacement keeps its marker for good, so once a later rollover has moved the label on, the
  // closed old issue and its closed replacement hold no label: that is a finished past, not a stall.
  if (!oldHas && !newHas && !oldOpen) return { state: 'none', replacement: null, extras: [] };
  let state = 'resume';
  if (!oldHas && !newHas) state = 'stalled';
  else if (!oldOpen && newHas) state = 'finished';
  return { state, replacement: chosen.number, extras };
}

module.exports = {
  MATERIALITY_MARKER_PREFIX,
  MATERIALITY_FIRST_SEEN_PREFIX,
  DIGEST_REPLACEMENT_PREFIX,
  CarryOverInputError,
  materialityFingerprint,
  parseMaterialityFingerprints,
  materialityEntryLine,
  trustedMaterialityTexts,
  isMaterialityDuplicate,
  selectCarryOverEntries,
  materialityEntryDate,
  planCarryOver,
  digestReplacementMarker,
  classifyRolloverResume,
};
