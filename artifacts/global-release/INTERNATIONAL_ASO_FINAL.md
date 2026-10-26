# International App Store package

Status: **ten updated metadata candidates prepared; no upload, approval, submission or public release performed by this workstream.** “Final” names the consolidated handoff, not an approved listing.

Reused the October 15 corrected package at `../nearr-1.5-privacy-corrected/artifacts/app-store-international/localized-copy-final-candidate.json` and the original English research in `../nearr-1.5-app-store-international/artifacts/app-store-international/research-global/metadata.json`. Prior worktrees remain unchanged. Brand, titles, subtitles, relevant keyword themes and screenshot headlines were retained where accurate. Descriptions and What's New were rewritten for the unified Fieldnotes product, actual interface language selection, preserved original content, 13+ with regional restrictions, separate recognition/purchase qualification and optional disclosed Plus allowances.

Prepared files:

- [Ten locale metadata candidates](aso/unified-metadata-candidates.json): en-US, es-MX, es-ES, pt-BR, fr-FR, de-DE, it, ja, ko, zh-Hans.
- [Metadata validation](aso/metadata-validation.json): every title/subtitle within 30 characters, keywords within a conservative 100 UTF-8 bytes, description and What's New within 4,000 characters.
- [New product-copy drafts](aso/unified-copy-drafts.json): model drafts requiring independent language/product review.
- [Preserved screenshot audit](aso/preserved-screenshot-audit.json): all 126 prior assets verified by SHA-256 and PNG dimensions, excluded from this release.

App Store locale codes and runtime language tags are different where appropriate: fr-FR → fr, de-DE → de, it → it, ja → ja and ko → ko. Locale-specific metadata is not a separate independently controlled listing for every country. Storefront availability must follow the legally qualified regional release policy, and App Store primary-language fallback must be checked against the final native binary and account configuration. No separate pt-PT/fr-CA/zh-Hant/Arabic/Hindi/Indonesian/Turkish launch package is activated here.

Apple documents the 30-character name limit and localizable subtitle in [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/), subtitle/keyword guidance in [Creating your product page](https://developer.apple.com/app-store/product-page/), and truthful feature/metadata requirements in [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/). Research observations in the prior package are search-API results, not current device rankings, search volume, traffic or paid conversion. No such performance claims were added.

The drafts deliberately do not promise universal minor recognition, unrestricted international availability, unlimited finds, a fixed cross-currency price, guaranteed recognition accuracy or approved translations. Paid wording is conditional because the actual Apple product, entitlement and sandbox release gates remain separate. Recheck the exact free/Plus offer against the qualified build before uploading; suppress optional Plus marketing if the experiment remains disabled.

Upload prerequisites: native language review; accurate signed Fieldnotes captures; current legal text and App Privacy; final eligible regions/age rating; verified IAP product and Store pricing; final binary identity; authenticated App Store Connect readback; and manual release selected. Existing App Store draft history is in the root submission handoff. Do not copy the older 1.5 English-only screenshots into this new product page.
