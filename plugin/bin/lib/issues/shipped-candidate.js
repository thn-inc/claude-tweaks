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
// When more than one mention qualifies, `strong` always wins over `weak`;
// among ties, the first qualifying mention in array order is reported —
// mentions is small (dispatch fetches at most 20 per record) and the exact
// PR named matters far less than the tier itself.
function classifyShipped(record, mentions, opts = {}) {
  const titleThreshold = opts.titleSimilarityThreshold ?? DEFAULT_TITLE_SIMILARITY_THRESHOLD;
  const prFiles = opts.prFiles || new Map();
  const recordKeyFiles = extractKeyFiles(record);
  const recordCreatedAtMs = record && record.createdAt ? new Date(record.createdAt).getTime() : null;
  const recordTokens = tokenizeTitle(record && record.title);

  let best = { tier: 'none', pr: null, signals: [] };

  for (const mention of mentions || []) {
    if (!mention || !mention.merged) continue;
    if (recordCreatedAtMs !== null && mention.mergedAt) {
      const mergedAtMs = new Date(mention.mergedAt).getTime();
      if (!(mergedAtMs > recordCreatedAtMs)) continue;
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

    const tier = (titleMatch || filesCoverAll) ? 'strong' : 'weak';

    if (tier === 'strong' && best.tier !== 'strong') {
      best = { tier, pr: mention.number, signals };
    } else if (tier === 'weak' && best.tier === 'none') {
      best = { tier, pr: mention.number, signals };
    }
  }

  return best;
}

module.exports = { classifyShipped };
