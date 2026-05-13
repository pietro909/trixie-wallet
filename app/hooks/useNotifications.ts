import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import type { RootStackParamList } from "../navigation/RootStack";
import { setupNotificationChannels } from "../services/notifications";
import { useAppStore } from "../store/useAppStore";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// Permission requesting deliberately lives in `ProfilePreferences` (gated on
// the user toggling the master switch on), not here. Auto-prompting on app
// launch produces an iOS system dialog with no context, and a denied
// response cannot be re-prompted in-app.
export function useNotifications() {
  const navigation = useNavigation<NavigationProp>();
  const hydrated = useAppStore((s) => s._hydrated);

  useEffect(() => {
    if (!hydrated) return;

    setupNotificationChannels();

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        const activityId =
          typeof data?.activityId === "string" ? data.activityId : undefined;
        if (activityId) {
          navigation.navigate("ActivityDetails", { activityId });
        } else {
          navigation.navigate("Activity");
        }
      });

    return () => {
      responseSubscription.remove();
    };
  }, [hydrated, navigation]);
}
