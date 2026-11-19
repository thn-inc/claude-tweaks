#!/usr/bin/env node
'use strict';
// tools/driver-merge-check-eval.js — the merge-check verdict fixtures and evaluation harness (#5228, AC9).
//
//   node tools/driver-merge-check-eval.js extract --runs <pipelines-dir> --out <file> [--worktree <dir>]
//   node tools/driver-merge-check-eval.js evaluate --fixtures <file> [--repeat N] [--concurrency N] [--limit N]
//                                                  [--minutes N] [--dollars N] [--out <results.json>] [--dry-run] [--worktree <dir>]
//
// extract (run once by the maintainer): walks <pipelines-dir>/**/decisions.md (live runs and archive/), takes
// each record's latest `Auto-merge gate` / `Auto-merge short-circuit` verdict through merge-verdict.js's
// confirmPassingVerdicts, resolves the record's merge commit from its merged closing PR, reads the record's
// title and body as of extraction, runs plugin/bin/blast-radius.js in a detached scratch checkout at the merge
// commit, and classifies the run's `## /review` section into the findings the review reported. A record that
// cannot be put in a fixture is excluded with a reason, never guessed at. The fixture file carries no
// rationale text and no local filesystem path.
//
// evaluate: replays each fixture through the production merge-check path — the code floors first (judgments.js's
// blastFloor, then diffFloor once the merged diff is read), else `merge-check` workers (judgments.js's launchAndValidate: the production launch and verdict check) --repeat times in a detached scratch checkout at the merge commit — and
// prints { total, autoMergeFixtures, needsHumanFixtures, floorDecided, excluded, excludedByReason, ac9, agreement,
// falseAutoMerge, notJudged, byReviewFindings, ... }. A launch that failed, or returned no valid verdict, is never a
// judged run: it counts toward launchFailures and the record's notJudged status, not toward agreement. --dry-run
// replaces the worker with one that always returns needs-human (no model call).
//
// The check state (`checks`, with its `closingPr`) is read at extraction with production's own call
// (`gh pr checks {pr} --json name,bucket`, falling back to the string `checks: unreadable`), so it is the state as of
// extractedAt, like the record bodies; evaluate passes it to the prompt as production does.
//
// Exit codes: 0 ok; 1 a runtime failure, or (evaluate) a false auto-merge — a needs-human fixture the worker
// merged on any judged repeat; 2 malformed invocation; 3 (evaluate, not --dry-run) no false auto-merge, but a launch
// failed or a fixture could not be replayed, so the run is not a clean result.
//
// Seam: run({ argv, deps }) returns the exit code. deps: gh(args) -> stdout (throws), git(args, {cwd}) -> stdout
// (throws), node(script, args, {cwd, timeout}) -> { code, stdout, stderr }, launchWorker(opts) -> envelope, fs,
// tmpdir, worktree, log(line), err(line).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const DRIVER = path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'driver');
const { confirmPassingVerdicts } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'dispatch', 'merge-verdict.js'));
const { loadMergeCheckRules, buildMergeCheckPrompt } = require(path.join(DRIVER, 'judgment-prompts.js'));
const { blastFloor, diffFloor, launchAndValidate } = require(path.join(DRIVER, 'judgments.js'));
const { WIN32_CLAUDE_BIN, MODEL_POLICY_KEYS } = require(path.join(DRIVER, 'launch.js'));
const { resolvePolicyKeys } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'policy-schema.js'));

