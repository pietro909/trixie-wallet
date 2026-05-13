import { SWAP_POLL_TASK_TYPE } from "@arkade-os/boltz-swap/expo";
import {
  defineExpoSwapBackgroundTask,
  registerExpoSwapBackgroundTask,
  unregisterExpoSwapBackgroundTask,
} from "@arkade-os/boltz-swap/expo/background";
import { SQLiteSwapRepository } from "@arkade-os/boltz-swap/repositories/sqlite";
import {
  AsyncStorageTaskQueue,
  type TaskItem,
  type TaskResult,
} from "@arkade-os/sdk/worker/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ArkadeWalletMetadata } from "../../store/types";
import {
  type BgTaskSummary,
  clearBgTaskMetrics,
  recordBgTaskRun,
} from "../diagnostics/bg-task-metrics";
import { recordPersistedError } from "../diagnostics/persisted";
import { scheduleLocalNotification, shouldNotify } from "../notifications";
import { buildIdentityFromSecret } from "./identity";
import { isMainnetForNetworkName } from "./network";
import { readSecret } from "./secret-store";
import { getSharedSqlExecutor } from "./storage";

export const SWAP_BACKGROUND_TASK_NAME = "trixie-boltz-swap-poll";
const SWAP_BACKGROUND_INTERVAL_MINUTES = 15;

const QUEUE_PREFIX = "trixie:boltz-swap-queue";
const QUEUE_INBOX_KEY = `${QUEUE_PREFIX}:inbox`;
const QUEUE_OUTBOX_KEY = `${QUEUE_PREFIX}:outbox`;
const QUEUE_CONFIG_KEY = `${QUEUE_PREFIX}:config`;
const ACTIVE_WALLET_KEY = `${QUEUE_PREFIX}:active-wallet`;
// Shadow log of TaskResult entries — owned by us, independent of the
// package's outbox (which the OS task body acknowledges and clears at the
// end of its run, so foreground-side getResults() would always be empty).
// Capped to keep AsyncStorage writes bounded across long backgrounded
// sessions.
const RECENT_RESULTS_KEY = `${QUEUE_PREFIX}:recent-results`;
const RECENT_RESULTS_CAP = 50;

type ActiveSwapWallet = {
  walletId: string;
  network: string;
  updatedAt: number;
};

export type RecordedSwapTaskResult = TaskResult & {
  recordedAt: number;
};

function parseRecentResults(raw: string): RecordedSwapTaskResult[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecordedSwapTaskResult[]) : [];
  } catch {
    return [];
  }
}

const SWAP_POLL_SUMMARY_KEYS = [
  "polled",
  "updated",
  "claimed",
  "refunded",
  "errors",
] as const;

