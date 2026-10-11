import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@meril-one/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ACTIVE, Empty, IconBadge, ProductThumb, STATUS, api, colors, fileUrl, slotLabel, space, type, useAuth, fmtDate, fs, isSmallScreen } from '@meril-one/shared';
import type { Booking, Product, ProductCategory } from '@meril-one/shared';
import { useCatalog } from '../catalog';
import type { RootStack } from '../nav';
import AddCategoryModal from '../AddCategoryModal';
import AdCarousel from '../AdCarousel';
import type { AdSlide } from '../AdCarousel';
import Bell from '../Bell';
import AutoScrollRow from '../AutoScrollRow';
import RescheduleCard, { hasPendingReschedule } from '../RescheduleCard';
import { warrantyInfo } from './ProductsScreen';

export const HOME_BLUE = '#1E6FE0';
const BLUE_DARK = '#1553BE';
const INK = '#0F1B2D';
const F = { bold: 'Poppins_700Bold', heavy: 'Poppins_800ExtraBold', medium: 'Poppins_500Medium' };
const card = { backgroundColor: '#fff', borderRadius: 20, shadowColor: '#1E3A8A', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 };

// "What can we help you with?" tiles: icon, pastel tile colour, icon colour.
type Tile = { key: string; label: string; icon: string; bg: string; fg: string; onPress: () => void };

