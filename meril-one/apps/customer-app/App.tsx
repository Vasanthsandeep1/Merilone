import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { APP_FONTS, AuthProvider, PageTitle, LoginScreen, Loading, colors, useAuth } from '@meril-one/shared';
import { CatalogProvider } from './src/catalog';
import type { RootStack, Tabs } from './src/nav';
import OnboardingScreen from './src/screens/OnboardingScreen';
import HomeScreen from './src/screens/HomeScreen';
import CategoryScreen from './src/screens/CategoryScreen';
import BookScreen from './src/screens/BookScreen';
import BookingsScreen from './src/screens/BookingsScreen';
import BookingDetailScreen from './src/screens/BookingDetailScreen';
import AccountScreen from './src/screens/AccountScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import TrackScreen from './src/screens/TrackScreen';
import ProductFormScreen from './src/screens/ProductFormScreen';
import ProductCategoryScreen from './src/screens/ProductCategoryScreen';
import ChooseEngineerScreen from './src/screens/ChooseEngineerScreen';
import EngineerProfileScreen from './src/screens/EngineerProfileScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ProductDetailScreen from './src/screens/ProductDetailScreen';
import BottomNav from './src/BottomNav';
import StoreScreen from './src/screens/StoreScreen';
import { HOME_BLUE } from './src/screens/HomeScreen';
import { useFonts } from '@expo-google-fonts/poppins';


// Meril One — Customer app. Log in with mobile + OTP, choose a background
// (home / hospital / lab / office / industry), book a service, and track the
// engineer until the job is done.
const Stack = createNativeStackNavigator<RootStack>();
const Tab = createBottomTabNavigator<Tabs>();

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.brand } };

function MainTabs() {
  return (
    <Tab.Navigator
      // Bottom nav bar only (no top bar). Each tab draws its own title.
      tabBar={(p) => <BottomNav state={p.state} navigation={p.navigation as any} />}
      screenOptions={({ route }) => ({
        // Most tabs draw their own title under the status bar; these two don't.
        headerShown: route.name === 'Store' || route.name === 'Alerts',
        header: ({ options }) => <PageTitle title={(options.title as string) || route.name} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Store" component={StoreScreen} />
      <Tab.Screen name="Bookings" component={BookingsScreen} options={{ title: 'My bookings' }} />
      <Tab.Screen name="Track" component={TrackScreen} options={{ title: 'Track order' }} />
      <Tab.Screen name="Products" component={ProductsScreen} options={{ title: 'My Products' }} />
      <Tab.Screen name="Alerts" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, user } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <LoginScreen title="Meril One" tagline="Expert repair & service for home, hospital and lab" icon="construct" />;
  if (!user.profileComplete) return <OnboardingScreen />;
  return (
    <CatalogProvider>
      <Stack.Navigator screenOptions={{ headerTintColor: colors.text, headerTitleStyle: { fontWeight: '700' }, headerShadowVisible: false, headerStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Category" component={CategoryScreen} options={({ route }) => ({ title: route.params.name })} />
        <Stack.Screen name="Book" component={BookScreen} options={{ title: 'Book service' }} />
        <Stack.Screen name="BookingDetail" component={BookingDetailScreen} options={{ title: 'Booking details' }} />
        <Stack.Screen name="EditProfile" component={OnboardingScreen} options={{ title: 'Edit profile' }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
        <Stack.Screen name="ChooseEngineer" component={ChooseEngineerScreen} options={{ title: 'Choose engineer' }} />
        <Stack.Screen name="EngineerProfile" component={EngineerProfileScreen} options={{ title: 'Engineer' }} />
        <Stack.Screen name="ProductCategory" component={ProductCategoryScreen} options={({ route }) => ({ title: route.params.name })} />
        <Stack.Screen name="ProductForm" component={ProductFormScreen} options={({ route }) => ({ title: route.params?.id ? 'Edit product' : 'Add product' })} />
        <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: 'Device details' }} />
      </Stack.Navigator>
    </CatalogProvider>
  );
}

export default function App() {
  // Poppins: the app-wide font (see packages/shared/src/text.tsx). Bundled with the app.
  const [fontsLoaded] = useFonts(APP_FONTS);
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider role="customer">
        <NavigationContainer theme={theme}>
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
