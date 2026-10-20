'use strict';

// A posix-only fake of a case-insensitive volume, for path-guard callers that
// accept an injected `fsImpl` (#3417, #3495). `entries` maps a CANONICAL
// absolute posix path to its kind: 'file', 'dir' (or 'directory'), or
// { type: 'symlink', target }. Lookup is by lowercased path. The JS
// `realpathSync` echoes the caller's casing (#3380); `realpathSync.native`
// returns the canonical key, as the OS does on such a volume. Only the four
// methods path-guard calls are provided, so an unexpected fs call throws.
//
// Posix-only by construction: a caller that runs path.resolve / path.join on
// win32 rewrites its literal paths (drive prefix, backslashes) and would miss
// every lookup, so those callers' tests skip on win32.
const path = require('node:path');

function caseInsensitiveFs(entries) {
  const key = (p) => path.posix.resolve(p).toLowerCase();
  const table = new Map(Object.entries(entries).map(([name, v]) => {
    const entry = typeof v === 'string' ? { type: v } : v;
    return [key(name), { name, ...entry, type: entry.type === 'dir' ? 'directory' : entry.type }];
  }));
  const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  const lookup = (p) => {
    const e = table.get(key(p));
    if (!e) throw enoent(p);
    return e;
  };
  const kindOf = (e) => ({
    isSymbolicLink: () => e.type === 'symlink',
    isFile: () => e.type === 'file',
    isDirectory: () => e.type === 'directory',
  });
  const lstatSync = (p) => kindOf(lookup(p));
  const realpathSync = (p) => {
    const e = lookup(p);
    return e.type === 'symlink' ? realpathSync(e.target) : p; // the JS form echoes the input casing
  };
  realpathSync.native = (p) => {
    const e = lookup(p);
    return e.type === 'symlink' ? realpathSync.native(e.target) : e.name; // the canonical casing
  };
  return {
    lstatSync,
    statSync: lstatSync,
    existsSync: (p) => table.has(key(p)),
    realpathSync,
  };
}

module.exports = { caseInsensitiveFs };
