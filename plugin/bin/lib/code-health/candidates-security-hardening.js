'use strict';

// candidates-security-hardening.js — deterministic pre-launch security
// hardening candidate generator for code-health's `focus=security-hardening`
// scoping mode (see skills/code-health/focus-mode.md). Flags four AI-app
// failure patterns: the original three (#2624) — (a) secret-shaped literals
// in client-side source, (b) user-data routes/handlers with no visible
// per-user ownership predicate nearby, (c) AI-model-calling routes/handlers
// with no visible auth/rate-limit/spend-guard signal nearby — plus a fourth
// (#2751): (d) agent/tool identity and delegation-audit gaps — a credential
// or token identifier reused verbatim across distinct call sites that look
// like separate callers/agents (no per-caller scoping), or a delegation call
// (one agent/tool invoking another) with no accompanying log/trace/audit
// signal nearby. Candidates are INPUT to the judge (skills/code-health/
// SKILL.md Step 5) — this generator never concludes anything on its own,
// never fixes anything.
//
// Scope boundary vs. sibling records (deliverable 5 of #2624, extended by
// #2751 to admit the fourth check above): this vertical owns exactly the
// four checks above. #2622's pre-scale hardening (query/background-job/
// caching/pooling/monitoring) and #2625's GDPR/backup-retention check are
// out of scope here — no overlapping category is claimed by more than one
// of the four. See `criteria-security-hardening.md` for the judging side of
// this same boundary statement.
//
// Coverage (stated explicitly, never implied total — IL-110):
//   - JS/TS files only (reuses candidates-dead-code.js's
//     listTrackedSourceFiles — same git-ls-files discovery, same extension
//     set, same .gitignore handling, same discoveryFailed/discoveryReason
//     IL-115 distinction).
//   - "Client-side" is a path heuristic (CLIENT_DIR_RE below, minus
//     SERVER_DIR_RE) — a repo whose client code lives outside those
//     directory names is invisible to check (a); a repo that mixes client
//     and server code in one file defeats the heuristic entirely.
//   - "Route/handler" is a path heuristic (ROUTE_DIR_RE below) for checks
//     (b) and (c) — a repo whose API code lives outside those directory
//     names (e.g. file-based routing with no distinguishing directory name)
//     is invisible to both.
//   - Secret detection is pattern-based (SECRET_PATTERNS) — a real secret
//     not matching a known provider shape, or a fabricated string that
//     happens to match one, are both possible false negatives/positives;
//     SAFE_PREFIX_RE reduces false positives on known-public key shapes
//     (Stripe pk_*, *_PUBLIC_*/NEXT_PUBLIC_*/VITE_*/REACT_APP_* env names)
//     but is not exhaustive — the judge is expected to apply the "is this
//     actually private/server-only" distinction the generator can't.
//   - Ownership/auth/rate-limit/spend-guard detection is a text-window
//     heuristic (a bounded window of characters around the query/call
//     site) — not a structural/AST-aware analysis, so it can only flag the
//     apparent *absence* of a recognizable predicate, never verify that an
//     existing one is actually correct (scoped to the right user, not
//     bypassable). Flag-for-human-review, not a formal proof.
//   - AI-SDK call recognition is pattern-based (AI_CALL_PATTERNS) — covers
//     the OpenAI/Anthropic SDK call shapes and a few generic "chat
//     completion"-style method names; a bespoke or unlisted provider SDK is
//     invisible to check (c).
//   - Shared-identity/delegation-audit detection (check (d), #2751) is
//     text-pattern only, same tradeoff as (b)/(c): a credential/token
//     identifier (naming-convention match, CREDENTIAL_NAME_RE) reused as an
//     argument across two or more distinct call-site callee names is a
//     heuristic for "separate callers/agents share one identity" — it
//     cannot tell a genuinely shared, intentionally-scoped utility token
//     from a broad-access one actually spanning agents; a delegation call
//     (DELEGATION_CALL_PATTERNS) with no log/trace/audit signal
//     (DELEGATION_AUDIT_SIGNAL_RE) within the usual text window is likewise
//     only the apparent *absence* of an audit trail, never proof one is
//     missing at a layer the generator doesn't scan (a wrapping middleware,
//     a centralized logger call elsewhere in the module).

const fs = require('fs');
const path = require('path');
const { listTrackedSourceFiles } = require('./candidates-dead-code');
const { registerGenerator } = require('./focus-generators');

const CLIENT_DIR_RE = /(^|\/)(client|frontend|web|public|src\/(components|pages|app))(\/|$)/i;
const SERVER_DIR_RE = /(^|\/)(server|backend|api)(\/|$)/i;
const ROUTE_DIR_RE = /(^|\/)(routes?|api|handlers?|controllers?|endpoints?)(\/|$)/i;

