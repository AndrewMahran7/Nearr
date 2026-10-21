export type PrivacyPolicySnapshot = {
  version: string;
  effectiveDate: string;
  operator: string;
  contactEmail: string;
  sections: { heading: string; paragraphs: string[] }[];
};

export type PrivacyPolicyManifest = {
  schemaVersion: number;
  canonicalUrl: string;
  snapshot: PrivacyPolicySnapshot | null;
  approval: {
    status: 'approved';
    approvedBy: string;
    approvedAt: string;
    reference: string;
    contentSha256: string;
    publicationVerified: boolean;
  } | null;
};

export function isPrivacyPolicyUrl(value: unknown): value is string;
export function getPrivacyPolicyErrors(manifest: unknown): string[];
export function getApprovedPrivacyPolicy(manifest: unknown): PrivacyPolicySnapshot | null;
export function privacyPolicyApprovalPayload(manifest: PrivacyPolicyManifest): string;
