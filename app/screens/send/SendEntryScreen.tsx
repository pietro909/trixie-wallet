import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  Camera as CameraIcon,
  ClipboardPaste,
  ScanLine,
  X,
} from "lucide-react-native";
import * as React from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Button from "../../components/Button";
import { useToast } from "../../components/ToastProvider";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import {
  networkNameOrNull,
  parsePaymentInput,
} from "../../services/paymentParser";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "SendEntry">;

export default function SendEntryScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const isFocused = useIsFocused();
  const { showToast } = useToast();

  const [permission, requestPermission] = useCameraPermissions();
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const scanLockRef = React.useRef(false);
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );

  // Reset scanner lock when the screen regains focus so the user can re-scan.
  React.useEffect(() => {
    if (isFocused) {
      scanLockRef.current = false;
      setBusy(false);
    }
  }, [isFocused]);

  const reticleAnim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(reticleAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(reticleAnim, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reticleAnim]);

  function handleParse(input: string, source: "scan" | "submit") {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = parsePaymentInput(input, {
        network: networkNameOrNull(network),
      });
      if (result.error || result.options.length === 0) {
        setError(result.error ?? "No payable target found");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        scanLockRef.current = false;
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.options.length === 1) {
        nav.navigate("SendAmount", { option: result.options[0] });
      } else {
        nav.navigate("SendOptions", { rawInput: input });
      }
    } catch {
      setError("Could not parse input");
      scanLockRef.current = false;
    } finally {
      // unlock scanner after navigation has settled, in case user comes back
      setTimeout(
        () => {
          scanLockRef.current = false;
          setBusy(false);
        },
        source === "scan" ? 800 : 200,
      );
    }
  }

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Paste or scan a payment string first");
      return;
    }
    handleParse(trimmed, "submit");
  }

  async function handlePaste() {
    try {
      const value = await Clipboard.getStringAsync();
      if (!value) {
        showToast("Clipboard is empty", "info");
        return;
      }
      setText(value);
      setError(null);
      Haptics.selectionAsync();
    } catch {
      showToast("Could not read clipboard", "error");
    }
  }

  function handleClear() {
    setText("");
    setError(null);
  }

  const status = permission?.status;
  const showCamera = status === "granted";
  // Mount the camera only when the screen is focused — otherwise a stale
  // QR in frame will re-fire when the user navigates back.
  const cameraActive = showCamera && isFocused;

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View
          style={[
            styles.scanner,
            { backgroundColor: theme.colors.surfaceSubtle },
          ]}
        >
          {cameraActive ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={(result) => {
                if (scanLockRef.current) return;
                if (!result?.data) return;
                scanLockRef.current = true;
                handleParse(result.data, "scan");
              }}
            />
          ) : status === "denied" ? (
            <View style={styles.permissionBlock}>
              <CameraIcon color={theme.colors.textSubtle} size={36} />
              <Text
                style={[styles.permissionTitle, { color: theme.colors.text }]}
              >
                Camera access denied
              </Text>
              <Text
                style={[
                  styles.permissionBody,
                  { color: theme.colors.textMuted },
                ]}
              >
                Enable camera access in system settings to scan QR codes, or
                paste a payment string below.
              </Text>
            </View>
          ) : (
            <View style={styles.permissionBlock}>
              <ScanLine color={theme.colors.textSubtle} size={36} />
              <Text
                style={[styles.permissionTitle, { color: theme.colors.text }]}
              >
                Scan QR codes
              </Text>
              <Text
                style={[
                  styles.permissionBody,
                  { color: theme.colors.textMuted },
                ]}
              >
                Allow the camera to scan a payment QR.
              </Text>
              <Pressable
                onPress={requestPermission}
                style={[
                  styles.permBtn,
                  { backgroundColor: theme.colors.primary },
                ]}
              >
                <Text style={styles.permBtnLabel}>Enable camera</Text>
              </Pressable>
            </View>
          )}

          {cameraActive ? (
            <View pointerEvents="none" style={styles.reticleWrap}>
              <Animated.View
                style={[
                  styles.reticle,
                  {
                    borderColor: theme.colors.primary,
                    transform: [
                      {
                        scale: reticleAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.94, 1.02],
                        }),
                      },
                    ],
                    opacity: reticleAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.6, 1],
                    }),
                  },
                ]}
              />
              <Text style={styles.reticleHint}>Point at a QR code</Text>
            </View>
          ) : null}

          {busy && cameraActive ? (
            <View style={styles.scannerLoading} pointerEvents="none">
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </View>

        <View style={styles.inputArea}>
          <Text style={[styles.inputLabel, { color: theme.colors.textMuted }]}>
            Or paste a payment string
          </Text>
          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: theme.colors.surfaceSubtle,
                borderColor: error ? theme.colors.danger : theme.colors.border,
              },
            ]}
          >
            <TextInput
              value={text}
              onChangeText={(t) => {
                setText(t);
                if (error) setError(null);
              }}
              placeholder="ark1…, tark1…, bc1…, lnbc…, lnurl…, bitcoin:…"
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={[styles.input, { color: theme.colors.text }]}
              accessibilityLabel="Payment string"
            />
            {text.length > 0 ? (
              <Pressable
                onPress={handleClear}
                accessibilityLabel="Clear"
                style={styles.clearBtn}
              >
                <X color={theme.colors.textSubtle} size={18} />
              </Pressable>
            ) : null}
          </View>

          {error ? (
            <Text style={[styles.error, { color: theme.colors.danger }]}>
              {error}
            </Text>
          ) : null}

          <View style={styles.row}>
            <Pressable
              onPress={handlePaste}
              accessibilityLabel="Paste from clipboard"
              style={({ pressed }) => [
                styles.pasteBtn,
                {
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <ClipboardPaste color={theme.colors.text} size={16} />
              <Text style={[styles.pasteLabel, { color: theme.colors.text }]}>
                Paste
              </Text>
            </Pressable>
            <Button
              label="Continue"
              theme={theme}
              loading={busy}
              disabled={!text.trim()}
              onPress={handleSubmit}
              style={styles.continueBtn}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  scanner: {
    height: 320,
    margin: spacing[5],
    borderRadius: radius.lg,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    width: 200,
    height: 200,
    borderWidth: 3,
    borderRadius: radius.md,
  },
  reticleHint: {
    color: "#ffffff",
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[3],
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 4,
  },
  scannerLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  permissionBlock: {
    alignItems: "center",
    padding: spacing[5],
  },
  permissionTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[3],
  },
  permissionBody: {
    fontSize: typography.size.sm,
    textAlign: "center",
    marginTop: spacing[2],
  },
  permBtn: {
    marginTop: spacing[4],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
  },
  permBtnLabel: {
    color: "#ffffff",
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  inputArea: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
  },
  inputLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing[2],
  },
  inputWrap: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingRight: spacing[2],
    flexDirection: "row",
    alignItems: "flex-start",
  },
  input: {
    flex: 1,
    minHeight: 56,
    maxHeight: 120,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    fontSize: typography.size.sm,
    fontFamily: typography.fontFamily.mono,
  },
  clearBtn: {
    padding: spacing[3],
  },
  error: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
  },
  row: {
    flexDirection: "row",
    gap: spacing[3],
    marginTop: spacing[4],
    alignItems: "stretch",
  },
  pasteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderRadius: radius.md,
    gap: spacing[2],
    minHeight: 48,
  },
  pasteLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  continueBtn: {
    flex: 1,
  },
});
