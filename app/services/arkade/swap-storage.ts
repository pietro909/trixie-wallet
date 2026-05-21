import { getSharedSqlExecutor } from "./storage";

const TABLE = "trixie_swap_meta";

export type LocalSwapDirection = "in" | "out";
export type LocalSwapFlow = "send" | "receive" | "lnurl_receive" | "lnurl_send";
export type LinkSource = "send_result" | "receive_claim" | "history_match";

const LOCAL_SWAP_FLOWS: ReadonlySet<LocalSwapFlow> = new Set([
  "send",
  "receive",
  "lnurl_send",
  "lnurl_receive",
]);

export function isLocalSwapFlow(value: unknown): value is LocalSwapFlow {
  return (
    typeof value === "string" && LOCAL_SWAP_FLOWS.has(value as LocalSwapFlow)
  );
}

function isLnurlFlow(flow: LocalSwapFlow): boolean {
  return flow === "lnurl_send" || flow === "lnurl_receive";
}

/**
 * Resolve `created_for_flow` when a row is being upserted. The LNURL tag is
 * "sticky": once a swap was created for an LNURL flow, a later generic
 * `send`/`receive` write (typically from restore) must not clobber it.
 * Conversely, an incoming `lnurl_*` always upgrades a generic prior row.
 */
export function resolveCreatedForFlowOnConflict(
  existing: LocalSwapFlow | null,
  incoming: LocalSwapFlow,
): LocalSwapFlow {
  if (isLnurlFlow(incoming)) return incoming;
  if (existing && isLnurlFlow(existing)) return existing;
  return incoming;
}

export type LocalSwapMetadata = {
  swapId: string;
  walletId: string;
  direction: LocalSwapDirection;
  createdForFlow: LocalSwapFlow;
  invoiceAmountSats: number | null;
  arkadeAmountSats: number | null;
  walletTxId: string | null;
  paymentHash: string | null;
  linkSource: LinkSource | null;
  backgroundNotified: boolean;
  restoredAt: number | null;
  createdAt: number;
  updatedAt: number;
};

let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const exec = getSharedSqlExecutor();
      await exec.run(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (
          swap_id TEXT PRIMARY KEY,
          wallet_id TEXT NOT NULL,
          direction TEXT NOT NULL,
          created_for_flow TEXT NOT NULL,
          invoice_amount_sats INTEGER,
          arkade_amount_sats INTEGER,
          wallet_tx_id TEXT,
          payment_hash TEXT,
          link_source TEXT,
          background_notified INTEGER DEFAULT 0,
          restored_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      );
      await exec.run(
        `CREATE INDEX IF NOT EXISTS idx_${TABLE}_wallet ON ${TABLE}(wallet_id)`,
      );
      await exec.run(
        `CREATE INDEX IF NOT EXISTS idx_${TABLE}_wallet_tx ON ${TABLE}(wallet_tx_id)`,
      );
    })();
  }
  return initPromise;
}

type Row = {
  swap_id: string;
  wallet_id: string;
  direction: LocalSwapDirection;
  created_for_flow: LocalSwapFlow;
  invoice_amount_sats: number | null;
  arkade_amount_sats: number | null;
  wallet_tx_id: string | null;
  payment_hash: string | null;
  link_source: LinkSource | null;
  background_notified: number;
  restored_at: number | null;
  created_at: number;
  updated_at: number;
};

