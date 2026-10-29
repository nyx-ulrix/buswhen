"""Builds mrt.js (stations, edges, map positions, distances) for the MRT page.

Sources:
- data/mrt_travel_times.csv: adjacent-station travel times (from DataStructureAssignment2)
- station coordinates from cheeaun/sgraildata (LTA open data), only used to measure distances for fares
- POS below: schematic map positions, laid out after LTA's system map

usage: python scripts/build_mrt.py
"""
import csv, json, math, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SGRAIL = 'https://raw.githubusercontent.com/cheeaun/sgraildata/master/data/v1/sg-rail.geojson'
NOT_OPEN = {'TE10', 'TE21', 'TE22A'}  # in the CSV but not open yet; joined across
LINES = {  # CSV line name -> (id, colour, label)
    'North-South Line (NSL)': ('NS', '#E22726', 'North-South'),
    'East-West Line (EWL)': ('EW', '#009645', 'East-West'),
    'Changi Airport Branch (CG)': ('CG', '#009645', 'East-West (Changi Airport)'),
    'North East Line (NEL)': ('NE', '#9900AA', 'North East'),
    'Circle Line (CCL)': ('CC', '#FA9E0D', 'Circle'),
    'Downtown Line (DTL)': ('DT', '#005EC4', 'Downtown'),
    'Thomson-East Coast Line (TEL)': ('TE', '#9D5B25', 'Thomson-East Coast'),
}

