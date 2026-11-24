// plugin/bin/lib/walkthrough/exposure.js — the one place the recording's embed/link
// decision is made (#4612). The packet never embeds a recording or a screenshot, in any
// repository visibility; this decides whether a remote link may be shown at all.
//
// Pure: the gh runner is injected, and nothing here spawns or reads a file.
'use strict';

const { EXPOSURE } = require('../wrap-up/packet-contract');
const { checkLink, isCredentialRefusal, isImageUrl } = require('../wrap-up/packet-links');

const VISIBILITY_ARGS = ['repo', 'view', '--json', 'isPrivate'];

// Only an explicit `isPrivate: true` is private. An unreadable, malformed or unexpected
// answer counts as public, so a failed lookup can never widen what a store may hold.
function readRepoVisibility(gh) {
  try {
    const answer = JSON.parse(gh(VISIBILITY_ARGS));
    return answer?.isPrivate === true ? 'private' : 'public';
  } catch {
    return 'public';
  }
}

// The url's own hostname is the allowed one: a store may live on any host, and checkLink
// is used here for its credential screen. Null when the url does not parse.
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// In order: an unprobed store, or one whose anonymous fetch was not refused, stays
// local. A landing page the credential rule refuses is withheld; one refused any other
// way stays local. An image url is not a landing page. A secret gist is never enough,
// and an Actions artifact only counts in a repository that reads as exactly `private`.
function decideExposure({ repoVisibility, storeProbe } = {}) {
  if (!storeProbe || storeProbe.anonymousFetch !== 'refused') return EXPOSURE.LOCAL_ONLY;
  const { url, store } = storeProbe;
  const hostname = hostnameOf(url);
  if (hostname === null) return EXPOSURE.LOCAL_ONLY;
  const link = checkLink(url, { allowedHosts: [hostname] });
  if (!link.ok) return isCredentialRefusal(link.reason) ? EXPOSURE.WITHHELD : EXPOSURE.LOCAL_ONLY;
  if (isImageUrl(url)) return EXPOSURE.LOCAL_ONLY;
  if (store === 'secret-gist') return EXPOSURE.LOCAL_ONLY;
  if (store === 'actions-artifact' && repoVisibility !== 'private') return EXPOSURE.LOCAL_ONLY;
  return EXPOSURE.LINKED_PRIVATE;
}

module.exports = { decideExposure, readRepoVisibility };
