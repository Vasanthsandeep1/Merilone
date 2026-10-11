import { useCallback, useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { BottomBar, Button, Empty, IconBadge, ProductThumb, Loading, STATUS, api, colors, fmtDate, money, slotLabel, space, fs } from '@meril-one/shared';
import type { Booking, Product } from '@meril-one/shared';
import type { StackProps } from '../nav';
import { warrantyInfo } from './ProductsScreen';

const F = { bold: 'Poppins_700Bold', heavy: 'Poppins_800ExtraBold', medium: 'Poppins_500Medium' };
const INK = '#0F1B2D';
const BLUE = '#1E6FE0';
type Tab = 'overview' | 'history' | 'warranty';
const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// "Device Details" for one of My Products: header (icon, name, S/N · model,
// warranty badge), tabs Overview / Service History / Warranty, and Book
// service / Edit at the bottom. History = this customer's bookings made for
// this product.
export default function ProductDetailScreen({ route, navigation }: StackProps<'ProductDetail'>) {
  const { id } = route.params;
  const [p, setP] = useState<Product | null>(null);
  const [history, setHistory] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const load = useCallback(async () => {
    try {
      const [prods, bookings] = await Promise.all([
        api.get<{ data: Product[] }>('/products'),
        api.get<{ data: (Booking & { productId?: number | null })[] }>('/bookings'),
      ]);
      const found = prods.data.find((x) => x.id === id) || null;
      setP(found);
      if (!found) setError('This product was not found.');
      setHistory(bookings.data.filter((b) => b.productId === id));
    } catch (e: any) { setError(e.message); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const edit = useCallback(() => navigation.navigate('ProductForm', { id }), [navigation, id]);
  // "Edit" at the top right: change the photo and any details.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={edit} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F0FE', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Ionicons name="create-outline" size={16} color={BLUE} />
          <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: BLUE, marginLeft: 4 }}>Edit</Text>
        </Pressable>
      ),
    });
  }, [navigation, edit]);

  if (error && !p) return <Empty icon="alert-circle" title="Couldn't open this product" text={error} />;
  if (!p) return <Loading />;

  const color = p.category?.color || BLUE;
  const w = warrantyInfo(p.warrantyUntil);
  const done = history.filter((b) => b.status === 'completed');
  const lastService = done.length
    ? done.map((b) => b.timeline.filter((t) => t.status === 'completed').at(-1)?.at || b.scheduledDate).sort().at(-1) || null
    : null;
  const daysLeft = p.warrantyUntil ? Math.round((new Date(`${p.warrantyUntil}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000) : null;

  const rows: [string, string][] = [
    ['Serial Number', p.serialNo || '—'],
    ['Brand', p.brand || '—'],
    ['Model', p.model || '—'],
    ['Category', p.category?.name || '—'],
    ['Purchase Date', day(p.purchaseDate)],
    ['Warranty till', day(p.warrantyUntil)],
    ['Location', p.location || '—'],
    ['Last Service', lastService ? day(lastService) : 'Not serviced yet'],
    ['Services done', String(done.length)],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Header */}
        <View style={{ backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', padding: space.lg }}>
          {/* Tap the picture to change it (opens Edit). */}
          <Pressable onPress={edit}>
            <ProductThumb imageUrl={p.imageUrl} icon={p.category?.icon} color={color} size={84} />
            <View style={{ position: 'absolute', right: -6, bottom: -6, width: 28, height: 28, borderRadius: 14, backgroundColor: BLUE, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={p.imageUrl ? 'pencil' : 'camera'} size={13} color="#fff" />
            </View>
          </Pressable>
          <View style={{ flex: 1, marginLeft: space.lg }}>
            <Text style={{ fontFamily: F.heavy, fontSize: fs(19), color: INK }} numberOfLines={2}>{p.name}</Text>
            <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: '#64748B', marginTop: 2 }} numberOfLines={1}>
              {[p.serialNo && `S/N: ${p.serialNo}`, [p.brand, p.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || p.category?.name || ' '}
            </Text>
            {w ? (
              <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', backgroundColor: w.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 8 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: w.color, marginRight: 6 }} />
                <Text style={{ fontFamily: F.bold, fontSize: fs(11), color: w.color }}>{daysLeft !== null && daysLeft < 0 ? 'Warranty Expired' : daysLeft !== null && daysLeft <= 30 ? 'Warranty Ending Soon' : 'Warranty Active'}</Text>
              </View>
            ) : (
              <Text style={{ fontFamily: F.medium, fontSize: fs(11), color: '#94A3B8', marginTop: 8 }}>No warranty date saved</Text>
            )}
          </View>
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EEF1F6', borderBottomWidth: 1, borderBottomColor: '#EEF1F6', paddingHorizontal: space.sm }}>
          {([['overview', 'Overview'], ['history', `Service History${history.length ? ` (${history.length})` : ''}`], ['warranty', 'Warranty']] as [Tab, string][]).map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={{ paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: 2.5, borderBottomColor: tab === k ? BLUE : 'transparent' }}>
              <Text style={{ fontFamily: tab === k ? F.bold : F.medium, fontSize: fs(14), color: tab === k ? BLUE : '#64748B' }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ padding: space.lg }}>
          {tab === 'overview' && (
            <View style={box}>
              {rows.map(([k, v], i) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: '#EEF1F6' }}>
                  <Text style={{ fontFamily: F.medium, fontSize: fs(13), color: '#64748B', flex: 1 }}>{k}</Text>
                  <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: INK, maxWidth: '60%', textAlign: 'right' }}>{v}</Text>
                </View>
              ))}
              {!!p.notes && (
                <View style={{ paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#EEF1F6' }}>
                  <Text style={{ fontFamily: F.medium, fontSize: fs(13), color: '#64748B' }}>Notes</Text>
                  <Text style={{ fontFamily: F.medium, fontSize: fs(13), color: INK, marginTop: 4 }}>{p.notes}</Text>
                </View>
              )}
            </View>
          )}

          {tab === 'history' && (
            history.length ? history.map((b) => {
              const st = STATUS[b.status];
              return (
                <Pressable key={b.id} onPress={() => navigation.navigate('BookingDetail', { id: b.id })} style={({ pressed }) => [box, { marginBottom: space.md, opacity: pressed ? 0.85 : 1 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: F.bold, fontSize: fs(14), color: INK }} numberOfLines={1}>{b.service?.name}</Text>
                      <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: '#64748B' }}>{b.bookingNo} · {fmtDate(b.scheduledDate)}, {slotLabel(b.slot)}</Text>
                    </View>
                    <View style={{ backgroundColor: st.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ fontFamily: F.bold, fontSize: fs(11), color: st.color }}>{st.label}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EEF1F6' }}>
                    <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: '#64748B' }}>{b.engineer?.name ? `Engineer: ${b.engineer.name}` : 'Engineer not assigned yet'}</Text>
                  </View>
                  {!!b.issue && <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: INK, marginTop: 6 }} numberOfLines={2}>“{b.issue}”</Text>}
                </Pressable>
              );
            }) : (
              <View style={box}>
                <Empty icon="construct-outline" title="No service yet" text="Services you book for this product show up here." />
              </View>
            )
          )}

          {tab === 'warranty' && (
            <View style={box}>
              {p.warrantyUntil ? (
                <>
                  <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                    <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: w?.bg, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={daysLeft !== null && daysLeft < 0 ? 'close-circle' : 'shield-checkmark'} size={34} color={w?.color} />
                    </View>
                    <Text style={{ fontFamily: F.heavy, fontSize: fs(18), color: INK, marginTop: 10 }}>
                      {daysLeft !== null && daysLeft < 0 ? 'Warranty expired' : 'Under warranty'}
                    </Text>
                    <Text style={{ fontFamily: F.medium, fontSize: fs(13), color: '#64748B', marginTop: 2 }}>
                      {daysLeft !== null && daysLeft < 0 ? `Ended ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago` : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
                    </Text>
                  </View>
                  {[['Purchase Date', day(p.purchaseDate)], ['Warranty till', day(p.warrantyUntil)]].map(([k, v]) => (
                    <View key={k} style={{ flexDirection: 'row', paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#EEF1F6' }}>
                      <Text style={{ fontFamily: F.medium, fontSize: fs(13), color: '#64748B', flex: 1 }}>{k}</Text>
                      <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: INK }}>{v}</Text>
                    </View>
                  ))}
                </>
              ) : (
                <Empty icon="shield-outline" title="No warranty date saved" text="Add the warranty end date to see how long it's covered."
                  action={<Button title="Add warranty date" variant="outline" onPress={() => navigation.navigate('ProductForm', { id: p.id })} />} />
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <BottomBar>
        <Button title="Edit" variant="outline" icon="create-outline" onPress={() => navigation.navigate('ProductForm', { id: p.id })} style={{ flex: 1 }} />
        <Button title="Book service" icon="construct" onPress={() => navigation.navigate('Book', { categoryId: p.categoryId ?? undefined, productId: p.id })} style={{ flex: 1.6 }} />
      </BottomBar>
    </View>
  );
}

const box = {
  backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 6,
  shadowColor: '#1E3A8A', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2,
};
