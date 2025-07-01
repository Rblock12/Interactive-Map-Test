const mapContainer = document.getElementById('mapContainer');
const leaderLinesSVG = document.getElementById('leaderLines');
const shapesLayer = document.getElementById('shapesLayer');
const mapImage = document.getElementById('mapImage');
const mapFileInput = document.getElementById('mapFileInput');
const mainMenu = document.getElementById('mainMenu');
const loadMapElement = document.getElementById('loadMapElement');
const pageContainer = document.querySelector('.page-container');

let editEnabled = false;
let currentMode = null;
let currentShape = null;
let currentShapePoints = [];

// Testing mode variables
let testItems = [];
let currentTestItem = null;
let remainingTestItems = [];
let testingMode = false;

let draggingPointLabel = null;
let draggingRefPoint = null;
let draggingPolygonPoint = null;
let draggingPolygonLabel = null;
let draggingLinePoint = null;
let draggingLineLabel = null;
let draggingPolygonAnchor = null;
let draggingLineAnchor = null;

let dragOffsetX = 0;
let dragOffsetY = 0;

// label structure: { refPointEl, labelBoxEl, refX, refY, labelX, labelY, correctText, userGuess }
const points = [];
// polygon structure: { points: [{x, y, element}], labelBoxEl, svgPath }
const polygons = [];
// line structure: { points: [{x, y, element}], labelBoxEl, polyline, anchorPoint, anchorX, anchorY }
const lines = [];

// Unsaved changes tracking - stores the baseline data for comparison
let baselineData = null;

// Function to handle keyboard events for label text boxes
function handleLabelKeydown(e) {
    if (e.key === 'Enter') {
        if (e.shiftKey) {
            // Shift+Enter: Allow new line (default behavior)
            return;
        } else {
            // Enter: Remove focus from the text box
            e.preventDefault();
            e.target.blur();
            return;
        }
    }
}

// Initialize UI state
document.addEventListener('DOMContentLoaded', () => {
    const editTools = document.querySelector('.edit-tools');
    editTools.classList.remove('visible');
    editEnabled = false;

    // Ensure all edit buttons are disabled initially
    setEditButtonsEnabled(false);

    // Initialize SVG size to match container
    updateSVGDimensions();

    // Initialize leader lines
    updateLeaderLines();

    // Add event listener for finish drawing button
    const finishDrawingBtn = document.getElementById('finishDrawingBtn');
    const cancelDrawingBtn = document.getElementById('cancelDrawingBtn');

    finishDrawingBtn.addEventListener('click', () => {
        if (currentMode === 'polygon' || currentMode === 'line') {
            finishCurrentShape();
            document.getElementById('finishDrawingInterface').style.display = 'none';
            setSidebarButtonsEnabled(true);
        }
    });

    cancelDrawingBtn.addEventListener('click', () => {
        abortCurrentDrawing();
        document.getElementById('finishDrawingInterface').style.display = 'none';
        setSidebarButtonsEnabled(true);
    });

    function abortCurrentDrawing() {
        // Remove any in-progress points
        if (currentShapePoints && currentShapePoints.length > 0) {
            currentShapePoints.forEach(point => {
                if (point.element && point.element.parentNode) {
                    point.element.classList.add('removing');
                    setTimeout(() => point.element.remove(), 300);
                }
            });
            currentShapePoints = [];
        }
        // Remove preview line if it exists
        const previewLine = document.getElementById('previewLine');
        if (previewLine) previewLine.remove();
        currentShape = null;

        // Re-enable all buttons after cancelling shape
        setSidebarButtonsEnabled(true);

        // Keep the mode (polygon/line) active so user can start again
    }

    // Add MutationObserver to watch for layout changes
    const observer = new ResizeObserver(entries => {
        requestAnimationFrame(() => {
            updateSVGDimensions();
            updateAllPositions();
            updateLeaderLines();
            updateInProgressShapePositions();
        });
    });
    observer.observe(document.querySelector('.map-viewport'));

    // Initialize help modal functionality
    initializeHelpModal();

    // Initialize collapsible interface functionality
    initializeCollapsibleInterfaces();

    // Add beforeunload event listener to warn about unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (hasUnsavedChanges()) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            return e.returnValue;
        }
    });
});

// Collapsible Interface Functions
function initializeCollapsibleInterfaces() {
    // Add event listeners to toggle buttons
    document.querySelectorAll('.interface-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetId = toggle.getAttribute('data-target');
            const content = document.querySelector(`[data-interface="${targetId}"]`);
            toggleInterface(content, toggle);
        });
    });

    // Add event listeners to headers for click-to-toggle (only on larger screens)
    document.querySelectorAll('.loadsave-header, .test-header, .edit-header').forEach(header => {
        header.addEventListener('click', (e) => {
            // Only allow header clicks on larger screens
            if (window.innerWidth >= 1024) {
                // Don't trigger if clicking on interactive elements
                if (e.target.closest('button, input, select, textarea')) {
                    return;
                }

                const toggle = header.querySelector('.interface-toggle');
                const targetId = toggle.getAttribute('data-target');
                const content = document.querySelector(`[data-interface="${targetId}"]`);
                toggleInterface(content, toggle);
            }
        });
    });

    // Add event listeners to tab buttons to expand corresponding interface
    document.querySelectorAll('.tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
            // Wait a bit for the tab switch to complete
            setTimeout(() => {
                const activeTab = document.querySelector('.tab-radio:checked');
                if (activeTab) {
                    const tabName = activeTab.id.replace('tab-', '');
                    const targetContent = document.querySelector(`[data-interface="${tabName}-content"]`);
                    const toggle = document.querySelector(`[data-target="${tabName}-content"]`);
                    if (targetContent && toggle) {
                        expandInterface(targetContent, toggle, toggle.closest('.loadsave-header, .test-header, .edit-header'));
                        collapseOtherInterfaces(targetContent);
                    }
                    // On small screens, enable edit mode when Edit tab is selected
                    if (window.innerWidth < 1024) {
                        if (tabName === 'edit') {
                            if (!editEnabled) toggleEditMode(true);
                        } else {
                            if (editEnabled) toggleEditMode(false);
                        }
                    }
                }
            }, 50);
        });
    });

    // Set initial state - expand the active tab's interface, collapse others
    const activeTab = document.querySelector('.tab-radio:checked');
    if (activeTab) {
        const tabName = activeTab.id.replace('tab-', '');
        const targetContent = document.querySelector(`[data-interface="${tabName}-content"]`);
        const toggle = document.querySelector(`[data-target="${tabName}-content"]`);
        if (targetContent && toggle) {
            expandInterface(targetContent, toggle, toggle.closest('.loadsave-header, .test-header, .edit-header'));
            collapseOtherInterfaces(targetContent);
        }
        // On small screens, enable edit mode if Edit tab is selected
        if (window.innerWidth < 1024 && tabName === 'edit') {
            if (!editEnabled) toggleEditMode(true);
        }
    }
}

function toggleInterface(content, toggle) {
    const isCollapsed = content.classList.contains('collapsed');
    const header = toggle.closest('.loadsave-header, .test-header, .edit-header');
    const isEdit = content.getAttribute('data-interface') === 'edit-content';

    if (isCollapsed) {
        // Expand this interface and collapse all others
        expandInterface(content, toggle, header);
        collapseOtherInterfaces(content);
        // On large screens, enable edit mode if Edit Map is twirled open
        if (window.innerWidth >= 1024 && isEdit && !editEnabled) {
            toggleEditMode(true);
        }
    } else {
        // Collapse this interface
        collapseInterface(content, toggle, header);
        // On large screens, disable edit mode if Edit Map is twirled closed
        if (window.innerWidth >= 1024 && isEdit && editEnabled) {
            toggleEditMode(false);
        }
    }
}

function expandInterface(content, toggle, header) {
    content.classList.remove('collapsed');
    toggle.classList.remove('collapsed');
    if (header) header.classList.remove('collapsed');
    toggle.setAttribute('title', 'Collapse interface');
}

function collapseInterface(content, toggle, header) {
    content.classList.add('collapsed');
    toggle.classList.add('collapsed');
    if (header) header.classList.add('collapsed');
    toggle.setAttribute('title', 'Expand interface');
}

function collapseOtherInterfaces(currentContent) {
    // Find all other interface contents and collapse them
    document.querySelectorAll('.interface-content').forEach(content => {
        if (content !== currentContent) {
            const toggle = document.querySelector(`[data-target="${content.getAttribute('data-interface')}"]`);
            const header = toggle ? toggle.closest('.loadsave-header, .test-header, .edit-header') : null;
            collapseInterface(content, toggle, header);

            // If this is the Edit Map interface being collapsed, disable edit mode on large screens
            if (content.getAttribute('data-interface') === 'edit-content' && window.innerWidth >= 1024) {
                if (editEnabled) {
                    toggleEditMode(false);
                }
            }
        }
    });
}

// Help Modal Functions
function initializeHelpModal() {
    const helpBtn = document.getElementById('helpBtn');
    const helpModal = document.getElementById('helpModal');
    const closeHelpBtn = document.getElementById('closeHelpBtn');

    // Open help modal
    helpBtn.addEventListener('click', () => {
        helpModal.style.display = 'block';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    });

    // Close help modal
    closeHelpBtn.addEventListener('click', () => {
        helpModal.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    });

    // Close modal when clicking outside of it
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) {
            helpModal.style.display = 'none';
            document.body.style.overflow = '';
        }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && helpModal.style.display === 'block') {
            helpModal.style.display = 'none';
            document.body.style.overflow = '';
        }
    });
}

// Function to update SVG dimensions to match container
function updateSVGDimensions() {
    const containerRect = mapContainer.getBoundingClientRect();
    leaderLinesSVG.setAttribute('width', containerRect.width);
    leaderLinesSVG.setAttribute('height', containerRect.height);
    shapesLayer.setAttribute('width', containerRect.width);
    shapesLayer.setAttribute('height', containerRect.height);
}

// Toggle Add submenu - now just updates the header state
function toggleAddMenu() {
    // The add submenu is now always visible, so we just update the header state
    updateAddButtonHeaderState();
}

// Helper function to update cursor styles based on current mode
function updateCursorStyles(mode) {
    const mapContainer = document.getElementById('mapContainer');

    // Reset all cursor-related classes first
    mapContainer.classList.remove('point-mode', 'polygon-mode', 'line-mode');
    mapContainer.style.cursor = 'default';

    // Reset all element cursor styles
    document.querySelectorAll('.ref-point, .polygon-point, .polygon-anchor, .label-box').forEach(element => {
        element.style.cursor = 'default';
        element.classList.remove('movable', 'deletable', 'editable');
    });

    // Set appropriate cursor and classes based on mode
    if (!editEnabled && !testingMode) {
        // Default state - no edit mode or test mode
        return;
    }

    if (testingMode) {
        // Test mode cursor styles
        mapContainer.style.cursor = 'default';
        document.querySelectorAll('.label-box').forEach(label => {
            label.style.cursor = 'default';
        });
        return;
    }

    switch (mode) {
        case 'point':
        case 'polygon':
        case 'line':
            mapContainer.classList.add(`${mode}-mode`);
            mapContainer.style.cursor = 'crosshair';
            break;
        case 'move':
            mapContainer.style.cursor = 'default';
            document.querySelectorAll('.ref-point, .polygon-point, .polygon-anchor, .label-box').forEach(element => {
                element.classList.add('movable');
                element.style.cursor = 'move';
            });
            break;
        case 'delete':
            mapContainer.style.cursor = 'default';
            document.querySelectorAll('.ref-point, .polygon-point, .polygon-anchor, .label-box').forEach(element => {
                element.classList.add('deletable');
                element.style.cursor = 'no-drop';
            });
            break;
        case 'editLabelText':
            mapContainer.style.cursor = 'default';
            document.querySelectorAll('.label-box').forEach(element => {
                element.classList.add('editable');
                element.style.cursor = 'text';
            });
            break;
        default:
            // No specific mode or null mode
            mapContainer.style.cursor = 'default';
            break;
    }
}

// Update setMode function to use the new cursor style helper
function setMode(mode) {
    if (!editEnabled) return;

    // Deactivate the current mode's button first
    if (currentMode) {
        const currentBtn = document.getElementById(`${currentMode}Btn`);
        if (currentBtn) {
            currentBtn.classList.remove('active');
            currentBtn.setAttribute('aria-pressed', 'false');
        }
    }

    // Set the new mode before updating UI
    const previousMode = currentMode;
    currentMode = mode;

    // If leaving a drawing mode (polygon/line) for any other mode, cancel unfinished shape/line
    if ((previousMode === 'polygon' || previousMode === 'line') && mode !== previousMode) {
        // Remove any in-progress points
        if (currentShapePoints.length > 0) {
            currentShapePoints.forEach(point => {
                if (point.element && point.element.parentNode) {
                    point.element.classList.add('removing');
                    setTimeout(() => point.element.remove(), 300);
                }
            });
            currentShapePoints = [];
        }
        // Remove preview line if it exists
        const previewLine = document.getElementById('previewLine');
        if (previewLine) previewLine.remove();
        currentShape = null;
        // Hide finish drawing interface
        const finishDrawingInterface = document.getElementById('finishDrawingInterface');
        if (finishDrawingInterface) finishDrawingInterface.style.display = 'none';
    }

    // Update cursor styles for the new mode
    updateCursorStyles(mode);

    if (mode === 'point') {
        mapContainer.classList.add('point-mode');
    } else if (mode === 'polygon') {
        mapContainer.classList.add('polygon-mode');
    } else if (mode === 'line') {
        mapContainer.classList.add('line-mode');
    }

    // Handle drawing mode transitions
    const finishDrawingInterface = document.getElementById('finishDrawingInterface');

    // If entering a drawing mode
    if (mode === 'polygon' || mode === 'line') {
        // Hide the interface initially, will show when first point is added
        finishDrawingInterface.style.display = 'none';
    }
    // If leaving a drawing mode
    else if ((previousMode === 'polygon' || previousMode === 'line') && mode !== 'polygon' && mode !== 'line') {
        finishDrawingInterface.style.display = 'none';

        // If we have points, finish the current shape
        if (currentShapePoints.length > 0) {
            finishCurrentShape();
        }

        // Clear any remaining points and reset state
        currentShape = null;
        currentShapePoints.forEach(point => {
            if (point.element && point.element.parentNode) {
                point.element.remove();
            }
        });
        currentShapePoints = [];

        // Remove preview line if it exists
        const previewLine = document.getElementById('previewLine');
        if (previewLine) previewLine.remove();
    }

    // If clicking the same mode button again, deactivate the mode
    if (mode === previousMode) {
        currentMode = null;
        updateCursorStyles(null);
        // Hide finish drawing interface when deactivating drawing mode
        if (previousMode === 'polygon' || previousMode === 'line') {
            finishDrawingInterface.style.display = 'none';
        }
    }
    // Always close tag panel when switching to move, delete, or editLabelText
    if (["move", "delete", "editLabelText"].includes(mode)) {
        toggletagPanel(false);
    } else if (mode == null || mode === previousMode) {
        toggletagPanel(false);
    } else if (["polygon", "line", "point", "changeTag"].includes(mode)) {
        toggletagPanel(true);
    }

    // Update all button states
    updateButtons();

    // Update add button header state
    updateAddButtonHeaderState();
}

// Update toggleEditMode to use the new cursor style helper
function toggleEditMode(forceState) {
    // If forceState is provided, set editEnabled to that value
    if (typeof forceState === 'boolean') {
        if (editEnabled === forceState) return;
        editEnabled = forceState;
    } else {
        editEnabled = !editEnabled;
    }

    // Toggle visibility of edit tools
    const editTools = document.querySelector('.edit-tools');
    if (editEnabled) {
        editTools.classList.add('visible');
        setEditButtonsEnabled(true);
    } else {
        editTools.classList.remove('visible');
        currentMode = null;
        currentShape = null;
        document.getElementById('finishDrawingInterface').style.display = 'none';
        if (currentShapePoints.length > 0) {
            currentShapePoints.forEach(point => {
                if (point.element && point.element.parentNode) {
                    point.element.remove();
                }
            });
            currentShapePoints = [];
        }
        const previewLine = document.getElementById('previewLine');
        if (previewLine) previewLine.remove();
        setEditButtonsEnabled(false);
        updateButtons();
        // Close the tag type panel if open
        const tagPanel = document.getElementById('tagPanel');
        if (tagPanel && tagPanel.style.display !== 'none') {
            clearTagError();
            tagPanel.style.transform = 'translateX(100%)';
            setTimeout(() => { tagPanel.style.display = 'none'; }, 300);
        }
    }
    updateCursorStyles(currentMode);
    updateTagVisibilityOnMap();
    document.querySelectorAll('.polygon-path').forEach(polygon => {
        polygon.setAttribute('stroke', editEnabled ? 'blue' : 'none');
        polygon.setAttribute('fill', editEnabled ? 'rgba(0, 0, 255, 0.2)' : 'none');
    });
    document.querySelectorAll('.line-path').forEach(line => {
        line.setAttribute('stroke', editEnabled ? 'blue' : 'none');
    });
    updateAddButtonHeaderState();
}

function updateButtons() {
    // Update all edit mode buttons
    document.querySelectorAll('.edit-mode-btn').forEach(btn => {
        const btnMode = btn.getAttribute('data-mode');
        if (btnMode) {
            const active = (btnMode === currentMode);
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active);
        }
    });

    // Update add button header state
    updateAddButtonHeaderState();
}

// Draw leader lines connecting ref points and label boxes
function updateLeaderLines() {
    // Clear previous lines
    leaderLinesSVG.innerHTML = '';

    // Update SVG size to match container
    updateSVGDimensions();

    // Helper function to get the center coordinates of a label box
    function getLabelBoxCenter(labelBoxEl) {
        const rect = labelBoxEl.getBoundingClientRect();
        const containerRect = mapContainer.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2 - containerRect.left;
        const centerY = rect.top + rect.height / 2 - containerRect.top;
        return { x: centerX, y: centerY };
    }

    // Check if we should hide leader lines (in find mode)
    const shouldHideLeaderLines = testingMode && currentTestMode === 'find';

    // Draw leader lines for regular labels
    points.forEach(({ refPointEl, labelBoxEl, refX, refY, labelX, labelY, type }) => {
        const x1 = refX;
        const y1 = refY;
        const center = getLabelBoxCenter(labelBoxEl);
        const x2 = center.x;
        const y2 = center.y;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', '#2196F3');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('class', 'leader-line');
        line.setAttribute('data-type', type);
        if (labelBoxEl && labelBoxEl.id) {
            line.setAttribute('data-for', labelBoxEl.id);
        }
        line.setAttribute('data-type', type);

        // Hide leader line if in find mode OR if the tag is hidden
        if (shouldHideLeaderLines || tagVisibility[type] === false) {
            line.style.visibility = 'hidden';
        }

        leaderLinesSVG.appendChild(line);
    });

    // Draw leader lines for polygons
    polygons.forEach(polygon => {
        const x1 = polygon.anchorX;
        const y1 = polygon.anchorY;
        const center = getLabelBoxCenter(polygon.labelBoxEl);
        const x2 = center.x;
        const y2 = center.y;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', '#2196F3');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('class', 'leader-line');
        line.setAttribute('data-type', polygon.type);
        if (polygon.labelBoxEl && polygon.labelBoxEl.id) {
            line.setAttribute('data-for', polygon.labelBoxEl.id);
        }
        line.setAttribute('data-type', polygon.type);

        // Hide leader line if in find mode OR if the tag is hidden
        if (shouldHideLeaderLines || tagVisibility[polygon.type] === false) {
            line.style.visibility = 'hidden';
        }

        leaderLinesSVG.appendChild(line);
    });

    // Draw leader lines for lines
    lines.forEach(lineObj => {
        const x1 = lineObj.anchorX;
        const y1 = lineObj.anchorY;
        const center = getLabelBoxCenter(lineObj.labelBoxEl);
        const x2 = center.x;
        const y2 = center.y;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', '#2196F3');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('class', 'leader-line');
        line.setAttribute('data-type', lineObj.type);
        if (lineObj.labelBoxEl && lineObj.labelBoxEl.id) {
            line.setAttribute('data-for', lineObj.labelBoxEl.id);
        }
        line.setAttribute('data-type', lineObj.type);

        // Hide leader line if in find mode OR if the tag is hidden
        if (shouldHideLeaderLines || tagVisibility[lineObj.type] === false) {
            line.style.visibility = 'hidden';
        }

        leaderLinesSVG.appendChild(line);
    });

    updateSaveButtonState();
}

