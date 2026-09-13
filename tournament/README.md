# Matchday multi-tournament architecture

`/tournament/` is the authenticated tournament library. Each event opens at
`/tournament/control.html?event={eventId}` and every field app keeps the same
`event` query parameter.

## Firestore tenancy

- `tournamentEvents/{eventId}`: configuration, branding, owner/member indexes,
  and the shared Match Control state.
- `tournamentEvents/{eventId}/members/{uid}`: event-specific roles.
- `tournamentEvents/{eventId}/matches/{matchId}`: referee/live score records.
- `tournamentEvents/{eventId}/registrations/{registrationId}`: private player
  registration records.
- `tournamentEvents/{eventId}/checkins/{playerId}`: event photos and waiver
  confirmations.
- `tournamentRefereeBoards/{eventId}`: referee-safe synchronized court state.
- `tournamentAccess/{uid}/events/{eventId}`: the signed-in user's tournament
  library index.
- `tournamentAccountDirectory/{email}`: exact-email staff lookup. Collection
  listing is denied by Firestore Rules; users publish only their own Firebase
  Auth email when they enter the portal.

The current OCPC x Rally Rebels event keeps its existing ID:
`ocpc-rally-rebels-dual-meet-2026`. Opening the portal as an OCPC site admin
adds the event library/membership indexes without replacing its state.

## Access model

OCPC Firebase Authentication remains the identity provider. Site admins grant
the global `tournament_organizer` role from the OCPC admin member panel. An
approved organizer can create events. Owners and Full Match Control can assign
event roles; Match Control cannot change staff access or reset the event.

On the free Firebase Spark plan, a staff member must sign in at `/tournament/`
once before their email can be assigned to an event. This creates only their
minimal exact-email directory entry and avoids exposing the OCPC player list.

## Deployment

The updated `firestore.rules` must be deployed before the portal code goes
live:

```sh
npx --yes firebase-tools@latest deploy --only firestore:rules --project ocpc-website-faf5e
```

No Cloud Function or Firebase billing-plan upgrade is required.
