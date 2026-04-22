# Sumi (墨) — Brand Guidelines

> 墨の哲学 × モダンテック — the craft of ink meets modern developer tooling.

Sumi is a Japanese-first, polished desktop IDE for Claude Code, built on
Tauri 2 + Next.js. This document is the single source of truth for how the
Sumi brand is expressed — in the product, on the site, and across every
surface where the logo, colors, or voice appear.

**Last updated**: 2026-04-23 / DEC-053

---

## 1. Brand philosophy

Sumi (墨) is the solid ink stick used in Japanese calligraphy (shodō) and
sumi-e ink-wash painting. To grind sumi on an inkstone and write is to
commit to a single stroke, without undo. The brand borrows that posture.

### Attributes (ranked — do NOT dilute)

1. **侘寂 (wabi-sabi)** — restraint, imperfection, depth within simplicity.
2. **静謐 (serenity)** — calm focus. No visual noise, no urgency theatre.
3. **職人的 (artisan)** — considered, crafted, not corporate.
4. **濃密 (density)** — rich information, elegantly arranged.

### Absolute no-list

- Cherry blossoms, torii gates, katana, "Japan theme park" clichés
- Cartoon / mascot / cute / kawaii
- Multi-hue gradients that scream SaaS
- Emojis in UI (see also the global `CLAUDE.md` convention)
- Drop shadows heavier than `0 4px 12px rgba(0,0,0,0.3)`
- Serif body fonts

---

## 2. Logo

### 2.1 The mark

The Sumi mark is a **single horizontal brushstroke with kasure (かすれ,
dry-brush fade)** and a **single orange ink drop**. Concept C from the
rename process; chosen over options A (enso) and B (radical 墨 kanji) for
reasons documented in `projects/PRJ-012/decisions.md` DEC-053.

What the mark means:

- The **stroke** is the decisive first line — the posture of a master
  calligrapher. It starts with pressure, flows through the middle, and
  dries out at the tail. That fade is the craft signal.
- The **drop** is a single accent of claude-orange, echoing where a loaded
  brush would leave a bead. It is the only permitted use of color in the
  mark. Do not add a second.

### 2.2 Files

All logo files live in `site/public/brand/` and are hand-coded SVGs with
semantic `<title>` / `<desc>` elements and `currentColor` where possible.

| File                          | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `logo.svg` → `logo-dark.svg`  | Full logo (mark + wordmark) for light bg      |
| `logo-light.svg`              | Full logo for dark bg                         |
| `logo-mark-dark.svg`          | Square mark only, for light bg (favicons)     |
| `logo-mark-light.svg`         | Square mark only, for dark bg                 |
| `logo-wordmark-dark.svg`      | Wordmark "sumi" only, for light bg            |
| `logo-wordmark-light.svg`     | Wordmark "sumi" only, for dark bg             |
| `app-icon-1024.svg`           | Master app icon (source of truth for raster)  |
| `app-icon-{32..1024}.png`     | Generated rasters (see `scripts/generate-icons.mjs`) |
| `og.svg` / `og.png`           | 1200×630 social card                          |

### 2.3 Clearspace

Leave clearspace on all sides equal to **1× the wordmark cap height**.
In the full-logo viewBox (216×64), cap height is 24. Never place other
graphics, rules, or type within that clearspace.

```
       ┌─────────────────────────────────────────────┐
   24u │                                             │
       │    ╭──────────╮   sumi                      │
       │    │ ~stroke~  │                            │
       │    ╰────●──────╯                            │
   24u │                                             │
       └─────────────────────────────────────────────┘
         24u                                     24u
```

### 2.4 Minimum size

| Medium   | Minimum width of the mark  |
| -------- | -------------------------- |
| Digital  | **16 px** (favicon floor)  |
| Print    | **8 mm**                   |

Below 16 px, use `site/public/icon.svg` — a simplified form that drops the
kasure gradient for raw legibility.

### 2.5 Wordmark

The wordmark is lowercase `sumi` set in **Geist Sans Medium** with
letter-spacing `-0.02em` (tight). All wordmark SVGs ship the glyphs as
vector paths — no web-font dependency at render time. If typography ever
needs to be re-set, use Geist Sans Medium as the source.

Never:
- Capitalize ("SUMI", "Sumi" as wordmark — though "Sumi" in body copy is OK)
- Substitute a different font
- Add serifs, italic, outline, or a stylized 墨 character into the wordmark

### 2.6 Do / Don't examples

**Do**

