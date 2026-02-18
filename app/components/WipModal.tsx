import * as React from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import { Construction } from "lucide-react-native";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  feature?: string;
  theme: AppTheme;
};

export default function WipModal({ visible, onClose, feature, theme }: Props) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  const scale = React.useRef(new Animated.Value(0.9)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 16,
          bounciness: 4,
        }),
      ]).start();
    } else {
      opacity.setValue(0);
      scale.setValue(0.9);
    }
  }, [visible, opacity, scale]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View
        style={[styles.backdrop, { backgroundColor: theme.colors.scrim, opacity }]}
      >
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.card,
              transform: [{ scale }],
            },
          ]}
        >
          <Construction color={theme.colors.primary} size={48} />
          <Text style={[styles.title, { color: theme.colors.text }]}>
            Work in Progress
          </Text>
          <Text style={[styles.body, { color: theme.colors.textMuted }]}>
            {feature ? `${feature} is` : "This feature is"} coming soon.
          </Text>
          <Pressable
            onPress={onClose}
            style={[styles.button, { backgroundColor: theme.colors.primary }]}
          >
            <Text style={styles.buttonText}>Got it</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: 280,
    padding: spacing[6],
    borderRadius: radius.lg,
    alignItems: "center",
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    marginTop: spacing[4],
  },
  body: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    textAlign: "center",
  },
  button: {
    marginTop: spacing[5],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[6],
    borderRadius: radius.md,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
});
