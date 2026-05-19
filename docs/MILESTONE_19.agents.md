# Milestone 19: Notification Deep-linking

**Status:** Planned (promoted from Issue 7)

## Goal
Enable OS notifications (fired from the background swap-poll task) to deep-link directly to specific Activity rows. This improves the UX by taking the user straight to the relevant transaction detail instead of a generic activity list.

## Context & Constraints
The background swap-poll task (`@arkade-os/boltz-swap/expo/background`) currently emits aggregate counts in `TaskResult.data`:
```json
{ "polled": 1, "updated": 0, "claimed": 1, "refunded": 0, "errors": 0 }
```
Because the specific `claimedIds` or `refundedIds` are not exposed, the notification payload in `app/services/arkade/swap-background.ts` cannot include an `activityId`.

## Strategy
To resolve this, we have two primary options:

1. **Upstream Enhancement (Preferred):** Update the `@arkade-os/boltz-swap` SDK's background task to include the IDs of transitioned swaps in the `TaskResult`.
2. **Local Reconciliation (Fallback):** Before firing the notification in `pushResult`, query the local SQLite swap repository to identify which swaps just transitioned to a "claim-notified" or "refund-notified" state.

### Implementation Checklist
- [ ] Research SDK capability: check if `TaskResult` can be extended to include `claimedIds`.
- [ ] Update `RecordingSwapTaskQueue.pushResult` to extract specific IDs.
- [ ] Map swap IDs to Activity IDs (using the logic in `app/services/arkade/activity-history.ts`).
- [ ] Update `scheduleLocalNotification` payload to include `activityId`.
- [ ] Verify `useNotifications` hook correctly handles the deep-link navigation.

## Testing Matrix
- **Background Claim:** Trigger a claim in the background; verify notification deep-links to the specific claim activity.
- **Background Refund:** Trigger a refund in the background; verify notification deep-links to the specific refund activity.
- **Coalesced Notification:** If multiple swaps transition, decide on a deep-linking strategy (e.g., link to the first one or fallback to the list).
