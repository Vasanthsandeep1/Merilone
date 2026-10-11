import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ACTIVE, Button, Card, Empty, IconBadge, api, colors, fmtDate, radius, slotLabel, space, type, fs } from '@meril-one/shared';
import type { Booking } from '@meril-one/shared';
import type { RootStack } from '../nav';

const timeOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null;

// The tracker steps for one booking, each done / current / to come, with the
// time it happened. "Reached" comes from the engineer's "I've reached the
// spot" (or starting the job, which they can only do on site).
function stepsFor(b: Booking) {
  const at = (s: string, note?: RegExp) => b.timeline.filter((t) => t.status === s && (!note || note.test(t.note || ''))).at(-1)?.at;
  const order = ['requested', 'accepted', 'on_the_way', 'in_progress', 'completed'];
  const reached = order.indexOf(b.status);
  const engineer = b.engineer?.name;
  return [
    { key: 'booked', icon: 'receipt-outline', title: 'Booked', done: true, time: b.createdAt,
      text: `${b.service?.name || 'Service'} for ${fmtDate(b.scheduledDate)}, ${slotLabel(b.slot)}` },
    { key: 'assigned', icon: 'person-outline', title: 'Engineer assigned', done: reached >= 1, time: at('accepted'),
      text: reached >= 1 ? `${engineer || 'Your engineer'} accepted your booking` : b.requestedEngineer ? `Waiting for ${b.requestedEngineer.name} to accept` : 'Finding an engineer near you' },
    { key: 'way', icon: 'car-outline', title: 'On the way', done: reached >= 2, time: at('on_the_way'),
      text: reached >= 2 ? `${engineer || 'Engineer'} is heading to you` : 'Engineer starts travelling to you' },
    { key: 'reached', icon: 'location-outline', title: 'Reached your place', done: !!b.arrivedAt || reached >= 3, time: b.arrivedAt || at('in_progress'),
      text: b.arrivedAt || reached >= 3 ? `${engineer || 'Engineer'} is at your place${reached === 3 ? ' and working on it' : ''}` : 'Share your OTP when the engineer arrives' },
    { key: 'done', icon: 'checkmark-done-outline', title: 'Work done', done: reached >= 4, time: at('completed'),
      text: reached >= 4 ? 'Service completed. Rate your engineer' : 'Engineer marks the job done when finished' },
  ];
}

// The vertical tracker from the sketch: circles joined by a line on the left,
// a box with the details on the right.
export function Tracker({ b }: { b: Booking }) {
  const steps = stepsFor(b);
  const current = steps.findIndex((s) => !s.done); // first step not done yet
  return (
    <View>
      {steps.map((s, i) => {
        const isCurrent = i === current;
        const color = s.done ? colors.success : isCurrent ? colors.accent : colors.textFaint;
        const last = i === steps.length - 1;
        return (
          <View key={s.key} style={{ flexDirection: 'row' }}>
            {/* circle + connecting line */}
            <View style={{ width: 44, alignItems: 'center' }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: color, backgroundColor: s.done ? colors.success : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={(s.done ? 'checkmark' : s.icon) as any} size={20} color={s.done ? '#fff' : color} />
              </View>
              {!last && <View style={{ width: 3, flex: 1, minHeight: 22, backgroundColor: steps[i + 1].done ? colors.success : colors.border }} />}
            </View>
            {/* box */}
            <View style={{ flex: 1, marginLeft: space.md, marginBottom: last ? 0 : space.md, borderWidth: isCurrent ? 1.5 : 1, borderColor: isCurrent ? colors.accent : colors.border, backgroundColor: isCurrent ? colors.accentSoft : s.done ? colors.surface : colors.bg, borderRadius: radius.md, padding: space.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', fontSize: fs(14), color: s.done || isCurrent ? colors.text : colors.textFaint }}>{s.title}</Text>
                {s.done && !!timeOf(s.time) && <Text style={{ fontSize: fs(11), color: colors.textMuted }}>{timeOf(s.time)}</Text>}
                {isCurrent && <Text style={{ fontSize: fs(10), fontWeight: '800', color: colors.accent }}>NOW</Text>}
              </View>
              <Text style={{ fontSize: fs(12), marginTop: 2, color: s.done || isCurrent ? colors.textMuted : colors.textFaint }}>{s.text}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// "Track order" tab: every ongoing booking with its live tracker
// (refreshes every 10 s), plus the ones finished in the last day.
export default function TrackScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ data: Booking[] }>('/bookings');
      const dayAgo = Date.now() - 86400000;
      setRows(r.data.filter((b) => ACTIVE.includes(b.status)
        || (b.status === 'completed' && new Date(b.timeline.filter((t) => t.status === 'completed').at(-1)?.at || 0).getTime() > dayAgo)));
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows || []}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={{ padding: space.lg, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={
          <View style={{ marginBottom: space.lg }}>
            <Text style={type.hero}>Track order</Text>
            <Text style={type.small}>Live status of your bookings. Updates on its own.</Text>
          </View>
        }
        ListEmptyComponent={rows === null && !error ? <Text style={type.small}>Loading…</Text> : (
          <Empty icon={error ? 'cloud-offline' : 'navigate-outline'} title={error ? "Couldn't load your orders" : 'Nothing to track right now'}
            text={error || 'When you book a service, you can follow it here step by step.'}
            action={!error ? <Button title="Book a service" onPress={() => navigation.navigate('Main')} /> : <Button title="Try again" variant="outline" onPress={load} />} />
        )}
        renderItem={({ item: b }) => (
          <Card style={{ marginBottom: space.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.lg }}>
              {b.category && <IconBadge icon={b.category.icon} color={b.category.color} size={42} />}
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={type.h3} numberOfLines={1}>{b.service?.name}</Text>
                <Text style={type.small}>{b.bookingNo}{b.equipment?.brand ? ` · ${[b.equipment.brand, b.equipment.model].filter(Boolean).join(' ')}` : ''}</Text>
              </View>
              {b.startOtp && (
                <View style={{ alignItems: 'center', backgroundColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: '#CBD5E1', fontSize: fs(9), fontWeight: '700' }}>OTP</Text>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: fs(15), letterSpacing: 2 }}>{b.startOtp}</Text>
                </View>
              )}
            </View>
            <Tracker b={b} />
            <Button title="View booking details" variant="ghost" onPress={() => navigation.navigate('BookingDetail', { id: b.id })} style={{ marginTop: space.sm, height: 40 }} />
          </Card>
        )}
      />
    </SafeAreaView>
  );
}
