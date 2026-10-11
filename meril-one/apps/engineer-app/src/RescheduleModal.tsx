import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, fs } from '@meril-one/shared';
import { Button, Chip, ErrorText, Field, api, colors, nextDays, radius, slotLabel, space, type } from '@meril-one/shared';
import type { Booking } from '@meril-one/shared';

// Engineer asks the customer to move a visit: pick a new day + start hour
// (hours you're already booked are locked) and say why. The booking keeps
// its time until the customer accepts.
export default function RescheduleModal({ job, visible, onClose, onSent }: {
  job: Booking; visible: boolean; onClose: () => void; onSent: (b: Booking) => void;
}) {
  const days = nextDays(7);
  const [date, setDate] = useState(job.scheduledDate);
  const [slot, setSlot] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState<string[]>([]);
  const [busy, setBusy] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null); setSlot(null);
    api.get<{ slots: string[] }>('/catalog').then((r) => setHours(r.slots)).catch(() => {});
    api.get<{ data: Record<string, string[]> }>('/engineer/busy').then((r) => setBusy(r.data)).catch(() => setBusy({}));
  }, [visible]);

  const nowHour = new Date().getHours();
  const open = (h: string) => date !== days[0].iso || Number(h.slice(0, 2)) > nowHour;
  const isCurrent = (h: string) => date === job.scheduledDate && h === job.slot.slice(0, 5);
  const taken = (h: string) => !isCurrent(h) && (busy[date] || []).includes(h);

  const send = async () => {
    setError(null);
    if (!slot) { setError('Choose the new time'); return; }
    if (!reason.trim()) { setError('Tell the customer why'); return; }
    setSaving(true);
    try {
      const r = await api.post<{ data: Booking }>(`/engineer/jobs/${job.id}/reschedule`, { date, slot, reason });
      onSent(r.data);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
            <Text style={type.h2}>Request reschedule</Text>
            <Text style={[type.small, { marginTop: 4, marginBottom: space.lg }]}>The customer gets your request and can accept or keep the current time ({slotLabel(job.slot)}).</Text>

            <Text style={[type.label, { marginBottom: space.sm }]}>New day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {days.map((d) => {
                const on = d.iso === date;
                return (
                  <Pressable key={d.iso} onPress={() => { setDate(d.iso); setSlot(null); }}
                    style={{ width: 60, paddingVertical: 8, marginRight: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1.5, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                    <Text style={{ fontSize: fs(11), fontWeight: '700', color: on ? '#CBD5E1' : colors.textMuted }}>{d.day}</Text>
                    <Text style={{ fontSize: fs(18), fontWeight: '800', color: on ? '#fff' : colors.text }}>{d.date}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={[type.label, { marginTop: space.lg, marginBottom: space.sm }]}>New start time</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {hours.filter(open).map((h) => (isCurrent(h) || taken(h)) ? (
                <View key={h} style={{ paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, alignItems: 'center' }}>
                  <Text style={{ fontSize: fs(13), fontWeight: '600', color: colors.textFaint, textDecorationLine: isCurrent(h) ? 'none' : 'line-through' }}>{slotLabel(h)}</Text>
                  <Text style={{ fontSize: fs(9), fontWeight: '700', color: colors.textFaint }}>{isCurrent(h) ? 'CURRENT' : 'BOOKED'}</Text>
                </View>
              ) : (
                <Chip key={h} label={slotLabel(h)} icon="time-outline" selected={slot === h} onPress={() => setSlot(h)} />
              ))}
              {!hours.filter(open).length && <Text style={type.small}>No times left today. Pick another day.</Text>}
            </View>

            <Field label="Reason" value={reason} onChangeText={setReason} multiline maxLength={300} style={{ marginTop: space.md }}
              placeholder="e.g. My previous job is taking longer than expected" />
            <ErrorText>{error}</ErrorText>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} />
              <Button title="Send request" onPress={send} loading={saving} style={{ flex: 1.4 }} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