// Customer home: blue rounded header (greeting, bell, avatar, search, hero:
// live booking + at-a-glance counts),
// category chips, the "What can we help you with?" grid, ads, My products.
export default function HomeScreen() {
  const { user } = useAuth();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { categories, error, reload } = useCatalog();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Booking[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [myCats, setMyCats] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [hint, setHint] = useState(0);
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [store, setStore] = useState<{ id: number; name: string; code: string | null; category: string; imageUrl: string | null }[]>([]);
  const [quotes, setQuotes] = useState<{ id: number; status: string }[]>([]);
  const [ads, setAds] = useState<{ id: number; title: string; imagePath: string; headline: string | null; subline: string | null; ctaText: string | null; target: { type: 'category'; categoryId: number; name: string } | null }[]>([]);

  const loadActive = useCallback(() => {
    api.get<{ data: Booking[] }>('/bookings').then((r) => { setActive(r.data.filter((b) => ACTIVE.includes(b.status))); setAllBookings(r.data); }).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { loadActive(); const t = setInterval(loadActive, 15000); return () => clearInterval(t); }, [loadActive]));
  const loadMine = useCallback(() => {
    api.get<{ data: ProductCategory[] }>('/product-categories').then((r) => setMyCats(r.data.filter((c) => c.custom))).catch(() => {});
    api.get<{ data: Product[] }>('/products').then((r) => setProducts(r.data)).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { loadMine(); }, [loadMine]));
  const loadStore = useCallback(() => {
    api.get<{ data: typeof store }>('/store/products').then((r) => setStore(r.data)).catch(() => {});
    api.get<{ data: typeof quotes }>('/quote-requests').then((r) => setQuotes(r.data)).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { loadStore(); }, [loadStore]));
  const loadAds = useCallback(() => { api.get<{ data: typeof ads }>('/ads').then((r) => setAds(r.data)).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => { loadAds(); const t = setInterval(loadAds, 60000); return () => clearInterval(t); }, [loadAds]));

  const openCategory = (key: string, name: string, custom: boolean) => navigation.navigate('ProductCategory', { key, name, custom });
  const goTab = (screen: string) => navigation.navigate('Main' as any, { screen } as any);
  const quickBook = (p: Product) => navigation.navigate('Book', { categoryId: p.categoryId ?? undefined, productId: p.id });

  const allServices = useMemo(() => categories.flatMap((c) => c.services.map((s) => ({ ...s, category: c }))), [categories]);
  const q = query.trim().toLowerCase();
  const results = q ? allServices.filter((s) => `${s.name} ${s.category.name}`.toLowerCase().includes(q)) : [];
  useEffect(() => { const t = setInterval(() => setHint((h) => h + 1), 2500); return () => clearInterval(t); }, []);
  const hintText = allServices.length ? allServices[hint % allServices.length].name.toLowerCase() : 'a service';

  const slides: AdSlide[] = ads.map((a) => ({
    key: `ad${a.id}`, image: fileUrl(a.imagePath), eyebrow: '', title: a.title, cta: '', color: HOME_BLUE, icon: 'megaphone',
    text: { headline: a.headline, subline: a.subline, cta: a.ctaText },
    onPress: () => { if (a.target) openCategory(`b${a.target.categoryId}`, a.target.name, false); },
  }));

  // Products whose warranty has ended or ends within 30 days.
  const warrantyAlerts = (products || []).filter((p) => { const w = warrantyInfo(p.warrantyUntil); return w && w.color !== colors.success; }).length;
  const warrantyWatch = (products || []).map((p) => ({ p, w: warrantyInfo(p.warrantyUntil) })).filter((x) => x.w && x.w.color !== colors.success).slice(0, 4);
  const recent = allBookings.filter((b) => b.status === 'completed').slice(0, 3);
  const openQuotes = quotes.filter((x) => x.status !== 'closed').length;
  const firstName = user?.name?.split(' ')[0] || 'there';
  const initials = (user?.name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  const tiles: Tile[] = [
    { key: 'req', label: 'Request Service', icon: 'construct', bg: '#E8F0FE', fg: '#1E6FE0', onPress: () => navigation.navigate('Book', {}) },
    { key: 'prod', label: 'My Products', icon: 'hardware-chip', bg: '#F1E9FE', fg: '#7C3AED', onPress: () => goTab('Products') },
    { key: 'track', label: 'Track Order', icon: 'navigate', bg: '#E6F6EE', fg: '#16A34A', onPress: () => goTab('Track') },
    { key: 'book', label: 'My Bookings', icon: 'calendar', bg: '#FFF2E2', fg: '#EA580C', onPress: () => goTab('Bookings') },
    { key: 'add', label: 'Add Product', icon: 'add-circle', bg: '#E3F6F5', fg: '#0D9488', onPress: () => navigation.navigate('ProductForm') },
    { key: 'note', label: 'Notifications', icon: 'notifications', bg: '#FDE8EC', fg: '#E11D48', onPress: () => goTab('Alerts') },
    { key: 'addr', label: 'My Address', icon: 'location', bg: '#E5F4FD', fg: '#0284C7', onPress: () => navigation.navigate('EditProfile', { edit: true }) },
    { key: 'cat', label: 'Add Category', icon: 'pricetags', bg: '#EEF0FF', fg: '#4F46E5', onPress: () => setAdding(true) },
  ];
  const chips = [
    ...categories.map((c) => ({ key: `b${c.id}`, name: c.name, icon: c.icon, color: c.color, custom: false })),
    ...myCats.map((c) => ({ key: c.key, name: c.name, icon: c.icon, color: c.color, custom: true })),
  ];

  const onRefresh = async () => { setRefreshing(true); await reload(); loadActive(); loadMine(); loadAds(); loadStore(); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }}>
      {focused && <StatusBar style="light" />}
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}>

        {/* ---------- Blue header ---------- */}
        <LinearGradient colors={[HOME_BLUE, BLUE_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + 6, paddingHorizontal: space.lg, paddingBottom: space.xl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, paddingTop: 2 }}>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: fs(11), fontFamily: F.bold, letterSpacing: 1 }} numberOfLines={1}>
                {(user?.orgName || user?.city || 'MERIL ONE').toUpperCase()}
              </Text>
              <Text style={{ color: '#fff', fontSize: fs(26), fontFamily: F.heavy, lineHeight: 34, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Hi, {firstName} 👋</Text>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: fs(13), fontFamily: F.medium }}>Welcome back to Meril One</Text>
            </View>
            <Bell color="#fff" />
            <Pressable onPress={() => goTab('Account')}
              style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)', alignItems: 'center', justifyContent: 'center', marginLeft: 6, opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: fs(15) }}>{initials}</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, marginTop: space.lg, paddingHorizontal: 16, height: 52 }}>
            <Ionicons name="search" size={20} color="#64748B" />
            <TextInput value={query} onChangeText={setQuery} placeholder={`Search ${hintText}…`} placeholderTextColor="#94A3B8"
              style={{ flex: 1, marginLeft: 10, fontSize: fs(15), color: INK, fontFamily: F.medium }} />
            {!!query && <Ionicons name="close-circle" size={20} color="#94A3B8" onPress={() => setQuery('')} />}
          </View>

          {/* ---------- Hero: what the customer needs to know + quick nav ---------- */}
          {active[0] && (() => {
            const b = active[0];
            return (
              <Pressable onPress={() => navigation.navigate('BookingDetail', { id: b.id })}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', marginTop: space.md, padding: 12, borderRadius: 18, backgroundColor: '#fff', opacity: pressed ? 0.92 : 1 })}>
                <IconBadge icon={b.status === 'requested' ? 'search' : b.status === 'in_progress' ? 'construct' : 'car'} color={HOME_BLUE} size={42} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#16A34A', marginRight: 6 }} />
                    <Text style={{ fontFamily: F.bold, fontSize: fs(10), color: '#16A34A', letterSpacing: 0.8 }}>LIVE{active.length > 1 ? ` · +${active.length - 1} MORE` : ''}</Text>
                  </View>
                  <Text style={{ fontFamily: F.bold, fontSize: fs(14), color: INK }} numberOfLines={1}>{STATUS[b.status].customerText}</Text>
                  <Text style={{ fontFamily: F.medium, fontSize: fs(11), color: '#64748B' }} numberOfLines={1}>{b.service?.name} · {fmtDate(b.scheduledDate)}, {slotLabel(b.slot)}</Text>
                </View>
                {b.startOtp ? (
                  <View style={{ backgroundColor: HOME_BLUE, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: fs(9), fontFamily: F.bold }}>OTP</Text>
                    <Text style={{ color: '#fff', fontFamily: F.heavy, fontSize: fs(15), letterSpacing: 2 }}>{b.startOtp}</Text>
                  </View>
                ) : <Ionicons name="chevron-forward" size={18} color="#94A3B8" />}
              </Pressable>
            );
          })()}

          {/* At a glance (real counts) */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: space.md }}>
            {[
              { k: 'act', n: active.length, label: 'Active requests', icon: 'pulse', onPress: () => goTab(active.length ? 'Track' : 'Bookings') },
              { k: 'prod', n: products?.length ?? 0, label: 'My products', icon: 'cube', onPress: () => goTab('Products') },
              { k: 'war', n: warrantyAlerts, label: 'Warranty alerts', icon: 'shield-half', onPress: () => goTab('Products'), warn: warrantyAlerts > 0 },
            ].map((t) => (
              <Pressable key={t.k} onPress={t.onPress}
                style={({ pressed }) => ({ flex: 1, padding: isSmallScreen ? 9 : 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', opacity: pressed ? 0.85 : 1 })}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#fff', fontFamily: F.heavy, fontSize: fs(22) }}>{t.n}</Text>
                  <Ionicons name={t.icon as any} size={18} color={t.warn ? '#FDBA74' : 'rgba(255,255,255,0.85)'} />
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.88)', fontFamily: F.medium, fontSize: fs(11), lineHeight: fs(14) }} numberOfLines={2}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

        </LinearGradient>

        {q ? (
          /* ---------- Search results ---------- */
          <View style={[card, { margin: space.lg, padding: space.sm }]}>
            {results.length ? results.map((s, i) => (
              <Pressable key={s.id} onPress={() => navigation.navigate('Book', { serviceId: s.id })}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: '#EEF1F6', opacity: pressed ? 0.7 : 1 })}>
                <IconBadge icon={s.category.icon} color={s.category.color} size={42} />
                <View style={{ flex: 1, marginLeft: space.md }}>
                  <Text style={{ fontFamily: F.bold, fontSize: fs(14), color: INK }}>{s.name}</Text>
                  <Text style={type.small}>{s.category.name}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </Pressable>
            )) : <Empty icon="search" title="No matching service" text="Try another word, or use Request Service." />}
          </View>
        ) : (
          <>
            {active.filter(hasPendingReschedule).map((b) => (
              <View key={`rs${b.id}`} style={{ paddingHorizontal: space.lg }}><RescheduleCard b={b} compact onAnswered={() => loadActive()} /></View>
            ))}

            {/* ---------- Your products: quick chips (tap = book service) ---------- */}
            <Text style={{ fontFamily: F.bold, fontSize: fs(14), color: INK, marginHorizontal: space.lg, marginTop: space.lg }}>Your products</Text>
            {/* Drifts slowly sideways on its own (AutoScrollRow). */}
            <View style={{ paddingTop: 10, paddingBottom: space.lg }}>
            <AutoScrollRow padding={space.lg} gap={10}>
              {(products || []).map((p) => {
                const c = p.category?.color || HOME_BLUE;
                return (
                  <Pressable key={p.id} onPress={() => quickBook(p)}
                    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#E6EAF2', opacity: pressed ? 0.8 : 1 },
                      { shadowColor: '#1E3A8A', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 }]}>
                    <Ionicons name={(p.category?.icon || 'cube') as any} size={16} color={c} />
                    <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: INK, marginLeft: 6 }} numberOfLines={1}>{p.name}</Text>
                  </Pressable>
                );
              })}
              <Pressable onPress={() => navigation.navigate('ProductForm')}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F0FE', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, opacity: pressed ? 0.8 : 1 })}>
                <Ionicons name="add" size={16} color={HOME_BLUE} />
                <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: HOME_BLUE, marginLeft: 4 }}>Add product</Text>
              </Pressable>
            </AutoScrollRow>
            </View>

            {/* ---------- What can we help you with? ---------- */}
            <Text style={{ fontFamily: F.heavy, fontSize: fs(19), color: INK, marginHorizontal: space.lg, marginBottom: space.md }}>What can we help you with?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.lg - 5 }}>
              {tiles.map((t) => (
                <View key={t.key} style={{ width: '25%', padding: 5 }}>
                  <Pressable onPress={t.onPress}
                    style={({ pressed }) => [card, { borderRadius: 16, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
                    <IconBadge icon={t.icon} color={t.fg} size={46} />
                    <Text style={{ fontFamily: F.bold, fontSize: fs(11), color: INK, textAlign: 'center', marginTop: 8, lineHeight: 14 }} numberOfLines={2}>{t.label}</Text>
                  </Pressable>
                </View>
              ))}
            </View>

            {/* ---------- Ads (from B2G Post Ads) ---------- */}
            {slides.length > 0 && <View style={{ marginTop: space.lg }}><AdCarousel slides={slides} inset={space.lg} height={170} /></View>}

            {/* ---------- My products ---------- */}
            {products !== null && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: space.lg, marginTop: space.xl, marginBottom: space.md }}>
                  <Text style={{ fontFamily: F.heavy, fontSize: fs(19), color: INK }}>My products</Text>
                  <Text onPress={() => navigation.navigate('ProductForm')} style={{ fontFamily: F.bold, color: HOME_BLUE, fontSize: fs(13) }}>+ Add product</Text>
                </View>
                {products.length ? (
                  <FlatList horizontal data={products} keyExtractor={(p) => String(p.id)} showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 8 }}
                    renderItem={({ item }) => {
                      const c = item.category?.color || HOME_BLUE;
                      return (
                        <Pressable onPress={() => quickBook(item)} style={({ pressed }) => [card, { width: 150, marginRight: 12, padding: 12, borderRadius: 16, opacity: pressed ? 0.88 : 1 }]}>
                          <View style={{ height: 84, borderRadius: 12, backgroundColor: `${c}14`, alignItems: 'center', justifyContent: 'center' }}>
                            <ProductThumb imageUrl={item.imageUrl} icon={item.category?.icon} color={c} size={item.imageUrl ? 72 : 52} />
                          </View>
                          <Text style={{ fontFamily: F.bold, marginTop: 8, color: INK, fontSize: fs(13) }} numberOfLines={1}>{item.name}</Text>
                          <Text style={{ fontFamily: F.medium, color: '#64748B', fontSize: fs(11) }} numberOfLines={1}>{[item.brand, item.model].filter(Boolean).join(' ') || item.category?.name || ' '}</Text>
                          <Text style={{ fontFamily: F.bold, color: HOME_BLUE, marginTop: 6, fontSize: fs(12) }}>Book service ›</Text>
                        </Pressable>
                      );
                    }} />
                ) : (
                  <Pressable onPress={() => navigation.navigate('ProductForm')} style={[card, { marginHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', padding: space.lg }]}>
                    <IconBadge icon="cube" color={HOME_BLUE} size={46} />
                    <View style={{ flex: 1, marginLeft: space.md }}>
                      <Text style={{ fontFamily: F.bold, fontSize: fs(14), color: INK }}>Add your products for 1-tap booking</Text>
                      <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: '#64748B' }}>Save your machines once, book service in one tap.</Text>
                    </View>
                    <Ionicons name="add-circle" size={26} color={HOME_BLUE} />
                  </Pressable>
                )}
              </>
            )}

            {/* ---------- Warranty watch: ended / ending within 30 days ---------- */}
            {warrantyWatch.length > 0 && (
              <>
                <SectionHead title="Warranty watch" sub="Get these checked while you can" />
                <View style={{ paddingHorizontal: space.lg, gap: 10 }}>
                  {warrantyWatch.map(({ p, w }) => (
                    <Pressable key={p.id} onPress={() => navigation.navigate('ProductDetail', { id: p.id })}
                      style={({ pressed }) => [card, { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, opacity: pressed ? 0.9 : 1 }]}>
                      <ProductThumb imageUrl={p.imageUrl} icon={p.category?.icon} color={p.category?.color} size={44} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ fontFamily: F.bold, fontSize: fs(14), color: INK }} numberOfLines={1}>{p.name}</Text>
                        <Text style={{ fontFamily: F.bold, fontSize: fs(11), color: w!.color }} numberOfLines={1}>{w!.text}</Text>
                      </View>
                      <Pressable onPress={() => quickBook(p)} style={{ backgroundColor: '#E8F0FE', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
                        <Text style={{ fontFamily: F.bold, fontSize: fs(12), color: HOME_BLUE }}>Book check-up</Text>
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* ---------- Recent services: book again / rate ---------- */}
            {recent.length > 0 && (
              <>
                <SectionHead title="Recent services" action="See all" onAction={() => goTab('Bookings')} />
                <View style={{ paddingHorizontal: space.lg, gap: 10 }}>
                  {recent.map((b) => (
                    <Pressable key={b.id} onPress={() => navigation.navigate('BookingDetail', { id: b.id })}
                      style={({ pressed }) => [card, { padding: 14, borderRadius: 16, opacity: pressed ? 0.9 : 1 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <IconBadge icon={b.category?.icon || 'construct'} color={b.category?.color || HOME_BLUE} size={40} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={{ fontFamily: F.bold, fontSize: fs(14), color: INK }} numberOfLines={1}>{b.service?.name}</Text>
                          <Text style={{ fontFamily: F.medium, fontSize: fs(11), color: '#64748B' }} numberOfLines={1}>
                            {fmtDate(b.scheduledDate)}{b.engineer?.name ? ` · ${b.engineer.name}` : ''}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EEF1F6' }}>
                        {b.rating ? (
                          <View style={{ flexDirection: 'row', flex: 1 }}>
                            {[1, 2, 3, 4, 5].map((i) => <Ionicons key={i} name={i <= (b.rating || 0) ? 'star' : 'star-outline'} size={14} color="#F59E0B" />)}
                          </View>
                        ) : (
                          <Text style={{ flex: 1, fontFamily: F.bold, fontSize: fs(12), color: '#D97706' }}>Rate this service ›</Text>
                        )}
                        <Pressable onPress={() => navigation.navigate('Book', { serviceId: b.service?.id, productId: b.productId ?? undefined, categoryId: b.category?.id })}
                          style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name="refresh" size={14} color={HOME_BLUE} />
                          <Text style={{ fontFamily: F.bold, fontSize: fs(12), color: HOME_BLUE, marginLeft: 4 }}>Book again</Text>
                        </Pressable>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* ---------- From the Meril Store (no prices: Get quote) ---------- */}
            {(store.length > 0 || quotes.length > 0) && (
              <>
                <SectionHead title="Meril Store" sub={openQuotes ? `${openQuotes} quote request${openQuotes === 1 ? '' : 's'} in progress` : 'Products for your lab, hospital & home'} action="Open store" onAction={() => goTab('Store')} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: 12, paddingBottom: 6 }}>
                  {store.slice(0, 10).map((x) => (
                    <Pressable key={x.id} onPress={() => navigation.navigate('Main' as any, { screen: 'Store', params: { openId: x.id } } as any)} style={({ pressed }) => [card, { width: 150, padding: 10, borderRadius: 16, opacity: pressed ? 0.9 : 1 }]}>
                      <View style={{ height: 90, borderRadius: 12, backgroundColor: '#F1F5FB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {x.imageUrl ? <Image source={{ uri: fileUrl(x.imageUrl) }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : <IconBadge icon="medkit" color={HOME_BLUE} size={44} />}
                      </View>
                      <Text style={{ fontFamily: F.bold, fontSize: fs(12), color: INK, marginTop: 8 }} numberOfLines={2}>{x.name}</Text>
                      <Text style={{ fontFamily: F.bold, fontSize: fs(12), color: HOME_BLUE, marginTop: 4 }}>Get quote ›</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

            {/* ---------- Explore services (live catalogue) ---------- */}
            {categories.length > 0 && (
              <>
                <SectionHead title="Explore services" sub="Everything our engineers can fix" />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.lg - 5 }}>
                  {categories.map((c) => (
                    <View key={c.id} style={{ width: '50%', padding: 5 }}>
                      <Pressable onPress={() => navigation.navigate('Category', { categoryId: c.id, name: c.name })}
                        style={({ pressed }) => [card, { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, opacity: pressed ? 0.9 : 1 }]}>
                        <IconBadge icon={c.icon} color={c.color} size={38} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={{ fontFamily: F.bold, fontSize: fs(12), color: INK }} numberOfLines={1}>{c.name}</Text>
                          <Text style={{ fontFamily: F.medium, fontSize: fs(10), color: '#64748B' }}>{c.services.length} service{c.services.length === 1 ? '' : 's'}</Text>
                        </View>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* ---------- Machine down? (urgent request) ---------- */}
            <LinearGradient colors={['#0F2A55', '#1E4FA0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ marginHorizontal: space.lg, marginTop: space.xl, borderRadius: 20, padding: space.lg }}>
              <Text style={{ fontFamily: F.heavy, fontSize: fs(17), color: '#fff' }}>Machine down?</Text>
              <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>Raise an urgent request and the nearest engineer is alerted today.</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: space.md }}>
                <Pressable onPress={() => navigation.navigate('Book', { urgent: true })}
                  style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 42, borderRadius: 12, backgroundColor: '#EF4444', opacity: pressed ? 0.85 : 1 })}>
                  <Ionicons name="warning" size={16} color="#fff" />
                  <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: '#fff', marginLeft: 6 }}>Emergency</Text>
                </Pressable>
                <Pressable onPress={() => goTab('Track')}
                  style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', opacity: pressed ? 0.85 : 1 })}>
                  <Ionicons name="navigate" size={16} color="#fff" />
                  <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: '#fff', marginLeft: 6 }}>Track order</Text>
                </Pressable>
              </View>
            </LinearGradient>
            <Text style={{ textAlign: 'center', fontFamily: F.medium, fontSize: fs(11), color: '#94A3B8', marginTop: space.xl }}>Meril One · Service you can trust</Text>
          </>
        )}
      </ScrollView>
      <AddCategoryModal visible={adding} onClose={() => setAdding(false)} onAdded={(c) => { setAdding(false); loadMine(); openCategory(c.key, c.name, true); }} />
    </View>
  );
}

function SectionHead({ title, sub, action, onAction }: { title: string; sub?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: space.lg, marginTop: space.xl, marginBottom: space.md }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.heavy, fontSize: fs(19), color: INK }}>{title}</Text>
        {!!sub && <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: '#64748B' }}>{sub}</Text>}
      </View>
      {!!action && <Text onPress={onAction} style={{ fontFamily: F.bold, color: HOME_BLUE, fontSize: fs(13) }}>{action}</Text>}
    </View>
  );
}
