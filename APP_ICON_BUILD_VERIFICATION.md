# Nearr 1.6 app icon build verification

Status: source, installed Expo generator, and completed Development IPA verified. Physical iPhone appearance remains unobserved.

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

The downloaded Development IPA was inspected directly with `zipfile` and `plistlib`. Only public bundle metadata and icon assets were extracted; no provisioning profiles, device identifiers, signing material or credential URLs are included in this evidence.

| Check | Actual IPA result |
| --- | --- |
| EAS build ID | `74a22771-5998-485b-ac16-f316caf7491d` |
| Native build source commit | `bb2a705ceda39f0938d2a90eca88952828ba614d` |
| Archive size | 32,650,170 bytes |
| Archive SHA-256 | `c8aba16fb9ccaf2b9b61b1a5a2b6dce6bcc2460771704b202fea6b374228c910` |
| Host bundle | `com.nearr.ios`, Nearr, version `1.6.59`, build `59` |
| Embedded Expo runtime | `1.6.59`, updates enabled |
| Host primary icon | `AppIcon`; iPhone `AppIcon60x60`, iPad `AppIcon60x60` / `AppIcon76x76` |
| Appearance | Host and extension `UIUserInterfaceStyle = Automatic` |
| Compiled icon files | `AppIcon60x60@2x.png` (120 px), `AppIcon76x76@2x~ipad.png` (152 px), plus compiled `Assets.car` |
| Share Extension | `PlugIns/NearrShareExtension.appex` exists; `com.nearr.ios.ShareExtension`, version `1.6.59`, extension build `1` |
| Extension registration | `com.apple.share-services`; principal class `NearrShareExtension.ShareExtensionViewController`; text / one web URL activation |
| Embedded extension JavaScript | Own `main.jsbundle` exists, 4,092,398 bytes; SHA-256 `d3427e3c16d9e0407da32ba57e27bcf828e5cd44787acc63f2ba585829ef2009` |
| Extension receipt artwork | `assets/assets/icon.png`, opaque 1024 px, byte-identical and RGB-identical to canonical source |

The build ID and build source commit are the successful EAS build identity supplied by the build owner. Bundle versions, runtime, resource presence, hashes and pixel measurements above were independently read from the downloaded archive. Extension build `1` is the actual plugin-generated value; it is not represented as build `59`.

Both directly emitted compiled app-icon PNGs use Apple's CgBI optimization. The inspection script decodes raw DEFLATE, reverses PNG row filters and converts premultiplied BGRA into ordinary RGBA. The decoded images were opened and visually inspected: both contain the selected botanical pin, orange spark and warm ivory full-square background, with no unexpected padding or earlier black icon. Both have alpha extrema `[255, 255]`, and all four corners are the expected RGB `[247, 244, 238]`.

| Compiled size | Mean absolute RGB channel difference from bicubic source resize (0–255) | Pixels exactly equal | Pixels within 8/channel |
| --- | --- | --- | --- |
| 120 × 120 | 0.852 | 92.89% | 97.42% |
| 152 × 152 | 0.642 | 94.54% | 98.01% |

Native resampling differs from Pillow's bicubic kernel around edges, so these downscaled icon pixels are not asserted to be identical. The complete metrics include nearest, bilinear, bicubic and Lanczos comparisons. The extension's 1024 px receipt asset is an exact match without resampling.

- [Reproducible IPA inspection script](artifacts/fieldnotes-implementation/icon-build-proof/verify-ipa.py)
- [Sanitized machine-readable archive proof](artifacts/fieldnotes-implementation/icon-build-proof/ipa/ipa-verification.json)
- [Compiled icon visual comparison](artifacts/fieldnotes-implementation/icon-build-proof/ipa/compiled-icon-comparison.png)
- [Decoded 120 px compiled icon](artifacts/fieldnotes-implementation/icon-build-proof/ipa/AppIcon60x60@2x-decoded.png)
- [Decoded 152 px compiled icon](artifacts/fieldnotes-implementation/icon-build-proof/ipa/AppIcon76x76@2x~ipad-decoded.png)

`Assets.car` is present and hashed in the JSON, but its catalog-only renditions, including any 3x icon, were not individually decoded on this Windows host. Archive inspection establishes packaging of the selected artwork; it does not establish installed iPhone home-screen, Settings or share-sheet presentation. Those physical-device checks remain pending. The founder must install this native build to receive its app icon; an OTA does not replace it. The later JS-only Quick Check loading commit `f6e9bbd` is intended for the initial Development OTA and is not the native build's source commit.
