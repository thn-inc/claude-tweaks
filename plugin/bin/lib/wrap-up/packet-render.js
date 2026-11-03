// bin/lib/wrap-up/packet-render.js — the acceptance packet's markdown (#4611). Every
// value from outside the renderer goes through inline() or codeSpan(), so a claim or
// a QA error cannot add a heading, a link, or a comment that hides what follows it.
//
// Pure: no git, gh or fs.
'use strict';

const {
  PACKET_MARKER, SECTIONS, MAX_PACKET_CHARS, COMMANDS_ONLY_SURFACES, WITHHELD_TEXT,
} = require('./packet-contract');
const {
  BEARER_SEGMENT_REASON, checkLink, findCredentialInText, hasBearerUrl, isCredentialRefusal, isImageUrl, normalizeKey,
} = require('./packet-links');
const { validatePacket } = require('./packet-validate');
const { redactText, redactOrWithhold } = require('../walkthrough/redact');
const { escapeRegExp } = require('../shared-primitives');

// Every shape GitHub can turn into a link or a notification. A plain `word:value` is
// not one: `link:deploy`, `localhost:3000` and `C:\temp` stay prose, so only the
// schemes with no `//` that make a real link are named. Each repeat before an anchor
// is bounded, which keeps the scan linear on a long run of word characters. `_` is no
// word character here: GitHub links `_@octocat_`. A character reference's digits are no
// `#12`: `escapeText` already keeps the reference itself from decoding.
const URL_TAIL = '[^\\s`<>]+';
const NOT_AFTER_WORD = '(?<![a-z0-9])';
const NOT_BEFORE_WORD = '(?![a-z0-9])';
const AUTOLINK_TOKEN_RE = new RegExp([
  `(?:https?:\\/\\/|www\\.)${URL_TAIL}`,
  `[a-z][a-z0-9+.-]{1,31}:\\/\\/${URL_TAIL}`,
  `${NOT_AFTER_WORD}(?:mailto|xmpp|tel|sms):${URL_TAIL}`,
  '[a-z0-9._%+-]{1,64}@[a-z0-9_-]+(?:\\.[a-z0-9_-]+)+',
  `(?<![a-z0-9/])[a-z0-9][a-z0-9-]{0,38}(?:\\/[a-z0-9._-]{1,100})?#\\d+${NOT_BEFORE_WORD}`,
  `${NOT_AFTER_WORD}@[a-z0-9][a-z0-9-]*(?:\\/[a-z0-9_-]+)?`,
  `${NOT_AFTER_WORD}(?!(?<=&)#\\d{1,7};)#\\d+${NOT_BEFORE_WORD}`,
  // GitHub's `GH-12` spelling of the same reference.
  `${NOT_AFTER_WORD}GH-\\d+${NOT_BEFORE_WORD}`,
].join('|'), 'i');
const CHECKS_PASSED_LABEL = 'Checks that passed:';
const ROW_KINDS = Object.freeze(['check', 'story']);

const WITHHELD_REASON = '(reason withheld: credential-shaped)';
const WITHHELD_ID_NOTE = 'id withheld: credential-shaped';
const WITHHELD_ID = `(${WITHHELD_ID_NOTE})`;
const RECORDING_WITHHELD = 'recording withheld: link contained a credential-shaped value';
const RECORDING_REFUSED = '(recording url refused)';
const NOT_RECORDED = 'not recorded';
const NO_STORY = 'no-story';
const LINKED_PRIVATE = 'linked-private';
const WITHHELD_EXPOSURE = 'withheld';

