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
const WORKTREE_NAME = '[A-Za-z0-9._+-]+';

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
  if (/^(?:review-ctx|delta-ctx)\/context\.md$/.test(rel)) return 'bundle';
  if (/^work\/[^/]+\.md$/.test(rel)) return 'spec';
  if (/^context\/[^/]+\.md$/.test(rel)) return 'procedure';
  if (/^(?:review-ctx|delta-ctx)\/agent-scratch\/[^/]+(?:\/.*)?$/.test(rel)) return 'scratch';
  return null;
}

// Optional prefix: mainRoot, or a worktree under it. Group 1 = prefix presence
// is read from the matched text, group 2 = seg, group 3 = rest.
function runInputsOf(text, { mainRoot, runName, copy = false }) {
  const root = escapeRe(toPosix(mainRoot));
  const re = new RegExp(
    `(?:${root}/(?:\\.claude/worktrees/${WORKTREE_NAME}/)?)?\\.claude-tweaks/pipelines/([^/\\s"'\`)]+)/(${PATH_END}*)`,
    'g'
  );
  const inputs = [];
  const unknown = [];
  const seen = new Set();
  for (const m of String(text).matchAll(re)) {
    const stripped = m[2].replace(/[.,;:]+$/, '');
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

function stripEffortLines(text) {
  return String(text).replace(/^\[Effort: (?:low|medium|high|xhigh|max) — [^\]]*\]\s*$\n?/gm, '');
}

function rewriteShas(text, map) {
  const keys = Object.keys(map || {});
  if (!keys.length) return String(text);
  return String(text).replace(/\b[0-9a-f]{7,40}\b/g, (tok) => {
    const key = keys.find((k) => k.startsWith(tok));
    return key ? String(map[key]).slice(0, tok.length) : tok;
  });
}

function rewriteText(text, { mainRoot, runName, repoPath, replacements = {}, shaMap = {} }) {
  let out = String(text);
  const { inputs } = runInputsOf(out, { mainRoot, runName });
  // Longest match first so a path never loses its tail to a shorter one.
  const matches = [...new Set(inputs.map((i) => i.match))].sort((a, b) => b.length - a.length);
  for (const match of matches) {
    if (Object.prototype.hasOwnProperty.call(replacements, match)) out = out.split(match).join(replacements[match]);
  }
  const wt = new RegExp(`${escapeRe(toPosix(mainRoot))}/\\.claude/worktrees/${WORKTREE_NAME}`, 'g');
  out = out.replace(wt, () => repoPath);
  return rewriteShas(out, shaMap);
}

function unrewrittenPaths(text, { mainRoot, runName, outDir }) {
  const t = String(text);
  const skip = [];
  if (outDir) {
    for (const m of t.matchAll(new RegExp(`${escapeRe(toPosix(outDir))}/${PATH_END}*`, 'g'))) {
      skip.push([m.index, m.index + m[0].length]);
    }
  }
  const re = new RegExp(`(?:${escapeRe(toPosix(mainRoot))}/|${escapeRe(PIPELINES + runName)}/)${PATH_END}*`, 'g');
  const out = [];
  for (const m of t.matchAll(re)) {
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    out.push(m[0]);
  }
  return out;
}

module.exports = { rangeOf, originRefsOf, runInputsOf, stripEffortLines, rewriteShas, rewriteText, unrewrittenPaths };
