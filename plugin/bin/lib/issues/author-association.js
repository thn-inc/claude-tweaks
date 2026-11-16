// bin/lib/issues/author-association.js
// Fills in each issue author's `authorAssociation` on a record snapshot (#4577).
// provenance.js's issueAuthorTrust lets an `Origin:` body line claim a
// side-effect class only for a trusted author, but the snapshot fetch cannot
// carry the fact it needs: `gh issue list --json` has no `authorAssociation`
// field (probed: `Unknown JSON field: "authorAssociation"`). So this module
// reads it afterwards, through aliased GraphQL batches of up to 200 issues.
//
// Only records with an `Origin:` line and no attestation yet are queried: the
// association decides nothing for any other record, a bot author is already
// trusted from `author.is_bot`, and a record that already carries an
// association needs no second read.
//
// Fail open: a failed batch, an issue the answer carries no association for,
// an unresolvable repo or an unreadable file leaves the affected records
// without an association, which issueAuthorTrust reads as 'unknown', the
// pre-#4577 behaviour. Every such gap is counted in `failedBatches` (with the
// first failure's cause in `firstCause`), counted in `unresolved`, or named in
// `skipped`, and warningLine reports it on one stderr line, so a degraded run
// is visible rather than silent.
//
// The runner is injectable (never the real `gh` in tests): runner(args) is
// invoked as if `gh ${args.join(' ')}` and returns stdout; a throw is a failed
// call (gh-api-module-pattern).
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { ghOptions } = require('../repo-resolve');
const sharedPrimitives = require('../shared-primitives');
const { hasOriginLine, issueAuthorTrust } = require('./provenance');
const { writeSnapshot } = require('./record-snapshot');
const { buildAuthorAssociationQuery } = require('./record-dependencies');

const DEFAULT_BATCH_SIZE = 200;

// An aliased GraphQL batch takes the batched bound; `repo view` is a single call.
// Exported so a caller that wraps its own runner (backlog-grant-gate's
// fetchAllRecords) applies the same bound rather than restating the rule.
function ghTimeoutFor(args) {
  return args[0] === 'api' && args[1] === 'graphql' ? sharedPrimitives.GH_BATCH_TIMEOUT_MS : sharedPrimitives.GH_TIMEOUT_MS;
}

function defaultRunner(args) {
  return execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: ghTimeoutFor(args), windowsHide: true }));
}

function needsAssociation(record) {
  if (!record || typeof record !== 'object') return false;
  return hasOriginLine(record.body) && issueAuthorTrust(record) === 'unknown';
}

function integerNumbers(numbers) {
  const list = Array.isArray(numbers) ? numbers : [];
  // Safe integers only: an unsafe one (1e21) prints as `1e+21`, which is not a
  // valid alias or argument and would fail the whole batch.
  return [...new Set(list.filter((n) => Number.isSafeInteger(n) && n > 0))];
}

function buildAssociationQuery(numbers) {
  return buildAuthorAssociationQuery(integerNumbers(numbers)) || '';
}

// The cause of a thrown call: stderr, else the message, on one bounded line.
// Never stdout (response data) and never the argv a Node message repeats
// beyond what the message itself holds (gh-api-module-pattern).
function causeOf(err) {
  const raw = err && typeof err.stderr === 'string' && err.stderr.trim() !== '' ? err.stderr : (err && err.message) || String(err);
  return String(raw).trim().replace(/\s+/g, ' ').slice(0, 300);
}

// A partial NOT_FOUND (a PR number, a transferred issue) makes gh exit 1 while
// still printing `{data, errors}` on stdout, so a thrown call is parsed from
// `err.stdout` before it counts as failed. Returns `{repository, cause}`:
// the repository object, or null with the reason the answer carries none.
function repositoryOf(runner, args) {
  let stdout;
  let cause = null;
  try {
    stdout = runner(args);
  } catch (err) {
    cause = causeOf(err);
    stdout = err && typeof err.stdout === 'string' && err.stdout !== '' ? err.stdout : null;
  }
  if (stdout === null) return { repository: null, cause };
  try {
    const parsed = JSON.parse(stdout);
    const repository = parsed && parsed.data && parsed.data.repository;
    return repository && typeof repository === 'object'
      ? { repository, cause: null }
      : { repository: null, cause: cause || 'no data.repository in the answer' };
  } catch {
    return { repository: null, cause: cause || 'unparseable answer' };
  }
}

