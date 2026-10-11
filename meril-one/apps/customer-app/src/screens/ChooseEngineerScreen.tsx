import { useCallback, useLayoutEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, Empty, api, colors, money, radius, space, type, fs } from '@meril-one/shared';
import type { EngineerCard, OemEngineer } from '@meril-one/shared';
import type { StackProps } from '../nav';

// Initials avatar for an engineer.
export function Avatar({ name, size = 52, online }: { name: string | null; size?: number; online?: boolean }) {
  const initials = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return (
    <View>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: size * 0.36, fontWeight: '800', color: colors.brand }}>{initials}</Text>
      </View>
      {online !== undefined && (
        <View style={{ position: 'absolute', right: 0, bottom: 0, width: size * 0.28, height: size * 0.28, borderRadius: size, borderWidth: 2, borderColor: colors.surface, backgroundColor: online ? colors.success : colors.textFaint }} />
      )}
    </View>
  );
}

// "★ 4.6 (23)" or "New" when nobody has rated them yet.
export function Stars({ rating, count }: { rating: number | null; count: number }) {
  if (!rating) return <Text style={{ fontSize: fs(12), fontWeight: '700', color: colors.info, backgroundColor: colors.infoSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden' }}>New</Text>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.success, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: fs(12) }}>{rating.toFixed(1)}</Text>
      <Ionicons name="star" size={10} color="#fff" style={{ marginLeft: 2 }} />
      <Text style={{ color: '#fff', fontSize: fs(11), marginLeft: 4 }}>({count})</Text>
    </View>
  );
}

// Engineers who can repair this category and cover the customer's area.
// Tap one to see their profile and book them.
export default function ChooseEngineerScreen({ route, navigation }: StackProps<'ChooseEngineer'>) {
  const { title, categoryId, serviceId, productId } = route.params;
  const [rows, setRows] = useState<EngineerCard[] | null>(null);
  const [area, setArea] = useState<{ city: string; pincode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Booking for one of My Products: its OEM company's own engineers first.
  const [oem, setOem] = useState<{ userId: number; name: string } | null>(null);
  const [oemEngineers, setOemEngineers] = useState<OemEngineer[]>([]);

  useLayoutEffect(() => { navigation.setOptions({ title: 'Choose engineer' }); }, [navigation]);

  const load = useCallback(async () => {
    const q = serviceId ? `serviceId=${serviceId}` : categoryId ? `categoryId=${categoryId}` : '';
    try {
      const r = await api.get<{ data: EngineerCard[]; area: { city: string; pincode: string } }>(`/engineers?${q}`);
      setRows(r.data); setArea(r.area); setError(null);
    } catch (e: any) { setError(e.message); }
    if (productId) {
      api.get<{ oem: { userId: number; name: string } | null; engineers: OemEngineer[] }>(`/products/${productId}/oem-engineers`)
        .then((o) => { setOem(o.oem); setOemEngineers(o.engineers); })
        .catch(() => { setOem(null); setOemEngineers([]); });
    }
  }, [categoryId, serviceId, productId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (e: EngineerCard) => navigation.navigate('EngineerProfile', { engineerId: e.id, categoryId, serviceId, productId });
  const book = (e: EngineerCard) => navigation.navigate('Book', { engineerId: e.id, serviceId, productId, categoryId });
  const bookOem = (e: OemEngineer) => navigation.navigate('Book', { oemEngineerId: e.id, serviceId, productId, categoryId });
  const online = (rows || []).filter((e) => e.online).length;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={rows || []}
      keyExtractor={(e) => String(e.id)}
      contentContainerStyle={{ padding: space.lg, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View style={{ marginBottom: space.md }}>
          <Text style={type.h2}>{title}</Text>
          {/* The product's OEM company's own engineers */}
          {!!oem && (
            <View style={{ backgroundColor: '#2563EB', borderRadius: radius.xl, padding: space.lg, marginTop: space.md, marginBottom: space.sm, overflow: 'hidden' }}>
              <Ionicons name="shield-checkmark" size={110} color="rgba(255,255,255,0.12)" style={{ position: 'absolute', right: -12, bottom: -16 }} />
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: fs(16) }}>{oem.name} authorised engineers</Text>
              <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: fs(12), marginTop: 2, marginBottom: space.md, maxWidth: '85%' }}>
                {oemEngineers.length ? 'From the company that sold you this product, covering your area.' : `${oem.name} has no engineer covering ${area?.city || 'your area'} yet. Choose a Meril One engineer below.`}
              </Text>
              {oemEngineers.map((e) => (
                <View key={e.id} style={{ backgroundColor: '#fff', borderRadius: radius.lg, padding: space.md, marginBottom: space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Avatar name={e.name} size={46} online={e.onApp ? e.online : undefined} />
                    <View style={{ flex: 1, marginLeft: space.md }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[type.h3, { flexShrink: 1 }]} numberOfLines={1}>{e.name}</Text>
                        <Ionicons name="shield-checkmark" size={14} color="#2563EB" style={{ marginLeft: 4 }} />
                      </View>
                      <Text style={type.small} numberOfLines={1}>{e.companyName} · {e.match === 'district' ? `covers ${e.coverage}` : `covers ${e.coverage}`}</Text>
                      <Text style={[type.small, { marginTop: 2 }]}>
                        {[e.experienceYears ? `${e.experienceYears} yrs exp` : null, e.onApp ? `${e.jobsDone} jobs done` : null, e.onApp ? (e.online ? 'Online' : 'Offline') : 'Gets your request directly'].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {e.onApp && <Stars rating={e.rating} count={e.ratingCount} />}
                  </View>
                  <Button title={`Book ${e.name.split(' ')[0]}`} onPress={() => bookOem(e)} style={{ marginTop: space.md, height: 42 }} />
                </View>
              ))}
            </View>
          )}
          {!!oem && <Text style={[type.label, { marginTop: space.md }]}>Other engineers near you</Text>}
          <Text style={type.small}>
            {rows ? `${rows.length} engineer${rows.length === 1 ? '' : 's'} near ${area?.city || 'you'}${rows.length ? ` · ${online} online now` : ''}` : 'Finding engineers near you…'}
          </Text>
        </View>
      }
      ListEmptyComponent={rows === null && !error ? null : (
        <Empty icon={error ? 'cloud-offline' : 'people-outline'} title={error ? "Couldn't load engineers" : 'No engineers here yet'}
          text={error || `No engineer covers ${area?.city || 'your area'} for this yet. You can still book; we'll send it to the first engineer who joins nearby.`}
          action={error ? <Button title="Try again" variant="outline" onPress={load} />
            : <Button title="Book without choosing" onPress={() => navigation.navigate('Book', { serviceId, productId, categoryId })} />} />
      )}
      renderItem={({ item: e }) => (
        <Card style={{ marginBottom: space.md }} onPress={() => open(e)}>
          <View style={{ flexDirection: 'row' }}>
            <Avatar name={e.name} online={e.online} />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[type.h3, { flex: 1 }]} numberOfLines={1}>{e.name}</Text>
                <Stars rating={e.rating} count={e.ratingCount} />
              </View>
              <Text style={type.small} numberOfLines={1}>{e.companyName || 'Independent engineer'}</Text>
              <Text style={[type.small, { marginTop: 2 }]}>
                {[e.experienceYears ? `${e.experienceYears} yrs exp` : null, `${e.jobsDone} job${e.jobsDone === 1 ? '' : 's'} done`, e.online ? 'Online' : 'Offline'].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flex: 1 }} />
            <Button title="View" variant="outline" onPress={() => open(e)} style={{ height: 40, paddingHorizontal: space.lg, marginRight: space.sm }} />
            <Button title="Book" onPress={() => book(e)} style={{ height: 40, paddingHorizontal: space.xl }} />
          </View>
        </Card>
      )}
    />
  );
}