function rowToMeta(row: Row): LocalSwapMetadata {
  return {
    swapId: row.swap_id,
    walletId: row.wallet_id,
    direction: row.direction,
    createdForFlow: row.created_for_flow,
    invoiceAmountSats: row.invoice_amount_sats,
    arkadeAmountSats: row.arkade_amount_sats,
    walletTxId: row.wallet_tx_id,
    paymentHash: row.payment_hash,
    linkSource: row.link_source,
    backgroundNotified: row.background_notified === 1,
    restoredAt: row.restored_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type RecordSwapMetadataInput = {
  swapId: string;
  walletId: string;
  direction: LocalSwapDirection;
  createdForFlow: LocalSwapFlow;
  invoiceAmountSats?: number | null;
  arkadeAmountSats?: number | null;
  paymentHash?: string | null;
  backgroundNotified?: boolean;
  restoredAt?: number | null;
};

export async function recordSwapMetadata(
  input: RecordSwapMetadataInput,
): Promise<void> {
  await ensureInit();
  const exec = getSharedSqlExecutor();
  const now = Date.now();
  // Pre-resolve the flow in JS so a generic restore write can't clobber an
  // existing lnurl_* tag. Two round-trips on the same local SQLite file are
  // cheap, and the resolver is unit-tested separately.
  const existing = await exec.get<{ created_for_flow: LocalSwapFlow }>(
    `SELECT created_for_flow FROM ${TABLE} WHERE swap_id = ?`,
    [input.swapId],
  );
  const effectiveFlow = resolveCreatedForFlowOnConflict(
    existing?.created_for_flow ?? null,
    input.createdForFlow,
  );
  await exec.run(
    `INSERT INTO ${TABLE} (
      swap_id, wallet_id, direction, created_for_flow,
      invoice_amount_sats, arkade_amount_sats,
      wallet_tx_id, payment_hash, link_source,
      background_notified, restored_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)
    ON CONFLICT(swap_id) DO UPDATE SET
      direction = excluded.direction,
      created_for_flow = excluded.created_for_flow,
      invoice_amount_sats = COALESCE(excluded.invoice_amount_sats, ${TABLE}.invoice_amount_sats),
      arkade_amount_sats = COALESCE(excluded.arkade_amount_sats, ${TABLE}.arkade_amount_sats),
      payment_hash = COALESCE(excluded.payment_hash, ${TABLE}.payment_hash),
      background_notified = COALESCE(excluded.background_notified, ${TABLE}.background_notified),
      restored_at = COALESCE(excluded.restored_at, ${TABLE}.restored_at),
      updated_at = excluded.updated_at`,
    [
      input.swapId,
      input.walletId,
      input.direction,
      effectiveFlow,
      input.invoiceAmountSats ?? null,
      input.arkadeAmountSats ?? null,
      input.paymentHash ?? null,
      input.backgroundNotified != null ? (input.backgroundNotified ? 1 : 0) : null,
      input.restoredAt ?? null,
      now,
      now,
    ],
  );
}

export async function getSwapMetadata(
  swapId: string,
): Promise<LocalSwapMetadata | null> {
  await ensureInit();
  const exec = getSharedSqlExecutor();
  const row = await exec.get<Row>(`SELECT * FROM ${TABLE} WHERE swap_id = ?`, [
    swapId,
  ]);
  return row ? rowToMeta(row) : null;
}

export async function getAllSwapMetadata(
  walletId: string,
): Promise<LocalSwapMetadata[]> {
  await ensureInit();
  const exec = getSharedSqlExecutor();
  const rows = await exec.all<Row>(
    `SELECT * FROM ${TABLE} WHERE wallet_id = ? ORDER BY created_at DESC`,
    [walletId],
  );
  return rows.map(rowToMeta);
}

export type LinkSwapToWalletTxInput = {
  swapId: string;
  walletTxId: string;
  source: LinkSource;
};

export async function linkSwapToWalletTx(
  input: LinkSwapToWalletTxInput,
): Promise<void> {
  await ensureInit();
  const exec = getSharedSqlExecutor();
  const now = Date.now();
  await exec.run(
    `UPDATE ${TABLE}
       SET wallet_tx_id = ?, link_source = ?, updated_at = ?
     WHERE swap_id = ?`,
    [input.walletTxId, input.source, now, input.swapId],
  );
}

export type FindCandidateMatchInput = {
  walletId: string;
  direction: LocalSwapDirection;
  amountSats: number;
  /** Lower bound (inclusive) of acceptable swap createdAt in ms. */
  afterTs: number;
  /** Upper bound (inclusive). */
  beforeTs: number;
};

/**
 * Returns swap metadata rows that are still unlinked and could plausibly be the
 * counterpart for an Arkade tx with the given amount and time window. Used by
 * the receive history-match fallback. Caller must apply the multi-match rule
 * (link none if 2+ rows match).
 */
export async function findUnlinkedSwapCandidates(
  input: FindCandidateMatchInput,
): Promise<LocalSwapMetadata[]> {
  await ensureInit();
  const exec = getSharedSqlExecutor();
  const rows = await exec.all<Row>(
    `SELECT * FROM ${TABLE}
      WHERE wallet_id = ?
        AND direction = ?
        AND wallet_tx_id IS NULL
        AND arkade_amount_sats = ?
        AND created_at BETWEEN ? AND ?`,
    [
      input.walletId,
      input.direction,
      input.amountSats,
      input.afterTs,
      input.beforeTs,
    ],
  );
  return rows.map(rowToMeta);
}

export async function markSwapsAsNotifiedBulk(
  swapIds: string[],
): Promise<void> {
  if (swapIds.length === 0) return;
  await ensureInit();
  const exec = getSharedSqlExecutor();
  const now = Date.now();
  const placeholders = swapIds.map(() => "?").join(", ");
  await exec.run(
    `UPDATE ${TABLE} SET background_notified = 1, updated_at = ? WHERE swap_id IN (${placeholders}) AND background_notified = 0`,
    [now, ...swapIds],
  );
}

export async function clearSwapMetadataForWallet(
  walletId: string,
): Promise<void> {
  await ensureInit();
  const exec = getSharedSqlExecutor();
  await exec.run(`DELETE FROM ${TABLE} WHERE wallet_id = ?`, [walletId]);
}

/**
 * Returns the timestamp of the most recent metadata write for the given
 * wallet, in milliseconds since epoch. Null when no rows exist.
 *
 * Used by the backup-health calculation to decide whether the wallet has
 * unbacked-up swap material. We compare against `MAX(updated_at)` because
 * `updated_at` reflects every linkage / status / restore touch, not just
 * row creation.
 */
export async function getLatestSwapMetadataWriteAt(
  walletId: string,
): Promise<number | null> {
  await ensureInit();
  const exec = getSharedSqlExecutor();
  const row = await exec.get<{ ts: number | null }>(
    `SELECT MAX(updated_at) AS ts FROM ${TABLE} WHERE wallet_id = ?`,
    [walletId],
  );
  return row?.ts ?? null;
}

/**
 * Restores swap metadata rows verbatim, preserving their original timestamps.
 * Used by the backup import flow. Existing rows with the same `swap_id` are
 * overwritten (the backup wins).
 */
export async function restoreSwapMetadataRows(
  rows: LocalSwapMetadata[],
): Promise<void> {
  if (rows.length === 0) return;
  await ensureInit();
  const exec = getSharedSqlExecutor();
  for (const row of rows) {
    await exec.run(
      `INSERT OR REPLACE INTO ${TABLE} (
        swap_id, wallet_id, direction, created_for_flow,
        invoice_amount_sats, arkade_amount_sats,
        wallet_tx_id, payment_hash, link_source,
        restored_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.swapId,
        row.walletId,
        row.direction,
        row.createdForFlow,
        row.invoiceAmountSats,
        row.arkadeAmountSats,
        row.walletTxId,
        row.paymentHash,
        row.linkSource,
        row.restoredAt,
        row.createdAt,
        row.updatedAt,
      ],
    );
  }
}
