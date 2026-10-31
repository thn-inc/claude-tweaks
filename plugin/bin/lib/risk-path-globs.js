// bin/lib/risk-path-globs.js
//
// Hand-rolled reader for the risk-path-globs block in policy.yml (#4609).
// bin/lib/policy-schema.js's parseFlatLines is deliberately flat-only, so this
// block needs its own reader, as model-profiles does (./model-profiles/policy-fragment.js).
// Pure: the caller passes the allowed slugs, and this file must not require
// ./policy-schema, which requires it. No YAML library — the plugin ships zero
// runtime npm deps.
'use strict';

// A YAML scalar that is not a string when written bare: a boolean, null, or a number.
const YAML_NON_STRING = /^(?:true|false|null|~|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|0x[0-9a-f]+|0o[0-7]+|[-+]?\.(?:inf|nan))$/i;

// True when every `close` in `text` follows a matching `open` and none is left open.
function isBalanced(text, open, close) {
  let depth = 0;
  for (const ch of text) {
    if (ch === open) depth += 1;
    else if (ch === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

// One glob element -> its string, or null when it is not an acceptable glob:
// empty, a nested list, a mapping (`k: v`, bare), a block-sequence dash, a
// block scalar, anchor or tag (`- a`, `|`, `>`, `&a`, `!t`), a non-string scalar
// (unless quoted), or braces that do not balance; a bare element's `[`/`]` must
// balance too (`src/[ab]/**` is a glob, `a]` is a typo). `*.sql` and `-x/**`
// are ordinary globs.
function acceptGlob(text, quoted) {
  if (text === '') return null;
  if (!quoted && (YAML_NON_STRING.test(text) || /^(?:-(?:\s|$)|[[{|>&!])/.test(text) || /:(\s|$)/.test(text))) return null;
  if (!quoted && !isBalanced(text, '[', ']')) return null;
  return isBalanced(text, '{', '}') ? text : null;
}

// The tokenizer's one quote rule: where the quote opening at text[i] closes, or
// -1 when none opens there. A quote opens only at the start of a token: at the
// start of the text, right after `[` or `,`, or after whitespace that follows
// `[`, `,`, `-` or nothing. It also needs a matching one after it, so an
// apostrophe inside a word, or a stray unmatched one, opens nothing. No escapes
// are read.
function quoteClose(text, i) {
  const ch = text[i];
  if (ch !== '"' && ch !== "'") return -1;
  const before = text.slice(0, i).trimEnd();
  const prev = before[before.length - 1];
  const opens = prev === undefined || prev === '[' || prev === ',' || (prev === '-' && before.length < i);
  return opens ? text.indexOf(ch, i + 1) : -1;
}

// One line with a trailing `# comment` cut: a `#` inside a quote is text, and
// a bare `#` starts a comment only after whitespace.
function stripComment(line) {
  for (let i = 0; i < line.length; i += 1) {
    const close = quoteClose(line, i);
    if (close !== -1) i = close;
    else if (line[i] === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

// Unclosed `[` in `text`, outside quotes (a negative result: a stray `]`).
function bracketDepth(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const close = quoteClose(text, i);
    if (close !== -1) i = close;
    else if (text[i] === '[') depth += 1;
    else if (text[i] === ']') depth -= 1;
  }
  return depth;
}

function skipSpace(text, i) {
  let at = i;
  while (at < text.length && /\s/.test(text[at])) at += 1;
  return at;
}

// One element starting at or after text[start] -> { text, quoted, next }, with
// `next` at the separator or the end of the text, or null when a quote never
// closes or has anything but the separator after it. A bare element runs to the
// separator; with a null separator (a sequence item) it runs to the end, so it
// may hold a comma, and a quoted one may have nothing after it.
function readElement(text, start, separator) {
  const i = skipSpace(text, start);
  if (text[i] === '"' || text[i] === "'") {
    const close = quoteClose(text, i);
    if (close === -1) return null;
    const next = skipSpace(text, close + 1);
    if (next < text.length && text[next] !== separator) return null;
    return { text: text.slice(i + 1, close), quoted: true, next };
  }
  const cut = separator === null ? -1 : text.indexOf(separator, i);
  const next = cut === -1 ? text.length : cut;
  return { text: text.slice(i, next).trim(), quoted: false, next };
}

// The inside of an inline `[…]` list -> [{ text, quoted }], or null when an
// element is malformed. A quoted element may hold a comma; a bare one is cut at
// every comma, so a brace group like {a,b} must be quoted. One trailing comma is
// tolerated (`[a, b,]`); a doubled one leaves an empty element, which acceptGlob
// rejects.
function splitInlineList(inner) {
  if (inner.trim() === '') return [];
  const items = [];
  let i = 0;
  for (;;) {
    const element = readElement(inner, i, ',');
    if (element === null) return null;
    items.push(element);
    if (element.next >= inner.length) return items;
    i = skipSpace(inner, element.next + 1); // past the comma
    if (i >= inner.length) return items; // the one trailing comma
  }
}

// risk-path-globs (#4609): a block mapping each risk slug to a glob list.
//   risk-path-globs:
//     migrations: [migrations/**, db/schema.rb]
//     public-contract:
//       - openapi/**
// parseFlatLines cannot see it (it skips indented lines), so this reads the
// block itself. Returns { present: false } when no line spells the key,
// { present: true, ok: true, value: {slug: [glob…]} }, or
// { present: true, ok: false, raw } when anything in the block is malformed —
// the caller then resolves null rather than a partial map. The block ends at the
// first non-blank, non-comment column-0 line. `allowedSlugs` are the slugs a row
// may name.
function parseRiskPathGlobs(policyRaw, allowedSlugs) {
  if (typeof policyRaw !== 'string') return { present: false };
  const lines = policyRaw.split('\n').map((line) => line.trimEnd()); // trimming also drops a CRLF's \r
  const spellsKey = (line) => /^\s*["']?risk-path-globs["']?\s*:/.test(line);
  const start = lines.findIndex(spellsKey);
  if (start === -1) return { present: false };
  const allowed = new Set(allowedSlugs);
  const blockEnd = (from) => {
    let stop = from + 1;
    while (stop < lines.length && (lines[stop] === '' || /^\s/.test(lines[stop]) || lines[stop].startsWith('#'))) stop += 1;
    return stop;
  };
  const end = blockEnd(start);
  // A column-0 `- x` ending the block is a root-level sequence, not a map, a
  // column-0 slug ending it is a row that lost its indent, and a second block is
  // ambiguous: reject all three rather than resolve {}. `raw` then also carries the
  // offending line or the second block.
  const slugLine = end < lines.length ? /^["']?([A-Za-z0-9_-]+)["']?\s*:/.exec(lines[end]) : null;
  const strayEnds = end < lines.length && (/^-(\s|$)/.test(lines[end]) || (slugLine !== null && allowed.has(slugLine[1])));
  const second = lines.findIndex((line, i) => i >= end && spellsKey(line));
  const fail = () => {
    const parts = [lines.slice(start, strayEnds ? end + 1 : end)];
    if (second !== -1) parts.push(lines.slice(second, blockEnd(second)));
    return { present: true, ok: false, raw: parts.map((part) => part.join('\n').trimEnd()).join('\n') };
  };
  if (strayEnds || second !== -1) return fail();

  // Only the exact column-0 spelling is read (`"risk-path-globs":` is the same key
  // in YAML, so it must not read as absent), and nothing but a comment may follow
  // the colon: an inline value is not a block.
  if (!/^risk-path-globs:\s*(?:#.*)?$/.test(lines[start])) return fail();

  const value = {};
  let rowIndent = null; // every row shares the first row's indent
  let open = null; // the row whose value is empty, collecting `- item` lines at one indent
  for (let i = start + 1; i < end; i += 1) {
    const line = stripComment(lines[i]);
    if (line === '') continue;
    const row = /^(\s+)([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line);
    const item = /^(\s+)-(?:\s+(.*))?$/.exec(line);
    if (row) {
      if (open && open.list.length === 0) return fail(); // `slug:` with no sequence under it
      const slug = row[2];
      if (rowIndent === null) rowIndent = row[1].length;
      if (row[1].length !== rowIndent || !allowed.has(slug) || Object.prototype.hasOwnProperty.call(value, slug)) return fail();
      value[slug] = [];
      open = null;
      let rest = (row[3] || '').trim();
      if (rest === '') {
        open = { list: value[slug], indent: null };
      } else if (rest.startsWith('[')) {
        // A flow list may continue over following lines until its brackets balance
        // (a last element like `src/*.[ch]` ends in `]` without closing the list).
        while (bracketDepth(rest) > 0) {
          i += 1;
          if (i >= end) return fail();
          rest += ` ${stripComment(lines[i]).trim()}`;
        }
        const elements = splitInlineList(rest.slice(1, -1));
        if (elements === null) return fail();
        for (const { text, quoted } of elements) {
          const glob = acceptGlob(text, quoted);
          if (glob === null) return fail();
          value[slug].push(glob);
        }
      } else {
        return fail();
      }
    } else if (item && open && item[1].length >= rowIndent) {
      if (open.indent === null) open.indent = item[1].length;
      else if (item[1].length !== open.indent) return fail(); // uneven sequence indent
      const element = readElement((item[2] || '').trim(), 0, null); // null: `"a" "b"`, or a quote never closed
      const glob = element === null ? null : acceptGlob(element.text, element.quoted);
      if (glob === null) return fail();
      open.list.push(glob);
    } else {
      return fail();
    }
  }
  if (open && open.list.length === 0) return fail();
  return { present: true, ok: true, value };
}

module.exports = { parseRiskPathGlobs };
