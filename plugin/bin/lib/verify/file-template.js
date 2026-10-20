// plugin/bin/lib/verify/file-template.js — the one `{file}` substitution for
// flaky retry and baseline templates (#3676). A test-file path comes from a
// runner's printed output, so it is untrusted and the template runs under a
// shell. A plain path substitutes byte-for-byte; any other path is quoted for
// the platform's shell or refused with a named reason. The template is never
// inspected for a plain path, and the value is spliced with split/join so a
// `$&` in a path is not a replacement pattern.
//
// Why the refusals exist: on win32, cmd.exe expands `%VAR%` even inside double
// quotes, and `"`/`!` cannot be escaped there, so such a path cannot be quoted
// safely. On POSIX, a template that already quotes `{file}` (or uses `${file}`,
// or backslashes) nests our quoting inside its own, so the quote boundaries
// cannot be trusted. A control character in a path is refused on every
// platform: it can break the command line and cannot be quoted reliably.
'use strict';

const PLAIN_PATH = /^[A-Za-z0-9_@+:./-]+$/;
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

function substituteFile(template, file, { platform = process.platform } = {}) {
  const splice = (value) => ({ ok: true, command: template.split('{file}').join(value) });
  if (PLAIN_PATH.test(file)) return splice(file);
  if (CONTROL_CHAR.test(file)) return { ok: false, reason: 'control-character' };
  if (platform === 'win32') {
    if (/["%!]/.test(file)) return { ok: false, reason: 'cmd-unquotable' };
    if (/["^]/.test(template)) return { ok: false, reason: 'template-quotes' };
    return splice(`"${file}"`);
  }
  if (/["'`\\]/.test(template) || template.includes('${file}')) return { ok: false, reason: 'template-quotes' };
  return splice(`'${file.replace(/'/g, "'\\''")}'`);
}

module.exports = { substituteFile };
