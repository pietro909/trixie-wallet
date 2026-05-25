import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Sparkle } from "./Sparkle";

// Keep the native splash visible until JS mounts this component.
// Called at module-import time per Expo's recommendation.
SplashScreen.preventAutoHideAsync().catch(() => {
  /* preventAutoHideAsync can throw on Fast Refresh; safe to ignore. */
});

const BRAND_PINK = "#ff007f";

// Match the static splash-icon.png so the handoff has no visual jump.
// app.json's expo-splash-screen plugin uses imageWidth: 200, so the static
// icon renders at 200px regardless of device. We render the animated SVG at
// the same logical size and let it pulse +/- a few percent during idle.
const SPARKLE_SIZE = 200;

type Props = {
  /** Becomes true when the app has finished initializing. Triggers the exit fade. */
  isAppReady: boolean;
  /** Called after the exit fade completes and the splash should unmount. */
  onAnimationDone: () => void;
};

export function AnimatedSplash({ isAppReady, onAnimationDone }: Props) {
  const { height } = useWindowDimensions();

  // Shared values for the entrance animation
  const mainScale = useSharedValue(0.4);
  const mainRotate = useSharedValue(-90);
  const mainOpacity = useSharedValue(0);

  const companionScale = useSharedValue(0.2);
  const companionRotate = useSharedValue(-180);
  const companionOpacity = useSharedValue(0);

  const wordmarkOpacity = useSharedValue(0);
  const wordmarkTranslate = useSharedValue(8);

  const overlayOpacity = useSharedValue(1);

  // Once the native splash is hidden and we've taken over, the JS overlay is
  // what the user is seeing. We track that so we don't fade out before the
  // entrance has even rendered.
  const [hasEntered, setHasEntered] = useState(false);

  // Run the entrance sequence once on mount.
  useEffect(() => {
    // Tell the native splash to hide. Because our overlay is mounted with the
    // same background color and final sparkle pose, the transition is invisible.
    SplashScreen.hideAsync().catch(() => {});

    // Main sparkle: scale + rotate in (0.6s), with opacity ramp (0.5s).
    mainOpacity.value = withTiming(1, {
      duration: 500,
      easing: Easing.out(Easing.quad),
    });
    mainScale.value = withTiming(1, {
      duration: 700,
      easing: Easing.bezier(0.22, 1.4, 0.36, 1), // overshoot ease, matches preview
    });
    mainRotate.value = withTiming(0, {
      duration: 700,
      easing: Easing.bezier(0.22, 1.4, 0.36, 1),
    });

    // Companion sparkle pops in slightly later
    companionOpacity.value = withDelay(
      300,
      withTiming(0.9, { duration: 400, easing: Easing.out(Easing.quad) }),
    );
    companionScale.value = withDelay(
      300,
      withTiming(1, {
        duration: 500,
        easing: Easing.bezier(0.22, 1.6, 0.36, 1),
      }),
    );
    companionRotate.value = withDelay(
      300,
      withTiming(0, {
        duration: 500,
        easing: Easing.bezier(0.22, 1.6, 0.36, 1),
      }),
    );

    // Wordmark fades up after both sparkles are settling
    wordmarkOpacity.value = withDelay(
      500,
      withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) }),
    );
    wordmarkTranslate.value = withDelay(
      500,
      withTiming(0, { duration: 500, easing: Easing.out(Easing.quad) }),
    );

    // Start the idle shimmer once entrance is done (~1s in).
    // Loops indefinitely until cancelled by the exit effect below.
    const idleStart = setTimeout(() => {
      mainScale.value = withRepeat(
        withSequence(
          withTiming(1.04, {
            duration: 1200,
            easing: Easing.inOut(Easing.quad),
          }),
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
      setHasEntered(true);
    }, 1000);

    return () => clearTimeout(idleStart);
  }, [
    mainOpacity,
    mainScale,
    mainRotate,
    companionOpacity,
    companionScale,
    companionRotate,
    wordmarkOpacity,
    wordmarkTranslate,
  ]);

  // When the app is ready AND we've at least started the idle shimmer,
  // fade the whole overlay out.
  useEffect(() => {
    if (!isAppReady || !hasEntered) return;

    // Stop the looping shimmer so it doesn't fight the exit.
    cancelAnimation(mainScale);
    mainScale.value = withTiming(1.08, {
      duration: 400,
      easing: Easing.in(Easing.quad),
    });

    overlayOpacity.value = withTiming(
      0,
      { duration: 400, easing: Easing.in(Easing.quad) },
      (finished) => {
        if (finished) {
          runOnJS(onAnimationDone)();
        }
      },
    );
  }, [isAppReady, hasEntered, mainScale, overlayOpacity, onAnimationDone]);

  // --- Animated styles ---
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const mainStyle = useAnimatedStyle(() => ({
    opacity: mainOpacity.value,
    transform: [
      { scale: mainScale.value },
      { rotate: `${mainRotate.value}deg` },
    ],
  }));

  const companionStyle = useAnimatedStyle(() => ({
    opacity: companionOpacity.value,
    transform: [
      { scale: companionScale.value },
      { rotate: `${companionRotate.value}deg` },
    ],
  }));

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkTranslate.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
    >
      {/* The sparkle stack sits centered. The two pieces animate on independent
          timelines, so they're rendered as overlapping absolutely-positioned
          Animated.Views, each containing the matching piece of the SVG. */}
      <View style={styles.center}>
        <Animated.View style={[styles.sparkleLayer, mainStyle]}>
          <Sparkle size={SPARKLE_SIZE} mainOnly color="#ffffff" />
        </Animated.View>
        <Animated.View style={[styles.sparkleLayer, companionStyle]}>
          <Sparkle size={SPARKLE_SIZE} companionOnly color="#ffffff" />
        </Animated.View>
      </View>

      {/* Wordmark anchored toward the bottom of the screen, like a typical
          launch screen. Adjust the multiplier or swap to a fixed offset to
          match your brand spec. */}
      <Animated.Text
        style={[styles.wordmark, { top: height * 0.65 }, wordmarkStyle]}
      >
        Trixie
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: BRAND_PINK,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    width: SPARKLE_SIZE,
    height: SPARKLE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  sparkleLayer: {
    position: "absolute",
    width: SPARKLE_SIZE,
    height: SPARKLE_SIZE,
  },
  wordmark: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "500",
    letterSpacing: -0.3,
    // Use your brand font here once it's loaded, e.g.:
    // fontFamily: 'Inter-Medium',
  },
});
