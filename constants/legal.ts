export const LEGAL_ACCEPTANCE_REQUIRED = false;

export const LEGAL_VERSION = '2026-05-02';

export const LEGAL_EFFECTIVE_DATE = 'May 2, 2026';

export const LEGAL_CONTACT_EMAIL = 'support@nearr.app';

export type LegalDocumentSection = {
  heading: string;
  paragraphs: string[];
};

export const TERMS_SECTIONS: LegalDocumentSection[] = [
  {
    heading: 'Overview',
    paragraphs: [
      'Nearr is a mobile app that helps you save restaurants and other places you discover online, organize them on a map, and optionally receive nearby reminders if you enable those permissions.',
      'This is an early-stage product. Features may change, break, or be removed over time.',
      'These Terms are a draft for production readiness and should be reviewed by counsel before a public launch.',
    ],
  },
  {
    heading: 'Accounts',
    paragraphs: [
      'You are responsible for maintaining access to your account and device.',
      'You must provide accurate account information and use Nearr only in compliance with applicable law.',
    ],
  },
  {
    heading: 'What Nearr Does',
    paragraphs: [
      'Nearr lets you save places from links, social content, and manual search.',
      'Nearr uses automated extraction to identify possible places from links or source content.',
      'Nearr can show your saved places on a map and may send local reminders when you are near a saved place if you enable notifications and location access.',
    ],
  },
  {
    heading: 'Important Limitations',
    paragraphs: [
      'Place extraction may be incomplete, ambiguous, or wrong.',
      'Nearby reminders may be delayed, inaccurate, or not delivered at all. They depend on device settings, operating system behavior, permissions, connectivity, and third-party services.',
      'Nearr is not for safety-critical, emergency, navigation, medical, or time-sensitive use.',
    ],
  },
  {
    heading: 'Third-Party Services',
    paragraphs: [
      'Nearr may interact with or link to third-party services such as Instagram, TikTok, Google Maps, Apple Maps, Supabase, and email providers such as Resend or SMTP services.',
      'Nearr is not affiliated with, endorsed by, or sponsored by Instagram, TikTok, Google, Apple, Supabase, Resend, or any restaurant, venue, or business that may appear in the app.',
    ],
  },
  {
    heading: 'Your Data and Conduct',
    paragraphs: [
      'You may save links, source URLs, notes, and places in Nearr. You are responsible for the content you submit and for having the right to use it.',
      'You may not use Nearr for unlawful, harmful, abusive, fraudulent, or infringing activity.',
    ],
  },
  {
    heading: 'Location and Notifications',
    paragraphs: [
      'You control notification and location permissions through your device settings.',
      'Nearby reminders require notification permission and location access, including background or Always access on some devices.',
    ],
  },
  {
    heading: 'Suspension or Termination',
    paragraphs: [
      'We may suspend, limit, or terminate access to Nearr if we believe the service is being misused, used illegally, or creating material risk to the product or other users.',
    ],
  },
  {
    heading: 'Liability',
    paragraphs: [
      'Nearr is provided on an as-is and as-available basis to the maximum extent allowed by law.',
      'To the fullest extent permitted by law, Nearr and its operators will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost data, lost profits, or missed opportunities arising from your use of the app.',
    ],
  },
  {
    heading: 'Changes and Contact',
    paragraphs: [
      'We may update these Terms over time. If we do, the current version date will be shown in the app or related materials.',
      `Questions about these Terms can be sent to ${LEGAL_CONTACT_EMAIL}. Effective date: ${LEGAL_EFFECTIVE_DATE}.`,
    ],
  },
];

export const PRIVACY_SECTIONS: LegalDocumentSection[] = [
  {
    heading: 'Overview',
    paragraphs: [
      'Nearr collects and uses a limited amount of information so the app can authenticate your account, save places, display them on a map, and optionally send nearby reminders.',
      'This policy is a production-readiness draft and should be reviewed by counsel before public launch.',
    ],
  },
  {
    heading: 'What We Collect',
    paragraphs: [
      'We may collect account information such as your email address, your saved places, source URLs, notes you add, reminder settings, notification settings, and location permission status.',
      'When nearby reminders are enabled, Nearr may access your current or approximate location as needed to check whether you are near a saved place.',
      'We may also collect app diagnostics and reliability information, such as error logs or event counts, to debug and improve the product.',
    ],
  },
  {
    heading: 'How We Use Data',
    paragraphs: [
      'We use your data to authenticate your account, save and organize places, show your map and list, power nearby reminders, and improve app reliability.',
      'We do not sell your personal data.',
    ],
  },
  {
    heading: 'Location Data',
    paragraphs: [
      'Nearr uses location to check whether you are near places you saved so the app can support nearby reminders.',
      'You can disable location access in your device settings at any time. If you do, nearby reminders may not work.',
    ],
  },
  {
    heading: 'Notifications',
    paragraphs: [
      'If you enable notifications, Nearr may send nearby reminders and test notifications. Notification delivery depends on your device, operating system, and provider behavior and is not guaranteed.',
    ],
  },
  {
    heading: 'Service Providers and Linked Services',
    paragraphs: [
      'Nearr may use Supabase for backend services, authentication, and database storage.',
      'Nearr may use Resend or another SMTP/email provider to send sign-in emails or service messages.',
      'Nearr may use Google Maps or Places APIs and Apple or Google mapping services to display maps, place details, or directions links.',
      'Instagram and TikTok links may be stored as source URLs when you save content from those services.',
    ],
  },
  {
    heading: 'Sharing and Disclosure',
    paragraphs: [
      'We share data only with service providers needed to operate the app or when required by law, legal process, or to protect users, the service, or our rights.',
    ],
  },
  {
    heading: 'Retention and Deletion',
    paragraphs: [
      'You can delete saved places inside the app. Some backup, operational, or log data may persist for a limited time.',
      `For account deletion or privacy requests, contact ${LEGAL_CONTACT_EMAIL}.`,
    ],
  },
  {
    heading: 'Children',
    paragraphs: [
      'Nearr is not intended for children under 13.',
    ],
  },
  {
    heading: 'Security and Changes',
    paragraphs: [
      'We use reasonable administrative, technical, and organizational safeguards, but no system is completely secure.',
      `We may update this Privacy Policy over time. Effective date: ${LEGAL_EFFECTIVE_DATE}.`,
    ],
  },
  {
    heading: 'Contact',
    paragraphs: [
      `Questions about privacy can be sent to ${LEGAL_CONTACT_EMAIL}.`,
    ],
  },
];