# HAAB brand reference for the platform UI

Source: screenshot of https://haabaviation.com/ (home page hero), colours sampled from the pixels.

## Colour (verbatim from the site's CSS variables)
| Token | Value | Use |
|---|---|---|
| ink | `#0a0c0f` | Page background, sidebar, top bar |
| ink-2 / ink-3 | `#111418` / `#181d24` | Raised dark panels |
| gold | `#b8966e` | Primary buttons, active states |
| gold-2 | `#d4b896` | Accent text, italic emphasis |
| cream | `#e8e4dc` | Body text on dark |
| fog | `#9ea8b4` | Muted text on dark |
| line | `rgba(184,150,110,.18)` | Hairlines on dark |

## Typography (confirmed from the site)
- Display: **Cormorant Garamond**, light (300), with italic gold emphasis. Stat numbers are 36px / 300.
- Labels, navigation, buttons: **Barlow Condensed**, uppercase, 600 weight, 13px, 2.5px letter-spacing.
- Body: **Barlow**.
- Buttons: padding 13px 30px, square corners. Gold = solid `#b8966e` with ink text. Outline = 1px `rgba(232,228,220,.3)`.

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

## Logo (seen in chat, file not yet in the repo)
- Colour version: deep navy winged emblem with globe and gear, "HAAB AVIATION" in thin capitals,
  "CONSULTANCY SERVICES LTD." in bold capitals. Intended for light backgrounds (certificates, invoices, emails,
  the work area header).
- The website uses a white version on dark. The dark sidebar and login screen need that white version.
- Legal name for documents: **HAAB Aviation Consultancy Services Ltd.**
- The site uses ONE file, `haab-logo.png`, and makes it white on dark backgrounds with the CSS filter
  `brightness(0) invert(1)` at height 56px. The platform does the same, so only that one file is needed:
  save it as `apps/web/public/brand/haab-logo.png`.
- Until the files arrive the UI shows a plain text wordmark. The logo is never redrawn or recoloured by hand.

## About HAAB (from the site, for copy and seed data)
- Ghana-based, incorporated July 2019 (Reg. CS146472019). Serves civil aviation authorities, airport operators,
  government agencies and private investors across Africa. Anchored in ICAO SARPs, ACI and IATA standards.
- Training & Capacity Building offer: Airport SMS; Emergency Planning & Response; Airside Operations & Management;
  Ground Handling Operations; Security Screening (ICAO Annex 17); ICAO & ACI Certification Preparation;
  ARFF & AVSEC; Wildlife Hazard Management.
- Voice: plain, formal, outcome-focused ("From strategy to delivery").

## Day and night mode
- Night is the website's own dark look; day is a warm paper work area built from the same hues.
- Components use semantic tokens only (`--bg`, `--surface`, `--text`, `--accent`, ...) so both themes stay consistent.
- Default follows the device (`prefers-color-scheme`). A header toggle sets `data-theme="day|night"` on `<html>`
  and remembers the choice in localStorage (read inside try/catch). A tiny inline script in the document head
  applies the stored choice before first paint, so there is no flash of the wrong theme.
- The sidebar and top bar are dark in both themes, as on the website.
- Gold used as TEXT on white uses `--accent-text` (#86683f) because the brand gold fails contrast on white.
- Printed output (certificates, invoices, PDF reports) is always day mode on white.
