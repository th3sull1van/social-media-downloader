---
name: Social Media Downloader
description: Chrome MV3 extension that archives original-resolution media from Instagram, Facebook, and Reddit in dark, quiet operator chrome.
colors:
  bg-primary: "#121214"
  bg-card: "#1c1c1f"
  bg-hover: "#26262b"
  bg-raised: "#1f1f23"
  bg-sunken: "#141417"
  bg-inset: "#242429"
  border-color: "#2e2e33"
  border-strong: "#33333a"
  text-primary: "#f0f0f2"
  text-high: "#ffffff"
  text-secondary: "#9e9ea7"
  text-soft: "#b0b0b8"
  text-muted: "#8b8b93"
  text-faint: "#8b8b93"
  instagram-magenta: "#e1306c"
  facebook-signal-blue: "#1877f2"
  reddit-orangered: "#ff4500"
  go-green: "#34d27b"
  halt-red: "#e5484d"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.02em"
    textTransform: "uppercase"
  counter:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  pill: "9999px"
spacing:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  2xl: "12px"
  3xl: "14px"
  4xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.instagram-magenta}"
    textColor: "{colors.text-high}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
    size: "13px"
  button-primary-hover:
    backgroundColor: "{colors.instagram-magenta}"
    textColor: "{colors.text-high}"
  button-secondary:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  button-secondary-hover:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.text-primary}"
  button-download:
    backgroundColor: "{colors.go-green}"
    textColor: "{colors.bg-primary}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  button-download-disabled:
    backgroundColor: "{colors.go-green}"
    textColor: "{colors.bg-primary}"
  button-cancel:
    backgroundColor: "transparent"
    textColor: "{colors.halt-red}"
    rounded: "{rounded.sm}"
    padding: "4px"
  chip-platform:
    backgroundColor: "{colors.instagram-magenta}"
    textColor: "{colors.text-high}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  chip-platform-fb:
    backgroundColor: "{colors.facebook-signal-blue}"
    textColor: "{colors.text-high}"
  chip-platform-reddit:
    backgroundColor: "{colors.reddit-orangered}"
    textColor: "{colors.text-high}"
  card:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
  modal-shell:
    backgroundColor: "#18181b"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
  grid-item:
    backgroundColor: "{colors.bg-inset}"
    rounded: "{rounded.md}"
  grid-item-selected:
    backgroundColor: "{colors.bg-inset}"
    textColor: "{colors.text-high}"
---

# Design System: Social Media Downloader

## Overview

**Creative North Star: "The Darkroom Archive"**

The Darkroom Archive treats every SMD surface as the antechamber to the photographs themselves. Surfaces are near-black operator chrome — quiet, dense, monochrome — so that the media being archived is the only hero on screen. Color is scarce and functional: one platform accent at a time acts as the safelight, marking what belongs to the current platform; green is reserved for the act of saving; red only appears when the user must stop something. Nothing is decorative; every hue is a status, and every pixel of chrome exists to frame, select, and package the user's archive.

Density is a feature, not a compromise. This is a 400px popup and an in-page modal competing with a live social feed for attention; controls are compact (11–13px labels, 6–8px rhythm) and confident — bordered, quick to parse, unambiguous about state. The system must remain soft and friendly at the edges: pill chips, fully rounded progress tracks, gentle 6–12px radii, and forgiving hover states keep the instrument feel from turning clinical. The stance is anti-marketing: no gradients except the Instagram brand gradient, no colored fills without status meaning, no decorative imagery in chrome.

