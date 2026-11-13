// plugin/bin/lib/repo-resolve.js — shared owner/repo resolution for the bin/
// gh CLIs: the one parseRepo (#1177), the injectable `gh --version` probe, and the
// gh host seam (#4505). ghOptions(args, opts) returns opts itself when a non-empty GH_HOST is set,
// when args name -R/--repo/--hostname (unless an explicit repo host is recorded, below),
// or when origin's host is not a known GHE host; a known one (*.ghe.com or a gh
// hosts.yml key) gets a copy whose env adds GH_HOST, memoized per cwd. An explicit
// --repo's host (pinExplicitRepoHost, or deps.explicitHost for one call, which takes
// precedence over the recorded host) is added the same way, to the call's own env and
// never to process.env (#4795). An enterprise token alone admits nothing, because gh
// sends it to whatever GH_HOST names (#4854). It adds no timeout or windowsHide and
// there is no seam spawn helper: each wrapped site's own `timeout` carries its bound.
// The origin-host gate (#4933), gateOriginRepo(remote, deps), is what a CLI's
// origin-derived repo goes through; the comment above it is the one statement of its rules.
// originSpecOf(remote) (#4794) is the one origin read every gate and reader shares.
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
let explicitRepoHost = null; // the host pinExplicitRepoHost recorded for this process's explicit --repo (#4795)

function _resetGhHostCache() {
  ghHostSpecs.clear();
  notedGhHosts.clear();
  explicitRepoHost = null;
}

