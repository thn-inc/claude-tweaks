// plugin/bin/lib/activity/render.js — the renderer half of /claude-tweaks:activity (#2757).
// Trusts facts.json (which only gh wrote) and never the narrative: every refs[] entry is
// validated against the citable set derived from the facts and dropped with a warning when
// absent or ambiguous. Refs come ONLY from refs[] — a `#123` typed inside an item's text is
// prose, not a citation, and is left exactly as written. Text and headings are prose only:
// newlines are collapsed to spaces and markdown link brackets are escaped before insertion
// (see inline()), so a citation-shaped string embedded in narrative text can never forge a
// section heading or a link that skipped resolveRef. Both inputs must carry schemaVersion: 1;
// anything else is rejected (never guessed across versions). A period counts as empty only
// when there is no activity AND no gather failures — a fully failed gather always renders
// normally (Partial gather + Notes), never the one-line empty report.
'use strict';

const NUMBERED = ['merged_prs', 'closed_issues', 'issues_raised', 'reviews_given', 'in_flight'];
const REGISTERS = ['retro', 'standup', 'manager'];
const NUMBER_REF_RE = /^([^\s/#@]+\/[^\s/#@]+)#(\d+)$/;
const COMMIT_REF_RE = /^([^\s/#@]+\/[^\s/#@]+)@([0-9a-fA-F]{7,40})$/;

// prose (item text or a section heading) -> single-line, link-bracket-safe prose
function inline(s) {
  return s.replace(/\s*[\r\n]+\s*/g, ' ').trim().replace(/[\[\]]/g, '\\$&');
}

class SchemaError extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    this.name = 'SchemaError';
    this.errors = errors;
  }
}

function validateFacts(facts) {
  const errors = [];
  if (!facts || typeof facts !== 'object') return { ok: false, errors: [{ path: 'facts', message: 'not an object' }] };
  if (facts.schemaVersion !== 1) errors.push({ path: 'facts.schemaVersion', message: `must be the number 1 (got ${JSON.stringify(facts.schemaVersion)})` });
  if (!facts.period || typeof facts.period.from !== 'string' || typeof facts.period.to !== 'string') errors.push({ path: 'facts.period', message: 'must carry from/to strings' });
  if (!Array.isArray(facts.repos)) errors.push({ path: 'facts.repos', message: 'must be an array' });
  for (const key of [...NUMBERED, 'commits', 'failures']) {
    if (!Array.isArray(facts[key])) errors.push({ path: `facts.${key}`, message: 'must be an array' });
  }
  return { ok: errors.length === 0, errors };
}

function validateNarratives(n) {
  const errors = [];
  if (!n || typeof n !== 'object') return { ok: false, errors: [{ path: 'narratives', message: 'not an object' }] };
  if (n.schemaVersion !== 1) errors.push({ path: 'narratives.schemaVersion', message: `must be the number 1 (got ${JSON.stringify(n.schemaVersion)})` });
  if (!REGISTERS.includes(n.register)) errors.push({ path: 'narratives.register', message: `must be one of ${REGISTERS.join('|')}` });
  if (!Array.isArray(n.sections)) { errors.push({ path: 'narratives.sections', message: 'must be an array' }); return { ok: false, errors }; }
  n.sections.forEach((s, i) => {
    if (!s || typeof s.heading !== 'string') errors.push({ path: `sections[${i}].heading`, message: 'must be a string' });
    if (!s || !Array.isArray(s.items)) { errors.push({ path: `sections[${i}].items`, message: 'must be an array' }); return; }
    s.items.forEach((it, j) => {
      if (!it || typeof it.text !== 'string') errors.push({ path: `sections[${i}].items[${j}].text`, message: 'must be a string' });
      if (!it || !Array.isArray(it.refs)) { errors.push({ path: `sections[${i}].items[${j}].refs`, message: 'must be an array of strings' }); return; }
      it.refs.forEach((r, k) => { if (typeof r !== 'string') errors.push({ path: `sections[${i}].items[${j}].refs[${k}]`, message: 'must be a string' }); });
    });
  });
  return { ok: errors.length === 0, errors };
}

// facts -> { numbers: Map<repo, Map<number, url>>, commits: Map<repo, [{sha, url}]> }
function citableRefs(facts) {
  const numbers = new Map();
  const commits = new Map();
  for (const key of NUMBERED) {
    for (const row of facts[key]) {
      if (!numbers.has(row.repo)) numbers.set(row.repo, new Map());
      if (!numbers.get(row.repo).has(row.number)) numbers.get(row.repo).set(row.number, row.url);
    }
  }
  for (const c of facts.commits) {
    if (!commits.has(c.repo)) commits.set(c.repo, []);
    commits.get(c.repo).push({ sha: String(c.sha), url: c.url });
  }
  return { numbers, commits };
}

// dropped ref -> the standard "not present" warning
function dropped(ref) {
  return { warning: `warning: dropped citation ${ref} — not present in facts.json` };
}

// ref string + citable set -> { link } | { warning }
function resolveRef(ref, citable) {
  let m = NUMBER_REF_RE.exec(ref);
  if (m) {
    const repoMap = citable.numbers.get(m[1]);
    const num = Number(m[2]);
    return repoMap && repoMap.has(num) ? { link: `[${m[1]}#${m[2]}](${repoMap.get(num)})` } : dropped(ref);
  }
  m = COMMIT_REF_RE.exec(ref);
  if (m) {
    const prefix = m[2].toLowerCase();
    const hits = (citable.commits.get(m[1]) || []).filter((c) => c.sha.toLowerCase().startsWith(prefix));
    if (hits.length === 1) return { link: `[${m[1]}@${prefix.slice(0, 7)}](${hits[0].url})` };
    if (hits.length === 0) return dropped(ref);
    return { warning: `warning: ambiguous citation ${m[1]}@${m[2]} — matches ${hits.length} commits` };
  }
  return dropped(ref);
}

function isEmptyPeriod(facts, narratives) {
  const noFacts = [...NUMBERED, 'commits'].every((k) => facts[k].length === 0);
  const noItems = narratives.sections.every((s) => s.items.length === 0);
  return noFacts && noItems && facts.failures.length === 0;
}

function render(facts, narratives) {
  const fv = validateFacts(facts);
  const nv = validateNarratives(narratives);
  const errors = [...fv.errors, ...nv.errors];
  if (errors.length) throw new SchemaError(errors);

  const { from, to } = facts.period;
  const title = `# Activity — ${from} to ${to} (${narratives.register})`;
  if (isEmptyPeriod(facts, narratives)) {
    return { markdown: `${title}\n\nNo activity found for ${from}..${to} in ${facts.repos.join(', ')}.\n`, warnings: [] };
  }

  const citable = citableRefs(facts);
  const warnings = [];
  const lines = [title, ''];
  for (const section of narratives.sections) {
    if (section.items.length === 0) continue;
    const heading = inline(section.heading).replace(/^#+(?=\s|$)\s*/, '');
    lines.push(`## ${heading}`, '');
    for (const item of section.items) {
      const text = inline(item.text);
      const links = [];
      for (const ref of item.refs) {
        const r = resolveRef(ref, citable);
        if (r.link) links.push(r.link); else warnings.push(r.warning);
      }
      lines.push(links.length ? `- ${text} (${links.join(', ')})` : `- ${text}`);
    }
    lines.push('');
  }
  if (facts.failures.length) {
    lines.push('## Partial gather', '');
    for (const f of facts.failures) lines.push(`- ${f.query} on ${f.repo}: ${f.error}`);
    lines.push('');
  }
  const counts = [...NUMBERED, 'commits'].map((k) => `${k}: ${facts[k].length}`).join(', ');
  lines.push('## Notes', '', `- Counts — ${counts}.`,
    '- Search-index lag: `--search` and `search prs` ride GitHub\'s search index, which lags fresh writes by minutes.',
    '- `reviews_given` is a proxy: PRs the actor reviewed whose last update falls in the window; the review\'s own timestamp is not consulted, and own-authored PRs are excluded.',
    '- Commits are matched by linked GitHub login; a commit authored with an unlinked email never appears.');
  const otherActivity = NUMBERED.some((k) => facts[k].length > 0);
  if (facts.commits.length === 0 && otherActivity) lines.push('- Note: no commits were matched for this actor in the window while other activity exists — check the commit email is linked to the GitHub account.');
  lines.push('');
  return { markdown: lines.join('\n'), warnings };
}

module.exports = { render, validateFacts, validateNarratives, citableRefs, SchemaError, REGISTERS };
