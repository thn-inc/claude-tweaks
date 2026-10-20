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
// safely. For a non-plain path, a template that wraps `{file}` in quotes
// (`"{file}"` on both platforms, also `'{file}'` on POSIX) has that wrapper
// replaced by this helper's own quoting; any other quote or escape character
// left in the template (or `${file}` on POSIX) refuses, because our quoting
// would nest inside it and the boundaries cannot be trusted. A control
// character in a path is refused on every platform: it can break the command
// line and cannot be quoted reliably.
'use strict';

const PLAIN_PATH = /^[A-Za-z0-9_@+:./-]+$/;
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

function substituteFile(template, file, { platform = process.platform } = {}) {
  if (PLAIN_PATH.test(file)) return { ok: true, command: template.split('{file}').join(file) };
  if (CONTROL_CHAR.test(file)) return { ok: false, reason: 'control-character' };
  if (platform === 'win32') {
    if (/["%!]/.test(file)) return { ok: false, reason: 'cmd-unquotable' };
    const bare = template.split('"{file}"').join('{file}');
    if (/["^]/.test(bare)) return { ok: false, reason: 'template-quotes' };
    return { ok: true, command: bare.split('{file}').join(`"${file}"`) };
  }
  const bare = template.split('"{file}"').join('{file}').split("'{file}'").join('{file}');
  if (/["'`\\]/.test(bare) || bare.includes('${file}')) return { ok: false, reason: 'template-quotes' };
  return { ok: true, command: bare.split('{file}').join(`'${file.replace(/'/g, "'\\''")}'`) };
}

module.exports = { substituteFile };
