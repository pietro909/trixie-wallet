import { useColorScheme } from "react-native";
import { type AppTheme, themes } from "../theme/theme";
import { useAppStore } from "../store/useAppStore";

export function useResolvedTheme(): AppTheme {
  const themePref = useAppStore((s) => s.preferences.theme);
  const systemScheme = useColorScheme();
  const resolved: "light" | "dark" =
    themePref !== "system"
      ? themePref
      : systemScheme === "dark"
        ? "dark"
        : "light";
  return themes[resolved];
}
