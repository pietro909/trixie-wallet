import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AppStartupGate from "./app/components/AppStartupGate";
import ToastProvider from "./app/components/ToastProvider";
import { useNotifications } from "./app/hooks/useNotifications";
import { useResolvedTheme } from "./app/hooks/useResolvedTheme";
import RootStack from "./app/navigation/RootStack";
import { toNavigationTheme } from "./app/theme/theme";

function NotificationsBridge() {
  useNotifications();
  return null;
}

function AppContent() {
  const theme = useResolvedTheme();

  return (
    <NavigationContainer theme={toNavigationTheme(theme)}>
      <NotificationsBridge />
      <AppStartupGate>
        <RootStack />
      </AppStartupGate>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </SafeAreaProvider>
  );
}
