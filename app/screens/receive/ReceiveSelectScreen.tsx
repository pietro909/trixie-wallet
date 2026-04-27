import * as React from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  Bitcoin,
  ChevronRight,
  Globe,
  Layers,
  Zap,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import type { ReceiveType } from "../../services/receive";
import { motion, radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "ReceiveSelect">;

type Option = {
  type: ReceiveType;
  title: string;
  helper: string;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
};

const OPTIONS: Option[] = [
  {
    type: "arkade",
    title: "Arkade",
    helper: "Instant off-chain VTXO transfer.",
    Icon: Layers,
  },
  {
    type: "bitcoin",
    title: "Bitcoin",
    helper: "On-chain payment to a native segwit address.",
    Icon: Bitcoin,
  },
  {
    type: "lightning",
    title: "Lightning",
    helper: "Generate a BOLT-11 invoice for a fixed amount.",
    Icon: Zap,
  },
  {
    type: "lnurl",
    title: "LNURL",
    helper: "Static pay endpoint. Sender chooses the amount.",
    Icon: Globe,
  },
];

function OptionCard({
  option,
  onPress,
}: {
  option: Option;
  onPress: () => void;
}) {
  const theme = useResolvedTheme();
  const scale = React.useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={option.title}
        onPressIn={() =>
          Animated.spring(scale, {
            toValue: motion.press.scaleDown,
            useNativeDriver: true,
            speed: 22,
            bounciness: 0,
          }).start()
        }
        onPressOut={() =>
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 18,
            bounciness: 6,
          }).start()
        }
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
            ...theme.shadow("card"),
          },
        ]}
      >
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: theme.colors.primarySoft },
          ]}
        >
          <option.Icon color={theme.colors.primary} size={22} />
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
            {option.title}
          </Text>
          <Text style={[styles.cardHelper, { color: theme.colors.textMuted }]}>
            {option.helper}
          </Text>
        </View>
        <ChevronRight color={theme.colors.textSubtle} size={20} />
      </Pressable>
    </Animated.View>
  );
}

export default function ReceiveSelectScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();

  function handleSelect(type: ReceiveType) {
    if (type === "lightning") {
      nav.navigate("ReceiveLightningAmount");
    } else {
      nav.navigate("ReceiveQR", { type });
    }
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: theme.colors.textMuted }]}>
          Choose how you want to be paid. Each option shares a different payment
          rail.
        </Text>
        <View style={styles.list}>
          {OPTIONS.map((opt) => (
            <OptionCard
              key={opt.type}
              option={opt}
              onPress={() => handleSelect(opt.type)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[8],
  },
  intro: {
    fontSize: typography.size.sm,
    lineHeight: typography.lineHeight.sm,
    marginBottom: spacing[5],
  },
  list: { gap: spacing[3] },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[3],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1 },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  cardHelper: {
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
    marginTop: 2,
  },
});
