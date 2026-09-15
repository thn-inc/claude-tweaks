// bin/lib/reconcile/escalate-residue.js — files (or dedup-finds) a backlog
// issue for one path stuck at `move-failed`/`removal-failed` past
// cache.js's RESIDUE_ESCALATE_THRESHOLD (#644 Deliverable 2). Same shape as
// bin/lib/feedback/file-feedback.js: an injectable runner so no test ever
// touches real `gh`, a fingerprint-marker dedup search before filing so a
// still-failing path across repeated escalating calls never files twice, and
// every failure degrades to a returned status rather than a thrown error —
// reconcile never breaks a session (index.js's header comment) and this is
// reachable from the same non-interactive, no-LLM contexts (session-start.js
// in-process, `bin/hooks.js reconcile` CLI) that have no gh-vs-MCP transport
// choice to make, unlike the LLM-orchestrated health-sweep skills'
// `_shared/github-write-transport.md` path — gh-absent here is a normal,
// best-effort miss, not a hard failure, and the next `/tidy` sweep or a
// human reading `reconcile`'s JSON is the backstop.
//
// Label posture (#1216, decided 2026-08-29): filing with `--label bug` only
// is a deliberate choice, not a gap — never add `by:*`/`type:*`/`risk:*`/
// `size:*`/`ready` here. Risk/size are content judgments, and this module
// runs in the no-LLM contexts named above, which cannot score them; a
// mechanical always-low default fails independently (`ready` requires a
// spec-shaped body, which reconcile's terse auto-report is not). Enrichment
// belongs to the downstream path that demonstrably picks these issues up: a
// plain open issue IS a backlog-stage record, the scheduled bare `/specify`
// drain (its deprecated `next` alias, historically) shapes it headlessly,
// and `/backlog` grants route it to an autonomous build. No `by:reconcile`
// origin value, no scoring heuristic — closed #1216 is the recorded
// decision.
'use strict';
const { fingerprintFromBasis, normalizeText } = require('../health-core/fingerprint');
// #644 review fix — defaultRunner/errorText were a byte-for-byte duplicate
// of bin/lib/feedback/file-feedback.js's own (this module's header comment
// already says "same shape"); import rather than restate, so a future fix
// to either only has to land once. The dedup-then-file FLOW below still
// diverges deliberately (no readBack/verify round trip, `--body` inline
// rather than `--body-file`) — that's a real behavioral difference, not
// duplication, and stays local to this module.
const { defaultRunner, errorText } = require('../feedback/file-feedback');
// #1892: file-feedback.js's own findDuplicate requests only
// `number,title,body,createdAt` (pinned by that module's own test, and
// adequate for its plain dedup-then-file need) — this module additionally
// needs to tell an OPEN hit from a CLOSED one (dedup-hit vs. reopen), so it
// keeps its own copy of the list-then-findByMarker idiom with `state` added,
// rather than widening the shared function's JSON fields for every other
// caller.
const { findByMarker } = require('../issues/dedup-lookup');

// #1811 Deliverable 4: `structurally-stuck` escalates as ONE shared record
// per sweep pass covering every stuck path, not one per directory — the
// symptom that produced seven near-identical records (#1811-#1817) for what
// was one underlying defect. Its fingerprint basis omits the path so every
// stuck dir's `trackResidue` call (cache.js's own per-path counter is
// unchanged — only the filing side consolidates) converges on the same
// marker; every other reason keeps the path in its basis, unchanged.
function residueFingerprint(reason, targetPath) {
  const basis = reason === 'structurally-stuck' ? [reason] : [reason, normalizeText(targetPath)];
  return fingerprintFromBasis('reconcile-residue', basis);
}

function structurallyStuckMarker() {
  return `<!-- fingerprint: ${residueFingerprint('structurally-stuck', '')} -->`;
}

