# HAAB brand reference for the platform UI

Source: screenshot of https://haabaviation.com/ (home page hero), colours sampled from the pixels.

## Colour
| Role | Value | Where it appears on the site |
|---|---|---|
| Gold (primary action) | `#b9966e` | Buttons ("Get in touch", "Our services") |
| Light gold (accent text) | `#d0b898` | Italic emphasis in headings ("African Aviation") |
| Ink / near-black | `#0c1013` | Bottom stats bar, header overlay |
| Slate | `#1d272f` | Hero shadows, panels |
| White | `#ffffff` | Headings, logo |
| Muted text | about 70% white | Body copy on dark |

## Typography (inferred from the screenshot; confirm against the site's CSS)
- Display: a light high-contrast serif in the Cormorant family, with italic gold emphasis.
- Labels, navigation, buttons: a condensed sans in the Barlow Condensed style, uppercase, wide letter-spacing, semibold.
- Body: a light humanist sans in the Barlow style.

## Shape and tone
- Square corners. No rounded pills, no shadows beyond a faint lift.
- One-pixel outlined tags ("ICAO COMPLIANT"), solid gold buttons, outlined secondary buttons.
- Voice: plain, authoritative, ICAO-aligned. Tagline: "ICAO-aligned · Africa-focused · Future-ready".
- Logo: white eagle-wing emblem with "HAAB AVIATION / CONSULTANCY SERVICES". The logo FILE is not in the
  repo yet. Do not redraw it; drop the supplied file in `apps/web/public/brand/` (see README there).

## Application of the brand to a data-heavy internal tool
The marketing site is dark and cinematic, which is hard to read for dense tables. The platform therefore uses
a dark ink sidebar and top bar with gold accents (matching the site), and a warm off-white work area for
tables and forms. Headings use the serif; labels and buttons use the condensed uppercase style.
