// bin/lib/wrap-up/packet-gather.js — the acceptance packet's facts (#4611): what the
// spec expects, what verify, QA and review recorded, and what git says changed, joined
// into one fact set with every gap stated in `partial`. Also reads the packet comment
// back off a record.
//
// Pure: no git, gh or fs. The CLI reads the inputs and passes them in.
'use strict';

const {
  SCHEMA_VERSION,
  PACKET_MARKER_RE,
  COMMANDS_ONLY_SURFACES,
  encodeFactKey,
} = require('./packet-contract');
const {
  BEARER_SEGMENT_REASON, checkLink, findCredentialInText, hasBearerUrl,
} = require('./packet-links');
const { redactOrWithhold } = require('../walkthrough/redact');
const { isTrustedComment, untrustedSkipNote } = require('../issues/comment-trust');
const { SECTIONS: CONSOLE_SECTIONS, decisionLineHash } = require('../console/resolve');

// The text is read up to a line terminator (`.` stops at one) and trimmed after, and
// what follows it must be whitespace. A trailing `\s*$` in the pattern is quadratic on a
// long whitespace run.
const HEADING_RE = /^(#{1,6})\s+(.*)/;
function parseHeading(line) {
  const match = HEADING_RE.exec(line);
  if (match === null || line.slice(match[0].length).trim() !== '') return null;
  return { level: match[1].length, text: match[2].trimEnd() };
}
const AC_HEADING_LEVELS = Object.freeze([2, 3]);
const AC_TITLE_RE = /^Acceptance Criteria(?:\s*\(.*\))?$/i;
// `1.`, `2a.`, `1)`, or bold: `**1.**`, `**1)**`.
const AC_NUMBERED_RE = /^(?:(\d+[a-z]?)[.)]\s+|\*\*(\d+[a-z]?)[.)]\*\*\s*)(\S.*)$/;
// `- `, `* `, `- [ ]`, `- [x]`. Anchored at column 0, so a nested bullet is not a criterion.
// A checkbox with no text states nothing, and must not shift the positional ids after it.
const AC_BULLET_RE = /^[-*]\s+(?!\[[ xX]\]\s*$)(?:\[[ xX]\]\s+)?(\S.*)$/;
const THEMATIC_BREAK_RE = /^(?:[-*_]\s*){3,}$/;
const POSITIONAL_AC_PREFIX = 'AC';
// A backtick fence's info string holds no backtick, so a line opening with inline
// code never swallows the rest of the section as a false fence.
const FENCE_RE = /^ {0,3}(?:(`{3,})([^`]*)|(~{3,})(.*))$/;

