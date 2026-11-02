// bin/lib/wrap-up/packet-gather.js — the acceptance packet's facts (#4611): what the
// spec expects, what verify, QA and review recorded, and what git says changed, joined
// into one fact set with every gap stated in `partial`. Also reads the packet comment
// back off a record.
//
// Pure: no git, gh or fs. The CLI reads the inputs and passes them in.
'use strict';

const crypto = require('crypto');
const {
  SCHEMA_VERSION,
  PACKET_MARKER_RE,
  COMMANDS_ONLY_SURFACES,
  encodeFactKey,
} = require('./packet-contract');
const { checkLink, findCredentialInText } = require('./packet-links');
const { isTrustedComment, untrustedSkipNote } = require('../issues/comment-trust');
const { SECTIONS: CONSOLE_SECTIONS } = require('../console/resolve');

const AC_HEADING_RE = /^## Acceptance Criteria\s*$/i;
const SECTION_HEADING_RE = /^## /;
const AC_ITEM_RE = /^(\d+[a-z]?)\.\s+(.*)$/;
// A backtick fence's info string holds no backtick, so a line opening with inline
// code never swallows the rest of the section as a false fence.
const FENCE_RE = /^ {0,3}(?:(`{3,})([^`]*)|(~{3,})(.*))$/;

