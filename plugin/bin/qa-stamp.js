#!/usr/bin/env node
// bin/qa-stamp.js — write and check the QA pass stamp (#3003), the only writer
// of {git-dir}/claude-tweaks-qa-pass.json (lib/verify/qa-stamp.js holds the
// rules). /claude-tweaks:test runs --write after QA Phase 5 writes report.json,
// and --check before pipeline story dispatch, so a dispatched group's second
// call skips stories that already passed at the same clean HEAD.
//
//   node bin/qa-stamp.js --write --report <RUN_DIR/report.json> [--stories-dir <dir>]
//   node bin/qa-stamp.js --check --stories <id=file,...> [--stories-dir <dir>]
//
// Prints one JSON line: --write → {written: true, path, sha, stories} or
// {written: false, reason}; --check → {skip, reason, sha}. Status is data:
// exit 0 in every state; 2 malformed invocation.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  composeQaStamp, decideQaSkip, readQaStamp, writeQaStamp,
} = require('./lib/verify/qa-stamp');
const { gitInfo, gitDir } = require('./lib/verify/report');

const USAGE = 'usage: qa-stamp.js --write --report <RUN_DIR/report.json> [--stories-dir <dir>]\n'
  + '       qa-stamp.js --check --stories <id=file,...> [--stories-dir <dir>]\n'
  + '  prints one JSON line; exit 0 in every state; 2 malformed invocation\n';

function parseArgs(argv) {
  const o = {
    write: false, check: false, report: null, storiesDir: null, stories: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') o.write = true;
    else if (a === '--check') o.check = true;
    else if (a === '--report') o.report = argv[++i] ?? null;
    else if (a === '--stories-dir') o.storiesDir = argv[++i] ?? null;
    else if (a === '--stories') {
      const raw = argv[++i] ?? '';
      const pairs = raw.split(',').filter(Boolean).map((item) => {
        const eq = item.indexOf('=');
        return eq > 0 && eq < item.length - 1 ? { id: item.slice(0, eq), file: item.slice(eq + 1) } : null;
      });
      if (pairs.length === 0 || pairs.includes(null)) return { error: `--stories expects id=file[,id=file...]: ${raw}` };
      o.stories = pairs;
    } else return { error: `unknown argument: ${a}` };
  }
  if (o.write === o.check) return { error: 'exactly one of --write or --check is required' };
  if (o.write && !o.report) return { error: '--write requires --report <path>' };
  if (o.check && !o.stories) return { error: '--check requires --stories <id=file,...>' };
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  gitInfo: () => gitInfo(),
  gitDir: () => gitDir(),
  now: () => new Date().toISOString(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function hashFile(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; }
}

function emit(deps, body) {
  deps.stdout(`${JSON.stringify(body)}\n`);
  return 0;
}

function write(o, deps) {
  let report;
  try { report = JSON.parse(fs.readFileSync(o.report, 'utf8')); } catch {
    return emit(deps, { written: false, reason: 'report-unreadable' });
  }
  const dir = deps.gitDir();
  if (!dir) return emit(deps, { written: false, reason: 'no-git-dir' });
  const storiesDir = o.storiesDir || report.stories_dir || 'stories';
  const storyHashes = {};
  for (const s of Array.isArray(report.stories) ? report.stories : []) {
    storyHashes[s.source_file] = hashFile(path.join(deps.cwd(), storiesDir, String(s.source_file)));
  }
  const { sha, dirty } = deps.gitInfo();
  const { stamp, error } = composeQaStamp({
    report, head: sha, dirty, storyHashes, storiesDir, reportPath: path.resolve(o.report), at: deps.now(),
  });
  if (error) return emit(deps, { written: false, reason: error });
  const p = writeQaStamp(dir, stamp);
  return emit(deps, { written: true, path: p, sha: stamp.sha, stories: stamp.stories.length });
}

function check(o, deps) {
  const dir = deps.gitDir();
  const stamp = dir ? readQaStamp(dir) : null;
  const storiesDir = o.storiesDir || 'stories';
  const selected = o.stories.map((s) => ({ ...s, sha256: hashFile(path.join(deps.cwd(), storiesDir, s.file)) }));
  const { sha, dirty } = deps.gitInfo();
  const verdict = decideQaSkip({
    stamp, head: sha, dirty, storiesDir, selected,
  });
  return emit(deps, { ...verdict, sha: stamp ? stamp.sha : null });
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`qa-stamp.js: ${o.error}\n${USAGE}`); return 2; }
  return o.write ? write(o, deps) : check(o, deps);
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
