import { useColorScheme } from "react-native";
import { useAppStore } from "../store/useAppStore";
import { type AppTheme, themes } from "../theme/theme";

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
