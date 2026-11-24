// plugin/bin/lib/learned-skills/rebuild.js — rebuilds conflicting learned-skills PRs on the integration tip (#6113).
//
// `resolveDiff3` is the pure part: it resolves the double-append conflicts in `git merge-file --diff3` output
// (ours = integration side, theirs = the PR) by keeping ours first and the PR's new lines after, and renumbers
// a numbered list both sides extended. Anything else — a changed line, an empty side, a hunk inside a list — refuses.
//
// `rebuild` is the git part, run from a clone (`cwd`) whose `origin` holds the PR branch. It fetches the
// integration branch and the PR head into per-call scratch refs, 3-way merges the head onto the tip with
// `merge-tree --write-tree` (git >= 2.38), resolves each content conflict with `merge-file --diff3` over
// blob files in a temp dir, builds one commit on a temp index (parent: the tip; message: the PR commits'
// Learned-Skills-Run/Entry trailer pairs, in order, each once) and force-pushes it to the PR's own
// `learned-skills/*` branch under `--force-with-lease={ref}:{oldHead}`, without GITHUB_TOKEN (a push made
// with the Actions token starts no CI). No worktree's branch, index or files is touched. It never throws:
// { ok: true, commit, tip } | { ok: false, reason, detail? }, reason one of not-learned-skills-branch,
// git-too-old, head-changed, lease-rejected, rebuild-failed, or `conflict needs a human: {files}` (every
// conflicted path, merge-tree order, when any one of them cannot be resolved).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { GIT_TIMEOUT_MS, GIT_PUSH_TIMEOUT_MS } = require('../shared-primitives');
const { realDeps, gitEnv, firstStderrLine } = require('./learned-skills');
const { repoPinnedEnv } = require('../hooks/git-exec');

const MARKER_SIZE = 32;

const ITEM = /^(\s*)(\d+)([.)])(\s)/;

const stripCr = (line) => (line.endsWith('\r') ? line.slice(0, -1) : line);

function isMarker(line, ch) {
  const text = stripCr(line);
  const run = ch.repeat(MARKER_SIZE);
  return text === run || text.startsWith(run + ' ');
}

const itemOf = (line) => {
  const m = ITEM.exec(stripCr(line));
  return m ? { indent: m[1].length, number: Number(m[2]) } : null;
};

// Renumbers the list items inside one resolved range `[start, end)` of `out`; false means a mid-list hunk.
function renumberRange(out, start, end) {
  let first = null;
  for (let i = start; i < end; i++) {
    const it = itemOf(out[i]);
    if (it) { first = it; break; }
  }
  if (!first) return true;
  const indent = first.indent;
  const items = [];
  for (let i = start; i < end; i++) {
    const it = itemOf(out[i]);
    if (it && it.indent === indent) items.push({ index: i, number: it.number });
  }

  let prev = null;
  for (let i = start - 1; i >= 0; i--) {
    const text = stripCr(out[i]);
    if (text.trim() === '') continue;
    const it = itemOf(out[i]);
    if (it && it.indent === indent) { prev = it.number; break; }
    if (!it && text.length - text.trimStart().length > indent) continue;
    if (it && it.indent > indent) continue;
    break;
  }
  const from = prev !== null ? prev + 1 : items[0].number;

  for (let i = end; i < out.length; i++) {
    if (stripCr(out[i]).trim() === '') continue;
    const it = itemOf(out[i]);
    if (it && it.indent === indent) return false;
    break;
  }

  items.forEach((item, n) => {
    if (item.number === from + n) return;
    out[item.index] = out[item.index].replace(/^(\s*)\d+/, (m, ws) => ws + String(from + n));
  });
  return true;
}

function resolveDiff3(text) {
  const lines = String(text).split('\n');
  const out = [];
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isMarker(lines[i], '<')) { out.push(lines[i]); continue; }
    const ours = [];
    const base = [];
    const theirs = [];
    let target = ours;
    let closed = false;
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (target === ours && isMarker(line, '|')) target = base;
      else if (target === base && isMarker(line, '=')) target = theirs;
      else if (target === theirs && isMarker(line, '>')) { closed = true; break; }
      else target.push(line);
    }
    if (!closed || target !== theirs || base.length > 0 || ours.length === 0 || theirs.length === 0) return { ok: false };
    const start = out.length;
    const have = new Set(ours.map(stripCr));
    out.push(...ours, ...theirs.filter((l) => !have.has(stripCr(l))));
    ranges.push([start, out.length]);
  }
  for (const [start, end] of ranges) {
    if (!renumberRange(out, start, end)) return { ok: false };
  }
  return { ok: true, text: out.join('\n') };
}

