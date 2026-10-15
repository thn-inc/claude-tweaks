'use strict';

// Harness cost-efficiency lens (#2741).
//
// A HarnessTax-style study found harness choice alone can move inference cost
// up to 5x for the same model on the same task, with no comparable change in
// success rate — a minimal four-tool harness (read/write/edit/bash) reached
// the cost-success Pareto frontier. `context-cost.js` already measures how
// big a skill's PROSE payload is; this module measures the other half of that
// same tax — a skill or subagent's declared TOOL roster — against that same
// four-tool reference point, plus how deep into `_shared/*.md` it reaches.
//
// Everything here is read-only and statically derived: a skill's own file
// size, its `allowed-tools:`/`tools:` frontmatter list, and how many distinct
// `_shared/*.md` files its own text cites. Live per-call token cost is not
// measured — it varies by conversation and isn't reproducible from the skill
// file alone (see the spec's own Technical Approach).
//
// Baseline is deliberately the literal four-tool reference point from the
// study (Read/Write/Edit/Bash) rather than a claude-tweaks-specific floor:
// this repo's skills routinely need more (Skill, Agent, AskUserQuestion), so
// the baseline is a fixed yardstick to measure overage AGAINST, not a claim
// that four tools is achievable here. A low ratio is not itself the goal.

const fs = require('node:fs');
const path = require('node:path');
const { splitFrontmatterFence } = require('../health-core/frontmatter-list');
const { escapeRegExp } = require('../shared-primitives');
const { listSkillDirs } = require('./skill-catalog');
const { measuredBytes, walkMarkdown } = require('./context-cost');

// The study's own reference point (read/write/edit/bash), named to this
// repo's actual built-in tool names.
const MINIMAL_BASELINE_TOOLS = ['Read', 'Write', 'Edit', 'Bash'];

// Parses a single-line, comma-separated frontmatter scalar field — the shape
// both `allowed-tools:` (SKILL.md) and `tools:` (an agent definition) use,
// e.g. `allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion`. Distinct from
// `parseFrontmatterListField` in frontmatter-list.js, which parses the
// multi-line `- item` bullet-list shape (`files:`/`paths:`) — a different
// field shape, not a special case of this one. Returns `null` when the field
// is absent (the common case — most skills declare no explicit tool scope and
// get the full default roster instead, which is itself the primary finding
// this lens surfaces) or the frontmatter fence itself is missing; returns []
// for a present-but-empty value (`tools:` with nothing after it).
function parseToolListField(content, fieldName) {
  const split = splitFrontmatterFence(content);
  if (!split) return null;
  const re = new RegExp(`^${escapeRegExp(fieldName)}:\\s*(.*)$`);
  const line = split.frontmatter.find((l) => re.test(l));
  if (line === undefined) return null;
  const value = line.match(re)[1].trim();
  if (!value) return [];
  return value.split(',').map((t) => t.trim()).filter(Boolean);
}

// `toolCount: null` means "no explicit scope declared" (implicitly unbounded
// — the full default roster) and is distinct from `toolCount: 0` (a declared
// but empty list). `overageRatio` is null whenever `toolCount` is, since
// there's nothing to ratio an unbounded roster against.
function toolCostEntry(tools) {
  if (tools === null) return { tools: null, toolCount: null, overageRatio: null };
  const toolCount = tools.length;
  return { tools, toolCount, overageRatio: toolCount / MINIMAL_BASELINE_TOOLS.length };
}

// Every shipped skill's declared tool scope, from its SKILL.md `allowed-tools:`
// frontmatter line.
function measureSkillToolCost(repoRoot) {
  const dir = path.join(repoRoot, 'skills');
  return listSkillDirs(repoRoot).map((name) => {
    const content = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8');
    return { name, ...toolCostEntry(parseToolListField(content, 'allowed-tools')) };
  });
}

// Every shipped agent definition's declared tool scope, from its `tools:`
// frontmatter line. `agents/` is a flat directory of `{name}.md` files (one
// file per agent, unlike `skills/{name}/SKILL.md`'s per-skill subdirectory) —
// absent entirely on a project with no custom agents, which is not an error.
function measureAgentToolCost(repoRoot) {
  const dir = path.join(repoRoot, 'agents');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const name = e.name.slice(0, -'.md'.length);
      const content = fs.readFileSync(path.join(dir, e.name), 'utf8');
      return { name, ...toolCostEntry(parseToolListField(content, 'tools')) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const SHARED_CITATION_RE = /_shared\/([A-Za-z0-9_-]+\.md)/g;

// Distinct `_shared/{name}.md` references a skill's own text cites — SKILL.md
// plus every sub-file beneath its directory — the citation-depth dimension
// the spec names alongside file size and tool count.
function countSharedCitations(repoRoot, skillName) {
  const dir = path.join(repoRoot, 'skills', skillName);
  const cited = new Set();
  for (const file of walkMarkdown(dir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(SHARED_CITATION_RE)) cited.add(m[1]);
  }
  return cited.size;
}

// Per-skill composite: tool cost + the guaranteed per-invocation SKILL.md
// byte payload (not sub-files, which are lazy-loaded — `context-cost.js`'s
// own distinction) + shared-citation depth. Sorted by byte size descending,
// matching this corpus's existing reporting convention
// (`measureSubFiles`/`overCeilingWarnings`).
function estimateHarnessCost(repoRoot) {
  const dir = path.join(repoRoot, 'skills');
  const entries = measureSkillToolCost(repoRoot).map(({ name, tools, toolCount, overageRatio }) => ({
    name,
    bytes: measuredBytes(path.join(dir, name, 'SKILL.md')).bytes,
    tools,
    toolCount,
    overageRatio,
    sharedCitations: countSharedCitations(repoRoot, name),
  }));
  entries.sort((a, b) => b.bytes - a.bytes);
  const unscopedCount = entries.filter((e) => e.toolCount === null).length;
  return { entries, totalSkills: entries.length, unscopedCount };
}

// Skills whose DECLARED tool count exceeds the baseline by more than
// `ratioThreshold` — never an unscoped skill (toolCount: null), since there's
// no declared count to ratio. An unscoped corpus majority is reported as the
// `unscopedCount` summary field instead (see estimateHarnessCost), since
// flagging each one individually would be noise, not signal, when it's the
// corpus norm rather than the exception.
function flagHighToolCount(entries, { ratioThreshold = 2 } = {}) {
  return entries.filter((e) => e.overageRatio !== null && e.overageRatio > ratioThreshold);
}

module.exports = {
  MINIMAL_BASELINE_TOOLS,
  parseToolListField,
  measureSkillToolCost,
  measureAgentToolCost,
  countSharedCitations,
  estimateHarnessCost,
  flagHighToolCount,
};
