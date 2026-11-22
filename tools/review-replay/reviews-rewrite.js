'use strict';
// Pure string layer for the lens-reviewer replay: read the sha range out of an
// archived prompt, classify the run-directory paths it names, and rewrite the
// prompt so no archived sha, worktree path or main-checkout path survives.
// Main-checkout paths may contain spaces, so every match is prefix-based on the
// literal mainRoot, never whitespace tokenizing.
const { toPosix } = require('./schema.js');

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATH_END = '[^\\s"\'`)]';
const PIPELINES = '.claude-tweaks/pipelines/';
// The characters of a path-segment name. Keep it last in every class it joins: a `-` before
// it would turn into a range (`[.A-Z…_+-]` is right, `[A-Z…_+-.]` spans `+` to `.`).
const SEG = 'A-Za-z0-9_+-';
// A worktree name never ends in '.', so a sentence's full stop stays outside the match.
const WORKTREE_NAME = `[.${SEG}]*[${SEG}]`;
// A mention of a root is a whole path unless a path-continuation character follows: a name
// character, or a dot that starts one. Any other character (space, quote, `:` or `,` in a
// path list, sentence punctuation) ends it, so no separator can hide a leak.
const PATH_END_LOOKAHEAD = `(?![${SEG}]|\\.[${SEG}])`;
// The bare root is that whole-path mention with no `/` after it: `{mainRoot}/…` is never
// rewritten, so a main-checkout path that is not a worktree or a run input stays flagged.
const BARE_END = `(?![/${SEG}]|\\.[${SEG}])`;
// An outDir span runs only over path characters, so it stops at a separator (`,` `:` `;` `|`,
// whitespace, a quote or a bracket) instead of swallowing the next path in a list.
const OUT_TAIL = `(?:/[/.${SEG}]*|${PATH_END_LOOKAHEAD})`;
const SHA_TOKEN = '(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])';
// Forward slashes, no trailing slash: `M/` would build `M//` and blind every scan.
const normRoot = (p) => toPosix(p).replace(/\/+$/, '');
// Trailing `.,;:` removed by a backward scan: a `[.,;:]+$` regex is quadratic on a long dot run.
function trimPunct(s) {
  let end = s.length;
  while (end > 0 && '.,;:'.includes(s[end - 1])) end--;
  return s.slice(0, end);
}
// A root that normalises to '' (the filesystem root) would match everywhere.
function requireRoot(mainRoot) {
  const root = normRoot(mainRoot);
  if (!root) throw new Error('mainRoot must not be empty or the filesystem root');
  return root;
}

function rangeOf(text) {
  const t = String(text);
  const range = t.match(/\b([0-9a-f]{7,40})\.\.\.(?:HEAD\b|[0-9a-f]{7,40}\b)/);
  const baseWord = range ? null : t.match(/\bbase\s+([0-9a-f]{7,40})\b/i);
  const base = range ? range[1] : baseWord ? baseWord[1] : null;
  const dots = t.match(/\.\.\.([0-9a-f]{7,40})\b/);
  const headWord = dots ? null : t.match(/\bHEAD(?:\s+at)?\s+([0-9a-f]{7,40})\b/);
  const head = dots ? dots[1] : headWord ? headWord[1] : null;
  return { base, head };
}

