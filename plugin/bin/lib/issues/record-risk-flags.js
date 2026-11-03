// bin/lib/issues/record-risk-flags.js
// Pure: the `Risk-flags:` body line (#4618) — the one reader every consumer shares
// (parseRiskFlags) and the sanctioned writers (addRiskFlags, removeRiskFlag,
// confirmRiskFlags, appendRiskProofGotcha). A record body, not a facet, carries the
// line, so the GitHub and local-files backends read it through the same function.
// No I/O.
//
// Grammar. `Risk-flags: migrations, auth` (comma-separated lowercase slugs: the four
// BUILTIN_RISK_CATEGORIES plus policy `risk-categories`) or `Risk-flags: none`
// (classified, nothing flagged). An absent line is an unclassified legacy record, read
// as no flags. A present line that is malformed or names an unknown slug is read as
// unknown: all four built-ins flagged, plus any other well-formed slug it named, so a
// misspelling can never read as "no risk". `Risk-flags-unconfirmed: true` marks a flag
// set a headless run kept without a human; any value but exactly `false` counts.
//
// Scope. Only the preamble is read: after an optional leading `---` frontmatter block,
// the lines before the first `## ` heading, fenced lines ignored (a quoted flag line is
// never the record's own). Detection is wider than the grammar — any preamble line
// matching FLAG_LINE_RE is a flag line — so a variant spelling is malformed, not absent.
//
// Writers only ever widen unless a human decided otherwise: removeRiskFlag and
// confirmRiskFlags refuse without `humanConfirmed === true`, and refuse again on an
// unknown line (Reading A: nothing is removed until addRiskFlags has repaired it).
// Every writer takes `\r\n?` to `\n` on entry and puts `\r\n` back when the body was
// uniformly CRLF.
'use strict';

const { BUILTIN_RISK_CATEGORIES } = require('../policy-schema');
const { fencedLineMask } = require('../markdown-blocks');

const RISK_FLAGS_NONE = 'none';
// The `code` removeRiskFlag/confirmRiskFlags refusals on an unreadable line carry,
// exported so the CLI matches on it rather than on message text.
const RISK_FLAGS_UNKNOWN = 'RISK_FLAGS_UNKNOWN';

const FLAG_LINE_RE = /^\s*risk[-_ ]?flags\s*:/i;
const MARKER_LINE_RE = /^\s*risk[-_ ]?flags[-_ ]unconfirmed\s*:/i;
const EXACT_FLAG_RE = /^Risk-flags: (.*)$/;
const MARKER_TRUE = 'Risk-flags-unconfirmed: true';
const MARKER_FALSE = 'Risk-flags-unconfirmed: false';
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const PREAMBLE_END_RE = /^## /;
const HEADING_RE = /^#{1,6}[ \t]/;

const GOTCHAS_HEADING_RE = /^## Gotchas[ \t]*$/;
const GOTCHAS_STOP_RE = /^#{1,2}[ \t]/;
const SECTION_BEFORE_RE = /^## (?:Breaking Change|Original request)[ \t]*$/;
const PROOF_BULLET_RE = /^- Risk proof required:/;

const isBlank = (line) => line.trim() === '';
const unique = (items) => [...new Set(items)];

function toText(body) {
  return body === null || body === undefined ? '' : String(body);
}

function toLines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

// True only when every line ending is `\r\n`: a mixed body is normalized to `\n`.
function isUniformCrlf(text) {
  return text.includes('\r\n') && !/[\r\n]/.test(text.replace(/\r\n/g, ''));
}

// body, (lines -> lines | null) -> body. `null` from `edit` means "no change" and
// returns the text exactly as given.
function editBody(body, edit) {
  const text = toText(body);
  const out = edit(toLines(text));
  if (out === null) return text;
  const joined = out.join('\n');
  return isUniformCrlf(text) ? joined.replace(/\n/g, '\r\n') : joined;
}

// The four built-ins in BUILTIN_RISK_CATEGORIES order, then every other slug in the
// order given: the canonical order an ok line reads in and the writers emit.
function canonicalOrder(slugs) {
  return [
    ...BUILTIN_RISK_CATEGORIES.filter((slug) => slugs.includes(slug)),
    ...unique(slugs.filter((slug) => !BUILTIN_RISK_CATEGORIES.includes(slug))),
  ];
}

// Unknown reads all four built-ins flagged, plus whatever else the line named.
function widened(named) {
  return [...BUILTIN_RISK_CATEGORIES, ...unique(named.filter((slug) => !BUILTIN_RISK_CATEGORIES.includes(slug)))];
}