# Schematic positions (x, y) on a 1700 x 1400 canvas.
POS = {
    'NS1': (297, 917), 'NS2': (297, 816), 'NS3': (297, 739), 'NS4': (297, 651), 'NS5': (297, 559),
    'NS7': (297, 472), 'NS8': (343, 373), 'NS9': (448, 352), 'NS10': (537, 352), 'NS11': (606, 352),
    'NS12': (676, 352), 'NS13': (746, 375), 'NS14': (793, 420), 'NS15': (793, 472), 'NS16': (793, 525),
    'NS17': (793, 582), 'NS18': (793, 621), 'NS19': (793, 672), 'NS20': (763, 731), 'NS21': (720, 775),
    'NS22': (676, 851), 'NS23': (714, 905), 'NS24': (775, 970), 'NS25': (890, 1090), 'NS26': (890, 1140),
    'NS27': (900, 1217), 'NS28': (960, 1263),
    'EW33': (122, 587), 'EW32': (122, 633), 'EW31': (122, 679), 'EW30': (122, 725), 'EW29': (122, 770),
    'EW28': (122, 816), 'EW27': (122, 862), 'EW26': (176, 917), 'EW25': (234, 917), 'EW24': (297, 917),
    'EW23': (373, 917), 'EW22': (426, 917), 'EW21': (497, 917), 'EW20': (532, 951), 'EW19': (562, 981),
    'EW18': (601, 1017), 'EW17': (637, 1053), 'EW16': (676, 1090), 'EW15': (752, 1165), 'EW14': (890, 1140),
    'EW13': (890, 1090), 'EW12': (973, 1005), 'EW11': (1027, 965), 'EW10': (1064, 928), 'EW9': (1097, 892),
    'EW8': (1130, 848), 'EW7': (1193, 797), 'EW6': (1240, 748), 'EW5': (1320, 706), 'EW4': (1414, 706),
    'EW3': (1432, 677), 'EW2': (1432, 626), 'EW1': (1432, 585), 'CG1': (1493, 764), 'CG2': (1565, 764),
    'NE1': (687, 1225), 'NE3': (703, 1090), 'NE4': (737, 1048), 'NE5': (775, 1018), 'NE6': (803, 970),
    'NE7': (835, 866), 'NE8': (846, 815), 'NE9': (846, 768), 'NE10': (876, 718), 'NE11': (920, 672),
    'NE12': (958, 622), 'NE13': (1010, 583), 'NE14': (1044, 548), 'NE15': (1077, 516), 'NE16': (1099, 482),
    'NE17': (1177, 404), 'NE18': (1214, 376),
    'CC1': (830, 970), 'CC2': (910, 1017), 'CC3': (983, 1091), 'CC4': (1093, 1117), 'CC5': (1117, 1064),
    'CC6': (1137, 1015), 'CC7': (1148, 963), 'CC8': (1150, 911), 'CC9': (1157, 848), 'CC10': (1134, 774),
    'CC11': (1085, 716), 'CC12': (1040, 670), 'CC13': (985, 622), 'CC14': (892, 593), 'CC15': (806, 582),
    'CC16': (708, 602), 'CC17': (634, 632), 'CC19': (533, 723), 'CC20': (510, 790), 'CC21': (491, 845),
    'CC22': (470, 917), 'CC23': (487, 965), 'CC24': (497, 1016), 'CC25': (513, 1063), 'CC26': (536, 1103),
    'CC27': (570, 1145), 'CC28': (613, 1183), 'CC29': (660, 1225), 'CE1': (1025, 1181), 'CE2': (957, 1217),
    'DT1': (412, 525), 'DT2': (412, 554), 'DT3': (412, 580), 'DT4': (412, 605), 'DT5': (412, 632),
    'DT6': (412, 658), 'DT7': (412, 685), 'DT8': (465, 723), 'DT9': (561, 723), 'DT10': (636, 723),
    'DT11': (758, 775), 'DT12': (863, 866), 'DT13': (895, 913), 'DT14': (1000, 1005), 'DT15': (1065, 1117),
    'DT16': (997, 1181), 'DT17': (948, 1197), 'DT18': (853, 1142), 'DT19': (765, 1048), 'DT20': (747, 992),
    'DT21': (922, 976), 'DT22': (962, 937), 'DT23': (1015, 885), 'DT24': (1048, 848), 'DT25': (1085, 810),
    'DT26': (1107, 774), 'DT27': (1134, 734), 'DT28': (1200, 694), 'DT29': (1240, 658), 'DT30': (1306, 645),
    'DT31': (1373, 645), 'DT32': (1462, 645), 'DT33': (1507, 677), 'DT34': (1507, 712), 'DT35': (1520, 764),
    'DT37': (1482, 842),
    'TE1': (412, 300), 'TE2': (476, 352), 'TE3': (493, 386), 'TE4': (525, 419), 'TE5': (557, 452),
    'TE6': (589, 485), 'TE7': (620, 519), 'TE8': (650, 578), 'TE9': (662, 632), 'TE11': (663, 723),
    'TE12': (649, 770), 'TE13': (649, 811), 'TE14': (649, 851), 'TE15': (649, 901), 'TE16': (649, 949),
    'TE17': (730, 1090), 'TE18': (767, 1121), 'TE19': (848, 1199), 'TE20': (929, 1217), 'TE22': (1131, 1177),
    'TE23': (1212, 1096), 'TE24': (1245, 1064), 'TE25': (1276, 1033), 'TE26': (1308, 1001),
    'TE27': (1340, 969), 'TE28': (1372, 937), 'TE29': (1400, 909), 'TE30': (1430, 880), 'TE31': (1455, 842),
}
Y_SHIFT = 260  # the map's top margin, trimmed


RDP_TOLERANCE = 14  # bends smaller than this (map units) are hand-placement noise, not real corners
CORNER_R = 28  # rounded corner radius, like the system map's curves


def rdp(pts, tol):
    """Ramer-Douglas-Peucker: keep only the points that are real corners."""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    seg = math.hypot(x2 - x1, y2 - y1) or 1e-9
    dists = [abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / seg for x, y in pts[1:-1]]
    i = max(range(len(dists)), key=dists.__getitem__) + 1
    if dists[i - 1] <= tol:
        return [pts[0], pts[-1]]
    return rdp(pts[:i + 1], tol)[:-1] + rdp(pts[i:], tol)


