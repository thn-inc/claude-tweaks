// bin/lib/init/claude-md-conformance.js — deterministic conformance check for an
// adopting project's CLAUDE.md against the plugin's current template. Replaces
// init Phase 1u.5's hand-maintained contract-version marker greps: the markers
// went stale as the template changed, and never covered Working Approach or
// Philosophy at all.
'use strict';

// The Initial Mode Template lives inside a fenced ```markdown block so that the
// template's own h2 headings do not collide with the documentation headings of
// the file that carries it. Return the fence's contents, fences stripped.
function extractTemplateBody(templateSource) {
  const lines = templateSource.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Initial Mode Template');
  if (start === -1) throw new Error('claude-md-template.md has no "## Initial Mode Template" section');

  let open = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('```')) { open = i; break; }
  }
  if (open === -1) throw new Error('unterminated: no opening fence after "## Initial Mode Template"');

  let close = -1;
  for (let i = open + 1; i < lines.length; i++) {
    if (lines[i].trim() === '```') { close = i; break; }
  }
  if (close === -1) throw new Error('unterminated fence in the Initial Mode Template');

  const body = lines.slice(open + 1, close).join('\n');

  // Fail loudly on an ambiguous fence rather than returning a truncated
  // template. The outer fence and any same-length inner fence are
  // indistinguishable to this scan — per CommonMark the outer block would
  // terminate at the inner one — so a nested ``` block silently cuts the
  // template short and every section past it reads as missing. Plan A's removal
  // of the Project Defaults block is what makes this file unambiguous; this
  // assertion is what stops that dependency from being a silent assumption.
  if (!/^## Don'ts$/m.test(body)) {
    throw new Error(
      'Initial Mode Template extraction stopped early — expected the template to end with '
      + "a \"## Don'ts\" section. A nested ``` fence inside the template will do this.",
    );
  }

  return body;
}

// Map each `## Heading` to its body text. Nested headings inside a section
// (the template has none after the Project Defaults removal) are not split out.
function splitSections(markdown) {
  const sections = new Map();
  let current = null;
  let buffer = [];
  // Normalize CRLF pairs, then strip a lone trailing \r left behind when the
  // extracted body's last line had no paired \n to match against (e.g. a fenced
  // block sliced at its closing fence). Without this, JS's `$` anchor (no /m or
  // /s flags) can't match past a trailing \r, so the per-line heading regex
  // below fails silently on CRLF input and this function returns an empty Map.
  for (const line of markdown.replace(/\r\n/g, '\n').replace(/\r$/, '').split('\n')) {
    const m = /^## (.+)$/.exec(line);
    if (m) {
      if (current !== null) sections.set(current, buffer.join('\n'));
      current = m[1].trim();
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  if (current !== null) sections.set(current, buffer.join('\n'));
  return sections;
}

// Sections the plugin authors and therefore owns the content of. Only these are
// compared against the template.
const PLUGIN_AUTHORED_SECTIONS = [
  'Philosophy',
  'Working Approach',
  'claude-tweaks Pipeline',
];

// Sections the adopting project fills in from its own codebase. Never compared —
// a project's Stack table differing from the template's skeleton is the whole
// point of the template.
const PROJECT_AUTHORED_SECTIONS = [
  'Stack',
  'Structure',
  'Commands',
  'Conventions',
  'Testing',
  'Environment',
  'Git',
  'Releasing',
  "Don'ts",
];

// `## Philosophy` is plugin-authored but not byte-comparable: the Initial Mode
// Template carries only a placeholder for it, and its real content lives in the
// file's own "## Generating Philosophy" section and varies across three maturity
// blocks. It is reported present/absent only.
const PHILOSOPHY_EXCEPTION = 'Philosophy';

// A section in neither list is `unclassified` rather than silently assigned.
// Callers treat a non-empty `unclassified` as a hard error — that is what stops
// a newly added template section from escaping the conformance check.
function classifySections(sections) {
  const pluginAuthored = [];
  const projectAuthored = [];
  const unclassified = [];
  for (const name of sections.keys()) {
    if (PLUGIN_AUTHORED_SECTIONS.includes(name)) pluginAuthored.push(name);
    else if (PROJECT_AUTHORED_SECTIONS.includes(name)) projectAuthored.push(name);
    else unclassified.push(name);
  }
  return { pluginAuthored, projectAuthored, unclassified };
}

// Philosophy's expected body is not comparable byte-for-byte: the template
// carries a placeholder, and the generated content varies by the project's
// maturity classification. It is reported present/absent only.
function checkConformance({ templateSource, projectClaudeMd }) {
  const templateSections = splitSections(extractTemplateBody(templateSource));
  const { pluginAuthored, unclassified } = classifySections(templateSections);
  if (unclassified.length) {
    throw new Error(
      `Unclassified template section(s): ${unclassified.join(', ')}. Add each to `
      + 'PLUGIN_AUTHORED_SECTIONS or PROJECT_AUTHORED_SECTIONS. Refusing to run a '
      + 'conformance check that would silently ignore them.',
    );
  }
  const projectSections = splitSections(projectClaudeMd);

  const missing = [];
  const drifted = [];
  const conformant = [];

  for (const section of pluginAuthored) {
    const expected = (templateSections.get(section) || '').trim();
    if (!projectSections.has(section)) {
      // Philosophy's template body is a placeholder, not real content — never
      // offer it as a verbatim patch. Report it as needing generation from the
      // project's maturity classification instead (see "Generating Philosophy"
      // in claude-md-template.md).
      if (section === PHILOSOPHY_EXCEPTION) {
        missing.push({
          section,
          expected: null,
          generate: 'maturity-classification',
        });
      } else {
        missing.push({ section, expected });
      }
      continue;
    }
    if (section === PHILOSOPHY_EXCEPTION) {
      conformant.push(section);
      continue;
    }
    const actual = projectSections.get(section).trim();
    if (actual === expected) conformant.push(section);
    else drifted.push({ section, expected, actual });
  }

  return { missing, drifted, conformant };
}

module.exports = {
  extractTemplateBody,
  splitSections,
  classifySections,
  checkConformance,
  PLUGIN_AUTHORED_SECTIONS,
  PROJECT_AUTHORED_SECTIONS,
  PHILOSOPHY_EXCEPTION,
};
