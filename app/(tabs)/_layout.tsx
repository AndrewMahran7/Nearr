import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: colors.bg,
        },
        headerTitleStyle: {
          color: colors.text,
        },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.primary,
        // Use the lighter secondary text color for inactive tabs so the
        // labels/icons stay readable on the dark tab bar (textMuted was too
        // dim → the black-on-black look). Active stays orange.
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          // Map-first: full-screen feel. The Map screen renders its own
          // floating chrome (search bar + chips) and handles the top safe
          // area itself, so the tab header is hidden here ONLY.
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Feather name="map" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="places"
        options={{
          title: 'Places',
          // Hidden from the tab bar (map-first) but kept as a reachable route
          // for rollback / deep links. Set href back to default to restore it.
          href: null,
          tabBarIcon: ({ color, size }) => (
            <Feather name="bookmark" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          // Hidden from the tab bar (map-first) but kept as a reachable route
          // for rollback / onboarding. Set href back to default to restore it.
          href: null,
          tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Feather name="settings" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
