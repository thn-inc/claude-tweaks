#!/usr/bin/env node
'use strict';

// tools/windows-regression/file-issue.js — the post-merge Windows check's
// verdict + issue filer (#3316).
//
// Reads the report.json that `plugin/bin/verify.js --baseline <base> --json`
// wrote on the windows-latest job, decides the job's exit code, and — on
// `main` only — files ONE `type:bug` GitHub issue naming the test files that
// newly fail (or comments on the open issue already covering this commit / the
// open "(not adjudicated)" one). The workflow's result IS this CLI's exit code.
//
// Optional flags: `--log <path>` — the uncapped verify log of the tests check,
// the excerpt source when readable (an unreadable one is a stderr note, not an
// error; the report's capped failingRegion is the fallback). `--base <sha>` —
// the commit verify compared against, named in the issue's lead line.
//
// Exit codes (a CLI-local vocabulary; the only caller is the workflow):
//   0  the verify outcome is a pass (raw pass, or a baseline-adjudicated pass)
//      — nothing filed
//   1  the verify outcome is a failure, whether or not an issue was filed
//      (a non-main ref files nothing); or the report is missing / unreadable /
//      not a JSON object; or `gh issue create` / `gh issue comment` failed
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
const EXCERPT_MAX_LINES = 12;
const FALLBACK_LINES = 200;
const NOT_RUN = 'baseline adjudication did not run';
const REQUIRED_FLAGS = ['--report', '--ref', '--sha', '--repo', '--run-url'];
const OPTIONAL_FLAGS = ['--log', '--base'];
const NOT_ADJUDICATED_SUFFIX = '(not adjudicated)';

const USAGE = `usage: file-issue.js --report <path> --ref <ref> --sha <sha> --repo <owner/name> --run-url <url>
                     [--log <path>] [--base <sha>]

Reads verify.js's report.json and, when the verify outcome is a failure on
${MAIN_REF}, files one ${LABEL} issue naming the newly failing test files — or
comments on the open issue already covering this commit.

  --log <path>   the uncapped verify log of the tests check; the excerpt source
                 when readable, else the report's capped failingRegion
  --base <sha>   the commit verify compared against, named in the issue

exit codes:
  0  the verify outcome is a pass — nothing filed
  1  the verify outcome is a failure (filed on main only), the report is
     unreadable, or \`gh issue create\` / \`gh issue comment\` failed
  2  malformed invocation
`;

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (!REQUIRED_FLAGS.includes(a) && !OPTIONAL_FLAGS.includes(a)) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
    opts[a.slice(2)] = v;
  }
  const missing = REQUIRED_FLAGS.filter((f) => !(f.slice(2) in opts));
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
  // Mirrors verify.js's effectivePass: a declared pre-existing allowlist match is a pass too.
  const preExisting = isPlainObject(report.preExistingAdjudicated) && Array.isArray(report.preExistingAdjudicated.matched);
  const pass = report.pass === true || preExisting || (ba !== null && ba.eligible === true && ba.verdict === 'pass');
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

// Backslash runs collapse to one slash: Node's TAP reporter inspect()-quotes a
// Windows location, doubling every backslash (extract.js's relativize does the same).
const slashes = (s) => s.replace(/\\+/g, '/');

