import {
  fetchNotificationPrefs,
  scheduleLocalNotification,
} from "../services/notifications";
import {
  decideNotification,
  executeNotification,
} from "../services/notifications/policy";
import { toastEmitter } from "../services/toast-emitter";
import type { Activity } from "./types";

const walletsWithEmittedBaseline = new Set<string>();
const toastedActivityIds = new Set<string>();

export function clearNotifyState(): void {
  walletsWithEmittedBaseline.clear();
  toastedActivityIds.clear();
}

export async function diffAndNotifyActivities(
  walletId: string,
  previous: Activity[],
  current: Activity[],
): Promise<void> {
  const isFirstPass = !walletsWithEmittedBaseline.has(walletId);
  if (isFirstPass) {
    walletsWithEmittedBaseline.add(walletId);
    return;
  }

  const prefs = await fetchNotificationPrefs();
  const prevById = new Map(previous.map((a) => [a.id, a]));

  for (const activity of current) {
    const prev = prevById.get(activity.id);

    let reason: "appeared" | "transitioned" | null = null;
    if (!prev) {
      reason = "appeared";
    } else if (prev.status !== activity.status) {
      reason = "transitioned";
    }

    if (reason && !toastedActivityIds.has(activity.id)) {
      const decision = await decideNotification(
        { source: "activity", activity, reason },
        prefs,
      );

      if (decision.kind !== "none") {
        toastedActivityIds.add(activity.id);
        await executeNotification(
          decision,
          toastEmitter,
          scheduleLocalNotification,
        );
      }
    }
  }
}
