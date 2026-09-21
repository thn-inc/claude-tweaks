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
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

function skipUnderRoot(reason) {
  return { skip: IS_ROOT && reason };
}

module.exports = { IS_ROOT, skipUnderRoot };
