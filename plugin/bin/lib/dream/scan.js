// bin/lib/dream/scan.js — cross-session self-healing pass, core logic (#2691).
//
// Mines this account's own Claude Code session transcripts (JSONL, one file
// per session under `{configDir}/projects/*/*.jsonl`) for tool-call failures
// whose normalized signature repeats across two or more DISTINCT sessions —
// the two-session evidence bar — and composes a propose-only markdown
// writeup per qualifying pattern, quoting a short excerpt from each
// contributing session.
//
// Read-only over the transcript corpus; the only writes this module itself
// performs are the two already-sanctioned run-dir writers
// (bin/lib/stage-item/write.js's writeStagedItem, bin/lib/log-decision/
// append.js's appendEntry) — both confined to a caller-supplied `runDir`.
// This module has no code path that accepts an arbitrary target path, so it
// cannot write to CLAUDE.md or any `plugin/skills/**` file even in error —
// the two-session floor and the propose-only model are both enforced here,
// not left to prose convention (the record's own Gotchas section).
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WINDOW_DAYS = 14;
const MIN_SESSIONS_FLOOR = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_COMMAND_CHARS = 200;
const MAX_ERROR_CHARS = 300;
const MAX_NORMALIZED_CHARS = 100;

// Absolute-path-looking tokens (>=2 slashes) get redacted before an error
// line becomes part of a grouping signature or a quoted excerpt — a
// transcript path commonly embeds the account's home-directory username,
// and a bare signature shouldn't fragment on a value that differs only by
// worktree/run-id while describing the same underlying failure.
const PATH_TOKEN_RE = /\/[^\s]*\/[^\s]*/g;

function truncate(s, max) {
  if (typeof s !== 'string') return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function redactPaths(s) {
  return s.replace(PATH_TOKEN_RE, '<path>');
}

// List every `{configDir}/projects/*/*.jsonl` file whose mtime falls within
// the last `windowDays` days of `now`. Bounded by design (the record's
// Technical Approach: "not the full corpus unbounded") — a nightly pass
// re-scans a sliding window, not the whole history every run.
function listTranscriptFiles({
  configDir, windowDays = DEFAULT_WINDOW_DAYS, now = Date.now(), deps = fs,
}) {
  const projectsDir = path.join(configDir, 'projects');
  let projectDirs;
  try { projectDirs = deps.readdirSync(projectsDir); } catch { return []; }
  const cutoff = now - windowDays * DAY_MS;
  const files = [];
  for (const projectDir of projectDirs) {
    const full = path.join(projectsDir, projectDir);
    let stat;
    try { stat = deps.statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let entries;
    try { entries = deps.readdirSync(full); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = path.join(full, entry);
      let fstat;
      try { fstat = deps.statSync(filePath); } catch { continue; }
      if (fstat.mtimeMs < cutoff) continue;
      files.push({
        filePath, projectDir, sessionIdFromName: entry.replace(/\.jsonl$/, ''), mtimeMs: fstat.mtimeMs,
      });
    }
  }
  return files;
}

// Derive the leading shell "verb" from a Bash tool's command string — the
// first token, after stripping leading `VAR=value` assignments — so
// `git stash pop` and `VAR=1 git stash pop` group under the same `git`
// commandVerb instead of fragmenting on incidental env prefixes.
function bashCommandVerb(command) {
  if (typeof command !== 'string') return 'bash';
  const tokens = command.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  return tokens[i] || 'bash';
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

// First substantive line of a tool error's content, with any leading
// `Exit code N` header stripped (too generic to discriminate on its own —
// nearly every Bash failure starts with one), redacted, lowercased,
// whitespace-collapsed, and length-capped. This is the fingerprint grouping
// keys on; `commandVerb` supplies the rest of the discrimination.
function normalizeErrorLine(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  // A bare "Exit code N" header is skipped in favor of the next line only
  // when there IS a next line — some failures carry no further detail at
  // all (an empty stderr), and "exit code N" alone is still a real,
  // groupable signal in that case, not nothing.
  const first = (lines.length > 1 && /^Exit code \d+$/i.test(lines[0])) ? lines[1] : lines[0];
  if (!first) return '';
  return truncate(redactPaths(first).toLowerCase().replace(/\s+/g, ' ').trim(), MAX_NORMALIZED_CHARS);
}

// Parse one transcript file into a list of findings — one per is_error
// tool_result block, correlated back to the assistant tool_use that
// produced it via `tool_use_id`. Malformed lines are skipped, not fatal —
// a transcript is append-only application data, not a trusted grammar.
function extractErrorFindings({ filePath, sessionId, deps = fs }) {
  let raw;
  try { raw = deps.readFileSync(filePath, 'utf8'); } catch { return []; }
  const lines = raw.split('\n').filter(Boolean);
  const toolUseById = new Map();
  const findings = [];

  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    if (o.type === 'assistant' && Array.isArray(o.message && o.message.content)) {
      for (const block of o.message.content) {
        if (block && block.type === 'tool_use' && block.id) {
          toolUseById.set(block.id, { name: block.name, input: block.input });
        }
      }
    }

    if (o.type === 'user' && Array.isArray(o.message && o.message.content)) {
      for (const block of o.message.content) {
        if (!block || block.type !== 'tool_result' || !block.is_error) continue;
        const tool = toolUseById.get(block.tool_use_id) || {};
        const toolName = tool.name || 'unknown';
        const commandVerb = toolName === 'Bash' ? bashCommandVerb(tool.input && tool.input.command) : toolName;
        const errorText = toolResultText(block.content);
        const normalized = normalizeErrorLine(errorText);
        if (!normalized) continue;
        findings.push({
          signature: `${toolName}:${commandVerb}:${normalized}`,
          toolName,
          commandVerb,
          sessionId,
          filePath,
          timestamp: o.timestamp || null,
          command: tool.input && typeof tool.input.command === 'string' ? truncate(tool.input.command, MAX_COMMAND_CHARS) : null,
          errorExcerpt: truncate(redactPaths(errorText.trim()), MAX_ERROR_CHARS),
        });
      }
    }
  }
  return findings;
}

// Group findings by exact signature. Exact match (not fuzzy similarity) is
// deliberate — see memory note on n-gram similarity being a normalization
// artifact; a prototype gate with a two-session evidence bar should not
// also carry a soft-matching false-positive risk on top of it.
function groupFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    let g = groups.get(f.signature);
    if (!g) {
      g = {
        signature: f.signature, toolName: f.toolName, commandVerb: f.commandVerb, items: [], sessionIds: new Set(),
      };
      groups.set(f.signature, g);
    }
    g.items.push(f);
    g.sessionIds.add(f.sessionId);
  }
  return [...groups.values()];
}

