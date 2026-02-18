import * as React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Info } from "lucide-react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import Button from "../components/Button";
import { spacing, typography, radius } from "../theme/theme";

function validateKey(value: string): "nsec" | "hex" | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("nsec1") && trimmed.length >= 60) return "nsec";
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return "hex";
  return null;
}

export default function RestoreWallet() {
  const theme = useResolvedTheme();
  const [key, setKey] = React.useState("");
  const keyFormat = key.length > 0 ? validateKey(key) : undefined;

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.content}>
        <Text style={[styles.label, { color: theme.colors.text }]}>
          Private Key
        </Text>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder="nsec1... or hex"
          placeholderTextColor={theme.colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor:
                keyFormat === undefined
                  ? theme.colors.border
                  : keyFormat
                    ? theme.colors.success
                    : theme.colors.danger,
            },
          ]}
        />
        {key.length > 0 && (
          <Text
            style={[
              styles.validation,
              { color: keyFormat ? theme.colors.success : theme.colors.danger },
            ]}
          >
            {keyFormat ? `Valid ${keyFormat.toUpperCase()} key` : "Invalid key format"}
          </Text>
        )}

        <Text style={[styles.label, { color: theme.colors.text, marginTop: spacing[6] }]}>
          Seed Phrase
        </Text>
        <TextInput
          editable={false}
          placeholder="Seed phrase restore (coming soon)"
          placeholderTextColor={theme.colors.placeholder}
          style={[
            styles.input,
            {
              color: theme.colors.textSubtle,
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: theme.colors.border,
              opacity: 0.5,
            },
          ]}
        />

        <View
          style={[styles.wipBanner, { backgroundColor: theme.colors.primarySoft }]}
        >
          <Info color={theme.colors.primary} size={20} />
          <Text style={[styles.wipText, { color: theme.colors.primary }]}>
            Wallet restore is a work in progress
          </Text>
        </View>

        <Button
          label="Restore"
          theme={theme}
          onPress={() => {}}
          disabled
          style={styles.submitBtn}
        />
      </View>
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
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[2],
  },
  input: {
    fontSize: typography.size.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  validation: {
    fontSize: typography.size.xs,
    marginTop: spacing[1],
  },
  wipBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    marginTop: spacing[6],
  },
  wipText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  submitBtn: {
    marginTop: spacing[5],
  },
});
