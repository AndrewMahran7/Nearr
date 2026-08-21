# Map Clustering — Phone QA

Branch: `feat/map-clustering`. Presentation only — no backend, no deployment.

Clustering is gated on the map pin redesign flag (`EXPO_PUBLIC_MAP_PIN_REDESIGN_ENABLED`).
With the flag off the map is byte-for-byte the one that shipped.

## What to check

1. **Sparse area** — open a region with a handful of saves. Pins look exactly as before: no clusters, no size change.
2. **Dense area** — pan to OC / LA. Overlapping pins collapse into cream discs with a glyph and a number.
3. **Counts** — zoom in one step on a cluster; the children that appear should add up to the number that was on it.
4. **Dominant icon** — a cluster that is mostly restaurants/cafés/bars shows the fork-and-knife glyph.
5. **Mixed cluster** — find a genuinely mixed area (food + outdoors + shopping, none over half). It shows the neutral multi-marker glyph, still with its count.
6. **Cluster tap** — one smooth zoom that reveals the children. Repeat until individual pins appear. No jump-to-nowhere, no bottom sheet.
7. **Selected place** — select a place in a dense area, then zoom out. Its pin stays individual and labelled; clusters form around it, never over it.
8. **Filters** — toggle a category chip. Cluster counts and glyphs recompute to that category only. Return to All and the previous counts come back.
9. **Pan / zoom hard** — no flashing, no markers re-appearing, no lag. Small pans across a zoom boundary must not flip the clustering back and forth.
10. **Camera stability** — open a place, close it. The camera does not move. Reclustering never moves the camera; only a cluster tap does.
11. **Queue / notification entry** — open a saved place from the queue and a group from a notification. The target place(s) stay individually visible.
12. **Airplane mode** — clusters still form, count, and expand. Nothing about a cluster requires the network.

## Watch for

- A cluster that never splits no matter how many times you tap it (should be impossible — expansion is capped at the zoom where clustering stops, past which co-located saves are ordinary overlapping pins).
- A selected place disappearing into a count.
- Cluster counts that disagree with the pins revealed by zooming in.
- Any photo appearing inside a cluster disc (clusters never load photos).
