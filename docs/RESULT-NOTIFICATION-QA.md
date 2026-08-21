# RESULT-NOTIFICATION-QA — Result-Aware Share Completion Notifications

## Scope

Validate result-aware lock-screen copy on an integrated development build. This ticket does not redesign notification navigation. A tap must continue to use the existing saved-place, saved-group, or share-job detail destination.

For every scenario below, verify:

- the title and body match the expected result class;
- tapping opens the existing expected destination;
- only one completion notification is delivered for the job;
- the wording does not claim more certainty than the result supports;
- lock-screen copy contains no caption, transcript, note, account name, coordinates, confidence percentage, or internal provider/model terminology.

## Scenario matrix

| Scenario | Expected title | Expected body | Existing tap destination |
| --- | --- | --- | --- |
| Strong exact result, newly saved | `Found it` | `<Place> is saved to your map.` | Saved-place detail |
| Strong exact result, already saved | `Already saved` | `<Place> is already in Nearr.` | Existing saved-place detail |
| One uncertain candidate | `We think this might be <Place>` | `Take a look and see if it matches.` | Share-job review |
| Exactly two candidates | `We found 2 possible spots` | `Which one looks right?` | Share-job picker |
| Three to five candidates | `We found N possible spots` | `Take a look and choose the best match.` | Share-job picker |
| More than five candidates | `We found several possible spots` | `Take a look and choose the best match.` | Share-job picker |
| Strong coarse city/region | `We narrowed it down` | `We think this is near <Locality>, but couldn’t pin down the exact spot.` | Share-job review/manual search |
| Observable named non-Places lead | `We found a possible lead: <Name>` | `Take a look and see if it fits.` | Share-job review/manual search |
| Multi-place complete | `We found all N places` | `They’re ready on your map.` | Saved-place group |
| Multi-place partial | `We found X of N places` | Possible-match wording when unresolved groups have candidates; otherwise `Take a look at what we found.` | Share-job multi-place review |
| Weak clues, no exact result | `We found a few clues` | `They weren’t enough to pin down the exact spot.` | Share-job review/manual search |
| Zero evidence | `We couldn’t pin this one down` | `Open Nearr to search manually.` | Share-job manual search |
| Technical failure | `Something went wrong` | `We couldn’t finish checking this post. Open Nearr to try again.` | Failed share-job detail/retry |

## Evidence-specific checks

1. Replay a model-prior-only locality. Confirm the locality name does not appear in the notification.
2. Replay a weak, uncorroborated city/region field. Confirm it does not appear as factual locality copy.
3. Replay a provider-classified geographic source tag or corroborated observable media locality. Confirm the bounded locality may appear.
4. Replay one scene with several identity candidates. Confirm candidate-count copy appears, not multi-place copy.
5. Replay several logical mention slots. Confirm complete/partial place counts use the logical slot total, not the aggregate candidate count.

## Deferred physical routing note

Physical cold-start, warm-start, and action-button tap routing can be signed off with the Notification-Tap Navigation Cleanup lane’s integrated build. This branch must only demonstrate that the unchanged payload opens the same destination and that copy changes do not introduce duplicate delivery.
