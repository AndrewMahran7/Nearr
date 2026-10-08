# App Store Connect status — HOLD

The existing EAS App Store artifact `693249e5-f54c-4abd-b76d-cdb8bee9eb07` is finished and identifies iOS 1.5.58, build 58, runtime 1.5.58, production channel, Git `ca08c154347096fe5da0bf2739cf0b25c0b706b0`, main bundle `com.nearr.ios`, Share Extension `com.nearr.ios.ShareExtension`; its packaged icon and extension were verified in the preceding release-candidate audit.

**Upload:** not attempted. **App Store Connect processing:** not started/unknown. **TestFlight:** not available from this task. **Build attached to 1.5 version:** no. **App Review submission:** no. **Manual release setting:** not configured because no submission was made. **Public release:** no.

Backend parity and smoke gates did not pass, so uploading or submitting would violate the founder's stop conditions. Once they pass, use the existing EAS build (no rebuild unless invalid), verify ASC version/build/bundle/icon/extension and processing, inspect existing metadata/privacy/export/legal/reviewer fields without guessing, then attach and submit for review with **manual release after approval**. If any declaration or required metadata cannot be verified, stop for founder confirmation. No external testers or emails are authorized.
