import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@meril-one/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Empty, IconBadge, ProductThumb, api, colors, radius, shadow, space, type, fs } from '@meril-one/shared';
import type { Product, ProductCategory } from '@meril-one/shared';
import type { RootStack } from '../nav';
import AddCategoryModal from '../AddCategoryModal';

const todayIso = () => new Date().toLocaleDateString('en-CA');
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Warranty badge: in warranty / ends within 30 days / expired.
export function warrantyInfo(until: string | null) {
  if (!until) return null;
  const days = Math.round((new Date(`${until}T00:00:00`).getTime() - new Date(`${todayIso()}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return { text: `Warranty ended ${fmtDay(until)}`, color: colors.danger, bg: colors.dangerSoft };
  if (days <= 30) return { text: `Warranty ends ${fmtDay(until)}`, color: colors.warning, bg: colors.warningSoft };
  return { text: `In warranty till ${fmtDay(until)}`, color: colors.success, bg: colors.successSoft };
}

// One saved product, as a tappable card (used in a category's list).
export function ProductCard({ p, onPress, onBook, onEdit }: { p: Product; onPress: () => void; onBook?: () => void; onEdit?: () => void }) {
  const w = warrantyInfo(p.warrantyUntil);
  const makeModel = [p.brand, p.model].filter(Boolean).join(' · ');
  return (
    <Card style={{ marginBottom: space.md }} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ProductThumb imageUrl={p.imageUrl} icon={p.category?.icon} color={p.category?.color} size={52} />
        <View style={{ flex: 1, marginLeft: space.md }}>
          <Text style={type.h3} numberOfLines={1}>{p.name}</Text>
          {!!makeModel && <Text style={type.small} numberOfLines={1}>{makeModel}</Text>}
          {!!p.serialNo && <Text style={type.small} numberOfLines={1}>S/N {p.serialNo}</Text>}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </View>
      {(w || p.location) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.md, gap: space.sm }}>
          {w && <Text style={{ fontSize: fs(11), fontWeight: '700', color: w.color, backgroundColor: w.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' }}>{w.text}</Text>}
          {!!p.location && <Text style={type.small}>{p.location}</Text>}
        </View>
      )}
      {onBook && (
        <View style={{ flexDirection: 'row', marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border, gap: space.sm }}>
          <Button title="Edit" variant="outline" icon="create-outline" onPress={onEdit || onPress} style={{ flex: 1, height: 42 }} />
          <Button title="Book service" icon="construct-outline" onPress={onBook} style={{ flex: 1.4, height: 42 }} />
        </View>
      )}
    </Card>
  );
}

// "My Products" home: a grid of categories — the basic ones for this
// customer's background plus their own — and an "Add category" tile.
// Tapping a category opens its products (ProductCategoryScreen).
export default function ProductsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [cats, setCats] = useState<ProductCategory[] | null>(null);
  const [uncategorized, setUncategorized] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  // Search across all products (name, brand, model, serial, location, category).
  const [query, setQuery] = useState('');
  const [all, setAll] = useState<Product[]>([]);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([
        api.get<{ data: ProductCategory[]; uncategorized: number }>('/product-categories'),
        api.get<{ data: Product[] }>('/products'),
      ]);
      setCats(r.data); setUncategorized(r.uncategorized); setAll(p.data); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  const q = query.trim().toLowerCase();
  const found = q ? all.filter((p) => [p.name, p.brand, p.model, p.serialNo, p.location, p.category?.name, p.notes]
    .some((v) => String(v || '').toLowerCase().includes(q))) : [];
  const book = (p: Product) => navigation.navigate('Book', { categoryId: p.categoryId ?? undefined, productId: p.id });
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = (cats || []).reduce((s, c) => s + c.products, 0) + uncategorized;
  const open = (c: ProductCategory) => navigation.navigate('ProductCategory', { key: c.key, name: c.name, custom: c.custom });

  // Straight into the new category, ready to add products.
  const onAdded = (c: ProductCategory) => { setAdding(false); load(); open(c); };

  const tiles: (ProductCategory | 'add')[] = [
    ...(cats || []),
    ...(uncategorized ? [{ key: 'none', name: 'Other', icon: 'cube', color: colors.textMuted, custom: false, products: uncategorized }] : []),
    'add',
  ];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Text style={type.hero}>My products</Text>
        <Text style={[type.small, { marginTop: 2 }]}>
          {cats ? `${total} product${total === 1 ? '' : 's'} saved · pick a category to add or view` : 'Loading…'}
        </Text>

        {/* Search bar */}
        <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, height: 48, marginTop: space.lg }, shadow]}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search name, brand, model, serial no…" placeholderTextColor={colors.textFaint}
            autoCorrect={false} returnKeyType="search" style={{ flex: 1, marginLeft: 10, fontSize: fs(15), color: colors.text }} />
          {!!query && <Ionicons name="close-circle" size={20} color={colors.textFaint} onPress={() => setQuery('')} />}
        </View>

        {q ? (
          <View style={{ marginTop: space.lg }}>
            <Text style={[type.small, { marginBottom: space.md }]}>{found.length} product{found.length === 1 ? '' : 's'} found</Text>
            {found.length ? found.map((p) => (
              <ProductCard key={p.id} p={p} onPress={() => navigation.navigate('ProductDetail', { id: p.id })} onEdit={() => navigation.navigate('ProductForm', { id: p.id })} onBook={() => book(p)} />
            )) : (
              <Empty icon="search" title={`No product matches "${query.trim()}"`} text="Try the brand, model or serial number, or add it as a new product."
                action={<Button title="Add product" icon="add" onPress={() => navigation.navigate('ProductForm')} />} />
            )}
          </View>
        ) : error && !cats ? (
          <Empty icon="cloud-offline" title="Couldn't load your products" text={error} action={<Button title="Try again" variant="outline" onPress={load} />} />
        ) : cats && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: space.lg }}>
            {tiles.map((t) => t === 'add' ? (
              <Pressable key="add" onPress={() => setAdding(true)}
                style={({ pressed }) => [tileStyle, { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent, backgroundColor: colors.accentSoft, opacity: pressed ? 0.8 : 1 }]}>
                <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="add" size={26} color="#fff" />
                </View>
                <Text style={[type.h3, { marginTop: space.sm, color: colors.accent }]}>Add category</Text>
                <Text style={type.small}>Make your own</Text>
              </Pressable>
            ) : (
              <Pressable key={t.key} onPress={() => open(t)}
                style={({ pressed }) => [tileStyle, shadow, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}>
                <IconBadge icon={t.icon} color={t.color} />
                <Text style={[type.h3, { marginTop: space.sm, textAlign: 'center' }]} numberOfLines={2}>{t.name}</Text>
                <Text style={type.small}>{t.products ? `${t.products} product${t.products === 1 ? '' : 's'}` : 'No products yet'}</Text>
                {t.custom && <Text style={{ position: 'absolute', top: 8, right: 8, fontSize: fs(10), fontWeight: '700', color: '#7C3AED' }}>MINE</Text>}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <AddCategoryModal visible={adding} onClose={() => setAdding(false)} onAdded={onAdded} />
    </SafeAreaView>
  );
}

const tileStyle = { width: '48%' as const, minHeight: 132, borderRadius: radius.lg, padding: space.md, marginBottom: space.md, alignItems: 'center' as const, justifyContent: 'center' as const };

// Used by ProductCategoryScreen to remove an empty custom category.
export const confirmDeleteCategory = (name: string, onYes: () => void) =>
  Alert.alert('Delete category?', `"${name}" will be removed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: onYes }]);
