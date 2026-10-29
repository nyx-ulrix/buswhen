"""Measures the map layout from LTA's system map so our tap points sit on its stations.

Reads data/system-map-hi.png (rendered from LTA's SVG by render_svg.mjs, kept out of git), then:
1. classifies pixels to line colours,
2. finds every station's code box (the solid rounded boxes, much thicker than the lines),
3. fits our rough positions (build_mrt.POS) onto those boxes and assigns each station code its box,
4. traces each line between neighbouring stations along the image's own pixels (for the route view),
5. exports the cropped map with the background removed to assets/system-map.png (+ a grey copy).
Writes data/map_layout.json (station positions, per-edge polylines and where the image sits, in our map
units) for build_mrt.py, and data/overlay.png to check the match by eye.

usage: node scripts/render_svg.mjs && python scripts/align_map.py
"""
import csv, heapq, json, math, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, optimize

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from build_mrt import LINES, NOT_OPEN, POS  # noqa: E402

COLOURS = {  # the system map's line colours
    'NS': (220, 40, 30), 'EW': (0, 150, 70), 'NE': (150, 0, 170),
    'CC': (248, 155, 15), 'DT': (10, 75, 165), 'TE': (155, 90, 35),
}
UNIQUE = list(COLOURS)
TRACE_DOWN = 3  # trace lines on a 1/3-size copy; plenty for the route view and much faster
JOINED = (('TE9', 'TE11'), ('TE20', 'TE22'), ('TE22', 'TE23'))  # across stations that aren't open yet
Image.MAX_IMAGE_PIXELS = None  # our own render, not untrusted input


def line_of(code):
    pre = code.rstrip('0123456789A')
    return {'CE': 'CC', 'CG': 'EW'}.get(pre, pre)


def classify(img):
    """label each pixel with the nearest line colour index (UNIQUE), or -1"""
    px = img.astype(np.int32)  # int16 overflows when the colour differences are squared
    sat = px.max(2) - px.min(2)
    d = np.stack([((px - np.array(COLOURS[k])) ** 2).sum(2) for k in UNIQUE])
    lab = d.argmin(0).astype(np.int8)
    lab[(d.min(0) > 70 ** 2) | (sat < 70)] = -1
    return lab


def code_boxes(mask, k):
    """centres of the solid code boxes on one line colour (lines are too thin to survive the opening)"""
    solid = ndimage.binary_closing(mask, structure=np.ones((int(1.5 * k), int(1.5 * k))))  # fill the white code text
    boxes = ndimage.binary_opening(solid, structure=np.ones((int(2.6 * k), int(2.6 * k))))  # boxes ~3.7k tall, lines ~1.8k
    lab, n = ndimage.label(boxes)
    keep = list(range(1, n + 1))
    if not keep:
        return np.zeros((0, 2))
    return np.array(ndimage.center_of_mass(boxes, lab, keep))[:, ::-1]  # (x, y)


def line_runs(rows):
    """each line as runs of station codes in order, split where the line branches"""
    adj = {}
    for r in rows:
        ln = LINES[r['Line']][0]
        pick = lambda cs: next((c for c in cs.split('/') if c in POS and line_of(c) == ('EW' if ln == 'CG' else ln)), None)
        a, b = pick(r['From Code']), pick(r['To Code'])
        if a and b:
            adj.setdefault(ln, {}).setdefault(a, []).append(b)
            adj[ln].setdefault(b, []).append(a)
    for a, b in JOINED:
        adj['TE'].setdefault(a, []).append(b)
        adj['TE'].setdefault(b, []).append(a)
    out = []
    for ln, g in adj.items():
        for n in list(g):  # drop unopened stations, already joined across
            if n in NOT_OPEN:
                for o in g.pop(n):
                    g[o].remove(n)
        used = set()
        for s in [n for n in g if len(g[n]) != 2]:
            for nxt in g[s]:
                if frozenset((s, nxt)) in used:
                    continue
                run = [s, nxt]
                used.add(frozenset((s, nxt)))
                while len(g[run[-1]]) == 2:
                    step = next((x for x in g[run[-1]] if frozenset((run[-1], x)) not in used), None)
                    if step is None:
                        break
                    used.add(frozenset((run[-1], step)))
                    run.append(step)
                out.append((ln, run))
    return out