1. Use `logo-light.svg` on sumi-ink, sumi-charcoal, or any dark surface.
2. Use `logo-dark.svg` on sumi-paper or white surfaces.
3. Scale the full logo down to 96 px wide; scale the mark down to 16 px.
4. Tint the stroke via CSS (`color: sumi-mist`) for low-emphasis uses
   like muted footer repeats. Keep the drop in claude-orange regardless.

**Don't**

1. Don't re-color the orange drop to brand-muted, enso-gold, or any
   other accent. The orange is LOCKED.
2. Don't place the logo on a photograph or patterned background without
   a solid sumi-ink or sumi-paper underlay.
3. Don't stretch, skew, or add drop-shadow > `0 4px 12px` to the logo.
4. Don't outline the mark with a border or put it inside a circle/badge
   badge. The mark already *is* the composition.

---

## 3. Color system

All color tokens are in Tailwind under the `sumi` namespace (see
`tailwind.config.ts`). HSL is authoritative; hex is reference-only.

### 3.1 Core (墨色 / grayscale, warm-leaning)

| Token              | HSL                  | Hex       | Use                                       |
| ------------------ | -------------------- | --------- | ----------------------------------------- |
| `sumi.ink`         | `220 8% 6%`          | `#0c0e12` | 背景基調 — app shell / site dark bg      |
| `sumi.charcoal`    | `220 6% 12%`         | `#191c21` | 1 段上の面 — cards, elevated surfaces     |
| `sumi.ash`         | `220 5% 22%`         | `#33363d` | ボーダー / hairline rules / 墨のかすれ    |
| `sumi.mist`        | `30 8% 70%`          | `#b2aca2` | セカンダリ文字 / muted captions           |
| `sumi.paper`       | `30 15% 94%`         | `#f3eee7` | 和紙ベージュ — 白の代替                   |

### 3.2 Accent (唯一の色)

| Token              | HSL                  | Hex       | Use                                       |
| ------------------ | -------------------- | --------- | ----------------------------------------- |
| `brand` (orange)   | `18 55% 50%`         | `#c15f3c` | CTA primary / focus / 決定色              |
| `brand.fg`         | `18 80% 60%`         | —         | Orange on dark bg, used for links/labels  |
| `brand.muted`      | `18 40% 40%`         | —         | CTA hover / pressed variant               |
| `brand.glow`       | `18 80% 55% / 0.35`  | —         | Focus ring glow / selection               |

### 3.3 Status

| Token     | HSL           | Hex       | Use                               |
| --------- | ------------- | --------- | --------------------------------- |
| `enso`    | `45 70% 55%`  | `#d9a43a` | Success / 完了 (gold-leaning)     |
| `chigiri` | `0 60% 50%`   | `#cc3333` | Destructive / error               |

### 3.4 The 70/20/10 rule

The entire Sumi palette obeys this ratio:

- **70 %** sumi-ink / charcoal (surfaces)
- **20 %** sumi-paper / mist (type)
- **10 %** claude-orange (CTA + focus only — never decoration)

If you find yourself using orange for a section divider, a bar chart, an
icon tint, or a hover accent that isn't a focus/CTA, stop. Use `sumi.ash`
or `sumi.mist` instead.

### 3.5 Dark mode / light mode

| Surface layer     | Dark mode         | Light mode        |
| ----------------- | ----------------- | ----------------- |
| Page background   | `sumi.ink`        | `sumi.paper`      |
| Card / panel      | `sumi.charcoal`   | `#ffffff`         |
| Border / rule     | `sumi.ash`        | `zinc-200`        |
| Primary text      | `sumi.paper`      | `sumi.ink`        |
| Secondary text    | `sumi.mist`       | `sumi.ash`        |
| Brand accent      | `brand` (unchanged across modes)             ||
| Focus ring        | `brand.glow`      | `brand.glow`      |

Dark is the default per product philosophy (code-editor-like). The light
mode is fully supported but visually secondary.

---

## 4. Typography

### 4.1 Typefaces

| Role                   | Typeface                | Weight    | Notes                                  |
| ---------------------- | ----------------------- | --------- | -------------------------------------- |
| Display / Heading      | **Geist Sans**          | 600       | Tracking `-0.02em`                     |
| Body                   | **Geist Sans**          | 400       | Default                                |
| Code / mono            | **Geist Mono**          | 400 / 500 | Terminal, code blocks, meta            |
| Japanese (fallback)    | Hiragino Kaku Gothic ProN / Yu Gothic UI / system-ui | | Inherited from system |
| Logo wordmark          | Geist Sans Medium (converted to paths in SVG)       | | |

