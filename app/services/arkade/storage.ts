import * as SQLite from "expo-sqlite";
import {
  SQLiteContractRepository,
  SQLiteWalletRepository,
  type SQLExecutor,
} from "@arkade-os/sdk/repositories/sqlite";

const DB_NAME = "trixie-arkade.db";

let dbInstance: SQLite.SQLiteDatabase | null = null;

function getDatabase(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync(DB_NAME);
  }
  return dbInstance;
}

function makeExecutor(db: SQLite.SQLiteDatabase): SQLExecutor {
  return {
    run: async (sql, params) => {
      await db.runAsync(sql, (params ?? []) as SQLite.SQLiteBindParams);
    },
    get: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await db.getFirstAsync<T>(
        sql,
        (params ?? []) as SQLite.SQLiteBindParams,
      );
      return result ?? undefined;
    },
    all: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      return db.getAllAsync<T>(
        sql,
        (params ?? []) as SQLite.SQLiteBindParams,
      );
    },
  };
}

export type ArkadeRepositories = {
  walletRepository: SQLiteWalletRepository;
  contractRepository: SQLiteContractRepository;
};

export function createRepositories(walletId: string): ArkadeRepositories {
  const db = getDatabase();
  const executor = makeExecutor(db);
  const prefix = `ark_${sanitize(walletId)}_`;
  return {
    walletRepository: new SQLiteWalletRepository(executor, { prefix }),
    contractRepository: new SQLiteContractRepository(executor, { prefix }),
  };
}

export async function clearWalletData(walletId: string): Promise<void> {
  const repos = createRepositories(walletId);
  await Promise.all([repos.walletRepository.clear(), repos.contractRepository.clear()]);
}

function sanitize(walletId: string): string {
  return walletId.replace(/[^a-zA-Z0-9]/g, "");
}
