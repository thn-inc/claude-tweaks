#!/usr/bin/env node
// bin/review-coordination.js — single-plain-command CLI over bin/lib/coordination.js's
// comparison/resolution helpers, for /claude-tweaks:review's Step 3/3.5 procedures
// (step3-lens-dispatch.md, step3-debate-and-refutation.md). Replaces the multi-line
// `node -e` invocations the harness worktree guard refuses (refs #887).
//   node bin/review-coordination.js categorise-reproduction <agentA.json> <agentB.json> [--lens <lens> --run <dir> --only confirmed|unconfirmed [--hold <file>]]
//   node bin/review-coordination.js log-reproduction-judgment <judgment.json> --lens <lens> --run <dir>
//   node bin/review-coordination.js settle-lens-replies <result.json> --ctx-id <id> [--run <dir> --only confirmed|unconfirmed [--hold <file>]]
//   node bin/review-coordination.js merge-lens-replies --out <file> --lens <id> --reviewers 1|2 --side-a <text-file|-> [--side-b <text-file|->] [--into <reply.json>]
//   node bin/review-coordination.js record-lens-dispatch --run <dir> --lens <3a..3h> --reviewers 1|2 --path task|workflow|worker --status completed|failed|blocked [--round <n>]
//   node bin/review-coordination.js detect-overlap <findings-by-lens.json>
//   node bin/review-coordination.js corroborate-cross-lens <unconfirmed-by-lens.json>
//   node bin/review-coordination.js resolve-debate <verdictA> <verdictB>
//   node bin/review-coordination.js resolve-tiebreak <finding.json> <reply-file> [--root <dir>] [--run <dir>] [--tier capable|standard]
//   node bin/review-coordination.js finding-ids <entries.json>
//   node bin/review-coordination.js plan-chunks <entries.json>
//   node bin/review-coordination.js write-findings <run-dir> <findings.json>
//   node bin/review-coordination.js check-coverage <run-dir>
// categorise-reproduction/log-reproduction-judgment/detect-overlap/corroborate-cross-lens print JSON
// (corroborate-cross-lens: #3604; log-reproduction-judgment: #5595); resolve-debate prints
// the bare resolution string. resolve-tiebreak/write-findings/check-coverage
// (#3945) print one JSON line: the resolver result (a could-not-parse reply is
// parse:"could-not-parse" with exit 0 — the signal is in the JSON), {path, count}
// of the review-findings.json written through the run-dir anchoring guard, and
// the tiebreak-coverage result over the run dir and its spec-*/ subdirs, the
// same set the archive gate checks (missing ids, exit 0 either way — archival,
// not this exit code, refuses). --root (default cwd) is where resolve-tiebreak
// reads the evidence file from; a finding path whose real path (symlinks
// followed, `..` normalized) leaves --root is never read, so its evidence is
// unverified. check-coverage goes through the same run-dir anchoring guard as
// write-findings: a worktree-local shadow run dir holds no artifact, and
// reading it would report a confident "nothing missing" [IL-127].
// resolve-tiebreak --run (#4026) appends the verdict line it prints — logStatus,
// step logStep, text logText, Reversibility: high — under decisions.md's
// `## /review` (the line step3-tiebreak.md's step 3 told the caller to log) and
// adds `logged` to the JSON: false, with one stderr line, when the append threw,
// which never changes the exit code. Without --run the output is unchanged.
// resolve-tiebreak's chunk form (#5540): when <finding.json> is a JSON array of 1 to
// CHUNK_MAX findings, <reply-file> holds one `Id: {12 hex}` block per finding and the
// call prints {chunk: true, results, unsettled, escalated}. Each settled finding (its block
// present exactly once) gets a result — the one-finding result plus id, index and,
// under --run, logged — and, under --run, its verdict line, appended in entry order. A
// missing or repeated id settles nothing and is named in unsettled with reason
// missing|duplicated, for the caller to re-dispatch alone. An empty, oversize or
// malformed array, or one repeating a finding id, exits 2 before anything is written.
// finding-ids (#5540) runs the chunk form's input checks over a JSON array of entries
// and prints {ids: [{index, id}]} — each id tiebreak.js's findingId, the `Id:` header a
// chunk agent is given — with no run dir and no writes; a failed check exits 2.
// plan-chunks (#5541) takes a JSON array of entries of any length and prints
// {chunks: [{chunk, tier, indexes}]}: tiebreak.js's planChunks, numbered from 1 in output
// order, each chunk one judge tier ('capable' | 'standard') of at most CHUNK_MAX entries,
// `indexes` positions in the input, a repeated finding id kept once at its first index (its later
// indexes appear in no chunk); [] prints {chunks: []}. No writes; an unreadable file, a
// non-array or a malformed entry exits 2 with the cause on stderr.
// resolve-tiebreak --tier (#5541), capable (the default) or standard; a missing or unknown
// value exits 2. At standard every entry must be Standard-tier (tiebreak.js's judgeTier); a
// Capable-tier entry exits 2 before the reply is read or anything is appended. The chunk
// form's output gains `escalated` beside results and unsettled: the entries a Standard judge
// raised to medium or higher, each {id, index, reason: 'raised', severity}, with no result and
// no verdict line, for the caller to judge again at capable ([] at capable). The one-finding
// form at standard prints {escalated: true, id, reason: 'raised', severity} for a raised
// finding — exit 0, nothing appended; any other reply resolves as at capable.
// categorise-reproduction --run (#5595) appends the reproduction pair lines (lib/reproduction-log.js's
// forms 1 to 4) under decisions.md's `## /review`, one line per finding and one per coincidence, in the
// order of the printed result: `--only confirmed` writes forms 1/2, `--only unconfirmed` forms 3/4 minus
// the findings of --hold (a JSON array of unconfirmed findings, each matching exactly one, that a tiebreak
// or the cross-lens pass already settled). The JSON gains `entries` (each carrying `section: "/review"`,
// the shape log-decision.js --entries takes), `unlocated` (unconfirmed findings with no integer line) and
// `logged`: false, with one stderr line, when the append threw, which never changes the exit code. --lens is
// a lens token plus an optional suffix, never a `"` or line break. Every refusal (a flag combination, a lens,
// a hold file, a finding path with a line break) exits 2 before the run dir is anchored and writes nothing.
// Without --run the output, exit codes and argument check are unchanged. Calling it twice appends twice.
// A value flag given twice (--lens a --lens b) exits 2 rather than keeping the last value.
// log-reproduction-judgment (#5595) appends one of the three judged reproduction lines (lib/reproduction-log.js's
// forms 5 to 7) under decisions.md's `## /review`, from a one-object JSON file: {kind: "absence-refuted", path,
// symbol, command, foundAt: {path, line}}, {kind: "vacuity-downgraded", path, line} or {kind: "vacuity-reconfirmed",
// path, line, command, output}. Any other kind exits 2. It prints {entries: [entry], logged}, `logged` as above. It
// formats what the session reports: it does not check that the command ran or that the output is real, the trust a
// hand-written line carried. A vacuity kind needs a --lens whose leading token is `3f`; vacuity-downgraded also needs
// an earlier form 1 or 2 line (a reproduced pair line) for that lens and location under `## /review`, so the
// downgrade is always the later line and stays an open console item until a tiebreak verdict settles it. The
// judgment file holds only its kind's declared keys (a `lens` or any other key exits 2: the lens comes from --lens), and
// an absence-refuted `symbol` holds no whitespace (the pair-line reader takes it as one token).
// Every refusal exits 2 and writes nothing; all come before the run dir is anchored except two of
// vacuity-downgraded's, which read decisions.md (no earlier reproduced line; a decisions.md that cannot be read).
// settle-lens-replies (#5598) takes the lens reviewers' reply texts — {lenses: [{lens, reviewers: 1|2}], reviewers:
// [{lens, side: 'A'|'B', text: string|null, failed}]}, bare or under a top-level `result` — parses each with
// lib/lens-reply.js and gives every reviewer one state (failed, not-done, unparseable, status-missing,
// status-misplaced, ok; first fit wins). A two-reviewer lens whose reviewers are both usable (status-misplaced or
// ok) settles: categoriseReproduction over the parsed findings, so a reviewer that did not answer is never read as
// an empty table. Any other lens is listed under needsSession (reason single-reviewer, or reviewer-unusable) with
// each usable reviewer's findings written to review-{ctx-id}-lens-{LENS}-agent{A|B}.json (session-tmp-resolve's
// path, from deps.env) and reported as findingsPath, null with one stderr line when the write failed. It prints one
// JSON line {settled, needsSession, violations, overflow, skipped}; --run/--only/--hold append each settled lens's
// pair lines as categorise-reproduction --run --lens does (settled items then carry entries and logged), --hold
// entries being {lens, ...finding}. Every refusal is one stderr line, exit 2, before anything is written.
// merge-lens-replies (#6003) folds one lens's Task-path reply texts into a settle-lens-replies input so one settle call
// settles every lens: it reads --into when given (a bare or `result`-wrapped reply, as settle-lens-replies reads it),
// drops every lenses/reviewers entry for --lens, appends {lens, reviewers} and one {lens, side, text, failed} per side
// (the text file's whole content, UTF-8, byte-exact; `-` for a side that failed or never answered: text null, failed true),
// and writes {lenses, reviewers} to --out atomically (--out may be --into). It prints {out, lenses, replaced}. --side-b is
// required with --reviewers 2 and refused with 1. Every refusal (a missing flag, a lens token outside the finding-line class, an
// unreadable text file, an empty or invalid --into) is one stderr line, exit 2, with nothing written; a failed write of --out exits 3.
// record-lens-dispatch (#5998) is the one sanctioned writer of the run dir's lens-dispatch.json (lib/review-lens/
// dispatch-record.js documents the file): it appends {lens, reviewers, path, round, status} (--round defaults to 1) under a
// fail-closed lock and prints {path, entry, duplicate}. An identical entry already present is not appended again
// (duplicate: true, exit 0). Exit 2 for any malformed flag or value, before the run dir is anchored; exit 3 for an
// unanchored or missing run dir, or when the append failed (a lock not taken in time, a malformed existing file, which is
// never overwritten), with one stderr line. It writes no decisions.md line.
// Exit 0 ok; 2 malformed invocation (a blank resolve-tiebreak --run included) or unreadable/invalid input (check-coverage:
// also a run dir that does not exist); 3 run dir unanchored (write-findings, check-coverage, resolve-tiebreak --run,
// categorise-reproduction --run, log-reproduction-judgment, settle-lens-replies --run, record-lens-dispatch), or missing (write-findings,
// resolve-tiebreak --run, categorise-reproduction --run, log-reproduction-judgment, settle-lens-replies --run, record-lens-dispatch), or the append failed (record-lens-dispatch, a held lock included), or the --out write failed (merge-lens-replies).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  categoriseReproduction,
  detectCrossLensOverlap,
  corroborateCrossLens,
  resolveDebate,
} = require('./lib/coordination');
const {
  resolveTiebreak, resolveTiebreakChunk, CHUNK_MAX, buildFindingsArtifact, checkRunTiebreakCoverage, FINDINGS_ARTIFACT,
  findingId, TIERS, judgeTier, planChunks, escalation,
} = require('./lib/tiebreak');
const { resolveWithin } = require('./lib/path-guard');
const { resolveTarget } = require('./lib/stage-item/write');
const { writeArtifact } = require('./lib/run-artifact/write');
const { formatEntry, appendEntry, appendEntries } = require('./lib/log-decision/append');
const { FINDING_LENS_CLASS } = require('./lib/console/finding-path');
const { pairEntries, holdKey, absenceRefuted, vacuityDowngraded, vacuityReconfirmed, JUDGMENT_KINDS } = require('./lib/reproduction-log');
const { classifyPairLine } = require('./lib/timing/pair-lines');
const { parseLensReply } = require('./lib/lens-reply');
const { entryProblem, appendLensDispatch } = require('./lib/review-lens/dispatch-record');
const { writeFileAtomic } = require('./lib/atomic-write');
const { resolvePrinted } = require('./session-tmp-resolve');

