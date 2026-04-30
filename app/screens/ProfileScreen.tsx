import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  ChevronRight,
  CircleUserRound,
  Lock,
  Settings,
  Shield,
  Trash2,
} from "lucide-react-native";
import type * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import { useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "Main">;

type MenuRoute =
  | "ProfilePreferences"
  | "ProfileBackup"
  | "ProfileLock"
  | "ProfileReset";

type MenuItem = {
  label: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  route: MenuRoute;
  danger?: boolean;
};

const MENU_ITEMS: MenuItem[] = [
  { label: "Preferences", icon: Settings, route: "ProfilePreferences" },
  { label: "Backup", icon: Shield, route: "ProfileBackup" },
  { label: "Lock Wallet", icon: Lock, route: "ProfileLock" },
  { label: "Reset Wallet", icon: Trash2, route: "ProfileReset", danger: true },
];

export default function ProfileScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const wallet = useAppStore((s) => s.wallet);

  const walletId = wallet?.id ?? "";
  const shortId = walletId
    ? `${walletId.slice(0, 8)}...${walletId.slice(-4)}`
    : "—";

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      {/* User Section */}
      <View style={styles.userSection}>
        <View
          style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}
        >
          <CircleUserRound color={theme.colors.primary} size={40} />
        </View>
        <Text
          style={[styles.walletIdLabel, { color: theme.colors.textSubtle }]}
        >
          {shortId}
        </Text>
      </View>

      {/* Menu Items */}
      <View
        style={[
          styles.menuCard,
          {
            backgroundColor: theme.colors.card,
            ...theme.shadow("card"),
          },
        ]}
      >
        {MENU_ITEMS.map((item, i) => (
          <Pressable
            key={item.route}
            onPress={() => nav.navigate(item.route)}
            style={({ pressed }) => [
              styles.menuItem,
              i < MENU_ITEMS.length - 1 && {
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.divider,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <item.icon
              color={item.danger ? theme.colors.danger : theme.colors.textMuted}
              size={22}
            />
            <Text
              style={[
                styles.menuLabel,
                {
                  color: item.danger ? theme.colors.danger : theme.colors.text,
                },
              ]}
            >
              {item.label}
            </Text>
            <ChevronRight color={theme.colors.textSubtle} size={18} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
  },
  userSection: {
    alignItems: "center",
    paddingVertical: spacing[6],
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  walletIdLabel: {
    fontSize: typography.size.xs,
    fontFamily: typography.fontFamily.mono,
    marginTop: spacing[3],
  },
  menuCard: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  menuLabel: {
    flex: 1,
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    marginLeft: spacing[3],
  },
});
