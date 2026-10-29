# NeoBrutBusTime — Style Guide

Neobrutalism UI with a groovy 70s display face. Bold flat colour, thick black outlines, hard offset shadows, chunky rounded shapes, playful cartoon illustrations.

---

## 1. Typography

### Display font — "Sundaze"
Psychedelic 70s display type: heavy, bulbous, swashed letterforms with curly terminals (see the `SUNDAZE` reference).

- **Use for:** app name, screen titles, big numbers (balances, ETAs), hero headings, empty-state headlines.
- **Never for:** body text, labels, buttons smaller than 18px, anything under ~20px — it gets unreadable.
- Always uppercase or title case, tight tracking (`letter-spacing: -0.01em`), line-height `1.0`.
- Self-host the font file in `/fonts` and load via `@font-face`. Fallback if unavailable: **Shrikhand** (Google Fonts) — closest free groovy face.

```css
@font-face {
  font-family: "Sundaze";
  src: url("/fonts/Sundaze.woff2") format("woff2");
  font-display: swap;
}
```

### UI / body font — Space Grotesk
Geometric grotesk with character; pairs well with the chunky display face and matches the sans in the reference UI.

| Token          | Font          | Size / Line height | Weight |
|----------------|---------------|--------------------|--------|
| `display-xl`   | Sundaze       | 48 / 48            | —      |
| `display-lg`   | Sundaze       | 36 / 36            | —      |
| `display-md`   | Sundaze       | 28 / 30            | —      |
| `title`        | Space Grotesk | 20 / 26            | 700    |
| `body`         | Space Grotesk | 16 / 22            | 500    |
| `label`        | Space Grotesk | 14 / 18            | 600    |
| `caption`      | Space Grotesk | 12 / 16            | 500    |

Numbers in `body`/`label` use `font-variant-numeric: tabular-nums`.

---

## 2. Colour

Flat, saturated pastels on a punchy background. No gradients. Black (`ink`) does all outlining and text.

| Token         | Hex       | Use                                      |
|---------------|-----------|------------------------------------------|
| `ink`         | `#111111` | Outlines, text, shadows, dark buttons    |
| `paper`       | `#FFFDF5` | Light surfaces, inactive chips           |
| `violet`      | `#A98BF5` | App background / page canvas             |
| `peach`       | `#FFB86B` | Primary card, analytics screen bg        |
| `lime`        | `#C8F169` | Highlight card, success                  |
| `coral`       | `#FF6B4A` | Accent card, alerts, "late"              |
| `pink`        | `#F7A8D8` | Feature screen bg, secondary card        |
| `sky`         | `#7EC8F0` | Charts, info, "on time"                  |
| `butter`      | `#FFE066` | Chips, badges, active states             |
| `grey`        | `#8A8A8A` | Disabled / unfilled bars                 |

Rules:
- One bold background colour per screen; cards sit on it in a *different* colour.
- Text on any colour is `ink`. White text only on `ink` surfaces.
- Contrast: every colour above passes AA with `ink` text.

---

## 3. The Neobrutal Kit

Every interactive or container element gets **outline + hard shadow + big radius**.

| Token            | Value                         |
|------------------|-------------------------------|
| `border`         | `2.5px solid #111111`         |
| `shadow`         | `4px 4px 0 #111111` (no blur) |
| `shadow-sm`      | `2px 2px 0 #111111`           |
| `radius-card`    | `28px`                        |
| `radius-btn`     | `999px` (pill)                |
| `radius-chip`    | `999px`                       |
| `radius-icon`    | `50%` (circle buttons)        |

```css
:root {
  --ink: #111; --paper: #FFFDF5; --violet: #A98BF5; --peach: #FFB86B;
  --lime: #C8F169; --coral: #FF6B4A; --pink: #F7A8D8; --sky: #7EC8F0;
  --butter: #FFE066; --grey: #8A8A8A;
  --border: 2.5px solid var(--ink);
  --shadow: 4px 4px 0 var(--ink);
  --shadow-sm: 2px 2px 0 var(--ink);
  --r-card: 28px;
}
.brut { border: var(--border); box-shadow: var(--shadow); border-radius: var(--r-card); }
```

---

## 4. Spacing & Layout

- 4px base grid: `4, 8, 12, 16, 24, 32, 48`.
- Screen gutter: `16px`. Gap between cards: `12px`.
- Card padding: `16–20px`.
- Mobile-first; cards stack, two-up small cards in a row (like the "Brooklin / Los Angeles" pair).
- Generous rounding everywhere — no sharp corners anywhere in the UI.

---

## 5. Components

### Cards
Coloured fill, `border`, `shadow`, `radius-card`. Title in `title`, key number in `display-md`, supporting text in `caption`. Illustrations may overflow the card edge for playfulness.

### Buttons
- **Primary:** `ink` fill, `paper` text, pill, full width at the bottom of the screen ("Add more").
- **Secondary:** `paper` or `butter` fill, `ink` text, `border` + `shadow-sm`, pill.
- **Icon button:** circle, 40px, `border`, coloured fill (e.g. coral back arrow).
- **Press state:** `transform: translate(2px, 2px); box-shadow: var(--shadow-sm);` — the button "sinks" into its shadow. 80ms.

### Chips / segmented tabs
Pills in a horizontal scroll row (All · Year · Month · Week). Inactive: `paper` + `border`. Active: `butter` or `lime` fill + `shadow-sm`.

### Bottom nav
Floating `ink` pill bar inset 16px from the edges. Icons in `paper` circles with `border`. Active item expands into a pill with icon + label ("Home", "Saving").

### Charts
Fat rounded bars (pill-shaped) with `border`. Filled portion in `sky`, track in `grey` or `paper`. Highlighted value shown in a small `butter` tooltip pill with `border`. No gridlines.

### Avatars / badges
Circles with `border`; small decorative bits (sparkles, asterisk ✱ in `butter`/orange) sprinkled around headings.

---

## 6. Illustration

- Retro cartoon "rubber-hose" mascots — objects with faces, noodle arms, sneakers and gloves (cf. the burger and cake characters).
- Thick black outlines matching `border` weight, flat fills from the palette, no gradients, minimal shading.
- For a bus/transit app: a bus mascot, a stop sign, a ticket, a coffee cup — same style.
- Place them breaking out of cards or as large hero art on feature screens.

---

## 7. Motion

- Snappy and bouncy: `cubic-bezier(.34,1.56,.64,1)`, 150–250ms.
- Cards enter with a small upward slide + overshoot.
- Respect `prefers-reduced-motion` — drop transforms, keep fades.

---

## 8. Do / Don't

**Do:** thick outlines, hard shadows, pill shapes, flat bold colours, big groovy display numbers, cheeky mascots.

**Don't:** soft/blurred shadows, gradients, thin hairline borders, sharp corners, the display font for small text, more than 3 card colours on one screen.
