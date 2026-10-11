import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Text, fs } from '@meril-one/shared';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '@meril-one/shared';
import type { Booking } from '@meril-one/shared';

// Partner-app look, matching the customer app: a light blue header with dark
// text, white cards, the Meril navy for accents and green for "online /
// money in". (`ink*` = the header area.)
export const P = {
  ink: '#E8F1FE',        // header background (light blue)
  inkSoft: '#FFFFFF',    // cards on the header
  inkLine: '#D3E3FB',
  onInk: colors.text,
  onInkMuted: colors.textMuted,
  accent: colors.brand,  // Meril navy, for icons / active items
  green: '#16A34A',
  greenBright: '#22C55E',
  greenSoft: '#DCFCE7',
};

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

// Navy header block that runs under the status bar.
export function InkHeader({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: P.ink, paddingHorizontal: space.lg, paddingBottom: space.xl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }, style]}>
      {children}
    </View>
  );
}

export function Initials({ name, size = 44, ring }: { name: string | null | undefined; size?: number; ring?: string }) {
  const t = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: ring ? 3 : 0, borderColor: ring }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.38 }}>{t}</Text>
    </View>
  );
}

// A dot that pulses outward while online (a "listening for jobs" signal).
export function PulseDot({ on, size = 12 }: { on: boolean; size?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) { v.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1400, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [on, v]);
  const color = on ? P.greenBright : '#64748B';
  return (
    <View style={{ width: size * 2.4, height: size * 2.4, alignItems: 'center', justifyContent: 'center' }}>
      {on && (
        <Animated.View style={{
          position: 'absolute', width: size * 2.4, height: size * 2.4, borderRadius: size * 1.2, backgroundColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.2] }) }],
        }} />
      )}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

// Small stat on the navy header.
export function InkStat({ icon, value, label }: { icon: any; value: string; label: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: P.inkSoft, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: P.inkLine }}>
      <Ionicons name={icon} size={16} color={P.green} />
      <Text style={{ color: P.onInk, fontSize: fs(18), fontWeight: '800', marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={{ color: P.onInkMuted, fontSize: fs(11), fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

// Two-option segmented switch (Ongoing / History).
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: '#E9EDF3', borderRadius: radius.pill, padding: 4 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={{ flex: 1, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: on ? colors.surface : 'transparent', alignItems: 'center', flexDirection: 'row', justifyContent: 'center' }}>
            <Text style={{ fontWeight: '700', color: on ? colors.text : colors.textMuted }}>{o.label}</Text>
            {o.count != null && o.count > 0 && (
              <View style={{ marginLeft: 6, backgroundColor: on ? P.accent : '#CBD5E1', borderRadius: 10, minWidth: 20, paddingHorizontal: 5, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: fs(11), fontWeight: '800' }}>{o.count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// Date block for job cards: "WED / 8 / OCT".
export function DateBlock({ date, color = P.accent }: { date: string; color?: string }) {
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  return (
    <View style={{ width: 52, borderRadius: radius.md, backgroundColor: `${color}12`, alignItems: 'center', paddingVertical: 6 }}>
      <Text style={{ fontSize: fs(10), fontWeight: '800', color }}>{d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()}</Text>
      <Text style={{ fontSize: fs(20), fontWeight: '900', color, lineHeight: 24 }}>{d.getDate()}</Text>
      <Text style={{ fontSize: fs(10), fontWeight: '700', color }}>{d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}</Text>
    </View>
  );
}

// Job counts from this engineer's real jobs: completed jobs counted on the
// day each was completed (plus bill sums, not shown: engineers aren't paid
// through the app).
export function earnings(jobs: Booking[]) {
  const doneAt = (b: Booking) => b.timeline.filter((t) => t.status === 'completed').at(-1)?.at;
  const done = jobs.filter((b) => b.status === 'completed');
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(startOfDay); weekAgo.setDate(weekAgo.getDate() - 6);
  const since = (from: Date) => done.filter((b) => new Date(doneAt(b) || 0) >= from);
  const sum = (l: Booking[]) => l.reduce((s, b) => s + (b.finalAmount || 0), 0);
  const today = since(startOfDay);
  const week = since(weekAgo);
  return { today: sum(today), todayJobs: today.length, week: sum(week), weekJobs: week.length, total: sum(done), totalJobs: done.length,
    ongoing: jobs.filter((b) => ['accepted', 'on_the_way', 'in_progress'].includes(b.status)).length };
}
