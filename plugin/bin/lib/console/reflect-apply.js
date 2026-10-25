// plugin/bin/lib/console/reflect-apply.js — carry a /reflect observation or convention finding
// (staged/reflect-{n}.md, classified into the Review Console's Skill updates section) to the
// destination its file names (#4168). The classifier (resolve.js) and this applier read one parse
// (./reflect-destination.js), so they cannot disagree about what a file asks for.
//
// One outcome per destination:
//   record  + gh transport   `gh issue create` through deps.gh, then an AUTO line — `filed`
//   record  + emit transport a Queue-write-shaped proposal file for a caller that files through MCP
//                            or local files — `session` (record); the session logs it with markApplied
//   decline                  deps.recordDecline + an AUTO line — `declined`
//   edit                     the session performs the edit — `session` (edit); logged with markApplied
//   none (a legacy file)     one materiality-digest line the session posts — `session` (digest);
//                            logged with markApplied once posted
//   invalid                  `pending` with reflect-destination-invalid:{why}
//   record, bad Defer-reason `refused`, one REFUSED line (resolve.js's refusedStagedNames reads it)
// An item whose `Reflect apply: staged/{name}` AUTO line is already in decisions.md is
// `alreadyApplied` and nothing else runs, so a second pass over a run applies nothing twice.
//
// Every side effect goes through `deps`; the module never exits, reads argv, or touches real gh.
// Each item runs in its own try/catch: one failure is that item's `failed` entry, never the batch's.
//
// A failed decisions.md append AFTER the outside effect landed (the issue is filed, the decline recorded) is
// not a `failed` item — retrying it would repeat the effect. It is a `logFailures` entry
// { item, error, line }, `line` the paste-ready command that logs it (`--applied filed --ref N` /
// `--decline`), which the caller runs before anything re-runs the batch: until the line lands, a plain
// re-run would file the record again.
'use strict';

const path = require('path');
const { formatEntry } = require('../log-decision/append');
const { materialityEntryLine, materialityFingerprint } = require('../health-core/materiality-digest');
const { createFingerprint } = require('../health-core/fingerprint');
const { errorText } = require('../feedback/file-feedback');
const { digestTextOf } = require('./staged-digest-text');
const { runIdOf } = require('./resolve');
const {
  isApplicableReflect, parseReflectDestination, deferReasonProblem, findingDescription, REFLECT_NO_DESTINATION,
} = require('./reflect-destination');

const SECTION = '/wrap-up';
const STEP = 'Reflect apply';
const STAGED_NAME_RE = /^reflect-.*\.md$/;
const APPLIED_KINDS = ['edited', 'filed', 'digested'];
// Labels the console's filing never writes: the grant and claim namespaces are a human's call, and the
// record's `Type:` line is the one authority for its `type:*` label.
const STRIPPED_LABEL_RE = /^(auto|bot|type):/i;

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// The AUTO line markApplied and the gh/decline paths write: `- AUTO {time} — Reflect apply: staged/{name} {outcome} …`.
function APPLIED_LINE_RE(name) {
  return new RegExp(`^- AUTO \\d{2}:\\d{2}:\\d{2} — ${STEP}: staged/${escapeRe(name)} (filed|declined|edited|digested)\\b`, 'm');
}

function readDecisions(runDir, deps) {
  try { return String(deps.readFile(path.join(runDir, 'decisions.md'))); } catch { return ''; }
}

function appliedLine(runDir, name, deps) {
  const text = readDecisions(runDir, deps);
  const m = APPLIED_LINE_RE(name).exec(text);
  return m ? text.slice(m.index).split('\n')[0].replace(/\r$/, '') : null;
}

// resolve.js's refusedStagedNames, for one name: a `- REFUSED` line naming `staged/{name}`.
function alreadyRefused(runDir, name, deps) {
  return readDecisions(runDir, deps).split('\n').some((line) => {
    if (!/^- REFUSED /.test(line)) return false;
    const m = /staged\/([A-Za-z0-9_-]+\.(?:md|patch))/.exec(line);
    return Boolean(m) && m[1] === name;
  });
}

// Every staged/reflect-*.md the applier acts on, sorted: [{ name, text }] — or { name, error } for an
// unreadable file. Applicable = isApplicableReflect (a Category the console consumer applies).
function listApplicable({ runDir, deps }) {
  const dir = path.join(runDir, 'staged');
  const out = [];
  for (const name of [...deps.readdir(dir)].filter((n) => STAGED_NAME_RE.test(n)).sort()) {
    let text;
    try { text = String(deps.readFile(path.join(dir, name))); } catch (err) { out.push({ name, error: `cannot read staged/${name}: ${errorText(err)}` }); continue; }
    if (isApplicableReflect(name, text)) out.push({ name, text });
  }
  return out;
}

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const CLI_PATH = path.resolve(__dirname, '..', '..', 'reflect-apply.js');
const cliLine = (runDir, tail) => `node ${shQuote(CLI_PATH)} --run ${shQuote(runDir)} ${tail}`;

