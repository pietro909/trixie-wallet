import {
  createNativeStackNavigator,
  type NativeStackHeaderProps,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import { ChevronLeft } from "lucide-react-native";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import ActivityScreen from "../screens/ActivityScreen";
import IntroCarousel from "../screens/IntroCarousel";
import LandingNoWallet from "../screens/LandingNoWallet";
import ProfileBackup from "../screens/ProfileBackup";
import ProfileLock from "../screens/ProfileLock";
import ProfilePreferences from "../screens/ProfilePreferences";
import ProfileReset from "../screens/ProfileReset";
import RestoreWallet from "../screens/RestoreWallet";
import ReceiveLightningAmountScreen from "../screens/receive/ReceiveLightningAmountScreen";
import ReceiveQRScreen from "../screens/receive/ReceiveQRScreen";
import ReceiveSelectScreen from "../screens/receive/ReceiveSelectScreen";
import SendAmountScreen from "../screens/send/SendAmountScreen";
import SendEntryScreen from "../screens/send/SendEntryScreen";
import SendOptionsScreen from "../screens/send/SendOptionsScreen";
import SendResultScreen from "../screens/send/SendResultScreen";
import SendReviewScreen from "../screens/send/SendReviewScreen";
import UnlockScreen from "../screens/UnlockScreen";
import type {
  ParsedPaymentOption,
  PaymentType,
} from "../services/paymentParser";
import type { ReceiveType } from "../services/receive";
import { useAppStore } from "../store/useAppStore";
import { type AppTheme, spacing, typography } from "../theme/theme";
import RootTabs from "./RootTabs";

export type RootStackParamList = {
  Landing: undefined;
  IntroCarousel: undefined;
  RestoreWallet: undefined;
  Unlock: undefined;
  Main: undefined;
  Activity: undefined;
  ProfilePreferences: undefined;
  ProfileBackup: undefined;
  ProfileLock: undefined;
  ProfileReset: undefined;
  ReceiveSelect: undefined;
  ReceiveLightningAmount: undefined;
  ReceiveQR: {
    type: ReceiveType;
    amountSats?: number;
    lightningInvoice?: string;
    lightningCreditedSats?: number;
    lightningExpiresAt?: number;
    lightningSwapId?: string;
  };
  SendEntry: undefined;
  SendOptions: { rawInput: string };
  SendAmount: { option: ParsedPaymentOption };
  SendReview: { option: ParsedPaymentOption; amountSats: number };
  SendResult: {
    status: "success" | "error";
    paymentType: PaymentType;
    destination: string;
    amountSats?: number;
    feeSats?: number;
    txId?: string;
    message?: string;
  };
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
  const wallet = useAppStore((s) => s.wallet);
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

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {!wallet ? (
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
            name="Activity"
            component={ActivityScreen}
            options={{ ...headerOptions, title: "Activity" }}
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
          <Stack.Screen
            name="ReceiveSelect"
            component={ReceiveSelectScreen}
            options={{ ...headerOptions, title: "Receive" }}
          />
          <Stack.Screen
            name="ReceiveLightningAmount"
            component={ReceiveLightningAmountScreen}
            options={{ ...headerOptions, title: "Lightning amount" }}
          />
          <Stack.Screen
            name="ReceiveQR"
            component={ReceiveQRScreen}
            options={{ ...headerOptions, title: "Receive" }}
          />
          <Stack.Screen
            name="SendEntry"
            component={SendEntryScreen}
            options={{ ...headerOptions, title: "Send" }}
          />
          <Stack.Screen
            name="SendOptions"
            component={SendOptionsScreen}
            options={{ ...headerOptions, title: "Choose payment" }}
          />
          <Stack.Screen
            name="SendAmount"
            component={SendAmountScreen}
            options={{ ...headerOptions, title: "Amount" }}
          />
          <Stack.Screen
            name="SendReview"
            component={SendReviewScreen}
            options={{ ...headerOptions, title: "Review" }}
          />
          <Stack.Screen
            name="SendResult"
            component={SendResultScreen}
            options={{
              ...headerOptions,
              title: "",
              headerBackVisible: false,
              gestureEnabled: false,
            }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
