'use strict';
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
// Nothing under plugin/bin trips this today, but nothing enforces that.
function stripComments(src) {
  return src.replace(
    /'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`|(?<!\\)\/\*[\s\S]*?\*\/|(?<!\\)\/\/[^\n]*/g,
    (m) => (/^['"`]/.test(m) ? m : m.replace(/[^\n]/g, ' ')),
  );
}

module.exports = { stripComments };
