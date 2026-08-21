# VAYRIN-CREATOR-IDENTITY-FALSE-AUTOSAVE

Status: open follow-up; intentionally out of scope for the media-dispatch repair.

## Observed development case

- Nearr-Dev share job: `1d2bf626-fb17-43f9-ab2e-88fee84a72ad`
- Sanitized source: Instagram reel `DMyGscmvfIJ`
- Incorrect auto-save: `Oliver's - Olive Oil & Balsamic Tasting Gallery`
- Suspected contaminant: the creator handle/display identity resembled the saved place name.

## Required invariant

```text
creator handle/display name alone
cannot be treated as place identity
and cannot cause auto-save
```

## Follow-up scope

Trace creator identity separately from post-authored place evidence through handle extraction,
candidate scoring, and the metadata auto-save gate. Add a regression fixture from the persisted
safe diagnostics before changing ranking or auto-save policy. Do not infer the correct place from
this incident alone.

