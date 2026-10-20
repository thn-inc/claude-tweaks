// Multi-agent coordination primitive — pure helpers.
//
// Companion to skills/_shared/multi-agent-coordination.md. The markdown
// is the spec; this file is the deterministic logic future callers
// (Specs 02-04) test against. No I/O, no imports from other bin/lib/
// modules — pure functions and constants only.

const LINE_TOLERANCE_REPRODUCTION = 2;
const LINE_TOLERANCE_DEBATE = 5;
// #2955: two reproduction agents can anchor one finding on different lines
// of the same multi-line statement, landing more than
// LINE_TOLERANCE_REPRODUCTION apart. A same-path pair within this wider
// bound still pairs, but only on known substance agreement at least
// SUBSTANCE_SIMILARITY_MIN (#3418: the same threshold as inside ±2, so the
// wide band no longer carries its own floor). Same value as
// LINE_TOLERANCE_DEBATE today, kept as its own name so the two can diverge.
const LINE_TOLERANCE_REPRODUCTION_WIDE = 5;
// #3604: line window for cross-lens corroboration of single-read findings at
// review's medium tier (see corroborateCrossLens below). Same value as
// LINE_TOLERANCE_DEBATE today, kept as its own name so the two can diverge.
const LINE_TOLERANCE_CORROBORATION = 5;
const REPRODUCTION_AGENT_COUNT = 2;
const DEBATE_AGENT_COUNT = 2;

// #1980: minimum token-Jaccard similarity for two findings' `text` to count
// as "the same substance" — a second signal alongside location, so a
// same-location pair that is NOT the same underlying issue no longer gets
// silently merged by categoriseReproduction (see sameSubstance below).
//
// #3418: calibrated on 73 archived reproduction pairs (same path, within ±5
// lines, drawn from 41 review runs). Different defects scored 0.00-0.15, and
// 54 of 59 same-defect pairs scored at least 0.20. One threshold covers the
// whole ±5 band, which supersedes #2955's separate 0.6 wide floor.
//
// #2331: distinct from near-duplicate.js's DEFAULT_TITLE_SIMILARITY_THRESHOLD
// by design, not oversight — same Jaccard-over-tokens primitive, but tuned
// against a different input domain (free-text finding descriptions here vs.
// short imperative record titles there), each threshold calibrated for its
// own domain's false-positive rate. Consolidating the constants would risk
// silently shifting one or both call sites' behavior; see this module's
// tokenizeSubstance vs. near-duplicate.js's tokenizeTitle for the matching
// preprocessing difference (path:line stripping vs. #N record-ref stripping).
const SUBSTANCE_SIMILARITY_MIN = 0.2;

// Minimal stop-word list for sameSubstance's tokenizer — just enough to keep
// common connective words from diluting the Jaccard score; not a general NLP
// tool, so no attempt at completeness.
//
// #2331: kept separate from near-duplicate.js's STOP_WORDS — this list is
// tuned for free-text finding descriptions, not the short imperative titles
// that list targets (which needs extra filler words like "should"/"will"/
// "again" that rarely appear in finding text). Merging the lists risks
// changing which words get filtered for either caller.
const SUBSTANCE_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'not',
  'no', 'this', 'that', 'it', 'its', 'as', 'by', 'from', 'into', 'than',
  'then', 'so', 'do', 'does', 'did',
]);

const SEVERITY_BUCKETS = {
  critical: 'high',
  high: 'high',
  medium: 'low',
  low: 'low',
  info: 'low',
};
// Alternative scheme (from spec gotchas): { critical: 'crit', high: 'mid',
// medium: 'mid', low: 'low', info: 'low' }. Swap by replacing the map above.

// Ordering used only to resolve a *confirmed* severity when a reproduction
// pair straddles a bucket boundary (see categoriseReproduction's
// reconcileSeverity below) — a separate concern from SEVERITY_BUCKETS, which
// only ever groups values into the coarse high/low pair used for matching.
const SEVERITY_RANK = ['info', 'low', 'medium', 'high', 'critical'];

const RED_TEAM_PERSONAS = [
  {
    name: 'Implementer',
    lens: 'Could I build exactly what this asks for without asking a question?',
  },
  {
    name: 'Maintainer',
    lens: "In 6 months, can someone changing related code know what they can/can't break?",
  },
  {
    name: 'Skeptical Reviewer',
    lens: 'What unstated assumption is doing the load-bearing work here?',
  },
];

