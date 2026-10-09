# Nearr 1.6 app icon build verification

Status: source and installed Expo generator verified; final Development IPA and installed iPhone appearance pending.

## Selected source

Winner C, Light Fieldnotes, is the canonical `assets/icon.png`. It is byte-identical to the selected study master. The actual implementation source was opened and visually inspected.

| Check | Result |
| --- | --- |
| Source dimensions | 1024 × 1024 |
| Format | PNG, sRGB, RGB, three channels, no alpha |
| Canvas | Opaque warm ivory, full square; no baked rounded mask |
| Source SHA-256 | `ac3ed31cf494843c72c5049e480e77f2af2fc74dcc8b9a85ce636aba0cc2db2a` |
| `expo.icon` | `./assets/icon.png` |
| `expo.ios.icon` | `./assets/icon.png` |
| Dynamic config | Preserves both source paths |
| Resolved configuration inspected | Nearr 1.6.59; `com.nearr.ios`; Development app/backend; automatic appearance |
| Embedded receipt | `ShareExtension.tsx` loads the same canonical icon through a static require |

The full four-candidate and size/context review is in [APP_ICON_STUDY.md](artifacts/fieldnotes-implementation/icon-study/APP_ICON_STUDY.md). Those wallpaper, Settings and store boards are design simulations, not native iOS captures.

## Installed native generator

The implementation uses Expo 51.0.39, `@expo/prebuild-config` 7.0.9 and `@expo/config-types` 51.0.3. The installed SDK51 icon generator was run against the actual resolved source, writing only to the evidence directory. It generated a universal 1024 icon and asset catalog manifest.

- [Reproduction script](artifacts/fieldnotes-implementation/icon-build-proof/verify-source.cjs)
- [Machine-readable source/generator proof](artifacts/fieldnotes-implementation/icon-build-proof/source-generator-proof.json)
- [Generated AppIcon catalog](artifacts/fieldnotes-implementation/icon-build-proof/generated/ios/Nearr/Images.xcassets/AppIcon.appiconset/Contents.json)
- [Generated PNG](artifacts/fieldnotes-implementation/icon-build-proof/generated/ios/Nearr/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png)

Generated dimensions are 1024 × 1024 with no alpha. The decoded RGB pixels are **identical** to the canonical source. Expo re-encodes the PNG, so file bytes differ: generated SHA-256 `88f9be93097adc681d146e34812662ea5a25af65a17d5931834ea48f95ac25a0`. Both decoded RGB buffers hash to `51b4074c121482b01e35c8494c85a1a5723b388b0a6ce212a0fe291e4fe3059d`.

This uses SDK51's supported string icon path. No modern `ios.icon.light/dark/tinted` object, Icon Composer `.icon` file, alternate-icon registration or unsupported SDK upgrade was added. The ordinary icon serves both appearances.

## Final Development binary

Pending the root build's final IPA. The final inspection must record its build ID, Git SHA, version/build number and archive hash; read the host and extension Info.plist; enumerate compiled app icon resources; decode those resources and compare their pixels with the canonical source at each compiled size. PNG file hashes alone cannot establish a mismatch because native tools may re-encode or optimize them.

An asset catalog generated in an evidence directory is not proof that an IPA includes it. An IPA comparison is not proof of the installed iPhone home-screen presentation. Neither of those stronger claims is made at this stage. The founder device check must verify the icon after installing the new native build; an OTA does not replace it.
