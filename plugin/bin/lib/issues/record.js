// bin/lib/issues/record.js
// Pure: the unified work-record taxonomy and payload assembly — the code twin of
// skills/_shared/work-record.md. Every label-string literal used by the health
// skills, /capture, /specify, /backlog, and /dispatch lives here; other modules
// import from this file rather than re-declaring their own copies. No network.
'use strict';

const { sharedFacetDefaults } = require('./facet-shape');

const ORIGINS = ['code-health', 'harness-health', 'journey-health', 'docs-health', 'capture', 'dispatch'];
const TYPES = ['bug', 'feature', 'task'];
const TIERS = ['low', 'medium', 'high'];
const PRIORITIES = ['high', 'medium', 'low'];
const CEREMONY_TIERS = ['fast-lane', 'standard'];

// The closed Defer-reason: vocabulary — the code twin of
// skills/_shared/deferral-gate.md's "Defer-reason: vocabulary" section
// (tests/deferral-gate-conformance.test.js pins the two lists equal). Order is
// the contract's order. Frozen: consumers compare against it, never extend it.
const DEFER_REASONS = Object.freeze([
  'tangential',
  'needs-human-decision',
  'pre-existing-outside-diff',
  'genuinely-larger',
  'blocked-external',
  'blocked-dependency',
]);

// Matches a Defer-reason: line on ANY line of the body (the /m flag) — the
// suppression check is "no line matching", per deferral-gate.md's hard gate;
// the first line of the body is where the insert path and producers put it
// (deferral-gate.md's "Where the reason lives").
const DEFER_REASON_LINE_RE = /^Defer-reason: (\S+)[ \t]*$/m;

const LABELS = {
  READY: 'ready',
  PARKED: 'parked',
  AUTO_BUILD: 'auto:build',
  AUTO_MERGE: 'auto:merge',
  BOT_IN_PROGRESS: 'bot:in-progress',
  BOT_BLOCKED: 'bot:blocked',
  BOT_PARKED: 'bot:parked',
  WONTFIX: 'wontfix',
  SOLUTION_UNJUSTIFIED: 'solution:unjustified',
  // Read-side legacy fallback — PERMANENT cross-project support (other repos' records keep framing:baked labels, pre-rename); removable only at a major version that drops pre-rename repo support. [IL-85] Never emitted.
  FRAMING_BAKED: 'framing:baked',
  NEEDS_DEFINITION: 'needs:definition',
  // Compatibility axis (#2251) — presence-only, like SOLUTION_UNJUSTIFIED. Read by
  // bin/lib/release/subject.js's merge-subject composer (! suffix + BREAKING CHANGE footer).
  BREAKING: 'breaking',
  DEMO_PENDING: 'demo:pending',
  DEMO_APPROVED: 'demo:approved',
  DEMO_CHANGES_REQUESTED: 'demo:changes-requested',
  PARENT_ISSUE: 'parent-issue',
  SHAPED_HEADLESS: 'shaped:headless',
};

// F8 from the program promise register — type:* label descriptions home
// (each <= 100 chars; used only when work-types: labels is configured).
const TYPE_LABELS = [
  ['type:bug', 'Type: a defect in existing behavior'],
  ['type:feature', 'Type: new capability or enhancement'],
  ['type:task', 'Type: maintenance, refactor, docs, or chore work'],
];

// Dual-write fingerprint markers: FP_RE_WORK is the current marker written by
// recordPayload(); FP_RE_LEGACY is the pre-work-record marker still present on older
// issues during the migration window, read from all three health producers
// (skills/_shared/work-record.md).
const FP_RE_WORK = /<!--\s*work-fingerprint:\s*([^\s>]+)\s*-->/;
const FP_RE_LEGACY = /<!--\s*(?:code-health|harness-health|journey-health)-fingerprint:\s*([^\s>]+)\s*-->/;

// Plain-text companion to FP_RE_WORK (#1700): the GitHub MCP server's read path
// (`mcp__github__list_issues`/`issue_read`) sanitizes issue bodies the same way it
// sanitizes PR bodies — every `<!-- ... -->` span is stripped before the tool result
// reaches the caller (see `_shared/pr-early-run-lifecycle.md`'s "Root cause" section,
// which documents this for PR reads; the same bluemonday StrictPolicy strips issue
// reads too). recordPayload's finalBody below writes this line immediately after the
// HTML-comment marker, unconditionally on every transport (the write path is
// unsanitized either way, so writing both costs nothing) — the same dual-marker
// scheme pr-early-run-lifecycle.md already uses for PR bodies. Line-anchored (/m),
// same convention as DEFER_REASON_LINE_RE/VERIFIED_AS_OF_RE above.
const FP_RE_WORK_PLAIN = /^work-fingerprint: (\S+)[ \t]*$/m;

