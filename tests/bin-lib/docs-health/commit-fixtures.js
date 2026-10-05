'use strict';
// Real throwaway git repositories for the verify-commit tests (#2866).
// Not a *.test.js file, so tools/run-tests.js never runs it on its own.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Bounds a hung fixture spawn into an error (tests/helpers/git-fixtures.js's
// FIXTURE_TIMEOUT_MS rationale).
const GIT_TIMEOUT_MS = 30000;

function git(cwd, args, input) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: 'pipe', input,
  });
}

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `docs-health-commit-ref-${label}-`));
}

// main: root -> second -> third; side branches off second with one commit
// (sideOnly) that is never merged into main.
function makeOriginRepo() {
  const dir = tmpDir('origin');
  git(dir, ['init', '-q', '-b', 'main']);
  const commit = (file, msg) => {
    fs.writeFileSync(path.join(dir, file), `${msg}\n`);
    git(dir, ['add', file]);
    git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', msg]);
    return git(dir, ['rev-parse', 'HEAD']).trim();
  };
  const root = commit('a.txt', 'root');
  const second = commit('b.txt', 'second');
  git(dir, ['checkout', '-q', '-b', 'side']);
  const sideOnly = commit('c.txt', 'side only');
  git(dir, ['checkout', '-q', 'main']);
  const third = commit('d.txt', 'third');
  git(dir, ['-c', 'user.email=t@example.com', '-c', 'user.name=T',
    'tag', '-a', 'annotated', '-m', 'annotated tag', second]);
  const annotatedTag = git(dir, ['rev-parse', 'annotated']).trim();
  return { dir, root, second, sideOnly, third, annotatedTag };
}

// A file:// URL, not a bare path: a local-path clone ignores --depth.
function cloneOf(origin, { depth } = {}) {
  const parent = tmpDir('clone');
  const dir = path.join(parent, 'clone');
  const args = ['clone', '-q'];
  if (depth) args.push('--depth', String(depth));
  args.push(`file://${origin.dir}`, dir);
  git(parent, args);
  return dir;
}

// 1500 empty commits with fixed identity and timestamps, so the hashes are
// deterministic; at that count two commits sharing a 4-character prefix is
// a birthday-bound near-certainty, and determinism makes it certain for this
// exact stream (probed: prefix cae9, 64 ms).
function makeAmbiguousRepo() {
  const dir = tmpDir('ambiguous');
  git(dir, ['init', '-q', '-b', 'main']);
  let stream = '';
  for (let i = 1; i <= 1500; i += 1) {
    const msg = `commit ${i}`;
    stream += `commit refs/heads/main\nmark :${i}\n`
      + `committer T <t@example.com> ${1700000000 + i} +0000\n`
      + `data ${Buffer.byteLength(msg)}\n${msg}\n`
      + `${i > 1 ? `from :${i - 1}\n` : ''}\n`;
  }
  git(dir, ['fast-import', '--quiet'], stream);
  const shas = git(dir, ['rev-list', 'main']).trim().split('\n');
  const seen = new Map();
  for (const sha of shas) {
    const prefix = sha.slice(0, 4);
    if (seen.has(prefix)) return { dir, prefix, candidates: [seen.get(prefix), sha].sort() };
    seen.set(prefix, sha);
  }
  throw new Error('makeAmbiguousRepo: no shared 4-character commit prefix — fixture is broken');
}

module.exports = { git, tmpDir, makeOriginRepo, cloneOf, makeAmbiguousRepo };
