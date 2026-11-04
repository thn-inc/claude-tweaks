// Cross-repository blocker refs — the body-declared half of #4793 (Decisions Q7
// and the Plan Review Clarifications). A record may say 'Blocked by owner/name#N'
// for a blocker that lives in another repository; this module parses that
// grammar and shapes its entries like Task 1's native `crossRepoBlockers`
// entries ({number, repository, state}), so record.js's openBlockerRefs /
// foreignBlockerBlocks / foreignBlockerRef apply to both unchanged.
//
// Pure: requires nothing and shells out nowhere — the property
// batching-failure-posture.md names for record-dependencies.js's builders. Code
// that runs gh lives in its own module. Not re-exported through record.js;
// consumers require this file directly.
//
// parseDependencies / DEP_RE in record-dependencies.js stay numbers-only (every
// caller treats the result as this repository's issue numbers). DEP_RE never
// matches a qualified line, because it needs '#' right after 'Blocked by '.
//
// Linearity (perf/cross-repo-dependency-linearity.test.js): both character
// classes exclude the '/' and '#' terminators, so a line costs one attempt at
// its start; the strip regex's left-boundary lookbehind keeps a long token from
// restarting at every character (regex-scan-linearity, shape 1).
'use strict';

// GraphQL Int is a signed 32-bit integer; issue(number:) rejects anything above it.
const GRAPHQL_INT_MAX = 2147483647;

const CROSS_REPO_DEP_RE = /^Blocked by ([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)#(\d+)\b/gm;
const CROSS_REPO_REF_RE = /^([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)#(\d+)$/;
const CROSS_REPO_STRIP_RE = /(?<![A-Za-z0-9-])[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#\d+/g;

// {repository, number} -> the case-insensitive identity two spellings of one blocker share.
function crossRepoKey({ repository, number }) {
  return `${repository.toLowerCase()}#${number}`;
}

// 'owner/name#N' (the whole string) -> {repository, number}, or null when it is not that
// grammar. The range is not checked here — buildCrossRepoStateQuery owns that.
function parseCrossRepoRef(ref) {
  if (typeof ref !== 'string') return null;
  const m = CROSS_REPO_REF_RE.exec(ref);
  return m ? { repository: m[1], number: Number(m[2]) } : null;
}

// body -> the qualified refs from line-anchored 'Blocked by owner/name#N' lines, in order of
// first appearance, deduped by crossRepoKey (first spelling kept); [] for a non-string or
// empty body. The regex carries 'g', but matchAll clones it per call, so no lastIndex state
// is shared across calls.
function parseCrossRepoDependencies(body) {
  if (typeof body !== 'string' || !body) return [];
  const seen = new Set();
  const refs = [];
  for (const m of body.matchAll(CROSS_REPO_DEP_RE)) {
    const key = crossRepoKey({ repository: m[1], number: Number(m[2]) });
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(`${m[1]}#${m[2]}`);
  }
  return refs;
}

// refs + Map(crossRepoKey -> state) -> one {number, repository, state} entry per ref, deduped by
// key. `state` is the map's value when that is a string, else null (unread reads as unknown).
function foreignEntries(refs, states) {
  if (!Array.isArray(refs)) return [];
  const seen = new Set();
  const entries = [];
  for (const ref of refs) {
    const parsed = parseCrossRepoRef(ref);
    if (!parsed) continue;
    const key = crossRepoKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    const state = states instanceof Map ? states.get(key) : undefined;
    entries.push({ number: parsed.number, repository: parsed.repository, state: typeof state === 'string' ? state : null });
  }
  return entries;
}

// The `body` entries whose key is not among `native`'s keys.
function bodyOnlyForeign(native = [], body = []) {
  const known = new Set(native.map(crossRepoKey));
  return body.filter((entry) => !known.has(crossRepoKey(entry)));
}

// Native entries first, then only the body entries native lacks.
function mergeForeignBlockers(native = [], body = []) {
  return [...native, ...bodyOnlyForeign(native, body)];
}

// text -> text with every qualified ref removed.
function stripCrossRepoRefs(text) {
  return text.replace(CROSS_REPO_STRIP_RE, '');
}

// keys ('owner/name#N') -> one batched query with an aliased repository/issue lookup per key,
// owner and name passed as String! variables. Returns null for a non-array or empty input;
// throws on a key parseCrossRepoRef rejects or a number above GRAPHQL_INT_MAX (callers filter).
function buildCrossRepoStateQuery(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const declarations = [];
  const aliases = [];
  const fields = [];
  keys.forEach((key, i) => {
    const parsed = parseCrossRepoRef(key);
    if (!parsed) throw new Error(`buildCrossRepoStateQuery: not an owner/name#N ref: ${key}`);
    if (parsed.number > GRAPHQL_INT_MAX) throw new Error(`buildCrossRepoStateQuery: issue number above ${GRAPHQL_INT_MAX}: ${key}`);
    const [owner, name] = parsed.repository.split('/');
    declarations.push(`$o${i}:String!`, `$n${i}:String!`);
    aliases.push(`c${i}: repository(owner:$o${i},name:$n${i}){ issue(number:${parsed.number}){ state } }`);
    fields.push([`o${i}`, owner], [`n${i}`, name]);
  });
  return { query: `query(${declarations.join(',')}){ ${aliases.join(' ')} }`, fields };
}

module.exports = {
  GRAPHQL_INT_MAX, CROSS_REPO_DEP_RE,
  parseCrossRepoDependencies, parseCrossRepoRef, crossRepoKey,
  foreignEntries, bodyOnlyForeign, mergeForeignBlockers,
  stripCrossRepoRefs, buildCrossRepoStateQuery,
};
