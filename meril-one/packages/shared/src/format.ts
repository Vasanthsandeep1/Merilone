import { colors } from './theme';
import type { BookingStatus, Segment } from './types';

export const money = (n: number | null | undefined) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// "10:00" -> "10 AM"; older range slots "09:00-12:00" -> "9 AM – 12 PM".
export const slotLabel = (slot: string) => {
  const to12 = (t: string) => { const h = Number(t.slice(0, 2)); return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };
  const [a, b] = slot.split('-');
  return b ? `${to12(a)} – ${to12(b)}` : to12(a);
};

export const SEGMENTS: { key: Segment; title: string; subtitle: string; icon: string; color: string }[] = [
  { key: 'home', title: 'Home', subtitle: 'Appliances, electronics, electrical', icon: 'home', color: '#2563EB' },
  { key: 'hospital', title: 'Hospital / Clinic', subtitle: 'Analyzers, monitors, surgical equipment', icon: 'medkit', color: '#DC2626' },
  { key: 'lab', title: 'Lab / Diagnostics', subtitle: 'Analyzers, centrifuges, lab equipment', icon: 'flask', color: '#0D9488' },
  { key: 'office', title: 'Office / Business', subtitle: 'Computers, printers, electricals', icon: 'business', color: '#7C3AED' },
  { key: 'industry', title: 'Industry / Factory', subtitle: 'Machines, compressors, pumps', icon: 'construct', color: '#4B5563' },
];
export const segmentTitle = (s: Segment | null) => SEGMENTS.find((x) => x.key === s)?.title || '—';

export const STATUS: Record<BookingStatus, { label: string; color: string; bg: string; customerText: string; engineerText: string }> = {
  requested: { label: 'Finding engineer', color: colors.warning, bg: colors.warningSoft, customerText: 'Looking for the nearest engineer…', engineerText: 'New request' },
  accepted: { label: 'Engineer assigned', color: colors.info, bg: colors.infoSoft, customerText: 'Your engineer is confirmed', engineerText: 'Accepted' },
  on_the_way: { label: 'On the way', color: colors.info, bg: colors.infoSoft, customerText: 'Your engineer is on the way', engineerText: 'On the way' },
  in_progress: { label: 'In progress', color: colors.accent, bg: colors.accentSoft, customerText: 'Work in progress', engineerText: 'In progress' },
  completed: { label: 'Completed', color: colors.success, bg: colors.successSoft, customerText: 'Job completed', engineerText: 'Completed' },
  cancelled: { label: 'Cancelled', color: colors.textMuted, bg: '#F1F2F4', customerText: 'Booking cancelled', engineerText: 'Cancelled' },
};
export const ACTIVE: BookingStatus[] = ['requested', 'accepted', 'on_the_way', 'in_progress'];

// Next 7 days as YYYY-MM-DD in the phone's local date.
export const nextDays = (n = 7) => Array.from({ length: n }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() + i);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { iso, day: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short' }), date: d.getDate(), month: d.toLocaleDateString('en-IN', { month: 'short' }) };
});
