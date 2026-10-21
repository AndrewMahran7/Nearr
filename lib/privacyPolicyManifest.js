// Shared by the app and the dependency-free EAS release gate. Approval metadata
// records a real founder decision; filling these fields is not itself approval.
const INTERNAL_COPY = /lawyer\s+review|production[ -]readiness\s+draft|reviewed\s+by\s+counsel|\bTODO\b|\[insert\b/i;

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPrivacyPolicyUrl(value) {
  if (!nonempty(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function getPrivacyPolicyErrors(manifest) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 1) errors.push('Unsupported privacy manifest schema.');
  if (!isPrivacyPolicyUrl(manifest?.canonicalUrl)) errors.push('A canonical HTTPS policy URL without tracking parameters is required.');

  const snapshot = manifest?.snapshot;
  if (!snapshot) {
    errors.push('The founder-approved offline policy snapshot is missing.');
  } else {
    if (!nonempty(snapshot.version)) errors.push('Policy version is missing.');
    if (!nonempty(snapshot.effectiveDate)) errors.push('Approved effective date is missing.');
    if (!nonempty(snapshot.operator)) errors.push('Approved operator is missing.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.contactEmail || '')) errors.push('Approved privacy contact is missing.');
    if (!Array.isArray(snapshot.sections) || !snapshot.sections.length || snapshot.sections.some((section) =>
      !section || !nonempty(section.heading) || !Array.isArray(section.paragraphs) || !section.paragraphs.length || !section.paragraphs.every(nonempty)
    )) errors.push('The complete approved policy sections are required.');
    if (INTERNAL_COPY.test(JSON.stringify(snapshot))) errors.push('Internal review notes or placeholders cannot be policy content.');
  }

  const approval = manifest?.approval;
  if (!approval || approval.status !== 'approved') {
    errors.push('Explicit founder policy approval has not been recorded.');
  } else {
    if (!nonempty(approval.approvedBy)) errors.push('Approval identity is missing.');
    if (!nonempty(approval.approvedAt) || !/^\d{4}-\d{2}-\d{2}T/.test(approval.approvedAt) || !Number.isFinite(Date.parse(approval.approvedAt))) errors.push('Approval timestamp is missing or invalid.');
    if (!nonempty(approval.reference)) errors.push('A reference to the actual founder approval is required.');
    if (!/^[a-f0-9]{64}$/.test(approval.contentSha256 || '')) errors.push('Approved content SHA-256 is missing.');
    if (approval.publicationVerified !== true) errors.push('Public policy and offline snapshot consistency has not been verified.');
  }
  return errors;
}

function getApprovedPrivacyPolicy(manifest) {
  return getPrivacyPolicyErrors(manifest).length === 0 ? manifest.snapshot : null;
}

// Exact canonical serialization for the release gate's SHA-256. The approved
// hash includes the URL so changing the public destination requires reapproval.
function privacyPolicyApprovalPayload(manifest) {
  return JSON.stringify({ canonicalUrl: manifest.canonicalUrl, snapshot: manifest.snapshot });
}

module.exports = { isPrivacyPolicyUrl, getPrivacyPolicyErrors, getApprovedPrivacyPolicy, privacyPolicyApprovalPayload };
