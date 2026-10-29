import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, Shrikhand_400Regular } from '@expo-google-fonts/shrikhand';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { Bus, MagnifyingGlass } from 'phosphor-react-native';

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

// saved: { [stopCode]: { name, road, services: [no] } }, empty services = show all
function useSaved() {
  const [saved, setSaved] = useState({});
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((v) => v && setSaved(JSON.parse(v))).catch(() => {});
  }, []);
  const update = (fn) =>
    setSaved((prev) => {
      const next = fn({ ...prev });
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

// One pill per service: the 3 upcoming buses as stacked fills, nearest = tallest, drawn first.
function BusBar({ service }) {
  const buses = [service.next, service.next2, service.next3];
  const mins = buses.map(minsUntil);
  return (
    <View style={s.barCol} accessible
      accessibilityLabel={`Bus ${service.no}: ${mins.filter((m) => m != null).map((m) => (m < 1 ? 'arriving' : `${Math.floor(m)} min`)).join(', ')}`}>
      <View style={s.bar}>
        {mins.map((m, i) => {
          if (m == null) return null;
          const fill = Math.max(0.06, 1 - m / BAR_WINDOW_MIN);
          const fillView = <View style={[s.fill, { height: `${fill * 100}%`, backgroundColor: BUS_COLORS[i] }]} />;
          return i === 0
            ? <Flash key={i} on={m < 1}>{fillView}</Flash>
            : <View key={i} style={StyleSheet.absoluteFill}>{fillView}</View>;
        })}
      </View>
      <Text style={s.barNo}>{service.no}</Text>
      {mins.map((m, i) => m != null && (
        <View key={i} style={[s.eta, { backgroundColor: BUS_COLORS[i] }]}>
          {m < 1 ? <Bus size={14} weight="bold" color={C.ink} /> : <Text style={s.etaText}>{Math.floor(m)}m</Text>}
        </View>
      ))}
    </View>
  );
}

function StopCard({ code, stop, services: raw, color, saved, onToggleStop, onToggleService }) {
  const services = Array.isArray(raw) ? raw : [];
  const starred = saved?.services || [];
  const shown = starred.length ? services.filter((x) => starred.includes(x.no)) : services;
  return (
    <View style={[s.card, { backgroundColor: color }]}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>{stop.name}</Text>
          <Text style={s.caption}>{code} · {stop.road}</Text>
        </View>
        <Btn small color={saved ? C.ink : C.paper} onPress={onToggleStop}>
          <Text style={[s.label, saved && { color: C.paper }]}>{saved ? 'Saved' : 'Save'}</Text>
        </Btn>
      </View>
      {raw === undefined && <View style={s.skeleton} />}
      {raw === 'error' && <Text style={s.caption}>Can't reach bus times. Retrying every second.</Text>}
      {Array.isArray(raw) && !raw.length && <Text style={s.caption}>No buses right now.</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.bars}>
        {shown.map((svc) => <BusBar key={svc.no} service={svc} />)}
      </ScrollView>
      {saved && services.length > 0 && (
        <Text style={s.caption}>Tap buses to show only those</Text>
      )}
      {saved && services.length > 0 && (
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

  const q = query.trim().toLowerCase();
  const results = q && stops
    ? stops.filter((st) => st.code.startsWith(q) || st.name.toLowerCase().includes(q)).slice(0, 20)
    : [];
  const savedCodes = Object.keys(saved);
  const visibleCodes = openCode && !saved[openCode] ? [openCode, ...savedCodes] : savedCodes;
  const arrivals = useArrivals(visibleCodes);

  const toggleStop = (code, stop) =>
    updateSaved((p) => {
      if (p[code]) delete p[code];
      else p[code] = { name: stop.name, road: stop.road, services: [] };
      return p;
    });
  const toggleService = (code, no) =>
    updateSaved((p) => {
      const list = p[code].services;
      p[code] = { ...p[code], services: list.includes(no) ? list.filter((x) => x !== no) : [...list, no] };
      return p;
    });

  if (!fontsLoaded) return <View style={s.screen} />;

  const card = (code, stop, i) => (
    <StopCard key={code} code={code} stop={stop} color={CARD_COLORS[i % CARD_COLORS.length]}
      services={arrivals[code]} saved={saved[code]}
      onToggleStop={() => toggleStop(code, stop)} onToggleService={(no) => toggleService(code, no)} />
  );
  const openStop = openCode && !saved[openCode] && stops?.find((st) => st.code === openCode);

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

      {openStop && card(openStop.code, openStop, 0)}
      {savedCodes.map((code, i) => card(code, saved[code], i + 1))}
      {!savedCodes.length && !openStop && !q && (
        <Text style={[s.caption, { marginTop: 24 }]}>Search a stop and tap Save to keep it here. Saved stops live only on this phone.</Text>
      )}
    </ScrollView>
  );
}

const outline = { borderWidth: 2.5, borderColor: C.ink };
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.violet },
  content: { padding: 16, gap: 12, maxWidth: 560, width: '100%', alignSelf: 'center' },
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
  bars: { gap: 12, paddingVertical: 4, paddingRight: 4 },
  barCol: { alignItems: 'center', gap: 4, width: 58 },
  bar: { ...outline, width: 52, height: 170, borderRadius: 999, backgroundColor: C.paper, overflow: 'hidden' },
  fill: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopWidth: 2.5, borderColor: C.ink, borderRadius: 999 },
  barNo: { fontFamily: 'Shrikhand_400Regular', fontSize: 20, color: C.ink },
  eta: { ...outline, borderWidth: 2, borderRadius: 999, paddingHorizontal: 8, minWidth: 44, alignItems: 'center' },
  etaText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.ink },
});
