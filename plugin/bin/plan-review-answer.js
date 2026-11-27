#!/usr/bin/env node
// bin/plan-review-answer.js — ingest a human's `/answer` replies to a plan-review question into the
// record body (#5053). Reads the record's body, labels and comments once, hands them to the pure
// detection in lib/issues/plan-review-answers.js (which owns trust, ordering and idempotence), and,
// unless --check, writes the folded body back with one `gh issue edit` and reads it back.
//
// Usage: plan-review-answer.js --issue <N> [--check] [--help]
//   On exit 0 or 3, stdout is one JSON line: {issue, state, question, questionCreatedAt, replies,
//   ingested}; exits 2 and 4 print to stderr only, with nothing on stdout. A read-back exit 4 may
//   follow a write that landed.
//     state              'no-question' | 'unanswered' | 'answered'
//     question           the question comment's URL, or null
//     questionCreatedAt  the question comment's createdAt, or null
//     replies            the URLs of every trusted `/answer` reply to that question
//     ingested           the reply URLs this call wrote into the body ([] with --check, or when
//                        every reply already has its Decision header in the body)
//   --check            read-only: report the state, never edit
//   The write (only when a reply is pending and not --check): one
//     gh issue edit <N> --repo <slug> --body-file <tmp> [--remove-label needs:answer]
//   with --remove-label only when the read labels carry needs:answer. The body file lives under the
//   session temp root and is removed afterwards. The edit is then read back: every pending reply URL
//   must head exactly one unfenced `**Decision**` line in the new body (decisionHeaderUrls, the same
//   parser that decided it was pending).
// Exit codes (a CLI-specific vocabulary — dispatch/answered-resumes.md's relay branches on 0 and 3):
//   0  answered: every reply is in the body (ingested now, or already)
//   3  unanswered, or no trusted question (JSON on stdout)
//   2  malformed invocation, or `gh` absent / the repo slug unresolved
//   4  a read, the write or the read-back failed, or the new body would pass 65,536 characters
//      (nothing is written); no failed step is taken as a clean answer
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const claimStore = require('./lib/issues/claim-store');
const { answeredState, appendAnswers, decisionHeaderUrls } = require('./lib/issues/plan-review-answers');
const { ghAvailable, ghOptions } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const { sessionTmpPath, envTmpdir } = require('./lib/session-tmp');

const BODY_CAP = 65536;
const ANSWER_LABEL = 'needs:answer';

const USAGE = 'usage: plan-review-answer.js --issue <N> [--check] [--help]\n'
  + '  prints one JSON line: {issue, state, question, questionCreatedAt, replies, ingested}\n'
  + '  --check  read-only: report the state, never edit the record\n'
  + '  exit 0 answered (ingested now or already) / 3 unanswered or no question / 2 usage error or gh absent / 4 a read, the write or the read-back failed\n';

// ---- real deps ----

// maxBuffer: the issue read carries the body and every comment.
function defaultGh(args) {
  return execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  }));
}

// The body file's path: under this session's temp root, else an own-pid file in the temp dir.
function defaultTmpPath(name) {
  const tmpdir = envTmpdir(process.env);
  return sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, name, { tmpdir })
    || path.join(tmpdir, `ct-plan-review-answer-${process.pid}-${name}`);
}

const realDeps = {
  ghAvailable: () => ghAvailable(),
  gh: defaultGh,
  tmpPath: defaultTmpPath,
  writeFile: (file, text) => fs.writeFileSync(file, text, 'utf8'),
  removeFile: (file) => { try { fs.rmSync(file, { force: true }); } catch { /* best effort: a leftover temp file is harmless */ } },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// ---- argv ----

function parseArgs(argv) {
  const o = { issue: null, check: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--check') { o.check = true; continue; }
    if (a !== '--issue') return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: '--issue requires a value' };
    if (!/^[1-9]\d*$/.test(v)) return { error: `--issue must be a positive integer, got ${JSON.stringify(v)}` };
    o.issue = Number(v);
  }
  return o;
}

// ---- failure plumbing ----

