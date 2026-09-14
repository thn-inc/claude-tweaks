// bin/lib/design-detect/surface-lines.js — the design-surface gate design-wrapper's
// review mode Step 3.8 (b) runs before selecting a craft critic (#1863): a
// control-flow-only diff in a file Layer 3 already classified as frontend
// (fetch/refresh logic in a .tsx component, say) has no design surface for a
// craft critic to judge. This module answers "did any changed line actually
// touch JSX/TSX markup, CSS/style, a template file, or user-facing copy?"
// from a unified diff, so Step 3.8 (b) can skip the dispatch entirely when
// the answer is no — the same posture Layer 3 already takes for files that
// aren't frontend at all (frontend-detection.md).
//
// Heuristic, not a parser: a real JSX/TSX/CSS/template classifier would need
// a full AST. This is a line-level regex classifier, deliberately biased
// toward false positives (dispatch the critic when unsure) over false
// negatives (skip a real UI change) — the incident this closes is about
// wasted context on a diff with zero UI content, not about narrowly gating
// real UI diffs.
'use strict';
const path = require('path');

// Extensions whose *any* changed line counts as a surface change outright —
// style and template files have no "control-flow-only" line, unlike a
// component file that mixes JSX with hooks/fetch/conditionals.
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);
const TEMPLATE_EXTENSIONS = new Set(['.html', '.vue', '.svelte']);
const JSX_EXTENSIONS = new Set(['.jsx', '.tsx']);

// A curated list of common HTML/SVG tag names — deliberately not "any
// lowercase identifier before `<`", which would also match a TypeScript
// generic (`Array<string>`, `useRef<HTMLDivElement>(null)`) and produce a
// false "surface" read on a pure control-flow line.
const HTML_TAGS = [
  'div', 'span', 'p', 'a', 'button', 'input', 'img', 'ul', 'ol', 'li', 'form',
  'label', 'section', 'header', 'footer', 'nav', 'table', 'thead', 'tbody',
  'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'svg', 'path',
  'textarea', 'select', 'option', 'br', 'hr', 'main', 'article', 'aside',
  'figure', 'figcaption', 'strong', 'em', 'b', 'i', 'small', 'pre', 'code',
  'blockquote', 'video', 'audio', 'canvas', 'dialog', 'iframe',
];

const COMPONENT_TAG_RE = /<\/?[A-Z][\w.]*(\s[^<>]*)?\/?>/; // <Button>, </Button>, <Foo.Bar />
const HTML_TAG_RE = new RegExp(`<\\/?(?:${HTML_TAGS.join('|')})(?:\\s[^<>]*)?\\/?>`, 'i');
const JSX_FRAGMENT_RE = /<>|<\/>/;
const JSX_ATTR_RE = /\b(className|style)\s*=/;
// Rendered text between two tags, e.g. `>Save changes<` — no `{`/`}` inside,
// since a brace there is a JS expression slot, not literal copy.
const JSX_TEXT_RE = />[^<>{}\n]+</;

// A capitalized TypeScript generic type argument (`useRef<HTMLDivElement>(null)`,
// `useState<Foo>(x)`) matches COMPONENT_TAG_RE's shape exactly — both are
// `<Identifier>` — and is the one real ambiguity a line-level regex can't
// resolve structurally. The disambiguator: a generic's closing `>` is
// immediately followed by the call's `(`; a JSX component's closing `>` is
// followed by more markup, text, or end of line. Excluding only the
// immediately-followed-by-`(` shape keeps real self-closing/opening
// component tags (`<Foo />`, `<Foo>`) matching while dropping the generic-call case.
function matchesExcludingGenericCall(re, line) {
  const m = re.exec(line);
  if (!m) return false;
  const nextChar = line[m.index + m[0].length];
  return nextChar !== '(';
}

function classifyFileKind(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const base = path.basename(normalized).toLowerCase();
  if (/\.module\.\w+$/i.test(base)) return 'style'; // CSS-module-shaped filename, any extension
  const ext = path.extname(normalized).toLowerCase();
  if (STYLE_EXTENSIONS.has(ext)) return 'style';
  if (TEMPLATE_EXTENSIONS.has(ext)) return 'template';
  if (JSX_EXTENSIONS.has(ext)) return 'jsx';
  return 'other';
}

// True when a single diff-content line (the `+`/`-` prefix already
// stripped) touches JSX markup, a className/style attribute, or a rendered
// text node — the surface signal inside a .jsx/.tsx file. Imports, hooks,
// fetch/API calls, and plain conditionals do not match.
function lineHasJsxSurface(line) {
  const l = String(line || '');
  return (
    matchesExcludingGenericCall(COMPONENT_TAG_RE, l) ||
    HTML_TAG_RE.test(l) ||
    JSX_FRAGMENT_RE.test(l) ||
    JSX_ATTR_RE.test(l) ||
    JSX_TEXT_RE.test(l)
  );
}

// True when a changed line (content only, kind already resolved from the
// file path) counts toward the design-surface gate.
function isSurfaceLine(content, kind) {
  if (kind === 'style' || kind === 'template') return true;
  if (kind === 'jsx') return lineHasJsxSurface(content);
  return false; // 'other' — a non-JSX/style/template file never trips this gate
}

// Parses a unified diff (`git diff -U0` output, or any diff with hunks) into
// a per-file surface verdict. Never throws on malformed input — an
// unparseable diff simply yields no files, which the caller (Step 3.8 (b))
// treats as "no surface change" per this gate's fail-open-toward-skipping
// posture only when the caller already knows files changed; see the CLI's
// own doc comment for how an empty diff is surfaced distinctly.
function analyzeDiff(diffText) {
  const text = typeof diffText === 'string' ? diffText : '';
  const lines = text.length ? text.split(/\r?\n/) : [];
  const order = [];
  const files = new Map();
  let current = null;

  for (const line of lines) {
    const gitHeader = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    const plusHeader = /^\+\+\+ b\/(.+)$/.exec(line);
    const file = gitHeader ? gitHeader[1] : plusHeader ? plusHeader[1] : null;
    if (file) {
      current = file;
      if (!files.has(current)) {
        files.set(current, { file: current, kind: classifyFileKind(current), surface: false, changedLines: 0 });
        order.push(current);
      }
      continue;
    }
    if (!current) continue;
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@') || line.startsWith('diff --git') || line.startsWith('index ')) continue;
    if (line.startsWith('+') || line.startsWith('-')) {
      const entry = files.get(current);
      const content = line.slice(1);
      entry.changedLines += 1;
      if (isSurfaceLine(content, entry.kind)) entry.surface = true;
    }
  }

  return order.map((f) => files.get(f));
}

// The one entry point Step 3.8 (b) calls (via the CLI below): true iff any
// changed file in the diff has at least one surface line.
function hasSurfaceChange(diffText) {
  return analyzeDiff(diffText).some((f) => f.surface);
}

module.exports = {
  STYLE_EXTENSIONS,
  TEMPLATE_EXTENSIONS,
  JSX_EXTENSIONS,
  classifyFileKind,
  lineHasJsxSurface,
  isSurfaceLine,
  analyzeDiff,
  hasSurfaceChange,
};
