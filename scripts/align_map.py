"""Measures the map layout from LTA's system map image so our map lines up with it.

Reads data/system-map.png (kept out of git) and the rough positions in build_mrt.POS, then:
1. classifies each pixel to a line colour,
2. fits our map frame onto the image (scale + offset) so stations land on their line's colour,
3. snaps every station onto its line,
4. traces each line between neighbouring stations along the image's own pixels.
Writes data/map_layout.json (station positions + per-edge polylines, in our map units),
which build_mrt.py uses instead of the hand positions. Also writes data/overlay.png to check.

usage: python scripts/align_map.py
"""
import csv, heapq, json, math, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, optimize

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from build_mrt import LINES, NOT_OPEN, POS, Y_SHIFT  # noqa: E402

COLOURS = {  # the system map's line colours
    'NS': (220, 40, 30), 'EW': (0, 150, 70), 'CG': (0, 150, 70), 'NE': (150, 0, 170),
    'CC': (248, 155, 15), 'DT': (10, 75, 165), 'TE': (155, 90, 35),
}
UNIQUE = ['NS', 'EW', 'NE', 'CC', 'DT', 'TE']


def classify(img):
    """label each pixel with the nearest line colour index (UNIQUE), or -1"""
    px = img.astype(int)
    sat = px.max(2) - px.min(2)
    d = np.stack([((px - np.array(COLOURS[k])) ** 2).sum(2) for k in UNIQUE])
    lab = d.argmin(0)
    lab[(d.min(0) > 70 ** 2) | (sat < 70)] = -1
    return lab


def main():
    img = np.array(Image.open(ROOT / 'data/system-map.png').convert('RGB'))
    lab = classify(img)
    masks = {k: lab == i for i, k in enumerate(UNIQUE)}
    masks['CG'] = masks['EW']
    dist, near = {}, {}
    for k, m in masks.items():
        d, idx = ndimage.distance_transform_edt(~m, return_indices=True)
        dist[k], near[k] = d, idx

    # stations and the lines through them (same joining rules as build_mrt)
    rows = [r for r in csv.DictReader(open(ROOT / 'data/mrt_travel_times.csv', encoding='utf-8')) if r['Line'] in LINES]
    pts = []  # (code, line, x, y) in our map units, for every code with a hand position
    for r in rows:
        line = LINES[r['Line']][0]
        for c in (r['From Code'] + '/' + r['To Code']).split('/'):
            pre = c.rstrip('0123456789A')
            ln = {'CE': 'CC'}.get(pre, pre)
            if c in POS and c not in NOT_OPEN and ln in COLOURS:
                pts.append((c, 'EW' if ln == 'CG' else ln, *POS[c]))
    pts = list({p[0]: p for p in pts}.values())

    H, W = lab.shape

    def cost(v):
        s, tx, ty = v
        total = 0.0
        for _, ln, x, y in pts:
            ix, iy = x * s + tx, y * s + ty
            if not (0 <= ix < W and 0 <= iy < H):
                return 1e9
            total += min(dist[ln][int(iy), int(ix)], 15) ** 2
        return total / len(pts)

    # coarse grid over scale and offset, then refine (works for any copy of the map: scale ~ width / 1700)
    best = None
    k = W / 554
    for s in np.linspace(0.28, 0.36, 17) * k:
        for tx in np.arange(-40, 41, 4) * k:
            for ty in np.arange(-80, 21, 4) * k:
                c = cost((s, tx, ty))
                if best is None or c < best[0]:
                    best = (c, (s, tx, ty))
    res = optimize.minimize(cost, best[1], method='Nelder-Mead', options={'xatol': 1e-4, 'fatol': 1e-3})
    s, tx, ty = res.x
    print(f'fit: scale {s:.4f}, offset ({tx:.1f}, {ty:.1f}), mean sq px error {res.fun:.2f}')
    to_img = lambda x, y: (x * s + tx, y * s + ty)
    to_map = lambda ix, iy: ((ix - tx) / s, (iy - ty) / s)

    # snap each code onto its line's nearest pixel
    snapped = {}
    worst = []
    for c, ln, x, y in pts:
        ix, iy = to_img(x, y)
        j, i = int(round(iy)), int(round(ix))
        ny, nx = near[ln][0][j, i], near[ln][1][j, i]
        worst.append((dist[ln][j, i], c))
        snapped[c] = to_map(nx + 0.5, ny + 0.5)
    worst.sort(reverse=True)
    print('furthest snaps (px):', [(c, round(d, 1)) for d, c in worst[:8]])
    # trace every edge along its line's pixels between the two snapped stations
    near_line = {k: ndimage.binary_dilation(m, iterations=1) for k, m in masks.items()}
    edges = {}
    for r in rows:
        line = LINES[r['Line']][0]
        ln = 'EW' if line == 'CG' else line
        pick = lambda codes: next((c for c in codes.split('/') if c in snapped and
                                   {'CE': 'CC', 'CG': 'EW'}.get(c.rstrip('0123456789A'), c.rstrip('0123456789A')) == ln), None)
        a, b = pick(r['From Code']), pick(r['To Code'])
        if not a or not b:
            continue  # unopened station: its two neighbours get traced directly below
        edges[f'{a}|{b}'] = trace(near_line[ln], to_img(*snapped[a]), to_img(*snapped[b]), to_map)
    # joined across unopened stations, as in build_mrt
    for a, b in (('TE9', 'TE11'), ('TE20', 'TE22'), ('TE22', 'TE23')):
        edges[f'{a}|{b}'] = trace(near_line['TE'], to_img(*snapped[a]), to_img(*snapped[b]), to_map)

    # the map itself: header and legend cropped off, sea and island background made transparent
    k = W / 554
    x0, y0, x1, y1 = int(4 * k), int(59 * k), int(550 * k), int(446 * k)
    crop = img[y0:y1, x0:x1].astype(int)
    bg = np.array([[216, 236, 244], [252, 252, 252]])
    d = np.sqrt(((crop[:, :, None, :] - bg[None, None]) ** 2).sum(3)).min(2)
    alpha = np.clip((d - 10) * 255 / 34, 0, 255).astype(np.uint8)  # soft edge so text stays anti-aliased
    out = Image.fromarray(np.dstack([crop.astype(np.uint8), alpha]))
    out = out.resize((out.width * 2, out.height * 2), Image.LANCZOS)  # smoother edges when scaled up
    out.save(ROOT / 'assets/system-map.png', optimize=True)
    mx, my = to_map(x0, y0)
    image = {'x': round(mx, 1), 'y': round(my, 1), 'w': round((x1 - x0) / s, 1), 'h': round((y1 - y0) / s, 1)}

    json.dump({'scale': s, 'tx': tx, 'ty': ty, 'image': image, 'codes': snapped, 'edges': edges},
              open(ROOT / 'data/map_layout.json', 'w'), indent=1)

    # overlay: our traced lines and stations on the reference, to check by eye
    ov = Image.fromarray(img).resize((W * 3, H * 3), Image.LANCZOS).convert('RGB')
    dr = ImageDraw.Draw(ov)
    for poly in edges.values():
        dr.line([(to_img(x, y)[0] * 3, to_img(x, y)[1] * 3) for x, y in poly], fill=(0, 0, 0), width=2)
    for c, (x, y) in snapped.items():
        ix, iy = to_img(x, y)
        dr.ellipse([ix * 3 - 4, iy * 3 - 4, ix * 3 + 4, iy * 3 + 4], outline=(0, 0, 0), width=2)
    ov.save(ROOT / 'data/overlay.png')