function severityBucket(severity) {
  // Case-insensitive: a dispatched agent's transcription may capitalize the
  // severity value (normalizeFinding's own header-key handling below already
  // anticipates a capitalized "Severity" table-header key, so a capitalized
  // *value* like "Critical" is an equally realistic input shape). Without
  // lowercasing first, 'Critical' misses every key in SEVERITY_BUCKETS (which
  // is all-lowercase) and silently falls into the 'low' bucket regardless of
  // its real severity.
  if (typeof severity !== 'string') return 'low';
  return SEVERITY_BUCKETS[severity.toLowerCase()] || 'low';
}

// Same case-insensitivity/non-string-safety posture as severityBucket above,
// but returns a fine-grained rank (not a coarse bucket) — used only to pick
// a deterministic "lower of the two" severity when a reproduction pair
// straddles a bucket boundary. An unrecognized or missing severity ranks as
// the lowest ('info'), never as the highest — silently promoting a
// malformed value to the top of the scale would be the more dangerous
// default.
function severityRank(severity) {
  if (typeof severity !== 'string') return 0;
  const idx = SEVERITY_RANK.indexOf(severity.toLowerCase());
  return idx === -1 ? 0 : idx;
}

// Template A (skills/_shared/subagent-dispatch-core.md) mandates dispatched
// agents return findings as a markdown table with a single combined
// "Path:Line" column (e.g. "src/auth.ts:42"), not separate path/line fields.
// findingsMatch/categoriseReproduction/detectCrossLensOverlap below compare
// on separate `.path`/`.line` fields, so parsePathLine/normalizeFinding are
// the bridge between Template A's literal output shape and what these
// functions require — without it, a caller that transcribes the table
// without splitting that column (leaving `.path`/`.line` undefined, or
// `.path` holding the combined string with no `.line`) makes every finding
// pair spuriously "match": `a.path !== b.path` is `undefined !== undefined`
// = false, and `Math.abs(a.line - b.line) > tolerance` is `NaN > tolerance`
// = false — neither check short-circuits, so the reproduction/overlap gate
// silently passes everything regardless of actual location.

function parsePathLine(pathLine) {
  if (typeof pathLine !== 'string') return { path: pathLine, line: undefined };
  const idx = pathLine.lastIndexOf(':');
  if (idx === -1) return { path: pathLine, line: undefined };
  const lineStr = pathLine.slice(idx + 1);
  // An empty (or whitespace-only) trailing segment — e.g. "src/auth.ts:" with
  // no line number after the colon — must resolve to "no line", not 0.
  // Number("") and Number(" ") both coerce to 0 in JS (not NaN), which would
  // otherwise silently produce a real, matchable line number out of a
  // location nobody actually reported.
  if (lineStr.trim() === '') return { path: pathLine, line: undefined };
  const line = Number(lineStr);
  if (Number.isNaN(line)) return { path: pathLine, line: undefined };
  return { path: pathLine.slice(0, idx), line };
}

// #1980: pulls a finding's substance text out of whichever key actually
// carries it — the lens agents' JSON column is `Finding` (Template A's
// combined-string transcription convention, mirrored by parsePathLine's own
// `Path:Line`/`Severity` handling above), while test fixtures and some
// callers use plain `text`. First present of text/finding/Finding/summary/
// Summary, trimmed; `null` when none of them hold a string — "unknown", not
// "empty", so sameSubstance below can tell the two apart.
function extractText(finding) {
  if (typeof finding.text === 'string') return finding.text.trim();
  const keys = ['finding', 'Finding', 'summary', 'Summary'];
  for (const key of keys) {
    if (typeof finding[key] === 'string') return finding[key].trim();
  }
  return null;
}

