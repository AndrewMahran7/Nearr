# Production release gate

Every production OTA must start with a copy of
`PRODUCTION_RELEASE_RECORD.template.json`. Fill in the previous main/OTA,
current Edge versions, Railway deployment, migration ledger, and an executable
rollback procedure. Pass it to the guarded publisher:

`npm run prod:update -- -m "message" --release-record <path> --yes`

The publisher records the new OTA group and marks the record `DEPLOYED`. That
does **not** mean healthy. Run the physical cold-start matrix on an iPhone and
change the applicable values to `PASS`:

1. signed-out cold launch
2. signed-in cold launch
3. force-close and relaunch
4. fresh onboarding cold launch whenever onboarding changed

`npm run release:status -- --record <path> --require-healthy` fails until the
physical matrix passes. Pending reports must say:

`DEPLOYED — PHYSICAL COLD-START VALIDATION PENDING`