// Function to update save button state
function updateSaveButtonState() {
    const saveButton = document.getElementById('saveElementsBtn');
    const hasData = points.length > 0 || polygons.length > 0 || lines.length > 0;
    const isDrawing = currentShapePoints && currentShapePoints.length > 0;
    const hasChanges = hasUnsavedChanges();

    // Disable save button if drawing or if no data exists
    const shouldBeDisabled = isDrawing || !hasData;
    saveButton.disabled = shouldBeDisabled;
    saveButton.style.opacity = shouldBeDisabled ? '0.5' : '1';
    saveButton.style.cursor = shouldBeDisabled ? 'not-allowed' : 'pointer';

    // Update the Load & Save header to show unsaved changes indicator
    const loadsaveHeader = document.querySelector('.loadsave-header h3');
    if (loadsaveHeader) {
        if (hasChanges && !shouldBeDisabled) {
            loadsaveHeader.innerHTML = '<i class="fas fa-folder-open"></i> Load & Save <span class="unsaved-indicator">*</span>';
            loadsaveHeader.classList.add('unsaved-changes');
        } else {
            loadsaveHeader.innerHTML = '<i class="fas fa-folder-open"></i> Load & Save';
            loadsaveHeader.classList.remove('unsaved-changes');
        }
    }

    // Update the Load/Save tab button to show unsaved changes indicator on small screens
    const loadsaveTabBtn = document.querySelector('.tab-btn[data-tab="loadsave"]');
    if (loadsaveTabBtn) {
        if (hasChanges && !shouldBeDisabled) {
            loadsaveTabBtn.innerHTML = 'Load/Save <span class="unsaved-indicator">*</span>';
            loadsaveTabBtn.classList.add('unsaved-changes');
        } else {
            loadsaveTabBtn.innerHTML = 'Load/Save';
            loadsaveTabBtn.classList.remove('unsaved-changes');
        }
    }
}

// Add label at ref point with label offset
function createLabel(refX, refY, labelX, labelY, text = '', createRefPoint = true, shouldFocus = true, isNewPoint = false) {
    let refPointEl = null;
    if (createRefPoint) {
        refPointEl = document.createElement('div');
        refPointEl.className = 'ref-point';
        refPointEl.style.left = refX + 'px';
        refPointEl.style.top = refY + 'px';
        refPointEl.setAttribute('tabindex', '0');
        refPointEl.setAttribute('aria-label', 'Reference point for label');
        refPointEl.setAttribute('role', 'button');
        refPointEl.style.userSelect = 'none';
        refPointEl.style.visibility = editEnabled ? 'visible' : 'hidden';
        mapContainer.appendChild(refPointEl);
        // Trigger the creation animation
        requestAnimationFrame(() => refPointEl.classList.add('visible'));
    }

    const labelBoxEl = document.createElement('div');
    labelBoxEl.className = 'label-box';
    labelBoxEl.style.left = labelX + 'px';
    labelBoxEl.style.top = labelY + 'px';
    labelBoxEl.textContent = text;
    labelBoxEl.setAttribute('tabindex', '0');
    labelBoxEl.setAttribute('role', 'textbox');
    labelBoxEl.setAttribute('aria-label', 'Label text');
    labelBoxEl.contentEditable = (shouldFocus || isNewPoint) ? 'true' : 'false';
    // Assign a unique id if not already set
    if (!labelBoxEl.id) {
        labelBoxEl.id = `label-${labelIdCounter++}`;
    }

    // Add keyboard event listener for Enter/Shift+Enter handling
    labelBoxEl.addEventListener('keydown', handleLabelKeydown);

    mapContainer.appendChild(labelBoxEl);
    // Trigger the creation animation
    requestAnimationFrame(() => labelBoxEl.classList.add('visible'));

    // Focus and set up editing if it's a new point or shouldFocus is true
    if (shouldFocus || isNewPoint) {
        requestAnimationFrame(() => {
            labelBoxEl.contentEditable = 'true';
            labelBoxEl.focus();
        });

        // Add blur handler to make non-editable when focus is lost
        labelBoxEl.addEventListener('blur', () => {
            // Keep editable for a short moment to allow for immediate typing
            setTimeout(() => {
                if (!editEnabled || currentMode !== 'editLabelText') {
                    labelBoxEl.contentEditable = 'false';
                }
            }, 100);
        });
    }

    return { refPointEl, labelBoxEl };
}

// Add a new label at position x,y relative to map container
function addLabel(x, y) {
    if (!editEnabled || currentMode !== 'point') return;

    // Position reference point
    const refX = x;
    const refY = y;
    // Position label box offset (20,20) from ref point
    const labelX = x + 20;
    const labelY = y + 20;

    const { refPointEl, labelBoxEl } = createLabel(refX, refY, labelX, labelY, '', true, false, true);

    // Convert to relative coordinates
    const relCoords = toRelativeCoords(refX, refY);
    const relLabelCoords = toRelativeCoords(labelX, labelY);

    const labelObj = {
        refPointEl,
        labelBoxEl,
        refX,
        refY,
        labelX,
        labelY,
        relRefX: relCoords.x,
        relRefY: relCoords.y,
        relLabelX: relLabelCoords.x,
        relLabelY: relLabelCoords.y,
        correctText: '',
        userGuess: '',
        type: currentType || tags[0] || ''
    };

    points.push(labelObj);
    updateLeaderLines();
    labelObj.labelBoxEl.focus();

    // Remove contentEditable when user blurs the label
    labelBoxEl.addEventListener('blur', () => {
        labelBoxEl.contentEditable = 'false';
    }, { once: true });

    updateLabelEditable();
    updateLeaderLines();
    updateSaveButtonState();
    renderTagPanel();
}

// Helper function to delete a line
function deleteLine(line, index) {
    // Add removing class to trigger animation
    line.points.forEach(p => p.element.classList.add('removing'));
    line.labelBoxEl.classList.add('removing');
    line.anchorPoint.classList.add('removing');

    // Remove elements after animation
    setTimeout(() => {
        line.points.forEach(p => p.element.remove());
        line.labelBoxEl.remove();
        line.polyline.remove();
        line.anchorPoint.remove();
        lines.splice(index, 1);
        updateLeaderLines();
        renderTagPanel();
    }, 300); // Match the animation duration
}

// Helper function to delete a polygon
function deletePolygon(polygon, index) {
    // Add removing class to trigger animation
    polygon.points.forEach(p => p.element.classList.add('removing'));
    polygon.labelBoxEl.classList.add('removing');
    polygon.anchorPoint.element.classList.add('removing');

    // Remove elements after animation
    setTimeout(() => {
        polygon.points.forEach(p => p.element.remove());
        polygon.labelBoxEl.remove();
        polygon.svgPath.remove();
        polygon.anchorPoint.element.remove();
        polygons.splice(index, 1);
        updateLeaderLines();
        renderTagPanel();
    }, 300); // Match the animation duration
}

// Remove label under a point (simple hit test)
function removeLabelAtPoint(x, y) {
    if (!editEnabled || currentMode !== 'delete') return;

    // Check regular labels first
    for (let i = points.length - 1; i >= 0; i--) {
        const { refPointEl, labelBoxEl } = points[i];
        const rectRef = refPointEl.getBoundingClientRect();
        const rectLabel = labelBoxEl.getBoundingClientRect();
        const containerRect = mapContainer.getBoundingClientRect();

        const offsetX = containerRect.left;
        const offsetY = containerRect.top;

        if (isPointInRect(x, y, rectRef, offsetX, offsetY) ||
            isPointInRect(x, y, rectLabel, offsetX, offsetY)) {
            // Add removing class to trigger animation
            refPointEl.classList.add('removing');
            labelBoxEl.classList.add('removing');
            labelBoxEl.style.pointerEvents = 'none'; // Prevent interaction during animation

            // Remove elements after animation
            setTimeout(() => {
                refPointEl.remove();
                labelBoxEl.remove();
                points.splice(i, 1);
                updateLeaderLines();
                updateSaveButtonState();
                renderTagPanel();
            }, 300); // Match the animation duration
            return true;
        }
    }

    // Check polygons
    for (let i = polygons.length - 1; i >= 0; i--) {
        const polygon = polygons[i];
        const containerRect = mapContainer.getBoundingClientRect();
        const offsetX = containerRect.left;
        const offsetY = containerRect.top;

        // Check if clicked on any polygon point, label, or inside the polygon
        const labelRect = polygon.labelBoxEl.getBoundingClientRect();
        const anchorRect = polygon.anchorPoint.element.getBoundingClientRect();

        // Check points
        for (const point of polygon.points) {
            const rect = point.element.getBoundingClientRect();
            if (isPointInRect(x, y, rect, offsetX, offsetY)) {
                deletePolygon(polygon, i);
                updateSaveButtonState();
                return true;
            }
        }

        // Check label or anchor
        if (isPointInRect(x, y, labelRect, offsetX, offsetY) ||
            isPointInRect(x, y, anchorRect, offsetX, offsetY)) {
            deletePolygon(polygon, i);
            updateSaveButtonState();
            return true;
        }
    }

    // Check lines
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const containerRect = mapContainer.getBoundingClientRect();
        const offsetX = containerRect.left;
        const offsetY = containerRect.top;

        // Check if clicked on any line point, label, anchor, or the line itself
        const labelRect = line.labelBoxEl.getBoundingClientRect();
        const anchorRect = line.anchorPoint.getBoundingClientRect();

        // Check points
        for (const point of line.points) {
            const rect = point.element.getBoundingClientRect();
            if (isPointInRect(x, y, rect, offsetX, offsetY)) {
                deleteLine(line, i);
                updateSaveButtonState();
                return true;
            }
        }

        // Check label, anchor, or line
        if (isPointInRect(x, y, labelRect, offsetX, offsetY) ||
            isPointInRect(x, y, anchorRect, offsetX, offsetY)) {
            deleteLine(line, i);
            updateSaveButtonState();
            return true;
        }
    }

    return false;
}

function isPointInRect(x, y, rect, offsetX, offsetY) {
    return x >= rect.left - offsetX &&
        x <= rect.right - offsetX &&
        y >= rect.top - offsetY &&
        y <= rect.bottom - offsetY;
}

// Move label or ref point logic
function onPointerDown(e) {
    if (!editEnabled || currentMode !== 'move') return;

    const rect = mapContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check regular labels
    for (const point of points) {
        const refRect = point.refPointEl.getBoundingClientRect();
        const labelRect = point.labelBoxEl.getBoundingClientRect();
        const offsetX = rect.left;
        const offsetY = rect.top;

        if (isPointInRect(x, y, refRect, offsetX, offsetY)) {
            draggingRefPoint = point;
            dragOffsetX = x - parseInt(point.refPointEl.style.left);
            dragOffsetY = y - parseInt(point.refPointEl.style.top);
            e.preventDefault();
            return;
        }

        if (isPointInRect(x, y, labelRect, offsetX, offsetY)) {
            draggingPointLabel = point;
            dragOffsetX = x - parseInt(point.labelBoxEl.style.left);
            dragOffsetY = y - parseInt(point.labelBoxEl.style.top);
            e.preventDefault();
            return;
        }
    }

    // Check polygons
    for (const polygon of polygons) {
        const labelRect = polygon.labelBoxEl.getBoundingClientRect();
        const anchorRect = polygon.anchorPoint.element.getBoundingClientRect();
        const offsetX = rect.left;
        const offsetY = rect.top;

        // Check polygon points
        for (let i = 0; i < polygon.points.length; i++) {
            const point = polygon.points[i];
            const pointRect = point.element.getBoundingClientRect();
            if (isPointInRect(x, y, pointRect, offsetX, offsetY)) {
                draggingPolygonPoint = { polygon, pointIndex: i };
                dragOffsetX = x - parseInt(point.element.style.left);
                dragOffsetY = y - parseInt(point.element.style.top);
                e.preventDefault();
                return;
            }
        }

        // Check polygon anchor point
        if (isPointInRect(x, y, anchorRect, offsetX, offsetY)) {
            draggingPolygonAnchor = polygon;
            dragOffsetX = x - polygon.anchorX;
            dragOffsetY = y - polygon.anchorY;
            e.preventDefault();
            return;
        }

        // Check polygon label
        if (isPointInRect(x, y, labelRect, offsetX, offsetY)) {
            draggingPolygonLabel = polygon;
            dragOffsetX = x - parseInt(polygon.labelBoxEl.style.left);
            dragOffsetY = y - parseInt(polygon.labelBoxEl.style.top);
            e.preventDefault();
            return;
        }
    }

    // Check lines
    for (const line of lines) {
        const labelRect = line.labelBoxEl.getBoundingClientRect();
        const anchorRect = line.anchorPoint.getBoundingClientRect();
        const offsetX = rect.left;
        const offsetY = rect.top;

        // Check line points
        for (let i = 0; i < line.points.length; i++) {
            const point = line.points[i];
            const pointRect = point.element.getBoundingClientRect();
            if (isPointInRect(x, y, pointRect, offsetX, offsetY)) {
                draggingLinePoint = { line, pointIndex: i };
                dragOffsetX = x - parseInt(point.element.style.left);
                dragOffsetY = y - parseInt(point.element.style.top);
                e.preventDefault();
                return;
            }
        }

        // Check line anchor point
        if (isPointInRect(x, y, anchorRect, offsetX, offsetY)) {
            draggingLineAnchor = line;
            dragOffsetX = x - line.anchorX;
            dragOffsetY = y - line.anchorY;
            e.preventDefault();
            return;
        }

        // Check line label
        if (isPointInRect(x, y, labelRect, offsetX, offsetY)) {
            draggingLineLabel = line;
            dragOffsetX = x - parseInt(line.labelBoxEl.style.left);
            dragOffsetY = y - parseInt(line.labelBoxEl.style.top);
            e.preventDefault();
            return;
        }
    }
}

function isPointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function onPointerMove(e) {
    if (!editEnabled || currentMode !== 'move') return;

    if (!draggingPointLabel && !draggingRefPoint && !draggingPolygonPoint &&
        !draggingPolygonLabel && !draggingLinePoint && !draggingLineLabel &&
        !draggingPolygonAnchor && !draggingLineAnchor) return;

    const rect = mapContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (draggingRefPoint) {
        const newX = x - dragOffsetX;
        const newY = y - dragOffsetY;
        draggingRefPoint.refX = newX;
        draggingRefPoint.refY = newY;
        draggingRefPoint.refPointEl.style.left = newX + 'px';
        draggingRefPoint.refPointEl.style.top = newY + 'px';
        const relCoords = toRelativeCoords(newX, newY);
        draggingRefPoint.relRefX = relCoords.x;
        draggingRefPoint.relRefY = relCoords.y;
    }
    if (draggingPointLabel) {
        const newX = x - dragOffsetX;
        const newY = y - dragOffsetY;
        draggingPointLabel.labelX = newX;
        draggingPointLabel.labelY = newY;
        draggingPointLabel.labelBoxEl.style.left = newX + 'px';
        draggingPointLabel.labelBoxEl.style.top = newY + 'px';
        const relCoords = toRelativeCoords(newX, newY);
        draggingPointLabel.relLabelX = relCoords.x;
        draggingPointLabel.relLabelY = relCoords.y;
    }

    if (draggingPolygonPoint) {
        const { polygon, pointIndex } = draggingPolygonPoint;
        const point = polygon.points[pointIndex];
        const newX = x - dragOffsetX;
        const newY = y - dragOffsetY;
        point.x = newX;
        point.y = newY;
        point.element.style.left = newX + 'px';
        point.element.style.top = newY + 'px';
        const relCoords = toRelativeCoords(newX, newY);
        point.relX = relCoords.x;
        point.relY = relCoords.y;

        // Update polygon path
        const pathData = `M ${polygon.points.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
        polygon.svgPath.setAttribute('d', pathData);
        polygon.svgPath.setAttribute('fill', editEnabled ? 'rgba(0, 0, 255, 0.2)' : 'none');
        polygon.svgPath.setAttribute('stroke', editEnabled ? 'blue' : 'none');
        polygon.svgPath.setAttribute('stroke-width', '2');

        // Update anchor point position to new centroid
        const centroid = getPolygonCentroid(polygon.points);
        polygon.anchorX = centroid.x;
        polygon.anchorY = centroid.y;
        polygon.anchorPoint.element.style.left = centroid.x + 'px';
        polygon.anchorPoint.element.style.top = centroid.y + 'px';
        const relAnchor = toRelativeCoords(centroid.x, centroid.y);
        polygon.relAnchorX = relAnchor.x;
        polygon.relAnchorY = relAnchor.y;
    }

    if (draggingPolygonLabel) {
        const newX = x - dragOffsetX;
        const newY = y - dragOffsetY;
        draggingPolygonLabel.labelBoxEl.style.left = newX + 'px';
        draggingPolygonLabel.labelBoxEl.style.top = newY + 'px';
        const relCoords = toRelativeCoords(newX, newY);
        draggingPolygonLabel.relLabelX = relCoords.x;
        draggingPolygonLabel.relLabelY = relCoords.y;
    }

    if (draggingLinePoint) {
        const { line, pointIndex } = draggingLinePoint;
        const point = line.points[pointIndex];
        const newX = x - dragOffsetX;
        const newY = y - dragOffsetY;
        point.x = newX;
        point.y = newY;
        point.element.style.left = newX + 'px';
        point.element.style.top = newY + 'px';
        const relCoords = toRelativeCoords(newX, newY);
        point.relX = relCoords.x;
        point.relY = relCoords.y;

        // Update polyline
        const points = line.points.map(p => `${p.x},${p.y}`).join(' ');
        line.polyline.setAttribute('points', points);
        line.polyline.setAttribute('fill', 'none');
        line.polyline.setAttribute('stroke', editEnabled ? 'blue' : 'none');
        line.polyline.setAttribute('stroke-width', '2');

        // Project anchor point onto nearest line segment
        let minDist = Infinity;
        let bestProjection = { x: line.anchorX, y: line.anchorY };

        // Check each line segment
        for (let i = 0; i < line.points.length - 1; i++) {
            const p1 = line.points[i];
            const p2 = line.points[i + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.sqrt(dx * dx + dy * dy);

            if (length === 0) continue;

            const t = Math.max(0, Math.min(1,
                ((line.anchorX - p1.x) * dx + (line.anchorY - p1.y) * dy) / (length * length)
            ));

            const projX = p1.x + t * dx;
            const projY = p1.y + t * dy;
            const dist = Math.sqrt(
                (projX - line.anchorX) * (projX - line.anchorX) +
                (projY - line.anchorY) * (projY - line.anchorY)
            );

            if (dist < minDist) {
                minDist = dist;
                bestProjection = { x: projX, y: projY };
            }
        }

        // Update anchor position to the best projection
        line.anchorX = bestProjection.x;
        line.anchorY = bestProjection.y;
        line.anchorPoint.style.left = line.anchorX + 'px';
        line.anchorPoint.style.top = line.anchorY + 'px';
        const relAnchor = toRelativeCoords(line.anchorX, line.anchorY);
        line.relAnchorX = relAnchor.x;
        line.relAnchorY = relAnchor.y;
    }

    if (draggingLineLabel) {
        const newX = x - dragOffsetX;
        const newY = y - dragOffsetY;
        draggingLineLabel.labelBoxEl.style.left = newX + 'px';
        draggingLineLabel.labelBoxEl.style.top = newY + 'px';
        const relCoords = toRelativeCoords(newX, newY);
        draggingLineLabel.relLabelX = relCoords.x;
        draggingLineLabel.relLabelY = relCoords.y;
    }

    if (draggingPolygonAnchor) {
        const newX = x - dragOffsetX;
        const newY = y - dragOffsetY;

        // If point is inside polygon, use it directly
        if (isPointInPolygon(newX, newY, draggingPolygonAnchor.points)) {
            draggingPolygonAnchor.anchorX = newX;
            draggingPolygonAnchor.anchorY = newY;
        } else {
            // If point is outside, find closest point on polygon perimeter
            const closestPoint = getClosestPointOnPolygon(newX, newY, draggingPolygonAnchor.points);
            draggingPolygonAnchor.anchorX = closestPoint.x;
            draggingPolygonAnchor.anchorY = closestPoint.y;
        }

        // Update the anchor point position
        draggingPolygonAnchor.anchorPoint.element.style.left = draggingPolygonAnchor.anchorX + 'px';
        draggingPolygonAnchor.anchorPoint.element.style.top = draggingPolygonAnchor.anchorY + 'px';
        const relAnchor = toRelativeCoords(draggingPolygonAnchor.anchorX, draggingPolygonAnchor.anchorY);
        draggingPolygonAnchor.relAnchorX = relAnchor.x;
        draggingPolygonAnchor.relAnchorY = relAnchor.y;
    }

    if (draggingLineAnchor) {
        const mouseX = x - dragOffsetX;
        const mouseY = y - dragOffsetY;
        const line = draggingLineAnchor;

        // Project the point onto the nearest line segment
        let minDist = Infinity;
        let bestProjection = { x: mouseX, y: mouseY };

        // Check each line segment
        for (let i = 0; i < line.points.length - 1; i++) {
            const p1 = line.points[i];
            const p2 = line.points[i + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.sqrt(dx * dx + dy * dy);

            if (length === 0) continue;

            const t = Math.max(0, Math.min(1,
                ((mouseX - p1.x) * dx + (mouseY - p1.y) * dy) / (length * length)
            ));

            const projX = p1.x + t * dx;
            const projY = p1.y + t * dy;
            const dist = Math.sqrt(
                (projX - mouseX) * (projX - mouseX) +
                (projY - mouseY) * (projY - mouseY)
            );

            if (dist < minDist) {
                minDist = dist;
                bestProjection = { x: projX, y: projY };
            }
        }

        // Update anchor position to the best projection
        line.anchorX = bestProjection.x;
        line.anchorY = bestProjection.y;
        line.anchorPoint.style.left = line.anchorX + 'px';
        line.anchorPoint.style.top = line.anchorY + 'px';
        const relAnchor = toRelativeCoords(line.anchorX, line.anchorY);
        line.relAnchorX = relAnchor.x;
        line.relAnchorY = relAnchor.y;
    }

    updateLeaderLines();
}

function onPointerUp(e) {
    draggingPointLabel = null;
    draggingRefPoint = null;
    draggingPolygonPoint = null;
    draggingPolygonLabel = null;
    draggingLinePoint = null;
    draggingLineLabel = null;
    draggingPolygonAnchor = null;
    draggingLineAnchor = null;
}

function finishCurrentShape() {
    if (!currentShapePoints || currentShapePoints.length < 2) return;

    if (currentShape === 'line') {
        // Create the final polyline
        const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        const points = currentShapePoints.map(p => `${p.x},${p.y}`).join(' ');
        polyline.setAttribute('points', points);
        polyline.setAttribute('class', 'line-path');
        shapesLayer.appendChild(polyline);

        // Calculate the true midpoint of the line by finding the point halfway along its total length
        let totalLength = 0;
        const segmentLengths = [];

        // Calculate total length and individual segment lengths
        for (let i = 0; i < currentShapePoints.length - 1; i++) {
            const p1 = currentShapePoints[i];
            const p2 = currentShapePoints[i + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            totalLength += length;
            segmentLengths.push(length);
        }

        // Find which segment contains the midpoint and calculate its position
        let currentLength = 0;
        let anchorX, anchorY;
        const halfLength = totalLength / 2;

        for (let i = 0; i < segmentLengths.length; i++) {
            if (currentLength + segmentLengths[i] >= halfLength) {
                // This segment contains our midpoint
                const p1 = currentShapePoints[i];
                const p2 = currentShapePoints[i + 1];
                const segmentFraction = (halfLength - currentLength) / segmentLengths[i];

                // Linear interpolation to find the exact midpoint
                anchorX = p1.x + (p2.x - p1.x) * segmentFraction;
                anchorY = p1.y + (p2.y - p1.y) * segmentFraction;
                break;
            }
            currentLength += segmentLengths[i];
        }

        // Create anchor point
        const anchorPoint = document.createElement('div');
        anchorPoint.className = 'polygon-anchor' + (currentMode === 'move' ? ' movable' : '');
        anchorPoint.style.left = anchorX + 'px';
        anchorPoint.style.top = anchorY + 'px';
        mapContainer.appendChild(anchorPoint);
        // Trigger the creation animation
        requestAnimationFrame(() => anchorPoint.classList.add('visible'));

        // Create label
        const labelX = anchorX + 20;
        const labelY = anchorY + 20;
        const { labelBoxEl } = createLabel(anchorX, anchorY, labelX, labelY, '', false, true);

        // Keep the existing points but update their classes and add relative coordinates
        const finalPoints = currentShapePoints.map(point => {
            point.element.className = 'polygon-point visible' + (currentMode === 'move' ? ' movable' : '');
            const relCoords = toRelativeCoords(point.x, point.y);
            point.relX = relCoords.x;
            point.relY = relCoords.y;
            return point;
        });

        // Get relative coordinates for anchor and label
        const relAnchorCoords = toRelativeCoords(anchorX, anchorY);
        const relLabelCoords = toRelativeCoords(labelX, labelY);

        // Store line data
        lines.push({
            points: finalPoints,
            labelBoxEl,
            polyline,
            anchorPoint,
            anchorX,
            anchorY,
            relAnchorX: relAnchorCoords.x,
            relAnchorY: relAnchorCoords.y,
            relLabelX: relLabelCoords.x,
            relLabelY: relLabelCoords.y,
            type: currentType || tags[0] || ''
        });

        type = currentType;
        anchorPoint.setAttribute('data-type', currentType);
        polyline.setAttribute('data-type', currentType);

    } else if (currentShape === 'polygon' && currentShapePoints.length >= 3) {
        // Create the final polygon path
        const svgPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const pathData = currentShapePoints.map((p, i) =>
            (i === 0 ? 'M' : 'L') + `${p.x},${p.y}`
        ).join(' ') + 'Z';
        svgPath.setAttribute('d', pathData);
        svgPath.setAttribute('class', 'polygon-path');
        svgPath.setAttribute('data-type', currentShape === 'polygon' ? currentType || tags[0] || '' : 'default');
        shapesLayer.appendChild(svgPath);

        // Calculate centroid for anchor point
        const centroid = getPolygonCentroid(currentShapePoints);

        // Create anchor point
        const anchorPoint = document.createElement('div');
        anchorPoint.className = 'polygon-anchor' + (currentMode === 'move' ? ' movable' : '');
        anchorPoint.style.left = centroid.x + 'px';
        anchorPoint.style.top = centroid.y + 'px';
        mapContainer.appendChild(anchorPoint);
        // Trigger the creation animation
        requestAnimationFrame(() => anchorPoint.classList.add('visible'));
        anchorPoint.setAttribute('data-type', currentShape === 'polygon' ? currentType || tags[0] || '' : 'default');

        // Create label
        const labelX = centroid.x + 20;
        const labelY = centroid.y + 20;
        const { labelBoxEl } = createLabel(centroid.x, centroid.y, labelX, labelY, '', false, true);

        // Keep the existing points but update their classes and add relative coordinates
        const finalPoints = currentShapePoints.map(point => {
            point.element.className = 'polygon-point visible' + (currentMode === 'move' ? ' movable' : '');
            const relCoords = toRelativeCoords(point.x, point.y);
            point.relX = relCoords.x;
            point.relY = relCoords.y;
            return point;
        });

        // Get relative coordinates for anchor and label
        const relCentroidCoords = toRelativeCoords(centroid.x, centroid.y);
        const relLabelCoords = toRelativeCoords(labelX, labelY);

        // Store polygon data
        polygons.push({
            points: finalPoints,
            labelBoxEl,
            svgPath,
            anchorPoint: { element: anchorPoint },
            anchorX: centroid.x,
            anchorY: centroid.y,
            relAnchorX: relCentroidCoords.x,
            relAnchorY: relCentroidCoords.y,
            relLabelX: relLabelCoords.x,
            relLabelY: relLabelCoords.y,
            type: currentShape === 'polygon' ? currentType || tags[0] || '' : 'default'
        });
    }

    // Clear current points array but maintain the current mode
    currentShapePoints = [];

    // Remove any preview elements
    const previewLine = document.getElementById('previewLine');
    if (previewLine) previewLine.remove();

    // Re-enable all buttons after finishing shape
    setSidebarButtonsEnabled(true);

    updateLeaderLines();
    updateButtons();
    updateSaveButtonState();
    renderTagPanel();
}

function getPolygonCentroid(points) {
    let sumX = 0;
    let sumY = 0;
    points.forEach(point => {
        sumX += point.x;
        sumY += point.y;
    });
    return {
        x: sumX / points.length,
        y: sumY / points.length
    };
}

// Update click handler
mapContainer.addEventListener('click', (e) => {
    if (!editEnabled) return;

    const rect = mapContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (currentMode === 'point') {
        addLabel(x, y);
    } else if (currentMode === 'delete') {
        removeLabelAtPoint(x, y);
    } else if (currentMode === 'editLabelText') {
        // Check regular labels
        for (const point of points) {
            const labelRect = point.labelBoxEl.getBoundingClientRect();
            if (isPointInRect(x, y, labelRect, rect.left, rect.top)) {
                point.labelBoxEl.contentEditable = 'true';
                // Add keyboard event listener if not already added
                if (!point.labelBoxEl.hasAttribute('data-keydown-added')) {
                    point.labelBoxEl.addEventListener('keydown', handleLabelKeydown);
                    point.labelBoxEl.setAttribute('data-keydown-added', 'true');
                }
                point.labelBoxEl.focus();
                return;
            }
        }

        // Check polygon labels
        for (const polygon of polygons) {
            const labelRect = polygon.labelBoxEl.getBoundingClientRect();
            if (isPointInRect(x, y, labelRect, rect.left, rect.top)) {
                polygon.labelBoxEl.contentEditable = 'true';
                // Add keyboard event listener if not already added
                if (!polygon.labelBoxEl.hasAttribute('data-keydown-added')) {
                    polygon.labelBoxEl.addEventListener('keydown', handleLabelKeydown);
                    polygon.labelBoxEl.setAttribute('data-keydown-added', 'true');
                }
                polygon.labelBoxEl.focus();
                return;
            }
        }

        // Check line labels
        for (const line of lines) {
            const labelRect = line.labelBoxEl.getBoundingClientRect();
            if (isPointInRect(x, y, labelRect, rect.left, rect.top)) {
                line.labelBoxEl.contentEditable = 'true';
                // Add keyboard event listener if not already added
                if (!line.labelBoxEl.hasAttribute('data-keydown-added')) {
                    line.labelBoxEl.addEventListener('keydown', handleLabelKeydown);
                    line.labelBoxEl.setAttribute('data-keydown-added', 'true');
                }
                line.labelBoxEl.focus();
                return;
            }
        }
    } else if (currentMode === 'polygon' || currentMode === 'line') {
        // Check if user clicked on the first point of the current shape (only for polygons)
        if (currentMode === 'polygon' && currentShapePoints.length > 0 && hasEnoughPointsForShape()) {
            const firstPoint = currentShapePoints[0];
            const firstPointRect = firstPoint.element.getBoundingClientRect();
            if (isPointInRect(x, y, firstPointRect, rect.left, rect.top)) {
                // User clicked on the first point, finish the shape
                finishCurrentShape();
                document.getElementById('finishDrawingInterface').style.display = 'none';
                setSidebarButtonsEnabled(true);
                return;
            }
        }

        const point = document.createElement('div');
        point.className = 'polygon-point';
        point.setAttribute('data-type', currentType);
        point.style.left = x + 'px';
        point.style.top = y + 'px';
        point.style.pointerEvents = 'auto';
        mapContainer.appendChild(point);
        // Trigger the creation animation
        requestAnimationFrame(() => point.classList.add('visible'));

        // Store both absolute and relative coordinates
        const relCoords = toRelativeCoords(x, y);
        currentShapePoints.push({ x, y, relX: relCoords.x, relY: relCoords.y, element: point });
        currentShape = currentMode;

        // Disable menu buttons after first point is created
        if (currentShapePoints.length === 1) {
            setSidebarButtonsEnabled(false);
            // Show the finish drawing interface when first point is created
            const finishDrawingInterface = document.getElementById('finishDrawingInterface');
            finishDrawingInterface.style.display = 'flex';
            updateFinishDrawingButtonState();
        } else {
            // Update finish button state for subsequent points
            updateFinishDrawingButtonState();
        }

        // Draw or update the preview polyline if we're drawing a line
        if (currentMode === 'line') {
            if (currentShapePoints.length > 1) {
                // Remove old preview if it exists
                const oldPreview = document.getElementById('previewLine');
                if (oldPreview) oldPreview.remove();

                // Create new preview polyline
                const preview = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
                preview.id = 'previewLine';
                const points = currentShapePoints.map(p => `${p.x},${p.y}`).join(' ');
                preview.setAttribute('points', points);
                preview.setAttribute('fill', 'none');
                preview.setAttribute('stroke', 'blue');
                preview.setAttribute('stroke-width', '2');
                shapesLayer.appendChild(preview);
            }
        }

        // Update leader lines after adding a point
        updateLeaderLines();
    }
});

// Dragging events
mapContainer.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);

// Initial disable buttons
toggleEditMode();

function updateLabelEditable() {
    const makeLabelsNonEditable = () => {
        // Make all labels non-editable
        points.forEach(point => {
            point.labelBoxEl.contentEditable = 'false';
        });
        polygons.forEach(polygon => {
            polygon.labelBoxEl.contentEditable = 'false';
        });
        lines.forEach(line => {
            line.labelBoxEl.contentEditable = 'false';
        });
    };

    // Make labels non-editable when not in edit label mode
    if (currentMode !== 'editLabelText') {
        makeLabelsNonEditable();
    }
}

function togglePolygonMode() {
    if (!editEnabled) return;

    // Cancel the current shape
    currentShapePoints.forEach(point => {
        point.element.classList.add('removing');
        setTimeout(() => point.element.remove(), 300);
    });
    currentShapePoints = [];
    currentShape = null;
    // Remove preview line if it exists
    const previewLine = document.getElementById('previewLine');
    if (previewLine) previewLine.remove();

    if (currentMode === 'polygon') {
        // Exit polygon mode
        setMode(null);
        // Reset cursor
        mapContainer.style.cursor = 'default';
    } else {
        // Start polygon mode
        setMode('polygon');
    }
}

function toggleLineMode() {
    if (!editEnabled) return;

    // Cancel the current line
    currentShapePoints.forEach(point => {
        point.element.classList.add('removing');
        setTimeout(() => point.element.remove(), 300);
    });
    currentShapePoints = [];
    currentShape = null;
    // Remove preview line if it exists
    const previewLine = document.getElementById('previewLine');
    if (previewLine) previewLine.remove();

    if (currentMode === 'line') {
        // Exit line mode
        setMode(null);
        // Reset cursor
        mapContainer.style.cursor = 'default';
    } else {
        // Start line mode
        setMode('line');
    }
}

function getClosestPointOnPolygon(x, y, points) {
    let closestPoint = { x: points[0].x, y: points[0].y };
    let minDist = Infinity;

    // Check each edge of the polygon
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];

        // Get closest point on this line segment
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) continue;

        const t = Math.max(0, Math.min(1,
            ((x - p1.x) * dx + (y - p1.y) * dy) / (length * length)
        ));

        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;
        const dist = Math.sqrt(
            (projX - x) * (projX - x) +
            (projY - y) * (projY - y)
        );

        if (dist < minDist) {
            minDist = dist;
            closestPoint = { x: projX, y: projY };
        }
    }

    return closestPoint;
}

// Add map file loading functionality
mapFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const errorMessage = document.getElementById('errorMessage');

    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showFileTypeWarningModal(file.type, 'image');
        // Reset the file input to allow selecting the same file again
        mapFileInput.value = '';
        return;
    }

    // Check if there are any existing labels, polygons, or lines
    const hasExistingData = points.length > 0 || polygons.length > 0 || lines.length > 0;

    const loadNewMap = () => {
        return new Promise((resolve, reject) => {
            errorMessage.style.display = 'none';

            // Reset all UI states
            resetUIState();

            // Hide save/load buttons while loading
            document.getElementById('saveElementsBtn').style.display = 'none';
            document.getElementById('loadElementsBtn').style.display = 'none';

            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();

                img.onload = () => {
                    console.log('Image loaded successfully:', img.width, 'x', img.height);
                    mapImage.src = img.src;
                    pageContainer.style.opacity = '1';
                    document.getElementById('saveElementsBtn').style.display = 'inline-block';
                    document.getElementById('loadElementsBtn').style.display = 'inline-block';

                    // Hide the front load map container
                    const frontLoadMapContainer = document.getElementById('frontLoadMapContainer');
                    if (frontLoadMapContainer) {
                        frontLoadMapContainer.classList.add('hidden');
                    }

                    // Clear all existing data
                    points.forEach(point => {
                        if (point.refPointEl) point.refPointEl.remove();
                        if (point.labelBoxEl) point.labelBoxEl.remove();
                    });
                    points.length = 0;

                    polygons.forEach(polygon => {
                        polygon.points.forEach(p => p.element.remove());
                        polygon.labelBoxEl.remove();
                        polygon.svgPath.remove();
                        polygon.anchorPoint.element.remove();
                    });
                    polygons.length = 0;

                    lines.forEach(line => {
                        line.points.forEach(p => p.element.remove());
                        line.labelBoxEl.remove();
                        line.polyline.remove();
                        line.anchorPoint.remove();
                    });
                    lines.length = 0;

                    // Clear SVG layers
                    while (shapesLayer.firstChild) {
                        shapesLayer.removeChild(shapesLayer.firstChild);
                    }
                    while (leaderLinesSVG.firstChild) {
                        leaderLinesSVG.removeChild(leaderLinesSVG.firstChild);
                    }

                    // Reset baseline data for unsaved changes detection
                    baselineData = null;

                    // Update SVG size to match new image
                    requestAnimationFrame(() => {
                        updateSVGDimensions();
                        // Reset file input to allow selecting the same file again
                        mapFileInput.value = '';
                        // Update save button state after clearing data
                        updateSaveButtonState();
                        resolve();
                    });
                };

                img.onerror = () => {
                    console.error('Failed to load image');
                    errorMessage.textContent = 'Failed to load the image. Please try another file.';
                    errorMessage.style.display = 'block';
                    // Keep save/load buttons hidden
                    document.getElementById('saveElementsBtn').style.display = 'none';
                    document.getElementById('loadElementsBtn').style.display = 'none';
                    // Reset file input to allow selecting the same file again
                    mapFileInput.value = '';
                    reject(new Error('Failed to load image'));
                };

                // Set image source from FileReader result
                img.src = e.target.result;
            };

            reader.onerror = () => {
                console.error('Failed to read file');
                errorMessage.textContent = 'Error reading the file. Please try again.';
                errorMessage.style.display = 'block';
                // Keep save/load buttons hidden
                document.getElementById('saveElementsBtn').style.display = 'none';
                document.getElementById('loadElementsBtn').style.display = 'none';
                // Reset file input to allow selecting the same file again
                mapFileInput.value = '';
                reject(new Error('Failed to read file'));
            };

            reader.readAsDataURL(file);
        });
    };

    if (hasExistingData) {
        // Create and show the confirmation dialog
        const dialog = document.createElement('div');
        dialog.className = 'warning-modal';
        dialog.innerHTML = `
            <div class="warning-modal-content">
                <div class="warning-modal-header">
                    <h3><i class="fas fa-exclamation-triangle"></i> Warning</h3>
                </div>
                <div class="warning-modal-body">
                    <p>Loading a new map will delete any unsaved elements. Would you like to:</p>
                    <div class="warning-modal-buttons">
                        <button id="saveAndContinue" class="warning-btn warning-btn-primary">
                            <i class="fas fa-save"></i> Save & Continue
                        </button>
                        <button id="continueWithoutSaving" class="warning-btn warning-btn-danger">
                            <i class="fas fa-exclamation-triangle"></i> Continue Without Saving
                        </button>
                        <button id="cancelLoad" class="warning-btn warning-btn-secondary">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.className = 'warning-modal-overlay';

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        // Handle dialog buttons
        document.getElementById('saveAndContinue').onclick = async () => {
            // Save current labels first
            saveElements();

            // Wait a bit for the save to complete, then update baseline data
            setTimeout(() => {
                // Update baseline data to reflect the saved state
                baselineData = getCurrentState();
            }, 500);

            dialog.remove();
            overlay.remove();
            try {
                await loadNewMap();
            } catch (error) {
                console.error('Failed to load new map:', error);
            }
        };

        document.getElementById('continueWithoutSaving').onclick = async () => {
            dialog.remove();
            overlay.remove();
            try {
                await loadNewMap();
            } catch (error) {
                console.error('Failed to load new map:', error);
            }
        };

        document.getElementById('cancelLoad').onclick = () => {
            dialog.remove();
            overlay.remove();
            // Reset the file input
            mapFileInput.value = '';
        };
    } else {
        // If no existing data, load the new map directly
        try {
            await loadNewMap();
        } catch (error) {
            console.error('Failed to load new map:', error);
        }
    }
});

// Add image error handler
mapImage.addEventListener('error', (e) => {
    console.error('Error loading image:', e);
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.textContent = 'Failed to display the image. Please try another file.';
    errorMessage.style.display = 'block';
});

// Save labels to JSON file
function saveElements() {
    const exportData = {
        points: points.map(point => ({
            refX: point.relRefX,
            refY: point.relRefY,
            labelX: point.relLabelX,
            labelY: point.relLabelY,
            text: point.labelBoxEl.textContent,
            type: point.type || 'default'
        })),
        polygons: polygons.map(polygon => ({
            points: polygon.points.map(p => ({ x: p.relX, y: p.relY })),
            anchorX: polygon.relAnchorX,
            anchorY: polygon.relAnchorY,
            labelX: polygon.relLabelX,
            labelY: polygon.relLabelY,
            text: polygon.labelBoxEl.textContent,
            type: polygon.type || 'default'
        })),
        lines: lines.map(line => ({
            points: line.points.map(p => ({ x: p.relX, y: p.relY })),
            anchorX: line.relAnchorX,
            anchorY: line.relAnchorY,
            labelX: line.relLabelX,
            labelY: line.relLabelY,
            text: line.labelBoxEl.textContent,
            type: line.type || 'default'
        }))
    };

    // Create a Blob containing the JSON data
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });

    // Create a temporary anchor element for downloading
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'map_labels.json'; // Suggested filename

    // Trigger the save dialog
    a.click();

    // Clean up
    URL.revokeObjectURL(a.href);

    // Update baseline data after successful save
    baselineData = JSON.parse(JSON.stringify(exportData));

    // Clear the unsaved changes indicator immediately
    updateSaveButtonState();
}

