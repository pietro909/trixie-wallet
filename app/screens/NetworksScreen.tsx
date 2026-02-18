import * as React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useAppTheme } from "../theme/theme";

export default function NetworksScreen() {
  const t = useAppTheme();
  return (
    <View style={[styles.container, { backgroundColor: t.colors.background }]}>
      <Text style={[styles.title, { color: t.colors.text }]}>Networks</Text>
      <Text style={[styles.subtitle, { color: t.colors.textMuted }]}>
        Replace this stub with your real screen.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { marginTop: 8, fontSize: 14 },
});
