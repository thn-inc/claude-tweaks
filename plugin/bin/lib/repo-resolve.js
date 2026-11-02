// plugin/bin/lib/repo-resolve.js — shared owner/repo resolution for the bin/
// gh CLIs: the one parseRepo (#1177), the injectable `gh --version` probe, and the
// gh host seam (#4505). ghOptions(args, opts) returns opts itself when GH_HOST is set,
// args name -R/--repo/--hostname, or origin's host is not a known GHE host; a known
// one (*.ghe.com or a gh hosts.yml key) gets a copy whose env adds GH_HOST, memoized
// per cwd. An enterprise token alone admits nothing, because gh sends it to whatever
// GH_HOST names (#4854). It adds no timeout or windowsHide and there is no seam
// spawn helper: each wrapped site's own `timeout` carries its bound.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharedPrimitives = require('./shared-primitives');
const { isTimeoutError } = sharedPrimitives;

// A git remote URL (SSH or HTTPS, with or without .git, on github.com or an
// arbitrary GitHub Enterprise Server host, or an `owner/name` string wrapped
// as `{host}/owner/name` by a caller) -> { host, owner, repo }, or null when
// it doesn't match. `host` defaults to matching whatever host segment is
// present in the URL -- callers that only destructure { owner, repo } are
// unaffected by the added field.
function parseRepo(url) {
  const m = /^(?:[a-zA-Z0-9._-]+@)?(?:https?:\/\/)?([a-zA-Z0-9.-]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
    String(url || '').trim()
  );
  return m ? { host: m[1], owner: m[2], repo: m[3] } : null;
}

// gh-api-module-pattern: bound every remote-contacting call on the seam.
// --version is local-only, but the bound is free and keeps this the one
// options object every call site below now shares. #2567: shared, not a
// local re-derivation of the same 5000 default, so a project's
// `gh-timeout-ms` policy override (or CLAUDE_TWEAKS_GH_TIMEOUT_MS env
// override) reaches this call too. A timed-out probe proves the binary
// spawned (#4554), so it reads as present — the next real call surfaces the
// timeout.
function ghAvailable(deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  try {
    exec('gh', ['--version'], { stdio: 'ignore', timeout: sharedPrimitives.GH_TIMEOUT_MS, windowsHide: true });
    return true;
  } catch (err) {
    return isTimeoutError(err);
  }
}

function remoteUrl() {
  return execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true });
}

// A parseRepo result (or any { host, owner, repo }) -> the slug `gh --repo`
// takes: bare `owner/repo` on github.com, host-qualified `host/owner/repo` on
// a GitHub Enterprise Server host. A missing host reads as github.com, so a
// caller threading an optional host through needs no guard of its own.
function repoSlug({ host, owner, repo }) {
  return host && host !== 'github.com' ? `${host}/${owner}/${repo}` : `${owner}/${repo}`;
}

// #2538 Deliverable 3: "print the derived repo so a mismatch is visible to
// the operator" — but only when there's something an operator would
// actually need to double-check. On plain github.com (the overwhelming
// common case, and every existing CLI's own "success path writes nothing to
// stderr" test fixture) this returns null and callers print nothing,
// preserving that established silence-on-success convention; a resolved
// GitHub Enterprise Server host is the one case worth a visible note, since
// it's also the one case a caller's own gh call could silently resolve
// against the wrong repo/host if the derivation guessed wrong.
function repoResolutionNote(repoSpec) {
  if (!repoSpec || !repoSpec.host || repoSpec.host === 'github.com') return null;
  return `resolved repo ${repoSlug(repoSpec)} (host: ${repoSpec.host})`;
}

// #4505: the gh host seam. A gh call that infers its repo from the cwd reaches
// github.com unless GH_HOST says otherwise, so on a GitHub Enterprise origin
// every such call went to the wrong host. ghOptions wraps a gh spawn's options
// object; every key of `deps` is optional and defaults to the real thing.
const ghHostSpecs = new Map(); // path.resolve(cwd) -> { host, owner, repo } | null
const notedGhHosts = new Set(); // hosts whose repoResolutionNote this process printed

