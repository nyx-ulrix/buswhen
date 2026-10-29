import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, Shrikhand_400Regular } from '@expo-google-fonts/shrikhand';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { ArrowDown, ArrowUp, Bus, MagnifyingGlass, PencilSimple, Trash } from 'phosphor-react-native';

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
const BAR_SLOT = 70; // bar column width + gap between bars

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
const LABEL_ROOM = 22;
function fillHeights(mins) {
  const out = [null, null, null];
  let floor = 10; // lowest fill is at least 32px, enough for a full dome
  for (let i = 2; i >= 0; i--) {
    if (mins[i] == null) continue;
    const raw = (1 - mins[i] / BAR_WINDOW_MIN) * BAR_H;
    out[i] = Math.min(BAR_H, Math.max(raw, floor + LABEL_ROOM));
    floor = out[i];
  }
  return out;
}

// One pill per service: the 3 upcoming buses as stacked fills, nearest = tallest, drawn first.
function BusBar({ service }) {
  const buses = [service.next, service.next2, service.next3];
  const mins = buses.map(minsUntil);
  return (
    <View style={s.barCol} accessible
      accessibilityLabel={`Bus ${service.no}: ${mins.filter((m) => m != null).map((m) => (m < 1 ? 'arriving' : `${Math.floor(m)} min`)).join(', ')}`}>
      <View style={s.bar}>
        {fillHeights(mins).map((h, i) => {
          if (h == null) return null;
          const m = mins[i];
          const fillView = (
            <View style={[s.fill, { height: h, backgroundColor: BUS_COLORS[i] }]}>
              {m < 1 ? <Bus size={14} weight="bold" color={C.ink} /> : <Text style={s.etaText}>{Math.floor(m)}m</Text>}
            </View>
          );
          return i === 0
            ? <Flash key={i} on={m < 1}>{fillView}</Flash>
            : <View key={i} style={StyleSheet.absoluteFill}>{fillView}</View>;
        })}
      </View>
      <Text style={s.barNo}>{service.no}</Text>
    </View>
  );
}

