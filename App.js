import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, Shrikhand_400Regular } from '@expo-google-fonts/shrikhand';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { BookmarkSimple, Bus, MagnifyingGlass, PencilSimple, Trash } from 'phosphor-react-native';

const C = {
  ink: '#111111', paper: '#FFFDF5', violet: '#A98BF5', peach: '#FFB86B', lime: '#C8F169',
  coral: '#FF6B4A', pink: '#F7A8D8', sky: '#7EC8F0', butter: '#FFE066', grey: '#5C5C5C',
};
const BUS_COLORS = [C.coral, C.sky, C.lime]; // arriving bus, 2nd, 3rd
const CARD_COLORS = [C.peach, C.pink, C.butter]; // max 3 per screen, none shared with bar fills
const BAR_WINDOW_MIN = 30; // a bus fills its bar from 30 min out to 0
const STOPS_URL = 'https://data.busrouter.sg/v1/stops.min.json';
const ARRIVALS_URL = 'https://arrivelah2.busrouter.sg/?id=';
const STORE_KEY = 'buswhen.saved';
const GAP = 12;
// Sized so a half-width tile on a 360px phone fits 3 bars: (360-32-12)/2 = 158 >= 3*38 + 2*8 + CARD_PAD
const BAR_W = 38;
const BAR_GAP = 8;
const BAR_SLOT = BAR_W + BAR_GAP;
const CARD_PAD = 25; // card padding (10) + border (2.5), both sides
const ICONS_W = 70; // pen + bookmark: two 32px buttons and a 6px gap
const MIN_TILE = 110; // narrowest tile: one bar plus the stacked icons beside it
// Shrinks a stop name so it fits in two lines of the tile instead of widening it.
// ponytail: estimates glyph width (0.6em for Space Grotesk bold) and allows ~1.6 lines since
// word wrapping wastes space; measure text if names still clip
const titleSize = (name, tileW, k) =>
  Math.max(12, Math.min(17 * k, Math.floor((1.6 * (tileW - CARD_PAD)) / (name.length * 0.6))));

// saved: [{ code, name, road, services: [no] }] in tile order, empty services = show all
function useSaved() {
  const [saved, setSaved] = useState([]);
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((v) => {
      if (!v) return;
      const d = JSON.parse(v);
      // first version stored an object keyed by stop code
      setSaved(Array.isArray(d) ? d : Object.entries(d).map(([code, st]) => ({ code, ...st })));
    }).catch(() => {});
  }, []);
  const update = (fn) =>
    setSaved((prev) => {
      const next = fn([...prev]);
      AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  return [saved, update];
}

function useStops() {
  const [stops, setStops] = useState(null);
  useEffect(() => {
    fetch(STOPS_URL)
      .then((r) => r.json())
      .then((d) => setStops(Object.entries(d).map(([code, [, , name, road]]) => ({ code, name, road }))))
      .catch(() => setStops([]));
  }, []);
  return stops;
}

// Polls every stop in `codes` once a second, straight from the phone.
function useArrivals(codes) {
  const [data, setData] = useState({});
  const key = codes.join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const inFlight = new Set();
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      for (const code of key.split(',')) {
        if (inFlight.has(code)) continue; // skip if last request for this stop hasn't returned
        inFlight.add(code);
        fetch(ARRIVALS_URL + code)
          .then((r) => r.json())
          .then((d) => alive && setData((p) => ({ ...p, [code]: d.services || [] })))
          .catch(() => alive && setData((p) => (p[code] ? p : { ...p, [code]: 'error' })))
          .finally(() => inFlight.delete(code));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [key]);
  return data;
}

const minsUntil = (bus) => (bus?.time ? Math.max(0, (new Date(bus.time) - Date.now()) / 60000) : null);

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub?.remove();
  }, []);
  return reduce;
}

