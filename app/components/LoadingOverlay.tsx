import * as React from "react";
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { type AppTheme, spacing, typography } from "../theme/theme";

type Props = {
  visible: boolean;
  message?: string;
  theme: AppTheme;
};

export default function LoadingOverlay({ visible, message, theme }: Props) {
  const opacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.overlay, { backgroundColor: theme.colors.scrim, opacity }]}
      pointerEvents="auto"
    >
      <View style={[styles.card, { backgroundColor: theme.colors.card }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        {message ? (
          <Text style={[styles.message, { color: theme.colors.text }]}>
            {message}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  card: {
    padding: spacing[6],
    borderRadius: 16,
    alignItems: "center",
    minWidth: 200,
  },
  message: {
    marginTop: spacing[4],
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    textAlign: "center",
  },
});
