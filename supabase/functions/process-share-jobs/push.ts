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
  logicalId?: string;
  attemptId?: string;
};

export type PushSubmissionResult = {
  status: 'submitted' | 'delivery_unknown' | 'permanently_failed';
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

export type PreparedPush = {
  tokenRows: Array<{ id: string; token: string }>;
  messages: Array<Record<string, unknown>>;
  logicalId: string;
};

export type PushPreparation =
  | { status: 'ready'; prepared: PreparedPush }
  | { status: 'retryable_pre_send' | 'permanently_failed'; errorCode: string };

/** All database/local work happens before the durable provider-attempt marker. */
export async function preparePushToUser(
  admin: any,
  userId: string,
  note: PushNotification,
  logicalId: string,
): Promise<PushPreparation> {
  if (!logicalId || new TextEncoder().encode(logicalId).length > 64) {
    return { status: 'permanently_failed', errorCode: 'invalid_logical_notification_id' };
  }
  const { data: tokenRows, error } = await admin
    .from('user_push_tokens')
    .select('id, token')
    .eq('user_id', userId)
    .eq('enabled', true);

  if (error) return { status: 'retryable_pre_send', errorCode: 'token_query_failed' };
  if (!tokenRows || tokenRows.length === 0) {
    return { status: 'permanently_failed', errorCode: 'no_enabled_tokens' };
  }

  const messages = tokenRows.map((t: { token: string }) => ({
    to: t.token,
    title: note.title,
    body: note.body,
    data: note.data,
    sound: 'default',
    channelId: 'default',
    priority: 'high',
    collapseId: logicalId,
    tag: logicalId,
  }));
  return { status: 'ready', prepared: { tokenRows, messages, logicalId } };
}

/** Called only after begin_share_job_notification_provider_attempt commits. */
export async function submitPreparedPush(
  admin: any,
  prepared: PreparedPush,
  attemptId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PushSubmissionResult> {
  const { tokenRows, messages, logicalId } = prepared;

  let submitted = 0;
  let invalidated = 0;
  const ticketRefs: TicketRef[] = [];
  let sawUnknown = false;
  let sawRejected = false;

  for (let i = 0; i < messages.length; i += SEND_CHUNK) {
    const chunk = messages.slice(i, i + SEND_CHUNK);
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
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
        // Even a failed HTTP response is not proof that no earlier chunk was
        // accepted. The at-most-once policy never resends after fetch starts.
        sawUnknown = true;
        continue;
      }

      const tickets = Array.isArray(parsed?.data) ? parsed.data : [];
      if (tickets.length !== chunk.length) sawUnknown = true;
      for (let k = 0; k < chunk.length; k++) {
        const ticket = tickets[k];
        const row = tokenRows[i + k];
        if (ticket?.status === 'ok' && typeof ticket?.id === 'string' && row?.id) {
          submitted += 1;
          ticketRefs.push({ ticketId: ticket.id, tokenId: row.id, logicalId, attemptId });
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
            sawRejected = true;
            continue;
          }
          if (isPermanentExpoError(code) || code === 'MessageRateExceeded') sawRejected = true;
          else sawUnknown = true;
        } else {
          sawUnknown = true;
        }
      }
    } catch (_err) {
      // A timeout/reset can happen after Expo accepted the request.
      sawUnknown = true;
    }
  }

  if (sawUnknown) {
    return {
      status: 'delivery_unknown',
      errorCode: 'expo_acceptance_ambiguous',
      ticketRefs,
      submitted,
      invalidated,
      tokens: tokenRows.length,
    };
  }
  if (submitted > 0) {
    return {
      status: 'submitted',
      errorCode: sawRejected ? 'expo_partial_rejection' : null,
      ticketRefs,
      submitted,
      invalidated,
      tokens: tokenRows.length,
    };
  }
  if (sawRejected) {
    return {
      status: 'permanently_failed',
      errorCode: 'expo_explicit_rejection',
      ticketRefs,
      submitted,
      invalidated,
      tokens: tokenRows.length,
    };
  }

  return {
    status: 'delivery_unknown',
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
  fetchImpl: typeof fetch = fetch,
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
      const res = await fetchImpl(EXPO_RECEIPTS_URL, {
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

  const allPermanentFailures = sawAnyResult && !sawRetryable && !hadAnySuccess && !sawNonPermanent;
  return {
    errorCode: sawRetryable ? 'expo_receipts_partial_retryable' : null,
    invalidated,
    hadAnySuccess,
    allPermanentFailures,
  };
}