function summaryFromSwapPollData(
  data: Record<string, unknown> | undefined,
): BgTaskSummary | undefined {
  if (!data) return undefined;
  const out: BgTaskSummary = {};
  for (const key of SWAP_POLL_SUMMARY_KEYS) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function errorMessageFromSwapPollData(
  data: Record<string, unknown> | undefined,
): string | undefined {
  if (!data) return undefined;
  const err = data.error;
  if (typeof err === "string" && err.length > 0) return err;
  return undefined;
}

class RecordingSwapTaskQueue extends AsyncStorageTaskQueue {
  async pushResult(result: TaskResult): Promise<void> {
    await super.pushResult(result);
    const recorded: RecordedSwapTaskResult = {
      ...result,
      recordedAt: Date.now(),
    };
    const raw = await AsyncStorage.getItem(RECENT_RESULTS_KEY);
    const list = raw ? parseRecentResults(raw) : [];
    list.push(recorded);
    while (list.length > RECENT_RESULTS_CAP) list.shift();
    await AsyncStorage.setItem(RECENT_RESULTS_KEY, JSON.stringify(list));
    // Persist durable per-task metrics for the Advanced UI. Separate from the
    // shadow log above, which is foreground-resume-only and destructive.
    // `TaskResult` has no start time and the package wrapper exposes no
    // before/after hook, so `durationMs` is omitted.
    const errorMessage = errorMessageFromSwapPollData(result.data);
    const summary = summaryFromSwapPollData(result.data);
    await recordBgTaskRun(SWAP_BACKGROUND_TASK_NAME, {
      status: result.status,
      occurredAt: result.executedAt,
      summary,
      errorMessage,
    });
    if (result.status === "failed") {
      const msg = errorMessage ?? "swap poll task failed";
      await recordPersistedError("lightning", `bg_swap_poll_failed: ${msg}`);
    }

    // Trigger local notifications for successful claims or refunds discovered
    // in the background. The upstream task data only carries counts, not swap
    // IDs, so we cannot deep-link to a specific Activity row from here — the
    // tap handler falls back to the Activity list. Tracked in ISSUES.md.
    if (summary && (summary.claimed || summary.refunded)) {
      if (await shouldNotify("swaps")) {
        const title = summary.claimed ? "Payment Received" : "Swap Refunded";
        const body = summary.claimed
          ? `Successfully claimed ${summary.claimed} swap${summary.claimed > 1 ? "s" : ""}.`
          : `Refunded ${summary.refunded} swap${summary.refunded > 1 ? "s" : ""}.`;

        try {
          await scheduleLocalNotification({
            title,
            body,
            channelId: "swaps",
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await recordPersistedError(
            "lightning",
            `bg_swap_notification_failed: ${message}`,
          );
        }
      }
    }
  }
}

export const swapTaskQueue = new RecordingSwapTaskQueue(
  AsyncStorage,
  QUEUE_PREFIX,
);

export function createSwapRepository(): SQLiteSwapRepository {
  return new SQLiteSwapRepository(getSharedSqlExecutor());
}

function newTaskId(): string {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

async function readActiveSwapWallet(): Promise<ActiveSwapWallet> {
  const raw = await AsyncStorage.getItem(ACTIVE_WALLET_KEY);
  if (!raw) {
    throw new Error("No active wallet is available for swap background work");
  }
  const parsed = JSON.parse(raw) as Partial<ActiveSwapWallet>;
  if (
    typeof parsed.walletId !== "string" ||
    parsed.walletId.length === 0 ||
    typeof parsed.network !== "string" ||
    parsed.network.length === 0
  ) {
    throw new Error("Swap background wallet state is malformed");
  }
  return {
    walletId: parsed.walletId,
    network: parsed.network,
    updatedAt:
      typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
  };
}

async function identityFactory() {
  // Runs in the OS-scheduled headless JS context. Capture failures into the
  // persisted error log so the foreground support bundle can see why the
  // background task could not even reach the swap-poll processor.
  try {
    const active = await readActiveSwapWallet();
    const secret = await readSecret(active.walletId);
    return buildIdentityFromSecret(
      secret,
      isMainnetForNetworkName(active.network),
    ).identity;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordPersistedError(
      "lightning",
      `bg_identity_factory_failed: ${message}`,
    );
    throw e;
  }
}

export async function rememberSwapBackgroundWallet(
  metadata: ArkadeWalletMetadata,
): Promise<void> {
  const value: ActiveSwapWallet = {
    walletId: metadata.id,
    network: metadata.network,
    updatedAt: Date.now(),
  };
  await AsyncStorage.setItem(ACTIVE_WALLET_KEY, JSON.stringify(value));
}

export async function clearSwapBackgroundState(): Promise<void> {
  // Defensive unregister: `ExpoArkadeSwaps.dispose` already unregisters when an
  // in-process Lightning instance exists, but a wallet that was set up in a
  // previous session and reset before any foreground Lightning code ran would
  // leave the OS scheduler with a stale registration firing every ~15 minutes.
  // Pair the cleanup with state wipe regardless.
  await unregisterExpoSwapBackgroundTask(SWAP_BACKGROUND_TASK_NAME).catch(
    () => {},
  );
  await Promise.all([
    AsyncStorage.removeItem(ACTIVE_WALLET_KEY),
    AsyncStorage.removeItem(RECENT_RESULTS_KEY),
    AsyncStorage.removeItem(QUEUE_INBOX_KEY),
    AsyncStorage.removeItem(QUEUE_OUTBOX_KEY),
    AsyncStorage.removeItem(QUEUE_CONFIG_KEY),
    clearBgTaskMetrics(SWAP_BACKGROUND_TASK_NAME),
  ]);
}

/**
 * App-owned unregister helper. Wraps the package's unregister with the
 * package-specific task name so callers (e.g. the store's BG-task descriptor)
 * never need to know the OS task name.
 */
export async function unregisterSwapBackgroundTask(): Promise<void> {
  await unregisterExpoSwapBackgroundTask(SWAP_BACKGROUND_TASK_NAME).catch(
    () => {},
  );
}

export async function seedSwapPollTask(): Promise<void> {
  const existing = await swapTaskQueue.getTasks(SWAP_POLL_TASK_TYPE);
  if (existing.length > 0) return;
  const task: TaskItem = {
    id: newTaskId(),
    type: SWAP_POLL_TASK_TYPE,
    data: {},
    createdAt: Date.now(),
  };
  await swapTaskQueue.addTask(task);
}

/**
 * Read and clear the shadow log of swap-poll results captured by
 * `RecordingSwapTaskQueue.pushResult`, then re-seed a fresh poll task as a
 * safety net (the package's OS task body re-seeds itself, but this covers
 * cases where the OS task crashed before re-seeding).
 *
 * We do NOT touch the package's outbox here. The OS task body calls
 * `getResults` + `acknowledgeResults` itself before returning, so the outbox
 * is empty by the time foreground reads it — and double-acking would race
 * with the package's own ack. The shadow log captures results at the moment
 * of `pushResult`, before the package clears them.
 */
export async function drainSwapPollResults(): Promise<
  RecordedSwapTaskResult[]
> {
  const raw = await AsyncStorage.getItem(RECENT_RESULTS_KEY);
  const list = raw ? parseRecentResults(raw) : [];
  if (list.length > 0) {
    await AsyncStorage.removeItem(RECENT_RESULTS_KEY);
  }
  await seedSwapPollTask();
  return list;
}

// Defining the task at module top level is an Expo TaskManager constraint:
// the handler must be registered synchronously at JS startup so an
// OS-scheduled wake can find it. Activation of the OS scheduler itself is
// deferred to `ensureSwapBackgroundRegistered`, called from the lifecycle
// once a wallet is available.
defineExpoSwapBackgroundTask(SWAP_BACKGROUND_TASK_NAME, {
  taskQueue: swapTaskQueue,
  swapRepository: createSwapRepository(),
  identityFactory,
});

/**
 * Activate OS-level scheduling for the swap-poll task. Idempotent —
 * `expo-background-task` accepts repeated `registerTaskAsync` calls for
 * the same task name. Pair with `clearSwapBackgroundState` (which
 * unregisters) on wallet teardown.
 */
export async function ensureSwapBackgroundRegistered(): Promise<void> {
  await registerExpoSwapBackgroundTask(SWAP_BACKGROUND_TASK_NAME, {
    minimumInterval: SWAP_BACKGROUND_INTERVAL_MINUTES,
  });
}