// `env` (optional) is the environment the git child runs in; absent, the inherited one.
function originUrl(cwd, env) {
  return execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: sharedPrimitives.GIT_TIMEOUT_MS, windowsHide: true,
    ...(env ? { env } : {}),
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

// An already-normalized host that is GitHub Enterprise by a positive signal: a
// *.ghe.com host, or a gh hosts.yml key. Shared by resolveGhSpec and gateOriginRepo.
function isKnownGhHost(host, deps = {}) {
  return host.endsWith('.ghe.com') || ghConfigHosts(deps).has(host);
}

// #4933: an origin remote -> { spec, refusal }. An absent or unparseable remote is
// { spec: null, refusal: null } (the caller's own no-repo path). An exported GH_HOST
// that normalizes to a host (ghHostIn) decides first: the origin host when it names that host, else github.com.
// An exported but empty (or whitespace-only) GH_HOST is no opt-in here, so an unknown origin
// host is still refused (decided at #4933's plan review); since #4794 ghOptions reads it the
// same way, through ghHostIn.
// Then github.com or isKnownGhHost passes; any other host is refused. Never throws.
// #4794: the gate judges `originSpecOf(remote)` alone (parseRepo of hostPathOf: userinfo, port and scheme
// dropped, the read the seam makes), so its verdict depends only on the host; a remote that
// read does not parse, such as a cloud sandbox's `http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}`
// proxy remote, is neither admitted nor refused. Two refusal texts: an SSH host may be an
// alias that resolves only through ~/.ssh/config, whatever its shape (`github.com-work` and
// `git.corp.invalid` look alike), so an SSH remote is told to export GH_HOST as the real host
// the alias maps to (or, for GitHub Enterprise, that server's host) and its own name is never
// offered as a GH_HOST value; an HTTPS host is a real DNS name the remote already reaches, so
// it keeps `export GH_HOST=${host}`.
function gateOriginRepo(remote, deps) {
  const d = deps || {};
  const parsed = originSpecOf(remote);
  if (!parsed) return { spec: null, refusal: null };
  const host = parsed.host;
  const ghHost = ghHostIn(d.env || process.env);
  if (ghHost) {
    return { spec: { ...parsed, host: ghHost === host ? host : 'github.com' }, refusal: null };
  }
  if (host === 'github.com' || isKnownGhHost(host, d)) return { spec: parsed, refusal: null };
  const prefix = `origin host ${host} is not a known GitHub host (not github.com, not *.ghe.com, not a gh hosts.yml key) — refusing to send it to gh`;
  return {
    spec: null,
    refusal: isSshRemote(remote)
      ? `${prefix}; if it is an SSH host alias, export GH_HOST as the real host it maps to (e.g. export GH_HOST=github.com), not the alias name; if it is GitHub Enterprise, export GH_HOST as that server's host`
      : `${prefix}; if it is GitHub Enterprise, export GH_HOST=${host}`,
  };
}

// An scp-style (`[user@]host:path`, no `//` after the colon) or `ssh://`, `git+ssh://`,
// `ssh+git://` remote: its host resolves through ~/.ssh/config, so it may be an alias.
function isSshRemote(remote) {
  const r = String(remote || '').trim();
  return /^(?:[^@\s/:]+@)?[^@\s/:]+:(?!\/)/.test(r) || /^(?:ssh|git\+ssh|ssh\+git):\/\//i.test(r);
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

// #4794: the one origin read. An origin remote URL -> { host, owner, repo } with the host
// normalized (hostPathOf drops userinfo, port and scheme; normalizeHost lower-cases and strips
// trailing dots), or null when the remote does not parse. Every reader of an origin remote goes
// through it, so a verdict depends only on the normalized host, never on how the URL is spelled.
function originSpecOf(remote) {
  const parsed = parseRepo(hostPathOf(remote));
  return parsed && { ...parsed, host: normalizeHost(parsed.host) };
}

// `deps.env` (optional) is the environment the origin read runs in and the one gh's config dir
// is looked up from; absent, the inherited one.
function resolveGhSpec(cwd, deps = {}) {
  const key = path.resolve(cwd);
  if (ghHostSpecs.has(key)) return ghHostSpecs.get(key);
  let spec = null;
  try {
    const url = deps.remoteUrl ? deps.remoteUrl(key) : originUrl(key, deps.env);
    const parsed = originSpecOf(url);
    if (parsed && parsed.host && parsed.host !== 'github.com') {
      // Positive signals only. Any other host stays silent (no note), token or not,
      // decided at #4854's plan review; its opt-in is an exported GH_HOST, or a
      // hosts.yml key from `gh auth login --hostname` (run with the token unset).
      if (isKnownGhHost(parsed.host, deps)) spec = parsed;
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
// pflag's attached `-Rx`) names the host itself, so the seam's origin-host injection
// stays out of it (an explicit repo host recorded or passed to ghOptions is still
// added: see ghOptions below).
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

// -> `opts` itself when nothing is injected, else a copy whose env is the effective
// env (opts.env, deps.env, or process env) plus GH_HOST. In order: an effective env
// that already has a non-empty GH_HOST wins and injects nothing (an empty, whitespace-only or
// '.' value is unset, #4794, so the injections below write over it in the call's own env copy;
// with nothing to inject, opts itself comes back and the empty value stays as it was); then
// the explicit repo host (`deps.explicitHost`, else the one pinExplicitRepoHost recorded) is
// injected, before the arg check, and prints no note. That order is deliberate (#4795,
// #4505): a host-less `-R owner/name` call on a pinned CLI must still reach the pinned
// host, as it did when the pin was an exported GH_HOST (which returned at the first
// check above, ahead of the arg scan), and a host-qualified flag beats GH_HOST in gh
// itself; checking args first would reintroduce #4505's split across two hosts.
// `deps.explicitHost` exists beside the recorded host for a caller that scopes the
// host to some calls only (backlog-grant-gate.js), and it wins over the recorded one.
// Then an explicit host arg injects nothing; then a known GHE origin host for
// opts.cwd is injected and its first injection per host prints repoResolutionNote,
// since GH_HOST also picks gh's auth host. The arg scan runs before the host probe,
// so an explicit-host call spawns no git.
function ghOptions(args, opts, deps = {}) {
  const o = opts || {};
  const base = o.env || deps.env || process.env;
  if (ghHostIn(base)) return opts;
  const explicitHost = deps.explicitHost || explicitRepoHost;
  if (explicitHost) return { ...o, env: { ...base, GH_HOST: explicitHost } };
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

// The ghOptions deps for a caller running gh against an injected environment (#5374):
// `{ env, stderr, homeDir }` (each optional) -> a deps object holding `env` and `stderr` only
// when given, and a `homedir` getter only when `homeDir` is a function, so `homeDir()` runs
// only if ghConfigDir falls through to the home directory. With none given it is `{}`, which
// ghOptions reads exactly as its own default.
function injectedGhDeps({ env, stderr, homeDir } = {}) {
  const deps = { ...(env ? { env } : {}), ...(stderr ? { stderr } : {}) };
  if (typeof homeDir === 'function') Object.defineProperty(deps, 'homedir', { get() { return homeDir(); }, enumerable: true });
  return deps;
}

// #4794: the exported GH_HOST as a normalized host, or null when it is unset or normalizes to
// nothing (empty, whitespace-only, all dots). The one GH_HOST reader: gateOriginRepo, ghOptions,
// explicitRepoGhHost, resolveRepoTarget and every caller comparing a host against it.
function ghHostIn(env) {
  return normalizeHost(String((env || {}).GH_HOST || '').trim()) || null;
}

// #4794: the one host a command's gh calls and host comparisons use, and the `--repo` slug
// for it. The host is, in order: a typed host-qualified --repo (`explicitHost`), a non-empty
// exported GH_HOST (gh itself sends a bare -R there), the caller's gated origin host
// (`originHost`), then github.com. The slug is bare `owner/repo` when that host is gh's own
// default host for a bare -R (GH_HOST, else github.com), else `host/owner/repo`: qualifying a
// slug gh already routes to the host would change a github.com origin's argv under an exported
// GH_HOST for no change in the host reached. Never reads origin: the caller passes the host
// the #4933 gate admitted (repoTargetOf), or none for a bare typed --repo.
function resolveRepoTarget({ owner, repo, explicitHost = null, originHost = null }, deps = {}) {
  const ghHost = ghHostIn(deps.env || process.env);
  const defaultHost = ghHost || 'github.com';
  const host = (explicitHost && normalizeHost(explicitHost)) || ghHost || (originHost && normalizeHost(originHost)) || 'github.com';
  return { host, ghRepo: host === defaultHost ? `${owner}/${repo}` : `${host}/${owner}/${repo}` };
}

// A CLI's explicit --repo names its own host, and a bare `owner/name` means
// github.com (Decision Q2). Its calls that carry no host flag (a github.com
// spec threads no --hostname; a GraphQL owner/repo pair; `gh api user`) would
// otherwise get ghOptions's origin host. -> the host those calls must reach,
// or null when ghOptions already reaches it from `cwd` (github.com when it
// injects nothing) or a non-empty GH_HOST is exported (AC4: the user's value wins).
function explicitRepoGhHost(repoSpec, cwd, deps = {}) {
  const env = deps.env || process.env;
  if (!repoSpec || ghHostIn(env)) return null;
  const host = normalizeHost(repoSpec.host || 'github.com');
  return host === (resolveGhHost(cwd || process.cwd(), deps) || 'github.com') ? null : host;
}

// For a single-invocation CLI whose every gh call targets its explicit --repo:
// records explicitRepoGhHost's answer (or null) as this module's explicit repo
// host, which ghOptions adds as GH_HOST to each wrapped call's own env. Writes
// neither process.env nor `deps.env`, so a gh spawn that skips ghOptions is not
// reached by it. -> the host recorded, or null. Called from a CLI's realDeps only.
function pinExplicitRepoHost(repoSpec, deps = {}) {
  const env = deps.env || process.env;
  explicitRepoHost = explicitRepoGhHost(repoSpec, deps.cwd, { ...deps, env });
  return explicitRepoHost;
}

module.exports = {
  parseRepo, ghAvailable, remoteUrl, repoSlug, repoResolutionNote,
  ghOptions, injectedGhDeps, resolveGhHost, explicitRepoGhHost, pinExplicitRepoHost, _resetGhHostCache,
  isKnownGhHost, gateOriginRepo, normalizeHost, originUrl, ghHostIn, resolveRepoTarget, hostPathOf, originSpecOf,
};