// Freshness stamp (#117): the commit each health-sweep skill actually read at
// filing time, threaded through specShapedBody's verifiedAsOf param as a
// plain body-metadata line — same convention as Origin:/Defer-reason:, never
// YAML frontmatter. A full or abbreviated git sha, hex only. Line-anchored
// (/m) so prose elsewhere in the body mentioning a commit never matches.
const VERIFIED_AS_OF_RE = /^Verified-as-of: ([0-9a-f]{7,40})[ \t]*$/mi;
const SHA_SHAPE_RE = /^[0-9a-f]{7,40}$/i;

// Line-anchored 'Blocked by #N' dependency declarations (multiline).
const DEP_RE = /^Blocked by #(\d+)\b/gm;

// Parent task-list entries (work-links: body-text), written by /specify as
// '- [ ] #{subIssueNum}' and checked off over time — both box states count.
const SUB_ISSUE_RE = /^- \[[ xX]\] #(\d+)\b/gm;

// Line-anchored 'Blocked by #N: {text}' assumption declarations (multiline) —
// a separate, additive sibling to DEP_RE/parseDependencies below, never a
// modification of either. DEP_RE already stops matching at the number, so a
// trailing ': {text}' parses under it with zero changes; this regex only
// exists to capture that trailing text when a caller wants it.
const DEP_ASSUMPTION_RE = /^Blocked by #(\d+):[ \t]*(.+)$/gm;

const BY_RE = /^by:(.+)$/;
const RISK_LABEL_RE = /^risk:(.+)$/;
const SIZE_LABEL_RE = /^size:(.+)$/;
// Read-side effort:* fallback — PERMANENT cross-project support (other repos' records keep effort:* labels); removable only at a major version that drops pre-rename repo support. [IL-85]
const EFFORT_LABEL_RE = /^effort:(.+)$/;
const PRIORITY_LABEL_RE = /^priority:(.+)$/;
const CEREMONY_LABEL_RE = /^ceremony:(.+)$/;

// The colon-form value labels parseRecordFacets reads straight into a facet:
// the regex that recognizes one, the facet key it sets, and the vocabulary its
// value must belong to. A value outside that vocabulary is ignored entirely
// (the facet keeps its default) rather than stored. Every prefix here is
// distinct, so one label name can match at most one row and evaluation order
// carries no meaning. effort:* is deliberately absent — it is the one value
// label that does NOT write its facet directly (see parseRecordFacets).
const VALUE_FACETS = [
  [BY_RE, 'origin', ORIGINS],
  [RISK_LABEL_RE, 'risk', TIERS],
  [SIZE_LABEL_RE, 'size', TIERS],
  [CEREMONY_LABEL_RE, 'ceremony', CEREMONY_TIERS],
  [PRIORITY_LABEL_RE, 'priority', PRIORITIES],
];