const NEGATIVE_ID_PREFIX = 'neg-';
const NEGATIVE_TAG = 'negative';
const STORIES_KEY_RE = /^stories:\s*(?:#.*)?$/;
// A bare `-` opens an item too, its keys on the lines below it.
const LIST_ITEM_RE = /^(\s*)(-(?:\s+|$))(.*)$/;
const ID_KEY_RE = /^id:\s*(.*)$/;
const FLOW_COMMENT_RE = /(?:^|\s)#.*$/;
const FLOW_TAGS_RE = /^tags:\s*\[(.*)$/;
const BLOCK_TAGS_RE = /^tags:\s*(?:#.*)?$/;
const BLOCK_ITEM_RE = /^-\s+(.*)$/;

const QA_SELECTION_RE = /QA (?:scoped: (\d+)\/\d+|skipped: (\d+) selected stories)/g;
const DECISION_ID_RE = /^decision:.*#([0-9a-f]{8})(?:-\d+)?$/;
const TIEBREAK_PREFIX = 'tiebreak:';
// Each runs to its sentence's end. A `.` inside a path is not one. The whitespace before
// a clause goes with it, but not through a leading `\s*` here: unanchored, that is
// quadratic on a long whitespace run, so stripClause walks back over it instead.
const LOW_CONFIDENCE_NOTE_RE = /Staged to Review Console as low-confidence.*?(?:\.(?=\s|$)|$)/;
const REVERSIBILITY_CLAUSE_RE = /Reversibility:.*?(?:\.(?=\s|$)|$)/;
const DECISION_LEAD_IN = ' — ';
const SETTLED_RESOLUTIONS = Object.freeze(['dismissed', 'dropped']);
// `Title: x`, `- Finding: x`, `- **Finding:** x`, the shapes archived staged files use.
const stagedFieldRe = (name) => new RegExp(`^(?:[-*]\\s+)?(?:\\*\\*)?${name}(?:\\*\\*)?:(?:\\*\\*)?[ \\t]*(\\S.*)$`, 'm');
const TITLE_FIELD_RE = stagedFieldRe('Title');
const FINDING_FIELD_RE = stagedFieldRe('Finding');
const FINDING_HEADING_RE = /^#{1,6}\s+Finding\s*$/;

const AC_MET = 'met';
const AC_FAILED_VERDICTS = Object.freeze(['partially met', 'not met']);
const AC_VERDICTS = Object.freeze([AC_MET, ...AC_FAILED_VERDICTS]);

const NO_CHECK_RESULT = Object.freeze({ status: 'not-run', reason: 'no result recorded' });
const SHA7_CHARS = 7;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownValue = (object, key) => (isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined);

// ---- acceptance criteria ----

// The lines outside code fences, the fence lines themselves excluded.
function linesOutsideFences(text) {
  const outside = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const fenceLine = FENCE_RE.exec(line);
    const marker = fenceLine && (fenceLine[1] || fenceLine[3]);
    if (fence) {
      const trailing = fenceLine && (fenceLine[2] ?? fenceLine[4]);
      const closes = marker && marker[0] === fence[0] && marker.length >= fence.length && trailing.trim() === '';
      if (closes) fence = null;
    } else if (marker) {
      fence = marker;
    } else {
      outside.push(line);
    }
  }
  return outside;
}

function parseAcceptanceCriteria(specText) {
  const criteria = [];
  let sectionLevel = null;
  let bullets = 0;
  for (const line of linesOutsideFences(specText)) {
    const heading = parseHeading(line);
    if (heading) {
      const { level } = heading;
      // A deeper heading stays inside the section.
      if (sectionLevel === null || level <= sectionLevel) {
        sectionLevel = AC_HEADING_LEVELS.includes(level) && AC_TITLE_RE.test(heading.text) ? level : null;
      }
      continue;
    }
    if (sectionLevel === null || THEMATIC_BREAK_RE.test(line)) continue;
    const numbered = AC_NUMBERED_RE.exec(line);
    const bullet = numbered ? null : AC_BULLET_RE.exec(line);
    if (numbered) {
      criteria.push({ id: numbered[1] ?? numbered[2], text: numbered[3] });
    } else if (bullet) {
      bullets += 1;
      criteria.push({ id: `${POSITIONAL_AC_PREFIX}${bullets}`, text: bullet[1] });
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

// `text` without its first `re` match and the whitespace just before it.
function stripClause(text, re) {
  const match = re.exec(text);
  if (match === null) return text;
  let start = match.index;
  while (start > 0 && /\s/.test(text[start - 1])) start -= 1;
  return text.slice(0, start) + text.slice(match.index + match[0].length);
}

// The first line of each hash, keyed by the id suffix the console mints for it. Built
// once per call, and only when a decision item needs it.
function decisionLinesByHash(decisions) {
  const byHash = new Map();
  for (const line of decisions.split(/\r?\n/)) {
    // decisionLineHash is the Review Console's own: resolve.js mints the item id from it.
    const hash = decisionLineHash(line);
    if (!byHash.has(hash)) byHash.set(hash, line);
  }
  return byHash;
}

function decisionFindingText(linesByHash, hash) {
  const line = linesByHash.get(hash);
  if (line === undefined) return null;
  const leadIn = line.indexOf(DECISION_LEAD_IN);
  const body = leadIn === -1 ? line : line.slice(leadIn + DECISION_LEAD_IN.length);
  return stripClause(stripClause(body, LOW_CONFIDENCE_NOTE_RE), REVERSIBILITY_CLAUSE_RE).trim() || null;
}

function tiebreakFindingText(findings, id) {
  const finding = findings.find((candidate) => candidate?.id === id);
  return typeof finding?.claim === 'string' && finding.claim.trim() !== ''
    ? `${finding.path}:${finding.line} ${finding.claim}`
    : null;
}

// The first line alone is often a generic heading or a `Target:`, so a named field wins.
// A `Title:` in a quoted code block is the block's, not the file's.
function stagedFindingText(text) {
  if (typeof text !== 'string') return null;
  const outside = linesOutsideFences(text);
  const prose = outside.join('\n');
  const field = TITLE_FIELD_RE.exec(prose) ?? FINDING_FIELD_RE.exec(prose);
  if (field) return field[1].trim();
  const lines = outside.map((line) => line.trim()).filter(Boolean);
  const heading = lines.findIndex((line) => FINDING_HEADING_RE.test(line));
  const underHeading = heading === -1 ? undefined : lines[heading + 1];
  if (underHeading !== undefined && parseHeading(underHeading) === null) return underHeading;
  return lines[0] ?? null;
}

function lowConfidenceFindings({ items, findings, decisions }, readStaged) {
  let linesByHash = null;
  return items
    // A settled staged file keeps its section. A can't-tell verdict keeps its item,
    // even at a `dropped` default: an agent that could not tell settled nothing.
    .filter((item) => item.section === CONSOLE_SECTIONS.LOW
      && (item.tiebreak || !SETTLED_RESOLUTIONS.includes(item.resolution)))
    .map(({ id }, index) => {
      const decision = DECISION_ID_RE.exec(id);
      let text;
      if (decision) {
        linesByHash ??= decisionLinesByHash(decisions);
        text = decisionFindingText(linesByHash, decision[1]);
      } else if (id.startsWith(TIEBREAK_PREFIX)) {
        text = tiebreakFindingText(findings, id.slice(TIEBREAK_PREFIX.length));
      } else {
        text = stagedFindingText(readStaged(id));
      }
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

// A comment opens at the first `#` that follows whitespace. Found by scanning, not by a
// `\s+#` regex, which is quadratic on a long whitespace run with no `#` after it.
function stripYamlComment(value) {
  for (let at = value.indexOf('#', 1); at !== -1; at = value.indexOf('#', at + 1)) {
    if (/\s/.test(value[at - 1])) return value.slice(0, at).trim();
  }
  return value.trim();
}
const stripYamlQuotes = (value) => value.replace(/^(["'])(.*)\1$/, '$2');
const yamlScalar = (value) => stripYamlQuotes(stripYamlComment(value));
const indentOf = (line) => line.length - line.trimStart().length;

// A flow list's text up to its closing bracket, which may be several lines away. The
// comment goes first: a bracket or comma inside one is not the list's.
function readFlowTags(line, story) {
  const listed = line.replace(FLOW_COMMENT_RE, '');
  const end = listed.indexOf(']');
  const entries = end === -1 ? listed : listed.slice(0, end);
  if (entries.split(',').map(yamlScalar).includes(NEGATIVE_TAG)) story.tagged = true;
  story.flowOpen = end === -1;
}

// One `key: value` at the item's own indent. Keys nested deeper (a step's `id:`, a
// step's `tags:`) never reach here.
function readStoryKey(body, story) {
  const id = ID_KEY_RE.exec(body);
  const flow = FLOW_TAGS_RE.exec(body);
  if (id) story.id = yamlScalar(id[1]);
  else if (flow) readFlowTags(flow[1], story);
  else if (BLOCK_TAGS_RE.test(body)) story.tagsOpen = true;
}

// One line inside an item, after its first. A block list stays open only while its
// `- ` lines continue directly under the key. YAML also allows them at the key's own
// indent, and no key of this item can start with `- `.
function readStoryLine(line, story) {
  const indent = indentOf(line);
  const body = line.trim();
  story.keyIndent ??= indent;
  if (story.tagsOpen) {
    const entry = indent >= story.keyIndent ? BLOCK_ITEM_RE.exec(body) : null;
    if (entry) {
      if (yamlScalar(entry[1]) === NEGATIVE_TAG) story.tagged = true;
      return;
    }
    story.tagsOpen = false;
  }
  if (indent === story.keyIndent) readStoryKey(body, story);
}

// The items of each `stories:` list, each opened by any `- ` line at the list's indent,
// so an id need not be an item's first key. A key at or left of that indent ends a list,
// and reading goes on, since a later document may hold another. The first `stories:` key
// excludes every list above it and any list under another key after it; a file with no
// such key reads every list that opens with a `- id:`.
function parseStoryFile(text) {
  const stories = [];
  let sawStoriesKey = false;
  let inStories = false;
  let itemIndent = null;
  let current = null;
  const closeList = () => {
    itemIndent = null;
    current = null;
    inStories = false;
  };
  for (const line of text.split(/\r?\n/)) {
    const body = line.trim();
    if (body === '' || body.startsWith('#')) continue;
    const indent = indentOf(line);
    if (current?.flowOpen) {
      if (indent > itemIndent) {
        readFlowTags(body, current);
        continue;
      }
      current.flowOpen = false;
    }
    if (indent === 0 && STORIES_KEY_RE.test(body)) {
      if (!sawStoriesKey) stories.length = 0;
      closeList();
      sawStoriesKey = true;
      inStories = true;
      continue;
    }
    const item = LIST_ITEM_RE.exec(line);
    const opensList = itemIndent === null && item && (inStories || (!sawStoriesKey && ID_KEY_RE.test(item[3])));
    if (item && (opensList || indent === itemIndent)) {
      itemIndent = indent;
      const keyIndent = item[3] === '' ? null : indent + item[2].length;
      current = { id: null, tagged: false, tagsOpen: false, flowOpen: false, keyIndent };
      stories.push(current);
      readStoryKey(item[3], current);
    } else if (itemIndent !== null) {
      if (indent <= itemIndent) closeList();
      else readStoryLine(line, current);
    }
  }
  return stories
    .filter(({ id }) => id)
    .map(({ id, tagged }) => ({ id, negative: tagged || id.startsWith(NEGATIVE_ID_PREFIX) }));
}

// An entry with no usable id keeps its place with `id: null`, so the gather can count
// what it could not list.
function storyResult(entry) {
  const { id: rawId, status, error } = entry ?? {};
  const id = typeof rawId === 'string' && rawId !== '' ? rawId : null;
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
  return report.stories.map(storyResult);
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

// `report.pass` and each `exitCode` stay raw when verify adjudicates a failing run to a
// pass; `effectivePass` is the verdict, there so no consumer re-derives it (#3316).
function adjudicatedReason(report) {
  if (report?.effectivePass !== true) return null;
  const baseline = report.baselineAdjudicated;
  if (baseline?.verdict === 'pass') {
    return typeof baseline.baseRef === 'string' ? `baseline-adjudicated vs ${baseline.baseRef}` : 'baseline-adjudicated';
  }
  return report.preExistingAdjudicated ? 'declared pre-existing failure' : 'adjudicated by verify';
}

function verifyCheckResult(entry, adjudicated) {
  if (!isObject(entry)) return NO_CHECK_RESULT;
  if (entry.exitCode === 0) return { status: 'passed' };
  if (entry.skipped) return { status: 'skipped', reason: String(entry.skipped) };
  // A null exit code is a hang or a spawn failure, which verify already counts as failed.
  if (entry.exitCode === undefined) return NO_CHECK_RESULT;
  if (adjudicated !== null) return { status: 'passed', reason: adjudicated };
  const summary = typeof entry.summary === 'string' && entry.summary !== '' ? entry.summary : null;
  return { status: 'failed', reason: summary ?? `exit ${entry.exitCode}` };
}

function checkFacts(report, expectedChecks) {
  const results = isObject(report?.checks) ? report.checks : {};
  const names = new Set([...(expectedChecks ?? []), ...Object.keys(results)]);
  const adjudicated = adjudicatedReason(report);
  return [...names].map((name) => {
    const entry = ownValue(results, name);
    return {
      id: `check:${encodeFactKey(name)}`,
      kind: 'check',
      source: entry === undefined ? 'verify-scope' : 'verify-report',
      ...verifyCheckResult(entry, adjudicated),
    };
  });
}

function storyFacts(storyIndex, storyResults, stampStories) {
  const negativeById = new Map((storyIndex ?? []).map(({ id, negative }) => [id, negative]));
  const isNegative = (id) => negativeById.get(id) ?? id.startsWith(NEGATIVE_ID_PREFIX);
  const stamped = new Set((stampStories ?? []).map(({ id }) => id));
  const fromReport = (storyResults ?? []).filter(({ id }) => id !== null && !stamped.has(id)).map(({ id, status, reason }) => ({
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
    if (key) return refuse(`credential key in command: ${key}`);
    return hasBearerUrl(command) ? refuse(BEARER_SEGMENT_REASON) : accept({ command });
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

// A recording's free strings as a narrator may read them, with the sum of what went from them.
// A claim's text meets only the credential screen, which misses a bare token or an address.
function redactedRecordingStrings({ text, captions, failure }) {
  let redactions = 0;
  const redacted = (value) => {
    if (typeof value !== 'string') return value;
    const result = redactOrWithhold(value);
    redactions += result.count;
    return result.text;
  };
  return { text: redacted(text), captions: captions?.map(redacted), failure: redacted(failure), redactions };
}

// The snapshot's outcome as a fact. A not-run one has no GIF, so no location.
function recordingFact(recording, recordingPath) {
  const { status, reason, exposure } = recording;
  const { text, captions, failure, redactions } = redactedRecordingStrings(recording);
  const common = { id: 'recording:walkthrough', kind: 'recording', status, source: 'walkthrough' };
  if (status === 'not-run') return { ...common, reason, ...(failure === undefined ? {} : { failure }), redactions };
  return {
    ...common, text, url_or_path: recordingPath.live, archive_path: recordingPath.archived, captions, exposure, redactions,
  };
}

function unmatchedAcKeys(acResults, criteria) {
  if (!isObject(acResults)) return [];
  const ids = new Set(criteria.map(({ id }) => id));
  return Object.keys(acResults).filter((key) => !ids.has(key) || !AC_VERDICTS.includes(acResults[key]));
}

function partialNotes(inputs, criteria, unmatched, repeated) {
  const { report, expectedChecks, specText, changes, commits, decisionsText, storyResults, stampStories, qaReportUnread } = inputs;
  const noCommits = (commits ?? []).length === 0;
  const qaExpected = qaReportUnread || qaSelectionFromDecisions(decisionsText) > 0;
  const qaWithoutId = (storyResults ?? []).filter(({ id }) => id === null).length;
  return [
    [!isObject(report?.checks), 'verify report not found'],
    [expectedChecks === null, 'verify-scope declaration not read — expected checks not derived'],
    [specText === null, 'spec not found — acceptance criteria not derived'],
    [specText !== null && criteria.length === 0, 'spec holds no parsed acceptance criteria — acceptance criteria not derived'],
    [changes === null, 'git changes not gathered'],
    [changes !== null && changes.length === 0 && noCommits, 'git change range is empty — changes not listed'],
    [decisionsText === null, 'review decisions log not found'],
    [storyResults === null && stampStories === null && qaExpected, 'QA report not read — selected stories not listed'],
    [qaWithoutId > 0, `QA report entries with no story id, not listed: ${qaWithoutId}`],
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
    ...(inputs.recording ? [recordingFact(inputs.recording, inputs.recordingPath)] : []),
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

  return {
    schemaVersion: SCHEMA_VERSION,
    record: inputs.record,
    surface,
    allowedHosts,
    partial: partialNotes(inputs, criteria, unmatchedAcKeys(inputs.acResults, criteria), [...repeated]),
    refused: linkOutcomes.flatMap(({ refused }) => (refused ? [refused] : [])),
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

// The version when the body's whole first line is the marker, else null. Trailing text
// or a padded `v01` is prose that resembles the marker, not an unknown version.
function packetVersion(body) {
  if (typeof body !== 'string') return null;
  const [firstLine] = body.split(/\r?\n/, 1);
  const marker = PACKET_MARKER_RE.exec(firstLine);
  if (marker === null || marker[0] !== firstLine || String(Number(marker[1])) !== marker[1]) return null;
  return Number(marker[1]);
}

// Reads only the comments it is given: a run-dir copy of the packet may be stale.
function readPacket(comments) {
  const candidates = comments.filter((comment) => packetVersion(comment?.body) !== null);
  const skipped = candidates.filter((comment) => !isTrustedComment(comment)).map(untrustedSkipNote);
  const [comment = null, ...rest] = earliestFirst(candidates.filter(isTrustedComment));
  if (comment === null) return { status: 'none', comment: null, version: null, extras: [], skipped };
  const version = packetVersion(comment.body);
  return {
    status: version === SCHEMA_VERSION ? 'found' : 'unreadable',
    comment,
    version,
    extras: rest.map((extra) => String(extra.url || extra.html_url || extra.id)),
    skipped,
  };
}

module.exports = {
  NEGATIVE_ID_PREFIX,
  parseAcceptanceCriteria,
  lowConfidenceFindings,
  qaSelectionFromDecisions,
  expectedChecksFromDeclaration,
  parseStoryFile,
  storyResultsFromQaReport,
  storiesFromQaStamp,
  redactedRecordingStrings,
  gatherPacketFacts,
  readPacket,
};
