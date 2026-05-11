/**
 * Per-OS-task metrics persisted across foreground/background JS contexts.
 *
 * Distinct from the destructive `drainSwapPollResults` shadow log in
 * `swap-background.ts`: that log is summed once into `LightningResumeSummary`
 * on foreground resume and then cleared. The metrics here are durable and
 * keyed per task name so the Advanced UI can render last-success/last-failure
 * + lifetime totals without competing with the resume drain.
 *
 * Designed as a generic shape so future OS-scheduled tasks (push
 * notifications) can write to it via the same API.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { redactString } from "./recorder";

const STORAGE_KEY_PREFIX = "trixie:bg-task:metrics:";
const MAX_ERROR_LEN = 240;

export type BgTaskRunStatus = "success" | "failed" | "noop";

export type BgTaskSummary = Record<string, number>;

export type BgTaskMetrics = {
  taskName: string;
  totalRuns: number;
  totalSuccesses: number;
  totalFailures: number;
  lastSuccessAt: number | null;
  lastSuccessDurationMs: number | null;
  lastSuccessSummary: BgTaskSummary | null;
  lastFailureAt: number | null;
  lastFailureMessage: string | null;
};

export type RecordBgTaskRunInput = {
  status: BgTaskRunStatus;
  occurredAt?: number;
  durationMs?: number;
  summary?: BgTaskSummary;
  errorMessage?: string;
};

function storageKey(taskName: string): string {
  return `${STORAGE_KEY_PREFIX}${taskName}`;
}

function emptyMetrics(taskName: string): BgTaskMetrics {
  return {
    taskName,
    totalRuns: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    lastSuccessAt: null,
    lastSuccessDurationMs: null,
    lastSuccessSummary: null,
    lastFailureAt: null,
    lastFailureMessage: null,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function coerceSummary(value: unknown): BgTaskSummary | null {
  if (!value || typeof value !== "object") return null;
  const out: BgTaskSummary = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isFiniteNumber(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseStored(taskName: string, raw: string): BgTaskMetrics {
  try {
    const parsed = JSON.parse(raw) as Partial<BgTaskMetrics>;
    return {
      taskName,
      totalRuns: isFiniteNumber(parsed.totalRuns) ? parsed.totalRuns : 0,
      totalSuccesses: isFiniteNumber(parsed.totalSuccesses)
        ? parsed.totalSuccesses
        : 0,
      totalFailures: isFiniteNumber(parsed.totalFailures)
        ? parsed.totalFailures
        : 0,
      lastSuccessAt: isFiniteNumber(parsed.lastSuccessAt)
        ? parsed.lastSuccessAt
        : null,
      lastSuccessDurationMs: isFiniteNumber(parsed.lastSuccessDurationMs)
        ? parsed.lastSuccessDurationMs
        : null,
      lastSuccessSummary: coerceSummary(parsed.lastSuccessSummary),
      lastFailureAt: isFiniteNumber(parsed.lastFailureAt)
        ? parsed.lastFailureAt
        : null,
      lastFailureMessage:
        typeof parsed.lastFailureMessage === "string"
          ? parsed.lastFailureMessage
          : null,
    };
  } catch {
    return emptyMetrics(taskName);
  }
}

export async function readBgTaskMetrics(
  taskName: string,
): Promise<BgTaskMetrics> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(taskName));
    if (!raw) return emptyMetrics(taskName);
    return parseStored(taskName, raw);
  } catch {
    return emptyMetrics(taskName);
  }
}

export async function clearBgTaskMetrics(taskName: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(taskName));
  } catch {
    // best-effort
  }
}

export async function recordBgTaskRun(
  taskName: string,
  input: RecordBgTaskRunInput,
): Promise<void> {
  try {
    const occurredAt = isFiniteNumber(input.occurredAt)
      ? input.occurredAt
      : Date.now();
    const current = await readBgTaskMetrics(taskName);
    const next: BgTaskMetrics = {
      ...current,
      totalRuns: current.totalRuns + 1,
    };
    if (input.status === "failed") {
      next.totalFailures = current.totalFailures + 1;
      next.lastFailureAt = occurredAt;
      next.lastFailureMessage = input.errorMessage
        ? redactString(input.errorMessage).slice(0, MAX_ERROR_LEN)
        : "Background task failed";
    } else {
      next.totalSuccesses = current.totalSuccesses + 1;
      next.lastSuccessAt = occurredAt;
      next.lastSuccessDurationMs = isFiniteNumber(input.durationMs)
        ? input.durationMs
        : null;
      next.lastSuccessSummary = input.summary
        ? coerceSummary(input.summary)
        : null;
    }
    await AsyncStorage.setItem(storageKey(taskName), JSON.stringify(next));
  } catch {
    // Best-effort: failing to record a metric must not crash the BG task.
  }
}
