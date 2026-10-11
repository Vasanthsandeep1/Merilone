import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

// A horizontal row that slowly drifts on its own, looping forever: the items
// are drawn twice and it jumps back by one copy's width, so the jump can't be
// seen. The user can still swipe it; it pauses while touched and resumes a
// moment after. Only drifts when the items don't all fit on screen.
export default function AutoScrollRow({ children, speed = 25, gap = 10, padding = 16, paddingVertical = 0 }: {
  children: ReactNode;
  speed?: number;   // px per second
  gap?: number;     // space between items (and between the two copies)
  padding?: number; // left padding
  paddingVertical?: number;
}) {
  const ref = useRef<ScrollView>(null);
  const x = useRef(0);
  const pausedUntil = useRef(0);
  const [copyWidth, setCopyWidth] = useState(0); // one copy incl. its trailing gap
  const [viewWidth, setViewWidth] = useState(0);
  const scrolls = viewWidth > 0 && copyWidth - gap + padding * 2 > viewWidth;

  useEffect(() => {
    if (!scrolls) return;
    let last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      if (now < pausedUntil.current) return;
      x.current += speed * dt;
      if (x.current >= padding + copyWidth) x.current -= copyWidth;
      ref.current?.scrollTo({ x: x.current, animated: false });
    }, 30);
    return () => clearInterval(t);
  }, [scrolls, copyWidth, speed, padding]);

  const copy = (key: string, measure: boolean) => (
    <View key={key} style={{ flexDirection: 'row', gap, paddingRight: gap }}
      onLayout={measure ? (e) => setCopyWidth(e.nativeEvent.layout.width) : undefined}>
      {children}
    </View>
  );

  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={16}
      onLayout={(e) => setViewWidth(e.nativeEvent.layout.width)}
      onScroll={(e) => { if (Date.now() < pausedUntil.current) x.current = e.nativeEvent.contentOffset.x; }}
      onScrollBeginDrag={() => { pausedUntil.current = Date.now() + 1e9; }}
      onScrollEndDrag={() => { pausedUntil.current = Date.now() + 2500; }}
      onMomentumScrollEnd={() => { pausedUntil.current = Date.now() + 2500; }}
      contentContainerStyle={{ paddingLeft: padding, paddingRight: padding - gap, paddingVertical }}>
      {copy('a', true)}
      {scrolls && copy('b', false)}
    </ScrollView>
  );
}
