'use strict';

// bin/lib/tidy-report-lint/rules.js — mechanical checks for the tidy report
// render's conformance scan (plugin/skills/tidy/step-6-auto.md, "Conformance
// scan" section, #731). Each function below is the mechanical counterpart to
// one row of that table; the `name` on each RULES entry is copied verbatim
// from the table's `Rule` column so the two stay greppable against each
// other — the row itself carries this file's path as its own "Remedy"
// cross-reference. Keep this file and that table in lockstep: a prose-only
// rule addition with no matching entry here is exactly the drift #731 warns
// against.
//
// Every check takes the full rendered report text and returns either `null`
// (the rule holds) or one string describing the first violation — "one line
// per failing row" per #731's acceptance criteria means one output line per
// FAILING TABLE ROW, not one line per occurrence within the input.
//
// Two rules are necessarily heuristic rather than fully mechanical, and are
// flagged as such where they're defined below: "Command alone" only catches
// the leading —/→ half of its rule (the "no trailing prose" half needs
// semantic judgment about what counts as prose); "Batch only where allowed"
// hardcodes today's batchable-skill list because this linter has no way to
// read a live SKILL.md argument-hint the way step-6-auto.md's own "read the
// hint at render time" instruction does — see BATCHABLE_SKILLS below.
//
// Surface-scoping (#1625): step-6-auto.md's Conformance scan intro documents
// a 7-rule/5-rule split for when the condense rule has fired and the report
// is checked as two separate texts (condensed chat render + `report.md`),
// plus one rule ("Every Yours row covered") the same intro names as applying
// on top of either surface. Each RULES entry below carries a `surface` tag
// ('condensed' | 'full' | 'both') pinning it to that documented split;
// `lintReport`'s `surface` option filters on it, always including 'both'.
// See the RULES declaration below for the exact partition.

const MAX_LINE = 100;
const MAX_TITLE = 50;

