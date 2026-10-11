import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, View,
} from 'react-native';
import { Text, TextInput } from './text';
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Image, Modal } from 'react-native';
import { fileUrl } from './api';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, shadow, space, type, fs } from './theme';
import { STATUS } from './format';
import type { BookingStatus } from './types';

export type IconName = keyof typeof Ionicons.glyphMap;

export const Screen = ({ children, scroll = true, style, edges = ['top'] }: {
  children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; edges?: ('top' | 'bottom')[];
}) => (
  <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg }}>
    {scroll ? (
      <ScrollView contentContainerStyle={[{ padding: space.lg, paddingBottom: 120 }, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    ) : <View style={[{ flex: 1 }, style]}>{children}</View>}
  </SafeAreaView>
);

export const Card = ({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) => (
  onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }, style]}>{children}</Pressable>
  ) : <View style={[s.card, style]}>{children}</View>
);

export const Button = ({ title, onPress, variant = 'primary', loading, disabled, icon, style }: {
  title: string; onPress: () => void; variant?: 'primary' | 'brand' | 'outline' | 'ghost' | 'danger' | 'success';
  loading?: boolean; disabled?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>;
}) => {
  const bg = { primary: colors.accent, brand: colors.brand, outline: colors.surface, ghost: 'transparent', danger: colors.danger, success: colors.success }[variant];
  const fg = variant === 'outline' || variant === 'ghost' ? colors.brand : '#fff';
  const off = disabled || loading;
  return (
    <Pressable onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 }, variant === 'outline' && { borderWidth: 1.5, borderColor: colors.brand }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} />}
          <Text style={[s.btnText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
};

export const Field = ({ label, hint, error, style, ...props }: TextInputProps & { label?: string; hint?: string; error?: string | null }) => (
  <View style={[{ marginBottom: space.md }, style as any]}>
    {label && <Text style={s.fieldLabel}>{label}</Text>}
    <TextInput placeholderTextColor={colors.textFaint} {...props}
      style={[s.input, props.multiline && { minHeight: 84, textAlignVertical: 'top', paddingTop: 12 }, error ? { borderColor: colors.danger } : null]} />
    {error ? <Text style={[type.small, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : hint ? <Text style={[type.small, { marginTop: 4 }]}>{hint}</Text> : null}
  </View>
);

export const Chip = ({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) => (
  <Pressable onPress={onPress}
    style={[s.chip, selected && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
    {icon && <Ionicons name={icon} size={14} color={selected ? '#fff' : colors.text} style={{ marginRight: 6 }} />}
    <Text style={{ fontSize: fs(13), fontWeight: '600', color: selected ? '#fff' : colors.text }}>{label}</Text>
  </Pressable>
);

export const StatusPill = ({ status, engineer }: { status: BookingStatus; engineer?: boolean }) => {
  const st = STATUS[status];
  return (
    <View style={[s.pill, { backgroundColor: st.bg }]}>
      <View style={[s.dot, { backgroundColor: st.color }]} />
      <Text style={{ fontSize: fs(12), fontWeight: '700', color: st.color }}>{engineer ? st.engineerText : st.label}</Text>
    </View>
  );
};

// Mix a hex colour toward white (amt > 0) or black (amt < 0).
const shade = (hex: string, amt: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  if (Number.isNaN(n)) return hex;
  const t = amt > 0 ? 255 : 0, a = Math.abs(amt);
  const ch = (v: number) => Math.round(v + (t - v) * a).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
};

// Icon tile in the style of service apps (Urban Company, Swiggy): a soft
// tinted rounded square with a thin-line icon in a deeper shade of the
// colour. No gloss or heavy shadow, so it reads clean and professional.
const outlineOf = (icon: string) => {
  const map = (Ionicons as any).glyphMap || {};
  const o = icon.endsWith('-outline') ? icon : `${icon}-outline`;
  return map[o] ? o : icon;
};
export const IconBadge = ({ icon, color, size = 46 }: { icon: string; color: string; size?: number }) => (
  <LinearGradient colors={[shade(color, 0.9), shade(color, 0.8)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
    style={{ width: size, height: size, borderRadius: size * 0.28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: shade(color, 0.72) }}>
    <Ionicons name={outlineOf(icon) as IconName} size={size * 0.5} color={shade(color, -0.2)} />
  </LinearGradient>
);

// A product's own photo when it has one, else its category's icon tile.
export const ProductThumb = ({ imageUrl, icon, color, size = 46 }: { imageUrl?: string | null; icon?: string | null; color?: string | null; size?: number }) => (
  imageUrl ? (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: '#fff', shadowColor: '#0F172A', shadowOpacity: 0.15, shadowRadius: size * 0.15, shadowOffset: { width: 0, height: size * 0.08 }, elevation: 4 }}>
      <Image source={{ uri: fileUrl(imageUrl) }} style={{ width: size, height: size, borderRadius: size * 0.3, borderWidth: 1, borderColor: '#E2E8F0' }} resizeMode="cover" />
    </View>
  ) : <IconBadge icon={icon || 'cube'} color={color || colors.brand} size={size} />
);

export const SectionTitle = ({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md }}>
    <Text style={type.h2}>{title}</Text>
    {action && <Text onPress={onAction} style={{ color: colors.accent, fontWeight: '700', fontSize: fs(13) }}>{action}</Text>}
  </View>
);

export const Empty = ({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) => (
  <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: space.xl }}>
    <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg }}>
      <Ionicons name={icon} size={32} color={colors.brand} />
    </View>
    <Text style={[type.h2, { textAlign: 'center' }]}>{title}</Text>
    {text && <Text style={[type.small, { textAlign: 'center', marginTop: 6, fontSize: fs(13) }]}>{text}</Text>}
    {action && <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View>}
  </View>
);

export const Loading = () => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
    <ActivityIndicator size="large" color={colors.brand} />
  </View>
);

export const Row = ({ icon, label, value }: { icon: IconName; label: string; value: ReactNode }) => (
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 }}>
    <Ionicons name={icon} size={18} color={colors.textMuted} style={{ width: 28, marginTop: 1 }} />
    <View style={{ flex: 1 }}>
      <Text style={type.small}>{label}</Text>
      {typeof value === 'string' ? <Text style={[type.body, { fontWeight: '600', marginTop: 2 }]}>{value}</Text> : value}
    </View>
  </View>
);

