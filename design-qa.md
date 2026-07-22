# Design QA

- Source visual truth:
  - `/var/folders/cf/ldx5fc_j5md5y50ppnwstddw0000gn/T/codex-clipboard-e84b5f03-8385-4e46-8ebf-d73d2bf4a56e.png`
  - `/var/folders/cf/ldx5fc_j5md5y50ppnwstddw0000gn/T/codex-clipboard-70a67c80-58b8-4985-a00f-aa9ce36859a4.png`
- Implementation screenshots:
  - `/tmp/jiucai-box-captures/watchlist-list.png`
  - `/tmp/jiucai-box-captures/watchlist-kline.png`
  - `/tmp/jiucai-box-captures/watchlist-kline-compact.png`
- Combined comparisons:
  - `/tmp/jiucai-box-captures/qa-list-comparison.png`
  - `/tmp/jiucai-box-captures/qa-chart-comparison.png`
- Viewports: 1440 × 900 and 1120 × 760.
- States: watchlist default, first row expanded, timeline + MACD, daily K + KDJ, compact layout.

## Full-view comparison evidence

- The standalone selected-instrument card above the filters is gone. The default state now proceeds directly from the page heading to filters and the table.
- Selecting a table row inserts the full K-line module immediately below that row. The selected row keeps a restrained green marker and an up-chevron, so the relationship remains visible.
- The right-side timeline now uses a price line, average-price line, area fill, real price axis and latest-price marker. Daily and weekly periods render real OHLC candles instead of close-price bars.
- Existing layout, typography, neutral palette, compact table density and right-side decision panel remain unchanged outside the annotated areas.

## Focused region comparison evidence

- Watchlist header/table: no redundant selected-instrument card remains; the row action column exposes expand/collapse and delete as separate controls.
- Expanded row: identity, OHLCV readout, all period controls, main indicators and sub-indicators remain available inside the table context.
- Right chart: the dense striped pattern shown in the source is no longer present. At the same panel width the trend, average and current price are legible.
- Compact state: heading actions wrap as a group, labels do not overlap, and the K-line period/indicator controls remain usable.

## Findings

- No actionable P0, P1 or P2 mismatch remains for the requested annotations.

## Required fidelity surfaces

- Fonts and typography: retained the product's system font stack, compact weights and tabular numerals; no clipped chart labels were observed.
- Spacing and layout rhythm: removed the redundant top block, kept table density, and attached expanded content directly to its source row.
- Colors and visual tokens: reused the existing neutral, red, green, amber and blue tokens; no new theme treatment was introduced.
- Image quality and asset fidelity: no new raster assets were needed; supplied app logo and Lucide controls remain sharp.
- Copy and content: preserved the current product wording and only changed interaction affordances required by the annotations.

## Comparison history

1. P1: K-line detail occupied a permanent block above the table. Fixed by moving expansion state into each watchlist row.
2. P1: Clicking a row only changed selection. Fixed with mouse/keyboard expand and collapse behavior plus a dedicated chevron control.
3. P1: The right timeline rendered close values as dense pseudo-candles. Fixed with a real timeline path and OHLC candles for K-line periods.
4. P2: At the compact viewport the heading action labels wrapped inside individual buttons. Fixed by wrapping the action group and keeping button labels on one line.

## Follow-up polish

- None required for this scoped change.

Previous scope result: passed

---

# Design QA: Conversation Preview

- Source visual truth: `/var/folders/cf/ldx5fc_j5md5y50ppnwstddw0000gn/T/codex-clipboard-d4a40e35-5d10-42da-8826-99ffe96863c1.png`
- Implementation screenshot: `/tmp/jiucai-conversation-preview-qa/conversation-preview.png`
- Focused implementation crop: `/tmp/jiucai-conversation-preview-qa/conversation-preview-focus.png`
- Combined comparison: `/tmp/jiucai-conversation-preview-qa/conversation-preview-comparison.png`
- Viewport: 1440 × 900.
- State: recent conversation hovered, session loaded, completed state, two attachments.

