'use strict';

// `/claude-tweaks:backlog refine` re-refuses a record whose grant decision a human
// already resolved (#3597). This module decides whether a `needs-decision` refusal
// stays resolved: the latest trusted grant-decision comment carries a `**Resolved:**`
// line with a suppressing choice, and nothing on the issue changed after that
// resolution (body edit or label change). Pure evaluation plus one GraphQL fetch.
//
// Both grant-decision units count — `backlog-refine` (human-present) and
// `backlog-grant` (headless) post the identical question and resolve through the
// same resolver, so the headless path would otherwise re-stamp every incident
// record. Resolution time is the earlier of the start of the `**Resolved:**` line's
// date (`{date}T00:00:00Z`) and the decision comment's `lastEditedAt`; the date alone
// when `lastEditedAt` is absent or unparseable. The comment is edited to add the line,
// so `lastEditedAt` is at or after the real resolution, and taking the min only ever
// moves the instant earlier, never later. The date alone can land later than the real
// resolution (a date east of UTC, or a future-dated typo) and would hide changes made
// in between; `lastEditedAt` alone would drift forward on a later re-edit of the
// comment and hide them the same way, so neither is used by itself. A same-day change
// before the resolution re-asks once (start of day is earlier than the real instant).
// Change evidence is the issue `lastEditedAt` (body edits) and LABELED/UNLABELED
// timeline events; `needs:decision` events are the resolver's own bookkeeping and are
// not changes. A timeline event whose `createdAt` does not parse is missing evidence,
// so the evaluator fails closed on it. `gh issue view --json` exposes neither field,
// hence GraphQL, and the fetcher has no MCP path (`backlog/mcp-transport.md` covers no
// needs-decision read): a gh-absent caller takes its fail-closed "Query failed" bullet.

const { execFileSync } = require('child_process');
const { isTrustedComment, untrustedSkipNote } = require('./comment-trust');
const { GH_TIMEOUT_MS } = require('../shared-primitives');

const GRANT_DECISION_UNITS = ['backlog-refine', 'backlog-grant'];
const SUPPRESSING_CHOICES = ['keep', 'build it myself'];

const DECISION_MARKER_RE = new RegExp(`^<!-- needs-decision: (${GRANT_DECISION_UNITS.join('|')}) -->`, 'm');
const RESOLVED_LINE_RE = /^\*\*Resolved:\*\* (.+?) — (\d{4}-\d{2}-\d{2})[ \t]*$/m;
const RESOLVED_MARKER = '**Resolved:**';
const RESOLVER_LABEL = 'needs:decision';

// {choice, date} from the first `**Resolved:** {choice} — {date}` line, or null.
function parseResolvedLine(body) {
  const match = RESOLVED_LINE_RE.exec(typeof body === 'string' ? body : '');
  if (!match) return null;
  return { choice: match[1], date: match[2] };
}

function timeOf(iso) {
  return Date.parse(iso);
}