def project(p, poly):
    """nearest point on a polyline, and its distance along it"""
    best, run = None, 0.0
    for (ax, ay), (bx, by) in zip(poly, poly[1:]):
        L = math.hypot(bx - ax, by - ay) or 1e-9
        t = max(0.0, min(1.0, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L ** 2))
        q = (ax + t * (bx - ax), ay + t * (by - ay))
        d = math.hypot(q[0] - p[0], q[1] - p[1])
        if best is None or d < best[0]:
            best = (d, q, run + t * L)
        run += L
    return best[1], best[2]


def rounded(poly, r=CORNER_R):
    """svg path through the polyline with circular-ish rounded corners"""
    poly = [p for i, p in enumerate(poly) if i == 0 or math.dist(p, poly[i - 1]) > 0.5]  # drop repeats
    f = lambda v: f'{v:.1f}'.rstrip('0').rstrip('.')
    d = f'M{f(poly[0][0])} {f(poly[0][1])}'
    for p, v, n in zip(poly, poly[1:], poly[2:]):
        lp, ln = math.dist(p, v), math.dist(v, n)
        rr = min(r, lp / 2, ln / 2)
        a = (v[0] + (p[0] - v[0]) * rr / lp, v[1] + (p[1] - v[1]) * rr / lp)
        b = (v[0] + (n[0] - v[0]) * rr / ln, v[1] + (n[1] - v[1]) * rr / ln)
        d += f'L{f(a[0])} {f(a[1])}Q{f(v[0])} {f(v[1])} {f(b[0])} {f(b[1])}'
    return d + f'L{f(poly[-1][0])} {f(poly[-1][1])}'


def smooth_lines(edges, codes, stations):
    """Straighten each line into runs between real corners and snap stations onto them.
    Updates station x/y in place; returns (line paths, {edge: path along the line})."""
    line_code = {}  # (station, line) -> that line's code at the station, for its map position
    for n, cs in codes.items():
        for c in cs:
            pre = c.rstrip('0123456789A')
            line_code[(n, {'CE': 'CC'}.get(pre, pre))] = c
    pos_on = lambda n, line: POS.get(line_code.get((n, line)) or line_code.get((n, 'EW' if line == 'CG' else line)),
                                     (stations[n]['x'], stations[n]['y'] + Y_SHIFT))

    per_line = {}
    for a, b, line, _ in edges:
        per_line.setdefault(line, []).append((a, b))
    line_paths, edge_paths, snapped = [], {}, {}
    for line, es in per_line.items():
        adj = {}
        for a, b in es:
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
        # maximal runs through stations with exactly two neighbours on this line
        used, chains = set(), []
        starts = [n for n in adj if len(adj[n]) != 2] or [next(iter(adj))]
        for s in starts:
            for nxt in adj[s]:
                if frozenset((s, nxt)) in used:
                    continue
                chain = [s, nxt]
                used.add(frozenset((s, nxt)))
                while len(adj[chain[-1]]) == 2 and chain[-1] != s:
                    step = next((x for x in adj[chain[-1]] if frozenset((chain[-1], x)) not in used), None)
                    if step is None:
                        break
                    used.add(frozenset((chain[-1], step)))
                    chain.append(step)
                chains.append(chain)
        for chain in chains:
            raw = [pos_on(n, line) for n in chain]
            raw = [(x, y - Y_SHIFT) for x, y in raw]
            poly = rdp(raw, RDP_TOLERANCE)
            line_paths.append([line, rounded(poly)])
            along = {}
            for n, p in zip(chain, raw):
                q, t = project(p, poly)
                along[n] = t
                snapped.setdefault(n, []).append(q)
            # each edge's piece of the run: its two stations plus any corners between them
            cum, corners = 0.0, []
            for u, v in zip(poly, poly[1:]):
                corners.append((cum, u))
                cum += math.dist(u, v)
            for u, v in zip(chain, chain[1:]):
                t0, t1 = sorted((along[u], along[v]))
                pts = [project(raw[chain.index(u)], poly)[0]]
                pts += [c for t, c in corners if t0 < t < t1][:: 1 if along[u] <= along[v] else -1]
                pts.append(project(raw[chain.index(v)], poly)[0])
                edge_paths[(u, v, line)] = edge_paths[(v, u, line)] = rounded(pts, CORNER_R / 2)
    for n, qs in snapped.items():
        stations[n]['x'] = round(sum(q[0] for q in qs) / len(qs), 1)
        stations[n]['y'] = round(sum(q[1] for q in qs) / len(qs), 1)
    return line_paths, edge_paths


