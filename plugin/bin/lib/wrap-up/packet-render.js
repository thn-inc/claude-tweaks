// bin/lib/wrap-up/packet-render.js — the acceptance packet's markdown (#4611). Every
// value from outside the renderer goes through inline() or codeSpan(), so a claim or
// a QA error cannot add a heading, a link, or a comment that hides what follows it.
//
// Pure: no git, gh or fs.
'use strict';

const { PACKET_MARKER, SECTIONS, MAX_PACKET_CHARS } = require('./packet-contract');
const { checkLink, findCredentialInText } = require('./packet-links');
const { validatePacket } = require('./packet-validate');

// Every shape GitHub can turn into a link or a notification. A plain `word:value` is
// not one: `link:deploy`, `localhost:3000` and `C:\temp` stay prose, so only the
// schemes with no `//` that make a real link are named. Each repeat before an anchor
// is bounded, which keeps the scan linear on a long run of word characters.
const URL_TAIL = '[^\\s`<>]+';
const NOT_AFTER_WORD = '(?<![a-z0-9_])';
const NOT_BEFORE_WORD = '(?![a-z0-9_])';
const AUTOLINK_TOKEN_RE = new RegExp([
  `(?:https?:\\/\\/|www\\.)${URL_TAIL}`,
  `[a-z][a-z0-9+.-]{1,31}:\\/\\/${URL_TAIL}`,
  `(?:mailto|xmpp|tel|sms):${URL_TAIL}`,
  '[a-z0-9._%+-]{1,64}@[a-z0-9_-]+(?:\\.[a-z0-9_-]+)+',
  `(?<![a-z0-9_/])[a-z0-9][a-z0-9-]{0,38}(?:\\/[a-z0-9._-]{1,100})?#\\d+${NOT_BEFORE_WORD}`,
  `${NOT_AFTER_WORD}@[a-z0-9][a-z0-9-]*(?:\\/[a-z0-9_-]+)?`,
  `${NOT_AFTER_WORD}#\\d+${NOT_BEFORE_WORD}`,
].join('|'), 'gi');
const CHECKS_PASSED_LABEL = 'Checks that passed:';
const COMMANDS_ONLY_SURFACES = Object.freeze(['infra', 'backend']);
const ROW_KINDS = Object.freeze(['check', 'story']);

// A whitespace run holding a line break becomes one space. Matching the run first
// keeps this linear; `\s*[\r\n]+\s*` is quadratic on a long run of spaces.
const collapseLines = (s) => String(s).replace(/\s+/g, (run) => (/[\r\n]/.test(run) ? ' ' : run));