const PLAN_SECTION = 'observation-plan';
const PLAN_HEADING = 'Observation plan';
const PLAN_ALL_SCREENED = 'all lines omitted for credential-shaped content';
// What the screened line names for a plan line whose URL has a bearer-shaped path segment.
const PLAN_BEARER_KEY = 'path segment';
const PLAN_HEADING_RE = /^#{1,6}[ \t]+observation plan[ \t]*$/i;
const PLAN_LIST_MARKER_RE = /^(?:[-+*]|\d{1,9}[.)])[ \t]+(?=\S)/;
// One backtick each side and none inside: a linear scan, since a failed opener reads no
// further than the next backtick. Any other run stays escaped, and inert either way.
const PLAN_CODE_SPAN_RE = /(?<!`)`([^`]+)`(?!`)/g;
const PLAN_INDENT_RE = /^[ \t]*/;
const TAB_COLUMNS = 4;
const MAX_RELATIVE_INDENT = 3;

// A whitespace run holding a line break becomes one space. Matching the run first
// keeps this linear; `\s*[\r\n]+\s*` is quadratic on a long run of spaces.
const collapseLines = (s) => String(s).replace(/\s+/g, (run) => (/[\r\n]/.test(run) ? ' ' : run));

// Beyond `[`, `]` and `<`: a backslash, or it would cancel the escape added after it
// (`\[` to `\\[`); a backtick, or it would pair with a URL's code span and leave the
// URL outside it; the `&` of a character reference, or `&#35;12` and `&commat;octocat`
// would decode into a live reference and a live mention after the token scan.
const escapeText = (text) => text.replace(/[\\`[\]<]|&(?=#|[a-z][a-z0-9]{1,31};)/gi, '\\$&');

// Each scan starts where the last token ended, so its lookbehinds cannot read a token's
// last character as a word before the next one. Adjacent tokens share one span: a
// closing backtick is no boundary, and `#12` `@octocat` touching would still be one run.
function spanTokens(text) {
  let out = '';
  let rest = text;
  let run = '';
  const closeRun = () => {
    if (run !== '') out += codeSpan(run);
    run = '';
  };
  for (let match = AUTOLINK_TOKEN_RE.exec(rest); match; match = AUTOLINK_TOKEN_RE.exec(rest)) {
    if (match.index > 0) {
      closeRun();
      out += escapeText(rest.slice(0, match.index));
    }
    run += match[0];
    rest = rest.slice(match.index + match[0].length);
  }
  closeRun();
  return out + escapeText(rest);
}

// What would open a block at the start of a line. A leading `~~~` would open a fence
// that runs to the end of the comment; a blockquote or list marker would hold a real
// heading, `- ## Couldn't test` among them, nested in it, and one layer escaped leaves
// the rest as paragraph text. A line of only `=` or `-` would underline the line above
// it into a heading. The digits are capped where CommonMark caps an ordered marker.
const escapeBlockStart = (text) => text
  .replace(/^(?:[#~>]|[-+*](?=\s|$))/, '\\$&')
  .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
  .replace(/^(?:=+|-+)$/, '\\$&');

function inline(s) {
  return escapeBlockStart(spanTokens(collapseLines(s).trim()));
}

function codeSpan(s) {
  const text = collapseLines(s);
  // A loop, not Math.max(...runs): a long enough text has more runs than a call can
  // take arguments.
  let longestRun = 0;
  for (const [run] of text.matchAll(/`+/g)) longestRun = Math.max(longestRun, run.length);
  const fence = '`'.repeat(longestRun + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

// `<url>` is a CommonMark autolink: the whole of it is one link and nothing in it is
// markup, so `a)[click](https://evil.example` stays inert. `href` percent-encodes the
// characters that could end it, and drops the line breaks `new URL` already ignored.
const liveLink = (url) => `<${new URL(url).href}>`;

const statusWord = (status) => (status === 'not-run' ? 'not run' : status);
// Verify summaries and QA errors echo URLs and environment values, so free text is
// screened wherever it renders. The matched text never does; the row or line stays.
const screenedInline = (text, withheld) => (findCredentialInText(text) ? withheld : inline(text));
const statusWithReason = (fact) => `${statusWord(fact.status)}: ${screenedInline(fact.reason ?? '', WITHHELD_REASON) || 'no reason recorded'}`;
// A fact key is percent-encoded, which the screen decodes. The id is display only here:
// validation has already matched it, and the fact stays citable.
const idSpan = (id) => (findCredentialInText(id) ? WITHHELD_ID : codeSpan(id));
// A citation list is already in parentheses, so a withheld id is the bare note here.
const citationSpan = (id) => (findCredentialInText(id) ? WITHHELD_ID_NOTE : codeSpan(id));
const citations = (refs) => refs.map(citationSpan).join(', ');
const claimText = (claim) => `${inline(claim.text)} (${citations(claim.refs)})`;
const claimLine = (claim) => `- ${claimText(claim)}`;
const movedLine = ({ claim, because }) => `- ${inline(claim.text)} (moved: cites ${idSpan(because.id)} — ${statusWithReason(because)})`;
// A pass carries a reason only when it needs one: a verify run adjudicated to a pass.
const rowLine = (fact) => `- ${idSpan(fact.id)} — ${fact.status === 'passed' && !fact.reason?.trim() ? 'passed' : statusWithReason(fact)}`;
const factText = (fact) => screenedInline(fact.text ?? '', WITHHELD_TEXT) || idSpan(fact.id);

// Decision Q3's row placement: every check/story fact lands in exactly one place.
function rowPlace(fact) {
  if (fact.status === 'skipped' || fact.status === 'not-run') return 'couldnt-test';
  if (fact.status === 'failed' || fact.negative === true) return 'tried-to-break';
  return 'checks-passed';
}

// inline() escapes both brackets. Only the closer comes back, so the raw comment holds the
// fixed token and the escaped opener keeps a `[redacted]: x` line from defining a link.
const ESCAPED_PLACEHOLDER = '\\[redacted\\]';
const RENDERED_PLACEHOLDER = '\\[redacted]';

// Every free string of the section comes through here. Gather has already redacted a gathered
// fact, and a second pass changes nothing; a hand-built fact still must not leak.
function recordingText(raw, tally) {
  const { text, count } = redactOrWithhold(raw ?? '');
  tally.redacted += count;
  return inline(text).replaceAll(ESCAPED_PLACEHOLDER, RENDERED_PLACEHOLDER);
}

// A recording may live on any host, so its own hostname is the allowed one: checkLink
// then screens the scheme, userinfo, path segments, query and fragment with no host rule.
function recordingHref(url, exposure) {
  let hostname;
  try {
    ({ hostname } = new URL(url));
  } catch {
    return { place: RECORDING_REFUSED, live: false };
  }
  const { ok, reason } = checkLink(url, { allowedHosts: [hostname] });
  if (isCredentialRefusal(reason)) return { place: RECORDING_WITHHELD, live: false };
  if (!ok || isImageUrl(url) || exposure !== LINKED_PRIVATE) return { place: RECORDING_REFUSED, live: false };
  return { place: liveLink(url), live: true };
}

// A blank value is an absent one.
const filled = (value) => (value?.trim() ? value : undefined);

// A shape, not a parse: `new URL` throws on `https://h:99999/x`, which is still a URL to the
// reader. A scheme of one letter is a Windows drive unless `//` follows it. The two strips are
// what `new URL` itself ignores, so `ht\ttps://h` and a leading control character read the same.
const URL_IGNORED_RE = /[\t\r\n]/g;
const REMOTE_PATH_RE = /^[\s\u0000-\u001f]*(?:[a-z][a-z0-9+.-]+:|(?:[a-z]:)?\/\/)/i;
const isRemotePath = (path) => REMOTE_PATH_RE.test(path.replace(URL_IGNORED_RE, ''));

const WITHHELD_PLACE = Object.freeze({ place: RECORDING_WITHHELD, live: false });

// A remote location meets the link rules. A local one meets the credential screen and the
// redactor, and never the bearer rule, which a run id or a dated slug would trip.
function recordingLocation(path, exposure) {
  if (isRemotePath(path)) return recordingHref(path, exposure);
  if (findCredentialInText(path) || redactText(path).count > 0) return WITHHELD_PLACE;
  return { place: codeSpan(path), live: false, local: true };
}

// Where the head line points, and what its archive line says. Either location being withheld
// withholds both, since the line would otherwise point at what the screen refused.
function recordingPlace(fact) {
  const { exposure } = fact;
  if (exposure === WITHHELD_EXPOSURE) return WITHHELD_PLACE;
  const archivePath = filled(fact.archive_path);
  const archive = archivePath === undefined ? null : recordingLocation(archivePath, exposure);
  if (archive?.place === RECORDING_WITHHELD) return WITHHELD_PLACE;
  const path = filled(fact.url_or_path);
  const main = fact.url !== undefined || path === undefined || exposure === LINKED_PRIVATE
    ? recordingHref(fact.url ?? path, exposure)
    : recordingLocation(path, exposure);
  if (main.place === RECORDING_WITHHELD) return WITHHELD_PLACE;
  const tag = main.local && exposure !== undefined ? ` (${exposure})` : '';
  return { place: `${main.place}${tag}`, live: main.live, archived: archive?.place };
}

// An id the redactor would change is withheld wherever this section's facts print one.
const recordingIdSpan = (id) => (redactText(id).count > 0 ? WITHHELD_ID : idSpan(id));

function recordingHeadLines(fact, tally) {
  if (fact.status === 'not-run') {
    const reason = recordingText(fact.reason, tally);
    return [reason ? `${NOT_RECORDED}: ${reason}` : NOT_RECORDED];
  }
  const { place, live, archived } = recordingPlace(fact);
  const text = recordingText(live ? filled(fact.label) ?? fact.text : fact.text, tally) || recordingIdSpan(fact.id);
  const head = `- ${text}: ${place}`;
  return archived === undefined ? [head] : [head, `  once archived: ${archived}`];
}

function recordingItem(fact) {
  const tally = { redacted: 0 };
  const lines = recordingHeadLines(fact, tally);
  // Numbered from 1 with no gap: a list that starts anywhere else cannot interrupt the line above it.
  (fact.captions ?? []).filter(filled).forEach((caption, index) => {
    lines.push(`  ${index + 1}. ${recordingText(caption, tally)}`);
  });
  if (fact.status === 'not-run' && filled(fact.failure)) lines.push(`  failure: ${recordingText(fact.failure, tally)}`);
  // Gather's count, since a second pass over its strings finds nothing left to count.
  const redacted = Number.isInteger(fact.redactions) ? fact.redactions : tally.redacted;
  if (redacted > 0) lines.push(`  redacted values: ${redacted}`);
  return lines.join('\n');
}

// A recording that was expected and could not be made also renders a Couldn't test row.
const recordingCouldNotRun = (fact) => fact.status === 'not-run' && fact.reason !== NO_STORY;
// Validation holds its reason to the vocabulary, so only the id needs more than rowLine gives.
const recordingRow = (fact) => `- ${recordingIdSpan(fact.id)} — ${statusWithReason(fact)}`;

function renderLinkFact(fact, facts, deploy) {
  if (fact.command) {
    const key = findCredentialInText(fact.command);
    if (key) return `(link refused: credential key in command: ${inline(key)})`;
    return hasBearerUrl(fact.command) ? `(link refused: ${BEARER_SEGMENT_REASON})` : codeSpan(fact.command);
  }
  if (COMMANDS_ONLY_SURFACES.includes(facts.surface)) return null;
  const check = checkLink(fact.url, { allowedHosts: facts.allowedHosts });
  if (!check.ok) return `(link refused: ${inline(check.reason)})`;
  const unverified = deploy?.target === 'dev' && deploy.live !== true;
  return `${liveLink(fact.url)}${unverified ? ' (link unverified: deploy not confirmed live)' : ''}`;
}

// A body holds only these two. Truncation may drop an item and never a note, whatever
// the text of either looks like.
const item = (text) => ({ text, droppable: true });
const note = (text) => ({ text, droppable: false });
const itemsOr = (lines, reason) => (lines.length > 0 ? lines.map(item) : [note(reason)]);

// The packet's one redacting choke point (#4612): nothing from a recording fact reaches the
// markdown except through recordingText, a screened link or a screened code span.
function renderRecordingSection(recordingFacts) {
  const rendered = recordingFacts.filter((fact) => !(fact.status === 'not-run' && fact.reason === NO_STORY));
  return itemsOr(rendered.map(recordingItem), NOT_RECORDED);
}

function testGuideBody(ctx) {
  const { facts, deploy, factsById, keptIn, rowsIn } = ctx;
  const steps = keptIn('test-guide').map((claim, index) => {
    const links = claim.refs
      .map((id) => factsById.get(id))
      .filter((fact) => fact.kind === 'link')
      .map((fact) => renderLinkFact(fact, facts, deploy))
      .filter(Boolean);
    return `${index + 1}. ${claimText(claim)}${links.length > 0 ? `: ${links.join('; ')}` : ''}`;
  });
  const body = itemsOr(steps, 'not applicable: no tested stories or links were gathered');
  const refused = facts.refused ?? [];
  if (refused.length > 0) {
    const entries = refused.map(({ id, reason }) => `${screenedInline(id, WITHHELD_ID)} (${screenedInline(reason, WITHHELD_REASON)})`);
    body.push(note(`- ${refused.length} link(s) refused: ${entries.join('; ')}`));
  }
  const passed = rowsIn('checks-passed');
  // The blank line keeps the label out of the numbered list above it.
  if (passed.length > 0) body.push(note(''), note(CHECKS_PASSED_LABEL), ...passed.map(rowLine).map(item));
  return body;
}

const SECTION_BODIES = Object.freeze({
  'what-changed': ({ keptIn }) => itemsOr(
    keptIn('what-changed').map(claimLine),
    'not applicable: no change facts were gathered',
  ),
  recording: ({ ofKind }) => renderRecordingSection(ofKind('recording')),
  'test-guide': testGuideBody,
  'couldnt-test': ({ ofKind, rowsIn, movedTo }) => itemsOr(
    [
      ...rowsIn('couldnt-test').map(rowLine),
      ...ofKind('recording').filter(recordingCouldNotRun).map(recordingRow),
      ...movedTo('couldnt-test').map(movedLine),
    ],
    'not applicable: every expected check ran',
  ),
  'tried-to-break': ({ keptIn, movedTo, rowsIn }) => itemsOr(
    [
      ...keptIn('tried-to-break').map(claimLine),
      ...movedTo('tried-to-break').map(movedLine),
      ...rowsIn('tried-to-break').map(rowLine),
    ],
    'not applicable: no negative stories or failures ran',
  ),
  'least-confident': ({ keptIn }) => itemsOr(
    keptIn('least-confident').map(claimLine),
    'not applicable: no low-confidence review findings',
  ),
  'risk-proofs': ({ keptIn }) => itemsOr(
    keptIn('risk-proofs').map(claimLine),
    'not applicable: no kept risk flags',
  ),
  // No decisions omits the section, heading included.
  decisions: ({ ofKind }) => ofKind('decision').map((fact) => item(`- ${factText(fact)}`)),
  deploy: ({ deploy }) => [note(
    screenedInline(deploy?.text ?? '', WITHHELD_TEXT) || `target: ${screenedInline(deploy?.target ?? 'local', WITHHELD_TEXT)}`,
  )],
});

const droppedLine = (n) => (n === 1
  ? '1 claim was dropped for missing evidence'
  : `${n} claims were dropped for missing evidence`);

const screenedHeading = (section) => (section === PLAN_SECTION
  ? PLAN_HEADING
  : SECTIONS.find(({ key }) => key === section).heading);

function screenedLines(screened) {
  if (screened.length === 0) return [];
  const noun = screened.length === 1 ? 'entry' : 'entries';
  const entries = screened.map(({ section, key }) => `${screenedHeading(section)} (${inline(key)})`).join('; ');
  return [`${screened.length} ${noun} omitted for credential-shaped content: ${entries}`];
}

// `_shared/observation-plan.md`'s grammar has to survive the trip to `/claude-tweaks:demo`,
// which reads the comment's raw text: a list marker stays a marker, a whole backtick
// span stays a span, and a sub-bullet stays under its parent. Whatever follows the
// marker gets inline()'s escapes, so `- ## Couldn't test` forges nothing.
function planText(text) {
  let out = '';
  let at = 0;
  for (const match of text.matchAll(PLAN_CODE_SPAN_RE)) {
    out += spanTokens(text.slice(at, match.index)) + codeSpan(match[1]);
    at = match.index + match[0].length;
  }
  return escapeBlockStart(out + spanTokens(text.slice(at)));
}

const indentWidth = (line) => [...PLAN_INDENT_RE.exec(line)[0]].reduce((sum, char) => sum + (char === '\t' ? TAB_COLUMNS : 1), 0);

// In place, and returns the same array.
function trimBlankEdges(lines) {
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines.at(-1).trim() === '') lines.pop();
  return lines;
}

// A plan's own `### Observation plan` heading is the section's, and blank edges are noise.
function planBody(plan) {
  const lines = trimBlankEdges(plan.split(/\r\n|\r|\n/));
  if (lines.length > 0 && PLAN_HEADING_RE.test(lines[0].trim())) lines.shift();
  return trimBlankEdges(lines);
}

// `column` is where the open list item's content starts. Up to three spaces past it
// stays in that item; a fourth would open an indented code block, so it is capped there.
function renderPlanLines(lines) {
  let column = 0;
  return lines.map((line) => {
    const text = line.trim();
    if (text === '') return '';
    const indent = Math.min(indentWidth(line), column + MAX_RELATIVE_INDENT);
    const pad = ' '.repeat(indent);
    const marker = PLAN_LIST_MARKER_RE.exec(text);
    if (marker === null) {
      if (indent < column) column = 0;
      return `${pad}${planText(text)}`;
    }
    const opener = `${marker[0].trimEnd()} `;
    column = indent + opener.length;
    return `${pad}${opener}${planText(text.slice(marker[0].length))}`;
  });
}

// Whether the credential key the screen found is the last thing on the line, bare, as a
// `--flag`, or before a `=` or `:`: its value is then on the next line. The key compares
// with `-` and `_` ignored, as the screen does.
function keyEndsLine(line, key) {
  const spelled = [...key.replace(/[-_]/g, '')].map(escapeRegExp).join('[-_]*');
  return new RegExp(`${spelled}[-_]*["'\`]?\\s*[=:]?$`).test(normalizeKey(line).trimEnd());
}

// Screened on the raw line, the whole of it: its Prepare commands and Entry point are
// the Test guide's, in a section the contract's map files under it (Decision Q2). A key
// often leaves its value on the next line, so what a dropped line continues with a
// trailing `\`, or holds at a deeper indent, a blank line between them or not, goes too.
// So does the next line after a key that ends its own line with no value, at any indent:
// `- --api-key` over a sibling `- SECRET` leaves the value in the sibling.
function screenPlanLines(lines, screened) {
  let droppedIndent = null;
  let continues = false;
  let awaitsValue = false;
  return lines.filter((line) => {
    const blank = line.trim() === '';
    const indent = indentWidth(line);
    const key = findCredentialInText(line) ?? (hasBearerUrl(line) ? PLAN_BEARER_KEY : null);
    if (key) screened.push({ section: PLAN_SECTION, key });
    const held = droppedIndent !== null && !blank && indent > droppedIndent;
    const valueLine = awaitsValue && !blank;
    if (!blank) awaitsValue = key !== null && keyEndsLine(line, key);
    if (!key && !continues && !held && !valueLine) {
      if (!blank) droppedIndent = null;
      return true;
    }
    continues = line.trimEnd().endsWith('\\');
    // A continuation sits at any indent, so only a key line says what is under it.
    if (key) droppedIndent = droppedIndent === null ? indent : Math.min(droppedIndent, indent);
    return false;
  });
}

const truncatedLines = (n) => (n > 0 ? [`truncated: ${n} items omitted`] : []);

function compose(doc, omitted) {
  const lines = [...doc.top, ...truncatedLines(omitted)];
  for (const { heading, body } of doc.sections) {
    lines.push('', `### ${heading}`, ...body.map(({ text }) => text));
  }
  lines.push(...doc.bottom);
  return lines.join('\n');
}

// A body line's share of the section: its text and the newline that joins it.
const lineChars = ({ text }) => text.length + 1;
const bodyChars = (body) => body.reduce((sum, line) => sum + lineChars(line), 0);

// Drops one item, then repairs what the drop could leave behind: a label with no
// rows, or a heading with no line under it. `section.chars` follows the edits, not a
// re-count of the whole body, which is quadratic over a long run of dropped rows.
function dropLastItem(section) {
  const { body } = section;
  let { chars } = section;
  for (const line of body.splice(body.findLastIndex(({ droppable }) => droppable), 1)) chars -= lineChars(line);
  if (body.at(-1)?.text === CHECKS_PASSED_LABEL) {
    for (const line of body.splice(-2, 2)) chars -= lineChars(line);
  }
  if (body.length === 0) {
    const emptied = note('all items omitted by truncation');
    body.push(emptied);
    chars += lineChars(emptied);
  }
  section.chars = chars;
}

// Works on a copy: when notes alone exceed the cap no drop can meet it, and the CLI
// refuses to post that result, so the caller keeps the document as it was.
function truncate(doc) {
  const sections = doc.sections.map(({ heading, body }) => ({ heading, body: [...body], chars: bodyChars(body) }));
  const trial = { ...doc, sections };
  const noteChars = (n) => truncatedLines(n).reduce((sum, line) => sum + line.length + 1, 0);
  let size = compose(trial, 0).length;
  let omitted = 0;
  while (size + noteChars(omitted) > MAX_PACKET_CHARS) {
    const candidates = sections.filter(({ body }) => body.some(({ droppable }) => droppable));
    if (candidates.length === 0) return { doc, omitted: 0 };
    const longest = candidates.reduce((a, b) => (b.chars > a.chars ? b : a));
    const before = longest.chars;
    dropLastItem(longest);
    size += longest.chars - before;
    omitted += 1;
  }
  return { doc: trial, omitted };
}

function renderPacket(facts, narrative, { observationPlan, poster } = {}) {
  const { kept, moved, dropped, screened: screenedClaims } = validatePacket(facts, narrative);
  const ofKind = (kind) => facts.facts.filter((fact) => fact.kind === kind);
  const rows = facts.facts.filter((fact) => ROW_KINDS.includes(fact.kind));
  const ctx = {
    facts,
    factsById: new Map(facts.facts.map((fact) => [fact.id, fact])),
    deploy: ofKind('deploy')[0] ?? null,
    ofKind,
    keptIn: (section) => kept.filter((claim) => claim.section === section),
    movedTo: (to) => moved.filter((entry) => entry.to === to),
    rowsIn: (place) => rows.filter((fact) => rowPlace(fact) === place),
  };

  const sections = SECTIONS
    .map(({ key, heading }) => ({ heading, body: SECTION_BODIES[key](ctx) }))
    .filter(({ body }) => body.length > 0);
  const screened = screenedClaims.map(({ claim, key }) => ({ section: claim.section, key }));
  const planLines = typeof observationPlan === 'string' ? planBody(observationPlan) : [];
  if (planLines.length > 0) {
    const shown = trimBlankEdges(screenPlanLines(planLines, screened));
    const body = shown.some((line) => line.trim() !== '') ? renderPlanLines(shown) : [PLAN_ALL_SCREENED];
    sections.push({ heading: PLAN_HEADING, body: body.map(note) });
  }

  const top = [PACKET_MARKER, '', `## Acceptance packet — #${facts.record}`, ''];
  // The blank line ends the blockquote; the next line would otherwise continue it.
  if (facts.partial.length > 0) {
    const notes = facts.partial.map((text) => screenedInline(text, WITHHELD_TEXT));
    top.push(`> partial gather: ${notes.join('; ')}`, '');
  }
  top.push(droppedLine(dropped.length), ...screenedLines(screened));

  const bottom = [];
  if (typeof poster === 'string' && poster.trim() !== '') {
    bottom.push('', '---', `_Posted by ${inline(poster)}. Resolve with \`/claude-tweaks:demo\`._`);
  }

  const { doc, omitted: truncated } = truncate({ top, sections, bottom });
  const markdown = compose(doc, truncated);
  return { markdown, dropped, screened, truncated, chars: markdown.length };
}

module.exports = {
  inline,
  codeSpan,
  renderPacket,
  renderRecordingSection,
};
