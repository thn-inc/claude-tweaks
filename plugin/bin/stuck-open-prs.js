#!/usr/bin/env node
// bin/stuck-open-prs.js — the finder behind the `stuck:open-pr` row of `/claude-tweaks:backlog
// attention` (#4849). A granted record (`auto:build`, no `bot:*` label) whose claim was released
// while an open PR still closes it is invisible to every other attention row, and nothing in the
// queue picks it up (the open-PR exclusion keeps it out). This reads one snapshot of the open records
// and prints the ones that are stuck, each with the remedy `dispatch-resume.js` itself gives for it.
//
// Usage: stuck-open-prs.js --records <path> [--help]
//   --records  a JSON array of open records as the attention snapshot holds them
//              (`number`, `state`, `title`, `createdAt`, `labels:[{name}]`), the file the skill wrote
// Stdout is one JSON line, `{rows:[{number, pr, remedy, title, createdAt, labels}]}`: the last three are
// copied from the record, so the caller can rank the row and print its age. A record renders no row
// when it has no open closing PR, when a live claim or a live sibling session holds it, or when the
// verdict says a provably live run does; a read that failed is a row whose remedy says so, never an
// absent one. Per record with an open PR, in this order, because the verdict can refuse a PR it cannot
// resume (foreign, bundled, a fork's, not a draft) before it reads either:
//   1. the claim (a live one skips the record; a failed read is an unreadable row and the verdict never runs)
//   2. the sibling session by `#N` token (a hit skips the record)
//   3. the verdict, `dispatch-resume.js --issue N`, run in process
//   4. the sibling session on the verdict's head, the exact read (a hit skips the record)
// Exit codes (a CLI-specific vocabulary — a row is data on stdout, so there is no exit 1 or 3):
//   0  rows printed, possibly none
//   2  malformed invocation, an unreadable or malformed --records file, `gh` absent, or the repo or
//      the main checkout unresolved
//   4  the batched linked-PR read failed; nothing is printed, since no failed read is taken as "no PR"
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const dispatchResume = require('./dispatch-resume');
const { fetchLinkedPRs } = require('./lib/issues/linked-prs');
const { classifyClaimBlob } = require('./lib/issues/claims');
const {
  parseRepo, ghAvailable, remoteUrl, ghOptions,
} = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');
const { findConflictingSession, findSessionOnWorktree } = require('./lib/hooks/sibling-sessions');
const { stuckCandidates, stuckRow } = require('./lib/dispatch/stuck-open-pr');

const USAGE = 'usage: stuck-open-prs.js --records <path> [--help]\n'
  + '  prints one JSON line: {rows:[{number, pr, remedy, title, createdAt, labels}]} (exit 0)\n'
  + '  exit 2 malformed invocation / unreadable --records / gh absent / repo or main checkout unresolved;\n'
  + '  exit 4 the linked-PR read failed\n';

// ---- real deps ----

// One aliased GraphQL call covers every candidate; the shared timeout bounds it like the other batched reads.
function ghRunner(args) {
  return execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  }));
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  ghAvailable: () => ghAvailable(),
  repo: () => parseRepo(remoteUrl()),
  mainRoot: () => mainCheckoutRoot(process.cwd()),
  linked: ({
    numbers, owner, repo, host,
  }) => fetchLinkedPRs({
    numbers, owner, repo, host, runner: ghRunner,
  }),
  // The verdict CLI's own reader, so the claim a row is judged on is the claim the verdict would read.
  readClaim: dispatchResume.realDeps.readClaim,
  findSibling: findConflictingSession,
  findSiblingOnWorktree: findSessionOnWorktree,
  resume: (n, io) => dispatchResume.run(['--issue', String(n)], { ...dispatchResume.realDeps, stdout: io.stdout, stderr: io.stderr }),
  now: () => Date.now(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// ---- argv ----

function parseArgs(argv) {
  const o = { records: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a !== '--records') return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
    o.records = v;
  }
  return o;
}

// ---- reads ----

const errText = (e) => (e && e.message) || String(e);

// Every entry must be a record with a positive integer number: a snapshot is the skill's own gh output,
// so a malformed one is a bug upstream, not a record to skip.
function readRecords(deps, file) {
  let parsed;
  try {
    parsed = JSON.parse(deps.readFile(file));
  } catch (e) {
    return { error: `could not read --records ${file}: ${errText(e)}` };
  }
  if (!Array.isArray(parsed)) return { error: `--records ${file} is not a JSON array` };
  const bad = parsed.find((r) => r === null || typeof r !== 'object' || !Number.isInteger(r.number) || r.number < 1);
  if (bad !== undefined) return { error: `--records ${file} holds an entry that is not a record with a positive integer number` };
  return { records: parsed };
}

