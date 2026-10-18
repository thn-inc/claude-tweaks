// bin/lib/review-context/build.js — scratch-dir minting and context-bundle assembly for
// /claude-tweaks:review Step 3 (step3-lens-dispatch.md). Replaces the compound-shell bundle
// recipe: the shared context every lens agent reads is built here, off the main thread's
// context, at a collision-free path (refs #887).
// Per-file sections resolve against the repo toplevel, not process.cwd() (#3017) — run this
// CLI from any subdirectory of the checkout and every file still reads correctly.
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

// A file's content is inlined in its section only up to this many bytes (#3020); larger
// files get a one-line stub section, and an added/deleted file's oversize diff chunk is
// elided the same way. Both are reported in `oversizeSections`.
const PER_FILE_CAP_BYTES = 64 * 1024;

// Generated files whose content is never worth inlining, matched on basename.
const ALWAYS_STUB_BASENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
]);

// True for lockfiles and `*.jsonl` fixtures. Accepts `/`- or `\`-separated paths.
function isAlwaysStub(file) {
  const base = String(file).replace(/\\/g, '/').split('/').pop();
  return ALWAYS_STUB_BASENAMES.has(base) || base.endsWith('.jsonl');
}

// The repo-relative path of a `diff --git a/P b/P` header line, or null when it is not the
// plain same-path form (quoted path, rename, copy). `P` may contain spaces, so it is
// recovered from the line length rather than by splitting on whitespace.
function diffHeaderPath(line) {
  const s = line.slice('diff --git '.length);
  if (!s.startsWith('a/') || (s.length - 5) % 2 !== 0) return null;
  const p = s.slice(2, 2 + (s.length - 5) / 2);
  return s === `a/${p} b/${p}` ? p : null;
}

// Replace the hunk of each added or deleted file whose chunk is over the per-file cap, or
// that is always-stub, with one marker line. A modified file's hunks are never touched —
// they are the review's subject. Splitting on `diff --git` headers (which only ever start a
// line outside a hunk, since hunk lines begin with `+`, `-` or a space) rejoins losslessly.
function elideDiff(diff) {
  const elided = [];
  const text = diff
    .split(/^(?=diff --git )/m)
    .map((chunk) => {
      if (!chunk.startsWith('diff --git ')) return chunk;
      const nl = chunk.indexOf('\n');
      if (nl === -1) return chunk;
      const headerLine = chunk.slice(0, nl);
      const afterHeader = chunk.slice(nl + 1);
      // Extended header = the lines before the first hunk / file-marker / binary line.
      const bodyAt = afterHeader.search(/^(@@|---|Binary files|GIT binary patch)/m);
      const extended = bodyAt === -1 ? afterHeader : afterHeader.slice(0, bodyAt);
      if (!/^(new|deleted) file mode /m.test(extended)) return chunk;
      const file = diffHeaderPath(headerLine);
      if (file === null) return chunk;
      if (Buffer.byteLength(chunk) <= PER_FILE_CAP_BYTES && !isAlwaysStub(file)) return chunk;
      elided.push(file);
      return `${headerLine}\n[${Buffer.byteLength(afterHeader)} bytes of diff elided for ${file} — see oversizeSections]\n`;
    })
    .join('');
  return { text, elided };
}

// Bundle shape (unchanged from the shell recipe it replaces): the full diff first, then a
// `===== {file} =====` section per in-scope file holding its current working-tree content.
// A section can legitimately come out empty — a deleted file, or an unreadable path — and
// that degrades safely rather than silently: the full diff at the top still carries that
// file's change, and the section is reported in `emptySections`. An oversize or always-stub
// file's section is a one-line stub and an oversize added/deleted file's diff chunk is a
// one-line marker; both degrade the same way (the live file / the diff still carries the
// change) and are reported in `oversizeSections`. A modified file's hunks stay whole, so the
// bundle as a whole is not strictly bounded.
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

  // #3017: `files` are repo-root-relative paths (from `git diff --name-only`,
  // or a caller-supplied --files-from list following the same convention) —
  // reading them with the bare relative name resolves against process.cwd(),
  // which silently misses every file (landing the whole diff in
  // emptySections) whenever this CLI runs from a subdirectory of the
  // checkout. Resolve the repo toplevel once via the same injected `git`
  // this function already uses for the diff itself, so a test can fake both
  // without a real repo.
  const root = git(['rev-parse', '--show-toplevel']).trim();

  const emptySections = [];
  const oversize = new Set();
  const { text: diffText, elided } = elideDiff(diff);
  let out = diffText;
  for (const f of files) {
    out += `\n===== ${f} =====\n`;
    // The name matcher runs BEFORE the read, so a deleted lockfile counts as stubbed
    // (oversizeSections) rather than empty (emptySections), and a stubbed file is never read.
    if (isAlwaysStub(f)) {
      oversize.add(f);
      out += `[section omitted: ${f} — always stubbed (lockfile or .jsonl); its change is in the diff above — read the live file for full content]\n`;
      continue;
    }
    let content = '';
    try {
      content = readFile(path.join(root, f), 'utf8');
    } catch {
      emptySections.push(f);
    }
    // Size comes from the content just read — readFile stays the only file seam (no stat).
    const bytes = Buffer.byteLength(content);
    if (bytes > PER_FILE_CAP_BYTES) {
      oversize.add(f);
      out += `[section omitted: ${f} is ${bytes} bytes, over the ${PER_FILE_CAP_BYTES}-byte per-file cap; its change is in the diff above — read the live file for full content]\n`;
    } else {
      out += content;
    }
  }
  // An elided diff chunk can belong to a path outside a --files-from scope; still report it.
  for (const f of elided) oversize.add(f);
  const oversizeSections = [...oversize];

  const contextPath = path.join(dir, 'context.md');
  writeFile(contextPath, out);
  return { dir, contextPath, bytes: Buffer.byteLength(out), files: files.length, emptySections, oversizeSections };
}

module.exports = { resolveDir, buildContext, MAX_BUFFER, PER_FILE_CAP_BYTES, isAlwaysStub };
