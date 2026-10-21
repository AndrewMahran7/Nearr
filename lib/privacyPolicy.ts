import manifest from '../constants/privacyPolicy.json';
import { getApprovedPrivacyPolicy, isPrivacyPolicyUrl } from './privacyPolicyManifest';

export const privacyPolicy = {
  canonicalUrl: manifest.canonicalUrl,
  snapshot: getApprovedPrivacyPolicy(manifest),
};

// No fetch, tracking event, account lookup or automatic browser navigation is
// performed by viewing the privacy page. Opening the website is a user action.
export async function openPrivacyPolicyWebsite(
  openURL: (url: string) => Promise<unknown>,
  url: string = privacyPolicy.canonicalUrl,
): Promise<boolean> {
  if (!isPrivacyPolicyUrl(url)) return false;
  try {
    await openURL(url);
    return true;
  } catch {
    return false;
  }
}
