import type { CreateShareJobResult } from './shareJobClient';

export type ShareExtensionSubmitTrace =
  | { event: 'submit_attempt'; detail: string }
  | { event: 'submit_result'; detail: string }
  | { event: 'recovery_started'; detail: string }
  | { event: 'recovery_result'; detail: string };

export function shareSourceIdentity(url: string): string {
  const instagram = /(?:^|\.)instagram\.com\/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)/i.exec(url);
  if (instagram) return `instagram:${instagram[1].toLowerCase()}`.slice(0, 64);
  const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase() ?? 'unknown';
  return `host:${host}`.slice(0, 64);
}

export function shareJobResultDetail(result: CreateShareJobResult): string {
  if (result.ok) return `${result.duplicate ? 'duplicate' : 'accepted'}:${result.status}`.slice(0, 64);
  const status = result.httpStatus == null ? 'none' : String(result.httpStatus);
  return `${result.reason}:${status}:${result.responseErrorCode ?? 'none'}`.slice(0, 64);
}

/**
 * Only retry outcomes where the request may have reached the server but its
 * acknowledgement may have been lost. The SAME clientRequestId is retained by
 * the caller, so this recovers a durable row instead of creating a second one.
 */
export function shouldRecoverShareJobSubmission(result: CreateShareJobResult): boolean {
  if (result.ok) return false;
  if (result.reason === 'timeout' || result.reason === 'network' || result.reason === 'invalid_response') {
    return true;
  }
  if (result.reason !== 'http_error') return false;
  const status = result.httpStatus ?? 0;
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export async function submitShareJobWithRecovery(args: {
  submit: () => Promise<CreateShareJobResult>;
  onTrace?: (trace: ShareExtensionSubmitTrace) => void;
}): Promise<{ result: CreateShareJobResult; attempts: 1 | 2 }> {
  args.onTrace?.({ event: 'submit_attempt', detail: 'attempt:1' });
  const first = await args.submit();
  args.onTrace?.({ event: 'submit_result', detail: shareJobResultDetail(first) });
  if (!shouldRecoverShareJobSubmission(first)) return { result: first, attempts: 1 };

  args.onTrace?.({ event: 'recovery_started', detail: shareJobResultDetail(first) });
  const recovered = await args.submit();
  args.onTrace?.({ event: 'recovery_result', detail: shareJobResultDetail(recovered) });
  return { result: recovered, attempts: 2 };
}
