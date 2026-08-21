// Pure cleanup for Facebook's public HTML metadata. Facebook sometimes puts
// engagement chrome in og:title and login/product copy in descriptions; none
// of that is post evidence.

export type FacebookMetadata = {
  title: string | null;
  description: string | null;
};

const GENERIC_DESCRIPTION_PATTERNS = [
  /^see posts, photos and more on facebook\.?$/i,
  /^log (?:in|into facebook) to (?:start sharing|continue|see)/i,
  /^create an account or log in to facebook/i,
  /^facebook helps you connect and share/i,
  /^the content (?:isn't|is not) available/i,
];

function useful(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return GENERIC_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(normalized))
    ? null
    : normalized;
}

export function normalizeFacebookMetadata(input: FacebookMetadata): FacebookMetadata {
  let title = useful(input.title);
  const description = useful(input.description);
  if (title) {
    title = title
      // Example observed on Facebook's own public video:
      // "2.8M views · 1.3K reactions | <post title> | Facebook"
      .replace(/^(?:[\d.,]+\s*[KMB]?\s+views?\s*[·•]\s*)?(?:[\d.,]+\s*[KMB]?\s+reactions?\s*\|\s*)/i, '')
      .replace(/\s*[|\-]\s*Facebook\s*$/i, '')
      .trim();
    if (!title || /^(?:facebook|log in or sign up)$/i.test(title)) title = null;
    // Facebook often appends " | <page name>" to an otherwise exact copy of
    // og:description. Keep the creator-written text once, without turning the
    // page name into a venue clue.
    if (title && description && title.startsWith(description)) title = description;
  }
  return { title, description };
}
