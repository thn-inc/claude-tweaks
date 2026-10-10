// bin/lib/review-context/build.js — scratch-dir minting and context-bundle assembly for
// /claude-tweaks:review Step 3 (step3-lens-dispatch.md). Replaces the compound-shell bundle
// recipe: the shared context every lens agent reads is built here, off the main thread's
// context, at a collision-free path (refs #887).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Full diffs plus touched-file contents can reach tens of MB on long branches.
const MAX_BUFFER = 64 * 1024 * 1024;

function realGit(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...opts, windowsHide: true });
}

// Precedence: explicit --dir, then run-dir-scoped (per-run unique by construction),
// then a fresh mkdtemp dir (per-invocation unique by construction). Never a fixed
// shared /tmp name — two concurrent reviews clobbering each other's lens outputs is
// the defect this module exists to close.
function resolveDir({ dir, run, tmpdir = os.tmpdir(), mkdtemp = fs.mkdtempSync, mkdir = fs.mkdirSync } = {}) {
  if (dir) {
    mkdir(dir, { recursive: true });
    return dir;
  }
  if (run) {
    // No 'tmp' path segment (refs #1213) — a common Read(**/tmp/**) permissions.deny glob
    // matches any tmp/ segment, not only a leading system one, and blocked lens agents from
    // reading this bundle during #316's review.
    const scoped = path.join(run, 'review-ctx');
    mkdir(scoped, { recursive: true });
    return scoped;
  }
  return mkdtemp(path.join(tmpdir, 'review-ctx-'));
}

// Bundle shape (unchanged from the shell recipe it replaces): the full diff first, then a
// `===== {file} =====` section per in-scope file holding its current working-tree content.
// A section can legitimately come out empty — a deleted file, or an unreadable path — and
// that degrades safely rather than silently: the full diff at the top still carries that
// file's change, and the section is reported in `emptySections`.
function buildContext({
  base,
  branch,
  dir,
  filesFrom,
  git = realGit,
  readFile = fs.readFileSync,
  writeFile = fs.writeFileSync,
} = {}) {
  if (!base || !branch) throw new Error('buildContext: base and branch are both required');
  if (!dir) throw new Error('buildContext: dir is required (resolve it via resolveDir first)');
  const range = `${base}...${branch}`;
  const diff = git(['diff', range]);

  const filesText = filesFrom ? readFile(filesFrom, 'utf8') : git(['diff', range, '--name-only']);
  const files = filesText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const emptySections = [];
  let out = diff;
  for (const f of files) {
    out += `\n===== ${f} =====\n`;
    let content = '';
    try {
      content = readFile(f, 'utf8');
    } catch {
      emptySections.push(f);
    }
    out += content;
  }

  const contextPath = path.join(dir, 'context.md');
  writeFile(contextPath, out);
  return { dir, contextPath, bytes: Buffer.byteLength(out), files: files.length, emptySections };
}

module.exports = { resolveDir, buildContext, MAX_BUFFER };
