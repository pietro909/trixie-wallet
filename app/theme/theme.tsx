import type {
  BottomTabBarButtonProps,
  BottomTabNavigationOptions,
} from "@react-navigation/bottom-tabs";
import type { Theme as NavigationTheme } from "@react-navigation/native";
import { DefaultTheme } from "@react-navigation/native";
import { BlurView } from "expo-blur";
import * as React from "react";
import {
  Animated,
  Platform,
  Pressable,
  type PressableProps,
  StyleSheet,
  useColorScheme,
  View,
  type ViewStyle,
} from "react-native";

type Mode = "light" | "dark";

/**
 * Brand: #ff007f
 */
const brand = {
  50: "#fff2f9",
  100: "#ffe6f2",
  200: "#ffbfdf",
  300: "#ff99cc",
  400: "#ff66b2",
  500: "#ff007f",
  600: "#d9006c",
  700: "#b20059",
  800: "#8c0046",
  900: "#660033",
} as const;

const neutral = {
  0: "#ffffff",
  50: "#f3f3f4",
  100: "#e6e7e8",
  150: "#dadbdd",
  200: "#cecfd1",
  300: "#b6b7ba",
  400: "#9d9fa3",
  500: "#84878c",
  600: "#6c6f76",
  700: "#54575f",
  800: "#3b3f48",
  900: "#222731",
  950: "#161b25",
  1000: "#0a0f1a",
} as const;

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  // Drop-in friendly: defaults to system if you don't load custom fonts.
  fontFamily: {
    ui: "Inter_400Regular",
    uiMedium: "Inter_500Medium",
    uiSemiBold: "Inter_600SemiBold",
    uiBold: "Inter_700Bold",
    mono: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, "2xl": 28 },
  lineHeight: { xs: 16, sm: 20, md: 24, lg: 26, xl: 30, "2xl": 36 },
  weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
  // Add these for compatibility if any library is looking for them directly
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const motion = {
  duration: { fast: 120, base: 180, slow: 260 },
  press: { scaleDown: 0.98 },
} as const;

function shadow(level: "card" | "popover"): ViewStyle {
  if (Platform.OS === "android") {
    return { elevation: level === "card" ? 6 : 10 };
  }
  return level === "card"
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.14,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 14 },
      };
}

function createTheme(mode: Mode) {
  const isDark = mode === "dark";

  const colors = isDark
    ? {
        background: neutral[1000],
        surface: neutral[950],
        surfaceSubtle: neutral[900],
        card: neutral[950],
        cardAlt: "#111728",

        text: neutral[0],
        textMuted: neutral[300],
        textSubtle: neutral[400],
        placeholder: neutral[500],

        border: neutral[800],
        divider: rgba("#ffffff", 0.08),

        primary: brand[500],
        primaryHover: brand[400],
        primaryPressed: brand[600],
        primarySoft: rgba(brand[500], 0.18),
        onPrimary: "#ffffff",

        success: "#32D583",
        warning: "#FDB022",
        danger: "#FDA29B",
        info: "#53B1FD",

        tabBarTint: brand[500],
        tabBarInactive: neutral[400],
        tabBarBg: rgba(neutral[950], 0.72),
        tabBarBorder: rgba("#ffffff", 0.1),

        scrim: rgba("#000000", 0.55),
        focusRing: rgba(brand[500], 0.4),
      }
    : {
        background: neutral[0],
        surface: neutral[0],
        surfaceSubtle: neutral[50],
        card: neutral[0],
        cardAlt: "#fbfbfd",

        text: neutral[950],
        textMuted: neutral[700],
        textSubtle: neutral[600],
        placeholder: neutral[500],

        border: neutral[150],
        divider: neutral[100],

        primary: brand[500],
        primaryHover: brand[600],
        primaryPressed: brand[700],
        primarySoft: rgba(brand[500], 0.12),
        onPrimary: "#ffffff",

        success: "#12B76A",
        warning: "#F79009",
        danger: "#F04438",
        info: "#2E90FA",

        tabBarTint: brand[500],
        tabBarInactive: neutral[600],
        tabBarBg: rgba("#ffffff", 0.75),
        tabBarBorder: rgba("#000000", 0.06),

        scrim: rgba(neutral[1000], 0.35),
        focusRing: rgba(brand[500], 0.32),
      };

  return {
    mode,
    colors,
    spacing,
    radius,
    typography,
    motion,
    shadow,
  } as const;
}

export type AppTheme = ReturnType<typeof createTheme>;

export const themes = {
  light: createTheme("light"),
  dark: createTheme("dark"),
} as const;