def trace(mask, a, b, to_map, margin=30):
    """cheapest 8-connected pixel path from a to b, preferring the line's own pixels"""
    H, W = mask.shape
    x0, x1 = int(max(0, min(a[0], b[0]) - margin)), int(min(W - 1, max(a[0], b[0]) + margin))
    y0, y1 = int(max(0, min(a[1], b[1]) - margin)), int(min(H - 1, max(a[1], b[1]) + margin))
    sub = mask[y0:y1 + 1, x0:x1 + 1]
    start = (int(round(a[1])) - y0, int(round(a[0])) - x0)
    goal = (int(round(b[1])) - y0, int(round(b[0])) - x0)
    hh, ww = sub.shape
    best = {start: 0.0}
    prev = {}
    q = [(0.0, start)]
    steps = [(dy, dx, math.hypot(dy, dx)) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
    while q:
        d, cur = heapq.heappop(q)
        if cur == goal:
            break
        if d > best.get(cur, 1e18):
            continue
        for dy, dx, L in steps:
            ny, nx = cur[0] + dy, cur[1] + dx
            if 0 <= ny < hh and 0 <= nx < ww:
                nd = d + L * (1 if sub[ny, nx] else 40)
                if nd < best.get((ny, nx), 1e18):
                    best[(ny, nx)] = nd
                    prev[(ny, nx)] = cur
                    heapq.heappush(q, (nd, (ny, nx)))
    path = [goal]
    while path[-1] != start:
        path.append(prev[path[-1]])
    path.reverse()
    pts = [to_map(x + x0 + 0.5, y + y0 + 0.5) for y, x in path]
    pts[0], pts[-1] = to_map(*a), to_map(*b)
    return [[round(x, 1), round(y, 1)] for x, y in pts]


if __name__ == '__main__':
    main()
