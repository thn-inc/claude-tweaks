'use strict';
// Shared root-privilege predicate for permission-simulation tests (#1853).
//
// A test that simulates a permission failure via fs.chmodSync (an unreadable
// or unwritable directory, a mode-000 file, a permission-denied parent) can
// only exercise that failure as a normal user. Under a root-privileged test
// runner (`process.getuid() === 0` — the shape of a sandboxed cloud or CI
// harness; see CLAUDE.md's Cloud parity section) the kernel ignores mode
// bits entirely, the simulated denial never happens, and the assertion that
// expects it fails deterministically — not flakily, and not because
// anything is actually broken.
//
// IS_ROOT is the one predicate every such test reads, so a future permission
// test never re-derives (or omits) the check. skipUnderRoot(reason) returns
// node:test's `{ skip }` options-object shape: `{ skip: false }` when not
// root (never skipped), `{ skip: reason }` when root (skipped, with the
// reason rendered in the TAP output) — an explicit skip, never a silent
// early `return`, so a root sandbox's `npm test` reads honestly as "N
// skipped (root)" rather than a quietly-shrunk assertion count.
//
// Windows is the other runner where a chmod denial never happens: there
// fs.chmodSync only toggles the read-only attribute, so no mode-000 file or
// directory ever denies access, and statSync().mode & 0o777 reads back 0o666.
// chmodDenialSkip(reason) is the one predicate for a denial simulation — it
// skips on win32 (with WIN32_CHMOD_SKIP_REASON, whatever the root state) and
// under root (with the caller's reason), else `{ skip: false }`.
// MODE_BITS_HONORED guards a mode-bit read-back assertion (#4290).
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const WIN32_CHMOD_SKIP_REASON = 'win32: chmod does not deny access';
const MODE_BITS_HONORED = process.platform !== 'win32';

function skipUnderRoot(reason) {
  return { skip: IS_ROOT && reason };
}

function chmodDenialSkip(reason, { platform = process.platform, isRoot = IS_ROOT } = {}) {
  if (platform === 'win32') return { skip: WIN32_CHMOD_SKIP_REASON };
  return { skip: isRoot && reason };
}

module.exports = { IS_ROOT, skipUnderRoot, chmodDenialSkip, MODE_BITS_HONORED, WIN32_CHMOD_SKIP_REASON };
