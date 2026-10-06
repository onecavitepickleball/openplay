# Matchday standalone hosting

Production: https://matchday-tournaments-abk.pages.dev/tournament/

Build with `node matchday/build.mjs`, then deploy with:

`cd dist/matchday && npx wrangler@4 pages deploy . --project-name matchday-tournaments --branch main --no-bundle`

Deploy from the built directory. This repository also contains the OCPC
Firebase Functions directory; deploying from the repository root can make
Wrangler try to bundle those unrelated functions.

This is an independent Cloudflare Pages artifact; it excludes the OCPC site,
club administration, backend credentials, tests and local data. Source currently
remains in this repository. Firebase Auth and Firestore remain on
`ocpc-website-faf5e`: existing accounts, event IDs, permissions, photos, public-link
tokens and data are not copied or reset. Club membership and organizer access
remain distinct, as before.

Add the Pages hostname to Firebase Authentication's authorized domains. Accounts
sign in once on the new origin using their existing credentials. Browser-local
offline edits/session caches cannot transfer between origins: reconnect and finish
syncing the old page before moving. Never clear storage containing unsynced work.

Legacy OCPC tournament routes redirect to the same path/query/hash on Pages, keeping
printed QR codes usable. The migration script prompts users before leaving an open
operational page. It never transfers passwords or authentication tokens in URLs.

## Release and verification

- Run engine, format-setup and browser regression tests before deploying.
- The builder strips Jekyll front matter and stamps module imports with a content hash.
- HTML/build metadata revalidate. The scoped worker caches the tournament shell only.
- Updates show a reload notice, never force a reload during a match.
- Deploy the standalone app before publishing legacy redirects on the OCPC site.
- To revert the cutover, remove the script references to `migration.js`; Firebase
  event data is shared, so this needs no data migration.

## Birthday setup

Choose **Create new tournament → Use birthday preset**, enter date/name/venue and
organizer, and review the configuration before creating. It prepares 12 expected
pairs, four pools, one qualifier per pool, semifinals, gold and bronze, 2 courts,
8–10 PM, timed rally games (8 min; medals 10 min), 2-min turnover. This is 16 games;
about 82 minutes of court slots before extra rest, briefing, delays or tie rallies.
Expected pairs are planning counts, not fake registrations. Register actual pairs
and review the draw before play. Do not change pool/qualifier settings after results.
Internet latency still exists; keep backups and allow recovery time.
