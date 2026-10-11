import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Button, ErrorText, Field, api, colors, radius, space, type } from '@meril-one/shared';
import type { ProductCategory } from '@meril-one/shared';

// "Add category" popup, used on Home and in the Products tab. Saves a
// customer-made category and hands it back so the caller can open it.
export default function AddCategoryModal({ visible, onClose, onAdded }: {
  visible: boolean; onClose: () => void; onAdded: (c: ProductCategory) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => { setName(''); setError(null); onClose(); };
  const save = async () => {
    if (!name.trim()) { setError('Enter a category name'); return; }
    setSaving(true); setError(null);
    try {
      const r = await api.post<{ data: ProductCategory }>('/product-categories', { name });
      setName('');
      onAdded(r.data);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.45)', padding: space.lg }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl }}>
          <Text style={type.h2}>New category</Text>
          <Text style={[type.small, { marginTop: 4, marginBottom: space.lg }]}>For products that don't fit the basic ones, e.g. Dental chairs, Water purifiers.</Text>
          <Field placeholder="Category name" value={name} onChangeText={setName} autoFocus maxLength={60} onSubmitEditing={save} returnKeyType="done" />
          <ErrorText>{error}</ErrorText>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Button title="Cancel" variant="outline" onPress={close} style={{ flex: 1 }} />
            <Button title="Add" onPress={save} loading={saving} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
