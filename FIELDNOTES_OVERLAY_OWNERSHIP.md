# Fieldnotes overlay ownership

`resolveFieldnotesMapPresentation` is the single derived owner for map chrome, Activity, pointer access, dock, floating actions, and empty feedback.

| Owner | Top chrome | Activity | Activity pointer | Map/Saved dock | Floating actions | Empty feedback |
| --- | --- | --- | --- | --- | --- | --- |
| Normal map | Yes | Yes | Enabled | Yes | Yes | Yes |
| Compact place | Yes | Yes | Enabled | Yes | No | No |
| Expanded place | No | No | Disabled | No | No | No |
| Search | No | No | Disabled | No | No | No |
| Nearby Explorer | No | No | Disabled | No | No | No |
| Saved library | No | No on map; Saved owns its Activity entry | Disabled on map | Yes | No | No |
| Source group | No | No | Disabled | No | No | No |
| Onboarding map | Yes | No | Disabled | No | No | Yes |

Expanded detail therefore cannot render or intercept through the underlying Activity target. Closing restores compact ownership once; dismissing the place restores normal ownership once. More remains inside the detail owner. Search, Nearby Explorer, source groups, and onboarding cannot leak map controls into their surfaces.

The focused test deliberately models the founder collision as two equal 44×44 rectangles at `(320,54)` and confirms they intersect when both exist. The repaired expanded state returns `showActivity=false` and `activityPointerEvents='none'`, removing the underlying rectangle instead of moving it.

Quick Check completion still uses its existing saved-place navigation contract. No router architecture was replaced.
