// bin/lib/ports/env-file.js — turns a leased port block into env-file
// content: which KEY=value lines a service list maps to, and how to splice
// those lines into a project's .env.local/.env as a clearly-marked managed
// region without disturbing anything else in the file.
'use strict';

const fs = require('fs');
const path = require('path');

const BEGIN_MARKER = '# claude-tweaks:ports begin — managed; edit port-services in .claude-tweaks/policy.yml instead';
const END_MARKER = '# claude-tweaks:ports end';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

function sanitizeServiceName(name) {
  return name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

// (services, base) -> [[key, value], ...], first service -> PORT, every
// later one -> {SANITIZED_UPPER_SNAKE}_PORT, offsets 0..n-1 from base.
function serviceVars(services, base) {
  return services.map((name, i) => {
    const key = i === 0 ? 'PORT' : `${sanitizeServiceName(name)}_PORT`;
    return [key, String(base + i)];
  });
}

// #1927: the leased block's base, exported as a stable per-checkout token a
// project can key non-port resources on (a test database name, a schema) —
// always the FIRST managed line, before PORT. Unique per checkout by the
// registry's construction; the plugin creates no databases, it hands the
// project the token.
const LEASE_KEY = 'CLAUDE_TWEAKS_LEASE';

function leaseVars(base) {
  return [[LEASE_KEY, String(base)]];
}

function detectEOL(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function buildRegionLines(lines) {
  return [BEGIN_MARKER, ...lines.map(([k, v]) => `${k}=${v}`), END_MARKER];
}

// Replace the text between the begin/end markers with `lines` (rendered as
// KEY=value), preserving every other line byte-for-byte including the
// file's own EOL style. Appends the region (after a trailing newline) when
// absent. Running this twice on its own output yields identical bytes.
function mergeManagedRegion(existingText, lines) {
  const regionLines = buildRegionLines(lines);

  if (!existingText) {
    return `${regionLines.join('\n')}\n`;
  }

  const eol = detectEOL(existingText);
  const body = existingText.endsWith(eol) ? existingText.slice(0, -eol.length) : existingText;
  const splitLines = body.length ? body.split(eol) : [];

  const beginIdx = splitLines.indexOf(BEGIN_MARKER);
  const endIdx = splitLines.indexOf(END_MARKER);

  const merged = (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx)
    ? [...splitLines, ...regionLines]
    : [...splitLines.slice(0, beginIdx), ...regionLines, ...splitLines.slice(endIdx + 1)];

  return merged.join(eol) + eol;
}

// The inverse of buildRegionLines: parses `KEY=value` pairs out of an
// existing managed region. Returns null when no (well-formed) region is
// present — a caller (ensure.js's staleness check) treats that the same as
// "nothing to compare against." A line inside the markers that isn't
// `KEY=value` is skipped rather than failing the whole parse.
function readManagedRegion(existingText) {
  if (!existingText) return null;
  const eol = detectEOL(existingText);
  const lines = existingText.split(eol);
  const beginIdx = lines.indexOf(BEGIN_MARKER);
  const endIdx = lines.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return null;

  const vars = [];
  for (const line of lines.slice(beginIdx + 1, endIdx)) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    vars.push([line.slice(0, eq), line.slice(eq + 1)]);
  }
  return vars;
}

function hasComposeFile(checkoutPath) {
  return COMPOSE_FILES.some((f) => fs.existsSync(path.join(checkoutPath, f)));
}

// Writes `.env.local` (always) and `.env` (only when a Compose file exists
// at the checkout root), merging the managed region into each. Skips the
// write entirely when the merged content is byte-identical to what's
// already on disk, so a no-op ensure() never bumps the file's mtime.
function writeEnvFiles(checkoutPath, vars) {
  const targets = [path.join(checkoutPath, '.env.local')];
  if (hasComposeFile(checkoutPath)) targets.push(path.join(checkoutPath, '.env'));

  const written = [];
  for (const target of targets) {
    let existing = '';
    try { existing = fs.readFileSync(target, 'utf8'); } catch { existing = ''; }
    const merged = mergeManagedRegion(existing, vars);
    if (merged !== existing) {
      fs.writeFileSync(target, merged);
      written.push(target);
    }
  }
  return { targets, written };
}

module.exports = {
  BEGIN_MARKER, END_MARKER, serviceVars, leaseVars, LEASE_KEY, mergeManagedRegion, readManagedRegion, hasComposeFile, writeEnvFiles,
};
