# Nearr Privacy Policy

**Effective date: [insert the approved publication date]**

This policy explains how Nearr handles information when you use the Nearr mobile app, website and connected services. Nearr is available only to people aged 18 or older. It helps eligible users save places from links and searches, organize saved places, identify places in selected social content, and receive optional reminders and notifications.

Nearr is operated by **Andrew Mahran (individual)**.

Privacy questions or requests: **andrew.mahran@icloud.com**.

## Information you provide and information about your account

Depending on how you use Nearr, we process:

- **Account information:** email address, account identifiers and, when supplied by your chosen Apple or Google sign-in method, profile names and provider identity information. An Apple private relay address may be used instead of your personal email.
- **Authentication information:** credentials and session information needed to sign you in and protect your account. For Nearr's email-and-password option, our authentication service stores a password verifier rather than a plaintext password. Apple or Google sign-in does not give Nearr your password for those services.
- **Saved content:** places you save, their source links and content identifiers, notes, categories, reminder settings, and actions such as marking a place visited or archived. Place details can include a business name, address, coordinates and provider place ID. Saving a place does not by itself mean you are there.
- **Choices and preferences:** onboarding interests and selected platforms, permission choices, notification settings and related account or onboarding state. Some onboarding state remains on your device; eligible account-linked progress can also be stored by our services.
- **Age eligibility:** your account-linked answer to whether you are at least 18, whether your account is eligible or restricted, the assessment method and policy version, and decision timestamps. This release uses your declaration; it does not independently verify your age or ask for a birth date, identity document or biometric information. A recorded under-18 or revoked decision cannot be changed by repeating the declaration in the app.
- **Support submissions:** your feedback category and message, contact email and account identity. Feedback also includes diagnostic context such as app/build and operating-system versions, device name when available, originating screen and submission time. In the current app, leaving the feedback contact-email field blank can still attach your account email.

We use account information to authenticate you, restore and operate your features, provide support and protect the service. Certain information also customizes what you see, such as an email-based greeting, preference-based onboarding material and location-biased suggestions.

We use the age-eligibility record to limit live recognition and related AI processing to accounts that have declared they are at least 18. Existing accounts without a decision remain pending until they complete the step. If an account is restricted, we preserve its saved data rather than automatically deleting it; contact us about access or data requests.

## Shared links, recognition and source media

When you ask Nearr to identify or save places from a link, Nearr and its service providers retrieve and process the selected source. This may include the original and normalized URL, public post/content identifiers, creator attribution, titles, captions, descriptions, thumbnails and content-derived place information.

Recognition can process source video, extracted images and audio, transcripts, text detected in images and other evidence to suggest places. We send selected image frames and relevant text to AI providers. When suitable platform captions are unavailable, extracted source audio may be sent for transcription. This feature works with content you select; it does not scan your camera roll or continuously listen to your microphone.

Raw media downloaded by our recognition worker is normally held in temporary processing files, with cleanup attempted when processing finishes. This is different from the information deliberately retained afterwards: selected image evidence, text/transcripts, recognition results, saved source relationships, and technical information needed to operate or investigate the feature. Temporary cleanup is not a promise that every copy is erased immediately after a crash or failed operation.

Some public-source information, canonical place/source records and representative thumbnails may be retained for shared place/source features rather than owned exclusively by one person's save. Removing one save does not necessarily remove shared material used by other people. Your own notes and account credentials are not made public by this shared-source feature.

When you open an original post, the relevant external app or website handles that visit under its own practices. Nearr also records certain source-opening actions and source references as described below. Nearr does not read your general Safari or other browser history.

## Search, usage analytics and diagnostics

Nearr records events about use of the app, including onboarding, sign-in flows, searches, save/share attempts and results, map and source interactions, permission actions and notification interactions. Some save-attempt or failure events include the **raw search query you entered**. Searches can also be sent to our place-search provider to retrieve results.

These records can include account IDs, persistent app-installation identifiers, onboarding/funnel identifiers, event times, source/place/job references and app/build/platform information. Events made before permanent account creation can later be associated with your account. This is not purely anonymous or aggregate analytics.

We use this information to understand how features are used, evaluate problems and results, and improve the product. We also retain operational diagnostics such as recognition timings, provider/model outcomes, errors, authentication/security metadata, and notification-delivery status. Requests to our infrastructure and providers can generate network and service logs, including IP addresses and request/account information.

Nearr uses Expo's update service to check for compatible app updates. Update requests use a persistent installation identifier and app/runtime/update information. Failed-launch and crash-related information can be reported on subsequent update checks, and Expo retains historical update-health information. A previous fatal-error description may accompany a request. This is a limited update/recovery diagnostic mechanism, not a promise that Nearr records every crash or a full device crash trace. Some additional Nearr diagnostic records remain only on your device unless you choose to share them for support.

Nearr's app analytics and reliability features are distinct from advertising targeting. This release does not display third-party advertisements or implement a Nearr advertising-targeting feature. Provider handling is described below; this statement is not a claim that all providers have identical data practices.

## Website attribution

The Nearr website may record how visitors arrive using referral information in a URL, such as creator identifiers, campaign/video identifiers and UTM parameters. It may keep this attribution in a first-party browser cookie for up to 90 days to measure visits and later website actions such as an App Store link tap. This website attribution is separate from the app's account and product records described above.

## Location and nearby reminders

You control location permission in your device settings, including whether precise location is available. Without location permission, features that depend on your current position may be unavailable or less useful.

Nearr uses location on your device to position the map and evaluate nearby reminders. When location is available for a place search, Nearr can send your current position to Google to bias results toward your area. That position may be precise or approximate depending on the permission and information supplied by the operating system.