const USAGE =
  'usage: review-coordination.js categorise-reproduction <agentA.json> <agentB.json> [--lens <lens> --run <dir> --only confirmed|unconfirmed [--hold <file>]]\n' +
  '       review-coordination.js log-reproduction-judgment <judgment.json> --lens <lens> --run <dir>\n' +
  '       review-coordination.js settle-lens-replies <result.json> --ctx-id <id> [--run <dir> --only confirmed|unconfirmed [--hold <file>]]\n' +
  '       review-coordination.js merge-lens-replies --out <file> --lens <id> --reviewers 1|2 --side-a <text-file|-> [--side-b <text-file|->] [--into <reply.json>]\n' +
  '       review-coordination.js record-lens-dispatch --run <dir> --lens <3a..3h> --reviewers 1|2 --path task|workflow|worker --status completed|failed|blocked [--round <n>]\n' +
  '       review-coordination.js detect-overlap <findings-by-lens.json>\n' +
  '       review-coordination.js corroborate-cross-lens <unconfirmed-by-lens.json>\n' +
  '       review-coordination.js resolve-debate <verdictA> <verdictB>\n' +
  '       review-coordination.js resolve-tiebreak <finding.json> <reply-file> [--root <dir>] [--run <dir>] [--tier capable|standard]\n' +
  '       review-coordination.js finding-ids <entries.json>\n' +
  '       review-coordination.js plan-chunks <entries.json>\n' +
  '       review-coordination.js write-findings <run-dir> <findings.json>\n' +
  '       review-coordination.js check-coverage <run-dir>\n';

// A relative path argument resolves against deps.cwd(), never the process's real working directory.
const at = (deps, file) => (path.isAbsolute(file) ? file : path.resolve(deps.cwd(), file));

