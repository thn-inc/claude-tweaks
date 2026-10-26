// plugin/bin/lib/console/backfill.js — the Review Console backlog backfill's
// work list (#3950). Walks every closed run (acknowledged consoles included —
// an acknowledgement silenced the banner, it settled nothing) and turns each
// unresolved stored item into work items the apply step can settle. A legacy
// `decision:` item bundles a whole decisions.md line, which can carry several
// findings, so it is split into one item per finding with a content-derived
// `bf:` id. Read-only: the CLI's apply mode (backfill-apply.js) is the only
// console.json writer. Something that exists but cannot be read or parsed is
// named in `unreadable` and emits no items — never "no claim", never settled.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { classifyStagedItem, SHADOW_DUP_RE, SECTIONS, runIdOf, parseTiebreakLine } = require('./resolve');
const { digestTextOf } = require('./staged-digest-text');
const { UNRESOLVED_RESOLUTIONS } = require('./residue');
const { readRunState, isStaleClaim, RUN_ID_RE } = require('../hooks/context');
const { lstatType } = require('../path-guard');

// Staged review files that carry one finding of their own.
const STAGED_FINDING_RE = /^review-(unconfirmed|contested|debate)-/;

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
// Reporter severities a tiebreak could file at (unknown counts as medium).
const FILEABLE_SEVERITIES = new Set(['critical', 'high', 'medium']);
const LOCATION_RE = /([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/g;
const PATH_SHAPED_RE = /[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/;
// Reproduction meta describes how a finding was (not) reproduced, never the finding itself. It is
// stripped a whole clause at a time — a parenthetical clause (split at `,` `;`) that opens with one of
// these — never a single word inside a kept claim ("the agent field is reproduced from stdin" stays).
const META_CLAUSE_RE = /^(?:present in only one\b|partner agents?\b|single agent\b|single[- ]read\b|no findings\b|(?:one|both) agents?\b|agent [A-Z]\b|probed by (?:the |an? )?agents?\b|not reproduced\b|reproduc\w*\s+(?:by|agents?|pairs?)\b)/i;
// A producer note that is meta as a whole parenthetical: a ledger `reason-not-auto:` note and a
// cross-lens pointer (`same substance as … resolved Don't fix`).
const META_PAREN_RE = /^(?:reason-not-auto:|same substance as\b)/i;
const STAGED_FILE_RE = /staged\/([A-Za-z0-9_-]+\.(?:md|patch))/;
// A decisions.md line's log prefix (`- STAGED 10:00:00 — `).
const LOG_PREFIX_RE = /^-\s+(?:STAGED|AUTO)\s+\d{2}:\d{2}:\d{2}\s+—\s+/;
// The producer's own staging note, in any case and followed by any of `.` `:` `;` ` —` or nothing
// (`Staged to Review Console as low-confidence`, `both staged as low-confidence`, mid-sentence lowercase).
const STAGING_NOTE_RE = /(?:\bboth\s+)?\bstaged\s+(?:to\s+Review\s+Console\s+)?as\s+low-confidence\b(?:[.:;]|\s*—)?/gi;
const BOILERPLATE = [/not reproduced/g, STAGING_NOTE_RE, /Reversibility: \S+\./g, /Artifact: [^.]*\./g];
// A ledger-row reference is meta about the console's ledger, never about the finding (R17).
const LEDGER_REF_RE = /(?:\b[\w-]+\s+case\s*=\s*)?(?:\b(?:already|same\s+as)\s+)?\bledger\s+(?:rows?\s+|#)\d+\b\s*[,;]?/gi;
// A trailing clause outside parentheses that only points at the ledger (`— ledger row 8.`, `ledger item 4`,
// `same as ledger row 4 (observation)`, `same observation already ledgered as row 6 (observation)`) is meta too.
// It must be set off: by an em dash, by a sentence boundary (`.` `;` `,`) before it, or be the whole claim;
// "the resolver corrupts ledger row 4" is a claim about a ledger row. Only `(observation)` may follow it.
const TRAILING_LEDGER_RE = /(?:^|\s*—\s*|(?<=[.;,])\s+)(?:(?:same\s+as\s+)?ledger\s+(?:row|item)\s+\d+|same\s+observation\s+already\s+ledgered\s+as\s+row\s+\d+)(?:\s*\(observation\))?\s*\.?\s*$/i;
// What a multi-location list leaves in front of a claim: separators, `and`, and bare line refs (`:335`, `-133`,
// `/127`). A `/` is a separator only before whitespace or a ref (`/claude-tweaks:flow` keeps its slash). A bare ref
// right after a list separator (`/` `,` `;` `and`) or another ref is a continuation — never one after prose
// punctuation (`not reproduced: -1 is returned` keeps its `-1`); one that opens the claim is stripped only when a
// separator, another ref, `and` or the end follows it (`-1 is returned` is prose). Matched against trimmed text.
const LEAD_FRAGMENT_RE = /^(?:\s+|(?<=(?:[/,;]|\band|[:\-/]\d+(?:-\d+)?)\s*)[:\-/]\d+(?:-\d+)?|[:\-/]\d+(?:-\d+)?(?=\s*(?:$|[/,;.)—(]|[:\-/]\d)|\s+and\s*(?:$|[/,:.\-]))|\/(?=\s|:\d|$)|[,;:.)—](?!\d)|and\b(?=\s*(?:[/,:.\-]|$)))+/;

const defaultDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readdir: (p) => {
    try { return fs.readdirSync(p); } catch { return []; }
  },
  // The one listing that must not read a failure as "empty": a run dir's own entries.
  readdirStrict: (p) => fs.readdirSync(p),
  // Every path checked here is a file about to be read. Only `missing` is
  // absent: a symlink is read through, and a directory, other node or
  // unreadable leaf counts as present so the read throws and the console is
  // named unreadable rather than read as having no such file.
  exists: (p) => lstatType(p).type !== 'missing',
  isDir: (p) => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  },
};

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function backfillItemId({ runId, sourceKey, findingKey }) {
  return `bf:${sha256(`${runId}\n${sourceKey}\n${findingKey}`).slice(0, 16)}`;
}

function itemHashOf(storedItems) {
  return sha256(JSON.stringify(storedItems));
}

// Closed runs, newest first by basename, with scanUnresolvedConsoles' twin
// rules (session-residue.js): a top-level run is closed when its run-state is
// `clean` and its archive twin is neither clean nor freshly `archiving`; any
// other top-level run is live — reported, never walked — and its archive copy,
// when there is one, stands in. A basename in both places is walked once.
function enumerateRuns(pipelinesRoot, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const archiveRoot = path.join(pipelinesRoot, 'archive');
  const names = (dir) => new Set(d.readdir(dir).filter((n) => RUN_ID_RE.test(n) && d.isDir(path.join(dir, n))));
  const top = names(pipelinesRoot);
  const archived = names(archiveRoot);
  const closed = [];
  const live = [];
  for (const name of [...new Set([...top, ...archived])].sort().reverse()) {
    if (top.has(name)) {
      const twin = archived.has(name) ? readRunState(path.join(archiveRoot, name)) : null;
      const twinDone = Boolean(twin && (twin.status === 'clean' || (twin.status === 'archiving' && !isStaleClaim(twin))));
      if (!twinDone) {
        const runDir = path.join(pipelinesRoot, name);
        const state = readRunState(runDir);
        if (state && state.status === 'clean') { closed.push(runDir); continue; }
        live.push({ runDir, status: (state && state.status) || 'unknown' });
      }
    }
    if (archived.has(name)) closed.push(path.join(archiveRoot, name));
  }
  return { closed, live };
}

// A word has a letter: a bare line ref (`:335`) left by a location list is not one.
const wordCount = (text) => text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;

// Does a ledger-row reference sit at a clause boundary of its parenthetical? Before it: the start or a
// `,` `;` `:`. After it: the end, a `,` `;` `:`, or its own consumed `,`/`;` not followed by a
// conjunction. Anywhere else (`see ledger row 3 and the cell`, `ledger row 3, but cell empty`) it is
// part of a clause, and removing it would leave a fragment.
function ledgerRefAtBoundary(match, offset, whole) {
  const before = whole.slice(0, offset).trimEnd();
  const after = whole.slice(offset + match.length);
  const leftOk = before === '' || /[,;:]$/.test(before);
  const rightOk = /[,;]\s*$/.test(match) ? !/^\s*(?:and|but|or|so|yet)\b/i.test(after) : /^\s*(?:$|[,;:])/.test(after);
  return leftOk && rightOk;
}

// A parenthetical loses its ledger-row references (dropped whole when nothing else is left, or when a
// reference sat inside a clause), then its reproduction-meta clauses, and is dropped whole when fewer
// than 3 words remain; one with neither is kept as written. A whole-parenthetical producer note
// (META_PAREN_RE) is dropped.
function cleanParenthetical(inner) {
  if (META_PAREN_RE.test(inner.trim())) return '';
  let text = inner;
  let ledger = false;
  let fragment = false;
  text = text.replace(LEDGER_REF_RE, (m, offset, whole) => {
    ledger = true;
    if (!ledgerRefAtBoundary(m, offset, whole)) fragment = true;
    return '';
  });
  if (ledger) {
    if (fragment) return '';
    text = text.replace(/\s+/g, ' ').replace(/^[\s,;:]+|[\s,;]+$/g, '');
    if (wordCount(text) === 0 || /^(?:\b(?:and|or)\b|[\d#,;&\s])*$/i.test(text)) return '';
  }
  // Clauses with their separators: a meta clause goes with the separator in front of it (or, for the
  // first clause, the one after it).
  const parts = text.split(/([,;])/);
  const kept = [];
  let meta = false;
  for (let i = 0; i < parts.length; i += 2) {
    if (META_CLAUSE_RE.test(parts[i].trim())) { meta = true; continue; }
    if (kept.length) kept.push(parts[i - 1]);
    kept.push(kept.length ? parts[i] : parts[i].replace(/^\s+/, ''));
  }
  if (!meta) return `(${text})`;
  const stripped = kept.join('').replace(/\s+/g, ' ').trim();
  return wordCount(stripped) < 3 ? '' : `(${stripped})`;
}

// The whole segment is the claim: reproduction-meta parentheticals and the producer's
// boilerplate come out, whitespace squashes, the location-list fragments in front go, and a claim
// that is exactly one parenthetical (with at most a lone trailing `.`) is unwrapped.
function cleanSegment(segment) {
  // A ref glued to the location token (`path:125` + `-133`, `path:122` + `/127`, `path` + `:17`) is that location's own tail.
  let text = segment.replace(/^[:\-/]\d+(?:-\d+)?/, '').replace(/\(([^()]*)\)/g, (whole, inner) => cleanParenthetical(inner));
  for (const re of BOILERPLATE) text = text.replace(re, '');
  // A dropped parenthetical leaves ` .` behind: at the end it goes (so a lone parenthetical unwraps), mid-claim it closes up.
  text = text.replace(/\s+/g, ' ').trim().replace(TRAILING_LEDGER_RE, '').replace(LEAD_FRAGMENT_RE, '').replace(/[\s,;]+$/, '').replace(/\s+\.$/, '').replace(/\s+\.(?=\s)/g, '.').trim();
  const whole = /^\(([^()]*)\)\s*\.?$/.exec(text);
  return whole ? whole[1].trim() : text;
}

// `low-confidence` describes the staging, never a severity.
function severityOf(text) {
  const m = /\b(critical|high|medium|low|info)\b(?!-confidence)/.exec(text);
  return m ? m[1] : null;
}

// The location tokens that start a finding: never one inside a parenthetical.
// A `:N-M` range after the first split point starts a finding only when a list
// separator (`,` `;` `/` `)` `—` or `and`) sets it off; set in prose
// (`overlaps tests/b.test.js:79-88`) it is a cross-reference continuing the
// previous finding's claim.
const RANGE_STARTS_FINDING_RE = /(?:[,;/)—]|\band)\s*$/;
function splitPoints(line) {
  const depthAt = [];
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    depthAt[i] = depth;
    if (line[i] === '(') depth += 1;
    else if (line[i] === ')' && depth > 0) depth -= 1;
  }
  const points = [];
  // `occurrence` counts the earlier LOCATION_RE matches of the same path:line anywhere in the line
  // (inside parentheticals too), so it does not depend on which tokens are split points.
  const seen = new Map();
  for (const m of line.matchAll(LOCATION_RE)) {
    const occurrence = seen.get(m[0]) || 0;
    seen.set(m[0], occurrence + 1);
    if (depthAt[m.index] > 0) continue;
    const end = m.index + m[0].length;
    if (points.length > 0 && /^-\d/.test(line.slice(end)) && !RANGE_STARTS_FINDING_RE.test(line.slice(0, m.index))) continue;
    points.push({ path: m[1], line: Number(m[2]), occurrence, start: m.index, end });
  }
  return points;
}

// One legacy decisions.md line → its findings. A finding's claim is the text
// between its location and the next split point (or the line's end).
// `located` is every location the line names ({ lens, path, line, occurrence }), claim or not: a line whose
// findings all lack a claim keeps its locations for the no-claim item that stands for it.
function analyseLine(line) {
  const tokens = splitPoints(line);
  if (!tokens.length) {
    const m = PATH_SHAPED_RE.exec(line);
    if (!m) return { findings: [], noClaim: 'no-path', located: [] };
    tokens.push({ path: m[0], line: null, occurrence: 0, start: m.index, end: m.index + m[0].length });
  }
  const lensMatch = /lens\s+"?([A-Za-z0-9_-]+)/.exec(line);
  const lens = lensMatch ? lensMatch[1] : 'unknown';
  const findings = tokens.map((t, k) => {
    const cleaned = cleanSegment(line.slice(t.end, k + 1 < tokens.length ? tokens[k + 1].start : line.length));
    return { lens, path: t.path, line: t.line, occurrence: t.occurrence, claim: wordCount(cleaned) < 4 ? '' : cleaned, severity: severityOf(cleaned) };
  });
  const located = findings.map((f) => ({ lens: f.lens, path: f.path, line: f.line, occurrence: f.occurrence }));
  if (findings.every((f) => f.claim === '')) return { findings: [], noClaim: 'claim-empty', located };
  return { findings, noClaim: null, located };
}

function splitDecisionLine(line) {
  const { findings, noClaim } = analyseLine(line);
  return { findings, noClaim };
}

const reporterSeverity = (s) => (s && SEVERITIES.includes(s) ? s : 'medium');
const findingKindOf = (section) => (section === SECTIONS.CONTESTED ? 'contested' : 'unconfirmed');
// A split item's key names its location only — lens, path:line and which occurrence of that
// path:line in the line — never the split-point index or whether a claim came out empty, so a
// change to the claim heuristics never moves an id (`@`, never the retired index-keyed `#k`).
const findingKeyOf = (f) => `${f.lens}|${f.path}:${f.line}@${f.occurrence}`;
const locationOf = (f) => ({ lens: f.lens, path: f.path, line: f.line });

// A new-shape coordination id (`…#{8 hex}`) may carry a `-{n}` repeat suffix
// for a byte-identical repeated line; it names the same line, so it groups and
// matches without the suffix (resolve.js's coordinationItems).
const normalizeDecisionId = (id) => id.replace(/(#[0-9a-f]{8})-\d+$/, '$1');

// The new shape's hash pins one exact line. The old 58-character shape can
// match any line sharing that lead-in, so it skips the lines coordinationItems
// never made an item of (resolve.js): tiebreak verdicts, and lines naming a
// staged file that exists (that file is the item).
function decisionLineMatches(line, groupId, readStaged) {
  if (`decision:${line.slice(2, 60)}#${sha256(line).slice(0, 8)}` === groupId) return true;
  if (line.slice(2, 60) !== groupId.slice('decision:'.length)) return false;
  if (parseTiebreakLine(line)) return false;
  const named = STAGED_FILE_RE.exec(line);
  return !(named && readStaged(named[1]) !== null);
}

// The items one source line yields: a finding item per finding, or one no-claim
// item for a line with no path or no claim at all. A finding whose own claim is
// empty, on a line whose other findings have one, is its own no-claim item.
// A no-claim item from a located finding keeps the location (`finding: { lens, path, line }`, no
// claim): the digest line names the file. A line whose findings all lack a claim is one item keyed
// by its first location, the key its first finding has when it does carry a claim; a line with no
// path is keyed ''.
function lineItems(line, base, runId, section) {
  const split = analyseLine(line);
  if (split.noClaim) {
    const located = split.located.length ? { finding: locationOf(split.located[0]), locations: split.located.map(locationOf) } : {};
    const findingKey = split.located.length ? findingKeyOf(split.located[0]) : '';
    return [{ ...base, itemId: backfillItemId({ runId, sourceKey: line, findingKey }), kind: 'no-claim', noClaimReason: split.noClaim, ...located, context: line, bundleLine: line }];
  }
  return split.findings.map((f) => itemOfFinding({
    base, itemId: backfillItemId({ runId, sourceKey: line, findingKey: findingKeyOf(f) }), finding: f, claim: f.claim, section, line,
  }));
}

// One split finding as a work item: a finding item, or a claim-empty no-claim item keeping its location.
// The severity is read from the claim (the cleaned segment it came from names the same one).
function itemOfFinding({
  base, itemId, finding, claim, section, line, locations,
}) {
  if (claim === '') {
    return {
      ...base, itemId, kind: 'no-claim', noClaimReason: 'claim-empty', finding: locationOf(finding), ...(locations ? { locations } : {}), context: line, bundleLine: line,
    };
  }
  return {
    ...base,
    itemId,
    kind: 'finding',
    finding: { ...locationOf(finding), reporterSeverity: reporterSeverity(severityOf(claim)), kind: findingKindOf(section) },
    claimText: claim,
    context: line,
    bundleLine: line,
  };
}

// A stored `backfillFinding` ({ lens, path, line, claimText, locations? }) is the finding apply
// persisted the sibling as; it is used as written, never re-derived from the line.
function storedFinding(v) {
  if (!v || typeof v !== 'object' || typeof v.lens !== 'string' || typeof v.path !== 'string' || typeof v.claimText !== 'string') return null;
  if (!(v.line === null || Number.isInteger(v.line))) return null;
  const locations = Array.isArray(v.locations) && v.locations.every((l) => l && typeof l.path === 'string') ? v.locations : null;
  return { lens: v.lens, path: v.path, line: v.line, claimText: v.claimText, locations };
}

// A persisted split sibling (`bf:` id). With `backfillFinding` it is that finding. A legacy entry
// with only `backfillSource` is re-split and matched by id; when the re-split misses (the split
// heuristics changed since it was persisted) it is `split-drift`: a finding with a recorded line,
// judged as the whole line at the line's first location, or a no-claim item when the line names
// none. `source-line-not-found` is only for an entry with no line at all.
function persistedSplitItem(item, single, runId, section) {
  const id = item.id;
  const source = typeof item.backfillSource === 'string' ? item.backfillSource : null;
  const stored = storedFinding(item.backfillFinding);
  if (stored) {
    return itemOfFinding({
      base: single, itemId: id, finding: stored, claim: stored.claimText, section, line: source || id, locations: stored.locations || undefined,
    });
  }
  if (source === null) return { ...single, itemId: id, kind: 'no-claim', noClaimReason: 'source-line-not-found', context: id };
  const own = lineItems(source, single, runId, section).find((w) => w.itemId === id);
  if (own) return own;
  const first = analyseLine(source).located[0];
  const claim = cleanSegment(source.replace(LOG_PREFIX_RE, ''));
  if (!first || wordCount(claim) === 0) return { ...single, itemId: id, kind: 'no-claim', noClaimReason: 'split-drift', context: source, bundleLine: source };
  return { ...itemOfFinding({ base: single, itemId: id, finding: first, claim, section, line: source }), noClaimReason: 'split-drift' };
}

// The first location a text names: `{ path, line }` from a `path:line`, else `{ path, line: null }`
// from a path-shaped token, else null.
function firstLocation(text) {
  const loc = /([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/.exec(text);
  if (loc) return { path: loc[1], line: Number(loc[2]) };
  const shaped = PATH_SHAPED_RE.exec(text);
  return shaped ? { path: shaped[0], line: null } : null;
}

// A staged finding file's leading header block: the maximal run of `Key: value` lines from the top. The run
// counts only when it ends at a blank line or at end of file; a run that ends at prose is no header block.
// { title, body }: title is the block's `Title:` value (null when absent or empty); body is the text after
// the block, trimmed, or the whole text, trimmed, when there is no block (#4136). Header lines whose key
// is not a bookkeeping or claim key (`Invariant:`, `Lenses:`, `Target:` ...) carry content: they lead the
// body, in order, then a blank line, then the rest.
const STAGED_HEADER_LINE_RE = /^[A-Za-z][A-Za-z-]*:[ \t]/;
const STAGED_BOOKKEEPING_KEYS = new Set(['title', 'kind', 'finding', 'staged-at', 'ledger', 'severity', 'defers', 'defer-reason']);
function stagedHeaderOf(text) {
  const lines = text.split('\n');
  let end = 0;
  while (end < lines.length && STAGED_HEADER_LINE_RE.test(lines[end])) end += 1;
  if (end === 0 || (end < lines.length && lines[end].trim() !== '')) return { title: null, body: text.trim() };
  const header = lines.slice(0, end);
  const titleLine = header.find((l) => l.startsWith('Title:'));
  const title = titleLine ? titleLine.slice('Title:'.length).trim() : '';
  const kept = header.filter((l) => !STAGED_BOOKKEEPING_KEYS.has(l.slice(0, l.indexOf(':')).toLowerCase()));
  const rest = lines.slice(end + 1).join('\n').trim();
  return { title: title || null, body: [kept.join('\n'), rest].filter(Boolean).join('\n\n') };
}

// A staged finding file's claim and location come from the same place. A claim taken from the digest
// text (a table row, a paragraph) takes that row's or paragraph's location when it names one. A
// `Finding:` line keeps the file's first location, normally its `Location:`/`Target:` field (a path
// the claim mentions is often the other copy, not the finding's own).
function stagedFindingItem(name, text, base, itemId, section) {
  if (!firstLocation(text)) return { ...base, itemId, kind: 'no-claim', noClaimReason: 'no-path', context: text };
  const sev = /Severity:\s*(\w+)/.exec(text);
  const lens = /Lens:\s*([\w-]+)/.exec(text) || /lens\s+"?([\w-]+)/.exec(text);
  const findingLine = /^[-*\s]*Finding:\**\s*(.+)$/m.exec(text);
  // No `Finding:` line: the digest text (staged-digest-text.js), which skips a header block, metadata and a
  // table header; the joined text only when that yields nothing.
  const joined = () => text.split('\n').filter((l) => !/^\s*#/.test(l)).join(' ');
  const claim = (findingLine ? findingLine[1] : digestTextOf(text) || joined()).replace(/\s+/g, ' ').replace(/^[\s:;,.)]+/, '').trim();
  const loc = (!findingLine && firstLocation(claim)) || firstLocation(text);
  const where = { lens: lens ? lens[1] : 'unknown', path: loc.path, line: loc.line };
  if (!claim) return { ...base, itemId, kind: 'no-claim', noClaimReason: 'claim-empty', finding: where, context: text };
  const header = stagedHeaderOf(text);
  const stated = sev && SEVERITIES.includes(sev[1].toLowerCase()) ? sev[1].toLowerCase() : null;
  return {
    ...base,
    itemId,
    kind: 'finding',
    finding: {
      ...where,
      reporterSeverity: reporterSeverity(sev && sev[1].toLowerCase()),
      kind: /^review-unconfirmed-/.test(name) ? 'unconfirmed' : 'contested',
    },
    claimText: claim,
    context: text,
    stagedFinding: { title: header.title, body: header.body, severity: stated },
  };
}

// The work items of one console. `readStaged(name)` returns a staged file's
// text, or null when it is absent. `findings` is the run's review-findings.json
// (the tiebreak artifact), read for a `tiebreak:` item's claim.
function consoleWorkItems({ consoleDir, consoleJson, decisions, readStaged, runId, findings = [] }) {
  const stored = consoleJson && Array.isArray(consoleJson.items) ? consoleJson.items : [];
  const stagedLines = [...new Set(String(decisions || '').split('\n').filter((l) => l.startsWith('- STAGED ')))];
  const decisionLinesAll = String(decisions || '').split('\n');
  const unresolved = stored.map((item, index) => ({ item, index })).filter(({ item }) => item && UNRESOLVED_RESOLUTIONS.has(item.resolution));

  const groups = new Map();
  for (const { item, index } of unresolved) {
    if (typeof item.id !== 'string' || !item.id.startsWith('decision:')) continue;
    const key = normalizeDecisionId(item.id);
    groups.set(key, [...(groups.get(key) || []), index]);
  }

  const out = [];
  const emitted = new Set();
  for (const { item, index } of unresolved) {
    const id = item.id;
    const section = item.section;
    const single = { itemHash: itemHashOf([item]), section, consoleDir, storedIndices: [index] };
    if (typeof id === 'string' && id.startsWith('decision:')) {
      const key = normalizeDecisionId(id);
      if (emitted.has(key)) continue;
      emitted.add(key);
      const indices = groups.get(key);
      const base = { itemHash: itemHashOf(indices.map((i) => stored[i])), section, consoleDir, storedIndices: indices };
      const matched = stagedLines.filter((line) => decisionLineMatches(line, key, readStaged));
      if (!matched.length) {
        out.push({ ...base, itemId: backfillItemId({ runId, sourceKey: id, findingKey: '' }), kind: 'no-claim', noClaimReason: 'source-line-not-found', context: id });
        continue;
      }
      for (const line of matched) out.push(...lineItems(line, base, runId, section));
    } else if (typeof id === 'string' && id.startsWith('bf:')) {
      out.push(persistedSplitItem(item, single, runId, section));
    } else if (typeof id === 'string' && id.startsWith('tiebreak:')) {
      const tid = id.slice('tiebreak:'.length);
      const verdicts = decisionLinesAll.map((l) => ({ l, t: parseTiebreakLine(l) })).filter(({ t }) => t && t.id === tid);
      const v = verdicts.length ? verdicts[verdicts.length - 1] : null;
      const itemId = backfillItemId({ runId, sourceKey: id, findingKey: '' });
      if (!v) { out.push({ ...single, itemId, kind: 'no-claim', noClaimReason: 'source-line-not-found', context: id }); continue; }
      const entry = findings.find((f) => f && f.id === tid);
      const claim = entry && typeof entry.claim === 'string' ? entry.claim.replace(/\s+/g, ' ').trim() : '';
      if (!claim) { out.push({ ...single, itemId, kind: 'no-claim', noClaimReason: 'claim-empty', finding: { lens: v.t.lens, path: v.t.path, line: v.t.line }, context: v.l }); continue; }
      out.push({
        ...single,
        itemId,
        kind: 'finding',
        finding: { lens: v.t.lens, path: v.t.path, line: v.t.line, reporterSeverity: reporterSeverity(v.t.severity), kind: findingKindOf(section) },
        claimText: claim,
        context: v.l,
      });
    } else if (typeof id === 'string' && id !== '' && !id.includes(':')) {
      const itemId = backfillItemId({ runId, sourceKey: `staged/${id}`, findingKey: '' });
      const text = readStaged(id);
      if (text === null || text === undefined) {
        out.push({ ...single, itemId, kind: 'no-claim', noClaimReason: 'staged-file-absent', context: id });
      } else if (STAGED_FINDING_RE.test(id)) {
        out.push(stagedFindingItem(id, text, single, itemId, section));
      } else {
        const anchor = SHADOW_DUP_RE.exec(id);
        const anchorText = anchor ? readStaged(anchor[1]) : undefined;
        out.push({ ...single, itemId, kind: 'staged-kind', staged: { name: id, ...classifyStagedItem(id, text, anchorText) } });
      }
    } else {
      // An engine row ({row}:{label}) has no staged file and no finding.
      const name = typeof id === 'string' ? id : null;
      out.push({ ...single, itemId: backfillItemId({ runId, sourceKey: String(name), findingKey: '' }), kind: 'staged-kind', staged: { name, section, reason: 'engine-row' } });
    }
  }
  return out;
}

// Reads `file`: null when absent, else its text; throws when it exists but cannot be read.
function readIfPresent(d, file) {
  return d.exists(file) ? d.readFile(file) : null;
}

// A run's consoles: the run's own console.json, then each spec-*/console.json. Throws when
// the run dir cannot be listed (removed mid-call, unreadable): the caller names the run unreadable.
function consolePathsOf(runDir, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  return [path.join(runDir, 'console.json'), ...d.readdirStrict(runDir).filter((n) => /^spec-/.test(n)).sort().map((n) => path.join(runDir, n, 'console.json'))];
}

// One console's inputs, read fresh: { state: 'absent' } when it has no console.json,
// { state: 'unreadable', path } naming the file that exists but could not be read or
// parsed, else { state: 'ok', consoleDir, consoleJson, decisions, findings, readStaged,
// runId } — the arguments consoleWorkItems and backfill-apply.js's applyToConsole take.
function readConsole(consolePath, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const consoleDir = path.dirname(consolePath);
  let consoleJson;
  try {
    const raw = readIfPresent(d, consolePath);
    if (raw === null) return { state: 'absent' };
    consoleJson = JSON.parse(raw);
  } catch { return { state: 'unreadable', path: consolePath }; }
  if (!consoleJson || typeof consoleJson !== 'object') return { state: 'unreadable', path: consolePath };
  const decisionsPath = path.join(consoleDir, 'decisions.md');
  let decisions;
  try { decisions = readIfPresent(d, decisionsPath) || ''; } catch { return { state: 'unreadable', path: decisionsPath }; }
  // The tiebreak artifact: absent reads as []; present but unreadable, unparseable
  // or not an array makes the console unreadable rather than claimless.
  const findingsPath = path.join(consoleDir, 'review-findings.json');
  let findings;
  try {
    const raw = readIfPresent(d, findingsPath);
    findings = raw === null ? [] : JSON.parse(raw);
  } catch { findings = null; }
  if (!Array.isArray(findings)) return { state: 'unreadable', path: findingsPath };
  const readStaged = (name) => readIfPresent(d, path.join(consoleDir, 'staged', name));
  return { state: 'ok', consoleDir, consoleJson, decisions, findings, readStaged, runId: runIdOf(consoleDir) };
}

function buildWorkList({ pipelinesRoot, mainSha, deps = {} }) {
  const d = { ...defaultDeps, ...deps };
  const { closed, live } = enumerateRuns(pipelinesRoot, d);
  const runs = [];
  const unreadable = [];
  for (const runDir of closed) {
    const items = [];
    let consolePaths;
    try { consolePaths = consolePathsOf(runDir, d); } catch { unreadable.push(runDir); continue; }
    for (const consolePath of consolePaths) {
      const read = readConsole(consolePath, d);
      if (read.state === 'absent') continue;
      if (read.state === 'unreadable') { unreadable.push(read.path); continue; }
      try {
        items.push(...consoleWorkItems(read));
      } catch { unreadable.push(consolePath); }
    }
    runs.push({ runDir, items });
  }
  return { mainSha, runs, live, unreadable };
}

function summarize(workList) {
  const items = workList.runs.flatMap((r) => r.items);
  const byKind = { finding: 0, 'no-claim': 0, 'staged-kind': 0 };
  for (const it of items) byKind[it.kind] += 1;
  return {
    runs: workList.runs.filter((r) => r.items.length > 0).length,
    consoles: new Set(items.map((it) => it.consoleDir)).size,
    items: items.length,
    byKind,
    findingsMaxFiled: items.filter((it) => it.kind === 'finding' && FILEABLE_SEVERITIES.has(it.finding.reporterSeverity)).length,
  };
}

module.exports = {
  STAGED_FINDING_RE, enumerateRuns, splitDecisionLine, backfillItemId, itemHashOf, consoleWorkItems, consolePathsOf, readConsole, buildWorkList, summarize,
};
