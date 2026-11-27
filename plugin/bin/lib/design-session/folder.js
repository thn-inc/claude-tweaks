// bin/lib/design-session/folder.js — topic slug and dated-folder match for a
// /claude-tweaks:design session (docs/superpowers/specs/{YYYY-MM-DD}-{slug}/).
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const MAX_SLUG = 50;

// '#N' / 'N' -> 'issue-N'; otherwise a lowercase ascii slug capped at
// MAX_SLUG on a word boundary. Throws when nothing slug-worthy remains.
function slugFor(input) {
  const raw = String(input == null ? '' : input).trim();
  const issue = /^#?(\d+)$/.exec(raw);
  if (issue) return `issue-${issue[1]}`;

  let slug = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    // Letters of another script (CJK, ...) leave no ascii: a stable hash slug.
    if (!/[\p{L}\p{N}]/u.test(raw)) throw new Error('empty topic');
    const hash = crypto.createHash('sha256').update(raw.normalize('NFC')).digest('hex');
    return `topic-${hash.slice(0, 10)}`;
  }

  if (slug.length > MAX_SLUG) {
    const cutInsideWord = slug[MAX_SLUG] !== '-';
    let head = slug.slice(0, MAX_SLUG);
    if (cutInsideWord) {
      const lastDash = head.lastIndexOf('-');
      if (lastDash > 0) head = head.slice(0, lastDash);
    }
    slug = head.replace(/-+$/, '');
  }
  return slug;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Newest existing directory whose name is exactly `{date}-{slug}`; otherwise
// the path a new session would use. Creates nothing.
function findFolder({ specsDir, slug, today }, fsImpl = fs) {
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRe(slug)}$`);
  let names = [];
  try {
    names = fsImpl.readdirSync(specsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && re.test(e.name))
      .map((e) => e.name);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    names = [];
  }
  if (names.length) {
    names.sort();
    return { folder: path.join(specsDir, names[names.length - 1]), existing: true };
  }
  return { folder: path.join(specsDir, `${today}-${slug}`), existing: false };
}

module.exports = { slugFor, findFolder, MAX_SLUG };
