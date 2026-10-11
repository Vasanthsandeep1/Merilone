import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Text, fs } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ACTIVE, APP_BLUE, Button, Card, Empty, IconBadge, PhotoStrip, SectionTitle, api, colors, fmtDate, money, radius, slotLabel, space, type, useAuth, isSmallScreen } from '@meril-one/shared';
import type { Booking, User } from '@meril-one/shared';
import type { RootStack } from '../nav';
import { Initials, P, PulseDot, earnings, greeting } from '../ui';

// Partner home, in the customer app's style: blue header (greeting, today's
// numbers), a banner that is the online switch, the next job, and incoming requests
// (refreshed every 10 s). Requests sent to this engineer by name come first.
export default function RequestsScreen() {
  const { user, setUser } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [jobs, setJobs] = useState<Booking[] | null>(null);
  const [mine, setMine] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toggling, setToggling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const online = !!user?.isAvailable;
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([
        api.get<{ data: Booking[] }>('/engineer/jobs/available'),
        api.get<{ data: Booking[] }>('/engineer/jobs/mine'),
      ]);
      setJobs(a.data); setMine(m.data); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]));

  const toggleOnline = async () => {
    setToggling(true);
    try { const r = await api.put<{ user: User }>('/engineer/availability', { isAvailable: !online }); setUser(r.user); await load(); }
    catch (e: any) { Alert.alert('Could not update', e.message); } finally { setToggling(false); }
  };
  const accept = async (b: Booking) => {
    setBusyId(b.id);
    try { await api.post(`/engineer/jobs/${b.id}/accept`); navigation.navigate('JobDetail', { id: b.id }); load(); }
    catch (e: any) { Alert.alert('Not available', e.message); load(); } finally { setBusyId(null); }
  };
  const decline = (b: Booking) => {
    setJobs((j) => (j || []).filter((x) => x.id !== b.id));
    api.post(`/engineer/jobs/${b.id}/decline`).catch(() => {});
  };

  const e = earnings(mine);
  const ongoing = mine.filter((b) => ACTIVE.includes(b.status) && b.status !== 'requested').length;
  const list = online ? jobs || [] : [];
  const bannerColor = online ? P.green : '#2563EB';

  const header = (
    <View>
      {/* Blue header, same as the customer app's Home */}
      <LinearGradient colors={[APP_BLUE, '#0F4FB8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingTop: insets.top + 12, paddingHorizontal: space.lg, paddingBottom: space.xl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: fs(11), fontWeight: '700', letterSpacing: 1 }} numberOfLines={1}>
              {(user?.companyName || 'MERIL ONE PARTNER').toUpperCase()}
            </Text>
            <Text style={{ color: '#fff', fontSize: fs(26), fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              Hi, {user?.name?.split(' ')[0] || 'there'} 👋
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <Ionicons name="location" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: fs(12), marginLeft: 3 }} numberOfLines={1}>{greeting()} · {user?.city || 'Set your city'}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Initials name={user?.name} size={50} ring={online ? P.greenBright : 'rgba(255,255,255,0.75)'} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, backgroundColor: '#fff', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 }}>
              <Ionicons name="star" size={11} color="#F59E0B" />
              <Text style={{ fontSize: fs(11), fontWeight: '800', color: colors.text, marginLeft: 3 }}>{user?.rating ?? 'New'}</Text>
            </View>
          </View>
        </View>

        {/* Today, at a glance */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: space.lg }}>
          {[
            { k: 'done', value: String(e.todayJobs), label: 'Done today', icon: 'checkmark-done' },
            { k: 'all', value: String(e.totalJobs), label: 'Total done', icon: 'trophy' },
            { k: 'on', value: String(ongoing), label: 'Ongoing', icon: 'time' },
          ].map((t) => (
            <View key={t.k} style={{ flex: 1, padding: isSmallScreen ? 9 : 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: fs(20), flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit>{t.value}</Text>
                <Ionicons name={t.icon as any} size={17} color="rgba(255,255,255,0.85)" />
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: fs(11), lineHeight: fs(14) }} numberOfLines={2}>{t.label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      <View style={{ paddingHorizontal: space.lg }}>
      {/* Online switch */}
      <Pressable onPress={toggleOnline} disabled={toggling}
        style={({ pressed }) => ({ backgroundColor: bannerColor, borderRadius: radius.xl, padding: space.lg, marginTop: space.lg, overflow: 'hidden', opacity: pressed || toggling ? 0.9 : 1 })}>
        <Ionicons name={online ? 'radio' : 'power'} size={110} color="rgba(255,255,255,0.12)" style={{ position: 'absolute', right: -14, bottom: -18 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <PulseDot on={online} />
          <Text style={{ color: '#fff', fontSize: fs(19), fontWeight: '800', marginLeft: 4 }}>{toggling ? 'Updating…' : online ? "You're online" : "You're offline"}</Text>
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.88)', marginTop: 4, fontSize: fs(12), maxWidth: '80%' }}>
          {online
            ? `Receiving requests in ${user?.city}${user?.servicePincodes?.length ? ` and ${user.servicePincodes.length} pincodes` : ''}. Keep the app open.`
            : 'Go online to start getting service requests near you.'}
        </Text>
        <View style={{ alignSelf: 'flex-start', marginTop: space.md, backgroundColor: '#fff', borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 7 }}>
          <Text style={{ color: bannerColor, fontWeight: '800' }}>{online ? 'Go offline' : 'Go online'}</Text>
        </View>
      </Pressable>

      {list.length > 0 && <SectionTitle title={`New requests (${list.length})`} />}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {useIsFocused() && <StatusBar style="light" />}
      <FlatList
        data={list}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.brand} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={error ? (
          <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
            <Card><Empty icon="cloud-offline" title="Couldn't load requests" text={error} /></Card>
          </View>
        ) : null}
        renderItem={({ item: b }) => (
          <View style={{ paddingHorizontal: space.lg }}>
            <Card style={{ marginBottom: space.md, borderColor: b.direct ? colors.accent : colors.border, borderWidth: b.direct ? 1.5 : 1 }}>
              {b.direct && (
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginBottom: space.md }}>
                  <Ionicons name="person" size={12} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: fs(11), fontWeight: '800', marginLeft: 4 }}>Customer chose you</Text>
                </View>
              )}
              <Pressable onPress={() => navigation.navigate('JobDetail', { id: b.id })} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {b.category && <IconBadge icon={b.category.icon} color={b.category.color} size={48} />}
                <View style={{ flex: 1, marginLeft: space.md }}>
                  <Text style={type.h3} numberOfLines={1}>{b.service?.name}</Text>
                  <Text style={type.small} numberOfLines={1}>{b.customer?.orgName || b.customer?.name} · {b.category?.name}</Text>
                </View>
              </Pressable>

              <View style={{ marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 }}>
                <Meta icon="calendar-outline" text={`${fmtDate(b.scheduledDate)}, ${slotLabel(b.slot)}`} />
                <Meta icon="location-outline" text={b.address} />
                {b.equipment?.brand && <Meta icon="hardware-chip-outline" text={[b.equipment.brand, b.equipment.model].filter(Boolean).join(' ')} />}
                {!!b.issue && <Meta icon="chatbubble-ellipses-outline" text={`"${b.issue}"`} />}
              </View>
              {b.photos?.length > 0 && (
                <View style={{ marginTop: space.md }}>
                  <Text style={[type.small, { marginBottom: 6 }]}>📷 {b.photos.length} photo{b.photos.length === 1 ? '' : 's'} from the customer</Text>
                  <PhotoStrip photos={b.photos} size={64} />
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
                <Button title="Skip" variant="outline" onPress={() => decline(b)} style={{ flex: 1, height: 48 }} />
                <Button title="Accept job" variant="success" icon="checkmark-circle" loading={busyId === b.id} onPress={() => accept(b)} style={{ flex: 2, height: 48 }} />
              </View>
            </Card>
          </View>
        )}
      />
    </View>
  );
}

const Stat = ({ icon, color, value, label }: { icon: any; color: string; value: string; label: string }) => (
  <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border }}>
    <IconBadge icon={icon} color={color} size={34} />
    <Text style={{ fontSize: fs(18), fontWeight: '800', color: colors.text, marginTop: space.sm }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    <Text style={type.small}>{label}</Text>
  </View>
);

const Meta = ({ icon, text }: { icon: any; text: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
    <Ionicons name={icon} size={15} color={colors.textMuted} style={{ marginTop: 1 }} />
    <Text style={[type.small, { marginLeft: 8, flex: 1, fontSize: fs(13), color: colors.text }]} numberOfLines={2}>{text}</Text>
  </View>
);
