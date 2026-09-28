import { parseAuthCallbackUrl } from './authDeepLinkCore';

export type AuthTransactionStatus =
  | 'authenticating'
  | 'cancelled'
  | 'failed'
  | 'authenticated'
  | 'transferring'
  | 'completed';

export type AuthTransaction = {
  id: string;
  provider: 'google';
  owner: 'initiating_screen';
  status: AuthTransactionStatus;
  startedAt: number;
};

let activeTransaction: AuthTransaction | null = null;
let sequence = 0;

/** Synchronous single-flight claim: two taps cannot launch two browser sheets. */
export function beginGoogleAuthTransaction(now = Date.now()): AuthTransaction | null {
  if (activeTransaction?.status === 'authenticating') return null;
  sequence += 1;
  activeTransaction = {
    id: `google-${now.toString(36)}-${sequence.toString(36)}`,
    provider: 'google',
    owner: 'initiating_screen',
    status: 'authenticating',
    startedAt: now,
  };
  return activeTransaction;
}

export function setAuthTransactionStatus(
  id: string,
  status: AuthTransactionStatus,
): AuthTransaction | null {
  if (!activeTransaction || activeTransaction.id !== id) return activeTransaction;
  activeTransaction = { ...activeTransaction, status };
  return activeTransaction;
}

export function getAuthTransaction(): AuthTransaction | null {
  return activeTransaction;
}

export function completeAuthenticatedTransaction(): void {
  if (activeTransaction && ['authenticated', 'transferring'].includes(activeTransaction.status)) {
    activeTransaction = { ...activeTransaction, status: 'completed' };
  }
}

export function markAuthenticatedTransactionTransferring(): void {
  if (activeTransaction?.status === 'authenticated') {
    activeTransaction = { ...activeTransaction, status: 'transferring' };
  }
}

/** The WebBrowser return is the one exchange owner; echoed OS links are inert. */
export function browserTransactionOwnsCallback(url: string, now = Date.now()): boolean {
  const transaction = activeTransaction;
  if (!transaction || now - transaction.startedAt > 5 * 60_000) return false;
  if (!parseAuthCallbackUrl(url).matches) return false;
  return ['authenticating', 'authenticated', 'transferring', 'completed'].includes(transaction.status);
}

export function initiatingScreenOwnsAuthNavigation(now = Date.now()): boolean {
  const transaction = activeTransaction;
  return !!transaction &&
    now - transaction.startedAt <= 5 * 60_000 &&
    ['authenticating', 'authenticated', 'transferring', 'completed'].includes(transaction.status);
}

export function resetAuthTransactionForTests(): void {
  activeTransaction = null;
  sequence = 0;
}