// Load labels from JSON file
function loadElements() {
    const input = document.getElementById('elementsFileInput');

    // Check if there are any existing labels, polygons, or lines
    const hasExistingData = points.length > 0 || polygons.length > 0 || lines.length > 0;

    const processLabelsFile = () => {
        input.click();
        input.onchange = function (e) {
            const file = e.target.files[0];
            if (!file) return;

            // File type validation for JSON
            // Accept either application/json or .json extension (for browsers that don't set type)
            const isJson = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
            if (!isJson) {
                showFileTypeWarningModal(file.type || file.name.split('.').pop(), 'JSON');
                input.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = function (e) {
                const data = JSON.parse(e.target.result);
                // Reset the file input so the same file can be loaded again
                input.value = '';

                // Collect all tag types from the file
                const foundTags = new Set();
                (data.points || []).forEach(point => { if (point.type) foundTags.add(point.type); });
                (data.polygons || []).forEach(polygon => { if (polygon.type) foundTags.add(polygon.type); });
                (data.lines || []).forEach(line => { if (line.type) foundTags.add(line.type); });
                tags = Array.from(foundTags);
                // Automatically select the first tag as active
                if (tags.length > 0) {
                    currentType = tags[0];
                    saveTags();
                }
                // Make all tags visible and remove any not present in the file
                tagVisibility = {};
                tags.forEach(tag => { tagVisibility[tag] = true; });
                saveTags();
                saveTagVisibility();
                updateTagVisibilityOnMap();
                renderTagPanel();

                // Clear existing labels
                points.forEach(point => {
                    if (point.refPointEl) point.refPointEl.remove();
                    if (point.labelBoxEl) point.labelBoxEl.remove();
                });
                points.length = 0;

                // Clear existing polygons
                polygons.forEach(polygon => {
                    polygon.points.forEach(p => p.element.remove());
                    polygon.labelBoxEl.remove();
                    polygon.svgPath.remove();
                    polygon.anchorPoint.element.remove();
                });
                polygons.length = 0;

                // Clear existing lines
                lines.forEach(line => {
                    line.points.forEach(p => p.element.remove());
                    line.labelBoxEl.remove();
                    line.polyline.remove();
                    line.anchorPoint.remove();
                });
                lines.length = 0;

                // Clear SVG layers
                while (shapesLayer.firstChild) {
                    shapesLayer.removeChild(shapesLayer.firstChild);
                }
                while (leaderLinesSVG.firstChild) {
                    leaderLinesSVG.removeChild(leaderLinesSVG.firstChild);
                }

                // Recreate labels
                data.points?.forEach(point => {
                    const absPos = toAbsoluteCoords(point.refX, point.refY);
                    const absLabelPos = toAbsoluteCoords(point.labelX, point.labelY);
                    const { refPointEl, labelBoxEl } = createLabel(
                        absPos.x,
                        absPos.y,
                        absLabelPos.x,
                        absLabelPos.y,
                        point.text,
                        true,  // createRefPoint
                        false  // shouldFocus
                    );

                    // Set initial visibility based on edit mode
                    refPointEl.style.visibility = editEnabled ? 'visible' : 'hidden';

                    // Add appropriate classes based on current mode
                    if (currentMode === 'move') {
                        refPointEl.classList.add('movable');
                        labelBoxEl.classList.add('movable');
                    } else if (currentMode === 'delete') {
                        refPointEl.classList.add('deletable');
                        labelBoxEl.classList.add('deletable');
                    } else if (currentMode === 'editLabelText') {
                        refPointEl.classList.add('editable');
                        labelBoxEl.classList.add('editable');
                    }

                    points.push({
                        refPointEl,
                        labelBoxEl,
                        refX: absPos.x,
                        refY: absPos.y,
                        labelX: absLabelPos.x,
                        labelY: absLabelPos.y,
                        relRefX: point.refX,
                        relRefY: point.refY,
                        relLabelX: point.labelX,
                        relLabelY: point.labelY,
                        type: point.type || 'default'
                    });
                });

                // Recreate polygons
                data.polygons?.forEach(polygon => {
                    // Create points
                    const points = polygon.points.map(p => {
                        const absPos = toAbsoluteCoords(p.x, p.y);
                        const pointEl = document.createElement('div');
                        pointEl.className = 'polygon-point visible';
                        pointEl.setAttribute('data-type', polygon.type || 'default');
                        // Add appropriate classes based on current mode
                        if (currentMode === 'move') {
                            pointEl.classList.add('movable');
                        } else if (currentMode === 'delete') {
                            pointEl.classList.add('deletable');
                        } else if (currentMode === 'editLabelText') {
                            pointEl.classList.add('editable');
                        }

                        pointEl.style.left = absPos.x + 'px';
                        pointEl.style.top = absPos.y + 'px';
                        pointEl.style.visibility = editEnabled ? 'visible' : 'hidden';
                        mapContainer.appendChild(pointEl);
                        return {
                            x: absPos.x,
                            y: absPos.y,
                            relX: p.x,
                            relY: p.y,
                            element: pointEl
                        };
                    });

                    // Create SVG path
                    const svgPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    const pathData = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
                    svgPath.setAttribute('d', pathData);
                    svgPath.setAttribute('fill', editEnabled ? 'rgba(0, 0, 255, 0.2)' : 'none');
                    svgPath.setAttribute('stroke', editEnabled ? 'blue' : 'none');
                    svgPath.setAttribute('stroke-width', '2');
                    svgPath.setAttribute('class', 'polygon-path');
                    svgPath.style.pointerEvents = 'none';
                    svgPath.setAttribute('data-type', polygon.type || 'default');
                    shapesLayer.appendChild(svgPath);

                    // Create anchor point
                    const absAnchorPos = toAbsoluteCoords(polygon.anchorX, polygon.anchorY);
                    const anchorPoint = document.createElement('div');
                    anchorPoint.className = 'polygon-anchor visible';

                    // Add appropriate classes based on current mode
                    if (currentMode === 'move') {
                        anchorPoint.classList.add('movable');
                    } else if (currentMode === 'delete') {
                        anchorPoint.classList.add('deletable');
                    } else if (currentMode === 'editLabelText') {
                        anchorPoint.classList.add('editable');
                    }

                    anchorPoint.style.left = absAnchorPos.x + 'px';
                    anchorPoint.style.top = absAnchorPos.y + 'px';
                    anchorPoint.style.visibility = editEnabled ? 'visible' : 'hidden';
                    mapContainer.appendChild(anchorPoint);
                    anchorPoint.setAttribute('data-type', polygon.type || 'default');

                    // Create label
                    const absLabelPos = toAbsoluteCoords(polygon.labelX, polygon.labelY);
                    const { labelBoxEl } = createLabel(
                        absAnchorPos.x,
                        absAnchorPos.y,
                        absLabelPos.x,
                        absLabelPos.y,
                        polygon.text,
                        false,  // createRefPoint
                        false   // shouldFocus
                    );

                    // Add appropriate classes to label based on current mode
                    if (currentMode === 'move') {
                        labelBoxEl.classList.add('movable');
                    } else if (currentMode === 'delete') {
                        labelBoxEl.classList.add('deletable');
                    } else if (currentMode === 'editLabelText') {
                        labelBoxEl.classList.add('editable');
                    }

                    polygons.push({
                        points,
                        labelBoxEl,
                        svgPath,
                        anchorPoint: { element: anchorPoint },
                        anchorX: absAnchorPos.x,
                        anchorY: absAnchorPos.y,
                        relAnchorX: polygon.anchorX,
                        relAnchorY: polygon.anchorY,
                        relLabelX: polygon.labelX,
                        relLabelY: polygon.labelY,
                        type: polygon.type || 'default'
                    });
                });

                // Recreate lines
                data.lines?.forEach(line => {
                    // Create points
                    const points = line.points.map(p => {
                        const absPos = toAbsoluteCoords(p.x, p.y);
                        const pointEl = document.createElement('div');
                        pointEl.className = 'polygon-point visible';
                        pointEl.setAttribute('data-type', line.type || 'default');
                        // Add appropriate classes based on current mode
                        if (currentMode === 'move') {
                            pointEl.classList.add('movable');
                        } else if (currentMode === 'delete') {
                            pointEl.classList.add('deletable');
                        } else if (currentMode === 'editLabelText') {
                            pointEl.classList.add('editable');
                        }

                        pointEl.style.left = absPos.x + 'px';
                        pointEl.style.top = absPos.y + 'px';
                        pointEl.style.visibility = editEnabled ? 'visible' : 'hidden';
                        mapContainer.appendChild(pointEl);
                        return {
                            x: absPos.x,
                            y: absPos.y,
                            relX: p.x,
                            relY: p.y,
                            element: pointEl
                        };
                    });

                    // Create polyline
                    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
                    const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
                    polyline.setAttribute('points', pointsStr);
                    polyline.setAttribute('fill', 'none');
                    polyline.setAttribute('stroke', editEnabled ? 'blue' : 'none');
                    polyline.setAttribute('stroke-width', '2');
                    polyline.setAttribute('class', 'line-path');
                    polyline.style.pointerEvents = 'none';
                    polyline.setAttribute('data-type', line.type || 'default');
                    shapesLayer.appendChild(polyline);

                    // Create anchor point
                    const absAnchorPos = toAbsoluteCoords(line.anchorX, line.anchorY);
                    const anchorPoint = document.createElement('div');
                    anchorPoint.className = 'polygon-anchor visible';

                    // Add appropriate classes based on current mode
                    if (currentMode === 'move') {
                        anchorPoint.classList.add('movable');
                    } else if (currentMode === 'delete') {
                        anchorPoint.classList.add('deletable');
                    } else if (currentMode === 'editLabelText') {
                        anchorPoint.classList.add('editable');
                    }

                    anchorPoint.style.left = absAnchorPos.x + 'px';
                    anchorPoint.style.top = absAnchorPos.y + 'px';
                    anchorPoint.style.visibility = editEnabled ? 'visible' : 'hidden';
                    mapContainer.appendChild(anchorPoint);
                    anchorPoint.setAttribute('data-type', line.type || 'default');

                    // Create label
                    const absLabelPos = toAbsoluteCoords(line.labelX, line.labelY);
                    const { labelBoxEl } = createLabel(
                        absAnchorPos.x,
                        absAnchorPos.y,
                        absLabelPos.x,
                        absLabelPos.y,
                        line.text,
                        false,  // createRefPoint
                        false   // shouldFocus
                    );

                    // Add appropriate classes to label based on current mode
                    if (currentMode === 'move') {
                        labelBoxEl.classList.add('movable');
                    } else if (currentMode === 'delete') {
                        labelBoxEl.classList.add('deletable');
                    } else if (currentMode === 'editLabelText') {
                        labelBoxEl.classList.add('editable');
                    }

                    lines.push({
                        points,
                        labelBoxEl,
                        polyline,
                        anchorPoint,
                        anchorX: absAnchorPos.x,
                        anchorY: absAnchorPos.y,
                        relAnchorX: line.anchorX,
                        relAnchorY: line.anchorY,
                        relLabelX: line.labelX,
                        relLabelY: line.labelY,
                        type: line.type || 'default'
                    });
                });

                updateLeaderLines();
                renderTagPanel();

                // Store the loaded data as baseline for unsaved changes detection
                baselineData = JSON.parse(JSON.stringify(data));

                // Clear the unsaved changes indicator since we just loaded new data
                updateSaveButtonState();
            };
            reader.readAsText(file);
        };
    };

    if (hasExistingData) {
        // Create and show the confirmation dialog
        const dialog = document.createElement('div');
        dialog.className = 'warning-modal';
        dialog.innerHTML = `
            <div class="warning-modal-content">
                <div class="warning-modal-header">
                    <h3><i class="fas fa-exclamation-triangle"></i> Warning</h3>
                </div>
                <div class="warning-modal-body">
                    <p>Loading an elements file will overwrite any existing elements. Would you like to:</p>
                    <div class="warning-modal-buttons">
                        <button id="saveAndContinue" class="warning-btn warning-btn-primary">
                            <i class="fas fa-save"></i> Save Current & Continue
                        </button>
                        <button id="continueWithoutSaving" class="warning-btn warning-btn-danger">
                            <i class="fas fa-exclamation-triangle"></i> Continue Without Saving
                        </button>
                        <button id="cancelLoad" class="warning-btn warning-btn-secondary">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.className = 'warning-modal-overlay';

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        // Handle dialog buttons
        document.getElementById('saveAndContinue').onclick = () => {
            saveElements();
            dialog.remove();
            overlay.remove();
            processLabelsFile();
        };

        document.getElementById('continueWithoutSaving').onclick = () => {
            dialog.remove();
            overlay.remove();
            processLabelsFile();
        };

        document.getElementById('cancelLoad').onclick = () => {
            dialog.remove();
            overlay.remove();
        };
    } else {
        processLabelsFile();
    }
}

// Calculate the map image's offset within the container
function getMapImageOffset() {
    const containerRect = mapContainer.getBoundingClientRect();
    const imageRect = mapImage.getBoundingClientRect();
    return {
        left: imageRect.left - containerRect.left,
        top: imageRect.top - containerRect.top,
        width: imageRect.width,
        height: imageRect.height
    };
}

// Convert absolute pixel coordinates to relative percentages (relative to map image)
function toRelativeCoords(x, y) {
    const { left, top, width, height } = getMapImageOffset();
    return {
        x: ((x - left) / width) * 100,
        y: ((y - top) / height) * 100
    };
}

// Convert relative percentages to absolute pixel coordinates (relative to map image)
function toAbsoluteCoords(relX, relY) {
    const { left, top, width, height } = getMapImageOffset();
    return {
        x: left + (relX * width) / 100,
        y: top + (relY * height) / 100
    };
}

// Update all element positions based on relative coordinates
function updateAllPositions() {
    // Update regular labels
    points.forEach(point => {
        const absPos = toAbsoluteCoords(point.relRefX, point.relRefY);
        const absLabelPos = toAbsoluteCoords(point.relLabelX, point.relLabelY);
        point.refPointEl.style.left = absPos.x + 'px';
        point.refPointEl.style.top = absPos.y + 'px';
        point.labelBoxEl.style.left = absLabelPos.x + 'px';
        point.labelBoxEl.style.top = absLabelPos.y + 'px';
        point.refX = absPos.x;
        point.refY = absPos.y;
        point.labelX = absLabelPos.x;
        point.labelY = absLabelPos.y;
    });

    // Update polygons
    polygons.forEach(polygon => {
        // Update points
        polygon.points.forEach(point => {
            const absPos = toAbsoluteCoords(point.relX, point.relY);
            point.x = absPos.x;
            point.y = absPos.y;
            point.element.style.left = absPos.x + 'px';
            point.element.style.top = absPos.y + 'px';
        });

        // Update SVG path
        const pathData = `M ${polygon.points.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
        polygon.svgPath.setAttribute('d', pathData);
        polygon.svgPath.setAttribute('fill', editEnabled ? 'rgba(0, 0, 255, 0.2)' : 'none');
        polygon.svgPath.setAttribute('stroke', editEnabled ? 'blue' : 'none');
        polygon.svgPath.setAttribute('stroke-width', '2');

        // Update anchor point
        const anchorPos = toAbsoluteCoords(polygon.relAnchorX, polygon.relAnchorY);
        polygon.anchorX = anchorPos.x;
        polygon.anchorY = anchorPos.y;
        polygon.anchorPoint.element.style.left = anchorPos.x + 'px';
        polygon.anchorPoint.element.style.top = anchorPos.y + 'px';

        // Update label
        const labelPos = toAbsoluteCoords(polygon.relLabelX, polygon.relLabelY);
        polygon.labelBoxEl.style.left = labelPos.x + 'px';
        polygon.labelBoxEl.style.top = labelPos.y + 'px';
    });

    // Update lines
    lines.forEach(line => {
        // Update points
        line.points.forEach(point => {
            const absPos = toAbsoluteCoords(point.relX, point.relY);
            point.x = absPos.x;
            point.y = absPos.y;
            point.element.style.left = absPos.x + 'px';
            point.element.style.top = absPos.y + 'px';
        });

        // Update polyline
        const points = line.points.map(p => `${p.x},${p.y}`).join(' ');
        line.polyline.setAttribute('points', points);
        line.polyline.setAttribute('fill', 'none');
        line.polyline.setAttribute('stroke', editEnabled ? 'blue' : 'none');
        line.polyline.setAttribute('stroke-width', '2');

        // Update anchor point
        const anchorPos = toAbsoluteCoords(line.relAnchorX, line.relAnchorY);
        line.anchorX = anchorPos.x;
        line.anchorY = anchorPos.y;
        line.anchorPoint.style.left = anchorPos.x + 'px';
        line.anchorPoint.style.top = anchorPos.y + 'px';

        // Update label
        const labelPos = toAbsoluteCoords(line.relLabelX, line.relLabelY);
        line.labelBoxEl.style.left = labelPos.x + 'px';
        line.labelBoxEl.style.top = labelPos.y + 'px';
    });

    updateLeaderLines();
}

// Testing mode functions
function startIdentifyTest() {
    // Hide all movable points except the current test item
    document.querySelectorAll('.ref-point, .polygon-point, .polygon-anchor').forEach(point => {
        point.style.visibility = 'hidden';
    });

    // Hide all label text and ensure reference points are visible for testing
    document.querySelectorAll('.label-box').forEach(label => {
        label.dataset.correctAnswer = label.textContent;
        label.textContent = '???';
    });

    // Prepare test items
    testItems = [
        ...points.map(point => ({ type: 'point', element: point.refPointEl, label: point.labelBoxEl })),
        ...polygons.map(polygon => ({ type: 'polygon', element: polygon.svgPath, label: polygon.labelBoxEl })),
        ...lines.map(line => ({ type: 'line', element: line.polyline, label: line.labelBoxEl }))
    ].filter(item => item.element && item.label);

    remainingTestItems = [...testItems];
    selectNextTestItem();

    // Show test interface
    const testInterface = document.getElementById('testInterface');
    testInterface.style.display = 'block';
    const testInput = document.getElementById('testInput');
    testInput.value = '';
    testInput.focus();
    return true;
}

function selectNextTestItem() {
    // Check if test is still active before proceeding
    if (!testingMode) {
        return;
    }

    // Remove highlight from previous item and its label if exists
    if (currentTestItem) {
        currentTestItem.element.classList.remove('highlight-test');
        currentTestItem.label.classList.remove('highlight-test');

        // Remove highlight from leader line if it exists
        const leaderLine = document.querySelector(`line[data-for="${currentTestItem.label.id}"]`);
        if (leaderLine) {
            leaderLine.classList.remove('highlight-test');
        }

        // Hide the previous test item's point if it's a label type
        if (currentTestItem.type === 'point') {
            currentTestItem.element.style.visibility = 'hidden';
        }
    }

    // Log remaining items for debugging
    console.log(`Remaining items: ${remainingTestItems.length}`);

    if (remainingTestItems.length === 0) {
        // Double-check that test is still active before showing congratulations
        if (testingMode) {
            endTest(true); // true indicates this is a natural completion
        }
        return;
    }

    // Take the next item from the front of the array (they're already shuffled)
    currentTestItem = remainingTestItems[0];
    console.log(`Selected item at index 0. Current length: ${remainingTestItems.length}`);

    if (currentTestMode === 'ident') {
        // Show and highlight both the item and its label in identify mode
        currentTestItem.element.classList.add('highlight-test');
        currentTestItem.label.classList.add('highlight-test');

        // Highlight the leader line
        const leaderLine = document.querySelector(`line[data-for="${currentTestItem.label.id}"]`);
        if (leaderLine) {
            leaderLine.classList.add('highlight-test');
        }

        // If it's a label type, make sure its point is visible
        if (currentTestItem.type === 'point') {
            currentTestItem.element.style.visibility = 'visible';
        }
    } else {
        // In find mode, only make shapes visible, not reference points
        if (currentTestItem.type === 'polygon') {
            currentTestItem.element.style.visibility = 'visible';
        } else if (currentTestItem.type === 'line') {
            currentTestItem.element.style.visibility = 'visible';
        }
        // Reference points (label type) stay hidden in find mode
    }

    // Update the target label in find mode
    if (currentTestMode === 'find') {
        const targetLabel = document.querySelector('#targetLabel span');
        targetLabel.textContent = currentTestItem.label.dataset.correctAnswer;
    } else if (currentTestMode === 'ident') {
        // Only scroll in identify mode
        // Use the element's bounding rect to determine its position
        const elementRect = currentTestItem.element.getBoundingClientRect();
        const labelRect = currentTestItem.label.getBoundingClientRect();

        // Calculate the midpoint between the element and its label
        const midpointY = (elementRect.top + labelRect.top) / 2;

        // Get the viewport height
        const viewportHeight = window.innerHeight;

        // Calculate the ideal scroll position that centers the midpoint
        const idealScrollTop = window.scrollY + midpointY - (viewportHeight / 2);

        // Scroll smoothly to the calculated position
        window.scrollTo({
            top: idealScrollTop,
            behavior: 'smooth'
        });
    }
}

function checkAnswer(answer) {
    const correctAnswer = currentTestItem.label.dataset.correctAnswer.trim().toLowerCase();
    const userAnswer = answer.toLowerCase();
    const testInput = document.getElementById('testInput');
    const testInputFeedback = document.querySelector('.test-feedback-element');

    // Remove previous feedback classes
    testInputFeedback.classList.remove('correct', 'incorrect');

    if (userAnswer === correctAnswer) {
        // Correct answer
        testInputFeedback.classList.add('correct');

        // Remove current item from remaining items
        remainingTestItems.shift();
        updateTestProgress();

        setTimeout(() => {
            testInput.value = '';
            testInputFeedback.classList.remove('correct', 'incorrect');
            selectNextTestItem();
        }, 1500);
    } else {
        // Incorrect answer
        testInputFeedback.classList.add('incorrect');
        testInput.value = '';
        testInput.focus();
        setTimeout(() => {
            testInputFeedback.classList.remove('incorrect');
        }, 1200);
    }
}

function updateTestProgress() {
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = progressContainer.querySelector('.progress');
    const progressNumbers = progressContainer.querySelector('.progress-numbers');

    if (progressBar && progressNumbers) {
        const completed = testItems.length - remainingTestItems.length;
        const total = testItems.length;
        const percentage = total > 0 ? (completed / total) * 100 : 0;

        // Update numeric progress
        progressNumbers.textContent = `${completed}/${total}`;

        // Update visual progress bar width using CSS custom property
        progressBar.style.setProperty('--progress-width', `${percentage}%`);
    }
}

function endTest(isNaturalCompletion = false) {
    // If in find mode, restore labels before ending
    if (currentTestMode === 'find') {
        // Don't call cleanupFindMode() here when showing completion screen
        // It will be called in cleanupTest() when user clicks Continue
        // Ensure reference points remain hidden for find mode completion screen
        document.querySelectorAll('.ref-point, .polygon-point, .polygon-anchor').forEach(point => {
            point.style.visibility = 'hidden';
        });
    }

    testingMode = false;
    currentTestMode = null;

    // Show completion message in test interface if this is a natural end
    if (isNaturalCompletion) {
        const testInterface = document.getElementById('testInterface');
        const identifyInterface = document.getElementById('identifyInterface');
        const findInterface = document.getElementById('findInterface');
        const progressContainer = document.getElementById('progressContainer');
        const stopTestContainer = document.getElementById('stopTestContainer');

        // Hide test mode interfaces and containers
        identifyInterface.classList.remove('active');
        findInterface.classList.remove('active');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        if (stopTestContainer) {
            stopTestContainer.style.display = 'none';
        }

        // Create compact sidebar completion message
        const completionDiv = document.createElement('div');
        completionDiv.className = 'sidebar-congrats';
        completionDiv.innerHTML = `
        <div class="congrats-icon"><i class="fas fa-trophy"></i></div>
        <div class="congrats-title">Congratulations!</div>
        <button id="continueBtn" class="congrats-continue-btn">Continue</button>
    `;

        testInterface.appendChild(completionDiv);

        // Add event listener to continue button
        document.getElementById('continueBtn').addEventListener('click', () => {
            testInterface.removeChild(completionDiv);
            cleanupTest();
        });

        return; // Exit early to prevent immediate cleanup
    }

    cleanupTest();
}

function cleanupTest() {
    // Remove find mode click handler and cleanup if in find mode
    if (currentTestMode === 'find') {
        mapContainer.removeEventListener('click', handleFindModeClick);
        cleanupFindMode();
    }

    const identBtn = document.getElementById('identPointBtn');
    const findBtn = document.getElementById('findPointBtn');
    const editToggle = document.getElementById('editToggle');
    const stopTestBtn = document.getElementById('stopTestBtn');
    const identifyInterface = document.getElementById('identifyInterface');
    const findInterface = document.getElementById('findInterface');

    // Remove testing mode class to restore interface toggles and un-gray windows
    const mainMenu = document.getElementById('mainMenu');
    if (mainMenu) {
        mainMenu.classList.remove('testing-mode-active');
    }

    // Hide test mode interfaces
    identifyInterface.classList.remove('active');
    findInterface.classList.remove('active');

    // Hide progress container
    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }

    // Hide and disable stop button container
    const stopTestContainer = document.getElementById('stopTestContainer');
    if (stopTestContainer) {
        stopTestContainer.style.display = 'none';
        stopTestContainer.classList.remove('active');
    }

    // Reset button states
    identBtn.classList.remove('test-active');
    findBtn.classList.remove('test-active');
    identBtn.disabled = false;
    findBtn.disabled = false;
    identBtn.style.opacity = '1';
    findBtn.style.opacity = '1';
    identBtn.style.cursor = 'pointer';
    findBtn.style.cursor = 'pointer';

    // Re-enable and reset all menu buttons
    document.querySelectorAll('.menu button').forEach(button => {
        if (button.id !== 'stopTestBtn' && button.id !== 'addBtn') {
            button.disabled = false;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
            button.classList.remove('test-active');
            button.setAttribute('aria-disabled', 'false');
        }
    });

    // Re-enable and reset load map container elements
    const loadMapContainer = document.getElementById('loadMapContainer');
    if (loadMapContainer) {
        loadMapContainer.querySelectorAll('button, label, input').forEach(element => {
            if (element.tagName.toLowerCase() === 'label') {
                element.style.opacity = '1';
                element.style.cursor = 'pointer';
                element.style.pointerEvents = 'auto';
            } else {
                element.disabled = false;
                element.style.opacity = '1';
                element.style.cursor = 'pointer';
                element.style.pointerEvents = 'auto';
            }
        });
    }

    // Show all label text and reset point visibility
    document.querySelectorAll('.label-box').forEach(label => {
        if (label.dataset.correctAnswer) {
            label.textContent = label.dataset.correctAnswer;
            delete label.dataset.correctAnswer;
        }
        // Reset any test-related styles
        label.classList.remove('highlight-test');
        label.style.animation = 'none';
        label.style.backgroundColor = '';
        label.style.color = '';
        label.style.borderColor = '';
        label.style.boxShadow = '';
        label.style.filter = '';
    });

    // Reset reference point visibility and styles
    document.querySelectorAll('.ref-point, .polygon-point, .polygon-anchor').forEach(point => {
        point.style.visibility = 'hidden';
        point.classList.remove('highlight-test');
        point.style.animation = 'none';
        point.style.backgroundColor = '';
        point.style.borderColor = '';
        point.style.transform = 'translate(-50%, -50%) scale(1)';
        point.style.boxShadow = '';
        point.style.filter = '';
    });

    // Reset any highlighted shapes (polygons and lines)
    document.querySelectorAll('.polygon-path, .line-path').forEach(shape => {
        shape.classList.remove('highlight-test');
        shape.style.animation = 'none';
        shape.setAttribute('stroke', 'none');
        shape.setAttribute('stroke-width', '2');
        shape.style.filter = '';
        if (shape.classList.contains('polygon-path')) {
            shape.setAttribute('fill', 'none');
        }
    });

    // Reset leader lines
    document.querySelectorAll('.leader-line').forEach(line => {
        line.classList.remove('highlight-test');
        line.style.animation = 'none';
        line.setAttribute('stroke', 'rgba(0, 0, 0, 0.4)');
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', '4,3');
        line.style.filter = '';
    });

    // Force a reflow to ensure animations are properly reset
    void document.documentElement.offsetHeight;

    // Remove animation: none after reflow to allow future animations
    document.querySelectorAll('.label-box, .ref-point, .polygon-point, .polygon-anchor, .polygon-path, .line-path, .leader-line').forEach(element => {
        element.style.animation = '';
    });

    // Clear any remaining test items
    testItems = [];
    remainingTestItems = [];
    currentTestItem = null;

    // Restore element visibility after Identify Elements mode
    restoreIdentifyTestVisibility();

    // Restore tag visibility based on user preferences
    updateTagVisibilityOnMap();

    // After restoreIdentifyTestVisibility();
    if (!editEnabled) {
        document.querySelectorAll('.ref-point').forEach(point => {
            point.style.visibility = 'hidden';
        });
    }

    // Re-enable the load/save tab when test ends
    const loadsaveTabRadio = document.getElementById('tab-loadsave');
    const loadsaveTabBtn = document.querySelector('label[for="tab-loadsave"]');
    if (loadsaveTabRadio && loadsaveTabBtn) {
        loadsaveTabRadio.disabled = false;
        loadsaveTabBtn.classList.remove('disabled');
    }

    // Re-enable the edit tab when test ends
    const editTabRadio = document.getElementById('tab-edit');
    const editTabBtn = document.querySelector('label[for="tab-edit"]');
    if (editTabRadio && editTabBtn) {
        editTabRadio.disabled = false;
        editTabBtn.classList.remove('disabled');
    }

    // Show all label text and reset point visibility
    document.querySelectorAll('.label-box').forEach(label => {
        if (label.dataset.correctAnswer) {
            label.textContent = label.dataset.correctAnswer;
            delete label.dataset.correctAnswer;
        }
        // Reset any test-related styles
        label.classList.remove('highlight-test');
        label.style.animation = 'none';
        label.style.backgroundColor = '';
        label.style.color = '';
        label.style.borderColor = '';
        label.style.boxShadow = '';
        label.style.filter = '';
    });

    // Reset reference point visibility and styles
    document.querySelectorAll('.ref-point, .polygon-point, .polygon-anchor').forEach(point => {
        point.style.visibility = 'hidden';
        point.classList.remove('highlight-test');
        point.style.animation = 'none';
        point.style.backgroundColor = '';
        point.style.borderColor = '';
        point.style.transform = 'translate(-50%, -50%) scale(1)';
        point.style.boxShadow = '';
        point.style.filter = '';
    });

    // Reset any highlighted shapes (polygons and lines)
    document.querySelectorAll('.polygon-path, .line-path').forEach(shape => {
        shape.classList.remove('highlight-test');
        shape.style.animation = 'none';
        shape.setAttribute('stroke', 'none');
        shape.setAttribute('stroke-width', '2');
        shape.style.filter = '';
        if (shape.classList.contains('polygon-path')) {
            shape.setAttribute('fill', 'none');
        }
    });

    // Reset leader lines
    document.querySelectorAll('.leader-line').forEach(line => {
        line.classList.remove('highlight-test');
        line.style.animation = 'none';
        line.setAttribute('stroke', 'rgba(0, 0, 0, 0.4)');
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', '4,3');
        line.style.filter = '';
    });

    // Force a reflow to ensure animations are properly reset
    void document.documentElement.offsetHeight;

    // Remove animation: none after reflow to allow future animations
    document.querySelectorAll('.label-box, .ref-point, .polygon-point, .polygon-anchor, .polygon-path, .line-path, .leader-line').forEach(element => {
        element.style.animation = '';
    });

    // Clear any remaining test items
    testItems = [];
    remainingTestItems = [];
    currentTestItem = null;

    // Restore element visibility after Identify Elements mode
    restoreIdentifyTestVisibility();

    // Restore tag visibility based on user preferences
    updateTagVisibilityOnMap();

    // After restoreIdentifyTestVisibility();
    if (!editEnabled) {
        document.querySelectorAll('.ref-point').forEach(point => {
            point.style.visibility = 'hidden';
        });
    }
}

