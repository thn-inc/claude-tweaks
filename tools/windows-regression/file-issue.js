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
//      not a JSON object (on main, that also files a "no verify report" issue —
//      the next push would otherwise take the unevaluated commit as its base);
//      or `gh issue create` / `gh issue comment` failed
//   2  malformed invocation
//
// Fails closed: a failed run whose adjudication never ran or crashed
// (`eligible: false`, or no `baselineAdjudicated` at all) still exits 1 and
// still files, titled "(not adjudicated)" with the raw failing output.
//
// Maintainer-only tooling under tools/ — not shipped plugin payload.

const fs = require('fs');
const { execFileSync } = require('child_process');
const { tapLines } = require('../../plugin/bin/lib/verify/extract.js');

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
const GH_TIMEOUT_MS = 60000;

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

const TEST_POINT_KINDS = new Set(['ok', 'notOk']);
const BOUNDARY_KINDS = new Set(['ok', 'notOk', 'subtest', 'yamlClose']);

// The excerpt for `file`, read off `tap` (verify's tapLines classification of
// `lines`, computed once per source): it opens at the owner of the first line
// naming the file — the failing-test line whose block holds that line, so the
// test's name is shown — and runs to the next pass/fail line at or above the
// opening line's indent (a deeper one is the failure's own error text) or
// EXCERPT_MAX_LINES. One effective-owner rule serves the match and the walk
// back: a line past its block's YAML-close line (ownership outlives the close)
// is owned by no one. A match no block owns is a crashed file's stderr, printed
// before its own failing-test line: the excerpt opens just after the nearest
// boundary above the match (a pass/fail, subtest or YAML-close line, or an
// owned line), where the stderr (and its `Error:` line) begins; there the end
// indent is 0. null when no line names the file. `normalized` is `lines`
// mapped through slashes(), computed once per issue rather than per file.
function excerptFor(file, { lines, normalized, tap }) {
  const needle = slashes(file);
  const hit = normalized.findIndex((l) => namesFile(l, needle));
  if (hit === -1) return null;
  const closes = new Map();
  const closeOf = (o) => {
    if (!closes.has(o)) closes.set(o, tap.findIndex((t, i) => i > o && t.owner === o && t.kind === 'yamlClose'));
    return closes.get(o);
  };
  const ownerAt = (i) => {
    const o = tap[i].owner;
    if (o === -1) return -1;
    const c = closeOf(o);
    return c !== -1 && i > c ? -1 : o;
  };
  let start = ownerAt(hit);
  if (start === -1) {
    start = hit;
    for (let i = hit - 1; i >= 0; i--) {
      const t = tap[i];
      if (ownerAt(i) !== -1 || BOUNDARY_KINDS.has(t.kind)) { start = i + 1; break; }
    }
  }
  const openIndent = tap[start].kind === 'notOk' ? tap[start].indent : 0;
  let end = Math.min(start + EXCERPT_MAX_LINES, lines.length);
  for (let i = start + 1; i < end; i++) {
    if (TEST_POINT_KINDS.has(tap[i].kind) && tap[i].indent <= openIndent) { end = i; break; }
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
      .map((lines) => ({ lines, normalized: lines.map(slashes), tap: tapLines(lines) }));
    const bullets = verdict.attributable.map((f) => `- \`${f}\`${timedOut.has(f) ? ' (timed out — no evidence)' : ''}`);
    parts.push(['### Newly failing test files', ...bullets].join('\n'));
    const excerpts = [];
    for (const file of verdict.attributable) {
      let excerpt = null;
      for (const s of sources) if (excerpt === null) excerpt = excerptFor(file, s);
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

// The issue for a main run whose report could not be read: this commit was never
// evaluated, so the next push's run takes it as its base unchecked.
function composeNoReportIssue({ sha, runUrl, problem }) {
  const short = sha.slice(0, 9);
  return {
    title: `${TITLE_PREFIX}no verify report for ${short} ${NOT_ADJUDICATED_SUFFIX}`,
    body: [
      `The post-merge Windows check on commit ${sha} produced no usable verify report (${problem}), so the commit was never evaluated.`,
      `**Run:** ${runUrl}`,
      'The next push to `main` compares against this commit, so anything this commit broke on Windows would read as pre-existing there. Re-run the workflow on this commit (or check its `windows` job log for why the report is missing) before trusting later runs.',
      '_Filed by .github/workflows/windows-regression.yml. Shape it with /claude-tweaks:specify before building._',
    ].join('\n\n'),
  };
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
  let problem = null;
  try {
    report = JSON.parse(deps.readFile(reportPath));
    if (!isPlainObject(report)) problem = `report ${reportPath} is not a JSON object`;
  } catch (e) {
    problem = `cannot read report ${reportPath}: ${e.message}`;
  }
  if (problem !== null) {
    err(`${TOOL}: ${problem}`);
    // On main this commit was never evaluated, yet the next push compares
    // against it — its regressions would silently become that run's baseline.
    if (ref === MAIN_REF) fileOrComment(composeNoReportIssue({ sha, runUrl, problem }), { repo, sha, adjudicated: false }, deps);
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

  const issue = composeIssue({ report, verdict, sha, base, pr: lookupMergedPr(repo, sha, deps), runUrl, logText });
  fileOrComment(issue, { repo, sha, adjudicated: verdict.adjudicated }, deps);
  return 1;
}

// Comment on the open issue already covering this commit, else file a new one.
// A gh failure is a stderr line; the caller's exit code is 1 either way.
function fileOrComment({ title, body }, { repo, sha, adjudicated }, deps) {
  const out = (s) => deps.stdout(`${s}\n`);
  const err = (s) => deps.stderr(`${s}\n`);
  const existing = findExistingIssue(repo, sha.slice(0, 9), adjudicated, deps);
  if (existing !== null) {
    try {
      deps.gh(['issue', 'comment', String(existing), '--repo', repo, '--body-file', '-'], body);
      out(`${TOOL}: commented on #${existing} (existing open issue)`);
    } catch (e) {
      err(`${TOOL}: gh issue comment failed: ${e.message}`);
    }
    return;
  }
  try {
    const url = String(deps.gh(['issue', 'create', '--repo', repo, '--label', LABEL, '--title', title, '--body-file', '-'], body)).trim();
    out(url);
  } catch (e) {
    err(`${TOOL}: gh issue create failed: ${e.message}`);
  }
}

function defaultDeps() {
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    // Bounded: a hung gh call fails this one call, not the whole `file` job.
    gh: (args, input) => execFileSync('gh', args, { input, encoding: 'utf8', timeout: GH_TIMEOUT_MS }),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
}

function main(argv) {
  process.exitCode = run(argv, defaultDeps());
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { run, classify, findMergedPr, composeIssue, parseArgs, defaultDeps, USAGE };