const NEGATIVE_ID_PREFIX = 'neg-';
const NEGATIVE_TAG = 'negative';
const STORY_ITEM_RE = /^(\s*)-\s+id:\s*(.*)$/;
const STORY_KEY_RE = /^-\s+/;
const INLINE_TAGS_RE = /^tags:\s*\[(.*?)\]/;
const BLOCK_TAGS_RE = /^tags:\s*(?:#.*)?$/;
const BLOCK_ITEM_RE = /^-\s+(.*)$/;

const QA_SELECTION_RE = /QA (?:scoped: (\d+)\/\d+|skipped: (\d+) selected stories)/g;
const DECISION_ID_RE = /^decision:.*#([0-9a-f]{8})(?:-\d+)?$/;
const TIEBREAK_PREFIX = 'tiebreak:';
// Each runs to its sentence's end. A `.` inside a path is not one.
const LOW_CONFIDENCE_NOTE_RE = /\s*Staged to Review Console as low-confidence.*?(?:\.(?=\s|$)|$)/;
const REVERSIBILITY_CLAUSE_RE = /\s*Reversibility:.*?(?:\.(?=\s|$)|$)/;
const DECISION_LEAD_IN = ' — ';

const AC_MET = 'met';
const AC_FAILED_VERDICTS = Object.freeze(['partially met', 'not met']);
const AC_VERDICTS = Object.freeze([AC_MET, ...AC_FAILED_VERDICTS]);

const NO_CHECK_RESULT = Object.freeze({ status: 'not-run', reason: 'no result recorded' });
const SHA7_CHARS = 7;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownValue = (object, key) => (isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined);

// ---- acceptance criteria ----

function parseAcceptanceCriteria(specText) {
  const criteria = [];
  let inSection = false;
  let fence = null;
  for (const line of specText.split(/\r?\n/)) {
    const fenceLine = FENCE_RE.exec(line);
    const marker = fenceLine && (fenceLine[1] || fenceLine[3]);
    if (fence) {
      const trailing = fenceLine && (fenceLine[2] ?? fenceLine[4]);
      const closes = marker && marker[0] === fence[0] && marker.length >= fence.length && trailing.trim() === '';
      if (closes) fence = null;
    } else if (marker) {
      fence = marker;
    } else if (SECTION_HEADING_RE.test(line)) {
      inSection = AC_HEADING_RE.test(line);
    } else if (inSection) {
      const item = AC_ITEM_RE.exec(line);
      if (item) criteria.push({ id: item[1], text: item[2] });
    }
  }
  return criteria;
}

function acFact({ id, text }, acResults) {
  const value = ownValue(acResults, id);
  let result;
  if (value === undefined) result = { status: 'not-run', reason: 'no spec-compliance result recorded' };
  else if (value === AC_MET) result = { status: 'passed' };
  else if (AC_FAILED_VERDICTS.includes(value)) result = { status: 'failed', reason: value };
  else result = { status: 'not-run', reason: 'unrecognized spec-compliance value' };
  return { id: `check:ac-${encodeFactKey(id)}`, kind: 'check', source: 'spec-compliance', text, ...result };
}

// ---- review findings ----

function decisionFindingText(decisions, hash) {
  const line = decisions.split(/\r?\n/).find((candidate) => (
    crypto.createHash('sha256').update(candidate).digest('hex').startsWith(hash)
  ));
  if (line === undefined) return null;
  const leadIn = line.indexOf(DECISION_LEAD_IN);
  const body = leadIn === -1 ? line : line.slice(leadIn + DECISION_LEAD_IN.length);
  return body.replace(LOW_CONFIDENCE_NOTE_RE, '').replace(REVERSIBILITY_CLAUSE_RE, '').trim() || null;
}

function tiebreakFindingText(findings, id) {
  const finding = findings.find((candidate) => candidate?.id === id);
  return typeof finding?.claim === 'string' && finding.claim.trim() !== ''
    ? `${finding.path}:${finding.line} ${finding.claim}`
    : null;
}

function stagedFindingText(text) {
  if (typeof text !== 'string') return null;
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function lowConfidenceFindings({ items, findings, decisions }, readStaged) {
  return items
    .filter((item) => item.section === CONSOLE_SECTIONS.LOW)
    .map(({ id }, index) => {
      const decision = DECISION_ID_RE.exec(id);
      let text;
      if (decision) text = decisionFindingText(decisions, decision[1]);
      else if (id.startsWith(TIEBREAK_PREFIX)) text = tiebreakFindingText(findings, id.slice(TIEBREAK_PREFIX.length));
      else text = stagedFindingText(readStaged(id));
      return { n: index + 1, text: text ?? id };
    });
}

// ---- QA and verify inputs ----

function qaSelectionFromDecisions(decisionsText) {
  let highest = 0;
  for (const match of (decisionsText ?? '').matchAll(QA_SELECTION_RE)) {
    highest = Math.max(highest, Number(match[1] ?? match[2]));
  }
  return highest;
}

function expectedChecksFromDeclaration(decl) {
  if (decl === null) return null;
  return [...decl.suites, ...['types', 'lint'].filter((key) => decl.checks[key] !== null)];
}

const stripYamlComment = (value) => value.replace(/\s+#.*$/, '').trim();
const stripYamlQuotes = (value) => value.replace(/^(["'])(.*)\1$/, '$2');
const yamlScalar = (value) => stripYamlQuotes(stripYamlComment(value));
const indentOf = (line) => line.length - line.trimStart().length;

// Reads one line inside a story item. `tagsOpen` is the item's block-list state: the
// list stays open only while its `- ` lines continue directly under the key. YAML also
// allows them at the key's own indent, and no key of this item can start with `- `.
function readStoryLine(line, story) {
  const indent = indentOf(line);
  const body = line.trim();
  if (story.tagsOpen) {
    const entry = indent >= story.keyIndent ? BLOCK_ITEM_RE.exec(body) : null;
    if (entry) {
      if (yamlScalar(entry[1]) === NEGATIVE_TAG) story.negative = true;
      return;
    }
    story.tagsOpen = false;
  }
  if (indent !== story.keyIndent) return;
  const inline = INLINE_TAGS_RE.exec(body);
  if (inline) {
    if (inline[1].split(',').map(yamlScalar).includes(NEGATIVE_TAG)) story.negative = true;
  } else if (BLOCK_TAGS_RE.test(body)) {
    story.tagsOpen = true;
  }
}

function parseStoryFile(text) {
  const stories = [];
  let itemIndent = null;
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const body = line.trim();
    if (body === '' || body.startsWith('#')) continue;
    const item = STORY_ITEM_RE.exec(line);
    if (item && (itemIndent === null || item[1].length === itemIndent)) {
      itemIndent = item[1].length;
      const id = yamlScalar(item[2]);
      current = {
        id,
        negative: id.startsWith(NEGATIVE_ID_PREFIX),
        tagsOpen: false,
        keyIndent: itemIndent + STORY_KEY_RE.exec(line.trimStart())[0].length,
      };
      stories.push(current);
    } else if (itemIndent !== null && indentOf(line) <= itemIndent) {
      current = null;
    } else if (current) {
      readStoryLine(line, current);
    }
  }
  return stories.filter(({ id }) => id !== '').map(({ id, negative }) => ({ id, negative }));
}

function storyResult({ id, status, error }) {
  const reasonOr = (fallback) => (typeof error === 'string' && error !== '' ? error : fallback);
  switch (status) {
    case 'PASS':
    case 'PASS_WITH_CAVEATS':
      return { id, status: 'passed' };
    case 'FAIL':
      return { id, status: 'failed', reason: reasonOr('story failed') };
    case 'SKIPPED':
      return { id, status: 'skipped', reason: reasonOr('skipped') };
    default:
      return { id, status: 'not-run', reason: `unrecognized QA status ${status}` };
  }
}

function storyResultsFromQaReport(report) {
  if (!isObject(report) || !Array.isArray(report.stories)) return null;
  return report.stories
    .filter((entry) => typeof entry?.id === 'string' && entry.id !== '')
    .map(storyResult);
}

function storiesFromQaStamp(stamp, head) {
  if (!stamp || !head || stamp.sha !== head) return null;
  return stamp.stories.map(({ id }) => ({ id, status: 'passed' }));
}

// ---- facts ----

function changeFacts(changes, commits) {
  return [
    ...(changes ?? []).map(({ path }) => ({
      id: `change:${encodeFactKey(path)}`, kind: 'change', status: 'passed', source: 'git', text: path,
    })),
    ...(commits ?? []).map(({ sha, subject }) => ({
      id: `change:commit-${encodeFactKey(sha.slice(0, SHA7_CHARS))}`, kind: 'change', status: 'passed', source: 'git', text: subject,
    })),
  ];
}

function verifyCheckResult(entry) {
  if (!isObject(entry)) return NO_CHECK_RESULT;
  if (entry.exitCode === 0) return { status: 'passed' };
  if (entry.skipped) return { status: 'skipped', reason: String(entry.skipped) };
  // A null exit code is a hang or a spawn failure, which verify already counts as failed.
  if (entry.exitCode === undefined) return NO_CHECK_RESULT;
  const summary = typeof entry.summary === 'string' && entry.summary !== '' ? entry.summary : null;
  return { status: 'failed', reason: summary ?? `exit ${entry.exitCode}` };
}

function checkFacts(report, expectedChecks) {
  const results = isObject(report?.checks) ? report.checks : {};
  const names = new Set([...(expectedChecks ?? []), ...Object.keys(results)]);
  return [...names].map((name) => {
    const entry = ownValue(results, name);
    return {
      id: `check:${encodeFactKey(name)}`,
      kind: 'check',
      source: entry === undefined ? 'verify-scope' : 'verify-report',
      ...verifyCheckResult(entry),
    };
  });
}

function storyFacts(storyIndex, storyResults, stampStories) {
  const negativeById = new Map((storyIndex ?? []).map(({ id, negative }) => [id, negative]));
  const isNegative = (id) => negativeById.get(id) ?? id.startsWith(NEGATIVE_ID_PREFIX);
  const stamped = new Set((stampStories ?? []).map(({ id }) => id));
  const fromReport = (storyResults ?? []).filter(({ id }) => !stamped.has(id)).map(({ id, status, reason }) => ({
    id: `story:${encodeFactKey(id)}`,
    kind: 'story',
    status,
    source: 'qa-report',
    negative: isNegative(id),
    ...(reason === undefined ? {} : { reason }),
  }));
  const fromStamp = [...stamped].map((id) => ({
    id: `story:${encodeFactKey(id)}`, kind: 'story', status: 'passed', source: 'qa-stamp', negative: isNegative(id),
  }));
  return [...fromReport, ...fromStamp];
}

// A link names exactly one of a command or a url, and a command wins: an unscreened
// url must not sit on a fact the renderer would never show.
function linkOutcome({ id, label, url, command }, surface, allowedHosts) {
  const factId = `link:${encodeFactKey(id)}`;
  const refuse = (reason) => ({ refused: { id: factId, reason } });
  const accept = (target) => ({
    fact: { id: factId, kind: 'link', status: 'passed', source: 'links', ...(label === undefined ? {} : { label }), ...target },
  });
  if (command) {
    const key = findCredentialInText(command);
    return key ? refuse(`credential key in command: ${key}`) : accept({ command });
  }
  if (COMMANDS_ONLY_SURFACES.includes(surface)) return refuse('infra surface lists commands, not links');
  const check = checkLink(url, { allowedHosts });
  return check.ok ? accept({ url }) : refuse(check.reason);
}

function deployFact(deploy) {
  const { target, live } = deploy ?? { target: 'local', live: null };
  let text = `target: ${target}`;
  if (target === 'dev') text += live === true ? ', confirmed live' : ', not confirmed live';
  return { id: 'deploy:status', kind: 'deploy', status: 'passed', source: 'deploy', text, target, live };
}

// A pass-through record may already spell its id with the kind.
function passThroughFacts(kind, source, entries) {
  const prefix = `${kind}:`;
  return (entries ?? []).map(({ id, text, url }) => ({
    id: `${prefix}${encodeFactKey(id.startsWith(prefix) ? id.slice(prefix.length) : id)}`,
    kind,
    status: 'passed',
    source,
    ...(text === undefined ? {} : { text }),
    ...(url === undefined ? {} : { url }),
  }));
}

function unmatchedAcKeys(acResults, criteria) {
  if (!isObject(acResults)) return [];
  const ids = new Set(criteria.map(({ id }) => id));
  return Object.keys(acResults).filter((key) => !ids.has(key) || !AC_VERDICTS.includes(acResults[key]));
}

function partialNotes(inputs, unmatched, repeated) {
  const { report, expectedChecks, specText, changes, commits, decisionsText, storyResults, stampStories, qaReportUnread } = inputs;
  const noCommits = (commits ?? []).length === 0;
  const qaExpected = qaReportUnread || qaSelectionFromDecisions(decisionsText) > 0;
  return [
    [report === null, 'verify report not found'],
    [expectedChecks === null, 'verify-scope declaration not read — expected checks not derived'],
    [specText === null, 'spec not found — acceptance criteria not derived'],
    [changes === null, 'git changes not gathered'],
    [changes !== null && changes.length === 0 && noCommits, 'git change range is empty — changes not listed'],
    [decisionsText === null, 'review decisions log not found'],
    [storyResults === null && stampStories === null && qaExpected, 'QA report not read — selected stories not listed'],
    [repeated.length > 0, `repeated fact ids, first kept: ${repeated.join(', ')}`],
    [unmatched.length > 0, `spec-compliance results match no acceptance criterion: ${unmatched.join(', ')}`],
  ].filter(([applies]) => applies).map(([, note]) => note);
}

function normalizeSurface(surface) {
  return typeof surface === 'string' ? surface.trim().toLowerCase() || null : null;
}

function gatherPacketFacts(inputs) {
  const surface = normalizeSurface(inputs.surface);
  const allowedHosts = [inputs.localBaseUrl, inputs.devBaseUrl].filter(Boolean);
  const criteria = inputs.specText === null ? [] : parseAcceptanceCriteria(inputs.specText);
  const linkOutcomes = (inputs.links ?? []).map((link) => linkOutcome(link, surface, allowedHosts));
  const acFacts = criteria.map((criterion) => acFact(criterion, inputs.acResults));
  const stories = storyFacts(inputs.storyIndex, inputs.storyResults, inputs.stampStories);

  const candidates = [
    ...changeFacts(inputs.changes, inputs.commits),
    ...checkFacts(inputs.report, inputs.expectedChecks),
    ...acFacts,
    ...stories,
    ...(inputs.lowConfidence ?? []).map(({ n, text }) => ({
      id: `finding:${n}`, kind: 'finding', status: 'passed', source: 'review', text,
    })),
    ...linkOutcomes.flatMap(({ fact }) => (fact ? [fact] : [])),
    deployFact(inputs.deploy),
    ...passThroughFacts('recording', 'recordings', inputs.recordings),
    ...passThroughFacts('flag', 'flags', inputs.flags),
    ...passThroughFacts('decision', 'decision-items', inputs.decisions),
  ];

  const byId = new Map();
  const repeated = new Set();
  for (const fact of candidates) {
    if (byId.has(fact.id)) repeated.add(fact.id);
    else byId.set(fact.id, fact);
  }

  const expected = new Set([
    ...(inputs.expectedChecks ?? []).map((name) => `check:${encodeFactKey(name)}`),
    ...acFacts.map(({ id }) => id),
    ...stories.map(({ id }) => id),
  ]);

  return {
    schemaVersion: SCHEMA_VERSION,
    record: inputs.record,
    surface,
    allowedHosts,
    partial: partialNotes(inputs, unmatchedAcKeys(inputs.acResults, criteria), [...repeated]),
    refused: linkOutcomes.flatMap(({ refused }) => (refused ? [refused] : [])),
    expected: [...expected],
    facts: [...byId.values()],
  };
}

// ---- reading the packet back ----

// gh spells it `createdAt`, the REST API behind the MCP transport `created_at`.
const createdInstant = (comment) => Date.parse(comment.createdAt ?? comment.created_at);

function earliestFirst(comments) {
  if (comments.some((comment) => Number.isNaN(createdInstant(comment)))) return comments;
  return [...comments].sort((a, b) => createdInstant(a) - createdInstant(b));
}

// Reads only the comments it is given: a run-dir copy of the packet may be stale.
function readPacket(comments) {
  const candidates = comments.filter((comment) => (
    typeof comment?.body === 'string' && PACKET_MARKER_RE.test(comment.body)
  ));
  const skipped = candidates.filter((comment) => !isTrustedComment(comment)).map(untrustedSkipNote);
  const [comment = null, ...rest] = earliestFirst(candidates.filter(isTrustedComment));
  if (comment === null) return { status: 'none', comment: null, version: null, extras: [], skipped };
  const version = Number(PACKET_MARKER_RE.exec(comment.body)[1]);
  return {
    status: version === SCHEMA_VERSION ? 'found' : 'unreadable',
    comment,
    version,
    extras: rest.map((extra) => String(extra.url || extra.html_url || extra.id)),
    skipped,
  };
}

module.exports = {
  parseAcceptanceCriteria,
  lowConfidenceFindings,
  qaSelectionFromDecisions,
  expectedChecksFromDeclaration,
  parseStoryFile,
  storyResultsFromQaReport,
  storiesFromQaStamp,
  gatherPacketFacts,
  readPacket,
};
