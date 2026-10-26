#!/usr/bin/env node
'use strict';

// tools/upstream-drift/run.js — the upstream-drift auditor's entry point.
//
// Wires the manifest (manifest.js) and the deterministic checks (checks.js)
// into a runnable sweep: decides which dependencies are DUE, converts the
// checks' output into fingerprinted findings, and deduplicates those against
// already-filed `by:upstream-drift` issues so a re-run over unresolved drift
// updates rather than duplicates.
//
// Maintainer-only tooling. Nothing under plugin/bin/ may import from here —
// the import is one-way, tools/ -> plugin/bin/lib/health-core/, and a test in
// tests/run.test.js pins that direction.
//
// ─── Why there is no rotation cursor ─────────────────────────────────────
//
// The four shipped health sweeps (plugin/bin/{code,harness,journey,docs}-health.js)
// rotate through targets on a 90-day cursor because there is always more
// repo to audit and no signal saying which part changed. Here the signal is
// exact: nothing is worth looking at until a version moves, and everything
// is worth looking at the moment one does. A cursor would sit on a real
// breaking bump for up to a rotation period. Triggers are version-driven —
// see isDue() below.
//
// That absence is also what makes this file's half of the record's AC6
// ("dry-run writes nothing to the health-state branch and stamps no cursor")
// structural rather than conditional: there is no cursor to stamp, and no
// durable-state writer is imported at all. The one real write this file
// performs is the local dedup cache, and --dry-run gates it.
//
// ─── This file does not call gh for writes ───────────────────────────────
//
// It emits issue *payloads* on stdout. Creating, reopening and commenting on
// issues is the caller's turn to take (the `/upstream-drift` skill, or a
// human piping the output) — the same split the four shipped sweeps use, and
// the reason `--dry-run` can promise "creates, edits or closes no issue"
// without needing to gate a network call that was never here.

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { loadManifest } = require('./manifest');
const { checkVersion, checkAssertions, replayFixtures, checkContentPins, isContentPinned } = require('./checks');
const { createFingerprint } = require('../../plugin/bin/lib/health-core/fingerprint');
const { createCache } = require('../../plugin/bin/lib/health-core/cache');
const { decide } = require('../../plugin/bin/lib/health-core/dedup');
const { loadIssueIndex } = require('../../plugin/bin/lib/health-core/issue-index');

const TOOL_NAME = 'upstream-drift';
const LABEL = 'by:upstream-drift';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'manifest.yml');

// Ordered most severe first, so indexOf doubles as a rank.
const SEVERITY = ['high', 'medium', 'low'];

const { readCache, writeCache } = createCache(TOOL_NAME);

// Basis order is fixed and deliberately EXCLUDES every version field.
//
// The record asks for two things that pull against each other: a finding must
// name both versions involved (so a reader can date it), and a re-run over
// the same unresolved drift must update the existing issue rather than
// duplicate it. Putting a version in the basis satisfies the first and breaks
// the second — every upstream release would mint a fresh id for drift that
// never changed, and the backlog would accumulate one issue per release.
// So versions live in the rendered body; the basis is what the finding is
// ABOUT, not what the versions happened to be when it was observed.
const { fingerprint } = createFingerprint(TOOL_NAME, ['kind', 'dep', 'subject']);

// ─── argument parsing ────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [], root: process.cwd(), dryRun: false, offline: false, latestTag: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--offline') args.offline = true;
    else if (a === '--json') args.json = true;
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--dep') args.dep = argv[++i];
    else if (a === '--issues') args.issues = argv[++i];
    else if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--latest-tag') {
      // Repeatable, `<dep>=<tag>` — one manifest entry per occurrence. A bare
      // `--latest-tag <tag>` is rejected rather than guessed at: with more
      // than one entry in the manifest there is no correct dependency to
      // assume, and silently applying it to all of them would report an
      // upgrade path for a product that never had that tag.
      const raw = argv[++i] || '';
      const eq = raw.indexOf('=');
      if (eq <= 0) {
        process.stderr.write(`[${TOOL_NAME}] --latest-tag expects <dep>=<tag>, got "${raw}"\n`);
        process.exit(2);
      }
      args.latestTag[raw.slice(0, eq)] = raw.slice(eq + 1);
    } else args._.push(a);
  }
  return args;
}

// ─── version comparison ──────────────────────────────────────────────────

