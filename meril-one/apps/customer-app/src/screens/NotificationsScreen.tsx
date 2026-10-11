import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Empty, api, colors, radius, space, type, fs } from '@meril-one/shared';
import type { RootStack } from '../nav';

type Note = { id: number; bookingId: number | null; kind: string; title: string; body: string | null; read: boolean; at: string };

const ICON: Record<string, { icon: string; color: string }> = {
  placed: { icon: 'receipt', color: colors.brand },
  on_the_way: { icon: 'car', color: colors.info },
  cancelled: { icon: 'close-circle', color: colors.textMuted },
  rescheduled: { icon: 'calendar', color: colors.brand },
  accepted: { icon: 'person-circle', color: colors.success },
  arrived: { icon: 'location', color: colors.info },
  started: { icon: 'construct', color: colors.brand },
  completed: { icon: 'checkmark-done-circle', color: colors.success },
  reschedule: { icon: 'time', color: colors.warning },
  released: { icon: 'refresh-circle', color: colors.danger },
  quote: { icon: 'pricetag', color: colors.brand },
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// Notifications: every step of every booking — placed, engineer assigned, on
// the way, arrived, work started, done, reschedule asks and answers,
// cancellations. Opening this screen marks them read; tapping one opens
// that booking. In the ☰ menu (Notifications) and behind the 🔔.
export default function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [rows, setRows] = useState<Note[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ data: Note[] }>('/notifications');
      setRows(r.data);
      if (r.data.some((n) => !n.read)) api.post('/notifications/read').catch(() => {});
    } catch { setRows((x) => x || []); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={rows || []}
      keyExtractor={(n) => String(n.id)}
      contentContainerStyle={{ padding: space.lg, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListEmptyComponent={rows === null ? <Text style={type.small}>Loading…</Text> : (
        <Empty icon="notifications-outline" title="No notifications yet" text="When an engineer accepts your booking, arrives or finishes, you'll see it here." />
      )}
      renderItem={({ item: n }) => {
        const look = ICON[n.kind] || { icon: 'notifications', color: colors.brand };
        return (
          <Pressable onPress={() => (n.bookingId ? navigation.navigate('BookingDetail', { id: n.bookingId }) : n.kind === 'quote' ? navigation.navigate('Main' as any, { screen: 'Store' } as any) : undefined)}
            style={({ pressed }) => ({ flexDirection: 'row', backgroundColor: n.read ? colors.surface : colors.brandSoft, borderRadius: radius.lg, padding: space.md, marginBottom: space.sm, borderWidth: 1, borderColor: n.read ? colors.border : '#C9D8EC', opacity: pressed ? 0.85 : 1 })}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: `${look.color}18`, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={look.icon as any} size={24} color={look.color} />
            </View>
            <View style={{ flex: 1, marginLeft: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[type.h3, { flex: 1 }]} numberOfLines={1}>{n.title}</Text>
                {!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginLeft: 6 }} />}
              </View>
              {!!n.body && <Text style={[type.small, { color: colors.text, marginTop: 2, fontSize: fs(13) }]}>{n.body}</Text>}
              <Text style={[type.small, { marginTop: 4 }]}>{ago(n.at)}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