function _resetGhHostCache() {
  ghHostSpecs.clear();
  notedGhHosts.clear();
}

function originUrl(cwd) {
  return execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: sharedPrimitives.GIT_TIMEOUT_MS, windowsHide: true,
  });
}

// gh's own config-dir order: GH_CONFIG_DIR, $XDG_CONFIG_HOME/gh, %AppData%/GitHub CLI
// (Windows only), then ~/.config/gh.
function ghConfigDir(deps) {
  const env = deps.env || process.env;
  if (env.GH_CONFIG_DIR) return env.GH_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'gh');
  if ((deps.platform || process.platform) === 'win32' && env.AppData) return path.join(env.AppData, 'GitHub CLI');
  return path.join(deps.homedir || os.homedir(), '.config', 'gh');
}

// A host as the known-host checks compare it: lower-cased, trailing dots (an FQDN's
// root label) stripped, so `ACME.ghe.com.` reads as `acme.ghe.com`.
function normalizeHost(host) {
  return String(host).toLowerCase().replace(/\.+$/, '');
}

// Normalized top-level keys of gh's hosts.yml; an unreadable file has none.
function ghConfigHosts(deps) {
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  let text;
  try {
    text = readFile(path.join(ghConfigDir(deps), 'hosts.yml'));
  } catch {
    return new Set();
  }
  return new Set([...String(text).matchAll(/^([^\s#:][^:\s]*):\s*$/gm)].map((m) => normalizeHost(m[1])));
}

// A `scheme://[user[:pass]@]host[:port]/path` URL -> `host/path`, the shape
// parseRepo reads. Its userinfo (a credential, never logged) and port are dropped;
// an scp-style or scheme-less remote is returned as is.
function hostPathOf(url) {
  const u = String(url || '').trim();
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/]*)(.*)$/i.exec(u);
  if (!m) return u;
  const authority = m[1].slice(m[1].lastIndexOf('@') + 1).replace(/:\d*$/, '');
  return `${authority}${m[2]}`;
}

function resolveGhSpec(cwd, deps = {}) {
  const key = path.resolve(cwd);
  if (ghHostSpecs.has(key)) return ghHostSpecs.get(key);
  let spec = null;
  try {
    const url = (deps.remoteUrl || originUrl)(key);
    const parsed = parseRepo(hostPathOf(url));
    const host = parsed && normalizeHost(parsed.host);
    if (host && host !== 'github.com') {
      // Positive signals only. Any other host stays silent (no note), token or not,
      // decided at #4854's plan review; its opt-in is an exported GH_HOST, or a
      // hosts.yml key from `gh auth login --hostname` (run with the token unset).
      const known = host.endsWith('.ghe.com') || ghConfigHosts(deps).has(host);
      if (known) spec = { ...parsed, host };
    }
  } catch (err) {
    // No origin or no git is an answer (no host), remembered below. A probe timeout
    // is not: say so once per cwd and leave it unmemoized, so the next call probes
    // again instead of sending a GHE origin's calls to github.com for the whole process.
    if (isTimeoutError(err)) {
      if (!notedGhHosts.has(`timeout:${key}`)) {
        notedGhHosts.add(`timeout:${key}`);
        const write = deps.stderr || ((s) => process.stderr.write(s));
        write(`claude-tweaks: reading origin timed out in ${key} — gh calls there use the default host until it answers\n`);
      }
      return null;
    }
  }
  ghHostSpecs.set(key, spec);
  return spec;
}

// The GitHub host gh calls from `cwd` should get as GH_HOST, or null (github.com,
// an unknown host, or no resolvable origin). Memoized per path.resolve(cwd).
function resolveGhHost(cwd, deps = {}) {
  const spec = resolveGhSpec(cwd, deps);
  return spec ? spec.host : null;
}

// Decision Q2: any -R/--repo/--hostname (also `--repo=x`, `--hostname=x` and
// pflag's attached `-Rx`) names the host itself, so the seam stays out of it.
// A `-f repo=widgets` value starts with neither flag; nothing after `--` is a flag,
// and the token after a value-taking flag is its value (a `--body` text that opens
// `-R`), never a flag. `gh pr review --comment` is gh's one boolean --comment.
// An exported GH_REPO is deliberately not read as an explicit repo: Decision Q2
// names args only, so a GHE origin still gets GH_HOST beside it (#4505).
const GH_VALUE_FLAGS = new Set(['--body', '--title', '-b', '-t', '-f', '-F', '--field', '--raw-field',
  '--jq', '-q', '--search', '--template', '--input', '--comment', '--subject', '--notes', '--description']);

function hasExplicitHostArg(args) {
  const list = args || [];
  const prReview = list[0] === 'pr' && list[1] === 'review';
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--') return false;
    if (typeof a !== 'string') continue;
    if (GH_VALUE_FLAGS.has(a) && !(prReview && a === '--comment')) { i++; continue; }
    if (a === '-R' || a === '--repo' || a === '--hostname') return true;
    if (a.startsWith('--repo=') || a.startsWith('--hostname=') || (a.startsWith('-R') && a.length > 2)) return true;
  }
  return false;
}

// -> `opts` itself when nothing is injected (an effective env that already has
// GH_HOST, even empty; an explicit host arg; no known GHE host for opts.cwd), else
// a copy whose env is opts.env (or process env) plus GH_HOST. The first injection
// per host prints repoResolutionNote, since GH_HOST also picks gh's auth host.
// The arg scan runs before the host probe, so an explicit-host call spawns no git.
function ghOptions(args, opts, deps = {}) {
  const o = opts || {};
  const base = o.env || deps.env || process.env;
  if ('GH_HOST' in base) return opts;
  if (hasExplicitHostArg(args)) return opts;
  const spec = resolveGhSpec(o.cwd || process.cwd(), deps);
  if (!spec) return opts;
  if (!notedGhHosts.has(spec.host)) {
    notedGhHosts.add(spec.host);
    const write = deps.stderr || ((s) => process.stderr.write(s));
    write(`claude-tweaks: ${repoResolutionNote(spec)} — gh calls get GH_HOST=${spec.host}\n`);
  }
  return { ...o, env: { ...base, GH_HOST: spec.host } };
}

// A CLI's explicit --repo names its own host, and a bare `owner/name` means
// github.com (Decision Q2). Its calls that carry no host flag (a github.com
// spec threads no --hostname; a GraphQL owner/repo pair; `gh api user`) would
// otherwise get ghOptions's origin host. -> the host those calls must reach,
// or null when ghOptions already reaches it from `cwd` (github.com when it
// injects nothing) or GH_HOST is exported (AC4: the user's value wins).
function explicitRepoGhHost(repoSpec, cwd, deps = {}) {
  const env = deps.env || process.env;
  if (!repoSpec || 'GH_HOST' in env) return null;
  const host = normalizeHost(repoSpec.host || 'github.com');
  return host === (resolveGhHost(cwd || process.cwd(), deps) || 'github.com') ? null : host;
}

// For a single-invocation CLI whose every gh call targets its explicit --repo:
// exports explicitRepoGhHost's answer as GH_HOST on `deps.env` (process.env),
// so every later gh spawn, ghOptions-wrapped or a library default, reaches
// that host. -> the host pinned, or null. Called from a CLI's realDeps only.
function pinExplicitRepoHost(repoSpec, deps = {}) {
  const env = deps.env || process.env;
  const host = explicitRepoGhHost(repoSpec, deps.cwd, { ...deps, env });
  if (host) env.GH_HOST = host;
  return host;
}

module.exports = {
  parseRepo, ghAvailable, remoteUrl, repoSlug, repoResolutionNote,
  ghOptions, resolveGhHost, explicitRepoGhHost, pinExplicitRepoHost, _resetGhHostCache,
};