function assertSlugs(name, slugs) {
  if (!Array.isArray(slugs)) throw new TypeError(`${name}: invalid slug list ${JSON.stringify(slugs)}: expected an array of slugs`);
  for (const slug of slugs) {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug) || slug === RISK_FLAGS_NONE) {
      throw new TypeError(`${name}: invalid slug ${JSON.stringify(slug)}: a slug is lowercase [a-z0-9-] and is never "${RISK_FLAGS_NONE}"`);
    }
  }
}

// lines -> where the preamble sits and which of its unfenced lines are flag lines,
// marker lines, and the last non-blank line (`anchor`, -1 when none): where a new flag
// line goes.
function scanPreamble(lines) {
  const frontmatterEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const start = frontmatterEnd === -1 ? 0 : frontmatterEnd + 1;
  const fenced = fencedLineMask(lines.slice(start));
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (!fenced[i - start] && PREAMBLE_END_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  const flagIdx = [];
  const markerIdx = [];
  let anchor = -1;
  for (let i = start; i < end; i += 1) {
    if (fenced[i - start]) continue;
    if (!isBlank(lines[i])) anchor = i;
    if (MARKER_LINE_RE.test(lines[i])) markerIdx.push(i);
    else if (FLAG_LINE_RE.test(lines[i])) flagIdx.push(i);
  }
  return { start, end, flagIdx, markerIdx, anchor };
}

// flag lines -> the slugs of one exact `Risk-flags: {value}` line, [] for `none`, or
// null when the line is malformed (any other spelling, two lines, an empty value, a
// slug failing SLUG_RE, `none` beside a slug).
function readExactLine(flagLines) {
  if (flagLines.length !== 1) return null;
  const match = EXACT_FLAG_RE.exec(flagLines[0]);
  if (!match) return null;
  const value = match[1].trim();
  if (value === '') return null;
  const tokens = value.split(',').map((token) => token.trim());
  if (tokens.some((token) => !SLUG_RE.test(token))) return null;
  if (tokens.includes(RISK_FLAGS_NONE)) return tokens.length === 1 ? [] : null;
  return unique(tokens);
}

// body, { extraCategories } -> { flags, status, reason, unconfirmed, raw }.
//   status 'ok'           the line reads cleanly; `flags` in canonical order.
//   status 'unknown'      reason 'malformed' | 'unknown-slug'; `flags` is all four
//                         built-ins, then any other well-formed slug the line named.
//   status 'unclassified' no flag line; `flags` is [].
// extraCategories are the policy `risk-categories` slugs the caller resolved; a slug
// outside the built-ins and that list reads unknown.
function parseRiskFlags(body, { extraCategories = [] } = {}) {
  const lines = toLines(toText(body));
  const scan = scanPreamble(lines);
  const unconfirmed = scan.markerIdx.some((i) => lines[i] !== MARKER_FALSE);
  if (scan.flagIdx.length === 0) return { flags: [], status: 'unclassified', reason: null, unconfirmed, raw: null };

  const flagLines = scan.flagIdx.map((i) => lines[i]);
  const raw = flagLines.join('\n');
  const named = unique(flagLines.flatMap((line) => line.slice(line.indexOf(':') + 1).split(',')
    .map((token) => token.trim())
    .filter((token) => SLUG_RE.test(token) && token !== RISK_FLAGS_NONE)));
  const slugs = readExactLine(flagLines);
  if (slugs === null) return { flags: widened(named), status: 'unknown', reason: 'malformed', unconfirmed, raw };

  const known = new Set([...BUILTIN_RISK_CATEGORIES, ...(Array.isArray(extraCategories) ? extraCategories : [])]);
  if (slugs.some((slug) => !known.has(slug))) return { flags: widened(slugs), status: 'unknown', reason: 'unknown-slug', unconfirmed, raw };
  return { flags: canonicalOrder(slugs), status: 'ok', reason: null, unconfirmed, raw };
}

function flagLineFor(flags) {
  return `Risk-flags: ${flags.length > 0 ? flags.join(', ') : RISK_FLAGS_NONE}`;
}

// lines, flag line text, marker mode -> lines with exactly one flag line.
//   markerMode 'write'  one `Risk-flags-unconfirmed: true` right below the flag line
//   markerMode 'clear'  no marker line
//   markerMode 'keep'   marker lines left where they are
// The first existing flag line is replaced in place and any further one dropped; with
// none, the line goes after the last non-blank preamble line, so inside the metadata
// block and above the first heading.
function applyFlagLine(lines, flagText, markerMode) {
  let work = lines;
  let scan = scanPreamble(work);
  if (markerMode !== 'keep' && scan.markerIdx.length > 0) {
    const drop = new Set(scan.markerIdx);
    work = work.filter((_, i) => !drop.has(i));
    scan = scanPreamble(work);
  }
  const block = markerMode === 'write' ? [flagText, MARKER_TRUE] : [flagText];
  if (scan.flagIdx.length > 0) {
    const [first, ...rest] = scan.flagIdx;
    const dropped = new Set(rest);
    const out = [];
    work.forEach((line, i) => {
      if (i === first) out.push(...block);
      else if (!dropped.has(i)) out.push(line);
    });
    return out;
  }
  const anchorIsHeading = scan.anchor !== -1 && HEADING_RE.test(work[scan.anchor]);
  const at = scan.anchor === -1 ? scan.start : scan.anchor + 1;
  const insert = anchorIsHeading ? ['', ...block] : [...block];
  if (at < work.length && !isBlank(work[at])) insert.push('');
  return [...work.slice(0, at), ...insert, ...work.slice(at)];
}

// body, slugs, { unconfirmed, extraCategories } -> body. Only ever adds: the line
// becomes every flag it already carried plus `slugs`, in canonical order. A malformed
// line, or one naming an unknown slug, is first widened to all four built-ins (plus any
// other well-formed slug it named), so a malformed line comes back ok and an unknown
// slug stays unknown; `none` is never carried. No flags at all writes `Risk-flags: none`.
// An existing marker stays (adding never confirms); `unconfirmed: true` writes one.
function addRiskFlags(body, slugs, { unconfirmed = false, extraCategories = [] } = {}) {
  assertSlugs('addRiskFlags', slugs);
  const current = parseRiskFlags(body, { extraCategories });
  const merged = canonicalOrder([...current.flags, ...slugs]);
  const markerMode = unconfirmed || current.unconfirmed ? 'write' : 'keep';
  return editBody(body, (lines) => applyFlagLine(lines, flagLineFor(merged), markerMode));
}

function refuseWithoutHuman(name, humanConfirmed) {
  if (humanConfirmed !== true) {
    throw new Error(`${name} refused: humanConfirmed must be exactly true, because narrowing or confirming a risk flag set is a human decision`);
  }
}

// Reading A: a line that reads unknown is not the line a human saw, so nothing is
// removed or confirmed until addRiskFlags has repaired it.
function currentReadableLine(name, body, extraCategories) {
  const current = parseRiskFlags(body, { extraCategories });
  if (current.status === 'unknown') {
    const error = new Error(`${name} refused: unreadable Risk-flags line (${current.reason}): ${JSON.stringify(current.raw)}; repair it with addRiskFlags first`);
    error.code = RISK_FLAGS_UNKNOWN;
    throw error;
  }
  return current;
}

// body, slug, { humanConfirmed, extraCategories } -> body. Drops one flag (`none` when it
// was the last) and the unconfirmed marker: a human decided the set. A slug the line does
// not carry returns the body unchanged.
function removeRiskFlag(body, slug, opts) {
  const { humanConfirmed, extraCategories = [] } = opts || {};
  refuseWithoutHuman('removeRiskFlag', humanConfirmed);
  const current = currentReadableLine('removeRiskFlag', body, extraCategories);
  if (typeof slug !== 'string') throw new TypeError(`removeRiskFlag: invalid slug ${JSON.stringify(slug)}`);
  if (!current.flags.includes(slug)) return toText(body);
  const rest = current.flags.filter((flag) => flag !== slug);
  return editBody(body, (lines) => applyFlagLine(lines, flagLineFor(rest), 'clear'));
}

// body, { humanConfirmed, extraCategories } -> body without the unconfirmed marker;
// byte-identical when there is none.
function confirmRiskFlags(body, opts) {
  const { humanConfirmed, extraCategories = [] } = opts || {};
  refuseWithoutHuman('confirmRiskFlags', humanConfirmed);
  currentReadableLine('confirmRiskFlags', body, extraCategories);
  return editBody(body, (lines) => {
    const { markerIdx } = scanPreamble(lines);
    if (markerIdx.length === 0) return null;
    const drop = new Set(markerIdx);
    return lines.filter((_, i) => !drop.has(i));
  });
}

function proofBullet(slugs) {
  const proofLines = slugs.map((slug) => `\`Proof(${slug}): …\``).join(', ');
  return `- Risk proof required: this record carries kept risk flags, so one plan step must contain, per slug, a line \`Proof(<slug>): <text>\` with a specific proof of at least 20 characters. Lines: ${proofLines}.`;
}

// lines, fence mask -> { heading, end } of the `## Gotchas` section (it ends at the next
// h1/h2 or the end of the body), or null.
function findGotchas(lines, fenced) {
  const heading = lines.findIndex((line, i) => !fenced[i] && GOTCHAS_HEADING_RE.test(line));
  if (heading === -1) return null;
  let end = lines.length;
  for (let i = heading + 1; i < lines.length; i += 1) {
    if (!fenced[i] && GOTCHAS_STOP_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { heading, end };
}

function dropLines(lines, drop) {
  const out = [];
  let justDropped = false;
  lines.forEach((line, i) => {
    if (drop.has(i)) {
      justDropped = true;
      return;
    }
    // A dropped bullet that stood alone between two blank lines leaves one, not two.
    if (justDropped && isBlank(line) && out.length > 0 && isBlank(out[out.length - 1])) {
      justDropped = false;
      return;
    }
    justDropped = false;
    out.push(line);
  });
  return out;
}

// Removes the `## Gotchas` section from lines, with the blank lines before it, so a
// section the bullet alone filled leaves no empty heading behind.
function dropSection(lines, { heading, end }, endsWithNewline) {
  let start = heading;
  while (start > 0 && isBlank(lines[start - 1])) start -= 1;
  const head = lines.slice(0, start);
  const tail = lines.slice(end);
  if (tail.length > 0) return head.length > 0 ? [...head, '', ...tail] : tail;
  if (head.length === 0) return [''];
  return endsWithNewline ? [...head, ''] : head;
}

function insertProofBullet(lines, fenced, bullet, endsWithNewline) {
  const gotchas = findGotchas(lines, fenced);
  if (gotchas) {
    let last = gotchas.heading;
    for (let i = gotchas.heading + 1; i < gotchas.end; i += 1) if (!isBlank(lines[i])) last = i;
    let at = last + 1;
    const block = [bullet];
    if (last === gotchas.heading) {
      if (at < lines.length && isBlank(lines[at])) at += 1;
      else block.unshift('');
    }
    if (at < lines.length && !isBlank(lines[at])) block.push('');
    return [...lines.slice(0, at), ...block, ...lines.slice(at)];
  }
  const before = lines.findIndex((line, i) => !fenced[i] && SECTION_BEFORE_RE.test(line));
  if (before !== -1) return [...lines.slice(0, before), '## Gotchas', '', bullet, '', ...lines.slice(before)];
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1])) end -= 1;
  const head = lines.slice(0, end);
  return [...head, ...(head.length > 0 ? [''] : []), '## Gotchas', '', bullet, ...(endsWithNewline ? [''] : [])];
}

