import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Text, fs } from '@meril-one/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chip, ErrorText, Field, api, colors, radius, space, type, useAuth } from '@meril-one/shared';
import type { Category, User } from '@meril-one/shared';
import AreaEditor from '../AreaEditor';
import type { Area } from '../AreaEditor';

// Engineer sign-up / edit, and the "Check your details" screen shown right
// after every OTP login (review). Everything comes from Meril B2G (Service
// Management) and can be corrected here — name, email, experience, area
// (states / districts) and skills — and is saved back to B2G. Company, Emp ID
// and mobile identify you at your company, so only the company changes them.
export default function ProfileSetupScreen({ review, onDone }: { review?: boolean; onDone?: () => void } = {}) {
  const { user, setUser, logout } = useAuth();
  const navigation = useNavigation();
  const editing = !!user?.profileComplete && !review;
  const [cats, setCats] = useState<Category[]>([]);
  const [f, setF] = useState({
    name: user?.name || '', email: user?.email || '', city: user?.city || '', pincode: user?.pincode || '',
    servicePincodes: (user?.servicePincodes || []).filter((p) => p !== user?.pincode).join(', '),
    experienceYears: user?.experienceYears ? String(user.experienceYears) : '',
    companyName: user?.companyName || '', about: user?.about || '',
  });
  // Visit charge per skill, as typed (blank = standard price).
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(user?.rates || {}).map(([k, v]) => [k, String(v)])),
  );
  const [skills, setSkills] = useState<number[]>(user?.skills || []);
  const b2g = user?.b2gEngineer || null;
  const [areas, setAreas] = useState<Area[]>(b2g?.areas || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { api.get<{ data: Category[] }>('/catalog').then((r) => setCats(r.data)).catch((e) => setError(e.message)); }, []);
  const toggle = (id: number) => setSkills((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = async () => {
    setError(null); setBusy(true);
    try {
      if (b2g && (!areas.length || areas.some((a) => !a.districts.length))) { setError('Pick at least one district in every state you add.'); setBusy(false); return; }
      const r = await api.put<{ user: User }>('/me', { ...f, skills, rates: Object.fromEntries(skills.map((id) => [id, Number(rates[id]) || 0])), ...(b2g ? { areas } : {}) });
      setUser(r.user);
      if (review) onDone?.();
      else if (editing) navigation.goBack();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView edges={editing ? [] : ['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {!editing && (
            <>
              <Text style={type.hero}>{review ? 'Check your details' : `Welcome, ${b2g ? user?.name?.split(' ')[0] : 'partner'} 👋`}</Text>
              <Text style={[type.small, { fontSize: fs(14), marginTop: 6, marginBottom: space.lg }]}>
                {b2g ? 'We fetched these from your company in Meril B2G. Change anything that is wrong, then continue.' : "You'll get requests for your skills, in the areas you cover."}
              </Text>
            </>
          )}
          {b2g ? (
            // From B2G: read-only.
            <View style={{ backgroundColor: '#2563EB', borderRadius: radius.xl, padding: space.lg, marginBottom: space.lg, overflow: 'hidden' }}>
              <Ionicons name="shield-checkmark" size={110} color="rgba(255,255,255,0.12)" style={{ position: 'absolute', right: -12, bottom: -16 }} />
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: fs(11), fontWeight: '800', letterSpacing: 0.5 }}>YOUR COMPANY (MERIL B2G)</Text>
              <Text style={{ color: '#fff', fontSize: fs(18), fontWeight: '800', marginTop: 4 }}>{b2g.companies.join(' / ')}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: fs(13), marginTop: 2 }}>Emp ID {b2g.empIds.join(', ')} · +91 {user?.phone}</Text>
              {!!b2g.skillNames?.filter((n) => !cats.some((c) => c.name === n)).length && (
                <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: fs(12), marginTop: space.sm }}>
                  Company skills: {b2g.skillNames.filter((n) => !cats.some((c) => c.name === n)).join(', ')}
                </Text>
              )}
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: fs(11), marginTop: space.md }}>Company, Emp ID and mobile are set by your company in Meril B2G.</Text>
            </View>
          ) : null}
          {b2g ? (
            <>
              <Text style={[type.label, { marginBottom: space.sm }]}>Your details</Text>
              <Field label="Full name *" value={f.name} onChangeText={set('name')} autoCapitalize="words" />
              <Field label="Email" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
              <Text style={[type.label, { marginTop: space.sm, marginBottom: space.sm }]}>Where you work *</Text>
              <AreaEditor value={areas} onChange={setAreas} />
              <View style={{ height: space.lg }} />
            </>
          ) : (
            <>
              <Field label="Full name *" value={f.name} onChangeText={set('name')} autoCapitalize="words" />
              <Field label="Email" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Field style={{ flex: 1 }} label="City *" value={f.city} onChangeText={set('city')} autoCapitalize="words" />
                <Field style={{ flex: 1 }} label="Home pincode *" value={f.pincode} onChangeText={(t) => set('pincode')(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" />
              </View>
              <Field label="Other pincodes you cover" value={f.servicePincodes} onChangeText={set('servicePincodes')} placeholder="e.g. 600040, 600054" keyboardType="numbers-and-punctuation"
                hint="You get every request in your city, plus these pincodes anywhere." />
              <Field label="Company / shop name" value={f.companyName} onChangeText={set('companyName')} placeholder="e.g. Sri Balaji Services (leave blank if independent)" autoCapitalize="words" />
            </>
          )}
          <Field label="About you" value={f.about} onChangeText={set('about')} multiline maxLength={1000}
            placeholder="What you specialise in, brands you service, certifications…" hint="Customers read this when choosing an engineer." />
          <Field label="Years of experience" value={f.experienceYears} onChangeText={(t) => set('experienceYears')(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />

          <Text style={[type.label, { marginTop: space.md, marginBottom: space.sm }]}>Your skills *</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {cats.map((c) => <Chip key={c.id} label={c.name} icon={c.icon as any} selected={skills.includes(c.id)} onPress={() => toggle(c.id)} />)}
            {!cats.length && <Text style={type.small}>Loading skills…</Text>}
          </View>

          <ErrorText>{error}</ErrorText>
          <Button title={editing ? 'Save changes' : review ? 'Continue' : 'Start getting jobs'} onPress={save} loading={busy} style={{ marginTop: space.md }} />
          {!editing && <Text onPress={logout} style={{ textAlign: 'center', color: colors.textMuted, marginTop: space.lg }}>Use a different number</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
