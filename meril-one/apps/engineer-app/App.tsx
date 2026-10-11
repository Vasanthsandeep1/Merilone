import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { APP_FONTS, AuthProvider, BottomTabs, LoginScreen, Loading, PageTitle, colors, loadNavState, saveNavState, useAuth } from '@meril-one/shared';
import { useFonts } from '@expo-google-fonts/poppins';
import type { RootStack, Tabs } from './src/nav';
import { P } from './src/ui';
import ProfileSetupScreen from './src/screens/ProfileSetupScreen';
import RequestsScreen from './src/screens/RequestsScreen';
import MyJobsScreen from './src/screens/MyJobsScreen';
import JobDetailScreen from './src/screens/JobDetailScreen';
import ProfileScreen from './src/screens/ProfileScreen';


// Meril One Partner — the Service Engineer app. Go online, get requests from
// customers in your area for the skills you have, accept, start the job with
// the customer's OTP, and close it with the bill.
const Stack = createNativeStackNavigator<RootStack>();
const Tab = createBottomTabNavigator<Tabs>();
const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.brand } };

const TABS = [
  { name: 'Requests', label: 'Home', icon: 'home' },
  { name: 'MyJobs', label: 'My jobs', icon: 'briefcase' },
  { name: 'Profile', label: 'Profile', icon: 'person' },
];

function MainTabs() {
  return (
    <Tab.Navigator
      // Same look as the customer app: bottom bar only, no top bar. Home
      // (Requests) draws its own blue header; the others get a page title.
      tabBar={(p) => <BottomTabs items={TABS} state={p.state} navigation={p.navigation as any} />}
      screenOptions={({ route }) => ({
        headerShown: route.name !== 'Requests',
        header: ({ options }) => <PageTitle title={(options.title as string) || route.name} />,
      })}
    >
      <Tab.Screen name="Requests" component={RequestsScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="MyJobs" component={MyJobsScreen} options={{ title: 'My jobs' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, user } = useAuth();
  // After an OTP login (not when the app reopens already logged in), show
  // "Check your details" with everything fetched from B2G, until Continue.
  const [review, setReview] = useState(false);
  const lastUser = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    const id = user?.id ?? null;
    if (lastUser.current === null && id !== null) setReview(true);
    lastUser.current = id;
  }, [ready, user?.id]);
  if (!ready) return <Loading />;
  if (!user) return <LoginScreen title="Meril One Partner" tagline="Get service jobs near you. Grow your earnings." icon="build" accent={colors.success} />;
  if (!user.profileComplete || review) return <ProfileSetupScreen review={review || undefined} onDone={() => setReview(false)} />;
  return (
    <Stack.Navigator screenOptions={{ headerTintColor: colors.text, headerTitleStyle: { fontWeight: '800' }, headerShadowVisible: false, headerStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="JobDetail" component={JobDetailScreen} options={{ title: 'Job details' }} />
      <Stack.Screen name="EditProfile" component={ProfileSetupScreen} options={{ title: 'Edit profile' }} />
    </Stack.Navigator>
  );
}

export default function App() {
  // Poppins: the app-wide font (see packages/shared/src/text.tsx). Bundled with the app.
  const [fontsLoaded] = useFonts(APP_FONTS);
  // Reopen on the job the engineer was looking at (e.g. after a phone call).
  const [nav, setNav] = useState<{ ready: boolean; state?: any }>({ ready: false });
  useEffect(() => { loadNavState('engineer').then((state) => setNav({ ready: true, state })); }, []);
  if (!fontsLoaded || !nav.ready) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider role="engineer">
        <NavigationContainer theme={theme} initialState={nav.state} onStateChange={(s) => saveNavState('engineer', s, ['JobDetail'])}>
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
