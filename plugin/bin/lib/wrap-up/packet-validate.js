// bin/lib/wrap-up/packet-validate.js — which narrated claims the acceptance packet
// may carry (#4611): every claim must cite facts the gather produced, of a kind its
// section allows, and a claim asserting verification goes where its evidence says.
//
// Pure: no git, gh or fs.
'use strict';

const {
  SCHEMA_VERSION,
  FACT_KINDS,
  FACT_STATUSES,
  CLAIM_SECTIONS,
  SECTION_KINDS,
  FACT_ID_RE,
  VERIFICATION_CLAIM_RE,
} = require('./packet-contract');
const { findCredentialInText } = require('./packet-links');

const ROUTED_KINDS = Object.freeze(['check', 'story']);
const OPTIONAL_TEXT_FIELDS = Object.freeze(['reason', 'text', 'url', 'command', 'label']);
const isObject = (value) => value !== null && typeof value === 'object';

class SchemaError extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    this.name = 'SchemaError';
    this.errors = errors;
  }
}

const shapeResult = (errors) => ({ ok: errors.length === 0, errors });

function checkSchemaVersion(doc, root, errors) {
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    errors.push({ path: `${root}.schemaVersion`, message: `must be the number ${SCHEMA_VERSION}` });
  }
}

function checkFact(fact, at, seenIds, errors) {
  if (!isObject(fact)) {
    errors.push({ path: at, message: 'not an object' });
    return;
  }
  if (typeof fact.id !== 'string' || !FACT_ID_RE.test(fact.id) || !fact.id.startsWith(`${fact.kind}:`)) {
    errors.push({ path: `${at}.id`, message: 'must be {kind}:{key} with the fact\'s own kind and an encoded key' });
  } else if (seenIds.has(fact.id)) {
    errors.push({ path: `${at}.id`, message: 'repeats an earlier fact id' });
  }
  seenIds.add(fact.id);
  if (!FACT_KINDS.includes(fact.kind)) {
    errors.push({ path: `${at}.kind`, message: `must be one of ${FACT_KINDS.join('|')}` });
  }
  if (!FACT_STATUSES.includes(fact.status)) {
    errors.push({ path: `${at}.status`, message: `must be one of ${FACT_STATUSES.join('|')}` });
  }
  if (typeof fact.source !== 'string') {
    errors.push({ path: `${at}.source`, message: 'must be a string' });
  }
  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (fact[field] !== undefined && typeof fact[field] !== 'string') {
      errors.push({ path: `${at}.${field}`, message: 'must be a string when present' });
    }
  }
}

function checkStringArray(value, at, errors) {
  if (!Array.isArray(value)) {
    errors.push({ path: at, message: 'must be an array of strings' });
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') errors.push({ path: `${at}[${index}]`, message: 'must be a string' });
  });
}

// Optional: an absent list means no refusals. Anything else must be well formed, or
// a malformed entry would read as no refusal, or throw a TypeError at render.
function checkRefused(refused, errors) {
  if (refused === undefined) return;
  if (!Array.isArray(refused)) {
    errors.push({ path: 'facts.refused', message: 'must be an array' });
    return;
  }
  refused.forEach((entry, index) => {
    const at = `facts.refused[${index}]`;
    if (!isObject(entry)) {
      errors.push({ path: at, message: 'not an object' });
      return;
    }
    for (const field of ['id', 'reason']) {
      if (typeof entry[field] !== 'string') errors.push({ path: `${at}.${field}`, message: 'must be a string' });
    }
  });
}

function validateFactsShape(facts) {
  if (!isObject(facts)) return shapeResult([{ path: 'facts', message: 'not an object' }]);
  const errors = [];
  checkSchemaVersion(facts, 'facts', errors);
  if (Array.isArray(facts.facts)) {
    const seenIds = new Set();
    facts.facts.forEach((fact, index) => checkFact(fact, `facts.facts[${index}]`, seenIds, errors));
  } else {
    errors.push({ path: 'facts.facts', message: 'must be an array' });
  }
  checkStringArray(facts.partial, 'facts.partial', errors);
  checkRefused(facts.refused, errors);
  if (!Number.isInteger(facts.record)) errors.push({ path: 'facts.record', message: 'must be an integer' });
  return shapeResult(errors);
}