const BLAST_RADIUS = path.join(__dirname, '..', 'plugin', 'bin', 'blast-radius.js');
const USAGE = [
  'usage: node tools/driver-merge-check-eval.js extract --runs <pipelines-dir> --out <file> [--worktree <dir>]',
  '       node tools/driver-merge-check-eval.js evaluate --fixtures <file> [--repeat N] [--concurrency N] [--limit N]',
  '                                                      [--minutes N] [--dollars N] [--out <results.json>] [--dry-run] [--worktree <dir>]',
].join('\n');
const DIVERGENCE = 'record bodies and check state as of extractedAt; later edits are a named divergence';
const COMPARABLE = ['auto-merge', 'needs-human'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const FINDING_TEXT_MAX = 200;
const SHA_RE = /^[0-9a-f]{40}$/;
const CHECKS_UNREADABLE = 'checks: unreadable';
const AC9_ENTRIES_FLOOR = 30;
const AC9_NON_AUTO_MERGE_FLOOR = 10;

// ---------------------------------------------------------------------------------------------------------
// The review-summary classifier.

// A local filesystem path in text that will land in the public fixture file.
function scrubLocalPaths(text) {
  return String(text).replace(/(?<![\w.-])\/(?:Users|home|private\/var|var\/folders|tmp)\/\S*/g, '<local-path>');
}

// The run-level degraded-review markers: the no-Agent SKIP line and a review entry rendering `Independence: degraded`.
function hasDegradedMarker(text) {
  return /condition:\s*no Agent tool in this host/i.test(text) || /Independence:\s*degraded/i.test(text);
}

// Statements that qualify a severity band instead of stating "nothing at all", and bare severity counts.
const QUALIFIED_NONE = /\bno\s+findings?\s+(?:at|above|below|of)\s+(?:critical|high|medium|low)\b/i;
const SEVERITY_BAND = /\b(?:critical|high|medium|low)\s*(?:\+|(?:or|and)\s+(?:above|higher|lower|below|more|less)\b)/i;
const BARE_COUNT = /\b\d+\s+(?:critical|high|medium|low)\b(?!-|\s+(?:severity\s+)?(?:findings?|issues?)\b)/i;
const NO_FINDINGS = /\bno\s+findings?\b/i;
const NEGATION = /\b(?:no|none|zero|0)\b/i;

// A line as the finding's text: the bullet and the `AUTO hh:mm:ss —` prefix are not part of it.
function findingText(line) {
  const stripped = line.trim().replace(/^[-*]\s+(?:[A-Z]+\s+\d{2}:\d{2}:\d{2}\s+[—–-]\s+)?/, '');
  return scrubLocalPaths(stripped).slice(0, FINDING_TEXT_MAX);
}

// A line cut into clauses at sentence punctuation followed by a space (so `a.js:9` and `10:00:00` stay whole).
function clausesOf(line) {
  return line.split(/(?:[.;:!?]+(?:\s+|$))|\s[—–]\s/).filter((c) => c.trim() !== '');
}

// The severity words in a clause prefix (the part before the finding noun), as { severity } in reading order.
// Capitalized words anywhere; a lowercase one only directly before the noun. A `-` right after the word is
// prose (`High-level`).
function severitiesBefore(prefix) {
  const found = [];
  const re = /\b(Critical|High|Medium|Low)\b(?!-)/g;
  let m;
  while ((m = re.exec(prefix)) !== null) found.push({ index: m.index, severity: m[1] });
  const adjacent = /\b(critical|high|medium|low)\s+(?:severity\s+)?$/i.exec(prefix);
  if (adjacent && !found.some((f) => f.index === adjacent.index)) {
    found.push({ index: adjacent.index, severity: adjacent[1][0].toUpperCase() + adjacent[1].slice(1).toLowerCase() });
  }
  return found;
}

// sectionText -> { findings: [{ severity, text }] } | { exclude: reason }.
//   - no text: no-review-summary; a degraded marker: degraded-review
//   - a severity word followed in its clause by a finding noun, with no negation before the noun, is a finding
//   - no findings at all, stated as `No findings`, is []
//   - a qualified or counted statement, a clause naming two severities, or a section stating neither: review-summary-ambiguous
function classifyReviewSection(sectionText) {
  if (typeof sectionText !== 'string' || sectionText.trim() === '') return { exclude: 'no-review-summary' };
  if (hasDegradedMarker(sectionText)) return { exclude: 'degraded-review' };
  if (QUALIFIED_NONE.test(sectionText) || SEVERITY_BAND.test(sectionText) || BARE_COUNT.test(sectionText)) {
    return { exclude: 'review-summary-ambiguous' };
  }
  const findings = [];
  for (const line of sectionText.split(/\r?\n/)) {
    for (const clause of clausesOf(line)) {
      const noun = /\b(?:findings?|issues?)\b/i.exec(clause);
      if (!noun) continue;
      const prefix = clause.slice(0, noun.index);
      const severities = severitiesBefore(prefix);
      if (severities.length === 0 || NEGATION.test(prefix)) continue;
      if (severities.length > 1) return { exclude: 'review-summary-ambiguous' };
      findings.push({ severity: severities[0].severity, text: findingText(line) });
    }
  }
  if (findings.length > 0) return { findings };
  if (NO_FINDINGS.test(sectionText)) return { findings: [] };
  return { exclude: 'review-summary-ambiguous' };
}

// Every `## /review` section of a decisions.md, joined (a heading's text up to the next `## ` heading).
function reviewSectionText(content) {
  const out = [];
  let inside = false;
  for (const line of String(content).split(/\r?\n/)) {
    if (/^##\s+\/review\b/.test(line)) {
      inside = true;
      continue;
    }
    if (/^##\s/.test(line)) inside = false;
    if (inside) out.push(line);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// Deps.

function defaultDeps(worktree) {
  const cwd = worktree || process.cwd();
  return {
    fs,
    tmpdir: os.tmpdir(),
    worktree: cwd,
    active: new Set(),
    gh: (args) => String(execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 256 * 1024 * 1024, windowsHide: true })),
    git: (args, opts = {}) => String(execFileSync('git', args, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 256 * 1024 * 1024, windowsHide: true })),
    node: (script, args, opts = {}) => {
      const r = spawnSync(process.execPath, [script, ...args], { cwd: opts.cwd, encoding: 'utf8', timeout: opts.timeout || 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
    },
    launchWorker: (opts) => {
      const { launchWorker, defaultRunner } = require(path.join(DRIVER, 'worker.js'));
      return launchWorker({ ...opts, ...(process.platform === 'win32' ? { bin: WIN32_CLAUDE_BIN } : {}) }, { runner: (call) => defaultRunner(call) });
    },
    platform: process.platform,
    env: process.env,
    log: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    now: () => new Date(),
  };
}

const errText = (e) => String((e && e.message) || e).split('\n')[0];

// ---------------------------------------------------------------------------------------------------------
// Scratch checkouts: a detached worktree under the OS temp dir, removed on every path.

async function withScratch(deps, sha, fn) {
  if (!SHA_RE.test(sha)) throw new Error(`not a commit sha: ${String(sha).slice(0, 60)}`);
  const dir = deps.fs.mkdtempSync(path.join(deps.tmpdir, 'mc-eval-'));
  deps.active = deps.active || new Set();
  deps.active.add(dir);
  try {
    deps.git(['-C', deps.worktree, 'worktree', 'add', '--detach', dir, sha]);
    return await fn(dir);
  } finally {
    removeScratch(deps, dir);
  }
}

function removeScratch(deps, dir) {
  try {
    deps.git(['-C', deps.worktree, 'worktree', 'remove', '--force', dir]);
  } catch (e) {
    // Not registered (the add failed) or the remove failed: say so, and clear the directory this call made.
    try {
      deps.fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      deps.err(`could not remove the scratch checkout ${dir}: ${errText(e)}`);
    }
  }
  if (deps.active) deps.active.delete(dir);
}

// ---------------------------------------------------------------------------------------------------------
// extract.

function listDecisionFiles(dir, fsImpl, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try {
    entries = fsImpl.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listDecisionFiles(p, fsImpl, out, depth + 1);
    else if (e.isFile() && e.name === 'decisions.md') out.push(p);
  }
  return out;
}

// The latest comparable verdict per record in one decisions.md: { record, verdict } | { record, exclude }.
function verdictsOf(content) {
  const records = [...new Set([...String(content).matchAll(/#(\d+) assess-agent-autonomy verdict/g)].map((m) => Number(m[1])))];
  if (records.length === 0) return [];
  const confirmed = confirmPassingVerdicts(content, records);
  return records.map((record) => {
    const latest = confirmed[record].latest;
    return COMPARABLE.includes(latest) ? { record, verdict: latest } : { record, exclude: 'no-merge-gate-verdict' };
  });
}

// The record's merged closing PR: { title, body, mergeSha } | { exclude }.
function readRecord(deps, record) {
  let issue;
  try {
    issue = JSON.parse(deps.gh(['issue', 'view', String(record), '--json', 'title,body,closedByPullRequestsReferences']));
  } catch {
    return { exclude: 'record-unreadable' };
  }
  const refs = Array.isArray(issue.closedByPullRequestsReferences) ? issue.closedByPullRequestsReferences : [];
  let best = null;
  for (const ref of refs) {
    if (!ref || !Number.isInteger(ref.number)) continue;
    try {
      const pr = JSON.parse(deps.gh(['pr', 'view', String(ref.number), '--json', 'state,mergeCommit,mergedAt']));
      const sha = pr && pr.mergeCommit && pr.mergeCommit.oid;
      if (pr.state === 'MERGED' && SHA_RE.test(String(sha)) && (!best || String(pr.mergedAt) > best.mergedAt)) {
        best = { sha, pr: ref.number, mergedAt: String(pr.mergedAt) };
      }
    } catch {
      // a closing reference that cannot be read is not a merge commit
    }
  }
  if (!best) return { exclude: 'no-merge-commit' };
  return { title: scrubLocalPaths(issue.title || ''), body: scrubLocalPaths(issue.body || ''), mergeSha: best.sha, closingPr: best.pr };
}

// The PR's check state, read the way production's merge-check reads it (judgments.js gatherInputs): the parsed
// `gh pr checks {pr} --json name,bucket`, or the string `checks: unreadable`.
function readChecks(deps, pr) {
  try {
    return JSON.parse(deps.gh(['pr', 'checks', String(pr), '--json', 'name,bucket']));
  } catch {
    return CHECKS_UNREADABLE;
  }
}

// blast-radius.js at the merge commit in a scratch checkout: the parsed { mergeBase, config, summary } or { exclude }.
async function blastRadiusAt(deps, sha) {
  try {
    deps.git(['-C', deps.worktree, 'cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    return { exclude: 'merge-commit-not-local' };
  }
  try {
    return await withScratch(deps, sha, (dir) => {
      const r = deps.node(BLAST_RADIUS, ['--base', `${sha}^1`], { cwd: dir, timeout: 120000 });
      if (!r || r.code !== 0) return { exclude: 'blast-radius-failed' };
      try {
        const parsed = JSON.parse(r.stdout);
        return parsed && typeof parsed === 'object' && parsed.summary ? { blastRadius: parsed } : { exclude: 'blast-radius-failed' };
      } catch {
        return { exclude: 'blast-radius-failed' };
      }
    });
  } catch (e) {
    deps.err(`scratch checkout at ${sha.slice(0, 12)} failed: ${errText(e)}`);
    return { exclude: 'blast-radius-failed' };
  }
}

// The text to scan for leaks: the OS temp dir (as given and resolved) and a /Users path.
function leakedPaths(json, deps) {
  const needles = new Set(['/Users/']);
  for (const t of [deps.tmpdir, safeRealpath(deps)]) if (t && t.length > 1) needles.add(t);
  return [...needles].filter((n) => json.includes(n));
}

function safeRealpath(deps) {
  try {
    return deps.fs.realpathSync(deps.tmpdir);
  } catch {
    return null;
  }
}

async function extract(opts, deps) {
  const files = listDecisionFiles(opts.runs, deps.fs).sort((a, b) => path.relative(opts.runs, a).replace(/^archive[\\/]/, '').localeCompare(path.relative(opts.runs, b).replace(/^archive[\\/]/, '')));
  if (files.length === 0) {
    deps.err(`no decisions.md found under ${opts.runs}`);
    return 1;
  }
  // The latest run wins when a record appears in several (the run directory names lead with a timestamp).
  const byRecord = new Map();
  let superseded = 0;
  for (const file of files) {
    let content;
    try {
      content = deps.fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const v of verdictsOf(content)) {
      // A later run with no merge-gate verdict never replaces an earlier real one; among merge-gate verdicts the latest wins.
      if (v.exclude && byRecord.has(v.record)) continue;
      if (byRecord.has(v.record)) superseded += 1;
      byRecord.set(v.record, { ...v, content });
    }
  }
  const excluded = [];
  const entries = [];
  const blastCache = new Map();
  const order = [...byRecord.keys()].sort((a, b) => a - b);
  let n = 0;
  for (const record of order) {
    n += 1;
    const cand = byRecord.get(record);
    const skip = (reason) => excluded.push({ record, reason });
    deps.err(`[${n}/${order.length}] #${record}`);
    if (cand.exclude) {
      skip(cand.exclude);
      continue;
    }
    const review = hasDegradedMarker(cand.content) ? { exclude: 'degraded-review' } : classifyReviewSection(reviewSectionText(cand.content));
    if (review.exclude) {
      skip(review.exclude);
      continue;
    }
    const rec = readRecord(deps, record);
    if (rec.exclude) {
      skip(rec.exclude);
      continue;
    }
    if (!blastCache.has(rec.mergeSha)) blastCache.set(rec.mergeSha, await blastRadiusAt(deps, rec.mergeSha));
    const blast = blastCache.get(rec.mergeSha);
    if (blast.exclude) {
      skip(blast.exclude);
      continue;
    }
    entries.push({
      record, verdict: cand.verdict, mergeSha: rec.mergeSha, closingPr: rec.closingPr, title: rec.title, body: rec.body,
      checks: readChecks(deps, rec.closingPr), blastRadius: blast.blastRadius, reviewFindings: review.findings,
    });
  }
  const out = {
    extractedAt: deps.now().toISOString(),
    divergence: DIVERGENCE,
    policy: {
      source: 'resolved per entry by blast-radius.js at its mergeSha; see each blastRadius.config',
      keys: ['merge-sensitive-paths', 'auto-merge-max-lines', 'auto-merge-max-files'],
    },
    excluded,
    entries,
  };
  const json = `${JSON.stringify(out, null, 2)}\n`;
  const leaks = leakedPaths(json, deps);
  if (leaks.length > 0) {
    deps.err(`refusing to write ${opts.out}: the fixture text contains ${leaks.join(', ')}`);
    return 1;
  }
  deps.fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  deps.fs.writeFileSync(opts.out, json);
  const tally = {};
  for (const e of excluded) tally[e.reason] = (tally[e.reason] || 0) + 1;
  deps.log(JSON.stringify({
    entries: entries.length,
    autoMerge: entries.filter((e) => e.verdict === 'auto-merge').length,
    needsHuman: entries.filter((e) => e.verdict === 'needs-human').length,
    excluded: excluded.length, excludedByReason: tally, supersededRuns: superseded, out: opts.out,
  }, null, 2));
  return 0;
}

// ---------------------------------------------------------------------------------------------------------
// evaluate.

function bump(bucket, expected, runs, agree) {
  bucket.fixtures += 1;
  bucket.runs += runs;
  bucket.agree += agree;
  bucket.byExpected[expected].runs += runs;
  bucket.byExpected[expected].agree += agree;
}

const newBucket = () => ({ fixtures: 0, runs: 0, agree: 0, byExpected: { 'auto-merge': { runs: 0, agree: 0 }, 'needs-human': { runs: 0, agree: 0 } } });

// The hand-built policy a replayed launch reads: this run's two ceilings plus the driver's model keys at their
// defaults (a real resolver reply), without which launchTracked refuses every launch for want of a model (#5917).
const launchPolicy = (opts) => ({
  'express-driver-wall-clock-minutes': { value: opts.minutes },
  'express-driver-spend-ceiling-dollars': { value: opts.dollars },
  ...resolvePolicyKeys(MODEL_POLICY_KEYS, { policyRaw: '' }),
});

// One fixture's launches: { verdicts, failures }. Only a launch that returned a valid verdict is a judged run; a failed
// launch or an invalid envelope adds to `failures` and to no verdict, so it can never read as agreement.
async function judgeFixture(fx, floor, opts, deps, rules) {
  const policy = { 'auto-merge-max-lines': floor.limits.lines, 'auto-merge-max-files': floor.limits.files };
  return withScratch(deps, fx.mergeSha, async (dir) => {
    const diff = deps.git(['-C', dir, '--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--end-of-options', `${fx.mergeSha}^1`, fx.mergeSha, '--']);
    // The same diff floor production applies after reading the diff, before any launch.
    const cut = diffFloor(diff);
    if (cut) return { floorDecided: true, floor: cut.floor, verdicts: [], failures: 0 };
    const prompt = buildMergeCheckPrompt({
      record: fx.record, title: fx.title, body: fx.body, diff, summary: floor.summary, policy,
      checks: fx.checks === undefined ? CHECKS_UNREADABLE : fx.checks, reviewFindings: fx.reviewFindings, rules,
    });
    const settingsDir = deps.fs.mkdtempSync(path.join(deps.tmpdir, 'mc-eval-settings-'));
    // Production's own launch and verdict validation (judgments.js launchAndValidate), on a scratch run dir and the
    // scratch checkout as the worktree; the policy carries this run's ceilings.
    const env = {
      deps: { ...deps, mkdirSync: (p, o) => deps.fs.mkdirSync(p, o), runner: deps.runner || ((call) => require(path.join(DRIVER, 'worker.js')).defaultRunner(call)) },
      shared: { policy: launchPolicy(opts), activeWorker: null },
    };
    const ctx = { runDir: settingsDir, worktree: dir };
    const verdicts = [];
    let failures = 0;
    try {
      for (let i = 0; i < opts.repeat; i += 1) {
        try {
          const judged = await launchAndValidate(env, ctx, prompt);
          if (judged.verdict) verdicts.push(judged.verdict);
          else failures += 1;
        } catch {
          failures += 1;
        }
      }
    } finally {
      try {
        deps.fs.rmSync(settingsDir, { recursive: true, force: true });
      } catch {
        // a temp settings dir that stays is only a temp dir
      }
    }
    return { verdicts, failures };
  });
}

async function evaluate(opts, deps) {
  let fixtures;
  try {
    fixtures = JSON.parse(deps.fs.readFileSync(opts.fixtures, 'utf8'));
  } catch (e) {
    deps.err(`cannot read the fixtures ${opts.fixtures}: ${errText(e)}`);
    return 1;
  }
  const all = Array.isArray(fixtures.entries) ? fixtures.entries : [];
  const comparable = all.filter((e) => e && COMPARABLE.includes(e.verdict));
  const picked = opts.limit > 0 ? comparable.slice(0, opts.limit) : comparable;
  const rules = loadMergeCheckRules((p) => deps.fs.readFileSync(p, 'utf8'));
  if (!rules.ok) {
    deps.err(`the merge-check rules did not load: ${rules.missing}`);
    return 1;
  }
  const launcher = opts.dryRun
    ? async () => ({ status: 'ok', reason: null, result: { verdict: 'needs-human', rationale: 'dry-run' } })
    : deps.launchWorker;
  const runDeps = { ...deps, launchWorker: launcher };

  const results = new Array(picked.length);
  let next = 0;
  async function lane() {
    while (next < picked.length) {
      const idx = next;
      next += 1;
      const fx = picked[idx];
      const floor = blastFloor(fx.blastRadius);
      if (floor.floor) {
        results[idx] = { record: fx.record, expected: fx.verdict, floorDecided: true, floor: floor.floor, verdicts: [], failures: 0, findings: fx.reviewFindings.length };
        continue;
      }
      try {
        const judged = await judgeFixture(fx, floor, opts, runDeps, rules.text);
        results[idx] = { record: fx.record, expected: fx.verdict, floorDecided: false, floor: null, ...judged, findings: fx.reviewFindings.length };
      } catch (e) {
        // A fixture that could not be replayed is reported, never counted as agreement or as a pass.
        results[idx] = { record: fx.record, expected: fx.verdict, floorDecided: false, floor: null, verdicts: [], failures: 0, error: errText(e), findings: fx.reviewFindings.length };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, picked.length || 1)) }, lane));

  const agreement = newBucket();
  const byReviewFindings = { empty: newBucket(), nonEmpty: newBucket() };
  const falseAutoMerge = [];
  let floorDecided = 0;
  let launchFailures = 0;
  let replayErrors = 0;
  const notJudged = [];
  const failuresByRecord = {};
  for (const r of results) {
    if (r.floorDecided) {
      floorDecided += 1;
      continue;
    }
    launchFailures += r.failures;
    if (r.failures > 0) failuresByRecord[r.record] = r.failures;
    if (r.error) replayErrors += 1;
    if (r.verdicts.length === 0) {
      notJudged.push(r.record);
      continue;
    }
    const agree = r.verdicts.filter((v) => v === r.expected).length;
    bump(agreement, r.expected, r.verdicts.length, agree);
    bump(r.findings === 0 ? byReviewFindings.empty : byReviewFindings.nonEmpty, r.expected, r.verdicts.length, agree);
    if (r.expected === 'needs-human' && r.verdicts.includes('auto-merge')) falseAutoMerge.push(r.record);
  }
  const excludedList = Array.isArray(fixtures.excluded) ? fixtures.excluded : [];
  const excludedByReason = {};
  for (const e of excludedList) excludedByReason[e.reason] = (excludedByReason[e.reason] || 0) + 1;
  const nonAutoMerge = all.filter((e) => e && e.verdict !== 'auto-merge').length;
  const rate = (b) => ({ ...b, rate: b.runs > 0 ? b.agree / b.runs : null });
  const summary = {
    total: picked.length,
    autoMergeFixtures: picked.filter((e) => e.verdict === 'auto-merge').length,
    needsHumanFixtures: picked.filter((e) => e.verdict === 'needs-human').length,
    floorDecided,
    skippedEntries: all.length - comparable.length,
    excluded: excludedList.length,
    excludedByReason,
    ac9: {
      entries: all.length, entriesFloor: AC9_ENTRIES_FLOOR, nonAutoMerge, nonAutoMergeFloor: AC9_NON_AUTO_MERGE_FLOOR,
      met: all.length >= AC9_ENTRIES_FLOOR && nonAutoMerge >= AC9_NON_AUTO_MERGE_FLOOR,
    },
    agreement: rate(agreement),
    falseAutoMerge,
    notJudged,
    byReviewFindings: { empty: rate(byReviewFindings.empty), nonEmpty: rate(byReviewFindings.nonEmpty) },
    launchFailures,
    launchFailuresByRecord: failuresByRecord,
    replayErrors,
    repeat: opts.repeat,
    dryRun: opts.dryRun,
  };
  deps.log(JSON.stringify(summary, null, 2));
  if (opts.out) {
    deps.fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    deps.fs.writeFileSync(opts.out, `${JSON.stringify({ ...summary, results }, null, 2)}\n`);
  }
  if (falseAutoMerge.length > 0) return 1;
  // A run with a failed launch or an unreplayable fixture judged less than it was asked to: not a clean result.
  if (!opts.dryRun && (launchFailures > 0 || replayErrors > 0)) {
    deps.err(`evaluate: ${launchFailures} launch failure(s), ${replayErrors} replay error(s); not a clean result (exit 3)`);
    return 3;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------
// CLI.

const VALUE_FLAGS = new Set(['--runs', '--out', '--fixtures', '--repeat', '--concurrency', '--limit', '--minutes', '--dollars', '--worktree']);
const INT_FLAGS = { '--repeat': 'repeat', '--concurrency': 'concurrency', '--limit': 'limit' };
const NUM_FLAGS = { '--minutes': 'minutes', '--dollars': 'dollars' };

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'extract' && command !== 'evaluate') return { error: command ? `unknown command: ${command}` : 'a command is required' };
  const opts = { command, repeat: 3, concurrency: 2, limit: 0, minutes: 10, dollars: 2, dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--dry-run') {
      if (command !== 'evaluate') return { error: '--dry-run applies to evaluate' };
      opts.dryRun = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} requires a value` };
      i += 1;
      if (INT_FLAGS[arg]) {
        if (!/^\d+$/.test(value) || (arg !== '--limit' && Number(value) < 1)) return { error: `${arg} must be a ${arg === '--limit' ? 'non-negative' : 'positive'} integer` };
        opts[INT_FLAGS[arg]] = Number(value);
      } else if (NUM_FLAGS[arg]) {
        if (!Number.isFinite(Number(value)) || Number(value) <= 0) return { error: `${arg} must be a positive number` };
        opts[NUM_FLAGS[arg]] = Number(value);
      } else {
        opts[arg.slice(2)] = value;
      }
    } else {
      return { error: `unknown argument: ${arg}` };
    }
  }
  if (command === 'extract' && (!opts.runs || !opts.out)) return { error: 'extract requires --runs and --out' };
  if (command === 'evaluate' && !opts.fixtures) return { error: 'evaluate requires --fixtures' };
  return { opts };
}

async function run({ argv, deps } = {}) {
  const parsed = parseArgs(argv || []);
  if (parsed.error) {
    (deps || defaultDeps()).err(`driver-merge-check-eval.js: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { opts } = parsed;
  const d = deps || defaultDeps(opts.worktree ? path.resolve(opts.worktree) : undefined);
  try {
    return opts.command === 'extract' ? await extract(opts, d) : await evaluate(opts, d);
  } catch (e) {
    d.err(`driver-merge-check-eval.js: ${errText(e)}`);
    return 1;
  }
}

module.exports = { run, classifyReviewSection, scrubLocalPaths, reviewSectionText, hasDegradedMarker, verdictsOf, parseArgs, launchPolicy };

if (require.main === module) {
  const deps = (() => {
    const i = process.argv.indexOf('--worktree');
    return defaultDeps(i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : undefined);
  })();
  // An interrupt removes the scratch checkouts still registered before the process ends.
  const onSignal = (sig) => {
    for (const dir of [...(deps.active || [])]) removeScratch(deps, dir);
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  run({ argv: process.argv.slice(2), deps }).then((code) => { process.exitCode = code; });
}