const SECRET_PATTERNS = [
  { name: 'stripe-secret-key', re: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'generic-api-key-assignment', re: /\b(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_-]{20,}['"]/gi },
  { name: 'openai-secret-key', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
];

// Known-public key shapes / env-var naming conventions that are safe to
// ship client-side — a match here suppresses the candidate rather than
// filing a false positive.
const SAFE_PREFIX_RE = /(pk_live_|pk_test_|NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_)/;

const OWNERSHIP_SIGNAL_RE = /(user_id|userId|owner_id|ownerId|req\.user\b|req\.auth\b|auth\(\)\.uid|\bRLS\b|row[- ]level security|\.eq\(\s*['"]user_id['"])/i;

const QUERY_SIGNAL_RE = /(\.findOne\(|\.find\(|\.query\(|\bSELECT\b|\.select\(|\.from\()/gi;

const AI_CALL_PATTERNS = [
  /\bopenai\b/i,
  /\bchat\.completions\.create\b/i,
  /\bmessages\.create\b/i,
  /\banthropic\b/i,
  /\bcreateChatCompletion\b/i,
  /\bgenerateText\b/i,
];

const AI_GUARD_SIGNAL_RE = /(rate ?limit|rateLimit|requireAuth|authenticate|isAuthenticated|middleware\([^)]*auth|maxTokens|max_tokens|spend|budget|quota)/i;

// Fourth check (#2751): agent/tool identity and delegation-audit gaps.
//
// (d.1) Shared identity — a credential/token identifier, declared once by
// naming convention (not value shape, unlike SECRET_PATTERNS above), then
// passed as an argument into two or more call sites whose callee names
// differ — the text-level proxy for "distinct callers/agents reuse one
// broad-access identity instead of each holding a scoped one."
const CREDENTIAL_NAME_RE = /token|api[_-]?key|credential|secret/i;
const CREDENTIAL_DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;

// Callee names that look like an agent/tool/delegate invocation rather than
// an unrelated utility call — narrows the shared-identity check so a token
// merely passed to, say, a logger twice doesn't itself read as cross-agent
// sharing.
const AGENT_CALLEE_RE = /agent|bot|worker|tool|delegate|dispatch/i;

// (d.2) Delegation call with no nearby audit/log/trace signal — one agent or
// tool invoking another with nothing recording who delegated to whom.
const DELEGATION_CALL_PATTERNS = [
  /\b(?:agents?|tools?)\.(?:call|invoke|run|execute|dispatch)\(/gi,
  /\bdelegateTo\(/gi,
  /\bcallAgent\(/gi,
  /\binvokeAgent\(/gi,
];

const DELEGATION_AUDIT_SIGNAL_RE = /(\blog\b|logger|\btrace\b|\baudit\b|\brecord\(|emit\(|console\.(log|info|warn|error))/i;

const WINDOW = 400; // chars, each direction, for co-occurrence checks

function windowAround(text, index, matchLen) {
  const start = Math.max(0, index - WINDOW);
  const end = Math.min(text.length, index + matchLen + WINDOW);
  return text.slice(start, end);
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// The physical line(s) spanning a match — deliberately narrower than
// windowAround's 400-char co-occurrence window. The safe-prefix allowlist
// check below *suppresses* a candidate outright (unlike the ownership/guard
// checks, which only ever add one), so a wide window lets an unrelated
// NEXT_PUBLIC_*/pk_live_* token 400 chars away in the same file silently
// clear a genuinely private secret on a different line/declaration entirely.
function lineText(text, index, matchLen) {
  const start = text.lastIndexOf('\n', index) + 1;
  const nextNewline = text.indexOf('\n', index + matchLen);
  const end = nextNewline === -1 ? text.length : nextNewline;
  return text.slice(start, end);
}

function scanClientSecrets(rel, text, candidates) {
  if (!CLIENT_DIR_RE.test(rel) || SERVER_DIR_RE.test(rel)) return;
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const matched = m[0];
      const win = lineText(text, m.index, matched.length);
      if (SAFE_PREFIX_RE.test(win)) {
        if (m.index === re.lastIndex) re.lastIndex += 1;
        continue;
      }
      const line = lineOf(text, m.index);
      candidates.push({
        file: rel,
        kind: 'client-secret',
        evidence: `secret-shaped literal ("${name}") in client-side file at ${rel}:${line}`,
      });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

function scanMissingOwnership(rel, text, candidates) {
  if (!ROUTE_DIR_RE.test(rel)) return;
  const re = new RegExp(QUERY_SIGNAL_RE.source, QUERY_SIGNAL_RE.flags);
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const win = windowAround(text, m.index, m[0].length);
    if (!OWNERSHIP_SIGNAL_RE.test(win)) {
      const line = lineOf(text, m.index);
      candidates.push({
        file: rel,
        kind: 'missing-ownership-check',
        evidence: `query site at ${rel}:${line} has no ownership predicate (user_id/owner_id/req.user/RLS) within ${WINDOW} chars`,
      });
    }
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
}

function scanUnguardedAiEndpoint(rel, text, candidates) {
  if (!ROUTE_DIR_RE.test(rel)) return;
  for (const pat of AI_CALL_PATTERNS) {
    const flags = pat.flags.includes('g') ? pat.flags : `${pat.flags}g`;
    const re = new RegExp(pat.source, flags);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const win = windowAround(text, m.index, m[0].length);
      if (!AI_GUARD_SIGNAL_RE.test(win)) {
        const line = lineOf(text, m.index);
        candidates.push({
          file: rel,
          kind: 'unguarded-ai-endpoint',
          evidence: `AI-model call at ${rel}:${line} has no auth/rate-limit/spend-guard signal within ${WINDOW} chars`,
        });
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

function scanSharedAgentIdentity(rel, text, candidates) {
  const declRe = new RegExp(CREDENTIAL_DECL_RE.source, CREDENTIAL_DECL_RE.flags);
  declRe.lastIndex = 0;
  let decl;
  const seenNames = new Set();
  while ((decl = declRe.exec(text))) {
    const name = decl[1];
    if (seenNames.has(name) || !CREDENTIAL_NAME_RE.test(name)) continue;
    seenNames.add(name);

    const usageRe = new RegExp(`([A-Za-z_$][\\w$]*)\\s*\\([^()]*\\b${name}\\b[^()]*\\)`, 'g');
    usageRe.lastIndex = 0;
    const calleesByName = new Map();
    let use;
    while ((use = usageRe.exec(text))) {
      const callee = use[1];
      if (callee === name) continue; // the declaration's own RHS, if it happens to be call-shaped
      if (!calleesByName.has(callee)) calleesByName.set(callee, use.index);
    }
    const distinctCallees = [...calleesByName.keys()];
    const agentLike = distinctCallees.filter((c) => AGENT_CALLEE_RE.test(c));
    if (distinctCallees.length >= 2 && agentLike.length >= 1) {
      const firstIndex = Math.min(...calleesByName.values());
      const line = lineOf(text, firstIndex);
      candidates.push({
        file: rel,
        kind: 'shared-agent-identity',
        evidence: `credential identifier "${name}" reused across distinct call sites (${distinctCallees.join(', ')}) starting at ${rel}:${line} — possible shared identity instead of per-caller scoping`,
      });
    }
  }
}

function scanUnauditedDelegation(rel, text, candidates) {
  for (const pat of DELEGATION_CALL_PATTERNS) {
    const re = new RegExp(pat.source, pat.flags);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const win = windowAround(text, m.index, m[0].length);
      if (!DELEGATION_AUDIT_SIGNAL_RE.test(win)) {
        const line = lineOf(text, m.index);
        candidates.push({
          file: rel,
          kind: 'shared-agent-identity',
          evidence: `delegation call at ${rel}:${line} has no audit/log/trace signal within ${WINDOW} chars`,
        });
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

// The rich-shape scan — registered under 'security-hardening' in
// FOCUS_GENERATORS. No policy config (unlike experiment-cleanup); every
// pattern here is a shipped default, not project-configurable, since these
// are provider-shaped literals and framework-generic middleware names
// rather than a project-specific idiom.
function scanSecurityHardening(rootDir) {
  const discovery = listTrackedSourceFiles(rootDir);
  if (discovery.discoveryFailed) {
    return {
      candidates: [],
      scannedFiles: 0,
      skippedFiles: [],
      discoveryFailed: true,
      discoveryReason: discovery.reason,
    };
  }

  const skippedFiles = [];
  const candidates = [];
  for (const rel of discovery.files) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(rootDir, rel));
    } catch {
      skippedFiles.push({ file: rel, reason: 'unreadable' });
      continue;
    }
    if (buf.includes(0)) {
      skippedFiles.push({ file: rel, reason: 'binary-or-nul' });
      continue;
    }
    const text = buf.toString('utf8');
    scanClientSecrets(rel, text, candidates);
    scanMissingOwnership(rel, text, candidates);
    scanUnguardedAiEndpoint(rel, text, candidates);
    scanSharedAgentIdentity(rel, text, candidates);
    scanUnauditedDelegation(rel, text, candidates);
  }

  candidates.sort((a, b) => (a.file === b.file ? a.evidence.localeCompare(b.evidence) : a.file.localeCompare(b.file)));

  return {
    candidates,
    scannedFiles: discovery.files.length,
    skippedFiles,
    discoveryFailed: false,
  };
}

// Spec-pinned Data/API Surface signature — a bare array, mirroring the
// sibling verticals' direct entry point for unit tests / a future
// non-focus-mode caller.
function candidatesSecurityHardening(rootDir) {
  return scanSecurityHardening(rootDir).candidates;
}

registerGenerator('security-hardening', scanSecurityHardening);

module.exports = {
  scanSecurityHardening,
  candidatesSecurityHardening,
  scanClientSecrets,
  scanMissingOwnership,
  scanUnguardedAiEndpoint,
  scanSharedAgentIdentity,
  scanUnauditedDelegation,
  SECRET_PATTERNS,
  CLIENT_DIR_RE,
  SERVER_DIR_RE,
  ROUTE_DIR_RE,
  SAFE_PREFIX_RE,
  CREDENTIAL_NAME_RE,
  AGENT_CALLEE_RE,
  DELEGATION_AUDIT_SIGNAL_RE,
};
