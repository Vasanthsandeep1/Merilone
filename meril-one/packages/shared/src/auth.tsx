import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ElementRef, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './text';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, auth } from './api';
import type { Role } from './api';
import type { User } from './types';
import { Button, ErrorText } from './ui';
import { colors, radius, space, type, fs } from './theme';

// Session for one app (customer or engineer): token in secure storage,
// the current user, and login/logout. Mobile number + OTP login.
interface AuthState {
  role: Role;
  user: User | null;
  ready: boolean;
  setUser: (u: User) => void;
  login: (token: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
};

export function AuthProvider({ role, children }: { role: Role; children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(async () => { await auth.clear(role); setUser(null); }, [role]);
  const refresh = useCallback(async () => {
    const r = await api.get<{ user: User }>('/me');
    setUser(r.user);
  }, []);

  useEffect(() => {
    auth.onUnauthorized(() => { auth.clear(role); setUser(null); });
    (async () => {
      try {
        if (await auth.load(role)) await refresh();
      } catch {
        // Offline or expired: the login screen shows; a 401 already cleared the token.
      } finally {
        setReady(true);
      }
    })();
  }, [role, refresh]);

  const login = useCallback(async (token: string, u: User) => { await auth.save(role, token); setUser(u); }, [role]);
  return <Ctx.Provider value={{ role, user, ready, setUser, login, logout, refresh }}>{children}</Ctx.Provider>;
}

// Two-step login screen: mobile number, then the 6-digit OTP.
export function LoginScreen({ title, tagline, accent = colors.accent, icon }: { title: string; tagline: string; accent?: string; icon: keyof typeof Ionicons.glyphMap }) {
  const { role, login } = useAuth();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const otpRef = useRef<ElementRef<typeof TextInput>>(null);

  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setError(null);
    if (!/^[6-9]\d{9}$/.test(phone)) { setError('Enter a valid 10-digit mobile number'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ devOtp?: string }>('/auth/send-otp', { phone, role });
      setDevOtp(r.devOtp || null);
      setStep('otp'); setOtp(''); setWait(30);
      setTimeout(() => otpRef.current?.focus(), 300);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const verify = async (code = otp) => {
    setError(null);
    if (code.length !== 6) { setError('Enter the 6-digit OTP'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ token: string; user: User }>('/auth/verify-otp', { phone, role, otp: code });
      await login(r.token, r.user);
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={[st.hero, { backgroundColor: colors.brand }]}>
          <View style={[st.logo, { backgroundColor: accent }]}><Ionicons name={icon} size={30} color="#fff" /></View>
          <Text style={st.heroTitle}>{title}</Text>
          <Text style={st.heroTag}>{tagline}</Text>
        </View>
        <View style={{ padding: space.xl, flex: 1 }}>
          {step === 'phone' ? (
            <>
              <Text style={type.h1}>Log in or sign up</Text>
              <Text style={[type.small, { fontSize: fs(14), marginTop: 4, marginBottom: space.xl }]}>We'll send an OTP to verify your number</Text>
              <View style={st.phoneRow}>
                <Text style={st.cc}>+91</Text>
                <TextInput value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" placeholder="Mobile number"
                  placeholderTextColor={colors.textFaint} style={st.phoneInput} maxLength={10} autoFocus onSubmitEditing={send} />
              </View>
              <ErrorText>{error}</ErrorText>
              <Button title="Get OTP" onPress={send} loading={busy} disabled={phone.length !== 10} />
            </>
          ) : (
            <>
              <Pressable onPress={() => { setStep('phone'); setError(null); }} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.lg }}>
                <Ionicons name="arrow-back" size={20} color={colors.text} /><Text style={{ marginLeft: 6, fontWeight: '600' }}>Change number</Text>
              </Pressable>
              <Text style={type.h1}>Enter OTP</Text>
              <Text style={[type.small, { fontSize: fs(14), marginTop: 4, marginBottom: space.xl }]}>Sent to +91 {phone}</Text>
              <TextInput ref={otpRef} value={otp} keyboardType="number-pad" maxLength={6} placeholder="••••••" placeholderTextColor={colors.textFaint}
                onChangeText={(t) => { const v = t.replace(/\D/g, '').slice(0, 6); setOtp(v); if (v.length === 6) verify(v); }}
                style={st.otpInput} textContentType="oneTimeCode" autoComplete="sms-otp" />
              {devOtp && (
                <Text style={st.devOtp}>Test mode (no SMS set up yet): your OTP is <Text style={{ fontWeight: '800' }}>{devOtp}</Text></Text>
              )}
              <ErrorText>{error}</ErrorText>
              <Button title="Verify & continue" onPress={() => verify()} loading={busy} disabled={otp.length !== 6} />
              <Text onPress={wait ? undefined : send} style={{ textAlign: 'center', marginTop: space.lg, color: wait ? colors.textFaint : colors.accent, fontWeight: '700' }}>
                {wait ? `Resend OTP in ${wait}s` : 'Resend OTP'}
              </Text>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  hero: { paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.xxl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  logo: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  heroTitle: { color: '#fff', fontSize: fs(28), fontWeight: '800' },
  heroTag: { color: '#CBD5E1', fontSize: fs(14), marginTop: 6 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, height: 56, marginBottom: space.lg, paddingHorizontal: 14 },
  cc: { fontSize: fs(17), fontWeight: '700', color: colors.text, marginRight: 10, paddingRight: 10, borderRightWidth: 1, borderRightColor: colors.border },
  phoneInput: { flex: 1, fontSize: fs(18), fontWeight: '600', color: colors.text, letterSpacing: 1 },
  otpInput: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, height: 60, fontSize: fs(26), fontWeight: '800', letterSpacing: 14, textAlign: 'center', color: colors.text, marginBottom: space.lg },
  devOtp: { backgroundColor: colors.warningSoft, color: colors.warning, padding: 10, borderRadius: radius.sm, marginBottom: space.lg, fontSize: fs(13) },
});
