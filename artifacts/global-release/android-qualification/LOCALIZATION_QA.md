# Localization qualification

Supported locales tested: en-US, es-MX, es-ES, pt-BR, fr, de, it, ja, ko, zh-Hans.

`locale-onboarding-runtime.json` records all ten offline Language/Birthday selections, disabled blank CTA and cold-relaunch persistence. `locale-app-runtime.json` records all ten native Settings, cold launch/map, disabled Plus, Saved, Place Detail, Activity and search passes. Matching `locale-*.png` files retain actual UI captures. German wrapping and CJK glyphs were inspected; this is not native-speaker certification.

Fixed bypasses: Saved category labels now use existing translated catalog keys; Saved dates use the selected app locale rather than device locale; detail/nearby categories and search/navigation controls use the translation engine. Original venue names are preserved. Real Saved component tests render category/date data in every locale. The onboarding Continue accessibility label now changes from Saving to the correct localized action rather than retaining busy text.

Catalog/native resource parity and the complete original localization entrypoints passed. No speculative legacy key deletion or translation catalog expansion was performed.

Coverage distinction: every locale has the native screens above, plus 30 real Plus component renders across three availability states. Error/eligibility/practice language parity is automated; the entire interactive error/underage/practice journey was not repeated manually ten times. Dynamic provider content and some pre-existing accessibility phrases remain original English; no claim of universal string translation.
