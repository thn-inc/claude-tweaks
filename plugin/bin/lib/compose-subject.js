// bin/lib/compose-subject.js — run(argv, deps) behind
// bin/compose-subject.js (#2251): reads one or more records via `gh issue
// view`, derives the composer's inputs (Type via native issueType then type:*
// label — the same precedence bin/lib/record-graph/encode.js's typeOf uses,
// aggregated across the whole bundle by precedence feature > bug > task (a
// type:task lowest-numbered record must not hide a type:feature sibling and
// under-bump the release); `breaking` via parseRecordFacets; summary = ##
// Overview's first sentence, falling back to ## Current State's first
// sentence for shaping-mode/specShapedBody records, which carry no ##
// Overview; migrationNote = the ## Breaking Change section), and prints
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
'use strict';

const { execFileSync } = require('child_process');
const { composeSubject, ComposeSubjectError, TYPE_PREFIX } = require('./release/subject');
const { parseRecordFacets, normalizeLabelNames } = require('./issues/record');
const { parseRepo, ghAvailable, remoteUrl } = require('./repo-resolve');

const USAGE = 'usage: compose-subject.js <n>[,<m>...] [<k>...] [--repo owner/name] [--tag <tag>] [--shell] [--help]\n';
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

// text -> its first sentence: the first paragraph (newlines collapsed to spaces), cut at
// the first `.`/`!`/`?` that is followed by whitespace or end of text; the whole paragraph
// when it has no such terminator.
function firstSentence(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return '';
  const firstPara = t.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim();
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(firstPara);
  return m ? m[0].trim() : firstPara;
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
  const repoSpec = opts.repo ? parseRepo(`github.com/${opts.repo}`) : parseRepo(remote);
  if (!repoSpec) { deps.stderr('compose-subject.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
  const slug = `${repoSpec.owner}/${repoSpec.repo}`;

  const records = [];
  for (const n of opts.numbers) {
    let raw;
    try {
      raw = deps.runner(['issue', 'view', String(n), '--repo', slug, '--json', 'number,title,body,labels,issueType']);
    } catch (err) {
      deps.stderr(`compose-subject.js: gh issue view ${n} failed: ${errMessage(err)}\n`);
      return 3;
    }
    let record;
    try { record = JSON.parse(raw); } catch {
      deps.stderr(`compose-subject.js: gh issue view ${n} returned unparseable JSON\n`);
      return 3;
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
  const migrationNote = breakingRecords.map((r) => extractSection(r.body, 'Breaking Change')).filter(Boolean).join('\n\n');

  let composed;
  try {
    composed = composeSubject({
      type: aggregateType(records),
      title: subjectRecord.title,
      number: subjectRecord.number,
      breaking: breakingRecords.length > 0,
      summary: firstSentence(extractSection(subjectRecord.body, 'Overview') || extractSection(subjectRecord.body, 'Current State')),
      migrationNote,
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

module.exports = { run, parseArgs, shellQuote, extractSection, firstSentence, typeOf, aggregateType, USAGE, realDeps };
