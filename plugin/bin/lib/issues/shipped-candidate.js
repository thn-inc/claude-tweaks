// bin/lib/issues/shipped-candidate.js
// Pure: classifies a record's own cross-reference mentions (from
// linked-prs.js's `fetchLinkedPRs`, the timeline-mentions field #1984
// added) into a `strong`/`weak`/`none` shipped-already tier. Used at
// /dispatch's pre-flight (`dispatch/queue-pull-script.md`, after the
// open-linked-PR exclusion #1224) to catch a record whose full deliverable
// set is already shipped on `main` via a merged PR that never carried a
// closing keyword for it (the #1791/#1803 and #1484/#1857 instances this
// record documents) before a build cycle is spent re-discovering that.
// No network, no I/O.
'use strict';

const { extractKeyFiles } = require('./grouping');
const { tokenizeTitle, jaccard, DEFAULT_TITLE_SIMILARITY_THRESHOLD } = require('./near-duplicate');

// record: { number, title, body, createdAt, labels }. mentions: the
// per-record `mentions` array `fetchLinkedPRs` returns — every same-repo PR
// that has ever cross-referenced this issue, closing keyword or not.
// opts.titleSimilarityThreshold overrides the #1944 tokenizer's default
// (0.5). opts.prFiles: Map<prNumber, string[]> — a PR's changed files,
// fetched lazily by the caller (`gh pr view --json files`) ONLY for
// `weak`-tier candidates and capped, per this record's own deliverable; a
// PR absent from this map is simply "files not fetched for it," which the
// files-based strong signal treats the same as "files don't cover
// everything" — it never upgrades a tier on missing data.
//
// Returns { tier: 'strong'|'weak'|'none', pr: number|null, signals: string[] }.
// The base signal — a merged PR, merged strictly after the record's own
// createdAt, mentions it — is `weak` on its own. It becomes `strong` only
// with a second, independent signal: the PR's title token-similarity to the
// record's own title clears the threshold, OR the PR's changed files cover
// every path in the record's own `### Key Files`. A record with no Key
// Files AND no title match can never be `strong` — the files-based check
// requires a non-empty Key Files list, so an empty list can't vacuously
// satisfy "every path is covered."
//
// A mention is skipped entirely (no tier, not even `weak`) when its PR was
// already open before the record was created — a record filed during a PR's
// build is that PR's by-product, not a deliverable it shipped (#4314:
// #4135/PR #4035, #4191/PR #4144). A mention with no `createdAt` (or an
// unparseable one) keeps the prior behavior.
//
// opts.lastReleasedAt: ISO time (or null) of the record's latest claim
// release (#4432), passed by the caller the same way as opts.prFiles — this
// function stays pure. A record a pipeline merged only half of and then
// released to finish is mentioned by a PR that merged BEFORE that release; its
// title/files still match, but the merge is not the whole deliverable. A
// mention whose `mergedAt` is strictly earlier than `lastReleasedAt` therefore
// carries the `predates-claim-release` signal and rates `weak` at most. Both
// sides are compared as instants (normalized through `Date`, like the
// createdAt checks), never as strings. A missing, unparseable or absent
// `lastReleasedAt`/`mergedAt` never downgrades and never upgrades — the prior
// behavior holds. A shaping-only release after a merge also downgrades; that
// is the safe direction, and the build's shipped-exit check
// (`tests/build-already-shipped-exit.test.js`) still catches a truly shipped
// record.
//
// When more than one mention qualifies, `strong` always wins over `weak`, and
// a `weak` without `predates-claim-release` wins over one with it; among
// ties, the first qualifying mention in array order is reported — mentions is
// small (dispatch fetches at most 20 per record) and the exact PR named
// matters far less than the tier itself.
const PREDATES_CLAIM_RELEASE = 'predates-claim-release';

// strong > weak > weak-that-predates-the-release > none
function rankOf(tier, predatesRelease) {
  if (tier === 'strong') return 3;
  if (tier === 'weak') return predatesRelease ? 1 : 2;
  return 0;
}

function classifyShipped(record, mentions, opts = {}) {
  const titleThreshold = opts.titleSimilarityThreshold ?? DEFAULT_TITLE_SIMILARITY_THRESHOLD;
  const prFiles = opts.prFiles || new Map();
  const recordKeyFiles = extractKeyFiles(record);
  const recordCreatedAtMs = record && record.createdAt ? new Date(record.createdAt).getTime() : null;
  const recordTokens = tokenizeTitle(record && record.title);
  // A falsy value must be NaN, never `new Date(null)` (epoch 0).
  const lastReleasedAtMs = opts.lastReleasedAt ? new Date(opts.lastReleasedAt).getTime() : NaN;

  let best = { tier: 'none', pr: null, signals: [] };
  let bestRank = rankOf('none', false);

  for (const mention of mentions || []) {
    if (!mention || !mention.merged) continue;
    if (recordCreatedAtMs !== null && mention.mergedAt) {
      const mergedAtMs = new Date(mention.mergedAt).getTime();
      if (!(mergedAtMs > recordCreatedAtMs)) continue;
    }
    if (recordCreatedAtMs !== null && mention.createdAt) {
      const prCreatedAtMs = new Date(mention.createdAt).getTime();
      if (prCreatedAtMs < recordCreatedAtMs) continue;
    }

    const signals = ['merged-pr-mention-after-created'];

    const titleSimilarity = jaccard(recordTokens, tokenizeTitle(mention.title));
    const titleMatch = titleSimilarity >= titleThreshold;
    if (titleMatch) signals.push('title-similarity');

    const files = prFiles.get(mention.number);
    const filesCoverAll = recordKeyFiles.length > 0
      && Array.isArray(files)
      && recordKeyFiles.every((f) => files.includes(f));
    if (filesCoverAll) signals.push('key-files-covered');

    const mergedAtMs = mention.mergedAt ? new Date(mention.mergedAt).getTime() : NaN;
    const predatesRelease = mergedAtMs < lastReleasedAtMs; // false when either side is NaN
    if (predatesRelease) signals.push(PREDATES_CLAIM_RELEASE);

    const tier = ((titleMatch || filesCoverAll) && !predatesRelease) ? 'strong' : 'weak';

    const rank = rankOf(tier, predatesRelease);
    if (rank > bestRank) {
      best = { tier, pr: mention.number, signals };
      bestRank = rank;
    }
  }

  return best;
}

module.exports = { classifyShipped, PREDATES_CLAIM_RELEASE };
