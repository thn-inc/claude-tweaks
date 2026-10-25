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
// What counts as code (CommonMark): fenced blocks (opener of 3+ backticks or
// tildes with at most 3 spaces of indent, a backtick fence's info string free
// of backticks; closer of the same character, at least as long, whitespace
// only after; an unclosed fence runs to the end of the text) and inline code
// spans. Inline spans are paragraph-scoped, not line-scoped: a paragraph is a
// run of non-blank lines outside fences that no block start interrupts (an
// ATX heading or thematic break is a one-line paragraph; a list-item or
// blockquote line starts a new one), and inside it a backtick run of
// length L opens a span that the next run of exactly length L closes; an
// unmatched run is literal. Indented code blocks are deliberately not masked
// (over-neutralizing is the safe direction).
//
// Neutralizing wraps a phrase in a backtick run whose length matches no
// backtick run already in its block region (the non-blank, non-fence lines
// around it; one backtick normally, two when single backticks are present, and
// so on), so the wrapper can never pair with a stray run, even under a renderer
// that pairs across a block start the splitter treats as a boundary. The result is re-scanned; `stillLive` lists any target number
// still found live, which should be empty in practice.
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
// "Fixes\n#5" is not a link), then one reference, not followed by a word
// character ("#5abc" is not a link). Groups: 1 = bare #N; 2/3/4 =
// owner/repo#N; 5/6/7/8 = issue URL (host, owner, repo, N).
const CLOSING_SOURCE = '\\b' + CLOSING_KEYWORD_ALTERNATION + ':?[ \\t]+(?:'
  + '#(\\d+)'
  + '|([\\w.-]+)/([\\w.-]+)#(\\d+)'
  + '|https?://([^/\\s]+)/([\\w.-]+)/([\\w.-]+)/issues/(\\d+)'
  + ')(?!\\w)';

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ATX_HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const BLOCKQUOTE_RE = /^ {0,3}>/;
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

// Pairs the backtick runs of one paragraph (text[start, end)) into inline code
// spans: a run of length L is closed by the next run of exactly length L; an
// unmatched run is literal and the scan moves on to the next run.
function paragraphSpans(text, start, end) {
  const runs = [...text.slice(start, end).matchAll(/`+/g)];
  const spans = [];
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i];
    const closeIdx = runs.findIndex((r, j) => j > i && r[0].length === open[0].length);
    if (closeIdx === -1) continue;
    const close = runs[closeIdx];
    spans.push([start + open.index, start + close.index + close[0].length]);
    i = closeIdx;
  }
  return spans;
}

const runLengths = (text, start, end) =>
  new Set([...text.slice(start, end).matchAll(/`+/g)].map((r) => r[0].length));

// Code regions of `text`: `masks` is a list of [start, end) ranges where a
// phrase is not a link (fenced blocks, inline spans); `paragraphs` carries
// each paragraph's offsets and the backtick run lengths of its whole block
// region (the non-blank, non-fence lines around it). Spans pair within a
// paragraph, but a wrapper must also avoid every run length in the region, so
// it stays safe if a renderer pairs across a block start we split on.
function codeRegions(text) {
  const masks = [];
  const paragraphs = [];
  let fence = null; // { ch, len, start }
  let parStart = -1;
  let parEnd = -1;
  let regionStart = -1;
  let regionEnd = -1;
  let regionParagraphs = [];
  const flush = () => {
    if (parStart === -1) return;
    masks.push(...paragraphSpans(text, parStart, parEnd));
    const paragraph = { start: parStart, end: parEnd, lengths: null };
    paragraphs.push(paragraph);
    regionParagraphs.push(paragraph);
    parStart = -1;
  };
  const endRegion = () => {
    flush();
    if (regionStart === -1) return;
    const lengths = runLengths(text, regionStart, regionEnd);
    for (const paragraph of regionParagraphs) paragraph.lengths = lengths;
    regionStart = -1;
    regionParagraphs = [];
  };
  let offset = 0;
  for (const raw of text.split('\n')) {
    const lineEnd = offset + raw.length;
    const line = raw.replace(/\r$/, '');
    if (fence) {
      const close = FENCE_CLOSE_RE.exec(line);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) {
        masks.push([fence.start, lineEnd]);
        fence = null;
      }
    } else {
      const open = FENCE_OPEN_RE.exec(line);
      if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
        endRegion();
        fence = { ch: open[1][0], len: open[1].length, start: offset };
      } else if (line.trim() === '') {
        endRegion();
      } else {
        if (regionStart === -1) regionStart = offset;
        regionEnd = lineEnd;
        // Block starts end the running paragraph (a backtick never pairs
        // across blocks); a heading or thematic break is a one-line block, so
        // the paragraph ends after it too. Splitting eagerly only
        // over-neutralizes, which is the safe direction.
        const singleLine = ATX_HEADING_RE.test(line) || THEMATIC_BREAK_RE.test(line);
        if (singleLine || LIST_ITEM_RE.test(line) || BLOCKQUOTE_RE.test(line)) flush();
        if (parStart === -1) parStart = offset;
        parEnd = lineEnd;
        if (singleLine) flush();
      }
    }
    offset = lineEnd + 1;
  }
  if (fence) masks.push([fence.start, text.length]);
  endRegion();
  return { masks, paragraphs };
}

const sameRepo = (owner, repo, wantOwner, wantRepo) =>
  String(owner).toLowerCase() === String(wantOwner).toLowerCase()
  && String(repo).toLowerCase() === String(wantRepo).toLowerCase();

function findClosingRefs(text, { owner, repo } = {}) {
  const source = String(text);
  const { masks } = codeRegions(source);
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
      // The URL form deliberately ignores the host: over-neutralizing is the
      // safe direction, and only owner/repo scope the match.
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
  const { paragraphs } = codeRegions(source);
  let out = source;
  for (let i = hits.length - 1; i >= 0; i--) {
    const { start, end, phrase } = hits[i];
    const par = paragraphs.find((p) => start >= p.start && start <= p.end);
    let len = 1;
    while (par && par.lengths.has(len)) len++;
    const tick = '`'.repeat(len);
    // A backtick right outside the wrapper would merge with it into a longer
    // run, so a space keeps the wrapper's length intact.
    const before = source[start - 1] === '`' ? ' ' : '';
    const after = source[end] === '`' ? ' ' : '';
    out = out.slice(0, start) + before + tick + phrase + tick + after + out.slice(end);
  }
  const live = new Set(findClosingRefs(out, { owner, repo })
    .map((r) => r.number)
    .filter((n) => wanted === null || wanted.has(n)));
  return {
    text: out,
    neutralized: hits.map(({ number, phrase }) => ({ number, phrase })),
    stillLive: [...live].sort((a, b) => a - b),
  };
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
