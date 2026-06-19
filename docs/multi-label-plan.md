# Plan: Multi-Label Support for Lines

## Problem Statement

Currently, the application enforces a **one-to-one** relationship between labels and elements:
- A **point** has exactly one label (its `labelBoxEl`).
- A **polygon** has exactly one label (its `labelBoxEl`).
- A **line** has exactly one label (its `labelBoxEl`).

For complex air routes, two new relationships are needed:

1. **One Line → Multiple Labels**: A single line (air route segment) may have multiple labels stacked on top of each other (e.g., overlapping routes diverging later).
2. **One Label → Multiple Lines**: A single label (route name) may span across multiple disconnected line segments (e.g., the same route name appearing on several segments before they diverge).

Testing must remain functional: clicking any line associated with a label should identify it, and clicking any label should identify/find all associated lines.

---

## Current Data Model (for reference)

```js
// points: { refPointEl, labelBoxEl, refX, refY, labelX, labelY, relRefX, relRefY, relLabelX, relLabelY, correctText, userGuess, type }
// polygons: { points[], labelBoxEl, svgPath, anchorPoint, anchorX, anchorY, relAnchorX, relAnchorY, relLabelX, relLabelY, type }
// lines:    { points[], labelBoxEl, polyline, anchorPoint, anchorX, anchorY, relAnchorX, relAnchorY, relLabelX, relLabelY, type }
```

Each element holds a **single** `labelBoxEl` reference.

---

## Proposed Data Model

### Option A: Bidirectional Mapping (Recommended)

Introduce a **label registry** and allow elements to reference multiple labels, and labels to reference multiple elements.

```js
// Label registry: each label is a unique entity
const labels = []; // { id, text, labelBoxEl, associatedLines: number[], associatedPoints: number[], associatedPolygons: number[] }

// points: { refPointEl, labelIds: [], refX, refY, labelX, labelY, relRefX, relRefY, relLabelX, relLabelY, type }
// polygons: { points[], labelIds: [], svgPath, anchorPoint, anchorX, anchorY, relAnchorX, relAnchorY, relLabelX, relLabelY, type }
// lines:    { points[], labelIds: [], polyline, anchorPoint, anchorX, anchorY, relAnchorX, relAnchorY, relLabelX, relLabelY, type }
```

**Key changes:**
- `labelBoxEl` moves from being a property of each element to being owned by the `labels` registry.
- Each element holds `labelIds: number[]` instead of a single `labelBoxEl`.
- Each label holds `associatedLines: number[]`, `associatedPoints: number[]`, `associatedPolygons: number[]` to track which elements it belongs to.

### Option B: Per-Element Label Arrays (Simpler, less cross-referencing)

Each element simply holds an array of label objects instead of a single one.

```js
// lines: { points[], labels: [{ labelBoxEl, text, ... }], polyline, anchorPoint, ... }
```

**Downside**: No easy way to find "all lines associated with label X" — you'd have to iterate all lines.

**Recommendation**: Use **Option A** for clean bidirectional lookups.

---

## Detailed Implementation Plan

### Phase 1: Data Model Migration

#### 1.1 Create the Label Registry
**File**: `app.js`
**Location**: Near existing data structures (lines ~20-28)

```js
// New: Label registry for multi-label support
const labels = []; // { id, text, labelBoxEl, associatedLines: [], associatedPoints: [], associatedPolygons: [] }
```

#### 1.2 Update Element Structures
**File**: `app.js`
**Affected locations**: All places where `points[]`, `polygons[]`, `lines[]` objects are created.

- Replace `labelBoxEl` with `labelIds: []` on all three element types.
- Replace `labelX`, `labelY`, `relLabelX`, `relLabelY` with arrays: `labelPositions: [{ labelX, labelY, relLabelX, relLabelY }]` (one per label).

### Phase 2: UI / Creation Flow

#### 2.1 `createLabel()` — Create a Label in the Registry
**File**: `app.js`
**Function**: `createLabel()` (line ~730)

- Instead of appending directly to `mapContainer`, create the labelBoxEl and register it in the `labels` registry.
- Return the label ID, not the element references.

#### 2.2 `addLabel()` — Assign Labels to Points
**File**: `app.js`
**Function**: `addLabel()` (line ~790)

