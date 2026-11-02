// plugin/bin/lib/qa-scrub/scrub.js — scrubs one QA story's artifacts of the
// values its `secrets:` block declares (#4477). Called by bin/qa-scrub.js, which
// the qa-agent runs after closing a story's session (agents/qa-agent.md §6.5).
//
// Scope: every file under the story's screenshot dir and its trace dir, plus
// every file under playwright-cli's shared output dir (`.playwright-cli/`:
// page-*.yml snapshots, console-*.log, live traces/ with .trace/.network and a
// sha1-named resources/ dir) modified at or after `since`. That dir is shared by
// parallel stories, so only files that actually hold a match are rewritten.
//
// Order: resolve locator secrets to values from the in-scope snapshots, find
// every match, rewrite text artifacts with REDACTION_MARKER, delete what cannot
// be redacted (zip containers, binaries holding a match, and images from the
// reveal onward — pixels cannot be redacted by regex), then re-read everything
// that survived and fail on any hit. Secret values live only in this process's
// memory: the outcome carries counts and paths, never a value.
//
// Reveal time is the earliest mtime of a matching snapshot (.yml/.yaml): each
// snapshot is written once, at the moment it was taken, while logs and live
// traces are appended to and carry their last write's mtime. Images at or after
// it are deleted. A match found only outside snapshots leaves the reveal unknown,
// and every in-scope image is deleted.
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');
const { resolveLocatorValues } = require('./snapshot-locator');
const { scrubLine } = require('./line');

const REDACTION_MARKER = '[REDACTED:qa-secret]';
const MIN_VALUE_LENGTH = 4;
const SNAPSHOT_EXT = new Set(['.yml', '.yaml']);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function classify(buf) {
  const at = (i, ...bytes) => bytes.every((b, k) => buf[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image';
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) return 'zip';
  return buf.includes(0) ? 'binary' : 'text';
}

// Recursive file list under `dir`; a missing root is an empty scope.
function walk(dir, errors) {
  const out = [];
  if (!dir) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') errors.push({ path: dir, code: err.code || 'readdir-failed' });
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, errors));
    else out.push(p);
  }
  return out;
}

function collectScope({ screenshots, traces, cliDir, since }, errors) {
  const files = [];
  for (const p of [...walk(screenshots, errors), ...walk(traces, errors)]) files.push({ path: p });
  const sinceMs = since ? since.getTime() : null;
  for (const p of walk(cliDir, errors)) {
    let mtimeMs = null;
    try { mtimeMs = fs.statSync(p).mtimeMs; } catch { /* unreadable: kept in scope, fails on read */ }
    if (sinceMs === null || mtimeMs === null || mtimeMs >= sinceMs) files.push({ path: p });
  }
  for (const f of files) {
    try {
      f.mtimeMs = fs.statSync(f.path).mtimeMs;
      f.buf = fs.readFileSync(f.path);
      f.type = classify(f.buf);
    } catch (err) {
      f.readError = err.code || 'read-failed';
    }
  }
  return files;
}

function resolveLocators(secrets, files, errors) {
  const values = [];
  const snapshots = files.filter((f) => f.type === 'text' && SNAPSHOT_EXT.has(path.extname(f.path).toLowerCase()));
  secrets.forEach((s, i) => {
    if (s.kind !== 'locator') return;
    const found = new Set();
    for (const f of snapshots) for (const v of resolveLocatorValues(f.buf.toString('utf8'), s.locator)) found.add(v);
    if (found.size === 0) { errors.push({ locator: i, code: 'locator-unresolved' }); return; }
    for (const v of found) {
      if (v.length < MIN_VALUE_LENGTH) errors.push({ locator: i, code: 'locator-value-too-short' });
      else values.push(v);
    }
  });
  return values;
}

// Each matcher carries the label a match counts under: the literal value, or
// (for a pattern) null — the matched text itself.
function buildMatchers(secrets, values) {
  const matchers = [];
  const literals = [...new Set(values)].sort((a, b) => b.length - a.length);
  for (const v of literals) {
    matchers.push({ re: new RegExp(escapeRegExp(v), 'g'), label: v });
    const escaped = JSON.stringify(v).slice(1, -1);
    if (escaped !== v) matchers.push({ re: new RegExp(escapeRegExp(escaped), 'g'), label: v });
  }
  for (const s of secrets) if (s.kind === 'pattern') matchers.push({ re: new RegExp(s.regex.source, 'g'), label: null });
  return matchers;
}

