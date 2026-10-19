'use strict';
const vm = require('node:vm');
// Shared literal-aware comment stripper for the source-scan conformance tests
// (#3536). Comments are blanked, never deleted: every non-newline character of a
// comment becomes a space, so offsets and line numbers stay stable. One
// left-to-right pass: a string or template literal is matched first and returned
// verbatim, so a `/*` or `//` inside a literal or inside a `//` comment can never
// open a fake comment that blanks real code. Both comment openers carry a
// `(?<!\\)` guard: a slash right after a backslash is an escaped slash, never a
// comment — a regex literal such as `/^origin\//` ends in one, and read as `//` it
// would blank the rest of its line. Regex literals are not modeled: a quote or
// backtick inside a regex can pair with a later literal, and an unescaped `/*` or
// `//` in a character class opens a comment. Either can blank code after it.
// `stripperVerdict` catches that: a blanked comment never breaks syntax, but blanked
// code cuts a literal short, so the stripped text stops compiling. Its caveat is that
// a mis-parse which still compiles goes unseen. The windows-hide, git-status and
// path-guard scans call it per file.
function stripComments(src) {
  return src.replace(
    /'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`|(?<!\\)\/\*[\s\S]*?\*\/|(?<!\\)\/\/[^\n]*/g,
    (m) => (/^['"`]/.test(m) ? m : m.replace(/[^\n]/g, ' ')),
  );
}

// Does `src` compile as a CommonJS module body? The wrapper matches how Node
// compiles a required file, so a hashbang and a top-level `return` are both valid.
// vm.Script compiles without running; a SyntaxError means "does not compile".
function compiles(src) {
  try {
    new vm.Script(
      '(function (exports, require, module, __filename, __dirname) {' + src.replace(/^#![^\n]*/, '') + '\n})',
    );
    return true;
  } catch (e) {
    if (e.name === 'SyntaxError') return false;
    throw e;
  }
}

// 'unparseable': the raw file does not compile, so no stripper verdict applies.
// 'misparsed': the raw file compiles but the stripped text does not, so the
// stripper blanked live code. 'ok': neither.
function stripperVerdict(raw, stripped = stripComments(raw)) {
  if (!compiles(raw)) return 'unparseable';
  if (!compiles(stripped)) return 'misparsed';
  return 'ok';
}

const STRIPPER_VERDICT_MESSAGES = {
  misparsed:
    'the comment stripper mis-parsed this file: the stripped text no longer compiles, so live code was blanked and cannot be scanned — see tests/helpers/strip-comments.js',
  unparseable:
    'this file does not compile as a CommonJS module, so the comment-stripper check cannot judge it — see tests/helpers/strip-comments.js',
};

module.exports = { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES };
