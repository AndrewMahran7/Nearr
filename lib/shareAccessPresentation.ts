import { t } from './i18nEngine';
/** Contract restrictions are actionable, terminal states, never transient retry loops. */
export function shareAccessPresentation(code?: string | null): { title: string; body: string } | null {
  switch (code) {
    case 'update_required': return { title: t("Update Nearr to continue"), body: t("This version cannot send new posts. Update Nearr, then try sharing again. Your saved places are still available.") };
    case 'age_eligibility_required': return { title: t("Check eligibility in Nearr"), body: t("Open Nearr to complete the age and region check before sharing. Your saved places are still available.") };
    case 'ai_permission_required': return { title: t("AI permission needed"), body: t("Open Nearr to review AI sharing permission before sending this post.") };
    case 'recognition_not_available': return { title: t("Video recognition is unavailable"), body: t("New video recognition is not available for this account or region. You can still open your saved places.") };
    case 'plus_allowance_exhausted': return { title: t("Monthly finds used"), body: t("Your available video finds have been used for this period. Your saved places remain available.") };
    case 'plus_verification_required': return { title: t("Check your subscription in Nearr"), body: t("Open Nearr to refresh or restore your subscription before sending another post. Your saved places are still available.") };
    case 'plus_recognition_ineligible': return { title: t("Video recognition is unavailable"), body: t("New video recognition is not available for this account or region. You can still open your saved places.") };
    default: return null;
  }
}
