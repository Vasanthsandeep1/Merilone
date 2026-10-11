import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Button, ErrorText, Field, IconBadge, Loading, SEGMENTS, api, colors, radius, space, type, useAuth, fs } from '@meril-one/shared';
import type { B2GMatch, Segment, User } from '@meril-one/shared';

// Sign-up (and Edit profile): step 1 choose your background, step 2 your
// details. The background decides which services you see.
//
// New sign-up: the verified mobile number is first looked up in the Meril
// B2G portal (clients and portal users). If found, the details form opens
// prefilled (name, organisation, email, address, background) with the
// products they bought from us, ready to add to My Products. The customer
// checks or edits, then continues.
export default function OnboardingScreen() {
  const { user, setUser, logout } = useAuth();
  const navigation = useNavigation();
  const editing = !!user?.profileComplete;
  const [step, setStep] = useState<1 | 2>(editing ? 2 : 1);
  const [segment, setSegment] = useState<Segment | null>(user?.segment || null);
  const [f, setF] = useState({
    name: user?.name || '', orgName: user?.orgName || '', email: user?.email || '',
    address: user?.address || '', city: user?.city || '', pincode: user?.pincode || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // B2G prefill (new sign-ups only).
  const [checking, setChecking] = useState(!editing);
  const [matches, setMatches] = useState<B2GMatch[]>([]);
  const [match, setMatch] = useState<B2GMatch | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const apply = (m: B2GMatch) => {
    setMatch(m);
    setF({ name: m.name, orgName: m.orgName, email: m.email, address: m.address, city: m.city, pincode: m.pincode });
    setSegment(m.segment || (m.orgName ? 'office' : 'home'));
    setPicked(Object.fromEntries(m.products.map((p) => [p.name, true])));
    setStep(2);
  };
  useEffect(() => {
    if (editing) return;
    api.get<{ found: boolean; matches: B2GMatch[] }>('/b2g-profile')
      .then((r) => { setMatches(r.matches); if (r.found) apply(r.matches[0]); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const isOrg = segment && segment !== 'home';
  const seg = SEGMENTS.find((s) => s.key === segment);

  const save = async () => {
    setError(null); setBusy(true);
    try {
      const r = await api.put<{ user: User }>('/me', { ...f, segment, b2gLink: match ? { source: match.source, id: match.id } : undefined });
      // Products bought through B2G that they kept ticked -> My Products.
      if (match) {
        for (const p of match.products.filter((x) => picked[x.name])) {
          await api.post('/products', { name: p.name, categoryKey: p.categoryId ? `b${p.categoryId}` : undefined, notes: `Bought through Meril B2G (qty ${p.qty})` }).catch(() => {});
        }
      }
      setUser(r.user);
      if (editing) navigation.goBack();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (checking) return <Loading />;

  if (step === 1) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.xl }}>
          <Text style={type.hero}>Welcome to Meril One 👋</Text>
          <Text style={[type.small, { fontSize: fs(15), marginTop: 6, marginBottom: space.xl }]}>Where do you need service? We'll show you the right experts.</Text>
          {SEGMENTS.map((s) => {
            const on = segment === s.key;
            return (
              <Pressable key={s.key} onPress={() => setSegment(s.key)}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md, borderWidth: 2, borderColor: on ? colors.brand : colors.border }}>
                <IconBadge icon={s.icon} color={s.color} size={50} />
                <View style={{ flex: 1, marginLeft: space.lg }}>
                  <Text style={type.h3}>{s.title}</Text>
                  <Text style={[type.small, { marginTop: 2 }]}>{s.subtitle}</Text>
                </View>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? colors.brand : colors.border} />
              </Pressable>
            );
          })}
          <Button title="Continue" onPress={() => setStep(2)} disabled={!segment} style={{ marginTop: space.md }} />
          <Text onPress={logout} style={{ textAlign: 'center', color: colors.textMuted, marginTop: space.lg }}>Use a different number</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={editing ? [] : ['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {!editing && <Text style={type.hero}>{match ? 'Welcome back 👋' : 'A few details'}</Text>}
          {match && (
            <View style={{ backgroundColor: '#2563EB', borderRadius: radius.xl, padding: space.lg, marginTop: space.lg, overflow: 'hidden' }}>
              <Ionicons name="link" size={100} color="rgba(255,255,255,0.12)" style={{ position: 'absolute', right: -10, bottom: -14 }} />
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: fs(16) }}>We found you in Meril B2G</Text>
              <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: fs(13), marginTop: 4, maxWidth: '85%' }}>
                Your details from {match.label} are filled in below. Check them, change anything, then continue.
              </Text>
              {matches.length > 1 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.md, gap: 6 }}>
                  {matches.map((m) => {
                    const on = m.source === match.source && m.id === match.id;
                    return (
                      <Pressable key={`${m.source}${m.id}`} onPress={() => apply(m)}
                        style={{ backgroundColor: on ? '#fff' : 'rgba(255,255,255,0.18)', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ color: on ? '#2563EB' : '#fff', fontWeight: '700', fontSize: fs(12) }}>{m.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Text onPress={() => { setMatch(null); setF({ name: '', orgName: '', email: '', address: '', city: '', pincode: '' }); setSegment(null); setStep(1); }}
                style={{ color: '#fff', fontWeight: '700', marginTop: space.md, textDecorationLine: 'underline', fontSize: fs(13) }}>
                Not me, start fresh
              </Text>
            </View>
          )}
          <Pressable onPress={() => setStep(1)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.brandSoft, padding: space.md, borderRadius: radius.md, marginVertical: space.lg }}>
            {seg && <IconBadge icon={seg.icon} color={seg.color} size={34} />}
            <Text style={{ flex: 1, marginLeft: space.md, fontWeight: '700', color: colors.brand }}>{seg?.title}</Text>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Change</Text>
          </Pressable>
          <Field label="Your name *" value={f.name} onChangeText={set('name')} placeholder="Full name" autoCapitalize="words" />
          {isOrg && <Field label={`${segment === 'hospital' ? 'Hospital / clinic' : segment === 'lab' ? 'Lab' : 'Company'} name *`} value={f.orgName} onChangeText={set('orgName')} placeholder="Organisation name" autoCapitalize="words" />}
          <Field label="Email" value={f.email} onChangeText={set('email')} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="Address" value={f.address} onChangeText={set('address')} placeholder="House / building, street, area" multiline />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Field style={{ flex: 1 }} label="City *" value={f.city} onChangeText={set('city')} placeholder="City" autoCapitalize="words" />
            <Field style={{ flex: 1 }} label="Pincode *" value={f.pincode} onChangeText={(t) => set('pincode')(t.replace(/\D/g, '').slice(0, 6))} placeholder="6 digits" keyboardType="number-pad" />
          </View>
          {match && match.products.length > 0 && (
            <View style={{ marginBottom: space.lg }}>
              <Text style={[type.label, { marginBottom: 4 }]}>Your products from Meril B2G</Text>
              <Text style={[type.small, { marginBottom: space.sm }]}>Ticked ones are added to My Products, so you can book service for them in one tap.</Text>
              {match.products.map((p) => {
                const on = !!picked[p.name];
                return (
                  <Pressable key={p.name} onPress={() => setPicked((x) => ({ ...x, [p.name]: !on }))}
                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? colors.brand : colors.border, padding: space.md, marginBottom: space.sm }}>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.brand : colors.textFaint} />
                    <View style={{ flex: 1, marginLeft: space.md }}>
                      <Text style={type.h3} numberOfLines={1}>{p.name}</Text>
                      <Text style={type.small}>Qty {p.qty}{p.lastBought ? ` · last bought ${new Date(`${p.lastBought}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          <ErrorText>{error}</ErrorText>
          <Button title={editing ? 'Save changes' : match ? 'Continue' : 'Start booking'} onPress={save} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
