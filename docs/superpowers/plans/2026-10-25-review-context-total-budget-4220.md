# Bound the total size of the /review shared context bundle (#4220) Implementation Plan

**Goal:** `buildContext` caps each file at 64 KB but nothing bounds the bundle as a whole; add a total-size budget that stubs the largest sections first, and tell lens agents what to read when the bundle came back over budget.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T135243-record-4220/work/4220-spec.md` (materialized from GitHub issue #4220)

Every code and prose block below was run in a scratch mirror before this plan was written (inline self-consistency check): the existing 39 tests in `tests/bin-lib/review-context/build.test.js` stay green, the 4 new tests pass, and with the budget branch disabled (`if (false && total > budgetBytes)`) the AC1.1 test fails with `bundle 61057 B over the 16384 B budget`. Real-input probe: `build --base HEAD~25 --branch HEAD` on this repo (323 files) printed `bytes` 3,989,582 before and 261,804 after (budget 262,144); an independent regex count over the written `context.md` matched the printed bytes and found 0 stubbed paths missing from `oversizeSections`. A 1,479-file range (`HEAD~150`) stays over budget at 912,136 B because its headers and stubs alone exceed 256 KB — the floor the code comment states.

---

### Task 1: Add a total-size budget to buildContext and name the per-path fallback for lens agents

**Files:**
- Modify: `plugin/bin/lib/review-context/build.js`
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (49,179 B now, about +900 B — well under the 52,500 B rail)
- Modify: `docs/plugin-structure.md`
- Test: `tests/bin-lib/review-context/build.test.js`
- Test: `tests/bin-lib/review-context/prose.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/review-context/build.test.js`, add `TOTAL_CAP_BYTES,` to the destructured `require('../../../plugin/bin/lib/review-context/build')` list, directly after `PER_FILE_CAP_BYTES,`. Then insert this block immediately before the line `test('CLI: malformed invocations exit 2 with usage', () => {` (covers AC1.1, and AC2.1 — Step 3 disables the budget branch to prove the test goes red):

````js
// --- Total bundle budget (#4220) -------------------------------------------------------

// Four modified files of 8, 6, 4 and 1 KB with every line changed, so each diff chunk is about
// twice its file and diff plus sections come to roughly 57 KB.
const BUDGET_FILE_KB = { 'a.txt': 8, 'b.txt': 6, 'c.txt': 4, 'd.txt': 1 };

function budgetLines(name, kb, word) {
  let text = '';
  for (let i = 0; Buffer.byteLength(text) < kb * 1024; i++) text += `${name} ${word} line ${i}\n`;
  return text;
}

function makeBudgetRepo() {
  const repo = initRepo('review-ctx-budget-');
  for (const [name, kb] of Object.entries(BUDGET_FILE_KB)) fs.writeFileSync(path.join(repo, name), budgetLines(name, kb, 'old'));
  startFeatureBranch(repo);
  for (const [name, kb] of Object.entries(BUDGET_FILE_KB)) fs.writeFileSync(path.join(repo, name), budgetLines(name, kb, 'new'));
  commitAll(repo, 'rewrite every line');
  return repo;
}

// Every path the bundle shows as a budget-stubbed section or an elided diff chunk.
function stubbedPaths(bundle) {
  const paths = new Set();
  for (const m of bundle.matchAll(/^\[section omitted: (.+?) is \d+ bytes, stubbed to fit the \d+-byte bundle budget;/gm)) paths.add(m[1]);
  for (const m of bundle.matchAll(/^\[\d+ bytes of diff elided for (.+?) — see oversizeSections\]$/gm)) paths.add(m[1]);
  return [...paths];
}

test('4220 AC1.1: a diff whose files sum above the budget yields bytes at or under it, every stubbed path listed', () => {
  const budgetBytes = 16 * 1024;
  const { result, bundle } = buildFrom(makeBudgetRepo(), { budgetBytes });
  assert.strictEqual(result.bytes, Buffer.byteLength(bundle), 'printed bytes is the bundle written');
  assert.ok(result.bytes <= budgetBytes, `bundle ${result.bytes} B over the ${budgetBytes} B budget`);
  const stubbed = stubbedPaths(bundle);
  assert.ok(stubbed.length > 0, 'the fixture must actually exceed the budget');
  for (const p of stubbed) assert.ok(result.oversizeSections.includes(p), `${p} stubbed but not in oversizeSections`);
  assert.deepStrictEqual([...result.oversizeSections].sort(), [...stubbed].sort());
});

test('4220: the largest pieces are stubbed first — the smallest file stays inline with its hunk whole', () => {
  const { result, bundle, diffPart } = buildFrom(makeBudgetRepo(), { budgetBytes: 16 * 1024 });
  assert.match(diffPart, /^\[\d+ bytes of diff elided for a\.txt — see oversizeSections\]$/m, 'the largest chunk goes first');
  assert.strictEqual(sectionOf(bundle, 'd.txt'), budgetLines('d.txt', 1, 'new'));
  assert.match(diffPart, /^\+d\.txt new line 0$/m);
  assert.ok(!result.oversizeSections.includes('d.txt'));
});

test('4220: a budget-stubbed section whose chunk was also elided points at the git diff command', () => {
  const { bundle } = buildFrom(makeBudgetRepo(), { budgetBytes: 16 * 1024 });
  const section = sectionOf(bundle, 'a.txt');
  assert.match(section, /^\[section omitted: a\.txt is \d+ bytes, stubbed to fit the 16384-byte bundle budget; its diff was elided too/);
  assert.ok(section.includes("`git diff main...feature -- 'a.txt'`"), section);
  assert.strictEqual(lineCount(section), 1);
});

test('4220: under the default budget the same diff is untouched', () => {
  const { result, bundle } = buildFrom(makeBudgetRepo());
  assert.ok(result.bytes < TOTAL_CAP_BYTES);
  assert.deepStrictEqual(result.oversizeSections, []);
  assert.strictEqual(sectionOf(bundle, 'a.txt'), budgetLines('a.txt', 8, 'new'));
});

````

  In `tests/bin-lib/review-context/prose.test.js`, change the require line to `const { PER_FILE_CAP_BYTES, TOTAL_CAP_BYTES } = require('../../../plugin/bin/lib/review-context/build');` and append at the end of the file:

````js

test('4220: step3-lens-dispatch.md names the total budget in KB and the per-path git diff read', () => {
  assert.ok(
    LENS_DISPATCH.includes(`${TOTAL_CAP_BYTES / 1024} KB total budget`),
    `step3-lens-dispatch.md must name the budget as ${TOTAL_CAP_BYTES / 1024} KB`,
  );
  assert.ok(
    LENS_DISPATCH.includes("read that change with `git diff {base}...{branch} -- '{path}'`, one path per call"),
    'step3-lens-dispatch.md must tell lens agents to read an elided hunk per path',
  );
});
````

- [ ] **Step 2: Implement** — replace the whole content of `plugin/bin/lib/review-context/build.js` with:

````js
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
  // Total budget (#4220): stub the largest remaining pieces first until the bundle fits. Sizes
  // are measured once, before any stub; each stub re-renders every piece of its file, since
  // eliding a chunk changes the pointer that file's section stub gives.
  if (total > budgetBytes) {
    const candidates = [
      ...chunks.flatMap((c, i) => (c.file !== null && !c.elided ? [{ chunk: c, size: Buffer.byteLength(chunkText[i]) }] : [])),
      ...sections.flatMap((s, i) => (s.kind === 'inline' && s.bytes > 0 ? [{ section: s, size: Buffer.byteLength(sectionText[i]) }] : [])),
    ].sort((a, b) => b.size - a.size);
    for (const candidate of candidates) {
      if (total <= budgetBytes) break;
      if (candidate.chunk) candidate.chunk.elided = true;
      else candidate.section.budgetStubbed = true;
      const f = candidate.chunk ? candidate.chunk.file : candidate.section.file;
      chunks.forEach((c, i) => {
        if (c.file !== f) return;
        const next = renderChunk(c);
        total += Buffer.byteLength(next) - Buffer.byteLength(chunkText[i]);
        chunkText[i] = next;
      });
      sections.forEach((s, i) => {
        if (s.file !== f) return;
        const next = renderSection(s);
        total += Buffer.byteLength(next) - Buffer.byteLength(sectionText[i]);
        sectionText[i] = next;
      });
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
````

  In `plugin/skills/review/step3-lens-dispatch.md`, in the paragraph that starts `> A section can legitimately come out empty`, replace `Any other modified file's hunks stay whole, an over-cap modified file included;` with `Any other modified file's hunks stay whole, an over-cap modified file included, unless the total budget in the next note needs them;`. Then, directly after that paragraph (before the `>` line that precedes `> **Pre-dispatch listing (scratch-sweep baseline).**`), insert these two lines:

````markdown
>
> **Over-budget bundle (#4220).** The whole bundle is held to a 256 KB total budget: when the diff and sections together exceed it, the CLI replaces the largest remaining hunks and inlined sections, largest first, with the same marker line and a one-line stub until the bundle fits, and names each in `oversizeSections` — so on a long branch any file's hunk, a modified file's included, can come back as a marker line. Tell each dispatched agent explicitly: for each path in its scope whose hunk the bundle shows as a marker line, read that change with `git diff {base}...{branch} -- '{path}'`, one path per call — never the whole branch diff in one read. This rule goes in the dispatch prompt alongside the scope, outside the byte-identical Calibration/Output-template block below.
````

  In `docs/plugin-structure.md`, in the `plugin/bin/lib/review-context/` row, replace ``pre-dispatch-listeners.txt` baselines, #3302). Consumed by`` with ``pre-dispatch-listeners.txt` baselines, #3302; over the 256 KB total budget, `TOTAL_CAP_BYTES`, the largest remaining hunks and sections are stubbed first until the bundle fits, #4220). Consumed by``.

- [ ] **Step 3: Run** `node --test tests/bin-lib/review-context/build.test.js tests/bin-lib/review-context/prose.test.js tests/bin-lib/review-context/exit-code.test.js` — PASS. Then prove the AC1.1 test discriminates (AC2.1): change `if (total > budgetBytes) {` to `if (false && total > budgetBytes) {` in `build.js`, re-run `node --test --test-name-pattern=4220 tests/bin-lib/review-context/build.test.js` and confirm `4220 AC1.1` FAILS, then restore the line and re-run to green. Never commit the disabled line.

- [ ] **Step 4: Commit** — one commit: `Bound the total size of the /review shared context bundle — refs #4220`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (budget, largest first, `oversizeSections` names every stubbed path) — Step 2 `build.js`; Deliverable 2 (lens agents' per-path `git diff` read) — Step 2 `step3-lens-dispatch.md` note, pinned by the prose test; Deliverable 3 (fixture whose files sum above the budget) — Step 1. AC1.1 — `4220 AC1.1` test; AC2.1 — Step 3's go-red revert.
- **Return shape:** unchanged — the printed JSON keys are the same eight; only `TOTAL_CAP_BYTES` is a new export. No test asserts the module's export list.
- **Placeholders:** none.