- Create a new label in the registry.
- Push the label ID into `point.labelIds`.
- Render the labelBoxEl at the specified position.

#### 2.3 `finishCurrentShape()` — Assign Labels to Lines/Polygons
**File**: `app.js`
**Function**: `finishCurrentShape()` (line ~1190)

- For lines and polygons, create a label in the registry.
- Push the label ID into `line.labelIds` / `polygon.labelIds`.
- Register the line/polygon in the label's `associatedLines` / `associatedPolygons`.

#### 2.4 Multi-Label Addition UI for Lines
**File**: `app.js` + `index.html`

**New UI concept**: When a line is selected (in Move or Tag mode), provide a way to add additional labels to it.

- **Option**: Right-click a line → "Add Label" context menu.
- **Option**: Select a line in Tag mode → a "Labels" panel shows existing labels and has an "Add Label" button.
- **Option**: Double-click a line to add/edit a label on it.

**HTML changes** (`index.html`):
- Add a "Multi-Label" section to the Edit interface, or repurpose the Tag panel to support per-element label management.
- Add a modal/dialog for creating a new label and assigning it to multiple lines.

#### 2.5 Label-to-Multiple-Lines Assignment UI
**File**: `app.js` + `index.html`

When creating or editing a label, provide a way to assign it to multiple lines:
- After creating a label, show a "Assign to Lines" panel listing all lines.
- User can check/uncheck lines to associate the label with them.
- The label's `associatedLines` array is updated accordingly.

### Phase 3: Rendering & Leader Lines

#### 3.1 `updateLeaderLines()`
**File**: `app.js`
**Function**: `updateLeaderLines()` (line ~560)

**Current behavior**: Draws one leader line per element (point/polygon/line) to its single `labelBoxEl`.

**New behavior**:
- For each label in `labels`, draw leader lines from **all** associated elements to that label's `labelBoxEl`.
- If a label is associated with multiple lines, draw leader lines from each line's anchor point to the single label.
- If a point/line has multiple labels, draw separate leader lines from the element to each label.

```js
labels.forEach(label => {
    label.associatedLines.forEach(lineIdx => {
        const line = lines[lineIdx];
        // Draw leader line from line's anchor to label
    });
    label.associatedPoints.forEach(pointIdx => {
        const point = points[pointIdx];
        // Draw leader line from point's refPoint to label
    });
    label.associatedPolygons.forEach(polyIdx => {
        const poly = polygons[polyIdx];
        // Draw leader line from poly's anchor to label
    });
});
```

#### 3.2 `updateAllPositions()`
**File**: `app.js`
**Function**: `updateAllPositions()` (line ~2300)

- Update positions for all labelBoxEls in the registry (not per-element).
- Each element's `labelPositions` array maps to the correct label's position.

#### 3.3 Position Management for Multiple Labels
**File**: `app.js`

When a line has multiple labels, they need to be positioned without overlapping:
- Implement an auto-offset algorithm: the first label at (anchorX+20, anchorY+20), second at (anchorX+20, anchorY+50), etc.
- Or: let the user manually drag each label independently (already supported via pointer move).

### Phase 4: Testing Mode

#### 4.1 Test Item Preparation (`_toggleTestModeInternal`)
**File**: `app.js`
**Function**: `_toggleTestModeInternal()` (line ~2900)

**Current behavior**:
```js
testItems = [
    ...points.filter(...).map(p => ({ type: 'point', element: p.refPointEl, label: p.labelBoxEl })),
    ...polygons.filter(...).map(p => ({ type: 'polygon', element: p.svgPath, label: p.labelBoxEl })),
    ...lines.filter(...).map(l => ({ type: 'line', element: l.polyline, label: l.labelBoxEl }))
];
```

**New behavior**:
```js
testItems = labels
    .filter(label => selectedTags.includes(/* label's tag */))
    .map(label => ({
        type: 'label',
        labelId: label.id,
        labelBoxEl: label.labelBoxEl,
        // For find mode: all associated elements
        associatedElements: [
            ...label.associatedPoints.map(i => ({ type: 'point', element: points[i].refPointEl })),
            ...label.associatedPolygons.map(i => ({ type: 'polygon', element: polygons[i].svgPath })),
            ...label.associatedLines.map(i => ({ type: 'line', element: lines[i].polyline }))
        ]
    }));
```