function normalizeFinding(finding) {
  if (!finding || typeof finding !== 'object') return finding;
  // `.line` must actually be a real, finite number for the "already split"
  // fast path to be trusted — a non-numeric leftover (e.g. `line: 'n/a'`)
  // must NOT short-circuit here, or the garbage value survives untouched
  // into findingsMatch's guard below.
  const hasNumericLine = typeof finding.line === 'number' && !Number.isNaN(finding.line);
  const hasSeparateFields = finding.path !== undefined && hasNumericLine;
  if (hasSeparateFields) {
    // Only allocate a new object when there is actually a normalized `text`
    // to add (an alternate key, or a `text` value that needed trimming) —
    // a finding with no text-bearing key at all must come back as the exact
    // same reference, pinned by the "already-split findings pass through
    // untouched" test.
    const text = extractText(finding);
    if (text === null || text === finding.text) return finding;
    return { ...finding, text };
  }
  // finding.path may itself hold the combined "path:line" string (a naive
  // transcription that never split it out), or the combined string may be
  // sitting under the literal table-header key "Path:Line" (a transcription
  // that copied the markdown column header verbatim as the JSON key).
  const rawPathLine = finding.path !== undefined ? finding.path : finding['Path:Line'];
  const parsed = parsePathLine(rawPathLine);
  const severity = finding.severity !== undefined ? finding.severity : finding.Severity;
  const text = extractText(finding);
  if (parsed.line === undefined) {
    // No usable location could be recovered — either the combined-string
    // parse failed, or `.line` held a non-numeric value with no colon-
    // embedded fallback in `.path`. Explicitly clear `.line` (rather than
    // leaving whatever garbage was there) so downstream guards see this as
    // unlocated instead of quietly falling through with a value that looks
    // present but isn't a real number.
    return { ...finding, line: undefined, severity, text };
  }
  return { ...finding, path: parsed.path, line: parsed.line, severity, text };
}

// Shared "do these two normalized findings refer to the same location?"
// guard, used by both findingsMatch and detectCrossLensOverlap. A finding
// with no known, numeric location can never be judged to match another by
// location — without these explicit checks, `undefined !== undefined`
// (false) and `NaN > tolerance` / `NaN <= tolerance` (also false) all fail
// to short-circuit, so two entirely unrelated, unlocated findings would
// fall through and spuriously "match".
function sameLocation(na, nb, tolerance) {
  if (!na || typeof na !== 'object' || !nb || typeof nb !== 'object') return false;
  if (na.path === undefined || nb.path === undefined) return false;
  if (typeof na.line !== 'number' || typeof nb.line !== 'number') return false;
  if (Number.isNaN(na.line) || Number.isNaN(nb.line)) return false;
  if (na.path !== nb.path) return false;
  return Math.abs(na.line - nb.line) <= tolerance;
}

// #1980: tokenizer for sameSubstance's Jaccard comparison — lowercase,
// strip any embedded `path:line` fragment (so two findings that both quote
// the same file location in their text don't inflate the score on that
// alone), strip punctuation, drop stop words.
function tokenizeSubstance(text) {
  const withoutLocations = text.replace(/\S+:\d+/g, ' ');
  return withoutLocations
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !SUBSTANCE_STOP_WORDS.has(word));
}

