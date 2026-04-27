import * as React from "react";
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Shield, Zap, Globe } from "lucide-react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { spacing, typography, radius } from "../theme/theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const STEPS = [
  {
    Icon: Shield,
    title: "Self-Custodial",
    body: "Your keys, your coins. Trixie never has access to your funds. Everything stays on your device.",
  },
  {
    Icon: Zap,
    title: "Instant Transfers",
    body: "Built on the Ark protocol for fast, cheap, and private off-chain transactions.",
  },
  {
    Icon: Globe,
    title: "Multi-Network",
    body: "Connect to multiple Ark service providers and manage your VTXOs from a single wallet.",
  },
];

export default function IntroCarousel() {
  const theme = useResolvedTheme();
  const nav = useNavigation();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const flatListRef = React.useRef<FlatList>(null);

  const isLast = activeIndex === STEPS.length - 1;

  function handleNext() {
    if (isLast) {
      nav.goBack();
    } else {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1 });
    }
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()}>
          <Text style={[styles.skip, { color: theme.colors.textMuted }]}>
            Skip
          </Text>
        </Pressable>
      </View>

      <FlatList
        ref={flatListRef}
        data={STEPS}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(
            e.nativeEvent.contentOffset.x / SCREEN_WIDTH,
          );
          setActiveIndex(index);
        }}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
            <item.Icon color={theme.colors.primary} size={72} />
            <Text style={[styles.slideTitle, { color: theme.colors.text }]}>
              {item.title}
            </Text>
            <Text style={[styles.slideBody, { color: theme.colors.textMuted }]}>
              {item.body}
            </Text>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {STEPS.map((step, i) => (
            <View
              key={step.title}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i === activeIndex
                      ? theme.colors.primary
                      : theme.colors.surfaceSubtle,
                  width: i === activeIndex ? 24 : 8,
                },
              ]}
            />
          ))}
        </View>

        <Pressable
          onPress={handleNext}
          style={[styles.nextButton, { backgroundColor: theme.colors.primary }]}
        >
          <Text style={styles.nextLabel}>
            {isLast ? "Get Started" : "Next"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
  },
  skip: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  slide: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing[8],
  },
  slideTitle: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginTop: spacing[6],
    textAlign: "center",
  },
  slideBody: {
    fontSize: typography.size.md,
    marginTop: spacing[3],
    textAlign: "center",
    lineHeight: typography.lineHeight.md,
  },
  footer: {
    paddingHorizontal: spacing[6],
    paddingBottom: spacing[8],
    alignItems: "center",
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing[6],
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  nextButton: {
    width: "100%",
    paddingVertical: spacing[3],
    borderRadius: radius.md,
    alignItems: "center",
  },
  nextLabel: {
    color: "#ffffff",
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
});
