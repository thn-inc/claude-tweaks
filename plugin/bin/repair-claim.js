#!/usr/bin/env node
// bin/repair-claim.js — repair or force-release an UNREADABLE claims-registry blob.
//   node bin/repair-claim.js <issue> --run <run-dir> --mode <release|reclaim> --reason <reason> \
//     [--link <url>] [--repo owner/name] [--section "/<skill>"] [--step <text>] [--help]
// Mechanizes _shared/issue-claims.md's "Repairing an unreadable claim blob" steps 1-4:
// read the blob and capture its sha (ordinary response metadata, available even when the
// content doesn't parse), confirm the content classifies 'unreadable' on that same fresh
// read, conditionally overwrite with sha set — releasePayload-shaped tombstone (`release`
// mode) or claimPayload-shaped content (`reclaim` mode) — and log the override. The gate
// is the exact inverse of release-claim.js's exit 5: 'unreadable' -> proceed; a live,
// stale, tombstone, or absent blob -> refuse, nothing written (those states belong to
// release-claim.js and the acquire path). Exit 0 repaired; 3 CAS rejection (sha changed
// between read and write — re-read and reassess, never retried blind); 4 refused (blob
// does not classify 'unreadable' on the fresh read); 1 failed — any other error;
// 2 malformed invocation or `gh` absent — the MCP path in _shared/issue-claims.md's
// subsection stays the documented fallback, deliberately not grown into this CLI.
// The overwrite destroys content that may encode a real holder's identity, so the
// override is logged (AUTO line in <run-dir>/decisions.md via resolveTarget — a
// worktree-local shadow is refused, never silently written) and mirrored as an issue
// comment; logging is bookkeeping, never a gate: the exit code always reflects the
// repair outcome, never whether decisions.md was written.
'use strict';

const path = require('path');
const { repairClaim, defaultRunner: repairDefaultRunner } = require('./lib/repair-claim/repair');
const { formatEntry, appendEntry, resolveTarget } = require('./lib/log-decision/append');
const { defaultRunner: gitDefaultRunner } = require('./lib/issues/claims-git-cas');
const { parseRepo, ghAvailable, remoteUrl } = require('./lib/repo-resolve');

const USAGE = 'usage: repair-claim.js <issue> --run <run-dir> --mode <release|reclaim> --reason <reason> [--link <url>] [--repo owner/name] [--section "/<skill>"] [--step <text>] [--help]\n';
const EXIT = { repaired: 0, 'cas-rejected': 3, refused: 4, failed: 1 };
const MODES = ['release', 'reclaim'];

// `--mode`'s value is deliberately NOT validated here — repair.js's own gate
// falls through to reclaim for any non-'release' value (Task 1's ruling), so
// `run()` below is the one place that rejects anything outside {release,
// reclaim}. Keeping that check out of parseArgs matches release-claim.js's
// split (parseArgs = shape, run = semantics).
function parseArgs(argv) {
  const o = {
    issue: null, run: null, mode: null, reason: null, link: null, repo: null, section: null, step: null, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; return v === undefined ? null : v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else if (a === '--mode') o.mode = next();
    else if (a === '--reason') o.reason = next();
    else if (a === '--link') o.link = next();
    else if (a === '--repo') o.repo = next();
    else if (a === '--section') o.section = next();
    else if (a === '--step') o.step = next();
    else if (/^--/.test(a)) return { error: `unknown argument: ${a}` };
    else if (o.issue === null) o.issue = a;
    else return { error: `unexpected argument: ${a}` };
  }
  return o;
}

