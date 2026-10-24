// plugin/bin/lib/plan-audit/parser.js — plan markdown parsing for
// bin/plan-audit.js (#903). No formal plan grammar exists (materialize.md's
// Prerequisites); this parser's tolerated shapes are derived from real plans
// under docs/superpowers/plans/ and pinned by tests/bin-lib/plan-audit/
// fixtures. Pure: no fs, no process access.
'use strict';

const FILE_TYPES = ['Create', 'Modify', 'Delete', 'Test'];

// Matches one "Files:" bullet line, e.g.:
//   - Modify: `plugin/bin/lib/foo.js`
//   - Create: tests/foo.test.js
//   - Modify: `plugin/skills/flow/materialize.md:142-147` (trailing note)
// Captures the type and the raw remainder (path + any trailing annotation).
const FILE_BULLET_RE = new RegExp(
  `^[-*]\\s+(${FILE_TYPES.join('|')}):\\s*(.+)$`,
);

// A "Files:" (or "**Files:**") section header — the label may carry inline
// text on the same line (e.g. "**Files:** none (verification only).").
const FILES_HEADER_RE = /^\*{0,2}Files:\*{0,2}\s*(.*)$/;

// Extracts the path from a Files-bullet remainder: prefer a backticked span
// (the dominant style in real plans); otherwise take the first
// whitespace-delimited token. Either way, strip a trailing line-range suffix
// (":123-145" or ":123") — Check A needs a bare filesystem path.
function extractPath(remainder) {
  const backticked = remainder.match(/`([^`]+)`/);
  let raw = backticked ? backticked[1] : remainder.split(/\s+/)[0];
  raw = raw.replace(/:\d+(-\d+)?$/, '');
  return raw;
}

// Returns every { type, path } bullet found under any "Files:" section in
// the plan, across every Task block — a plan-authoring.md-shaped plan
// declares one Files: section per task, and Check A/headroom scan all of
// them, not just the first.
function extractFileEntries(text) {
  const lines = text.split('\n');
  const entries = [];
  let inFilesSection = false;
  for (const line of lines) {
    const bullet = line.match(FILE_BULLET_RE);
    if (bullet) {
      inFilesSection = true;
      entries.push({ type: bullet[1], path: extractPath(bullet[2]) });
      continue;
    }
    if (FILES_HEADER_RE.test(line.trim())) {
      inFilesSection = true;
      continue;
    }
    // A blank line doesn't end the section (bullets are often preceded by
    // one); any other non-bullet, non-blank line does.
    if (inFilesSection && line.trim() !== '' && !line.trim().startsWith('-') && !line.trim().startsWith('*')) {
      inFilesSection = false;
    }
  }
  return entries;
}

// "Scope keywords: foo, bar, baz" — line-anchored, case-insensitive label.
// Returns a trimmed, de-duplicated array (empty when the field is absent).
function extractScopeKeywords(text) {
  const match = text.match(/^Scope keywords:\s*(.+)$/im);
  if (!match) return [];
  return [...new Set(
    match[1].split(',').map((k) => k.trim()).filter(Boolean),
  )];
}

// "Premise-refs: path/to/migration.sql, https://example.com/spec" —
// plan-authoring-boundary-checks.md's Upstream-schema premise check: paths or URLs a
// plan claims to have read to prove a claimed semantic about a schema this
// project does not own. Same comma-separated/trim/de-dup shape as
// extractScopeKeywords above, line-anchored and case-insensitive — kept as
// its own function rather than folded into extractScopeKeywords so that
// function's existing array-shaped return value (and every current caller
// and test built against it) is unchanged; the field is optional, so an
// absent line returns empty, same as extractScopeKeywords does.
function extractPremiseRefs(text) {
  const match = text.match(/^Premise-refs:\s*(.+)$/im);
  if (!match) return [];
  return [...new Set(
    match[1].split(',').map((k) => k.trim()).filter(Boolean),
  )];
}

// Splits the plan into per-task blocks: { taskNumber, title, body }, one per
// "### Task N: ..." heading, body running to the next such heading (or EOF).
function extractTaskBlocks(text) {
  const headingRe = /^###\s+Task\s+(\d+):\s*(.*)$/gm;
  const headings = [];
  let m;
  while ((m = headingRe.exec(text)) !== null) {
    headings.push({ index: m.index, taskNumber: m[1], title: m[2].trim(), headingEnd: m.index + m[0].length });
  }
  return headings.map((h, i) => {
    const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
    return { taskNumber: h.taskNumber, title: h.title, body: text.slice(h.headingEnd, end) };
  });
}

// Within one task body, extracts the Step 2 Run:/Expected: pair (writing-plans'
// "Run test to verify it fails" sub-step). Matched by step NUMBER, not by the
// step's wording — real plans phrase the heading differently ("Run the new
// tests to verify they fail" vs "Run test to verify it fails"). Returns null
// when the task carries no Step 2 (or no Run:/Expected: pair under it) — a
// non-code task, per plan-audit.md's Check C.
function extractStep2Verification(taskBody) {
  const stepRe = /\*\*Step\s+2:[^*\n]*\*\*/g;
  const stepMatch = stepRe.exec(taskBody);
  if (!stepMatch) return null;
  // Scope the search window to the text between this Step 2 heading and the
  // next "- [ ] **Step" heading (or end of task body).
  const rest = taskBody.slice(stepMatch.index + stepMatch[0].length);
  const nextStep = rest.match(/\n[-*]\s*\[[ xX]?\]\s*\*\*Step\s+\d+:/);
  const window = nextStep ? rest.slice(0, nextStep.index) : rest;
  const runMatch = window.match(/^Run:\s*(.+)$/m);
  const expectedMatch = window.match(/^Expected:\s*(.+)$/m);
  if (!runMatch || !expectedMatch) return null;
  const backtickedCmd = runMatch[1].match(/`([^`]+)`/);
  const command = (backtickedCmd ? backtickedCmd[1] : runMatch[1]).trim();
  return { command, expected: expectedMatch[1].trim() };
}

