// supabase/functions/process-share-jobs/push.ts
//
// Expo Push transport for server-sent job-result notifications.
//
// This is the REMOTE push path — distinct from the on-device local
// place-reminder notifications in lib/notifications.ts. It fans a single
// notification out to all of a user's enabled Expo push tokens and
// deactivates any token Expo reports as DeviceNotRegistered.
//
// NEVER logs token strings.

// @ts-nocheck — Deno runtime.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 200;

export type PushNotification = {
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export type TicketRef = {
  ticketId: string;
  tokenId: string;
};

export type PushSubmissionResult = {
  status: 'submitted' | 'retryable_failed' | 'permanently_failed';
  errorCode: string | null;
  ticketRefs: TicketRef[];
  submitted: number;
  invalidated: number;
  tokens: number;
};

export type PushReceiptResult = {
  errorCode: string | null;
  invalidated: number;
  hadAnySuccess: boolean;
  allPermanentFailures: boolean;
};

function isRetryableExpoError(code: string | null): boolean {
  if (!code) return true;
  return ['MessageRateExceeded', 'ExpoServiceError', 'TOO_MANY_REQUESTS'].includes(code);
}

function isPermanentExpoError(code: string | null): boolean {
  if (!code) return false;
  return [
    'DeviceNotRegistered',
    'MessageTooBig',
    'MessageRateExceededByRecipient',
    'MismatchSenderId',
    'InvalidCredentials',
  ].includes(code);
}

export async function submitPushToUser(
  admin: any,
  userId: string,
  note: PushNotification,
): Promise<PushSubmissionResult> {
  const { data: tokenRows, error } = await admin
    .from('user_push_tokens')
    .select('id, token')
    .eq('user_id', userId)
    .eq('enabled', true);

  if (error || !tokenRows || tokenRows.length === 0) {
    return {
      status: 'permanently_failed',
      errorCode: error ? 'token_query_failed' : 'no_enabled_tokens',
      ticketRefs: [],
      submitted: 0,
      invalidated: 0,
      tokens: 0,
    };
  }

  const messages = tokenRows.map((t: { token: string }) => ({
    to: t.token,
    title: note.title,
    body: note.body,
    data: note.data,
    sound: 'default',
    channelId: 'default',
    priority: 'high',
  }));

  let submitted = 0;
  let invalidated = 0;
  const ticketRefs: TicketRef[] = [];
  let sawRetryable = false;
  let sawPermanent = false;

  for (let i = 0; i < messages.length; i += SEND_CHUNK) {
    const chunk = messages.slice(i, i + SEND_CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(chunk),
      });
      const parsed = await res.json().catch(() => null);
      if (!res.ok) {
        sawRetryable = true;
        continue;
      }

      const tickets = Array.isArray(parsed?.data) ? parsed.data : [];
      for (let k = 0; k < tickets.length; k++) {
        const ticket = tickets[k];
        const row = tokenRows[i + k];
        if (ticket?.status === 'ok') {
          submitted += 1;
          if (typeof ticket?.id === 'string' && row?.id) {
            ticketRefs.push({ ticketId: ticket.id, tokenId: row.id });
          }
        } else if (ticket?.status === 'error') {
          const code = typeof ticket?.details?.error === 'string' ? ticket.details.error : null;
          if (code === 'DeviceNotRegistered') {
            if (row?.id) {
              await admin
                .from('user_push_tokens')
                .update({ enabled: false })
                .eq('id', row.id);
              invalidated += 1;
            }
            sawPermanent = true;
            continue;
          }

          if (isRetryableExpoError(code)) {
            sawRetryable = true;
          } else if (isPermanentExpoError(code)) {
            sawPermanent = true;
          } else {
            sawRetryable = true;
          }
        }
      }
    } catch (_err) {
      sawRetryable = true;
    }
  }

  if (submitted > 0) {
    return {
      status: 'submitted',
      errorCode: null,
      ticketRefs,
      submitted,
      invalidated,
      tokens: tokenRows.length,
    };
  }

  if (sawRetryable) {
    return {
      status: 'retryable_failed',
      errorCode: 'expo_send_retryable',
      ticketRefs,
      submitted,
      invalidated,
      tokens: tokenRows.length,
    };
  }

  if (sawPermanent) {
    return {
      status: 'permanently_failed',
      errorCode: 'expo_send_permanent',
      ticketRefs,
      submitted,
      invalidated,
      tokens: tokenRows.length,
    };
  }

  return {
    status: 'retryable_failed',
    errorCode: 'expo_send_unknown',
    ticketRefs,
    submitted,
    invalidated,
    tokens: tokenRows.length,
  };
}

export async function checkExpoReceipts(
  admin: any,
  ticketRefs: TicketRef[],
): Promise<PushReceiptResult> {
  if (!Array.isArray(ticketRefs) || ticketRefs.length === 0) {
    return {
      errorCode: null,
      invalidated: 0,
      hadAnySuccess: false,
      allPermanentFailures: false,
    };
  }

  let invalidated = 0;
  let hadAnySuccess = false;
  let sawAnyResult = false;
  let sawRetryable = false;
  let sawNonPermanent = false;

  for (let i = 0; i < ticketRefs.length; i += RECEIPT_CHUNK) {
    const chunk = ticketRefs.slice(i, i + RECEIPT_CHUNK);
    const ids = chunk.map((t) => t.ticketId);
    try {
      const res = await fetch(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify({ ids }),
      });

      if (!res.ok) {
        sawRetryable = true;
        continue;
      }

      const parsed = await res.json().catch(() => null);
      const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : {};

      for (const ref of chunk) {
        const receipt = data?.[ref.ticketId];
        if (!receipt) {
          sawRetryable = true;
          continue;
        }

        sawAnyResult = true;
        if (receipt?.status === 'ok') {
          hadAnySuccess = true;
          sawNonPermanent = true;
          continue;
        }

        if (receipt?.status === 'error') {
          const code = typeof receipt?.details?.error === 'string' ? receipt.details.error : null;
          if (code === 'DeviceNotRegistered') {
            await admin.from('user_push_tokens').update({ enabled: false }).eq('id', ref.tokenId);
            invalidated += 1;
            continue;
          }
          if (isRetryableExpoError(code)) {
            sawRetryable = true;
            sawNonPermanent = true;
            continue;
          }
          if (!isPermanentExpoError(code)) {
            sawRetryable = true;
            sawNonPermanent = true;
            continue;
          }
        }
      }
    } catch {
      sawRetryable = true;
    }
  }

  if (sawRetryable && !sawAnyResult) {
    return {
      errorCode: 'expo_receipts_retryable',
      invalidated,
      hadAnySuccess,
      allPermanentFailures: false,
    };
  }

  const allPermanentFailures = sawAnyResult && !hadAnySuccess && !sawNonPermanent;
  return {
    errorCode: sawRetryable ? 'expo_receipts_partial_retryable' : null,
    invalidated,
    hadAnySuccess,
    allPermanentFailures,
  };
}
