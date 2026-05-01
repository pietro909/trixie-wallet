/**
 * Persisted error log that survives across JS contexts and app restarts.
 *
 * The in-memory `recorder.ts` buffer only captures errors in the foreground
 * context — the OS-scheduled background task runs in a separate JS context
 * with its own (also doomed) memory, so any `recordError` calls inside
 * background code are lost when the headless task finishes.
 *
 * This module backs a small AsyncStorage-backed list that BG-side code
 * writes to, and the foreground app drains into the in-memory recorder on
 * hydration so the support bundle includes them.
 *
 * Redaction happens at write time, same rule as the in-memory recorder.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { type ErrorCategory, redactString } from "./recorder";

const STORAGE_KEY = "trixie:persisted-errors";
const MAX_ENTRIES = 50;

export type PersistedErrorEntry = {
  /** ms since epoch when the BG-side error was captured. */
  timestamp: number;
  category: ErrorCategory;
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

function isPersistedErrorEntry(value: unknown): value is PersistedErrorEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.timestamp !== "number" || !Number.isFinite(v.timestamp)) {
    return false;
  }
  if (typeof v.category !== "string") return false;
  if (typeof v.message !== "string") return false;
  if (
    v.details !== undefined &&
    (typeof v.details !== "object" || v.details === null)
  ) {
    return false;
  }
  return true;
}

function safeParse(raw: string): PersistedErrorEntry[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPersistedErrorEntry);
  } catch {
    return [];
  }
}

export async function recordPersistedError(
  category: ErrorCategory,
  message: string,
  details?: Record<string, string | number | boolean | null | undefined>,
): Promise<void> {
  try {
    const entry: PersistedErrorEntry = {
      timestamp: Date.now(),
      category,
      message: redactString(message),
    };
    if (details) {
      const redacted: Record<string, string | number | boolean | null> = {};
      for (const [k, v] of Object.entries(details)) {
        if (v === undefined) continue;
        redacted[k] = typeof v === "string" ? redactString(v) : v;
      }
      if (Object.keys(redacted).length > 0) entry.details = redacted;
    }
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const list = raw ? safeParse(raw) : [];
    list.push(entry);
    while (list.length > MAX_ENTRIES) list.shift();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Best-effort: there's no point recording an error about failing to
    // record an error. Swallow.
  }
}

export async function drainPersistedErrors(): Promise<PersistedErrorEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const list = raw ? safeParse(raw) : [];
    if (list.length > 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
    return list;
  } catch {
    return [];
  }
}

export async function clearPersistedErrors(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