function logApplied({ runDir, text, reversibility, deps }) {
  deps.appendDecision({ runDir, section: SECTION, entry: formatEntry({ status: 'AUTO', now: deps.now(), step: STEP, text, reversibility }) });
}

function declineFingerprint(description) {
  return createFingerprint('reflect', ['description']).fingerprint({ description });
}

// Records the decline and logs it. -> { applied } | { failed } | { applied, logFailure } (declined but unlogged).
function declineText({ runDir, item, text, reason, deps }) {
  const description = findingDescription(text);
  if (!description) return { failed: { item, error: `staged/${item} has no finding text to fingerprint` } };
  const fp = declineFingerprint(description);
  try {
    deps.recordDecline(fp, { reason, source: 'reflect', subject: description });
  } catch (err) {
    return { failed: { item, error: errorText(err) } };
  }
  const applied = { item, outcome: 'declined', ref: fp };
  try {
    logApplied({ runDir, text: `staged/${item} declined (${reason}); decline ${fp} recorded`, reversibility: 'high (clearDecline)', deps });
  } catch (err) {
    return { applied, logFailure: { item, error: errorText(err), line: cliLine(runDir, `--item ${shQuote(item)} --decline ${shQuote(reason)}`) } };
  }
  return { applied };
}

// A decline the console's Decline/Skip row asks for, whatever the file's own destination.
// -> { alreadyApplied } | { applied } | { failed } | { applied, logFailure }
function declineItem({ runDir, item, reason, deps }) {
  const line = appliedLine(runDir, item, deps);
  if (line) return { alreadyApplied: { item, line } };
  let text;
  try { text = String(deps.readFile(path.join(runDir, 'staged', item))); } catch (err) { return { failed: { item, error: `cannot read staged/${item}: ${errorText(err)}` } }; }
  return declineText({ runDir, item, text, reason, deps });
}

const normalizeRef = (ref) => `#${String(ref).replace(/^#/, '')}`;

// Logs the AUTO line for a session-performed outcome (the edit made, the record filed through MCP or
// local files, the digest line posted). { runDir, item, kind: 'edited'|'filed'|'digested', ref? }
// -> { alreadyApplied } | { applied } | { failed } | { error } (the call does not fit the file: a usage error).
function markApplied({ runDir, item, kind, ref, deps }) {
  if (!APPLIED_KINDS.includes(kind)) return { error: `unknown --applied kind: ${kind} (expected ${APPLIED_KINDS.join('|')})` };
  const line = appliedLine(runDir, item, deps);
  if (line) return { alreadyApplied: { item, line } };
  let text;
  try { text = String(deps.readFile(path.join(runDir, 'staged', item))); } catch (err) { return { failed: { item, error: `cannot read staged/${item}: ${errorText(err)}` } }; }
  const dest = parseReflectDestination(text);
  let logText;
  let reversibility;
  let carried = ref;
  if (kind === 'edited') {
    if (dest.kind !== 'edit') return { error: `staged/${item}'s destination is not an edit (it is ${dest.kind}) — --applied edited does not fit it` };
    logText = `staged/${item} edited ${dest.target}`;
    reversibility = 'high (in the wrap-up commit)';
    carried = dest.target;
  } else if (kind === 'filed') {
    if (dest.kind !== 'record') return { error: `staged/${item}'s destination is not a record (it is ${dest.kind}) — --applied filed does not fit it` };
    const problem = deferReasonProblem(dest.proposal);
    if (problem !== null) return { error: `staged/${item}'s record has no valid Defer-reason (${problem}) — it is refused, never filed, so --applied filed does not fit it` };
    carried = normalizeRef(ref);
    logText = `staged/${item} filed as ${carried} (Defer-reason: ${dest.proposal.deferReason})`;
    reversibility = 'high (gh issue close)';
  } else {
    if (dest.kind !== 'none') return { error: `staged/${item} has a destination line (${dest.kind}) — --applied digested only fits a legacy file with none` };
    logText = `staged/${item} digested (${ref})`;
    reversibility = 'high (entry remains promotable from the digest)';
  }
  try {
    logApplied({ runDir, text: logText, reversibility, deps });
  } catch (err) {
    return { failed: { item, error: `could not append the decisions.md entry: ${errorText(err)}` } };
  }
  return { applied: { item, outcome: kind, ref: carried } };
}

function recordLabels(proposal) {
  return [...proposal.labels.filter((l) => !STRIPPED_LABEL_RE.test(l)), `type:${proposal.type}`];
}

// The legacy rule: a reflect finding with no destination line is disposed as one materiality-digest line.
function digestEntryFor({ runDir, name, text }) {
  const files = /^\*\*Files:\*\*[ \t]*(.+?)[ \t]*$/m.exec(text);
  const entry = {
    area: 'reflect',
    finding: `${name} (no destination): ${digestTextOf(text)}`.slice(0, 200),
    fileRefs: (files && files[1].replace(/\s+/g, ' ').trim()) || 'general',
    deferReason: REFLECT_NO_DESTINATION,
    provenance: runIdOf(runDir),
  };
  return { line: materialityEntryLine(entry), fingerprint: materialityFingerprint(entry) };
}

