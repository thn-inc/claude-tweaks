'use strict';

// candidates-security-hardening.js — deterministic pre-launch security
// hardening candidate generator for code-health's `focus=security-hardening`
// scoping mode (see skills/code-health/focus-mode.md). Originally flagged
// three AI-app failure patterns (#2624): (a) secret-shaped literals in
// client-side source, (b) user-data routes/handlers with no visible
// per-user ownership predicate nearby, (c) AI-model-calling routes/handlers
// with no visible auth/rate-limit/spend-guard signal nearby. Extended by
// sibling records that each add further checks to this same vertical
// rather than standing up their own: (d)/(e) JWT algorithm-confusion and
// long-lived-token checks (#2657), (f)/(g)/(h) secrets-manager usage and
// key-rotation checks (#2666), (i) a privacy-policy third-party-service
// accuracy check (#2663), (j) agent/tool identity and delegation-audit
// gaps (#2751) — a credential or token identifier reused verbatim across
// distinct call sites that look like separate callers/agents (no
// per-caller scoping), or a delegation call (one agent/tool invoking
// another) with no accompanying log/trace/audit signal nearby — and three
// more (#2668): (k) raw-HTML output sinks (dangerouslySetInnerHTML,
// innerHTML =, v-html, Blade {!! !!}, a `| safe` filter) with no sanitizer
// signal nearby, (l) upload middleware/handlers (multer, formidable,
// busboy, request.files, UploadFile) with no type/size-limit signal
// nearby, (m) webhook route files with no signature-verification signal
// nearby. All thirteen checks are INPUT to the judge
// (skills/code-health/SKILL.md Step 5) — this generator never concludes
// anything on its own, never fixes anything.
//
// Scope boundary vs. sibling records (deliverable 5 of #2624, extended by
// #2657/#2663/#2666/#2751/#2668): this vertical owns exactly the checks
// named above.
// #2622's pre-scale hardening (query/background-job/caching/pooling/
// monitoring) and #2625's GDPR/backup-retention check remain out of scope
// here — no overlapping category is claimed by more than one vertical. The
// terms-of-service and cyber-liability-insurance items #2663 also names are
// explicitly NOT automated here (and never will be — they are not code-
// inspectable); see `criteria-security-hardening.md`'s Manual items section.
// See that same file for the judging side of every boundary statement here.
//
// Coverage (stated explicitly, never implied total — IL-110):
//   - JS/TS files only for every per-file scan — one unfiltered
//     `listTrackedFiles` discovery call (candidates-dead-code.js's
//     git-ls-files helper), filtered here to the same extension set
//     `listTrackedSourceFiles` would use, shared with the privacy-policy-
//     mismatch check (i)'s own need for the unfiltered list (a privacy-policy
//     document is rarely a .js/.ts file) so both draw from the one discovery
//     pass rather than each triggering its own `git ls-files` subprocess.
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
//   - JWT checks (d)/(e) recognize `jsonwebtoken`-shaped (`jwt.verify(`/
//     `jwt.sign(`) and `jose`-shaped (`jwtVerify(`) call sites only, scanned
//     repo-wide rather than gated to ROUTE_DIR_RE (JWT validation commonly
//     lives in a dedicated auth/middleware module outside a routes/
//     handlers directory name) — a bespoke or unlisted JWT library, or a
//     `jose` `SignJWT` builder-chain sign call, is invisible to either
//     check. Each is a text-window presence check for an `algorithms:`
//     option (d) or an `expiresIn`/`exp` option (e) — it cannot verify the
//     option's *value* is actually safe (e.g. `algorithms: ['none']`
//     explicitly listed still reads as "pinned"). Both checks (and (f)-(h)
//     below) still skip a CLIENT_DIR_RE-matching path the same way check (a)
//     does (deliberate — see the tests pinning this), so a framework
//     convention that places server-side code under a CLIENT_DIR_RE-matching
//     directory name (e.g. Next.js App Router's `src/app` tree, used for both
//     client and server files) is invisible to (d)-(h) as well as (a).
//   - Secrets-lifecycle checks (f)/(g)/(h) are a single-file text heuristic:
//     a credential-shaped `process.env.*` access with no secrets-manager
//     SDK import pattern anywhere in the same file flags (f); given a
//     manager import, no "rotat*" mention anywhere in the file flags (g);
//     given both, no automation-scheduling signal (cron/schedule/
//     EventBridge/etc.) within the same text window as the rotation mention
//     flags (h). A real secrets-manager usage or documented rotation
//     procedure that lives in a *different* file (a shared config module, a
//     separate ops doc) is invisible to all three — this is explicitly a
//     flag-for-human-review
//     heuristic, consistent with this record's own Gotchas.
//   - Privacy-policy-mismatch (i) only runs when a file matching
//     PRIVACY_POLICY_FILE_RE exists in the tracked tree; a repo with no
//     such file produces no candidate for this check (missing-policy is
//     the `focus=prelaunch` vertical's `privacy-policy` manual item, not
//     this check's job — see Scope boundary). Third-party-service
//     detection is pattern-based (THIRD_PARTY_SERVICES) — an unlisted
//     service, or one referenced only via a generic wrapper, is invisible.
//   - Shared-identity/delegation-audit detection (check (j), #2751) is
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
//   - Unescaped-output/XSS sink detection (check (k), #2668) is
//     pattern-based across several templating conventions
//     (UNESCAPED_OUTPUT_SINK_PATTERNS) — but since this generator only
//     scans JS/TS-extension files (SOURCE_EXTS, in candidates-dead-code.js),
//     a Vue `.vue` single-file component, a Laravel `.blade.php` view, or a
//     Jinja/Django/Nunjucks `.html`/`.jinja2` template is invisible to this
//     check entirely; only an occurrence of one of these sink shapes
//     written inside a `.js`/`.ts`/`.jsx`/`.tsx` file is visible. No
//     directory restriction is applied — a sink can appear in any scanned
//     file.
//   - Unrestricted-upload detection (check (l), #2668) is pattern-based
//     (UPLOAD_HANDLER_PATTERNS) with no directory restriction — a
//     type/size-limit guard (UPLOAD_GUARD_SIGNAL_RE) expressed outside the
//     text window, or enforced at a reverse-proxy/API-gateway layer the
//     generator never reads, is indistinguishable from a guard that's
//     genuinely absent.
//   - Unverified-webhook detection (check (m), #2668) is gated on a path
//     heuristic (WEBHOOK_FILE_RE: the file or a parent directory must name
//     itself "webhook"/"webhooks") — a webhook handler living in a file or
//     directory that doesn't name itself that way is invisible to this
//     check; a signature-verification call (WEBHOOK_VERIFY_SIGNAL_RE)
//     performed in a shared middleware or verifier utility outside the text
//     window reads as absent.