// The consolidated record's body carries its own paths list between two
// sentinel HTML comments — parsed back out so a later escalate/resolve call
// can add/remove exactly one path without disturbing the rest, and edited
// in place (via `gh issue edit --body`) rather than only ever appended to as
// a comment, so "the body names all N paths" stays literally true for
// anyone reading the record, not just its comment thread.
const STUCK_PATHS_RE = /<!-- stuck-paths -->([\s\S]*?)<!-- \/stuck-paths -->/;

function parseStuckPaths(body) {
  const m = STUCK_PATHS_RE.exec(body || '');
  if (!m) return [];
  return m[1].split('\n')
    .map((line) => /^- `(.*)`$/.exec(line.trim()))
    .filter(Boolean)
    .map((mm) => mm[1]);
}

function renderStuckPathsBlock(paths) {
  return ['<!-- stuck-paths -->', ...paths.map((p) => `- \`${p}\``), '<!-- /stuck-paths -->'].join('\n');
}

function structurallyStuckBody(paths) {
  return [
    'Reconcile has one or more run directories stuck at `structurally-stuck` (no-worktree/no-branch/no-pr) past the escalation threshold.',
    '',
    renderStuckPathsBlock(paths),
    '',
    'Filed automatically by `bin/lib/reconcile` — see #644/#1811.',
    '',
    structurallyStuckMarker(),
  ].join('\n');
}

// { repo, marker, runner } -> matching issue { number, title, body,
// createdAt, state } or null. Same plain list-then-filter idiom as
// file-feedback.js's findDuplicate (never `gh issue list --search` — rides
// GitHub's eventually-consistent Search API, root cause of #1016/#1079/
// #1089) — `--state all` so a closed duplicate is still found (Deliverable 4:
// dedup must consider open AND closed records).
function findResidueDuplicate({ repo, marker, runner = defaultRunner }) {
  const out = runner(['issue', 'list', '--repo', repo, '--state', 'all', '--json', 'number,title,body,createdAt,state', '--limit', '10000']);
  const issues = JSON.parse(out);
  const result = findByMarker(Array.isArray(issues) ? issues : [], marker);
  return result ? result.canonical : null;
}

function residueBody({ reason, targetPath, count, firstFailedAt, lastError }) {
  const marker = `<!-- fingerprint: ${residueFingerprint(reason, targetPath)} -->`;
  const lines = [
    `Reconcile has failed \`${reason}\` on this path for ${count} consecutive passes` +
      (firstFailedAt ? ` (first observed ${new Date(firstFailedAt).toISOString()})` : '') + '.',
    '',
    `**Path:** \`${targetPath}\``,
    `**Reason:** \`${reason}\``,
    lastError ? `**Last error:** ${lastError}` : null,
    '',
    'Filed automatically by `bin/lib/reconcile` — see #644.',
    '',
    marker,
  ].filter((l) => l !== null);
  return { body: lines.join('\n'), marker };
}

