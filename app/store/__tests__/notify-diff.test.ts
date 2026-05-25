import { toastEmitter } from "../../services/toast-emitter";
import type { Activity } from "../../store/types";
import { clearNotifyState, diffAndNotifyActivities } from "../notify-diff";

jest.mock("../../services/notifications", () => ({
  fetchNotificationPrefs: jest
    .fn()
    .mockResolvedValue({ payments: true, swaps: true }),
  // Implement the snapshot shortcut so policy.ts honours the prefs object
  // passed from notify-diff.ts without reading AsyncStorage.
  shouldNotify: jest.fn(
    async (
      category: "swaps" | "payments",
      snapshot?: { payments: boolean; swaps: boolean } | null,
    ) => {
      if (snapshot !== undefined) return snapshot?.[category] ?? false;
      return true;
    },
  ),
  scheduleLocalNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/toast-emitter", () => ({
  toastEmitter: { show: jest.fn() },
}));

const toastShow = toastEmitter.show as jest.Mock;

function mkActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act_1",
    kind: "payment",
    direction: "in",
    rail: "arkade",
    timestamp: 1_000_000,
    title: "Received",
    status: "confirmed",
    source: { type: "arkade_tx", walletTxId: "tx_1" },
    ...overrides,
  };
}

describe("diffAndNotifyActivities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearNotifyState();
  });

  it("cold start: suppresses all notifications on the initial snapshot call", async () => {
    const activity = mkActivity();
    // First call for this walletId — must be silent regardless of activities.
    await diffAndNotifyActivities("w1", [], [activity]);
    expect(toastShow).not.toHaveBeenCalled();
  });

  it("double-refresh idempotence: toasts exactly once when the same appeared activity is seen twice", async () => {
    const activity = mkActivity();
    // Prime the baseline (first pass).
    await diffAndNotifyActivities("w1", [], []);
    // First non-baseline refresh — activity appears.
    await diffAndNotifyActivities("w1", [], [activity]);
    // Second refresh with the same stale baseline — activity appears again.
    // toastedActivityIds must gate the second execution.
    await diffAndNotifyActivities("w1", [], [activity]);
    expect(toastShow).toHaveBeenCalledTimes(1);
    expect(toastShow).toHaveBeenCalledWith("Payment received", "success");
  });

  it("background→foreground de-dup: no foreground toast when OS push already fired (backgroundNotified=true)", async () => {
    const activity = mkActivity({
      kind: "lightning_swap",
      status: "confirmed",
      metadata: { backgroundNotified: true },
    });
    // Prime baseline.
    await diffAndNotifyActivities("w1", [], []);
    // Foreground resume sees the newly-settled swap that was already notified.
    await diffAndNotifyActivities("w1", [], [activity]);
    expect(toastShow).not.toHaveBeenCalled();
  });

  it("iOS permission-denied: still toasts in-app when backgroundNotified is absent (OS never showed the push)", async () => {
    // No backgroundNotified field — OS permission was denied, so the flag was
    // never set to true in the background pass.
    const activity = mkActivity({
      kind: "lightning_swap",
      status: "confirmed",
    });
    // Prime baseline.
    await diffAndNotifyActivities("w1", [], []);
    await diffAndNotifyActivities("w1", [], [activity]);
    expect(toastShow).toHaveBeenCalledWith("Payment received", "success");
  });

  it("pending→confirmed transition: no toast on status change for a payment activity", async () => {
    const pending = mkActivity({ id: "act_p", status: "pending" });
    const confirmed = mkActivity({ id: "act_p", status: "confirmed" });
    // Prime baseline.
    await diffAndNotifyActivities("w1", [], []);
    // Activity is already known at pending; it transitions to confirmed this refresh.
    // reason="transitioned" — policy must return none for payments.
    await diffAndNotifyActivities("w1", [pending], [confirmed]);
    expect(toastShow).not.toHaveBeenCalled();
  });
});