const fs = require('fs');
const path = require('path');
const { listTrackedFiles } = require('./candidates-dead-code');
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

// JWT validation (#2657): alg-confusion / alg:none / long-lived-token checks.
const JWT_VERIFY_CALL_RE = /\b(?:jwt|jsonwebtoken)\.verify\(|\bjwtVerify\(/g;
const JWT_SIGN_CALL_RE = /\b(?:jwt|jsonwebtoken)\.sign\(/g;
const JWT_ALGORITHMS_OPTION_RE = /\balgorithms?\s*:/i;
const JWT_EXPIRES_OPTION_RE = /\bexpiresIn\s*:|\bexp\s*:/i;

// Secrets lifecycle (#2666): secrets-manager usage + rotation checks.
const CREDENTIAL_ENV_RE = /process\.env\.([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\b/gi;
const SAFE_CREDENTIAL_NAME_RE = /PUBLIC|PUBLISHABLE/i;
const SECRETS_MANAGER_IMPORT_RE = /(\bdoppler\b|\binfisical\b|@aws-sdk\/client-secrets-manager|aws-sdk\/clients\/secretsmanager|@google-cloud\/secret-manager|\bnode-vault\b|hashicorp[-/]vault|@azure\/keyvault-secrets)/i;
const ROTATION_KEYWORD_RE = /\brotat(e|ion|ing|ed)\b/i;
const ROTATION_AUTOMATION_RE = /\b(cron|node-cron|scheduled?|setInterval|EventBridge|CloudWatch\s*Events?)\b/i;

// Privacy-policy accuracy (#2663): third-party service vs. policy-doc check.
const PRIVACY_POLICY_FILE_RE = /(^|\/)(privacy-?policy|privacy)\.(md|mdx|html?|txt)$/i;
// JS/TS extension test — shared by the main per-file scan loop (which
// files below) and scanPrivacyPolicyMismatch's own need to recognize source
// files among the unfiltered tracked-files list.
const JS_TS_SOURCE_FILE_RE = /\.(jsx?|tsx?|mjs|cjs)$/i;
const THIRD_PARTY_SERVICES = [
  { name: 'Google Analytics', codeRe: /\b(gtag\(|google-analytics|GoogleAnalytics)\b/i, policyRe: /google analytics|\bga4\b/i },
  { name: 'Segment', codeRe: /@segment\/analytics|\bsegment\.(io|com)\b/i, policyRe: /segment/i },
  { name: 'Mixpanel', codeRe: /\bmixpanel\b/i, policyRe: /mixpanel/i },
  { name: 'Sentry', codeRe: /@sentry\/|\bSentry\.init\b/i, policyRe: /sentry/i },
  { name: 'Intercom', codeRe: /\bintercom\b/i, policyRe: /intercom/i },
  { name: 'Stripe', codeRe: /\bstripe\b/i, policyRe: /stripe/i },
  { name: 'Hotjar', codeRe: /\bhotjar\b/i, policyRe: /hotjar/i },
  { name: 'Facebook Pixel', codeRe: /\bfbq\(/i, policyRe: /facebook|\bmeta\b/i },
];

// Check (j) (#2751): agent/tool identity and delegation-audit gaps.
//
// (j.1) Shared identity — a credential/token identifier, declared once by
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

// (j.2) Delegation call with no nearby audit/log/trace signal — one agent or
// tool invoking another with nothing recording who delegated to whom.
const DELEGATION_CALL_PATTERNS = [
  /\b(?:agents?|tools?)\.(?:call|invoke|run|execute|dispatch)\(/gi,
  /\bdelegateTo\(/gi,
  /\bcallAgent\(/gi,
  /\binvokeAgent\(/gi,
];

const DELEGATION_AUDIT_SIGNAL_RE = /(\blog\b|logger|\btrace\b|\baudit\b|\brecord\(|emit\(|console\.(log|info|warn|error))/i;

// Check (k) (#2668): XSS via unescaped output. Raw-HTML sinks across
// several framework conventions — stack-agnostic by design (Gotchas,
// #2668) rather than one vendor's API.
const UNESCAPED_OUTPUT_SINK_PATTERNS = [
  /\bdangerouslySetInnerHTML\b/i, // React
  /\.innerHTML\s*=(?!=)/, // vanilla DOM assignment (not ==/===)
  /\bv-html\b/i, // Vue
  /\{!!.*?!!\}/, // Laravel Blade unescaped-output directive
  /\|\s*safe\b/i, // Jinja2/Django/Nunjucks "| safe" filter
];

const SANITIZER_SIGNAL_RE = /(DOMPurify|sanitize-html|sanitizeHtml|sanitize\(|escapeHtml|encodeHTML|he\.encode|xss\(|striptags|escapeHTML|\bpurify\()/i;

// Check (l) (#2668): unrestricted file uploads. Upload middleware/handler
// shapes across several frameworks.
const UPLOAD_HANDLER_PATTERNS = [
  /\bmulter\s*\(/i,
  /\bformidable\s*\(/i,
  /\bbusboy\s*\(/i,
  /\brequest\.files\b/i,
  /\breq\.files\b/i,
  /\bUploadFile\b/,
];

const UPLOAD_GUARD_SIGNAL_RE = /(fileFilter|mimetype|mime[_-]?type|allowed[_-]?(?:types|extensions|mimetypes)|file[_-]?size|maxFileSize|limits\s*:|\.size\s*[<>]|content[-_]?type\s*===|extname\(|allowedExtensions)/i;

// Check (m) (#2668): unverified payment/webhook callbacks. Gated on a
// path heuristic (a webhook route file names itself that way) rather than a
// directory-name heuristic like ROUTE_DIR_RE, since webhook endpoints are
// usually distinguished by name, not by living under routes?/api/ alone.
const WEBHOOK_FILE_RE = /(^|\/)[\w.-]*webhooks?[\w.-]*(\/|$)/i;

const WEBHOOK_HANDLER_SIGNAL_RE = /(\.(?:post|put|all)\(|router\.(?:post|put)\(|exports\.handler\s*=|module\.exports\s*=|export\s+(?:default|const\s+handler)|functions\.https\.onRequest\()/i;

const WEBHOOK_VERIFY_SIGNAL_RE = /(constructEvent|verifySignature|verifyWebhookSignature|timingSafeEqual|createHmac|stripe-signature|x-hub-signature|svix-signature|[\w-]*-signature['"`]|signature\s*header)/i;

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
  QUERY_SIGNAL_RE.lastIndex = 0;
  let m;
  while ((m = QUERY_SIGNAL_RE.exec(text))) {
    const win = windowAround(text, m.index, m[0].length);
    if (!OWNERSHIP_SIGNAL_RE.test(win)) {
      const line = lineOf(text, m.index);
      candidates.push({
        file: rel,
        kind: 'missing-ownership-check',
        evidence: `query site at ${rel}:${line} has no ownership predicate (user_id/owner_id/req.user/RLS) within ${WINDOW} chars`,
      });
    }
    if (m.index === QUERY_SIGNAL_RE.lastIndex) QUERY_SIGNAL_RE.lastIndex += 1;
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

function scanJwtValidation(rel, text, candidates) {
  if (CLIENT_DIR_RE.test(rel) && !SERVER_DIR_RE.test(rel)) return; // JWT verification/issuance is a server-side concern
  JWT_VERIFY_CALL_RE.lastIndex = 0;
  let m;
  while ((m = JWT_VERIFY_CALL_RE.exec(text))) {
    const win = windowAround(text, m.index, m[0].length);
    if (!JWT_ALGORITHMS_OPTION_RE.test(win)) {
      const line = lineOf(text, m.index);
      candidates.push({
        file: rel,
        kind: 'jwt-alg-not-pinned',
        evidence: `JWT verify call at ${rel}:${line} has no explicit algorithms allowlist within ${WINDOW} chars — vulnerable to alg:none / algorithm-confusion attacks`,
      });
    }
    if (m.index === JWT_VERIFY_CALL_RE.lastIndex) JWT_VERIFY_CALL_RE.lastIndex += 1;
  }

  JWT_SIGN_CALL_RE.lastIndex = 0;
  while ((m = JWT_SIGN_CALL_RE.exec(text))) {
    const win = windowAround(text, m.index, m[0].length);
    if (!JWT_EXPIRES_OPTION_RE.test(win)) {
      const line = lineOf(text, m.index);
      candidates.push({
        file: rel,
        kind: 'jwt-long-lived-token',
        evidence: `JWT sign call at ${rel}:${line} has no expiresIn/exp option within ${WINDOW} chars — token may never expire`,
      });
    }
    if (m.index === JWT_SIGN_CALL_RE.lastIndex) JWT_SIGN_CALL_RE.lastIndex += 1;
  }
}

function scanSecretsLifecycle(rel, text, candidates) {
  if (CLIENT_DIR_RE.test(rel) && !SERVER_DIR_RE.test(rel)) return; // credential-env access is a server-side concern
  const hasManager = SECRETS_MANAGER_IMPORT_RE.test(text);
  CREDENTIAL_ENV_RE.lastIndex = 0;
  let credMatch = null;
  let m;
  while ((m = CREDENTIAL_ENV_RE.exec(text))) {
    if (!SAFE_CREDENTIAL_NAME_RE.test(m[1])) {
      credMatch = m;
      break;
    }
    if (m.index === CREDENTIAL_ENV_RE.lastIndex) CREDENTIAL_ENV_RE.lastIndex += 1;
  }
  if (!credMatch) return; // no credential-shaped env access in this file at all

  if (!hasManager) {
    const line = lineOf(text, credMatch.index);
    candidates.push({
      file: rel,
      kind: 'secrets-no-manager',
      evidence: `credential-shaped env access at ${rel}:${line} with no dedicated secrets-manager SDK import in this file`,
    });
    return; // rotation checks only meaningful once a manager is actually in use
  }

  const rotationMatch = ROTATION_KEYWORD_RE.exec(text);
  if (!rotationMatch) {
    candidates.push({
      file: rel,
      kind: 'no-rotation-procedure',
      evidence: `${rel} imports a secrets-manager SDK but names no rotation procedure (no "rotat*" mention in file)`,
    });
    return;
  }

  // Windowed near the rotation mention (not whole-file) — an unrelated
  // automation signal elsewhere in a large file (a cron job for something
  // else entirely) must not silently clear a genuinely manual-only rotation
  // procedure, matching this file's header comment and the criteria doc.
  const win = windowAround(text, rotationMatch.index, rotationMatch[0].length);
  if (!ROTATION_AUTOMATION_RE.test(win)) {
    candidates.push({
      file: rel,
      kind: 'no-rotation-schedule',
      evidence: `${rel} mentions key rotation but no automation signal (cron/schedule/EventBridge) is present within ${WINDOW} chars — rotation appears manual-only`,
    });
  }
}

// Whole-repo check (unlike the per-file scans above): needs the policy
// document's own content to compare against, so it runs once per
// `scanSecurityHardening` call rather than once per discovered file.
// `cachedText` (optional) is a Map of already-read `rel -> text` for files
// matching `JS_TS_SOURCE_FILE_RE` — `scanSecurityHardening` below
// passes the content its own main loop already read, so this check doesn't
// re-read and re-decode the whole JS/TS tree a second time. Omit it (as
// every direct unit-test call below does) to have this function read the
// files itself, unchanged from its original standalone behavior.
function scanPrivacyPolicyMismatch(files, rootDir, candidates, cachedText) {
  const policyFile = files.find((f) => PRIVACY_POLICY_FILE_RE.test(f));
  if (!policyFile) return; // nothing to compare against — missing-policy is prelaunch's job, not this check's

  let policyText;
  try {
    policyText = fs.readFileSync(path.join(rootDir, policyFile), 'utf8');
  } catch {
    return;
  }

  const flaggedServices = new Set();
  for (const rel of files) {
    if (rel === policyFile || !JS_TS_SOURCE_FILE_RE.test(rel)) continue;
    let text = cachedText && cachedText.get(rel);
    if (text === undefined) {
      let buf;
      try {
        buf = fs.readFileSync(path.join(rootDir, rel));
      } catch {
        continue;
      }
      if (buf.includes(0)) continue;
      text = buf.toString('utf8');
    }
    for (const svc of THIRD_PARTY_SERVICES) {
      if (flaggedServices.has(svc.name)) continue;
      if (svc.codeRe.test(text) && !svc.policyRe.test(policyText)) {
        candidates.push({
          file: rel,
          kind: 'privacy-policy-mismatch',
          evidence: `${svc.name} integration found in ${rel} but not named in privacy policy (${policyFile})`,
        });
        flaggedServices.add(svc.name);
      }
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

function scanUnescapedOutput(rel, text, candidates) {
  for (const pat of UNESCAPED_OUTPUT_SINK_PATTERNS) {
    const flags = pat.flags.includes('g') ? pat.flags : `${pat.flags}g`;
    const re = new RegExp(pat.source, flags);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const win = windowAround(text, m.index, m[0].length);
      if (!SANITIZER_SIGNAL_RE.test(win)) {
        const line = lineOf(text, m.index);
        candidates.push({
          file: rel,
          kind: 'unescaped-output',
          evidence: `raw-HTML output sink at ${rel}:${line} has no sanitizer signal within ${WINDOW} chars`,
        });
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

function scanUnrestrictedUpload(rel, text, candidates) {
  for (const pat of UPLOAD_HANDLER_PATTERNS) {
    const flags = pat.flags.includes('g') ? pat.flags : `${pat.flags}g`;
    const re = new RegExp(pat.source, flags);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const win = windowAround(text, m.index, m[0].length);
      if (!UPLOAD_GUARD_SIGNAL_RE.test(win)) {
        const line = lineOf(text, m.index);
        candidates.push({
          file: rel,
          kind: 'unrestricted-upload',
          evidence: `upload handler at ${rel}:${line} has no type/size-limit signal within ${WINDOW} chars`,
        });
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

function scanUnverifiedWebhook(rel, text, candidates) {
  if (!WEBHOOK_FILE_RE.test(rel)) return;
  const re = new RegExp(WEBHOOK_HANDLER_SIGNAL_RE.source, 'gi');
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const win = windowAround(text, m.index, m[0].length);
    if (!WEBHOOK_VERIFY_SIGNAL_RE.test(win)) {
      const line = lineOf(text, m.index);
      candidates.push({
        file: rel,
        kind: 'unverified-webhook',
        evidence: `webhook handler at ${rel}:${line} has no signature-verification signal within ${WINDOW} chars`,
      });
    }
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
}

// The rich-shape scan — registered under 'security-hardening' in
// FOCUS_GENERATORS. No policy config (unlike experiment-cleanup); every
// pattern here is a shipped default, not project-configurable, since these
// are provider-shaped literals and framework-generic middleware names
// rather than a project-specific idiom.
function scanSecurityHardening(rootDir) {
  // A single unfiltered discovery call serves both the per-file source scans
  // below and privacy-policy-mismatch's own file-list need (the policy
  // document itself is rarely a .js/.ts file, so it needs the unfiltered
  // list) — avoids a second `git ls-files` subprocess per sweep, and means
  // a discovery failure here has exactly one place to propagate rather than
  // two (the privacy-policy pass used to swallow its own, separate
  // discovery call's failure silently — IL-110 forbids implying coverage
  // that didn't happen).
  const allTracked = listTrackedFiles(rootDir);
  if (allTracked.discoveryFailed) {
    return {
      candidates: [],
      scannedFiles: 0,
      skippedFiles: [],
      discoveryFailed: true,
      discoveryReason: allTracked.reason,
    };
  }
  const sourceFiles = allTracked.files.filter((f) => JS_TS_SOURCE_FILE_RE.test(f));

  const skippedFiles = [];
  const candidates = [];
  const sourceTextByFile = new Map();
  for (const rel of sourceFiles) {
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
    sourceTextByFile.set(rel, text);
    scanClientSecrets(rel, text, candidates);
    scanMissingOwnership(rel, text, candidates);
    scanUnguardedAiEndpoint(rel, text, candidates);
    scanJwtValidation(rel, text, candidates);
    scanSecretsLifecycle(rel, text, candidates);
    scanSharedAgentIdentity(rel, text, candidates);
    scanUnauditedDelegation(rel, text, candidates);
    scanUnescapedOutput(rel, text, candidates);
    scanUnrestrictedUpload(rel, text, candidates);
    scanUnverifiedWebhook(rel, text, candidates);
  }

  // Reuses the source-file content the loop above already read — see
  // scanPrivacyPolicyMismatch's `cachedText` param.
  scanPrivacyPolicyMismatch(allTracked.files, rootDir, candidates, sourceTextByFile);

  candidates.sort((a, b) => (a.file === b.file ? a.evidence.localeCompare(b.evidence) : a.file.localeCompare(b.file)));

  return {
    candidates,
    scannedFiles: sourceFiles.length,
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
  scanJwtValidation,
  scanSecretsLifecycle,
  scanPrivacyPolicyMismatch,
  scanSharedAgentIdentity,
  scanUnauditedDelegation,
  scanUnescapedOutput,
  scanUnrestrictedUpload,
  scanUnverifiedWebhook,
  SECRET_PATTERNS,
  CLIENT_DIR_RE,
  SERVER_DIR_RE,
  ROUTE_DIR_RE,
  SAFE_PREFIX_RE,
  THIRD_PARTY_SERVICES,
  CREDENTIAL_NAME_RE,
  AGENT_CALLEE_RE,
  DELEGATION_AUDIT_SIGNAL_RE,
  WEBHOOK_FILE_RE,
};
