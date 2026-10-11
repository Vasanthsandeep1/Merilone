import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@meril-one/shared';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Button, Empty, IconBadge, Loading, api, fileUrl, space, fs } from '@meril-one/shared';

const F = { bold: 'Poppins_700Bold', heavy: 'Poppins_800ExtraBold', medium: 'Poppins_500Medium' };
const INK = '#0F1B2D';
const BLUE = '#1E6FE0';

type StoreProduct = {
  id: number; name: string; code: string | null; category: string; division: string;
  description: string | null; imageUrl: string | null; brochureUrl: string | null; seller: string | null;
};
type Quote = {
  id: number; requestNo: string; productId: number; productName: string; quantity: number; message: string | null;
  status: 'new' | 'contacted' | 'quoted' | 'closed'; reply: string | null; createdAt: string;
};
const QUOTE_STATUS: Record<Quote['status'], { label: string; color: string; bg: string }> = {
  new: { label: 'Sent', color: BLUE, bg: '#E8F0FE' },
  contacted: { label: 'In progress', color: '#EA580C', bg: '#FFF2E2' },
  quoted: { label: 'Quote ready', color: '#16A34A', bg: '#DCFCE7' },
  closed: { label: 'Closed', color: '#64748B', bg: '#F1F5F9' },
};
const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Store: the products listed in B2G (View Profile > Products). No prices:
// each product has "Get quote", which sends a quote request to the portal
// (Service Management > Quote Requests). "My quotes" shows the replies.
export default function StoreScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<StoreProduct[] | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'store' | 'quotes'>('store');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [open, setOpen] = useState<StoreProduct | null>(null);
  const [asking, setAsking] = useState<StoreProduct | null>(null);
  // Opened from Home's Meril Store strip: show that product's details.
  const route = useRoute<any>();
  const openId: number | undefined = route.params?.openId;
  useEffect(() => {
    if (!openId || !items) return;
    const p = items.find((x) => x.id === openId);
    if (p) { setView('store'); setOpen(p); }
    navigation.setParams({ openId: undefined } as any);
  }, [openId, items, navigation]);

  const load = useCallback(async () => {
    try {
      const [p, q] = await Promise.all([
        api.get<{ data: StoreProduct[] }>('/store/products'),
        api.get<{ data: Quote[] }>('/quote-requests'),
      ]);
      setItems(p.data); setQuotes(q.data); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const cats = useMemo(() => [...new Set((items || []).map((p) => p.category))], [items]);
  const q = query.trim().toLowerCase();
  const shown = (items || []).filter((p) => (!cat || p.category === cat)
    && (!q || [p.name, p.code, p.category, p.description, p.seller].filter(Boolean).join(' ').toLowerCase().includes(q)));

  if (!items && error) return <Empty icon="cloud-offline" title="Couldn't load the store" text={error} action={<Button title="Try again" variant="outline" onPress={load} />} />;
  if (!items) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {/* Store / My quotes */}
        <View style={{ flexDirection: 'row', backgroundColor: '#E6EBF3', borderRadius: 14, padding: 4, marginBottom: space.md }}>
          {([['store', 'Store'], ['quotes', `My quotes${quotes.length ? ` (${quotes.length})` : ''}`]] as const).map(([k, label]) => (
            <Pressable key={k} onPress={() => setView(k)} style={{ flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center', backgroundColor: view === k ? '#fff' : 'transparent' }}>
              <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: view === k ? BLUE : '#64748B' }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {view === 'store' ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: '#E6EAF2' }}>
              <Ionicons name="search" size={19} color="#64748B" />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search products, code, category" placeholderTextColor="#94A3B8"
                style={{ flex: 1, marginLeft: 10, fontSize: fs(14), color: INK, fontFamily: F.medium }} />
              {!!query && <Ionicons name="close-circle" size={19} color="#94A3B8" onPress={() => setQuery('')} />}
            </View>

            {cats.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: space.md }}>
                {[null, ...cats].map((c) => {
                  const on = cat === c;
                  return (
                    <Pressable key={c || 'all'} onPress={() => setCat(c)}
                      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: on ? BLUE : '#fff', borderWidth: 1, borderColor: on ? BLUE : '#E6EAF2' }}>
                      <Text style={{ fontFamily: F.bold, fontSize: fs(12), color: on ? '#fff' : INK }}>{c || 'All'}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {!items.length ? (
              <Empty icon="storefront-outline" title="The store is empty right now" text="Products will show here as soon as they're added." />
            ) : !shown.length ? (
              <Empty icon="search" title="No product matches" text="Try another word or category." />
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: cats.length > 1 ? 0 : space.md }}>
                {shown.map((p) => (
                  <Pressable key={p.id} onPress={() => setOpen(p)}
                    style={({ pressed }) => [card, { width: '48.5%', marginBottom: space.md, padding: 10, opacity: pressed ? 0.9 : 1 }]}>
                    <View style={{ height: 120, borderRadius: 12, backgroundColor: '#F1F5FB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {p.imageUrl ? <Image source={{ uri: fileUrl(p.imageUrl) }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                        : <IconBadge icon="medkit" color={BLUE} size={52} />}
                    </View>
                    <Text style={{ fontFamily: F.medium, fontSize: fs(10), color: BLUE, marginTop: 8 }} numberOfLines={1}>{p.category.toUpperCase()}</Text>
                    <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: INK, lineHeight: 18 }} numberOfLines={2}>{p.name}</Text>
                    {!!p.code && <Text style={{ fontFamily: F.medium, fontSize: fs(11), color: '#64748B' }} numberOfLines={1}>{p.code}</Text>}
                    <Pressable onPress={() => setAsking(p)}
                      style={({ pressed }) => ({ marginTop: 8, height: 36, borderRadius: 10, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', opacity: pressed ? 0.85 : 1 })}>
                      <Ionicons name="pricetag-outline" size={14} color="#fff" />
                      <Text style={{ fontFamily: F.bold, fontSize: fs(12), color: '#fff', marginLeft: 5 }}>Get quote</Text>
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : !quotes.length ? (
          <Empty icon="pricetags-outline" title="No quote requests yet" text="Tap Get quote on any product in the Store."
            action={<Button title="Browse the store" variant="outline" onPress={() => setView('store')} />} />
        ) : quotes.map((qt) => {
          const st = QUOTE_STATUS[qt.status];
          return (
            <View key={qt.id} style={[card, { padding: space.lg, marginBottom: space.md }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.bold, fontSize: fs(14), color: INK }} numberOfLines={2}>{qt.productName}</Text>
                  <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: '#64748B' }}>{qt.requestNo} · Qty {qt.quantity} · {fmt(qt.createdAt)}</Text>
                </View>
                <View style={{ backgroundColor: st.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: F.bold, fontSize: fs(11), color: st.color }}>{st.label}</Text>
                </View>
              </View>
              {!!qt.message && <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: '#475569', marginTop: 8 }}>You: “{qt.message}”</Text>}
              {!!qt.reply && (
                <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#F1F5FB' }}>
                  <Text style={{ fontFamily: F.bold, fontSize: fs(11), color: BLUE }}>REPLY</Text>
                  <Text style={{ fontFamily: F.medium, fontSize: fs(13), color: INK }}>{qt.reply}</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Product details */}
      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)} presentationStyle="pageSheet">
        {open && (
          <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['bottom']}>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={{ height: 260, backgroundColor: '#F1F5FB', alignItems: 'center', justifyContent: 'center' }}>
                {open.imageUrl ? <Image source={{ uri: fileUrl(open.imageUrl) }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                  : <IconBadge icon="medkit" color={BLUE} size={90} />}
                <Pressable onPress={() => setOpen(null)} hitSlop={10}
                  style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close" size={20} color="#fff" />
                </Pressable>
              </View>
              <View style={{ padding: space.lg }}>
                <Text style={{ fontFamily: F.bold, fontSize: fs(11), color: BLUE }}>{open.category.toUpperCase()}</Text>
                <Text style={{ fontFamily: F.heavy, fontSize: fs(21), color: INK, marginTop: 2 }}>{open.name}</Text>
                <Text style={{ fontFamily: F.medium, fontSize: fs(13), color: '#64748B', marginTop: 2 }}>
                  {[open.code && `Code: ${open.code}`, open.seller && `by ${open.seller}`].filter(Boolean).join(' · ')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, padding: 12, borderRadius: 12, backgroundColor: '#FFF7ED' }}>
                  <Ionicons name="information-circle" size={18} color="#EA580C" />
                  <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: '#9A3412', marginLeft: 8, flex: 1 }}>Prices depend on quantity and location. Ask for a quote and we'll get back to you.</Text>
                </View>
                {(() => {
                  const { about, specs } = splitSpecs(open.description);
                  const rows: [string, string][] = [
                    ...(open.code ? [['Product code', open.code] as [string, string]] : []),
                    ['Category', open.category],
                    ...(open.seller ? [['Brand / seller', open.seller] as [string, string]] : []),
                    ...specs,
                  ];
                  return (
                    <>
                      {!!about && (
                        <>
                          <Text style={{ fontFamily: F.bold, fontSize: fs(15), color: INK, marginTop: space.lg }}>About this product</Text>
                          <Text style={{ fontFamily: F.medium, fontSize: fs(13), color: '#334155', lineHeight: 20, marginTop: 4 }}>{about}</Text>
                        </>
                      )}
                      <Text style={{ fontFamily: F.bold, fontSize: fs(15), color: INK, marginTop: space.lg, marginBottom: space.sm }}>Specifications</Text>
                      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: '#E6EAF2', overflow: 'hidden' }}>
                        {rows.map(([k, v], i) => (
                          <View key={`${k}${i}`} style={{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: i % 2 ? '#fff' : '#F8FAFC', borderTopWidth: i ? 1 : 0, borderTopColor: '#EEF1F6' }}>
                            <Text style={{ fontFamily: F.medium, fontSize: fs(12), color: '#64748B', width: '42%' }}>{k}</Text>
                            <Text style={{ fontFamily: F.bold, fontSize: fs(12), color: INK, flex: 1 }}>{v}</Text>
                          </View>
                        ))}
                      </View>
                      {!!open.brochureUrl && (
                        <Pressable onPress={() => Linking.openURL(fileUrl(open.brochureUrl!))}
                          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', marginTop: space.md, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#D3E3FB', backgroundColor: '#F1F6FE', opacity: pressed ? 0.85 : 1 })}>
                          <Ionicons name="document-text-outline" size={20} color={BLUE} />
                          <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: BLUE, marginLeft: 8, flex: 1 }}>View brochure / datasheet</Text>
                          <Ionicons name="open-outline" size={16} color={BLUE} />
                        </Pressable>
                      )}
                    </>
                  );
                })()}
              </View>
            </ScrollView>
            <View style={{ padding: space.lg, borderTopWidth: 1, borderTopColor: '#EEF1F6' }}>
              <Button title="Get quote" icon="pricetag-outline" onPress={() => { const p = open; setOpen(null); setTimeout(() => setAsking(p), 350); }} />
            </View>
          </SafeAreaView>
        )}
      </Modal>

      <QuoteSheet product={asking} onClose={() => setAsking(null)} bottom={insets.bottom}
        onSent={() => { setAsking(null); load(); setView('quotes'); }} />
    </View>
  );
}