// body, slugs -> body whose `## Gotchas` section carries exactly one `- Risk proof
// required:` bullet naming exactly `slugs` (canonical order): created at the end of the
// section, a new section placed before `## Breaking Change` / `## Original request`
// else at the end of the body; rewritten in place when it exists, so it widens and
// narrows with the kept set, byte-identical when already right; removed on `[]`, along
// with a Gotchas section it leaves empty. `[]` on a body without one is a no-op.
function appendRiskProofGotcha(body, slugs) {
  assertSlugs('appendRiskProofGotcha', slugs);
  const wanted = canonicalOrder(slugs);
  const bullet = wanted.length > 0 ? proofBullet(wanted) : null;
  return editBody(body, (lines) => {
    const endsWithNewline = lines[lines.length - 1] === '';
    const fenced = fencedLineMask(lines);
    const bulletIdx = lines.map((line, i) => (!fenced[i] && PROOF_BULLET_RE.test(line) ? i : -1)).filter((i) => i !== -1);
    if (bulletIdx.length === 0) return bullet === null ? null : insertProofBullet(lines, fenced, bullet, endsWithNewline);
    if (bullet !== null) {
      if (bulletIdx.length === 1 && lines[bulletIdx[0]] === bullet) return null;
      const out = lines.map((line, i) => (i === bulletIdx[0] ? bullet : line));
      return dropLines(out, new Set(bulletIdx.slice(1)));
    }
    const before = findGotchas(lines, fenced);
    const inGotchas = before !== null && bulletIdx.some((i) => i > before.heading && i < before.end);
    const out = dropLines(lines, new Set(bulletIdx));
    if (!inGotchas) return out;
    const after = findGotchas(out, fencedLineMask(out));
    const empty = after !== null && out.slice(after.heading + 1, after.end).every(isBlank);
    return empty ? dropSection(out, after, endsWithNewline) : out;
  });
}

module.exports = {
  RISK_FLAGS_NONE, RISK_FLAGS_UNKNOWN, parseRiskFlags, addRiskFlags, removeRiskFlag, confirmRiskFlags, appendRiskProofGotcha,
};
