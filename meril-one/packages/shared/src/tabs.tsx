import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './text';
import { colors, fs } from './theme';

// Shared look for both apps: a white bottom navigation bar (the active tab in
// blue with a soft pill behind its icon), and a plain big page title for tabs
// that don't draw their own.
export const APP_BLUE = '#1E6FE0';

export type TabItem = { name: string; label: string; icon: string };

export function BottomTabs({ items, state, navigation, color = APP_BLUE }: {
  items: TabItem[];
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
  color?: string;
}) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  return (
    <View style={{
      flexDirection: 'row', backgroundColor: '#fff', paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8),
      borderTopLeftRadius: 22, borderTopRightRadius: 22,
      shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 12,
    }}>
      {items.map((it) => {
        const on = current === it.name;
        return (
          <Pressable key={it.name} onPress={() => navigation.navigate(it.name)} style={{ flex: 1, alignItems: 'center' }}
            accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 4, borderRadius: 999, backgroundColor: on ? '#E8F0FE' : 'transparent' }}>
              <Ionicons name={(on ? it.icon : `${it.icon}-outline`) as any} size={22} color={on ? color : '#94A3B8'} />
            </View>
            <Text style={{ fontWeight: on ? '700' : '500', fontSize: fs(11), color: on ? color : '#94A3B8', marginTop: 2 }} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PageTitle({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: colors.bg, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 6 }}>
      <Text style={{ fontWeight: '800', fontSize: fs(24), color: colors.text }} numberOfLines={1}>{title}</Text>
    </View>
  );
}
