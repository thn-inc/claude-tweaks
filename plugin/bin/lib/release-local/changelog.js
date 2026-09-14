'use strict';
// bin/lib/release-local/changelog.js — renders one CHANGELOG section in
// release-please's grammar (design stance 5) so a project can move between
// pr-first (release-please) and local-merge (this engine) with no format
// boundary. The byte grammar is pinned by tests/bin-lib/release-local/
// changelog-fixture.test.js against sections captured from release-please's
// own CHANGELOG; change this file only with a re-captured fixture in hand.
// Under local-merge there are no PRs, so no PR links; commit links and the
// compare URL need a repo URL, so both appear only when `origin` parses as a
// GitHub remote (ruling 1 in the plan).

// release-please's default changelog-sections: order is render order; hidden
// types render only when the commit is breaking (ruling 2).
const SECTIONS = [
  { type: 'feat', title: 'Features', hidden: false },
  { type: 'fix', title: 'Bug Fixes', hidden: false },
  { type: 'perf', title: 'Performance Improvements', hidden: false },
  { type: 'revert', title: 'Reverts', hidden: false },
  { type: 'docs', title: 'Documentation', hidden: true },
  { type: 'style', title: 'Styles', hidden: true },
  { type: 'chore', title: 'Miscellaneous Chores', hidden: true },
  { type: 'refactor', title: 'Code Refactoring', hidden: true },
  { type: 'test', title: 'Tests', hidden: true },
  { type: 'build', title: 'Build System', hidden: true },
  { type: 'ci', title: 'Continuous Integration', hidden: true },
];

// The https form tolerates an optional userinfo prefix (a plain user, or a
// token credential like `x-access-token:TOKEN@`) — never reflected in the
// returned url, which is always the canonical lowercase github.com form.
const GITHUB_REMOTE_RE = /^(?:https?:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;

function parseGitHubRemote(url) {
  const m = GITHUB_REMOTE_RE.exec(String(url || '').trim());
  return m ? { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` } : null;
}

const scopePrefix = (c) => (c.scope ? `**${c.scope}:** ` : '');

function bullet(c, repo) {
  const link = repo ? ` ([${c.sha.slice(0, 7)}](${repo.url}/commit/${c.sha}))` : '';
  return `* ${scopePrefix(c)}${c.description}${link}\n`;
}

function note(c) { return `* ${scopePrefix(c)}${c.breakingNote}\n`; }

function renderSection({ version, previousTag, date, commits, repo }) {
  const heading = repo && previousTag
    ? `## [${version}](${repo.url}/compare/${previousTag}...v${version}) (${date})`
    : `## ${version} (${date})`;
  const breaking = commits.filter((c) => c.breaking);
  const groups = [];
  for (const section of SECTIONS) {
    const list = commits.filter((c) => c.type === section.type && (!section.hidden || c.breaking));
    if (list.length) groups.push(`### ${section.title}\n\n${list.map((c) => bullet(c, repo)).join('')}`);
  }
  const notes = breaking.length ? `### ⚠ BREAKING CHANGES\n\n${breaking.map(note).join('')}\n` : '';
  return `${heading}\n\n\n${notes}${groups.join('\n\n')}`;
}

// Insert before the first version heading (release-please's `## [x](…)`,
// `## x (…)`, or this repo's legacy `## vX.Y.Z — …` — the boundary case the
// design's Non-goals keep: pre-boundary entries stay in their old form).
const FIRST_VERSION_HEADING_RE = /^##+ \[?v?\d+\.\d+\.\d+/m;

function prependSection(existing, section) {
  if (existing === null || existing === undefined || existing.trim() === '') return `# Changelog\n\n${section}`;
  const at = existing.search(FIRST_VERSION_HEADING_RE);
  if (at === -1) return `${existing.replace(/\s*$/, '')}\n\n${section}`;
  return `${existing.slice(0, at)}${section}\n${existing.slice(at)}`;
}

module.exports = { SECTIONS, parseGitHubRemote, renderSection, prependSection };
