import { Dimensions } from 'react-native';

// Responsive text: on narrow phones (e.g. 360 dp wide, Realme 8) every size
// shrinks a little so labels fit; from ~390 dp up (most phones, tablets)
// sizes stay as designed. Use fs(14) instead of 14 for fontSize.
const SCREEN_W = Math.min(Dimensions.get('window').width, Dimensions.get('window').height || Infinity);
const FONT_K = Math.max(0.86, Math.min(1, SCREEN_W / 390));
export const fs = (n: number) => Math.round(n * FONT_K * 2) / 2;
export const isSmallScreen = SCREEN_W < 380;

// Meril One design tokens, shared by both apps. A clean white UI with bold
// type, rounded cards and one strong accent for actions — the UrbanClap /
// Swiggy / Amazon feel. Each app passes its own accent where it differs.
export const colors = {
  brand: '#1E4373',      // Meril navy: headers, selected states
  brandSoft: '#EEF2F7',
  accent: '#F97316',     // primary actions (Book, Accept, Confirm)
  accentSoft: '#FFF1E7',
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  border: '#E8EAEE',
  text: '#111827',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  success: '#16A34A',
  successSoft: '#E9F7EF',
  warning: '#D97706',
  warningSoft: '#FEF5E7',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  info: '#2563EB',
  infoSoft: '#EAF1FE',
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const type = {
  hero: { fontSize: fs(26), fontWeight: '800' as const, color: colors.text, letterSpacing: -0.3 },
  h1: { fontSize: fs(22), fontWeight: '800' as const, color: colors.text },
  h2: { fontSize: fs(18), fontWeight: '700' as const, color: colors.text },
  h3: { fontSize: fs(15), fontWeight: '700' as const, color: colors.text },
  body: { fontSize: fs(14), color: colors.text },
  small: { fontSize: fs(12), color: colors.textMuted },
  label: { fontSize: fs(12), fontWeight: '700' as const, color: colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' as const },
};

export const shadow = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
};