function jaccard(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Returns a similarity score in [0, 1], or `null` when either normalized
// finding has no usable `.text` — "unknown", not "zero similarity", so
// callers (sameSubstance, categoriseReproduction's best-candidate pick) can
// tell "we don't know" apart from "we know, and it's different."
function substanceSimilarity(na, nb) {
  const ta = na && typeof na.text === 'string' ? na.text : null;
  const tb = nb && typeof nb.text === 'string' ? nb.text : null;
  if (ta === null || tb === null) return null;
  const normA = ta.trim().toLowerCase();
  const normB = tb.trim().toLowerCase();
  if (normA.length === 0 || normB.length === 0) return null;
  if (normA === normB) return 1;
  if (normA.startsWith(normB) || normA.endsWith(normB) || normB.startsWith(normA) || normB.endsWith(normA)) {
    return 1;
  }
  return jaccard(tokenizeSubstance(ta), tokenizeSubstance(tb));
}

// Tri-state: `true` (at/above SUBSTANCE_SIMILARITY_MIN, or a prefix/suffix
// match), `false` (both texts known, similarity below the floor), or `null`
// (unknown — one or both sides carry no text). `null` behaves like `true`
// for pairing purposes (categoriseReproduction below) — a missing text
// column must never discard a location-only match, matching today's
// pre-#1980 behavior for that case.
function sameSubstance(na, nb) {
  const score = substanceSimilarity(na, nb);
  if (score === null) return null;
  return score >= SUBSTANCE_SIMILARITY_MIN;
}

function findingsMatch(a, b, tolerance = LINE_TOLERANCE_REPRODUCTION) {
  const na = normalizeFinding(a);
  const nb = normalizeFinding(b);
  if (!sameLocation(na, nb, tolerance)) return false;
  if (sameSubstance(na, nb) === false) return false;
  return severityBucket(na.severity) === severityBucket(nb.severity);
}

// Reconciles a matched reproduction pair's severity into the single value
// the caller sees on the confirmed finding. When both agents bucket the
// finding the same way, nothing changes — this is the pre-existing behavior,
// pinned by the "matching severity bucket" test. When the pair straddles a
// bucket boundary (e.g. high vs medium: agreement on location and substance,
// disagreement only on how severe it is), the finding is still reproduced —
// take the lower of the two severities as the deterministic confirmed value,
// and flag `severityContested: true` so a consumer (the Wrap-Up Console, a
// PR verdict comment) can surface the disagreement explicitly rather than
// silently picking a number. See #733.
//
// `lower.severity` is normalized before it lands on the output — a missing
// or malformed severity field ranks lowest via severityRank's own floor
// default, but would otherwise propagate through untouched (undefined/null)
// when that malformed side wins the tiebreak, silently dropping the
// `severity` key from any consumer that serializes the finding.
function reconcileSeverity(fa, fb) {
  if (severityBucket(fa.severity) === severityBucket(fb.severity)) return fa;
  const lower = severityRank(fa.severity) <= severityRank(fb.severity) ? fa : fb;
  const severity = typeof lower.severity === 'string' ? lower.severity : 'info';
  return { ...fa, severity, severityContested: true };
}

// #2907: assigns pairs best-first across every A finding, so which A
// finding a B finding pairs with no longer depends on the order agent A
// reported them in. Ranked by similarity (an unknown/`null` score ranks below
// every known one), then by the smaller line delta, then by A index, then by
// B index, so even a tie resolves the same way on every run.
//
// Best-first alone can still strand a finding both agents reported: when A1
// matches B1 best and B2 too, but A2 matches only B1, taking A1-B1 first
// leaves A2 with nothing. So every A finding left unpaired then tries an
// augmenting path (re-routing an already-paired A finding to another of its
// matches), which makes the result a maximum pairing: no pairing of these
// candidates confirms more findings, and pass 3 below relies on that.
function assignBestPairs(pairs, aToB, pairedB) {
  const rank = (score) => (score === null ? -1 : score);
  const ordered = [...pairs].sort((x, y) => rank(y.score) - rank(x.score)
    || x.delta - y.delta || x.aIndex - y.aIndex || x.bIndex - y.bIndex);
  const bToA = new Map();
  const matchesOf = new Map(); // A index → its B candidates, best first
  for (const pair of ordered) {
    if (!matchesOf.has(pair.aIndex)) matchesOf.set(pair.aIndex, []);
    matchesOf.get(pair.aIndex).push(pair.bIndex);
    if (aToB.has(pair.aIndex) || pairedB.has(pair.bIndex)) continue;
    aToB.set(pair.aIndex, pair.bIndex);
    bToA.set(pair.bIndex, pair.aIndex);
    pairedB.add(pair.bIndex);
  }
  const augment = (aIndex, visited) => {
    for (const bIndex of matchesOf.get(aIndex)) {
      if (visited.has(bIndex)) continue;
      visited.add(bIndex);
      const holder = bToA.get(bIndex);
      if (holder === undefined || augment(holder, visited)) {
        aToB.set(aIndex, bIndex);
        bToA.set(bIndex, aIndex);
        pairedB.add(bIndex);
        return true;
      }
    }
    return false;
  };
  for (const aIndex of matchesOf.keys()) {
    if (!aToB.has(aIndex)) augment(aIndex, new Set());
  }
}

function categoriseReproduction(agentAFindings, agentBFindings) {
  const normalizedA = agentAFindings.map((rawFa) => normalizeFinding(rawFa));
  const normalizedB = agentBFindings.map((rawFb) => normalizeFinding(rawFb));
  const ownLine = new Map(); // A index → B index, paired within ±2
  const wideLine = new Map(); // A index → B index, paired in the wide band
  const pairedB = new Set();

  // Pass 1 (#1980 + #2907): every ±2 pair whose substance is not known to
  // differ — an unknown score (`null`, a missing text column) still pairs,
  // per sameSubstance's contract above — assigned best-first across all A
  // findings. A different-substance neighbour is never reserved here: it may
  // still be another A finding's real twin.
  const ownLinePairs = [];
  normalizedA.forEach((fa, aIndex) => {
    normalizedB.forEach((fb, bIndex) => {
      if (!sameLocation(fa, fb, LINE_TOLERANCE_REPRODUCTION)) return;
      const score = substanceSimilarity(fa, fb);
      if (score !== null && score < SUBSTANCE_SIMILARITY_MIN) return;
      ownLinePairs.push({ aIndex, bIndex, score, delta: Math.abs(fa.line - fb.line) });
    });
  });
  assignBestPairs(ownLinePairs, ownLine, pairedB);

  // Pass 2 (#2955, #3418): the wide band, for A findings with no ±2 twin. A
  // pair 3-5 lines apart counts only on known substance agreement at least
  // SUBSTANCE_SIMILARITY_MIN, the same bar as inside ±2 — a missing text
  // column never pairs here. It runs after pass 1 so it never takes a B
  // finding another A finding reported on (nearly) the same line.
  const widePairs = [];
  normalizedA.forEach((fa, aIndex) => {
    if (ownLine.has(aIndex)) return;
    normalizedB.forEach((fb, bIndex) => {
      if (pairedB.has(bIndex)) return;
      if (!sameLocation(fa, fb, LINE_TOLERANCE_REPRODUCTION_WIDE)) return;
      const score = substanceSimilarity(fa, fb);
      if (score === null || score < SUBSTANCE_SIMILARITY_MIN) return;
      widePairs.push({ aIndex, bIndex, score, delta: Math.abs(fa.line - fb.line) });
    });
  });
  assignBestPairs(widePairs, wideLine, pairedB);

  const confirmed = [];
  for (const pairs of [ownLine, wideLine]) {
    [...pairs.keys()].sort((x, y) => x - y).forEach((aIndex) => {
      confirmed.push(reconcileSeverity(normalizedA[aIndex], normalizedB[pairs.get(aIndex)]));
    });
  }

  // Pass 3 (#1980): an A finding still unpaired takes its first ±2
  // neighbour nobody paired as a coincidence — do NOT merge. Both sides
  // surface in unconfirmed, each pointing at the other via `nearLocation`,
  // so a reviewer sees the coincidence instead of one finding silently
  // vanishing. That neighbour always differs in substance: pass 1's pairing
  // is maximum, so an A finding it left unpaired has no free ±2 match, and
  // pass 2 only removes B findings.
  const unconfirmed = [];
  const consumedB = new Set();
  normalizedA.forEach((fa, aIndex) => {
    if (ownLine.has(aIndex) || wideLine.has(aIndex)) return;
    const neighbour = normalizedB.findIndex((fb, bIndex) => !pairedB.has(bIndex) && !consumedB.has(bIndex)
      && sameLocation(fa, fb, LINE_TOLERANCE_REPRODUCTION));
    if (neighbour === -1) {
      unconfirmed.push({ ...fa, source: 'A' });
      return;
    }
    consumedB.add(neighbour);
    const fb = normalizedB[neighbour];
    unconfirmed.push({ ...fa, source: 'A', nearLocation: { source: 'B', path: fb.path, line: fb.line } });
    unconfirmed.push({ ...fb, source: 'B', nearLocation: { source: 'A', path: fa.path, line: fa.line } });
  });

  normalizedB.forEach((fb, bIndex) => {
    if (pairedB.has(bIndex) || consumedB.has(bIndex)) return;
    unconfirmed.push({ ...fb, source: 'B' });
  });

  return { confirmed, unconfirmed };
}

function detectCrossLensOverlap(findingsByLens) {
  const lenses = Object.keys(findingsByLens);
  const overlaps = [];

  for (let i = 0; i < lenses.length; i++) {
    for (let j = i + 1; j < lenses.length; j++) {
      const lensA = lenses[i];
      const lensB = lenses[j];
      for (const rawFa of findingsByLens[lensA]) {
        for (const rawFb of findingsByLens[lensB]) {
          const fa = normalizeFinding(rawFa);
          const fb = normalizeFinding(rawFb);
          if (sameLocation(fa, fb, LINE_TOLERANCE_DEBATE)) {
            overlaps.push({ lensA, lensB, findingA: fa, findingB: fb });
          }
        }
      }
    }
  }

  return overlaps;
}

// #3604: cross-lens corroboration for review's medium tier. A finding only one
// agent of a lens reported stays `unconfirmed` under the single-read rule even
// when a different lens independently reported the same defect. Two findings
// from different lenses are an edge when they share path within
// LINE_TOLERANCE_CORROBORATION AND known substance agreement
// (>= SUBSTANCE_SIMILARITY_MIN; missing text never corroborates). Clusters are
// the connected components of that edge graph (union-find) rather than a greedy
// pairing, so no finding can be stranded by an earlier pairing choice (the
// Greedy-assignment stranding precedent, #2907). A cluster qualifies when it
// spans >= 2 distinct lenses; one lens never corroborates itself.
//
// A qualifying cluster is then carved into rows so a chain (A~B, B~C, A and C
// apart) never silently absorbs a distinct finding: members ordered by
// severityRank descending, then input order; the first remaining member is a
// row's representative, and the row takes every remaining member that directly
// matches it (same location within ±5 and known substance agreement, any lens).
// A row's severity is its representative's — the highest, mirroring
// step3-routing.md's cross-lens de-dup rule — so a corroborating low finding
// never demotes a critical one. A row's `lenses` are its members' lenses plus
// those of the representative's cross-lens edge partners.
//
// Input: { [lens]: Finding[] } — the findings still `unconfirmed` per lens.
// Output: { corroborated: CorroboratedFinding[], unconfirmed: { [lens]: Finding[] } };
// `unconfirmed` keeps every input lens key (empty array when none remain).
function corroborateCrossLens(unconfirmedByLens) {
  const lenses = Object.keys(unconfirmedByLens);
  const nodes = lenses.flatMap((lens) => unconfirmedByLens[lens]
    .map((raw) => ({ lens, finding: normalizeFinding(raw) })));

  const directMatch = (i, j) => {
    if (!sameLocation(nodes[i].finding, nodes[j].finding, LINE_TOLERANCE_CORROBORATION)) return false;
    // Missing text (`null`) never corroborates, unlike the reproduction pairing.
    return sameSubstance(nodes[i].finding, nodes[j].finding) === true;
  };

  const parent = nodes.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const partners = nodes.map(() => []); // cross-lens edge partners per node
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].lens === nodes[j].lens) continue;
      if (!directMatch(i, j)) continue;
      partners[i].push(j);
      partners[j].push(i);
      parent[find(j)] = find(i);
    }
  }

  const clusters = new Map();
  nodes.forEach((_, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(i);
  });

  const corroborated = [];
  const consumed = new Set();
  for (const members of clusters.values()) {
    const clusterLenses = new Set(members.map((i) => nodes[i].lens));
    if (clusterLenses.size < 2) continue;
    members.forEach((i) => consumed.add(i));
    let remaining = [...members].sort((x, y) => severityRank(nodes[y].finding.severity)
      - severityRank(nodes[x].finding.severity) || x - y);
    while (remaining.length > 0) {
      const rep = remaining[0];
      const rowMembers = [rep, ...remaining.slice(1).filter((m) => directMatch(rep, m))];
      remaining = remaining.filter((m) => !rowMembers.includes(m));
      const rowLenses = new Set(rowMembers.map((i) => nodes[i].lens));
      partners[rep].forEach((p) => rowLenses.add(nodes[p].lens));
      if (rowLenses.size < 2) {
        throw new Error('corroborateCrossLens: a qualifying-cluster row names fewer than 2 lenses');
      }
      // eslint-disable-next-line no-unused-vars
      const { nearLocation, source, ...repFinding } = nodes[rep].finding;
      const buckets = new Set(rowMembers.map((i) => severityBucket(nodes[i].finding.severity)));
      const row = {
        ...repFinding,
        severity: SEVERITY_RANK[severityRank(repFinding.severity)],
        lenses: lenses.filter((lens) => rowLenses.has(lens)),
        members: rowMembers.map((i) => {
          const { lens, finding } = nodes[i];
          return { lens, path: finding.path, line: finding.line, severity: finding.severity, text: finding.text };
        }),
      };
      if (buckets.size > 1) row.severityContested = true;
      corroborated.push(row);
    }
  }

  const unconfirmed = {};
  lenses.forEach((lens) => { unconfirmed[lens] = []; });
  nodes.forEach((node, i) => {
    if (!consumed.has(i)) unconfirmed[node.lens].push(node.finding);
  });

  return { corroborated, unconfirmed };
}

