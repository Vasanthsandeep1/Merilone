import { useCallback, useLayoutEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { useFocusEffect } from '@react-navigation/native';
import { BottomBar, Button, Empty, ErrorText, api, colors, space, type } from '@meril-one/shared';
import type { Product } from '@meril-one/shared';
import type { StackProps } from '../nav';
import { ProductCard, confirmDeleteCategory } from './ProductsScreen';

// One category's products, with "Add product" (the new product goes into
// this category). key: "b3" basic, "c7" custom, "none" = no category.
export default function ProductCategoryScreen({ route, navigation }: StackProps<'ProductCategory'>) {
  const { key, name, custom } = route.params;
  const [rows, setRows] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useLayoutEffect(() => { navigation.setOptions({ title: name }); }, [navigation, name]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ data: Product[] }>('/products');
      setRows(r.data.filter((p) => (p.categoryKey || 'none') === key)); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [key]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = () => navigation.navigate('ProductForm', key === 'none' ? undefined : { categoryKey: key });

  const removeCategory = () => confirmDeleteCategory(name, async () => {
    setDeleting(true);
    try { await api.del(`/product-categories/${key.slice(1)}`); navigation.goBack(); } catch (e: any) { setError(e.message); setDeleting(false); }
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        style={{ flex: 1 }}
        data={rows || []}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ padding: space.lg, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={
          <View style={{ marginBottom: space.md }}>
            <Button title={`Add product to ${name}`} icon="add-circle-outline" onPress={add} />
            {!!rows?.length && <Text style={[type.small, { marginTop: space.md }]}>{rows.length} product{rows.length === 1 ? '' : 's'}</Text>}
          </View>
        }
        ListEmptyComponent={rows === null && !error ? <Text style={type.small}>Loading…</Text> : (
          <Empty icon={error ? 'cloud-offline' : 'cube-outline'} title={error ? "Couldn't load products" : `No products in ${name} yet`}
            text={error || 'Tap "Add product" to save the ones you have: brand, model, serial number and warranty. You can pick them when you book a service.'}
            action={error ? <Button title="Try again" variant="outline" onPress={load} /> : undefined} />
        )}
        renderItem={({ item }) => (
          <ProductCard p={item} onPress={() => navigation.navigate('ProductDetail', { id: item.id })} onEdit={() => navigation.navigate('ProductForm', { id: item.id })}
            onBook={() => navigation.navigate('Book', { categoryId: item.categoryId ?? undefined, productId: item.id })} />
        )}
        ListFooterComponent={custom && rows !== null && rows.length === 0 ? (
          <View>
            <ErrorText>{error && rows !== null ? error : null}</ErrorText>
            <Button title="Delete this category" variant="ghost" icon="trash-outline" onPress={removeCategory} loading={deleting} />
          </View>
        ) : null}
      />
      <BottomBar>
        <Button title="Add product" icon="add" onPress={add} style={{ flex: 1 }} />
      </BottomBar>
    </View>
  );
}
