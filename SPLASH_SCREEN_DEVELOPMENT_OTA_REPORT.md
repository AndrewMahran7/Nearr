# Splash-screen Development OTA report

## Result

The splash lifecycle fix was published to the Development channel for runtime `1.6.59`. No Production update or native build was created.

| Field | Value |
| --- | --- |
| Source commit | `596514222c64d67515d09103855e3d28d9002998` |
| Runtime | `1.6.59` |
| Channel | `development` |
| Environment | `development` |
| Update group | `7704b52c-ba7c-4bbd-9974-7f8ae9a95bc8` |
| iOS update | `01a137f2-1990-7aa9-b129-baf40dfd1baf` |
| Android update | `01a137f2-1990-75ad-be98-745071e54e20` |
| Message | `Fix iOS splash lifecycle during onboarding navigation` |

Dashboard: <https://expo.dev/accounts/andrewmahran/projects/nearr/updates/7704b52c-ba7c-4bbd-9974-7f8ae9a95bc8>

## Release decision

Expo config and the existing iOS Development build confirm that build/runtime 1.6.59 already contains the expected native splash storyboard, module, and configuration. The defect and fix are JavaScript-only, so a new native build was unnecessary.

The publish wrapper verified the Development app/backend lane before running EAS Update. Both iOS and Android bundles exported and published successfully.

## Validation before publish

- `npm run test:splash-lifecycle` — 10/10 passed.
- `npm run test:create-map-navigation` — 10/10 passed.
- Every requested onboarding, auth, map, root-layout, typecheck, and prebuild command passed.
- Android Development client boot and Metro JS reload each logged exactly one handled prevent and one handled hide.
- Android Development client deep link reached `Create your map`; Back left the route, and neither route transition emitted another splash event or warning.
- `git diff --check` passed.

The remaining gate is the founder's physical iOS retest after the Development client downloads this OTA.