function stopTest() {
    endTest(false); // false indicates this is not a natural completion
}

// Add event listener for test input
document.getElementById('testInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && testingMode) {
        checkAnswer(e.target.value);
    }
});

// Add event listener for identify mode button
document.getElementById('identPointBtn').addEventListener('click', () => {
    if (!testingMode) {
        toggleTestMode('ident');
    }
});

// Add event listener for stop test button
document.getElementById('stopTestBtn').addEventListener('click', () => {
    endTest(false); // false indicates this is not a natural completion
});

function toggleTestMode(mode) {
    // Show tag type selection modal before starting test
    showTestTagTypeModal(mode, function (selectedTags) {
        // Proceed with test setup using only selected tag types
        _toggleTestModeInternal(mode, selectedTags);
    });
}

// Internal function to handle test setup after tag selection
function _toggleTestModeInternal(mode, selectedTags) {
    const identBtn = document.getElementById('identPointBtn');
    const findBtn = document.getElementById('findPointBtn');
    const stopTestBtn = document.getElementById('stopTestBtn');
    const editTools = document.querySelector('.edit-tools');
    const addSubMenu = document.getElementById('addSubMenu');

    // If we're already in test mode and clicking the same button, do nothing
    if (testingMode && currentTestMode === mode) return;

    // If we're in a different test mode, stop it first
    if (testingMode) {
        endTest(false); // false indicates this is not a natural completion
        // Only restore visibility if we're not entering find mode (where we want to hide elements)
        if (mode !== 'find') {
            restoreVisibility(); // Make sure everything is visible before starting new mode
        }
    }

    // If we're in edit mode, disable it
    if (editEnabled) {
        // Call toggleEditMode to properly close edit mode and update all UI states
        toggleEditMode(false);
    }

    // Start the test mode
    testingMode = true;
    currentTestMode = mode;

    // Update cursor styles for test mode
    updateCursorStyles(null);

    // Add testing mode class to main menu to hide interface toggles and gray out non-testing windows
    const mainMenu = document.getElementById('mainMenu');
    if (mainMenu) {
        mainMenu.classList.add('testing-mode-active');
    }

    // Common initialization for both modes
    document.querySelectorAll('.ref-point, .polygon-point, .polygon-anchor').forEach(point => {
        point.style.visibility = 'hidden';
    });

    // Store correct answers
    document.querySelectorAll('.label-box').forEach(label => {
        if (!label.dataset.correctAnswer) {
            label.dataset.correctAnswer = label.textContent;
        }
    });

    // Prepare test items (filter by selected tag types)
    testItems = [
        ...points.filter(point => selectedTags.includes(point.type)).map(point => ({ type: 'point', element: point.refPointEl, label: point.labelBoxEl })),
        ...polygons.filter(polygon => selectedTags.includes(polygon.type)).map(polygon => ({ type: 'polygon', element: polygon.svgPath, label: polygon.labelBoxEl })),
        ...lines.filter(line => selectedTags.includes(line.type)).map(line => ({ type: 'line', element: line.polyline, label: line.labelBoxEl }))
    ].filter(item => item.element && item.label);

    // Shuffle the test items array for random order
    for (let i = testItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [testItems[i], testItems[j]] = [testItems[j], testItems[i]];
    }

    remainingTestItems = [...testItems];

    // Log the number of test items for debugging
    console.log(`Starting test with ${testItems.length} items`);

    // Show test interface and stop button
    const testInterface = document.getElementById('testInterface');
    const identifyInterface = document.getElementById('identifyInterface');
    const findInterface = document.getElementById('findInterface');
    testInterface.style.display = 'block';

    // Show the appropriate test mode interface
    if (mode === 'ident') {
        // Hide labels for identify mode
        document.querySelectorAll('.label-box').forEach(label => {
            label.textContent = '???';
        });

        // Show identify interface
        identifyInterface.classList.add('active');
        findInterface.classList.remove('active');

        // Focus the input
        const testInput = document.getElementById('testInput');
        testInput.value = '';
        testInput.focus();
    } else if (mode === 'find') {
        // Hide all reference points in find mode but keep them in the layout
        document.querySelectorAll('.ref-point').forEach(point => {
            point.style.visibility = 'hidden';
        });

        // Hide labels and leader lines in find mode
        document.querySelectorAll('.label-box').forEach(label => {
            label.style.visibility = 'hidden';
        });
        document.querySelectorAll('.leader-line').forEach(line => {
            line.style.visibility = 'hidden';
        });

        // Show find interface
        identifyInterface.classList.remove('active');
        findInterface.classList.add('active');

        // Show and update the target label
        const targetLabel = document.querySelector('#targetLabel');
        const targetLabelSpan = targetLabel.querySelector('span');
        targetLabel.style.display = 'block';

        // Set initial target label text from first test item
        if (remainingTestItems.length > 0) {
            targetLabelSpan.textContent = remainingTestItems[0].label.dataset.correctAnswer;
        }

        // Add click handler for map elements
        mapContainer.addEventListener('click', handleFindModeClick);
    }

    // Show and enable stop button
    const stopTestContainer = document.getElementById('stopTestContainer');
    stopTestContainer.style.display = 'block';
    stopTestContainer.classList.add('active');
    stopTestBtn.style.display = 'block';
    stopTestBtn.disabled = false;

    // Show progress container and initialize progress counter
    const progressContainer = document.getElementById('progressContainer');
    progressContainer.style.display = 'block';

    // Initialize progress with the new structure
    updateTestProgress();

    // Select the first test item after UI is ready
    selectNextTestItem();

    // Disable edit mode during test (no longer need to disable editToggle button)
    if (editEnabled) {
        toggleEditMode(false);
    }

    // Update button states and disable all menu buttons
    identBtn.classList.toggle('test-active', mode === 'ident');
    findBtn.classList.toggle('test-active', mode === 'find');

    // Disable testing mode buttons during test
    identBtn.disabled = true;
    findBtn.disabled = true;
    identBtn.style.opacity = '0.5';
    findBtn.style.opacity = '0.5';
    identBtn.style.cursor = 'not-allowed';
    findBtn.style.cursor = 'not-allowed';

    // Disable all menu buttons except stop test
    document.querySelectorAll('.menu button').forEach(button => {
        if (button.id !== 'stopTestBtn') {
            button.disabled = true;
            button.style.opacity = '0.5';
            button.style.cursor = 'not-allowed';
        }
    });

    // Disable load map and save/load labels buttons
    const loadMapContainer = document.getElementById('loadMapContainer');
    if (loadMapContainer) {
        loadMapContainer.querySelectorAll('button, label, input').forEach(element => {
            if (element.tagName.toLowerCase() === 'label') {
                element.style.opacity = '0.5';
                element.style.cursor = 'not-allowed';
            } else {
                element.disabled = true;
                element.style.opacity = '0.5';
                element.style.cursor = 'not-allowed';
            }
        });
    }

    // Disable the load/save tab when test is active
    const loadsaveTabRadio = document.getElementById('tab-loadsave');
    const loadsaveTabBtn = document.querySelector('label[for="tab-loadsave"]');
    if (loadsaveTabRadio && loadsaveTabBtn) {
        loadsaveTabRadio.disabled = true;
        loadsaveTabBtn.classList.add('disabled');
    }

    // Disable the edit tab when test is active
    const editTabRadio = document.getElementById('tab-edit');
    const editTabBtn = document.querySelector('label[for="tab-edit"]');
    if (editTabRadio && editTabBtn) {
        editTabRadio.disabled = true;
        editTabBtn.classList.add('disabled');
    }

    // Close the tag type panel if open
    const tagPanel = document.getElementById('tagPanel');
    if (tagPanel && tagPanel.style.display !== 'none') {
        clearTagError();
        tagPanel.style.transform = 'translateX(100%)';
        setTimeout(() => { tagPanel.style.display = 'none'; }, 300);
    }

    // In Identify Elements mode, temporarily show/hide only the elements being tested
    if (mode === 'ident') {
        setIdentifyTestVisibility(testItems);
        if (currentTestItem.type === 'point') {
            currentTestItem.element.style.visibility = 'visible';
        }
    }
}

let currentTestMode = null;

// Helper function to check if we have enough points for the current shape type
function hasEnoughPointsForShape() {
    if (!editEnabled || !currentMode || !currentShapePoints || currentShapePoints.length === 0) return false;
    if (currentMode === 'polygon') return currentShapePoints.length >= 3;
    if (currentMode === 'line') return currentShapePoints.length >= 2;
    return false;
}

// Function to reset all UI states
function resetUIState() {
    // Exit test mode if active
    if (testingMode) {
        stopTest();
    }

    // Exit edit mode if active
    if (editEnabled) {
        editEnabled = false;
        // Removed editToggle references
        const editTools = document.querySelector('.edit-tools');
        editTools.classList.remove('visible');
    }

    // Reset all buttons to inactive state
    document.querySelectorAll('.menu button').forEach(btn => {
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('active');
        // Only disable certain buttons
        if (btn.id !== 'identPointBtn' &&
            btn.id !== 'findPointBtn' &&
            btn.id !== 'editLabelTextBtn') {  // Don't disable edit text button
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
        }
    });

    // Hide Add submenu
    const addSubMenu = document.getElementById('addSubMenu');
    const addBtn = document.getElementById('addBtn');
    addBtn.setAttribute('aria-pressed', 'false');
    addBtn.classList.remove('active');

    // Reset current mode and shape
    currentMode = null;
    currentShape = null;

    // Clear any in-progress shape points
    if (currentShapePoints.length > 0) {
        currentShapePoints.forEach(point => {
            if (point.element && point.element.parentNode) {
                point.element.remove();
            }
        });
        currentShapePoints = [];
    }

    // Hide finish drawing interface
    document.getElementById('finishDrawingInterface').style.display = 'none';

    // Remove preview line if it exists
    const previewLine = document.getElementById('previewLine');
    if (previewLine) previewLine.remove();

    // Reset cursor styles
    updateCursorStyles(null);
}

