import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ACTIVE, Button, Card, Chip, Empty, IconBadge, StatusPill, api, colors, fmtDate, money, slotLabel, space, type } from '@meril-one/shared';
import type { Booking } from '@meril-one/shared';
import type { RootStack } from '../nav';

// All of the customer's bookings: ongoing first, then past.
export default function BookingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get<{ data: Booking[] }>('/bookings'); setRows(r.data); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]));

  const list = (rows || []).filter((b) => (tab === 'active') === ACTIVE.includes(b.status));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <Text style={type.hero}>My bookings</Text>
        <View style={{ flexDirection: 'row', marginTop: space.md }}>
          <Chip label="Ongoing" selected={tab === 'active'} onPress={() => setTab('active')} />
          <Chip label="Past" selected={tab === 'past'} onPress={() => setTab('past')} />
        </View>
      </View>
      <FlatList
        data={list}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={rows === null && !error ? <Text style={type.small}>Loading…</Text> : (
          <Empty icon={error ? 'cloud-offline' : 'calendar-outline'} title={error ? "Couldn't load bookings" : tab === 'active' ? 'No ongoing bookings' : 'No past bookings'}
            text={error || 'Book a service from Home and track it here.'}
            action={!error && tab === 'active' ? <Button title="Book a service" onPress={() => navigation.navigate('Main')} /> : undefined} />
        )}
        renderItem={({ item: b }) => (
          <Card style={{ marginBottom: space.md }} onPress={() => navigation.navigate('BookingDetail', { id: b.id })}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {b.category && <IconBadge icon={b.category.icon} color={b.category.color} size={42} />}
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={type.h3} numberOfLines={1}>{b.service?.name}</Text>
                <Text style={type.small}>{b.bookingNo}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md }}>
              <StatusPill status={b.status} />
              <Text style={type.small}>{fmtDate(b.scheduledDate)} · {slotLabel(b.slot)}</Text>
            </View>
            {b.status === 'completed' && (
              <View style={{ marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={type.small}>{b.rating ? `You rated ${'★'.repeat(b.rating)}` : 'Rate your engineer'}</Text>
              </View>
            )}
          </Card>
        )}
      />
    </SafeAreaView>
  );
}
