# Category and practice manifest

Primary interest is deterministic: the existing ordered selection contract chooses one primary interest and that value is used for Phase 1 and Phase 2. The mapping is locally packaged and versioned; runtime networking is not used to choose Phase 1.

| Category family | Interest aliases | Phase 1 identity | Local asset family | Scripted place | Real practice |
|---|---|---|---|---|---|
| Food | food, cafes | `{platform}-food-offline-v1` | `mad_yolks` | Mad Yolks | 2nd Floor public Instagram post |
| Outdoors | outdoors, things_to_do | `{platform}-outdoors-offline-v1` | `dorset_quarry` | Dorset Quarry | Dorset Quarry public Instagram reel |
| Travel | travel, anything/default | `{platform}-travel-offline-v1` | `hydra_old_town` | Hydra Old Town | Dorset Quarry destination reel |
| Shopping | shopping | `{platform}-shopping-offline-v2` | `old_towne_shops_v2` | Old Towne Orange Shops | Country Roads Antiques public Instagram post |

Shopping provenance is the OCTA Old Towne Orange antiquing page, which embeds the selected public Country Roads Antiques post. The app opens the exact canonical post and still runs the ordinary authenticated recognition/cache safety path; it never treats the expected place as a result.

The new shopping bitmap assets were produced with the built-in image-generation mode using these prompts:

- Poster: candid vertical independent home-goods and stationery boutique in a California shopping district; warm daylight; recognizable retail subject; no text, logos, or brands.
- Place image: coherent landscape view of the same independent boutique interior; warm daylight; no text, logos, or brands.

Saved paths:

- `assets/onboarding/authentic/old-towne-shops-poster-v2.png`
- `assets/onboarding/authentic/old-towne-shops-place-v2.png`
- `assets/onboarding/authentic/old-towne-shops-loop-v2.mp4` (five-second vertical loop derived locally from the generated poster)

Old checkpoints are replaced only when still pre-share and untouched. Any checkpoint with a result, pending share, or completed save retains its original fixture as historical truth.