function oneOf(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of ${allowed.join('|')} (got "${value}")`);
  }
}

// classification -> risk/size scoring axis fold, shared by every health
// producer's issue-payload.js (docs-health, harness-health; journey-health
// uses its own severity-based fold instead, see journey-health/issue-payload.js):
// additive is a safe, mechanical patch (low risk, small change); restructural
// needs human review and is a bigger change. A finding kind that's deliberately
// unscored (e.g. harness-health's "new-skill") looks this map up and gets
// `undefined` back rather than consulting it at all — callers gate that
// themselves, this map has no "unscored" entry.
const CLASSIFICATION_SCORING = {
  additive: { risk: 'low', size: 'low' },
  restructural: { risk: 'medium', size: 'high' },
};

// Returns a backtick fence at least one character longer than the longest run
// of backticks found inside `text`, so a fenced code block wrapping arbitrary
// finding content (a docs/skill/rule/CLAUDE.md excerpt) can never be closed
// early by a ``` sequence already present in that content — GitHub's
// fence-matching rule only treats a run of >= the opening fence's length as
// a closer.
function fenceFor(text) {
  const runs = String(text).match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function fencedBlock(text) {
  const fence = fenceFor(text);
  return `${fence}\n${text}\n${fence}`;
}

// { title, body, type, origin?, risk?, size?, ceremony?, solutionUnjustified?, ready?, parked?, priority?, fingerprint?, deferReason? }
// -> { title, body, labels: string[], type }
// Validates supplied enum values; absence of an optional field never throws.
// The emit side is size-only: `effort` is accepted only to throw on it (below) —
// a caller composing a payload inline from pre-rename facets fails loud instead
// of silently dropping the scoring label. No code path here writes an effort:*
// label. The read side's effort:* fallback (parseRecordFacets below) is
// deliberately one-directional. `framing` is rejected the same way — the
// pre-rename name of `solutionUnjustified` (#677).
function recordPayload({ title, body, type, origin, risk, size, ceremony, solutionUnjustified, ready, parked, priority, fingerprint, effort, framing, deferReason } = {}) {
  if (typeof title !== 'string' || !title) {
    throw new Error(`title must be a non-empty string (got ${typeof title})`);
  }
  if (typeof body !== 'string') {
    throw new Error(`body must be a string (got ${typeof body})`);
  }
  oneOf('type', type, TYPES);

  if (effort !== undefined) {
    throw new Error('recordPayload has no effort parameter — the record facet is size (#217); effort means reasoning depth');
  }

  if (framing !== undefined) {
    throw new Error('recordPayload has no framing parameter — the facet is solutionUnjustified (#677); framing:baked was renamed solution:unjustified');
  }

  if (ready && parked) {
    throw new Error('a record cannot be both ready and parked');
  }

  // deferReason is validation-plus-body-line, never a label: an unknown value
  // throws naming the field (same posture as the effort rejection above); a valid
  // one is inserted as the body's first line unless the body already carries a
  // matching Defer-reason: line (a specShapedBody-composed body, #623), in which
  // case nothing is inserted; a body carrying a *different* value is a caller
  // contradiction and throws.
  let reasonBody = body;
  if (deferReason !== undefined) {
    oneOf('deferReason', deferReason, DEFER_REASONS);
    const existing = DEFER_REASON_LINE_RE.exec(body);
    if (existing) {
      if (existing[1] !== deferReason) {
        throw new Error(`body already carries "Defer-reason: ${existing[1]}" but deferReason is "${deferReason}"`);
      }
    } else {
      reasonBody = `Defer-reason: ${deferReason}\n\n${body}`;
    }
  }

  // Deterministic emission order: by:*, risk:*, size:*, ceremony:*, solution:unjustified, ready, parked, priority:*.
  const labels = [];

  if (origin !== undefined) {
    oneOf('origin', origin, ORIGINS);
    labels.push(`by:${origin}`);
  }
  if (risk !== undefined) {
    oneOf('risk', risk, TIERS);
    labels.push(`risk:${risk}`);
  }
  if (size !== undefined) {
    oneOf('size', size, TIERS);
    labels.push(`size:${size}`);
  }
  if (ceremony !== undefined) {
    oneOf('ceremony', ceremony, CEREMONY_TIERS);
    labels.push(`ceremony:${ceremony}`);
  }
  if (solutionUnjustified) labels.push(LABELS.SOLUTION_UNJUSTIFIED);
  if (ready) labels.push(LABELS.READY);
  if (parked) labels.push(LABELS.PARKED);
  if (priority !== undefined) {
    oneOf('priority', priority, PRIORITIES);
    labels.push(`priority:${priority}`);
  }

  const finalBody = fingerprint
    ? `${reasonBody}\n\n<!-- work-fingerprint: ${fingerprint} -->\nwork-fingerprint: ${fingerprint}`
    : reasonBody;

  return { title, body: finalBody, labels, type };
}

// body -> fingerprint string, or null when no marker is present (also null for
// null/undefined/empty body). The new work-fingerprint HTML-comment marker wins
// whenever both it and the legacy HTML-comment marker are present, regardless of
// which appears first in the body (dual-write/migration period). The plain-text
// companion (FP_RE_WORK_PLAIN, #1700) is checked last, as a fallback only — it
// exists specifically for the case where an MCP-fetched body has had every
// HTML-comment span stripped, so neither HTML-comment regex can match, but the
// plain-text line survives untouched.
function extractFingerprint(body) {
  if (typeof body !== 'string' || !body) return null;
  const work = FP_RE_WORK.exec(body);
  if (work) return work[1];
  const legacy = FP_RE_LEGACY.exec(body);
  if (legacy) return legacy[1];
  const plain = FP_RE_WORK_PLAIN.exec(body);
  return plain ? plain[1] : null;
}

// body -> the git sha the sweep read when it filed this issue, or null when
// absent (a pre-#117 issue, or a body that was never run through
// specShapedBody's verifiedAsOf param). Consumers (e.g. bin/materialize.js)
// diff this against current HEAD to say something actionable about drift —
// see [IL-71]: presence of a fresh stamp bounds drift, it never establishes
// correctness, so a consumer still must not skip verification just because
// this reads recent.
function extractVerifiedAsOf(body) {
  if (typeof body !== 'string' || !body) return null;
  const m = VERIFIED_AS_OF_RE.exec(body);
  return m ? m[1].toLowerCase() : null;
}

// Accepts either bare label-name strings or {name} objects (gh's own shape).
function normalizeLabelNames(labels) {
  return (labels || []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean);
}

// labels (string[] | {name}[]) -> the full record-facet shape. Explicit false/null
// defaults are set first and only ever flipped/assigned as matching labels are found
// in a single pass over the normalized names — never inferred from truthiness. Stage
// precedence is ready > parked > backlog regardless of array order or malformed
// combinations (e.g. both 'ready' and 'parked' present resolves to 'ready').
// Acceptance has no such precedence — the three demo:* labels are mutually exclusive
// by construction, so a plain last-match-in-array-wins assignment (same style as
// origin/risk/size/priority below) is enough.
// The size facet is the one exception to last-match-in-array-wins: size:* always
// beats a pre-rename effort:* label whichever order they appear in, so the effort
// value is only held aside during the pass and applied afterward, and never when a
// size:* label was found.
// Shared-key defaults come from facet-shape.js — local-store.js's defaultFacets
// builds on the same shape (plus its own local-only keys). Add a new shared
// facet key there, not independently here — the sanctioned exception is a key
// with no meaning on the other driver, declared driver-locally instead (see
// shapedHeadless immediately below, the GitHub-only counterpart to
// local-store.js's parent/blockedBy/unsynced keys).
function parseRecordFacets(labels) {
  const names = normalizeLabelNames(labels);

  const facets = sharedFacetDefaults();
  facets.shapedHeadless = false; // GitHub-only facet (headless `next` is github-issues only) — deliberately not in the shared facet-shape.js, so the local-files driver carries no meaningless default for it.
  let effortFallback = null;

  for (const name of names) {
    if (name === LABELS.READY) {
      facets.stage = 'ready';
      continue;
    }
    if (name === LABELS.PARKED) {
      if (facets.stage !== 'ready') facets.stage = 'parked';
      continue;
    }
    if (name === LABELS.AUTO_BUILD) {
      facets.grants.build = true;
      continue;
    }
    if (name === LABELS.AUTO_MERGE) {
      facets.grants.merge = true;
      continue;
    }
    if (name === LABELS.BOT_IN_PROGRESS) {
      facets.bot.inProgress = true;
      continue;
    }
    if (name === LABELS.BOT_BLOCKED) {
      facets.bot.blocked = true;
      continue;
    }
    if (name === LABELS.BOT_PARKED) {
      facets.bot.parked = true;
      continue;
    }
    if (name === LABELS.WONTFIX) {
      facets.notPlanned = true;
      continue;
    }
    if (name === LABELS.DEMO_PENDING) {
      facets.acceptance = 'pending';
      continue;
    }
    if (name === LABELS.DEMO_APPROVED) {
      facets.acceptance = 'approved';
      continue;
    }
    if (name === LABELS.DEMO_CHANGES_REQUESTED) {
      facets.acceptance = 'changes-requested';
      continue;
    }
    // solution:unjustified — or its pre-rename spelling framing:baked (permanent read-side fallback, [IL-85]).
    if (name === LABELS.SOLUTION_UNJUSTIFIED || name === LABELS.FRAMING_BAKED) {
      facets.solutionUnjustified = true;
      continue;
    }
    if (name === LABELS.NEEDS_DEFINITION) {
      facets.needsDefinition = true;
      continue;
    }
    if (name === LABELS.BREAKING) {
      facets.breaking = true;
      continue;
    }
    if (name === LABELS.PARENT_ISSUE) {
      facets.isParentIssue = true;
      continue;
    }
    if (name === LABELS.SHAPED_HEADLESS) {
      facets.shapedHeadless = true;
      continue;
    }
    // Read-side family:parent fallback — PERMANENT cross-project support (other repos' records keep family:parent labels); removable only at a major version that drops pre-rename repo support. [IL-85]
    if (name === 'family:parent') {
      facets.isParentIssue = true;
      continue;
    }

    // Read-side effort:* fallback — PERMANENT cross-project support (other repos' records keep effort:* labels); removable only at a major version that drops pre-rename repo support. [IL-85]
    // Last such label wins among repeats, matching the VALUE_FACETS pass just below and the pre-rename effort parse this replaces.
    const effort = EFFORT_LABEL_RE.exec(name);
    if (effort && TIERS.includes(effort[1])) {
      effortFallback = effort[1];
      continue;
    }

    for (const [labelRe, key, vocabulary] of VALUE_FACETS) {
      const match = labelRe.exec(name);
      if (match && vocabulary.includes(match[1])) {
        facets[key] = match[1];
        break;
      }
    }
  }

  if (facets.size === null) facets.size = effortFallback;

  return facets;
}

// (body, lineRe) -> deduped array of the numbers lineRe's first capture group
// matches, in order of first appearance; [] for a null/undefined/empty body.
// Shared by the two line-anchored body scans below. Both regexes carry the 'g'
// flag but matchAll clones them internally per call, so lastIndex state is never
// shared across calls.
function parseIssueNumbers(body, lineRe) {
  if (typeof body !== 'string' || !body) return [];
  const seen = new Set();
  const result = [];
  for (const match of body.matchAll(lineRe)) {
    const n = Number(match[1]);
    if (!seen.has(n)) {
      seen.add(n);
      result.push(n);
    }
  }
  return result;
}

// body -> deduped array of issue numbers from line-anchored 'Blocked by #N' lines,
// in order of first appearance. Mid-line occurrences (not at line start) don't
// count as a dependency declaration.
function parseDependencies(body) {
  return parseIssueNumbers(body, DEP_RE);
}

// parent body -> deduped array of sub-issue numbers from its task list, in order
// of first appearance. Mid-line occurrences don't count, exactly as with DEP_RE.
// Under work-links: native the parent body carries no task list at all — that
// caller reads sub_issues from the API and never calls this.
function parseSubIssues(body) {
  return parseIssueNumbers(body, SUB_ISSUE_RE);
}

// candidate issue numbers -> one batched, aliased GraphQL query requesting each
// candidate's native blockedBy connection (work-links: native). GraphQL aliases
// can't start with a digit, hence the 'i' prefix. Returns null for an empty or
// non-array input — nothing to query, and an empty repository{} selection set
// would be invalid GraphQL.
function buildNativeDependencyQuery(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const fields = numbers
    .map((n) => `i${n}: issue(number:${n}){ number blockedBy(first:25){ nodes{ number state } } }`)
    .join('\n      ');
  return `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      ${fields}\n  }\n}`;
}

// candidate parent-issue numbers -> one batched, aliased GraphQL query requesting
// each parent's native subIssues connection (work-links: native). first:100 is the
// connection page size requested, not a claim about any platform-side cap on
// sub-issue count; pageInfo.hasNextPage is the actual guard callers must honor —
// it fires whenever a parent has more sub-issues than fit in one page, whatever
// that cap turns out to be, so a truncated page is never mistaken for a complete
// one. Same alias/null conventions as buildNativeDependencyQuery above.
function buildNativeSubIssuesQuery(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const fields = numbers
    .map((n) => `i${n}: issue(number:${n}){ number subIssues(first:100){ nodes{ number } pageInfo{ hasNextPage } } }`)
    .join('\n      ');
  return `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      ${fields}\n  }\n}`;
}

// candidate sub-issue numbers -> one batched, aliased GraphQL query requesting each
// issue's native parent (work-links: native), read from the sub-issue's own side.
// Probed live on this repo 2026-08-24: issue(number:$n){ parent{ number title state } }
// returns { number, parent: { number, title, state } } for a sub-issue, and
// parent: null for a parentless record. Same alias/null conventions as
// buildNativeSubIssuesQuery above. Caller: demo/entry-paths.md's Full verification
// pointer sub-procedure. review/cross-spec-promise-check.md performs the equivalent
// native parent-resolution query independently — it does not call this function.
function buildNativeParentQuery(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const fields = numbers
    .map((n) => `i${n}: issue(number:${n}){ number parent{ number title state } }`)
    .join('\n      ');
  return `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      ${fields}\n  }\n}`;
}

// one candidate's parsed aliased response value (the { number, blockedBy: { nodes } }
// shape buildNativeDependencyQuery's query produces per alias) -> true when at least
// one blockedBy node is still OPEN. Mirrors parseDependencies' role for the
// work-links: body-text case, but judges a single already-parsed node instead of
// scanning body text for every candidate at once.
function hasOpenNativeBlocker(issueNode) {
  const nodes = issueNode && issueNode.blockedBy && issueNode.blockedBy.nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.some((n) => n && n.state === 'OPEN');
}

// candidates[] (each with .number), openBlockerIdsFn: candidate -> number[] of
// the open blocker ids excluding it (empty when none) -> { eligible, excluded }.
// The shared partition shape both blocked-by checks below need: split on
// whether the candidate has any open blocker, carrying the actual blocker
// id(s) for whichever candidates get dropped instead of discarding them
// (dispatch/SKILL.md's Blocked-exclusion report, #1101). A two-member
// dependency cycle needs no special handling here: each member's
// `openBlockerIdsFn` independently names the other, so both land in
// `excluded` — the cycle is visible as two entries pointing at each other,
// not a distinct code path.
function partitionByOpenBlockers(candidates, openBlockerIdsFn) {
  const eligible = [];
  const excluded = [];
  for (const c of candidates) {
    const openBlockers = openBlockerIdsFn(c);
    if (openBlockers.length > 0) excluded.push({ number: c.number, blockedBy: openBlockers });
    else eligible.push(c);
  }
  return { eligible, excluded };
}

// candidates[] (each with .number and .body), openNumbers: Set<number> -> { eligible, excluded }.
// The same open-body-text-dependency predicate dispatch/queue-pull-script.md's own
// eligibility filter already applies (parseDependencies + an open id), via
// partitionByOpenBlockers above.
function partitionByOpenBodyBlockers(candidates, openNumbers) {
  return partitionByOpenBlockers(candidates, (c) => parseDependencies(c.body).filter((dep) => openNumbers.has(dep)));
}

// candidates[] (each with .number), repoData: the native GraphQL response's
// repository{} object (i{number} aliases, buildNativeDependencyQuery's shape) ->
// { eligible, excluded }, same shape as partitionByOpenBodyBlockers above, for
// work-links: native. hasOpenNativeBlocker only ever returned a boolean; this is
// the identical OPEN-state filter, keeping the actual blocker numbers instead of
// discarding them. A candidate missing from repoData (no `i{n}` alias — e.g. the
// project isn't on work-links: native, per queue-pull-script.md's `{}` placeholder)
// has no nodes to check and stays eligible, matching hasOpenNativeBlocker's own
// no-array-of-nodes -> false behavior. Same fails-safe guard as hasOpenNativeBlocker:
// a malformed response (nodes present but not an array, e.g. a schema mismatch)
// degrades to "no blockers resolved", never throws .filter-is-not-a-function.
function partitionByOpenNativeBlockers(candidates, repoData) {
  return partitionByOpenBlockers(candidates, (c) => {
    const node = repoData && repoData['i' + c.number];
    const rawNodes = node && node.blockedBy && node.blockedBy.nodes;
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];
    return nodes.filter((n) => n && n.state === 'OPEN').map((n) => n.number);
  });
}

// candidate issue numbers -> one batched, aliased GraphQL query requesting
// each candidate's closedByPullRequestsReferences connection (#1224) — the
// PRs that would close it via a closing keyword (Closes/Fixes/Resolves #N)
// or GitHub's native "Development" linkage, whether still open or already
// merged/closed. Runs unconditionally — unlike buildNativeDependencyQuery
// (work-links: native only), this check isn't gated behind a dependency-
// tracking policy: it exists purely to stop wasted re-dispatch of a record
// that already has a build in flight. Same alias/null conventions as
// buildNativeDependencyQuery above.
// Also carries each candidate's cross-reference timeline (#1984) — every PR
// that has ever mentioned the issue, closing keyword or not — beside the
// closedByPullRequestsReferences connection above. This is the "mentioned
// but never closed" case buildLinkedPRQuery's own connection can't see: a
// merged PR whose body says "refs #N" with no closing keyword leaves the
// record open with a live grant despite the work already having shipped
// (#1791/#1803, #1484/#1857). `source { ... on PullRequest { ... } }`
// resolves to null for a cross-reference from another Issue (not a PR),
// which linked-prs.js's fetchLinkedPRs filters out; `repository{
// nameWithOwner }` lets it filter to same-repo mentions only (a
// CrossReferencedEvent's source can live in an unrelated repository).
function buildLinkedPRQuery(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const fields = numbers
    .map((n) => `i${n}: issue(number:${n}){ number closedByPullRequestsReferences(first:10){ nodes{ number state } } timelineItems(itemTypes:[CROSS_REFERENCED_EVENT], first:20){ nodes{ ... on CrossReferencedEvent { source { ... on PullRequest { number title state merged mergedAt repository { nameWithOwner } } } } } } }`)
    .join('\n      ');
  return `query($owner:String!,$repo:String!){\n  repository(owner:$owner,name:$repo){\n      ${fields}\n  }\n}`;
}

// candidates[] (each with .number), repoData: the linked-PR GraphQL response's
// repository{} object (i{number} aliases, buildLinkedPRQuery's shape) ->
// { eligible, excludedByOpenPR }. A candidate already covered by an open,
// unmerged PR that will close it is excluded from re-dispatch — building it
// again would race or duplicate a build already in flight (#1224). Mirrors
// partitionByOpenNativeBlockers's shape and fail-safe posture (a malformed
// or missing connection degrades to "no open linked PR", never throws), but
// carries the linked PR's own number for the excluded entry rather than a
// list of blocker ids, since there is exactly one PR to name per exclusion.
// A candidate missing from repoData (this query was never run for it) stays
// eligible, same no-alias -> eligible behavior as the native-blocker check.
function partitionByOpenLinkedPR(candidates, repoData) {
  const { eligible, excluded } = partitionByOpenBlockers(candidates, (c) => {
    const node = repoData && repoData['i' + c.number];
    const rawNodes = node && node.closedByPullRequestsReferences && node.closedByPullRequestsReferences.nodes;
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];
    const openPR = nodes.find((n) => n && n.state === 'OPEN');
    return openPR ? [openPR.number] : [];
  });
  // partitionByOpenBlockers' generic shape carries a blocker LIST per
  // excluded candidate (a candidate can have several open blockers); this
  // caller only ever has exactly one linked PR to name, so unwrap back to
  // the single `pr` field this function's own callers expect.
  const excludedByOpenPR = excluded.map((e) => ({ number: e.number, pr: e.blockedBy[0] }));
  return { eligible, excludedByOpenPR };
}

