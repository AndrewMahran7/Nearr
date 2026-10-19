# Fieldnotes native visual QA

## Available environment

- Host: Windows, America/Los_Angeles
- iOS simulator: unavailable on this host
- Physical iPhone control: unavailable
- Android tools: `ANDROID_HOME` is declared, but `adb.exe` and `emulator.exe` are absent
- Founder recording: unavailable
- Native screenshots captured: none

No simulated mockup is labeled as a runtime capture, and Android is not claimed as proof of iOS UISwitch geometry.

## Instrumented/source evidence

| Pair | Evidence | Result |
| --- | --- | --- |
| Activity / More | Collision model uses two `(320,54,44,44)` rectangles; expanded owner removes Activity and pointer events. | Source/pure pass |
| Switch / slot | Slot `(0,0,67,48)`, nominal control `(8,8.5,51,31)`, 8-point trailing clearance; native development log added. | Source/pure pass; native pending |
| Filters / empty card | Top derives from measured top-chrome and Activity bottoms plus spacing. | Source pass; native rect pending |
| New pin / viewport | Camera uses measured unobstructed viewport and 86-point representative side padding. | Pure camera pass; native projection pending |
| Floating controls / dock | One owner controls render and pointer access. | Ownership matrix pass |
| Search / keyboard | Existing keyboard-resize and search runtime matrices remain green. | Component/state pass |

## Physical acceptance still required

Run the ten-minute checklist in `FIELDNOTES_PHYSICAL_QA_HANDOFF.md` on the 1.6.59 Development build. Capture Light/Dark screenshots of the expanded header and switch, an accessibility-text pass, a rapid Activity/More dismissal video, the new-save map, and the Search/Saved/Detail image sequence.