// Broader than the strict heading matched by extractStep2Verification above
// (which requires bold "**Step 2:...**" text) — detects any checkbox-style
// Step 2 line regardless of wording or bold formatting, so a task can be
// classified as "Step 2 present" even when the strict extractor can't parse
// it. Used to distinguish "no Step 2 at all" (nothing to report; a non-code
// task, per plan-audit.md's Check C) from "Step 2 present but unparseable"
// (#1594's signal).
const STEP2_CHECKBOX_RE = /^[-*]\s*\[[ xX]?\]\s*.*\bStep\s+2\b.*$/m;

// Within one task body whose STEP2_CHECKBOX_RE already matched, returns a
// short raw excerpt (up to 5 non-blank lines, from the checkbox line to the
// next step heading or end of body) for diagnostic display when the strict
// Run:/Expected: extraction can't parse a verification pair from it. Returns
// null if no checkbox line is found (callers only invoke this after
// confirming one exists, but stays defensive rather than assuming).
function extractStep2RawExcerpt(taskBody) {
  const heading = STEP2_CHECKBOX_RE.exec(taskBody);
  if (!heading) return null;
  const afterHeading = taskBody.slice(heading.index + heading[0].length);
  const nextStep = afterHeading.match(/\n[-*]\s*\[[ xX]?\]\s*.*\bStep\s+\d+\b/);
  const window = heading[0] + (nextStep ? afterHeading.slice(0, nextStep.index) : afterHeading);
  return window.trim().split('\n').filter((line) => line.trim() !== '').slice(0, 5).join('\n');
}

// Convenience: every task whose Step 2 is present (a checkbox line matching
// STEP2_CHECKBOX_RE) but unparseable (extractStep2Verification finds no
// Run:/Expected: pair under it). A task with no Step 2 at all is never
// reported — that's a non-code task, per plan-audit.md's Check C.
// plan-audit.js's Check C reports these as warnings (never a hard finding) so
// a human can judge whether the plan needs updating to the canonical template
// or the parser needs to learn a legitimately new shape (#1594).
function extractUnparseableStep2s(text) {
  return extractTaskBlocks(text)
    .filter((task) => STEP2_CHECKBOX_RE.test(task.body) && extractStep2Verification(task.body) === null)
    .map((task) => ({
      taskNumber: task.taskNumber,
      title: task.title,
      raw: extractStep2RawExcerpt(task.body),
    }));
}

