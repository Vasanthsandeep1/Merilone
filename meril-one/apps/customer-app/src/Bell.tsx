import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, colors, fs } from '@meril-one/shared';
import type { RootStack } from './nav';

// 🔔 in the top bar with the unread count; checks every 15 s while the app is
// open. Tapping opens Notifications.
export default function Bell({ color = colors.text }: { color?: string } = {}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [unread, setUnread] = useState(0);
  const load = useCallback(() => {
    api.get<{ unread: number }>('/notifications').then((r) => setUnread(r.unread)).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Pressable onPress={() => navigation.navigate('Notifications')} hitSlop={10} accessibilityLabel="Notifications"
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(127,127,127,0.15)' : 'transparent' })}>
      <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={25} color={color} />
      {unread > 0 && (
        <View style={{ position: 'absolute', top: 6, right: 5, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: '#fff' }}>
          <Text style={{ color: '#fff', fontSize: fs(10), fontWeight: '800' }}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}
