// bin/lib/express/sampling.js
// Pure: the express lane's (#4025) post-merge review sampling — which merged
// express PRs owe a post-merge review, whether one already ran, and which
// records a merged PR fixes. Prose statement of record is
// skills/_shared/express-lane.md; this module is its code twin. No I/O:
// callers fetch merged PRs and comments and pass them in.
'use strict';

const { isSampleOrdinal } = require('../issues/grant-sampling');
const { isTrustedComment } = require('../issues/comment-trust');

// The express PR body carries this line; the run id is the capture. `cli.js`'s merged-PR
// search matches the same key. (A multiline `$` already stops before a CR, so a body
// edited in GitHub's web UI, which comes back CRLF, still matches.)
const EXPRESS_MARKER_KEY = 'claude-tweaks-express';
const EXPRESS_MARKER_RE = new RegExp(`^${EXPRESS_MARKER_KEY}: (\\S+)$`, 'm');
const REVIEW_COMMENT_MARKER = '<!-- run-comment: express-review -->';

function expressMarker(runId) {
  return `${EXPRESS_MARKER_KEY}: ${runId}`;
}

function isExpressPr(body) {
  return typeof body === 'string' && EXPRESS_MARKER_RE.test(body);
}

// merges: [{ number, mergedAt, body }] in any order. Ordinals are 1-based over
// express merges only, ascending by mergedAt then PR number, so the result is
// independent of fetch order and non-express PRs never consume an ordinal.
// An unparseable mergedAt fails closed: the entry consumes no ordinal and is
// never sampled (keeping it would make the comparator non-transitive).
function selectReviewSamples(merges, every) {
  const express = (Array.isArray(merges) ? merges : [])
    .filter((m) => m && isExpressPr(m.body) && Number.isFinite(Date.parse(m.mergedAt)))
    .sort((a, b) => (Date.parse(a.mergedAt) - Date.parse(b.mergedAt)) || (a.number - b.number));

  const samples = [];
  express.forEach((m, i) => {
    const ordinal = i + 1;
    if (isSampleOrdinal(ordinal, every)) samples.push({ number: m.number, ordinal, mergedAt: m.mergedAt });
  });
  return samples;
}

// comments: gh (`authorAssociation`) or REST (`author_association`) shaped —
// isTrustedComment reads either. The marker must open the body; a comment
// that merely quotes it does not count.
function isReviewed(comments) {
  return (Array.isArray(comments) ? comments : []).some(
    (c) => isTrustedComment(c) && typeof c.body === 'string' && c.body.startsWith(REVIEW_COMMENT_MARKER),
  );
}

function fixesRecords(body) {
  const out = [];
  for (const m of String(body || '').matchAll(/^Fixes #(\d+)$/gm)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

module.exports = {
  EXPRESS_MARKER_KEY,
  EXPRESS_MARKER_RE,
  REVIEW_COMMENT_MARKER,
  expressMarker,
  isExpressPr,
  selectReviewSamples,
  isReviewed,
  fixesRecords,
};