function checkClaim(claim, at, errors) {
  if (!isObject(claim)) {
    errors.push({ path: at, message: 'not an object' });
    return;
  }
  if (typeof claim.section !== 'string') errors.push({ path: `${at}.section`, message: 'must be a string' });
  if (typeof claim.text !== 'string' || claim.text.trim() === '') {
    errors.push({ path: `${at}.text`, message: 'must be a non-empty string' });
  }
  checkStringArray(claim.refs, `${at}.refs`, errors);
}

function validateNarrativeShape(narrative) {
  if (!isObject(narrative)) return shapeResult([{ path: 'narrative', message: 'not an object' }]);
  const errors = [];
  checkSchemaVersion(narrative, 'narrative', errors);
  if (Array.isArray(narrative.claims)) {
    narrative.claims.forEach((claim, index) => checkClaim(claim, `narrative.claims[${index}]`, errors));
  } else {
    errors.push({ path: 'narrative.claims', message: 'must be an array' });
  }
  return shapeResult(errors);
}

const isFailed = (fact) => fact.status === 'failed';
const isUntested = (fact) => fact.status === 'skipped' || fact.status === 'not-run';

// Places one claim in exactly one of `result`'s buckets. The order is the contract:
// each rule assumes the ones above it passed.
function placeClaim(claim, factsById, result) {
  const { section, text, refs } = claim;
  const drop = (reason) => result.dropped.push({ claim, reason });
  const move = (to, because) => result.moved.push({ claim, to, because });

  if (!CLAIM_SECTIONS.includes(section)) return drop(`unknown section ${section}`);
  const key = findCredentialInText(text);
  if (key) return result.screened.push({ claim, key });
  if (refs.length === 0) return drop('no refs');
  const absent = refs.find((id) => !factsById.has(id));
  if (absent !== undefined) return drop(`absent fact ${absent}`);

  const cited = refs.map((id) => factsById.get(id));
  const incompatible = cited.find((fact) => !SECTION_KINDS[section].includes(fact.kind));
  if (incompatible) return drop(`incompatible fact ${incompatible.id} (${incompatible.kind}) for ${section}`);
  if (section === 'risk-proofs' && !cited.some((fact) => fact.kind === 'flag')) {
    return drop('risk proof cites no flag');
  }
  if (section === 'risk-proofs' && cited.every((fact) => fact.kind === 'flag')) {
    return drop('risk proof cites no proof fact');
  }
  if (section === 'tried-to-break' && !cited.some(isFailed)) {
    const negatives = cited.filter((fact) => fact.negative === true);
    if (negatives.length === 0) return drop('tried-to-break claim cites no negative or failed fact');
    if (negatives.every(isUntested)) return move('couldnt-test', negatives[0]);
  }

  // A risk proof asserts its proof whatever the wording; Decision Q12 limits Q9's
  // plain-wording exemption to Test-guide manual steps.
  if (section === 'risk-proofs' || VERIFICATION_CLAIM_RE.test(text)) {
    const routed = cited.filter((fact) => ROUTED_KINDS.includes(fact.kind));
    const failed = routed.find(isFailed);
    if (failed && section !== 'tried-to-break') return move('tried-to-break', failed);
    const untested = routed.find(isUntested);
    if (!failed && untested) return move('couldnt-test', untested);
  }
  return result.kept.push(claim);
}

function validatePacket(facts, narrative) {
  const errors = [...validateFactsShape(facts).errors, ...validateNarrativeShape(narrative).errors];
  if (errors.length > 0) throw new SchemaError(errors);
  const factsById = new Map(facts.facts.map((fact) => [fact.id, fact]));
  const result = { kept: [], moved: [], dropped: [], screened: [] };
  for (const claim of narrative.claims) placeClaim(claim, factsById, result);
  return result;
}

module.exports = {
  SchemaError,
  validateFactsShape,
  validateNarrativeShape,
  validatePacket,
};