function readJson(file, deps) {
  const stderr = deps.stderr;
  let raw;
  try {
    raw = fs.readFileSync(at(deps, file), 'utf8');
  } catch (err) {
    stderr(`review-coordination.js: cannot read ${file}: ${err.message}\n`);
    return { failed: true };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch (err) {
    stderr(`review-coordination.js: invalid JSON in ${file}: ${err.message}\n`);
    return { failed: true };
  }
}

// Anchors a run dir under the main checkout. Returns { dir } on success, else
// { exitCode } after writing the reason to stderr (a missing dir exits
// `missingExitCode`; an unanchored or unresolvable one exits 3).
function anchorRunDir(runDir, deps, missingExitCode) {
  let target;
  try {
    target = resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  } catch (err) {
    deps.stderr(`review-coordination.js: ${err && err.message}\n`);
    return { exitCode: 3 };
  }
  if (target.ok) return { dir: target.dir };
  if (target.reason === 'missing') {
    deps.stderr(`review-coordination.js: run dir does not exist: ${runDir}\n`);
    return { exitCode: missingExitCode };
  }
  deps.stderr(`review-coordination.js: run dir is not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/): ${runDir} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
  return { exitCode: 3 };
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  now: () => new Date(),
  appendDecision: appendEntry,
  appendDecisions: appendEntries,
  get env() { return process.env; },
};

// Appends one resolved verdict's decisions.md line under --run and sets `result.logged`;
// a failed append sets `logged: false` and writes one stderr line, never throwing.
// Shared by resolve-tiebreak's one-finding and chunk forms.
function appendVerdict(result, anchoredDir, now, deps) {
  try {
    const entry = formatEntry({ status: result.logStatus, now, step: result.logStep, text: result.logText, reversibility: 'high' });
    deps.appendDecision({ runDir: anchoredDir, section: '/review', entry });
    result.logged = true;
  } catch (err) {
    result.logged = false;
    deps.stderr(`review-coordination.js: could not append the decisions.md entry (- ${result.logLine}): ${(err && err.message) || err}\n`);
  }
}

const REPRODUCTION_FLAGS = ['--lens', '--run', '--only', '--hold'];

// Splits rest into { flags, positional } for a verb whose value flags are `names`; a trailing bare flag, a blank
// value (an unset $PIPELINE_RUN_DIR expands to "") or a flag given twice is a usage error: { exitCode: 2 }.
// `brief` drops the USAGE tail from those refusals (one stderr line), for the verbs that promise one.
function parseValueFlags(rest, names, deps, { brief = false } = {}) {
  const usage = brief ? '' : USAGE;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (!names.includes(rest[i])) {
      positional.push(rest[i]);
      continue;
    }
    if (i + 1 >= rest.length || rest[i + 1].trim() === '') {
      deps.stderr(`review-coordination.js: ${rest[i]} needs a value\n` + usage);
      return { exitCode: 2 };
    }
    const name = rest[i].slice(2);
    if (flags[name] !== undefined) {
      deps.stderr(`review-coordination.js: ${rest[i]} given more than once\n` + usage);
      return { exitCode: 2 };
    }
    flags[name] = rest[++i];
  }
  return { flags, positional };
}

// A lens is the token class finding lines read (console/finding-path.js's FINDING_LENS_CLASS) plus an
// optional suffix such as ` (Security)`; never a `"` or a line break, which would end the quoted lens
// in the line or split the line. Returns the refusal text, or null for a usable lens.
const LENS_RE = new RegExp(`^[${FINDING_LENS_CLASS}]+[^"\\r\\n]*$`);
function lensProblem(lens) {
  if (typeof lens === 'string' && LENS_RE.test(lens)) return null;
  return `--lens must start with a lens token (letters, digits, _ or -) and hold no quote or line break, got ${JSON.stringify(lens)}`;
}

// The hold file's refusal text, or null: a JSON array of findings, each matching exactly one
// unconfirmed finding by holdKey. A finding matching none was never staged here; one matching
// several cannot say which it settled.
function holdProblem(hold, file, unconfirmed) {
  if (!Array.isArray(hold)) return `${file} must hold a JSON array of findings`;
  for (const [i, entry] of hold.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return `${file} entry ${i} is not a finding object`;
    const matches = unconfirmed.filter((f) => holdKey(f) === holdKey(entry)).length;
    if (matches !== 1) return `${file} entry ${i} matches ${matches} unconfirmed findings, it must match exactly 1`;
  }
  return null;
}

// The findings one categorise-reproduction call writes lines for: the confirmed ones, or the
// unconfirmed ones the hold file does not name.
function writtenFindings(result, only, hold) {
  if (only === 'confirmed') return result.confirmed;
  const held = new Set(hold.map(holdKey));
  return result.unconfirmed.filter((f) => !held.has(holdKey(f)));
}

// Appends already-composed entries (each carrying its `section`) under one now and one lock; returns
// true when appended (an empty batch included), false after one stderr line when the append threw,
// which never changes the exit code. Shared by every verb that writes composed decisions.md lines.
function appendDecisionEntries(entries, anchoredDir, deps) {
  try {
    const now = deps.now();
    deps.appendDecisions({ runDir: anchoredDir, items: entries.map((e) => ({ section: e.section, entry: formatEntry({ ...e, now }) })) });
    return true;
  } catch (err) {
    const message = String((err && err.message) || err).replace(/[\r\n]+/g, ' ');
    deps.stderr(`review-coordination.js: could not append the decisions.md entries (${message})\n`);
    return false;
  }
}

// The evidence reader both resolve-tiebreak forms pass the resolver: it throws
// (→ evidence-unverified) for a path that resolves outside --root.
function evidenceReader(root) {
  return (p) => {
    const real = resolveWithin(path.resolve(root, p), root);
    if (real === null) throw new Error(`evidence path is outside --root or does not resolve: ${p}`);
    return fs.readFileSync(real, 'utf8');
  };
}

// The chunk form's input checks, shared by resolve-tiebreak's chunk form and finding-ids:
// returns { ids } (one finding id per entry, in entry order) or { exitCode: 2 } after one stderr line.
function validateChunk(findings, file, deps) {
  if (findings.length === 0 || findings.length > CHUNK_MAX) {
    deps.stderr(`review-coordination.js: a tiebreak chunk holds 1 to ${CHUNK_MAX} findings, ${file} holds ${findings.length}\n`);
    return { exitCode: 2 };
  }
  let ids;
  try {
    ids = buildFindingsArtifact(findings).map((f) => f.id);
  } catch (err) {
    deps.stderr(`review-coordination.js: malformed finding in ${file}: ${err.message}\n`);
    return { exitCode: 2 };
  }
  if (new Set(ids).size !== ids.length) {
    deps.stderr(`review-coordination.js: two findings in ${file} share a finding id\n`);
    return { exitCode: 2 };
  }
  return { ids };
}

// True, after one stderr line, when the entries cannot be judged at `tier` (#5541): at
// 'standard' every entry must be Standard-tier (judgeTier), so a Capable-tier finding is a
// caller error caught here before the reply is read or anything is appended, never by
// catching resolveTiebreakChunk's TypeError afterwards. 'capable' accepts every entry.
// Callers pass entries validateChunk or buildFindingsArtifact already accepted.
function refusedAtTier(findings, tier, deps) {
  if (tier !== 'standard' || !findings.some((f) => judgeTier(f) === 'capable')) return false;
  deps.stderr('review-coordination.js: a Capable-tier finding cannot be judged at standard — run plan-chunks and judge each chunk at its own tier\n');
  return true;
}

// The chunk form of resolve-tiebreak (#5540): the entries file is a JSON array of
// 1..CHUNK_MAX findings and the reply file holds one block per finding. Every exit-2
// check runs before the reply is read, the run dir is anchored, or anything is
// appended, so a refused chunk writes nothing.
function resolveTiebreakChunkCommand(findings, positional, root, runDir, tier, deps) {
  const checked = validateChunk(findings, positional[0], deps);
  if (checked.exitCode !== undefined) return checked.exitCode;
  if (refusedAtTier(findings, tier, deps)) return 2;
  let reply;
  try {
    reply = fs.readFileSync(at(deps, positional[1]), 'utf8');
  } catch (err) {
    deps.stderr(`review-coordination.js: cannot read ${positional[1]}: ${err.message}\n`);
    return 2;
  }
  let anchored = null;
  if (runDir !== null) {
    anchored = anchorRunDir(runDir, deps, 3);
    if (anchored.exitCode !== undefined) return anchored.exitCode;
  }
  const now = deps.now();
  const { results, unsettled, escalated } = resolveTiebreakChunk(findings, reply, { readFile: evidenceReader(root), now, tier });
  if (anchored) {
    for (const result of results) appendVerdict(result, anchored.dir, now, deps);
  }
  deps.stdout(JSON.stringify({ chunk: true, results, unsettled, escalated }) + '\n');
  return 0;
}

// The judged lines' closed field rules (#5595): each kind's single-line string fields, whole-number lines and shape.
// `lens3f` marks the kinds whose line is a lens 3f line (--lens must start with 3f). The table's keys must stay equal to
// the composer's JUDGMENT_KINDS; a test pins that.
const isText = (v) => typeof v === 'string' && v.trim() !== '' && !/[\r\n]/.test(v);
const isLineNumber = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const JUDGMENT_FIELDS = {
  'absence-refuted': { text: ['path', 'symbol', 'command'], extra: ['foundAt'], compose: absenceRefuted },
  'vacuity-downgraded': { text: ['path'], lines: ['line'], lens3f: true, compose: vacuityDowngraded },
  'vacuity-reconfirmed': { text: ['path', 'command', 'output'], lines: ['line'], lens3f: true, compose: vacuityReconfirmed },
};
const LENS_TOKEN_RE = new RegExp(`^[${FINDING_LENS_CLASS}]+`);
const leadingToken = (lens) => { const m = LENS_TOKEN_RE.exec(lens); return m ? m[0] : null; };

// The keys a kind's judgment may hold besides `kind`. Any other key (a `lens` above all, which would override
// --lens and skip its checks) is refused, and the composer is handed only these.
const judgmentKeys = (rule) => [...rule.text, ...(rule.lines || []), ...(rule.extra || [])];

// The refusal text for a judgment object's fields, or null.
function judgmentProblem(j, rule) {
  const undeclared = Object.keys(j).filter((k) => k !== 'kind' && !judgmentKeys(rule).includes(k));
  if (undeclared.length) return `unexpected key ${undeclared.map((k) => JSON.stringify(k)).join(', ')}, a ${j.kind} judgment holds only kind, ${judgmentKeys(rule).join(', ')}`;
  for (const k of rule.text) if (!isText(j[k])) return `${k} must be a non-empty single-line string, got ${JSON.stringify(j[k])}`;
  // The pair-line reader takes the symbol of `{path}:{symbol}` as one whitespace-free token (timing/pair-lines.js), so a
  // symbol holding whitespace would be logged as a line no reader classifies.
  if (j.kind === 'absence-refuted' && /\s/.test(j.symbol)) return `symbol must not hold whitespace, got ${JSON.stringify(j.symbol)}`;
  for (const k of rule.lines || []) if (!isLineNumber(j[k])) return `${k} must be a whole number of 1 or more, got ${JSON.stringify(j[k])}`;
  if (j.kind === 'absence-refuted') {
    const at = j.foundAt;
    if (!at || typeof at !== 'object' || Array.isArray(at)) return `foundAt must be {path, line}, got ${JSON.stringify(at)}`;
    if (!isText(at.path)) return `foundAt.path must be a non-empty single-line string, got ${JSON.stringify(at.path)}`;
    if (!isLineNumber(at.line)) return `foundAt.line must be a whole number of 1 or more, got ${JSON.stringify(at.line)}`;
  }
  return null;
}

// True when decisions.md's `## /review` section holds a form 1 or 2 line for lens 3f at file:line.
function holdsReproducedLine(text, file, line) {
  let inReview = false;
  for (const raw of text.split('\n')) {
    if (/^## /.test(raw)) { inReview = raw.trimEnd() === '## /review'; continue; }
    if (!inReview || !raw.startsWith('- ')) continue;
    const m = classifyPairLine(raw);
    if (m && (m.form === 'reproduced' || m.form === 'reproduced-severity-contested')
      && leadingToken(m.lens || '') === '3f' && m.path === file && m.line === line) return true;
  }
  return false;
}

// log-reproduction-judgment <judgment.json> --lens <lens> --run <dir> (#5595); every refusal precedes any write, and all
// but vacuity-downgraded's two decisions.md refusals (no earlier reproduced line; an unreadable decisions.md) precede the anchoring.
function logReproductionJudgment(rest, deps) {
  const parsed = parseValueFlags(rest, ['--lens', '--run'], deps);
  if (parsed.exitCode !== undefined) return parsed.exitCode;
  const { flags, positional } = parsed;
  const refuse = (message) => { deps.stderr(`review-coordination.js: ${message}\n`); return 2; };
  if (positional.length !== 1) return refuse('log-reproduction-judgment takes exactly 1 JSON file path\n' + USAGE.trimEnd());
  if (flags.lens === undefined || flags.run === undefined) return refuse('log-reproduction-judgment needs --lens and --run\n' + USAGE.trimEnd());
  const lensRefusal = lensProblem(flags.lens);
  if (lensRefusal) return refuse(lensRefusal);
  const input = readJson(positional[0], deps);
  if (input.failed) return 2;
  const j = input.value;
  if (!j || typeof j !== 'object' || Array.isArray(j)) return refuse(`${positional[0]} must hold one JSON object`);
  if (!JUDGMENT_KINDS.includes(j.kind)) return refuse(`unknown judgment kind "${j.kind}" — expected one of ${JUDGMENT_KINDS.join(', ')}`);
  const rule = JUDGMENT_FIELDS[j.kind];
  const problem = judgmentProblem(j, rule);
  if (problem) return refuse(`${j.kind}: ${problem}`);
  if (rule.lens3f && leadingToken(flags.lens) !== '3f') return refuse(`${j.kind} is a lens 3f line, --lens must start with 3f, got ${JSON.stringify(flags.lens)}`);
  const anchored = anchorRunDir(flags.run, deps, 3);
  if (anchored.exitCode !== undefined) return anchored.exitCode;
  if (j.kind === 'vacuity-downgraded') {
    let text = '';
    try {
      text = fs.readFileSync(path.join(anchored.dir, 'decisions.md'), 'utf8');
    } catch (err) {
      if (!err || err.code !== 'ENOENT') return refuse(`cannot read decisions.md: ${(err && err.message) || err}`);
    }
    if (!holdsReproducedLine(text, j.path, j.line)) {
      return refuse(`vacuity-downgraded needs an earlier reproduced line (form 1 or 2) for lens 3f at ${j.path}:${j.line} under ## /review in decisions.md; write it with categorise-reproduction --run --only confirmed first`);
    }
  }
  const fields = Object.fromEntries(judgmentKeys(rule).map((k) => [k, j[k]]));
  const composed = { ...rule.compose({ ...fields, lens: flags.lens }), section: '/review' };
  const logged = appendDecisionEntries([composed], anchored.dir, deps);
  deps.stdout(JSON.stringify({ entries: [composed], logged }) + '\n');
  return 0;
}

// ---- settle-lens-replies (#5598): lens reviewers' reply texts -> pair verdicts ----

const LENS_SEGMENT_RE = new RegExp(`^[${FINDING_LENS_CLASS}]+$`);
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// The refusal text for a --ctx-id that is not one plain path segment (it names three files), or null.
function ctxIdProblem(id) {
  if (id !== '' && !/[\\/\r\n]/.test(id) && !id.includes('..')) return null;
  return `--ctx-id must be one plain path segment (no /, \\, .. or line break), got ${JSON.stringify(id)}`;
}

// The result file's refusal text, or { lenses, reviewers }. Bare: a top-level `reviewers` array; wrapped: the same
// object under a top-level `result` (both `lenses` and `reviewers` read from inside it).
function settleInputProblem(value, file) {
  let src = null;
  if (isPlainObject(value)) {
    if (Array.isArray(value.reviewers)) src = value;
    else if (isPlainObject(value.result) && Array.isArray(value.result.reviewers)) src = value.result;
  }
  if (src === null) return { problem: `${file} must hold an object with a reviewers array, at the top level or under result` };
  const lenses = src.lenses;
  if (!Array.isArray(lenses) || lenses.length === 0) return { problem: `${file} must name its lenses: a non-empty array of {lens, reviewers}` };
  const seen = new Set();
  for (const [i, l] of lenses.entries()) {
    if (!isPlainObject(l) || typeof l.lens !== 'string' || !LENS_SEGMENT_RE.test(l.lens)) return { problem: `lenses[${i}].lens must be one plain token of letters, digits, _ or -, got ${JSON.stringify(isPlainObject(l) ? l.lens : l)}` };
    if (l.reviewers !== 1 && l.reviewers !== 2) return { problem: `lenses[${i}].reviewers must be 1 or 2 for lens ${l.lens}, got ${JSON.stringify(l.reviewers)}` };
    if (seen.has(l.lens)) return { problem: `lens ${l.lens} is named twice in lenses` };
    seen.add(l.lens);
  }
  const reviewers = src.reviewers;
  if (reviewers.length === 0) return { problem: `${file} holds no reviewers` };
  const taken = new Set();
  for (const [i, r] of reviewers.entries()) {
    if (!isPlainObject(r)) return { problem: `reviewers[${i}] is not an object` };
    if (typeof r.lens !== 'string' || !LENS_SEGMENT_RE.test(r.lens)) return { problem: `reviewers[${i}].lens must be one plain token of letters, digits, _ or -, got ${JSON.stringify(r.lens)}` };
    if (r.side !== 'A' && r.side !== 'B') return { problem: `reviewers[${i}].side must be A or B, got ${JSON.stringify(r.side)}` };
    if (r.text !== null && typeof r.text !== 'string') return { problem: `reviewers[${i}].text must be a string or null, got ${JSON.stringify(r.text)}` };
    if (typeof r.failed !== 'boolean') return { problem: `reviewers[${i}].failed must be true or false, got ${JSON.stringify(r.failed)}` };
    if (!seen.has(r.lens)) return { problem: `reviewers[${i}] names lens ${r.lens}, which lenses does not` };
    if (taken.has(`${r.lens}/${r.side}`)) return { problem: `lens ${r.lens} side ${r.side} has two entries` };
    taken.add(`${r.lens}/${r.side}`);
  }
  for (const l of lenses) {
    const sides = ['A', 'B'].filter((s) => taken.has(`${l.lens}/${s}`));
    if (sides.length === 0) return { problem: `lens ${l.lens} has no reviewer entry` };
    if (l.reviewers === 1 && sides.length !== 1) return { problem: `lens ${l.lens} takes one reviewer (reviewers: 1), got entries for sides ${sides.join(' and ')}` };
    if (l.reviewers === 2 && sides.length !== 2) return { problem: `lens ${l.lens} takes two reviewers, side ${sides[0] === 'A' ? 'B' : 'A'} has no entry` };
  }
  return { lenses, reviewers };
}

// The closed state set, first fit wins (spec Deliverable 3). A failed reviewer is never an empty table.
function reviewerState(entry, parsed) {
  if (entry.failed || entry.text === null || entry.text.trim() === '') return 'failed';
  if (parsed.statusWord === 'BLOCKED' || parsed.statusWord === 'NEEDS_CONTEXT') return 'not-done';
  if (parsed.parse !== 'ok') return 'unparseable';
  if (parsed.status === 'missing') return 'status-missing';
  return parsed.status === 'misplaced' ? 'status-misplaced' : 'ok';
}
const isUsable = (r) => r.state === 'ok' || r.state === 'status-misplaced';

// Writes one usable reviewer's findings array to its session-temp path; returns the path, or null after one stderr line.
function writeLensFindings(ctxId, lens, r, deps) {
  const name = `review-${ctxId}-lens-${lens}-agent${r.side}.json`;
  try {
    const file = resolvePrinted(name, { env: deps.env });
    fs.writeFileSync(file, JSON.stringify(r.parsed.findings, null, 2) + '\n');
    return file;
  } catch (err) {
    const message = String((err && err.message) || err).replace(/[\r\n]+/g, ' ');
    deps.stderr(`review-coordination.js: could not write ${name} (${message})\n`);
    return null;
  }
}

// settle-lens-replies <result.json> --ctx-id <id> [--run <dir> --only confirmed|unconfirmed [--hold <file>]] (#5598).
// Every refusal (exit 2) precedes the run dir anchoring (exit 3), which precedes every write.
function settleLensReplies(rest, deps) {
  const parsedFlags = parseValueFlags(rest, ['--ctx-id', '--run', '--only', '--hold'], deps, { brief: true });
  if (parsedFlags.exitCode !== undefined) return parsedFlags.exitCode;
  const { flags, positional } = parsedFlags;
  const refuse = (message) => { deps.stderr(`review-coordination.js: ${message}\n`); return 2; };
  if (positional.length !== 1) return refuse('settle-lens-replies takes exactly 1 JSON file path');
  if (flags['ctx-id'] === undefined) return refuse('settle-lens-replies needs --ctx-id');
  if (flags.run === undefined && (flags.only !== undefined || flags.hold !== undefined)) return refuse('--only and --hold apply only with --run');
  if (flags.run !== undefined && flags.only === undefined) return refuse('settle-lens-replies --run needs --only');
  if (flags.only !== undefined && flags.only !== 'confirmed' && flags.only !== 'unconfirmed') return refuse('--only needs confirmed or unconfirmed');
  if (flags.hold !== undefined && flags.only !== 'unconfirmed') return refuse('--hold applies only with --only unconfirmed');
  const ctxId = flags['ctx-id'];
  const ctxRefusal = ctxIdProblem(ctxId);
  if (ctxRefusal) return refuse(ctxRefusal);
  const input = readJson(positional[0], deps);
  if (input.failed) return 2;
  const checked = settleInputProblem(input.value, positional[0]);
  if (checked.problem) return refuse(checked.problem);

  const states = checked.lenses.map(({ lens, reviewers: expected }) => {
    const rs = checked.reviewers.filter((e) => e.lens === lens).sort((x, y) => (x.side < y.side ? -1 : 1)).map((e) => {
      const parsed = parseLensReply(e.text === null ? '' : e.text);
      return { lens, side: e.side, parsed, state: reviewerState(e, parsed), text: e.text };
    });
    const settles = expected === 2 && rs.every(isUsable);
    return { lens, reviewers: rs, expected, settles, result: settles ? categoriseReproduction(rs[0].parsed.findings, rs[1].parsed.findings) : null };
  });
  const settled = states.filter((s) => s.settles);

  const hold = {};
  if (flags.hold !== undefined) {
    const held = readJson(flags.hold, deps);
    if (held.failed) return 2;
    if (!Array.isArray(held.value)) return refuse(`${flags.hold} must hold a JSON array of findings`);
    for (const [i, entry] of held.value.entries()) {
      if (!isPlainObject(entry)) return refuse(`${flags.hold} entry ${i} is not a finding object`);
      if (!settled.some((s) => s.lens === entry.lens)) return refuse(`${flags.hold} entry ${i} names lens ${JSON.stringify(entry.lens)}, which is not a settled lens`);
      hold[entry.lens] = hold[entry.lens] || [];
      hold[entry.lens].push(entry);
    }
    // The match-exactly-once rule is categorise-reproduction's own (holdProblem), applied to each
    // lens's entries over that lens's unconfirmed set; its entry index counts within the lens.
    for (const [lens, entries] of Object.entries(hold)) {
      const problem = holdProblem(entries, flags.hold, settled.find((s) => s.lens === lens).result.unconfirmed);
      if (problem) return refuse(`${problem} (lens ${JSON.stringify(lens)})`);
    }
  }

  const pairedByLens = new Map();
  if (flags.run !== undefined) {
    for (const s of settled) {
      const { entries } = pairEntries(s.result, { lens: s.lens, only: flags.only, hold: hold[s.lens] || [] });
      pairedByLens.set(s.lens, entries.map((e) => ({ ...e, section: '/review' })));
    }
  }

  let anchored = null;
  if (flags.run !== undefined) {
    anchored = anchorRunDir(flags.run, deps, 3);
    if (anchored.exitCode !== undefined) return anchored.exitCode;
  }

  const needsSession = [];
  for (const s of states) {
    if (s.settles) continue;
    const reason = s.expected === 1 ? 'single-reviewer' : 'reviewer-unusable';
    needsSession.push({
      lens: s.lens,
      reason,
      reviewers: s.reviewers.map((r) => {
        const out = { side: r.side, state: r.state, statusWord: r.parsed.statusWord };
        if (r.state === 'not-done') out.text = r.text;
        if (isUsable(r)) out.findingsPath = writeLensFindings(ctxId, s.lens, r, deps);
        return out;
      }),
    });
  }

  const logged = anchored ? appendDecisionEntries([...pairedByLens.values()].flat(), anchored.dir, deps) : undefined;
  const all = states.flatMap((s) => s.reviewers);
  const out = {
    settled: settled.map((s) => {
      const item = { lens: s.lens, confirmed: s.result.confirmed, unconfirmed: s.result.unconfirmed };
      if (anchored) { item.entries = pairedByLens.get(s.lens); item.logged = logged; }
      return item;
    }),
    needsSession,
    violations: all.filter((r) => r.state === 'status-misplaced' || r.state === 'status-missing').map((r) => ({ lens: r.lens, side: r.side, status: r.parsed.status })),
    overflow: all.filter((r) => r.parsed.parse === 'ok' && r.parsed.overflow > 0).map((r) => ({ lens: r.lens, side: r.side, hidden: r.parsed.overflow })),
    skipped: all.filter((r) => r.parsed.skipped > 0).map((r) => ({ lens: r.lens, side: r.side, rows: r.parsed.skipped })),
  };
  deps.stdout(JSON.stringify(out) + '\n');
  return 0;
}

// merge-lens-replies --out <file> --lens <id> --reviewers 1|2 --side-a <text-file|-> [--side-b <text-file|->] [--into <reply.json>] (#6003).
// Every refusal (exit 2) precedes the write; --into is read before --out is written, so the two may be one file.
function mergeLensReplies(rest, deps) {
  const parsedFlags = parseValueFlags(rest, ['--out', '--lens', '--reviewers', '--side-a', '--side-b', '--into'], deps, { brief: true });
  if (parsedFlags.exitCode !== undefined) return parsedFlags.exitCode;
  const { flags, positional } = parsedFlags;
  const refuse = (message) => { deps.stderr(`review-coordination.js: ${message}\n`); return 2; };
  if (positional.length !== 0) return refuse('merge-lens-replies takes no positional arguments');
  for (const need of ['out', 'lens', 'reviewers', 'side-a']) {
    if (flags[need] === undefined) return refuse(`merge-lens-replies needs --${need}`);
  }
  if (!LENS_SEGMENT_RE.test(flags.lens)) return refuse(`--lens must be one plain token of letters, digits, _ or -, got ${JSON.stringify(flags.lens)}`);
  if (flags.reviewers !== '1' && flags.reviewers !== '2') return refuse(`--reviewers must be 1 or 2, got ${JSON.stringify(flags.reviewers)}`);
  const reviewers = Number(flags.reviewers);
  if (reviewers === 1 && flags['side-b'] !== undefined) return refuse('--side-b applies only with --reviewers 2');
  if (reviewers === 2 && flags['side-b'] === undefined) return refuse('--reviewers 2 needs --side-b');
  const sides = [['A', flags['side-a']]];
  if (reviewers === 2) sides.push(['B', flags['side-b']]);
  const added = [];
  for (const [side, source] of sides) {
    if (source === '-') {
      added.push({ lens: flags.lens, side, text: null, failed: true });
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(at(deps, source), 'utf8');
    } catch (err) {
      return refuse(`cannot read ${source}: ${err.message}`);
    }
    added.push({ lens: flags.lens, side, text, failed: false });
  }
  let lenses = [];
  let kept = [];
  let replaced = false;
  if (flags.into !== undefined) {
    const input = readJson(flags.into, deps);
    if (input.failed) return 2;
    const checked = settleInputProblem(input.value, flags.into);
    if (checked.problem) return refuse(checked.problem);
    replaced = checked.lenses.some((l) => l.lens === flags.lens);
    lenses = checked.lenses.filter((l) => l.lens !== flags.lens);
    kept = checked.reviewers.filter((e) => e.lens !== flags.lens);
  }
  const merged = { lenses: [...lenses, { lens: flags.lens, reviewers }], reviewers: [...kept, ...added] };
  const valid = settleInputProblem(merged, flags.out);
  if (valid.problem) return refuse(valid.problem);
  try {
    writeFileAtomic(at(deps, flags.out), JSON.stringify(merged, null, 2) + '\n');
  } catch (err) {
    deps.stderr(`review-coordination.js: cannot write ${flags.out}: ${(err && err.message) || err}\n`);
    return 3;
  }
  deps.stdout(JSON.stringify({ out: flags.out, lenses: merged.lenses.map((l) => l.lens), replaced }) + '\n');
  return 0;
}

// record-lens-dispatch --run <dir> --lens <3a..3h> --reviewers 1|2 --path task|workflow|worker --status completed|failed|blocked [--round <n>] (#5998).
// Every flag refusal (exit 2) precedes the run dir anchoring (exit 3), which precedes the write.
function recordLensDispatch(rest, deps) {
  const parsedFlags = parseValueFlags(rest, ['--run', '--lens', '--reviewers', '--path', '--status', '--round'], deps, { brief: true });
  if (parsedFlags.exitCode !== undefined) return parsedFlags.exitCode;
  const { flags, positional } = parsedFlags;
  const refuse = (message) => { deps.stderr(`review-coordination.js: ${message}\n`); return 2; };
  if (positional.length !== 0) return refuse('record-lens-dispatch takes no positional argument');
  for (const name of ['run', 'lens', 'reviewers', 'path', 'status']) {
    if (flags[name] === undefined) return refuse(`record-lens-dispatch needs --${name}`);
  }
  if (flags.round !== undefined && !/^[1-9][0-9]*$/.test(flags.round)) return refuse(`--round must be a positive integer, got ${JSON.stringify(flags.round)}`);
  const entry = {
    lens: flags.lens,
    reviewers: /^[12]$/.test(flags.reviewers) ? Number(flags.reviewers) : flags.reviewers,
    path: flags.path,
    round: flags.round === undefined ? 1 : Number(flags.round),
    status: flags.status,
  };
  const problem = entryProblem(entry);
  if (problem) return refuse(problem);
  const anchored = anchorRunDir(flags.run, deps, 3);
  if (anchored.exitCode !== undefined) return anchored.exitCode;
  let result;
  try {
    result = appendLensDispatch({ runDir: anchored.dir, entry, env: deps.env });
  } catch (err) {
    const message = String((err && err.message) || err).replace(/[\r\n]+/g, ' ');
    deps.stderr(`review-coordination.js: could not record lens-dispatch.json (${message})\n`);
    return 3;
  }
  deps.stdout(JSON.stringify({ path: result.file, entry, duplicate: result.duplicate }) + '\n');
  return 0;
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h') {
    deps.stdout(USAGE);
    return 0;
  }
  if (command === 'categorise-reproduction') {
    const parsed = parseValueFlags(rest, REPRODUCTION_FLAGS, deps);
    if (parsed.exitCode !== undefined) return parsed.exitCode;
    const { flags, positional } = parsed;
    if (positional.length !== 2) {
      deps.stderr('review-coordination.js: categorise-reproduction takes exactly 2 JSON file paths\n' + USAGE);
      return 2;
    }
    const written = flags.run !== undefined;
    if (!written && (flags.lens !== undefined || flags.only !== undefined || flags.hold !== undefined)) {
      deps.stderr('review-coordination.js: --lens, --only and --hold apply only with --run\n' + USAGE);
      return 2;
    }
    if (written && (flags.lens === undefined || flags.only === undefined)) {
      deps.stderr('review-coordination.js: categorise-reproduction --run needs --lens and --only\n' + USAGE);
      return 2;
    }
    if (written && flags.only !== 'confirmed' && flags.only !== 'unconfirmed') {
      deps.stderr('review-coordination.js: --only needs confirmed or unconfirmed\n' + USAGE);
      return 2;
    }
    if (flags.hold !== undefined && flags.only === 'confirmed') {
      deps.stderr('review-coordination.js: --hold applies only with --only unconfirmed\n' + USAGE);
      return 2;
    }
    if (written) {
      const problem = lensProblem(flags.lens);
      if (problem) {
        deps.stderr(`review-coordination.js: ${problem}\n`);
        return 2;
      }
    }
    const a = readJson(positional[0], deps);
    if (a.failed) return 2;
    const b = readJson(positional[1], deps);
    if (b.failed) return 2;
    if (!Array.isArray(a.value) || !Array.isArray(b.value)) {
      deps.stderr('review-coordination.js: both inputs must be JSON arrays of findings\n');
      return 2;
    }
    const result = categoriseReproduction(a.value, b.value);
    if (!written) {
      deps.stdout(JSON.stringify(result) + '\n');
      return 0;
    }
    let hold = [];
    if (flags.hold !== undefined) {
      const held = readJson(flags.hold, deps);
      if (held.failed) return 2;
      const problem = holdProblem(held.value, flags.hold, result.unconfirmed);
      if (problem) {
        deps.stderr(`review-coordination.js: ${problem}\n`);
        return 2;
      }
      hold = held.value;
    }
    const { entries, unlocated } = pairEntries(result, { lens: flags.lens, only: flags.only, hold });
    const bad = writtenFindings(result, flags.only, hold).find((f) => typeof f.path !== 'string' || f.path === '' || /[\r\n]/.test(f.path));
    if (bad) {
      deps.stderr(`review-coordination.js: a finding path must be a non-empty single line, got ${JSON.stringify(bad.path)}\n`);
      return 2;
    }
    const anchored = anchorRunDir(flags.run, deps, 3);
    if (anchored.exitCode !== undefined) return anchored.exitCode;
    const sectioned = entries.map((e) => ({ ...e, section: '/review' }));
    const logged = appendDecisionEntries(sectioned, anchored.dir, deps);
    deps.stdout(JSON.stringify({ ...result, entries: sectioned, unlocated, logged }) + '\n');
    return 0;
  }
  if (command === 'log-reproduction-judgment') return logReproductionJudgment(rest, deps);
  if (command === 'settle-lens-replies') return settleLensReplies(rest, deps);
  if (command === 'merge-lens-replies') return mergeLensReplies(rest, deps);
  if (command === 'record-lens-dispatch') return recordLensDispatch(rest, deps);
  if (command === 'detect-overlap') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: detect-overlap takes exactly 1 JSON file path\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[0], deps);
    if (input.failed) return 2;
    if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) {
      deps.stderr('review-coordination.js: input must be a JSON object mapping lens name to findings array\n');
      return 2;
    }
    deps.stdout(JSON.stringify(detectCrossLensOverlap(input.value)) + '\n');
    return 0;
  }
  if (command === 'corroborate-cross-lens') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: corroborate-cross-lens takes exactly 1 JSON file path\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[0], deps);
    if (input.failed) return 2;
    if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) {
      deps.stderr('review-coordination.js: input must be a JSON object mapping lens name to findings array\n');
      return 2;
    }
    if (!Object.values(input.value).every(Array.isArray)) {
      deps.stderr('review-coordination.js: every lens value must be a findings array\n');
      return 2;
    }
    deps.stdout(JSON.stringify(corroborateCrossLens(input.value)) + '\n');
    return 0;
  }
  if (command === 'resolve-debate') {
    if (rest.length !== 2) {
      deps.stderr('review-coordination.js: resolve-debate takes exactly 2 verdicts\n' + USAGE);
      return 2;
    }
    deps.stdout(resolveDebate(rest[0], rest[1]) + '\n');
    return 0;
  }
  if (command === 'resolve-tiebreak') {
    let root = deps.cwd();
    let runDir = null;
    let tier = 'capable';
    const positional = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--tier') {
        if (!TIERS.includes(rest[i + 1])) {
          deps.stderr(`review-coordination.js: --tier needs one of ${TIERS.join(', ')}\n` + USAGE);
          return 2;
        }
        tier = rest[++i];
      } else if (rest[i] === '--root' || rest[i] === '--run') {
        // A blank --run (an unset $PIPELINE_RUN_DIR) is a missing one, never a run dir
        // resolved against cwd -- resolve-policy.js's rule (#1138).
        if (i + 1 >= rest.length || (rest[i] === '--run' && rest[i + 1].trim() === '')) {
          deps.stderr(`review-coordination.js: ${rest[i]} needs a directory\n` + USAGE);
          return 2;
        }
        if (rest[i] === '--root') root = at(deps, rest[++i]);
        else runDir = rest[++i];
      } else positional.push(rest[i]);
    }
    if (positional.length !== 2) {
      deps.stderr('review-coordination.js: resolve-tiebreak takes <finding.json> <reply-file> [--root <dir>] [--run <dir>] [--tier capable|standard]\n' + USAGE);
      return 2;
    }
    const input = readJson(positional[0], deps);
    if (input.failed) return 2;
    if (Array.isArray(input.value)) return resolveTiebreakChunkCommand(input.value, positional, root, runDir, tier, deps);
    try {
      buildFindingsArtifact([input.value]);
    } catch (err) {
      deps.stderr(`review-coordination.js: malformed finding in ${positional[0]}: ${err.message}\n`);
      return 2;
    }
    if (refusedAtTier([input.value], tier, deps)) return 2;
    let reply;
    try {
      reply = fs.readFileSync(at(deps, positional[1]), 'utf8');
    } catch (err) {
      deps.stderr(`review-coordination.js: cannot read ${positional[1]}: ${err.message}\n`);
      return 2;
    }
    let anchored = null;
    if (runDir !== null) {
      anchored = anchorRunDir(runDir, deps, 3);
      if (anchored.exitCode !== undefined) return anchored.exitCode;
    }
    // A Standard judge that raised the finding to medium or higher has not settled it (#5541):
    // print the escalation and append nothing, for the caller to judge it again at Capable.
    const raised = escalation(input.value, reply, tier);
    if (raised) {
      deps.stdout(JSON.stringify({ escalated: true, id: findingId(input.value), ...raised }) + '\n');
      return 0;
    }
    const now = deps.now();
    const result = resolveTiebreak(input.value, reply, { readFile: evidenceReader(root), now });
    if (anchored) appendVerdict(result, anchored.dir, now, deps);
    deps.stdout(JSON.stringify(result) + '\n');
    return 0;
  }
  if (command === 'finding-ids') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: finding-ids takes exactly 1 JSON file path\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[0], deps);
    if (input.failed) return 2;
    if (!Array.isArray(input.value)) {
      deps.stderr(`review-coordination.js: ${rest[0]} must hold a JSON array of tiebreak entries\n`);
      return 2;
    }
    const checked = validateChunk(input.value, rest[0], deps);
    if (checked.exitCode !== undefined) return checked.exitCode;
    deps.stdout(JSON.stringify({ ids: checked.ids.map((id, index) => ({ index, id })) }) + '\n');
    return 0;
  }
  if (command === 'plan-chunks') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: plan-chunks takes exactly 1 JSON file path\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[0], deps);
    if (input.failed) return 2;
    if (!Array.isArray(input.value)) {
      deps.stderr(`review-coordination.js: ${rest[0]} must hold a JSON array of tiebreak entries\n`);
      return 2;
    }
    let chunks;
    try {
      chunks = planChunks(input.value);
    } catch (err) {
      deps.stderr(`review-coordination.js: malformed finding in ${rest[0]}: ${err.message}\n`);
      return 2;
    }
    deps.stdout(JSON.stringify({ chunks: chunks.map((c, i) => ({ chunk: i + 1, tier: c.tier, indexes: c.indexes })) }) + '\n');
    return 0;
  }
  if (command === 'write-findings') {
    if (rest.length !== 2) {
      deps.stderr('review-coordination.js: write-findings takes <run-dir> <findings.json>\n' + USAGE);
      return 2;
    }
    const input = readJson(rest[1], deps);
    if (input.failed) return 2;
    let artifact;
    try {
      artifact = buildFindingsArtifact(input.value);
    } catch (err) {
      deps.stderr(`review-coordination.js: invalid findings in ${rest[1]}: ${err.message}\n`);
      return 2;
    }
    const anchored = anchorRunDir(rest[0], deps, 3);
    if (anchored.exitCode !== undefined) return anchored.exitCode;
    try {
      const result = writeArtifact({ runDir: anchored.dir, name: FINDINGS_ARTIFACT, content: JSON.stringify(artifact, null, 2) + '\n' });
      deps.stdout(JSON.stringify({ path: result.file, count: artifact.length }) + '\n');
    } catch (err) {
      deps.stderr(`review-coordination.js: could not write ${FINDINGS_ARTIFACT} (${err && err.message})\n`);
      return 3;
    }
    return 0;
  }
  if (command === 'check-coverage') {
    if (rest.length !== 1) {
      deps.stderr('review-coordination.js: check-coverage takes exactly 1 run-dir\n' + USAGE);
      return 2;
    }
    const anchored = anchorRunDir(rest[0], deps, 2);
    if (anchored.exitCode !== undefined) return anchored.exitCode;
    // listSpecDirs comes from the archive module so tiebreak.js never requires
    // it; loaded here so the other verbs never pay for that module.
    const { listSpecDirs } = require('./lib/reconcile/archive-merged');
    deps.stdout(JSON.stringify(checkRunTiebreakCoverage(anchored.dir, listSpecDirs(anchored.dir))) + '\n');
    return 0;
  }
  deps.stderr(`review-coordination.js: unknown command: ${command === undefined ? '(none)' : command}\n` + USAGE);
  return 2;
}

module.exports = { run, realDeps, JUDGMENT_FIELDS };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