const realDeps = {
  repair: repairClaim,
  runner: repairDefaultRunner,
  gitRunner: gitDefaultRunner,
  ghAvailable,
  remoteUrl,
  now: () => Date.now(),
  cwd: () => process.cwd(),
  mainRoot: undefined,
  sessionId: () => process.env.CLAUDE_CODE_SESSION_ID || '',
  host: () => require('os').hostname(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function decisionText(issue, r, mode, reason, link) {
  if (r.outcome === 'repaired') return `repaired unreadable claim blob on #${issue} (mode ${mode}; ${reason})${link ? `; link ${link}` : ''}`;
  if (r.outcome === 'refused') return `refused claim repair on #${issue}: blob classifies '${r.state}', not 'unreadable' — nothing written`;
  if (r.outcome === 'cas-rejected') return `claim repair on #${issue} rejected by compare-and-swap (sha changed since read) — nothing written; re-read and reassess`;
  return `claim repair of #${issue} FAILED (${reason}): ${r.error}`;
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(o.error + '\n' + USAGE); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (o.issue === null) { deps.stderr('repair-claim.js: <issue> is required\n' + USAGE); return 2; }
  const issue = Number(o.issue);
  if (!Number.isInteger(issue) || issue <= 0) { deps.stderr('repair-claim.js: <issue> must be a positive integer\n' + USAGE); return 2; }
  if (!o.run) { deps.stderr('repair-claim.js: --run <run-dir> is required (its basename is the claim runId)\n' + USAGE); return 2; }
  if (!o.mode || !MODES.includes(o.mode)) { deps.stderr(`repair-claim.js: --mode must be one of ${MODES.join('|')}\n` + USAGE); return 2; }
  if (!o.reason || !o.reason.trim()) { deps.stderr('repair-claim.js: --reason is required\n' + USAGE); return 2; }
  if (!deps.ghAvailable()) {
    deps.stderr('repair-claim.js: `gh` is required — in a gh-absent environment run the same read-classify-write manually per _shared/issue-claims.md\'s "Repairing an unreadable claim blob" section (MCP path).\n');
    return 2;
  }
  let remote = null;
  if (!o.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
  const repoSpec = o.repo ? parseRepo(o.repo.split('/').length >= 3 ? o.repo : `github.com/${o.repo}`) : parseRepo(remote);
  if (!repoSpec) { deps.stderr('repair-claim.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
  // #1443: parseRepo's regex accepts any non-'/' owner/repo segment, including '.'/'..'
  // (#1153 review finding). repair -> claim-store.js interpolates `${owner}/${repo}`
  // directly into a `gh api repos/{repoSlug}/contents/...` path, the same reachable
  // sink release-claim.js/link-records.js/backlog-grant-gate.js already guard.
  if (repoSpec.owner === '.' || repoSpec.owner === '..' || repoSpec.repo === '.' || repoSpec.repo === '..') {
    deps.stderr('repair-claim.js: invalid --repo value — owner/repo cannot be "." or ".."\n');
    return 2;
  }
  const runDir = o.run.replace(/\/+$/, '');
  const runId = path.basename(runDir);
  const reason = o.reason.trim();
  // Anchoring is resolved and any refusal warned BEFORE the destructive
  // repair call runs, so an operator sees "decisions.md will not be written"
  // before content is overwritten, not after (Finding 3, spec #1608).
  let target;
  try { target = resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch { target = { ok: false, reason: 'missing' }; }
  if (!target.ok) {
    if (target.reason === 'not-anchored') {
      deps.stderr(`repair-claim.js: decisions.md not written — run dir is not anchored under the main checkout (a worktree-local shadow): ${runDir} — see _shared/pipeline-run-dir.md\n`);
    } else {
      deps.stderr(`repair-claim.js: decisions.md not written — run dir does not exist: ${runDir}\n`);
    }
  }
  const r = deps.repair({
    owner: repoSpec.owner, repo: repoSpec.repo, ghHost: repoSpec.host, issueNumber: issue, runId, mode: o.mode, reason, link: o.link || undefined,
    sessionId: deps.sessionId(), host: deps.host(), runner: deps.runner, gitRunner: deps.gitRunner, now: deps.now(),
  });
  let logged = false;
  if (target.ok) {
    const reversibility = r.outcome === 'repaired' ? 'low' : 'n/a';
    const entry = formatEntry({
      status: 'AUTO', now: deps.now(), step: o.step || 'claim repair', text: decisionText(issue, r, o.mode, reason, o.link), reversibility,
    });
    try { appendEntry({ runDir, section: o.section, entry }); logged = true; } catch (err) { deps.stderr(`repair-claim.js: decisions.md not written (${err && err.message})\n`); }
  }
  deps.stdout(JSON.stringify({
    issue, runId, mode: o.mode, reason, link: o.link || null, outcome: r.outcome, state: r.state, commentPosted: r.commentPosted, note: r.note || null, error: r.error || null, logged,
  }, null, 2) + '\n');
  return EXIT[r.outcome] ?? 1;
}

// `realDeps` is exported so the CLI's own wiring is testable — specifically
// that `gitRunner` is the real claims-git-cas runner and `repair` is the real
// repairClaim module function, neither silently dropped or stubbed. Tests
// inject their own deps into `run` and never use this object.
module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
