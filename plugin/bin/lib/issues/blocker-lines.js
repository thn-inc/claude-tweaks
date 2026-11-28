// bin/lib/issues/blocker-lines.js
// Pure: the one definition of the three `Blocked by` body-line forms (#6374) —
//   Blocked by #N                                   (this repository)
//   Blocked by owner/name#N                         (another repository)
//   Blocked by: {part} (left for owner/name)        (a part not yet filed)
// Every parser (record-dependencies.js, cross-repo-refs.js, plan-line.js,
// design-session/parts.js, ambiguity-resolve.js) imports its regex from here.
// Two read scopes, on purpose: the symbolic form is read through authoredText (fences and code
// spans stripped, stopping at `## Original request`), as readyRestorable always read it; the `#N`
// and `owner/name#N` forms keep the raw-body grammar they had before #6374 (parseDependencies and
// cross-repo-refs.js apply LOCAL_/FOREIGN_BLOCKER_LINE_RE to the raw body). So a fenced
// `Blocked by #N` still holds a record, and a fenced symbolic line does not.
// No network. Requires only ./materialize-format (for authoredText); keep it that way —
// record-payload.js loads materialize-format at load time, so it must never
// require this file at top level.
'use strict';

const { authoredText } = require('./materialize-format');

// The four exported *_LINE_RE / *_ASSUMPTION_RE regexes are `g`/`m`-flagged, so they carry
// `lastIndex` state: use them with `matchAll` / `String.prototype.match` only, never `.test()` or
// `.exec()`. (AC1.1 pins their source and flags to the regexes they replaced.)

// Line-anchored 'Blocked by #N' dependency declarations (multiline).
const LOCAL_BLOCKER_LINE_RE = /^Blocked by #(\d+)\b/gm;

// Line-anchored 'Blocked by #N: {text}' assumption declarations (multiline) —
// a separate, additive sibling to LOCAL_BLOCKER_LINE_RE, never a modification
// of it. The line regex already stops matching at the number, so a trailing
// ': {text}' parses under it with zero changes; this regex only exists to
// capture that trailing text when a caller wants it.
const LOCAL_BLOCKER_ASSUMPTION_RE = /^Blocked by #(\d+):[ \t]*(.+)$/gm;

// The owner class starts with an alphanumeric (GitHub's rule), so no ref can begin with '-' and
// become a leading-'--' argv element when a key is passed to a CLI.
const FOREIGN_BLOCKER_LINE_RE = /^Blocked by ([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)#(\d+)\b/gm;

const REPO = '[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+';
// A symbolic blocker line, `Blocked by: {part} (left for {owner/name})` (a list bullet allowed):
// group 1 = part, group 2 = repository.
const SYMBOLIC_BLOCKER_LINE_RE = new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?Blocked by: (.+) \\(left for (${REPO})\\)[ \\t]*$`, 'gm');
// The same line as one non-global test, for isBlockerLine.
const SYMBOLIC_ONE_LINE_RE = new RegExp(SYMBOLIC_BLOCKER_LINE_RE.source);
// The two `#N` forms as non-global tests, derived from the line regexes above so one edit moves both.
const LOCAL_ONE_LINE_RE = new RegExp(LOCAL_BLOCKER_LINE_RE.source);
const FOREIGN_ONE_LINE_RE = new RegExp(FOREIGN_BLOCKER_LINE_RE.source);

// One line matches any of the three forms.
function isBlockerLine(line) {
  if (typeof line !== 'string') return false;
  return LOCAL_ONE_LINE_RE.test(line) || FOREIGN_ONE_LINE_RE.test(line) || SYMBOLIC_ONE_LINE_RE.test(line);
}

// A symbolic blocker's name: the text after `Blocked by: `. The one producer;
// design-session/parts.js's symbolicRef delegates here.
function symbolicBlockerRef({ part, repository }) {
  return `${part} (left for ${repository})`;
}

// The symbolic blockers of a body, read from its authored text only (before
// `## Original request`, code spans and fences stripped), in first-appearance
// order, deduplicated on part plus case-insensitive repository.
function symbolicBlockers(body) {
  if (typeof body !== 'string' || body === '') return [];
  const seen = new Set();
  const out = [];
  for (const m of authoredText(body).matchAll(SYMBOLIC_BLOCKER_LINE_RE)) {
    const key = `${m[1]}\u0000${m[2].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ part: m[1], repository: m[2] });
  }
  return out;
}

const symbolicBlockerRefs = (body) => symbolicBlockers(body).map(symbolicBlockerRef);

const hasSymbolicBlocker = (body) => symbolicBlockers(body).length > 0;

module.exports = {
  LOCAL_BLOCKER_LINE_RE, LOCAL_BLOCKER_ASSUMPTION_RE, FOREIGN_BLOCKER_LINE_RE, SYMBOLIC_BLOCKER_LINE_RE,
  REPO, isBlockerLine, symbolicBlockerRef, symbolicBlockers, symbolicBlockerRefs, hasSymbolicBlocker,
};