Nearby reminder events can also be stored with your account, saved place, time and distance or entered-region information. Those records can reveal your vicinity and, in some circumstances, more closely constrain your location even though they do not contain a continuous raw GPS trail. A saved business's coordinates and geography inferred from shared content are separate from your current device position.

Turning off location permission stops the related future device-location access; it does not automatically erase information already retained. You can also change reminder settings in Nearr.

## Notifications

If you allow notifications, Nearr can register app/device push identifiers and associate them with your account. Remote completion notifications are delivered using Expo and Apple's push service. Notification content may include a place name or result, and can appear on your device's lock screen according to your settings.

Nearr retains some notification content, job/place references and delivery-attempt or error information. Expo's handling of a message during delivery is separate from Nearr's stored copy. Local nearby reminders and remote recognition-completion notifications are different paths. You can change notification permission in device settings and reminder preferences in Nearr.

## Service providers and external services

We use providers to host and operate features, rather than running every part of Nearr ourselves. Depending on the feature and processing result, information may be handled by:

- **Supabase:** authentication, account and application databases, storage, backend processing and related service/security logging. Information retained in these services is information Nearr collects; it is not excluded simply because a provider hosts it.
- **Railway:** hosting the media-processing worker and related operations. Recognition inputs, temporary media and technical processing information may pass through this service.
- **Google:** optional Google sign-in, Places/geocoding and related place content, the bundled Maps integration, and Gemini Developer API recognition. These are separate integrations with different terms. Direct place-search requests can include search text, current-location bias and network metadata; backend place lookups generally use content-derived queries rather than your device GPS. Google Maps services may retain request information under their own applicable terms and are not described here as universally transient or processor-only.
- **Apple:** optional Sign in with Apple, device location/MapKit and push delivery. Nearr retains identity information Apple supplies when you choose sign-in and separately retains the app information described above; Apple's own handling of its platform services follows Apple's terms.
- **Expo:** app update delivery/recovery and remote-notification registration/relay, including associated installation and diagnostic information.
- **OpenAI and Google's Gemini Developer API:** transcription or recognition tasks as described above. These are developer API services, not consumer ChatGPT or consumer Gemini conversations. Selected text and image evidence may go to Gemini or, for some recognition paths, OpenAI. The configured transcription path uses OpenAI's audio-transcription endpoint. Nearr retains some returned text and results itself.
- **ScrapeCreators and source platforms/content delivery services:** conditional acquisition of the public social content you select, including source URLs and available metadata/media. A provider receives the source information needed for that request; our server-side acquisition requests do not deliberately attach your Nearr account ID or your device's IP address. The source itself can identify a creator or other person. Operational/request records may be retained by the acquisition provider.
- **Email and support-delivery services:** sign-in/account messages and support correspondence. The delivery route depends on the service and message involved.

For the API services used here, OpenAI does not use API inputs and outputs for model training by default, and paid Gemini API terms exclude submitted content from product/model improvement. These protections do not mean that every request has zero retention. Security/abuse monitoring and feature-specific processing can still apply. Nearr's OpenAI recognition requests disable response storage, but that setting does not itself eliminate all provider security retention. OpenAI's audio-transcription endpoint has different retention treatment from its recognition/model endpoints. Nearr's own saved evidence, transcripts, results and diagnostics remain subject to Nearr's retention practices even where a provider processes a particular input transiently.

Other providers have their own terms and retention practices. We do not promise that all vendors follow a single retention period or that public-source material is never processed for any secondary purpose permitted by their terms. Provider account settings and the services used can change; material changes to Nearr's practices will require this policy and the relevant notices to be updated.

## Retention and deletion

Nearr retains account records, saved content and service records to operate the features described in this policy. **There is not one automatic expiry period that applies to every stored record.** Some information remains until you delete the relevant save or account; diagnostics, source caches, shared content and operational records can have different lifecycles. We do not currently promise a universal number of days after which all records are automatically erased.

You can remove saved places and initiate account deletion in the app. The account-deletion process removes the account and associated core records, including saved-place relationships, profiles and push-token mappings, and performs cleanup of specified analytics, feedback and recognition evidence. Deletion is not equivalent to immediate removal of every historical copy or derived record:

- Some recognition/operational diagnostics can remain after direct account/job references are removed. Removing those references does not necessarily make every content-bearing record irreversibly anonymous.
- Shared canonical place/source information, cached recognition material or thumbnails may remain independently of one deleted save or account, including when legitimate relationships for other users still exist.
- Historical anonymous/conversion-linked analytics, provider logs and encrypted backups may not be removed by the same account-deletion operation.
- Separate correspondence you send to support, and records that must be handled under applicable legal obligations, can require separate handling.

To ask about information that remains after an in-app deletion, contact **andrew.mahran@icloud.com**. Do not send passwords, session tokens or unnecessary sensitive information in your request. We may need sufficient information to confirm the request concerns your account. Exact legal rights, verification requirements and any applicable exceptions depend on your circumstances and location.

## Your choices and security

You can choose whether to provide optional feedback, which links/content to submit, which supported sign-in method to use, and whether to grant location and notification permissions. You can change device permissions and available in-app settings later. Declining a permission may limit the feature that needs it. These choices do not mean that all app analytics or necessary service records have an independent opt-out switch in the current version.

We use access controls, authentication and security measures in operating Nearr. No internet service or storage system can guarantee absolute security. Please share only content you intend Nearr and the described providers to process, keep account access secure, and use the support contact for privacy concerns.

## Changes and contact

We may update this policy when Nearr's practices change. The published policy will show its effective date. A policy update by itself does not grant new permissions or replace a required consent request.

For privacy questions, access/deletion inquiries or concerns about this policy, contact **andrew.mahran@icloud.com**.

