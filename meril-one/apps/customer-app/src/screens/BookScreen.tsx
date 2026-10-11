import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Alert, Image } from 'react-native';
import { BottomBar, Button, Card, Chip, ErrorText, Field, IconBadge, api, colors, fileUrl, money, nextDays, radius, slotLabel, space, type, uploadPhoto, useAuth, fs } from '@meril-one/shared';
import type { Booking, EngineerProfile, Product } from '@meril-one/shared';
import { useCatalog } from '../catalog';
import type { StackProps } from '../nav';
import { Avatar, Stars } from './ChooseEngineerScreen';

// Book a service: equipment & problem, address, date and time slot.
// Prefilled from the customer's profile. With engineerId the request goes to
// that engineer at their rate. Services are quick-select chips (the product's
// category's services, or the engineer's skills); several can be picked for
// one visit. Booked from a product, that product is fixed (no product picker).
export default function BookScreen({ route, navigation }: StackProps<'Book'>) {
  const { user } = useAuth();
  const { categories, findService, slots } = useCatalog();
  const { engineerId, oemEngineerId } = route.params;
  // Booking the product's OEM engineer: who they are (from the product's list).
  const [oemEng, setOemEng] = useState<{ name: string; companyName: string } | null>(null);
  useEffect(() => {
    if (!oemEngineerId || !route.params.productId) return;
    api.get<{ engineers: { id: number; name: string; companyName: string }[] }>(`/products/${route.params.productId}/oem-engineers`)
      .then((r) => setOemEng(r.engineers.find((x) => x.id === oemEngineerId) || null)).catch(() => {});
  }, [oemEngineerId, route.params.productId]);
  // Selected services, in the order picked (the first is the main one).
  const [serviceIds, setServiceIds] = useState<number[]>(route.params.serviceId ? [route.params.serviceId] : []);
  const toggleService = (id: number) => setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const selected = serviceIds.map((id) => findService(id)).filter(Boolean) as { service: { id: number; name: string; price: number }; category: { id: number; name: string; icon: string; color: string } }[];
  const found = selected[0] || null;
  const [engineer, setEngineer] = useState<EngineerProfile | null>(null);
  // Hours the chosen engineer is already booked for: { date: ["10:00", …] }.
  const [busyHours, setBusyHours] = useState<Record<string, string[]>>({});
  const loadBusy = () => {
    const path = oemEngineerId ? `/oem-engineers/${oemEngineerId}/busy` : engineerId ? `/engineers/${engineerId}/busy` : null;
    if (!path) return;
    api.get<{ data: Record<string, string[]> }>(path).then((r) => setBusyHours(r.data)).catch(() => setBusyHours({}));
  };
  useEffect(() => { if (oemEngineerId) loadBusy(); }, [oemEngineerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!engineerId) return;
    api.get<{ data: EngineerProfile }>(`/engineers/${engineerId}`).then((r) => setEngineer(r.data)).catch(() => setEngineer(null));
    loadBusy();
  }, [engineerId]);
  const days = nextDays(7);
  const [date, setDate] = useState(days[0].iso);
  const [slot, setSlot] = useState<string | null>(null);
  const [issue, setIssue] = useState(route.params.urgent ? 'URGENT breakdown: ' : '');
  // Photos of the problem: uploaded as soon as they're picked (paths kept).
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const MAX_PHOTOS = 5;
  const addPhoto = async (from: 'camera' | 'library') => {
    const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', `Allow ${from === 'camera' ? 'camera' : 'photo'} access to add a photo.`); return; }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsMultipleSelection: from === 'library', selectionLimit: MAX_PHOTOS - photos.length };
    const r = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled) return;
    for (const a of r.assets.slice(0, MAX_PHOTOS - photos.length)) {
      setUploading((n) => n + 1);
      try {
        const p = await uploadPhoto('/uploads/problem-photo', a.uri, a.mimeType || 'image/jpeg');
        setPhotos((x) => (x.length < MAX_PHOTOS ? [...x, p] : x));
      } catch (e: any) { Alert.alert('Photo not added', e.message); } finally { setUploading((n) => n - 1); }
    }
  };
  const [eq, setEq] = useState({ brand: '', model: '', serialNo: '' });
  // The customer's saved products (My Products); tapping one fills the
  // equipment fields. Same-type products are listed first.
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<number | null>(null);
  useEffect(() => {
    api.get<{ data: Product[] }>('/products').then((r) => {
      setProducts(r.data);
      const pre = r.data.find((p) => p.id === route.params.productId);
      if (pre) { setProductId(pre.id); setEq({ brand: pre.brand || '', model: pre.model || '', serialNo: pre.serialNo || '' }); }
    }).catch(() => setProducts([]));
  }, [route.params.productId]);
  const [addr, setAddr] = useState({ address: user?.address || '', city: user?.city || '', pincode: user?.pincode || '' });
  const [contact, setContact] = useState({ contactName: user?.name || '', contactPhone: user?.phone || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOrg = user?.segment && user.segment !== 'home';

  // Services to choose from: the given category's, else every service the
  // chosen engineer can do (or every service).
  const skillIds = engineer ? engineer.skills.map((s) => s.id) : null;
  const choices = categories
    .filter((c) => (route.params.categoryId ? c.id === route.params.categoryId : !skillIds || skillIds.includes(c.id)))
    .flatMap((c) => c.services.map((s) => ({ ...s, category: c })));
  const service = found?.service;
  const category = found?.category;
  // Booked from a product: that product, fixed.
  const fixedProduct = route.params.productId ? products.find((p) => p.id === route.params.productId) : undefined;
  const sortedProducts = [...products].sort((a, b) => Number(b.categoryId === category?.id) - Number(a.categoryId === category?.id));
  const pickProduct = (p: Product) => {
    if (productId === p.id) { setProductId(null); setEq({ brand: '', model: '', serialNo: '' }); return; }
    setProductId(p.id);
    setEq({ brand: p.brand || '', model: p.model || '', serialNo: p.serialNo || '' });
  };
  const showEquipment = isOrg || productId !== null;

  // Today's hours that have already started aren't offered; hours the
  // engineer is already booked for show as "Booked" and can't be picked.
  const nowHour = new Date().getHours();
  const slotOpen = (s: string) => date !== days[0].iso || Number(s.slice(0, 2)) > nowHour;
  const isBusy = (s: string) => (busyHours[date] || []).includes(s);

  const book = async () => {
    setError(null);
    if (issue.trim().length < 5) { setError("Tell us what's wrong. A few words are enough."); return; }
    if (!slot) { setError('Choose a time slot'); return; }
    if (uploading) { setError('Wait for the photos to finish uploading'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ data: Booking }>('/bookings', { serviceId: service?.id, serviceIds, categoryId: route.params.categoryId, photos, engineerId, oemEngineerId, productId: route.params.productId, issue, equipment: eq, ...addr, ...contact, scheduledDate: date, slot });
      navigation.replace('BookingDetail', { id: r.data.id });
    } catch (e: any) {
      setError(e.message); setBusy(false);
      // Someone else just took that hour: refresh and clear the choice.
      if (/already booked/i.test(e.message)) { setSlot(null); loadBusy(); }
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {!!oemEngineerId && (
          <Card style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md, backgroundColor: '#EAF1FE', borderColor: '#EAF1FE' }}>
            <Avatar name={oemEng?.name || null} size={44} />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <Text style={type.small}>Authorised engineer</Text>
              <Text style={type.h3} numberOfLines={1}>{oemEng?.name || 'Loading…'}</Text>
              {!!oemEng && <Text style={type.small} numberOfLines={1}>{oemEng.companyName}</Text>}
            </View>
          </Card>
        )}
        {engineerId && (
          <Card style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md, backgroundColor: colors.brandSoft, borderColor: colors.brandSoft }}>
            <Avatar name={engineer?.name || null} size={44} online={engineer?.online} />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <Text style={type.small}>Your engineer</Text>
              <Text style={type.h3} numberOfLines={1}>{engineer?.name || 'Loading…'}</Text>
              {!!engineer && <Text style={type.small} numberOfLines={1}>{engineer.companyName || 'Independent engineer'}</Text>}
            </View>
            {!!engineer && <Stars rating={engineer.rating} count={engineer.ratingCount} />}
          </Card>
        )}

        {/* The product being serviced (booked from My Products) */}
        {!!fixedProduct && (
          <Card style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.lg }}>
            <IconBadge icon={fixedProduct.category?.icon || 'cube'} color={fixedProduct.category?.color || colors.brand} size={44} />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <Text style={type.small}>Service for</Text>
              <Text style={type.h3} numberOfLines={1}>{fixedProduct.name}</Text>
              <Text style={type.small} numberOfLines={1}>
                {[fixedProduct.brand, fixedProduct.model, fixedProduct.serialNo && `S/N ${fixedProduct.serialNo}`].filter(Boolean).join(' · ') || fixedProduct.category?.name || ''}
              </Text>
            </View>
          </Card>
        )}

        {/* Services: quick-select chips, several allowed */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.sm }}>
          <Text style={type.label}>What do you need? <Text style={{ textTransform: 'none', fontWeight: '600' }}>(optional)</Text></Text>
          <Text style={type.small}>{selected.length ? `${selected.length} selected` : 'Not sure? Skip it'}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {choices.map((s) => {
            const on = serviceIds.includes(s.id);
            return (
              <Pressable key={s.id} onPress={() => toggleService(s.id)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1.5,
                  borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : pressed ? colors.brandSoft : colors.surface })}>
                <Ionicons name={on ? 'checkmark-circle' : 'add-circle-outline'} size={17} color={on ? '#fff' : colors.textMuted} />
                <Text style={{ marginLeft: 6, fontWeight: '700', fontSize: fs(13), color: on ? '#fff' : colors.text }}>{s.name}</Text>
              </Pressable>
            );
          })}
          {!choices.length && <Text style={type.small}>Loading services…</Text>}
        </View>
        {selected.length > 1 && <Text style={[type.small, { marginTop: space.sm }]}>All {selected.length} will be done in one visit.</Text>}

        {!fixedProduct && sortedProducts.length > 0 && (
          <>
            <Text style={[type.label, { marginTop: space.xl, marginBottom: space.sm }]}>Which of your products?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg }}>
              {sortedProducts.map((p) => (
                <Chip key={p.id} label={[p.name, p.model].filter(Boolean).join(' · ')} icon="cube-outline" selected={productId === p.id} onPress={() => pickProduct(p)} />
              ))}
            </ScrollView>
          </>
        )}

        <Text style={[type.label, { marginTop: space.xl, marginBottom: space.sm }]}>{fixedProduct ? "What's wrong with it? *" : "What's the problem? *"}</Text>
        {showEquipment && !fixedProduct && (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Field style={{ flex: 1 }} placeholder="Brand" value={eq.brand} onChangeText={(t) => setEq((p) => ({ ...p, brand: t }))} />
            <Field style={{ flex: 1 }} placeholder="Model" value={eq.model} onChangeText={(t) => setEq((p) => ({ ...p, model: t }))} />
          </View>
        )}
        {showEquipment && !fixedProduct && <Field placeholder="Serial number (optional)" value={eq.serialNo} onChangeText={(t) => setEq((p) => ({ ...p, serialNo: t }))} />}
        <Field placeholder="Describe the issue, error code, since when…" value={issue} onChangeText={setIssue} multiline />

        {/* Photos of the problem (shown to the engineer) */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
          {photos.map((p) => (
            <View key={p}>
              <Image source={{ uri: fileUrl(p) }} style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.border }} />
              <Pressable onPress={() => setPhotos((x) => x.filter((y) => y !== p))} hitSlop={8}
                style={{ position: 'absolute', top: -6, right: -6, backgroundColor: colors.surface, borderRadius: 11 }}>
                <Ionicons name="close-circle" size={22} color={colors.danger} />
              </Pressable>
            </View>
          ))}
          {uploading > 0 && (
            <View style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={colors.brand} />
            </View>
          )}
          {photos.length + uploading < MAX_PHOTOS && (
            <>
              <Pressable onPress={() => addPhoto('camera')}
                style={{ width: 72, height: 72, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="camera-outline" size={24} color={colors.brand} />
                <Text style={{ fontSize: fs(10), fontWeight: '700', color: colors.brand, marginTop: 2 }}>Camera</Text>
              </Pressable>
              <Pressable onPress={() => addPhoto('library')}
                style={{ width: 72, height: 72, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="images-outline" size={24} color={colors.brand} />
                <Text style={{ fontSize: fs(10), fontWeight: '700', color: colors.brand, marginTop: 2 }}>Gallery</Text>
              </Pressable>
            </>
          )}
        </View>
        <Text style={[type.small, { marginTop: -space.sm, marginBottom: space.sm }]}>Add up to {MAX_PHOTOS} photos of the problem (optional). The engineer sees them.</Text>

        <Text style={[type.label, { marginTop: space.md, marginBottom: space.sm }]}>When?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg }}>
          {days.map((d) => {
            const on = d.iso === date;
            return (
              <Pressable key={d.iso} onPress={() => { setDate(d.iso); setSlot(null); }}
                style={{ width: 64, paddingVertical: 10, marginRight: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1.5, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                <Text style={{ fontSize: fs(11), fontWeight: '700', color: on ? '#CBD5E1' : colors.textMuted }}>{d.day}</Text>
                <Text style={{ fontSize: fs(20), fontWeight: '800', color: on ? '#fff' : colors.text, marginTop: 2 }}>{d.date}</Text>
                <Text style={{ fontSize: fs(11), color: on ? '#CBD5E1' : colors.textMuted }}>{d.month}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.md }}>
          {slots.filter(slotOpen).map((s) => isBusy(s) ? (
            <View key={s} style={{ paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, alignItems: 'center' }}>
              <Text style={{ fontSize: fs(13), fontWeight: '600', color: colors.textFaint, textDecorationLine: 'line-through' }}>{slotLabel(s)}</Text>
              <Text style={{ fontSize: fs(9), fontWeight: '700', color: colors.textFaint }}>BOOKED</Text>
            </View>
          ) : (
            <Chip key={s} label={slotLabel(s)} icon="time-outline" selected={slot === s} onPress={() => setSlot(s)} />
          ))}
          {!slots.filter(slotOpen).length && <Text style={type.small}>No times left today. Pick another day.</Text>}
        </View>

        <Text style={[type.label, { marginTop: space.lg, marginBottom: space.sm }]}>Where?</Text>
        <Field placeholder="Address" value={addr.address} onChangeText={(t) => setAddr((p) => ({ ...p, address: t }))} multiline />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Field style={{ flex: 1 }} placeholder="City" value={addr.city} onChangeText={(t) => setAddr((p) => ({ ...p, city: t }))} />
          <Field style={{ flex: 1 }} placeholder="Pincode" keyboardType="number-pad" value={addr.pincode} onChangeText={(t) => setAddr((p) => ({ ...p, pincode: t.replace(/\D/g, '').slice(0, 6) }))} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Field style={{ flex: 1 }} label="Contact person" value={contact.contactName} onChangeText={(t) => setContact((p) => ({ ...p, contactName: t }))} />
          <Field style={{ flex: 1 }} label="Phone" keyboardType="phone-pad" value={contact.contactPhone} onChangeText={(t) => setContact((p) => ({ ...p, contactPhone: t.replace(/\D/g, '').slice(0, 10) }))} />
        </View>
        <ErrorText>{error}</ErrorText>
        <View style={{ flexDirection: 'row', backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.sm }}>
          <Ionicons name="flash" size={16} color={colors.brand} style={{ marginTop: 1 }} />
          <Text style={[type.small, { flex: 1, marginLeft: 8, color: colors.text }]}>
            Your request goes to {fixedProduct ? "the product company's" : 'verified'} engineers near you. You'll get a notification 🔔 as soon as one accepts.
          </Text>
        </View>
      </ScrollView>
      <BottomBar>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fs(16), fontWeight: '800', color: colors.text }}>{selected.length ? `${selected.length} service${selected.length === 1 ? '' : 's'}` : 'Service request'}</Text>
          <Text style={type.small}>{slot ? `${days.find((d) => d.iso === date)?.day} ${days.find((d) => d.iso === date)?.date}, ${slotLabel(slot)}` : 'Pick a time'}</Text>
        </View>
        <Button title="Book service" onPress={book} loading={busy} style={{ flex: 1.4 }} />
      </BottomBar>
    </KeyboardAvoidingView>
  );
}
