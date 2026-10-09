# Fieldnotes visual deviations

Fieldnotes Light is the primary implementation. Dark mode shares the same hierarchy with botanical surfaces, restrained peach/rust accents and light text. The implementation preserves the reference's purpose while using existing native components, real data and truthful missing-image states.

| Difference from the ideal reference | Reason and treatment |
| --- | --- |
| Android Google map rather than the reference's illustrated travel map | This is the real native map. It uses a quiet light style and botanical dark style. iOS keeps Apple Maps; Android captures cannot validate its exact cartography. |
| Fewer photo markers and real clustered counts | Photo slots are capped at three at local zoom, selected first; remaining markers use the saved glyph or native cluster count. Available local image snapshots are used without bulk hydration. |
| Missing destination photos in real Saved records | No stock image is substituted. The featured no-photo entry is compact; detail and review retain explicit unavailable-image states. The two-photo detail example uses clearly documented bundled onboarding images. |
| Variable length names, addresses and notes | Typography wraps and secondary content scrolls. The Development sample includes a 47-character business name. Curated reference copy is not imposed on user records. |
| Multi-place ambiguity requires more density | The existing five-place fixture has explicit alternatives and mixed selections. Removing these would lose review/recovery behavior. The sticky Save footer remains clear. |
| Account and Activity access differ in signed-out QA | The existing auth/access guards are preserved. Read-only QA adapters mount actual route/components; they do not fabricate a signed-in session. |
| Screenshot chrome and device ratio | Evidence uses an Android Pixel 8a emulator plus documented viewport/font overrides. Android system keyboard/navigation bars are genuine. Reference mockups have different device geometry. |
| Save-state motion and haptics cannot be proved by a still image | Reduce Motion logic and durable-success haptic call sites were checked in code/tests. Actual iPhone haptic feel, VoiceOver announcements and background behavior remain device checks. |
| Save arrival preserves camera ownership | A real durable save gets local arrival feedback and does not move the map camera. The complete source-to-map choreography belongs to the explicitly scripted onboarding experience. |
| Search has explicit local and discovery modes | This preserves offline usefulness and the existing provider cost gates; a local saved-place query does not silently initiate discovery requests. |
| Native extension appearance follows the OS | The host app's forced Light/Dark preference is not shared into the extension. Its light/dark native surfaces follow system appearance. |
| Standard native icon resource | The SDK 51 configuration supports the normal icon resource. Separate iOS dark/tinted icon resource objects are not introduced. |
| Welcome and practice are different onboarding stages | The welcome comparison identifies this stage difference. A separately labeled actual practice-component image shows the source/place payoff rather than presenting the welcome frame as that payoff. |
| Secondary copy at 2× text size | Primary actions remain visible in the reviewed Android frames. Some secondary map summary and Review alternative subtitles use ellipses, and the Saved search placeholder clips. This remains a documented accessibility-polish item; it is not proof of unrestricted text expansion or an iOS Dynamic Type pass. |
| Small-screen welcome illustration | The decorative source card partly overlaps the illustrative place-name start. The main title and actions remain usable. Copy below the welcome fold scrolls rather than being forced into a 375×667 viewport. |

The native pass fixed avoidable visual differences: the Saved peek no longer extends under the navigation dock, the light native map is no longer visually noisy, missing-photo Saved entries no longer consume a giant empty hero, and the welcome screen no longer repeats its brand block. Remaining data and platform differences are intentional and documented rather than hidden by fabricated content.