// Beyond `[`, `]` and `<`: a backslash, or it would cancel the escape added after it
// (`\[` to `\\[`); a backtick, or it would pair with a URL's code span and leave the
// URL outside it.
const escapeText = (text) => text.replace(/[\\`[\]<]/g, '\\$&');

function inline(s) {
  const text = collapseLines(s).trim();
  let out = '';
  let at = 0;
  for (const match of text.matchAll(AUTOLINK_TOKEN_RE)) {
    out += escapeText(text.slice(at, match.index)) + codeSpan(match[0]);
    at = match.index + match[0].length;
  }
  out += escapeText(text.slice(at));
  // A leading `~~~` would open a fence that runs to the end of the comment, and a
  // line of only `=` or `-` would underline the line above it into a heading.
  return out.replace(/^[#~]/, '\\$&').replace(/^(?:=+|-+)$/, '\\$&');
}

function codeSpan(s) {
  const text = collapseLines(s);
  const longestRun = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

// `<url>` is a CommonMark autolink: the whole of it is one link and nothing in it is
// markup, so `a)[click](https://evil.example` stays inert. `href` percent-encodes the
// characters that could end it, and drops the line breaks `new URL` already ignored.
const liveLink = (url) => `<${new URL(url).href}>`;

const statusWord = (status) => (status === 'not-run' ? 'not run' : status);
const statusWithReason = (fact) => `${statusWord(fact.status)}: ${inline(fact.reason ?? '') || 'no reason recorded'}`;
const citations = (refs) => refs.map(codeSpan).join(', ');
const claimText = (claim) => `${inline(claim.text)} (${citations(claim.refs)})`;
const claimLine = (claim) => `- ${claimText(claim)}`;
const movedLine = ({ claim, because }) => `- ${inline(claim.text)} (moved: cites ${codeSpan(because.id)} — ${statusWithReason(because)})`;
const rowLine = (fact) => `- ${codeSpan(fact.id)} — ${fact.status === 'passed' ? 'passed' : statusWithReason(fact)}`;
const factText = (fact) => inline(fact.text ?? '') || codeSpan(fact.id);

// Decision Q3's row placement: every check/story fact lands in exactly one place.
function rowPlace(fact) {
  if (fact.status === 'skipped' || fact.status === 'not-run') return 'couldnt-test';
  if (fact.status === 'failed' || fact.negative === true) return 'tried-to-break';
  return 'checks-passed';
}

// A recording may live on any host, so its own hostname is the allowed one: checkLink
// then screens the scheme, userinfo, query and fragment with no host rule.
function recordingHref(url) {
  let hostname;
  try {
    ({ hostname } = new URL(url));
  } catch {
    return '(recording url refused)';
  }
  return checkLink(url, { allowedHosts: [hostname] }).ok ? liveLink(url) : '(recording url refused)';
}

const recordingLine = (fact) => `- ${factText(fact)}: ${recordingHref(fact.url)}`;

function renderLinkFact(fact, facts, deploy) {
  if (fact.command) {
    const key = findCredentialInText(fact.command);
    return key ? `(link refused: credential key in command: ${inline(key)})` : codeSpan(fact.command);
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
    const entries = refused.map(({ id, reason }) => `${inline(id)} (${inline(reason)})`);
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
  recording: ({ ofKind }) => itemsOr(ofKind('recording').map(recordingLine), 'not recorded'),
  'test-guide': testGuideBody,
  'couldnt-test': ({ rowsIn, movedTo }) => itemsOr(
    [...rowsIn('couldnt-test').map(rowLine), ...movedTo('couldnt-test').map(movedLine)],
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
  deploy: ({ deploy }) => [note(inline(deploy?.text ?? '') || `target: ${inline(deploy?.target ?? 'local')}`)],
});

const droppedLine = (n) => (n === 1
  ? '1 claim was dropped for missing evidence'
  : `${n} claims were dropped for missing evidence`);

function screenedLines(screened) {
  if (screened.length === 0) return [];
  const noun = screened.length === 1 ? 'entry' : 'entries';
  const keys = screened.map(({ key }) => inline(key)).join('; ');
  return [`${screened.length} Test guide ${noun} omitted for credential-shaped content: ${keys}`];
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

const bodyChars = (body) => body.reduce((sum, { text }) => sum + text.length + 1, 0);

// Drops one item, then repairs what the drop could leave behind: a label with no
// rows, or a heading with no line under it.
function dropLastItem(section) {
  const { body } = section;
  body.splice(body.findLastIndex(({ droppable }) => droppable), 1);
  if (body.at(-1)?.text === CHECKS_PASSED_LABEL) body.splice(-2, 2);
  if (body.length === 0) body.push(note('all items omitted by truncation'));
  section.chars = bodyChars(body);
}

function truncate(doc) {
  const sections = doc.sections.map((section) => {
    section.chars = bodyChars(section.body);
    return section;
  });
  const noteChars = (n) => truncatedLines(n).reduce((sum, line) => sum + line.length + 1, 0);
  let size = compose(doc, 0).length;
  let omitted = 0;
  while (size + noteChars(omitted) > MAX_PACKET_CHARS) {
    const candidates = sections.filter(({ body }) => body.some(({ droppable }) => droppable));
    if (candidates.length === 0) break;
    const longest = candidates.reduce((a, b) => (b.chars > a.chars ? b : a));
    const before = longest.chars;
    dropLastItem(longest);
    size += longest.chars - before;
    omitted += 1;
  }
  return omitted;
}

function renderPacket(facts, narrative, { observationPlan, poster } = {}) {
  const { kept, moved, dropped, screened } = validatePacket(facts, narrative);
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
  if (typeof observationPlan === 'string' && observationPlan.trim() !== '') {
    const lines = observationPlan.split(/\r\n|\r|\n/);
    sections.push({ heading: 'Observation plan', body: lines.map((line) => note(inline(line))) });
  }

  const top = [PACKET_MARKER, '', `## Acceptance packet — #${facts.record}`, ''];
  // The blank line ends the blockquote; the next line would otherwise continue it.
  if (facts.partial.length > 0) top.push(`> partial gather: ${facts.partial.map(inline).join('; ')}`, '');
  top.push(droppedLine(dropped.length), ...screenedLines(screened));

  const bottom = [];
  if (typeof poster === 'string' && poster.trim() !== '') {
    bottom.push('', '---', `_Posted by ${inline(poster)}. Resolve with \`/claude-tweaks:demo\`._`);
  }

  const doc = { top, sections, bottom };
  const truncated = truncate(doc);
  const markdown = compose(doc, truncated);
  return { markdown, dropped, screened, truncated, chars: markdown.length };
}

module.exports = {
  inline,
  codeSpan,
  renderPacket,
};
