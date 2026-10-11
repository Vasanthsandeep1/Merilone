import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Text, fs } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, IconBadge, RatingsList, SectionTitle, api, apiBaseUrl, colors, money, radius, space, type, useAuth } from '@meril-one/shared';
import type { Booking, Category } from '@meril-one/shared';
import type { RootStack } from '../nav';
import { Initials, P, earnings } from '../ui';

// The engineer's profile, in the customer app's Account style: who you are,
// a summary banner, about, your skills, ratings received (no
// customer names), work area, and edit / log out.
export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [cats, setCats] = useState<Category[]>([]);
  const [jobs, setJobs] = useState<Booking[]>([]);
  useEffect(() => { api.get<{ data: Category[] }>('/catalog').then((r) => setCats(r.data)).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => { api.get<{ data: Booking[] }>('/engineer/jobs/mine').then((r) => setJobs(r.data)).catch(() => {}); }, []));

  const skills = cats.filter((c) => user?.skills.includes(c.id));
  const e = earnings(jobs);
  const ratings = jobs
    .filter((b) => b.status === 'completed' && b.rating)
    .map((b) => ({ rating: b.rating!, review: b.review, service: b.service?.name || null, date: b.timeline.filter((t) => t.status === 'completed').at(-1)?.at || b.scheduledDate }))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}>
      {/* Who you are */}
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Initials name={user?.name} size={64} ring={user?.isAvailable ? P.greenBright : undefined} />
        <View style={{ flex: 1, marginLeft: space.lg }}>
          <Text style={type.h2} numberOfLines={1}>{user?.name}</Text>
          <Text style={type.small} numberOfLines={1}>{user?.companyName || 'Independent engineer'}</Text>
          <Text style={type.small}>+91 {user?.phone}</Text>
        </View>
        <View style={{ backgroundColor: user?.isAvailable ? colors.successSoft : colors.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: fs(11), fontWeight: '800', color: user?.isAvailable ? colors.success : colors.textMuted }}>{user?.isAvailable ? 'ONLINE' : 'OFFLINE'}</Text>
        </View>
      </Card>

      {/* Summary banner (customer-app banner style) */}
      <View style={{ backgroundColor: '#2563EB', borderRadius: radius.xl, padding: space.xl, marginTop: space.lg, overflow: 'hidden' }}>
        <Ionicons name="ribbon" size={120} color="rgba(255,255,255,0.12)" style={{ position: 'absolute', right: -14, bottom: -18 }} />
        <View style={{ flexDirection: 'row' }}>
          {[
            [user?.rating ? `${user.rating} ★` : 'New', `${user?.ratingCount || 0} ratings`],
            [String(e.totalJobs), 'Jobs done'],
            [user?.experienceYears ? `${user.experienceYears} yrs` : '—', 'Experience'],
          ].map(([v, l], i) => (
            <View key={l} style={{ flex: 1, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.25)', paddingLeft: i ? space.md : 0 }}>
              <Text style={{ color: '#fff', fontSize: fs(20), fontWeight: '900' }}>{v}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: fs(12) }}>{l}</Text>
            </View>
          ))}
        </View>
      </View>

      {!!user?.about && (
        <>
          <SectionTitle title="About you" />
          <Card><Text style={[type.body, { lineHeight: 20 }]}>{user.about}</Text></Card>
        </>
      )}

      <SectionTitle title="Your skills" />
      <Card style={{ padding: 0 }}>
        {skills.map((c, i) => {
          return (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <IconBadge icon={c.icon} color={c.color} size={38} />
              <Text style={[type.h3, { flex: 1, marginLeft: space.md }]}>{c.name}</Text>
            </View>
          );
        })}
        {!skills.length && <Text style={[type.small, { padding: space.md }]}>Loading…</Text>}
      </Card>

      <SectionTitle title="Ratings you received" />
      <Card><RatingsList reviews={ratings} /></Card>

      <SectionTitle title="Work area" />
      {user?.b2gEngineer ? (
        <Card style={{ padding: 0 }}>
          {user.b2gEngineer.areas.map((a, i) => (
            <Line key={a.state} icon="map-outline" label={a.state} value={a.districts.join(', ')} first={i === 0} />
          ))}
          <Line icon="business-outline" label="Company" value={`${user.b2gEngineer.companies.join(' / ')} · Emp ID ${user.b2gEngineer.empIds.join(', ')}`} />
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          <Line icon="business-outline" label="City" value={user?.city || '—'} first />
          <Line icon="pin-outline" label="Pincodes" value={(user?.servicePincodes || []).join(', ') || '—'} />
        </Card>
      )}
      {!!user?.b2gEngineer && <Text style={[type.small, { marginTop: space.sm }]}>Name, company and area come from Meril B2G. Ask your company to change them.</Text>}

      <Card style={{ marginTop: space.lg, padding: 0 }}>
        <Menu icon="create-outline" label="Edit profile & skills" onPress={() => navigation.navigate('EditProfile', { edit: true })} first />
        <Menu icon="help-circle-outline" label="Help & support" onPress={() => Alert.alert('Help & support', 'Contact your Meril One partner support desk.')} />
      </Card>

      <Pressable onPress={() => Alert.alert('Log out?', 'You will stop receiving requests.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: logout }])}
        style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
        <Ionicons name="log-out-outline" size={20} color={colors.danger} />
        <Text style={{ color: colors.danger, fontWeight: '700', marginLeft: 8 }}>Log out</Text>
      </Pressable>
      <Text style={[type.small, { textAlign: 'center', color: colors.textFaint }]}>Meril One Partner · {apiBaseUrl().replace(/^https?:\/\//, '').replace('/api/m1', '')}</Text>
    </ScrollView>
  );
}

const Line = ({ icon, label, value, first }: { icon: any; label: string; value: ReactNode; first?: boolean }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border }}>
    <Ionicons name={icon} size={20} color={colors.text} />
    <Text style={{ width: 80, marginLeft: space.md, color: colors.textMuted }}>{label}</Text>
    <Text style={{ flex: 1, fontWeight: '600', color: colors.text }}>{value}</Text>
  </View>
);

const Menu = ({ icon, label, onPress, first }: { icon: any; label: string; onPress: () => void; first?: boolean }) => (
  <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', padding: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border, backgroundColor: pressed ? colors.bg : 'transparent' })}>
    <Ionicons name={icon} size={20} color={colors.text} />
    <Text style={{ flex: 1, marginLeft: space.md, fontWeight: '600', color: colors.text }}>{label}</Text>
    <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
  </Pressable>
);
