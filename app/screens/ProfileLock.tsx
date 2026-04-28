import * as React from "react";
import {
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Lock } from "lucide-react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import { useToast } from "../components/ToastProvider";
import Button from "../components/Button";
import { spacing, typography, radius } from "../theme/theme";

export default function ProfileLock() {
  const theme = useResolvedTheme();
  const { showToast } = useToast();
  const hasPassword = useAppStore((s) => !!s.security.passwordHash);
  const setPassword = useAppStore((s) => s.setPassword);
  const toggleBiometrics = useAppStore((s) => s.toggleBiometrics);
  const lockWallet = useAppStore((s) => s.lockWallet);

  const [password, setPasswordInput] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [biometrics, setBiometrics] = React.useState(false);
  const [error, setError] = React.useState("");

  async function handleSetAndLock() {
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setError("");
    setPassword(password);
    if (biometrics) toggleBiometrics(true);
    await lockWallet();
    showToast("Wallet locked", "info");
  }

  async function handleLockNow() {
    await lockWallet();
    showToast("Wallet locked", "info");
  }

  if (hasPassword) {
    return (
      <SafeAreaView
        edges={["bottom"]}
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <View style={styles.centered}>
          <Lock color={theme.colors.primary} size={56} />
          <Text style={[styles.heading, { color: theme.colors.text }]}>
            Lock your wallet?
          </Text>
          <Text style={[styles.body, { color: theme.colors.textMuted }]}>
            You will need your password to unlock.
          </Text>
          <Button
            label="Lock Now"
            theme={theme}
            onPress={handleLockNow}
            style={styles.lockBtn}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.form}>
        <Text style={[styles.heading, { color: theme.colors.text }]}>
          Set a Password
        </Text>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>
          Protect your wallet with a password.
        </Text>

        <TextInput
          value={password}
          onChangeText={(t) => {
            setPasswordInput(t);
            setError("");
          }}
          placeholder="Password (min 6 characters)"
          placeholderTextColor={theme.colors.placeholder}
          secureTextEntry
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: error ? theme.colors.danger : theme.colors.border,
            },
          ]}
        />

        <TextInput
          value={confirm}
          onChangeText={(t) => {
            setConfirm(t);
            setError("");
          }}
          placeholder="Confirm password"
          placeholderTextColor={theme.colors.placeholder}
          secureTextEntry
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: error ? theme.colors.danger : theme.colors.border,
              marginTop: spacing[3],
            },
          ]}
        />

        {error ? (
          <Text style={[styles.error, { color: theme.colors.danger }]}>
            {error}
          </Text>
        ) : null}

        <View style={styles.bioRow}>
          <Text style={[styles.bioLabel, { color: theme.colors.text }]}>
            Enable Biometrics
          </Text>
          <Switch
            value={biometrics}
            onValueChange={setBiometrics}
            trackColor={{
              false: theme.colors.border,
              true: theme.colors.primary,
            }}
          />
        </View>

        <Button
          label="Set Password & Lock"
          theme={theme}
          onPress={handleSetAndLock}
          disabled={!password || !confirm}
          style={styles.submitBtn}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing[5],
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  form: {
    paddingTop: spacing[6],
  },
  heading: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginTop: spacing[4],
  },
  body: {
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
  bioRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing[5],
  },
  bioLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  submitBtn: {
    marginTop: spacing[6],
  },
  lockBtn: {
    marginTop: spacing[6],
    width: "100%",
  },
});
