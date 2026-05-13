import { getSharedSqlExecutor } from "./storage";

const TABLE = "arkade_tx_timestamps";

let initPromise: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const exec = getSharedSqlExecutor();
      await exec.run(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (
          ark_txid TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL
        )`,
      );
    })().catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

/**
 * Returns the cached creation timestamp (ms since epoch) for an Ark txid,
 * or `undefined` on miss. Treats any SQL error as a miss — the indexer is
 * the source of truth and a stale cache row is the only thing the caller
 * could lose.
 */
export async function getTimestamp(
  arkTxid: string,
): Promise<number | undefined> {
  try {
    await ensureTable();
    const exec = getSharedSqlExecutor();
    const row = await exec.get<{ timestamp: number }>(
      `SELECT timestamp FROM ${TABLE} WHERE ark_txid = ?`,
      [arkTxid],
    );
    return row?.timestamp ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persists a timestamp for an Ark txid. Best-effort: a write failure is
 * swallowed so the activity build keeps progressing — the worst outcome is
 * one extra indexer call next refresh.
 */
export async function saveTimestamp(
  arkTxid: string,
  timestamp: number,
): Promise<void> {
  try {
    await ensureTable();
    const exec = getSharedSqlExecutor();
    await exec.run(
      `INSERT OR REPLACE INTO ${TABLE} (ark_txid, timestamp) VALUES (?, ?)`,
      [arkTxid, timestamp],
    );
  } catch {
    // best-effort
  }
}

export async function clearAllTimestamps(): Promise<void> {
  try {
    await ensureTable();
    const exec = getSharedSqlExecutor();
    await exec.run(`DELETE FROM ${TABLE}`);
  } catch {
    // best-effort
  }
}