export function useAppTheme(): AppTheme {
  const scheme = useColorScheme();
  return scheme === "dark" ? themes.dark : themes.light;
}

export function toNavigationTheme(t: AppTheme): NavigationTheme {
  return {
    dark: t.mode === "dark",
    colors: {
      primary: t.colors.primary,
      background: t.colors.background,
      card: t.colors.card,
      text: t.colors.text,
      border: t.colors.border,
      notification: t.colors.primary,
    },
    fonts: DefaultTheme.fonts,
  } as NavigationTheme;
}

/**
 * Active indicator dot + stable layout (doesn't change tab heights).
 * Use inside `tabBarIcon`.
 */
export function TabIcon(props: {
  focused: boolean;
  color: string;
  size: number;
  theme: AppTheme;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
}) {
  const { focused, color, size, theme, Icon } = props;
  const dot = Math.max(5, Math.round(size * 0.22)); // ~5-6px

  // Tiny "pop" when focused (subtle, premium).
  const pop = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (!focused) return;
    Animated.sequence([
      Animated.spring(pop, {
        toValue: 1.06,
        useNativeDriver: true,
        speed: 18,
        bounciness: 6,
      }),
      Animated.spring(pop, {
        toValue: 1.0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 6,
      }),
    ]).start();
  }, [focused, pop]);

  return (
    <Animated.View
      style={{
        width: size + 10,
        height: size + 14,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pop }],
      }}
    >
      <Icon color={color} size={size} />
      {focused ? (
        <View
          style={{
            position: "absolute",
            bottom: 1,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: theme.colors.primary,
            ...(theme.mode === "dark"
              ? {
                  shadowColor: theme.colors.primary,
                  shadowOpacity: 0.35,
                  shadowRadius: 6,
                }
              : null),
          }}
        />
      ) : null}
    </Animated.View>
  );
}

/**
 * Micro-interaction: subtle press scale + (Android) ripple.
 * Keeps navigation behavior intact by forwarding all props.
 */
export function AnimatedTabBarButton({
  theme,
  style,
  ...props
}: BottomTabBarButtonProps & { theme: AppTheme }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const opacity = React.useRef(new Animated.Value(1)).current;

  const onPressIn: PressableProps["onPressIn"] = (e) => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: motion.press.scaleDown,
        useNativeDriver: true,
        speed: 22,
        bounciness: 0,
      }),
      Animated.timing(opacity, {
        toValue: 0.95,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();
    props.onPressIn?.(e);
  };

  const onPressOut: PressableProps["onPressOut"] = (e) => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 18,
        bounciness: 6,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
    props.onPressOut?.(e);
  };

  return (
    <Animated.View style={{ transform: [{ scale }], opacity }}>
      <Pressable
        {...(props as PressableProps)}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        android_ripple={
          Platform.OS === "android"
            ? { color: theme.colors.primarySoft, borderless: false }
            : undefined
        }
        style={() => [style, styles.tabButton]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tabButton: {
    borderRadius: radius.lg,
  },
});

type TabsOptions = {
  bottomInset?: number;
  blur?: boolean;
  animation?: BottomTabNavigationOptions["animation"];
};

/**
 * Premium floating bottom tabs (glass + subtle transitions).
 * Uses `tabBarBackground` for BlurView.
 */
export function makeBottomTabsOptions(
  t: AppTheme,
  opts: TabsOptions = {},
): BottomTabNavigationOptions {
  const isDark = t.mode === "dark";
  const bottomInset = opts.bottomInset ?? 0;
  const blur = opts.blur ?? true;

  return {
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: t.colors.tabBarTint,
    tabBarInactiveTintColor: t.colors.tabBarInactive,
    animation: opts.animation,

    tabBarButton: (p) => <AnimatedTabBarButton {...p} theme={t} />,

    tabBarLabelStyle: {
      fontSize: 11,
      fontFamily: typography.fontFamily.ui,
      fontWeight: typography.weight.semibold,
      marginTop: -2,
    },
    tabBarIconStyle: { marginTop: 6 },

    tabBarStyle: {
      position: "absolute",
      left: spacing[4],
      right: spacing[4],
      bottom: spacing[3] + bottomInset,
      height: 64,
      borderRadius: radius.lg,
      borderTopWidth: 1,
      borderTopColor: t.colors.tabBarBorder,
      backgroundColor: t.colors.tabBarBg,
      ...shadow("card"),
      overflow: "hidden",
    },

    tabBarBackground: blur
      ? () => (
          <BlurView
            tint={isDark ? "dark" : "light"}
            intensity={90}
            style={StyleSheet.absoluteFill}
          />
        )
      : undefined,
  };
}