## Full-view comparison evidence

- The preview opens beside the hovered conversation without changing the active page, matching the reference interaction model.
- The card stays above the main workspace and does not shift the sidebar or conversation layout.
- The implementation keeps the existing compact sidebar proportions instead of copying Codex's wider project sidebar.

## Focused region comparison evidence

- Both cards present the same information order: title, completion state, recent content and attachment summary.
- The implementation adds the product's existing conversation icon and separates state, message count and update time for faster scanning.
- The reference's project activity rail is intentionally omitted because it belongs to Codex project navigation, not the conversation preview itself.

## Findings

- No actionable P0, P1 or P2 mismatch remains for the requested hover-preview behavior.

## Required fidelity surfaces

- Fonts and typography: retained the product's system font stack and compact text scale; the title truncates safely and the excerpt clamps to three lines.
- Spacing and layout rhythm: card spacing follows the reference hierarchy while fitting the 236 px app sidebar; the viewport-edge clamp prevents off-screen rendering.
- Colors and visual tokens: reused the existing neutral surfaces plus green and blue semantic states; contrast remains legible.
- Image quality and asset fidelity: no new raster assets were required; existing Lucide icons remain sharp. Real image attachments use their local thumbnails when available.
- Copy and content: uses beginner-friendly product language and real session content rather than placeholder text.

## Interaction and state checks

- Hover delay, loaded state, direct-open click, keyboard focus, Escape close and hover transfer from row to card were implemented.
- Loading, unread, busy, no-message and no-attachment states have explicit fallbacks.
- The existing archive menu remains independent and closes the preview before opening.

## Comparison history

1. Initial implementation matched the reference card hierarchy on the first focused comparison.
2. Existing archive controls were rechecked after capture; no collision or focus conflict remained.

## Follow-up polish

- P3: a future iteration could show richer image thumbnails once more conversations contain image attachments.

Previous scope result: passed

---

# Design QA: In-chat Conversation History

- Source visual truth: `/var/folders/cf/ldx5fc_j5md5y50ppnwstddw0000gn/T/codex-clipboard-d4a40e35-5d10-42da-8826-99ffe96863c1.png`
- Implementation screenshot: `/tmp/jiucai-history-qa/conversation-history.png`
- Focused implementation crop: `/tmp/jiucai-history-qa/conversation-history-focus.png`
- Combined comparison: `/tmp/jiucai-history-qa/conversation-history-comparison.png`
- Viewport: 1440 × 900.
- State: four-turn conversation, second history marker hovered, preview open, conversation scrolled near the latest reply.

## Full-view comparison evidence

- The history rail sits at the far left of the current conversation pane and overlays unused margin instead of reducing message width.
- Four compact markers represent four user-led turns. The visible turn uses a stronger marker, while the remaining turns stay quiet.
- The preview opens beside the selected marker and stays above conversation content without moving the layout.

## Focused region comparison evidence

- The source and implementation share the same interaction hierarchy: narrow marker rail, one emphasized marker and a floating summary card to its right.
- The implementation uses the current product's smaller radius, neutral colors and beginner-friendly Chinese copy rather than importing unrelated Codex project language.
- Long titles and summaries are safely truncated or clamped; attachment names are shown only when that turn contains attachments.

## Findings

- No actionable P0, P1 or P2 mismatch remains for the requested in-chat history behavior.

## Required fidelity surfaces

- Fonts and typography: retained the app's system font stack, compact scale and readable line height; the preview hierarchy remains clear at 1440 × 900.
- Spacing and layout rhythm: the rail remains inside the conversation pane's unused left margin, and the preview has enough separation from both the rail and message content.
- Colors and visual tokens: reused the existing white, neutral border, muted text and active charcoal tokens.
- Image quality and asset fidelity: no raster assets were needed; marker controls use the existing Lucide icon library and render sharply.
- Copy and content: previews use the real user question, the latest answer from that turn, time and attachments without technical terms.

