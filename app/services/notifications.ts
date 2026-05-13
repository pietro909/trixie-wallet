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

async function setupNotificationChannels() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });

    await Notifications.setNotificationChannelAsync("swaps", {
      name: "Swaps",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });

    await Notifications.setNotificationChannelAsync("payments", {
      name: "Payments",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
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

export async function shouldNotify(category: "swaps" | "payments") {
  // Match the store-side opt-in default: only notify when the user has
  // explicitly enabled notifications AND the category is on. Missing prefs,
  // missing storage, or a parse error all collapse to "no", because we
  // never want to surface notifications the user did not consent to.
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const prefs = parsed?.preferences?.notifications;
    if (!prefs || prefs.enabled !== true) return false;
    return prefs[category] !== false;
  } catch {
    return false;
  }
}
