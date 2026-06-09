import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AlertTriangle } from "lucide-react-native";
import * as React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Button from "../components/Button";
import LoadingOverlay from "../components/LoadingOverlay";
import { useToast } from "../components/ToastProvider";
import { useLoading } from "../hooks/useLoading";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import { BackupError } from "../services/backup/crypto";
import { PayloadParseError } from "../services/backup/serializer";
import { restoreLoadingMessage } from "../store/restoreProgress";
import { useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

type Nav = NativeStackNavigationProp<
  RootStackParamList,
  "RestoreBackupPassword"
>;
type Route = RouteProp<RootStackParamList, "RestoreBackupPassword">;

export default function RestoreBackupPasswordScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const envelope = route.params.envelope;
  const importBackup = useAppStore((s) => s.importBackup);
  const restoreProgress = useAppStore((s) => s.restoreProgress);
  const { showToast } = useToast();
  const { isLoading, message, show, hide } = useLoading();

  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const created = new Date(envelope.createdAt);
  const summary = `Backup from ${created.toLocaleString()} · v${envelope.version}`;

  const loadingMessage = restoreLoadingMessage(restoreProgress, message);

  async function handleSubmit() {
    if (password.length === 0) {
      setError("Enter the backup password");
      return;
    }
    setError(null);
    show("Verifying password…");
    // Yield one event-loop tick so React paints the LoadingOverlay before
    // we kick off pbkdf2Async, which runs ~10ms of synchronous JS before
    // its first internal yield. Without this, the button looks frozen for
    // the entire decrypt+import on slow devices and the emulator.
    await new Promise((r) => setTimeout(r, 0));
    try {
      await importBackup(envelope, password);
      // Navigation auto-redirects to Main when wallet exists.
    } catch (e) {
      if (e instanceof BackupError && e.kind === "wrong_password") {
        setError("Incorrect password");
      } else if (e instanceof BackupError && e.kind === "unsupported_version") {
        setError(
          "This backup was made by a different version of Trixie. Update the app and try again.",
        );
      } else if (e instanceof BackupError) {
        setError(e.message);
      } else if (e instanceof PayloadParseError) {
        setError("This backup file is not valid Trixie data.");
      } else {
        const msg = e instanceof Error ? e.message : "Restore failed";
        setError(msg);
        showToast(msg, "error");
      }
    } finally {
      hide();
    }
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.content}>
        <Text style={[styles.heading, { color: theme.colors.text }]}>
          Backup password
        </Text>
        <Text style={[styles.summary, { color: theme.colors.textMuted }]}>
          {summary}
        </Text>

        <View
          style={[
            styles.advisory,
            { backgroundColor: `${theme.colors.warning}20` },
          ]}
        >
          <AlertTriangle color={theme.colors.warning} size={14} />
          <Text style={[styles.advisoryText, { color: theme.colors.text }]}>
            Decryption can take 5–15 seconds. Keep the app open until it
            finishes.
          </Text>
        </View>

        <TextInput
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            setError(null);
          }}
          placeholder="Backup password"
          placeholderTextColor={theme.colors.placeholder}
          secureTextEntry
          autoFocus
          editable={!isLoading}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: error ? theme.colors.danger : theme.colors.border,
            },
          ]}
        />

        {error ? (
          <Text style={[styles.error, { color: theme.colors.danger }]}>
            {error}
          </Text>
        ) : null}

        <Button
          label="Restore"
          theme={theme}
          onPress={handleSubmit}
          disabled={isLoading || password.length === 0}
          loading={isLoading}
          style={styles.submitBtn}
        />

        <Button
          label="Use a different file"
          variant="ghost"
          theme={theme}
          onPress={() => nav.goBack()}
          disabled={isLoading}
          style={styles.cancelBtn}
        />
      </View>

      <LoadingOverlay
        visible={isLoading}
        message={loadingMessage}
        theme={theme}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
  },
  heading: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  summary: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    marginBottom: spacing[5],
  },
  input: {
    fontSize: typography.size.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  error: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
  },
  submitBtn: {
    marginTop: spacing[5],
  },
  cancelBtn: {
    marginTop: spacing[2],
  },
  advisory: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.sm,
    marginBottom: spacing[4],
  },
  advisoryText: {
    flex: 1,
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
  },
});
