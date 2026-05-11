import { useFocusEffect } from "@react-navigation/native";
import * as React from "react";
import {
  type BgTaskMetrics,
  readBgTaskMetrics,
} from "../services/diagnostics/bg-task-metrics";

/**
 * Loads `BgTaskMetrics` for the named OS task and re-reads them every time
 * the host screen regains focus. Metrics tick at the OS task cadence (~15 min
 * for swap-poll) so a live subscription is not worth the wiring — a focus
 * read covers the realistic case of opening Advanced after a wake.
 *
 * Returns `null` until the first read completes.
 */
export function useBackgroundTaskMetrics(
  taskName: string,
): BgTaskMetrics | null {
  const [metrics, setMetrics] = React.useState<BgTaskMetrics | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        const next = await readBgTaskMetrics(taskName);
        if (!cancelled) setMetrics(next);
      })();
      return () => {
        cancelled = true;
      };
    }, [taskName]),
  );

  return metrics;
}