// ---------------------------------------------------------------------------------------------
// rebuild: the plumbing commit and the leased push

const MIN_GIT = [2, 38];
const PREFIX = 'learned-skills/';
const RUN_TRAILER = /^Learned-Skills-Run: (.*)$/;
const ENTRY_TRAILER = /^Learned-Skills-Entry: (.*)$/;
const CONTENT_TYPES = new Set(['Auto-merging', 'CONFLICT (contents)']);

const defaultDeps = () => ({
  git: realDeps.git,
  mkdtemp: () => fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rebuild-')),
  rm: (p) => fs.rmSync(p, { recursive: true, force: true }),
  writeFile: (p, data) => fs.writeFileSync(p, data),
  env: process.env,
  nonce: () => crypto.randomBytes(4).toString('hex'),
});

// The Run/Entry trailer pairs of the PR's own commits, oldest first, each pair once.
function trailerPairs(log) {
  const pairs = [];
  const seen = new Set();
  for (const body of log.split('\0')) {
    let run = null;
    for (const raw of body.split('\n')) {
      const line = raw.replace(/\r$/, '');
      const r = RUN_TRAILER.exec(line);
      if (r) { run = r[1]; continue; }
      const e = ENTRY_TRAILER.exec(line);
      if (e && run !== null) {
        const key = `${run}\0${e[1]}`;
        if (!seen.has(key)) { seen.add(key); pairs.push([run, e[1]]); }
        run = null;
      }
    }
  }
  return pairs;
}

// `merge-tree --write-tree -z` stdout: the tree, the conflicted-file entries up to an empty field, then
// the messages (`count, path x count, type, message`).
function parseMergeTree(stdout) {
  const fields = stdout.split('\0');
  const tree = fields[0];
  const files = new Map();
  let i = 1;
  for (; i < fields.length && fields[i] !== ''; i++) {
    const m = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]*)$/.exec(fields[i]);
    if (!m) continue;
    if (!files.has(m[4])) files.set(m[4], { stages: {} });
    files.get(m[4]).stages[m[3]] = { mode: m[1], oid: m[2] };
  }
  i++;
  const types = new Map();
  while (i < fields.length && fields[i] !== '') {
    const count = Number(fields[i++]);
    if (!Number.isInteger(count)) break;
    const paths = fields.slice(i, i + count);
    i += count;
    const type = fields[i++];
    i++;
    for (const p of paths) {
      if (!types.has(p)) types.set(p, new Set());
      types.get(p).add(type);
    }
  }
  return { tree, files, types };
}

// A throwing runner's stdout when the call exited non-zero by design (merge-tree: 1, merge-file: the count).
const stdoutOf = (err) => (err && err.stdout != null ? String(err.stdout) : null);