#### 4.2 Identify Mode (`selectNextTestItem`)
**File**: `app.js`
**Function**: `selectNextTestItem()` (line ~3100)

- Highlight the label's `labelBoxEl`.
- Highlight **all** associated elements (lines, points, polygons).
- Highlight **all** associated leader lines.

#### 4.3 Find Mode (`handleFindModeClick`)
**File**: `app.js`
**Function**: `handleFindModeClick()` (line ~3050)

**Current behavior**: Checks if click is near the single `currentTestItem.element`.

**New behavior**: Check if click is near **any** of the associated elements:
```js
for (const assoc of currentTestItem.associatedElements) {
    if (checkClick(assoc)) { isCorrect = true; break; }
}
```

#### 4.4 Cleanup (`cleanupTest`)
**File**: `app.js`
**Function**: `cleanupTest()` (line ~2700)

- Reset highlighting on all associated elements, not just a single element.

### Phase 5: Save / Load

#### 5.1 `saveElements()`
**File**: `app.js`
**Function**: `saveElements()` (line ~2200)

**Current export**:
```json
{
    "points": [{ refX, refY, labelX, labelY, text, type }],
    "polygons": [{ points: [...], anchorX, anchorY, labelX, labelY, text, type }],
    "lines": [{ points: [...], anchorX, anchorY, labelX, labelY, text, type }]
}
```

**New export**:
```json
{
    "labels": [
        { id: 0, text: "Route A", type: "Airway", associatedPoints: [], associatedPolygons: [], associatedLines: [0, 2] },
        { id: 1, text: "Route B", type: "Airway", associatedPoints: [], associatedPolygons: [], associatedLines: [1] }
    ],
    "points": [
        { refX, refY, labelPositions: [{ labelX, labelY }], labelIds: [0], type }
    ],
    "polygons": [
        { points: [...], anchorX, anchorY, labelPositions: [{ labelX, labelY }], labelIds: [1], type }
    ],
    "lines": [
        { points: [...], anchorX, anchorY, labelPositions: [{ labelX, labelY }, { labelX, labelY }], labelIds: [0, 1], type }
    ]
}
```

#### 5.2 `loadElements()`
**File**: `app.js`
**Function**: `loadElements()` (line ~2270)

- Parse the new format.
- Rebuild the `labels` registry.
- Rebuild element structures with `labelIds` and `labelPositions`.
- Re-establish bidirectional associations.

#### 5.3 `getCurrentState()` / `hasUnsavedChanges()`
**File**: `app.js`

- Update to include the `labels` registry in the state comparison.

### Phase 6: Edit Operations

#### 6.1 Delete (`removeLabelAtPoint`)
**File**: `app.js`
**Function**: `removeLabelAtPoint()` (line ~900)

- When deleting a label from an element:
  - Remove the label from the element's `labelIds`.
  - Remove the element from the label's `associatedLines`/`associatedPoints`/`associatedPolygons`.
  - If the label has no more associations, remove the label entirely (including its `labelBoxEl`).

#### 6.2 Rename (`editLabelText` mode)
**File**: `app.js`

- When editing a label's text, update `labels[labelId].text`.
- Since multiple elements share the same label, editing one updates all references.

#### 6.3 Tag Mode (`changeTag` mode)
**File**: `app.js`

- When changing a tag on an element, update the tag on all associated labels.
- Update the tag on the label registry entry.

#### 6.4 Move Mode
**File**: `app.js`

- When moving an element, update leader lines for **all** labels associated with that element.
- Each label's position is independent, so dragging a label moves only that label.

### Phase 7: Tag Panel & Highlighting

#### 7.1 `renderTagPanel()`
**File**: `app.js`
**Function**: `renderTagPanel()` (line ~3700)

- Update element counts to count by **labels** rather than elements (or show both).
- Hovering a tag should highlight all labels of that tag type and all their associated elements.

#### 7.2 `highlightElementsWithTag()` / `removeElementHighlighting()`
**File**: `app.js`

**New behavior**:
```js
function highlightElementsWithTag(tag) {
    labels.filter(l => l.type === tag).forEach(label => {
        label.labelBoxEl.classList.add('tag-hover-highlight');
        label.associatedLines.forEach(i => highlightLineElements(lines[i]));
        label.associatedPoints.forEach(i => highlightPointElements(points[i]));
        label.associatedPolygons.forEach(i => highlightPolygonElements(polygons[i]));
    });
}
```

