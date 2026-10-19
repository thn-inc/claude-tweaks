// bin/lib/issues/recent-commit-check.js — overlap screens for a finding about
// to be filed as a new record: recent-commit (#1316) and open-PR (#3191).
//
// Why: #1068 was filed describing exactly the symptom commit 73478c8b (refs
// #959) had already fixed the day before — nothing caught the near-duplicate
// before it reached `ready` and got materialized into a worktree/draft PR.
// This module is the shared heuristic screen the four health-sweep skills'
// filing steps and /claude-tweaks:capture's filing step run against a new
// finding's own title (and, optionally, touched files) before/around
// `gh issue create`, per spec #1316's Technical Approach (a): commit-message
// grep against the finding's own key terms/file paths over a lookback
// window's `git log`.
//
// Pure and local-only: the commit screen reads `git log`; the open-PR screen
// takes an already-fetched PR list (capture's skill prose runs `gh pr list`
// and hands the JSON in). Neither touches the network or `gh` itself — no
// timeout bound per the gh-api-module-pattern skill's local-only exemption.
// Fails toward null on any git failure (not a repo, no git on PATH, empty
// history) — this screen must never block or delay filing over its own
// inability to resolve an answer; see filing.md's fail-open framing at each
// of the five call sites.
'use strict';

const { execFileSync } = require('child_process');

const DEFAULT_LOOKBACK_DAYS = 14;
// Unscoped (no files given): require at least this many distinct terms to
// overlap a commit subject before calling it a "strong" match — a single
// common word shared between a finding title and an unrelated commit subject
// is exactly the false-positive/filing-time-noise case AC2 rules out.
const DEFAULT_MIN_TERM_MATCHES = 2;
const MIN_TERM_LENGTH = 4;

// Generic English stopwords plus health-sweep/spec vocabulary that recurs
// across unrelated findings (health/skill/fix/etc.) — words this common
// contribute no discriminating signal and would otherwise inflate every
// finding's term-match count. Deliberately conservative (short list, no
// domain tuning) — start conservative per the spec's own Gotchas and widen
// only from real filing-time signal.
const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'been', 'were', 'when', 'while',
  'about', 'into', 'onto', 'over', 'under', 'after', 'before', 'during',
  'should', 'would', 'could', 'their', 'there', 'these', 'those', 'which',
  'where', 'what', 'does', 'doesnt', 'isnt', 'wasnt', 'skill', 'health',
  'finding', 'issue', 'check', 'fixed', 'fixes', 'file', 'filed', 'filing',
]);

// title -> deduped array of lowercase words length >= MIN_TERM_LENGTH,
// stopwords dropped. Never touches the shell — used only for in-process
// string matching against commit subjects already fetched via git log.
function deriveKeyTerms(title) {
  if (typeof title !== 'string' || !title) return [];
  const words = title
    .toLowerCase()
    .replace(/[`*_#()[\]{}'".,:;!?/\\<>|~^$%&+=@]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= MIN_TERM_LENGTH && !STOPWORDS.has(w));
  return [...new Set(words)];
}

// { root, title?, terms?, files?, lookbackDays?, minTermMatches? }, execImpl?
// -> { lookbackDays, fileScoped, commits: [{sha, subject, date, matchedTerms}] }
//    sorted newest-first, or null (no plausible match, or git unavailable).
//
// terms, when supplied, is used verbatim (lowercased/deduped) instead of
// deriving from title — callers that already know a finding's key terms may
// pass them directly. files, when supplied, scopes the `git log` walk to
// commits touching those paths, and relaxes the match threshold to a single
// term (the file overlap itself is already half the signal).
function findRecentCommitOverlap({
  root, title, terms, files, lookbackDays = DEFAULT_LOOKBACK_DAYS, minTermMatches = DEFAULT_MIN_TERM_MATCHES,
} = {}, execImpl = execFileSync) {
  const cleanTerms = Array.isArray(terms) && terms.length > 0
    ? [...new Set(terms.map((t) => String(t || '').trim().toLowerCase()).filter((t) => t.length > 0))]
    : deriveKeyTerms(title);
  if (cleanTerms.length === 0) return null;

  const days = Number.isFinite(lookbackDays) && lookbackDays > 0
    ? Math.floor(lookbackDays) : DEFAULT_LOOKBACK_DAYS;
  const cleanFiles = (Array.isArray(files) ? files : [])
    .map((f) => String(f || '').trim()).filter((f) => f.length > 0);

  const args = ['-C', root, 'log', `--since=${days}.days`, '--no-merges', '--format=%H%x1f%s%x1f%aI'];
  // `--` is the standard git-log revision/path disambiguator (not the
  // rev-parse/merge-base `--end-of-options` hazard the gh-api-module-pattern
  // skill warns about) — required here since no revision is given, only paths.
  if (cleanFiles.length > 0) args.push('--', ...cleanFiles);

  let out;
  try {
    out = String(execImpl('git', args, { encoding: 'utf8' }));
  } catch {
    return null;
  }

  const commits = out.split('\n').filter(Boolean).map((line) => {
    const [sha, subject, date] = line.split('\x1f');
    return { sha, subject: subject || '', date: date || '' };
  });

  const scored = commits
    .map((c) => {
      const subjectLower = c.subject.toLowerCase();
      const matchedTerms = cleanTerms.filter((t) => subjectLower.includes(t));
      return { ...c, matchedTerms };
    })
    .filter((c) => c.matchedTerms.length > 0);

  const threshold = cleanFiles.length > 0 ? 1 : Math.max(1, minTermMatches);
  const strong = scored.filter((c) => c.matchedTerms.length >= threshold);
  if (strong.length === 0) return null;

  strong.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));

  return { lookbackDays: days, fileScoped: cleanFiles.length > 0, commits: strong };
}

// { title, prs, minTermMatches? } -> { prs: [{number, title, url, matchedTerms}] }
//    sorted by matchedTerms count (desc, then higher PR number first), or null.
//
// prs is an already-fetched open-PR list (`gh pr list --json number,title,url`).
// A PR matches when it shares at least minTermMatches key terms with the
// candidate title, by set intersection of deriveKeyTerms on both sides (not a
// substring test). Never throws: an empty or non-string title, or a prs value
// that is not an array, yields null; a PR entry without a string title is skipped.
function findOpenPrOverlap(opts) {
  const { title, prs, minTermMatches = DEFAULT_MIN_TERM_MATCHES } = opts || {};
  const candidateTerms = deriveKeyTerms(title);
  if (candidateTerms.length === 0 || !Array.isArray(prs)) return null;

  const threshold = Math.max(1, minTermMatches);
  const matches = [];
  for (const pr of prs) {
    if (!pr || typeof pr.title !== 'string') continue;
    const prTerms = new Set(deriveKeyTerms(pr.title));
    const matchedTerms = candidateTerms.filter((t) => prTerms.has(t));
    if (matchedTerms.length >= threshold) {
      matches.push({ number: pr.number, title: pr.title, url: pr.url, matchedTerms });
    }
  }
  if (matches.length === 0) return null;

  matches.sort((a, b) => (b.matchedTerms.length - a.matchedTerms.length)
    || ((Number(b.number) || 0) - (Number(a.number) || 0)));

  return { prs: matches };
}

module.exports = {
  findRecentCommitOverlap, findOpenPrOverlap, deriveKeyTerms, DEFAULT_LOOKBACK_DAYS, DEFAULT_MIN_TERM_MATCHES,
};