function resolveDebate(verdictA, verdictB) {
  if (verdictA === 'agree' && verdictB === 'agree') return 'confirmed';
  if (verdictA === 'disagree' && verdictB === 'disagree') return 'unconfirmed';
  return 'contested';
}

// Sibling to resolveDebate, not an overload of it — the input/output shape
// differs on purpose. resolveDebate reconciles two judges into one of three
// buckets (confirmed/unconfirmed/contested); resolveRefutation takes a
// single verdict from one falsification agent and only ever moves a finding
// one direction: a `confirmed` finding that survives refutation stays
// `confirmed`, one that gets refuted downgrades to `unconfirmed`. There is
// no "contested" outcome here — a single agent's verdict has no second
// judge to disagree with. Ambiguity fails toward more scrutiny, not less —
// matching resolveDebate's own conservative default: only the exact literal
// 'not-refuted' keeps a finding confirmed. 'refuted', a missing/empty
// verdict, or any other malformed string (e.g. from a failed or BLOCKED
// dispatch) all downgrade to 'unconfirmed' — a failed refutation attempt
// must never be indistinguishable from a genuine "stands as confirmed."
function resolveRefutation(verdict) {
  return verdict === 'not-refuted' ? 'confirmed' : 'unconfirmed';
}

function buildReproductionDispatch(taskScope, profile = 'Standard') {
  const prompt = `${taskScope}\n\n[Use: ${profile}] (contract § Model Selection — reproduction agent, independent run)`;
  return {
    profile,
    agentCount: REPRODUCTION_AGENT_COUNT,
    agents: [
      { role: 'reproducer-A', prompt },
      { role: 'reproducer-B', prompt },
    ],
  };
}