function originRefsOf(text) {
  const out = [];
  for (const m of String(text).matchAll(/\borigin\/([A-Za-z0-9._\/-]+?)(?=\.\.\.|[\s`'"),]|$)/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function classify(rel) {
  if (rel.split('/').includes('..')) return null;
  if (/^(?:review-ctx|delta-ctx)\/context\.md$/.test(rel)) return 'bundle';
  if (/^work\/[^/]+\.md$/.test(rel)) return 'spec';
  if (/^context\/[^/]+\.md$/.test(rel)) return 'procedure';
  if (/^(?:review-ctx|delta-ctx)\/agent-scratch\/[^/,]+(?:\/[^,]*)?$/.test(rel)) return 'scratch';
  return null;
}

// Optional prefix: mainRoot, or a worktree under it. Group 1 = prefix presence
// is read from the matched text, group 2 = seg, group 3 = rest.
function runInputsOf(text, { mainRoot, runName, copy = false }) {
  const root = escapeRe(normRoot(mainRoot));
  const re = new RegExp(
    `(?:${root}/(?:\\.claude/worktrees/${WORKTREE_NAME}/)?)?\\.claude-tweaks/pipelines/([^/\\s"'\`)]+)/(${PATH_END}*)`,
    'g'
  );
  const inputs = [];
  const unknown = [];
  const seen = new Set();
  for (const m of String(text).matchAll(re)) {
    const stripped = trimPunct(m[2]);
    const match = m[0].slice(0, m[0].length - (m[2].length - stripped.length));
    const prefixed = !match.startsWith(PIPELINES);
    if (m[1] !== runName) {
      if (copy && !prefixed) continue;
      if (!unknown.includes(match)) unknown.push(match);
      continue;
    }
    if (seen.has(match)) continue;
    seen.add(match);
    const lead = stripped.match(/^(spec-\d+)\/(.*)$/);
    const member = lead ? lead[1] : null;
    const rel = lead ? lead[2] : stripped;
    const kind = classify(rel);
    if (!kind) {
      if (!unknown.includes(match)) unknown.push(match);
      continue;
    }
    inputs.push({ match, member, rel, kind });
  }
  return { inputs, unknown };
}

// The distinct worktree paths `{mainRoot}/.claude/worktrees/{name}` the text names, in text order.
function worktreePathsOf(text, { mainRoot }) {
  const re = new RegExp(`${escapeRe(requireRoot(mainRoot))}/\\.claude/worktrees/${WORKTREE_NAME}`, 'g');
  return [...new Set([...String(text).matchAll(re)].map((m) => m[0]))];
}

function stripEffortLines(text) {
  return String(text).replace(/^\[Effort: (?:low|medium|high|xhigh|max) — [^\]]*\][ \t\r]*$\n?/gm, '');
}

// Maps one sha token, or null when the map is empty.
function shaMapper(map) {
  const keys = Object.keys(map || {});
  if (!keys.length) return null;
  return (tok) => {
    const key = keys.find((k) => k.startsWith(tok));
    return key ? String(map[key]).slice(0, tok.length) : tok;
  };
}

function rewriteShas(text, map) {
  const mapSha = shaMapper(map);
  if (!mapSha) return String(text);
  return String(text).replace(new RegExp(SHA_TOKEN, 'g'), (tok) => mapSha(tok));
}

function rewriteText(text, { mainRoot, runName, repoPath, replacements = {}, shaMap = {} }) {
  const t = String(text);
  const root = escapeRe(requireRoot(mainRoot));
  const { inputs } = runInputsOf(t, { mainRoot, runName });
  // Longest match first so a path never loses its tail to a shorter one.
  const literals = [...new Set(inputs.map((i) => i.match))]
    .filter((m) => Object.prototype.hasOwnProperty.call(replacements, m))
    .sort((a, b) => b.length - a.length);
  const mapSha = shaMapper(shaMap);
  // One left-to-right pass, so no step re-matches text another substituted: a repoPath or
  // replacement value under mainRoot, or one carrying an archived sha prefix, stays as given.
  // At one position the alternatives try in order: run input, worktree, bare root, sha.
  const never = '((?!))'; // a group that never matches keeps the callback's group numbering
  const re = new RegExp([
    literals.length ? `(${literals.map(escapeRe).join('|')})` : never,
    `${root}/\\.claude/worktrees/${WORKTREE_NAME}`,
    `${root}${BARE_END}`,
    mapSha ? `(${SHA_TOKEN})` : never,
  ].join('|'), 'g');
  return t.replace(re, (m, lit, sha) => {
    if (lit !== undefined) return String(replacements[lit]);
    if (sha !== undefined) return mapSha(sha);
    return repoPath;
  });
}

function unrewrittenPaths(text, { mainRoot, runName, outDir }) {
  const t = String(text);
  const root = requireRoot(mainRoot);
  const out = outDir ? normRoot(outDir) : '';
  // The output directory is exempt only when it lies strictly under the main checkout; an
  // outDir equal to or containing mainRoot would hide every leak, so it fails closed.
  const skip = [];
  if (out && out.startsWith(root + '/')) {
    const spans = new RegExp(`${escapeRe(out)}${OUT_TAIL}`, 'g');
    for (const m of t.matchAll(spans)) skip.push([m.index, m.index + m[0].length]);
  }
  const re = new RegExp(
    `(?:${escapeRe(root)}|${escapeRe(PIPELINES + runName)})(?:/${PATH_END}*|${PATH_END_LOOKAHEAD})`, 'g');
  const found = [];
  let j = 0; // spans and mentions both arrive in text order, so one forward walk pairs them
  for (const m of t.matchAll(re)) {
    // Exempt only a mention that lies wholly inside an outDir span (sentence punctuation
    // aside), so `{outDir}:/etc` or a list joining another path is still flagged.
    const end = m.index + trimPunct(m[0]).length;
    while (j < skip.length && skip[j][1] <= m.index) j++;
    if (j < skip.length && skip[j][0] <= m.index && end <= skip[j][1]) continue;
    found.push(m[0]);
  }
  return found;
}

module.exports = { rangeOf, originRefsOf, runInputsOf, worktreePathsOf, stripEffortLines, rewriteShas, rewriteText, unrewrittenPaths };
