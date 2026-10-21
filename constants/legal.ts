export const LEGAL_ACCEPTANCE_REQUIRED = false;

export const LEGAL_VERSION = '2026-05-02';

export const LEGAL_EFFECTIVE_DATE = 'August 19, 2026';

export const LEGAL_CONTACT_EMAIL = 'andrew.mahran@icloud.com';

export const TERMS_PUBLIC_URL = 'https://nearrapp.com/terms';

export type LegalDocumentSection = {
  heading: string;
  paragraphs: string[];
};

export const TERMS_SECTIONS: LegalDocumentSection[] = [
  {
    heading: '1. Overview',
    paragraphs: [
      "Nearr is a mobile app that helps you save real-world places you discover online — restaurants, hikes, beaches, hotels, and other places — identify places shown in videos and posts even when they aren't named, organize them on a map, and optionally receive nearby reminders.",
    ],
  },
  {
    heading: '2. Accounts',
    paragraphs: [
      "You're responsible for maintaining access to your account and device, and for providing accurate account information. You must use Nearr in compliance with applicable law.",
    ],
  },
  {
    heading: '3. What Nearr Does',
    paragraphs: [
      'Nearr lets you save places from links, shared social content, and manual search.',
      'When you share a video or post, Nearr may use automated analysis — including visual, audio, caption/text, and location clues — to identify the real-world place or places it shows. A single video or post may correspond to more than one place; where that happens, Nearr may surface more than one candidate location.',
      'Nearr may show saved places on a map and send nearby reminders if notifications and location permissions are enabled.',
    ],
  },
  {
    heading: '4. Automated Identification and Its Limits',
    paragraphs: [
      "Place identification is automated and may be incomplete, ambiguous, or wrong — especially for videos with few or unclear clues. Where a match isn't certain, Nearr may present its best available leads rather than a single definitive answer. Verify important details, like an address, hours, or whether a place is currently open, before relying on them.",
      "Nearby reminders may be delayed, inaccurate, or not delivered at all, depending on device settings, operating system behavior, permissions, connectivity, and third-party services.",
      "Nearr should not be relied on for safety-critical, emergency, navigation, medical, or time-sensitive purposes.",
    ],
  },
  {
    heading: '5. Third-Party Services and Content',
    paragraphs: [
      'Nearr may interact with or link to third-party services, including Instagram, TikTok, Facebook, Google Maps, Apple Maps, Supabase, and email or hosting providers. Place details, addresses, hours, and directions may come from third-party data providers and may be inaccurate or outdated.',
      'Nearr is not affiliated with, endorsed by, or sponsored by Instagram, TikTok, Facebook, Meta, Google, Apple, or any restaurant, venue, or business shown in the app. All trademarks belong to their respective owners.',
      "You may only share or save content you have the right to access and share. Saving content to Nearr doesn't give you or Nearr any ownership over that content — it remains the property of whoever created or posted it.",
    ],
  },
  {
    heading: '6. User Conduct',
    paragraphs: [
      'You must not use Nearr for illegal, harmful, abusive, fraudulent, or infringing activity.',
    ],
  },
  {
    heading: '7. Location and Notifications',
    paragraphs: [
      'You control notification and location permissions through your device settings. Nearby reminders require notification permission and location access, including background access on some devices.',
    ],
  },
  {
    heading: '8. Suspension or Termination',
    paragraphs: [
      'Nearr may suspend, limit, or terminate access if the service is being misused, used illegally, or creating material risk to the product or other users.',
    ],
  },
  {
    heading: '9. Changes to the Service',
    paragraphs: [
      'Nearr may add, modify, or remove features over time, and the service may occasionally be unavailable.',
    ],
  },
  {
    heading: '10. Limitation of Liability',
    paragraphs: [
      'Nearr is provided on an as-is and as-available basis to the maximum extent permitted by law. To the fullest extent permitted by law, Nearr and its operators are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost data, lost profits, or missed opportunities arising from use of the app.',
    ],
  },
  {
    heading: '11. Changes to These Terms',
    paragraphs: [
      "Nearr may update these Terms over time. The current version's effective date is shown above.",
    ],
  },
  {
    heading: '12. Contact',
    paragraphs: [
      `Questions about these Terms can be sent to ${LEGAL_CONTACT_EMAIL}.`,
    ],
  },
];
