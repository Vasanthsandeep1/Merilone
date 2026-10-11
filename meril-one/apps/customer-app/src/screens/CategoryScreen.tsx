import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Empty, IconBadge, api, colors, money, radius, space, type, fs } from '@meril-one/shared';
import type { Product, Service } from '@meril-one/shared';
import { useCatalog } from '../catalog';
import type { StackProps } from '../nav';

// One category: the customer's own products in it (with Add product), then
// the services, with their usual time, each bookable.
export default function CategoryScreen({ route, navigation }: StackProps<'Category'>) {
  const { categories } = useCatalog();
  const { categoryId, productId } = route.params;
  const category = categoryId ? categories.find((c) => c.id === categoryId) : null;
  const key = `b${categoryId}`;
  const [mine, setMine] = useState<Product[] | null>(null);
  useFocusEffect(useCallback(() => {
    api.get<{ data: Product[] }>('/products').then((r) => setMine(r.data)).catch(() => setMine(null));
  }, []));
  const product = productId ? mine?.find((p) => p.id === productId) : undefined;
  const mineHere = mine === null ? null : mine.filter((p) => p.categoryKey === key);
  const book = (serviceId: number) => navigation.navigate('Book', { serviceId, productId });

  // A product in the customer's own category: every service, grouped.
  if (!categoryId) {
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}>
        {product && <ForProduct p={product} />}
        <Text style={[type.small, { marginBottom: space.lg }]}>Pick the service that fits your {product?.name || 'product'}.</Text>
        {categories.map((c) => (
          <View key={c.id} style={{ marginBottom: space.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.sm }}>
              <IconBadge icon={c.icon} color={c.color} size={30} />
              <Text style={[type.h3, { marginLeft: space.sm }]}>{c.name}</Text>
            </View>
            {c.services.map((s) => <ServiceRow key={s.id} s={s} onBook={() => book(s.id)} />)}
          </View>
        ))}
      </ScrollView>
    );
  }
  if (!category) return <Empty icon="alert-circle" title="Category not found" />;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.lg }}>
        <IconBadge icon={category.icon} color={category.color} size={56} />
        <View style={{ marginLeft: space.lg, flex: 1 }}>
          <Text style={type.h1}>{category.name}</Text>
          <Text style={type.small}>{category.services.length} services · verified engineers</Text>
        </View>
      </View>
      {product ? <ForProduct p={product} /> : (
      /* My products in this category */
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg, borderWidth: 1, borderColor: colors.border }}>
        <Pressable onPress={() => navigation.navigate('ProductCategory', { key, name: category.name, custom: false })} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="cube-outline" size={20} color={colors.brand} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <Text style={type.h3}>My products here</Text>
            <Text style={type.small}>
              {mineHere === null ? 'Loading…' : mineHere.length ? `${mineHere.length} saved: ${mineHere.slice(0, 2).map((p) => p.name).join(', ')}${mineHere.length > 2 ? '…' : ''}` : 'None saved yet'}
            </Text>
          </View>
          {!!mineHere?.length && <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />}
        </Pressable>
        <Button title="Add product" icon="add" onPress={() => navigation.navigate('ProductForm', { categoryKey: key })} style={{ marginTop: space.md, height: 44 }} />
      </View>
      )}

      <Text style={[type.label, { marginBottom: space.sm }]}>Services</Text>
      {category.services.map((s) => <ServiceRow key={s.id} s={s} onBook={() => book(s.id)} />)}
    </ScrollView>
  );
}

// "Booking for: Bedroom AC · Voltas 183V" banner when booking for a product.
function ForProduct({ p }: { p: Product }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.brandSoft, borderRadius: radius.lg, padding: space.md, marginBottom: space.lg }}>
      <Ionicons name="cube" size={20} color={colors.brand} />
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <Text style={type.small}>Booking for</Text>
        <Text style={type.h3} numberOfLines={1}>{[p.name, [p.brand, p.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</Text>
      </View>
    </View>
  );
}

function ServiceRow({ s, onBook }: { s: Service; onBook: () => void }) {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md, borderWidth: 1, borderColor: colors.border, flexDirection: 'row' }}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={type.h3}>{s.name}</Text>
        {!!s.description && <Text style={[type.small, { marginTop: 4, fontSize: fs(13) }]}>{s.description}</Text>}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md }}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={[type.small, { marginLeft: 3 }]}>{s.durationMins >= 60 ? `${s.durationMins / 60} hr` : `${s.durationMins} min`}</Text>
        </View>
      </View>
      <Pressable onPress={onBook}
        style={({ pressed }) => ({ alignSelf: 'center', borderWidth: 1.5, borderColor: colors.accent, backgroundColor: pressed ? colors.accentSoft : colors.surface, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 8 })}>
        <Text style={{ color: colors.accent, fontWeight: '800' }}>BOOK</Text>
      </Pressable>
    </View>
  );
}