// { repo, reason, targetPath, count, firstFailedAt, lastError, runner } ->
// { status: 'filed'|'dedup-hit'|'reopened', number } | { status: 'escalation-failed', reason }
// Never throws — every branch below is try/caught, mirroring every other
// best-effort write in this module family (logReapEvent in reap-merged.js,
// writeCache here).
//
// #1892 Deliverable 4: a marker match that is already CLOSED means this same
// path escalated before, got resolved, and is now failing again. Reopen the
// existing record instead of filing a fresh duplicate — a deliberate choice
// to keep one issue per path across its whole open/closed/reopened lifetime,
// not one per escalation streak. (`--state all` above mirrors the shared
// `findDuplicate`'s own already-`--state all` behavior, not a widening from
// an open-only search bug — see #2334.)
// #1811 Deliverable 4: the consolidated escalation path for
// `structurally-stuck` alone — every OTHER reason keeps escalateResidue's
// ordinary one-record-per-path behavior below unchanged. Dedups by the same
// (path-less) fingerprint marker: no hit files a new record naming just this
// one path; a hit already naming this path is a plain dedup-hit (or reopen,
// if closed); a hit that does NOT yet name this path gets it appended —
// edited into the body (so "the body names all N paths" stays literally
// true) and also left as a comment, satisfying both this file's own
// dedup-marker convention and the Technical Approach's "append... as a
// comment" phrasing.
// -> { status: 'filed'|'dedup-hit'|'appended'|'reopened', number } |
//    { status: 'escalation-failed', reason, number? }
function escalateStructurallyStuck({ repo, targetPath, runner = defaultRunner }) {
  if (!repo) return { status: 'escalation-failed', reason: 'no-repo-slug' };
  const marker = structurallyStuckMarker();

  let hit;
  try {
    hit = findResidueDuplicate({ repo, marker, runner });
  } catch (err) {
    return { status: 'escalation-failed', reason: errorText(err) };
  }

  if (!hit) {
    try {
      const out = runner([
        'issue', 'create', '--repo', repo,
        '--title', 'reconcile: structurally-stuck run directories',
        '--body', structurallyStuckBody([targetPath]),
        '--label', 'bug',
      ]);
      const m = /\/issues\/(\d+)/.exec(String(out));
      return { status: 'filed', number: m ? Number(m[1]) : null };
    } catch (err) {
      return { status: 'escalation-failed', reason: errorText(err) };
    }
  }

  const existingPaths = parseStuckPaths(hit.body);
  const alreadyNamed = existingPaths.includes(targetPath);
  const updatedPaths = alreadyNamed ? existingPaths : [...existingPaths, targetPath];

  if (hit.state !== 'CLOSED') {
    if (alreadyNamed) return { status: 'dedup-hit', number: hit.number };
    try {
      runner(['issue', 'edit', String(hit.number), '--repo', repo, '--body', structurallyStuckBody(updatedPaths)]);
      runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body', `Also stuck: \`${targetPath}\``]);
      return { status: 'appended', number: hit.number };
    } catch (err) {
      return { status: 'escalation-failed', reason: errorText(err), number: hit.number };
    }
  }

  try {
    runner(['issue', 'edit', String(hit.number), '--repo', repo, '--body', structurallyStuckBody(updatedPaths)]);
    runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body',
      `Reconcile is seeing \`${targetPath}\` stuck at structurally-stuck again — reopening rather than filing a duplicate.`]);
    runner(['issue', 'reopen', String(hit.number), '--repo', repo]);
    return { status: 'reopened', number: hit.number };
  } catch (err) {
    return { status: 'escalation-failed', reason: errorText(err), number: hit.number };
  }
}

function escalateResidue({
  repo, reason, targetPath, count, firstFailedAt, lastError, runner = defaultRunner,
}) {
  if (reason === 'structurally-stuck') return escalateStructurallyStuck({ repo, targetPath, runner });
  if (!repo) return { status: 'escalation-failed', reason: 'no-repo-slug' };
  const { body, marker } = residueBody({ reason, targetPath, count, firstFailedAt, lastError });
  const title = `reconcile: ${reason} stuck on ${targetPath}`;

  let hit;
  try {
    hit = findResidueDuplicate({ repo, marker, runner });
  } catch (err) {
    return { status: 'escalation-failed', reason: errorText(err) };
  }
  if (hit) {
    if (hit.state !== 'CLOSED') return { status: 'dedup-hit', number: hit.number };
    try {
      runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body',
        `Reconcile is seeing this path fail \`${reason}\` again (${count} consecutive passes since it was ` +
        'last resolved) — reopening rather than filing a duplicate.']);
      runner(['issue', 'reopen', String(hit.number), '--repo', repo]);
      return { status: 'reopened', number: hit.number };
    } catch (err) {
      return { status: 'escalation-failed', reason: errorText(err), number: hit.number };
    }
  }

  try {
    const out = runner(['issue', 'create', '--repo', repo, '--title', title, '--body', body, '--label', 'bug']);
    const m = /\/issues\/(\d+)/.exec(String(out));
    return { status: 'filed', number: m ? Number(m[1]) : null };
  } catch (err) {
    return { status: 'escalation-failed', reason: errorText(err) };
  }
}

