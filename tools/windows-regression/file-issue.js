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
const TITLE_PREFIX = 'Windows regression: ';

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

// The verify outcome. `pass` — verify.js's own `effectivePass` is the authority;
// a report from an older verify.js lacks it, so only a raw `pass: true` counts
// (fail closed: an adjudicated pass on such a report is a failure).
// `adjudicated` — a usable baseline verdict naming files; false (with `reason`)
// when adjudication was absent, ineligible, or named nothing, in which case a
// failure is reported from the raw output instead.
function classify(report) {
  const ba = isPlainObject(report.baselineAdjudicated) ? report.baselineAdjudicated : null;
  const attributable = ba && Array.isArray(ba.attributable) ? ba.attributable.filter((f) => typeof f === 'string') : [];
  let reason = null;
  if (!ba) reason = NOT_RUN;
  else if (ba.eligible !== true) reason = typeof ba.reason === 'string' && ba.reason ? ba.reason : NOT_RUN;
  const pass = typeof report.effectivePass === 'boolean' ? report.effectivePass : report.pass === true;
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

// Does `l` (a slashes()-normalized line) name `needle` as a whole repo-relative
// path — on a path boundary before (start, `/`, quote, whitespace) and after
// (`:`, quote, whitespace, end)?
function namesFile(l, needle) {
  for (let at = l.indexOf(needle); at !== -1; at = l.indexOf(needle, at + 1)) {
    const before = at === 0 ? '' : l[at - 1];
    const after = l.charAt(at + needle.length);
    if ((before === '' || /[/'"\s]/.test(before)) && (after === '' || /[:'"\s]/.test(after))) return true;
  }
  return false;
}

// The excerpt for `file`: from the nearest `not ok` line at or before the first
// line naming the file (so the test's name is shown), through the next ok/not ok
// line at or above the opening line's indent (a deeper `ok N` is the failure's own
// error text) or EXCERPT_MAX_LINES. A match past that `not ok`'s own YAML terminator (`...`
// at its indent + 2) sits outside any failure block — a crashed file's stderr,
// printed before its own `not ok` — so the excerpt opens just after the last test
// boundary (`ok N`, `# Subtest:`, a YAML `...`) above the match, where the stderr
// (and its `Error:` line) begins; there the end indent is 0. null when no line
// names the file. `normalized` is `lines` mapped through slashes(), computed once
// per issue rather than per file.
function excerptFor(file, lines, normalized) {
  const needle = slashes(file);
  const hit = normalized.findIndex((l) => namesFile(l, needle));
  if (hit === -1) return null;
  let notOk = -1;
  for (let i = hit; i >= 0; i--) if (/^\s*not ok\b/.test(lines[i])) { notOk = i; break; }
  let close = -1;
  if (notOk !== -1) {
    const terminator = `${' '.repeat(lines[notOk].search(/\S/) + 2)}...`;
    close = lines.findIndex((l, i) => i > notOk && l.trimEnd() === terminator);
  }
  let start = hit;
  if (notOk !== -1 && (close === -1 || hit <= close)) {
    start = notOk;
  } else {
    for (let i = hit - 1; i >= Math.max(close, 0); i--) {
      if (/^\s*(ok \d|# Subtest:|\.\.\.\s*$)/.test(lines[i])) { start = i + 1; break; }
    }
  }
  const openIndent = /^\s*not ok\b/.test(lines[start]) ? lines[start].search(/\S/) : 0;
  let end = Math.min(start + EXCERPT_MAX_LINES, lines.length);
  for (let i = start + 1; i < end; i++) {
    if (/^\s*(not )?ok \d/.test(lines[i]) && lines[i].search(/\S/) <= openIndent) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

// The tests check's failing region, else the first other failed check's — verify.js
// sets a check's failingRegion only when its exitCode is non-zero (null on a hang
// or a pass), and its report entries carry no per-check `pass`.
function failingRegionOf(report) {
  const checks = isPlainObject(report.checks) ? report.checks : {};
  const region = (c) => (isPlainObject(c) && typeof c.failingRegion === 'string' ? c.failingRegion : null);
  if (region(checks.tests) !== null) return checks.tests.failingRegion;
  const other = Object.values(checks).find((c) => region(c) !== null && c.exitCode !== 0);
  return other ? other.failingRegion : '';
}

// The text inside the fence `body` leaves open at its end (its opening backtick
// run), or null — CommonMark: an opener is a line of 3+ backticks (no backtick in
// its info string), closed only by a backtick-only line at least as long.
function openFenceAtEnd(body) {
  let open = null;
  for (const line of body.split('\n')) {
    const m = line.match(open === null ? /^ {0,3}(`{3,})[^`]*$/ : /^ {0,3}(`{3,})\s*$/);
    if (open === null) { if (m) open = m[1]; } else if (m && m[1].length >= open.length) open = null;
  }
  return open;
}

// `body` cut to BODY_CAP: never between a UTF-16 surrogate pair, and a fence the
// cut leaves open is closed before TRUNCATION_NOTE — the closer counts against the
// cap, so each retry cuts earlier and the loop ends.
function truncateBody(body) {
  if (body.length <= BODY_CAP) return body;
  let cut = BODY_CAP;
  for (;;) {
    const c = body.charCodeAt(cut - 1);
    if (cut > 0 && c >= 0xd800 && c <= 0xdbff) cut--;
    const head = body.slice(0, cut);
    const open = openFenceAtEnd(head);
    const closer = open === null ? '' : `\n${open}`;
    if (head.length + closer.length <= BODY_CAP) return head + closer + TRUNCATION_NOTE;
    cut = Math.max(0, BODY_CAP - closer.length);
  }
}

function timedOutOf(report) {
  const ba = report.baselineAdjudicated;
  return isPlainObject(ba) && Array.isArray(ba.timedOut) ? ba.timedOut : [];
}

function composeIssue({ report, verdict, sha, base, pr, runUrl, logText }) {
  const short = sha.slice(0, 9);
  const title = verdict.adjudicated
    ? `${TITLE_PREFIX}${verdict.attributable.length} test file(s) newly failing after ${short}`
    : `${TITLE_PREFIX}tests failing after ${short} ${NOT_ADJUDICATED_SUFFIX}`;
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
    // The uncapped log first when readable; a file no log line names retries on
    // the report's failing region before going without an excerpt.
    const sources = (typeof logText === 'string' ? [logText.split(/\r?\n/), regionLines] : [regionLines])
      .map((lines) => ({ lines, normalized: lines.map(slashes) }));
    const bullets = verdict.attributable.map((f) => `- \`${f}\`${timedOut.has(f) ? ' (timed out — no evidence)' : ''}`);
    parts.push(['### Newly failing test files', ...bullets].join('\n'));
    const excerpts = [];
    for (const file of verdict.attributable) {
      let excerpt = null;
      for (const s of sources) if (excerpt === null) excerpt = excerptFor(file, s.lines, s.normalized);
      if (excerpt !== null) excerpts.push(`#### \`${file}\`\n\n${fence(excerpt)}`);
    }
    if (excerpts.length) parts.push(['### Failure excerpts', ...excerpts].join('\n\n'));
  } else {
    const output = regionLines.slice(0, FALLBACK_LINES).join('\n');
    const cause = verdict.reason === NOT_RUN ? NOT_RUN : `${NOT_RUN}: ${verdict.reason}`;
    parts.push(`### Failing output (${cause})\n\n${output ? fence(output) : '(no failing output captured)'}`);
  }
  parts.push('_Filed by .github/workflows/windows-regression.yml — failures were compared against the push\'s base commit (verify.js --baseline). Shape it with /claude-tweaks:specify before building._');
  return { title, body: truncateBody(parts.join('\n\n')) };
}

function lookupMergedPr(repo, sha, deps) {
  try {
    return findMergedPr(JSON.parse(deps.gh(['api', `repos/${repo}/commits/${sha}/pulls`])));
  } catch (e) {
    deps.stderr(`${TOOL}: merged-PR lookup failed: ${e.message} — composing "unknown"\n`);
    return null;
  }
}

// The open issue already covering this run, or null: one of ours (titled
// TITLE_PREFIX…) naming this commit's short sha, else — for a run that was not
// adjudicated — one of ours ending in the not-adjudicated suffix. Each lookup
// puts its distinguishing words in the search, so a busy label can't push the
// match past --limit. A failing or unparseable listing is "none": it must never
// block filing.
function findExistingIssue(repo, short, adjudicated, deps) {
  const ours = (search) => {
    const issues = JSON.parse(deps.gh(['issue', 'list', '--repo', repo, '--state', 'open', '--label', LABEL,
      '--search', search, '--json', 'number,title', '--limit', '50']));
    if (!Array.isArray(issues)) return [];
    return issues.filter((i) => isPlainObject(i) && Number.isInteger(i.number) && typeof i.title === 'string'
      && i.title.startsWith(TITLE_PREFIX));
  };
  try {
    const hit = ours(`Windows regression ${short} in:title`).find((i) => i.title.includes(short))
      || (adjudicated ? undefined
        : ours('Windows regression not adjudicated in:title').find((i) => i.title.endsWith(NOT_ADJUDICATED_SUFFIX)));
    return hit ? hit.number : null;
  } catch (e) {
    deps.stderr(`${TOOL}: open-issue lookup failed: ${e.message} — filing a new issue\n`);
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
