import { Stack } from "expo-router";
import {toNavigationTheme, useAppTheme} from "@/app/theme/theme";
import RootTabs from "@/app/navigation/RootTabs";
import {ThemeProvider} from "@react-navigation/native";
import * as React from "react";

export default function RootLayout() {
  const theme = useAppTheme();

  return (
    <ThemeProvider value={toNavigationTheme(theme)}>
      <RootTabs />
    </ThemeProvider>
  );
}
