// plugin/bin/lib/console/memory-write.js — the pure half of an automatic memory write (#4620, control
// mode): resolve a target inside the memory directory, hash the prior content, and compose a reversible
// whole-file diff. The caller (console-resolve.js --memory-write) reads the prior and does every write.
//
// This writes outside the repository, so containment goes through path-guard only: `resolveWithin`
// follows symlinks and fails closed, so `../x`, an absolute path elsewhere and a symlink pointing out
// are all `outside-memory-dir`. A target that does not exist yet (a create) is resolved through its
// parent directory, which must exist.
'use strict';

const crypto = require('crypto');
const path = require('path');
const { resolveWithin, lstatType, canonicalRealpath } = require('../path-guard');

const MEMORY_DIFF_CAP_BYTES = 20 * 1024;
const NO_NEWLINE = '\\ No newline at end of file';
// The reverse of a memory write. `core.autocrlf=false` because `git apply` writes through autocrlf even
// outside a repository, so a Windows default would restore CRLF bytes (#5694).
const MEMORY_REVERT_COMMAND = 'git -c core.autocrlf=false apply -R --unidiff-zero';

function splitLines(text) {
  if (text === '') return { lines: [], noNewline: false };
  const noNewline = !text.endsWith('\n');
  const lines = text.split('\n');
  if (!noNewline) lines.pop();
  return { lines, noNewline };
}

function range(sign, count) { return count === 0 ? `${sign}0,0` : `${sign}1,${count}`; }

// A single-hunk unified diff replacing the whole file: `MEMORY_REVERT_COMMAND` on it restores `oldText`.
function wholeFileDiff(name, oldText, newText) {
  const old = oldText === null ? { lines: [], noNewline: false } : splitLines(oldText);
  const next = splitLines(newText);
  const out = [oldText === null ? '--- /dev/null' : `--- a/${name}`, `+++ b/${name}`, `@@ ${range('-', old.lines.length)} ${range('+', next.lines.length)} @@`];
  for (const l of old.lines) out.push(`-${l}`);
  if (old.noNewline) out.push(NO_NEWLINE);
  for (const l of next.lines) out.push(`+${l}`);
  if (next.noNewline) out.push(NO_NEWLINE);
  return `${out.join('\n')}\n`;
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// { memoryDir, target } -> { ok: true, path, name } | { ok: false, why }. `target` may be relative to
// memoryDir. The returned path is canonical (symlinks resolved), the one to read and write.
function resolveMemoryTarget({ memoryDir, target }) {
  const rootReal = canonicalRealpath(memoryDir);
  if (rootReal === null) return { ok: false, why: 'memory-dir-unreadable' };
  const abs = path.resolve(memoryDir, target);
  const leaf = lstatType(abs);
  let resolved = null;
  if (leaf.type === 'missing') {
    const parentPath = path.dirname(abs);
    const parent = resolveWithin(parentPath, memoryDir);
    if (parent === null && lstatType(parentPath).type === 'missing') {
      // The parent does not exist: it is `parent-missing` only when its nearest existing ancestor is inside
      // the memory dir; an escape keeps `outside-memory-dir`.
      let ancestor = path.dirname(parentPath);
      while (lstatType(ancestor).type === 'missing' && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
      return { ok: false, why: resolveWithin(ancestor, memoryDir) !== null ? 'parent-missing' : 'outside-memory-dir' };
    }
    if (parent !== null) resolved = path.join(parent, path.basename(abs));
  } else if (leaf.type === 'file' || leaf.type === 'symlink') {
    resolved = resolveWithin(abs, memoryDir);
  }
  if (resolved === null) return { ok: false, why: 'outside-memory-dir' };
  // A symlink whose target is a directory or other non-file never reads as a memory file.
  if (lstatType(resolved).type === 'directory') return { ok: false, why: 'outside-memory-dir' };
  return { ok: true, path: resolved, name: path.relative(rootReal, resolved).split(path.sep).join('/') };
}

function planMemoryWrite({ memoryDir, target, content, priorText }) {
  const r = resolveMemoryTarget({ memoryDir, target });
  if (!r.ok) return { ok: false, why: r.why };
  const diff = wholeFileDiff(r.name, priorText, content);
  return {
    ok: true,
    path: r.path,
    priorHash: priorText === null ? 'none' : sha256(priorText),
    diff,
    overCap: Buffer.byteLength(diff) > MEMORY_DIFF_CAP_BYTES,
  };
}

module.exports = { MEMORY_DIFF_CAP_BYTES, MEMORY_REVERT_COMMAND, wholeFileDiff, resolveMemoryTarget, planMemoryWrite, sha256 };
