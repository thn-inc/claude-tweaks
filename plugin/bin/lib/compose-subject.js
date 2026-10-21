// bin/lib/compose-subject.js — run(argv, deps) behind
// bin/compose-subject.js (#2251): reads one or more records via `gh issue
// view`, derives the composer's inputs (Type via native issueType then type:*
// label — the same precedence bin/lib/record-graph/encode.js's typeOf uses,
// aggregated across the whole bundle by precedence feature > bug > task (a
// type:task lowest-numbered record must not hide a type:feature sibling and
// under-bump the release); `breaking` via parseRecordFacets; summary = ##
// Overview's first sentence, falling back to ## Current State's first
// sentence for shaping-mode/specShapedBody records, which carry no ##
// Overview; migrationNote = the ## Breaking Change section; releaseNote =
// the subject record's own ## Release Note section, never aggregated across
// a bundle — every record in the bundle must still carry a non-empty
// section, but only the subject's text is rendered), and prints
// bin/lib/release/subject.js's composeSubject() output. Skill prose reaches
// the composer only through this CLI — the pure module has no shell surface.
//
// Usage: compose-subject.js <n>[,<m>...] [<k>...] [--repo owner/name] [--tag <tag>] [--scope <scope>] [--range <base>...<head>] [--pr <n>] [--out-dir <dir>] [--help]
// Numbers may be comma-joined and/or space-separated; the subject record is
// the lowest number, and the body carries one `Fixes #n` line per number.
// Output: JSON {"title","body"} by default; `--out-dir <dir>` instead writes
// <dir>/title.txt, <dir>/body.md and <dir>/message.txt (= title, blank line,
// body; no trailing newline on any of them), creating <dir> recursively, and
// prints only the single-quoted title on one line. It exists because the
// Claude Code worktree Bash guard refuses `eval` and `$(…)` wrapped around
// `gh` (#3522); a merge fence consumes the files with `-F`/`--body-file`.
// `--shell` (eval-able SUBJECT_TITLE=/SUBJECT_BODY= assignments) was retired
// in #3537 after #3522 moved every fence to `--out-dir`.
// Exit codes (Split-1/2, mirroring bin/resolve-blockers.js): 0 composed; 1
// malformed invocation (including --range with --pr, or commit-scope-paths
// set with neither) OR a policy misconfiguration (a malformed
// commit-scope-paths entry, a commit-scope token composeSubject rejects) OR a
// record that cannot be composed (no resolvable Type, `breaking` label with no
// ## Breaking Change section — the composer's own usage error, message on
// stderr); 2 `gh` absent or owner/repo unresolvable (no --repo and no readable
// origin remote); 3 an external read failed — a `gh issue view` call, the
// `git diff --name-only -z` behind --range, or the `gh pr diff --name-only`
// behind --pr, or an `--out-dir` write failed.
// --range is read with -z and --end-of-options so a C-quoted (non-ASCII) path
// still matches its prefix and a dash-leading value can never be read as a git option.
// Every side effect goes through deps so tests never touch gh or git
// (gh-api-module-pattern's CLI wrapper contract).
//
// Decision (#2319, review minor from #2251): exit 1 stays overloaded —
// malformed invocation and an uncomposable record share one code. A fourth
// code would only be worth adding if some caller could act differently on
// "bad CLI invocation" vs. "shaping defect in the record"; today every merge
// site (pr-first-merge.md's two squash sites, and the four local-merge sites
// in merge-subject-composer-conformance.test.js's LOCAL_SITES) treats any
// non-zero compose-subject.js exit identically (the composer exiting non-zero stops the fence before any merge), so a fourth
// code would carry no distinguishable behavior at the only call sites that
// exist — six merge-site fences would need editing for a distinction nothing
// reads. Revisit if a caller ever needs to route "uncomposable" (park the
// record) differently from "bad invocation" (a caller bug).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { composeSubject, ComposeSubjectError } = require('./release/subject');
const {
  parseRecordFacets, typeOf, extractSection: extractSectionShared,
} = require('./issues/record');
const {
  parseRepo, ghAvailable, remoteUrl, repoSlug,
} = require('./repo-resolve');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS } = require('./shared-primitives');
const { readCommitScope, readListKey } = require('./policy');
const { parseScopePaths, resolveCommitScope, CommitScopeError } = require('./commit-scope');

