'use strict';

// Builds the replay judge prompts from the production tiebreak template
// (plugin/skills/review/step3-tiebreak.md), so an edit to that template changes
// what the replay sends. Pure text; no file or process access.

const { toPosix } = require('./schema.js');
const { split: splitLines } = require('./util.js');

const REPLY_MARKER = 'Reply with exactly';
const CHUNK_BLOCK_END = '{\u2026 one such block';

function loadTemplate(tiebreakMdText) {
  const lines = splitLines(tiebreakMdText);
  const heading = lines.findIndex((l) => l.trim() === '## Dispatch');
  if (heading === -1) throw new Error('step3-tiebreak.md: no "## Dispatch" heading');
  // The single-finding template is the first fence under the heading, the chunk template the second.
  const fence = (from) => {
    const open = lines.findIndex((l, i) => i > from && l.startsWith('```'));
    if (open === -1) throw new Error('step3-tiebreak.md: no fenced template after "## Dispatch"');
    const close = lines.findIndex((l, i) => i > open && l.startsWith('```'));
    if (close === -1) throw new Error('step3-tiebreak.md: the template fence under "## Dispatch" is not closed');
    return { body: lines.slice(open + 1, close), close };
  };
  const single = fence(heading);
  const chunk = fence(single.close);
  const body = single.body;
  const split = body.findIndex((l, i) => l === '' && i + 1 < body.length && body[i + 1].startsWith(REPLY_MARKER));
  if (split === -1) throw new Error('step3-tiebreak.md: no blank line before "' + REPLY_MARKER + '" in the template');
  return { block: body.slice(0, split), rest: body.slice(split + 1), chunk: chunkTemplate(chunk.body) };
}

// The chunk template: a Diff scope line, one block per finding headed "Id: {id}", a marker line, then the shared rules.
function chunkTemplate(body) {
  const first = body.findIndex((l) => l.startsWith('Id: {'));
  const end = body.findIndex((l) => l.startsWith(CHUNK_BLOCK_END));
  if (first === -1) throw new Error('step3-tiebreak.md: the chunk template has no "Id: {" block line');
  if (end === -1) throw new Error('step3-tiebreak.md: the chunk template has no "' + CHUNK_BLOCK_END + '" marker line');
  const block = body.slice(first, end);
  while (block.length && block[block.length - 1].trim() === '') block.pop();
  const rest = body.slice(end + 1);
  while (rest.length && rest[0].trim() === '') rest.shift();
  return { block, rest };
}

function backtickLine(lines, prefix) {
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('`' + prefix) && t.endsWith('`') && t.length > prefix.length + 2) {
      return t.slice(1, -1);
    }
  }
  return null;
}

function disciplineLines(text) {
  const lines = splitLines(text);
  const readOnly = backtickLine(lines, 'READ-ONLY REVIEW: ');
  const shell = backtickLine(lines, 'SHELL DISCIPLINE: ');
  if (readOnly === null || shell === null) return null;
  return { readOnly, shell };
}

// `needScope` is false for a chunk block, whose Diff scope line is written once above all the blocks.
function fillFinding(block, finding, { treeRoot, base, head }, needScope = true) {
  const seen = { finding: false, severity: false, location: false, scope: !needScope };
  const out = [];
  let inPositions = false;
  for (const line of block) {
    if (line.startsWith('Positions:')) {
      inPositions = true;
      if (finding.positions && finding.positions.length) {
        out.push('Positions:');
        for (const p of finding.positions) out.push('- ' + p.claim + ' (' + p.severity + ')');
      }
      continue;
    }
    if (inPositions && line.startsWith('- {')) continue;
    inPositions = false;
    if (line.startsWith('Id: {')) { out.push('Id: ' + finding.id); continue; }
    if (line.startsWith('Finding: {')) { seen.finding = true; out.push('Finding: ' + finding.claim); }
    else if (line.startsWith('Severity: {')) { seen.severity = true; out.push('Severity: ' + finding.severity); }
    else if (line.startsWith('Location: {')) {
      seen.location = true;
      // Forward slashes on every platform, so a judge's citation of it strips back to the repo-relative path (score.js's stripTree).
      out.push('Location: ' + toPosix(treeRoot) + '/' + finding.path + ':' + finding.line);
    } else if (line.startsWith('Diff scope: {')) { seen.scope = true; out.push('Diff scope: ' + base + '...' + head); }
    else out.push(line);
  }
  const names = { finding: 'Finding', severity: 'Severity', location: 'Location', scope: 'Diff scope' };
  for (const k of Object.keys(seen)) {
    if (!seen[k]) throw new Error('step3-tiebreak.md: template has no "' + names[k] + ': {" placeholder line');
  }
  return out;
}

function fillRest(rest, discipline) {
  let readOnly = false;
  let shell = false;
  const out = [];
  for (const line of rest) {
    if (line.startsWith('[... READ-ONLY REVIEW')) { readOnly = true; out.push(discipline.readOnly); }
    else if (line.startsWith('[... SHELL DISCIPLINE')) { shell = true; out.push(discipline.shell); }
    else if (line.startsWith('SCRATCH:') || line.startsWith('[Use:')) continue;
    else out.push(line);
  }
  if (!readOnly) throw new Error('step3-tiebreak.md: template has no "[... READ-ONLY REVIEW" placeholder line');
  if (!shell) throw new Error('step3-tiebreak.md: template has no "[... SHELL DISCIPLINE" placeholder line');
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

function chunkPrompt(template, findings, ctx) {
  if (!template.chunk) throw new Error('step3-tiebreak.md: no chunk template');
  const out = ['Diff scope: ' + ctx.base + '...' + ctx.head, ''];
  for (const f of findings) out.push(...fillFinding(template.chunk.block, f, ctx, false), '');
  out.push(...fillRest(template.chunk.rest, ctx.discipline));
  return out.join('\n');
}

function buildPrompt(template, findings, ctx) {
  if (!findings || findings.length === 0) throw new Error('buildPrompt: no findings');
  if (findings.length >= 2) return chunkPrompt(template, findings, ctx);
  const rest = fillRest(template.rest, ctx.discipline);
  return [...fillFinding(template.block, findings[0], ctx), '', ...rest].join('\n');
}

module.exports = { loadTemplate, disciplineLines, fillFinding, buildPrompt };
