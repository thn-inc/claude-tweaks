'use strict';
// Single-quotes a path for a Bash command fixture (#4281).
//
// The PreToolUse guards read each word's real bash value, as Git Bash does on
// Windows. An unquoted native path loses its backslashes there
// (`D:\a\_temp\x` reaches the guard as `D:a_tempx`, a drive-relative path no
// real session sends), so a fixture that interpolates a temp path unquoted
// fails on win32 only. A POSIX single-quoted word keeps every character
// literal; an embedded `'` closes the quote, adds an escaped `\'`, and reopens
// it. Unlike a double-quoted fixture, this also survives a `$`, backtick or
// `"` in the path.
function shellQuote(p) {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

module.exports = { shellQuote };