const USAGE = 'usage: compose-subject.js <n>[,<m>...] [<k>...] [--repo owner/name] [--tag <tag>] [--scope <scope>] [--range <base>...<head>] [--pr <n>] [--out-dir <dir>] [--help]\n';
// Decision (#2319): kept at the single-call convention, not widened. Each
// `gh issue view` call below fetches exactly one record — unlike
// fetch-sub-issues.js's 30000ms bound, which covers a single batched
// 50-alias GraphQL call, this CLI issues N genuinely separate single-record
// REST calls, so the single-call convention (gh-api-module-pattern's "Bound
// every remote-contacting call") applies unchanged to each one. #2567:
// shared, not a local re-derivation of the same 5000 default — see
// shared-primitives.js.
// Bundle Type aggregation precedence — highest-impact type wins so a lowest-numbered
// type:task record can never hide a type:feature (or type:bug) sibling behind a `chore:`
// subject (#2251 F6). Mirrors record.js's TYPES order; a fourth Type added there
// must gain a slot here too (see the TYPE_PREFIX === record.TYPES pinning test
// in compose-subject.test.js, which fails loudly on drift).
const TYPE_PRECEDENCE = ['feature', 'bug', 'task'];

const isPos = (n) => Number.isInteger(n) && n > 0;

// err -> its message, or its string form when it has none (e.g. a thrown non-Error).
function errMessage(err) {
  return err && err.message ? err.message : String(err);
}

function parseArgs(argv) {
  const opts = { numbers: [], repo: null, tag: null, scope: null, range: null, pr: null, outDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; return opts; }
    if (a === '--repo' || a === '--tag' || a === '--scope' || a === '--range' || a === '--pr' || a === '--out-dir') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `missing value for ${a}` };
      if (a === '--pr' && !/^\d+$/.test(v)) return { error: `invalid --pr value: ${v}` };
      if (a === '--range' && !/^[^\s-][^\s]*\.\.\.[^\s-][^\s]*$/.test(v)) return { error: `invalid --range value: ${v} — expected <base>...<head>` };
      opts[a === '--out-dir' ? 'outDir' : a.slice(2)] = v;
      i++;
      continue;
    }
    if (a.startsWith('--')) return { error: `unknown argument: ${a}` };
    for (const part of a.split(',')) {
      const n = Number(part);
      if (part.trim() === '' || !isPos(n)) return { error: `malformed record number: ${JSON.stringify(part)}` };
      opts.numbers.push(n);
    }
  }
  if (opts.numbers.length === 0) return { error: 'missing <n> argument' };
  if (opts.range !== null && opts.pr !== null) return { error: '--range and --pr are mutually exclusive' };
  opts.numbers = [...new Set(opts.numbers)].sort((a, b) => a - b);
  return opts;
}

// Single-quote a value for POSIX sh: close, escaped quote, reopen.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// This file's own section shape — h2-only, stop-at-next-h2, trimmed (a
// Breaking Change/Release Note/Overview section may carry nested
// subsections that must stay inside it, unlike record.js's h2-h4/any-heading
// default used by decomposition-crossref.js and grouping.js) — bound once so
// every call site here (and this module's own re-export) gets it without
// restating the options.
function extractSection(body, heading) {
  return extractSectionShared(body, heading, { levelPattern: '2', stopPattern: '2', trim: true });
}

