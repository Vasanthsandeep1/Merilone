import { fs } from '@meril-one/shared';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text } from '@meril-one/shared';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

// One banner: either a posted image ad (`image`, from B2G > Post Ads) or a
// drawn banner (eyebrow / title / cta / colour / icon). `onPress` runs its action.
export type AdSlide = {
  image?: string;    // full URL of a posted banner
  // Text typed in B2G Post Ads, drawn at the bottom-left of the image.
  text?: { headline?: string | null; subline?: string | null; cta?: string | null };
  key: string;
  eyebrow: string;
  title: string;
  cta: string;
  color: string;
  icon: string;
  onPress: () => void;
};

// Ad banners are 3 : 1 (upload 1200 x 400 px): full width and short.
export const AD_RATIO = 3;

// Promo banners at the top of Home: full width, short (width / 3), the image
// filling the whole section. Slides change every 4 s; swiping pauses the
// auto-slide for a moment, then it carries on. Dots show which one is on.
// With `height` + `children` it is the Home header's background (hero): the
// images fill the whole header and the children (location, search) float on
// top; empty parts of the header still swipe / tap through to the banner.
// `inset` (side margin) makes it a rounded card inside the page instead of full width.
export default function AdCarousel({ slides, height: fixedHeight, children, inset = 0 }: { slides: AdSlide[]; height?: number; children?: ReactNode; inset?: number }) {
  const { width: screenW } = useWindowDimensions();
  const width = screenW - inset * 2;
  const height = fixedHeight ?? Math.round(width / AD_RATIO);
  const ref = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const pausedUntil = useRef(0);
  const ids = slides.map((s) => s.key).join('|');

  // A new set of slides starts from the first one.
  useEffect(() => {
    indexRef.current = 0; setIndex(0);
    ref.current?.scrollTo({ x: 0, animated: false });
  }, [ids]);

  // Auto-slide every 4 s (unless the user swiped in the last 5 s).
  useEffect(() => {
    if (slides.length < 2) return undefined;
    const t = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      const next = (indexRef.current + 1) % slides.length;
      indexRef.current = next;
      setIndex(next);
      ref.current?.scrollTo({ x: next * width, animated: true });
    }, 4000);
    return () => clearInterval(t);
  }, [ids, slides.length, width]);

  if (!slides.length) return null;

  const settle = (x: number) => {
    const i = Math.max(0, Math.min(slides.length - 1, Math.round(x / width)));
    indexRef.current = i; setIndex(i);
  };

  return (
    <View style={{ height, width, marginHorizontal: inset, borderRadius: inset ? 18 : 0, overflow: 'hidden' }}>
      <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} decelerationRate="fast"
        onScrollBeginDrag={() => { pausedUntil.current = Date.now() + 5000; }}
        onScrollEndDrag={() => { pausedUntil.current = Date.now() + 5000; }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.x)}>
        {slides.map((s) => s.image ? (
          <Pressable key={s.key} onPress={s.onPress} accessibilityLabel={s.text?.headline || s.title} style={{ width, height, backgroundColor: '#E5E7EB' }}>
            <Image source={{ uri: s.image }} style={{ width, height }} resizeMode="cover" />
            {!!(s.text?.headline || s.text?.subline || s.text?.cta) && (
              <>
                {/* smooth dark fade at the bottom so the text reads on any image */}
                <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.62)']} locations={[0, 0.45, 1]}
                  style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.min(170, height * 0.5) }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: 20, right: 70, bottom: 24 }}>
                  {!!s.text?.headline && <Text style={adText.headline} numberOfLines={2}>{s.text.headline}</Text>}
                  {!!s.text?.subline && <Text style={adText.subline} numberOfLines={2}>{s.text.subline}</Text>}
                  {!!s.text?.cta && (
                    <View style={adText.ctaPill}>
                      <Text style={adText.cta}>{s.text.cta.replace(/\s*[→>›]+\s*$/, '')}</Text>
                      <Ionicons name="arrow-forward" size={14} color="#fff" style={{ marginLeft: 6 }} />
                    </View>
                  )}
                </View>
              </>
            )}
          </Pressable>
        ) : (
          <Pressable key={s.key} onPress={s.onPress} style={{ width, height, overflow: 'hidden', backgroundColor: s.color }}>
            <View style={{ position: 'absolute', width: height * 1.8, height: height * 1.8, borderRadius: height, right: -height * 0.6, top: -height * 0.45, backgroundColor: 'rgba(255,255,255,0.10)' }} />
            <View style={{ position: 'absolute', right: 18, top: (height - 78) / 2, width: 78, height: 78, borderRadius: 39, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center',
              shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 }}>
              <Ionicons name={s.icon as any} size={40} color={s.color} />
            </View>
            <View style={{ position: 'absolute', left: 18, top: 14, right: 112 }}>
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: fs(11), fontWeight: '700' }} numberOfLines={1}>{s.eyebrow}</Text>
              <Text style={{ color: '#fff', fontSize: fs(17), fontWeight: '800', marginTop: 3, lineHeight: 21 }} numberOfLines={2}>{s.title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                <Text style={{ color: '#fff', fontSize: fs(13), fontWeight: '800' }}>{s.cta}</Text>
                <Ionicons name="arrow-forward" size={15} color="#fff" style={{ marginLeft: 6 }} />
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      {children != null && (
        <>
          {/* smooth dark fade at the top so white text / icons stay readable */}
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0)']} locations={[0, 0.55, 1]}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 230 }} />
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>{children}</View>
        </>
      )}
      {slides.length > 1 && (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 7, alignSelf: 'center', flexDirection: 'row', gap: 5, backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8 }}>
          {slides.map((s, i) => (
            <View key={s.key} style={{ width: i === index ? 14 : 5, height: 5, borderRadius: 3, backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.6)' }} />
          ))}
        </View>
      )}
    </View>
  );
}

// Ad banner text, bottom-left: a big tight Poppins headline, a softer
// sub-text, and an orange button with an arrow. A light shadow keeps it crisp.
const shade = { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 };
const adText = {
  headline: { fontFamily: 'Poppins_800ExtraBold', fontSize: fs(26), lineHeight: 31, color: '#fff', letterSpacing: -0.6, includeFontPadding: false, ...shade },
  subline: { fontFamily: 'Poppins_500Medium', fontSize: fs(14), lineHeight: 20, color: 'rgba(255,255,255,0.88)', marginTop: 4, includeFontPadding: false, ...shade },
  ctaPill: {
    alignSelf: 'flex-start' as const, flexDirection: 'row' as const, alignItems: 'center' as const,
    backgroundColor: '#F97316', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, marginTop: 12,
    shadowColor: '#F97316', shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  cta: { fontFamily: 'Poppins_700Bold', fontSize: fs(13), color: '#fff', includeFontPadding: false },
};
