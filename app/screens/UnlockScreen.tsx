import * as React from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Fingerprint, WalletMinimal } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import Button from "../components/Button";
import { spacing, typography, radius } from "../theme/theme";

export default function UnlockScreen() {
  const theme = useResolvedTheme();
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const unlockWithPassword = useAppStore((s) => s.unlockWithPassword);
  const unlockWithBiometrics = useAppStore((s) => s.unlockWithBiometrics);
  const biometricsEnabled = useAppStore((s) => s.security.biometricsEnabled);

  const shakeAnim = React.useRef(new Animated.Value(0)).current;

  function shake() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  function handlePasswordUnlock() {
    setError("");
    const ok = unlockWithPassword(password);
    if (!ok) {
      setError("Incorrect password");
      shake();
    }
  }

  async function handleBiometrics() {
    setLoading(true);
    const ok = await unlockWithBiometrics();
    setLoading(false);
    if (!ok) {
      setError("Biometric authentication failed");
      shake();
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: only auto-trigger on mount
  React.useEffect(() => {
    if (biometricsEnabled) {
      const timer = setTimeout(() => {
        unlockWithBiometrics().then((ok) => {
          if (!ok) {
            setError("Biometric authentication failed");
            shake();
          }
        });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.top}>
        <WalletMinimal color={theme.colors.primary} size={56} />
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Welcome back
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
          Enter your password to unlock
        </Text>
      </View>

      <Animated.View
        style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}
      >
        <TextInput
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            setError("");
          }}
          placeholder="Password"
          placeholderTextColor={theme.colors.placeholder}
          secureTextEntry
          autoFocus
          onSubmitEditing={handlePasswordUnlock}
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
          label="Unlock"
          theme={theme}
          onPress={handlePasswordUnlock}
          disabled={!password}
          style={styles.unlockBtn}
        />

        {biometricsEnabled && (
          <Button
            label="Use Biometrics"
            variant="secondary"
            theme={theme}
            onPress={handleBiometrics}
            loading={loading}
            icon={<Fingerprint color={theme.colors.text} size={20} />}
            style={styles.bioBtn}
          />
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing[6],
  },
  top: {
    alignItems: "center",
    paddingTop: 80,
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginTop: spacing[5],
  },
  subtitle: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
  },
  form: {
    marginTop: spacing[8],
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
    marginTop: spacing[1],
  },
  unlockBtn: {
    marginTop: spacing[4],
  },
  bioBtn: {
    marginTop: spacing[3],
  },
});
