import { BottomTabs } from '@meril-one/shared';

// Bottom navigation bar (no top bar). Notifications are behind the bell on Home.
const ITEMS = [
  { name: 'Home', label: 'Home', icon: 'home' },
  { name: 'Store', label: 'Store', icon: 'storefront' },
  { name: 'Bookings', label: 'Bookings', icon: 'calendar' },
  { name: 'Track', label: 'Track', icon: 'navigate' },
  { name: 'Account', label: 'Account', icon: 'person' },
];

export default function BottomNav({ state, navigation }: { state: { index: number; routes: { key: string; name: string }[] }; navigation: { navigate: (name: string) => void } }) {
  return <BottomTabs items={ITEMS} state={state} navigation={navigation} />;
}