// Decision (#2319): a `.` immediately preceded by one of these tokens (case-insensitive,
// e.g./i.e./etc.) or by a version-number/decimal token (`6.34`, `v6.34`) is not treated as a
// sentence terminator — an Overview opening with "e.g. " or "v6.34. " no longer truncates the
// first sentence to just that token. Deliberately narrow: only the two cases named in #2319
// (generic Latin abbreviations, version/decimal numbers), not a general abbreviation dictionary
// (e.g. "Dr."/"St."), which risks silently merging genuinely separate sentences in Overview prose.
const NON_TERMINAL_ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc']);
const VERSION_OR_DECIMAL_RE = /^v?\d+(\.\d+)*$/i;

function isNonTerminalToken(word) {
  const w = word.toLowerCase();
  return NON_TERMINAL_ABBREVIATIONS.has(w) || VERSION_OR_DECIMAL_RE.test(w);
}

// text -> its first sentence: the first paragraph (newlines collapsed to spaces), cut at the
// first `.`/`!`/`?` that is followed by whitespace or end of text and is not immediately
// preceded by a non-terminal token (see above); the whole paragraph when it has no such
// terminator.
function firstSentence(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return '';
  const firstPara = t.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim();
  for (const m of firstPara.matchAll(/[.!?](?=\s|$)/g)) {
    const before = firstPara.slice(0, m.index);
    const wordMatch = /(\S+)$/.exec(before);
    if (wordMatch && isNonTerminalToken(wordMatch[1])) continue;
    return firstPara.slice(0, m.index + 1).trim();
  }
  return firstPara;
}

// (#2561) A GitHub Enterprise Server host running an older `gh` (observed:
// 2.92.0) can reject the REST `--json issueType` field outright —
// `Unknown JSON field: "issueType"`, exit 3 — before this CLI's own type
// derivation ever runs. Detected narrowly on that literal message text
// (checked against both `.message` and `.stderr`, since which one carries
// the text depends on the runner) so a genuine auth/not-found/network
// failure still propagates as fatal (AC 1/6's negative control).
function isUnknownIssueTypeField(err) {
  const text = [err && err.message, err && err.stderr].filter(Boolean).map(String).join(' ');
  return /Unknown JSON field:\s*"issueType"/i.test(text);
}

// (repoSpec, n, runner) -> {name: string}|null via one `gh api graphql`
// call — the fallback when the REST `issueType` field itself is rejected by
// the host and the record carries no `type:*` label. Best-effort: any
// failure here (network, host also rejects the GraphQL shape, unparseable
// response) degrades to "no native type" rather than throwing — typeOf/
// aggregateType already tolerate a null issueType and fall through to
// label-based or no-type composition (Deliverable 4).
function fetchIssueTypeGraphQL(runner, repoSpec, n) {
  try {
    const args = ['api', 'graphql'];
    if (repoSpec.host && repoSpec.host !== 'github.com') args.push('--hostname', repoSpec.host);
    // owner/repo are bound as GraphQL variables (-f, never string-interpolated
    // into the query text) per gh-api-module-pattern's established shape —
    // see bin/lib/issues/native-dependencies.js's fetchNativeDependencies.
    // `n` is embedded directly: it's already validated as a positive number
    // by parseArgs' isPos check before reaching here, matching
    // buildNativeParentQuery's own numeric-alias convention.
    args.push(
      '-f', `query=query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ issue(number: ${n}) { issueType { name } } } }`,
      '-f', `owner=${repoSpec.owner}`,
      '-f', `repo=${repoSpec.repo}`,
    );
    const raw = runner(args);
    const parsed = JSON.parse(raw);
    const name = parsed && parsed.data && parsed.data.repository && parsed.data.repository.issue
      && parsed.data.repository.issue.issueType && parsed.data.repository.issue.issueType.name;
    return typeof name === 'string' ? { name } : null;
  } catch {
    return null;
  }
}