function emitProposal(proposal) {
  const labels = proposal.labels.filter((l) => !STRIPPED_LABEL_RE.test(l));
  return `Title: ${proposal.title}\nType: ${proposal.type}\nLabels: ${labels.length ? labels.join(', ') : 'none'}\nDefer-reason: ${proposal.deferReason}\n\n${proposal.body}`;
}

function applyReflectItems({
  runDir, only, transport = 'gh', outDir, repo, dryRun = false, deps,
}) {
  const res = { applied: [], session: [], refused: [], pending: [], alreadyApplied: [], failed: [], logFailures: [] };
  if (dryRun) res.planned = [];
  const wanted = Array.isArray(only) ? new Set(only) : null;
  let workTypes;

  for (const entry of listApplicable({ runDir, deps })) {
    const item = entry.name;
    if (wanted && !wanted.has(item)) continue;
    const plan = (outcome) => { if (dryRun) res.planned.push({ item, outcome }); };
    const fail = (error) => { res.failed.push({ item, error }); plan('failed'); };
    try {
      if (entry.error) { fail(entry.error); continue; }
      const line = appliedLine(runDir, item, deps);
      if (line) { res.alreadyApplied.push({ item, line }); plan('alreadyApplied'); continue; }
      const { text } = entry;
      const dest = parseReflectDestination(text);

      if (dest.kind === 'invalid') { res.pending.push({ item, reason: `reflect-destination-invalid:${dest.why}` }); plan('pending'); continue; }

      if (dest.kind === 'none') {
        plan('digest');
        if (!dryRun) res.session.push({ item, outcome: 'digest', ...digestEntryFor({ runDir, name: item, text }) });
        continue;
      }

      if (dest.kind === 'edit') {
        if (!deps.exists(path.join(deps.cwd(), dest.target))) { fail(`edit target not found: ${dest.target}`); continue; }
        plan('edit');
        if (!dryRun) res.session.push({ item, outcome: 'edit', target: dest.target });
        continue;
      }

      if (dest.kind === 'decline') {
        plan('declined');
        if (dryRun) continue;
        const r = declineText({ runDir, item, text, reason: dest.reason, deps });
        if (r.applied) res.applied.push(r.applied);
        if (r.failed) res.failed.push(r.failed);
        if (r.logFailure) res.logFailures.push(r.logFailure);
        continue;
      }

      // record
      const { proposal } = dest;
      const problem = deferReasonProblem(proposal);
      if (problem !== null) {
        res.refused.push({ item, value: problem });
        plan('refused');
        if (!dryRun && !alreadyRefused(runDir, item, deps)) {
          try {
            deps.appendDecision({
              runDir,
              section: SECTION,
              entry: formatEntry({ status: 'REFUSED', now: deps.now(), step: `Queue write staged/${item}`, text: `no valid Defer-reason on staged/${item}; kept staged` }),
            });
          } catch (err) {
            res.logFailures.push({ item, error: errorText(err), line: cliLine(runDir, `--only ${shQuote(item)}`) });
          }
        }
        continue;
      }

      const stem = item.replace(/\.md$/, '');
      if (transport === 'emit') {
        const file = path.join(outDir, `reflect-apply-${stem}.md`);
        plan('record');
        if (dryRun) continue;
        deps.mkdir(outDir);
        deps.writeFile(file, emitProposal(proposal));
        res.session.push({ item, outcome: 'record', proposal: file });
        continue;
      }

      if (workTypes === undefined) workTypes = deps.workTypes();
      if (workTypes !== 'labels') {
        fail(`work-types ${workTypes || 'unset'}: the gh transport expresses Type as a type:* label — rerun with --transport emit`);
        continue;
      }
      plan('filed');
      if (dryRun) continue;
      const bodyFile = deps.tmpFile(`reflect-apply-${stem}.md`);
      deps.writeFile(bodyFile, proposal.body);
      const out = deps.gh([
        'issue', 'create', ...(repo ? ['--repo', repo] : []), '--title', proposal.title, '--body-file', bodyFile,
        ...recordLabels(proposal).flatMap((l) => ['--label', l]),
      ]);
      const m = /\/issues\/(\d+)/.exec(String(out));
      if (!m) { res.failed.push({ item, error: `could not read the issue number from gh output: ${JSON.stringify(String(out))} — the issue may exist; check before re-running` }); continue; }
      const ref = `#${m[1]}`;
      res.applied.push({ item, outcome: 'filed', ref });
      try {
        logApplied({ runDir, text: `staged/${item} filed as ${ref} (Defer-reason: ${proposal.deferReason})`, reversibility: 'high (gh issue close)', deps });
      } catch (err) {
        res.logFailures.push({ item, error: errorText(err), line: cliLine(runDir, `--item ${shQuote(item)} --applied filed --ref ${m[1]}`) });
      }
    } catch (err) {
      res.failed.push({ item, error: errorText(err) });
      plan('failed');
    }
  }
  return res;
}

module.exports = {
  applyReflectItems, listApplicable, markApplied, declineItem, APPLIED_LINE_RE, APPLIED_KINDS,
};
