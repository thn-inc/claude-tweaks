#!/usr/bin/env node
'use strict';

// tools/windows-regression/file-issue.js — the post-merge Windows check's
// verdict + issue filer (#3316).
//
// Reads the report.json that `plugin/bin/verify.js --baseline HEAD^1 --json`
// wrote on the windows-latest job, decides the job's exit code, and — on
// `main` only — files ONE `type:bug` GitHub issue naming the test files that
// newly fail. The workflow's result IS this CLI's exit code.
//
// Exit codes (a CLI-local vocabulary; the only caller is the workflow):
//   0  the verify outcome is a pass (raw pass, or a baseline-adjudicated pass)
//      — nothing filed
//   1  the verify outcome is a failure, whether or not an issue was filed
//      (a non-main ref files nothing); or the report is missing / unreadable /
//      not a JSON object; or `gh issue create` failed
//   2  malformed invocation
//
// Fails closed: a failed run whose adjudication never ran or crashed
// (`eligible: false`, or no `baselineAdjudicated` at all) still exits 1 and
// still files, titled "(not adjudicated)" with the raw failing output.
//
// Maintainer-only tooling under tools/ — not shipped plugin payload.

const fs = require('fs');
const { execFileSync } = require('child_process');

const TOOL = 'windows-regression';
const MAIN_REF = 'refs/heads/main';
const LABEL = 'type:bug';
const BODY_CAP = 60000;
const TRUNCATION_NOTE = '\n\n…(truncated — see the run\'s verify-report artifact)';
const EXCERPT_AFTER = 10;
const FALLBACK_LINES = 200;
const NOT_RUN = 'baseline adjudication did not run';
const FLAGS = ['--report', '--ref', '--sha', '--repo', '--run-url'];

const USAGE = `usage: file-issue.js --report <path> --ref <ref> --sha <sha> --repo <owner/name> --run-url <url>

Reads verify.js's report.json and, when the verify outcome is a failure on
${MAIN_REF}, files one ${LABEL} issue naming the newly failing test files.

exit codes:
  0  the verify outcome is a pass — nothing filed
  1  the verify outcome is a failure (filed on main only), the report is
     unreadable, or \`gh issue create\` failed
  2  malformed invocation
`;

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (!FLAGS.includes(a)) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
    opts[a.slice(2)] = v;
  }
  const missing = FLAGS.filter((f) => !(f.slice(2) in opts));
  if (missing.length) return { error: `missing required flag(s): ${missing.join(', ')}` };
  return { opts };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The verify outcome. `pass` — report.pass === true or an adjudicated pass.
// `adjudicated` — a usable baseline verdict naming files; false (with `reason`)
// when adjudication was absent, ineligible, or named nothing, in which case a
// failure is reported from the raw output instead.
function classify(report) {
  const ba = isPlainObject(report.baselineAdjudicated) ? report.baselineAdjudicated : null;
  const attributable = ba && Array.isArray(ba.attributable) ? ba.attributable.filter((f) => typeof f === 'string') : [];
  let reason = null;
  if (!ba) reason = NOT_RUN;
  else if (ba.eligible !== true) reason = typeof ba.reason === 'string' && ba.reason ? ba.reason : NOT_RUN;
  const pass = report.pass === true || (ba !== null && ba.eligible === true && ba.verdict === 'pass');
  if (reason === null && attributable.length === 0 && !pass) reason = 'baseline adjudication named no failing test file';
  return { outcome: pass ? 'pass' : 'fail', adjudicated: reason === null, attributable, reason };
}

function findMergedPr(pulls) {
  if (!Array.isArray(pulls)) return null;
  const hit = pulls.find((p) => isPlainObject(p) && p.merged_at);
  return hit ? { number: hit.number, url: hit.html_url } : null;
}

// A fence longer than any backtick run inside the text, so test output that
// itself contains ``` cannot close it early.
function fence(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map((r) => r.length));
  const f = '`'.repeat(longest + 1);
  return `${f}\n${text}\n${f}`;
}

const slashes = (s) => s.replace(/\\/g, '/');