We do **not** use Noto Serif JP or other serif Japanese faces. If a
"more Japanese" feel is needed in a heading, solve it with **tracking**,
not with a serif. `tracking-[0.2em]` on a short kanji heading is the
idiomatic Sumi move.

### 4.2 Type scale (site)

| Name  | Size         | Weight | Tracking   |
| ----- | ------------ | ------ | ---------- |
| h1    | 3rem / 4rem  | 700    | `-0.02em`  |
| h2    | 1.5rem       | 600    | `-0.01em`  |
| h3    | 1.25rem      | 600    | normal     |
| body  | 1rem         | 400    | normal     |
| small | 0.875rem     | 400    | normal     |
| mono  | 0.8125rem    | 400    | `0.04em`   |

### 4.3 Tone of voice

**Voice**: the tone of a craftsperson explaining their tools to a fellow
craftsperson. Direct. Unhurried. Minimally decorated. Japanese first, with
English technical terms retained (Claude Code, Tauri, Next.js) — we do not
Japanize brand names.

**Do** write sentences like:

> Tauri 2 で構築された、日本語話者のための汎用 Claude Code デスクトップクライアント。
> 墨の哲学で仕上げた、静謐で濃密な開発環境。

**Don't** write sentences like:

> AI-powered next-gen IDE experience with blazing fast performance and
> unlimited possibilities for your creative coding journey!

Or mixed:

> 🚀 爆速 Claude Code IDE で開発体験を爆上げ！✨

Keep punctuation Japanese (`、。「」`). Keep em-dashes ASCII. Keep
measurements in metric where relevant.

---

## 5. Iconography

- Web: **Heroicons** (outline primarily, solid for filled states).
- Mobile: **Ionicons via `@expo/vector-icons`** (when Sumi grows to mobile).
- **Never** use emojis in UI — for the rare case a symbol is needed
  (status, OS indicator), use a dedicated icon or the ASCII-mono glyph
  set from Geist Mono.
- Stroke width 1.5 px at 24 px size, 1.25 px at 16 px size.

---

## 6. App icon generation

The master is `site/public/brand/app-icon-1024.svg`. Rasterization is
deterministic via `site/scripts/generate-icons.mjs` (uses `sharp`, which
ships with Next.js).

```bash
cd site
node scripts/generate-icons.mjs
```

This writes `app-icon-{32,64,128,128@2x,256,512,1024}.png` into
`site/public/brand/` plus a 32 px `favicon-32.png` at the site root.

**When you're ready to flip the Tauri app brand** (separate migration step,
NOT part of this PR), the mapping to `src-tauri/icons/` is:

| Tauri file                  | Source                            |
| --------------------------- | --------------------------------- |
| `icon.png` (512)            | `app-icon-512.png`                |
| `32x32.png`                 | `app-icon-32.png`                 |
| `64x64.png`                 | `app-icon-64.png`                 |
| `128x128.png`               | `app-icon-128.png`                |
| `128x128@2x.png`            | `app-icon-128@2x.png` (256 px)    |
| `icon.ico` (Windows)        | `npx png-to-ico app-icon-256.png` |
| `icon.icns` (macOS)         | `npx png2icons app-icon-1024.png` (or `iconutil` pipeline) |
| `Square*Logo.png` (Store)   | resize `app-icon-1024.png` to the exact requested sizes |
| `android/` adaptive         | `app-icon-512.png` as foreground, `sumi.ink` as background |
| `ios/` AppIcon              | `app-icon-1024.png` — Xcode will generate the asset catalog entries |

Keep `src-tauri/icons/` unchanged until the dedicated rebrand PR lands.

---

## 7. Motion

Animation is calm. Movement exists to communicate state, never to entertain.

- Duration: **150 ms** for micro (hover, focus), **300 ms** for layout,
  **500 ms** maximum for page-level transitions.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` for entrances;
  `cubic-bezier(0.4, 0, 1, 1)` for exits.
- No spring-bounces, no parallax, no decorative scroll-linked animation.

---

## 8. License

Logo files are MIT-licensed with the Sumi brand, i.e. the visual trademark
applies. Use in derivative / non-official distributions should rename the
product and replace the mark — the mark identifies Sumi, not Claude Code
in general. Claude and Anthropic are trademarks of Anthropic, PBC.

---

## 9. Changelog

- **2026-04-23** · v1.0 — Initial brand set (mark, wordmark, palette,
  guidelines). See `projects/PRJ-012/decisions.md` DEC-053.