// Sticky bottom action bar (price on the left, button on the right).
export const BottomBar = ({ children }: { children: ReactNode }) => (
  <SafeAreaView edges={['bottom']} style={s.bottomBar}>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.md }}>{children}</View>
  </SafeAreaView>
);

export const ErrorText = ({ children }: { children: ReactNode }) =>
  children ? <Text style={{ color: colors.danger, backgroundColor: colors.dangerSoft, padding: 10, borderRadius: radius.sm, marginBottom: space.md, fontSize: fs(13) }}>{children}</Text> : null;

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border, ...shadow },
  btn: { height: 52, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  btnText: { fontSize: fs(16), fontWeight: '700' },
  fieldLabel: { fontSize: fs(13), fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, height: 50, fontSize: fs(15), color: colors.text },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginRight: 8, marginBottom: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  bottomBar: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, ...shadow },
});

// Rating summary + every review, without customer names: big average,
// 5★…1★ bars, then the reviews (stars, service, date, comment).
export const RatingsList = ({ reviews }: { reviews: { rating: number; review: string | null; service: string | null; date: string }[] }) => {
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const max = Math.max(1, ...[5, 4, 3, 2, 1].map((n) => reviews.filter((r) => r.rating === n).length));
  if (!reviews.length) {
    return <Text style={[type.small, { paddingVertical: space.sm }]}>No ratings yet. Ratings appear here after customers rate completed jobs.</Text>;
  }
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md }}>
        <View style={{ alignItems: 'center', width: 90 }}>
          <Text style={{ fontSize: fs(34), fontWeight: '900', color: colors.text }}>{avg.toFixed(1)}</Text>
          <Text style={{ color: '#F59E0B', fontSize: fs(13) }}>{'★'.repeat(Math.round(avg))}<Text style={{ color: colors.border }}>{'★'.repeat(5 - Math.round(avg))}</Text></Text>
          <Text style={type.small}>{reviews.length} rating{reviews.length === 1 ? '' : 's'}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: space.md }}>
          {[5, 4, 3, 2, 1].map((n) => {
            const c = reviews.filter((r) => r.rating === n).length;
            return (
              <View key={n} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 2 }}>
                <Text style={[type.small, { width: 22 }]}>{n}★</Text>
                <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: 'hidden' }}>
                  <View style={{ width: `${(c / max) * 100}%`, height: 8, borderRadius: 4, backgroundColor: n >= 4 ? colors.success : n === 3 ? '#F59E0B' : colors.danger }} />
                </View>
                <Text style={[type.small, { width: 24, textAlign: 'right' }]}>{c}</Text>
              </View>
            );
          })}
        </View>
      </View>
      {reviews.map((r, i) => (
        <View key={i} style={{ paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#F59E0B', fontSize: fs(14) }}>{'★'.repeat(r.rating)}<Text style={{ color: colors.border }}>{'★'.repeat(5 - r.rating)}</Text></Text>
            <Text style={type.small}>{new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
          </View>
          {!!r.service && <Text style={[type.small, { marginTop: 2 }]}>{r.service}</Text>}
          {!!r.review && <Text style={[type.body, { marginTop: 4 }]}>{r.review}</Text>}
        </View>
      ))}
    </View>
  );
};

// Problem photos as thumbnails; tap one to see it full screen.
export const PhotoStrip = ({ photos, size = 76 }: { photos: string[]; size?: number }) => {
  const [open, setOpen] = useState<string | null>(null);
  if (!photos?.length) return null;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {photos.map((p) => (
          <Pressable key={p} onPress={() => setOpen(p)}>
            <Image source={{ uri: fileUrl(p) }} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.border }} />
          </Pressable>
        ))}
      </ScrollView>
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable onPress={() => setOpen(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          {open && <Image source={{ uri: fileUrl(open) }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
          <Text style={{ color: '#fff', marginTop: space.lg, opacity: 0.8 }}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </>
  );
};