function fetchAuthorAssociations({ numbers, owner, repo, runner = defaultRunner, batchSize = DEFAULT_BATCH_SIZE } = {}) {
  const ns = integerNumbers(numbers);
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE;
  const byNumber = new Map();
  let failedBatches = 0;
  let unresolved = 0;
  let firstCause = null;
  for (let i = 0; i < ns.length; i += size) {
    const chunk = ns.slice(i, i + size);
    const args = ['api', 'graphql', '-f', `query=${buildAssociationQuery(chunk)}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`];
    const { repository, cause } = repositoryOf(runner, args);
    if (!repository) {
      failedBatches += 1;
      if (firstCause === null) firstCause = cause;
      continue;
    }
    for (const n of chunk) {
      const issue = repository[`i${n}`];
      const value = issue && issue.authorAssociation;
      if (typeof value === 'string' && value !== '') byNumber.set(n, value);
      else unresolved += 1;
    }
  }
  return { byNumber, failedBatches, unresolved, firstCause };
}

function attachAuthorAssociations(records, byNumber) {
  return records.map((r) => (r && typeof r === 'object' && byNumber.has(r.number) ? { ...r, authorAssociation: byNumber.get(r.number) } : r));
}

function resolveRepo(runner) {
  try {
    const parsed = JSON.parse(runner(['repo', 'view', '--json', 'owner,name']));
    const owner = parsed && parsed.owner && parsed.owner.login;
    const repo = parsed && parsed.name;
    return typeof owner === 'string' && owner !== '' && typeof repo === 'string' && repo !== '' ? { owner, repo } : null;
  } catch {
    return null;
  }
}

function enrichRecords(records, { runner = defaultRunner, owner, repo } = {}) {
  if (!Array.isArray(records)) return { records, failedBatches: 0, skipped: 'not-array' };
  const numbers = records.filter(needsAssociation).map((r) => r.number);
  if (integerNumbers(numbers).length === 0) return { records, failedBatches: 0, skipped: null };
  const target = owner && repo ? { owner, repo } : resolveRepo(runner);
  if (!target) return { records, failedBatches: 0, skipped: 'repo-unresolved' };
  const { byNumber, failedBatches, unresolved, firstCause } = fetchAuthorAssociations({ numbers, owner: target.owner, repo: target.repo, runner });
  return { records: attachAuthorAssociations(records, byNumber), failedBatches, unresolved, firstCause, skipped: null };
}

// One stderr line for a degraded enrichment, or '' when nothing degraded, so a
// caller prints `warningLine(result)` when it is non-empty and never restates
// which fields count as a gap.
function warningLine({ failedBatches, unresolved, firstCause, skipped }) {
  const parts = [];
  if (failedBatches > 0) parts.push(`${failedBatches} batch(es) failed`);
  if (failedBatches > 0 && firstCause) parts.push(`first cause: ${firstCause}`);
  if (unresolved > 0) parts.push(`${unresolved} issue(s) with no association in the answer`);
  if (skipped) parts.push(`skipped: ${skipped}`);
  if (parts.length === 0) return '';
  return `author-association enrichment incomplete (${parts.join('; ')}) — records without an association keep the pre-#4577 Origin-line behaviour\n`;
}

// Reads a snapshot file, enriches it, and writes it back only when an
// association was attached. An unreadable, non-JSON or non-array file is left
// untouched and returned as `skipped` with `records: null`.
function enrichRecordsFile(file, deps = {}) {
  const stderr = typeof deps.stderr === 'function' ? deps.stderr : (s) => process.stderr.write(s);
  let result;
  let records;
  try {
    records = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    result = { records: null, failedBatches: 0, skipped: err instanceof SyntaxError ? 'not-json' : 'unreadable' };
  }
  if (!result && !Array.isArray(records)) result = { records: null, failedBatches: 0, skipped: 'not-array' };
  if (!result) {
    result = enrichRecords(records, deps);
    if (!result.skipped && result.records.some((r, i) => r !== records[i])) {
      try {
        writeSnapshot(file, result.records);
      } catch {
        result = { ...result, skipped: 'write-failed' };
      }
    }
  }
  const warning = warningLine(result);
  if (warning) stderr(warning);
  return result;
}

module.exports = {
  needsAssociation,
  buildAssociationQuery,
  fetchAuthorAssociations,
  attachAuthorAssociations,
  enrichRecords,
  enrichRecordsFile,
  defaultRunner,
  ghTimeoutFor,
  warningLine,
};
