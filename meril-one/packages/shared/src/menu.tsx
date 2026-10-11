import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Modal, Pressable, View } from 'react-native';
import { Text } from './text';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space, fs } from './theme';

// Replaces the tab bar with a "☰" button: a slim bar at the top (below the
// phone's status bar) with the page title; tapping ☰ slides in a menu with
// just the app's sections. Pass it as the tab navigator's `tabBar`, with
// tabBarPosition 'top'. `items` maps each tab route name to its label + icon.
export type MenuItem = { label: string; icon: string };

export function MenuBar({ state, navigation, items, dark, appName, right, colorFor }: {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
  items: Record<string, MenuItem>;
  dark?: boolean;     // navy bar (engineer app) instead of white
  appName: string;
  right?: ReactNode | ((fg: string) => ReactNode); // e.g. the notifications bell
  // Per-screen bar colour (e.g. blue on Home to merge with its header).
  // overlay: the bar floats over the screen (transparent), e.g. over Home's image header.
  // bare: only the ☰ button is drawn (no title / bell), e.g. on Home whose own header shows those.
  colorFor?: (routeName: string) => { bg: string; fg: string; overlay?: boolean; bare?: boolean } | undefined;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  const current = state.routes[state.index];
  const custom = colorFor?.(state.routes[state.index].name);
  const bg = custom?.bg ?? (dark ? '#0B1B33' : colors.surface);
  const fg = custom?.fg ?? (dark ? '#FFFFFF' : colors.text);

  useEffect(() => {
    if (open) Animated.timing(slide, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [open, slide]);
  const close = () => Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setOpen(false));
  const go = (name: string) => { close(); navigation.navigate(name); };

  return (
    <View pointerEvents="box-none" style={[
      { backgroundColor: bg, paddingTop: insets.top, borderBottomWidth: dark || custom ? 0 : 1, borderBottomColor: colors.border },
      custom?.overlay ? { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, elevation: 10 } : null,
    ]}>
      <View pointerEvents="box-none" style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <Pressable onPress={() => setOpen(true)} hitSlop={10} accessibilityLabel="Open menu"
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? (dark ? 'rgba(255,255,255,0.12)' : colors.bg) : 'transparent' })}>
          <Ionicons name="menu" size={28} color={fg} />
        </Pressable>
        {!custom?.bare && (
          <>
            <Text style={{ flex: 1, marginLeft: space.sm, fontSize: fs(18), fontWeight: '800', color: fg }} numberOfLines={1}>
              {custom ? appName : items[current.name]?.label || current.name}
            </Text>
            {typeof right === 'function' ? right(fg) : right}
          </>
        )}
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <Animated.View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', opacity: slide }}>
          <Pressable style={{ flex: 1 }} onPress={close} />
        </Animated.View>
        <Animated.View style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '78%', maxWidth: 320, backgroundColor: colors.surface,
          paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg,
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-340, 0] }) }],
          shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, elevation: 16,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, marginBottom: space.lg }}>
            <Text style={{ flex: 1, fontSize: fs(20), fontWeight: '900', color: colors.text }}>{appName}</Text>
            <Pressable onPress={close} hitSlop={10}><Ionicons name="close" size={26} color={colors.textMuted} /></Pressable>
          </View>
          {state.routes.map((r, i) => {
            const it = items[r.name];
            if (!it) return null;
            const on = i === state.index;
            return (
              <Pressable key={r.key} onPress={() => go(r.name)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', marginHorizontal: space.md, marginBottom: 4, paddingHorizontal: space.md, paddingVertical: 14, borderRadius: radius.md, backgroundColor: on ? colors.brandSoft : pressed ? colors.bg : 'transparent' })}>
                <Ionicons name={(on ? it.icon : `${it.icon}-outline`) as any} size={22} color={on ? colors.brand : colors.textMuted} />
                <Text style={{ marginLeft: space.md, fontSize: fs(16), fontWeight: on ? '800' : '600', color: on ? colors.brand : colors.text }}>{it.label}</Text>
                {on && <View style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }} />}
              </Pressable>
            );
          })}
        </Animated.View>
      </Modal>
    </View>
  );
}
