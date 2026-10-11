import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { Button, api, colors, fmtDate, radius, slotLabel, space, type, fs } from '@meril-one/shared';
import type { Booking } from '@meril-one/shared';

// The engineer asked to move this visit: show old -> new time and the
// reason, with Accept / Keep original time. Used on Home and the booking.
export const hasPendingReschedule = (b: Booking) =>
  b.rescheduleRequest?.status === 'pending' && ['accepted', 'on_the_way'].includes(b.status);

export default function RescheduleCard({ b, onAnswered, compact }: { b: Booking; onAnswered: (b: Booking) => void; compact?: boolean }) {
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const rq = b.rescheduleRequest!;
  const who = b.engineer?.name?.split(' ')[0] || 'Your engineer';

  const answer = async (accept: boolean) => {
    setBusy(accept ? 'yes' : 'no');
    try {
      const r = await api.post<{ data: Booking }>(`/bookings/${b.id}/reschedule`, { accept });
      onAnswered(r.data);
    } catch (e: any) { Alert.alert('Could not save', e.message); } finally { setBusy(null); }
  };

  return (
    <View style={{ backgroundColor: colors.accentSoft, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.accent, padding: space.lg, marginTop: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="time" size={18} color={colors.accent} />
        <Text style={{ marginLeft: 6, fontSize: fs(11), fontWeight: '800', color: colors.accent, letterSpacing: 0.5 }}>ACTION NEEDED</Text>
      </View>
      <Text style={[type.h3, { marginTop: space.sm }]}>
        {who} asks to reschedule{compact && b.service ? ` your ${b.service.name}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, flexWrap: 'wrap' }}>
        <Text style={[type.small, { textDecorationLine: 'line-through' }]}>{fmtDate(rq.fromDate)}, {slotLabel(rq.fromSlot)}</Text>
        <Ionicons name="arrow-forward" size={14} color={colors.textMuted} style={{ marginHorizontal: 6 }} />
        <Text style={{ fontWeight: '800', color: colors.text }}>{fmtDate(rq.date)}, {slotLabel(rq.slot)}</Text>
      </View>
      <Text style={[type.small, { marginTop: space.sm, color: colors.text }]}>"{rq.reason}"</Text>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <Button title="Keep original time" variant="outline" onPress={() => answer(false)} loading={busy === 'no'} disabled={!!busy} style={{ flex: 1, height: 44 }} />
        <Button title="Accept" onPress={() => answer(true)} loading={busy === 'yes'} disabled={!!busy} style={{ flex: 1, height: 44 }} />
      </View>
    </View>
  );
}
