import * as LocalAuthentication from "expo-local-authentication";
import { ShieldCheck, X } from "lucide-react-native";
import * as React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";
import Button from "./Button";

interface AuthGateProps {
  visible: boolean;
  title: string;
  message: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function AuthGate({
  visible,
  title,
  message,
  onSuccess,
  onCancel,
}: AuthGateProps) {
  const theme = useResolvedTheme();
  const biometricsEnabled = useAppStore((s) => s.security.biometricsEnabled);
  const hasPassword = useAppStore((s) => !!s.security.passwordHash);
  const verifyPassword = useAppStore((s) => s.verifyPassword);

  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  // Tracks the active auth session to prevent cross-session leaks.
  // Incrementing this invalidates all pending async attempts from prior opens.
  const sessionIdRef = React.useRef(0);
  const sessionActiveRef = React.useRef(false);
  const previousVisibleRef = React.useRef(false);
  const onSuccessRef = React.useRef(onSuccess);

  // Tracks if the user was already prompted for biometrics in the current session
  // to prevent re-triggering on effect dependency changes while visible.
  const promptedRef = React.useRef(false);

  React.useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const resetState = React.useCallback(() => {
    setPassword("");
    setError("");
    setLoading(false);
  }, []);

  const invalidateSession = React.useCallback(() => {
    sessionIdRef.current += 1;
    sessionActiveRef.current = false;
    promptedRef.current = false;
  }, []);

  const startSession = React.useCallback(() => {
    sessionIdRef.current += 1;
    sessionActiveRef.current = true;
    promptedRef.current = false;
    return sessionIdRef.current;
  }, []);

  const isActiveSession = React.useCallback((sessionId: number) => {
    return sessionActiveRef.current && sessionIdRef.current === sessionId;
  }, []);

  const completeSuccess = React.useCallback(
    (sessionId: number) => {
      if (!isActiveSession(sessionId)) return;
      invalidateSession();
      resetState();
      onSuccessRef.current();
    },
    [invalidateSession, isActiveSession, resetState],
  );

  const handleBiometrics = React.useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!isActiveSession(sessionId)) return;
    promptedRef.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: title,
        fallbackLabel: "Use password",
      });
      if (result.success) {
        completeSuccess(sessionId);
      }
    } catch {
      // Fallback to password entry
    }
  }, [completeSuccess, isActiveSession, title]);

  React.useEffect(() => {
    const wasVisible = previousVisibleRef.current;
    previousVisibleRef.current = visible;

    if (visible && !wasVisible) {
      const sessionId = startSession();
      if (!hasPassword) {
        completeSuccess(sessionId);
        return;
      }
      if (biometricsEnabled && !promptedRef.current) {
        void handleBiometrics();
      }
      return;
    }

    if (!visible && wasVisible) {
      invalidateSession();
      resetState();
    }
  }, [
    visible,
    hasPassword,
    biometricsEnabled,
    completeSuccess,
    handleBiometrics,
    invalidateSession,
    resetState,
    startSession,
  ]);

  React.useEffect(() => {
    return () => {
      invalidateSession();
    };
  }, [invalidateSession]);

  async function handleSubmit() {
    const sessionId = sessionIdRef.current;
    if (!isActiveSession(sessionId)) return;
    setError("");
    setLoading(true);
    try {
      const ok = await verifyPassword(password);
      if (!isActiveSession(sessionId)) return;

      if (ok) {
        completeSuccess(sessionId);
      } else {
        setError("Invalid password");
      }
    } finally {
      if (isActiveSession(sessionId)) {
        setLoading(false);
      }
    }
  }

  function handleCancel() {
    invalidateSession();
    resetState();
    onCancel();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <View
          style={[
            styles.content,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              ...theme.shadow("card"),
            },
          ]}
        >
          <View style={styles.header}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: `${theme.colors.primary}15` },
              ]}
            >
              <ShieldCheck color={theme.colors.primary} size={24} />
            </View>
            <Pressable
              onPress={handleCancel}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Cancel authentication"
            >
              <X color={theme.colors.textMuted} size={20} />
            </Pressable>
          </View>

          <View style={styles.body}>
            <Text style={[styles.title, { color: theme.colors.text }]}>
              {title}
            </Text>
            <Text style={[styles.message, { color: theme.colors.textMuted }]}>
              {message}
            </Text>
          </View>

          <TextInput
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError("");
            }}
            placeholder="Enter wallet password"
            placeholderTextColor={theme.colors.placeholder}
            secureTextEntry
            autoFocus
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

          <View style={styles.actions}>
            <Button
              label="Authorize"
              theme={theme}
              onPress={handleSubmit}
              loading={loading}
              disabled={!password || loading}
              style={styles.submitBtn}
            />
            {biometricsEnabled && (
              <Button
                label="Use Biometrics"
                variant="ghost"
                theme={theme}
                onPress={() => {
                  void handleBiometrics();
                }}
                disabled={loading}
                style={styles.bioBtn}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: spacing[5],
  },
  content: {
    padding: spacing[5],
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing[4],
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    padding: spacing[1],
  },
  body: {
    gap: spacing[1],
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
  },
  message: {
    fontSize: typography.size.sm,
    lineHeight: typography.lineHeight.sm,
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
    marginTop: -spacing[2],
  },
  actions: {
    gap: spacing[2],
  },
  submitBtn: {
    width: "100%",
  },
  bioBtn: {
    width: "100%",
  },
});
