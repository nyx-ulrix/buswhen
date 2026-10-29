// Shared look for every page: palette, base styles and the two button types.
import { Pressable, StyleSheet } from 'react-native';

export const C = {
  ink: '#111111', paper: '#FFFDF5', violet: '#A98BF5', peach: '#FFB86B', lime: '#C8F169',
  coral: '#FF6B4A', pink: '#F7A8D8', sky: '#7EC8F0', butter: '#FFE066', grey: '#5C5C5C',
};
export const CARD_COLORS = [C.peach, C.pink, C.butter]; // max 3 per screen
export const GAP = 12;
export const outline = { borderWidth: 2.5, borderColor: C.ink };

// plain objects, so each page can spread them into its own StyleSheet
export const base = {
  screen: { flex: 1, backgroundColor: C.violet },
  content: { padding: 16, gap: GAP, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  display: { fontFamily: 'Shrikhand_400Regular', fontSize: 44, lineHeight: 52, color: C.ink },
  displaySm: { fontFamily: 'Shrikhand_400Regular', fontSize: 28, lineHeight: 34, color: C.ink },
  cardTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 17, lineHeight: 21, color: C.ink },
  label: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.ink },
  caption: { fontFamily: 'SpaceGrotesk_500Medium', fontSize: 12, color: C.ink },
  search: {
    ...outline, borderRadius: 999, backgroundColor: C.paper, paddingHorizontal: 18, flexDirection: 'row',
    alignItems: 'center', gap: 10, boxShadow: `4px 4px 0 ${C.ink}`,
  },
  searchInput: { flex: 1, paddingVertical: 14, fontFamily: 'SpaceGrotesk_500Medium', fontSize: 16, color: C.ink, outlineStyle: 'none' },
  btn: { ...outline, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 12, boxShadow: `4px 4px 0 ${C.ink}` },
  chip: { ...outline, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, boxShadow: `2px 2px 0 ${C.ink}` },
  card: { ...outline, borderRadius: 20, padding: 10, gap: 10, boxShadow: `4px 4px 0 ${C.ink}` },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconBtn: {
    ...outline, width: 32, height: 32, borderRadius: 999, backgroundColor: C.paper,
    alignItems: 'center', justifyContent: 'center', boxShadow: `2px 2px 0 ${C.ink}`,
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,17,17,0.45)' },
  sheet: {
    ...outline, position: 'absolute', left: 16, right: 16, bottom: 16, maxWidth: 640, marginHorizontal: 'auto',
    backgroundColor: C.paper, borderRadius: 28, padding: 20, gap: 12, boxShadow: `4px 4px 0 ${C.ink}`,
  },
};
const s = StyleSheet.create(base);

export function IconBtn({ children, label, disabled, active, size, onPress }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }} hitSlop={6}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.iconBtn, size && { width: size, height: size }, disabled && { opacity: 0.3 },
        active && { backgroundColor: C.ink },
        pressed && { transform: [{ translateX: 2 }, { translateY: 2 }], boxShadow: 'none' }]}>
      {children}
    </Pressable>
  );
}

export function Btn({ children, color = C.paper, small, label, onPress }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [
      small ? s.chip : s.btn, { backgroundColor: color },
      pressed && { transform: [{ translateX: 2 }, { translateY: 2 }], boxShadow: `1px 1px 0 ${C.ink}` },
    ]}>
      {children}
    </Pressable>
  );
}
