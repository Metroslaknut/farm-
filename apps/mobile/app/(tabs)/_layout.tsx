import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { theme } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type TabKey = 'tab.home' | 'tab.videos' | 'tab.market' | 'tab.myFarm' | 'tab.profile';

/** `title` is the English name (also in the tabs catalog); the shown title comes from `label` in the current language. */
const TABS: { name: string; title: string; label: TabKey; icon: IconName; iconActive: IconName }[] =
  [
    { name: 'index', title: 'Home', label: 'tab.home', icon: 'home-outline', iconActive: 'home' },
    {
      name: 'videos',
      title: 'Videos',
      label: 'tab.videos',
      icon: 'play-circle-outline',
      iconActive: 'play-circle',
    },
    {
      name: 'market',
      title: 'Market',
      label: 'tab.market',
      icon: 'storefront-outline',
      iconActive: 'storefront',
    },
    {
      name: 'my-farm',
      title: 'My Farm',
      label: 'tab.myFarm',
      icon: 'leaf-outline',
      iconActive: 'leaf',
    },
    {
      name: 'profile',
      title: 'Profile',
      label: 'tab.profile',
      icon: 'person-outline',
      iconActive: 'person',
    },
  ];

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const t = useT('tabs');
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.tabActive,
        tabBarInactiveTintColor: theme.colors.tabInactive,
        tabBarStyle: {
          backgroundColor: theme.colors.background,
          borderTopColor: theme.colors.border,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarLabelStyle: { fontSize: theme.font.size.xs, fontWeight: theme.font.weight.medium },
        headerStyle: { backgroundColor: theme.colors.background },
        headerTitleStyle: { color: theme.colors.text, fontWeight: theme.font.weight.bold },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
            tabBarAccessibilityLabel: t('tab.a11y', { title: t(tab.label) }),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? tab.iconActive : tab.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