function StopCard({ code, stop, services: raw, color, saved, style, onToggleStop, onToggleService }) {
  const services = Array.isArray(raw) ? raw : [];
  const starred = saved?.services || [];
  const shown = starred.length ? services.filter((x) => starred.includes(x.no)) : services;
  const [picking, setPicking] = useState(false);
  return (
    <View style={[s.card, { backgroundColor: color }, style]}>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        <View style={{ flex: 1, minWidth: 110 }}>
          <Text style={s.cardTitle}>{stop.name}</Text>
          <Text style={s.caption}>{code} · {stop.road}</Text>
        </View>
        <View style={s.row}>
          {saved && services.length > 0 && (
            <IconBtn label={picking ? 'Done choosing buses' : 'Choose which buses to show'} onPress={() => setPicking(!picking)}>
              <PencilSimple size={18} weight="bold" color={C.ink} />
            </IconBtn>
          )}
          <Btn small color={saved ? C.ink : C.paper} onPress={onToggleStop}>
            <Text style={[s.label, saved && { color: C.paper }]}>{saved ? 'Saved' : 'Save'}</Text>
          </Btn>
        </View>
      </View>
      {raw === undefined && <View style={s.skeleton} />}
      {raw === 'error' && <Text style={s.caption}>Can't reach bus times. Retrying every second.</Text>}
      {Array.isArray(raw) && !raw.length && <Text style={s.caption}>No buses right now.</Text>}
      {shown.length > 0 && (
        <View style={s.bars}>{shown.map((svc) => <BusBar key={svc.no} service={svc} />)}</View>
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

function EditLayout({ saved, onClose, onMove, onRemove }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close edit layout" />
      <View style={s.sheet}>
        <Text style={s.displaySm}>Edit layout</Text>
        <Text style={s.caption}>Tiles show in this order, left to right.</Text>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10, padding: 4 }}>
          {saved.map((st, i) => (
            <View key={st.code} style={[s.editRow, { backgroundColor: CARD_COLORS[i % CARD_COLORS.length] }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.label} numberOfLines={1}>{st.name}</Text>
                <Text style={s.caption}>{st.code}</Text>
              </View>
              <IconBtn label={`Move ${st.name} up`} disabled={i === 0} onPress={() => onMove(i, -1)}>
                <ArrowUp size={18} weight="bold" color={C.ink} />
              </IconBtn>
              <IconBtn label={`Move ${st.name} down`} disabled={i === saved.length - 1} onPress={() => onMove(i, 1)}>
                <ArrowDown size={18} weight="bold" color={C.ink} />
              </IconBtn>
              <IconBtn label={`Remove ${st.name}`} onPress={() => onRemove(st.code)}>
                <Trash size={18} weight="bold" color={C.ink} />
              </IconBtn>
            </View>
          ))}
        </ScrollView>
        <Btn color={C.ink} onPress={onClose}>
          <Text style={[s.label, { color: C.paper, textAlign: 'center' }]}>Done</Text>
        </Btn>
      </View>
    </Modal>
  );
}

function IconBtn({ children, label, disabled, onPress }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.iconBtn, disabled && { opacity: 0.3 },
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
  const moveStop = (i, dir) =>
    updateSaved((p) => {
      [p[i], p[i + dir]] = [p[i + dir], p[i]];
      return p;
    });

  // Bento: column count from screen width, each tile spans enough columns for its bars.
  const inner = Math.floor(gridW ?? Math.min(width, 1200) - 32);
  const cols = inner >= 1000 ? 4 : inner >= 640 ? 3 : 2;
  const colW = (inner - GAP * (cols - 1)) / cols;
  const barsPerCol = Math.max(1, Math.floor((colW - 36 + GAP) / BAR_SLOT));
  const tileStyle = (code, starred) => {
    const list = Array.isArray(arrivals[code]) ? arrivals[code] : [];
    const n = starred?.length ? list.filter((x) => starred.includes(x.no)).length : list.length;
    const span = Math.min(cols, Math.max(1, Math.ceil(n / barsPerCol)));
    // flexGrow lets the last tile in a row stretch, so rows never leave holes
    return { flexBasis: span * colW + (span - 1) * GAP, flexGrow: 1 };
  };

  if (!fontsLoaded) return <View style={s.screen} />;

  const card = (code, stop, i) => (
    <StopCard key={code} code={code} stop={stop} color={CARD_COLORS[i % CARD_COLORS.length]}
      services={arrivals[code]} saved={isSaved(code)} style={tileStyle(code, isSaved(code)?.services)}
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
      {editing && <EditLayout saved={saved} onClose={() => setEditing(false)} onMove={moveStop} onRemove={removeStop} />}
      {!savedCodes.length && !openStop && !q && (
        <Text style={[s.caption, { marginTop: 24 }]}>Search a stop and tap Save to keep it here. Saved stops live only on this phone.</Text>
      )}
    </ScrollView>
  );
}

const outline = { borderWidth: 2.5, borderColor: C.ink };
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.violet },
  content: { padding: 16, gap: GAP, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  bento: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, alignItems: 'stretch' },
  displaySm: { fontFamily: 'Shrikhand_400Regular', fontSize: 28, lineHeight: 34, color: C.ink },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,17,17,0.45)' },
  sheet: {
    ...outline, position: 'absolute', left: 16, right: 16, bottom: 16, maxWidth: 520, marginHorizontal: 'auto',
    backgroundColor: C.paper, borderRadius: 28, padding: 20, gap: 12, boxShadow: `4px 4px 0 ${C.ink}`,
  },
  editRow: {
    ...outline, borderRadius: 20, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
    boxShadow: `2px 2px 0 ${C.ink}`,
  },
  iconBtn: {
    ...outline, width: 40, height: 40, borderRadius: 999, backgroundColor: C.paper,
    alignItems: 'center', justifyContent: 'center', boxShadow: `2px 2px 0 ${C.ink}`,
  },
  display: { fontFamily: 'Shrikhand_400Regular', fontSize: 44, lineHeight: 52, color: C.ink, marginTop: 16 },
  cardTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, color: C.ink },
  label: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.ink },
  caption: { fontFamily: 'SpaceGrotesk_500Medium', fontSize: 12, color: C.ink },
  search: {
    ...outline, borderRadius: 999, backgroundColor: C.paper, paddingHorizontal: 18, flexDirection: 'row',
    alignItems: 'center', gap: 10, boxShadow: `4px 4px 0 ${C.ink}`,
  },
  searchInput: { flex: 1, paddingVertical: 14, fontFamily: 'SpaceGrotesk_500Medium', fontSize: 16, color: C.ink, outlineStyle: 'none' },
  skeleton: { height: 170, width: 52, borderRadius: 999, borderWidth: 2.5, borderColor: C.ink, borderStyle: 'dashed', opacity: 0.4 },
  btn: { ...outline, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 12, boxShadow: `4px 4px 0 ${C.ink}` },
  chip: { ...outline, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, boxShadow: `2px 2px 0 ${C.ink}` },
  card: { ...outline, borderRadius: 28, padding: 18, gap: 12, boxShadow: `4px 4px 0 ${C.ink}` },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bars: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingVertical: 4 },
  barCol: { alignItems: 'center', gap: 4, width: 58 },
  bar: { ...outline, width: 52, height: BAR_H, borderRadius: 999, backgroundColor: C.paper, overflow: 'hidden' },
  fill: {
    // full border (not just top) so the curve keeps an even line; the sides hide under the pill's clip
    position: 'absolute', bottom: 0, left: -2.5, right: -2.5, borderWidth: 2.5, borderBottomWidth: 0, borderColor: C.ink,
    borderTopLeftRadius: 999, borderTopRightRadius: 999, alignItems: 'center', paddingTop: 3,
  },
  barNo: { fontFamily: 'Shrikhand_400Regular', fontSize: 20, color: C.ink },
  etaText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.ink },
});