def main():
    img = np.array(Image.open(ROOT / 'data/system-map-hi.png').convert('RGB'))
    H, W = img.shape[:2]
    k = W / 554  # sizes below were measured on the 554px copy
    lab = classify(img)
    masks = {c: lab == i for i, c in enumerate(UNIQUE)}
    boxes = {c: code_boxes(m, k) for c, m in masks.items()}
    print('code boxes found:', {c: len(b) for c, b in boxes.items()})

    rows = [r for r in csv.DictReader(open(ROOT / 'data/mrt_travel_times.csv', encoding='utf-8')) if r['Line'] in LINES]
    codes = sorted({c for r in rows for c in (r['From Code'] + '/' + r['To Code']).split('/')
                    if c in POS and c not in NOT_OPEN and line_of(c) in COLOURS})
    P = np.array([POS[c] for c in codes], float)

    # fit x/y scale + offset: grid search on a 1/3-size copy, scoring how close every code lands to
    # its line's colour, then refine
    D = TRACE_DOWN
    dist = {c: np.minimum(ndimage.distance_transform_edt(~m[::D, ::D]), 15 * k / D) for c, m in masks.items()}
    cols = np.array([UNIQUE.index(line_of(c)) for c in codes])
    stack = np.stack([dist[c] for c in UNIQUE])
    hh, ww = stack.shape[1:]

    def cost(v):
        sx_, sy_, tx_, ty_ = v
        ix = ((P[:, 0] * sx_ + tx_) / D).astype(int)
        iy = ((P[:, 1] * sy_ + ty_) / D).astype(int)
        if ix.min() < 0 or iy.min() < 0 or ix.max() >= ww or iy.max() >= hh:
            return 1e9
        return float((stack[cols, iy, ix] ** 2).mean())

    best = None
    for s_ in np.linspace(0.26, 0.38, 25) * k:
        for ar in np.linspace(0.94, 1.06, 7):
            for tx_ in np.arange(-60, 90, 6) * k:
                for ty_ in np.arange(-60, 90, 6) * k:
                    c_ = cost((s_, s_ * ar, tx_, ty_))
                    if best is None or c_ < best[0]:
                        best = (c_, (s_, s_ * ar, tx_, ty_))
    res = optimize.minimize(cost, best[1], method='Nelder-Mead', options={'xatol': 1e-4, 'fatol': 1e-4, 'maxiter': 4000})
    sx, sy, tx, ty = res.x
    pred = np.c_[P[:, 0] * sx + tx, P[:, 1] * sy + ty]
    print(f'fit: scale ({sx:.4f}, {sy:.4f}), offset ({tx:.1f}, {ty:.1f}), '
          f'rms {math.sqrt(res.fun) * D / k:.2f} (554px units)')

    # one box per code. LTA shifts parts of the layout between map versions, so one fit isn't enough:
    # assign each code its nearest free box of its colour, nudge every guess by how its neighbours
    # moved, and repeat until the guesses settle
    to_map = lambda ix, iy: ((ix - tx) / sx, (iy - ty) / sy)
    to_img = lambda x, y: (x * sx + tx, y * sy + ty)
    small = {c: ndimage.binary_dilation(m[::TRACE_DOWN, ::TRACE_DOWN], iterations=1) for c, m in masks.items()}
    in_map = lambda B: B[(B[:, 1] > 59 * k) & (B[:, 1] < 446 * k)] if len(B) else B  # no header or legend
    boxes = {c: in_map(b) for c, b in boxes.items()}
    guess = pred.copy()
    for it in range(8):
        at = np.zeros_like(guess)
        for colour in UNIQUE:
            idx = np.where(np.array([line_of(c) for c in codes]) == colour)[0]
            B = boxes[colour]
            cost = np.hypot(guess[idx, None, 0] - B[None, :, 0], guess[idx, None, 1] - B[None, :, 1])
            ri, ci = optimize.linear_sum_assignment(cost)
            at[idx[ri]] = B[ci]
        move = at - guess
        near = np.argsort(np.hypot(guess[:, None, 0] - guess[None, :, 0], guess[:, None, 1] - guess[None, :, 1]), 1)[:, :7]
        step = np.median(move[near], axis=1)
        guess = guess + step
        print(f'  pass {it + 1}: median move {np.median(np.hypot(*move.T)) / k:.2f}, max {np.hypot(*move.T).max() / k:.1f}')
    at_px = dict(zip(codes, at))
    far = sorted(((np.hypot(*(at[i] - guess[i])) / k, c) for i, c in enumerate(codes)), reverse=True)
    print('far from their settled guess (554px units):', [(c, round(d, 1)) for d, c in far if d > 5])
    snapped = {c: to_map(*p) for c, p in at_px.items()}

    # trace each edge along its line on a smaller copy
    to_small = lambda x, y: tuple(v / TRACE_DOWN for v in to_img(x, y))
    from_small = lambda ix, iy: to_map(ix * TRACE_DOWN, iy * TRACE_DOWN)
    pairs = []
    for r in rows:
        ln = 'EW' if LINES[r['Line']][0] == 'CG' else LINES[r['Line']][0]
        pick = lambda cs: next((c for c in cs.split('/') if c in snapped and line_of(c) == ln), None)
        a, b = pick(r['From Code']), pick(r['To Code'])
        if a and b:
            pairs.append((a, b, ln))
    pairs += [(a, b, 'TE') for a, b in JOINED]
    edges = {f'{a}|{b}': trace(small[ln], to_small(*snapped[a]), to_small(*snapped[b]), from_small, 30 * k / TRACE_DOWN)
             for a, b, ln in pairs}

    # the map itself: header and legend cropped off, sea and island background made transparent
    x0, y0, x1, y1 = int(4 * k), int(59 * k), int(550 * k), int(446 * k)
    crop = img[y0:y1, x0:x1].astype(np.int32)
    bg = np.array([[216, 236, 244], [252, 252, 252], [255, 255, 255]], dtype=np.int32)
    d = np.sqrt(((crop[:, :, None, :] - bg[None, None]) ** 2).sum(3)).min(2)
    alpha = np.clip((d - 10) * 255 / 34, 0, 255).astype(np.uint8)  # soft edge so text stays anti-aliased
    out = Image.fromarray(np.dstack([crop.astype(np.uint8), alpha]))
    f = 2600 / out.width  # about 2600px wide: sharp at the biggest zoom
    out = out.resize((round(out.width * f), round(out.height * f)), Image.LANCZOS)
    out.quantize(256, method=Image.Quantize.FASTOCTREE).save(ROOT / 'assets/system-map.png', optimize=True)
    # a light grey copy, shown under the route so everything off the route fades back
    ga = np.array(out)
    lum = ga[..., :3].astype(float) @ [0.299, 0.587, 0.114]
    ga[..., :3] = (255 - (255 - lum) * 0.3)[..., None].astype(np.uint8)
    Image.fromarray(ga).quantize(64, method=Image.Quantize.FASTOCTREE).save(ROOT / 'assets/system-map-grey.png', optimize=True)
    mx, my = to_map(x0, y0)
    image = {'x': round(mx, 1), 'y': round(my, 1), 'w': round((x1 - x0) / sx, 1), 'h': round((y1 - y0) / sy, 1)}

    json.dump({'scale': [sx, sy], 'offset': [tx, ty], 'image': image,
               'codes': {c: [round(x, 1), round(y, 1)] for c, (x, y) in snapped.items()}, 'edges': edges},
              open(ROOT / 'data/map_layout.json', 'w'), indent=1)

    # overlay to check by eye: traced lines and our station points on the reference
    z = 1200 / W
    ov = Image.fromarray(img).resize((1200, 1200), Image.LANCZOS)
    dr = ImageDraw.Draw(ov)
    for poly in edges.values():
        dr.line([tuple(v * z for v in to_img(x, y)) for x, y in poly], fill=(0, 0, 0), width=2)
    for x, y in snapped.values():
        ix, iy = (v * z for v in to_img(x, y))
        dr.ellipse([ix - 4, iy - 4, ix + 4, iy + 4], outline=(0, 0, 0), width=2)
    ov.save(ROOT / 'data/overlay.png')


def trace(mask, a, b, to_map, margin):
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