def main():
    rows = [r for r in csv.DictReader(open(ROOT / 'data/mrt_travel_times.csv', encoding='utf-8'))
            if r['Line'] in LINES]

    # station name -> its codes; edges per line as (a, b, mins)
    codes, edges = {}, []
    for r in rows:
        for n, c in ((r['From Station'], r['From Code']), (r['To Station'], r['To Code'])):
            codes.setdefault(n, set()).update(c.split('/'))
        edges.append([r['From Station'], r['To Station'], LINES[r['Line']][0], float(r['Travel Time (mins)'])])

    # join across stations that aren't open yet
    closed = {n for n, cs in codes.items() if cs & NOT_OPEN and not cs - NOT_OPEN}
    for n in closed:
        touching = [e for e in edges if n in e[:2]]
        assert len(touching) == 2, n
        (a1, b1, line, t1), (a2, b2, _, t2) = touching
        ends = [x for x in (a1, b1, a2, b2) if x != n]
        edges = [e for e in edges if e not in touching] + [[ends[0], ends[1], line, t1 + t2]]
        del codes[n]

    # stations newer than sgraildata, from OneMap search ([lng, lat] like GeoJSON)
    geo = {'TE30': [103.949311, 1.316684], 'TE31': [103.957184, 1.320401]}
    for f in json.load(urllib.request.urlopen(SGRAIL))['features']:
        p = f['properties']
        if f['geometry']['type'] == 'Point' and p.get('stop_type') == 'station':
            for c in p.get('station_codes', '').split('-'):
                geo[c] = f['geometry']['coordinates']

    stations = {}
    for n, cs in codes.items():
        pts = [POS[c] for c in cs if c in POS]
        ll = next((geo[c] for c in sorted(cs) if c in geo), None)
        assert pts, f'no map position for {n} {cs}'
        assert ll, f'no coordinates for {n} {cs}'
        order = lambda c: (c.rstrip('0123456789A'), int(''.join(ch for ch in c if ch.isdigit()) or 0))
        stations[n] = {
            'codes': sorted((c for c in cs if c not in NOT_OPEN and c != 'CG'), key=order),
            'x': round(sum(p[0] for p in pts) / len(pts)),
            'y': round(sum(p[1] for p in pts) / len(pts)) - Y_SHIFT,
            'll': [round(ll[1], 6), round(ll[0], 6)],
        }

    line_paths, edge_paths = smooth_lines(edges, codes, stations)

    def km(a, b):
        (la1, lo1), (la2, lo2) = stations[a]['ll'], stations[b]['ll']
        p1, p2 = math.radians(la1), math.radians(la2)
        h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
        return 2 * 6371 * math.asin(math.sqrt(h))

    for e in edges:
        e.append(round(km(e[0], e[1]), 2))
        e.append(edge_paths[(e[0], e[1], e[2])])
    lines = {v[0]: {'colour': v[1], 'name': v[2]} for v in LINES.values()}
    out = ('// Generated by scripts/build_mrt.py. Do not edit by hand.\n'
           f'export const LINES = {json.dumps(lines)};\n'
           f'export const STATIONS = {json.dumps(stations, ensure_ascii=False)};\n'
           '// [from, to, line, minutes, km, svg path along the line]\n'
           f'export const EDGES = {json.dumps(edges, ensure_ascii=False)};\n'
           '// one smooth svg path per continuous run of a line: [line, d]\n'
           f'export const LINE_PATHS = {json.dumps(line_paths)};\n')
    (ROOT / 'mrt.js').write_text(out, encoding='utf-8')
    print(f'{len(stations)} stations, {len(edges)} edges -> mrt.js')


main()