class Exit extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const errText = (e) => (e && e.message) || String(e);

// A dep call whose failure is a failed read or write (exit 4), never a clean answer.
function step(label, fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Exit) throw e;
    throw new Exit(4, `${label}: ${errText(e)}`);
  }
}

// ---- gh reads ----

// The record as the detection needs it: body text, label names, the comments array.
function readIssue(deps, slug, issue, label) {
  const out = step(label, () => deps.gh(['issue', 'view', String(issue), '--repo', slug, '--json', 'body,labels,comments']));
  const parsed = step(`${label} output`, () => JSON.parse(out));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.comments) || !Array.isArray(parsed.labels)) {
    throw new Exit(4, `${label}: body, labels or comments missing from the reply`);
  }
  return {
    body: typeof parsed.body === 'string' ? parsed.body : '',
    labels: parsed.labels.map((l) => (typeof l === 'string' ? l : l && l.name)).filter((l) => typeof l === 'string'),
    comments: parsed.comments,
  };
}

// ---- the write ----

function ingest(ctx, rec, st) {
  const { deps, slug, issue } = ctx;
  const next = appendAnswers(rec.body, st.question, st.pending);
  if (next.length > BODY_CAP) {
    throw new Exit(4, `the body would grow to ${next.length} characters, past the ${BODY_CAP} cap — nothing written`);
  }
  const file = step('body file path', () => deps.tmpPath(`plan-review-answer-${issue}.md`));
  if (typeof file !== 'string' || file === '') throw new Exit(4, 'body file path: no temp path available');
  try {
    step('body file write', () => deps.writeFile(file, next));
    const args = ['issue', 'edit', String(issue), '--repo', slug, '--body-file', file];
    if (rec.labels.includes(ANSWER_LABEL)) args.push('--remove-label', ANSWER_LABEL);
    step('gh issue edit', () => deps.gh(args));
  } finally {
    try { deps.removeFile(file); } catch { /* best effort */ }
  }
  const after = readIssue(deps, slug, issue, 'read-back');
  const headers = decisionHeaderUrls(after.body);
  for (const reply of st.pending) {
    const n = headers.filter((url) => url === reply.url).length;
    if (n !== 1) throw new Exit(4, `read-back: ${n} Decision header lines for ${reply.url} in the new body, expected one`);
  }
  return st.pending.map((r) => r.url);
}

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return 0; }
  const fail = (code, message) => { deps.stderr(`plan-review-answer.js: ${message}\n${code === 2 ? USAGE : ''}`); return code; };
  if (opts.error) return fail(2, opts.error);
  if (opts.issue === null) return fail(2, '--issue is required');

  try {
    let available = false;
    try { available = deps.ghAvailable(); } catch { /* a throwing probe reads as gh absent */ }
    if (!available) throw new Exit(2, 'gh CLI not found on PATH — plan-review-answer needs it to read and edit the record');
    let slug = null;
    try {
      slug = claimStore.resolveRepoSlugOrThrow(deps.gh);
    } catch (e) {
      throw new Exit(2, `could not resolve the repo slug: ${errText(e)}`);
    }
    if (!slug) throw new Exit(2, 'could not resolve the repo slug (gh repo view returned nothing)');

    const ctx = { deps, slug, issue: opts.issue };
    const rec = readIssue(deps, slug, opts.issue, `gh issue view #${opts.issue}`);
    const st = answeredState({ comments: rec.comments, body: rec.body });
    const ingested = !opts.check && st.pending.length > 0 ? ingest(ctx, rec, st) : [];
    deps.stdout(`${JSON.stringify({
      issue: opts.issue,
      state: st.state,
      question: st.question ? (st.question.url || null) : null,
      questionCreatedAt: st.question ? (st.question.createdAt || null) : null,
      replies: st.replies.map((r) => r.url),
      ingested,
    })}\n`);
    return st.state === 'answered' ? 0 : 3;
  } catch (e) {
    if (e instanceof Exit) return fail(e.code, e.message);
    return fail(4, `unexpected failure: ${errText(e)}`);
  }
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
