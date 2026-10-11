import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import {
  ACTIVE, Button, Card, Empty, IconBadge, Loading, PhotoStrip, Row, STATUS, StatusPill, api, colors, fmtDate, fmtDateTime, money, radius, slotLabel, space, type, fs } from '@meril-one/shared';
import type { Booking, BookingStatus } from '@meril-one/shared';
import type { StackProps } from '../nav';
import RescheduleCard, { hasPendingReschedule } from '../RescheduleCard';

const STEPS: { key: BookingStatus; label: string }[] = [
  { key: 'requested', label: 'Booking placed' },
  { key: 'accepted', label: 'Engineer assigned' },
  { key: 'on_the_way', label: 'On the way' },
  { key: 'in_progress', label: 'Work in progress' },
  { key: 'completed', label: 'Completed' },
];

// One booking, tracked live (refreshes every 10 s while it's ongoing):
// progress steps, the start OTP, the engineer, work done, and rating.
export default function BookingDetailScreen({ route }: StackProps<'BookingDetail'>) {
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get<{ data: Booking }>(`/bookings/${route.params.id}`); setB(r.data); setError(null); } catch (e: any) { setError(e.message); }
  }, [route.params.id]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!b || ACTIVE.includes(b.status)) load(); }, 10000);
    return () => clearInterval(t);
  }, [load, b?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !b) return <Empty icon="cloud-offline" title="Couldn't load the booking" text={error} />;
  if (!b) return <Loading />;

  const stepIndex = STEPS.findIndex((s) => s.key === b.status);
  const at = (k: BookingStatus) => b.timeline.find((t) => t.status === k)?.at;

  const cancel = () => Alert.alert('Cancel booking?', 'The engineer will be informed.', [
    { text: 'Keep booking', style: 'cancel' },
    { text: 'Cancel booking', style: 'destructive', onPress: async () => { try { await api.post(`/bookings/${b.id}/cancel`, { reason: 'Cancelled by customer' }); load(); } catch (e: any) { Alert.alert('Could not cancel', e.message); } } },
  ]);
  const rate = async () => {
    setBusy(true);
    try { await api.post(`/bookings/${b.id}/rate`, { rating, review }); load(); } catch (e: any) { Alert.alert('Could not save', e.message); } finally { setBusy(false); }
  };

  const doneAt = b.timeline.filter((t) => t.status === 'completed').at(-1)?.at || null;
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}>
      {/* Status header */}
      <View style={{ backgroundColor: b.status === 'cancelled' ? colors.textMuted : colors.brand, borderRadius: radius.xl, padding: space.xl }}>
        <Text style={{ color: '#CBD5E1', fontSize: fs(12), fontWeight: '700' }}>{b.bookingNo}</Text>
        <Text style={{ color: '#fff', fontSize: fs(22), fontWeight: '800', marginTop: 4 }}>
          {b.requestedEngineer ? `Waiting for ${b.requestedEngineer.name || 'your engineer'} to accept` : STATUS[b.status].customerText}
        </Text>
        {!!b.requestedEngineer && (
          <Text style={{ color: '#E2E8F0', fontSize: fs(12), marginTop: 4 }}>
            Sent only to {b.requestedEngineer.name}{b.requestedEngineer.companyName ? ` (${b.requestedEngineer.companyName})` : ''}. If they can't take it, we'll find another engineer nearby.
          </Text>
        )}
        <Text style={{ color: '#CBD5E1', marginTop: 4 }}>{fmtDate(b.scheduledDate)} · {slotLabel(b.slot)}</Text>
        {b.startOtp && (
          <View style={{ marginTop: space.lg, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, padding: space.md, flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="key" size={20} color="#fff" />
            <Text style={{ color: '#E2E8F0', flex: 1, marginLeft: 10, fontSize: fs(13) }}>Share this OTP with the engineer to start the job</Text>
            <Text style={{ color: '#fff', fontSize: fs(24), fontWeight: '800', letterSpacing: 4 }}>{b.startOtp}</Text>
          </View>
        )}
      </View>

      {hasPendingReschedule(b) && <RescheduleCard b={b} onAnswered={setB} />}

      {b.photos.length > 0 && (
        <Card style={{ marginTop: space.lg }}>
          <Text style={[type.label, { marginBottom: space.sm }]}>Your photos</Text>
          <PhotoStrip photos={b.photos} />
        </Card>
      )}

      {/* Progress */}
      {b.status !== 'cancelled' && (
        <Card style={{ marginTop: space.lg }}>
          {STEPS.map((s, i) => {
            const done = i <= stepIndex;
            const time = at(s.key);
            return (
              <View key={s.key} style={{ flexDirection: 'row' }}>
                <View style={{ alignItems: 'center', width: 28 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: done ? colors.success : colors.surface, borderWidth: 2, borderColor: done ? colors.success : colors.border, alignItems: 'center', justifyContent: 'center' }}>
                    {done && <Ionicons name="checkmark" size={12} color="#fff" />}
                  </View>
                  {i < STEPS.length - 1 && <View style={{ width: 2, flex: 1, minHeight: 22, backgroundColor: i < stepIndex ? colors.success : colors.border }} />}
                </View>
                <View style={{ flex: 1, marginLeft: space.sm, paddingBottom: space.md }}>
                  <Text style={{ fontWeight: done ? '700' : '500', color: done ? colors.text : colors.textFaint }}>{s.label}</Text>
                  {time && <Text style={type.small}>{fmtDateTime(time)}</Text>}
                </View>
              </View>
            );
          })}
        </Card>
      )}

      {/* Engineer */}
      {b.engineer && (
        <Card style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontWeight: '800', color: colors.brand, fontSize: fs(18) }}>{(b.engineer.name || 'E')[0]}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: space.md }}>
            <Text style={type.h3}>{b.engineer.name}</Text>
            <Text style={type.small}>
              {b.engineer.rating ? `★ ${b.engineer.rating} (${b.engineer.ratingCount})` : 'New engineer'}{b.engineer.experienceYears ? ` · ${b.engineer.experienceYears} yrs exp` : ''}
            </Text>
          </View>
          {ACTIVE.includes(b.status) && (
            <Pressable onPress={() => Linking.openURL(`tel:${b.engineer!.phone}`)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="call" size={20} color={colors.success} />
            </Pressable>
          )}
        </Card>
      )}

      {/* Details */}
      <Card style={{ marginTop: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.sm }}>
          {b.category && <IconBadge icon={b.category.icon} color={b.category.color} size={38} />}
          <View style={{ flex: 1, marginLeft: space.md }}>
            <Text style={type.h3}>{b.service?.name}</Text>
            <Text style={type.small}>{b.category?.name}</Text>
          </View>
          <StatusPill status={b.status} />
        </View>
        {b.equipment && <Row icon="hardware-chip-outline" label="Equipment" value={[b.equipment.brand, b.equipment.model, b.equipment.serialNo && `S/N ${b.equipment.serialNo}`].filter(Boolean).join(' · ')} />}
        {b.issue && <Row icon="chatbubble-ellipses-outline" label="Problem" value={b.issue} />}
        <Row icon="location-outline" label="Address" value={`${b.address}, ${b.city} ${b.pincode}`} />
        {b.cancelReason && <Row icon="close-circle-outline" label="Cancelled" value={b.cancelReason} />}
      </Card>

      {/* Service report: the problem, what was fixed, photos before / after */}
      {b.status === 'completed' && (
        <Card style={{ marginTop: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md }}>
            <Ionicons name="document-text" size={20} color={colors.brand} />
            <Text style={[type.h3, { marginLeft: 8, flex: 1 }]}>Service report</Text>
            {!!doneAt && <Text style={type.small}>{fmtDateTime(doneAt)}</Text>}
          </View>
          {!!b.engineer?.name && <Text style={[type.small, { marginBottom: space.sm }]}>Done by {b.engineer.name}{b.engineer.companyName ? ` · ${b.engineer.companyName}` : ''}</Text>}
          {!!b.equipment?.brand && <Text style={[type.small, { marginBottom: space.sm }]}>Equipment: {[b.equipment.brand, b.equipment.model, b.equipment.serialNo && `S/N ${b.equipment.serialNo}`].filter(Boolean).join(' · ')}</Text>}

          <Text style={[type.label, { marginTop: space.sm }]}>Problem reported</Text>
          <Text style={[type.body, { marginTop: 2 }]}>{b.issue || '—'}</Text>
          {b.photos.length > 0 && <View style={{ marginTop: space.sm }}><PhotoStrip photos={b.photos} size={70} /></View>}

          <Text style={[type.label, { marginTop: space.lg }]}>What was fixed</Text>
          <Text style={[type.body, { marginTop: 2 }]}>{b.workNotes || '—'}</Text>
          {b.partsUsed.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
              {b.partsUsed.map((p, i) => (
                <Text key={i} style={{ fontSize: fs(12), fontWeight: '600', color: colors.text, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' }}>{p.name} × {p.qty}</Text>
              ))}
            </View>
          )}

          {!!b.workPhotos?.length && (
            <>
              <Text style={[type.label, { marginTop: space.lg, marginBottom: space.sm }]}>After service ({b.workPhotos.length} photo{b.workPhotos.length === 1 ? '' : 's'})</Text>
              <PhotoStrip photos={b.workPhotos} size={96} />
            </>
          )}
        </Card>
      )}

      {/* Rating */}
      {b.status === 'completed' && (
        <Card style={{ marginTop: space.lg }}>
          {b.rating ? (
            <>
              <Text style={type.h3}>Your rating</Text>
              <Text style={{ fontSize: fs(26), color: '#F59E0B', marginTop: 4 }}>{'★'.repeat(b.rating)}<Text style={{ color: colors.border }}>{'★'.repeat(5 - b.rating)}</Text></Text>
              {b.review && <Text style={[type.body, { marginTop: 6 }]}>"{b.review}"</Text>}
            </>
          ) : (
            <>
              <Text style={type.h3}>How was the service?</Text>
              <View style={{ flexDirection: 'row', marginVertical: space.md }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
                    <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={34} color={n <= rating ? '#F59E0B' : colors.textFaint} style={{ marginRight: 8 }} />
                  </Pressable>
                ))}
              </View>
              <TextInput value={review} onChangeText={setReview} placeholder="Tell us more (optional)" placeholderTextColor={colors.textFaint} multiline
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, minHeight: 70, textAlignVertical: 'top', marginBottom: space.md, color: colors.text }} />
              <Button title="Submit rating" onPress={rate} loading={busy} disabled={!rating} />
            </>
          )}
        </Card>
      )}

      {['requested', 'accepted', 'on_the_way'].includes(b.status) && (
        <Button title="Cancel booking" variant="ghost" onPress={cancel} style={{ marginTop: space.lg }} />
      )}
    </ScrollView>
  );
}

