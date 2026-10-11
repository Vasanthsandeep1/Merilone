import { useEffect, useLayoutEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { BottomBar, Button, Card, Empty, IconBadge, Loading, RatingsList, api, colors, money, space, type, fs } from '@meril-one/shared';
import type { EngineerProfile } from '@meril-one/shared';
import type { StackProps } from '../nav';
import { Avatar, Stars } from './ChooseEngineerScreen';

const monthYear = (d: string) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

// An engineer's profile: company, experience, rating, skills and
// customer reviews, with "Book" at the bottom.
export default function EngineerProfileScreen({ route, navigation }: StackProps<'EngineerProfile'>) {
  const { engineerId, categoryId, serviceId, productId } = route.params;
  const [e, setE] = useState<EngineerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => { navigation.setOptions({ title: e?.name || 'Engineer' }); }, [navigation, e?.name]);
  useEffect(() => {
    api.get<{ data: EngineerProfile }>(`/engineers/${engineerId}${categoryId ? `?categoryId=${categoryId}` : ''}`)
      .then((r) => setE(r.data)).catch((err) => setError(err.message));
  }, [engineerId, categoryId]);

  if (error) return <Empty icon="alert-circle" title="Couldn't load this engineer" text={error} />;
  if (!e) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}>
        {/* Header */}
        <View style={{ alignItems: 'center', marginBottom: space.lg }}>
          <Avatar name={e.name} size={84} online={e.online} />
          <Text style={[type.h1, { marginTop: space.md }]}>{e.name}</Text>
          <Text style={type.small}>{e.companyName || 'Independent engineer'}{e.city ? ` · ${e.city}` : ''}</Text>
          <View style={{ marginTop: space.sm }}><Stars rating={e.rating} count={e.ratingCount} /></View>
        </View>

        {/* Key facts */}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[
            [e.jobsDone, 'Jobs done'],
            [e.experienceYears ? `${e.experienceYears} yrs` : '—', 'Experience'],
            [e.online ? 'Online' : 'Offline', 'Status'],
          ].map(([v, l]) => (
            <Card key={String(l)} style={{ flex: 1, alignItems: 'center', padding: space.md }}>
              <Text style={{ fontSize: fs(17), fontWeight: '800', color: l === 'Status' ? (e.online ? colors.success : colors.textMuted) : colors.text }}>{v}</Text>
              <Text style={type.small}>{l}</Text>
            </Card>
          ))}
        </View>

        {!!e.about && (
          <>
            <Text style={[type.label, { marginTop: space.xl, marginBottom: space.sm }]}>About</Text>
            <Card><Text style={[type.body, { lineHeight: 20 }]}>{e.about}</Text></Card>
          </>
        )}

        {/* Skills */}
        <Text style={[type.label, { marginTop: space.xl, marginBottom: space.sm }]}>Services</Text>
        <Card style={{ padding: 0 }}>
          {e.skills.map((s, i) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border, backgroundColor: s.id === categoryId ? colors.accentSoft : undefined }}>
              <IconBadge icon={s.icon} color={s.color} size={34} />
              <Text style={[type.h3, { flex: 1, marginLeft: space.md }]}>{s.name}</Text>
            </View>
          ))}
        </Card>

        {/* Ratings: all of them, no customer names */}
        <Text style={[type.label, { marginTop: space.xl, marginBottom: space.sm }]}>Ratings & reviews</Text>
        <Card><RatingsList reviews={e.reviews} /></Card>

        {/* Work done: every completed job */}
        <Text style={[type.label, { marginTop: space.xl, marginBottom: space.sm }]}>Work done ({e.works.length})</Text>
        <Card style={{ padding: 0 }}>
          {e.works.length ? e.works.map((w, i) => (
            <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <IconBadge icon={w.category?.icon || 'construct'} color={w.category?.color || colors.brand} size={34} />
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={type.h3} numberOfLines={1}>{w.service}</Text>
                <Text style={type.small}>{[w.brand, monthYear(w.date)].filter(Boolean).join(' · ')}</Text>
              </View>
              {w.rating ? <Text style={{ color: '#F59E0B', fontWeight: '800' }}>{w.rating}★</Text> : <Text style={type.small}>—</Text>}
            </View>
          )) : <Text style={[type.small, { padding: space.md }]}>No completed jobs yet.</Text>}
        </Card>
        <Text style={[type.small, { textAlign: 'center', marginTop: space.lg }]}>On Meril One since {monthYear(e.memberSince)}</Text>
      </ScrollView>
      <BottomBar>
        <Button title={`Book ${e.name?.split(' ')[0] || 'engineer'}`} onPress={() => navigation.navigate('Book', { engineerId: e.id, serviceId, productId, categoryId })} style={{ flex: 1 }} />
      </BottomBar>
    </View>
  );
}
