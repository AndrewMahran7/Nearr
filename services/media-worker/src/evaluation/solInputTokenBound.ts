/** Reservation only: never modifies an inference request. Verified 2026-10-11:
 * https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses
 * gpt-5.6-sol high detail <=2500 patches, multiplier 1.2, rounding +/-1 token.
 * Reserve 3001 tokens per inline JPEG plus the entire non-image JSON byte count
 * and 4096 protocol tokens. Unknown input shapes fall back to the older bound. */
export function solHighImageTokenBound(body: Record<string, any>): number | null {
  if (body.model !== 'gpt-5.6-sol' || !Array.isArray(body.input) ||
      Object.keys(body).some((key) => !['model', 'instructions', 'input', 'text', 'reasoning', 'store', 'max_output_tokens'].includes(key))) return null;
  const bounded = structuredClone(body); let images = 0;
  for (const message of bounded.input) {
    if (!message || typeof message !== 'object' || message.role !== 'user' || !Array.isArray(message.content) ||
        Object.keys(message).some((key) => !['role', 'content'].includes(key))) return null;
    for (const part of message.content) {
      if (part?.type === 'input_text' && typeof part.text === 'string' && Object.keys(part).every((key) => ['type', 'text'].includes(key))) continue;
      if (part?.type !== 'input_image' || part.detail !== 'high' ||
          Object.keys(part).some((key) => !['type', 'detail', 'image_url'].includes(key)) ||
          typeof part.image_url !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(part.image_url)) return null;
      const bytes = Buffer.from(part.image_url.slice('data:image/jpeg;base64,'.length), 'base64');
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
      images++; part.image_url = '';
    }
  }
  return Buffer.byteLength(JSON.stringify(bounded)) + 4096 + images * 3001;
}
