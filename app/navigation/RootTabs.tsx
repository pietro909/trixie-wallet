import * as React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Network, WalletMinimal, CircleUserRound } from "lucide-react-native";

import { makeBottomTabsOptions, TabIcon, useAppTheme } from "../theme/theme";

import NetworksScreen from "../screens/NetworksScreen";
import WalletScreen from "../screens/WalletScreen";
import ProfileScreen from "../screens/ProfileScreen";

export type RootTabsParamList = {
  Networks: undefined;
  Wallet: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<RootTabsParamList>();

export default function RootTabs() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const base = makeBottomTabsOptions(theme, {
          bottomInset: Math.max(0, insets.bottom - 6),
          blur: true,
          // animation: "fade", // enable after you confirm it's stable in your setup
        });

        return {
          ...base,
          tabBarIcon: ({ focused, color, size }) => {
            const Icon =
              route.name === "Networks"
                ? Network
                : route.name === "Wallet"
                ? WalletMinimal
                : CircleUserRound;

            return (
              <TabIcon
                focused={focused}
                color={color}
                size={size ?? 24}
                theme={theme}
                Icon={Icon}
              />
            );
          },
        };
      }}
    >
      <Tab.Screen name="Networks" component={NetworksScreen} />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
