import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput, fs } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { INDIA_DISTRICTS, INDIA_STATES, colors, radius, space, type } from '@meril-one/shared';

export type Area = { state: string; districts: string[] };

// The engineer's area, like the B2G form: several states, and in each the
// districts they work in (tap to tick / untick). "+ Add state" picks another.
export default function AreaEditor({ value, onChange }: { value: Area[]; onChange: (v: Area[]) => void }) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(value.length === 1 ? value[0].state : null);

  const setDistricts = (state: string, districts: string[]) =>
    onChange(value.map((a) => (a.state === state ? { ...a, districts: [...new Set(districts)].sort() } : a)));
  const toggle = (state: string, d: string) => {
    const a = value.find((x) => x.state === state)!;
    setDistricts(state, a.districts.includes(d) ? a.districts.filter((x) => x !== d) : [...a.districts, d]);
  };
  const used = new Set(value.map((a) => a.state));
  const states = INDIA_STATES.filter((s) => !used.has(s) && s.toLowerCase().includes(q.trim().toLowerCase())).sort();

  return (
    <View>
      {value.map((a) => {
        const list = [...new Set([...(INDIA_DISTRICTS[a.state] || []), ...a.districts])].sort();
        const expanded = open === a.state;
        return (
          <View key={a.state} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: space.sm, overflow: 'hidden' }}>
            <Pressable onPress={() => setOpen(expanded ? null : a.state)} style={{ flexDirection: 'row', alignItems: 'center', padding: space.md }}>
              <Ionicons name="map-outline" size={18} color={colors.brand} />
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <Text style={type.h3}>{a.state}</Text>
                <Text style={[type.small, { color: a.districts.length ? colors.textMuted : colors.danger }]} numberOfLines={expanded ? undefined : 1}>
                  {a.districts.length ? a.districts.join(', ') : 'Tap to pick districts'}
                </Text>
              </View>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              <Pressable hitSlop={10} onPress={() => onChange(value.filter((x) => x.state !== a.state))} style={{ marginLeft: space.md }}>
                <Ionicons name="close-circle" size={20} color={colors.textFaint} />
              </Pressable>
            </Pressable>
            {expanded && (
              <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: space.sm }}>
                  <Text onPress={() => setDistricts(a.state, a.districts.length === list.length ? [] : list)} style={{ color: colors.accent, fontWeight: '700', fontSize: fs(12) }}>
                    {a.districts.length === list.length ? 'Clear all' : 'Select all'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {list.map((d) => {
                    const on = a.districts.includes(d);
                    return (
                      <Pressable key={d} onPress={() => toggle(a.state, d)}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                        <Text style={{ fontSize: fs(12), fontWeight: '600', color: on ? '#fff' : colors.text }}>{d}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        );
      })}

      <Pressable onPress={() => { setQ(''); setPicking(true); }}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: space.md, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent }}>
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={{ color: colors.accent, fontWeight: '700', marginLeft: 4 }}>{value.length ? 'Add another state' : 'Add a state'}</Text>
      </Pressable>

      <Modal visible={picking} animationType="slide" transparent onRequestClose={() => setPicking(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '80%', padding: space.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md }}>
              <Text style={[type.h2, { flex: 1 }]}>Choose a state</Text>
              <Pressable onPress={() => setPicking(false)} hitSlop={10}><Ionicons name="close" size={24} color={colors.textMuted} /></Pressable>
            </View>
            <TextInput value={q} onChangeText={setQ} placeholder="Search state" placeholderTextColor={colors.textFaint}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, height: 44, color: colors.text, marginBottom: space.sm }} />
            <ScrollView keyboardShouldPersistTaps="handled">
              {states.map((s) => (
                <Pressable key={s} onPress={() => { onChange([...value, { state: s, districts: [] }]); setOpen(s); setPicking(false); }}
                  style={({ pressed }) => ({ paddingVertical: 14, paddingHorizontal: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: pressed ? colors.bg : 'transparent' })}>
                  <Text style={{ fontSize: fs(15), color: colors.text }}>{s}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
