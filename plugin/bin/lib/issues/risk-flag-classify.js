// bin/lib/issues/risk-flag-classify.js
// The deterministic risk-flag classifier floor (#4618): a record body -> the
// invisible-risk categories its Deliverables, Acceptance Criteria and Key Files name.
// The floor is what a deterministic reading always finds; the shaping agent may add
// flags beyond it, never fewer. The body line itself is written only by
// record-risk-flags.js. Pure, except readRiskPolicy's one read through `readFile`.
//
// Sections. `## Deliverables` and `## Acceptance Criteria` run to the next h1/h2 (so a
// subsection stays inside) or to a Key Files heading nested under them; Key Files is
// the h2-h4 heading grouping.js reads, to the next heading. An absent heading lands in
// `missingSections`; a present, empty one does not, so an unread section never passes
// as "nothing matched".
//
// Matching. Keywords are word-bounded and case-insensitive, per line of the two h2
// sections and per Key Files line with its path-like backticked spans (holding a `/` or
// `.`) blanked, so a backticked path is matched only as a path while a backticked word
// stays a keyword. Paths are the backticked spans of Key Files lines,
// against a slug's built-in path rules (`via: 'path'`) and `pathGlobs[slug]`
// through isSensitivePath (`via: 'path-glob'`). Lines are read Deliverables, then
// Acceptance Criteria, then Key Files; on a Key Files line, path, then path-glob, then
// keyword. One flag per slug, the first match: built-ins in BUILTIN_RISK_CATEGORIES
// order, then policy extras, each matching its own slug spelled with a hyphen or a space.
'use strict';

const fs = require('fs');
const path = require('path');
const { findSection, fencedLineMask } = require('../markdown-blocks');
const { isSensitivePath } = require('./blast-radius');
const { BUILTIN_RISK_CATEGORIES, LIST_ELEMENT_PATTERNS, resolvePolicyKeys } = require('../policy-schema');
const { isControlModeOn } = require('../policy');

