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
// the same way, and an always-stub file's diff chunk is elided whatever its change type. A
// readable markdown file (`.md` / `.markdown`) gets the stub section at any size (#3713) — its
// hunks stay whole in the diff, and prose is the bulk of a skill-heavy diff's bundle. All
// are reported in `oversizeSections`.
const PER_FILE_CAP_BYTES = 64 * 1024;

// The whole bundle is held to this many bytes by default (#4220): the per-file cap bounds one
// section, not the bundle, and #4028's 129-file review still came to 3 MB, more than any lens
// agent can read. Over it, buildContext replaces the largest remaining diff chunks and inlined
// sections, largest first, with the same marker line and one-line stub until the bundle fits.
// Named `_CAP_` like PER_FILE_CAP_BYTES: tests/skill-size-single-source.test.js reads any
// `*BUDGET*_BYTES` constant as a skill-size number.
const TOTAL_CAP_BYTES = 256 * 1024;

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

// True for lockfiles and `*.jsonl` fixtures. Accepts `/`- or `\`-separated paths
// on any host — an any-separator normalization, so not toPosix (#3317).
function isAlwaysStub(file) {
  const base = String(file).replace(/\\/g, '/').split('/').pop();
  return ALWAYS_STUB_BASENAMES.has(base) || base.endsWith('.jsonl');
}

