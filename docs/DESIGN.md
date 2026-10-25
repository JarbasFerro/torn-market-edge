# Market Edge design system

Market Edge lives inside Torn's pages, mostly on a phone in Torn PDA. It should read as one product on every surface, take as little room from Torn as possible, and put the number the player acts on first.

The stylesheet is the `CSS` constant in `src/parts/04.part.js`. Every size and colour below is a token there; use the token, not a raw value.

## Principles

1. **The decision first.** Each line leads with the number to act on: a $/hour, a price to set, a profit. Supporting figures follow in muted text, and the reasoning goes behind "?".
2. **Dense, not cramped.** Rows are about 22 px tall, buttons 22 px in rows and 26 px in panels. On touch screens an invisible margin (`--me-hit`) around every control keeps it easy to tap without making it look bigger.
3. **Quiet unless it matters.** Neutral or losing rows fade to one muted word ("Loss", "Sold out"). Fair-priced browse cards get no chip at all. Colour is reserved for what deserves attention.
4. **Torn's layout is never pushed around.** Strips go in their own line or as an overlay; they never squeeze into Torn's text or change a fixed-size card.

## Identity

- **The state edge.** A 3 px coloured left edge marks everything Market Edge adds: strips, cards, toasts and travel cards. It is the brand mark; rows do not carry an "ME" label.
- **State colours:** green `--me-good` (good, best, filled), amber `--me-warn` (worth considering, warning), red `--me-bad` (risk), grey `--me-strip-border` (neutral). Colour is never the only signal: a word ("BEST", "Loss", "Filled") always goes with it.
- **The tab.** A slim "ME" tab on the right edge is the only floating element. It shows a green count when deals are on screen.
- **Theme.** Tokens follow Torn's `body.dark-mode`, so everything sits naturally on light and dark Torn.

## Tokens

| Group | Tokens |
|---|---|
| Type | `--me-fs-xs` 10, `--me-fs-sm` 11, `--me-fs-md` 12, `--me-fs-lg` 13, `--me-fs-xl` 15 px; `--me-font` Arial. Figures use tabular numerals. |
| Space | `--me-s1` 2, `--me-s2` 4, `--me-s3` 6, `--me-s4` 8, `--me-s5` 12 px |
| Controls | `--me-ctl-sm` 22 px (rows), `--me-ctl` 26 px (panels), `--me-hit` 4 px (7 px on touch screens) |
| Shape | `--me-r-sm` 3, `--me-r` 5, `--me-r-lg` 7 px; `--me-edge` 3 px |
| Colour | `--me-bg`, `--me-bg-2`, `--me-fg`, `--me-muted`, `--me-faint`, `--me-border`, `--me-strip`, `--me-strip-border`, `--me-good` / `--me-warn` / `--me-bad` with `-bg` tints, `--me-btn*`, `--me-on-good`, `--me-shadow` |

Text roles: kicker (10 px, uppercase, muted) for section labels, primary (12 to 13 px bold) for the number to act on, secondary (11 px muted) for supporting figures, note (10 px muted) for small print.

## Components

| Component | Class | Use |
|---|---|---|
| Strip | `.me-inline-analysis` | Market Edge's line on a Torn row. Inline, `.me-row-line` (full width under the row) or `.me-inline-block` (own line in the text column). State class `GREEN` / `YELLOW` / `RED` / `GREY` sets the edge; `.me-muted` fades it. |
| Sell strip | `.me-fill-strip` | Sell forms: price first, origin second, one action (Fill, or Filled with Undo). |
| Browse chip | `.me-browse-chip` | Overlay on fixed-size cards; takes no space. Only for deals. |
| Card | `.me-card` | Grouped content inside Torn pages (abroad best-trip plan). `.me-card-section` divides it. |
| Fill bar | `.me-fill-bar` | Bulk action above a sell form. |
| Button | `.me-btn` (panel, 26 px), `.me-bazaar-fill-btn` / `.me-ah-remind` / `.me-key-cta` (in rows, 22 px) | One family. A green border marks the primary action. |
| Tag | `.me-tag` | Solid green label such as "BEST". |
| Chip | `.me-chip`, `.me-chip-link` | Context facts (slots, cash, flight) and the dashed "change" link. |
| Why | `.me-why-toggle`, `.me-why` | The "?" and its explanation. No `title` tooltips anywhere: mobile webviews pop them up over the row. |
| Panel | `#market-edge-root`, `.me-shell`, `.me-header`, `.me-body` | Floating panel; header 34 px. |
| Travel card | `.me-trip` | Ranked country cards in the travel plan. |
| Launcher | `.me-launcher`, `.me-launcher-badge`, `.me-launcher-menu` | Edge tab, deal count, page-aware menu. |
| Toast | `.me-toast` | Alerts; state edge like everything else. |

## Copy

- Money: short form in secondary text (`$13.7k`, `$7.21m`), exact dollars only where the player types or compares them.
- Separator: a middle dot ` · `.
- Units: "1 unit", "28 units". No "+$0" on things that cannot be bought: say why instead ("Sold out", "No slots left", "Not enough cash").
- Write in words a player uses: "under value", "per trip", "round trip", "Filled".

## Rules for new UI

- Start from an existing component; add a new one here before using it.
- Rules on elements inside Torn's markup need `!important`; panel, menu and dialog rules do not.
- Never set a fixed height on a Torn element. If Market Edge content would overflow a card Torn sizes, use an overlay (see `fitInlineBlock`).
- Check new UI at 390 px wide in dark mode before release.
