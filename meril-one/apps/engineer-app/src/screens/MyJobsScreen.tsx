import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Text, fs } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ACTIVE, Card, Empty, IconBadge, STATUS, api, colors, fmtDate, money, radius, shadow, slotLabel, space, type } from '@meril-one/shared';
import type { Booking } from '@meril-one/shared';
import type { RootStack } from '../nav';
import { P, Segmented, earnings } from '../ui';

// Jobs this engineer has taken: an earnings summary, then ongoing jobs (soonest
// first) or "Work done": every completed job, newest first, grouped by month
// with the month's total, each with what was done, parts, amount and rating.
// Cancelled jobs are listed after.
export default function MyJobsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get<{ data: Booking[] }>('/engineer/jobs/mine'); setRows(r.data); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const all = rows || [];
  // Ongoing: the job accepted most recently first.
  const acceptedAt = (b: Booking) => b.timeline.filter((t) => t.status === 'accepted').at(-1)?.at || b.createdAt;
  const active = all.filter((b) => ACTIVE.includes(b.status))
    .sort((a, b) => acceptedAt(b).localeCompare(acceptedAt(a)));
  const doneAt = (b: Booking) => b.timeline.filter((t) => t.status === 'completed').at(-1)?.at || b.scheduledDate;
  const completed = all.filter((b) => b.status === 'completed').sort((a, b) => doneAt(b).localeCompare(doneAt(a)));
  const cancelled = all.filter((b) => b.status === 'cancelled');
  const e = earnings(all);
  const monthOf = (b: Booking) => new Date(doneAt(b)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  // Work done: month headers + jobs, then cancelled.
  const workItems: Item[] = [];
  let month = '';
  for (const b of completed) {
    const m = monthOf(b);
    if (m !== month) {
      month = m;
      const inMonth = completed.filter((x) => monthOf(x) === m);
      workItems.push({ kind: 'month', key: `m${m}`, label: m, count: inMonth.length, total: inMonth.reduce((s, x) => s + (x.finalAmount || 0), 0) });
    }
    workItems.push({ kind: 'work', key: `w${b.id}`, b });
  }
  if (cancelled.length) {
    workItems.push({ kind: 'title', key: 'cancelled', label: `Cancelled (${cancelled.length})` });
    cancelled.forEach((b) => workItems.push({ kind: 'job', key: `c${b.id}`, b }));
  }
  const list: Item[] = tab === 'active' ? active.map((b) => ({ kind: 'job' as const, key: `a${b.id}`, b })) : workItems;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={list}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ paddingBottom: 30, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.brand} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={
          <>
            <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
              {/* Jobs summary: same blue banner style as the customer app's Home banner */}
              <View style={{ backgroundColor: '#2563EB', borderRadius: radius.xl, padding: space.xl, overflow: 'hidden' }}>
                <Ionicons name="briefcase" size={120} color="rgba(255,255,255,0.12)" style={{ position: 'absolute', right: -14, bottom: -18 }} />
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: fs(12), fontWeight: '700', letterSpacing: 0.5 }}>JOBS COMPLETED</Text>
                <Text style={{ color: '#fff', fontSize: fs(32), fontWeight: '900', marginTop: 2 }}>{e.totalJobs}</Text>
                <View style={{ flexDirection: 'row', marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.25)' }}>
                  {[
                    [String(e.todayJobs), 'Today'],
                    [String(e.weekJobs), 'Last 7 days'],
                    [String(e.ongoing), 'Ongoing'],
                  ].map(([v, l], i) => (
                    <View key={l} style={{ flex: 1, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.25)', paddingLeft: i ? space.md : 0 }}>
                      <Text style={{ color: '#fff', fontSize: fs(16), fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: fs(11) }}>{l}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
            <View style={{ padding: space.lg, paddingBottom: space.md }}>
              <Segmented value={tab} onChange={setTab} options={[{ key: 'active', label: 'Ongoing', count: active.length }, { key: 'done', label: 'Work done', count: completed.length }]} />
            </View>
          </>
        }
        ListEmptyComponent={rows === null && !error ? <Text style={[type.small, { textAlign: 'center' }]}>Loading…</Text> : (
          <View style={{ paddingHorizontal: space.lg }}>
            <Card>
              <Empty icon={error ? 'cloud-offline' : 'briefcase-outline'} title={error ? "Couldn't load jobs" : tab === 'active' ? 'No ongoing jobs' : 'No work done yet'}
                text={error || (tab === 'active' ? 'Accept a request and it shows up here.' : 'Every job you complete is listed here with what you did.')} />
            </Card>
          </View>
        )}
        renderItem={({ item }) => {
          if (item.kind === 'month') return (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: space.lg, marginTop: space.sm, marginBottom: space.sm }}>
              <Text style={type.h3}>{item.label}</Text>
              <Text style={type.small}>{item.count} job{item.count === 1 ? '' : 's'}</Text>
            </View>
          );
          if (item.kind === 'title') return <Text style={[type.label, { marginHorizontal: space.lg, marginTop: space.lg, marginBottom: space.sm }]}>{item.label}</Text>;
          if (item.kind === 'work') return <WorkCard b={item.b} when={doneAt(item.b)} onPress={() => navigation.navigate('JobDetail', { id: item.b.id })} />;
          const b = item.b;
          const st = STATUS[b.status];
          return (
            <View style={{ paddingHorizontal: space.lg }}>
              <Card style={{ marginBottom: space.md }} onPress={() => navigation.navigate('JobDetail', { id: b.id })}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {b.category && <IconBadge icon={b.category.icon} color={b.status === 'cancelled' ? colors.textMuted : b.category.color} size={44} />}
                  <View style={{ flex: 1, marginLeft: space.md }}>
                    <Text style={type.h3} numberOfLines={1}>{b.service?.name}</Text>
                    <Text style={type.small} numberOfLines={1}>{b.customer?.orgName || b.customer?.name} · {b.bookingNo}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ backgroundColor: st.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: st.color, fontSize: fs(12), fontWeight: '800' }}>{b.arrivedAt && ['accepted', 'on_the_way'].includes(b.status) ? 'At site' : st.engineerText}</Text>
                    </View>
                    {b.rescheduleRequest?.status === 'pending' && ACTIVE.includes(b.status) && (
                      <Text style={{ marginLeft: 8, fontSize: fs(12), fontWeight: '700', color: colors.warning }}>Reschedule asked</Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                    <Text style={[type.small, { marginLeft: 4 }]}>{fmtDate(b.scheduledDate)} · {slotLabel(b.slot)}</Text>
                  </View>
                </View>
              </Card>
            </View>
          );
        }}
      />
    </View>
  );
}