**Key Characteristics:**
- Near-black monochrome surfaces (#121214 base, #1c1c1f cards, #2e2e33 borders); media and accents supply all color.
- One accent at a time: the platform accent recolors primary actions, selection, and progress as a set (magenta / signal blue / orangered), never mixed on screen.
- State-coded action colors: green = save/download, red = cancel/danger, platform accent = platform identity + selection.
- Compact confident controls: 11–13px type, 6px radius, 1px borders, tight 6–8px rhythm.
- Friendly geometry on dark: 9999px pills, fully rounded progress bars, 12px modal shell.

## Colors

A near-black neutral ramp with three saturated platform accents and two state colors; every saturated hue carries one fixed meaning.

### Primary
- **Instagram Magenta** (#e1306c): the default accent — primary buttons, selected grid borders, check overlays, progress fill, FAB. Default theme = Instagram because it was the first plugin.
- **Facebook Signal Blue** (#1877f2): Facebook theme accent; recolors the entire accent set (primary button, selection, progress, FAB, chip) as one coherent theme.
- **Reddit Orangered** (#ff4500): Reddit theme accent; same set recoloring as Facebook.
- **Go Green** (#34d27b): the download/save action color; reserved exclusively for the primary download button. Dark text (#121214) for contrast on the bright fill.
- **Halt Red** (#e5484d): cancel/danger; outline-only treatment (transparent fill, 1px border; hover adds a 15% red wash). Button text uses the lifted tint **#ee6a6e** for AA contrast on the raised modal band (5.4:1); the #e5484d border alone meets the 3:1 non-text minimum.

### Secondary
- **Instagram Brand Gradient** (linear-gradient(135deg, #e1306c, #fd1d1d, #f56040)): reserved for the Instagram platform badge/chip only. The only gradient in the system — a brand identity asset, not a decorative device. (Frontmatter lists the magenta stop as `instagram-magenta`; the full gradient lives in `--accent-ig` in `popup.css` and must not be flattened into a solid.)

### Neutral
- **Ink Base** (#121214): app background (popup body, download button text color).
- **Card Base** (#1c1c1f): cards and secondary buttons.
- **Raised Base** (#1f1f23): modal header/footer bands.
- **Sunken Base** (#141417): scanner bar, filter bar, progress track, segmented control tray — surfaces that recede behind controls.
- **Inset Base** (#242429): grid items, action buttons, avatar placeholder — the "well" a thumbnail sits in.
- **Hover Step** (#26262b): hover state of cards/buttons/tabs; one step lighter than Card Base.
- **Selected Tab Step** (#27272e): active tab background in the overlay (one step above Hover Step).
- **Segment Step** (#2c2c33): checked segment face and action-button hover; two steps above Card Base.
- **Hairline Border** (#2e2e33): all 1px borders.
- **Strong Border** (#33333a): avatar ring, action-button borders in the overlay.
- **Text Primary** (#f0f0f2): primary text.
- **Text High** (#ffffff): text on accent fills, modal title, close-button hover.
- **Text Secondary** (#9e9ea7): secondary text and secondary-button labels.
- **Text Soft** (#b0b0b8): overlay link buttons.
- **Text Muted** (#8b8b93): metadata, counters, empty-state body, overlay small print. Lifted from #6e6e77 (3.1–3.6:1, AA fail) to 5.0–5.5:1 on every dark surface; formerly separate "Text Faint".

### Named Rules (optional, powerful)
**The One Accent Rule.** Only one platform accent appears at a time, and it recolors the whole accent set — buttons, selection borders, check overlays, progress, FAB, chip — as one coherent theme. Never mix two platform accents on screen.
**The Status-Only Color Rule.** Saturated color is status, never decoration. Green appears only on the download action; red only on cancel/danger; a platform accent only on platform identity and selection. If a surface needs color to look designed, it is wrong.
**The Gradient Exception Rule.** The only gradient is the Instagram brand gradient on the Instagram badge/chip; it is a brand asset carried from the platform's own identity, and it must never be generalized to other surfaces.

## Typography

**Display Font:** System UI stack (-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)
**Body Font:** System UI stack (same)
**Label/Mono Font:** none — no mono or display face; weight and case carry hierarchy

**Character:** One system stack across all contexts; hierarchy is carried entirely by weight (400→800), size (10–18px), and uppercase micro-labels. The scale is compressed — this is operator chrome, and 13px body text is deliberate density.

### Hierarchy
- **Display** (700, 16px, 1.2): modal target title — the largest statement in the system.
- **Title** (700, 15px, 1.2): popup target title.
- **Headline** (700, 14px, 1.2): popup brand title.
- **Body** (400, 12–13px, 1.45): general copy, statuses, descriptions.
- **Label** (600, 10–11px, 0.02em, uppercase): platform chips/badges, target-type eyebrow, tab counts, media tags.
- **Counter** (800, 18px, 1): the media counter — the only 800 weight in the system, giving the archive size real presence.
- **Tag** (700, 9–10px): corner tags on grid items (video/format/resolution).

### Named Rules (optional)
**The Weight-Carries-Hierarchy Rule.** No new font faces. Hierarchy comes from the system stack's weights (400/600/700/800), size steps of 9–18px, and uppercase 10–11px micro-labels — never from adding a typeface.

## Layout

**Popup:** fixed 400px-wide body, max-height 600px, 14px outer padding, 12px vertical gap between sections. Internal card padding 10–14px. Compact rhythm: 4/6/8/10/12px steps.
**Overlay modal:** viewport-anchored sheet — 94vw wide, max 920px; 90vh tall — flex column with fixed header/scanner/filter bands and a scrollable auto-fill media grid (min 130px columns, 12px gap, 14px/20px padding).
**Grid:** thumbnails are square (aspect-ratio 1/1), 3-up in the popup (6px gap, 240px max height, scrollable), auto-fill in the modal.
**Platform-conditional visibility:** `.ig-only` / `.reddit-only` elements toggle per platform; layout adapts by showing/hiding platform-scoped quick-scanner buttons and filter tabs.

## Elevation & Depth

Hybrid by context — **The Flat-Panel Rule:** panels are flat at rest. Popup and modal interiors use no shadows; cards, tabs, and buttons are separated by 1px hairline borders and the neutral tonal ladder (Sunken #141417 → Card #1c1c1f → Raised #1f1f23 → Inset #242429). Depth appears only when UI floats above a third-party page: the FAB carries `0 4px 16px rgba(0,0,0,0.4)` (hover lifts to `0 6px 22px rgba(0,0,0,0.55)` + translateY(-2px)), the modal shell carries `0 16px 48px rgba(0,0,0,0.75)` over a `rgba(0,0,0,0.78)` scrim with 4px backdrop blur, and grid items scale to 1.02 on hover. Shadows are a floating-context device, never a panel device.

### Shadow Vocabulary
- **FAB ambient** (`box-shadow: 0 4px 16px rgba(0,0,0,0.4)`, hover `0 6px 22px rgba(0,0,0,0.55)`): detaches the launch button from the host page.
- **Modal structural** (`box-shadow: 0 16px 48px rgba(0,0,0,0.75)`): lifts the modal shell over the scrim.
- **Scrim** (`rgba(0,0,0,0.78)` + `backdrop-filter: blur(4px)`): dims the host page; 0.15s ease-out fade-in.

### Named Rules (optional)
**The Flat-Panel Rule.** Surfaces inside the popup and modal are flat at rest; shadows belong exclusively to UI floating over third-party pages (FAB, modal shell) or to hover/active responses.

## Shapes

Soft-geometric dark chrome. Controls use 6px radius (buttons, tabs, selects, segments), containers 8px (cards, grid items in the popup; overlay grid items use 8px), the modal shell 12px, and identity chips/badges 9999px pills. Check overlays are 4px-radius squares (18px popup / 20px overlay) with a translucent white border at rest. The 2px selection border on grid items is the primary selection affordance — accent-colored, replacing the transparent resting border. Media tags use 3px (popup) / 4px (overlay) radius. Avatar/logo containers are circles (50%) with 2px Strong Border rings. No sharp corners anywhere; no asymmetrical or rotated geometry.

## Components

### Buttons
- **Shape:** gently rounded (6px), no visible border on primary; font-weight 600–700.
- **Primary:** platform accent fill (`--color-accent`), white text, 9px 12px padding, 13px, full-width in popup scan row.
- **Hover / Focus:** primary dims to 90% opacity; secondary shifts to Hover Step bg + Text Primary; action buttons shift to Segment Step + white text. Focus states are not styled today (native outline) — preserve.
- **Secondary / Ghost / Tertiary:** Card Base fill + 1px hairline border + Text Secondary, 6px 10px, 11px. Link buttons are transparent (Select All / Deselect All / Deduplicate, 11–12px 600).
- **Download:** Go Green fill, Ink Base text, 700 weight, 10px padding, full width; disabled at 40% opacity.
- **Cancel:** outline-only Halt Red (1px #e5484d border, #ee6a6e text, transparent fill); hover adds rgba(229,72,77,0.15) wash.
- **Segmented control:** Sunken tray + hairline border, 2px padding, 2px gap; checked face = Segment Step bg + white text; hidden native input (radio) drives state.

### Chips (platform identity)
- **Style:** 9999px pill, accent fill, white 700 11px uppercase text; Instagram badge uses the brand gradient variant.
- **State:** identity-only (which platform is detected); not interactive filters. The FAB count badge is a white pill with Ink Base 800 text — inverse of the platform chips.

### Cards / Containers
- **Corner Style:** 8px radius.
- **Background:** Card Base; modal bands use Raised Base; sunken bars use Sunken Base.
- **Shadow Strategy:** none — see Flat-Panel Rule.
- **Border:** 1px Hairline Border on all cards.
- **Internal Padding:** 10–14px.

### Inputs / Fields
- **Style:** Card Base fill, 1px hairline border, 6px radius, 12px text (subreddit select-dropdown is the only native input styled today).
- **Focus:** native browser focus (unstyled) — preserve.
- **Error / Disabled:** disabled = 40% opacity + not-allowed cursor (no error styling exists yet).

### Navigation
- **Style:** filter tabs — transparent rest state, Text Secondary 600 12px, 6px 10px padding, 6px radius, horizontal scroll, `(count)` suffix in 11px 80% opacity.
- **Active:** Hover Step bg + platform accent text (popup) / Selected Tab Step bg + white text (overlay).
- **Mobile treatment:** tabs scroll horizontally rather than wrapping; no breakpoints exist — popup is fixed-width, modal is viewport-scaled.

### Signature: The Media Grid
The system's defining component: square (1/1) thumbnails in a bordered dark well (Inset Base), 2px transparent resting border that becomes the platform accent when selected, with a corner check overlay (dark translucent square → accent when selected) and bottom/left corner tags (9–10px, 700, dark translucent pill-lets) for video/format/resolution. Hover scales 1.02 (overlay) with cursor pointer. This grid IS the archive being built — treat every change to it as a change to the product's identity.

### Media Tags
- **Style:** dark translucent pill-lets (`rgba(0,0,0,0.75)` popup / 0.8 overlay), white 9–10px 700 text, 1px 4px / 2px 5px padding, 3–4px radius, absolutely positioned in grid-item corners (format top-right, video bottom-left, resolution bottom-right).

## Do's and Don'ts

### Do:
- **Do** recolor the entire accent set as a theme when the platform changes (buttons, selection borders, check overlays, progress, FAB, chip switch together).
- **Do** keep every saturated color status-coded: green = save, red = stop, platform accent = identity/selection.
- **Do** use 1px Hairline Borders + tonal layering for panel depth; reserve shadows for the FAB and modal shell.
- **Do** keep type in the system stack; use weight (400/600/700/800), 9–18px steps, and uppercase 10–11px micro-labels for hierarchy.
- **Do** keep the media grid square, accent-bordered on selection, with corner tags — it is the signature component.

### Don't:
- **Don't** add a second gradient; the Instagram badge gradient is the only one.
- **Don't** mix two platform accents on one screen.
- **Don't** introduce colored fills without status meaning (no decorative color in chrome).
- **Don't** add shadows inside popup/modal panels — the Flat-Panel Rule.
- **Don't** grow control sizes past 13px body / 11px labels; the compact operator density is deliberate (11–13px is the working range).
- **Don't** add a new typeface; the system stack carries all hierarchy.
