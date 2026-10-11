import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { BottomBar, Button, Chip, ErrorText, Field, Loading, api, colors, fileUrl, space, type, uploadPhoto } from '@meril-one/shared';
import type { Product, ProductCategory } from '@meril-one/shared';
import type { StackProps } from '../nav';

const EMPTY = { name: '', categoryKey: null as string | null, brand: '', model: '', serialNo: '', purchaseDate: '', warrantyUntil: '', location: '', notes: '', imageUrl: null as string | null };
type Form = typeof EMPTY;

// Typed as DD-MM-YYYY (how people write dates in India); sent as YYYY-MM-DD.
const toDisplay = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '');
const toIso = (d: string) => {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : d.trim();
};
// Keeps only digits and adds the dashes while typing: 15032025 -> 15-03-2025.
const maskDate = (t: string) => {
  const d = t.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('-');
};
const validDate = (d: string) => !d || /^\d{2}-\d{2}-\d{4}$/.test(d);

// Add a new product, or edit / delete one (route param id).
export default function ProductFormScreen({ route, navigation }: StackProps<'ProductForm'>) {
  const id = route.params?.id;
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [form, setForm] = useState<Form>({ ...EMPTY, categoryKey: route.params?.categoryKey ?? null });
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get<{ data: ProductCategory[] }>('/product-categories').then((r) => setCategories(r.data)).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    api.get<{ data: Product[] }>('/products')
      .then((r) => {
        const p = r.data.find((x) => x.id === id);
        if (!p) { setError('This product was not found.'); return; }
        setForm({
          name: p.name, categoryKey: p.categoryKey, brand: p.brand || '', model: p.model || '', serialNo: p.serialNo || '',
          purchaseDate: toDisplay(p.purchaseDate), warrantyUntil: toDisplay(p.warrantyUntil), location: p.location || '', notes: p.notes || '', imageUrl: p.imageUrl || null,
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Product photo: camera or gallery, uploaded straight away; saved with the product.
  const [uploading, setUploading] = useState(false);
  const pickPhoto = async (from: 'camera' | 'library') => {
    const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', `Allow ${from === 'camera' ? 'camera' : 'photo'} access to add a photo.`); return; }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.4, allowsEditing: true, aspect: [1, 1] };
    const r = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    setUploading(true);
    try {
      const path = await uploadPhoto('/uploads/product-photo', r.assets[0].uri, r.assets[0].mimeType || 'image/jpeg');
      set('imageUrl', path);
    } catch (e: any) { Alert.alert('Photo not added', e.message); } finally { setUploading(false); }
  };
  const choosePhoto = () => Alert.alert('Product photo', undefined, [
    { text: 'Take photo', onPress: () => pickPhoto('camera') },
    { text: 'Choose from gallery', onPress: () => pickPhoto('library') },
    ...(form.imageUrl ? [{ text: 'Remove photo', style: 'destructive' as const, onPress: () => set('imageUrl', null) }] : []),
    { text: 'Cancel', style: 'cancel' as const },
  ]);

  const save = async () => {
    setError(null);
    if (!form.name.trim()) { setError('Enter the product name'); return; }
    if (!validDate(form.purchaseDate) || !validDate(form.warrantyUntil)) { setError('Enter dates as DD-MM-YYYY'); return; }
    if (uploading) { setError('Wait for the photo to finish uploading'); return; }
    setBusy(true);
    try {
      const body = { ...form, purchaseDate: toIso(form.purchaseDate), warrantyUntil: toIso(form.warrantyUntil) };
      if (id) await api.put(`/products/${id}`, body); else await api.post('/products', body);
      navigation.goBack();
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  const remove = () => Alert.alert('Delete product?', `"${form.name}" will be removed from My Products.`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await api.del(`/products/${id}`); navigation.goBack(); } catch (e: any) { setError(e.message); setBusy(false); }
      },
    },
  ]);

  if (loading) return <Loading />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={choosePhoto} disabled={uploading}
          style={{ alignSelf: 'center', width: 132, height: 132, borderRadius: 24, marginBottom: space.lg, backgroundColor: colors.surface, borderWidth: form.imageUrl ? 0 : 1.5, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {form.imageUrl ? (
            <Image source={{ uri: fileUrl(form.imageUrl) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <>
              <Ionicons name="camera-outline" size={32} color={colors.textMuted} />
              <Text style={[type.small, { marginTop: 4, fontWeight: '700' }]}>Add photo</Text>
            </>
          )}
          {uploading && <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brand} /></View>}
          {!!form.imageUrl && !uploading && (
            <View style={{ position: 'absolute', right: 8, bottom: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(15,23,42,0.65)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="pencil" size={15} color="#fff" />
            </View>
          )}
        </Pressable>

        <Field label="Product name *" placeholder="e.g. Biochemistry analyzer, Bedroom AC" value={form.name} onChangeText={(t) => set('name', t)} />

        {!!categories.length && (
          <>
            <Text style={[type.label, { marginBottom: space.sm }]}>Category</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.md }}>
              {categories.map((c) => (
                <Chip key={c.key} label={c.name} icon={c.icon as any} selected={form.categoryKey === c.key}
                  onPress={() => set('categoryKey', form.categoryKey === c.key ? null : c.key)} />
              ))}
            </View>
          </>
        )}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Field style={{ flex: 1 }} label="Brand" placeholder="e.g. Meril" value={form.brand} onChangeText={(t) => set('brand', t)} />
          <Field style={{ flex: 1 }} label="Model" placeholder="e.g. AutoQuant 200i" value={form.model} onChangeText={(t) => set('model', t)} />
        </View>
        <Field label="Serial number" placeholder="Printed on the label at the back" value={form.serialNo} onChangeText={(t) => set('serialNo', t)} autoCapitalize="characters" />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Field style={{ flex: 1 }} label="Purchase date" placeholder="DD-MM-YYYY" keyboardType="number-pad" value={form.purchaseDate} onChangeText={(t) => set('purchaseDate', maskDate(t))} />
          <Field style={{ flex: 1 }} label="Warranty till" placeholder="DD-MM-YYYY" keyboardType="number-pad" value={form.warrantyUntil} onChangeText={(t) => set('warrantyUntil', maskDate(t))} />
        </View>
        <Field label="Where is it?" placeholder="e.g. Lab 2, 1st floor / Living room" value={form.location} onChangeText={(t) => set('location', t)} />
        <Field label="Notes" placeholder="Anything the engineer should know" value={form.notes} onChangeText={(t) => set('notes', t)} multiline />
        <ErrorText>{error}</ErrorText>
        {!!id && <Button title="Delete product" variant="ghost" icon="trash-outline" onPress={remove} disabled={busy} style={{ marginTop: space.sm }} />}
      </ScrollView>
      <BottomBar>
        <Button title={id ? 'Save changes' : 'Save product'} onPress={save} loading={busy} style={{ flex: 1 }} />
      </BottomBar>
    </KeyboardAvoidingView>
  );
}
