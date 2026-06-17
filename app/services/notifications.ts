import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { STORAGE_KEY } from "../store/storage-keys";
import { recordPersistedError } from "./diagnostics/persisted";

// expo-notifications suppresses foreground-scheduled notifications on iOS
// unless a handler is registered. Set at module scope so it applies in both
// the foreground app and the OS-scheduled headless JS context (where the
// swap-poll background task fires notifications).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermissions() {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === "granted";
}

export async function checkNotificationPermissions() {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}

// Brand pink, kept in sync with `brand[500]` in `app/theme/theme.tsx`.
// Hardcoded here rather than imported to keep this service free of the
// theme module's React/Reanimated transitive deps (it runs in the
// OS-scheduled headless JS context too).
const BRAND_COLOR = "#ff007f";

// Distinct vibration patterns per channel so that users who customize one
// channel in system Settings don't have to disambiguate by tray icon
// alone. Format: [wait, vibrate, wait, vibrate, ...] in ms. Patterns are
// only set at channel creation; user customizations win once a channel
// exists, so changing these values does not affect existing installs.
const VIBRATION_DEFAULT = [0, 250];
const VIBRATION_SWAPS = [0, 200, 100, 200];
const VIBRATION_PAYMENTS = [0, 250, 100, 250, 100, 250];

async function setupNotificationChannels() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: VIBRATION_DEFAULT,
      lightColor: BRAND_COLOR,
    });

    await Notifications.setNotificationChannelAsync("swaps", {
      name: "Swaps",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: VIBRATION_SWAPS,
      lightColor: BRAND_COLOR,
    });

    await Notifications.setNotificationChannelAsync("payments", {
      name: "Payments",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: VIBRATION_PAYMENTS,
      lightColor: BRAND_COLOR,
    });
  }
}

// Lazy, memoized channel setup. Lives in the same module as
// `scheduleLocalNotification` so callers — including the OS-scheduled
// headless JS context — get the contract "if you can schedule, channels
// are ready" without having to remember to wire setup themselves. The
// promise resolves even on failure (rejection caught + logged) so we never
// cache a permanently-rejected promise that blocks all future scheduling;
// Android falls back to the default channel if a named one is missing.
let channelSetupPromise: Promise<void> | null = null;

async function ensureChannelsReady(): Promise<void> {
  if (channelSetupPromise) return channelSetupPromise;
  channelSetupPromise = setupNotificationChannels().catch((e) => {
    const message = e instanceof Error ? e.message : String(e);
    return recordPersistedError(
      "lightning",
      `notification_channel_setup_failed: ${message}`,
    );
  });
  return channelSetupPromise;
}

export async function scheduleLocalNotification(opts: {
  title: string;
  body: string;
  data?: Record<string, string | number | boolean>;
  channelId?: "default" | "swaps" | "payments";
}) {
  await ensureChannelsReady();
  // For immediate delivery on Android with a specific channel, the channelId
  // must be carried on the trigger (ChannelAwareTriggerInput), not on the
  // notification content. `null` is also a valid trigger but does not route
  // to a specific channel.
  await Notifications.scheduleNotificationAsync({
    content: {
      title: opts.title,
      body: opts.body,
      data: opts.data,
      sound: true,
    },
    trigger: { channelId: opts.channelId ?? "default" },
  });
}

/**
 * Parsed notification opt-ins. `null` means all categories are off (either
 * the master switch is disabled, storage is absent, or a parse error occurred).
 */
export type NotificationPrefsSnapshot = {
  payments: boolean;
  swaps: boolean;
} | null;

/**
 * Reads the current notification preferences from AsyncStorage in a single
 * pass. Returns `null` when the master switch is off or reading fails.
 * Callers that need to check multiple categories in a tight loop should call
 * this once and pass the result to `shouldNotify`.
 */
export async function fetchNotificationPrefs(): Promise<NotificationPrefsSnapshot> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const prefs = parsed?.preferences?.notifications;
    if (prefs?.enabled !== true) return null;
    return {
      payments: prefs.payments !== false,
      swaps: prefs.swaps !== false,
    };
  } catch {
    return null;
  }
}

/**
 * Returns true if the user has enabled notifications for the given category.
 *
 * Routing Policy (see also app/services/notifications/policy.ts):
 * - 'payments': Inbound receipts across all rails (Arkade, Bitcoin, Lightning).
 *   Even when technically a swap completion, the user-facing event is a payment.
 * - 'swaps': Maintenance and background activity (refunds, background poll summaries).
 */
export async function shouldNotify(
  category: "swaps" | "payments",
  snapshot?: NotificationPrefsSnapshot,
) {
  if (snapshot !== undefined) return snapshot?.[category] ?? false;
  // Match the store-side opt-in default: only notify when the user has
  // explicitly enabled notifications AND the category is on. Missing prefs,
  // missing storage, or a parse error all collapse to "no", because we
  // never want to surface notifications the user did not consent to.
  const prefs = await fetchNotificationPrefs();
  return prefs?.[category] ?? false;
}