const SHORTHAND_PATTERNS = [
  { label: '(likewise', re: /\(likewise\b/i },
  { label: '(also', re: /\(also\b/i },
  { label: '(and N more', re: /\(and\s+\d+\s+more\b/i },
  { label: '(+N', re: /\(\+\d+\)/ },
  { label: 'et al', re: /\bet al\b/i },
];

const BOX_CHARS = /[┌─┐│├┤└┘]/;

// See the file header: this list can drift from a live argument-hint without
// warning. Keep it in sync with step-6-auto.md's Yours-grouping sentence
// ("Today that is /claude-tweaks:flow …, /claude-tweaks:dispatch …,
// /claude-tweaks:specify …, and /claude-tweaks:demo …") whenever that
// sentence changes.
const BATCHABLE_SKILLS = new Set([
  '/claude-tweaks:flow',
  '/claude-tweaks:dispatch',
  '/claude-tweaks:specify',
  '/claude-tweaks:demo',
]);

const YOURS_FIXED_PREFIX = ['specify', 'demo', 'git', 'capture', 'backlog refine'];

// A command line: an optional leading env-var assignment, then a
// fully-qualified skill invocation or a bare executable. Matches the same
// vocabulary step-6-auto.md's Report rules require ("fully-qualified
// /claude-tweaks:{skill} form for skill invocations").
const COMMAND_LINE = /^(?:[A-Z_][A-Z0-9_]*="[^"]*"\s+)*(?:\/claude-tweaks:|\/superpowers:|gh\s|git\s|node\s)/;

function lines(text) {
  return text.split('\n');
}

function extractFencedBlocks(text) {
  const ls = lines(text);
  const blocks = [];
  let inFence = false;
  let current = null;
  for (let i = 0; i < ls.length; i += 1) {
    const trimmed = ls[i].trim();
    if (!inFence && trimmed.startsWith('```')) {
      inFence = true;
      current = { startLine: i + 1, lines: [] }; // startLine: 1-indexed line of the fence-open marker itself
      continue;
    }
    if (inFence && trimmed === '```') {
      inFence = false;
      blocks.push(current);
      current = null;
      continue;
    }
    if (inFence) current.lines.push(ls[i]);
  }
  return blocks;
}

// The header line immediately above a fenced block, or '' when the block
// isn't directly preceded by one (blank lines between header and fence are
// tolerated, matching the template's own spacing).
function headerAbove(text, block) {
  const ls = lines(text);
  let i = block.startLine - 2; // 0-indexed line just above the fence-open marker
  while (i >= 0 && ls[i].trim() === '') i -= 1;
  return i >= 0 ? ls[i].trim() : '';
}

// The fenced block immediately below a `**Yours (N)**` header, or null when
// the report carries no Yours section (an empty section is omitted entirely
// per the Report rules' empty-state clause, so absence is not a violation).
function extractYoursFence(text) {
  for (const block of extractFencedBlocks(text)) {
    if (/\*\*Yours \(\d+\)\*\*/.test(headerAbove(text, block))) return block;
  }
  return null;
}

// Fences that use the shared trailing-column convention (Column shape rule).
// Approve's fence renders three plain lines with no trailing column, and
// Clean's fence has its own dedicated shape check — neither belongs here.
function alignedFences(text) {
  return extractFencedBlocks(text).filter((block) => {
    const header = headerAbove(text, block);
    return header === '**Applied automatically**' || /\*\*Yours \(\d+\)\*\*/.test(header);
  });
}

// Splits a Yours fence's raw lines into groups: a group head has no leading
// whitespace (`{command} ({k})`); every indented line beneath it belongs to
// that group, per the Column shape rule ("rows are indented three spaces
// under a group head").
function splitYoursGroups(blockLines) {
  const groups = [];
  let current = null;
  for (const line of blockLines) {
    if (line.trim() === '') continue;
    if (line[0] !== ' ' && line[0] !== '\t') {
      const head = line.trim();
      current = { head, key: head.replace(/\s*\(\d+\)\s*$/, ''), rows: [] };
      groups.push(current);
    } else if (current) {
      current.rows.push(line);
    }
  }
  return groups;
}

function groupSortKey(commandText) {
  if (commandText.startsWith('/claude-tweaks:')) return commandText.slice('/claude-tweaks:'.length);
  return commandText;
}

function checkWidth(text) {
  const ls = lines(text);
  for (let i = 0; i < ls.length; i += 1) {
    if (ls[i].length > MAX_LINE) {
      return `Width: line ${i + 1} is ${ls[i].length} chars (max ${MAX_LINE})`;
    }
  }
  return null;
}

// Title = the text between a `#{N}` ref and the following 2+-space gap (or
// end of line when there is none) — the lazy `(.+?)` expands to the first
// position where the optional trailing-gap group can match.
const TITLE_ROW = /#\d+\s{2,}(.+?)(?:\s{2,}\S.*)?$/;

function checkTitles(text) {
  const ls = lines(text);
  for (let i = 0; i < ls.length; i += 1) {
    const m = ls[i].match(TITLE_ROW);
    if (!m) continue;
    const title = m[1];
    if (title.length > MAX_TITLE) {
      return `Titles: line ${i + 1} title column "${title.slice(0, 20)}…" is ${title.length} chars (max ${MAX_TITLE})`;
    }
  }
  return null;
}

// Trailing column = the text after the LAST run of 2+ spaces on a line, with
// no further 2+-space run inside it (the negative lookahead keeps this from
// matching an earlier gap on a multi-column row).
const TRAILING_COL = /\s{2,}(\S(?:(?!\s{2,}).)*)$/;

function checkAligned(text) {
  for (const block of alignedFences(text)) {
    const header = headerAbove(text, block);
    const isYours = /\*\*Yours \(\d+\)\*\*/.test(header);
    const isApplied = header === '**Applied automatically**';
    const offsets = [];
    block.lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      // Within a Yours fence, only record rows carry a trailing column — a
      // group head (`{command} ({k})`, no leading whitespace) and a closing
      // command line have none, and would otherwise be misread as a
      // mis-aligned row.
      if (isYours && (line[0] !== ' ' || COMMAND_LINE.test(trimmed))) return;
      // Applied rows start at column 0 (a verb); a three-space-indented detail sub-line — a
      // reconcile skip reason or a filled Release Note (tidy/release-note-repair.md) — carries no
      // trailing column of its own. The exact three-space bound keeps a stray one-space indent on
      // a top-level Applied row (a mis-padding bug, not a sub-line) still flagged.
      if (isApplied && /^ {3}\S/.test(line)) return;
      const m = line.match(TRAILING_COL);
      if (!m) return;
      offsets.push({ idx, offset: line.length - m[1].length });
    });
    if (offsets.length < 2) continue;
    const expected = offsets[0].offset;
    for (const o of offsets) {
      if (o.offset !== expected) {
        return `Aligned: line ${block.startLine + o.idx + 1} trailing column starts at ${o.offset}, expected ${expected}`;
      }
    }
  }
  return null;
}

function checkOneRecordPerRow(text) {
  const ls = lines(text);
  for (let i = 0; i < ls.length; i += 1) {
    const trimmed = ls[i].trim();
    if (COMMAND_LINE.test(trimmed)) continue; // a batch line legitimately carries #{N},#{M},…
    const matches = trimmed.match(/#\d+/g);
    if (matches && matches.length > 1) {
      return `One record per row: line ${i + 1} carries ${matches.length} record refs (${matches.join(', ')})`;
    }
  }
  return null;
}

function checkNoShorthand(text) {
  const ls = lines(text);
  for (let i = 0; i < ls.length; i += 1) {
    for (const { label, re } of SHORTHAND_PATTERNS) {
      if (re.test(ls[i])) {
        return `No shorthand: line ${i + 1} contains "${label}"`;
      }
    }
  }
  return null;
}

// Only the leading —/→ half of this rule is mechanically checkable here —
// see the file header.
const LEADING_ANNOTATION = /^\s*[—→]\s*/;

function checkCommandAlone(text) {
  const ls = lines(text);
  for (let i = 0; i < ls.length; i += 1) {
    if (LEADING_ANNOTATION.test(ls[i]) && COMMAND_LINE.test(ls[i].replace(LEADING_ANNOTATION, ''))) {
      return `Command alone: line ${i + 1} has a leading —/→ before its command`;
    }
  }
  return null;
}

function checkEveryYoursRowCovered(text) {
  const block = extractYoursFence(text);
  if (!block) return null;
  for (const g of splitYoursGroups(block.lines)) {
    if (g.key === 'review') continue; // exempted per step-6-auto.md's Yours grouping rule
    const hasCommand = g.rows.some((l) => COMMAND_LINE.test(l.trim()));
    if (!hasCommand) {
      return `Every Yours row covered: group "${g.head}" has no closing command line`;
    }
  }
  return null;
}

function checkBatchOnlyWhereAllowed(text) {
  const block = extractYoursFence(text);
  if (!block) return null;
  for (const g of splitYoursGroups(block.lines)) {
    for (const row of g.rows) {
      const trimmed = row.trim();
      if (!COMMAND_LINE.test(trimmed)) continue;
      if (!/#\d+(?:\s*,\s*#\d+)+/.test(trimmed)) continue; // not a batch line
      const stripped = trimmed.replace(/^(?:[A-Z_][A-Z0-9_]*="[^"]*"\s+)+/, '');
      const cmd = stripped.split(/\s+/)[0];
      if (!BATCHABLE_SKILLS.has(cmd)) {
        return `Batch only where allowed: "${trimmed.slice(0, 60)}" batches refs on non-batchable command "${cmd}"`;
      }
    }
  }
  return null;
}

const SECTION_HEADER = /^\*\*(Applied automatically|Approve \(\d+\)|Yours \(\d+\)|Clean:)\*\*/;

function checkFencedNoBoxArt(text) {
  const ls = lines(text);
  const boxLine = ls.findIndex((l) => BOX_CHARS.test(l));
  if (boxLine !== -1) {
    return `Fenced, no box art: line ${boxLine + 1} contains a box-drawing character`;
  }
  for (let i = 0; i < ls.length; i += 1) {
    const m = ls[i].match(SECTION_HEADER);
    if (!m) continue;
    if (m[1] === 'Clean:' && /^\*\*Clean:\*\*\s*nothing\b/.test(ls[i].trim())) continue; // literal no-fence case
    let j = i + 1;
    while (j < ls.length && ls[j].trim() === '') j += 1;
    if (j >= ls.length || !ls[j].trim().startsWith('```')) {
      return `Fenced, no box art: section "${m[1]}" is not followed by a fence`;
    }
  }
  return null;
}

function checkGroupOrder(text) {
  const block = extractYoursFence(text);
  if (!block) return null;
  const keys = splitYoursGroups(block.lines).map((g) => groupSortKey(g.key));
  const rest = keys.filter((k) => !YOURS_FIXED_PREFIX.includes(k) && k !== 'review').sort();
  const expected = [
    ...YOURS_FIXED_PREFIX.filter((k) => keys.includes(k)),
    ...rest,
    ...(keys.includes('review') ? ['review'] : []),
  ];
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] !== expected[i]) {
      return `Group order: Yours groups render as [${keys.join(', ')}], expected [${expected.join(', ')}]`;
    }
  }
  return null;
}

function checkCleanShape(text) {
  const ls = lines(text);
  const idx = ls.findIndex((l) => l.trim().startsWith('**Clean:**'));
  if (idx === -1) return null; // omission is covered by other rules, not this one
  const trimmed = ls[idx].trim();
  if (trimmed === '**Clean:** nothing — every scan surfaced findings') return null;
  if (trimmed !== '**Clean:**') {
    return `Clean shape: line ${idx + 1} is neither the no-findings sentence nor bare "**Clean:**"`;
  }
  let j = idx + 1;
  while (j < ls.length && ls[j].trim() === '') j += 1;
  if (j >= ls.length || !ls[j].trim().startsWith('```')) {
    return `Clean shape: line ${idx + 1} "**Clean:**" is not followed by a fence`;
  }
  let k = j + 1;
  let sawLine = false;
  while (k < ls.length && !ls[k].trim().startsWith('```')) {
    if (ls[k].trim() !== '') {
      sawLine = true;
      if (!/^\S.*\s{2,}(\d+|—) checked\s*$/.test(ls[k])) {
        return `Clean shape: line ${k + 1} does not match "{scan}  {count} checked"`;
      }
    }
    k += 1;
  }
  if (!sawLine) return `Clean shape: "**Clean:**" fence has no scan lines`;
  return null;
}

function checkFooterOnce(text) {
  const matches = text.match(/decisions\.md/g) || [];
  if (matches.length !== 1) {
    return `Footer once: "decisions.md" appears ${matches.length} times (expected exactly 1)`;
  }
  return null;
}

function checkCondense(text) {
  const total = lines(text).length;
  if (total <= 40) return null;
  if (!/Full report:\s+\S+\/report\.md/.test(text)) {
    return `Condense: report is ${total} lines (over 40) with no "Full report: {run-dir}/report.md" footer`;
  }
  return null;
}

// Surface tag on each rule: which text step-6-auto.md's Conformance scan
// intro says this row is checked against when the condense rule has fired
// and the report is split across two texts (the condensed chat text and
// `report.md`). 'condensed' = the 7 rows the intro names explicitly
// ("Width, Titles, No shorthand, Command alone, Batch only where allowed,
// Aligned and Condense"); 'full' = the 5 remaining section-shape rows it
// names as checked "against the full report in report.md" (One record per
// row, Fenced, Group order, Clean shape, Footer once). 'both' is the one
// named exception the same intro calls out explicitly: "the surface-tagged
// rows below apply — and so does Every Yours row covered" — a condensed
// report that drops its Yours section fails this row exactly as a dropped
// Yours section in the full report would, so it runs against whichever text
// is being checked rather than sitting in either partition alone. When no
// condense split is in play (a single, un-split report), all 13 rules still
// run together; see lintReport's `surface` option below.
//
// Order matches step-6-auto.md's Conformance scan table, top to bottom.
const RULES = [
  { name: 'Width', check: checkWidth, surface: 'condensed' },
  { name: 'Titles', check: checkTitles, surface: 'condensed' },
  { name: 'Aligned', check: checkAligned, surface: 'condensed' },
  { name: 'One record per row', check: checkOneRecordPerRow, surface: 'full' },
  { name: 'No shorthand', check: checkNoShorthand, surface: 'condensed' },
  { name: 'Command alone', check: checkCommandAlone, surface: 'condensed' },
  { name: 'Every Yours row covered', check: checkEveryYoursRowCovered, surface: 'both' },
  { name: 'Batch only where allowed', check: checkBatchOnlyWhereAllowed, surface: 'condensed' },
  { name: 'Fenced, no box art', check: checkFencedNoBoxArt, surface: 'full' },
  { name: 'Group order', check: checkGroupOrder, surface: 'full' },
  { name: 'Clean shape', check: checkCleanShape, surface: 'full' },
  { name: 'Footer once', check: checkFooterOnce, surface: 'full' },
  { name: 'Condense', check: checkCondense, surface: 'condensed' },
];

const SURFACES = new Set(['condensed', 'full']);

// `options.surface`, when given, restricts the scan to the rule subset
// step-6-auto.md's Conformance scan intro documents for that surface
// ('condensed' or 'full' — see the RULES comment above), plus any rule
// tagged 'both'. Omitted (the default), every rule runs — the un-split,
// single-report case where the condense rule never fired and the whole
// report is one text.
function lintReport(text, options = {}) {
  const { surface } = options;
  if (surface !== undefined && !SURFACES.has(surface)) {
    throw new Error(`lintReport: surface must be "condensed" or "full" (got ${JSON.stringify(surface)})`);
  }
  const rules = surface === undefined ? RULES : RULES.filter((r) => r.surface === surface || r.surface === 'both');
  const issues = [];
  for (const rule of rules) {
    const issue = rule.check(text);
    if (issue) issues.push(issue);
  }
  return issues;
}

module.exports = {
  RULES,
  SURFACES,
  lintReport,
  // Exported for direct unit coverage of the trickier extraction helpers.
  extractFencedBlocks,
  extractYoursFence,
  splitYoursGroups,
};