function findMatches(text, matchers, found) {
  let hit = false;
  for (const { re, label } of matchers) {
    for (const m of text.matchAll(re)) {
      hit = true;
      if (found) found.add(label === null ? m[0] : label);
    }
  }
  return hit;
}

function scrubStoryArtifacts({ secrets, screenshots, traces = null, cliDir = null, since = null }) {
  const errors = [];
  const remaining = new Set();
  const deleted = [];
  const files = collectScope({ screenshots, traces, cliDir, since }, errors);
  for (const f of files) if (f.readError) { errors.push({ path: f.path, code: f.readError }); remaining.add(f.path); }
  const readable = files.filter((f) => !f.readError);

  const values = resolveLocators(secrets, readable, errors);
  const matchers = buildMatchers(secrets, values);

  // Find.
  const found = new Set();
  let revealMs = null;
  let matchedOutsideSnapshots = false;
  for (const f of readable) {
    if (f.type === 'image' || f.type === 'zip') continue;
    f.text = f.buf.toString(f.type === 'text' ? 'utf8' : 'latin1');
    f.hit = findMatches(f.text, matchers, found);
    if (!f.hit) continue;
    if (f.type === 'text' && SNAPSHOT_EXT.has(path.extname(f.path).toLowerCase())) {
      revealMs = revealMs === null ? f.mtimeMs : Math.min(revealMs, f.mtimeMs);
    } else {
      matchedOutsideSnapshots = true;
    }
  }
  let reveal = 'none';
  if (revealMs !== null) reveal = 'snapshot';
  else if (matchedOutsideSnapshots) reveal = 'unknown';

  // Act.
  let rewritten = 0;
  let removedImages = 0;
  const removeFile = (f, reason) => {
    try {
      fs.unlinkSync(f.path);
      f.gone = true;
      if (reason) deleted.push({ path: f.path, reason });
      return true;
    } catch (err) {
      errors.push({ path: f.path, code: err.code || 'unlink-failed' });
      remaining.add(f.path);
      return false;
    }
  };
  for (const f of readable) {
    if (f.type === 'zip') {
      removeFile(f, 'zip-container');
    } else if (f.type === 'binary' && f.hit) {
      removeFile(f, 'binary');
    } else if (f.type === 'text' && f.hit) {
      let text = f.text;
      for (const { re } of matchers) text = text.replace(re, REDACTION_MARKER);
      try { writeFileAtomic(f.path, text); rewritten += 1; } catch (err) {
        errors.push({ path: f.path, code: err.code || 'write-failed' });
        remaining.add(f.path);
      }
    } else if (f.type === 'image') {
      const drop = reveal === 'unknown' || (reveal === 'snapshot' && f.mtimeMs >= revealMs);
      if (drop && removeFile(f, null)) removedImages += 1;
    }
  }

  // Verify: every surviving non-image file is re-read and must hold no match.
  for (const f of readable) {
    if (f.gone || f.type === 'image' || remaining.has(f.path)) continue;
    try {
      const buf = fs.readFileSync(f.path);
      if (findMatches(buf.toString(f.type === 'text' ? 'utf8' : 'latin1'), matchers, null)) remaining.add(f.path);
    } catch (err) {
      errors.push({ path: f.path, code: err.code || 'read-failed' });
      remaining.add(f.path);
    }
  }
  // A locator that resolved to no usable value cannot be proven gone anywhere.
  if (errors.some((e) => e.locator !== undefined)) {
    for (const f of files) if (!f.gone) remaining.add(f.path);
  }

  const counts = {
    values_scrubbed: found.size,
    artifacts_scrubbed: rewritten + deleted.length,
    screenshots_removed: removedImages,
  };
  return {
    ok: remaining.size === 0 && errors.length === 0,
    ...counts,
    deleted,
    remaining: [...remaining].sort(),
    errors,
    reveal,
    no_matches: found.size === 0,
    line: scrubLine(counts),
  };
}

module.exports = { scrubStoryArtifacts, REDACTION_MARKER, MIN_VALUE_LENGTH };
