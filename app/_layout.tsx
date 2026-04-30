import { ThemeProvider } from "@react-navigation/native";
import AppStartupGate from "@/app/components/AppStartupGate";
import ToastProvider from "@/app/components/ToastProvider";
import { useResolvedTheme } from "@/app/hooks/useResolvedTheme";
import RootStack from "@/app/navigation/RootStack";
import { toNavigationTheme } from "@/app/theme/theme";

export default function RootLayout() {
  const theme = useResolvedTheme();

  return (
    <ToastProvider>
      <ThemeProvider value={toNavigationTheme(theme)}>
        <AppStartupGate>
          <RootStack />
        </AppStartupGate>
      </ThemeProvider>
    </ToastProvider>
  );
}
