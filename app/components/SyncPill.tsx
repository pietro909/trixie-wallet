import * as React from "react";
import { type StyleProp, StyleSheet, Text, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { SyncStage } from "../store/types";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";

/**
 * Honest, distinguishable labels for each refresh stage. The visible text and
 * the accessibility announcement share these so VoiceOver / TalkBack users
 * hear exactly what sighted users read.
 */
const STAGE_LABEL: Record<SyncStage, string> = {
  snapshot: "Syncing balance…",
  lightning: "Syncing Lightning…",
  activities: "Updating activity…",
  notify: "Updating activity…",
};

type Props = {
  /** Whether the pill should be shown. Drives the 250ms opacity fade. */
  visible: boolean;
  /** Current refresh stage, or `null` when idle. Selects the label. */
  stage: SyncStage | null;
  theme: AppTheme;
  /** Positioning style applied by the caller (the pill lays out as a row). */
  style?: StyleProp<ViewStyle>;
};

/**
 * Calm "syncing" affordance: a softly pulsing dot beside a stage label. Fades
 * in/out rather than popping, never intercepts touches (so cached data stays
 * interactive while a refresh runs), and announces its state politely for
 * assistive tech.
 */
export function SyncPill({
  visible,
  stage,
  theme,
  style,
}: Props): React.ReactElement {
  const opacity = useSharedValue(0);
  const dot = useSharedValue(0.4);

  // Keep the last real stage so the label doesn't blank out mid fade-out, when
  // the store has already flipped back to `idle` (stage === null).
  const [label, setLabel] = React.useState(
    stage ? STAGE_LABEL[stage] : "Syncing…",
  );
  React.useEffect(() => {
    if (stage) setLabel(STAGE_LABEL[stage]);
  }, [stage]);

  React.useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 250 });
  }, [visible, opacity]);

  // Gentle dot pulse while visible; idle (steady) otherwise. Runs on the UI
  // thread so it never competes with the JS refresh work it's reporting on.
  React.useEffect(() => {
    if (visible) {
      dot.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.4, { duration: 600, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
    } else {
      dot.value = withTiming(0.4, { duration: 250 });
    }
  }, [visible, dot]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.value }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={visible ? label : undefined}
      style={[
        styles.pill,
        { backgroundColor: theme.colors.surfaceSubtle },
        containerStyle,
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: theme.colors.primary },
          dotStyle,
        ]}
      />
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
  label: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
});
