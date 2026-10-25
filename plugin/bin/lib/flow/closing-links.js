// bin/lib/flow/closing-links.js — finds and neutralizes GitHub closing-keyword
// phrases in PR body text (#4199). Pure: no I/O, no spawning, no clock — text
// in, text and offsets out.
//
// Why it exists: GitHub links every closing-keyword phrase anywhere in a PR
// body ("closes #N", "Fixes: #N", "resolves owner/repo#N", "Fixed: <issue
// URL>") and re-derives those links from the current body on every edit, so a
// phrase buried in a deferred-closure reason closed a record the run meant to
// leave open (PR #4144 closed #2724 that way). A phrase inside a code span is
// not a link, which is the unlink mechanism used here. The probe table that
// established both facts is in the plan, "Corrected premise", from probe PR
// #4234.
//
// Exports:
//   findClosingRefs(text, {owner, repo})           every link-making phrase, in order
//   neutralizeClosingPhrases(text, {targets, ...}) wraps chosen phrases in backticks
//   parseFixesSpan(body)                           reads the Fixes/Refs span a PR body carries
//   prRepoFromUrl(url)                             {host, owner, repo} of a PR URL
//   sameRepoNumbers(refs, {owner, repo})           same-repo numbers of closingIssuesReferences
'use strict';
const { CLOSING_KEYWORD_ALTERNATION } = require('../issue-branch-tracking');

// Keyword, optional ':', horizontal whitespace only (`[ \t]+`, never `\s+`, so
// "Fixes\n#5" is not a link), then one reference. Groups: 1 = bare #N;
// 2/3/4 = owner/repo#N; 5/6/7/8 = issue URL (host, owner, repo, N).
const CLOSING_SOURCE = '\\b' + CLOSING_KEYWORD_ALTERNATION + ':?[ \\t]+(?:'
  + '#(\\d+)'
  + '|([\\w.-]+)/([\\w.-]+)#(\\d+)'
  + '|https?://([^/\\s]+)/([\\w.-]+)/([\\w.-]+)/issues/(\\d+)'
  + ')';

// [start, end) ranges where a phrase is not a link: fenced blocks (lines whose
// trimmed start is ``` or ~~~, toggling, fence lines included) and inline code
// spans (a backtick run closed by the next run of equal length on one line).
function maskedRanges(text) {
  const ranges = [];
  let offset = 0;
  let fenceStart = -1;
  for (const line of text.split('\n')) {
    const lineEnd = offset + line.length;
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      if (fenceStart === -1) fenceStart = offset;
      else { ranges.push([fenceStart, lineEnd]); fenceStart = -1; }
    } else if (fenceStart === -1) {
      const runs = [...line.matchAll(/`+/g)];
      for (let i = 0; i < runs.length; i++) {
        const open = runs[i];
        const closeIdx = runs.findIndex((r, j) => j > i && r[0].length === open[0].length);
        if (closeIdx === -1) continue;
        const close = runs[closeIdx];
        ranges.push([offset + open.index, offset + close.index + close[0].length]);
        i = closeIdx;
      }
    }
    offset = lineEnd + 1;
  }
  if (fenceStart !== -1) ranges.push([fenceStart, text.length]);
  return ranges;
}

const sameRepo = (owner, repo, wantOwner, wantRepo) =>
  String(owner).toLowerCase() === String(wantOwner).toLowerCase()
  && String(repo).toLowerCase() === String(wantRepo).toLowerCase();

function findClosingRefs(text, { owner, repo } = {}) {
  const source = String(text);
  const masks = maskedRanges(source);
  const scoped = Boolean(owner && repo);
  const found = [];
  for (const m of source.matchAll(new RegExp(CLOSING_SOURCE, 'gi'))) {
    const start = m.index;
    if (masks.some(([a, b]) => start >= a && start < b)) continue;
    let number;
    if (m[1] !== undefined) number = Number(m[1]);
    else if (m[4] !== undefined) {
      if (scoped && !sameRepo(m[2], m[3], owner, repo)) continue;
      number = Number(m[4]);
    } else {
      if (scoped && !sameRepo(m[6], m[7], owner, repo)) continue;
      number = Number(m[8]);
    }
    found.push({ number, start, end: start + m[0].length, phrase: m[0] });
  }
  return found;
}

function neutralizeClosingPhrases(text, { targets = null, owner, repo } = {}) {
  const source = String(text);
  const wanted = targets === null ? null : new Set(targets.map(Number));
  const hits = findClosingRefs(source, { owner, repo }).filter((r) => wanted === null || wanted.has(r.number));
  let out = source;
  for (let i = hits.length - 1; i >= 0; i--) {
    const { start, end, phrase } = hits[i];
    out = out.slice(0, start) + '`' + phrase + '`' + out.slice(end);
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
    const r = ref && ref.repository;
    if (!r || !r.name || !r.owner || !r.owner.login) continue;
    if (sameRepo(r.owner.login, r.name, owner, repo)) numbers.add(Number(ref.number));
  }
  return [...numbers].sort((x, y) => x - y);
}

module.exports = {
  findClosingRefs, neutralizeClosingPhrases, parseFixesSpan, prRepoFromUrl, sameRepoNumbers,
};
