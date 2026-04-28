import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  CircleUserRound,
  SlidersHorizontal,
  WalletMinimal,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useResolvedTheme } from "../hooks/useResolvedTheme";
import AdvancedScreen from "../screens/AdvancedScreen";
import ProfileScreen from "../screens/ProfileScreen";
import WalletScreen from "../screens/WalletScreen";
import { makeBottomTabsOptions, TabIcon } from "../theme/theme";

export type RootTabsParamList = {
  Advanced: undefined;
  Wallet: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<RootTabsParamList>();

export default function RootTabs() {
  const theme = useResolvedTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName="Wallet"
      detachInactiveScreens={false}
      screenOptions={({ route }) => {
        const base = makeBottomTabsOptions(theme, {
          bottomInset: Math.max(0, insets.bottom - 6),
          blur: true,
          animation: "none",
        });

        return {
          ...base,
          sceneStyle: {
            flex: 1,
            paddingTop: insets.top,
            backgroundColor: theme.colors.background,
          },
          tabBarIcon: ({ focused, color, size }) => {
            const Icon =
              route.name === "Advanced"
                ? SlidersHorizontal
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
      <Tab.Screen name="Advanced" component={AdvancedScreen} />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