// Within one task body, extracts the Step 1 text (heading through the next
// Step heading or end of body) — #1999's Check C append-shape exception
// needs Step 1's own prose to look for a named path, alongside Step 2's
// Run:/Expected: pair. Returns null when the task carries no Step 1 heading.
function extractStep1Text(taskBody) {
  const stepRe = /\*\*Step\s+1:[^*\n]*\*\*/;
  const stepMatch = stepRe.exec(taskBody);
  if (!stepMatch) return null;
  const rest = taskBody.slice(stepMatch.index + stepMatch[0].length);
  const nextStep = rest.match(/\n[-*]\s*\[[ xX]?\]\s*\*\*Step\s+\d+:/);
  const window = stepMatch[0] + (nextStep ? rest.slice(0, nextStep.index) : rest);
  return window.trim();
}

// "Expected: FAIL after Step 1 ..." — the author-side escape hatch for
// Check C's append-shape heuristic (#1999): declares the shape explicitly,
// no path-matching needed. Still starts with "FAIL" so the existing
// extractVerificationChecks scope filter below keeps selecting the task.
const APPEND_MARKER_RE = /^FAIL\s+after\s+Step\s*1\b/i;

// Convenience: every task's Step 2 verification pair, only for tasks that
// have one and whose Expected text starts with FAIL (Check C's own scope —
// see plan-audit.md's "Finding" section). Each entry also carries #1999's
// append-shape inputs: step1Text (that task's own Step 1 prose, or null),
// taskFileEntries (that task's own Files: bullets — Check C's caller filters
// to Modify:/Test:), and appendMarker (the explicit marker above).
function extractVerificationChecks(text) {
  return extractTaskBlocks(text)
    .map((task) => ({ task, verification: extractStep2Verification(task.body) }))
    .filter(({ verification }) => verification && /^FAIL\b/i.test(verification.expected))
    .map(({ task, verification }) => ({
      taskNumber: task.taskNumber,
      title: task.title,
      command: verification.command,
      expected: verification.expected,
      step1Text: extractStep1Text(task.body),
      taskFileEntries: extractFileEntries(task.body),
      appendMarker: APPEND_MARKER_RE.test(verification.expected.trim()),
    }));
}

// Strips fenced code blocks (```...```) from text before it is tested for a
// prose marker — a plan header that quotes another plan's `**Execution:**
// batched` line inside a fenced example must not itself read as batched.
function stripFencedCodeBlocks(text) {
  // Backtick and tilde fences alike (both are CommonMark fences); an
  // unclosed fence strips nothing — the lazy quantifier needs its closer.
  return text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
}