// #1892 Deliverable 3: the cache-pruning half of the same marker-lookup
// idiom — a residueFailures entry whose live path is gone (archived, reaped,
// or resolved by some other means entirely) and was already escalated has an
// open backlog record naming a path that no longer needs it. Comment (why)
// then close — best-effort, mirrors escalateResidue's own never-throw
// posture; cache.js drops the cache entry regardless of whether this
// resolution succeeds (the path itself is gone either way, so it can never
// fail or succeed again — see that call site's own comment).
// #1811 Deliverable 4: the consolidated record names N paths, so resolving
// ONE of them must never close the record out from under the OTHER,
// still-genuinely-stuck paths it names. Removes just `targetPath` from the
// body's stuck-paths list; only closes once the list empties.
// -> { status: 'closed'|'path-removed'|'already-closed'|'not-found', number? } |
//    { status: 'resolution-failed', reason, number? }
function resolveStructurallyStuck({ repo, targetPath, runner = defaultRunner }) {
  if (!repo) return { status: 'resolution-failed', reason: 'no-repo-slug' };
  const marker = structurallyStuckMarker();
  let hit;
  try {
    hit = findResidueDuplicate({ repo, marker, runner });
  } catch (err) {
    return { status: 'resolution-failed', reason: errorText(err) };
  }
  if (!hit) return { status: 'not-found' };
  const existingPaths = parseStuckPaths(hit.body);
  if (!existingPaths.includes(targetPath)) return { status: 'not-found' };
  if (hit.state === 'CLOSED') return { status: 'already-closed', number: hit.number };
  const remaining = existingPaths.filter((p) => p !== targetPath);
  try {
    runner(['issue', 'edit', String(hit.number), '--repo', repo, '--body', structurallyStuckBody(remaining)]);
    if (remaining.length === 0) {
      runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body',
        `\`${targetPath}\` no longer exists on disk — the last remaining stuck path. Closing.`]);
      runner(['issue', 'close', String(hit.number), '--repo', repo]);
      return { status: 'closed', number: hit.number };
    }
    runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body',
      `\`${targetPath}\` no longer exists on disk — resolved by other means, removed from the stuck-paths list ` +
      `(${remaining.length} path(s) still stuck).`]);
    return { status: 'path-removed', number: hit.number };
  } catch (err) {
    return { status: 'resolution-failed', reason: errorText(err), number: hit.number };
  }
}

// -> { status: 'closed'|'already-closed'|'not-found', number? } |
//    { status: 'resolution-failed', reason, number? }
function resolveResidue({ repo, reason, targetPath, runner = defaultRunner }) {
  if (reason === 'structurally-stuck') return resolveStructurallyStuck({ repo, targetPath, runner });
  if (!repo) return { status: 'resolution-failed', reason: 'no-repo-slug' };
  const marker = `<!-- fingerprint: ${residueFingerprint(reason, targetPath)} -->`;
  let hit;
  try {
    hit = findResidueDuplicate({ repo, marker, runner });
  } catch (err) {
    return { status: 'resolution-failed', reason: errorText(err) };
  }
  if (!hit) return { status: 'not-found' };
  if (hit.state === 'CLOSED') return { status: 'already-closed', number: hit.number };
  try {
    runner(['issue', 'comment', String(hit.number), '--repo', repo, '--body',
      `This path no longer exists on disk — resolved by other means. Closing.`]);
    runner(['issue', 'close', String(hit.number), '--repo', repo]);
    return { status: 'closed', number: hit.number };
  } catch (err) {
    return { status: 'resolution-failed', reason: errorText(err), number: hit.number };
  }
}

module.exports = {
  escalateResidue, resolveResidue, residueFingerprint, residueBody, findResidueDuplicate, defaultRunner, errorText,
  parseStuckPaths, renderStuckPathsBlock, structurallyStuckBody, structurallyStuckMarker,
};