function handleFindModeClick(e) {
    if (!testingMode || currentTestMode !== 'find') return;

    // Get click coordinates relative to the map container
    const rect = mapContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const buffer = 10; //points

    const feedback = document.querySelector('#findInterface .feedback');

    // Check if we clicked on the correct element with buffer zone
    let isCorrect = false;
    if (currentTestItem) {
        if (currentTestItem.type === 'point') {
            // For points, temporarily make the element visible to get its position
            const refPoint = currentTestItem.element;
            const originalVisibility = refPoint.style.visibility;

            // Make it invisible but still take up space
            refPoint.style.visibility = 'hidden';

            // Get the position
            const pointRect = refPoint.getBoundingClientRect();
            const pointX = pointRect.left + pointRect.width / 2 - rect.left;
            const pointY = pointRect.top + pointRect.height / 2 - rect.top;

            // Restore original visibility
            refPoint.style.visibility = originalVisibility;

            // Check distance
            const distance = Math.sqrt(Math.pow(clickX - pointX, 2) + Math.pow(clickY - pointY, 2));
            isCorrect = distance <= buffer;
        } else if (currentTestItem.type === 'polygon') {
            // For polygons, check if click is inside polygon or near its edges
            const path = currentTestItem.element;
            // Get points from the path's d attribute
            const points = getPointsFromPath(path.getAttribute('d'));

            // Check if point is inside polygon or near its edges
            isCorrect = isPointInOrNearPolygon(clickX, clickY, points, buffer);
        } else if (currentTestItem.type === 'line') {
            // For lines, temporarily make it visible to get coordinates
            const line = currentTestItem.element;
            const originalVisibility = line.style.visibility;
            const originalStroke = line.getAttribute('stroke');

            // Make it invisible but still take up space
            line.style.visibility = 'hidden';
            line.setAttribute('stroke', 'rgba(0,0,0,0.001)'); // Nearly invisible but still rendered

            // Get the points from the path
            const points = getPointsFromPolyline(line.getAttribute('points'));

            // Restore original state
            line.style.visibility = originalVisibility;
            line.setAttribute('stroke', originalStroke);

            // Check distance
            isCorrect = isPointOnLine(clickX, clickY, points, 10);
        }
    }

    if (isCorrect) {
        // Correct click
        const targetLabel = document.getElementById('targetLabel');
        targetLabel.classList.add('correct');
        remainingTestItems.shift();
        updateTestProgress();
        mapContainer.removeEventListener('click', handleFindModeClick);
        setTimeout(() => {
            targetLabel.classList.remove('correct', 'incorrect');
            if (remainingTestItems.length > 0) {
                mapContainer.addEventListener('click', handleFindModeClick);
            }
            selectNextTestItem();
        }, 1500);
    } else {
        // Incorrect click
        const targetLabel = document.getElementById('targetLabel');
        targetLabel.classList.add('incorrect');
        setTimeout(() => {
            targetLabel.classList.remove('incorrect');
        }, 1200);
    }
}

function selectNextTestItem() {
    // Check if test is still active before proceeding
    if (!testingMode) {
        return;
    }

    // Remove highlight from previous item and its label if exists
    if (currentTestItem) {
        currentTestItem.element.classList.remove('highlight-test');
        currentTestItem.label.classList.remove('highlight-test');

        // Remove highlight from leader line if it exists
        const leaderLine = document.querySelector(`line[data-for="${currentTestItem.label.id}"]`);
        if (leaderLine) {
            leaderLine.classList.remove('highlight-test');
        }

        // Hide the previous test item's point if it's a label type
        if (currentTestItem.type === 'point') {
            currentTestItem.element.style.visibility = 'hidden';
        }
    }

    // Log remaining items for debugging
    console.log(`Remaining items: ${remainingTestItems.length}`);

    if (remainingTestItems.length === 0) {
        // Double-check that test is still active before showing congratulations
        if (testingMode) {
            endTest(true); // true indicates this is a natural completion
        }
        return;
    }

    // Take the next item from the front of the array (they're already shuffled)
    currentTestItem = remainingTestItems[0];
    console.log(`Selected item at index 0. Current length: ${remainingTestItems.length}`);

    if (currentTestMode === 'ident') {
        // Show and highlight both the item and its label in identify mode
        currentTestItem.element.classList.add('highlight-test');
        currentTestItem.label.classList.add('highlight-test');

        // Highlight the leader line
        const leaderLine = document.querySelector(`line[data-for="${currentTestItem.label.id}"]`);
        if (leaderLine) {
            leaderLine.classList.add('highlight-test');
        }

        // If it's a label type, make sure its point is visible
        if (currentTestItem.type === 'point') {
            currentTestItem.element.style.visibility = 'visible';
        }
    } else {
        // In find mode, only make shapes visible, not reference points
        if (currentTestItem.type === 'polygon') {
            currentTestItem.element.style.visibility = 'visible';
        } else if (currentTestItem.type === 'line') {
            currentTestItem.element.style.visibility = 'visible';
        }
        // Reference points (label type) stay hidden in find mode
    }

    // Update the target label in find mode
    if (currentTestMode === 'find') {
        const targetLabel = document.querySelector('#targetLabel span');
        targetLabel.textContent = currentTestItem.label.dataset.correctAnswer;
    } else if (currentTestMode === 'ident') {
        // Only scroll in identify mode
        // Use the element's bounding rect to determine its position
        const elementRect = currentTestItem.element.getBoundingClientRect();
        const labelRect = currentTestItem.label.getBoundingClientRect();

        // Calculate the midpoint between the element and its label
        const midpointY = (elementRect.top + labelRect.top) / 2;

        // Get the viewport height
        const viewportHeight = window.innerHeight;

        // Calculate the ideal scroll position that centers the midpoint
        const idealScrollTop = window.scrollY + midpointY - (viewportHeight / 2);

        // Scroll smoothly to the calculated position
        window.scrollTo({
            top: idealScrollTop,
            behavior: 'smooth'
        });
    }
}

function isPointInOrNearPolygon(x, y, points, buffer) {
    // First check if point is inside polygon
    if (isPointInPolygon(x, y, points)) return true;

    // If not inside, check distance to edges
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        if (distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= buffer) {
            return true;
        }
    }
    return false;
}

function isPointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function restoreVisibility() {
    // Restore label visibility
    document.querySelectorAll('.label-box').forEach(label => {
        label.style.visibility = 'visible';
        label.style.opacity = '1';
    });

    // Restore leader line visibility
    document.querySelectorAll('.leader-line').forEach(line => {
        line.style.visibility = 'visible';
        line.style.opacity = '1';
    });

    // Restore reference point visibility
    document.querySelectorAll('.ref-point, .polygon-point, .polygon-anchor').forEach(point => {
        point.style.visibility = 'visible';
        point.style.opacity = '1';
    });
}

function getPointsFromPath(d) {
    if (!d) return [];

    // Split the path data into commands and coordinates
    const parts = d.match(/[a-zA-Z][^a-zA-Z]*/g);
    const points = [];
    let currentX = 0;
    let currentY = 0;

    parts.forEach(part => {
        const command = part[0];
        const coords = part.slice(1).trim().split(/[\s,]+/).map(Number);

        switch (command.toUpperCase()) {
            case 'M': // Move to (absolute)
                currentX = coords[0];
                currentY = coords[1];
                points.push({ x: currentX, y: currentY });
                break;
            case 'L': // Line to (absolute)
                currentX = coords[0];
                currentY = coords[1];
                points.push({ x: currentX, y: currentY });
                break;
            case 'H': // Horizontal line (absolute)
                currentX = coords[0];
                points.push({ x: currentX, y: currentY });
                break;
            case 'V': // Vertical line (absolute)
                currentY = coords[0];
                points.push({ x: currentX, y: currentY });
                break;
            case 'Z': // Close path
                if (points.length > 0) {
                    points.push({ x: points[0].x, y: points[0].y });
                }
                break;
            // Add relative commands if needed
            case 'm': // Move to (relative)
                currentX += coords[0];
                currentY += coords[1];
                points.push({ x: currentX, y: currentY });
                break;
            case 'l': // Line to (relative)
                currentX += coords[0];
                currentY += coords[1];
                points.push({ x: currentX, y: currentY });
                break;
            case 'h': // Horizontal line (relative)
                currentX += coords[0];
                points.push({ x: currentX, y: currentY });
                break;
            case 'v': // Vertical line (relative)
                currentY += coords[0];
                points.push({ x: currentX, y: currentY });
                break;
        }
    });

    return points;
}

function cleanupFindMode() {
    // Restore all labels and leader lines
    document.querySelectorAll('.label-box').forEach(label => {
        label.style.visibility = 'visible';
        label.style.opacity = '1';
    });

    document.querySelectorAll('.leader-line').forEach(line => {
        line.style.visibility = 'visible';
        line.style.opacity = '1';
    });

    // Note: Reference points remain hidden in find mode
    // They will be properly restored in cleanupTest() when the test is fully ended
}

// Add a global counter for label IDs
let labelIdCounter = 1;

function isPointNearPolyline(x, y, points) {
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        if (distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y) === 0) {
            return true;
        }
    }
    return false;
}

function distanceToLineSegment(x, y, x1, y1, x2, y2) {
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;

    if (len_sq !== 0) {
        param = dot / len_sq;
    }

    let xx, yy;

    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

// Add this helper near getPointsFromPath
function getPointsFromPolyline(pointsAttr) {
    if (!pointsAttr) return [];
    return pointsAttr.trim().split(' ').map(pair => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
    });
}

// Add this function for aggressive debugging
function isPointOnLine(x, y, points, buffer) {
    let minDist = Infinity;
    let minSeg = -1;
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dist = distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y);
        if (dist < minDist) {
            minDist = dist;
            minSeg = i;
        }
        if (dist <= buffer) {
            return true;
        }
    }
    return false;
}

// Add this helper near toggleEditMode
function showReferencePoints() {
    document.querySelectorAll('.ref-point').forEach(point => {
        point.style.visibility = 'visible';
    });
}

// Add image load handler to update overlays after image loads
mapImage.addEventListener('load', updateAllPositions);

// Tag/Type Management
let tags = [];
let currentType = '';
let tagToEdit = null;
let tagToDelete = null;

function loadTags() {
    const stored = localStorage.getItem('mapTags');
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) {
                tags = parsed;
            } else {
                tags = ['Fix', 'Navaid', 'Warning Area', 'Airway', 'Sector'];
            }
        } catch (e) {
            tags = ['Fix', 'Navaid', 'Warning Area', 'Airway', 'Sector'];
        }
    } else {
        tags = ['Fix', 'Navaid', 'Warning Area', 'Airway', 'Sector'];
    }
    currentType = localStorage.getItem('currentType') || tags[0];
}

function saveTags() {
    localStorage.setItem('mapTags', JSON.stringify(tags));
    localStorage.setItem('currentType', currentType);
}

// Track the last tag order for FLIP animation
let lastTagOrder = [];

// Add global flag for tag panel editing mode
let tagPanelEditing = false;

function renderTagPanel() {
    const tagTypeList = document.getElementById('tagTypeList');
    // FLIP animation logic (unchanged)
    const prevPositions = new Map();
    const prevOrder = lastTagOrder.join('|');
    const currOrder = tags.join('|');
    const shouldAnimate = prevOrder !== currOrder && lastTagOrder.length > 0;
    if (shouldAnimate) {
        Array.from(tagTypeList.children).forEach(li => {
            prevPositions.set(li.textContent, li.getBoundingClientRect());
        });
    }
    tagTypeList.innerHTML = '';
    tags.forEach((tag, idx) => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.justifyContent = 'space-between';
        li.style.padding = '8px 12px';
        li.style.borderRadius = '6px';
        li.style.fontWeight = '500';
        li.style.background = (tag === currentType) ? '#2196F3' : 'transparent';
        li.style.color = (tag === currentType) ? 'white' : '#333';
        li.style.cursor = 'pointer';
        li.style.transition = 'background-color 0.2s ease';

        // Add hover effect for better UX
        li.addEventListener('pointerenter', () => {
            if (tag !== currentType) {
                li.style.background = 'rgba(33, 150, 243, 0.1)';
            }
        });

        li.addEventListener('pointerleave', () => {
            if (tag !== currentType) {
                li.style.background = 'transparent';
            }
        });

        // Add click handler to the entire li element
        li.addEventListener('click', (e) => {
            // Don't trigger if clicking on interactive elements (buttons, etc.)
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                return;
            }

            currentType = tag;
            if (tagVisibility[tag] === false) {
                setTagVisibility(tag, true);
            } else {
                saveTags();
                renderTagPanel();
            }
        });

        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // --- Visibility toggle ---
        const visBtn = document.createElement('button');
        visBtn.title = tagVisibility[tag] === false ? 'Show this tag type' : 'Hide this tag type';
        visBtn.style.color = (tag === currentType) ? 'white' : '#333';
        visBtn.innerHTML = `
    <span class="tag-eye-icon">
        <i class="fas fa-eye" style="opacity:${tagVisibility[tag] === false ? '0' : '1'};"></i>
        <i class="fas fa-eye-slash" style="opacity:${tagVisibility[tag] === false ? '1' : '0'};"></i>
    </span>
    `;
        visBtn.style.width = '28px';
        visBtn.style.height = '28px';
        visBtn.style.marginRight = '0';
        visBtn.style.padding = '0';
        visBtn.onclick = function (e) {
            e.stopPropagation();
            setTagVisibility(tag, tagVisibility[tag] === false);
        };
        li.appendChild(visBtn);
        // --- Up/Down reorder buttons (only in edit mode) ---
        const orderGroup = document.createElement('div');
        orderGroup.style.display = 'flex';
        orderGroup.style.flexDirection = 'row';
        orderGroup.style.gap = '2px';
        orderGroup.style.marginLeft = '6px';
        orderGroup.style.marginRight = '8px';
        if (tagPanelEditing) {
            // Up button
            const upBtn = document.createElement('button');
            upBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
            upBtn.style.background = 'none';
            upBtn.style.border = 'none';
            upBtn.style.cursor = idx === 0 ? 'not-allowed' : 'pointer';
            upBtn.style.fontSize = '14px';
            upBtn.style.padding = '0 2px';
            upBtn.disabled = idx === 0;
            upBtn.title = 'Move up';
            upBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
            upBtn.style.color = (tag === currentType) ? 'white' : '#333';
            upBtn.onclick = function (e) {
                e.stopPropagation();
                if (idx > 0) {
                    const tmp = tags[idx - 1];
                    tags[idx - 1] = tags[idx];
                    tags[idx] = tmp;
                    saveTags();
                    renderTagPanel();
                }
            };
            orderGroup.appendChild(upBtn);
            // Down button
            const downBtn = document.createElement('button');
            downBtn.innerHTML = '<i class="fas fa-arrow-down"></i>';
            downBtn.style.background = 'none';
            downBtn.style.border = 'none';
            downBtn.style.cursor = idx === tags.length - 1 ? 'not-allowed' : 'pointer';
            downBtn.style.fontSize = '14px';
            downBtn.style.padding = '0 2px';
            downBtn.disabled = idx === tags.length - 1;
            downBtn.title = 'Move down';
            downBtn.style.visibility = idx === tags.length - 1 ? 'hidden' : 'visible';
            downBtn.style.color = (tag === currentType) ? 'white' : '#333';
            downBtn.onclick = function (e) {
                e.stopPropagation();
                if (idx < tags.length - 1) {
                    const tmp = tags[idx + 1];
                    tags[idx + 1] = tags[idx];
                    tags[idx] = tmp;
                    saveTags();
                    renderTagPanel();
                }
            };
            orderGroup.appendChild(downBtn);
        }
        li.appendChild(orderGroup);
        // Tag name clickable for selection
        const tagSpan = document.createElement('span');
        tagSpan.textContent = tag;

        // Add element count badge
        const elementCount = getElementCountForTag(tag);
        const countBadge = createElementCountBadge(elementCount);
        tagSpan.appendChild(countBadge);

        // Add highlighting for both mouse and touch events
        let highlightTimeout;

        // Mouse events for desktop
        li.addEventListener('pointerenter', () => {
            highlightElementsWithTag(tag);
        });

        li.addEventListener('pointerleave', () => {
            removeElementHighlighting();
        });

        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        li.appendChild(tagSpan);
        // Edit/Delete buttons (only in edit mode)
        const btnGroup = document.createElement('div');
        if (tagPanelEditing) {
            // Rename button
            const editBtn = document.createElement('button');
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.title = 'Rename tag';
            editBtn.style.background = '#FFC107';
            editBtn.style.color = '#333';
            editBtn.style.border = 'none';
            editBtn.style.borderRadius = '4px';
            editBtn.style.padding = '4px 8px';
            editBtn.style.fontSize = '13px';
            editBtn.style.cursor = 'pointer';
            editBtn.style.marginRight = '6px';
            editBtn.style.width = '28px';
            editBtn.style.height = '28px';
            editBtn.style.display = 'flex';
            editBtn.style.alignItems = 'center';
            editBtn.style.justifyContent = 'center';
            editBtn.onclick = function (e) {
                e.stopPropagation();
                tagToEdit = tag;
                document.getElementById('editTagInput').value = tag;
                document.getElementById('editTagModalBackdrop').style.display = 'block';
                document.getElementById('editTagModal').style.display = 'block';
            };
            btnGroup.appendChild(editBtn);
            // Only show delete button if more than one tag exists
            if (tags.length > 1) {
                const delBtn = document.createElement('button');
                delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                delBtn.title = 'Delete tag';
                delBtn.style.background = '#f44336';
                delBtn.style.color = 'white';
                delBtn.style.border = 'none';
                delBtn.style.borderRadius = '4px';
                delBtn.style.padding = '4px 8px';
                delBtn.style.fontSize = '13px';
                delBtn.style.cursor = 'pointer';
                delBtn.style.width = '28px';
                delBtn.style.height = '28px';
                delBtn.style.display = 'flex';
                delBtn.style.alignItems = 'center';
                delBtn.style.justifyContent = 'center';
                delBtn.onclick = function (e) {
                    e.stopPropagation();
                    tagToDelete = tag;
                    // Check if any elements use this tag
                    const usedBy = [
                        ...points.filter(l => l.type === tag),
                        ...polygons.filter(p => p.type === tag),
                        ...lines.filter(l => l.type === tag)
                    ];
                    if (usedBy.length === 0) {
                        tags = tags.filter(t => t !== tag);
                        if (currentType === tag) currentType = tags[0] || '';
                        saveTags();
                        renderTagPanel();
                        return;
                    }
                    const msg = document.getElementById('deleteTagMsg');
                    const modal = document.getElementById('deleteTagModal');
                    const prevDropdown = document.getElementById('deleteTagDropdown');
                    if (prevDropdown) prevDropdown.remove();
                    msg.innerHTML = `There are <b>${usedBy.length}</b> elements using the tag "${tag}".<br>Please select a new tag type to reassign them to before deleting.`;
                    const select = document.createElement('select');
                    select.id = 'deleteTagDropdown';
                    select.style.margin = '16px 0 0 0';
                    select.style.padding = '8px';
                    select.style.borderRadius = '6px';
                    select.style.border = '1px solid #ccc';
                    select.style.fontSize = '15px';
                    tags.filter(t => t !== tag).forEach(t => {
                        const opt = document.createElement('option');
                        opt.value = t;
                        opt.textContent = t;
                        select.appendChild(opt);
                    });
                    msg.appendChild(select);
                    document.getElementById('deleteTagModalBackdrop').style.display = 'block';
                    modal.style.display = 'block';
                };
                btnGroup.appendChild(delBtn);
            }
        }
        li.appendChild(btnGroup);
        tagTypeList.appendChild(li);
    });
    // FLIP animation after DOM update (unchanged)
    if (shouldAnimate) {
        requestAnimationFrame(() => {
            Array.from(tagTypeList.children).forEach(li => {
                const prev = prevPositions.get(li.textContent);
                if (prev) {
                    const now = li.getBoundingClientRect();
                    const dy = prev.top - now.top;
                    if (dy !== 0) {
                        li.style.transition = 'none';
                        li.style.transform = `translateY(${dy}px)`;
                        li.classList.add('moving');
                        void li.offsetHeight;
                        li.style.transition = 'transform 0.25s cubic-bezier(.4,2,.6,1), opacity 0.2s';
                        li.style.transform = '';
                        setTimeout(() => {
                            li.classList.remove('moving');
                            li.style.transition = '';
                        }, 300);
                    }
                }
            });
        });
    }
    lastTagOrder = tags.slice();
    // --- Edit/Done button at top ---
    const tagPanel = document.getElementById('tagPanel');
    const panelHeader = tagPanel && tagPanel.querySelector('div');
    if (panelHeader) {
        // Remove any previous edit/done buttons
        Array.from(panelHeader.querySelectorAll('.tag-edit-btn, .tag-done-btn')).forEach(btn => btn.remove());
        // Find the h2 and close button
        const h2 = panelHeader.querySelector('h2');
        const closeBtn = panelHeader.querySelector('button');
        // Create edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'tag-edit-btn';
        editBtn.textContent = 'Edit';
        editBtn.style.background = '#e3eafc';
        editBtn.style.color = '#1976D2';
        editBtn.style.border = 'none';
        editBtn.style.borderRadius = '6px';
        editBtn.style.fontSize = '15px';
        editBtn.style.cursor = 'pointer';
        editBtn.style.padding = '5px 14px';
        editBtn.style.marginLeft = '10px';
        editBtn.onclick = function () {
            tagPanelEditing = true;
            renderTagPanel();
        };
        // Create done button
        const doneBtn = document.createElement('button');
        doneBtn.className = 'tag-done-btn';
        doneBtn.textContent = 'Done';
        doneBtn.style.background = '#2196F3';
        doneBtn.style.color = 'white';
        doneBtn.style.border = 'none';
        doneBtn.style.borderRadius = '6px';
        doneBtn.style.fontSize = '15px';
        doneBtn.style.cursor = 'pointer';
        doneBtn.style.padding = '5px 14px';
        doneBtn.style.marginLeft = '10px';
        doneBtn.onclick = function () {
            tagPanelEditing = false;
            clearTagError();
            renderTagPanel();
        };
        // Insert after h2, before close button
        if (h2 && closeBtn) {
            panelHeader.insertBefore(editBtn, closeBtn);
            panelHeader.insertBefore(doneBtn, closeBtn);
        }
        editBtn.style.display = tagPanelEditing ? 'none' : '';
        doneBtn.style.display = tagPanelEditing ? '' : 'none';
    }
    // --- Add section (only in edit mode) ---
    const addSection = document.getElementById('newTagInput')?.parentElement;
    if (addSection) {
        addSection.style.display = tagPanelEditing ? 'flex' : 'none';
    }
}