// Task count for /build's single-task fast-lane condition (#1926): the plan
// file is the authority, never the diff or SDD's own narration. `batched`
// is true only for the two markers this record defines — the header line
// `**Execution:** batched` (text before the first "### Task" heading) or a
// task title carrying `[batch]` — because a batched dispatch bundles work
// items reviewed together, which the single-task equivalence never covers.
// The header check strips fenced code blocks first (task titles are single
// lines and need no such stripping).
function countTasks(text) {
  const blocks = extractTaskBlocks(text);
  const firstHeading = text.search(/^###\s+Task\s+\d+:/m);
  const header = firstHeading === -1 ? text : text.slice(0, firstHeading);
  const batched = /^\*\*Execution:\*\*\s*batched\s*$/m.test(stripFencedCodeBlocks(header))
    || blocks.some((b) => /\[batch\]/i.test(b.title));
  return { tasks: blocks.length, batched };
}

// ── Check E inputs: the spec's acceptance-criterion clauses (#3099) ────────
// The spec's `## Acceptance Criteria` section, split into items (one per
// top-level `-`/`*`/`+`/`1.` list line, a leading `[ ]` checkbox stripped)
// and each item into clauses on sentence ends and `;`. Ids are
// `AC{item}.{clause}`, both 1-based, item = position in the section (never
// the literal list number). A prose-only section (no list lines — about a
// tenth of real specs) makes each paragraph one item. Code spans and a few
// abbreviations are masked before splitting so `a; b` inside backticks and
// "e.g." never cut a clause. Anything the splitter cannot read confidently
// lands in `unparsed`, never in `clauses` (parse-signal-discipline): a
// missing or empty section, an item with an odd backtick count, an unbalanced
// `(`/`[`, or a fence, and — when the section does have list items — any
// stray prose paragraph beside them, except a one-line italic footer such as
// `_Filed by review via specShapedBody._`. A sub-bullet indented deeper than
// its parent item's marker folds into that item rather than becoming a new one.
const AC_HEADING_RE = /^##[ \t]+Acceptance Criteria[ \t]*$/i;
const AC_SECTION_END_RE = /^#{1,2}[ \t]/;
const AC_FENCE_RE = /^[ \t]*(```|~~~)/;
const AC_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+(.*)$/;
const AC_CHECKBOX_RE = /^\[[ xX]\][ \t]+/;
const AC_FOOTER_RE = /^(?:_[^_].*_|\*[^*].*\*)$/;
const AC_ABBREVIATION_RE = /\b(?:e\.g|i\.e|etc|vs|cf)\./gi;
// An HTML entity's trailing `;` (named `&amp;`, decimal `&#39;`, hex `&#x27;`)
// is never a clause-cut boundary — masked the same way a code span is, by
// replacing the whole matched entity (including its `;`) with same-length
// `x` filler so no `;` remains for the cutter to see. Real corpus regression:
// spec #272 AC4's "the judge&#39;s material..." mis-split into bogus clauses
// at every escaped apostrophe.
const AC_HTML_ENTITY_RE = /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g;
// An in-item sub-label like `3a.`/`2b.` (digits then one lowercase letter,
// then the period) is never its own clause boundary — real corpus
// regression: spec #287's "...not deleted outright. 3a. `grep ...`" split
// `3a.` off as a degenerate clause of its own. Checked against the masked
// text ending exactly at the candidate cut so it fires before the
// what-follows lowercase check below, regardless of what follows the label.
const AC_SUB_LABEL_END_RE = /\b\d+[a-z]\.$/;

function specSectionLines(specText, headingRe) {
  const lines = specText.replace(/\r\n?/g, '\n').split('\n');
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (AC_FENCE_RE.test(lines[i])) { inFence = !inFence; continue; }
    if (!inFence && headingRe.test(lines[i])) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const section = [];
  inFence = false;
  for (let i = start; i < lines.length; i++) {
    if (AC_FENCE_RE.test(lines[i])) inFence = !inFence;
    if (!inFence && AC_SECTION_END_RE.test(lines[i])) break;
    section.push(lines[i]);
  }
  return section;
}

function acceptanceSectionLines(specText) {
  return specSectionLines(specText, AC_HEADING_RE);
}

// Returns the item's clauses (trimmed, a trailing `;` dropped), or null when
// the item cannot be split confidently (odd backtick count — a code span the
// mask cannot bound). A cut is made after `;`, or after `.`/`!`/`?` followed
// by whitespace and a character that is not a lowercase letter, and never
// inside parentheses or brackets, nor right after an in-item sub-label
// (`3a.`, `2b.`).
function splitClauses(text) {
  if ((text.match(/`/g) || []).length % 2 !== 0) return null;
  const masked = text
    .replace(/`[^`]*`/g, (m) => `\`${'x'.repeat(m.length - 2)}\``)
    .replace(AC_HTML_ENTITY_RE, (m) => 'x'.repeat(m.length))
    .replace(AC_ABBREVIATION_RE, (m) => m.replace(/\./g, 'x'));
  const cuts = [];
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if ((ch === ')' || ch === ']') && depth > 0) depth -= 1;
    else if (depth === 0 && ch === ';') cuts.push(i + 1);
    else if (depth === 0 && (ch === '.' || ch === '!' || ch === '?')) {
      if (ch === '.' && AC_SUB_LABEL_END_RE.test(masked.slice(0, i + 1))) continue;
      const after = masked.slice(i + 1).match(/^\s+(\S)/);
      if (after && !/[a-z]/.test(after[1])) cuts.push(i + 1);
    }
  }
  // An opener left unclosed (depth != 0) is the same signal as an odd backtick
  // count: refuse rather than guess where the clause actually ends.
  if (depth !== 0) return null;
  const clauses = [];
  let from = 0;
  for (const cut of [...cuts, text.length]) {
    const clause = text.slice(from, cut).trim().replace(/;$/, '').trim();
    if (/[A-Za-z0-9]/.test(clause)) clauses.push(clause);
    from = cut;
  }
  return clauses.length ? clauses : null;
}

// Returns { clauses: [{id, item, text}], unparsed: [{item, raw}] }. `item` is
// null on an unparsed entry that belongs to no single item (no section, an
// empty section, a stray paragraph).
function extractAcceptanceClauses(specText) {
  const section = acceptanceSectionLines(specText);
  if (section === null) {
    return { clauses: [], unparsed: [{ item: null, raw: 'no "## Acceptance Criteria" section in the spec' }] };
  }
  const items = [];
  const paragraphs = [];
  let current = null;
  let prevBlank = true;
  let inFence = false;
  for (const line of section) {
    if (AC_FENCE_RE.test(line)) {
      inFence = !inFence;
      if (!current) {
        current = { lines: [], fenced: true };
        paragraphs.push(current);
      }
      current.fenced = true;
      current.lines.push(line.trim());
      prevBlank = false;
      continue;
    }
    if (inFence) { current.lines.push(line.trim()); continue; }
    if (line.trim() === '') {
      prevBlank = true;
      if (current && !items.includes(current)) current = null;
      continue;
    }
    const itemMatch = line.match(AC_ITEM_RE);
    if (itemMatch) {
      const indent = line.match(/^ */)[0].length;
      // A list line indented deeper than the open item's own marker is a sub-bullet
      // of that item, not a sibling — fold it in rather than letting it consume a
      // new item number and renumber everything after it.
      if (current && items.includes(current) && indent > current.indent) {
        current.lines.push(itemMatch[1].replace(AC_CHECKBOX_RE, '').trim());
      } else {
        current = { lines: [itemMatch[1].replace(AC_CHECKBOX_RE, '')], fenced: false, indent };
        items.push(current);
      }
    } else if (current && (/^\s/.test(line) || !prevBlank)) {
      current.lines.push(line.trim());
    } else {
      current = { lines: [line.trim()], fenced: false };
      paragraphs.push(current);
    }
    prevBlank = false;
  }
  const prose = paragraphs.filter((p) => p.fenced || !(p.lines.length === 1 && AC_FOOTER_RE.test(p.lines[0])));
  const unparsed = [];
  let units = items;
  if (items.length === 0) {
    if (prose.length === 0) {
      return { clauses: [], unparsed: [{ item: null, raw: 'empty "## Acceptance Criteria" section' }] };
    }
    units = prose;
  } else {
    for (const p of prose) unparsed.push({ item: null, raw: p.lines.join(' ') });
  }
  const clauses = [];
  units.forEach((unit, idx) => {
    const item = idx + 1;
    const raw = unit.lines.join(' ').trim();
    const split = unit.fenced ? null : splitClauses(raw);
    if (split === null) {
      unparsed.push({ item, raw });
      return;
    }
    split.forEach((text, c) => clauses.push({ id: `AC${item}.${c + 1}`, item, text }));
  });
  return { clauses, unparsed };
}

// ── Check E inputs: where a plan may claim coverage (#3099) ────────────────
// Three sources, read in one pass; a line inside a ``` or ~~~ fence is
// content of the step it sits in, never a heading, waiver, or table row:
// - waivers: a line `Waived AC{item}.{clause}: {reason}` (an optional `- `
//   bullet before it). A waiver line is consumed, so its own id never also
//   counts as a citation.
// - testSteps: the text of every `**Step N: {title}**` sub-step inside a
//   `### Task N:` block whose title names a test or a verification
//   (/\btests?\b|\bverif/i), from its heading to the next step heading.
// - mapRows: every markdown table row (a line starting with `|`) — a
//   spec-coverage map, when an author writes one. The installed upstream
//   writing-plans template carries no such table (superpowers 6.4.1), so it
//   is an accepted source, never an expected one.
const STEP_HEADING_RE = /^[-*]?[ \t]*(?:\[[ xX]?\][ \t]*)?\*\*Step[ \t]+\d+:([^*\n]*)\*\*/;
const TEST_STEP_TITLE_RE = /\btests?\b|\bverif/i;
// One waiver-line shape, two targets: an AC clause id (Check E) or a repo path
// (Check F, #3602). `targetPattern` supplies the single capture group.
function waiverLineRe(targetPattern) {
  return new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?Waived[ \\t]+${targetPattern}[ \\t]*:[ \\t]*(\\S.*?)[ \\t]*$`);
}
const WAIVER_RE = waiverLineRe('(AC\\d+\\.\\d+)');
const PATH_WAIVER_RE = waiverLineRe('`?([^\\s`:]+(?::\\d+(?:-\\d+)?)?)`?');

function extractCoverageSources(planText) {
  const waivers = [];
  const testSteps = [];
  const mapRows = [];
  let inTask = false;
  let inFence = false;
  let current = null;
  for (const line of planText.replace(/\r\n?/g, '\n').split('\n')) {
    const fence = AC_FENCE_RE.test(line);
    if (fence) inFence = !inFence;
    if (fence || inFence) {
      if (current) current.push(line);
      continue;
    }
    const waiver = line.match(WAIVER_RE);
    if (waiver) {
      waivers.push({ id: waiver[1], reason: waiver[2] });
      continue;
    }
    if (/^[ \t]*\|/.test(line)) mapRows.push(line);
    if (/^###[ \t]+Task[ \t]+\d+:/.test(line)) { inTask = true; current = null; continue; }
    if (/^#{1,3}[ \t]/.test(line)) { inTask = false; current = null; continue; }
    if (!inTask) continue;
    const step = line.match(STEP_HEADING_RE);
    if (step) {
      current = TEST_STEP_TITLE_RE.test(step[1]) ? [line] : null;
      if (current) testSteps.push(current);
      continue;
    }
    if (current) current.push(line);
  }
  return { waivers, testSteps: testSteps.map((s) => s.join('\n')), mapRows };
}

// ── Per-task role/review-risk markers (#3378) ──────────────────────────────
// Optional, line-anchored per-task markers an author adds below a
// "### Task N:" heading — never inside a fenced code block — so
// `build/dispatch.md`'s SDD invocation can forward a per-task model tier
// instead of defaulting every task in a spec to the header's `size:`
// mapping. Closed value sets; the one canonical source every other
// consumer (plan-authoring-checks.md, dispatch.md) cites rather than
// restates — a conformance test cross-checks the copies.
const TASK_MARKER_ROLES = ['transcription', 'integration', 'judgment'];
const TASK_MARKER_RISKS = ['high'];

// Same-line-only (`[ \t]*`, never `\s*` — see "Adding a fifth metadata line"
// in materialize.md for why: `\s` matches `\n` and would read past this
// line into the next one). Matched once per task body, first occurrence.
const ROLE_MARKER_RE = /^\*\*Role:\*\*[ \t]*(.*)$/m;
const RISK_MARKER_RE = /^\*\*Review risk:\*\*[ \t]*(.*)$/m;

// Returns { markers: boolean, tasks: [{ index, title, role, risk, roleRaw,
// riskRaw }] }. `index` is the task's own declared number (SDD addresses
// tasks by this identity, not by position in the file) as a Number.
// `role`/`risk` are the recognized value or null (an absent line, or a
// present line whose value isn't in the closed set above); `roleRaw`/
// `riskRaw` carry the line's raw trimmed value (or null when the line is
// absent at all) so a caller validating against the closed set (checks.js's
// `checkTaskMarkers`) can still name the actual offending value. `markers`
// is true iff ANY task carries a recognized marker KEY at all — a key
// present with an unrecognized value still counts (the task is marked, just
// invalidly), so `markers: false` means "no `**Role:**`/`**Review risk:**`
// line anywhere", never "no valid one". A marker line inside a fenced code
// block in a task body is stripped before matching, same as the batched
// marker's own header-fence handling in `countTasks` above.
function extractTaskMarkers(text) {
  const blocks = extractTaskBlocks(text);
  let markers = false;
  const tasks = blocks.map((b) => {
    const body = stripFencedCodeBlocks(b.body);
    const roleMatch = body.match(ROLE_MARKER_RE);
    const riskMatch = body.match(RISK_MARKER_RE);
    const roleRaw = roleMatch ? roleMatch[1].trim() : null;
    const riskRaw = riskMatch ? riskMatch[1].trim() : null;
    if (roleRaw !== null || riskRaw !== null) markers = true;
    return {
      index: Number(b.taskNumber),
      title: b.title,
      role: roleRaw !== null && TASK_MARKER_ROLES.includes(roleRaw) ? roleRaw : null,
      risk: riskRaw !== null && TASK_MARKER_RISKS.includes(riskRaw) ? riskRaw : null,
      roleRaw,
      riskRaw,
    };
  });
  return { markers, tasks };
}

// ── Check F inputs: repo paths the spec's Technical Approach / Gotchas name (#3602) ──
//
// extractSpecPaths reads the backticked spans of those two sections (Key Files
// is a `###` under Technical Approach, so it is included) and keeps the ones
// that look like a repo-relative file path. It never returns a silent empty:
// a line with an unbalanced backtick, or a section with an unclosed fence, is
// reported in `unparsed` so the caller can tell "could not read" from "names
// no paths". An absent section contributes nothing (both are optional).
const F_SECTIONS = ['Technical Approach', 'Gotchas'];
const REPO_PATH_RE = /^(?:\.\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?$/;

function looksLikeRepoPath(span) {
  return REPO_PATH_RE.test(span);
}

function normalizeRepoPath(p) {
  return p.replace(/^(?:\.\/)+/, '').replace(/:\d+(?:-\d+)?$/, '');
}

function hasUnclosedFence(lines) {
  return lines.filter((l) => AC_FENCE_RE.test(l)).length % 2 !== 0;
}

function extractSpecPaths(specText) {
  const paths = [];
  const unparsed = [];
  const seen = new Set();
  const specHasUnclosedFence = hasUnclosedFence(specText.replace(/\r\n?/g, '\n').split('\n'));
  for (const name of F_SECTIONS) {
    const lines = specSectionLines(specText, new RegExp(`^##[ \\t]+${name}[ \\t]*$`, 'i'));
    if (!lines) {
      // null is "absent" only when no fence is left open: an earlier unclosed
      // fence swallows this heading, and that must not read as "nothing here".
      if (specHasUnclosedFence) unparsed.push({ section: name, raw: `unclosed code fence before "## ${name}"` });
      continue;
    }
    if (hasUnclosedFence(lines)) {
      unparsed.push({ section: name, raw: `unclosed code fence in "## ${name}"` });
      continue;
    }
    let inFence = false;
    for (const line of lines) {
      if (AC_FENCE_RE.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      // An odd count, or a run of 2+ backticks (a double-backtick span the
      // single-backtick matcher below would mis-pair), is a line we cannot read.
      if ((line.match(/`/g) || []).length % 2 !== 0 || /``/.test(line)) {
        unparsed.push({ section: name, raw: line.trim() });
        continue;
      }
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        const span = m[1].trim();
        if (!looksLikeRepoPath(span)) continue;
        const path = normalizeRepoPath(span);
        if (seen.has(path)) continue;
        seen.add(path);
        paths.push({ path, section: name });
      }
    }
  }
  return { paths, unparsed };
}

// `Waived {path}: {reason}` lines in the plan — the Check F counterpart of
// Check E's `Waived AC{item}.{clause}: {reason}`. A fenced line is an example,
// not a waiver; a target that is not a repo path (e.g. an AC id) is skipped.
function extractPathWaivers(planText) {
  const waivers = [];
  let inFence = false;
  for (const line of planText.replace(/\r\n?/g, '\n').split('\n')) {
    if (AC_FENCE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(PATH_WAIVER_RE);
    if (m && looksLikeRepoPath(m[1])) waivers.push({ path: normalizeRepoPath(m[1]), reason: m[2] });
  }
  return waivers;
}

module.exports = {
  extractAcceptanceClauses,
  splitClauses,
  extractCoverageSources,
  looksLikeRepoPath,
  normalizeRepoPath,
  extractSpecPaths,
  extractPathWaivers,
  extractFileEntries,
  extractScopeKeywords,
  extractPremiseRefs,
  extractTaskBlocks,
  extractStep1Text,
  extractStep2Verification,
  extractVerificationChecks,
  extractUnparseableStep2s,
  countTasks,
  TASK_MARKER_ROLES,
  TASK_MARKER_RISKS,
  extractTaskMarkers,
};
