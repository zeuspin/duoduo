# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable Design Decisions

- The product is a dense macOS operational tool, not a marketing surface.
- Avoid rounded cards, pills, and nested containers.
- Content areas, rows, player, transcript lines, alerts, and status blocks use square corners.
- Border radius is reserved for the top header or temporary menus and must not exceed 6px.
- Content cards, buttons, status labels, dialogs, and toast messages use square corners; semantic circles such as avatars, counts, and status dots are exempt.
- Visual language follows the supplied Admindek course dashboard reference: fixed dark sidebar, light top bar, spacious gray workspace, image-led card grid, compact data rows, and restrained blue actions.
- Viewing a room, monitoring a room, and playing a room are separate actions and states.
- Multiple rooms may run silent monitoring and ASR, while at most one room plays audible audio.
- Monitored rooms use full-width horizontal work cards with their own live ASR feed on the right; ASR from different rooms is never merged into one reading stream.
- Unmonitored rooms use compact image-led cards. Starting or stopping monitoring moves the room between the two sections and changes the card layout.
- Do not include a notification center or a persistent sidebar load/monitor-count summary in the first feature.
- The appearance system uses the six 观风 palettes (宣纸墨、观海蓝、松石青、朱砂红、玄黑金、云雾紫); Apple-style translucent glass is a shared material treatment across all six themes, not a separate theme.
