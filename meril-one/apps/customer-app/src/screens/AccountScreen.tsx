import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, IconBadge, SEGMENTS, apiBaseUrl, colors, radius, space, type, useAuth, fs } from '@meril-one/shared';
import type { RootStack } from '../nav';

export default function AccountScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const seg = SEGMENTS.find((s) => s.key === user?.segment);

  const items: { icon: any; label: string; onPress: () => void }[] = [
    { icon: 'person-outline', label: 'Edit profile & address', onPress: () => navigation.navigate('EditProfile', { edit: true }) },
    { icon: 'calendar-outline', label: 'My bookings', onPress: () => navigation.navigate('Main') },
    { icon: 'help-circle-outline', label: 'Help & support', onPress: () => Alert.alert('Help & support', 'Call your Meril One support desk, or contact the engineer from your booking.') },
  ];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <Text style={type.hero}>Account</Text>
        <Card style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: fs(22), fontWeight: '800' }}>{(user?.name || '?')[0]}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: space.lg }}>
            <Text style={type.h2}>{user?.name}</Text>
            <Text style={type.small}>+91 {user?.phone}</Text>
            {user?.orgName && <Text style={type.small}>{user.orgName}</Text>}
          </View>
        </Card>

        {seg && (
          <Pressable onPress={() => navigation.navigate('EditProfile', { edit: true })}
            style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.brandSoft, padding: space.md, borderRadius: radius.md }}>
            <IconBadge icon={seg.icon} color={seg.color} size={36} />
            <View style={{ flex: 1, marginLeft: space.md }}>
              <Text style={type.small}>Your background</Text>
              <Text style={{ fontWeight: '700', color: colors.brand }}>{seg.title}</Text>
            </View>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Change</Text>
          </Pressable>
        )}

        <Card style={{ marginTop: space.lg, padding: 0 }}>
          {items.map((it, i) => (
            <Pressable key={it.label} onPress={it.onPress}
              style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <Ionicons name={it.icon} size={20} color={colors.text} />
              <Text style={{ flex: 1, marginLeft: space.md, fontWeight: '600', color: colors.text }}>{it.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          ))}
        </Card>

        <Pressable onPress={() => Alert.alert('Log out?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: logout }])}
          style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: '700', marginLeft: 8 }}>Log out</Text>
        </Pressable>
        <Text style={[type.small, { textAlign: 'center', marginTop: space.md, color: colors.textFaint }]}>Meril One · server {apiBaseUrl().replace(/^https?:\/\//, '').replace('/api/m1', '')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
