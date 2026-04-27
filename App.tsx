
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { toNavigationTheme } from "./app/theme/theme";
import { useResolvedTheme } from "./app/hooks/useResolvedTheme";
import AppStartupGate from "./app/components/AppStartupGate";
import ToastProvider from "./app/components/ToastProvider";
import RootStack from "./app/navigation/RootStack";

function AppContent() {
  const theme = useResolvedTheme();

  return (
    <NavigationContainer theme={toNavigationTheme(theme)}>
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
