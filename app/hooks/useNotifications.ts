import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import type { RootStackParamList } from "../navigation/RootStack";
import { setupNotificationChannels } from "../services/notifications";
import { useAppStore } from "../store/useAppStore";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function useNotifications() {
  const navigation = useNavigation<NavigationProp>();
  const notificationsEnabled = useAppStore(
    (s) => s.preferences.notifications.enabled,
  );
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

  useEffect(() => {
    if (!hydrated || !notificationsEnabled) return;

    const checkAndRequest = async () => {
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();
      if (existingStatus !== "granted") {
        await Notifications.requestPermissionsAsync();
      }
    };

    checkAndRequest();
  }, [hydrated, notificationsEnabled]);
}