// The regex admits any \d{4}-\d{2}-\d{2}; a date that does not round-trip (2026-13-45,
// 2026-02-30) has no real start of day, so it cannot anchor a change comparison.
function isRealDate(date) {
  const ms = timeOf(`${date}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

// Evidence the change comparison needs: both timestamps usable and the Resolved date a
// real calendar date. bodyLastEditedAt is string | null (never edited) | undefined (missing).
function isEvidenceUsable({ bodyLastEditedAt, labelEvents, date }) {
  if (bodyLastEditedAt === undefined || !Array.isArray(labelEvents)) return false;
  if (bodyLastEditedAt !== null && (typeof bodyLastEditedAt !== 'string' || Number.isNaN(timeOf(bodyLastEditedAt)))) {
    return false;
  }
  if (labelEvents.some((event) => Number.isNaN(timeOf(event.createdAt)))) return false;
  return isRealDate(date);
}

// comments: `gh`/GraphQL-shaped comment nodes; labelEvents: {action, label, createdAt}.
// bodyLastEditedAt: string | null (never edited) | undefined (evidence missing).
function evaluateResolvedRefusal({ number, comments, bodyLastEditedAt, labelEvents }) {
  const skipped = [];
  let latest = null;
  let latestMs = -Infinity;

  for (const comment of comments || []) {
    if (!DECISION_MARKER_RE.test(comment.body || '')) continue;
    if (!isTrustedComment(comment)) {
      skipped.push(untrustedSkipNote(comment));
      continue;
    }
    const ms = timeOf(comment.createdAt);
    if (ms > latestMs) {
      latest = comment;
      latestMs = ms;
    }
  }

  const base = {
    suppress: false, reason: '', choice: null, date: null, resolvedAt: null,
    changes: [], annotation: null, skipped,
  };
  if (latest === null) return { ...base, reason: 'no-decision-comment' };

  const resolved = parseResolvedLine(latest.body);
  if (resolved === null) {
    // A marker line that exists but does not parse (ASCII hyphen, trailing text, a timestamp
    // after the date) is a malformed resolution, not an unanswered question.
    const malformed = (latest.body || '').includes(RESOLVED_MARKER);
    return { ...base, reason: malformed ? 'resolved-unparseable' : 'latest-unresolved' };
  }
  base.choice = resolved.choice;
  base.date = resolved.date;

  if (!SUPPRESSING_CHOICES.includes(resolved.choice)) {
    return { ...base, reason: 'choice-not-suppressing' };
  }
  if (!isEvidenceUsable({ bodyLastEditedAt, labelEvents, date: resolved.date })) {
    return { ...base, reason: 'evidence-unavailable' };
  }

  // The earlier of the Resolved date's start of day and the decision comment's last edit
  // (see the header): `lastEditedAt` is at or after the real resolution, so the min only
  // ever moves resolvedAt earlier.
  const startOfDayMs = timeOf(`${resolved.date}T00:00:00Z`);
  const editedMs = timeOf(latest.lastEditedAt);
  const resolvedMs = Number.isNaN(editedMs) ? startOfDayMs : Math.min(startOfDayMs, editedMs);
  const resolvedAt = new Date(resolvedMs).toISOString().replace('.000Z', 'Z');
  base.resolvedAt = resolvedAt;

  const changes = [];
  if (typeof bodyLastEditedAt === 'string' && timeOf(bodyLastEditedAt) > resolvedMs) {
    changes.push({ kind: 'body', at: bodyLastEditedAt });
  }
  for (const event of labelEvents) {
    if (event.label === RESOLVER_LABEL) continue;
    if (timeOf(event.createdAt) > resolvedMs) {
      changes.push({ kind: 'label', label: event.label, action: event.action, at: event.createdAt });
    }
  }

  if (changes.length > 0) {
    return { ...base, reason: 'changed-since-resolution', changes };
  }
  return {
    ...base,
    suppress: true,
    reason: 'unchanged',
    annotation: `#${number} — refusal resolved ${resolved.choice} on ${resolved.date}; not re-asked`,
  };
}

// One query for the decision comments, the issue body edit time and the label events.
const RESOLVED_REFUSAL_QUERY = 'query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ issue(number:$number){ lastEditedAt comments(last:100){ nodes{ body authorAssociation createdAt lastEditedAt url author{login} } } timelineItems(last:100, itemTypes:[LABELED_EVENT, UNLABELED_EVENT]){ nodes{ __typename ... on LabeledEvent{ createdAt label{name} } ... on UnlabeledEvent{ createdAt label{name} } } } } } }';

function buildResolvedRefusalQuery() {
  return RESOLVED_REFUSAL_QUERY;
}

function defaultRunner(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: GH_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Throws on a gh failure, on a GraphQL `errors` body, or when the issue is missing —
// the caller fails closed, so a missing issue is never a `suppress: true`.
// `gh api` has no --repo slot, so a GitHub Enterprise host travels as --hostname; github.com
// (or no host) leaves the argv as gh would default it.
function fetchResolvedRefusalEvidence({ number, owner, repo, host, runner = defaultRunner }) {
  const hostArgs = host && host !== 'github.com' ? ['--hostname', host] : [];
  const stdout = runner([
    'api', 'graphql',
    ...hostArgs,
    '-f', 'query=' + buildResolvedRefusalQuery(),
    '-f', 'owner=' + owner,
    '-f', 'repo=' + repo,
    '-F', 'number=' + number,
  ]);
  const body = JSON.parse(stdout);
  if (body.errors) {
    throw new Error('GraphQL errors: ' + JSON.stringify(body.errors));
  }
  const issue = body.data && body.data.repository && body.data.repository.issue;
  if (!issue) {
    throw new Error(`issue #${number} not found in ${owner}/${repo}`);
  }
  const timeline = issue.timelineItems && issue.timelineItems.nodes;
  return {
    comments: (issue.comments && issue.comments.nodes) || [],
    bodyLastEditedAt: issue.lastEditedAt,
    labelEvents: Array.isArray(timeline)
      ? timeline.map((node) => ({
        action: node.__typename === 'LabeledEvent' ? 'labeled' : 'unlabeled',
        label: node.label && node.label.name,
        createdAt: node.createdAt,
      }))
      : undefined,
  };
}

module.exports = {
  GRANT_DECISION_UNITS,
  SUPPRESSING_CHOICES,
  parseResolvedLine,
  evaluateResolvedRefusal,
  buildResolvedRefusalQuery,
  fetchResolvedRefusalEvidence,
  defaultRunner,
};
