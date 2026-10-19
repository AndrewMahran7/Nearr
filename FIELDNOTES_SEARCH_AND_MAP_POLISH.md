# Fieldnotes search and map polish

Manual discovery keeps the selected row and input visible while persistence runs. The row shows a spinner with `Saving…`, uses a synchronous duplicate-submission lock, and waits for the save result. A real rejection or null/false save result leaves the search intact and replaces the status with `Try again`. Successful persistence records `persistence_ms`; no comparable physical network sample was available in this run.

Saved-result rows now load exact local snapshots keyed by user ID, saved-place ID, and Google place ID. Candidate files are validated before display. The path uses `hydrationPolicy="saved_snapshot"`, which does not perform a Google lookup. An exact source thumbnail remains a truthful fallback; otherwise the existing placeholder is retained.

A newly persisted place now receives a `new_save` camera transaction. A single coordinate is fitted into the measured unobstructed viewport at a maximum zoom of 15, then normal selected-marker occlusion correction runs under the same camera coordinator. User gestures still cancel owned programmatic motion. Show All retains multi-coordinate, international, polar, identical-coordinate, and antimeridian behavior.

The 390×844 regression sample reserves top and bottom overlays and produces a local region with latitude delta below 0.1 and at least 86 points of left/right marker padding. This is geometry evidence, not a native framebuffer measurement.