// records[] -> the bundle's aggregated Type, by TYPE_PRECEDENCE (feature > bug > task) —
// the same "any record decides it" shape breaking already uses (OR across the bundle),
// just precedence-ranked instead of boolean. null when no record resolves a Type at all
// (composeSubject then throws its own usage error, exit 1).
function aggregateType(records) {
  const types = records.map(typeOf);
  for (const t of TYPE_PRECEDENCE) if (types.includes(t)) return t;
  return null;
}

const realDeps = {
  ghAvailable,
  remoteUrl,
  // stderr piped, not inherited (#3028): execFileSync's default echoes the
  // child's stderr to ours, so the handled #2561 `Unknown JSON field:
  // "issueType"` rejection printed gh's full field list ahead of a successful
  // compose and read as a failure. err.stderr (isUnknownIssueTypeField) and
  // err.message (the fatal paths) still carry the text.
  runner: (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true }),
  fetchIssueType: fetchIssueTypeGraphQL,
  readCommitScope: () => readCommitScope(process.cwd()),
  readCommitScopePaths: () => readListKey(process.cwd(), 'commit-scope-paths'),
  gitRunner: (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, windowsHide: true }),
  mkdirp: (d) => fs.mkdirSync(d, { recursive: true }),
  writeFile: (p, s) => fs.writeFileSync(p, s, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 1; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (!deps.ghAvailable()) { deps.stderr('compose-subject.js: `gh` is required\n'); return 2; }

  let remote = null;
  if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
  const repoSpec = opts.repo ? parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`) : parseRepo(remote);
  if (!repoSpec) { deps.stderr('compose-subject.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
  const slug = repoSlug(repoSpec);

  const records = [];
  for (const n of opts.numbers) {
    const viewArgs = (fields) => ['issue', 'view', String(n), '--repo', slug, '--json', fields];
    let raw;
    let issueTypeFieldRejected = false;
    try {
      raw = deps.runner(viewArgs('number,title,body,labels,issueType'));
    } catch (err) {
      if (!isUnknownIssueTypeField(err)) {
        deps.stderr(`compose-subject.js: gh issue view ${n} failed: ${errMessage(err)}\n`);
        return 3;
      }
      // (#2561) The host rejects the REST `issueType` field outright — retry
      // without it rather than failing the whole compose. A genuine
      // auth/not-found/network failure on THIS retry is still fatal.
      issueTypeFieldRejected = true;
      try {
        raw = deps.runner(viewArgs('number,title,body,labels'));
      } catch (err2) {
        deps.stderr(`compose-subject.js: gh issue view ${n} failed: ${errMessage(err2)}\n`);
        return 3;
      }
    }
    let record;
    try { record = JSON.parse(raw); } catch {
      deps.stderr(`compose-subject.js: gh issue view ${n} returned unparseable JSON\n`);
      return 3;
    }
    // (#2561) The REST field was unavailable — fall back to the native type
    // only when no `type:*` label already answers it (label-based first, no
    // extra request); a GraphQL fetch when one is still wanted. Best-effort:
    // `fetchIssueType`'s own failure degrades to "no native type" (Deliverable 4).
    // `typeOf` answers the label question here rather than a restated label
    // scan: on this path the record carries no `issueType` field at all, so
    // `typeOf` falls straight through to its own `type:*` label lookup.
    if (issueTypeFieldRejected) {
      const labelType = typeOf(record);
      record.issueType = labelType ? null : deps.fetchIssueType(deps.runner, repoSpec, n);
    }
    records.push(record);
  }

  const subjectRecord = records[0];
  const breakingRecords = records.filter((r) => parseRecordFacets(r.labels).breaking);
  const missing = breakingRecords.filter((r) => !extractSection(r.body, 'Breaking Change'));
  if (missing.length) {
    deps.stderr(`compose-subject.js: breaking is set on #${missing.map((r) => r.number).join(', #')} but the record carries no non-empty "## Breaking Change" section\n`);
    return 1;
  }
  const releaseNoteMissing = records.filter((r) => !extractSection(r.body, 'Release Note'));
  if (releaseNoteMissing.length) {
    deps.stderr(`compose-subject.js: record(s) #${releaseNoteMissing.map((r) => r.number).join(', #')} carry no non-empty "## Release Note" section\n`);
    return 1;
  }
  const migrationNote = breakingRecords.map((r) => extractSection(r.body, 'Breaking Change')).filter(Boolean).join('\n\n');
  const releaseNote = extractSection(subjectRecord.body, 'Release Note');

  let scope = opts.scope;
  if (scope === null) {
    const constant = deps.readCommitScope();
    let pairs;
    try { pairs = parseScopePaths(deps.readCommitScopePaths()); } catch (err) {
      if (!(err instanceof CommitScopeError)) throw err;
      deps.stderr(`compose-subject.js: ${errMessage(err)}\n`);
      return 1;
    }
    let changedPaths = [];
    if (pairs.length > 0) {
      if (!opts.range && !opts.pr) {
        deps.stderr('compose-subject.js: commit-scope-paths is set but neither --range nor --pr was given — pass --range {base}...{head} (local-merge fences) or --pr {n} (pr-first fences)\n');
        return 1;
      }
      const command = opts.range ? `git diff --name-only ${opts.range}` : `gh pr diff ${opts.pr} --name-only`;
      try {
        changedPaths = opts.range
          ? deps.gitRunner(['diff', '--name-only', '-z', '--end-of-options', opts.range]).split('\0').filter(Boolean)
          : deps.runner(['pr', 'diff', String(opts.pr), '--repo', slug, '--name-only']).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      } catch (err) {
        deps.stderr(`compose-subject.js: ${command} failed: ${errMessage(err)}\n`);
        return 3;
      }
    }
    const resolved = resolveCommitScope({ explicit: null, constant, pairs, changedPaths });
    scope = resolved.scope;
    if (resolved.note) {
      deps.stderr(`compose-subject.js: changed paths span scopes ${resolved.note.join(', ')} — ${scope === null ? 'subject left unscoped' : `falling back to commit-scope "${scope}"`}\n`);
    }
  }

  let composed;
  try {
    composed = composeSubject({
      type: aggregateType(records),
      title: subjectRecord.title,
      number: subjectRecord.number,
      scope,
      breaking: breakingRecords.length > 0,
      summary: firstSentence(extractSection(subjectRecord.body, 'Overview') || extractSection(subjectRecord.body, 'Current State')),
      migrationNote,
      releaseNote,
      fixes: opts.numbers,
      tag: opts.tag,
      breakingRecords: breakingRecords.map((r) => r.number),
    });
  } catch (err) {
    if (!(err instanceof ComposeSubjectError)) throw err;
    deps.stderr(`compose-subject.js: ${errMessage(err)}\n`);
    return 1;
  }

  if (opts.outDir !== null) {
    const files = [
      [path.join(opts.outDir, 'title.txt'), composed.title],
      [path.join(opts.outDir, 'body.md'), composed.body],
      [path.join(opts.outDir, 'message.txt'), `${composed.title}\n\n${composed.body}`],
    ];
    let current = opts.outDir;
    try {
      deps.mkdirp(opts.outDir);
      for (const [file, text] of files) { current = file; deps.writeFile(file, text); }
    } catch (err) {
      deps.stderr(`compose-subject.js: could not write ${current}: ${errMessage(err)}\n`);
      return 3;
    }
    deps.stdout(shellQuote(composed.title) + '\n');
  } else {
    deps.stdout(`${JSON.stringify(composed)}\n`);
  }
  return 0;
}

module.exports = {
  run,
  parseArgs,
  shellQuote,
  extractSection,
  firstSentence,
  typeOf,
  aggregateType,
  isUnknownIssueTypeField,
  fetchIssueTypeGraphQL,
  USAGE,
  realDeps,
};
