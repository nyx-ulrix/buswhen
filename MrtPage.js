import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { ArrowRight, MagnifyingGlassMinus, MagnifyingGlassPlus, X } from 'phosphor-react-native';
import { Btn, C, CARD_COLORS, IconBtn, base, outline } from './ui';
import { EDGES, LINES, STATIONS } from './mrt';
import { TRANSFER_MIN, fareCents, findRoute } from './route';

const lineColour = (id) => LINES[id === 'CG' ? 'EW' : id]?.colour ?? C.grey;
const codeColour = (code) => {
  const p = code.replace(/[0-9]/g, '');
  return LINES[{ CG: 'EW', CE: 'CC' }[p] ?? p]?.colour ?? '#748477'; // LRT codes (BP, STC, PTC) in grey
};

function CodeChips({ codes, small }) {
  return (
    <View style={m.codes}>
      {codes.map((c) => (
        <View key={c} style={[m.code, small && m.codeSmall, { backgroundColor: codeColour(c) }]}>
          <Text style={[m.codeText, small && { fontSize: 9 }]}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

const NAMES = Object.keys(STATIONS).sort();
// One pill for the whole journey: [from] → [to]. Tap a station to change it; the arrow swaps them.
function RouteBar({ from, to, setFrom, setTo }) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // 'from' | 'to' while changing a chosen station
  const query = q.trim().toLowerCase();
  const hits = query
    ? NAMES.filter((n) => n.toLowerCase().includes(query)
      || STATIONS[n].codes.some((c) => c.toLowerCase().startsWith(query))).slice(0, 6)
    : [];
  const target = editing ?? (!from ? 'from' : 'to');
  const choose = (n) => {
    (target === 'from' ? setFrom : setTo)(n);
    setQ('');
    setEditing(null);
  };
  const slot = (which) => {
    const value = which === 'from' ? from : to;
    if (value && editing !== which) {
      return (
        <Pressable style={m.slot} accessibilityRole="button" accessibilityLabel={`Change ${which === 'from' ? 'start' : 'end'}, ${value}`}
          onPress={() => { setEditing(which); setQ(''); }}>
          <Text style={base.label} numberOfLines={1}>{value}</Text>
          <CodeChips codes={STATIONS[value].codes} small />
        </Pressable>
      );
    }
    return (
      <View style={m.slot}>
        <TextInput style={m.slotInput} value={target === which ? q : ''} autoFocus={editing === which}
          onChangeText={(t) => { setEditing(which); setQ(t); }} onFocus={() => setEditing(which)}
          accessibilityLabel={which === 'from' ? 'Start station' : 'End station'}
          placeholder={which === 'from' ? 'Start station' : 'End station'} placeholderTextColor={C.grey} />
      </View>
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={m.routeBar}>
        {slot('from')}
        <IconBtn size={30} label="Swap direction" disabled={!from && !to}
          onPress={() => { setFrom(to); setTo(from); setEditing(null); }}>
          <ArrowRight size={15} weight="bold" color={C.ink} />
        </IconBtn>
        {slot('to')}
        {(from || to) && (
          <IconBtn size={28} label="Clear stations" onPress={() => { setFrom(null); setTo(null); setQ(''); setEditing(null); }}>
            <X size={13} weight="bold" color={C.ink} />
          </IconBtn>
        )}
      </View>
      {query !== '' && !hits.length && <Text style={base.caption}>No MRT station matches "{q}".</Text>}
      {hits.map((n) => (
        <Btn key={n} small label={`Choose ${n}`} onPress={() => choose(n)}>
          <View style={[base.row, { gap: 8 }]}>
            <Text style={[base.label, { flex: 1 }]}>{n}</Text>
            <CodeChips codes={STATIONS[n].codes} small />
          </View>
        </Btn>
      ))}
    </View>
  );
}

function Stat({ color, big, small }) {
  return (
    <View style={[base.card, m.stat, { backgroundColor: color }]}>
      <Text style={m.statBig} numberOfLines={1}>{big}</Text>
      <Text style={base.caption}>{small}</Text>
    </View>
  );
}

// map frame in map units, with room above and to the right for the slanted names
const X0 = 40;
const Y0 = -50;
const VIEW_W = 1860;
const VIEW_H = 1110;
const LABELS_FROM = 1100; // map width (px) from which every station name is readable
const DOT_R = 11; // one dot size for every station, the interchange size
// Each name goes on the first side (right, below, above, left) that no line leaves the station from.
const NEIGHBOURS = {};
for (const [a, b] of EDGES) { (NEIGHBOURS[a] ??= []).push(b); (NEIGHBOURS[b] ??= []).push(a); }
const SIDES = [['right', 1, 0], ['below', 0, 1], ['above', 0, -1], ['left', -1, 0]];
const LABEL_SIDE = Object.fromEntries(NAMES.map((n) => {
  const st = STATIONS[n];
  const dirs = NEIGHBOURS[n].map((o) => {
    const dx = STATIONS[o].x - st.x;
    const dy = STATIONS[o].y - st.y;
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  });
  const free = SIDES.find(([, sx, sy]) => dirs.every(([dx, dy]) => dx * sx + dy * sy < 0.7)); // nothing within ~45 deg
  return [n, (free ?? SIDES[0])[0]];
}));
function labelAt(side, st, gap, size) {
  if (side === 'below') return { x: st.x, y: st.y + gap + size * 0.75, textAnchor: 'middle' };
  if (side === 'above') return { x: st.x, y: st.y - gap, textAnchor: 'middle' };
  if (side === 'left') return { x: st.x - gap, y: st.y + size * 0.35, textAnchor: 'end' };
  return { x: st.x + gap, y: st.y + size * 0.35, textAnchor: 'start' };
}

function SystemMap({ route, from, to, onPick }) {
  const hRef = useRef(null);
  const vRef = useRef(null);
  const [boxW, setBoxW] = useState(0);
  // zoom steps are map widths in px; opens at the first one where all names are readable
  const widths = [...new Set([boxW, LABELS_FROM, 1600, 2400].filter((w) => w >= boxW))];
  const [zi, setZi] = useState(null);
  const z = zi ?? Math.max(0, widths.findIndex((w) => w >= LABELS_FROM));
  const mapW = widths[Math.min(z, widths.length - 1)] || 0;
  const pans = mapW > boxW + 1;
  const allLabels = mapW >= LABELS_FROM;
  const perUnit = mapW / VIEW_W; // screen px per map unit
  const label = (px) => px / perUnit;
  // keyed by line too: some station pairs are linked by two lines (Raffles Place - City Hall)
  const hopKey = (a, b, line) => `${[a, b].sort().join('|')}|${line}`;
  const onRoute = useMemo(() => new Set(route?.hops.map((h) => hopKey(h.from, h.to, h.line))), [route]);
  const routeStations = new Set(route?.stations);
  const fade = route ? 0.25 : 1;
  // when zoomed in, open on the route (or the city centre) instead of the far west
  useEffect(() => {
    if (!pans) return;
    const pts = [from, to].filter(Boolean).map((n) => STATIONS[n]);
    const c = pts.length ? pts : [STATIONS['City Hall']];
    const cx = c.reduce((t, p) => t + p.x, 0) / c.length;
    const cy = c.reduce((t, p) => t + p.y, 0) / c.length;
    hRef.current?.scrollTo({ x: Math.max(0, (cx - X0) * perUnit - boxW / 2), animated: !!pts.length });
    vRef.current?.scrollTo({ y: Math.max(0, (cy - Y0) * perUnit - 260), animated: !!pts.length });
  }, [mapW, from, to]);
  return (
    <View style={[base.card, { backgroundColor: C.paper, padding: 0, overflow: 'hidden' }]}
      onLayout={(e) => setBoxW(Math.floor(e.nativeEvent.layout.width - 5))}>
      <ScrollView ref={hRef} horizontal scrollEnabled={pans} style={{ maxHeight: pans ? 520 : undefined }}>
        <ScrollView ref={vRef} nestedScrollEnabled scrollEnabled={pans}>
          {mapW > 0 && (
            <Svg width={mapW} height={(mapW * VIEW_H) / VIEW_W} viewBox={`${X0} ${Y0} ${VIEW_W} ${VIEW_H}`}>
              {/* black casing under every line, then the colour on top, like the cards' outlines */}
              <G opacity={fade}>
                {EDGES.map((e, i) => (
                  <Path key={i} d={e[5]} stroke={C.ink} strokeWidth={22} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {EDGES.map((e, i) => (
                  <Path key={`c${i}`} d={e[5]} stroke={lineColour(e[2])} strokeWidth={14} fill="none" strokeLinecap="round"
                    strokeLinejoin="round" />
                ))}
              </G>
              {route && (
                <G>
                  {EDGES.filter((e) => onRoute.has(hopKey(e[0], e[1], e[2]))).map((e) => (
                    <G key={`${e[0]}|${e[1]}|${e[2]}`}>
                      <Path d={e[5]} stroke={C.ink} strokeWidth={26} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      <Path d={e[5]} stroke={lineColour(e[2])} strokeWidth={17} fill="none" strokeLinecap="round"
                        strokeLinejoin="round" />
                    </G>
                  ))}
                </G>
              )}
              {NAMES.map((n) => {
                const st = STATIONS[n];
                const inter = st.codes.length > 1;
                const lit = !route || routeStations.has(n);
                const end = n === from || n === to;
                const named = end || allLabels || (route && lit && inter);
                const size = end ? Math.max(15, label(13)) : 15;
                return (
                  <G key={n} opacity={lit ? 1 : 0.35}>
                    {/* every dot the same size; the start and end stand out by colour */}
                    <Circle cx={st.x} cy={st.y} r={DOT_R} fill={end ? C.butter : C.paper} stroke={C.ink} strokeWidth={4} />
                    {named && (
                      <SvgText {...labelAt(LABEL_SIDE[n], st, DOT_R + 6, size)} fontSize={size}
                        fontFamily="SpaceGrotesk_700Bold" fill={C.ink}
                        stroke={C.paper} strokeWidth={size / 4} paintOrder="stroke">{n}</SvgText>
                    )}
                    {/* bigger invisible target so stations are easy to tap at any zoom */}
                    <Circle cx={st.x} cy={st.y} r={Math.max(12, label(14))} fill="transparent" onPress={() => onPick(n)} />
                  </G>
                );
              })}
            </Svg>
          )}
        </ScrollView>
      </ScrollView>
      <View style={m.zoom}>
        <IconBtn label="Zoom in" disabled={z >= widths.length - 1} onPress={() => setZi(z + 1)}>
          <MagnifyingGlassPlus size={16} weight="bold" color={C.ink} />
        </IconBtn>
        <IconBtn label="Zoom out" disabled={z === 0} onPress={() => setZi(z - 1)}>
          <MagnifyingGlassMinus size={16} weight="bold" color={C.ink} />
        </IconBtn>
      </View>
    </View>
  );
}

export default function MrtPage() {
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const route = useMemo(() => findRoute(from, to), [from, to]);
  const pick = (n) => (from && !to && n !== from ? setTo(n) : !from ? setFrom(n) : setTo(n === from ? null : n));
  const fare = route && fareCents(route.km);
  const changes = route ? route.legs.length - 1 : 0;

  return (
    <>
      <SystemMap route={route} from={from} to={to} onPick={pick} />
      <RouteBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {!route && <Text style={base.caption}>Pick two stations, or tap them on the map above.</Text>}

      {route && (
        <>
          <View style={m.stats}>
            <Stat color={CARD_COLORS[0]} big={`${route.mins} min`} small={`${route.hops.length} stops`} />
            <Stat color={CARD_COLORS[1]} big={`S$${(fare / 100).toFixed(2)}`} small="Adult card fare, approx." />
            <Stat color={CARD_COLORS[2]} big={changes === 0 ? 'Direct' : changes}
              small={`${changes === 0 ? 'no changes' : `change${changes > 1 ? 's' : ''}`}, about ${route.km.toFixed(1)} km`} />
          </View>
          <View style={[base.card, { backgroundColor: C.paper, gap: 12 }]}>
            {route.legs.map((leg, i) => (
              <View key={i} style={{ gap: 6 }}>
                {i > 0 && <Text style={base.caption}>Change at {leg.from} (about {TRANSFER_MIN} min)</Text>}
                <View style={[base.row, { gap: 10, alignItems: 'flex-start' }]}>
                  <View style={[m.lineBar, { backgroundColor: lineColour(leg.line) }]} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={[m.linePill, { backgroundColor: lineColour(leg.line) }]}>
                      <Text style={m.linePillText}>{LINES[leg.line === 'CG' ? 'EW' : leg.line].name} line</Text>
                    </View>
                    <Text style={base.label}>{leg.from} → {leg.to}</Text>
                    <Text style={base.caption}>{leg.stops} stop{leg.stops > 1 ? 's' : ''} · {Math.round(leg.mins)} min</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={base.caption}>
        Times include about {TRANSFER_MIN} min per change but not waiting for the train. Fares are adult card fares from
        straight-line distances, so they can be a band or two under the real fare. MRT lines only, no LRT.
      </Text>
    </>
  );
}

const m = StyleSheet.create({
  routeBar: { ...base.search, paddingHorizontal: 14, paddingVertical: 8, gap: 8, borderRadius: 32 },
  slot: { flex: 1, minWidth: 0, gap: 3, minHeight: 40, justifyContent: 'center' },
  slotInput: { ...base.searchInput, paddingVertical: 8, fontSize: 15 },
  codes: { flexDirection: 'row', gap: 3 },
  code: { ...outline, borderWidth: 1.5, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  codeSmall: { paddingHorizontal: 4, paddingVertical: 0 },
  codeText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.paper },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 12 },
  statBig: { fontFamily: 'Shrikhand_400Regular', fontSize: 21, lineHeight: 30, color: C.ink },
  lineBar: { width: 10, alignSelf: 'stretch', borderRadius: 999, borderWidth: 2, borderColor: C.ink },
  linePill: { ...outline, borderWidth: 2, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  linePillText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.paper },
  zoom: { position: 'absolute', right: 10, top: 10, gap: 8 },
});
