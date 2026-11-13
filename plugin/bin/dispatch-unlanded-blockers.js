#!/usr/bin/env node
// bin/dispatch-unlanded-blockers.js — the queue pull's unlanded-blocker pass (#4792).
//   node bin/dispatch-unlanded-blockers.js --groups <path> --exclusions <path> --integration-branch <name> --work-links <native|body-text>
// Reads the pull's remaining candidates (the `dispatch-groups.json` shape: an array
// of groups, each an array of already-fetched {number, title, body, labels}), hands
// them to ONE `preflight-records.js --prefetched-json - --blocker-landing` call, and
// prints the groups without the candidates whose out-of-run blocker is closed but
// whose closing commit never reached the integration branch (`unlanded`). Each
// dropped candidate gets a `reason: 'unlanded-blocker'` entry in the exclusions file
// (`detail: {blockers: [{blocker, commit}]}`) through exclusions.js's appendExclusion,
// the one sanctioned writer, and one `AUTO — dispatch:` line on stderr. `open` is the
// `blocked` pass's; an `undetermined` verdict keeps the candidate (one `kept` line),
// because /flow Step 2.7b proceeds on `undetermined` too. A cross-repository
// `undetermined` is a CLOSED foreign blocker: it keeps the candidate as well, and the
// `kept` line names it `owner/name#N` (#4793).
//
// Order: (1) a malformed invocation is exit 2; (2) an unreadable or ill-shaped --groups
// is exit 1; (3) an empty pool is printed unchanged, with no call and no write;
// (4) SCREEN — records whose blocker declaration cannot be checked are named before the
// call (a non-positive-integer number, a non-string body, non-array labels, a `Blocked
// by` number that is no valid issue number or is above 2147483647 — under every
// --work-links value); (5) an empty --integration-branch (the queue pull's variable
// failed to resolve) skips the call with a Warning; (6) an empty remainder skips it;
// (7) the call, its stderr forwarded unchanged, and — only on exit 1 and only when its
// stderr line `preflight-records.js: missing dependency data for #a, #b` names
// candidates of that call — those candidates leave the call as malformed and the call
// runs exactly once more over the rest (never a third); (8) a whole-call failure of the
// deciding call is a Warning and no unlanded-blocker entry; (9) the writes; (10) the
// undetermined lines; (11) the surviving groups on stdout.
//
// Why a record whose declaration cannot be checked is excluded, not kept: one such
// record makes preflight-records.js exit 2 (or 1) for the whole call, which would turn
// the check off for every other candidate (Q3), and keeping it would dispatch a record
// whose blockers nobody could judge (Q4). It gets a `reason: 'malformed-blocker'`
// entry (`detail: {cause}`) and an `AUTO` line, and is eligible again on the first pull
// after its declaration can be checked (the queue pull truncates non-`firing` entries).
// A number above 2147483647 is screened because github.com answers it with a NOT_FOUND
// that the landing check reads as `undetermined`: unscreened, the record would dispatch.
//
// Why the native-missing re-run is once, and only on that line: the line attributes the
// failure to named candidates (a candidate with no entry in the native dependency
// response), so excluding them and re-running is sound. Any other exit-1 output
// (`missing repository — …`, a query failure, a named number outside the call, a re-run
// that fails again) cannot be pinned on a record and is a whole-call failure.
//
// Why the pass otherwise fails open: /flow Step 2.7b re-checks before any claim, so a
// skipped exclusion costs one dispatch that ends in that record's non-failing stop. A
// probe failure must not block every unrelated record. A whole-call failure keeps the
// malformed-blocker entries already found.
//
// Exit codes (a CLI-specific vocabulary):
//   0  the pool is on stdout — filtered, or unchanged apart from malformed-blocker
//      records on a fail-open skip
//   1  the pass could not complete: --groups unreadable or not an array of arrays of
//      records, or an exclusions write was refused (a corrupt exclusions file, #3110) —
//      nothing is printed on stdout
//   2  malformed invocation (a missing flag, a flag with no value, a bad --work-links
//      value, an unknown argument)
// --help (or -h) prints the usage line on stdout and exits 0 before any argument is read.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { appendExclusion } = require('./lib/dispatch/exclusions');
const { LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const {
  NATIVE_MISSING_CAUSE, poolRecords, malformedRecords, nativeMissingRecords, malformedExclusion,
  landingExclusions, withoutExcluded,
} = require('./lib/dispatch/unlanded-blockers');

const USAGE = 'usage: dispatch-unlanded-blockers.js --groups <path> --exclusions <path> --integration-branch <name> --work-links <native|body-text>\n';

const PREFLIGHT_JS = path.join(__dirname, 'preflight-records.js');
// A stated bound; each gh call inside preflight-records.js is already bounded at 30 s.
const PREFLIGHT_TIMEOUT_MS = 300000;

const FLAGS = {
  '--groups': 'groups',
  '--exclusions': 'exclusions',
  '--integration-branch': 'integrationBranch',
  '--work-links': 'workLinks',
};
// --integration-branch and --work-links take '' (an unresolved queue-pull variable).
const NON_EMPTY = new Set(['--groups', '--exclusions']);
const WORK_LINKS = ['native', 'body-text', ''];

// argv -> { groups, exclusions, integrationBranch, workLinks } | { error }.
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (typeof v !== 'string' || v.startsWith('--')) return { error: `missing value for ${a}` };
    if (NON_EMPTY.has(a) && !v.trim()) return { error: `missing value for ${a}` };
    if (a === '--work-links' && !WORK_LINKS.includes(v)) return { error: `--work-links must be "native" or "body-text" (got "${v}")` };
    out[FLAGS[a]] = v;
    i += 1;
  }
  const missing = Object.keys(FLAGS).find((f) => !Object.hasOwn(out, FLAGS[f]));
  if (missing) return { error: `missing ${missing}` };
  return out;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  preflight: (args, input) => spawnSync(process.execPath, [PREFLIGHT_JS, ...args], {
    input, encoding: 'utf8', timeout: PREFLIGHT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  }),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const errMessage = (err) => (err && err.message) || String(err);

