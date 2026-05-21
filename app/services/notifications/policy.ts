import type { Activity } from "../../store/types";
import {
  type NotificationPrefsSnapshot,
  shouldNotify as shouldNotifyOS,
} from "../notifications";

export type WalletNotificationEvent =
  | {
      source: "activity";
      activity: Activity;
      reason: "appeared" | "transitioned";
    }
  | {
      source: "swap_drain";
      claimed: number;
      refunded: number;
      context: "foreground" | "background";
    };

export type NotificationDecision =
  | { kind: "none" }
  | {
      kind: "toast";
      message: string;
      tone: "success" | "info" | "error";
    }
  | {
      kind: "local_notification";
      title: string;
      body: string;
      channelId: "swaps" | "payments" | "default";
    };

/**
 * Maps a semantic wallet event to a UI decision (toast, local notification, or none).
 * Centralizes all user-facing copy and category routing.
 *
 * Routing Policy (see also app/services/notifications.ts):
 * - Activity-based inbound payments (all rails) -> 'payments'.
 * - Lightning swap refunds (foreground or background) -> 'swaps'.
 * - Background headless summaries (swap_drain source) -> 'swaps'.
 */
export async function decideNotification(
  event: WalletNotificationEvent,
  prefs?: NotificationPrefsSnapshot,
): Promise<NotificationDecision> {
  if (event.source === "activity") {
    const { activity, reason } = event;

    if (activity.direction !== "in") return { kind: "none" };

    if (activity.kind === "payment") {
      // For standard payments, we notify immediately upon appearance (pending or confirmed).
      // We don't notify on status transitions (e.g. pending -> confirmed) as the
      // first "appeared" toast was enough.
      if (reason !== "appeared") return { kind: "none" };

      const allowed = await shouldNotifyOS("payments", prefs);
      if (!allowed) return { kind: "none" };

      return {
        kind: "toast",
        message: "Payment received",
        tone: "success",
      };
    }

    if (activity.kind === "lightning_swap") {
      // For swaps, we notify when they reach a terminal successful or refunded state.
      // This covers both appeared (background claim) and transitioned (foreground claim).
      if (activity.status !== "confirmed" && activity.status !== "refunded") {
        return { kind: "none" };
      }

      // OS push already fired for this swap while the app was in the background —
      // suppress the foreground toast to avoid the double-buzz.
      if (activity.metadata?.backgroundNotified) return { kind: "none" };

      // Successful claims are "payments" to the user; refunds are "swaps" activity.
      // Foreground refunds use the same 'swaps' category as background summaries.
      const category = activity.status === "confirmed" ? "payments" : "swaps";
      const allowed = await shouldNotifyOS(category, prefs);
      if (!allowed) return { kind: "none" };

      if (activity.status === "confirmed") {
        return {
          kind: "toast",
          message: "Payment received",
          tone: "success",
        };
      }

      return {
        kind: "toast",
        message: "Swap refunded",
        tone: "info",
      };
    }

    return { kind: "none" };
  }

  if (event.source === "swap_drain") {
    const { claimed, refunded, context } = event;

    if (claimed === 0 && refunded === 0) return { kind: "none" };

    // Foreground toasts are handled by the activity-delta detector above.
    // Deleting this path prevents double-toasting when a swap is claimed
    // while the app is open.
    if (context === "foreground") return { kind: "none" };

    // Swap drain results route to the 'swaps' category.
    const allowed = await shouldNotifyOS("swaps", prefs);
    if (!allowed) return { kind: "none" };

    const copy = composeSwapCopy(claimed, refunded, context);

    return {
      kind: "local_notification",
      title: copy.title,
      body: copy.body,
      channelId: "swaps",
    };
  }

  return { kind: "none" };
}

function composeSwapCopy(
  claimed: number,
  refunded: number,
  context: "foreground" | "background",
): { title: string; body: string } {
  const suffix = context === "foreground" ? " in background" : "";

  if (claimed > 0 && refunded > 0) {
    return {
      title: "Swap activity",
      body:
        `Claimed ${claimed} swap${claimed > 1 ? "s" : ""}, ` +
        `refunded ${refunded} swap${refunded > 1 ? "s" : ""}${suffix}.`,
    };
  }

  if (claimed > 0) {
    return {
      title: "Swap completed",
      body: `Successfully claimed ${claimed} swap${claimed > 1 ? "s" : ""}${suffix}.`,
    };
  }

  return {
    title: "Swap refunded",
    body: `Refunded ${refunded} swap${refunded > 1 ? "s" : ""}${suffix}.`,
  };
}

/**
 * Executes a notification decision by either showing a toast or scheduling
 * a local notification.
 */
export async function executeNotification(
  decision: NotificationDecision,
  toast: { show: (msg: string, tone: "success" | "info" | "error") => void },
  schedule: (opts: {
    title: string;
    body: string;
    channelId?: "default" | "swaps" | "payments";
  }) => Promise<void>,
) {
  if (decision.kind === "toast") {
    toast.show(decision.message, decision.tone);
  } else if (decision.kind === "local_notification") {
    await schedule({
      title: decision.title,
      body: decision.body,
      channelId: decision.channelId,
    });
  }
}
