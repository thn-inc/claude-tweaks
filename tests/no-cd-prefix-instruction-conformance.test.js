'use strict';
// #4442: skill prose must not instruct a `cd "…" && <command>` prefix. The
// canonical rule is _shared/subagent-dispatch-core.md's Working Directory
// Discipline: pass the anchor as the command's own argument (`git -C`, an
// absolute path, `--repo`), one plain command per Bash call. Read live: a
// convention over every future addition to plugin/skills.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { scratchDir } = require('./helpers/tmp-dir');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
// A `$(cd "…" && pwd -P)` canonicalization subshell is not an instruction.
const CD_PREFIX = /(?<!\$\()\bcd\s+"[^"\n]*"\s*&&/g;

// Counter-examples labelled as forbidden, or guard-behavior documentation.
const ALLOWLIST = [
  { file: '_shared/subagent-dispatch-core.md', anchor: 'never `cd "..." && git ...`' },
  { file: '_shared/subagent-dispatch-core.md', anchor: 'a `cd "<dir>" && <command>` shape' },
  { file: '_shared/scratch-worktree.md', anchor: '`cd "<wt>" && pwd && pwd`' },
  { file: '_shared/scratch-worktree.md', anchor: '`cd "<main checkout>" && git log --oneline -1`' },
  { file: '_shared/scratch-worktree.md', anchor: '`cd "<wt>" && cat > f <<\'EOF\'`' },
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// Returns { files, hits: [{ file, line, text, matches }] } for every line
// carrying a cd-prefix match, relative file paths with forward slashes.
function scan(root) {
  const files = walk(root);
  const hits = [];
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    readText(abs).split('\n').forEach((text, i) => {
      const matches = text.match(CD_PREFIX);
      if (matches) hits.push({ file: rel, line: i + 1, text, matches: matches.length });
    });
  }
  return { files: files.length, hits };
}

const covered = (h) => ALLOWLIST.some((a) => a.file === h.file && h.text.includes(a.anchor));

function withTempTree(name, body, fn) {
  const dir = scratchDir('ct-nocd-');
  try {
    fs.mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const LIVE = scan(SKILLS);

test('AC1.1: no plugin/skills markdown instructs a cd "…" && prefix', () => {
  const offenders = LIVE.hits.filter((h) => !covered(h));
  assert.deepStrictEqual(
    offenders.map((h) => `${h.file}:${h.line} ${h.text.trim()}`),
    [],
    'use `git -C`, an absolute path or `--repo` as the command\'s own argument instead of a cd prefix',
  );
});

test('allowlist entries each match exactly one live line', () => {
  for (const a of ALLOWLIST) {
    const n = LIVE.hits.filter((h) => h.file === a.file && h.text.includes(a.anchor)).length;
    assert.strictEqual(n, 1, `${a.file} anchor ${a.anchor} matches ${n} lines — ${n ? 'tighten the anchor' : 'remove this entry'}`);
  }
});

test('AC2.1 go-red: a restored build/SKILL.md cd "$WORKTREE" && sentence is flagged', () => {
  const body = 'When dispatching subagents, require them to use `cd "$WORKTREE" && …` or `git -C "$WORKTREE" …`.\n';
  const r = withTempTree('build/SKILL.md', body, scan);
  assert.strictEqual(r.hits.filter((h) => !covered(h)).length, 1);
});

test('canonicalization subshell is not flagged', () => {
  const r = withTempTree('_shared/x.md', 'RUN_ROOT=$(cd "$RUN_ROOT" && pwd -P)\n', scan);
  assert.strictEqual(r.hits.length, 0);
});

test('the walk reads at least 100 .md files', () => {
  assert.ok(LIVE.files >= 100, `read only ${LIVE.files} files`);
});