// Does `line` name `needle` as a whole repo-relative path — on a path boundary
// before (start, `/`, quote, whitespace) and after (`:`, quote, whitespace, end)?
function namesFile(line, needle) {
  const l = slashes(line);
  for (let at = l.indexOf(needle); at !== -1; at = l.indexOf(needle, at + 1)) {
    const before = at === 0 ? '' : l[at - 1];
    const after = l.charAt(at + needle.length);
    if ((before === '' || /[/'"\s]/.test(before)) && (after === '' || /[:'"\s]/.test(after))) return true;
  }
  return false;
}

// The excerpt for `file`: from the nearest `not ok` line at or before the first
// line naming the file (so the test's name is shown), through the next ok/not ok
// line or EXCERPT_MAX_LINES. A test boundary (`ok N`, `# Subtest:`, a YAML `...`)
// reached first means the match sits outside any failure block — a crashed file's
// stderr, printed before its own `not ok` — so the excerpt opens just after that
// boundary, where the stderr (and its `Error:` line) begins.
// null when no line names the file.
function excerptFor(file, lines) {
  const needle = slashes(file);
  const hit = lines.findIndex((l) => namesFile(l, needle));
  if (hit === -1) return null;
  let start = hit;
  for (let i = hit; i >= 0; i--) {
    if (/^\s*not ok\b/.test(lines[i])) { start = i; break; }
    if (i < hit && /^\s*(ok \d|# Subtest:|\.\.\.\s*$)/.test(lines[i])) { start = i + 1; break; }
  }
  let end = Math.min(start + EXCERPT_MAX_LINES, lines.length);
  for (let i = start + 1; i < end; i++) if (/^\s*(not )?ok \d/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

function failingRegionOf(report) {
  const tests = isPlainObject(report.checks) ? report.checks.tests : null;
  return isPlainObject(tests) && typeof tests.failingRegion === 'string' ? tests.failingRegion : '';
}

function timedOutOf(report) {
  const ba = report.baselineAdjudicated;
  return isPlainObject(ba) && Array.isArray(ba.timedOut) ? ba.timedOut : [];
}

function composeIssue({ report, verdict, sha, base, pr, runUrl, logText }) {
  const short = sha.slice(0, 9);
  const title = verdict.adjudicated
    ? `Windows regression: ${verdict.attributable.length} test file(s) newly failing after ${short}`
    : `Windows regression: tests failing after ${short} ${NOT_ADJUDICATED_SUFFIX}`;
  const region = failingRegionOf(report);
  const regionLines = region ? region.split(/\r?\n/) : [];
  const parts = [
    base ? `The post-merge Windows check failed on commit ${sha} (compared against ${base.slice(0, 9)}).` : `The post-merge Windows check failed on commit ${sha}.`,
    pr ? `**Merged PR:** #${pr.number} (${pr.url})` : '**Merged PR:** unknown',
    `**Run:** ${runUrl}`,
  ];
  if (verdict.adjudicated) {
    // Every file name first, excerpts after — the body cap can only drop excerpts.
    const timedOut = new Set(timedOutOf(report));
    const excerptLines = typeof logText === 'string' ? logText.split(/\r?\n/) : regionLines;
    const bullets = verdict.attributable.map((f) => `- \`${f}\`${timedOut.has(f) ? ' (timed out — no evidence)' : ''}`);
    parts.push(['### Newly failing test files', ...bullets].join('\n'));
    const excerpts = [];
    for (const file of verdict.attributable) {
      const excerpt = excerptFor(file, excerptLines);
      if (excerpt !== null) excerpts.push(`#### \`${file}\`\n\n${fence(excerpt)}`);
    }
    if (excerpts.length) parts.push(['### Failure excerpts', ...excerpts].join('\n\n'));
  } else {
    const output = regionLines.slice(0, FALLBACK_LINES).join('\n');
    parts.push(`### Failing output (${NOT_RUN}: ${verdict.reason})\n\n${output ? fence(output) : '(no failing output captured)'}`);
  }
  parts.push('_Filed by .github/workflows/windows-regression.yml — failures were compared against the push\'s base commit (verify.js --baseline). Shape it with /claude-tweaks:specify before building._');
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

// The open issue already covering this run, or null: one naming this commit's
// short sha, else — for a run that was not adjudicated — one ending in the
// not-adjudicated suffix. A failing or unparseable listing is "none": it must
// never block filing.
function findExistingIssue(repo, short, adjudicated, deps) {
  try {
    const issues = JSON.parse(deps.gh(['issue', 'list', '--repo', repo, '--state', 'open', '--label', LABEL,
      '--search', 'Windows regression in:title', '--json', 'number,title', '--limit', '50']));
    if (!Array.isArray(issues)) return null;
    const open = issues.filter((i) => isPlainObject(i) && Number.isInteger(i.number) && typeof i.title === 'string');
    const hit = open.find((i) => i.title.includes(short))
      || (adjudicated ? undefined : open.find((i) => i.title.endsWith(NOT_ADJUDICATED_SUFFIX)));
    return hit ? hit.number : null;
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
  const { report: reportPath, ref, sha, repo, 'run-url': runUrl, log: logPath, base } = parsed.opts;

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

  let logText;
  if (logPath && verdict.adjudicated) {
    try {
      logText = deps.readFile(logPath);
    } catch (e) {
      err(`${TOOL}: cannot read log ${logPath}: ${e.message} — using the report's failing region`);
    }
  }

  const { title, body } = composeIssue({ report, verdict, sha, base, pr: lookupMergedPr(repo, sha, deps), runUrl, logText });
  const existing = findExistingIssue(repo, sha.slice(0, 9), verdict.adjudicated, deps);
  if (existing !== null) {
    try {
      deps.gh(['issue', 'comment', String(existing), '--repo', repo, '--body-file', '-'], body);
      out(`${TOOL}: commented on #${existing} (existing open issue)`);
    } catch (e) {
      err(`${TOOL}: gh issue comment failed: ${e.message}`);
    }
    return 1;
  }
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
