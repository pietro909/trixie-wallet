import * as React from "react";
import { ThemeProvider } from "@react-navigation/native";
import { toNavigationTheme } from "@/app/theme/theme";
import { useResolvedTheme } from "@/app/hooks/useResolvedTheme";
import AppStartupGate from "@/app/components/AppStartupGate";
import ToastProvider from "@/app/components/ToastProvider";
import RootStack from "@/app/navigation/RootStack";

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
