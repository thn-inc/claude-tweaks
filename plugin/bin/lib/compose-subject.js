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
// Usage: compose-subject.js <n>[,<m>...] [<k>...] [--repo owner/name] [--tag <tag>] [--shell] [--help]
// Numbers may be comma-joined and/or space-separated; the subject record is
// the lowest number, and the body carries one `Fixes #n` line per number.
// Output: JSON {"title","body"} by default; `--shell` prints two POSIX sh
// assignments, SUBJECT_TITLE='…' then SUBJECT_BODY='…' (single-quoted, '
// escaped as '\''); the body value spans physical lines, so consume it with
// `eval "$(…)"`, never by line splitting.
// Exit codes (Split-1/2, mirroring bin/resolve-blockers.js): 0 composed; 1
// malformed invocation OR a record that cannot be composed (no resolvable
// Type, `breaking` label with no ## Breaking Change section — the composer's
// own usage error, message on stderr); 2 `gh` absent or owner/repo
// unresolvable (no --repo and no readable origin remote); 3 a `gh issue view`
// call itself failed. Every side effect goes through deps so tests never
// touch gh or git (gh-api-module-pattern's CLI wrapper contract).
//
// Decision (#2319, review minor from #2251): exit 1 stays overloaded —
// malformed invocation and an uncomposable record share one code. A fourth
// code would only be worth adding if some caller could act differently on
// "bad CLI invocation" vs. "shaping defect in the record"; today every merge
// site (pr-first-merge.md's two squash sites, and the four local-merge sites
// in merge-subject-composer-conformance.test.js's LOCAL_SITES) treats any
// non-zero compose-subject.js exit identically (`|| exit 1`), so a fourth
// code would carry no distinguishable behavior at the only call sites that
// exist — six merge-site fences would need editing for a distinction nothing
// reads. Revisit if a caller ever needs to route "uncomposable" (park the
// record) differently from "bad invocation" (a caller bug).
'use strict';

const { execFileSync } = require('child_process');
const { composeSubject, ComposeSubjectError, TYPE_PREFIX } = require('./release/subject');
const { parseRecordFacets, normalizeLabelNames } = require('./issues/record');
const {
  parseRepo, ghAvailable, remoteUrl, repoSlug,
} = require('./repo-resolve');

const USAGE = 'usage: compose-subject.js <n>[,<m>...] [<k>...] [--repo owner/name] [--tag <tag>] [--shell] [--help]\n';
// Decision (#2319): kept at the single-call convention, not widened. Each
// `gh issue view` call below fetches exactly one record — unlike
// fetch-sub-issues.js's 30000ms bound, which covers a single batched
// 50-alias GraphQL call, this CLI issues N genuinely separate single-record
// REST calls, so the 5000ms single-call convention (gh-api-module-pattern's
// "Bound every remote-contacting call") applies unchanged to each one.
const GH_TIMEOUT_MS = 5000;
const RECOGNIZED_TYPES = Object.keys(TYPE_PREFIX);
// Bundle Type aggregation precedence — highest-impact type wins so a lowest-numbered
// type:task record can never hide a type:feature (or type:bug) sibling behind a `chore:`
// subject (#2251 F6). Mirrors TYPE_PREFIX's own key set; a fourth Type added to
// TYPE_PREFIX in subject.js must gain a slot here too (see the RECOGNIZED_TYPES ===
// record.TYPES pinning test in compose-subject.test.js, which fails loudly on drift).
const TYPE_PRECEDENCE = ['feature', 'bug', 'task'];

const isPos = (n) => Number.isInteger(n) && n > 0;

// err -> its message, or its string form when it has none (e.g. a thrown non-Error).
function errMessage(err) {
  return err && err.message ? err.message : String(err);
}

function parseArgs(argv) {
  const opts = { numbers: [], repo: null, tag: null, shell: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; return opts; }
    if (a === '--shell') { opts.shell = true; continue; }
    if (a === '--repo' || a === '--tag') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `missing value for ${a}` };
      if (a === '--repo') opts.repo = v; else opts.tag = v;
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
  opts.numbers = [...new Set(opts.numbers)].sort((a, b) => a - b);
  return opts;
}

// Single-quote a value for POSIX sh: close, escaped quote, reopen.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// body, heading text -> that `## {heading}` section's trimmed body ('' when absent).
function extractSection(body, heading) {
  if (typeof body !== 'string') return '';
  const re = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm');
  const m = re.exec(body);
  return m ? m[1].trim() : '';
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

function typeOf(record) {
  const native = record.issueType;
  if (native && typeof native === 'object' && typeof native.name === 'string') {
    const name = native.name.toLowerCase();
    return RECOGNIZED_TYPES.includes(name) ? name : null;
  }
  const names = normalizeLabelNames(record.labels);
  for (const t of RECOGNIZED_TYPES) if (names.includes(`type:${t}`)) return t;
  return null;
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
  runner: (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS }),
  fetchIssueType: (runner, repoSpec, n) => fetchIssueTypeGraphQL(runner, repoSpec, n),
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
    let raw;
    let issueTypeFieldRejected = false;
    try {
      raw = deps.runner(['issue', 'view', String(n), '--repo', slug, '--json', 'number,title,body,labels,issueType']);
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
        raw = deps.runner(['issue', 'view', String(n), '--repo', slug, '--json', 'number,title,body,labels']);
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
    if (issueTypeFieldRejected) {
      const hasTypeLabel = RECOGNIZED_TYPES.some((t) => normalizeLabelNames(record.labels).includes(`type:${t}`));
      record.issueType = hasTypeLabel ? null : deps.fetchIssueType(deps.runner, repoSpec, n);
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

  let composed;
  try {
    composed = composeSubject({
      type: aggregateType(records),
      title: subjectRecord.title,
      number: subjectRecord.number,
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

  if (opts.shell) {
    deps.stdout(`SUBJECT_TITLE=${shellQuote(composed.title)}\nSUBJECT_BODY=${shellQuote(composed.body)}\n`);
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
