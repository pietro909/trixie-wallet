// AsyncStorage keys for the persisted app state. Extracted into its own
// module so non-store services (e.g. notifications) can reference the
// current key without importing `useAppStore.ts` and creating a cycle.
export const STORAGE_KEY = "app_state_v4";

export const LEGACY_STORAGE_KEYS = [
  "app_state_v1",
  "app_state_v2",
  "app_state_v3",
] as const;
