import { forwardRef } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';
import type { TextInputProps, TextProps, TextStyle } from 'react-native';

// App-wide font: Poppins. Both apps use these Text / TextInput instead of
// React Native's, so every label gets the font without setting fontFamily
// everywhere. The weight in the style (fontWeight '400'…'900' / 'bold') picks
// the matching Poppins file, because Android can't bold a custom font itself.
// The fonts are loaded in each app's App.tsx (useFonts, APP_FONTS).
export { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold } from '@expo-google-fonts/poppins';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold } from '@expo-google-fonts/poppins';
export const APP_FONTS = { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold };

const FAMILY: Record<string, string> = {
  normal: 'Poppins_400Regular', 100: 'Poppins_400Regular', 200: 'Poppins_400Regular', 300: 'Poppins_400Regular', 400: 'Poppins_400Regular',
  500: 'Poppins_500Medium', 600: 'Poppins_600SemiBold', bold: 'Poppins_700Bold', 700: 'Poppins_700Bold',
  800: 'Poppins_800ExtraBold', 900: 'Poppins_800ExtraBold',
};

// Adds the Poppins file for the style's weight (unless a fontFamily is set).
function withFont(style: TextProps['style']) {
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  if (flat.fontFamily) return style;
  return [style, { fontFamily: FAMILY[String(flat.fontWeight ?? '400')] || FAMILY[400], fontWeight: 'normal' as const }];
}

// Large system font sizes may grow text by up to 20%, not enough to break layouts.
export const Text = forwardRef<RNText, TextProps>(({ style, maxFontSizeMultiplier = 1.2, ...props }, ref) => (
  <RNText ref={ref} maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} style={withFont(style)} />
));
Text.displayName = 'Text';

export const TextInput = forwardRef<RNTextInput, TextInputProps>(({ style, maxFontSizeMultiplier = 1.2, ...props }, ref) => (
  <RNTextInput ref={ref} maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} style={withFont(style)} />
));
TextInput.displayName = 'TextInput';