// The first failingRegion line mentioning the file (a Windows TAP location is
// backslash-absolute, the attributable path is repo-relative with slashes),
// plus the lines after it. null when no line names the file.
function excerptFor(file, lines) {
  const needle = slashes(file);
  const at = lines.findIndex((l) => slashes(l).includes(needle));
  return at === -1 ? null : lines.slice(at, at + 1 + EXCERPT_AFTER).join('\n');
}

function failingRegionOf(report) {
  const tests = isPlainObject(report.checks) ? report.checks.tests : null;
  return isPlainObject(tests) && typeof tests.failingRegion === 'string' ? tests.failingRegion : '';
}

function composeIssue({ report, verdict, sha, pr, runUrl }) {
  const short = sha.slice(0, 9);
  const title = verdict.adjudicated
    ? `Windows regression: ${verdict.attributable.length} test file(s) newly failing after ${short}`
    : `Windows regression: tests failing after ${short} (not adjudicated)`;
  const region = failingRegionOf(report);
  const lines = region ? region.split(/\r?\n/) : [];
  const parts = [
    `The post-merge Windows check failed on commit ${sha}.`,
    pr ? `**Merged PR:** #${pr.number} (${pr.url})` : '**Merged PR:** unknown',
    `**Run:** ${runUrl}`,
  ];
  if (verdict.adjudicated) {
    const sections = ['### Newly failing test files'];
    for (const file of verdict.attributable) {
      const excerpt = excerptFor(file, lines);
      sections.push(excerpt === null ? `- \`${file}\`` : `- \`${file}\`\n\n${fence(excerpt)}`);
    }
    parts.push(sections.join('\n\n'));
  } else {
    const output = lines.slice(0, FALLBACK_LINES).join('\n');
    parts.push(`### Failing output (${NOT_RUN}: ${verdict.reason})\n\n${output ? fence(output) : '(no failing output captured)'}`);
  }
  parts.push('_Filed by .github/workflows/windows-regression.yml — failures were compared against the previous commit on main (verify.js --baseline HEAD^1). Shape it with /claude-tweaks:specify before building._');
  let body = parts.join('\n\n');
  if (body.length > BODY_CAP) body = body.slice(0, BODY_CAP) + TRUNCATION_NOTE;
  return { title, body };
}

function lookupMergedPr(repo, sha, deps) {
  try {
    return findMergedPr(JSON.parse(deps.gh(['api', `repos/${repo}/commits/${sha}/pulls`])));
  } catch {
    return null;
  }
}

function run(argv, deps) {
  const out = (s) => deps.stdout(`${s}\n`);
  const err = (s) => deps.stderr(`${s}\n`);
  const parsed = parseArgs(argv);
  if (parsed.help) { deps.stdout(USAGE); return 0; }
  if (parsed.error) { err(`${TOOL}: ${parsed.error}`); deps.stderr(USAGE); return 2; }
  const { report: reportPath, ref, sha, repo, 'run-url': runUrl } = parsed.opts;

  let report;
  try {
    report = JSON.parse(deps.readFile(reportPath));
  } catch (e) {
    err(`${TOOL}: cannot read report ${reportPath}: ${e.message}`);
    return 1;
  }
  if (!isPlainObject(report)) {
    err(`${TOOL}: report ${reportPath} is not a JSON object`);
    return 1;
  }

  const verdict = classify(report);
  if (verdict.outcome === 'pass') { out(`${TOOL}: pass — nothing to file`); return 0; }
  if (ref !== MAIN_REF) { out(`${TOOL}: fail on ${ref} — not filing (main only)`); return 1; }

  const { title, body } = composeIssue({ report, verdict, sha, pr: lookupMergedPr(repo, sha, deps), runUrl });
  try {
    const url = String(deps.gh(['issue', 'create', '--repo', repo, '--label', LABEL, '--title', title, '--body-file', '-'], body)).trim();
    out(url);
  } catch (e) {
    err(`${TOOL}: gh issue create failed: ${e.message}`);
  }
  return 1;
}

function defaultDeps() {
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    gh: (args, input) => execFileSync('gh', args, { input, encoding: 'utf8' }),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
}

function main(argv) {
  process.exitCode = run(argv, defaultDeps());
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { run, classify, findMergedPr, composeIssue, parseArgs, defaultDeps, USAGE };
