/** Pure, conservative entity-role policy for place recognition text. */

export const ENTITY_ROLE_POLICY_VERSION = 'recognition-entity-role-2026-09-14.v1';

export type RecognitionEntityRole =
  | 'LOCATION'
  | 'VENUE'
  | 'BRAND'
  | 'PERSON_CREATOR'
  | 'PRODUCT'
  | 'EVENT_TOUR'
  | 'AMBIGUOUS';

export type RecognitionEntity = {
  value: string;
  normalizedValue: string;
  role: RecognitionEntityRole;
  confidence: 'high' | 'medium' | 'low';
  source: 'tagged_account' | 'creator_account' | 'caption_text';
  reason: string;
};

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedHandle(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '');
}

function contextMatches(caption: string, handle: string, prefix: string): boolean {
  return new RegExp(`(?:${prefix})\\s+(?:[^@\\n]{0,28}\\s)?@${escaped(handle)}\\b`, 'iu').test(caption);
}

/**
 * A bare social tag is deliberately AMBIGUOUS. It becomes venue identity only
 * when the caption gives it a locative relationship; sponsor/product/person
 * language classifies the other common roles. This preserves candidate breadth
 * while preventing an account-name equality from masquerading as place proof.
 */
export function classifyTaggedAccounts(args: {
  captionText: string;
  posterHandle?: string | null;
  taggedHandles: readonly string[];
}): RecognitionEntity[] {
  const caption = args.captionText ?? '';
  const poster = args.posterHandle ? normalizedHandle(args.posterHandle) : null;
  const output: RecognitionEntity[] = [];
  if (poster) {
    output.push({
      value: `@${poster}`,
      normalizedValue: poster,
      role: 'PERSON_CREATOR',
      confidence: 'high',
      source: 'creator_account',
      reason: 'provider_attributed_creator',
    });
  }

  for (const raw of args.taggedHandles) {
    const handle = normalizedHandle(raw);
    if (!handle || handle === poster) continue;
    let role: RecognitionEntityRole = 'AMBIGUOUS';
    let confidence: RecognitionEntity['confidence'] = 'low';
    let reason = 'bare_tag_has_no_place_relationship';

    if (contextMatches(caption, handle, 'at|inside|located\\s+at|location|visit(?:ing)?|meet\\s+us\\s+at|\\u{1F4CD}')) {
      role = 'VENUE'; confidence = 'high'; reason = 'explicit_locative_account_relationship';
    } else if (contextMatches(caption, handle, 'filmed\\s+by|shot\\s+by|photo(?:graphy)?\\s+by|video\\s+by|with|featuring')) {
      role = 'PERSON_CREATOR'; confidence = 'medium'; reason = 'person_or_creator_relationship';
    } else if (contextMatches(caption, handle, 'sponsored\\s+by|presented\\s+by|powered\\s+by|partner(?:ed)?\\s+with|thanks\\s+to')) {
      role = 'BRAND'; confidence = 'high'; reason = 'sponsor_or_brand_relationship';
    } else if (contextMatches(caption, handle, 'wearing|using|riding|equipment\\s+by|gear\\s+by|board\\s+by|foil\\s+by')) {
      role = 'PRODUCT'; confidence = 'medium'; reason = 'product_or_equipment_relationship';
    } else if (contextMatches(caption, handle, 'tour\\s+by|event\\s+by|festival\\s+by|race\\s+by')) {
      role = 'EVENT_TOUR'; confidence = 'medium'; reason = 'event_or_tour_relationship';
    }
    output.push({
      value: `@${handle}`,
      normalizedValue: handle,
      role,
      confidence,
      source: 'tagged_account',
      reason,
    });
  }
  return output;
}

export function roleForTaggedHandle(
  entities: readonly RecognitionEntity[],
  handle: string | null | undefined,
): RecognitionEntityRole {
  const normalized = normalizedHandle(handle ?? '');
  return entities.find((entity) =>
    entity.source === 'tagged_account' && entity.normalizedValue === normalized
  )?.role ?? 'AMBIGUOUS';
}

export function roleAllowsStrongPlaceNameEvidence(role: RecognitionEntityRole | null | undefined): boolean {
  return role === 'VENUE' || role === 'LOCATION';
}
