import * as React from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type ToastType, toastEmitter } from "../services/toast-emitter";
import { radius, spacing, typography, useAppTheme } from "../theme/theme";

type ToastState = {
  message: string;
  type: ToastType;
  key: number;
} | null;

/**
 * Single-path toast hook: returns a `showToast` bound to the global
 * `toastEmitter`. Component callers use this for ergonomics; non-component
 * services (e.g. the swap-poll resume drain in `lightning.ts`) call
 * `toastEmitter.show` directly. Both routes converge on the same listener
 * attached by `ToastProvider`, so there is one visible toast surface.
 */
const TOAST_API = {
  showToast: (message: string, type: ToastType = "info") =>
    toastEmitter.show(message, type),
} as const;

export function useToast() {
  return TOAST_API;
}

export default function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [toast, setToast] = React.useState<ToastState>(null);
  const translateY = React.useRef(new Animated.Value(-80)).current;
  const opacity = React.useRef(new Animated.Value(0)).current;
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    return toastEmitter.addListener((message, type) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, type, key: Date.now() });
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          speed: 16,
          bounciness: 4,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
      timerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -80,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => setToast(null));
      }, 3000);
    });
  }, [translateY, opacity]);

  const bgColor =
    toast?.type === "success"
      ? theme.colors.success
      : toast?.type === "error"
        ? theme.colors.danger
        : theme.colors.primary;

  return (
    <>
      {children}
      {toast ? (
        <Animated.View
          style={[
            styles.toast,
            {
              backgroundColor: bgColor,
              top: insets.top + spacing[3],
              transform: [{ translateY }],
              opacity,
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.text}>{toast.message}</Text>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: spacing[4],
    right: spacing[4],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    zIndex: 2000,
    alignItems: "center",
  },
  text: {
    color: "#ffffff",
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
});
