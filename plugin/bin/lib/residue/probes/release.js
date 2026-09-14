// bin/lib/residue/probes/release.js — tag-to-CHANGELOG consistency for any
// release-please-bootstrapped project (#2257 generalized this off the
// `manifest.name === 'claude-tweaks'` gate and this repo's own tag/CHANGELOG/
// shipped-versions.tsv triple). The check now runs — and is meaningful — on
// any consuming project, not only this one: every `v*` tag at or after the
// project's "bootstrap version" should have a matching CHANGELOG heading,
// and every such heading should have a matching tag.
//
// Bootstrap version anchor: the version value `.release-please-manifest.json`
// held at the commit that FIRST introduced that file to the repo — no
// separate marker file needed, since `git log --diff-filter=A` finds that
// commit mechanically. A project that has never bootstrapped release-please
// (no such file in history) has nothing this probe can anchor to, so it
// reports `ran: false` rather than guessing a starting point.
'use strict';

const { makeFinding } = require('../finding');

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function probeRelease({ scope, run } = {}) {
  if (!scope || !scope.ran) {
    return { ran: false, reason: (scope && scope.reason) || 'scope unresolved', findings: [] };
  }

  const introLog = run(['git', 'log', '--diff-filter=A', '--format=%H', '--', '.release-please-manifest.json']);
  const introSha = introLog ? introLog.trim().split('\n').filter(Boolean).pop() : null;
  if (!introSha) {
    return { ran: false, reason: 'not applicable — no .release-please-manifest.json in history (release-please not bootstrapped)', findings: [] };
  }

  const manifestAtIntro = run(['git', 'show', `${introSha}:.release-please-manifest.json`]);
  let bootstrapVersion = null;
  try {
    const parsed = JSON.parse(manifestAtIntro || '');
    const first = Object.values(parsed)[0];
    bootstrapVersion = parseVersion(first);
  } catch {
    bootstrapVersion = null;
  }
  if (!bootstrapVersion) {
    return { ran: false, reason: 'could not parse a version out of .release-please-manifest.json at its introducing commit', findings: [] };
  }

  const changelog = run(['git', 'show', 'HEAD:CHANGELOG.md']);
  if (changelog === null) {
    return { ran: false, reason: 'could not read CHANGELOG.md at HEAD', findings: [] };
  }

  const tagList = run(['git', 'tag', '-l', 'v*']) || '';
  const tags = tagList.split('\n').map((t) => t.trim()).filter(Boolean)
    .map((tag) => ({ tag, version: parseVersion(tag) }))
    .filter((t) => t.version && compareVersions(t.version, bootstrapVersion) >= 0);
  const tagVersionStrings = new Set(tags.map((t) => t.version.join('.')));

  const headingRe = /^## v(\d+\.\d+\.\d+)\b/gm;
  const headingVersions = new Set();
  let hm;
  while ((hm = headingRe.exec(changelog)) !== null) headingVersions.add(hm[1]);

  const findings = [];
  for (const { tag, version } of tags) {
    const v = version.join('.');
    if (!headingVersions.has(v)) {
      findings.push(makeFinding({
        kind: 'release', scope: 'blast-radius', subject: `CHANGELOG entry for ${tag}`, remedy: 'auto',
        evidence: `CHANGELOG.md at HEAD has no "## v${v}" heading for tag ${tag}`,
      }));
    }
  }
  for (const v of headingVersions) {
    const version = parseVersion(v);
    if (version && compareVersions(version, bootstrapVersion) >= 0 && !tagVersionStrings.has(v)) {
      findings.push(makeFinding({
        kind: 'release', scope: 'blast-radius', subject: `tag for CHANGELOG entry v${v}`, remedy: 'record',
        evidence: `CHANGELOG.md names v${v} but no "v${v}" git tag exists`,
      }));
    }
  }
  return { ran: true, reason: null, findings };
}

module.exports = { probeRelease };