// The verdict dispatch-resume.js prints for one record: {code, verdict}. A run that throws, exits on a
// code it does not document, or prints something that is not a JSON object has no verdict (null).
function readVerdict(deps, n) {
  let text = '';
  let errors = '';
  let code;
  try {
    code = deps.resume(n, { stdout: (s) => { text += s; }, stderr: (s) => { errors += s; } });
  } catch (e) {
    return { code: 4, verdict: null, errors: errText(e) };
  }
  if (!Number.isInteger(code)) code = 4;
  let verdict = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) verdict = parsed;
  } catch { /* no verdict: the row says so */ }
  return { code, verdict, errors };
}

// ---- run ----

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return 0; }
  const fail = (code, message) => { deps.stderr(`stuck-open-prs.js: ${message}\n${code === 2 ? USAGE : ''}`); return code; };
  if (opts.error) return fail(2, opts.error);
  if (opts.records === null) return fail(2, '--records is required');

  const read = readRecords(deps, opts.records);
  if (read.error) return fail(2, read.error);
  const byNumber = new Map(read.records.map((r) => [r.number, r]));
  const candidates = stuckCandidates(read.records);

  let available = false;
  try { available = deps.ghAvailable(); } catch { /* a throwing probe reads as gh absent */ }
  if (!available) return fail(2, 'gh CLI not found on PATH — the linked-PR read needs it');
  let mainRoot = null;
  try { mainRoot = deps.mainRoot(); } catch { /* refused just below */ }
  if (!mainRoot) return fail(2, 'could not resolve the main checkout root');
  let repo = null;
  try { repo = deps.repo(); } catch { /* refused just below */ }
  if (!repo || !repo.owner || !repo.repo) return fail(2, 'could not resolve owner/repo from the origin remote');

  const rows = [];
  if (candidates.length > 0) {
    let linked;
    try {
      linked = deps.linked({
        numbers: candidates, owner: repo.owner, repo: repo.repo, host: repo.host,
      });
      const missing = candidates.filter((n) => !linked || typeof linked.get !== 'function' || linked.get(n) === undefined || linked.get(n) === null);
      if (missing.length > 0) throw new Error(`no linked-PR entry for ${missing.map((n) => `#${n}`).join(', ')}`);
    } catch (e) {
      return fail(4, `linked-PR read failed: ${errText(e)}`);
    }

    const slug = `${repo.owner}/${repo.repo}`;
    for (const n of candidates) {
      const pr = linked.get(n).openPR;
      if (!Number.isInteger(pr)) continue;
      const row = stuckRowFor(deps, { n, pr, slug, mainRoot });
      if (row !== null) {
        const r = byNumber.get(n);
        rows.push({ ...row, title: r.title, createdAt: r.createdAt, labels: r.labels });
      }
    }
  }
  deps.stdout(`${JSON.stringify({ rows })}\n`);
  return 0;
}

// One candidate with an open PR -> its row, or null when a live owner holds it. A read that fails or
// throws is an unreadable row (exit code 4 in its message), so a record is never hidden by a failure.
function stuckRowFor(deps, {
  n, pr, slug, mainRoot,
}) {
  const unreadable = (code = 4) => stuckRow({
    number: n, pr, code, verdict: null,
  });
  try {
    const claim = deps.readClaim(slug, n);
    if (!claim || claim.failure) return unreadable();
    if (classifyClaimBlob(claim.absent ? null : claim.content, deps.now()).state === 'live') return null;
    if (deps.findSibling(`#${n}`, { cwd: mainRoot }) !== null) return null;

    const { code, verdict, errors } = readVerdict(deps, n);
    if (errors.trim() !== '') deps.stderr(`stuck-open-prs.js: #${n}: ${errors.trim()}\n`);
    const row = stuckRow({
      number: n, pr, code, verdict,
    });
    if (row === null) return null;
    const head = verdict && typeof verdict.headRefName === 'string' && verdict.headRefName !== '' ? verdict.headRefName : null;
    if (head !== null && deps.findSiblingOnWorktree({ branch: head }, { cwd: mainRoot }) !== null) return null;
    return row;
  } catch {
    return unreadable();
  }
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