function Flash({ on, children }) {
  const v = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  useEffect(() => {
    if (!on || reduce) { v.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.25, duration: 400, useNativeDriver: false }),
      Animated.timing(v, { toValue: 1, duration: 400, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [on, reduce]);
  return <Animated.View style={[StyleSheet.absoluteFill, { opacity: v }]}>{children}</Animated.View>;
}

// Fill heights in px, nearest bus tallest. Each fill keeps LABEL_ROOM px above the one in front
// so the time printed at its top edge stays readable even when buses bunch up.
const BAR_H = 170;
const LABEL_ROOM = 32; // two-line label: number over "min"
function fillHeights(mins, k) {
  const out = [null, null, null];
  let floor = 10 * k; // lowest fill is at least 42px (at k=1), enough for a full dome
  for (let i = 2; i >= 0; i--) {
    if (mins[i] == null) continue;
    const raw = (1 - mins[i] / BAR_WINDOW_MIN) * BAR_H * k;
    out[i] = Math.min(BAR_H * k, Math.max(raw, floor + LABEL_ROOM * k));
    floor = out[i];
  }
  return out;
}

// One pill per service: the 3 upcoming buses as stacked fills, nearest = tallest, drawn first.
// k scales every bar dimension so bars grow with the screen.
function BusBar({ service, k }) {
  // the API occasionally lists a later bus first, so order by arrival time
  const buses = [service.next, service.next2, service.next3].filter((b) => b?.time)
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  const mins = buses.map(minsUntil);
  return (
    <View style={[s.barCol, { width: BAR_W * k }]} accessible
      accessibilityLabel={`Bus ${service.no}: ${mins.filter((m) => m != null).map((m) => (m < 1 ? 'arriving' : `${Math.floor(m)} min`)).join(', ')}`}>
      <View style={[s.bar, { width: BAR_W * k, height: BAR_H * k }]}>
        {fillHeights(mins, k).map((h, i) => {
          if (h == null) return null;
          const m = mins[i];
          const fillView = (
            <View style={[s.fill, { height: h, backgroundColor: BUS_COLORS[i], paddingTop: 7 * k }]}>
              {m < 1 ? <Bus size={14 * k} weight="bold" color={C.ink} /> : (
                <Text style={[s.etaText, { fontSize: 12 * k, lineHeight: 12 * k }]}>
                  {Math.floor(m)}{'\n'}<Text style={[s.etaUnit, { fontSize: 6.3 * k, lineHeight: 7 * k }]}>min</Text>
                </Text>
              )}
            </View>
          );
          return i === 0
            ? <Flash key={i} on={m < 1}>{fillView}</Flash>
            : <View key={i} style={StyleSheet.absoluteFill}>{fillView}</View>;
        })}
      </View>
      <Text style={[s.barNo, { fontSize: 16 * k, width: BAR_SLOT * k }]}>{service.no}</Text>
    </View>
  );
}

function StopCard({ code, stop, services: raw, color, saved, tileW, k, onToggleStop, onToggleService }) {
  const services = Array.isArray(raw) ? raw : [];
  const starred = saved?.services || [];
  const shown = starred.length ? services.filter((x) => starred.includes(x.no)) : services;
  const [picking, setPicking] = useState(false);
  // Icons sit right of the name, unless the bars leave a gap at the end of their row:
  // then they stack in that gap and the name gets the full width.
  const spare = tileW - CARD_PAD - (shown.length * BAR_SLOT - BAR_GAP) * k;
  const iconsBesideBars = shown.length > 0 && spare >= 32 + BAR_GAP * k; // stacked: one button wide
  // next to the name only if the name keeps ~110px, otherwise under the stop details
  const iconsBesideTitle = !iconsBesideBars && tileW - CARD_PAD - ICONS_W - 8 >= 110;
  const titleW = iconsBesideTitle ? tileW - ICONS_W - 8 : tileW;
  const icons = (
    <View style={[iconsBesideBars ? { alignSelf: 'flex-end', marginLeft: 'auto' } : s.row, { gap: 6 }]}>
      {saved && services.length > 0 && (
        <IconBtn active={picking} label={picking ? 'Done choosing buses' : 'Choose which buses to show'}
          onPress={() => setPicking(!picking)}>
          <PencilSimple size={15} weight="bold" color={picking ? C.paper : C.ink} />
        </IconBtn>
      )}
      <IconBtn label={saved ? `Remove ${stop.name} from saved` : `Save ${stop.name}`} onPress={onToggleStop}>
        <BookmarkSimple size={15} weight={saved ? 'fill' : 'bold'} color={C.ink} />
      </IconBtn>
    </View>
  );
  return (
    <View style={[s.card, { backgroundColor: color, width: tileW }]}>
      <View style={[s.row, { alignItems: 'flex-start', gap: 8 }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.cardTitle, { fontSize: titleSize(stop.name, titleW, k), lineHeight: titleSize(stop.name, titleW, k) + 4 }]}
            numberOfLines={2}>{stop.name}</Text>
          <Text style={s.caption}>{code} · {stop.road}</Text>
        </View>
        {iconsBesideTitle && icons}
      </View>
      {!iconsBesideBars && !iconsBesideTitle && icons}
      {raw === undefined && <View style={[s.skeleton, { width: BAR_W * k, height: BAR_H * k }]} />}
      {raw === 'error' && <Text style={s.caption}>Can't reach bus times. Retrying every second.</Text>}
      {Array.isArray(raw) && !raw.length && <Text style={s.caption}>No buses right now.</Text>}
      {shown.length > 0 && (
        <View style={[s.bars, { gap: BAR_GAP * k }]}>
          {shown.map((svc) => <BusBar key={svc.no} service={svc} k={k} />)}
          {iconsBesideBars && icons}
        </View>
      )}
      {picking && saved && services.length > 0 && (
        <Text style={s.caption}>Tap buses to show only those</Text>
      )}
      {picking && saved && services.length > 0 && (
        <View style={s.chips}>
          {services.map((svc) => {
            const on = starred.includes(svc.no);
            return (
              <Btn key={svc.no} small color={on ? C.ink : C.paper} onPress={() => onToggleService(svc.no)}>
                <Text style={[s.label, on && { color: C.paper }]}>{svc.no}</Text>
              </Btn>
            );
          })}
        </View>
      )}
    </View>
  );
}

// Zoomed-out copy of the bento grid. Drag a tile onto another to move it there.
const MINI_GAP = 5; // smaller than GAP scaled down, so the preview never wraps earlier than the grid
function EditLayout({ saved, inner, widthOf, onClose, onReorder, onRemove }) {
  const [gridW, setGridW] = useState(0);
  const [dragCode, setDragCode] = useState(null);
  const [overCode, setOverCode] = useState(null);
  const pan = useRef(new Animated.ValueXY()).current;
  const tileRefs = useRef({});
  const rects = useRef({});
  const responders = useRef({});
  const live = useRef({});
  live.current = { saved, onReorder }; // responders are made once, so they read fresh values from here

  // Tile rects are measured fresh when a drag starts: onLayout on web only fires on resize,
  // so after a reorder of same-size tiles the stored positions would be stale.
  const measureAll = () => {
    for (const { code } of live.current.saved) {
      tileRefs.current[code]?.measureInWindow((x, y, w, h) => { rects.current[code] = { x, y, w, h }; });
    }
  };
  // tile under the finger, or the nearest one when the finger is in a gap
  const hit = (px, py) => {
    let best = null;
    let bestD = Infinity;
    for (const { code } of live.current.saved) {
      const r = rects.current[code];
      if (!r) continue;
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return code;
      const d = (r.x + r.w / 2 - px) ** 2 + (r.y + r.h / 2 - py) ** 2;
      if (d < bestD) { bestD = d; best = code; }
    }
    return best;
  };
  const end = () => { setDragCode(null); setOverCode(null); pan.setValue({ x: 0, y: 0 }); };
  const responderFor = (code) => (responders.current[code] ??= PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { measureAll(); pan.setValue({ x: 0, y: 0 }); setDragCode(code); },
    onPanResponderMove: (_, g) => {
      pan.setValue({ x: g.dx, y: g.dy });
      setOverCode(hit(g.moveX, g.moveY));
    },
    onPanResponderRelease: (_, g) => {
      const moved = Math.abs(g.dx) + Math.abs(g.dy) > 4;
      const to = moved && hit(g.moveX, g.moveY);
      end();
      if (to && to !== code) live.current.onReorder(code, to);
    },
    onPanResponderTerminate: end,
  }));

  const scale = (gridW - 8) / inner; // 8 = miniGrid padding
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close edit layout" />
      <View style={s.sheet}>
        <Text style={s.displaySm}>Edit layout</Text>
        <Text style={s.caption}>Drag a tile to move it.</Text>
        <View style={s.miniGrid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
          {gridW > 0 && saved.map((st, i) => {
            const dragging = dragCode === st.code;
            const neighbour = (dir) => saved[i + dir] && onReorder(st.code, saved[i + dir].code);
            return (
              <Animated.View key={st.code} {...responderFor(st.code).panHandlers}
                ref={(el) => { tileRefs.current[st.code] = el; }}
                accessible accessibilityLabel={`${st.name}, tile ${i + 1} of ${saved.length}`}
                accessibilityActions={[{ name: 'decrement', label: 'Move earlier' }, { name: 'increment', label: 'Move later' }]}
                onAccessibilityAction={(e) => neighbour(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
                style={[s.miniTile, {
                  width: Math.floor(widthOf(st.code) * scale),
                  backgroundColor: CARD_COLORS[(i + 1) % CARD_COLORS.length], // same offset as the real tiles
                }, overCode === st.code && !dragging && s.miniTarget,
                dragging && { zIndex: 2, boxShadow: `6px 6px 0 ${C.ink}`, transform: [...pan.getTranslateTransform(), { scale: 1.04 }] }]}>
                <View style={[s.row, { alignItems: 'flex-start' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.miniTitle} numberOfLines={2}>{st.name}</Text>
                    <Text style={s.caption}>{st.code}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${st.name}`} hitSlop={8}
                    onPress={() => onRemove(st.code)} style={s.miniRemove}>
                    <Trash size={12} weight="bold" color={C.ink} />
                  </Pressable>
                </View>
              </Animated.View>
            );
          })}
        </View>
        <Btn color={C.ink} onPress={onClose}>
          <Text style={[s.label, { color: C.paper, textAlign: 'center' }]}>Done</Text>
        </Btn>
      </View>
    </Modal>
  );
}

function IconBtn({ children, label, disabled, active, onPress }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }} hitSlop={6}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.iconBtn, disabled && { opacity: 0.3 }, active && { backgroundColor: C.ink },
        pressed && { transform: [{ translateX: 2 }, { translateY: 2 }], boxShadow: 'none' }]}>
      {children}
    </Pressable>
  );
}

function Btn({ children, color = C.paper, small, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [
      small ? s.chip : s.btn, { backgroundColor: color },
      pressed && { transform: [{ translateX: 2 }, { translateY: 2 }], boxShadow: `1px 1px 0 ${C.ink}` },
    ]}>
      {children}
    </Pressable>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({ Shrikhand_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });
  const [saved, updateSaved] = useSaved();
  const stops = useStops();
  const [query, setQuery] = useState('');
  const [openCode, setOpenCode] = useState(null);
  const [editing, setEditing] = useState(false);
  const { width } = useWindowDimensions();
  const [gridW, setGridW] = useState(null); // measured, since window width includes the scrollbar

  const q = query.trim().toLowerCase();
  const results = q && stops
    ? stops.filter((st) => st.code.startsWith(q) || st.name.toLowerCase().includes(q)).slice(0, 20)
    : [];
  const savedCodes = saved.map((st) => st.code);
  const isSaved = (code) => saved.find((st) => st.code === code);
  const visibleCodes = openCode && !isSaved(openCode) ? [openCode, ...savedCodes] : savedCodes;
  const arrivals = useArrivals(visibleCodes);

  const removeStop = (code) => updateSaved((p) => p.filter((st) => st.code !== code));
  const toggleStop = (code, stop) =>
    isSaved(code) ? removeStop(code) : updateSaved((p) => [...p, { code, name: stop.name, road: stop.road, services: [] }]);
  const toggleService = (code, no) =>
    updateSaved((p) => p.map((st) => (st.code !== code ? st
      : { ...st, services: st.services.includes(no) ? st.services.filter((x) => x !== no) : [...st.services, no] })));
  const reorderStop = (fromCode, toCode) =>
    updateSaved((p) => {
      const to = p.findIndex((st) => st.code === toCode); // dragged tile takes the target's slot
      const [moved] = p.splice(p.findIndex((st) => st.code === fromCode), 1);
      p.splice(to, 0, moved);
      return p;
    });

  // Bento: each tile is exactly as wide as its bars (min 3 bars, so two fit side by side on a
  // 360px phone), packed left to right. Gaps at row ends are fine.
  const inner = Math.floor(gridW ?? Math.min(width, 1200) - 32);
  const barsOf = (code) => {
    const list = Array.isArray(arrivals[code]) ? arrivals[code] : [];
    const starred = isSaved(code)?.services;
    return starred?.length ? list.filter((x) => starred.includes(x.no)).length : list.length;
  };
  // bars grow with the screen: 1x on a 360px phone, up to 1.6x on wide screens
  const k = Math.min(1.6, Math.max(1, inner / 328));
  // as wide as the bars, but never under MIN_TILE so the name stays readable
  const widthOf = (code) =>
    Math.min(inner, Math.max(MIN_TILE * k, (barsOf(code) * BAR_SLOT - BAR_GAP) * k + CARD_PAD));

  if (!fontsLoaded) return <View style={s.screen} />;

  const card = (code, stop, i) => (
    <StopCard key={code} code={code} stop={stop} color={CARD_COLORS[i % CARD_COLORS.length]}
      services={arrivals[code]} saved={isSaved(code)} tileW={widthOf(code)} k={k}
      onToggleStop={() => toggleStop(code, stop)} onToggleService={(no) => toggleService(code, no)} />
  );
  const openStop = openCode && !isSaved(openCode) && stops?.find((st) => st.code === openCode);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.display}>Bus When?</Text>
      <Text style={s.caption}>Live arrivals, updated every second ✱</Text>

      <Text style={s.label} nativeID="searchLabel">Find a stop</Text>
      <View style={s.search}>
        <MagnifyingGlass size={20} weight="bold" color={C.ink} />
        <TextInput style={s.searchInput} value={query} onChangeText={setQuery} accessibilityLabelledBy="searchLabel"
          placeholder="Code or name, e.g. 09047" placeholderTextColor={C.grey} />
      </View>
      {stops === null && q !== '' && <Text style={s.caption}>Loading stops...</Text>}
      {stops?.length === 0 && <Text style={s.caption}>Couldn't load the stop list. Check your connection and reopen the app.</Text>}
      {stops?.length > 0 && q !== '' && !results.length && <Text style={s.caption}>No stops match "{query}".</Text>}
      {results.map((st) => (
        <Btn key={st.code} onPress={() => { setOpenCode(st.code); setQuery(''); }}>
          <Text style={s.label}>{st.name}</Text>
          <Text style={s.caption}>{st.code} · {st.road}</Text>
        </Btn>
      ))}

      {openStop && <View style={s.bento}>{card(openStop.code, openStop, 0)}</View>}
      {saved.length > 1 && (
        <View style={[s.row, { justifyContent: 'space-between', marginTop: 8 }]}>
          <Text style={s.cardTitle}>Saved stops</Text>
          <Btn small color={C.butter} onPress={() => setEditing(true)}>
            <Text style={s.label}>Edit layout</Text>
          </Btn>
        </View>
      )}
      <View style={s.bento} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
        {saved.map((st, i) => card(st.code, st, i + 1))}
      </View>
      {editing && (
        <EditLayout saved={saved} inner={inner} widthOf={widthOf}
          onClose={() => setEditing(false)} onReorder={reorderStop} onRemove={removeStop} />
      )}
      {!savedCodes.length && !openStop && !q && (
        <Text style={[s.caption, { marginTop: 24 }]}>Search a stop and tap the bookmark to keep it here. Saved stops live only on this phone.</Text>
      )}
    </ScrollView>
  );
}

const outline = { borderWidth: 2.5, borderColor: C.ink };
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.violet },
  content: { padding: 16, gap: GAP, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  bento: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, alignItems: 'flex-start' },
  displaySm: { fontFamily: 'Shrikhand_400Regular', fontSize: 28, lineHeight: 34, color: C.ink },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,17,17,0.45)' },
  sheet: {
    ...outline, position: 'absolute', left: 16, right: 16, bottom: 16, maxWidth: 640, marginHorizontal: 'auto',
    backgroundColor: C.paper, borderRadius: 28, padding: 20, gap: 12, boxShadow: `4px 4px 0 ${C.ink}`,
  },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: MINI_GAP, padding: 4, alignItems: 'flex-start' },
  miniTile: {
    borderWidth: 2, borderColor: C.ink, borderRadius: 16, padding: 8, gap: 6, minHeight: 84,
    boxShadow: `2px 2px 0 ${C.ink}`, cursor: 'grab', userSelect: 'none', touchAction: 'none',
  },
  miniTarget: { borderStyle: 'dashed', opacity: 0.55 },
  miniTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, lineHeight: 14, color: C.ink },
  miniRemove: {
    borderWidth: 1.5, borderColor: C.ink, borderRadius: 999, width: 22, height: 22,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper,
  },
  iconBtn: {
    ...outline, width: 32, height: 32, borderRadius: 999, backgroundColor: C.paper,
    alignItems: 'center', justifyContent: 'center', boxShadow: `2px 2px 0 ${C.ink}`,
  },
  display: { fontFamily: 'Shrikhand_400Regular', fontSize: 44, lineHeight: 52, color: C.ink, marginTop: 16 },
  cardTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 17, lineHeight: 21, color: C.ink },
  label: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.ink },
  caption: { fontFamily: 'SpaceGrotesk_500Medium', fontSize: 12, color: C.ink },
  search: {
    ...outline, borderRadius: 999, backgroundColor: C.paper, paddingHorizontal: 18, flexDirection: 'row',
    alignItems: 'center', gap: 10, boxShadow: `4px 4px 0 ${C.ink}`,
  },
  searchInput: { flex: 1, paddingVertical: 14, fontFamily: 'SpaceGrotesk_500Medium', fontSize: 16, color: C.ink, outlineStyle: 'none' },
  skeleton: { height: BAR_H, width: BAR_W, borderRadius: 999, borderWidth: 2.5, borderColor: C.ink, borderStyle: 'dashed', opacity: 0.4 },
  btn: { ...outline, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 12, boxShadow: `4px 4px 0 ${C.ink}` },
  chip: { ...outline, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, boxShadow: `2px 2px 0 ${C.ink}` },
  card: { ...outline, borderRadius: 20, padding: 10, gap: 10, boxShadow: `4px 4px 0 ${C.ink}` },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bars: { flexDirection: 'row', flexWrap: 'wrap', gap: BAR_GAP, paddingVertical: 4 },
  barCol: { alignItems: 'center', gap: 4, width: BAR_W },
  bar: { ...outline, width: BAR_W, height: BAR_H, borderRadius: 999, backgroundColor: C.paper, overflow: 'hidden' },
  fill: {
    // full border (not just top) so the curve keeps an even line; the sides hide under the pill's clip
    position: 'absolute', bottom: 0, left: -2.5, right: -2.5, borderWidth: 2.5, borderBottomWidth: 0, borderColor: C.ink,
    borderTopLeftRadius: 999, borderTopRightRadius: 999, alignItems: 'center', paddingTop: 7,
  },
  barNo: { fontFamily: 'Shrikhand_400Regular', fontSize: 16, color: C.ink, textAlign: 'center', width: BAR_W + BAR_GAP },
  etaText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, lineHeight: 12, color: C.ink, textAlign: 'center' },
  etaUnit: { fontFamily: 'SpaceGrotesk_500Medium', fontSize: 6.3, lineHeight: 7 },
});
