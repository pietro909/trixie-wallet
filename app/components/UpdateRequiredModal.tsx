import { AlertTriangle } from "lucide-react-native";
import type * as React from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

/**
 * App-level, non-dismissable prompt shown when arkd rejects the client build
 * (`BUILD_VERSION_TOO_OLD`). Mounted near the root navigation tree so it can
 * appear during onboarding, wallet refresh, send/receive, or Profile flows —
 * not only on the Wallet screen. There are no validated store URLs in this
 * milestone, so it shows update instructions rather than a broken link button.
 */
export default function UpdateRequiredModal(): React.ReactElement | null {
  const theme = useResolvedTheme();
  const updateRequired = useAppStore((s) => s._updateRequired);

  if (!updateRequired) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // Non-dismissable: swallow the Android hardware back button so the prompt
      // cannot be closed without updating.
      onRequestClose={() => {}}
    >
      <View style={[styles.scrim, { backgroundColor: theme.colors.scrim }]}>
        <View
          accessibilityRole="alert"
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              ...theme.shadow("popover"),
            },
          ]}
        >
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: theme.colors.dangerSoft },
            ]}
          >
            <AlertTriangle color={theme.colors.danger} size={28} />
          </View>
          <Text style={[styles.title, { color: theme.colors.text }]}>
            Update required
          </Text>
          <Text style={[styles.body, { color: theme.colors.textMuted }]}>
            A server update requires a newer version of Trixie Wallet. Update
            the app to continue.
          </Text>
          <Text
            style={[styles.instructions, { color: theme.colors.textSubtle }]}
          >
            Update Trixie Wallet from where you installed it, then reopen the
            app.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[6],
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing[6],
    alignItems: "center",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing[4],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    textAlign: "center",
  },
  body: {
    fontSize: typography.size.md,
    textAlign: "center",
    marginTop: spacing[3],
    lineHeight: 22,
  },
  instructions: {
    fontSize: typography.size.sm,
    textAlign: "center",
    marginTop: spacing[4],
    lineHeight: 20,
  },
});