## Interaction and state checks

- Hover, keyboard focus, Escape close, pointer transfer to preview and click-to-jump are implemented.
- The active marker follows conversation scrolling.
- Automated capture confirmed clicking the first marker reduced the conversation scroll position; the run fails if the jump does not occur.
- Sessions with fewer than two turns hide the rail; long sessions scroll inside the rail without showing a second scrollbar.

## Comparison history

1. The first implementation matched the reference structure in the focused side-by-side comparison.
2. Full-view verification confirmed the rail does not cover messages or the composer, so no P0/P1/P2 visual fix was required.

## Follow-up polish

- P3: if future sessions regularly exceed dozens of turns, marker grouping by conversation stage could improve scanning further.

Previous scope result: passed

---

# Design QA: Conversation History Visual Polish

- Source visual truth:
  - Idle: `/var/folders/cf/ldx5fc_j5md5y50ppnwstddw0000gn/T/codex-clipboard-91b99059-0ab7-41e6-b373-baeb7c0a8f85.png`
  - Selected: `/var/folders/cf/ldx5fc_j5md5y50ppnwstddw0000gn/T/codex-clipboard-ed39cf15-404c-4336-8f5e-f210953a1ed4.png`
- Implementation screenshots:
  - Idle: `/tmp/jiucai-history-polish-final/conversation-history-idle.png`
  - Selected: `/tmp/jiucai-history-polish-final/conversation-history-selected.png`
  - Selected focused crop: `/tmp/jiucai-history-polish-final/conversation-history-focus.png`
- Combined comparisons:
  - Idle: `/tmp/jiucai-history-polish-final/qa-history-idle-comparison.png`
  - Selected: `/tmp/jiucai-history-polish-final/qa-history-selected-comparison.png`
- Viewport: 1440 × 900.
- States: no hover and second history marker hovered.

## Full-view comparison evidence

- Idle markers are now uniformly short, closely spaced and low contrast, matching the quiet Codex default state.
- The current reading position is distinguished by tone only; it no longer becomes a long heavy marker before interaction.
- Hovering a marker creates a fish-eye progression: selected marker longest, immediate neighbours medium, distant markers short.
- The selected preview is compact and floats beside the rail without changing conversation layout.

## Focused region comparison evidence

- The implementation removed the extra round label and timestamp that made the earlier card busier than the Codex reference.
- The card now follows the reference order: title, two-line answer summary and optional attachment.
- Marker controls retain a stable 16 px hit row while their visible line width changes, preventing hover jitter between neighbouring items.

## Findings

- No actionable P0, P1 or P2 mismatch remains for the idle and selected states.

## Required fidelity surfaces

- Fonts and typography: compact system text, a single 11 px title and a muted 10 px two-line summary match the reference density.
- Spacing and layout rhythm: 16 px marker rows and zero visual gap create the narrow vertical rhythm shown by Codex; the preview uses 12 px padding and an 8 px radius.
- Colors and visual tokens: idle, current and selected states use progressively stronger neutral grays with no colored decoration.
- Image quality and asset fidelity: no raster assets are required; horizontal markers and attachment indicators use the installed Lucide icon set.
- Copy and content: only the user's question, the answer summary and real attachment name remain.

## Comparison history

1. P2: the earlier idle state used long, widely spaced markers and made the current marker too prominent. Fixed with uniform 8 px idle markers and 16 px rows.
2. P2: the earlier selected state lacked a clear expansion hierarchy. Fixed with 34/22/14/8 px proximity-based widths.
3. P2: the preview included extra round and time metadata and clamped to three lines. Fixed by removing metadata and reducing the answer to two lines.
4. Post-fix combined screenshots show the same quiet idle state and expanded selected state as the two references.

## Follow-up polish

- None required for this scoped visual correction.

final result: passed