// When the panel is closed, exit edit mode
function toggletagPanel(forceOpen) {
    const panel = document.getElementById('tagPanel');
    const computedStyle = window.getComputedStyle(panel);
    const isClosed = (computedStyle.display === 'none' || computedStyle.transform === 'translateX(100%)' || panel.style.transform === 'translateX(100%)');

    if (!isClosed === forceOpen) return; // already in requested state

    if (isClosed) {
        renderTagPanel();
        panel.style.display = 'block';
        // Use double requestAnimationFrame for reliable animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                panel.style.transform = 'translateX(0)';
            });
        });
    } else {
        // Clear error message when closing the panel
        clearTagError();
        panel.style.transform = 'translateX(100%)';
        setTimeout(() => {
            panel.style.display = 'none';
            tagPanelEditing = false;
            renderTagPanel();
        }, 300);
    }

    // Update SVG dimensions and positions after layout changes
    requestAnimationFrame(() => {
        updateSVGDimensions();
        updateAllPositions();
        updateLeaderLines();
    });
}

function addNewTag() {
    const input = document.getElementById('newTagInput');
    const errorElement = document.getElementById('newTagError');
    const val = input.value.trim();

    // Clear any existing error message
    clearTagError();

    if (val) {
        if (tags.includes(val)) {
            // Show error message for duplicate tag
            errorElement.style.display = 'block';
            // Add a subtle shake animation to the input
            input.style.animation = 'shake 0.5s ease-in-out';
            setTimeout(() => {
                input.style.animation = '';
            }, 500);
        } else {
            // Add the new tag
            tags.push(val);
            saveTags();
            renderTagPanel();
            input.value = '';
        }
    }
}

// Edit Tag Modal logic
function closeEditTagModal() {
    clearEditTagError();
    document.getElementById('editTagModalBackdrop').style.display = 'none';
    document.getElementById('editTagModal').style.display = 'none';
    tagToEdit = null;
}
function saveEditTag() {
    const newName = document.getElementById('editTagInput').value.trim();
    const errorElement = document.getElementById('editTagError');
    const input = document.getElementById('editTagInput');

    // Clear any existing error message
    clearEditTagError();

    if (!newName) return;

    if (tags.includes(newName)) {
        // Show error message for duplicate tag
        errorElement.style.display = 'block';
        // Add a subtle shake animation to the input
        input.style.animation = 'shake 0.5s ease-in-out';
        setTimeout(() => {
            input.style.animation = '';
        }, 500);
        return;
    }

    // Update tag in tags array
    const idx = tags.indexOf(tagToEdit);
    if (idx !== -1) tags[idx] = newName;
    // Update all elements using this tag
    points.forEach(l => { if (l.type === tagToEdit) l.type = newName; });
    polygons.forEach(p => { if (p.type === tagToEdit) p.type = newName; });
    lines.forEach(l => { if (l.type === tagToEdit) l.type = newName; });
    // Update currentType if needed
    if (currentType === tagToEdit) currentType = newName;
    saveTags();
    renderTagPanel();
    closeEditTagModal();
}

// Delete Tag Modal logic
function closeDeleteTagModal() {
    document.getElementById('deleteTagModalBackdrop').style.display = 'none';
    document.getElementById('deleteTagModal').style.display = 'none';
    tagToDelete = null;
}
function confirmDeleteTag() {
    // Remove tag from tags array
    const prevTags = [...tags];
    tags = tags.filter(t => t !== tagToDelete);
    // Check if a dropdown exists (i.e., elements use this tag)
    const dropdown = document.getElementById('deleteTagDropdown');
    let fallback = tags[0] || '';
    if (dropdown) {
        fallback = dropdown.value;
    }
    // Update all elements using this tag to the selected fallback
    points.forEach(l => { if (l.type === tagToDelete) l.type = fallback; });
    polygons.forEach(p => { if (p.type === tagToDelete) p.type = fallback; });
    lines.forEach(l => { if (l.type === tagToDelete) l.type = fallback; });
    // Update currentType if needed
    if (currentType === tagToDelete) currentType = fallback;
    saveTags();
    renderTagPanel();
    closeDeleteTagModal();
}

// Load tags on startup
loadTags();

// When adding a new point, use the currentType
function addLabel(x, y) {
    if (!editEnabled || currentMode !== 'point') return;
    const refX = x;
    const refY = y;
    const labelX = x + 20;
    const labelY = y + 20;
    const { refPointEl, labelBoxEl } = createLabel(refX, refY, labelX, labelY, '', true, false, true);
    const relCoords = toRelativeCoords(refX, refY);
    const relLabelCoords = toRelativeCoords(labelX, labelY);
    const labelObj = {
        refPointEl,
        labelBoxEl,
        refX,
        refY,
        labelX,
        labelY,
        relRefX: relCoords.x,
        relRefY: relCoords.y,
        relLabelX: relLabelCoords.x,
        relLabelY: relLabelCoords.y,
        correctText: '',
        userGuess: '',
        type: currentType || tags[0] || ''
    };
    points.push(labelObj);
    updateLeaderLines();
    // Always make label editable and focus after a short delay to ensure keyboard opens
    labelBoxEl.contentEditable = 'true';
    // Add keyboard event listener if not already added
    if (!labelBoxEl.hasAttribute('data-keydown-added')) {
        labelBoxEl.addEventListener('keydown', handleLabelKeydown);
        labelBoxEl.setAttribute('data-keydown-added', 'true');
    }
    setTimeout(() => {
        labelBoxEl.focus();
        // Place cursor at end
        if (window.getSelection && labelBoxEl.childNodes.length > 0) {
            const range = document.createRange();
            range.selectNodeContents(labelBoxEl);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }

    }, 0);

    // Remove contentEditable when user blurs the label
    labelBoxEl.addEventListener('blur', () => {
        labelBoxEl.contentEditable = 'false';
    }, { once: true });
    updateLabelEditable();
    updateLeaderLines();
    updateSaveButtonState();
    renderTagPanel();
}

// --- Test Tag Type Modal Logic ---
let pendingTestMode = null;
let pendingTestModeCallback = null;
function showTestTagTypeModal(testMode, callback) {
    pendingTestMode = testMode;
    pendingTestModeCallback = callback;
    const modal = document.getElementById('testTagTypeModal');
    const form = document.getElementById('testTagTypeForm');
    form.innerHTML = '';

    // Get element counts for each tag
    const tagElementCounts = {};
    tags.forEach(tag => {
        tagElementCounts[tag] = getElementCountForTag(tag);
    });

    // Check if any tags have elements
    const hasAnyElements = Object.values(tagElementCounts).some(count => count > 0);

    tags.forEach(tag => {
        const id = `testTagType_${tag}`;
        const div = document.createElement('div');
        const elementCount = tagElementCounts[tag];
        const isDisabled = elementCount === 0;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.value = tag;
        checkbox.checked = !isDisabled; // Only check if not disabled
        checkbox.disabled = isDisabled;
        checkbox.className = isDisabled ? 'disabled-checkbox' : '';

        div.appendChild(checkbox);
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = tag;
        label.className = isDisabled ? 'disabled-label' : '';

        // Add element count badge
        const countBadge = createElementCountBadge(elementCount);
        if (isDisabled) {
            countBadge.className = 'element-count-badge disabled-badge';
            countBadge.title = 'No elements with this tag type';
        }
        label.appendChild(countBadge);

        label.style.marginLeft = '8px';
        label.style.cursor = isDisabled ? 'not-allowed' : 'pointer';

        // Add highlighting for both mouse and touch events (only if not disabled)
        if (!isDisabled) {
            let highlightTimeout;

            // Mouse events for desktop
            div.addEventListener('pointerenter', () => {
                highlightElementsWithTag(tag);
            });

            div.addEventListener('pointerleave', () => {
                removeElementHighlighting();
            });

            div.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });
        }

        div.appendChild(label);
        form.appendChild(div);

        // Add click event listener to the entire div to toggle checkbox
        if (!isDisabled) {
            div.addEventListener('click', (e) => {
                // Don't trigger if clicking on the checkbox itself or its label (to avoid double-toggling)
                if (e.target.type === 'checkbox' || e.target.tagName === 'LABEL' || e.target.closest('label')) {
                    return;
                }
                // Toggle the checkbox
                checkbox.checked = !checkbox.checked;
                // Trigger change event to update button state
                checkbox.dispatchEvent(new Event('change'));
            });
        }
    });

    modal.style.display = 'block';

    // Add select/deselect all logic
    setTimeout(() => {
        const selectAllBtn = document.getElementById('selectAllTestTagsBtn');
        const deselectAllBtn = document.getElementById('deselectAllTestTagsBtn');

        if (selectAllBtn) {
            selectAllBtn.onclick = function () {
                const form = document.getElementById('testTagTypeForm');
                form.querySelectorAll('input[type=checkbox]:not(:disabled)').forEach(cb => {
                    cb.checked = true;
                });
                updateStartTestButtonState();
            };
        }

        if (deselectAllBtn) {
            deselectAllBtn.onclick = function () {
                const form = document.getElementById('testTagTypeForm');
                form.querySelectorAll('input[type=checkbox]').forEach(cb => {
                    cb.checked = false;
                });
                updateStartTestButtonState();
            };
        }

        // Add change listeners to checkboxes to update button state
        const checkboxes = form.querySelectorAll('input[type=checkbox]:not(:disabled)');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', updateStartTestButtonState);
        });

        updateStartTestButtonState();
    }, 0);
}
function closeTestTagTypeModal() {
    document.getElementById('testTagTypeModal').style.display = 'none';
    pendingTestMode = null;
    pendingTestModeCallback = null;
}
function confirmTestTagTypeModal() {
    const form = document.getElementById('testTagTypeForm');
    const checked = Array.from(form.querySelectorAll('input[type=checkbox]:checked:not(:disabled)')).map(cb => cb.value);

    // Sync tag visibility with the selected tags for testing
    // Set visibility to true for selected tags, false for unselected tags
    tags.forEach(tag => {
        const isSelected = checked.includes(tag);
        setTagVisibility(tag, isSelected);
    });

    if (pendingTestModeCallback) {
        pendingTestModeCallback(checked);
    }
    closeTestTagTypeModal();
}

// Change Tag Mode
let changeTagMode = false;

function toggleChangeTagMode() {
    if (!editEnabled) return;
    // Open the tag panel if not already open
    const tagPanel = document.getElementById('tagPanel');
    if (tagPanel && (tagPanel.style.display === 'none' || tagPanel.style.transform === 'translateX(100%)')) {
        renderTagPanel();
        tagPanel.style.display = 'block';
        setTimeout(() => { tagPanel.style.transform = 'translateX(0)'; }, 10);
    }
    // If in add, polygon, or line mode, exit that mode
    if (currentMode) {
        const currentBtn = document.getElementById(`${currentMode}Btn`);
        if (currentBtn) {
            currentBtn.classList.remove('active');
            currentBtn.setAttribute('aria-pressed', 'false');
        }
    }
    if (['point', 'polygon', 'line'].includes(currentMode)) {
        // Use setMode(null) to exit any other mode for better integration
        setMode(null);
    }
    changeTagMode = !changeTagMode;
    const btn = document.getElementById('tagPanelBtn');
    btn.classList.toggle('active', changeTagMode);
    btn.setAttribute('aria-pressed', changeTagMode);
    // Change cursor for feedback
    if (changeTagMode) {
        mapContainer.style.cursor = 'normal';
    } else {
        updateCursorStyles(currentMode);
    }
}

// Exit change tag mode when edit mode is turned off
const origToggleEditMode = toggleEditMode;
toggleEditMode = function () {
    if (changeTagMode) {
        changeTagMode = false;
        const btn = document.getElementById('tagPanelBtn');
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
        updateCursorStyles(currentMode);
    }
    origToggleEditMode.apply(this, arguments);
};

// Change tag on click in changeTag mode
mapContainer.addEventListener('click', function (e) {
    if (!editEnabled || currentMode !== 'changeTag') return;
    const rect = mapContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let changed = false;
    let changedLabelBox = null;
    // Check regular labels
    for (const point of points) {
        const refRect = point.refPointEl.getBoundingClientRect();
        const labelRect = point.labelBoxEl.getBoundingClientRect();
        const offsetX = rect.left;
        const offsetY = rect.top;
        if (
            x >= refRect.left - offsetX && x <= refRect.right - offsetX &&
            y >= refRect.top - offsetY && y <= refRect.bottom - offsetY
        ) {
            point.type = currentType;
            changed = true;
            changedLabelBox = point.labelBoxEl;
            break;
        }
        if (
            x >= labelRect.left - offsetX && x <= labelRect.right - offsetX &&
            y >= labelRect.top - offsetY && y <= labelRect.bottom - offsetY
        ) {
            point.type = currentType;
            changed = true;
            changedLabelBox = point.labelBoxEl;
            break;
        }
    }
    // Check polygons
    if (!changed) {
        for (const polygon of polygons) {
            const labelRect = polygon.labelBoxEl.getBoundingClientRect();
            if (
                x >= labelRect.left - rect.left && x <= labelRect.right - rect.left &&
                y >= labelRect.top - rect.top && y <= labelRect.bottom - rect.top
            ) {
                polygon.type = currentType;
                polygon.anchorPoint.element.setAttribute('data-type', currentType);
                polygon.svgPath.setAttribute('data-type', currentType);
                polygon.points.forEach(p => p.element.setAttribute('data-type', currentType));
                changed = true;
                changedLabelBox = polygon.labelBoxEl;
                break;
            }
        }
    }
    // Check lines
    if (!changed) {
        for (const line of lines) {
            const labelRect = line.labelBoxEl.getBoundingClientRect();
            if (
                x >= labelRect.left - rect.left && x <= labelRect.right - rect.left &&
                y >= labelRect.top - rect.top && y <= labelRect.bottom - rect.top
            ) {
                line.type = currentType;
                line.anchorPoint.setAttribute('data-type', currentType);
                line.polyline.setAttribute('data-type', currentType);
                line.points.forEach(p => p.element.setAttribute('data-type', currentType));
                changed = true;
                changedLabelBox = line.labelBoxEl;
                break;
            }
        }
    }
    if (changed) {
        saveTags();
        renderTagPanel();
        // Update leader line data-type for the changed element
        if (changedLabelBox && changedLabelBox.id) {
            const line = document.querySelector(`.leader-line[data-for="${changedLabelBox.id}"]`);
            if (line) line.setAttribute('data-type', currentType);

            // Visual indication: highlight the changed element and ALL its related components
            changedLabelBox.classList.add('tag-changed');

            // Also highlight the reference point if it exists (for points)
            const refPoint = changedLabelBox.previousElementSibling;
            if (refPoint && refPoint.classList.contains('ref-point')) {
                refPoint.classList.add('tag-changed');
            }

            // Also highlight the leader line if it exists
            if (line) {
                line.classList.add('tag-changed');
            }

            // Find and highlight the associated polygon or line elements
            // Check if this is a polygon label
            const polygon = polygons.find(p => p.labelBoxEl === changedLabelBox);
            if (polygon) {
                // Highlight polygon path
                if (polygon.svgPath) {
                    polygon.svgPath.classList.add('tag-changed');
                }
                // Highlight polygon points
                polygon.points.forEach(p => {
                    if (p.element) {
                        p.element.classList.add('tag-changed');
                    }
                });
                // Highlight anchor point
                if (polygon.anchorPoint && polygon.anchorPoint.element) {
                    polygon.anchorPoint.element.classList.add('tag-changed');
                }
            }

            // Check if this is a line label
            const lineObj = lines.find(l => l.labelBoxEl === changedLabelBox);
            if (lineObj) {
                // Highlight line path
                if (lineObj.polyline) {
                    lineObj.polyline.classList.add('tag-changed');
                }
                // Highlight line points
                lineObj.points.forEach(p => {
                    if (p.element) {
                        p.element.classList.add('tag-changed');
                    }
                });
                // Highlight anchor point
                if (lineObj.anchorPoint) {
                    lineObj.anchorPoint.classList.add('tag-changed');
                }
            }

            // Remove highlighting after 700ms
            setTimeout(() => {
                changedLabelBox.classList.remove('tag-changed');
                if (refPoint && refPoint.classList.contains('ref-point')) {
                    refPoint.classList.remove('tag-changed');
                }
                if (line) {
                    line.classList.remove('tag-changed');
                }

                // Remove highlighting from polygon elements
                if (polygon) {
                    if (polygon.svgPath) {
                        polygon.svgPath.classList.remove('tag-changed');
                    }
                    polygon.points.forEach(p => {
                        if (p.element) {
                            p.element.classList.remove('tag-changed');
                        }
                    });
                    if (polygon.anchorPoint && polygon.anchorPoint.element) {
                        polygon.anchorPoint.element.classList.remove('tag-changed');
                    }
                }

                // Remove highlighting from line elements
                if (lineObj) {
                    if (lineObj.polyline) {
                        lineObj.polyline.classList.remove('tag-changed');
                    }
                    lineObj.points.forEach(p => {
                        if (p.element) {
                            p.element.classList.remove('tag-changed');
                        }
                    });
                    if (lineObj.anchorPoint) {
                        lineObj.anchorPoint.classList.remove('tag-changed');
                    }
                }
            }, 700);
        }
        updateTagVisibilityOnMap();
    }
});

// --- Integrate changeTag mode into setMode ---
// (Add this at the end of setMode)
(function () {
    const origSetMode = setMode;
    setMode = function (mode) {
        const prevMode = currentMode;
        origSetMode.apply(this, arguments);
        // UI for changeTag mode
        const tagPanelBtn = document.getElementById('tagPanelBtn');
        if (tagPanelBtn) {
            tagPanelBtn.classList.toggle('active', currentMode === 'changeTag');
            tagPanelBtn.setAttribute('aria-pressed', currentMode === 'changeTag');
            if (currentMode === 'changeTag') {
                mapContainer.style.cursor = 'normal';
                // Open the tag panel if not already open
                toggletagPanel(true);
            } else {
                updateCursorStyles(currentMode);
            }
        }
    };
})();

// --- Tag Visibility State ---
let tagVisibility = {};
function loadTagVisibility() {
    try {
        tagVisibility = JSON.parse(localStorage.getItem('tagVisibility') || '{}');
    } catch { tagVisibility = {}; }
    // Ensure all tags have a value
    tags.forEach(tag => { if (!(tag in tagVisibility)) tagVisibility[tag] = true; });
}
function saveTagVisibility() {
    localStorage.setItem('tagVisibility', JSON.stringify(tagVisibility));
}
function setTagVisibility(tag, visible) {
    tagVisibility[tag] = visible;
    saveTagVisibility();
    updateTagVisibilityOnMap();
    renderTagPanel();
}
function updateTagVisibilityOnMap() {
    // Labels
    points.forEach(l => {
        l.labelBoxEl.style.visibility = tagVisibility[l.type] !== false ? 'visible' : 'hidden';
        // Reference points should be visible in edit mode only if the tag is not hidden
        if (l.refPointEl) {
            const shouldBeVisible = editEnabled && tagVisibility[l.type] !== false;
            l.refPointEl.style.visibility = shouldBeVisible ? 'visible' : 'hidden';
        }
    });
    // Polygons
    polygons.forEach(p => {
        if (p.labelBoxEl) p.labelBoxEl.style.visibility = tagVisibility[p.type] !== false ? 'visible' : 'hidden';
        if (p.svgPath) p.svgPath.style.visibility = tagVisibility[p.type] !== false ? 'visible' : 'hidden';
        if (p.points) p.points.forEach(pt => {
            if (pt.element) {
                const shouldBeVisible = editEnabled && tagVisibility[p.type] !== false;
                pt.element.style.visibility = shouldBeVisible ? 'visible' : 'hidden';
            }
        });
    });
    // Lines
    lines.forEach(l => {
        if (l.labelBoxEl) l.labelBoxEl.style.visibility = tagVisibility[l.type] !== false ? 'visible' : 'hidden';
        if (l.polyline) l.polyline.style.visibility = tagVisibility[l.type] !== false ? 'visible' : 'hidden';
        if (l.anchorPoint) {
            const shouldBeVisible = editEnabled && tagVisibility[l.type] !== false;
            l.anchorPoint.style.visibility = shouldBeVisible ? 'visible' : 'hidden';
        }
    });
    // Leader lines
    document.querySelectorAll('.leader-line').forEach(line => {
        const type = line.getAttribute('data-type');
        line.style.visibility = tagVisibility[type] !== false ? 'visible' : 'hidden';
    });
    // Polygon/line points, anchors, and paths
    document.querySelectorAll('.polygon-point, .polygon-anchor, .polygon-path, .line-path').forEach(el => {
        const type = el.getAttribute('data-type');
        if (el.classList.contains('polygon-point') || el.classList.contains('polygon-anchor')) {
            // Points and anchors should be visible in edit mode only if the tag is not hidden
            const shouldBeVisible = editEnabled && tagVisibility[type] !== false;
            el.style.visibility = shouldBeVisible ? 'visible' : 'hidden';
        } else {
            // Paths should be visible if the tag is not hidden
            el.style.visibility = tagVisibility[type] !== false ? 'visible' : 'hidden';
        }
    });
}

