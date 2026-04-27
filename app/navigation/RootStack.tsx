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
import ReceiveSelectScreen from "../screens/receive/ReceiveSelectScreen";
import ReceiveLightningAmountScreen from "../screens/receive/ReceiveLightningAmountScreen";
import ReceiveQRScreen from "../screens/receive/ReceiveQRScreen";
import SendEntryScreen from "../screens/send/SendEntryScreen";
import SendOptionsScreen from "../screens/send/SendOptionsScreen";
import SendAmountScreen from "../screens/send/SendAmountScreen";
import SendReviewScreen from "../screens/send/SendReviewScreen";
import SendResultScreen from "../screens/send/SendResultScreen";
import type { ReceiveType } from "../services/receive";
import type {
  ParsedPaymentOption,
  PaymentType,
} from "../services/paymentParser";

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
  ReceiveSelect: undefined;
  ReceiveLightningAmount: undefined;
  ReceiveQR: { type: ReceiveType; amountSats?: number };
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