// "Get quote" sheet: quantity + an optional note, sent to the portal.
function QuoteSheet({ product, onClose, onSent, bottom }: { product: StoreProduct | null; onClose: () => void; onSent: () => void; bottom: number }) {
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  const send = async () => {
    if (!product) return;
    if (n < 1) { Alert.alert('Quantity', 'Enter a quantity of 1 or more.'); return; }
    setBusy(true);
    try {
      await api.post('/quote-requests', { productId: product.id, quantity: n, message: note });
      setQty('1'); setNote('');
      Alert.alert('Quote requested', "We've sent your request. You'll get a notification when there's a reply.");
      onSent();
    } catch (e: any) { Alert.alert('Not sent', e.message); } finally { setBusy(false); }
  };
  return (
    <Modal visible={!!product} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        {product && (
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.lg, paddingBottom: Math.max(bottom, 16) }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', marginBottom: space.md }} />
            <Text style={{ fontFamily: F.heavy, fontSize: fs(18), color: INK }}>Get a quote</Text>
            <Text style={{ fontFamily: F.medium, fontSize: fs(13), color: '#64748B' }} numberOfLines={2}>{product.name}{product.code ? ` · ${product.code}` : ''}</Text>

            <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: INK, marginTop: space.lg }}>Quantity</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <Pressable onPress={() => setQty(String(Math.max(1, n - 1)))} style={stepBtn}>
                <Ionicons name="remove" size={20} color={BLUE} />
              </Pressable>
              <TextInput value={qty} onChangeText={(t) => setQty(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad"
                style={{ width: 80, height: 44, marginHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', textAlign: 'center', fontFamily: F.bold, fontSize: fs(16), color: INK }} />
              <Pressable onPress={() => setQty(String(n + 1))} style={stepBtn}>
                <Ionicons name="add" size={20} color={BLUE} />
              </Pressable>
            </View>

            <Text style={{ fontFamily: F.bold, fontSize: fs(13), color: INK, marginTop: space.lg }}>Anything we should know? (optional)</Text>
            <TextInput value={note} onChangeText={setNote} multiline placeholder="e.g. Need delivery to Chennai by next month, with installation"
              placeholderTextColor="#94A3B8"
              style={{ minHeight: 80, marginTop: 6, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, fontFamily: F.medium, fontSize: fs(13), color: INK, textAlignVertical: 'top' }} />

            <Button title="Send quote request" icon="send" loading={busy} onPress={send} style={{ marginTop: space.lg }} />
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
// The description may hold specs as "Key: Value" lines (one per line);
// those become the Specifications table, the rest is the About text.
function splitSpecs(text: string | null) {
  const specs: [string, string][] = [];
  const about: string[] = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*[-•*]?\s*([^:]{2,40}):\s*(.+)$/.exec(line);
    if (m) specs.push([m[1].trim(), m[2].trim()]); else if (line.trim()) about.push(line.trim());
  }
  return { about: about.join('\n'), specs };
}

const stepBtn = { width: 44, height: 44, borderRadius: 12, backgroundColor: '#E8F0FE', alignItems: 'center' as const, justifyContent: 'center' as const };

const card = {
  backgroundColor: '#fff', borderRadius: 16,
  shadowColor: '#1E3A8A', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
};
