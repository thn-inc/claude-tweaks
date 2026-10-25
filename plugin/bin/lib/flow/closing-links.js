// bin/lib/flow/closing-links.js — finds and neutralizes GitHub closing-keyword
// phrases in PR body text (#4199). Pure: no I/O, no spawning, no clock — text
// in, text and offsets out.
//
// Why it exists: GitHub links every closing-keyword phrase anywhere in a PR
// body ("closes #N", "Fixes: #N", "resolves owner/repo#N", "Fixed: <issue
// URL>") and re-derives those links from the current body on every edit, so a
// phrase buried in a deferred-closure reason closed a record the run meant to
// leave open (PR #4144 closed #2724 that way).
//
// No markdown masking, on purpose. A phrase inside a code span or fenced block
// is not a link, but deciding that means modelling CommonMark's block rules,
// and every such model errs in the unsafe direction (a phrase it believes is
// code that GitHub still links). So `findClosingRefs` reports every keyword
// phrase it sees, code or not, a superset of what GitHub links.
//
// Neutralizing inserts the word "issue " between the keyword and the
// reference: "closes #5" becomes "closes issue #5". The grammar requires the
// reference directly after the keyword's whitespace, so the result can never
// re-match, and probe PR #4234 rows 8-10 showed GitHub does not link
// "closes issue #4233", "resolves issue owner/repo#4233" or "Fixed: issue
// <issue URL>" either. Every other byte stays identical, CRLF included. The
// probe table is in the plan, "Corrected premise" (rows 1-7 there, 8-10 in
// the redesign ruling).
//
// Exports:
//   findClosingRefs(text, {owner, repo})           every link-making phrase, in order
//   neutralizeClosingPhrases(text, {targets, ...}) inserts "issue " before chosen references
//   parseFixesSpan(body)                           reads the Fixes/Refs span a PR body carries
//   prRepoFromUrl(url)                             {host, owner, repo} of a PR URL
//   sameRepoNumbers(refs, {owner, repo})           same-repo numbers of closingIssuesReferences
'use strict';
const { CLOSING_KEYWORD_ALTERNATION } = require('../issue-branch-tracking');

// Keyword, optional ':', horizontal whitespace only (`[ \t]+`, never `\s+`, so
// "Fixes\n#5" is not a link), then one reference, not followed by a word
// character ("#5abc" is not a link). Groups: 1 = the whole reference; 2 = bare
// #N; 3/4/5 = owner/repo#N; 6/7/8/9 = issue URL (host, owner, repo, N).
const CLOSING_SOURCE = '\\b' + CLOSING_KEYWORD_ALTERNATION + ':?[ \\t]+('
  + '#(\\d+)'
  + '|([\\w.-]+)/([\\w.-]+)#(\\d+)'
  + '|https?://([^/\\s]+)/([\\w.-]+)/([\\w.-]+)/issues/(\\d+)'
  + ')(?!\\w)';

function sameRepo(owner, repo, wantOwner, wantRepo) {
  return String(owner).toLowerCase() === String(wantOwner).toLowerCase()
    && String(repo).toLowerCase() === String(wantRepo).toLowerCase();
}

// Every phrase, in document order. `start`/`end` span keyword through
// reference; `refStart` is where the reference itself begins (an internal
// field `neutralizeClosingPhrases` uses; it is not part of the documented
// shape callers rely on).
function scanClosingRefs(text, { owner, repo } = {}) {
  const source = String(text);
  const scoped = Boolean(owner && repo);
  const found = [];
  for (const m of source.matchAll(new RegExp(CLOSING_SOURCE, 'gi'))) {
    let number;
    if (m[2] !== undefined) number = Number(m[2]);
    else if (m[5] !== undefined) {
      if (scoped && !sameRepo(m[3], m[4], owner, repo)) continue;
      number = Number(m[5]);
    } else {
      // The URL form deliberately ignores the host: over-neutralizing is the
      // safe direction, and only owner/repo scope the match.
      if (scoped && !sameRepo(m[7], m[8], owner, repo)) continue;
      number = Number(m[9]);
    }
    const end = m.index + m[0].length;
    found.push({ number, start: m.index, end, phrase: m[0], refStart: end - m[1].length });
  }
  return found;
}

function findClosingRefs(text, opts) {
  return scanClosingRefs(text, opts).map(({ number, start, end, phrase }) => ({ number, start, end, phrase }));
}

function neutralizeClosingPhrases(text, { targets = null, owner, repo } = {}) {
  const source = String(text);
  const wanted = targets === null ? null : new Set(targets.map(Number));
  const hits = scanClosingRefs(source, { owner, repo }).filter((r) => wanted === null || wanted.has(r.number));
  let out = source;
  for (let i = hits.length - 1; i >= 0; i--) {
    out = out.slice(0, hits[i].refStart) + 'issue ' + out.slice(hits[i].refStart);
  }
  return { text: out, neutralized: hits.map(({ number, phrase }) => ({ number, phrase })) };
}

const SPAN_MARKERS = [
  ['[claude-tweaks-fixes-start]', '[claude-tweaks-fixes-end]'],
  ['<!-- fixes-start -->', '<!-- fixes-end -->'],
];

function parseFixesSpan(body) {
  const source = String(body);
  for (const [open, close] of SPAN_MARKERS) {
    const a = source.indexOf(open);
    if (a === -1) continue;
    const b = source.indexOf(close, a + open.length);
    if (b === -1) continue;
    const fixes = [];
    const refs = [];
    for (const raw of source.slice(a + open.length, b).split('\n')) {
      const line = raw.replace(/\r$/, '');
      const fix = /^Fixes #(\d+)\s*$/.exec(line);
      if (fix) { fixes.push(Number(fix[1])); continue; }
      const ref = /^Refs #(\d+)\b/.exec(line);
      if (ref) refs.push(Number(ref[1]));
    }
    return { found: true, fixes, refs };
  }
  return { found: false, fixes: [], refs: [] };
}

function prRepoFromUrl(url) {
  const m = /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/.exec(String(url));
  return m ? { host: m[1], owner: m[2], repo: m[3] } : null;
}

function sameRepoNumbers(refs, { owner, repo }) {
  const numbers = new Set();
  for (const ref of refs || []) {
    if (!ref || !Number.isInteger(ref.number) || ref.number <= 0) continue;
    const r = ref.repository;
    if (!r || !r.name || !r.owner || !r.owner.login) continue;
    if (sameRepo(r.owner.login, r.name, owner, repo)) numbers.add(ref.number);
  }
  return [...numbers].sort((x, y) => x - y);
}

module.exports = {
  findClosingRefs, neutralizeClosingPhrases, parseFixesSpan, prRepoFromUrl, sameRepoNumbers,
};