// The floor, per built-in slug. Wider phrasing is the shaping agent's job. Exported so
// the test can prove one phrase per keyword alternative matches that alternative alone.
const FLOOR = {
  migrations: {
    keywords: ['migrations?', 'schema changes?', 'alter table', 'drop (?:table|column)', 'database schema'],
    paths: [/(?:^|\/)migrations?\//i, /\.sql$/i],
  },
  auth: {
    keywords: ['auth(?:n|z|enticat\\w*|ori[sz]\\w*)?', 'permissions?', 'access control', 'rbac', 'login', 'session tokens?'],
    paths: [],
  },
  'public-contract': {
    keywords: ['public (?:api|contract)s?', 'hook payloads?', 'file formats?', 'wire format', 'breaking changes?', 'openapi'],
    paths: [],
  },
  'irreversible-side-effect': {
    keywords: ['irreversibl\\w*', 'permanently delet\\w*', 'outbound (?:sends?|emails?|messages?)', 'sends? (?:an? )?(?:emails?|sms|notifications?)', 'payments?', 'refunds?'],
    paths: [],
  },
};
for (const slug of BUILTIN_RISK_CATEGORIES) {
  if (!FLOOR[slug]) throw new Error(`risk-flag-classify: built-in category ${slug} has no floor`);
}

const wordRe = (alternatives) => new RegExp(`\\b(?:${alternatives.join('|')})\\b`, 'i');
const BUILTIN_RULES = new Map(BUILTIN_RISK_CATEGORIES.map((slug) => [slug, { keyword: wordRe(FLOOR[slug].keywords), paths: FLOOR[slug].paths }]));

const SECTION_NAMES = ['Deliverables', 'Acceptance Criteria', 'Key Files'];
const KEY_FILES_HEADING_RE = /^#{2,4}[ \t]+Key Files[ \t]*$/;
const BACKTICK_SPAN_RE = new RegExp('`([^`]*)`', 'g');
// A backticked span holding a `/` or `.` reads as a path; any other span stays keyword text.
const PATH_LIKE_RE = /[/.]/;
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/;

const EVIDENCE_CAP = 300;
// C0 (except the whitespace controls \t \n \v \f \r, which the collapse handles), DEL, C1.
const CONTROL_RE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;
const ESCAPE_RE = new RegExp('[\\\\[\\]`<>]', 'g');
const ELLIPSIS = '…';

const unique = (items) => [...new Set(items)];
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// text -> one line safe to quote in a record or a packet: C0/DEL/C1 control bytes
// dropped, then whitespace (newlines included) collapsed to single spaces, `\`, `[`,
// `]`, a backtick, `<` and `>` escaped with a backslash (the backslash too, so a
// backslash already in the text cannot cancel an escape), and capped at
// EVIDENCE_CAP characters, an ellipsis marking the cut. A cut never leaves half an
// escape pair or half a surrogate pair at the end.
function inertEvidence(text) {
  const flat = String(text === null || text === undefined ? '' : text).replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim();
  const escaped = flat.replace(ESCAPE_RE, (ch) => `\\${ch}`);
  if (escaped.length <= EVIDENCE_CAP) return escaped;
  let cut = escaped.slice(0, EVIDENCE_CAP - ELLIPSIS.length);
  let run = 0;
  while (run < cut.length && cut[cut.length - 1 - run] === '\\') run += 1;
  if (run % 2 === 1) cut = cut.slice(0, -1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}${ELLIPSIS}`;
}

// A `## ` section's lines, cut at a Key Files heading nested inside it, or null.
function h2SectionLines(body, heading) {
  const text = findSection(body, heading, { levelPattern: '2', stopPattern: '1,2' });
  if (text === null) return null;
  const lines = text.split('\n');
  const fenced = fencedLineMask(lines);
  const cut = lines.findIndex((line, i) => !fenced[i] && KEY_FILES_HEADING_RE.test(line));
  return cut === -1 ? lines : lines.slice(0, cut);
}

function readSections(body) {
  const keyFiles = findSection(body, 'Key Files');
  return {
    Deliverables: h2SectionLines(body, 'Deliverables'),
    'Acceptance Criteria': h2SectionLines(body, 'Acceptance Criteria'),
    'Key Files': keyFiles === null ? null : keyFiles.split('\n'),
  };
}

// The lines to match, in reading order: { line, text (keyword-matched), paths }.
function candidateLines(sections) {
  const out = [];
  for (const name of ['Deliverables', 'Acceptance Criteria']) {
    for (const line of sections[name] || []) if (line.trim() !== '') out.push({ line, text: line, paths: [] });
  }
  for (const line of sections['Key Files'] || []) {
    if (line.trim() === '') continue;
    const paths = [...line.matchAll(BACKTICK_SPAN_RE)].map((m) => m[1].trim()).filter(Boolean);
    out.push({ line, text: line.replace(BACKTICK_SPAN_RE, (span, inner) => (PATH_LIKE_RE.test(inner) ? ' ' : span)), paths });
  }
  return out;
}

function checkExtras(extraCategories) {
  const extras = extraCategories === null || extraCategories === undefined ? [] : extraCategories;
  if (!Array.isArray(extras)) throw new TypeError(`classifyRiskFlags(): extraCategories must be an array of slugs, got ${JSON.stringify(extras)}`);
  for (const slug of extras) {
    // The schema's own slug rule, read at call time, so this module accepts every
    // `risk-categories` entry the resolver accepts.
    if (typeof slug !== 'string' || !LIST_ELEMENT_PATTERNS.slug.test(slug)) throw new TypeError(`classifyRiskFlags(): invalid extra category ${JSON.stringify(slug)}: not a policy slug`);
  }
  return extras;
}

// A glob keyed by a slug outside the known set would classify a flag no reader knows,
// so it is refused rather than dropped.
function checkGlobs(pathGlobs, slugs) {
  const globs = pathGlobs === null || pathGlobs === undefined ? {} : pathGlobs;
  if (typeof globs !== 'object' || Array.isArray(globs)) throw new TypeError(`classifyRiskFlags(): pathGlobs must be a slug -> glob list map, got ${JSON.stringify(globs)}`);
  for (const [slug, list] of Object.entries(globs)) {
    if (!slugs.includes(slug)) throw new TypeError(`classifyRiskFlags(): pathGlobs names ${JSON.stringify(slug)}, which is neither a built-in category nor in extraCategories`);
    if (!Array.isArray(list) || list.some((glob) => typeof glob !== 'string')) throw new TypeError(`classifyRiskFlags(): pathGlobs.${slug} must be an array of glob strings`);
  }
  return globs;
}

function ruleFor(slug, globs) {
  const builtin = BUILTIN_RULES.get(slug);
  return {
    keyword: builtin ? builtin.keyword : new RegExp(`\\b${slug.split('-').map(escapeRegExp).join('[- ]')}\\b`, 'i'),
    paths: builtin ? builtin.paths : [],
    globs: Object.prototype.hasOwnProperty.call(globs, slug) ? globs[slug] : [],
  };
}

function matchVia(rule, candidate) {
  if (candidate.paths.some((p) => rule.paths.some((re) => re.test(p)))) return 'path';
  if (rule.globs.length > 0 && candidate.paths.some((p) => isSensitivePath(p, rule.globs))) return 'path-glob';
  if (rule.keyword.test(candidate.text)) return 'keyword';
  return null;
}

// body, { extraCategories, pathGlobs } -> { flags: [{ slug, evidence, via }], missingSections }.
// `evidence` is the matched line, list marker and checkbox stripped, through inertEvidence.
function classifyRiskFlags(body, opts) {
  const { extraCategories, pathGlobs } = opts || {};
  const slugs = unique([...BUILTIN_RISK_CATEGORIES, ...checkExtras(extraCategories)]);
  const globs = checkGlobs(pathGlobs, slugs);
  const sections = readSections(body);
  const candidates = candidateLines(sections);
  const flags = [];
  for (const slug of slugs) {
    const rule = ruleFor(slug, globs);
    for (const candidate of candidates) {
      const via = matchVia(rule, candidate);
      if (via === null) continue;
      flags.push({ slug, evidence: inertEvidence(candidate.line.replace(LIST_MARKER_RE, '')), via });
      break;
    }
  }
  return { flags, missingSections: SECTION_NAMES.filter((name) => sections[name] === null) };
}

const controlModeOff = () => ({ controlMode: false, extraCategories: [], pathGlobs: {}, globsInvalid: false });

// repoRoot, { readFile } -> { controlMode, extraCategories, pathGlobs, globsInvalid }.
// `.claude-tweaks/policy.yml` under repoRoot; an absent file (ENOENT/ENOTDIR) is control
// mode off and any other read error throws. `risk-categories` and `risk-path-globs` are
// consulted only with control mode on, each through resolvePolicyKeys; a rejected
// `risk-path-globs` block reads `globsInvalid: true` with no globs.
function readRiskPolicy(repoRoot, deps) {
  const { readFile = fs.readFileSync } = deps || {};
  let policyRaw;
  try {
    policyRaw = readFile(path.join(repoRoot, '.claude-tweaks', 'policy.yml'), 'utf8');
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return controlModeOff();
    throw error;
  }
  const mode = resolvePolicyKeys(['control-mode'], { policyRaw })['control-mode'];
  if (!isControlModeOn(mode.value)) return controlModeOff();
  const resolved = resolvePolicyKeys(['risk-categories', 'risk-path-globs'], { policyRaw });
  const categories = resolved['risk-categories'].value;
  const extraCategories = Array.isArray(categories) ? categories : String(categories).split(',').map((slug) => slug.trim()).filter(Boolean);
  const globs = resolved['risk-path-globs'];
  const globsInvalid = globs.invalid === true;
  return { controlMode: true, extraCategories, pathGlobs: globsInvalid || globs.value === null ? {} : globs.value, globsInvalid };
}

module.exports = { FLOOR, classifyRiskFlags, inertEvidence, readRiskPolicy };
