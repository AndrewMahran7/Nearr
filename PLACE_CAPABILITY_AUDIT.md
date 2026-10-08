# Place capability audit

Date: 2026-10-08
Scope: Nearr Development only

## Contract

`lib/placeCapabilities.ts` is the single client authority for deciding whether a place is server-addressable. Identity shape is not inferred separately by each screen.

| Place kind | Durable identity | Read locally | Directions | Open original | Native share | Reminder/edit/visited/wrong/delete | Transfer/sync |
|---|---|---:|---:|---:|---:|---:|---:|
| `server_saved_place` | Real saved-place UUID | Yes | Yes | If source URL exists | Public-place share | Yes | Yes |
| `tutorial_local_place` | Tutorial/fixture ID, never a DB key | Yes | Yes | If fixture provenance exists | Plain native share | No | No |
| `unsaved_candidate` | Candidate identity only | Yes | If coordinates exist | If source URL exists | Plain native share | No | No |

The local tutorial fixtures are detected centrally from their fixture IDs and tutorial source markers. A UUID-shaped cached place remains server-addressable; a synthetic tutorial ID never does. Manual search candidates remain unsaved candidates until a real save returns a UUID.

## Mad Yolks action matrix

| Action | Result |
|---|---|
| Open card/detail | Local fixture details and bundled photos render synchronously |
| Directions | Opens coordinates using the device map provider |
| Watch original | Opens the fixture's real HTTPS provenance URL |
| Share | Uses a local native share payload; it does not create a public server share |
| Reminder | Hidden because there is no durable server row |
| Edit | Hidden |
| Mark visited | Hidden |
| Wrong place | Hidden |
| Remove | Hidden |
| Transfer/sync | Excluded from server payloads |

This removes the prior broken affordance pattern: tutorial-only actions are not presented and therefore cannot fail with raw UUID/RPC errors.

## Defense in depth

- `lib/savedPlaceIdentity.ts` throws `SavedPlaceCapabilityError` with code `local_saved_place_not_server_addressable` and friendly copy when a server-only operation receives a local ID.
- `lib/publicPlace.ts` validates the saved-place UUID before creating a public share.
- `services/savedPlaceSourcesService.ts` skips source-enrichment RPCs for local IDs.
- Existing saved-place and share-job mutations continue to require real saved-place UUIDs.
- Transfer/sync projects only real UUID-backed places.
- `SelectedPlaceDetails` derives all action visibility from the capability object and does not mount the Wrong Place flow for tutorial content.

No Supabase schema change or data migration is required. Tutorial content remains intentionally device-local.

## Regression proof

`npm run test:place-capabilities` checks real saved places, tutorial fixtures, and unsaved candidates; it also asserts that the typed boundary error contains no raw database wording. `npm run test:oct8-founder-journey` exercises the Mad Yolks founder path.
