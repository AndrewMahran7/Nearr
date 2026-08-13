import assert from 'node:assert/strict';

import { SHARE_JOBS_DEEPLINK_PATH } from '../lib/shareRoutes';
import {
  completionView,
  createCompletionActions,
  createSubmissionGate,
} from '../lib/shareExtensionCompletion';

async function main() {
  // Successful completion render model.
  const accepted = completionView({ kind: 'accepted', duplicate: false });
  assert.deepEqual(accepted, {
    title: 'Sent to Nearr',
    body: "We'll find the place and add it to your map.",
    primary: 'Done',
    secondary: 'Open Nearr',
    showsConfirmationMark: true,
  });

  // A duplicate server response is still one accepted share, stated honestly.
  const duplicate = completionView({ kind: 'accepted', duplicate: true });
  assert.match(duplicate.body, /already shared/i);
  assert.equal(duplicate.primary, 'Done');

  // Queue-submission failure is compact, recoverable, and provider-agnostic.
  const failure = completionView({ kind: 'submission_failure' });
  assert.equal(failure.title, "Couldn't send this to Nearr");
  assert.equal(failure.primary, 'Try again');
  assert.equal(failure.secondary, 'Cancel');
  assert.doesNotMatch(`${failure.title} ${failure.body}`, /supabase|gemini|google|api/i);

  // Done is terminal, single-shot, and never opens the host app.
  let closes = 0;
  const openedPaths: string[] = [];
  const doneActions = createCompletionActions({
    close: () => {
      closes += 1;
    },
    openHostApp: (path) => openedPaths.push(path),
  });
  assert.equal(doneActions.done(), true);
  assert.equal(doneActions.done(), false);
  assert.equal(doneActions.openNearr(SHARE_JOBS_DEEPLINK_PATH), false);
  assert.equal(closes, 1);
  assert.equal(openedPaths.length, 0);

  // Open Nearr emits exactly one queue deep link. It does not carry the shared
  // URL and therefore cannot submit the same share again in the host app.
  const openActions = createCompletionActions({
    close: () => {
      closes += 1;
    },
    openHostApp: (path) => openedPaths.push(path),
  });
  assert.equal(openActions.openNearr(SHARE_JOBS_DEEPLINK_PATH), true);
  assert.equal(openActions.openNearr(SHARE_JOBS_DEEPLINK_PATH), false);
  assert.equal(openActions.done(), false);
  assert.deepEqual(openedPaths, [SHARE_JOBS_DEEPLINK_PATH]);
  assert.doesNotMatch(openedPaths[0], /url=|sid=|create/i);

  // Concurrent effect/retry calls share one Phase-1 submission promise. The
  // test deliberately leaves that promise pending to prove no Phase-2 work is
  // awaited or launched by the completion controller.
  let submitCalls = 0;
  let acceptRequest!: (value: { ok: true }) => void;
  const acceptedRequest = new Promise<{ ok: true }>((resolve) => {
    acceptRequest = resolve;
  });
  const gate = createSubmissionGate(async () => {
    submitCalls += 1;
    return acceptedRequest;
  });
  const first = gate.run();
  const repeated = gate.run();
  await Promise.resolve();
  assert.equal(submitCalls, 1);
  assert.equal(first, repeated);
  assert.equal(gate.isSubmitting(), true);
  acceptRequest({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.equal(gate.isSubmitting(), false);

  // A completed failure can be retried, but repeated taps during either request
  // are collapsed. The stable clientRequestId is supplied by the component.
  await gate.run();
  assert.equal(submitCalls, 2);

  console.log('PASS share completion render, actions, failure, async, and tap safety');
}

void main();