// True for markdown files (`.md` / `.markdown`, case-insensitive). Accepts `/`- or
// `\`-separated paths on any host — an any-separator normalization, so not toPosix (#3317).
function isMarkdown(file) {
  const base = String(file).replace(/\\/g, '/').split('/').pop();
  return /\.(md|markdown)$/i.test(base);
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

// Split a diff into per-file chunks, marking the chunk of each always-stub file (any change
// type) and of each added or deleted file over the per-file cap as elided. A modified
// non-always-stub file's chunk is never marked here — its hunks are the review's subject, and
// only buildContext's total budget can elide one. Chunks split only at a `diff --git ` header
// that follows a line feed: hunk lines begin with `+`, `-` or a space, so a header never starts a
// line inside a hunk, and a CR inside a hunk line (which a multiline `^` would treat as a line
// start) is not a break. The split is lossless — rejoining the chunks reproduces the input.
// Each chunk is `{text, file, headerLine, bodyBytes, deleted, elided}`; `file` is null for a
// leading non-header chunk or an unparseable header, and such a chunk is never elided.
function diffChunks(diff) {
  return diff.split(/(?<=\n)(?=diff --git )/).map((text) => {
    const kept = { text, file: null, headerLine: null, bodyBytes: 0, deleted: false, elided: false };
    if (!text.startsWith('diff --git ')) return kept;
    const nl = text.indexOf('\n');
    if (nl === -1) return kept;
    const headerLine = text.slice(0, nl);
    const afterHeader = text.slice(nl + 1);
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
    if (file === null) return kept;
    const deleted = /^deleted file mode /m.test(extended);
    const isAddedOrDeleted = deleted || /^new file mode /m.test(extended);
    const isOversizeAddedOrDeleted = isAddedOrDeleted && Buffer.byteLength(text) > PER_FILE_CAP_BYTES;
    return {
      text,
      file,
      headerLine,
      bodyBytes: Buffer.byteLength(afterHeader),
      deleted,
      elided: isAlwaysStub(file) || isOversizeAddedOrDeleted,
    };
  });
}

// A chunk as the bundle carries it: whole, or its header plus one marker line once elided.
function renderChunk(chunk) {
  if (!chunk.elided) return chunk.text;
  return `${chunk.headerLine}\n[${chunk.bodyBytes} bytes of diff elided for ${chunk.file} — see oversizeSections]\n`;
}

// The diff with every elided chunk replaced by its marker line. `elided` lists every elided
// path; `deleted` the subset whose chunk was a deletion.
function elideDiff(diff) {
  const chunks = diffChunks(diff);
  const elidedChunks = chunks.filter((c) => c.elided);
  return {
    text: chunks.map(renderChunk).join(''),
    elided: elidedChunks.map((c) => c.file),
    deleted: elidedChunks.filter((c) => c.deleted).map((c) => c.file),
  };
}

// Bundle shape (unchanged from the shell recipe it replaces): the full diff first, then a
// `===== {file} =====` section per in-scope file holding its current working-tree content.
// A section can legitimately come out empty — a deleted file, or an unreadable path — and
// that degrades safely rather than silently: the full diff at the top still carries that
// file's change, and the section is reported in `emptySections`. An oversize or always-stub
// file's section is a one-line stub, as is a readable markdown file's at any size (its hunks
// stay whole; a deleted or unreadable one stays an empty section), and an always-stub file's or
// an oversize added/deleted file's diff chunk is a one-line marker; both are reported in
// `oversizeSections`. A stub points at wherever the content still lives: the diff above (hunk
// kept), the live file (hunk elided too), or `git diff {range} -- {path}` (elided or deleted).
// A modified non-always-stub file's hunks stay whole unless the total budget (#4220) needs
// them: over `budgetBytes`, the largest remaining diff chunks and inlined sections are replaced,
// largest first, by the same marker line and a one-line stub until the bundle fits, and each is
// reported in `oversizeSections` — `bytes` exceeds the budget only when the headers and stubs
// alone do. It also writes the two pre-dispatch baselines a worktree-isolated reviewer cannot
// capture itself: the `git status` listing (`pre-dispatch-status.txt`) and the lsof listener
// snapshot (`pre-dispatch-listeners.txt`).
function buildContext({
  base,
  branch,
  dir,
  filesFrom,
  budgetBytes = TOTAL_CAP_BYTES,
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
  writeFile(baselinePath, git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], { cwd: root })); // git-path-read: not a path list (display: the reviewer diffs it as text against its own status run)
  const listeners = lsof();
  const listenersPath = typeof listeners === 'string' ? path.join(dir, 'pre-dispatch-listeners.txt') : null;
  if (listenersPath) writeFile(listenersPath, listeners);

  const emptySections = [];
  const chunks = diffChunks(diff);
  // Elision is read when a piece is rendered, so a chunk the budget elides later re-points the
  // stub of that file's section too.
  const isElided = (f) => chunks.some((c) => c.file === f && c.elided);
  const isDeletedAndElided = (f) => chunks.some((c) => c.file === f && c.elided && c.deleted);
  // The pointer a stub gives for the file's content, by what is still true of it. The command is
  // the same three-dot range the bundle's own diff used (so it shows exactly the elided change,
  // merge-base included), with the path single-quoted: it comes from the branch under review.
  function whereToLook(f) {
    const showDiff = `\`git diff ${range} -- ${shellQuote(f)}\``;
    if (isDeletedAndElided(f)) {
      return `the file is deleted and its diff was elided (see the marker line above) — run ${showDiff} for its last content`;
    }
    if (isElided(f)) {
      return `its diff was elided too (see the marker line above) — run ${showDiff} for the change, or read the live file for full content`;
    }
    return 'its change is in the diff above — read the live file for full content';
  }

  // One section per file, classified before anything is rendered.
  const sections = files.map((f) => {
    // The name matcher runs BEFORE the read, so a deleted lockfile counts as stubbed
    // (oversizeSections) rather than empty (emptySections), and a stubbed file is never read.
    if (isAlwaysStub(f)) return { file: f, kind: 'always' };
    let content;
    try {
      content = readFile(path.join(root, f), 'utf8');
    } catch {
      emptySections.push(f);
      return { file: f, kind: 'unread' };
    }
    // Size comes from the content just read — readFile stays the only file seam (no stat).
    const bytes = Buffer.byteLength(content);
    // Markdown is stubbed at any size once the read succeeded (#3713); a failed read falls through.
    if (isMarkdown(f)) return { file: f, kind: 'markdown', bytes };
    if (bytes > PER_FILE_CAP_BYTES) return { file: f, kind: 'cap', bytes };
    return { file: f, kind: 'inline', bytes, content, budgetStubbed: false };
  });

  function renderSection(s) {
    const f = s.file;
    const head = `\n===== ${f} =====\n`;
    if (s.kind === 'always') return `${head}[section omitted: ${f} — always stubbed (lockfile or .jsonl); ${whereToLook(f)}]\n`;
    // A deleted over-cap file has no content to inline and no hunk in the diff either: leave
    // the one-line pointer here, since the marker line above only says "see oversizeSections".
    if (s.kind === 'unread') return isElided(f) ? `${head}[section omitted: ${f} — ${whereToLook(f)}]\n` : head;
    if (s.kind === 'markdown') return `${head}[section omitted: ${f} is ${s.bytes} bytes of markdown, not inlined; ${whereToLook(f)}]\n`;
    if (s.kind === 'cap') {
      return `${head}[section omitted: ${f} is ${s.bytes} bytes, over the ${PER_FILE_CAP_BYTES}-byte per-file cap; ${whereToLook(f)}]\n`;
    }
    if (s.budgetStubbed) {
      return `${head}[section omitted: ${f} is ${s.bytes} bytes, stubbed to fit the ${budgetBytes}-byte bundle budget; ${whereToLook(f)}]\n`;
    }
    return head + s.content;
  }

  const chunkText = chunks.map(renderChunk);
  const sectionText = sections.map(renderSection);
  let total = [...chunkText, ...sectionText].reduce((n, t) => n + Buffer.byteLength(t), 0);
  // Re-render every piece of file `f` from the current elision flags and return the byte change.
  // Rendering is a pure function of those flags, so calling it again after flipping one back
  // restores the earlier text.
  function rerenderFile(f) {
    let delta = 0;
    chunks.forEach((c, i) => {
      if (c.file !== f) return;
      const next = renderChunk(c);
      delta += Buffer.byteLength(next) - Buffer.byteLength(chunkText[i]);
      chunkText[i] = next;
    });
    sections.forEach((s, i) => {
      if (s.file !== f) return;
      const next = renderSection(s);
      delta += Buffer.byteLength(next) - Buffer.byteLength(sectionText[i]);
      sectionText[i] = next;
    });
    return delta;
  }
  // Total budget (#4220): stub the largest remaining pieces first until the bundle fits. Sizes
  // are measured once, before any stub; each stub re-renders every piece of its file, since
  // eliding a chunk changes the pointer that file's section stub gives. A piece whose stub is
  // not smaller than the piece (a few lines changed in a tiny file) is left whole, so a budget
  // that cannot be reached never leaves the bundle larger than the unbudgeted one. A chunk with
  // no parseable path (`file` null) is never a candidate: a marker line has no path to name.
  if (total > budgetBytes) {
    const candidates = [
      ...chunks.flatMap((c, i) => (c.file !== null && !c.elided ? [{ chunk: c, size: Buffer.byteLength(chunkText[i]) }] : [])),
      ...sections.flatMap((s, i) => (s.kind === 'inline' && s.bytes > 0 ? [{ section: s, size: Buffer.byteLength(sectionText[i]) }] : [])),
    ].sort((a, b) => b.size - a.size);
    for (const candidate of candidates) {
      if (total <= budgetBytes) break;
      const piece = candidate.chunk || candidate.section;
      const flag = candidate.chunk ? 'elided' : 'budgetStubbed';
      piece[flag] = true;
      const delta = rerenderFile(piece.file);
      if (delta >= 0) {
        piece[flag] = false;
        rerenderFile(piece.file);
      } else {
        total += delta;
      }
    }
  }
  const out = chunkText.join('') + sectionText.join('');

  const oversize = new Set();
  for (const s of sections) {
    const stubbed = s.kind === 'always' || s.kind === 'markdown' || s.kind === 'cap' || s.budgetStubbed;
    if (stubbed || (s.kind === 'unread' && isElided(s.file))) oversize.add(s.file);
  }
  // An elided diff chunk can belong to a path outside a --files-from scope; still report it.
  for (const c of chunks) if (c.elided) oversize.add(c.file);

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

module.exports = { resolveDir, buildContext, realLsof, MAX_BUFFER, PER_FILE_CAP_BYTES, TOTAL_CAP_BYTES, isAlwaysStub, isMarkdown, elideDiff };