type Item =
  | { kind: 'month'; key: string; label: string; total: number; count: number }
  | { kind: 'title'; key: string; label: string }
  | { kind: 'work'; key: string; b: Booking }
  | { kind: 'job'; key: string; b: Booking };

// One completed job in full: equipment, what was done, parts and
// the rating (no customer name next to the rating).
function WorkCard({ b, when, onPress }: { b: Booking; when: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ marginHorizontal: space.lg, marginBottom: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.92 : 1 }, shadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: b.category?.color || P.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={(b.category?.icon || 'construct') as any} size={20} color="#fff" />
        </View>
        <View style={{ flex: 1, marginLeft: space.md }}>
          <Text style={type.h3} numberOfLines={1}>{b.service?.name}</Text>
          <Text style={type.small} numberOfLines={1}>{new Date(when).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {b.bookingNo}</Text>
        </View>
      </View>
      <View style={{ padding: space.md }}>
        {!!b.equipment?.brand && (
          <Text style={[type.small, { marginBottom: 4 }]}>{[b.equipment.brand, b.equipment.model, b.equipment.serialNo && `S/N ${b.equipment.serialNo}`].filter(Boolean).join(' · ')}</Text>
        )}
        <Text style={{ fontSize: fs(13), color: b.workNotes ? colors.text : colors.textFaint, lineHeight: 18 }}>{b.workNotes || 'No work notes added'}</Text>
        {b.partsUsed.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
            {b.partsUsed.map((p, i) => (
              <Text key={i} style={{ fontSize: fs(11), fontWeight: '600', color: colors.text, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' }}>{p.name} × {p.qty}</Text>
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          {b.rating ? (
            <>
              <Text style={{ color: '#F59E0B', fontSize: fs(14) }}>{'★'.repeat(b.rating)}<Text style={{ color: colors.border }}>{'★'.repeat(5 - b.rating)}</Text></Text>
              {!!b.review && <Text style={[type.small, { flex: 1, marginLeft: space.sm }]} numberOfLines={2}>"{b.review}"</Text>}
            </>
          ) : <Text style={type.small}>Not rated yet</Text>}
        </View>
      </View>
    </Pressable>
  );
}
