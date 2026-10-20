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
const { splitNul } = require('../git-z');

// Full diffs plus touched-file contents can reach tens of MB on long branches.
const MAX_BUFFER = 64 * 1024 * 1024;

function realGit(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...opts, windowsHide: true });
}

// The TCP listeners on this host, as lsof prints them. Returns null when lsof is not installed
// (the listener baseline is then absent, not empty), '' when lsof finds no listener (exit 1),
// and the listing otherwise. Any other failure is null too — including a timeout (lsof can block
// on a stale network or FUSE mount), which throws with status null. stderr is dropped so lsof
// warnings do not reach the CLI's own stderr.
function realLsof({ exec = execFileSync } = {}) {
  try {
    return exec('lsof', ['+c', '0', '-nP', '-iTCP', '-sTCP:LISTEN'], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch (err) {
    return err.status === 1 ? err.stdout || '' : null;
  }
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
// files get a one-line stub section, an added/deleted file's oversize diff chunk is elided
// the same way, and an always-stub file's diff chunk is elided whatever its change type. All
// are reported in `oversizeSections`.
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

// `-c` pair that keeps non-ASCII names unquoted in diff headers and `--name-only` output alike.
const GIT_UNQUOTED_PATHS = ['-c', 'core.quotePath=false'];

// POSIX single-quote a path for a command a stub suggests running — the path is branch content,
// so it must never be able to end the argument or start a substitution.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
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

// Replace the diff chunk of each always-stub file (any change type) and of each added or
// deleted file over the per-file cap with one marker line. A modified non-always-stub file's
// hunks are never touched — they are the review's subject. Chunks split only at a `diff --git `
// header that follows a line feed: hunk lines begin with `+`, `-` or a space, so a header never
// starts a line inside a hunk, and a CR inside a hunk line (which a multiline `^` would treat as
// a line start) is not a break. The split is lossless — rejoining the chunks reproduces the input.
// `elided` lists every elided path; `deleted` the subset whose chunk was a deletion.
function elideDiff(diff) {
  const elided = [];
  const deleted = [];
  const text = diff
    .split(/(?<=\n)(?=diff --git )/)
    .map((chunk) => {
      if (!chunk.startsWith('diff --git ')) return chunk;
      const nl = chunk.indexOf('\n');
      if (nl === -1) return chunk;
      const headerLine = chunk.slice(0, nl);
      const afterHeader = chunk.slice(nl + 1);
      // Extended header = the lines before the first hunk / file-marker / binary line.
      const bodyAt = afterHeader.search(/^(@@|---|Binary files|GIT binary patch)/m);
      const extended = bodyAt === -1 ? afterHeader : afterHeader.slice(0, bodyAt);
      // A rename or copy header names two paths; its `rename to` / `copy to` extended-header line
      // names the destination, which is the path `--name-only` reports and the one to match.
      // Quoted paths and anything else unparseable come back null: kept whole.
      let file = diffHeaderPath(headerLine);
      if (file === null) {
        const destination = /^(?:rename|copy) to (.+)$/m.exec(extended);
        file = destination ? destination[1] : null;
      }
      if (file === null) return chunk;
      const isDeleted = /^deleted file mode /m.test(extended);
      const isAddedOrDeleted = isDeleted || /^new file mode /m.test(extended);
      const isOversizeAddedOrDeleted = isAddedOrDeleted && Buffer.byteLength(chunk) > PER_FILE_CAP_BYTES;
      if (!isAlwaysStub(file) && !isOversizeAddedOrDeleted) return chunk;
      elided.push(file);
      if (isDeleted) deleted.push(file);
      return `${headerLine}\n[${Buffer.byteLength(afterHeader)} bytes of diff elided for ${file} — see oversizeSections]\n`;
    })
    .join('');
  return { text, elided, deleted };
}

// Bundle shape (unchanged from the shell recipe it replaces): the full diff first, then a
// `===== {file} =====` section per in-scope file holding its current working-tree content.
// A section can legitimately come out empty — a deleted file, or an unreadable path — and
// that degrades safely rather than silently: the full diff at the top still carries that
// file's change, and the section is reported in `emptySections`. An oversize or always-stub
// file's section is a one-line stub, and an always-stub file's or an oversize added/deleted
// file's diff chunk is a one-line marker; both are reported in `oversizeSections`. A stub
// points at wherever the content still lives: the diff above (hunk kept), the live file (hunk
// elided too), or `git diff {range} -- {path}` (elided or deleted). A modified non-always-stub
// file's hunks stay whole, so the bundle as a whole is not strictly bounded. It also writes the
// two pre-dispatch baselines a worktree-isolated reviewer cannot capture itself: the `git status`
// listing (`pre-dispatch-status.txt`) and the lsof listener snapshot (`pre-dispatch-listeners.txt`).
function buildContext({
  base,
  branch,
  dir,
  filesFrom,
  git = realGit,
  readFile = fs.readFileSync,
  writeFile = fs.writeFileSync,
  lsof = realLsof,
} = {}) {
  if (!base || !branch) throw new Error('buildContext: base and branch are both required');
  if (!dir) throw new Error('buildContext: dir is required (resolve it via resolveDir first)');
  const range = `${base}...${branch}`;
  // The explicit flags pin the `a/`/`b/` header form against diff.noprefix / diff.mnemonicPrefix /
  // external-diff config — elideDiff's header parsing depends on it.
  const diff = git([
    ...GIT_UNQUOTED_PATHS,
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '--end-of-options',
    range,
  ]);

  // The git list is NUL-delimited (-z) so a path with a newline or a quoted byte survives intact;
  // the hand-written --files-from list stays newline-split and trimmed.
  const files = filesFrom
    ? readFile(filesFrom, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : splitNul(git([...GIT_UNQUOTED_PATHS, 'diff', '--name-only', '-z', '--end-of-options', range]));

  // #3017: `files` are repo-root-relative paths (from `git diff --name-only`,
  // or a caller-supplied --files-from list following the same convention) —
  // reading them with the bare relative name resolves against process.cwd(),
  // which silently misses every file (landing the whole diff in
  // emptySections) whenever this CLI runs from a subdirectory of the
  // checkout. Resolve the repo toplevel once via the same injected `git`
  // this function already uses for the diff itself, so a test can fake both
  // without a real repo.
  const root = git(['rev-parse', '--show-toplevel']).trim();

  // Pre-dispatch baselines (#3302): the reviewer compares the tree against these to tell its own
  // changes from what was already there, so they are captured here, before any lens runs.
  const baselinePath = path.join(dir, 'pre-dispatch-status.txt');
  writeFile(baselinePath, git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], { cwd: root }));
  const listeners = lsof();
  const listenersPath = typeof listeners === 'string' ? path.join(dir, 'pre-dispatch-listeners.txt') : null;
  if (listenersPath) writeFile(listenersPath, listeners);

  const emptySections = [];
  const oversize = new Set();
  const { text: diffText, elided, deleted } = elideDiff(diff);
  const elidedSet = new Set(elided);
  const deletedSet = new Set(deleted);
  // The pointer a stub gives for the file's content, by what is still true of it. The command is
  // the same three-dot range the bundle's own diff used (so it shows exactly the elided change,
  // merge-base included), with the path single-quoted: it comes from the branch under review.
  function whereToLook(f) {
    const showDiff = `\`git diff ${range} -- ${shellQuote(f)}\``;
    if (deletedSet.has(f)) {
      return `the file is deleted and its diff was elided (see the marker line above) — run ${showDiff} for its last content`;
    }
    if (elidedSet.has(f)) {
      return `its diff was elided too (see the marker line above) — run ${showDiff} for the change, or read the live file for full content`;
    }
    return 'its change is in the diff above — read the live file for full content';
  }
  let out = diffText;
  for (const f of files) {
    out += `\n===== ${f} =====\n`;
    // The name matcher runs BEFORE the read, so a deleted lockfile counts as stubbed
    // (oversizeSections) rather than empty (emptySections), and a stubbed file is never read.
    if (isAlwaysStub(f)) {
      oversize.add(f);
      out += `[section omitted: ${f} — always stubbed (lockfile or .jsonl); ${whereToLook(f)}]\n`;
      continue;
    }
    let content = '';
    try {
      content = readFile(path.join(root, f), 'utf8');
    } catch {
      emptySections.push(f);
      // A deleted over-cap file has no content to inline and no hunk in the diff either: leave
      // the one-line pointer here, since the marker line above only says "see oversizeSections".
      if (elidedSet.has(f)) {
        oversize.add(f);
        out += `[section omitted: ${f} — ${whereToLook(f)}]\n`;
        continue;
      }
    }
    // Size comes from the content just read — readFile stays the only file seam (no stat).
    const bytes = Buffer.byteLength(content);
    if (bytes > PER_FILE_CAP_BYTES) {
      oversize.add(f);
      out += `[section omitted: ${f} is ${bytes} bytes, over the ${PER_FILE_CAP_BYTES}-byte per-file cap; ${whereToLook(f)}]\n`;
    } else {
      out += content;
    }
  }
  // An elided diff chunk can belong to a path outside a --files-from scope; still report it.
  for (const f of elided) oversize.add(f);

  const contextPath = path.join(dir, 'context.md');
  writeFile(contextPath, out);
  return {
    dir,
    contextPath,
    bytes: Buffer.byteLength(out),
    files: files.length,
    emptySections,
    oversizeSections: [...oversize],
    baselinePath,
    listenersPath,
  };
}

module.exports = { resolveDir, buildContext, realLsof, MAX_BUFFER, PER_FILE_CAP_BYTES, isAlwaysStub, elideDiff };
