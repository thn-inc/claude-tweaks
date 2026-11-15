'use strict';
// Shared literal-aware comment stripper (#3536, #3585, #3903). Callers reach it two
// ways: the source-scan conformance tests through tests/helpers/strip-comments.js
// (which re-exports `stripComments` and itself defines the `stripperVerdict` compile
// oracle; its header keeps the caller list tests/strip-comments-callers-twin.test.js
// pins), and plugin code by requiring this file directly (today
// plugin/bin/lib/code-health/candidates-experiment-cleanup.js's `normalizeBranch`
// and plugin/bin/lib/code-health/candidates-scale-readiness.js's brace tracker,
// #3903). Comments are blanked, never deleted:
// every non-newline character of a comment becomes a space, so offsets and line numbers
// stay stable.
//
// One left-to-right scanner models string literals, template literals (their
// nested `${…}` code is scanned recursively) and regex literals, and keeps each
// verbatim — a quote, backtick, `//` or `/*` inside one stays code and never opens
// a fake string or comment. A hashbang first line is kept as is. An unterminated
// string, template, regex or block comment ends at the end of its line or of the
// input and never throws. Template nesting is recursed into only MAX_TEMPLATE_DEPTH
// levels deep; past that a `${` is plain template text, so a pathological file
// cannot overflow the stack. `{ literals: 'blank' }` also blanks string, template-text
// and regex literal bodies, for operator scans that must not read literal text as
// code (a `\` directly before a newline, a string's line continuation, stays); the
// default `'keep'` leaves them verbatim. Any other `literals` value throws a TypeError.
//
// Whether a `/` that is not a comment opener begins a regex or is division follows
// the previous significant token: a regex after nothing, after a punctuator other
// than `)`, `]`, `}`, `++` or `--`, or after one of the keywords in REGEX_KEYWORDS
// (unless that word follows a `.`, so a property named `return` is just a word);
// division after a literal, an identifier or number, or `)`, `]`, `}`, `++`, `--`
// (a regex can never follow a postfix `++`/`--`, so `i++ / 2` is division).
//
// Known ambiguity: a `/` right after `)` or `}` is read as division, so a regex
// there — `if (x) /re/.test(y)`, or one opening a statement after a block-closing
// `}` — is misread. The stripper also runs over a project's own JS/TS through the
// code-health generators named above, so no survey of plugin/bin or tests/ can rule
// that shape out. A plugin caller gets no mis-parse signal, so it must treat its scan
// as a heuristic. The source-scan tests' backstop is `stripperVerdict` in
// tests/helpers/strip-comments.js: it catches only the compile-breaking direction,
// where blanked code cuts a literal short and the stripped text stops compiling. A
// misread that still compiles goes unseen: it can keep a comment's text, or blank text
// inside a multi-line template literal.
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const LITERAL = { kind: 'literal' };
const MAX_TEMPLATE_DEPTH = 100;

function isIdentChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch) || (ch >= '\u0080' && !/\s/.test(ch));
}

function isPunct(token, value) {
  return token !== null && token.kind === 'punct' && token.value === value;
}

// Does a `/` after `prev` (the previous significant token) begin a regex literal?
function slashStartsRegex(prev) {
  if (prev === null) return true;
  if (prev.kind === 'literal') return false;
  if (prev.kind === 'word') return REGEX_KEYWORDS.has(prev.value) && !prev.afterDot;
  if (prev.value === '++' || prev.value === '--') return false;
  return !')]}'.includes(prev.value);
}

// End index of the string literal opening at `i`: just past its closing quote, or
// at a newline (not consumed) or the end of input when it is unterminated. The
// body between the quotes is handed to `blankBody`.
function scanString(src, i, blankBody) {
  const quote = src[i];
  const bodyStart = i + 1;
  i = bodyStart;
  while (i < src.length && src[i] !== quote && src[i] !== '\n') {
    if (src[i] !== '\\') i++;
    else i += src[i + 1] === '\r' && src[i + 2] === '\n' ? 3 : 2; // a CRLF continuation is one escape
  }
  const bodyEnd = Math.min(i, src.length);
  blankBody(bodyStart, bodyEnd);
  return src[bodyEnd] === quote ? bodyEnd + 1 : bodyEnd;
}

