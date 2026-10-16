// plugin/bin/lib/verify/qa-stamp.js — the QA pass stamp (#3003). Records that a
// pipeline QA run passed every selected story at one clean commit, so a later
// /claude-tweaks:test call at the same HEAD (a dispatched group's second call)
// can skip re-running them. Bound to HEAD and to each story file's sha256: a
// story YAML edited since the stamp (Phase 4.5's selector recoveries included)
// is never covered. Lives beside the verification stamp in the checkout's own
// git dir (report.js's gitDir()), so both dispatch calls in one worktree read
// it. bin/qa-stamp.js is the only writer. Reads fail toward absence, like
// stamp.js: anything malformed is null, never a covering stamp.
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');

const QA_STAMP_NAME = 'claude-tweaks-qa-pass.json';
const SHA_RE = /^[0-9a-f]{40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const PASSED = new Set(['PASS', 'PASS_WITH_CAVEATS']);

function composeQaStamp({
  report, head, dirty, storyHashes, storiesDir, reportPath, at,
}) {
  const stories = report && Array.isArray(report.stories) ? report.stories : [];
  if (stories.length === 0) return { error: 'no-stories' };
  for (const s of stories) {
    if (!PASSED.has(s.status)) return { error: `story-not-passed: ${s.id} ${s.status}` };
  }
  const summary = (report && report.summary) || {};
  if ((summary.failed || 0) > 0 || (summary.skipped || 0) > 0) return { error: 'summary-not-clean' };
  if (summary.total !== stories.length) return { error: 'summary-mismatch' };
  if (dirty !== false) return { error: 'dirty-tree' };
  if (typeof head !== 'string' || !SHA_RE.test(head)) return { error: 'no-head' };
  const entries = [];
  for (const s of stories) {
    const sha256 = storyHashes[s.source_file];
    if (typeof sha256 !== 'string') return { error: `story-file-unreadable: ${s.source_file}` };
    entries.push({ id: s.id, file: s.source_file, sha256 });
  }
  return {
    stamp: {
      sha: head, dirty: false, stories: entries, storiesDir, at, reportPath,
    },
  };
}

function decideQaSkip({
  stamp, head, dirty, storiesDir, selected,
}) {
  if (!stamp) return { skip: false, reason: 'no-stamp' };
  if (dirty !== false) return { skip: false, reason: 'dirty-tree' };
  if (stamp.sha !== head) return { skip: false, reason: 'sha-mismatch' };
  if (stamp.storiesDir !== storiesDir) return { skip: false, reason: 'stories-dir-mismatch' };
  if (!Array.isArray(selected) || selected.length === 0) return { skip: false, reason: 'nothing-selected' };
  for (const sel of selected) {
    const entry = stamp.stories.find((s) => s.id === sel.id && s.file === sel.file);
    if (!entry) return { skip: false, reason: `story-not-covered: ${sel.id}` };
    if (entry.sha256 !== sel.sha256) return { skip: false, reason: `story-changed: ${sel.id}` };
  }
  return { skip: true, reason: 'covered' };
}

function validStory(s) {
  return s !== null && typeof s === 'object' && typeof s.id === 'string'
    && typeof s.file === 'string' && typeof s.sha256 === 'string' && HASH_RE.test(s.sha256);
}

function readQaStamp(gitDir, fsImpl = fs) {
  let parsed;
  try { parsed = JSON.parse(fsImpl.readFileSync(path.join(gitDir, QA_STAMP_NAME), 'utf8')); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object') return null;
  if (typeof parsed.sha !== 'string' || !SHA_RE.test(parsed.sha)) return null;
  if (parsed.dirty !== false) return null;
  if (!Array.isArray(parsed.stories) || !parsed.stories.every(validStory)) return null;
  return parsed;
}

function writeQaStamp(gitDir, stamp, fsImpl = fs) {
  const p = path.join(gitDir, QA_STAMP_NAME);
  writeFileAtomic(p, `${JSON.stringify(stamp, null, 2)}\n`, {
    writeFile: fsImpl.writeFileSync,
    rename: fsImpl.renameSync,
    unlink: fsImpl.unlinkSync || (() => {}),
  });
  return p;
}

module.exports = {
  composeQaStamp, decideQaSkip, readQaStamp, writeQaStamp, QA_STAMP_NAME,
};