// Numeric, segment by segment. String comparison would put "4.0.9" above
// "4.0.10" and report an older tag as latest for any dependency past its
// ninth patch — the failure would look exactly like "no upgrade available".
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Highest tag carrying `tagPrefix`, as { tag, version }, or null.
//
// The prefix filter is load-bearing, not cosmetic: an upstream that ships
// several products from one tree (pbakaus/impeccable ships skill-v*, cli-v*
// and ext-v*) will otherwise hand one entry another product's version line.
function pickLatestTag(tags, tagPrefix) {
  const matching = tags
    .map((t) => String(t).trim())
    .filter((t) => t.startsWith(tagPrefix))
    .map((t) => ({ tag: t, version: t.slice(tagPrefix.length) }))
    .filter((t) => /^\d/.test(t.version));
  if (matching.length === 0) return null;
  matching.sort((x, y) => compareVersions(y.version, x.version));
  return { tag: matching[0].tag, version: matching[0].version };
}

function defaultRunCommand(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// Resolves the newest upstream tag for one manifest entry.
//
// Degrades to null rather than throwing: no network, no gh, an upstream repo
// that moved, or a rate limit must leave the deterministic half of the audit
// fully usable. A null latest means "no upgrade class this run", never "no
// drift" — buildFindings keeps reporting drift regardless.
function resolveLatest(entry, options = {}) {
  if (options.offline) return null;
  const upstream = entry.upstream || {};
  if (!upstream.repo || !upstream['tag-prefix']) return null;
  const runCommand = options.runCommand || defaultRunCommand;
  let out;
  try {
    out = runCommand(`gh api "repos/${upstream.repo}/tags?per_page=100" --jq '.[].name'`);
  } catch {
    return null;
  }
  if (!out) return null;
  return pickLatestTag(String(out).split('\n').filter(Boolean), upstream['tag-prefix']);
}

// ─── evaluation ──────────────────────────────────────────────────────────

// Runs all three deterministic checks plus latest-tag resolution for one
// entry, and folds them into the single object buildFindings consumes.
//
// Every collaborator is injectable so the unit suite can exercise the trigger
// table without touching the network or the real installed artifacts —
// [IL-73]'s lesson from the shipped sweeps, applied before this tool ever
// grows a durable side effect.
function evaluate(entry, options = {}) {
  // Content-pinned entries (`versioning: none` — tagless upstreams) take
  // their own path: no installed artifact exists, so the three probe-based
  // checks and latest-tag resolution are structurally inapplicable, not
  // merely skipped. checkContentPins is the class's one deterministic
  // signal, and `pinned` carries the commit SHA rather than a version.
  if (isContentPinned(entry)) {
    const doCheckContentPins = options.checkContentPins || checkContentPins;
    const contentPins = doCheckContentPins(entry, options);
    const evaluation = {
      name: entry.name,
      pinned: entry.pin.commit,
      installed: [],
      resolvedInstalled: null,
      latest: null,
      latestTag: null,
      contentPins,
    };
    evaluation.due = isDue(evaluation);
    return evaluation;
  }

  const doCheckVersion = options.checkVersion || checkVersion;
  const doCheckAssertions = options.checkAssertions || checkAssertions;
  const doReplayFixtures = options.replayFixtures || replayFixtures;
  const doResolveLatest = options.resolveLatest || ((e) => resolveLatest(e, options));

  const version = doCheckVersion(entry, options);
  const assertions = doCheckAssertions(entry, options);
  const fixtures = doReplayFixtures(entry, options);
  const latest = doResolveLatest(entry, options);

  const installed = version.installed || [];
  // A plugin-cache-glob probe legitimately resolves several cached copies
  // side by side. The running artifact is the one matching `pinned`; the
  // others are stale cache directories (judge-procedure.md step 2). Only
  // when none matches do we fall back to the first, so a breach still has a
  // concrete "from" version to name.
  const resolvedInstalled = installed.find((v) => v === entry.pinned) || installed[0] || null;

  const evaluation = {
    name: entry.name,
    pinned: entry.pinned,
    installed,
    resolvedInstalled,
    latest: latest ? latest.version : null,
    latestTag: latest ? latest.tag : null,
    version,
    assertions,
    fixtures,
    reportUpgrades: entry['report-upgrades'] !== false,
  };
  evaluation.due = isDue(evaluation);
  return evaluation;
}

// Whether upstream has published something newer than the running artifact.
//
// Extracted rather than inlined at its three call sites (isDue, buildFindings,
// cmdDue's reason list) because all three must agree: a `due` report that
// disagrees with the findings it precedes is worse than either being wrong on
// its own. `resolvedInstalled` is required — "you could upgrade from nothing"
// is noise, and checkVersion already reported the absence.
//
// An entry's `report-upgrades: false` opt-out lives here, not at a call site,
// so isDue, buildFindings and cmdDue stay in agreement.
function hasUpgrade(evaluation) {
  if (evaluation.contentPins) return false; // no version line exists to upgrade along
  if (evaluation.reportUpgrades === false) return false;
  return Boolean(
    evaluation.latest
    && evaluation.resolvedInstalled
    && compareVersions(evaluation.latest, evaluation.resolvedInstalled) > 0,
  );
}

// The trigger model, in one place. A dependency is due when a version moved
// or a claim stopped holding — never on elapsed time.
function isDue(evaluation) {
  if (evaluation.contentPins) return evaluation.contentPins.status !== 'ok';
  if (evaluation.version.status !== 'ok') return true;
  if (evaluation.assertions.status === 'drift') return true;
  if (evaluation.fixtures.status === 'mismatch') return true;
  return hasUpgrade(evaluation);
}

// ─── findings ────────────────────────────────────────────────────────────

// `subject` is what the finding is about, and is the only free-form part of
// the fingerprint basis — see the createFingerprint comment above.
function makeFinding({ kind, cls, severity, dep, subject, from, to, detail }) {
  const finding = {
    kind,
    class: cls,
    severity,
    dep,
    subject,
    versions: { from, to },
    detail,
  };
  finding.id = fingerprint(finding);
  return finding;
}

// Converts one evaluation into findings. Mechanical: this reports what
// checks.js already decided and never re-derives a verdict by reading a file
// itself. Mirrors the mapping table in
// `.claude/skills/upstream-drift/judge-procedure.md` step 1 — that file is
// the prose twin of this function for the interactive path, and the two are
// meant to move together.
function buildFindings(evaluation) {
  const findings = [];
  const dep = evaluation.name;
  const { pinned, resolvedInstalled, latest } = evaluation;

  // --- content pins (`versioning: none` entries) -----------------------
  // The class's whole finding surface: a committed fixture whose bytes no
  // longer hash to the pinned digest. Nothing below applies — there is no
  // installed version to breach and no tag line to upgrade along.
  if (evaluation.contentPins) {
    for (const result of evaluation.contentPins.results || []) {
      if (result.status === 'ok') continue;
      findings.push(makeFinding({
        kind: 'content-pin-breach',
        cls: 'drift',
        severity: 'high',
        dep,
        subject: result.path,
        from: result.observed ? `sha256:${result.observed.slice(0, 12)}` : '(missing fixture)',
        to: `commit ${String(pinned).slice(0, 12)}`,
        detail: `The committed fixture for ${result.path} no longer matches the sha256 this repo pins `
          + `for commit ${pinned}. Either the pin was corrupted or the fixture was edited — neither is `
          + `upstream movement, both need a human. ${result.detail}`,
      }));
    }
    return findings;
  }

  // --- version ---------------------------------------------------------
  if (evaluation.version.status === 'breach') {
    findings.push(makeFinding({
      kind: 'pin-breach',
      cls: 'drift',
      severity: 'high',
      dep,
      subject: 'installed-vs-pinned',
      from: resolvedInstalled || '(none)',
      to: pinned,
      // Named explicitly, because it changes how everything below reads: the
      // assertions and fixtures were just run against an artifact this repo
      // never verified, so their verdicts are provisional.
      detail: `The installed artifact is ${resolvedInstalled}, but this repo pins ${pinned}. `
        + 'Every other finding for this dependency was checked against the installed version, '
        + 'not the pinned one, and is provisional until the two agree.',
    }));
  } else if (evaluation.version.status === 'absent') {
    findings.push(makeFinding({
      kind: 'absent',
      cls: 'drift',
      severity: 'low',
      dep,
      subject: 'not-installed',
      from: '(not installed)',
      to: pinned,
      // Deliberately not worded as a breach: not installed is not the same
      // as installed-wrong, and this repo has no evidence of the latter.
      detail: `No installed artifact was found for ${dep}; this repo pins ${pinned}. `
        + 'Nothing is claimed to be wrong with the dependency — there is simply nothing here to check against.',
    }));
  }

  // --- assertions ------------------------------------------------------
  // `skipped` means the root could not be resolved, which is "absent" — and
  // checkVersion already reported that. Emitting a second finding here would
  // manufacture evidence, so this branch is intentionally silent.
  if (evaluation.assertions.status === 'drift') {
    for (const result of evaluation.assertions.results || []) {
      if (result.status === 'ok') continue;
      const missing = result.status === 'missing-file';
      findings.push(makeFinding({
        kind: missing ? 'assertion-missing-file' : 'assertion-drift',
        cls: 'drift',
        // A moved or deleted upstream path breaks the citation outright;
        // an unmatched literal merely ages it.
        severity: missing ? 'high' : 'medium',
        dep,
        subject: `${result.file}::${result.claims}`,
        from: resolvedInstalled || '(not installed)',
        to: latest || pinned,
        detail: missing
          ? `${result.file} cites ${result.upstreamPath}, which no longer exists upstream. `
            + `The claim it makes — "${result.claims}" — can no longer be checked at all. ${result.detail}`
          : `${result.file} claims "${result.claims}", but the literal it asserts against `
            + `is no longer present in ${result.upstreamPath}. ${result.detail}`,
      }));
    }
  }

  // --- fixtures --------------------------------------------------------
  if (evaluation.fixtures.status === 'mismatch') {
    for (const result of evaluation.fixtures.results || []) {
      if (result.status === 'ok') continue;
      findings.push(makeFinding({
        kind: 'fixture-breach',
        cls: 'drift',
        // The strongest evidence class available — this observed the
        // artifact running, rather than reading it.
        severity: 'high',
        dep,
        subject: result.run,
        from: resolvedInstalled || '(not installed)',
        to: latest || pinned,
        detail: `Replaying \`${result.run}\` no longer produces the recorded contract. ${result.detail}`,
      }));
    }
  }

  // --- upgrade ---------------------------------------------------------
  // Not a defect, and deliberately not filed like one.
  if (hasUpgrade(evaluation)) {
    findings.push(makeFinding({
      kind: 'upgrade-available',
      cls: 'upgrade',
      severity: 'low',
      dep,
      subject: 'upgrade',
      from: resolvedInstalled,
      to: latest,
      detail: `${dep} is installed at ${resolvedInstalled}; upstream has published ${latest}. `
        + 'Nothing is known to be wrong — this is new surface to triage, not a defect. '
        + `Run \`/upstream-drift --dep ${dep}\` for the capability report.`,
    }));
  }

  return findings;
}

// ─── issue payloads ──────────────────────────────────────────────────────

const TITLES = {
  'content-pin-breach': (f) => `${f.dep}: committed fixture for ${f.subject} no longer matches its pinned hash`,
  'pin-breach': (f) => `${f.dep}: installed ${f.versions.from} does not match pinned ${f.versions.to}`,
  absent: (f) => `${f.dep}: pinned at ${f.versions.to} but not installed`,
  'assertion-drift': (f) => `${f.dep}: a claim in ${f.subject.split('::')[0]} no longer holds upstream`,
  'assertion-missing-file': (f) => `${f.dep}: an upstream path cited by ${f.subject.split('::')[0]} no longer exists`,
  'fixture-breach': (f) => `${f.dep}: recorded runtime contract no longer replays`,
  'upgrade-available': (f) => `${f.dep}: ${f.versions.to} is available (installed ${f.versions.from})`,
};

// `validate-findings` reads a findings file off disk, so its input is not
// guaranteed to be something buildFindings produced — it can be hand-edited,
// truncated, or left over from an older schema. Every field toIssuePayload
// dereferences is checked here, because the alternative is a TypeError deep
// inside a title template that reads like a crash rather than a bad input.
// Mirrors the drop-with-diagnostic posture of the four shipped sweeps'
// validate-finding rather than failing the whole run on one bad entry.
function validateFinding(f) {
  const errors = [];
  if (!f || typeof f !== 'object') return { ok: false, errors: ['not an object'] };
  if (!f.id) errors.push('missing id (fingerprint)');
  if (!TITLES[f.kind]) errors.push(`unknown kind "${f.kind}"`);
  if (!f.dep) errors.push('missing dep');
  if (!f.subject) errors.push('missing subject');
  if (!f.detail) errors.push('missing detail');
  if (!SEVERITY.includes(f.severity)) errors.push(`unknown severity "${f.severity}"`);
  if (f.class !== 'drift' && f.class !== 'upgrade') errors.push(`unknown class "${f.class}"`);
  if (!f.versions || !f.versions.from || !f.versions.to) {
    // AC5 lives or dies here: a finding that cannot name both versions is not
    // publishable, because a reader cannot tell a stale one from a fresh one.
    errors.push('missing versions.from/versions.to');
  }
  return errors.length === 0 ? { ok: true, value: f } : { ok: false, errors };
}

// The fingerprint is embedded in the body, not merely carried alongside it.
// dedup's issue index is rebuilt by reading filed issues back off GitHub, so
// a fingerprint that lives only in this process's memory cannot be recovered
// on a fresh machine — and every finding would re-file as brand new.
function toIssuePayload(finding) {
  const title = TITLES[finding.kind](finding);
  const lead = finding.class === 'upgrade'
    ? `Upstream has moved ahead of this repo's installed copy of \`${finding.dep}\`.`
    : `A claim this repo makes about \`${finding.dep}\` no longer holds.`;

  const body = [
    lead,
    '',
    finding.detail,
    '',
    '| | Version |',
    '|---|---|',
    `| From | \`${finding.versions.from}\` |`,
    `| To | \`${finding.versions.to}\` |`,
    '',
    `Severity: **${finding.severity}** · Class: **${finding.class}** · Dependency: \`${finding.dep}\``,
    '',
    `<!-- upstream-drift-fingerprint: ${finding.id} -->`,
  ].join('\n');

  return {
    title: `[upstream-drift] ${title}`,
    body,
    labels: [LABEL],
    fingerprint: finding.id,
    severity: finding.severity,
    class: finding.class,
    dep: finding.dep,
  };
}

// ─── dedup ───────────────────────────────────────────────────────────────

// Runs health-core's decide() over a finding set and returns the payloads
// that should actually be filed, plus the per-finding decisions and the
// cache mutations they imply. Pure — the caller owns persisting `cache`,
// which is what lets --dry-run skip the write without changing this logic.
function dedupeFindings(findings, issueIndex, cache) {
  const payloads = [];
  const decisions = [];
  const nextCache = { ...cache };
  const seen = new Set();

  for (const finding of findings) {
    if (seen.has(finding.id)) continue; // intra-run dedup
    seen.add(finding.id);

    const decision = decide(finding, issueIndex, nextCache);
    decisions.push({ id: finding.id, kind: finding.kind, dep: finding.dep, ...decision });
    if (decision.action === 'skip' || decision.action === 'suppress') continue;

    nextCache[finding.id] = decision.action === 'reopen'
      ? { status: 'regressed', issue: decision.issue || null }
      : { status: 'staged', issue: null };

    const payload = toIssuePayload(finding);
    payloads.push(decision.action === 'reopen' ? { ...payload, reopen: decision.issue } : payload);
  }

  return { payloads, decisions, cache: nextCache };
}

// ─── commands ────────────────────────────────────────────────────────────

function loadEntries(args) {
  const manifest = loadManifest(args.manifest || MANIFEST_PATH);
  const entries = args.dep
    ? manifest.dependencies.filter((d) => d.name === args.dep)
    : manifest.dependencies;
  if (entries.length === 0) {
    process.stderr.write(`[${TOOL_NAME}] no manifest entry named "${args.dep}"\n`);
    process.exit(2);
  }
  return entries;
}

function evaluateAll(args) {
  return loadEntries(args).map((entry) => evaluate(entry, {
    offline: args.offline,
    resolveLatest: (e) => {
      const override = args.latestTag[e.name];
      if (override) {
        const prefix = (e.upstream || {})['tag-prefix'] || '';
        return { tag: override, version: override.startsWith(prefix) ? override.slice(prefix.length) : override };
      }
      return resolveLatest(e, { offline: args.offline });
    },
  }));
}

// `due` — the trigger report. Answers "is there anything to look at", which
// is the question a scheduler or a human asks before paying for the rest.
function cmdDue(args, io = {}) {
  const write = io.write || ((s) => process.stdout.write(s));
  const evaluations = evaluateAll(args);
  const report = evaluations.map((e) => ({
    name: e.name,
    due: e.due,
    installed: e.resolvedInstalled,
    pinned: e.pinned,
    latest: e.latest,
    reasons: e.contentPins
      ? [e.contentPins.status !== 'ok' && 'a pinned content hash no longer matches its committed fixture'].filter(Boolean)
      : [
        e.version.status === 'breach' && 'installed does not match pinned',
        e.version.status === 'absent' && 'not installed',
        e.assertions.status === 'drift' && 'an assertion no longer resolves',
        e.fixtures.status === 'mismatch' && 'a fixture replay no longer matches',
        hasUpgrade(e) && 'an upgrade is available',
      ].filter(Boolean),
  }));
  write(JSON.stringify({ due: report.filter((r) => r.due).length, dependencies: report }, null, 2) + '\n');
  return report;
}

// `findings` — the deterministic half, as a fingerprinted findings array.
// This is the file `validate-findings` consumes.
function cmdFindings(args, io = {}) {
  const write = io.write || ((s) => process.stdout.write(s));
  const findings = evaluateAll(args).flatMap(buildFindings);
  write(JSON.stringify(findings, null, 2) + '\n');
  if (findings.length === 0) {
    // AC2: an all-green run says so, on stderr, and files nothing. It must
    // never turn "nothing found" into an issue of its own.
    process.stderr.write(`[${TOOL_NAME}] no findings — every assertion and fixture holds and no reported upgrade is pending — nothing to file\n`);
  }
  return findings;
}

// `validate-findings` — dedup against already-filed issues, emit payloads.
function cmdValidateFindings(args, io = {}) {
  const write = io.write || ((s) => process.stdout.write(s));
  const root = args.root || process.cwd();
  const findingsPath = args._[1];
  if (!findingsPath) {
    process.stderr.write(`usage: run.js validate-findings <findings.json> [--root <dir>] [--issues <file>] [--dry-run]\n`);
    process.exit(2);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  } catch {
    process.stderr.write(`[${TOOL_NAME}] validate-findings: could not read or parse findings file: ${findingsPath}\n`);
    process.exit(1);
  }
  if (!Array.isArray(raw)) {
    process.stderr.write(`[${TOOL_NAME}] validate-findings: findings file must contain a JSON array\n`);
    process.exit(1);
  }

  const survivors = [];
  for (const f of raw) {
    const v = validateFinding(f);
    if (!v.ok) {
      process.stderr.write(
        `[${TOOL_NAME}] validate-findings: dropped finding for "${(f && f.dep) || '?'}": ${v.errors.join('; ')}\n`,
      );
      continue;
    }
    survivors.push(v.value);
  }

  const issueIndex = loadIssueIndex(args.issues, TOOL_NAME);
  const { payloads, decisions, cache } = dedupeFindings(survivors, issueIndex, readCache(root));

  // The only write this command performs, and --dry-run gates it. A dry run
  // that still records fingerprints as `staged` would make the NEXT real run
  // skip everything it just previewed.
  if (!args.dryRun) writeCache(root, cache);

  write(JSON.stringify(payloads, null, 2) + '\n');
  const suppressed = decisions.filter((d) => d.action === 'skip' || d.action === 'suppress').length;
  process.stderr.write(
    `[${TOOL_NAME}] validate-findings: ${survivors.length} valid finding(s), ${payloads.length} payload(s) after dedup`
    + `${suppressed ? `, ${suppressed} already filed or suppressed` : ''}`
    + `${args.dryRun ? ' (dry run — no cache written, no issue touched)' : ''}\n`,
  );
  return payloads;
}

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (cmd === 'due') return cmdDue(args);
  if (cmd === 'findings') return cmdFindings(args);
  if (cmd === 'validate-findings') return cmdValidateFindings(args);
  process.stderr.write(
    'usage: run.js <command> [options]\n'
    + 'commands:\n'
    + '  due               [--dep <name>] [--offline] [--latest-tag <dep>=<tag>] [--manifest <path>]\n'
    + '  findings          [--dep <name>] [--offline] [--latest-tag <dep>=<tag>] [--manifest <path>]\n'
    + '  validate-findings <findings.json> [--root <dir>] [--issues <file>] [--dry-run]\n'
    + '\n'
    + `Filed issues carry the "${LABEL}" label; create it once with:\n`
    + `  gh label create "${LABEL}" --description "Origin: filed by the upstream-drift auditor"\n`,
  );
  process.exit(2);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  parseArgs,
  compareVersions,
  pickLatestTag,
  resolveLatest,
  evaluate,
  isDue,
  hasUpgrade,
  buildFindings,
  validateFinding,
  toIssuePayload,
  dedupeFindings,
  cmdDue,
  cmdFindings,
  cmdValidateFindings,
  main,
  SEVERITY,
  LABEL,
  REPO_ROOT,
};