function buildDebateDispatch(contestedFinding, profile = 'Capable') {
  const prompt =
    `Review this finding and reply with verdict ('agree' / 'disagree' / 'partial') ` +
    `then one paragraph of reasoning:\n\n${JSON.stringify(contestedFinding)}\n\n` +
    `[Use: ${profile}] (contract § Model Selection — debate agent)`;
  return {
    profile,
    agentCount: DEBATE_AGENT_COUNT,
    rounds: 1,
    agents: [
      { role: 'debater-A', prompt },
      { role: 'debater-B', prompt },
    ],
  };
}

function buildRedTeamDispatch(specContent, profile = 'Standard') {
  return {
    profile,
    agentCount: RED_TEAM_PERSONAS.length,
    agents: RED_TEAM_PERSONAS.map((p) => ({
      role: p.name,
      prompt: `${p.lens}\n\nSpec under review:\n\n${specContent}\n\n[Use: ${profile}] (contract § Model Selection — ${p.name} persona)`,
    })),
  };
}

module.exports = {
  // Constants
  LINE_TOLERANCE_REPRODUCTION,
  LINE_TOLERANCE_REPRODUCTION_WIDE,
  LINE_TOLERANCE_DEBATE,
  LINE_TOLERANCE_CORROBORATION,
  REPRODUCTION_AGENT_COUNT,
  DEBATE_AGENT_COUNT,
  RED_TEAM_PERSONAS,
  SUBSTANCE_SIMILARITY_MIN,
  // Comparison / aggregation logic
  severityBucket,
  severityRank,
  parsePathLine,
  normalizeFinding,
  sameLocation,
  sameSubstance,
  substanceSimilarity,
  findingsMatch,
  categoriseReproduction,
  detectCrossLensOverlap,
  corroborateCrossLens,
  resolveDebate,
  resolveRefutation,
  // Dispatch shape builders (pure data — no actual Task() calls)
  buildReproductionDispatch,
  buildDebateDispatch,
  buildRedTeamDispatch,
};
