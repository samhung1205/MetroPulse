# MetroPulse UI/UX Redesign — Batch C Implementation

## Scope

Batch C only changes Station Detail and Analytics. It preserves the Batch A query-state architecture and Batch B homepage, recommendation list, score evidence, methodology, tokens, shared header, and MRT route semantics. It does not change recommendation ranking, weights, normalization, PageRank, gamma, station identity, D1 schema, or real/synthetic selection.

## Files changed

- `src/index.ts`: recommendation-context links and restoration; Station Detail and Analytics page structure, rendering, states, chart behavior, and keyboard interactions.
- `public/static/styles.css`: shared light-system layouts and responsive styles for Station Detail and Analytics.
- `src/routes/station-detail.ts`: additive preference availability and source metadata only; existing query and aggregation semantics remain unchanged.
- `src/lib/types.ts`: aligns the Y route token with the approved Batch B semantic color.
- `README.md`: current page behavior, project structure, and usage guidance.
- `docs/uiux/06-batch-c-implementation.md`: this implementation record.

## Station Detail information architecture

The detail page now follows this order:

1. Return to the current recommendation, or start a recommendation for a direct deep link.
2. Station identity: Chinese and English names, route code badges, district, and transfer information supported by current station data.
3. Relationship to the current query, only when validated recommendation context exists.
4. Station features and tag reasons, with the current preference first.
5. Secondary “use this station as origin” action.
6. Supporting evidence in PageRank, preference, then flow order.

Charts no longer precede the identity, recommendation relationship, or station features. The page uses typography, spacing, dividers, definition rows, and only necessary surfaces instead of a dashboard card stack.

## Recommendation context and navigation

Recommendation-result links include the validated `from`, `time_period`, and `preference` values plus an explicit `context=recommendation` marker. The Detail page validates the station-code format and the allowed period/preference values before showing query-specific content.

“返回本次推薦” is a deterministic URL rather than a history-only action:

```text
/?from={origin}&time_period={period}&preference={preference}&restore=recommendations#results-section
```

The homepage loads the station list, restores the selected origin and controls, re-runs the recommendation, and focuses the result heading. A direct `/station/:id` shows “返回開始推薦” and does not invent a prior query. “改以此站出發” replaces only `from`; when context exists it keeps the previous period and preference without submitting automatically.

## Station data explanation and chart accessibility

- The recommendation relationship reuses exact API reasons and relative connection evidence. It does not estimate station count, transfer count, or travel time.
- PageRank uses the complete six-period order and calls out the highest PageRank period as relative network importance, not real-time crowding or a best visiting time.
- Preference tags/reasons appear before charts. The API now supplies an additive `availability` array, allowing the UI to say “資料不足” when a tag is missing instead of presenting the legacy fallback zero as an observed zero.
- The preference radar remains supporting evidence. Every dimension is repeated in a text/data table.
- Flow labels distinguish `本站 → 目的地` from `來源站 → 本站`. The UI discloses that outbound prioritizes afternoon (otherwise the first available period), while inbound selects each origin's maximum across periods. Each displayed row includes its actual period.
- The Detail API does not expose connection-month provenance. The UI states this as unknown and identifies the existing `pagerank_scores` and `transition_matrix` sources without inferring a shared month.
- Each canvas has an accessible name, a visible heading and explanation, and a same-source table or data list. Animation is disabled when `prefers-reduced-motion: reduce` is active.

## Analytics information architecture

Analytics is now a secondary MetroPulse workspace in the same shared light header, background, typography, and token system. The content order is:

1. Analysis controls for month, period, and Top N.
2. A live summary of the current data scope.
3. Ranking and comparison tabs.
4. Station/month data and multi-month trend when available.
5. Data definitions and limitations.

The station selector accepts an explicit station code or an unambiguous station name. Duplicate names are not mapped to a guessed canonical station; the UI asks for a station code.

## Analytics correctness fixes

- Ranking rows and the horizontal comparison chart both use the selected Top 10, 20, or 30. The chart takeaway states the actual count and highest station.
- One available month is labelled “月份資料” and explicitly says it is insufficient for trend interpretation. “跨月份 PageRank 趨勢” and the line chart appear only with two or more months.
- Ranking and station-month requests use abortable request identity checks. Loading, empty, and error states are inline; controls remain available, stale rows/charts are cleared, and retry actions preserve the current inputs.
- Tabs implement `tablist`, `tab`, `tabpanel`, `aria-selected`, `aria-controls`, roving `tabindex`, arrow keys, and Home/End. The active state uses shape/underline and text weight in addition to color.
- Ordinary ranking bars use one neutral accent. MRT route colors are reserved for code badges. Charts avoid gradients, glow, and decorative multi-color encoding.
- Axis units, visible titles, concise takeaways, accessible canvas names, and readable row/table alternatives keep tooltips from being the only numeric source.

## Verification

### Build

- `npm run build`: passed with Vite 6.4.2; 37 modules transformed.

### Station Detail

- Tested `BL11 → night → food`, opened the first result `BL12 台北車站`, then returned through the deterministic link.
- The homepage restored `BL11`, night, food, the result heading focus, and the same five results/scores: BL12 0.79, BL10 0.38, R11 0.38, BL18 0.37, BL15 0.33.
- Direct `/station/BL12` rendered correctly with “返回開始推薦” and no fabricated relationship section.
- “改以此站出發” produced `/?from=BL12&time_period=night&preference=food`, restored all controls, and did not auto-submit.
- PageRank, radar, data alternatives, flow directions, inline error, and successful retry were checked in a real browser.

### Analytics

- Top 10/20/30 produced exactly 10/20/30 ranking rows and 10/20/30 chart labels.
- `BL12` morning peak returned one row, “月份資料”, the insufficient-trend message, and no trend chart.
- Tab arrow and Home/End navigation, station selection, controls, loading, empty, simulated HTTP failure, and successful retry were checked in a real browser.

### Responsive and accessibility checks

- Station Detail with and without recommendation context, and Analytics, were checked at 320, 375, 390, 768, 1024, and 1440 CSS-pixel widths. No page-level horizontal overflow was found; two-dimensional tables use local scrolling.
- Heading hierarchy, main/navigation/footer landmarks, labelled controls, live status regions, route code plus color, chart names, data alternatives, focus restoration, keyboard tabs, and reduced-motion chart settings were checked.
- Physical VoiceOver/NVDA and Safari testing remains a final manual verification; this implementation does not claim site-wide WCAG certification.

## Deferred to Batch D — Advanced Map UX

- Complete map pan/zoom interaction.
- Canonical transfer-station identity redesign.
- Station-coordinate rewrite.
- Keyboard navigation for 100+ map stations.

## Data issues intentionally not changed

- The Detail endpoint's outbound and inbound data use different existing period-selection/aggregation behavior; Batch C discloses it rather than changing `src/db/queries.ts` semantics.
- Detail connection-month provenance is unavailable.
- Some legacy tag scores use zero as a fallback; the additive availability flag separates missing presentation without changing stored scores.
- Station identity and transfer duplicates remain as currently modelled.
- Recommendation ranking, weights, normalization, PageRank calculation, gamma, real/synthetic selection, D1 schema, and existing data selection remain untouched.