// body -> array of {number, assumption} for every line-anchored
// 'Blocked by #N: {text}' declaration, in order of appearance. A bare
// 'Blocked by #N' line (no colon) contributes nothing here — parseDependencies
// above is still the only reader of bare dependency lines. Not deduped by
// number: a caller writing the same N twice with different text gets both
// entries back, same as matchAll would naturally produce.
function parseDependencyAssumptions(body) {
  if (typeof body !== 'string' || !body) return [];
  const result = [];
  for (const match of body.matchAll(DEP_ASSUMPTION_RE)) {
    result.push({ number: Number(match[1]), assumption: match[2] });
  }
  return result;
}

// { header?, currentState, deliverables, acceptanceCriteria?, openQuestion?, filedBy,
//   provenance?: { origin?, deferReason? }, footer?: string | null, verifiedAsOf?: string }
//   -> body string.
// Additive over the original shape: a call passing none of provenance/footer/openQuestion/
// verifiedAsOf (and a non-empty header) composes byte-identical output — the four health-suite
// builders are the regression oracle (tests/health-filing-parity.test.js). Exactly one
// of acceptanceCriteria/openQuestion must be supplied: openQuestion is the composer's
// needs:definition variant, rendering `## Open Question` in place of Acceptance
// Criteria so a needs-you record never carries placeholder AC. Provenance lines
// (Origin:, then Defer-reason: — validated against DEFER_REASONS) render between
// header and `## Current State`, where provenance.js's line-anchored Origin: parse
// reads them. footer: a string replaces the default health-suite sentence, null omits
// it; exhaust producers pass `_Filed by \`{producer}\` via specShapedBody._` — the
// machine-visible marker _shared/work-record.md's born-shaped matrix rows key on.
// header is the slot for producer-specific leading lines (e.g. `Trigger: {condition}`)
// and may be empty/omitted — the one relaxation from the original, needed because the
// openQuestion variant's canonical call carries no header.
// verifiedAsOf (#117): the git sha the caller itself read the repo at, right before
// composing this body — a plain `Verified-as-of: {sha}` metadata line, rendered before
// Origin:/Defer-reason: (extracted by extractVerifiedAsOf, above). Validated against a
// bare hex-sha shape so an obviously wrong value (a date, a branch name) fails loud here
// rather than filing a stamp nothing can compare against. The caller MUST resolve this
// value itself, at read time — never pass a value this function re-derives or that was
// resolved earlier than the read that produced currentState/deliverables, or a queued
// finding filed later stamps a commit it never actually looked at (worse than no stamp —
// see the Gotchas in issue #117).
function specShapedBody({
  header, currentState, deliverables, acceptanceCriteria, openQuestion, filedBy, provenance, footer, verifiedAsOf,
} = {}) {
  const isEmpty = (value) => value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);
  const hasAC = !isEmpty(acceptanceCriteria);
  const hasOQ = !isEmpty(openQuestion);
  if (hasAC === hasOQ) {
    throw new Error('specShapedBody: exactly one of acceptanceCriteria/openQuestion is required');
  }
  const sections = [
    ['currentState', currentState],
    ['deliverables', deliverables],
    ['filedBy', filedBy],
  ];
  for (const [name, value] of sections) {
    if (isEmpty(value)) {
      throw new Error(`specShapedBody: ${name} is required and must be non-empty`);
    }
  }
  if (!isEmpty(verifiedAsOf) && !SHA_SHAPE_RE.test(verifiedAsOf)) {
    throw new Error(`specShapedBody: verifiedAsOf must be a git commit sha (got "${verifiedAsOf}")`);
  }
  const { origin, deferReason } = provenance || {};
  if (deferReason !== undefined) oneOf('deferReason', deferReason, DEFER_REASONS);
  const block = (v) => (Array.isArray(v) ? v.join('\n\n') : v);
  const parts = [];
  if (!isEmpty(header)) parts.push(header);
  if (!isEmpty(verifiedAsOf)) parts.push(`Verified-as-of: ${verifiedAsOf.toLowerCase()}`);
  if (!isEmpty(origin)) parts.push(`Origin: ${origin}`);
  if (deferReason !== undefined) parts.push(`Defer-reason: ${deferReason}`);
  parts.push('## Current State', block(currentState), '## Deliverables', block(deliverables));
  if (hasOQ) parts.push('## Open Question', block(openQuestion));
  else parts.push('## Acceptance Criteria', block(acceptanceCriteria));
  if (footer === undefined) {
    parts.push(`_Filed by \`${filedBy}\`. Close to resolve; label \`wontfix\` to suppress future reports of this finding._`);
  } else if (footer !== null && !isEmpty(footer)) {
    parts.push(footer);
  }
  return parts.join('\n\n');
}

module.exports = {
  ORIGINS, TYPES, TIERS, PRIORITIES, DEFER_REASONS, LABELS, TYPE_LABELS, recordPayload, specShapedBody,
  FP_RE_WORK, FP_RE_LEGACY, FP_RE_WORK_PLAIN, extractFingerprint, extractVerifiedAsOf, normalizeLabelNames, parseRecordFacets,
  parseDependencies, parseDependencyAssumptions, buildNativeDependencyQuery,
  hasOpenNativeBlocker, CLASSIFICATION_SCORING, fenceFor, fencedBlock, parseSubIssues,
  buildNativeSubIssuesQuery, buildNativeParentQuery, partitionByOpenBodyBlockers, partitionByOpenNativeBlockers,
  buildLinkedPRQuery, partitionByOpenLinkedPR,
};