// THE two-session evidence bar, enforced in code: a group whose findings
// come from fewer than `minSessions` distinct sessions is dropped here,
// unconditionally — a single-session anomaly (even one that repeated
// several times within that one session) never reaches a proposal.
// `minSessions` can be raised above the floor but never lowered below it —
// callers that need a stricter bar pass a higher number; nothing in this
// function accepts a value under MIN_SESSIONS_FLOOR.
function filterByEvidenceBar(groups, minSessions = MIN_SESSIONS_FLOOR) {
  const floor = Math.max(minSessions, MIN_SESSIONS_FLOOR);
  return groups
    .filter((g) => g.sessionIds.size >= floor)
    .sort((a, b) => b.sessionIds.size - a.sessionIds.size || b.items.length - a.items.length);
}

// One markdown proposal per qualifying group — propose-only by construction:
// this function returns a string. Nothing in this module writes it anywhere
// except through the caller's own writeStagedItem call into `runDir/staged/`.
function composeProposalMarkdown(group, { windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const sessionIds = [...group.sessionIds];
  const evidenceSessions = sessionIds.slice(0, 3);
  const evidence = evidenceSessions.map((sid) => {
    const item = group.items.find((f) => f.sessionId === sid);
    const lines = [`- Session \`${sid}\`${item.timestamp ? ` (${item.timestamp})` : ''}:`];
    if (item.command) lines.push(`  - Command: \`${item.command}\``);
    lines.push(`  - Error: \`${item.errorExcerpt}\``);
    return lines.join('\n');
  }).join('\n');

  return `# Dream pass — repeated failure across ${group.sessionIds.size} sessions

**Pattern:** \`${group.toolName}\` / \`${group.commandVerb}\` — ${group.signature.split(':').slice(2).join(':')}

**Evidence bar:** met — ${group.sessionIds.size} distinct sessions (window: last ${windowDays} days), ${group.items.length} total occurrence(s).

## Quoted evidence

${evidence}

## Proposal

This failure signature recurred across independent sessions. Consider whether it merits a
documented rule (a CLAUDE.md Don'ts entry, a skill's Gotchas note, or an auto-memory file) —
this proposal does not do that for you. **Nothing has been applied.** Review the quoted evidence
above, confirm it represents a real, generalizable mistake (not two unrelated failures that
happen to share surface text), and if so, make the documentation edit yourself — this pass
never edits CLAUDE.md or a skill file directly.

## Reject

If this is noise (coincidental text overlap, or the two sessions already understood the fix and
just hit the same transient condition twice), no action is needed — this file can be deleted or
left for the next cleanup pass. It was never auto-applied anywhere.
`;
}

function composeReportMarkdown({
  scannedFiles, windowDays, minSessions, groupsConsidered, proposals,
}) {
  const lines = [
    '# Dream pass — report',
    '',
    `Scanned ${scannedFiles} transcript file(s) from the last ${windowDays} day(s); evidence bar: ${minSessions} distinct sessions.`,
    `${groupsConsidered} distinct failure signature(s) found; ${proposals.length} met the evidence bar and were staged.`,
    '',
  ];
  if (proposals.length === 0) {
    lines.push('No repeating cross-session pattern met the evidence bar this run.');
  } else {
    lines.push('## Staged proposals');
    lines.push('');
    for (const p of proposals) {
      lines.push(`- \`staged/${p.id}.md\` — ${p.group.toolName}/${p.group.commandVerb}, ${p.group.sessionIds.size} sessions`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// Orchestrates list -> extract -> group -> filter. Pure with respect to the
// filesystem except through the injected `deps` (default: real `fs`) — a
// test can supply a fake `deps` with in-memory readdirSync/statSync/
// readFileSync to exercise this without touching disk or the real account's
// transcripts.
function runScan({
  configDir, windowDays = DEFAULT_WINDOW_DAYS, minSessions = MIN_SESSIONS_FLOOR, now = Date.now(), deps = fs,
}) {
  const files = listTranscriptFiles({
    configDir, windowDays, now, deps,
  });
  const findings = [];
  for (const f of files) {
    findings.push(...extractErrorFindings({ filePath: f.filePath, sessionId: f.sessionIdFromName, deps }));
  }
  const groups = groupFindings(findings);
  const qualifying = filterByEvidenceBar(groups, minSessions);
  return {
    scannedFiles: files.length, findings, groups, qualifying,
  };
}

module.exports = {
  DEFAULT_WINDOW_DAYS,
  MIN_SESSIONS_FLOOR,
  listTranscriptFiles,
  extractErrorFindings,
  groupFindings,
  filterByEvidenceBar,
  composeProposalMarkdown,
  composeReportMarkdown,
  runScan,
  bashCommandVerb,
  normalizeErrorLine,
  redactPaths,
};