#### 7.3 `getElementCountForTag()`
**File**: `app.js`

- Update to count unique labels of the given tag type.

### Phase 8: Tag Visibility

#### 8.1 `updateTagVisibilityOnMap()`
**File**: `app.js`
**Function**: `updateTagVisibilityOnMap()` (line ~4500)

- Update visibility based on label registry entries.
- If a label is hidden, hide all its associated elements (or keep elements visible but hide only the label).

### Phase 9: Identify Test Visibility

#### 9.1 `setIdentifyTestVisibility()` / `restoreIdentifyTestVisibility()`
**File**: `app.js**

- Update to work with the label registry.
- Show/hide labels and all their associated elements.

---

## Files That Need Changes

| File | Functions / Sections to Modify |
|------|-------------------------------|
| `app.js` | Data structures (lines ~20-28) |
| `app.js` | `createLabel()` (~line 730) |
| `app.js` | `addLabel()` (~line 790) |
| `app.js` | `finishCurrentShape()` (~line 1190) |
| `app.js` | `deleteLine()` / `deletePolygon()` |
| `app.js` | `updateLeaderLines()` (~line 560) |
| `app.js` | `removeLabelAtPoint()` (~line 900) |
| `app.js` | `updateAllPositions()` (~line 2300) |
| `app.js` | `saveElements()` (~line 2200) |
| `app.js` | `loadElements()` (~line 2270) |
| `app.js` | `getCurrentState()` |
| `app.js` | `_toggleTestModeInternal()` (~line 2900) |
| `app.js` | `selectNextTestItem()` (~line 3100) |
| `app.js` | `handleFindModeClick()` (~line 3050) |
| `app.js` | `cleanupTest()` (~line 2700) |
| `app.js` | `renderTagPanel()` (~line 3700) |
| `app.js` | `highlightElementsWithTag()` / `removeElementHighlighting()` |
| `app.js` | `getElementCountForTag()` |
| `app.js` | `updateTagVisibilityOnMap()` (~line 4500) |
| `app.js` | `setIdentifyTestVisibility()` / `restoreIdentifyTestVisibility()` |
| `app.js` | Tag change mode click handler |
| `app.js` | `updateCursorStyles()` |
| `index.html` | New UI for multi-label assignment (modal/panel) |
| `style.css` | Styles for multi-label UI elements |

---

## Implementation Order (Recommended)

1. **Phase 1** — Data model migration (foundation for everything else)
2. **Phase 2** — UI for creating/assigning multi-labels
3. **Phase 3** — Rendering updates (leader lines, positions)
4. **Phase 5** — Save/Load (so changes persist)
5. **Phase 4** — Testing mode (builds on rendering)
6. **Phase 6** — Edit operations (delete, rename, tag, move)
7. **Phase 7-9** — Tag panel, visibility, and test visibility helpers

---

## Edge Cases & Considerations

1. **Label collision**: When multiple labels are on the same line, they should auto-offset vertically to avoid overlapping.
2. **Leader line clutter**: A label associated with 5+ lines will have many leader lines converging on one box. Consider visual distinction (e.g., dashed lines for secondary associations).
3. **Deletion cascade**: Deleting a line should not delete its labels if other lines/elements still reference them. Only delete a label when it has zero associations.
4. **Drag behavior**: Dragging a shared label should move it for all associated elements simultaneously.
5. **Backward compatibility**: The load function should handle the old single-label format and migrate it to the new format.
6. **Performance**: With many labels and associations, leader line updates and hit-testing need to remain responsive. Consider using `requestAnimationFrame` batching.

---

## Testing Strategy

- **Unit tests** for the label registry (add/remove/associate operations).
- **Integration tests** for save/load round-trip with multi-label data.
- **Manual testing** for:
  - Creating a line with multiple labels.
  - Creating a label and assigning it to multiple lines.
  - Find mode: clicking any associated line identifies the label.
  - Identify mode: the label text is shown, clicking any associated line is accepted.
  - Deleting a line that shares a label with another line — label persists.
  - Saving and reloading — multi-label structure is preserved.