// End index of the regex literal opening at `i`: just past its flags, or at a
// newline (not consumed) or the end of input when it is unterminated. A `/` inside
// a `[…]` class or after a backslash does not end it. The body between the slashes
// is handed to `blankBody`; the slashes and flags are not.
function scanRegex(src, i, blankBody) {
  let inClass = false;
  const bodyStart = i + 1;
  i++;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') {
      blankBody(bodyStart, i);
      return i;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      blankBody(bodyStart, i);
      i++;
      while (i < src.length && isIdentChar(src[i])) i++;
      return i;
    }
    i++;
  }
  blankBody(bodyStart, src.length);
  return src.length;
}

function stripComments(src, { literals = 'keep' } = {}) {
  if (literals !== 'keep' && literals !== 'blank') {
    throw new TypeError(`stripComments: literals must be 'keep' or 'blank', got ${String(literals)}`);
  }
  const out = src.split('');
  const n = src.length;
  const blank = (start, end) => {
    for (let k = start; k < end; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // A literal body blanks like a comment, except a `\` directly before a newline (a
  // string's line continuation, LF or CRLF) stays: blanking it would leave an
  // unterminated string.
  const keepsContinuation = (k) =>
    (src[k] === '\\' && (src[k + 1] === '\n' || (src[k + 1] === '\r' && src[k + 2] === '\n'))) ||
    (src[k] === '\r' && src[k - 1] === '\\' && src[k + 1] === '\n');
  const blankLiteral = (start, end) => {
    for (let k = start; k < end; k++) {
      if (out[k] === '\n' || keepsContinuation(k)) continue;
      out[k] = ' ';
    }
  };
  const blankBody = literals === 'blank' ? blankLiteral : () => {};

  // Scans code from `i`. With `inBrace`, the `}` that closes the enclosing `${`
  // ends the scan. Returns the index to resume at.
  function scanCode(i, inBrace) {
    let prev = null;
    let depth = 0;
    while (i < n) {
      const ch = src[i];
      if (ch === '/' && src[i + 1] === '/') {
        const nl = src.indexOf('\n', i);
        const end = nl === -1 ? n : nl;
        blank(i, end);
        i = end;
      } else if (ch === '/' && src[i + 1] === '*') {
        const close = src.indexOf('*/', i + 2);
        const end = close === -1 ? n : close + 2;
        blank(i, end);
        i = end;
      } else if (ch === "'" || ch === '"') {
        i = scanString(src, i, blankBody);
        prev = LITERAL;
      } else if (ch === '`') {
        i = scanTemplate(i);
        prev = LITERAL;
      } else if (ch === '/') {
        if (slashStartsRegex(prev)) {
          i = scanRegex(src, i, blankBody);
          prev = LITERAL;
        } else {
          prev = { kind: 'punct', value: '/' };
          i++;
        }
      } else if (/\s/.test(ch)) {
        i++;
      } else if (isIdentChar(ch)) {
        let end = i + 1;
        while (end < n && isIdentChar(src[end])) end++;
        prev = { kind: 'word', value: src.slice(i, end), afterDot: isPunct(prev, '.') };
        i = end;
      } else {
        if (ch === '{') depth++;
        else if (ch === '}') {
          if (inBrace && depth === 0) return i + 1;
          if (depth > 0) depth--;
        }
        const doubled = (ch === '+' || ch === '-') && isPunct(prev, ch) && src[i - 1] === ch;
        prev = { kind: 'punct', value: doubled ? ch + ch : ch };
        i++;
      }
    }
    return n;
  }

  // Scans the template literal opening at `i`, recursing into each `${…}` up to
  // MAX_TEMPLATE_DEPTH levels deep.
  let templateDepth = 0;
  function scanTemplate(i) {
    i++;
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') {
        blankBody(i, Math.min(i + 2, n));
        i += 2;
      } else if (ch === '`') return i + 1;
      else if (ch === '$' && src[i + 1] === '{' && templateDepth < MAX_TEMPLATE_DEPTH) {
        templateDepth++;
        i = scanCode(i + 2, true);
        templateDepth--;
      } else {
        blankBody(i, i + 1);
        i++;
      }
    }
    return n;
  }

  let start = 0;
  if (src.startsWith('#!')) {
    const nl = src.indexOf('\n');
    start = nl === -1 ? n : nl;
  }
  scanCode(start, false);
  return out.join('');
}

module.exports = { stripComments };