// A spawn result -> what to name after "exited": the error, the status or the signal.
function exitDescription(res) {
  if (res.error) return `error (${errMessage(res.error)})`;
  if (typeof res.status === 'number') return String(res.status);
  return `signal ${res.signal || 'unknown'}`;
}

const skipWarning = (why) => `Warning: unlanded-blocker pass skipped — ${why}; no unlanded-blocker exclusions this pull\n`;

// groups text -> groups | throws with the reason it is unusable.
function parseGroups(text) {
  const groups = JSON.parse(text);
  const ok = Array.isArray(groups) && groups.every((g) => Array.isArray(g)
    && g.every((r) => r && typeof r === 'object' && !Array.isArray(r)));
  if (!ok) throw new Error('not an array of arrays of records');
  return groups;
}

// argv -> exit code. All I/O through deps so tests never touch gh or the filesystem.
function run(argv, deps = realDeps) {
  if (argv.includes('--help') || argv.includes('-h')) { deps.stdout(USAGE); return 0; }
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(`dispatch-unlanded-blockers.js: ${opts.error}\n${USAGE}`); return 2; }

  let groups;
  try {
    groups = parseGroups(deps.readFile(opts.groups));
  } catch (err) {
    deps.stderr(`dispatch-unlanded-blockers.js: cannot read --groups ${opts.groups}: ${errMessage(err)}\n`);
    return 1;
  }

  const pool = poolRecords(groups);
  if (pool.length === 0) { deps.stdout(JSON.stringify(groups)); return 0; }

  // Step 4: the screen runs before every skip below.
  const malformed = malformedRecords(pool);
  const screened = new Set(malformed.map((m) => m.number));
  let checked = pool.filter((r) => !screened.has(r.number));

  const branch = opts.integrationBranch.trim();
  let unlanded = [];
  let undetermined = [];

  const callLanding = (records) => {
    const args = [
      ...records.map((r) => String(r.number)), '--prefetched-json', '-', '--blocker-landing',
      '--integration-branch', branch, ...(opts.workLinks ? ['--work-links', opts.workLinks] : []),
    ];
    let res;
    try {
      res = deps.preflight(args, JSON.stringify(records));
    } catch (err) {
      return { thrown: err };
    }
    if (res && typeof res.stderr === 'string' && res.stderr) deps.stderr(res.stderr);
    return { res };
  };

  // Step 8: the deciding call -> { exclusions, undetermined } | null (fail open, warned).
  const judge = (call, records) => {
    if (call.thrown) { deps.stderr(skipWarning(`preflight-records.js exited error (${errMessage(call.thrown)})`)); return null; }
    const { res } = call;
    if (!res || res.error || res.status !== 0) {
      deps.stderr(skipWarning(`preflight-records.js exited ${exitDescription(res || {})}`));
      return null;
    }
    try {
      return landingExclusions(JSON.parse(res.stdout), records.map((r) => r.number));
    } catch (err) {
      deps.stderr(skipWarning(`preflight-records.js printed no usable envelope (${errMessage(err)})`));
      return null;
    }
  };

  if (!branch) {
    deps.stderr(skipWarning('no integration branch resolved'));
  } else if (checked.length > 0) {
    let call = callLanding(checked);
    // Step 7's re-run: only an exit-1 whose stderr names candidates of this very call.
    if (call.res && call.res.status === 1) {
      const missing = nativeMissingRecords(call.res.stderr, checked.map((r) => r.number));
      if (missing) {
        for (const number of missing) malformed.push({ number, cause: NATIVE_MISSING_CAUSE });
        checked = checked.filter((r) => !missing.includes(r.number));
        call = checked.length > 0 ? callLanding(checked) : null;
      }
    }
    const landing = call && judge(call, checked);
    if (landing) { unlanded = landing.exclusions; undetermined = landing.undetermined; }
  }

  // Step 9: the writes, each AUTO line after its write landed.
  try {
    for (const m of malformed) {
      appendExclusion(opts.exclusions, malformedExclusion(m));
      deps.stderr(`AUTO — dispatch: #${m.number} excluded — malformed blocker declaration: ${m.cause}; the other candidates are still checked\n`);
    }
    for (const e of unlanded) {
      appendExclusion(opts.exclusions, e);
      for (const b of e.detail.blockers) {
        deps.stderr(`AUTO — dispatch: #${e.records[0]} excluded, blocker #${b.blocker} closed but its closing commit ${b.commit} is not on origin/${branch}\n`);
      }
    }
  } catch (err) {
    deps.stderr(`dispatch-unlanded-blockers.js: ${errMessage(err)}\n`);
    return 1;
  }

  for (const u of undetermined) {
    deps.stderr(`AUTO — dispatch: #${u.record} kept — blocker ${u.repository ? `${u.repository}#${u.blocker}` : `#${u.blocker}`} landing undetermined (via ${u.via})\n`);
  }

  const excluded = new Set([...malformed.map((m) => m.number), ...unlanded.flatMap((e) => e.records)]);
  deps.stdout(JSON.stringify(withoutExcluded(groups, excluded)));
  return 0;
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