// Ensure tagVisibility is loaded on startup
document.addEventListener('DOMContentLoaded', loadTagVisibility);

// --- Identify Elements Test Mode: Temporary Element Visibility ---
let prevElementDisplayMap = new Map();

function setIdentifyTestVisibility(testItems) {
    prevElementDisplayMap.clear();
    // Build a Set of labelBoxEls, polygon labelBoxEls, line labelBoxEls, and their associated shapes/lines
    const testLabelEls = new Set(testItems.map(item => item.label));
    const testPolygonPaths = new Set(testItems.filter(item => item.type === 'polygon').map(item => item.element));
    const testLinePolylines = new Set(testItems.filter(item => item.type === 'line').map(item => item.element));

    // LABELS
    document.querySelectorAll('.label-box').forEach(el => {
        prevElementDisplayMap.set(el, el.style.visibility);
        el.style.visibility = testLabelEls.has(el) ? 'visible' : 'hidden';
    });
    // POLYGON SHAPES
    document.querySelectorAll('.polygon-path').forEach(el => {
        prevElementDisplayMap.set(el, el.style.visibility);
        el.style.visibility = testPolygonPaths.has(el) ? 'visible' : 'hidden';
    });
    // LINE SHAPES
    document.querySelectorAll('.line-path').forEach(el => {
        prevElementDisplayMap.set(el, el.style.visibility);
        el.style.visibility = testLinePolylines.has(el) ? 'visible' : 'hidden';
    });
    // LEADER LINES
    document.querySelectorAll('.leader-line').forEach(el => {
        // Find the label this line is for
        const forId = el.getAttribute('data-for');
        const label = forId && document.getElementById(forId);
        prevElementDisplayMap.set(el, el.style.visibility);
        el.style.visibility = (label && testLabelEls.has(label)) ? 'visible' : 'hidden';
    });
    // Hide all ref-points (red points)
    document.querySelectorAll('.ref-point').forEach(el => {
        prevElementDisplayMap.set(el, el.style.visibility);
        el.style.visibility = 'hidden';
    });
    // Hide all polygon/line points and anchors
    document.querySelectorAll('.polygon-point, .polygon-anchor').forEach(el => {
        prevElementDisplayMap.set(el, el.style.visibility);
        el.style.visibility = 'hidden';
    });
}

function restoreIdentifyTestVisibility() {
    if (!prevElementDisplayMap) return;
    prevElementDisplayMap.forEach((visibility, el) => {
        el.style.visibility = visibility;
    });
    prevElementDisplayMap.clear();
}

loadMapButton.addEventListener('click', () => {
    document.getElementById('mapFileInput').click();
});

// Front load map button functionality
const frontLoadMapButton = document.getElementById('frontLoadMapButton');
const frontMapFileInput = document.getElementById('frontMapFileInput');
const frontLoadMapContainer = document.getElementById('frontLoadMapContainer');

frontLoadMapButton.addEventListener('click', () => {
    frontMapFileInput.click();
});

frontMapFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Use the same file loading logic as the original button
    const mapFileInput = document.getElementById('mapFileInput');
    const errorMessage = document.getElementById('errorMessage');
    const pageContainer = document.querySelector('.page-container');

    // Check file type
    if (!file.type.startsWith('image/')) {
        errorMessage.textContent = 'Please select a valid image file.';
        errorMessage.style.display = 'block';
        frontMapFileInput.value = '';
        return;
    }

    // Check if there are any existing labels, polygons, or lines
    const hasExistingData = points.length > 0 || polygons.length > 0 || lines.length > 0;

    const loadNewMap = () => {
        return new Promise((resolve, reject) => {
            errorMessage.style.display = 'none';

            // Reset all UI states
            resetUIState();

            // Hide save/load buttons while loading
            document.getElementById('saveElementsBtn').style.display = 'none';
            document.getElementById('loadElementsBtn').style.display = 'none';

            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();

                img.onload = () => {
                    console.log('Image loaded successfully:', img.width, 'x', img.height);
                    mapImage.src = img.src;
                    pageContainer.style.opacity = '1';
                    document.getElementById('saveElementsBtn').style.display = 'inline-block';
                    document.getElementById('loadElementsBtn').style.display = 'inline-block';

                    // Hide the front load map container
                    frontLoadMapContainer.classList.add('hidden');

                    // Clear all existing data
                    points.forEach(point => {
                        if (point.refPointEl) point.refPointEl.remove();
                        if (point.labelBoxEl) point.labelBoxEl.remove();
                    });
                    points.length = 0;

                    polygons.forEach(polygon => {
                        polygon.points.forEach(p => p.element.remove());
                        polygon.labelBoxEl.remove();
                        polygon.svgPath.remove();
                        polygon.anchorPoint.element.remove();
                    });
                    polygons.length = 0;

                    lines.forEach(line => {
                        line.points.forEach(p => p.element.remove());
                        line.labelBoxEl.remove();
                        line.polyline.remove();
                        line.anchorPoint.remove();
                    });
                    lines.length = 0;

                    // Clear SVG layers
                    while (shapesLayer.firstChild) {
                        shapesLayer.removeChild(shapesLayer.firstChild);
                    }
                    while (leaderLinesSVG.firstChild) {
                        leaderLinesSVG.removeChild(leaderLinesSVG.firstChild);
                    }

                    // Update SVG size to match new image
                    requestAnimationFrame(() => {
                        updateSVGDimensions();
                        // Reset file input to allow selecting the same file again
                        frontMapFileInput.value = '';
                        // Update save button state after clearing data
                        updateSaveButtonState();
                        resolve();
                    });
                };

                img.onerror = () => {
                    console.error('Failed to load image');
                    errorMessage.textContent = 'Failed to load the image. Please try another file.';
                    errorMessage.style.display = 'block';
                    // Keep save/load buttons hidden
                    document.getElementById('saveElementsBtn').style.display = 'none';
                    document.getElementById('loadElementsBtn').style.display = 'none';
                    // Reset file input to allow selecting the same file again
                    frontMapFileInput.value = '';
                    reject(new Error('Failed to load image'));
                };

                // Set image source from FileReader result
                img.src = e.target.result;
            };

            reader.onerror = () => {
                console.error('Failed to read file');
                errorMessage.textContent = 'Error reading the file. Please try again.';
                errorMessage.style.display = 'block';
                // Keep save/load buttons hidden
                document.getElementById('saveElementsBtn').style.display = 'none';
                document.getElementById('loadElementsBtn').style.display = 'none';
                // Reset file input to allow selecting the same file again
                frontMapFileInput.value = '';
                reject(new Error('Failed to read file'));
            };

            reader.readAsDataURL(file);
        });
    };

    if (hasExistingData) {
        // Create and show the confirmation dialog
        const dialog = document.createElement('div');
        dialog.className = 'warning-modal';
        dialog.innerHTML = `
            <div class="warning-modal-content">
                <div class="warning-modal-header">
                    <h3><i class="fas fa-exclamation-triangle"></i> Warning</h3>
                </div>
                <div class="warning-modal-body">
                    <p>Loading a new map will delete any unsaved elements. Would you like to:</p>
                    <div class="warning-modal-buttons">
                        <button id="saveAndContinue" class="warning-btn warning-btn-primary">
                            <i class="fas fa-save"></i> Save & Continue
                        </button>
                        <button id="continueWithoutSaving" class="warning-btn warning-btn-danger">
                            <i class="fas fa-exclamation-triangle"></i> Continue Without Saving
                        </button>
                        <button id="cancelLoad" class="warning-btn warning-btn-secondary">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.className = 'warning-modal-overlay';

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        // Handle dialog buttons
        document.getElementById('saveAndContinue').onclick = async () => {
            // Save current labels first
            saveElements();

            // Wait a bit for the save to complete, then update baseline data
            setTimeout(() => {
                // Update baseline data to reflect the saved state
                baselineData = getCurrentState();
            }, 500);

            dialog.remove();
            overlay.remove();
            try {
                await loadNewMap();
            } catch (error) {
                console.error('Failed to load new map:', error);
            }
        };

        document.getElementById('continueWithoutSaving').onclick = async () => {
            dialog.remove();
            overlay.remove();
            try {
                await loadNewMap();
            } catch (error) {
                console.error('Failed to load new map:', error);
            }
        };

        document.getElementById('cancelLoad').onclick = () => {
            dialog.remove();
            overlay.remove();
            // Reset the file input
            frontMapFileInput.value = '';
        };
    } else {
        // If no existing data, load the new map directly
        try {
            await loadNewMap();
        } catch (error) {
            console.error('Failed to load new map:', error);
        }
    }
});

// Helper to enable/disable the Start Test button
function updateStartTestButtonState() {
    const form = document.getElementById('testTagTypeForm');
    const checked = form.querySelectorAll('input[type=checkbox]:checked:not(:disabled)');
    const startBtn = document.querySelector('#testTagTypeModal .modal-btns button[onclick="confirmTestTagTypeModal()"]');
    if (startBtn) {
        startBtn.disabled = checked.length === 0;
        startBtn.style.opacity = checked.length === 0 ? '0.5' : '1';
        startBtn.style.cursor = checked.length === 0 ? 'not-allowed' : 'pointer';
    }
}

// Add this function to update in-progress shape positions on resize
function updateInProgressShapePositions() {
    if (!currentShapePoints || currentShapePoints.length === 0) return;
    currentShapePoints.forEach(point => {
        // Update absolute position from relative
        const abs = toAbsoluteCoords(point.relX, point.relY);
        point.x = abs.x;
        point.y = abs.y;
        point.element.style.left = abs.x + 'px';
        point.element.style.top = abs.y + 'px';
    });
    // Also update the preview line/polyline if it exists
    const previewLine = document.getElementById('previewLine');
    if (previewLine && currentShapePoints.length > 1) {
        const points = currentShapePoints.map(p => `${p.x},${p.y}`).join(' ');
        previewLine.setAttribute('points', points);
    }
}

function setSidebarButtonsEnabled(enabled) {
    // Only enable/disable sidebar drawing and edit buttons, not finish/cancel
    const ids = [
        'moveBtn', 'editLabelTextBtn', 'deleteBtn', 'tagPanelBtn',
        'pointBtn', 'polygonBtn', 'lineBtn',
        'findPointBtn', 'identPointBtn',
        'loadMapButton', 'saveElementsBtn', 'loadElementsBtn'
    ];
    ids.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = !enabled;
            btn.style.opacity = enabled ? '1' : '0.5';
            btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        }
    });

    // If enabling buttons, update save button state based on whether there are elements
    if (enabled) {
        updateSaveButtonState();
    }
}

// Function to enable/disable only edit buttons (excluding editToggle)
function setEditButtonsEnabled(enabled) {
    const editButtonIds = [
        'moveBtn', 'editLabelTextBtn', 'deleteBtn', 'tagPanelBtn',
        'pointBtn', 'polygonBtn', 'lineBtn'
    ];
    editButtonIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = !enabled;
            btn.style.opacity = enabled ? '1' : '0.5';
            btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        }
    });

    // If enabling buttons, update save button state based on whether there are elements
    if (enabled) {
        updateSaveButtonState();
    }
}

// Patch setMode to disable all other buttons during drawing
const originalSetMode = setMode;
setMode = function (mode) {
    originalSetMode.call(this, mode);
    if (mode === 'polygon' || mode === 'line') {
        const finishDrawingBtn = document.getElementById('finishDrawingBtn');
        const cancelDrawingBtn = document.getElementById('cancelDrawingBtn');
        finishDrawingBtn.disabled = true;
        finishDrawingBtn.style.opacity = '1';
        finishDrawingBtn.style.cursor = 'pointer';
        cancelDrawingBtn.disabled = false;
        cancelDrawingBtn.style.opacity = '1';
        cancelDrawingBtn.style.cursor = 'pointer';
    } else {
        setSidebarButtonsEnabled(true);
    }
};

// Helper function to update finish drawing button state
function updateFinishDrawingButtonState() {
    const finishDrawingBtn = document.getElementById('finishDrawingBtn');
    const cancelDrawingBtn = document.getElementById('cancelDrawingBtn');

    if (hasEnoughPointsForShape()) {
        finishDrawingBtn.style.display = 'inline-flex';
        finishDrawingBtn.disabled = false;
        finishDrawingBtn.removeAttribute('style');
        finishDrawingBtn.style.display = 'inline-flex';
    } else {
        finishDrawingBtn.style.display = 'inline-flex';
        finishDrawingBtn.disabled = true;
        finishDrawingBtn.removeAttribute('style');
        finishDrawingBtn.style.display = 'inline-flex';
    }
    cancelDrawingBtn.style.display = 'inline-flex';
}

// Add these helper functions at the top of the file (after the variable declarations)

// Helper function to get element count for a tag
function getElementCountForTag(tag) {
    return [
        ...points.filter(l => l.type === tag),
        ...polygons.filter(p => p.type === tag),
        ...lines.filter(l => l.type === tag)
    ].length;
}

// Helper function to highlight elements with a specific tag
function highlightElementsWithTag(tag) {
    // Highlight elements with this tag using data-type attribute
    document.querySelectorAll(`[data-type="${tag}"]`).forEach(el => {
        el.classList.add('tag-hover-highlight');
    });

    // Highlight label boxes for this tag
    points.forEach(point => {
        if (point.type === tag) {
            point.labelBoxEl.classList.add('tag-hover-highlight');
        }
    });

    polygons.forEach(polygon => {
        if (polygon.type === tag) {
            polygon.labelBoxEl.classList.add('tag-hover-highlight');
        }
    });

    lines.forEach(line => {
        if (line.type === tag) {
            line.labelBoxEl.classList.add('tag-hover-highlight');
        }
    });

    // Highlight reference points for this tag
    points.forEach(point => {
        if (point.type === tag && point.refPointEl) {
            point.refPointEl.classList.add('tag-hover-highlight');
        }
    });
}

// Helper function to remove highlighting
function removeElementHighlighting() {
    // Remove highlighting from all elements
    document.querySelectorAll('.tag-hover-highlight').forEach(el => {
        el.classList.remove('tag-hover-highlight');
    });
}

// Helper function to create element count badge
function createElementCountBadge(count) {
    const badge = document.createElement('span');
    badge.textContent = `${count}`;
    badge.className = 'element-count-badge';
    return badge;
}

// Function to show file type warning modal
function showFileTypeWarningModal(fileType, expectedType) {
    const dialog = document.createElement('div');
    dialog.className = 'warning-modal';
    dialog.innerHTML = `
        <div class="warning-modal-content">
            <div class="warning-modal-header">
                <h3><i class="fas fa-exclamation-triangle"></i> Invalid File Type</h3>
            </div>
            <div class="warning-modal-body">
                <p>The selected file is not a valid ${expectedType} file. Please select a file with the correct format.</p>
                <div class="warning-modal-buttons">
                    <button id="okFileTypeWarning" class="warning-btn warning-btn-primary">
                        <i class="fas fa-check"></i> OK
                    </button>
                </div>
            </div>
        </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'warning-modal-overlay';

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    // Handle dialog button
    document.getElementById('okFileTypeWarning').onclick = () => {
        dialog.remove();
        overlay.remove();
    };

    // Close modal when clicking outside of it
    overlay.addEventListener('click', () => {
        dialog.remove();
        overlay.remove();
    });

    // Close modal with Escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            dialog.remove();
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

// Add event listener to clear error message when user starts typing
document.addEventListener('DOMContentLoaded', function () {
    const newTagInput = document.getElementById('newTagInput');
    if (newTagInput) {
        newTagInput.addEventListener('input', function () {
            clearTagError();
        });
    }

    // Add event listener for edit tag input
    const editTagInput = document.getElementById('editTagInput');
    if (editTagInput) {
        editTagInput.addEventListener('input', function () {
            clearEditTagError();
        });
    }
});

// Helper function to clear tag error message
function clearTagError() {
    const errorElement = document.getElementById('newTagError');
    if (errorElement) {
        errorElement.style.display = 'none';
    }
}

// Helper function to clear edit tag error message
function clearEditTagError() {
    const errorElement = document.getElementById('editTagError');
    if (errorElement) {
        errorElement.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', function () {
    // Sidebar tab switching
    const tabBtns = document.querySelectorAll('.sidebar-tab-bar .tab-btn');
    const sidebarTabs = document.querySelector('.sidebar-tabs');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            tabBtns.forEach(b => b.setAttribute('aria-selected', 'false'));
            btn.setAttribute('aria-selected', 'true');
            sidebarTabs.setAttribute('data-active-tab', btn.getAttribute('data-tab'));
        });
    });

    // Show front load map container if no map is loaded
    const mapImage = document.getElementById('mapImage');
    const frontLoadMapContainer = document.getElementById('frontLoadMapContainer');

    if (mapImage && frontLoadMapContainer) {
        // Check if map image has a source
        if (!mapImage.src || mapImage.src === window.location.href) {
            // No map loaded, show the front load container
            frontLoadMapContainer.classList.remove('hidden');
        } else {
            // Map is loaded, hide the front load container
            frontLoadMapContainer.classList.add('hidden');
        }
    }
});

// Edit tab functionality - automatically enable/disable edit mode
const editTabRadio = document.getElementById('tab-edit');

editTabRadio.addEventListener('change', () => {
    if (editTabRadio.checked) {
        // Enable edit mode when edit tab is selected
        if (!editEnabled) {
            toggleEditMode(true);
        }
    } else {
        // Disable edit mode when other tabs are selected
        if (editEnabled) {
            toggleEditMode(false);
        }
    }
});

// Also handle when other tabs are selected to disable edit mode
const loadsaveTabRadio = document.getElementById('tab-loadsave');
const testTabRadio = document.getElementById('tab-test');

loadsaveTabRadio.addEventListener('change', () => {
    if (loadsaveTabRadio.checked && editEnabled) {
        toggleEditMode(false);
    }
});

testTabRadio.addEventListener('change', () => {
    if (testTabRadio.checked && editEnabled) {
        toggleEditMode(false);
    }
});

// Function to update add button header active state
function updateAddButtonHeaderState() {
    const addBtnHeader = document.getElementById('addBtn');
    const pointBtn = document.getElementById('pointBtn');
    const polygonBtn = document.getElementById('polygonBtn');
    const lineBtn = document.getElementById('lineBtn');

    // Check if any submenu item is active
    const isAnySubmenuActive = (pointBtn && pointBtn.getAttribute('aria-pressed') === 'true') ||
        (polygonBtn && polygonBtn.getAttribute('aria-pressed') === 'true') ||
        (lineBtn && lineBtn.getAttribute('aria-pressed') === 'true');

    if (addBtnHeader) {
        if (isAnySubmenuActive) {
            addBtnHeader.classList.add('active');
        } else {
            addBtnHeader.classList.remove('active');
        }
    }
}

// Get current state in the same format as saveElements exports
function getCurrentState() {
    return {
        points: points.map(point => ({
            refX: point.relRefX,
            refY: point.relRefY,
            labelX: point.relLabelX,
            labelY: point.relLabelY,
            text: point.labelBoxEl.textContent,
            type: point.type || 'default'
        })),
        polygons: polygons.map(polygon => ({
            points: polygon.points.map(p => ({ x: p.relX, y: p.relY })),
            anchorX: polygon.relAnchorX,
            anchorY: polygon.relAnchorY,
            labelX: polygon.relLabelX,
            labelY: polygon.relLabelY,
            text: polygon.labelBoxEl.textContent,
            type: polygon.type || 'default'
        })),
        lines: lines.map(line => ({
            points: line.points.map(p => ({ x: p.relX, y: p.relY })),
            anchorX: line.relAnchorX,
            anchorY: line.relAnchorY,
            labelX: line.relLabelX,
            labelY: line.relLabelY,
            text: line.labelBoxEl.textContent,
            type: line.type || 'default'
        }))
    };
}

// Compare two states to detect if there are unsaved changes
function hasUnsavedChanges() {
    if (!baselineData) {
        // If no baseline data, check if there's any current data
        return points.length > 0 || polygons.length > 0 || lines.length > 0;
    }

    const currentState = getCurrentState();

    // Deep comparison of the two states
    return !deepEqual(currentState, baselineData);
}

// Deep equality comparison for objects
function deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;

    if (obj1 == null || obj2 == null) return obj1 === obj2;

    if (typeof obj1 !== typeof obj2) return false;

    if (typeof obj1 !== 'object') return obj1 === obj2;

    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

    if (Array.isArray(obj1)) {
        if (obj1.length !== obj2.length) return false;
        for (let i = 0; i < obj1.length; i++) {
            if (!deepEqual(obj1[i], obj2[i])) return false;
        }
        return true;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
        if (!keys2.includes(key)) return false;
        if (!deepEqual(obj1[key], obj2[key])) return false;
    }

    return true;
}
