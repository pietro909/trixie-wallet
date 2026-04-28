import * as React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Network } from "lucide-react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import { useToast } from "../components/ToastProvider";
import Button from "../components/Button";
import { spacing, typography, radius } from "../theme/theme";

const STATUS_LABELS: Record<string, string> = {
  idle: "Not checked",
  connecting: "Connecting…",
  online: "Online",
  offline: "Offline",
};

export default function NetworksScreen() {
  const theme = useResolvedTheme();
  const { showToast } = useToast();
  const networkState = useAppStore((s) => s.network);
  const wallet = useAppStore((s) => s.wallet);
  const setArkServerUrl = useAppStore((s) => s.setArkServerUrl);
  const refreshServer = useAppStore((s) => s.refreshServer);

  const [draft, setDraft] = React.useState(networkState.arkServerUrl);
  const isDirty = draft.trim() !== networkState.arkServerUrl;
  const isConnecting = networkState.status === "connecting";

  React.useEffect(() => {
    if (networkState.status === "idle") {
      refreshServer();
    }
  }, [networkState.status, refreshServer]);

  async function handleApply() {
    if (!isDirty) return;
    if (wallet) {
      showToast("Reset the wallet before changing the server", "error");
      setDraft(networkState.arkServerUrl);
      return;
    }
    await setArkServerUrl(draft);
    await refreshServer();
  }

  async function handleTest() {
    await refreshServer();
    const status = useAppStore.getState().network.status;
    if (status === "online") {
      showToast("Server reachable", "success");
    } else if (status === "offline") {
      showToast(
        useAppStore.getState().network.lastError ?? "Server unreachable",
        "error",
      );
    }
  }

  const statusColor =
    networkState.status === "online"
      ? theme.colors.success
      : networkState.status === "offline"
        ? theme.colors.danger
        : theme.colors.textSubtle;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Network color={theme.colors.primary} size={48} />
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Arkade server
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
          Trixie talks to one Arkade server at a time. Mutinynet is the safe
          default for prototype work.
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
            ...theme.shadow("card"),
          },
        ]}
      >
        <Text style={[styles.label, { color: theme.colors.textMuted }]}>
          Server URL
        </Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isConnecting && !wallet}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: theme.colors.border,
            },
          ]}
        />
        {wallet ? (
          <Text style={[styles.hint, { color: theme.colors.textSubtle }]}>
            Server is locked once a wallet exists. Reset to switch.
          </Text>
        ) : null}
        <View style={styles.row}>
          <Text style={[styles.label, { color: theme.colors.textMuted }]}>
            Status
          </Text>
          <Text style={[styles.statusValue, { color: statusColor }]}>
            {STATUS_LABELS[networkState.status]}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: theme.colors.textMuted }]}>
            Detected network
          </Text>
          <Text style={[styles.value, { color: theme.colors.text }]}>
            {networkState.detectedNetwork ?? "—"}
          </Text>
        </View>
        {networkState.lastError ? (
          <Text style={[styles.errorText, { color: theme.colors.danger }]}>
            {networkState.lastError}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {isDirty ? (
          <Button
            label="Apply server"
            theme={theme}
            onPress={handleApply}
            loading={isConnecting}
            disabled={isConnecting || !!wallet}
          />
        ) : null}
        <Button
          label="Test connection"
          variant="secondary"
          theme={theme}
          onPress={handleTest}
          loading={isConnecting}
          disabled={isConnecting}
          style={isDirty ? styles.testBtn : undefined}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
  },
  header: {
    alignItems: "center",
    paddingVertical: spacing[6],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginTop: spacing[3],
  },
  subtitle: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    textAlign: "center",
    lineHeight: typography.lineHeight.sm,
  },
  card: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  label: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  input: {
    fontSize: typography.size.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing[2],
  },
  hint: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing[4],
  },
  value: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  statusValue: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  errorText: {
    fontSize: typography.size.xs,
    marginTop: spacing[3],
  },
  actions: {
    marginTop: spacing[5],
  },
  testBtn: {
    marginTop: spacing[3],
  },
});