function rebuild({ pr, headRef, oldHead, integrationBranch, cwd }, overrides = {}) {
  if (typeof headRef !== 'string' || !headRef.startsWith(PREFIX) || headRef === integrationBranch) {
    return { ok: false, reason: 'not-learned-skills-branch' };
  }
  const deps = { ...defaultDeps(), ...overrides };
  let base = null;
  let head = null;
  const git = (args, opts = {}) => deps.git(args, { cwd, ...opts });
  const out = (args, opts) => String(git(args, opts)).trim();
  let dir = null;
  let fetched = false;
  try {
    const nonce = typeof deps.nonce === 'function' ? deps.nonce() : deps.nonce;
    base = `refs/claude-tweaks/rebuild/${pr}-${nonce}/base`;
    head = `refs/claude-tweaks/rebuild/${pr}-${nonce}/head`;
    const version = /(\d+)\.(\d+)/.exec(out(['version'], { timeout: GIT_TIMEOUT_MS }));
    if (!version || Number(version[1]) < MIN_GIT[0] || (Number(version[1]) === MIN_GIT[0] && Number(version[2]) < MIN_GIT[1])) {
      return { ok: false, reason: 'git-too-old' };
    }
    fetched = true;
    git(['fetch', '--no-tags', '--no-write-fetch-head', 'origin',
      `+refs/heads/${integrationBranch}:${base}`, `+refs/heads/${headRef}:${head}`], { timeout: GIT_PUSH_TIMEOUT_MS });
    const fetchedHead = out(['rev-parse', '--verify', '--end-of-options', `${head}^{commit}`]);
    if (fetchedHead !== oldHead) return { ok: false, reason: 'head-changed' };
    const tip = out(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
    const mergeBase = out(['merge-base', '--end-of-options', tip, oldHead]);
    const pairs = trailerPairs(String(git(['log', '--reverse', '--format=%B%x00', '--end-of-options', `${mergeBase}..${oldHead}`])));

    let mergeOut;
    try {
      mergeOut = String(git(['merge-tree', '--write-tree', '-z', '--end-of-options', tip, oldHead]));
    } catch (err) {
      mergeOut = stdoutOf(err);
      if (mergeOut === null || err.status !== 1) throw err;
    }
    const { tree, files, types } = parseMergeTree(mergeOut);

    dir = deps.mkdtemp();
    const resolved = new Map();
    const conflicted = [...files.keys()];
    const unresolvable = [];
    for (const [file, info] of files) {
      const { 1: b, 2: o, 3: t } = info.stages;
      const kinds = types.get(file) || new Set();
      if (!b || !o || !t || [...kinds].some((k) => !CONTENT_TYPES.has(k))) { unresolvable.push(file); continue; }
      const paths = { ours: path.join(dir, 'ours'), base: path.join(dir, 'base'), theirs: path.join(dir, 'theirs') };
      deps.writeFile(paths.ours, git(['cat-file', 'blob', o.oid], { encoding: 'buffer' }));
      deps.writeFile(paths.base, git(['cat-file', 'blob', b.oid], { encoding: 'buffer' }));
      deps.writeFile(paths.theirs, git(['cat-file', 'blob', t.oid], { encoding: 'buffer' }));
      let merged;
      try {
        merged = git(['merge-file', '-p', '--diff3', `--marker-size=${MARKER_SIZE}`, '-L', 'ours', '-L', 'base', '-L', 'theirs',
          paths.ours, paths.base, paths.theirs], { encoding: 'buffer' });
      } catch (err) {
        merged = err && err.stdout != null ? err.stdout : null;
        if (merged === null || !(err.status > 0 && err.status < 128)) throw err;
      }
      let decoded = null;
      try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(merged); } catch { /* not UTF-8: unresolvable */ }
      const res = decoded === null ? { ok: false } : resolveDiff3(decoded);
      if (!res.ok) { unresolvable.push(file); continue; }
      resolved.set(file, { mode: o.mode, text: res.text });
    }
    if (unresolvable.length > 0) return { ok: false, reason: `conflict needs a human: ${conflicted.join(', ')}` };

    const indexEnv = gitEnv({ GIT_INDEX_FILE: path.join(dir, 'index') });
    git(['read-tree', '--end-of-options', tree], { env: indexEnv });
    for (const [file, { mode, text }] of resolved) {
      const oid = out(['hash-object', '-w', '--stdin'], { env: indexEnv, input: text });
      git(['update-index', '--cacheinfo', `${mode},${oid},${file}`], { env: indexEnv });
    }
    const finalTree = out(['write-tree'], { env: indexEnv });
    const trailers = pairs.map(([run, entry]) => `Learned-Skills-Run: ${run}\nLearned-Skills-Entry: ${entry}\n`).join('');
    const message = `Rebuild learned-skills PR #${pr} on ${integrationBranch}\n\n${trailers}`;
    const commit = out(['commit-tree', finalTree, '-p', tip, '-F', '-'], { env: indexEnv, input: message });

    const pushEnv = { ...repoPinnedEnv(deps.env), GIT_LITERAL_PATHSPECS: '1' };
    delete pushEnv.GITHUB_TOKEN;
    try {
      git(['push', '--no-verify', `--force-with-lease=refs/heads/${headRef}:${oldHead}`, '--end-of-options', 'origin',
        `${commit}:refs/heads/${headRef}`], { env: pushEnv, timeout: GIT_PUSH_TIMEOUT_MS });
    } catch (err) {
      if (/stale info|\[rejected\]/.test(String(err && err.stderr))) return { ok: false, reason: 'lease-rejected' };
      throw err;
    }
    return { ok: true, commit, tip };
  } catch (err) {
    return { ok: false, reason: 'rebuild-failed', detail: firstStderrLine(err) };
  } finally {
    if (fetched && base && head) {
      for (const ref of [base, head]) {
        try { git(['update-ref', '-d', '--end-of-options', ref]); } catch { /* best effort */ }
      }
    }
    if (dir) { try { deps.rm(dir); } catch { /* best effort */ } }
  }
}

module.exports = { MARKER_SIZE, MIN_GIT, resolveDiff3, rebuild };
