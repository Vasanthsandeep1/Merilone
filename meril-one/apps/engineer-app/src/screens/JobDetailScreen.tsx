import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View, ActivityIndicator, Image } from 'react-native';
import { Text, TextInput, fs } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  BottomBar, Button, Card, Empty, ErrorText, Field, Loading, PhotoStrip, Row, STATUS, api, colors, fileUrl, uploadPhoto, fmtDate, money, radius, slotLabel, space, type,
} from '@meril-one/shared';
import type { Booking } from '@meril-one/shared';
import type { StackProps } from '../nav';
import RescheduleModal from '../RescheduleModal';
import { P } from '../ui';

type Part = { name: string; qty: string };

// One job, with the next action for its stage:
// requested -> Accept · accepted -> On the way · on the way -> Start (OTP)
// · in progress -> Complete (service charge, parts, notes).
export default function JobDetailScreen({ route, navigation }: StackProps<'JobDetail'>) {
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [notes, setNotes] = useState('');
  // After-work photos (required to complete): taken with the camera, uploaded straight away.
  const [workPhotos, setWorkPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const addWorkPhoto = async (from: 'camera' | 'library') => {
    const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', `Allow ${from === 'camera' ? 'camera' : 'photo'} access to add a photo.`); return; }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const r = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    setUploading((n) => n + 1);
    try {
      const p = await uploadPhoto('/engineer/uploads/work-photo', r.assets[0].uri, r.assets[0].mimeType || 'image/jpeg');
      setWorkPhotos((x) => (x.length < 6 ? [...x, p] : x));
    } catch (e: any) { Alert.alert('Photo not added', e.message); } finally { setUploading((n) => n - 1); }
  };
  const [parts, setParts] = useState<Part[]>([]);
  const [rescheduling, setRescheduling] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get<{ data: Booking }>(`/engineer/jobs/${route.params.id}`); setB(r.data); setError(null); } catch (e: any) { setError(e.message); }
  }, [route.params.id]);
  useEffect(() => { load(); }, [load]);

  if (error && !b) return <Empty icon="alert-circle" title="Job not available" text={error} />;
  if (!b) return <Loading />;

  const act = async (path: string, body: object = {}) => {
    setActionError(null); setBusy(true);
    try {
      const r = await api.post<{ data: Booking }>(path, body);
      if (r?.data) setB(r.data); else await load();
    } catch (e: any) { setActionError(e.message); } finally { setBusy(false); }
  };
  const status = (action: string, extra: object = {}) => act(`/engineer/jobs/${b.id}/status`, { action, ...extra });

  const openMaps = () => {
    const q = encodeURIComponent(`${b.address}, ${b.city} ${b.pincode}`);
    Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`);
  };
  const release = () => Alert.alert('Release this job?', 'It goes back to other engineers nearby.', [
    { text: 'Keep job', style: 'cancel' },
    { text: 'Release', style: 'destructive', onPress: async () => { await status('release'); navigation.goBack(); } },
  ]);

  const mine = b.status !== 'requested';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ backgroundColor: colors.brand, borderRadius: radius.xl, padding: space.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 50, height: 50, borderRadius: 15, backgroundColor: b.category?.color || P.green, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={(b.category?.icon || 'construct') as any} size={26} color="#fff" />
            </View>
            <View style={{ flex: 1, marginLeft: space.md }}>
              <Text style={{ color: '#fff', fontSize: fs(19), fontWeight: '800' }}>{b.service?.name}</Text>
              <Text style={{ color: '#CBD5E1', fontSize: fs(12) }}>{b.bookingNo} · {b.category?.name}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, padding: space.md }}>
              <Text style={{ color: '#CBD5E1', fontSize: fs(11) }}>WHEN</Text>
              <Text style={{ color: '#fff', fontWeight: '800', marginTop: 2 }}>{fmtDate(b.scheduledDate)}, {slotLabel(b.slot)}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, padding: space.md }}>
              <Text style={{ color: '#CBD5E1', fontSize: fs(11) }}>STATUS</Text>
              <Text style={{ color: '#4ADE80', fontWeight: '800', marginTop: 2 }}>{b.arrivedAt && ['accepted', 'on_the_way'].includes(b.status) ? 'At site' : STATUS[b.status].engineerText}</Text>
            </View>
          </View>
        </View>
        <Card style={{ marginTop: space.lg }}>
          <Text style={[type.label, { marginBottom: space.xs }]}>Job</Text>
          {b.equipment && <Row icon="hardware-chip-outline" label="Equipment" value={[b.equipment.brand, b.equipment.model, b.equipment.serialNo && `S/N ${b.equipment.serialNo}`].filter(Boolean).join(' · ')} />}
          {b.issue && <Row icon="chatbubble-ellipses-outline" label="Problem reported" value={b.issue} />}
          {b.photos?.length > 0 && (
            <View style={{ marginTop: space.md }}>
              <Text style={[type.label, { marginBottom: space.sm }]}>Photos from the customer ({b.photos.length})</Text>
              <PhotoStrip photos={b.photos} size={84} />
            </View>
          )}
        </Card>

        {/* Reschedule request and the customer's answer */}
        {b.rescheduleRequest && ['accepted', 'on_the_way'].includes(b.status) && (() => {
          const rq = b.rescheduleRequest;
          const look = {
            pending: { icon: 'hourglass-outline', color: colors.warning, bg: colors.warningSoft, title: 'Waiting for the customer to answer' },
            accepted: { icon: 'checkmark-circle', color: colors.success, bg: colors.successSoft, title: 'Customer accepted the new time' },
            rejected: { icon: 'close-circle', color: colors.danger, bg: colors.dangerSoft, title: 'Customer kept the original time' },
            expired: { icon: 'alert-circle', color: colors.textMuted, bg: colors.bg, title: 'Your suggested time passed before the customer answered' },
          }[rq.status];
          return (
            <View style={{ marginTop: space.lg, backgroundColor: look.bg, borderRadius: radius.lg, padding: space.lg, flexDirection: 'row' }}>
              <Ionicons name={look.icon as any} size={22} color={look.color} />
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={[type.h3, { color: look.color }]}>{look.title}</Text>
                <Text style={[type.small, { marginTop: 2 }]}>
                  Asked to move {fmtDate(rq.fromDate)}, {slotLabel(rq.fromSlot)} → {fmtDate(rq.date)}, {slotLabel(rq.slot)}
                </Text>
                {rq.status === 'rejected' && <Text style={[type.small, { marginTop: 4, color: colors.text }]}>Please visit at the original time, or call the customer.</Text>}
              </View>
            </View>
          );
        })()}

        {/* Customer */}
        <Card style={{ marginTop: space.lg }}>
          <Text style={[type.label, { marginBottom: space.sm }]}>Customer</Text>
          <Text style={type.h3}>{b.customer?.name}</Text>
          {b.customer?.orgName && <Text style={type.small}>{b.customer.orgName}</Text>}
          <Row icon="location-outline" label="Address" value={mine ? `${b.address}, ${b.city} ${b.pincode}` : `${b.address} (full address after you accept)`} />
          {mine && b.status !== 'completed' && b.status !== 'cancelled' && (
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
              {b.customer?.phone && <Button title="Call" icon="call" variant="outline" onPress={() => Linking.openURL(`tel:${b.customer!.phone}`)} style={{ flex: 1, height: 44 }} />}
              <Button title="Directions" icon="navigate" variant="outline" onPress={openMaps} style={{ flex: 1, height: 44 }} />
            </View>
          )}
        </Card>

        {/* Start: OTP */}
        {['accepted', 'on_the_way'].includes(b.status) && (
          <Card style={{ marginTop: space.lg }}>
            <Text style={type.h3}>Start the job</Text>
            <Text style={[type.small, { marginTop: 4, marginBottom: space.md }]}>Ask the customer for the 4-digit OTP shown in their app.</Text>
            <TextInput value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="• • • •" placeholderTextColor={colors.textFaint}
              style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, height: 56, fontSize: fs(24), fontWeight: '800', letterSpacing: 12, textAlign: 'center', color: colors.text }} />
          </Card>
        )}

        {/* Complete: work done + parts (no money in the app) */}
        {b.status === 'in_progress' && (
          <Card style={{ marginTop: space.lg }}>
            <Text style={[type.h3, { marginBottom: space.md }]}>Close the job</Text>
            <Text style={{ fontSize: fs(13), fontWeight: '600', color: colors.text, marginBottom: 6 }}>Parts used</Text>
            {parts.map((p, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                <Field style={{ flex: 2.2 }} placeholder="Part name" value={p.name} onChangeText={(t) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, name: t } : x)))} />
                <Field style={{ flex: 0.8 }} placeholder="Qty" keyboardType="number-pad" value={p.qty} onChangeText={(t) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, qty: t.replace(/\D/g, '') } : x)))} />
                <Pressable onPress={() => setParts((ps) => ps.filter((_, j) => j !== i))} hitSlop={8} style={{ marginBottom: space.md }}>
                  <Ionicons name="close-circle" size={22} color={colors.textFaint} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => setParts((ps) => [...ps, { name: '', qty: '1' }])} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md }}>
              <Ionicons name="add-circle" size={20} color={colors.accent} />
              <Text style={{ color: colors.accent, fontWeight: '700', marginLeft: 6 }}>Add part</Text>
            </Pressable>
            <Field label="What was the problem & what did you fix? *" value={notes} onChangeText={setNotes} multiline placeholder="e.g. Pump motor jammed. Cleaned and replaced the seal, tested 3 runs OK." />

            <Text style={{ fontSize: fs(13), fontWeight: '600', color: colors.text, marginBottom: 2 }}>Photos of the finished work *</Text>
            <Text style={[type.small, { marginBottom: space.sm }]}>Shown to the customer in their service report. At least 1, up to 6.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {workPhotos.map((p) => (
                <View key={p}>
                  <Image source={{ uri: fileUrl(p) }} style={{ width: 76, height: 76, borderRadius: 12, backgroundColor: colors.bg }} />
                  <Pressable onPress={() => setWorkPhotos((x) => x.filter((y) => y !== p))} hitSlop={8}
                    style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#fff', borderRadius: 12 }}>
                    <Ionicons name="close-circle" size={22} color={colors.danger} />
                  </Pressable>
                </View>
              ))}
              {uploading > 0 && (
                <View style={{ width: 76, height: 76, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brand} /></View>
              )}
              {workPhotos.length + uploading < 6 && (
                <>
                  <Pressable onPress={() => addWorkPhoto('camera')}
                    style={{ width: 76, height: 76, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.brand, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandSoft }}>
                    <Ionicons name="camera" size={24} color={colors.brand} />
                    <Text style={{ fontSize: fs(10), fontWeight: '700', color: colors.brand }}>Camera</Text>
                  </Pressable>
                  <Pressable onPress={() => addWorkPhoto('library')}
                    style={{ width: 76, height: 76, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="images-outline" size={22} color={colors.textMuted} />
                    <Text style={{ fontSize: fs(10), fontWeight: '700', color: colors.textMuted }}>Gallery</Text>
                  </Pressable>
                </>
              )}
            </View>
          </Card>
        )}

        {/* Completed summary */}
        {b.status === 'completed' && (
          <Card style={{ marginTop: space.lg }}>
            <Text style={type.h3}>Job completed</Text>
            {b.partsUsed.map((p, i) => <Text key={i} style={[type.small, { marginTop: 4 }]}>• {p.name} × {p.qty}</Text>)}
            {b.workNotes && <Text style={[type.small, { marginTop: space.sm }]}>{b.workNotes}</Text>}
            {!!b.workPhotos?.length && <View style={{ marginTop: space.sm }}><PhotoStrip photos={b.workPhotos} size={76} /></View>}
            {b.rating ? <Text style={{ marginTop: space.md, color: '#F59E0B', fontSize: fs(18) }}>{'★'.repeat(b.rating)} <Text style={type.small}>{b.review || ''}</Text></Text>
              : <Text style={[type.small, { marginTop: space.md }]}>Waiting for the customer's rating.</Text>}
          </Card>
        )}

        {b.status === 'cancelled' && <Card style={{ marginTop: space.lg }}><Text style={type.h3}>Cancelled</Text><Text style={type.small}>{b.cancelReason}</Text></Card>}

        <View style={{ marginTop: space.lg }}><ErrorText>{actionError}</ErrorText></View>
        {['accepted', 'on_the_way'].includes(b.status) && b.rescheduleRequest?.status !== 'pending' && (
          <Button title="Request reschedule" variant="outline" icon="calendar-outline" onPress={() => setRescheduling(true)} style={{ marginBottom: space.sm }} />
        )}
        {['accepted', 'on_the_way'].includes(b.status) && <Button title="Release job" variant="ghost" onPress={release} />}
      </ScrollView>

      <RescheduleModal job={b} visible={rescheduling} onClose={() => setRescheduling(false)}
        onSent={(nb) => { setRescheduling(false); setB(nb); Alert.alert('Request sent', 'The customer will see it in their app and can accept or keep the current time.'); }} />

      {b.status === 'requested' && (
        <BottomBar><Button title="Accept job" variant="success" loading={busy} onPress={() => act(`/engineer/jobs/${b.id}/accept`)} style={{ flex: 1 }} /></BottomBar>
      )}
      {/* accepted -> On the way -> I've reached the spot -> OTP start */}
      {b.status === 'accepted' && !b.arrivedAt && (
        <BottomBar>
          <Button title="On the way" variant="outline" icon="car" loading={busy} onPress={() => status('on_the_way')} style={{ flex: 1 }} />
          <Button title="Reached spot" icon="location" loading={busy} onPress={() => status('arrived')} style={{ flex: 1 }} />
        </BottomBar>
      )}
      {b.status === 'on_the_way' && !b.arrivedAt && (
        <BottomBar><Button title="I've reached the spot" icon="location" loading={busy} onPress={() => status('arrived')} style={{ flex: 1 }} /></BottomBar>
      )}
      {['accepted', 'on_the_way'].includes(b.status) && !!b.arrivedAt && (
        <BottomBar><Button title="Verify OTP & start job" loading={busy} disabled={otp.length !== 4} onPress={() => status('start', { otp })} style={{ flex: 1 }} /></BottomBar>
      )}
      {b.status === 'in_progress' && (
        <BottomBar>
          <Button title="Complete job" variant="success" icon="checkmark-done" loading={busy} style={{ flex: 1 }}
            onPress={() => {
              if (notes.trim().length < 5) { setActionError('Write what the problem was and what you fixed.'); return; }
              if (!workPhotos.length) { setActionError('Take at least one photo of the finished work.'); return; }
              if (uploading) { setActionError('Wait for the photos to finish uploading.'); return; }
              status('complete', { labourCharge: 0, workNotes: notes, workPhotos, partsUsed: parts.filter((p) => p.name.trim()).map((p) => ({ name: p.name, qty: Number(p.qty) || 1, price: 0 })) });
            }} />
        </BottomBar>
      )}
    </KeyboardAvoidingView>
  );
}

