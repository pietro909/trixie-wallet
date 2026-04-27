import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import {
  createNativeStackNavigator,
  type NativeStackHeaderProps,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppStore } from "../store/useAppStore";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { type AppTheme, spacing, typography } from "../theme/theme";

import RootTabs from "./RootTabs";
import LandingNoWallet from "../screens/LandingNoWallet";
import IntroCarousel from "../screens/IntroCarousel";
import RestoreWallet from "../screens/RestoreWallet";
import UnlockScreen from "../screens/UnlockScreen";
import TransactionsScreen from "../screens/TransactionsScreen";
import ProfilePreferences from "../screens/ProfilePreferences";
import ProfileBackup from "../screens/ProfileBackup";
import ProfileLock from "../screens/ProfileLock";
import ProfileReset from "../screens/ProfileReset";

export type RootStackParamList = {
  Landing: undefined;
  IntroCarousel: undefined;
  RestoreWallet: undefined;
  Unlock: undefined;
  Main: undefined;
  Transactions: undefined;
  ProfilePreferences: undefined;
  ProfileBackup: undefined;
  ProfileLock: undefined;
  ProfileReset: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function StackHeader({
  title,
  onBack,
  canGoBack,
  theme,
}: {
  title: string;
  onBack: () => void;
  canGoBack: boolean;
  theme: AppTheme;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        headerStyles.container,
        {
          paddingTop: insets.top + spacing[3],
          backgroundColor: theme.colors.background,
        },
      ]}
    >
      {canGoBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={headerStyles.back}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <ChevronLeft color={theme.colors.text} size={28} />
        </Pressable>
      ) : null}
      <Text
        style={[headerStyles.title, { color: theme.colors.text }]}
        numberOfLines={1}
      >
        {title}
      </Text>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: spacing[3],
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  back: {
    padding: spacing[1],
    marginLeft: -spacing[1],
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});

export default function RootStack() {
  const theme = useResolvedTheme();
  const walletContainer = useAppStore((s) => s.walletContainer);
  const security = useAppStore((s) => s.security);

  const renderCustomHeader = (props: NativeStackHeaderProps) => (
    <StackHeader
      title={props.options.title ?? ""}
      onBack={() => props.navigation.goBack()}
      canGoBack={!!props.back}
      theme={theme}
    />
  );

  const headerOptions: NativeStackNavigationOptions =
    Platform.OS === "android"
      ? {
          headerShown: true,
          header: renderCustomHeader,
        }
      : {
          headerShown: true,
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          headerShadowVisible: false,
        };

  console.log("RootStack: walletContainer", walletContainer);
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {!walletContainer ? (
        // No wallet flow
        <>
          <Stack.Screen
            name="Landing"
            component={LandingNoWallet}
            options={{ animation: "fade" }}
          />
          <Stack.Screen name="IntroCarousel" component={IntroCarousel} />
          <Stack.Screen
            name="RestoreWallet"
            component={RestoreWallet}
            options={{ ...headerOptions, title: "Restore Wallet" }}
          />
        </>
      ) : security.isLocked ? (
        // Locked flow
        <Stack.Screen
          name="Unlock"
          component={UnlockScreen}
          options={{ animation: "fade" }}
        />
      ) : (
        // Main app flow
        <>
          <Stack.Screen
            name="Main"
            component={RootTabs}
            options={{ animation: "fade" }}
          />
          <Stack.Screen
            name="Transactions"
            component={TransactionsScreen}
            options={{ ...headerOptions, title: "Transactions" }}
          />
          <Stack.Screen
            name="ProfilePreferences"
            component={ProfilePreferences}
            options={{ ...headerOptions, title: "Preferences" }}
          />
          <Stack.Screen
            name="ProfileBackup"
            component={ProfileBackup}
            options={{ ...headerOptions, title: "Backup" }}
          />
          <Stack.Screen
            name="ProfileLock"
            component={ProfileLock}
            options={{ ...headerOptions, title: "Lock Wallet" }}
          />
          <Stack.Screen
            name="ProfileReset"
            component={ProfileReset}
            options={{ ...headerOptions, title: "Reset Wallet" }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
