// OpenLayers-based map system for the Map Testing Tool

// Helper: distance from point to segment
// pixel: [x, y], a: [x, y], b: [x, y]
function pointToSegmentDistance(p, a, b) {
    const x = p[0], y = p[1];
    const x1 = a[0], y1 = a[1];
    const x2 = b[0], y2 = b[1];
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;
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

class OLMapSystem {
    constructor() {

        this.map = null;
        this.vectorSource = null;
        this.vectorLayer = null;
        this.imageLayer = null;
        this.drawInteraction = null;
        this.modifyInteraction = null;
        this.snapInteraction = null;
        this.leaderLineSource = null;
        this.leaderLineLayer = null;
        this.currentMode = null;
        this.annotations = {
            points: [],
            polygons: [],
            lines: []
        };

        // Tag system integration
        this.tags = [];
        this.currentType = '';
        this.tagVisibility = {};

        // Label system using OpenLayers overlays
        this.labelOverlays = new Map(); // feature -> overlay
        this.leaderLineFeatures = new Map(); // feature -> leader line feature

        // Anchor point system for movable leader line connections
        this.anchorPointFeatures = new Map(); // feature -> anchor point feature

        // Track when modifications are active to prevent interference with anchor point movement
        this.isModifying = false;

        this.initMap();
        this.setupInteractions();
        this.loadTags();
    }

    initMap() {
        // Create vector source for annotations
        this.vectorSource = new ol.source.Vector();
        // Create vector source for leader lines
        this.leaderLineSource = new ol.source.Vector();
        // Create vector layer for leader lines (below annotation layer)
        this.leaderLineLayer = new ol.layer.Vector({
            source: this.leaderLineSource,
            style: new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: '#666',
                    width: 1,
                    lineDash: [4, 3]
                })
            })
        });
        // Create vector layer for annotations with label styling
        this.vectorLayer = new ol.layer.Vector({
            source: this.vectorSource
            // Remove the layer-level style function to allow feature-level styles to work
        });
        // Create the map (without image layer initially)
        this.map = new ol.Map({
            target: 'map',
            layers: [this.leaderLineLayer, this.vectorLayer], // Leader lines below annotation layer
            view: new ol.View({
                center: [0, 0],
                zoom: 2,
            })
        });

        // Add pointer event handling for cursor styles
        this.setupMapCursorHandling();

        // Listen for geometry changes on all annotation features
        this.vectorSource.on('changefeature', (event) => {
            const feature = event.feature;
            if (!feature) return;
            const props = feature.getProperties();
            if ((props.type === 'point' || props.type === 'polygon' || props.type === 'line') && props.text) {
                this.updateLeaderLine(feature);
            }
        });
    }

    setupInteractions() {
        // No longer create modifyInteraction here; it is created in setMode when needed
        // Create snap interaction that only snaps to non-leader-line features
        this.snapInteraction = new ol.interaction.Snap({
            source: this.vectorSource,
            edge: true,
            vertex: true
        });
        // Patch the snap interaction to ignore leader lines
        const originalGetClosestFeatureToCoordinate = this.snapInteraction.source_.getClosestFeatureToCoordinate.bind(this.snapInteraction.source_);
        this.snapInteraction.source_.getClosestFeatureToCoordinate = (coordinate, filter) => {
            // Only snap to non-leader-line features
            return originalGetClosestFeatureToCoordinate(coordinate, (feature) => {
                const props = feature.getProperties();
                return props.type !== 'leader-line' && (!filter || filter(feature));
            });
        };
        // Don't add snap/modify interaction initially - it will be added/removed based on mode

        // Add map click listener for mode-specific operations
        this.map.on('click', (event) => this.handleMapClick(event));
    }

    setupMapCursorHandling() {
        // Add pointer move event to detect feature hover
        this.map.on('pointermove', (event) => {
            const pixel = event.pixel;
            const feature = this.map.forEachFeatureAtPixel(pixel, (feature) => feature);

            const mapElement = this.map.getTargetElement();
            if (!mapElement) return;

            if (feature) {
                const properties = feature.getProperties();
                // Only apply cursor styles to actual features and anchor points, not leader lines
                if (properties.type !== 'leader-line') {
                    // Special handling for move mode: grab on vertex/point/label, move on segment, default otherwise
                    if (this.currentMode === 'move') {
                        let showGrab = false;
                        let showMove = false;
                        // Use the same pixel tolerance as the modify interaction
                        const tolerance = (this.modifyInteraction && this.modifyInteraction.pixelTolerance) ? this.modifyInteraction.pixelTolerance : 10;

                        // Anchor points are always grabbable
                        if (properties.type === 'anchor-point') {
                            showGrab = true;
                        } else if (properties.type === 'point') {
                            showGrab = true;
                        } else if (properties.type === 'polygon' || properties.type === 'line') {
                            const geometry = feature.getGeometry();
                            let coords = geometry.getCoordinates();
                            if (properties.type === 'polygon') {
                                coords = coords[0]; // Outer ring
                            }
                            // Check if pointer is near any vertex
                            for (let i = 0; i < coords.length; i++) {
                                const vertexPixel = this.map.getPixelFromCoordinate(coords[i]);
                                const dx = vertexPixel[0] - pixel[0];
                                const dy = vertexPixel[1] - pixel[1];
                                const dist = Math.sqrt(dx * dx + dy * dy);
                                if (dist < tolerance) { // Use modifyInteraction tolerance
                                    showGrab = true;
                                    break;
                                }
                            }
                            // If not on vertex, check if near a segment (edge)
                            if (!showGrab) {
                                for (let i = 0; i < coords.length - 1; i++) {
                                    const a = this.map.getPixelFromCoordinate(coords[i]);
                                    const b = this.map.getPixelFromCoordinate(coords[i + 1]);
                                    const segDist = pointToSegmentDistance(pixel, a, b);
                                    if (segDist < tolerance) { // Use modifyInteraction tolerance
                                        showMove = true;
                                        break;
                                    }
                                }
                                // For polygons, also check closing segment
                                if (!showMove && properties.type === 'polygon' && coords.length > 2) {
                                    const a = this.map.getPixelFromCoordinate(coords[coords.length - 1]);
                                    const b = this.map.getPixelFromCoordinate(coords[0]);
                                    const segDist = pointToSegmentDistance(pixel, a, b);
                                    if (segDist < tolerance) {
                                        showMove = true;
                                    }
                                }
                            }
                        }
                        if (showGrab) {
                            mapElement.style.cursor = 'grab';
                        } else if (showMove) {
                            mapElement.style.cursor = 'move';
                        } else {
                            mapElement.style.cursor = 'default';
                        }

                    } else {
                        // Apply cursor based on current mode
                        switch (this.currentMode) {
                            case 'move':
                                mapElement.style.cursor = 'grab';
                                break;
                            case 'point':
                            case 'polygon':
                            case 'line':
                                mapElement.style.cursor = 'crosshair';
                                break;
                            case 'delete':
                                mapElement.style.cursor = 'no-drop';
                                break;
                            case 'editLabelText':
                                mapElement.style.cursor = 'pointer';
                                break;
                            case 'changeTag':
                                mapElement.style.cursor = 'pointer';
                                break;
                            default:
                                mapElement.style.cursor = 'default';
                                break;
                        }
                    }
                } else {
                    // Leader line - use default cursor
                    mapElement.style.cursor = 'default';
                }
            } else {
                // Not hovering over any feature - use mode-specific cursor
                this.updateFeatureCursorStyles();
            }
        });

        // Add pointer leave event to reset cursor when leaving map
        this.map.getTargetElement().addEventListener('pointerleave', () => {
            const mapElement = this.map.getTargetElement();
            if (mapElement) {
                mapElement.style.cursor = 'default';

            }
        });
    }

    createStyleFunction() {
        return (feature) => {
            const geometry = feature.getGeometry();
            const type = geometry.getType();
            const properties = feature.getProperties();

            // Check if this feature should be visible based on its tag
            const tagType = properties.tagType || 'default';
            const isVisible = this.tagVisibility[tagType] !== false;

            // If the feature should be hidden, return invisible style
            if (!isVisible) {
                return new ol.style.Style({
                    fill: new ol.style.Fill({
                        color: 'transparent'
                    }),
                    stroke: new ol.style.Stroke({
                        color: 'transparent',
                        width: 0
                    }),
                    image: undefined
                });
            }

            // Only style the feature itself, not the text
            return new ol.style.Style({
                fill: new ol.style.Fill({
                    color: properties.type === 'polygon' ? 'rgba(33, 150, 243, 0.15)' : 'rgba(243, 33, 33, 0.15)'
                }),
                stroke: new ol.style.Stroke({
                    color: properties.type === 'polygon' || properties.type === 'line' ? '#2196F3' : '#2196F3',
                    width: 2
                }),
                image: properties.type === 'point' ? new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({
                        color: '#2196F3'
                    }),
                    stroke: new ol.style.Stroke({
                        color: '#fff',
                        width: 2
                    })
                }) : undefined
            });
        };
    }

    createHighlightStyleFunction() {
        return (feature) => {
            const geometry = feature.getGeometry();
            const type = geometry.getType();
            const properties = feature.getProperties();
            // Only style the feature itself, not the text
            return new ol.style.Style({
                fill: new ol.style.Fill({
                    color: properties.type === 'polygon' ? 'rgba(33, 150, 243, 0.2)' : 'transparent'
                }),
                stroke: new ol.style.Stroke({
                    color: '#2196F3',
                    width: 4
                }),
                image: properties.type === 'point' ? new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({
                        color: '#2196F3'
                    }),
                    stroke: new ol.style.Stroke({
                        color: '#1565c0',
                        width: 3
                    })
                }) : undefined
            });
        };
    }

    createAnchorPointStyleFunction() {
        return (feature) => {
            const properties = feature.getProperties();
            if (properties.type === 'anchor-point') {
                // Only show anchor points when in move mode
                if (this.currentMode === 'move') {

                    return new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 6,
                            fill: new ol.style.Fill({
                                color: '#f37521'
                            }),
                            stroke: new ol.style.Stroke({
                                color: '#fff',
                                width: 2
                            })
                        })
                    });
                } else {
                    // Hide anchor points when not in move mode

                    return new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 0,
                            fill: new ol.style.Fill({
                                color: 'transparent'
                            }),
                            stroke: new ol.style.Stroke({
                                color: 'transparent',
                                width: 0
                            })
                        })
                    });
                }
            }
            return this.createStyleFunction()(feature);
        };
    }

    loadMapImage(imageUrl) {
        // Remove existing image layer if any
        if (this.imageLayer) {
            this.map.removeLayer(this.imageLayer);
        }

        // Create new image layer
        this.imageLayer = new ol.layer.Image({
            source: new ol.source.ImageStatic({
                url: imageUrl,
                imageExtent: [0, 0, 1000, 1000]
            })
        });

        // Add image layer to map at the bottom (index 0) so vector layer stays on top
        this.map.getLayers().insertAt(0, this.imageLayer);

        // Load image to get actual dimensions
        const img = new Image();
        img.onload = () => {
            const extent = [0, 0, img.width, img.height];
            // Create new source with correct extent
            const newSource = new ol.source.ImageStatic({
                url: imageUrl,
                imageExtent: extent
            });
            this.imageLayer.setSource(newSource);
            const newView = new ol.View({
                center: ol.extent.getCenter(extent),
                zoom: 2,
                extent: extent
            });
            this.map.setView(newView);
            newView.fit(extent, { padding: [20, 20, 20, 20] });
        };

        img.onerror = (e) => {
            console.error('Error loading image:', e);
            const errorMessage = document.getElementById('errorMessage');
            if (errorMessage) {
                errorMessage.textContent = 'Failed to display the image. Please try another file.';
                errorMessage.style.display = 'block';
            }
        };
        img.src = imageUrl;
    }

    setMode(mode) {
        // Unify mode names: treat 'tag' and 'changeTag' as the same, 'rename' and 'editLabelText' as the same
        if (mode === 'tag') mode = 'changeTag';
        if (mode === 'rename') mode = 'editLabelText';
        // Stop any ongoing operations before changing mode
        this.stopAllOperations();
        // Reset interaction references
        this.drawInteraction = null;
        // Remove snap interaction if present
        if (this.snapInteraction) {
            this.map.removeInteraction(this.snapInteraction);
        }
        // Always remove all modify interactions before switching modes
        this.removeAllModifyInteractions();
        // Remove reference to modifyInteraction
        this.modifyInteraction = null;
        this.currentMode = mode;

        // Hide finish drawing interface when changing modes
        this.hideFinishDrawingInterface();

        // Create new interactions based on mode
        if (mode === 'point') {
            this.drawInteraction = new ol.interaction.Draw({
                source: this.vectorSource,
                type: 'Point',
                style: this.createStyleFunction()
            });
        } else if (mode === 'polygon') {
            this.drawInteraction = new ol.interaction.Draw({
                source: this.vectorSource,
                type: 'Polygon',
                freehandCondition: ol.events.condition.never,
                style: this.createStyleFunction()
            });
        } else if (mode === 'line') {
            this.drawInteraction = new ol.interaction.Draw({
                source: this.vectorSource,
                type: 'LineString',
                freehandCondition: ol.events.condition.never,
                style: this.createStyleFunction()
            });
        } else if (mode === 'move') {
            // Create and add modify interaction for move mode
            this.modifyInteraction = new ol.interaction.Modify({
                source: this.vectorSource,
                filter: (feature) => {
                    // Allow modification of features and anchor points, but not leader lines
                    const properties = feature.getProperties();
                    return properties.type !== 'leader-line';
                },
                style: this.createStyleFunction()
            });
            // Listen for feature modifications
            this.modifyInteraction.on('modifystart', (event) => {
                // Ensure we're in move mode
                if (this.currentMode !== 'move') {
                    event.preventDefault();
                    return;
                }
                // Set modification flag
                this.isModifying = true;
            });
            this.modifyInteraction.on('modifying', (event) => {

                // Real-time update of leader lines for all modified features
                if (event.features) {

                    event.features.forEach((feature) => {
                        const properties = feature.getProperties();

                        if (properties.type === 'anchor-point') {
                            // If anchor point is moved, update the leader line for its parent feature
                            const parentFeature = properties.parentFeature;
                            if (parentFeature) {

                                this.updateLeaderLine(parentFeature);
                            }
                        } else {
                            // Regular feature modification - only update leader line, not anchor point
                            // Don't update anchor point during modification to allow user to move it
                            this.updateLeaderLine(feature);
                        }
                    });
                }
            });
            this.modifyInteraction.on('modifyend', (event) => {
                // Only process if in move mode
                if (this.currentMode === 'move') {
                    // Handle modifications
                    if (event.features) {
                        event.features.forEach((feature) => {
                            const properties = feature.getProperties();
                            if (properties.type === 'anchor-point') {
                                // If anchor point was modified, constrain it to the parent shape
                                const parentFeature = properties.parentFeature;
                                if (parentFeature) {
                                    this.constrainAnchorPointToShape(feature, parentFeature);
                                    this.updateLeaderLine(parentFeature);
                                }
                            } else {
                                // For parent features, just ensure anchor points are constrained
                                const anchorPointFeature = this.anchorPointFeatures.get(feature);
                                if (anchorPointFeature) {
                                    this.constrainAnchorPointToShape(anchorPointFeature, feature);
                                    this.updateLeaderLine(feature);
                                }
                            }
                        });
                    }
                    this.updateAnnotationsFromFeatures();
                }
                // Clear modification flag
                this.isModifying = false;
            });
            this.map.addInteraction(this.modifyInteraction);
        } else if (mode === 'delete') {
            // Delete mode is handled in handleMapClick
            // No additional interaction needed
        }
        // Add draw interaction if created
        if (this.drawInteraction) {
            this.map.addInteraction(this.drawInteraction);
            // Add snap interaction for drawing
            this.map.addInteraction(this.snapInteraction);
            // Listen for draw events
            this.drawInteraction.on('drawstart', (event) => {
                // Show finish drawing interface when drawing starts
                this.showFinishDrawingInterface();

                // Ensure we're in the correct drawing mode
                const expectedType = this.currentMode === 'point' ? 'Point' :
                    this.currentMode === 'polygon' ? 'Polygon' :
                        this.currentMode === 'line' ? 'LineString' : null;
                if (expectedType && event.feature.getGeometry().getType() !== expectedType) {
                    event.preventDefault();
                }

                // Set up geometry change listener for the sketch feature
                const sketch = event.feature;
                if (sketch) {
                    const geometry = sketch.getGeometry();
                    if (geometry) {
                        geometry.on('change', () => {
                            setTimeout(() => {
                                this.updateFinishDrawingButtonState();
                            }, 10);
                        });
                    }
                }
            });

            // Listen for when points are added to the sketch
            this.drawInteraction.on('addvertex', (event) => {
                // Update button state when a new vertex is added
                setTimeout(() => {
                    this.updateFinishDrawingButtonState();
                }, 10);
            });

            // Also listen for geometry changes which might not trigger addvertex
            this.drawInteraction.on('modifystart', (event) => {
                setTimeout(() => {
                    this.updateFinishDrawingButtonState();
                }, 10);
            });

            // Listen for any geometry changes
            this.drawInteraction.on('change', (event) => {
                setTimeout(() => {
                    this.updateFinishDrawingButtonState();
                }, 10);
            });

            this.drawInteraction.on('drawend', (event) => {
                this.handleDrawEnd(event);
                // Hide finish drawing interface when drawing ends
                this.hideFinishDrawingInterface();
            });
        }
        // Update label cursors based on new mode
        this.updateLabelCursors();
        // Update feature cursor styles immediately
        this.updateFeatureCursorStyles();
        // Update anchor point visibility based on new mode
        this.updateAnchorPointVisibility();
        // Debug log

    }

    stopAllOperations() {
        // Stop any ongoing label dragging
        this.labelOverlays.forEach((overlay, feature) => {
            const labelElement = overlay.getElement();
            if (labelElement && labelElement._dragHandlers) {
                // Remove event listeners
                labelElement.removeEventListener('mousedown', labelElement._dragHandlers.mousedown);
                document.removeEventListener('mousemove', labelElement._dragHandlers.mousemove);
                document.removeEventListener('mouseup', labelElement._dragHandlers.mouseup);

                // Reset cursor
                labelElement.style.cursor = this.currentMode === 'move' ? 'grab' : 'default';
            }
        });

        // Stop any ongoing OpenLayers interactions
        if (this.drawInteraction) {
            this.drawInteraction.abortDrawing();
        }

        // Stop any ongoing modify operations
        if (this.modifyInteraction) {
            // Force end any ongoing modifications
            this.modifyInteraction.dispatchEvent('modifyend');
        }

        // Remove all interactions temporarily to ensure they're completely stopped
        if (this.drawInteraction) {
            this.map.removeInteraction(this.drawInteraction);
        }
        if (this.modifyInteraction) {
            this.map.removeInteraction(this.modifyInteraction);
        }

        // Reset modification flag
        this.isModifying = false;
    }

    updateLabelCursors() {
        this.labelOverlays.forEach((overlay, feature) => {
            const labelElement = overlay.getElement();
            if (!labelElement) return;
            this.applyCursorStylesToLabel(labelElement);
        });
    }

    attachLabelDragListeners(labelElement, featureId) {
        if (labelElement._dragHandlers) return; // Already attached

        // Find the feature object from the ID
        let feature = null;
        for (const [f, overlay] of this.labelOverlays) {
            if (f.getProperties().id === featureId) {
                feature = f;
                break;
            }
        }
        if (!feature) return;

        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        const mousedownHandler = (e) => {
            if (this.currentMode === 'move') {
                isDragging = true;
                const rect = labelElement.getBoundingClientRect();
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                labelElement.style.cursor = 'grabbing';
                labelElement.classList.add('dragging');
                e.preventDefault();
                e.stopPropagation();
            }
        };
        const mousemoveHandler = (e) => {
            if (isDragging && this.currentMode === 'move') {
                const overlay = this.labelOverlays.get(feature);
                if (overlay) {
                    const mapRect = this.map.getTargetElement().getBoundingClientRect();
                    const pixel = [e.clientX - mapRect.left, e.clientY - mapRect.top];
                    const coordinate = this.map.getCoordinateFromPixel(pixel);
                    overlay.setPosition(coordinate);
                    this.updateLeaderLine(feature);
                }
            } else if (isDragging && this.currentMode !== 'move') {
                isDragging = false;
                labelElement.style.cursor = 'default';
                labelElement.classList.remove('dragging');

            }
        };
        const mouseupHandler = () => {
            if (isDragging) {
                isDragging = false;
                if (this.currentMode === 'move') {
                    labelElement.style.cursor = 'grab';

                    // Update annotations after drag ends to capture new label position
                    this.updateAnnotationsFromFeatures();
                } else {
                    labelElement.style.cursor = 'default';

                }
                labelElement.classList.remove('dragging');
            }
        };
        labelElement.addEventListener('mousedown', mousedownHandler);
        document.addEventListener('mousemove', mousemoveHandler);
        document.addEventListener('mouseup', mouseupHandler);
        labelElement._dragHandlers = {
            mousedown: mousedownHandler,
            mousemove: mousemoveHandler,
            mouseup: mouseupHandler
        };
    }

    detachLabelDragListeners(labelElement) {
        if (!labelElement._dragHandlers) return;
        labelElement.removeEventListener('mousedown', labelElement._dragHandlers.mousedown);
        document.removeEventListener('mousemove', labelElement._dragHandlers.mousemove);
        document.removeEventListener('mouseup', labelElement._dragHandlers.mouseup);
        delete labelElement._dragHandlers;
    }

    handleDrawEnd(event) {
        // Only process if in a drawing mode
        if (!['point', 'polygon', 'line'].includes(this.currentMode)) {
            return;
        }

        const feature = event.feature;
        const geometry = feature.getGeometry();
        const type = geometry.getType();

        // Debug: Log the current type being used


        // Set properties based on type
        feature.setProperties({
            type: type === 'Point' ? 'point' : type === 'Polygon' ? 'polygon' : 'line',
            text: '',
            tagType: this.currentType || 'default',
            id: `${type === 'Point' ? 'point' : type === 'Polygon' ? 'polygon' : 'line'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        });

        // Set initial style for the feature
        feature.setStyle(this.createStyleFunction()(feature));

        // Update annotations from features
        this.updateAnnotationsFromFeatures();

        // Prompt for text for all feature types
        this.promptForText(feature);
    }

    // Add methods to handle finish/cancel drawing buttons
    showFinishDrawingInterface() {
        const finishDrawingInterface = document.getElementById('finishDrawingInterface');
        if (finishDrawingInterface) {
            finishDrawingInterface.style.display = 'flex';
            this.updateFinishDrawingButtonState();
        } else {
        }
    }

    hideFinishDrawingInterface() {
        const finishDrawingInterface = document.getElementById('finishDrawingInterface');
        if (finishDrawingInterface) {
            finishDrawingInterface.style.display = 'none';
        }
    }

    updateFinishDrawingButtonState() {
        const finishDrawingBtn = document.getElementById('finishDrawingBtn');
        const cancelDrawingBtn = document.getElementById('cancelDrawingBtn');

        if (finishDrawingBtn && cancelDrawingBtn) {
            // Check if we have enough points to finish the shape
            let canFinish = false;

            if (this.drawInteraction) {
                const sketch = this.drawInteraction.sketchFeature_;
                if (sketch) {
                    const geometry = sketch.getGeometry();
                    if (geometry) {
                        const coordinates = geometry.getCoordinates();
                        const type = geometry.getType();

                        // Check if we have enough points to finish
                        if (type === 'Polygon' && coordinates[0] && coordinates[0].length >= 5) {
                            // For polygons, we need at least 5 points: 3 unique vertices + 1 closing point + 1 current mouse position
                            // OpenLayers automatically closes polygons by adding the first point again
                            canFinish = true;
                        } else if (type === 'LineString' && coordinates && coordinates.length >= 3) {
                            canFinish = true;
                        }
                    }
                }
            }

            // Update finish button state
            if (canFinish) {
                finishDrawingBtn.disabled = false;
                finishDrawingBtn.style.opacity = '1';
                finishDrawingBtn.style.cursor = 'pointer';
                finishDrawingBtn.classList.remove('disabled');
            } else {
                finishDrawingBtn.disabled = true;
                finishDrawingBtn.style.opacity = '0.5';
                finishDrawingBtn.style.cursor = 'not-allowed';
                finishDrawingBtn.classList.add('disabled');
            }

            // Cancel button is always enabled
            cancelDrawingBtn.disabled = false;
            cancelDrawingBtn.style.opacity = '1';
            cancelDrawingBtn.style.cursor = 'pointer';
        }
    }

    finishCurrentDrawing() {
        if (this.drawInteraction) {
            // For OpenLayers, we need to manually complete the current drawing
            // We'll do this by getting the current sketch and adding it to the source

            const sketch = this.drawInteraction.sketchFeature_;
            if (sketch) {
                const geometry = sketch.getGeometry();
                if (geometry) {
                    const coordinates = geometry.getCoordinates();
                    const type = geometry.getType();

                    // Check if we have enough points to finish
                    if ((type === 'Polygon' && coordinates[0] && coordinates[0].length >= 4) ||
                        (type === 'LineString' && coordinates.length >= 2)) {

                        // Set properties for the feature
                        sketch.setProperties({
                            type: type === 'Point' ? 'point' : type === 'Polygon' ? 'polygon' : 'line',
                            text: '',
                            tagType: this.currentType || 'default',
                            id: `${type === 'Point' ? 'point' : type === 'Polygon' ? 'polygon' : 'line'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                        });

                        // Set style for the feature
                        sketch.setStyle(this.createStyleFunction()(sketch));

                        // Add the feature to the source
                        this.vectorSource.addFeature(sketch);

                        // Update annotations from features
                        this.updateAnnotationsFromFeatures();

                        // Remove the current drawing interaction to stop drawing
                        this.map.removeInteraction(this.drawInteraction);

                        // Prompt for text
                        this.promptForText(sketch);

                        // Hide the finish drawing interface
                        this.hideFinishDrawingInterface();

                        // Re-create the drawing interaction for future drawings
                        this.drawInteraction = new ol.interaction.Draw({
                            source: this.vectorSource,
                            type: this.currentMode === 'polygon' ? 'Polygon' :
                                this.currentMode === 'line' ? 'LineString' : 'Point',
                            style: this.createStyleFunction()
                        });

                        // Add the new drawing interaction
                        this.map.addInteraction(this.drawInteraction);

                        // Add event listeners to the new interaction
                        this.drawInteraction.on('drawstart', (event) => {
                            this.showFinishDrawingInterface();

                            // Set up geometry change listener for the sketch feature
                            const sketch = event.feature;
                            if (sketch) {
                                const geometry = sketch.getGeometry();
                                if (geometry) {
                                    geometry.on('change', () => {
                                        setTimeout(() => {
                                            this.updateFinishDrawingButtonState();
                                        }, 10);
                                    });
                                }
                            }
                        });
                        this.drawInteraction.on('addvertex', (event) => {
                            // Update button state when a new vertex is added
                            setTimeout(() => {
                                this.updateFinishDrawingButtonState();
                            }, 10);
                        });
                        this.drawInteraction.on('modifystart', (event) => {
                            setTimeout(() => {
                                this.updateFinishDrawingButtonState();
                            }, 10);
                        });
                        this.drawInteraction.on('change', (event) => {
                            setTimeout(() => {
                                this.updateFinishDrawingButtonState();
                            }, 10);
                        });
                        this.drawInteraction.on('drawend', (event) => {
                            this.handleDrawEnd(event);
                            this.hideFinishDrawingInterface();
                        });

                    } else {
                        // Not enough points, just hide the interface
                        this.hideFinishDrawingInterface();
                    }
                } else {
                    // No geometry, just hide the interface
                    this.hideFinishDrawingInterface();
                }
            } else {
                // No sketch feature, just hide the interface
                this.hideFinishDrawingInterface();
            }
        }
    }

    cancelCurrentDrawing() {
        if (this.drawInteraction) {
            // Abort the current drawing
            this.drawInteraction.abortDrawing();
            this.hideFinishDrawingInterface();
        }
    }

    handleMapClick(event) {
        // Check if click is on a label overlay first
        const clickedElement = event.originalEvent.target;
        if (clickedElement && clickedElement.classList.contains('label-overlay')) {
            // Click is on a label, handle based on current mode
            if (this.currentMode === 'changeTag') {
                this.handleLabelTagChange(clickedElement);
            }
            return;
        }

        // Only process clicks if in the appropriate mode
        if (this.currentMode === 'editLabelText') {
            const feature = this.map.forEachFeatureAtPixel(event.pixel, (feature) => feature);
            if (feature) {
                this.promptForText(feature);
            }
        } else if (this.currentMode === 'delete') {
            this.handleDeleteClick(event);
        } else if (this.currentMode === 'changeTag') {
            this.handleFeatureTagChange(event);
        }
        // For other modes (point, polygon, line, move), let OpenLayers handle the interactions
    }

    handleDeleteClick(event) {
        const feature = this.map.forEachFeatureAtPixel(event.pixel, (feature) => feature);
        if (feature) {
            // Remove label overlay and leader line if they exist
            this.removeLabelOverlay(feature);
            this.removeLeaderLine(feature);
            // Remove the feature from the source
            this.vectorSource.removeFeature(feature);
            // Update annotations
            this.updateAnnotationsFromFeatures();
        }
    }

    handleFeatureTagChange(event) {
        const feature = this.map.forEachFeatureAtPixel(event.pixel, (feature) => feature);
        if (feature && feature.get('type') !== 'leader-line') {
            this.changeElementTag(feature);
        }
    }

    handleLabelTagChange(labelElement) {
        const featureId = labelElement.getAttribute('data-feature-id');
        if (featureId) {
            const feature = this.vectorSource.getFeatureById(featureId);
            if (feature) {
                this.changeElementTag(feature);
            }
        }
    }

    changeElementTag(feature) {
        const currentTag = this.getCurrentType();
        if (!currentTag) {
            console.warn('No tag selected for changing element tag');
            return;
        }

        const properties = feature.getProperties();
        const oldTag = properties.tagType || 'default';

        // Update the feature's tag
        feature.set('tagType', currentTag);

        // --- Highlight the feature itself ---
        const originalStyle = feature.getStyle();
        feature.setStyle(this.createHighlightStyleFunction()(feature));
        setTimeout(() => {
            // Restore normal style after highlight
            feature.setStyle(this.createStyleFunction()(feature));
        }, 700);
        // --- End highlight ---

        // Update the feature's style based on the new tag's visibility
        // (already handled above)

        // Update the label overlay's data-type attribute
        const overlay = this.labelOverlays.get(feature);
        if (overlay) {
            const labelElement = overlay.getElement();
            if (labelElement) {
                labelElement.setAttribute('data-type', currentTag);
                // Add visual feedback
                this.addTagChangeVisualFeedback(labelElement);
            }
        }

        // Update leader line tag if it exists
        const leaderLineFeature = this.leaderLineFeatures.get(feature);
        if (leaderLineFeature) {
            leaderLineFeature.set('tagType', currentTag);
        }

        // Update annotations
        this.updateAnnotationsFromFeatures();

        // Save tags to persist the change
        this.saveTags();


    }

    addTagChangeVisualFeedback(labelElement) {
        // Add visual feedback class
        labelElement.classList.add('tag-changed');

        // Remove the feedback after animation
        setTimeout(() => {
            labelElement.classList.remove('tag-changed');
        }, 700);
    }

    promptForText(feature) {

        const oldText = feature.get('text') || '';
        const text = prompt('Enter label text:', oldText);
        if (text !== null) {
            const upperText = text.toUpperCase();
            feature.set('text', upperText);
            this.createOrUpdateLabelOverlay(feature);
            this.createOrUpdateLeaderLine(feature);
            setTimeout(() => this.updateAnnotationsFromFeatures(), 0);
        } else {
            // Only remove the feature if it did not have a label before (i.e., new label creation)
            if (!oldText) {
                setTimeout(() => {
                    this.removeLabelOverlay(feature);
                    this.removeLeaderLine(feature);
                    this.vectorSource.removeFeature(feature);
                    this.updateAnnotationsFromFeatures();
                }, 0);
            }
            // Otherwise, do nothing (keep the existing label)
        }
    }

    createOrUpdateLabelOverlay(feature) {
        const properties = feature.getProperties();
        if (!properties.text) return;
        // Remove existing overlay if any, but get its position first
        let previousPosition = null;
        const previousOverlay = this.labelOverlays.get(feature);
        if (previousOverlay) {
            previousPosition = previousOverlay.getPosition();
        }
        this.removeLabelOverlay(feature);

        const geometry = feature.getGeometry();
        const coordinates = geometry.getCoordinates();

        // Calculate initial label position
        let labelPosition;
        if (previousPosition) {
            labelPosition = previousPosition;
        } else if (properties.type === 'point') {
            // For points, place label above the point
            labelPosition = [coordinates[0], coordinates[1] + 30];
        } else if (properties.type === 'polygon') {
            // For polygons, place label at centroid
            const centroid = this.getPolygonCentroid(coordinates[0]);
            labelPosition = [centroid[0], centroid[1] + 20];
        } else if (properties.type === 'line') {
            // For lines, place label at midpoint
            const midpoint = this.getLineMidpoint(coordinates);
            labelPosition = [midpoint[0], midpoint[1] + 20];
        }

        // Create label element
        const labelElement = document.createElement('div');
        labelElement.className = 'label-overlay';
        labelElement.textContent = properties.text.toUpperCase();
        labelElement.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        labelElement.style.border = '1px solid rgba(0, 0, 0, 0.3)';
        labelElement.style.borderRadius = '4px';
        labelElement.style.padding = '4px 8px';
        labelElement.style.fontSize = '14px';
        labelElement.style.fontFamily = 'Arial, sans-serif';
        labelElement.style.pointerEvents = 'auto';
        labelElement.style.maxWidth = '200px';
        labelElement.style.wordWrap = 'break-word';
        labelElement.style.whiteSpace = 'nowrap';
        labelElement.setAttribute('data-feature-id', properties.id);
        labelElement.setAttribute('data-type', properties.tagType || 'default');

        // Create overlay
        const overlay = new ol.Overlay({
            element: labelElement,
            positioning: 'bottom-center',
            offset: [0, 10]
        });

        // Set position
        overlay.setPosition(labelPosition);

        // Add to map
        this.map.addOverlay(overlay);
        this.labelOverlays.set(feature, overlay);

        // Apply cursor styles immediately after overlay is added
        this.applyCursorStylesToLabel(labelElement);

        // Add click handlers
        labelElement.onclick = (e) => {
            if (this.currentMode === 'delete') {
                e.stopPropagation();
                this.handleDeleteFeature(feature);
            } else if (this.currentMode === 'editLabelText') {
                e.stopPropagation();
                this.promptForText(feature);
            } else if (this.currentMode === 'changeTag') {
                e.stopPropagation();
                this.changeElementTag(feature);
            }
        };

        // Update annotations after creating/updating label overlay
        this.updateAnnotationsFromFeatures();
    }

    applyCursorStylesToLabel(labelElement) {
        // Remove all previous classes and reset cursor
        labelElement.classList.remove('movable', 'deletable', 'pointerable', 'contextable');
        labelElement.style.cursor = 'default';

        // Remove any existing event listeners
        this.detachLabelDragListeners(labelElement);
        labelElement.onpointerenter = null;
        labelElement.onpointerleave = null;
        labelElement.onpointerdown = null;
        labelElement.onpointerup = null;



        switch (this.currentMode) {
            case 'move':
                labelElement.classList.add('movable');
                labelElement.style.cursor = 'grab';

                // Add hover handlers for move mode
                labelElement.onpointerenter = () => {
                    labelElement.style.cursor = 'grab';

                };
                labelElement.onpointerleave = () => {
                    labelElement.style.cursor = 'grab';

                };
                this.attachLabelDragListeners(labelElement, labelElement.getAttribute('data-feature-id'));
                break;
            case 'editLabelText':
                labelElement.classList.add('pointerable');
                labelElement.style.cursor = 'pointer';

                // Add hover handlers for edit mode
                labelElement.onpointerenter = () => {
                    labelElement.style.cursor = 'pointer';

                };
                labelElement.onpointerleave = () => {
                    labelElement.style.cursor = 'pointer';

                };
                break;
            case 'delete':
                labelElement.classList.add('deletable');
                labelElement.style.cursor = 'no-drop';

                // Add hover handlers for delete mode
                labelElement.onpointerenter = () => {
                    labelElement.style.cursor = 'no-drop';

                };
                labelElement.onpointerleave = () => {
                    labelElement.style.cursor = 'no-drop';

                };
                break;
            case 'changeTag':
                labelElement.classList.add('pointerable');
                labelElement.style.cursor = 'pointer';

                // Add hover handlers for tag mode
                labelElement.onpointerenter = () => {
                    labelElement.style.cursor = 'pointer';

                };
                labelElement.onpointerleave = () => {
                    labelElement.style.cursor = 'pointer';

                };
                break;
            case 'add':
            case 'point':
            case 'polygon':
            case 'line':
                labelElement.style.cursor = 'default';

                // Add hover handlers for drawing modes
                labelElement.onpointerenter = () => {
                    labelElement.style.cursor = 'default';

                };
                labelElement.onpointerleave = () => {
                    labelElement.style.cursor = 'default';

                };
                break;
            case 'neutral':
            default:
                labelElement.style.cursor = 'default';

                // Add hover handlers for neutral mode
                labelElement.onpointerenter = () => {
                    labelElement.style.cursor = 'default';

                };
                labelElement.onpointerleave = () => {
                    labelElement.style.cursor = 'default';

                };
                break;
        }

        // Log the final state

    }

    updateLabelCursors() {

        this.labelOverlays.forEach((overlay, feature) => {
            const labelElement = overlay.getElement();
            if (!labelElement) return;
            this.applyCursorStylesToLabel(labelElement);
        });
    }

    makeLabelDraggable(labelElement, feature) {
        // No-op: Drag listeners are now managed by updateLabelCursors/attachLabelDragListeners
    }

    createOrUpdateLeaderLine(feature) {
        const properties = feature.getProperties();

        if (!properties.text) return;


        // Remove existing leader line if any
        this.removeLeaderLine(feature);

        // Get anchor point position (or create one if it doesn't exist)
        let startPoint = this.getAnchorPointPosition(feature);


        // Check if we have an actual anchor point feature, not just a calculated position
        const anchorPointFeature = this.anchorPointFeatures.get(feature);
        if (!anchorPointFeature) {

            this.createAnchorPoint(feature);
            startPoint = this.getAnchorPointPosition(feature);

        } else {

        }

        // Get label overlay position for end point
        const overlay = this.labelOverlays.get(feature);
        if (!overlay) return;
        const labelPosition = overlay.getPosition();
        if (!labelPosition) return;

        // Create leader line feature
        const leaderLineGeometry = new ol.geom.LineString([startPoint, labelPosition]);
        const leaderLineFeature = new ol.Feature({
            geometry: leaderLineGeometry,
            type: 'leader-line',
            parentFeature: feature,
            tagType: properties.tagType || 'default'
        });
        // Style the leader line (optional, can use layer style)
        // leaderLineFeature.setStyle(...)
        this.leaderLineSource.addFeature(leaderLineFeature);
        this.leaderLineFeatures.set(feature, leaderLineFeature);
    }

    updateLeaderLine(feature) {

        const leaderLineFeature = this.leaderLineFeatures.get(feature);
        if (!leaderLineFeature) {

            return;
        }

        // Get anchor point position
        const startPoint = this.getAnchorPointPosition(feature);

        if (!startPoint) {

            return;
        }

        // Get label overlay position for end point
        const overlay = this.labelOverlays.get(feature);
        if (!overlay) {

            return;
        }
        const labelPosition = overlay.getPosition();

        if (!labelPosition) {

            return;
        }

        // Update leader line geometry
        const newGeometry = new ol.geom.LineString([startPoint, labelPosition]);
        leaderLineFeature.setGeometry(newGeometry);

    }

    removeLeaderLine(feature) {
        const leaderLineFeature = this.leaderLineFeatures.get(feature);
        if (leaderLineFeature) {
            this.leaderLineSource.removeFeature(leaderLineFeature);
            this.leaderLineFeatures.delete(feature);
        }
        // Also remove the anchor point when removing leader line
        this.removeAnchorPoint(feature);
    }

    removeLabelOverlay(feature) {
        const overlay = this.labelOverlays.get(feature);
        if (overlay) {
            // Clean up event listeners
            const labelElement = overlay.getElement();
            if (labelElement && labelElement._dragHandlers) {
                labelElement.removeEventListener('mousedown', labelElement._dragHandlers.mousedown);
                document.removeEventListener('mousemove', labelElement._dragHandlers.mousemove);
                document.removeEventListener('mouseup', labelElement._dragHandlers.mouseup);
            }
            this.map.removeOverlay(overlay);
            this.labelOverlays.delete(feature);
        }
    }

    getPolygonCentroid(coordinates) {
        let x = 0, y = 0;
        coordinates.forEach(coord => {
            x += coord[0];
            y += coord[1];
        });
        return [x / coordinates.length, y / coordinates.length];
    }

    getLineMidpoint(coordinates) {
        if (coordinates.length < 2) {
            return coordinates[0] || [0, 0];
        }

        // Calculate the total length of the line
        let totalLength = 0;
        const segmentLengths = [];

        for (let i = 0; i < coordinates.length - 1; i++) {
            const start = coordinates[i];
            const end = coordinates[i + 1];
            const segmentLength = Math.sqrt(
                Math.pow(end[0] - start[0], 2) + Math.pow(end[1] - start[1], 2)
            );
            segmentLengths.push(segmentLength);
            totalLength += segmentLength;
        }

        // Find the midpoint (half of total length)
        const targetLength = totalLength / 2;
        let currentLength = 0;

        // Find which segment contains the midpoint
        for (let i = 0; i < segmentLengths.length; i++) {
            const segmentLength = segmentLengths[i];
            if (currentLength + segmentLength >= targetLength) {
                // The midpoint is in this segment
                const remainingLength = targetLength - currentLength;
                const ratio = remainingLength / segmentLength;

                const start = coordinates[i];
                const end = coordinates[i + 1];

                // Interpolate between start and end points
                const midX = start[0] + ratio * (end[0] - start[0]);
                const midY = start[1] + ratio * (end[1] - start[1]);

                return [midX, midY];
            }
            currentLength += segmentLength;
        }

        // Fallback: if we somehow didn't find the midpoint, return the last point
        return coordinates[coordinates.length - 1];
    }

    createAnchorPoint(feature) {
        const properties = feature.getProperties();
        if (!properties.text) return; // Only create anchor points for features with text

        // Only create anchor points for polygons and lines, not points
        if (properties.type === 'point') return;



        // Remove existing anchor point if any
        this.removeAnchorPoint(feature);

        const geometry = feature.getGeometry();
        const coordinates = geometry.getCoordinates();

        // Calculate initial anchor point position
        let anchorPosition;
        if (properties.type === 'polygon') {
            const centroid = this.getPolygonCentroid(coordinates[0]);
            anchorPosition = centroid;
        } else if (properties.type === 'line') {
            const midpoint = this.getLineMidpoint(coordinates);
            anchorPosition = midpoint;
        }

        // Create anchor point feature
        const anchorPointGeometry = new ol.geom.Point(anchorPosition);
        const anchorPointFeature = new ol.Feature({
            geometry: anchorPointGeometry,
            type: 'anchor-point',
            parentFeature: feature,
            tagType: properties.tagType || 'default'
        });

        // Set style for anchor point
        anchorPointFeature.setStyle(this.createAnchorPointStyleFunction()(anchorPointFeature));

        // Add geometry change listener to update leader line when anchor point moves
        const anchorGeometry = anchorPointFeature.getGeometry();
        anchorGeometry.on('change', () => {

            // Constrain the anchor point to stay within the shape
            this.constrainAnchorPointToShape(anchorPointFeature, feature);
            // Update the leader line
            this.updateLeaderLine(feature);
        });

        // Add geometry change listener to parent feature to update anchor point when parent changes
        this.addGeometryChangeListenerToFeature(feature);

        // Add to vector source and track it
        this.vectorSource.addFeature(anchorPointFeature);
        this.anchorPointFeatures.set(feature, anchorPointFeature);


    }

    updateAnchorPoint(feature) {
        const anchorPointFeature = this.anchorPointFeatures.get(feature);
        if (!anchorPointFeature) return;

        const properties = feature.getProperties();
        const geometry = feature.getGeometry();
        const coordinates = geometry.getCoordinates();

        // Recalculate anchor point position based on feature geometry
        let anchorPosition;
        if (properties.type === 'point') {
            anchorPosition = coordinates;
        } else if (properties.type === 'polygon') {
            const centroid = this.getPolygonCentroid(coordinates[0]);
            anchorPosition = centroid;
        } else if (properties.type === 'line') {
            const midpoint = this.getLineMidpoint(coordinates);
            anchorPosition = midpoint;
        }

        // Update anchor point geometry
        const newGeometry = new ol.geom.Point(anchorPosition);
        anchorPointFeature.setGeometry(newGeometry);
    }

    addGeometryChangeListenerToFeature(feature) {
        // Add geometry change listener to parent feature to update anchor point when parent changes
        const parentGeometry = feature.getGeometry();
        if (parentGeometry) {
            // Remove any existing listeners to avoid duplicates
            parentGeometry.un('change', this.handleParentGeometryChange);

            // Add the listener
            parentGeometry.on('change', this.handleParentGeometryChange.bind(this, feature));
        }
    }

    handleParentGeometryChange(feature) {
        // Don't update anchor point position when parent shape changes
        // Just ensure it stays constrained within the new boundaries
        const anchorPointFeature = this.anchorPointFeatures.get(feature);
        if (anchorPointFeature) {
            this.constrainAnchorPointToShape(anchorPointFeature, feature);
        }
        // Always update the leader line
        this.updateLeaderLine(feature);
    }

    removeAnchorPoint(feature) {
        const anchorPointFeature = this.anchorPointFeatures.get(feature);
        if (anchorPointFeature) {
            this.vectorSource.removeFeature(anchorPointFeature);
            this.anchorPointFeatures.delete(feature);
        }
    }

    getAnchorPointPosition(feature) {
        const anchorPointFeature = this.anchorPointFeatures.get(feature);

        if (anchorPointFeature) {
            const coords = anchorPointFeature.getGeometry().getCoordinates();

            return coords;
        }

        // Fallback to original calculation if no anchor point exists
        const properties = feature.getProperties();
        const geometry = feature.getGeometry();
        const coordinates = geometry.getCoordinates();



        if (properties.type === 'point') {
            // For points, just return the point coordinates (no anchor point needed)
            return coordinates;
        } else if (properties.type === 'polygon') {
            return this.getPolygonCentroid(coordinates[0]);
        } else if (properties.type === 'line') {
            return this.getLineMidpoint(coordinates);
        }


        return null;
    }

    constrainAnchorPointToShape(anchorPointFeature, parentFeature) {
        const parentProperties = parentFeature.getProperties();
        const parentGeometry = parentFeature.getGeometry();
        const anchorGeometry = anchorPointFeature.getGeometry();
        const currentCoords = anchorGeometry.getCoordinates();

        let constrainedCoords = currentCoords;

        if (parentProperties.type === 'polygon') {
            // For polygons, constrain to the polygon boundary
            const polygonCoords = parentGeometry.getCoordinates()[0]; // Outer ring
            if (!this.isPointInPolygon(currentCoords, polygonCoords)) {
                // Find the closest point on the polygon boundary
                constrainedCoords = this.getClosestPointOnPolygon(currentCoords, polygonCoords);
            }
        } else if (parentProperties.type === 'line') {
            // For lines, constrain to the line segments
            const lineCoords = parentGeometry.getCoordinates();
            constrainedCoords = this.getClosestPointOnLine(currentCoords, lineCoords);
        }

        // Update the anchor point geometry if it changed
        if (constrainedCoords[0] !== currentCoords[0] || constrainedCoords[1] !== currentCoords[1]) {
            anchorGeometry.setCoordinates(constrainedCoords);
        }
    }

    isPointInPolygon(point, polygonCoords) {
        // Ray casting algorithm to determine if point is inside polygon
        const x = point[0];
        const y = point[1];
        let inside = false;

        for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
            const xi = polygonCoords[i][0];
            const yi = polygonCoords[i][1];
            const xj = polygonCoords[j][0];
            const yj = polygonCoords[j][1];

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    }

    getClosestPointOnPolygon(point, polygonCoords) {
        let closestPoint = null;
        let minDistance = Infinity;

        // Check each edge of the polygon
        for (let i = 0; i < polygonCoords.length; i++) {
            const start = polygonCoords[i];
            const end = polygonCoords[(i + 1) % polygonCoords.length];

            const closestOnEdge = this.getClosestPointOnSegment(point, start, end);
            const distance = Math.sqrt(
                Math.pow(point[0] - closestOnEdge[0], 2) +
                Math.pow(point[1] - closestOnEdge[1], 2)
            );

            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = closestOnEdge;
            }
        }

        return closestPoint || point;
    }

    getClosestPointOnLine(point, lineCoords) {
        let closestPoint = null;
        let minDistance = Infinity;

        // Check each segment of the line
        for (let i = 0; i < lineCoords.length - 1; i++) {
            const start = lineCoords[i];
            const end = lineCoords[i + 1];

            const closestOnSegment = this.getClosestPointOnSegment(point, start, end);
            const distance = Math.sqrt(
                Math.pow(point[0] - closestOnSegment[0], 2) +
                Math.pow(point[1] - closestOnSegment[1], 2)
            );

            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = closestOnSegment;
            }
        }

        return closestPoint || point;
    }

    getClosestPointOnSegment(point, start, end) {
        const A = point[0] - start[0];
        const B = point[1] - start[1];
        const C = end[0] - start[0];
        const D = end[1] - start[1];

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq !== 0) param = dot / lenSq;

        let xx, yy;
        if (param < 0) {
            xx = start[0];
            yy = start[1];
        } else if (param > 1) {
            xx = end[0];
            yy = end[1];
        } else {
            xx = start[0] + param * C;
            yy = start[1] + param * D;
        }

        return [xx, yy];
    }

    updateAnnotationsFromFeatures() {
        const features = this.vectorSource.getFeatures();
        this.annotations.points = [];
        this.annotations.polygons = [];
        this.annotations.lines = [];
        features.forEach(feature => {
            const properties = feature.getProperties();
            const geometry = feature.getGeometry();
            const coordinates = geometry.getCoordinates();
            // Skip leader lines and anchor points
            if (properties.type === 'leader-line' || properties.type === 'anchor-point') return;

            // Get label position from overlay
            let labelPosition = null;
            const overlay = this.labelOverlays.get(feature);
            if (overlay) {
                labelPosition = overlay.getPosition();
            }

            // Get anchor position for polygons and lines
            let anchorPosition = null;
            if (properties.type === 'polygon' || properties.type === 'line') {
                const anchorFeature = this.anchorPointFeatures.get(feature);
                if (anchorFeature) {
                    anchorPosition = anchorFeature.getGeometry().getCoordinates();
                }
            }

            if (properties.type === 'point') {
                this.annotations.points.push({
                    id: properties.id,
                    coordinates: coordinates,
                    labelPosition: labelPosition,
                    text: properties.text || '',
                    type: properties.tagType || 'default'
                });
            } else if (properties.type === 'polygon') {
                this.annotations.polygons.push({
                    id: properties.id,
                    coordinates: coordinates[0], // Polygon coordinates
                    labelPosition: labelPosition,
                    anchorPosition: anchorPosition,
                    text: properties.text || '',
                    type: properties.tagType || 'default'
                });
            } else if (properties.type === 'line') {
                this.annotations.lines.push({
                    id: properties.id,
                    coordinates: coordinates,
                    labelPosition: labelPosition,
                    anchorPosition: anchorPosition,
                    text: properties.text || '',
                    type: properties.tagType || 'default'
                });
            }
        });
        // Trigger save state update
        if (typeof updateSaveButtonState === 'function') {
            updateSaveButtonState();
        }
        // Always update tag panel if it exists
        if (typeof renderTagPanel === 'function') {
            renderTagPanel();
        }
    }

    // Data conversion methods
    convertToSaveFormat() {






        const exportData = {
            points: [],
            polygons: [],
            lines: []
        };

        // Process points
        this.annotations.points.forEach(point => {
            const feature = this.vectorSource.getFeatureById(point.id);
            if (feature) {
                const overlay = this.labelOverlays.get(feature);
                let labelPosition = null;

                if (overlay) {
                    const labelElement = overlay.getElement();
                    if (labelElement) {
                        const rect = labelElement.getBoundingClientRect();
                        const mapElement = this.map.getTargetElement();
                        const mapRect = mapElement.getBoundingClientRect();

                        // Convert to map coordinates
                        const labelPixel = [
                            rect.left + rect.width / 2 - mapRect.left,
                            rect.top + rect.height / 2 - mapRect.top
                        ];
                        labelPosition = this.map.getCoordinateFromPixel(labelPixel);
                    }
                }

                exportData.points.push({
                    id: point.id,
                    coordinates: point.coordinates,
                    labelPosition: labelPosition,
                    text: point.text,
                    type: point.type
                });
            }
        });

        // Process polygons
        this.annotations.polygons.forEach(polygon => {
            const feature = this.vectorSource.getFeatureById(polygon.id);
            if (feature) {
                const overlay = this.labelOverlays.get(feature);
                let labelPosition = null;
                let anchorPosition = null;

                if (overlay) {
                    const labelElement = overlay.getElement();
                    if (labelElement) {
                        const rect = labelElement.getBoundingClientRect();
                        const mapElement = this.map.getTargetElement();
                        const mapRect = mapElement.getBoundingClientRect();

                        // Convert to map coordinates
                        const labelPixel = [
                            rect.left + rect.width / 2 - mapRect.left,
                            rect.top + rect.height / 2 - mapRect.top
                        ];
                        labelPosition = this.map.getCoordinateFromPixel(labelPixel);
                    }
                }

                // Get anchor point position if it exists
                const anchorFeature = this.anchorPointFeatures.get(feature);
                if (anchorFeature) {
                    anchorPosition = anchorFeature.getGeometry().getCoordinates();
                }

                exportData.polygons.push({
                    id: polygon.id,
                    coordinates: polygon.coordinates,
                    labelPosition: labelPosition,
                    anchorPosition: anchorPosition,
                    text: polygon.text,
                    type: polygon.type
                });
            }
        });

        // Process lines
        this.annotations.lines.forEach(line => {
            const feature = this.vectorSource.getFeatureById(line.id);
            if (feature) {
                const overlay = this.labelOverlays.get(feature);
                let labelPosition = null;
                let anchorPosition = null;

                if (overlay) {
                    const labelElement = overlay.getElement();
                    if (labelElement) {
                        const rect = labelElement.getBoundingClientRect();
                        const mapElement = this.map.getTargetElement();
                        const mapRect = mapElement.getBoundingClientRect();

                        // Convert to map coordinates
                        const labelPixel = [
                            rect.left + rect.width / 2 - mapRect.left,
                            rect.top + rect.height / 2 - mapRect.top
                        ];
                        labelPosition = this.map.getCoordinateFromPixel(labelPixel);
                    }
                }

                // Get anchor point position if it exists
                const anchorFeature = this.anchorPointFeatures.get(feature);
                if (anchorFeature) {
                    anchorPosition = anchorFeature.getGeometry().getCoordinates();
                }

                exportData.lines.push({
                    id: line.id,
                    coordinates: line.coordinates,
                    labelPosition: labelPosition,
                    anchorPosition: anchorPosition,
                    text: line.text,
                    type: line.type
                });
            }
        });

        return exportData;
    }

    loadFromSaveFormat(data) {
        // Clear existing features and overlays
        this.vectorSource.clear();
        this.leaderLineSource.clear(); // Clear leader line source
        this.leaderLineFeatures.clear();
        this.anchorPointFeatures.clear();
        this.labelOverlays.forEach((overlay, feature) => {
            // Clean up event listeners
            const labelElement = overlay.getElement();
            if (labelElement && labelElement._dragHandlers) {
                labelElement.removeEventListener('mousedown', labelElement._dragHandlers.mousedown);
                document.removeEventListener('mousemove', labelElement._dragHandlers.mousemove);
                document.removeEventListener('mouseup', labelElement._dragHandlers.mouseup);
            }
            this.map.removeOverlay(overlay);
        });
        this.labelOverlays.clear();

        // Load points
        (data.points || []).forEach(point => {
            const feature = new ol.Feature({
                geometry: new ol.geom.Point(point.coordinates),
                type: 'point',
                text: point.text,
                tagType: point.type,
                id: point.id
            });

            // Set initial style for the feature
            feature.setStyle(this.createStyleFunction()(feature));

            this.vectorSource.addFeature(feature);

            // Create label overlay if text exists
            if (point.text) {
                this.createOrUpdateLabelOverlay(feature);

                // Position label at saved location if available
                if (point.labelPosition) {
                    const overlay = this.labelOverlays.get(feature);
                    if (overlay) {
                        overlay.setPosition(point.labelPosition);
                    }
                }

                this.createOrUpdateLeaderLine(feature);
            }
        });

        // Load polygons
        (data.polygons || []).forEach(polygon => {
            const feature = new ol.Feature({
                geometry: new ol.geom.Polygon([polygon.coordinates]),
                type: 'polygon',
                text: polygon.text,
                tagType: polygon.type,
                id: polygon.id
            });

            // Set initial style for the feature
            feature.setStyle(this.createStyleFunction()(feature));

            this.vectorSource.addFeature(feature);

            // Create anchor point if position is saved
            if (polygon.anchorPosition) {
                const anchorFeature = new ol.Feature({
                    geometry: new ol.geom.Point(polygon.anchorPosition),
                    type: 'anchor-point',
                    parentFeature: feature,
                    id: `anchor-${polygon.id}`
                });
                anchorFeature.setStyle(this.createAnchorPointStyleFunction()(anchorFeature));
                this.vectorSource.addFeature(anchorFeature);
                this.anchorPointFeatures.set(feature, anchorFeature);
            }

            // Create label overlay if text exists
            if (polygon.text) {
                this.createOrUpdateLabelOverlay(feature);

                // Position label at saved location if available
                if (polygon.labelPosition) {
                    const overlay = this.labelOverlays.get(feature);
                    if (overlay) {
                        overlay.setPosition(polygon.labelPosition);
                    }
                }

                this.createOrUpdateLeaderLine(feature);
            }
        });

        // Load lines
        (data.lines || []).forEach(line => {
            const feature = new ol.Feature({
                geometry: new ol.geom.LineString(line.coordinates),
                type: 'line',
                text: line.text,
                tagType: line.type,
                id: line.id
            });

            // Set initial style for the feature
            feature.setStyle(this.createStyleFunction()(feature));

            this.vectorSource.addFeature(feature);

            // Create anchor point if position is saved
            if (line.anchorPosition) {
                const anchorFeature = new ol.Feature({
                    geometry: new ol.geom.Point(line.anchorPosition),
                    type: 'anchor-point',
                    parentFeature: feature,
                    id: `anchor-${line.id}`
                });
                anchorFeature.setStyle(this.createAnchorPointStyleFunction()(anchorFeature));
                this.vectorSource.addFeature(anchorFeature);
                this.anchorPointFeatures.set(feature, anchorFeature);
            }

            // Create label overlay if text exists
            if (line.text) {
                this.createOrUpdateLabelOverlay(feature);

                // Position label at saved location if available
                if (line.labelPosition) {
                    const overlay = this.labelOverlays.get(feature);
                    if (overlay) {
                        overlay.setPosition(line.labelPosition);
                    }
                }

                this.createOrUpdateLeaderLine(feature);
            }
        });

        this.updateAnnotationsFromFeatures();
    }

    // Public API methods
    getMap() {
        return this.map;
    }

    getAnnotations() {
        return this.annotations;
    }

    clearAnnotations() {
        // Clear all overlays
        this.labelOverlays.forEach((overlay, feature) => {
            // Clean up event listeners
            const labelElement = overlay.getElement();
            if (labelElement && labelElement._dragHandlers) {
                labelElement.removeEventListener('mousedown', labelElement._dragHandlers.mousedown);
                document.removeEventListener('mousemove', labelElement._dragHandlers.mousemove);
                document.removeEventListener('mouseup', labelElement._dragHandlers.mouseup);
            }
            this.map.removeOverlay(overlay);
        });
        this.labelOverlays.clear();

        this.vectorSource.clear();
        this.leaderLineFeatures.clear();
        this.leaderLineSource.clear();
        this.anchorPointFeatures.clear();
        this.annotations.points = [];
        this.annotations.polygons = [];
        this.annotations.lines = [];
    }

    // Tag system methods
    loadTags() {
        const stored = localStorage.getItem('mapTags');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.tags = parsed;
                } else {
                    this.tags = ['Fix', 'Navaid', 'Warning Area', 'Airway', 'Sector'];
                }
            } catch (e) {
                this.tags = ['Fix', 'Navaid', 'Warning Area', 'Airway', 'Sector'];
            }
        } else {
            this.tags = ['Fix', 'Navaid', 'Warning Area', 'Airway', 'Sector'];
        }
        this.currentType = localStorage.getItem('currentType') || this.tags[0];
        this.loadTagVisibility();
    }

    saveTags() {
        localStorage.setItem('mapTags', JSON.stringify(this.tags));
        localStorage.setItem('currentType', this.currentType);
    }

    loadTagVisibility() {
        try {
            this.tagVisibility = JSON.parse(localStorage.getItem('tagVisibility') || '{}');
        } catch {
            this.tagVisibility = {};
        }
        // Ensure all tags have a value
        this.tags.forEach(tag => {
            if (!(tag in this.tagVisibility)) this.tagVisibility[tag] = true;
        });
    }

    saveTagVisibility() {
        localStorage.setItem('tagVisibility', JSON.stringify(this.tagVisibility));
    }

    setTagVisibility(tag, visible) {
        this.tagVisibility[tag] = visible;
        this.saveTagVisibility();
        this.updateTagVisibilityOnMap();
    }

    updateTagVisibilityOnMap() {

        const features = this.vectorSource.getFeatures();


        features.forEach(feature => {
            const properties = feature.getProperties();
            const tagType = properties.tagType || 'default';
            const isVisible = this.tagVisibility[tagType] !== false;



            // Set feature visibility based on tag visibility
            if (properties.type === 'leader-line') {
                // For leader lines, check parent feature visibility
                const parentFeature = properties.parentFeature;
                const parentTagType = parentFeature.get('tagType') || 'default';
                const parentVisible = this.tagVisibility[parentTagType] !== false;

                if (parentVisible) {
                    // Show leader line with normal style
                    feature.setStyle(new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: '#666',
                            width: 1,
                            lineDash: [4, 3]
                        })
                    }));
                } else {
                    // Hide leader line by setting invisible style
                    feature.setStyle(new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: 'transparent',
                            width: 0
                        })
                    }));
                }
            } else if (properties.type === 'anchor-point') {
                // For anchor points, check parent feature visibility AND current mode
                const parentFeature = properties.parentFeature;
                const parentTagType = parentFeature.get('tagType') || 'default';
                const parentVisible = this.tagVisibility[parentTagType] !== false;
                const inMoveMode = this.currentMode === 'move';

                if (parentVisible && inMoveMode) {
                    // Show anchor point with normal style (only in move mode)
                    feature.setStyle(this.createAnchorPointStyleFunction()(feature));
                } else {
                    // Hide anchor point by setting invisible style
                    feature.setStyle(new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 0,
                            fill: new ol.style.Fill({
                                color: 'transparent'
                            }),
                            stroke: new ol.style.Stroke({
                                color: 'transparent',
                                width: 0
                            })
                        })
                    }));
                }
            } else {
                // For main features, use the updated style function that respects tag visibility
                feature.setStyle(this.createStyleFunction()(feature));
            }
        });

        // Update label overlay visibility
        this.labelOverlays.forEach((overlay, feature) => {
            const properties = feature.getProperties();
            const tagType = properties.tagType || 'default';
            const isVisible = this.tagVisibility[tagType] !== false;

            const labelElement = overlay.getElement();
            if (labelElement) {
                labelElement.style.display = isVisible ? 'block' : 'none';
            }
        });

        // Update leader line visibility in leader line source
        const leaderLineFeatures = this.leaderLineSource.getFeatures();
        leaderLineFeatures.forEach(feature => {
            const properties = feature.getProperties();
            if (properties.type === 'leader-line') {
                const parentFeature = properties.parentFeature;
                const parentTagType = parentFeature.get('tagType') || 'default';
                const parentVisible = this.tagVisibility[parentTagType] !== false;

                if (parentVisible) {
                    // Show leader line with normal style
                    feature.setStyle(new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: '#666',
                            width: 1,
                            lineDash: [4, 3]
                        })
                    }));
                } else {
                    // Hide leader line by setting invisible style
                    feature.setStyle(new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: 'transparent',
                            width: 0
                        })
                    }));
                }
            }
        });

        // Trigger UI updates if the function exists
        if (typeof renderTagPanel === 'function') {
            renderTagPanel();
        }

        // Force map refresh to ensure styles are applied
        this.map.render();
    }

    getCurrentType() {
        return this.currentType;
    }

    setCurrentType(type) {

        this.currentType = type;
        this.saveTags();
    }

    getTags() {
        return this.tags;
    }

    getTagVisibility() {
        return this.tagVisibility;
    }

    getElementCountForTag(tag) {
        const features = this.vectorSource.getFeatures();
        return features.filter(feature => {
            const properties = feature.getProperties();
            return (
                properties.tagType === tag &&
                properties.type !== 'leader-line' &&
                properties.type !== 'anchor-point'
            );
        }).length;
    }

    // Debug helper function to inspect element tags
    debugElementTags() {
        const features = this.vectorSource.getFeatures();

        features.forEach((feature, index) => {
            const properties = feature.getProperties();
        });

        return features;
    }

    highlightElementsWithTag(tag) {
        // Check if the tag is currently hidden - if so, don't highlight anything
        const isTagVisible = this.tagVisibility[tag] !== false;
        if (!isTagVisible) {
            return; // Don't highlight hidden tags
        }

        const features = this.vectorSource.getFeatures();
        features.forEach(feature => {
            const properties = feature.getProperties();
            if (properties.tagType === tag) {
                // Apply highlight style
                feature.setStyle(this.createHighlightStyleFunction()(feature));

                // Highlight label overlay
                const overlay = this.labelOverlays.get(feature);
                if (overlay) {
                    const labelElement = overlay.getElement();
                    if (labelElement) {
                        labelElement.style.backgroundColor = 'rgba(33, 150, 243, 0.85)';
                        labelElement.style.border = '2px solid #2196F3';
                        labelElement.style.color = '#fff';
                    }
                }
            } else if (properties.type === 'leader-line') {
                // Highlight leader lines for matching parent features
                const parentFeature = properties.parentFeature;
                const parentTagType = parentFeature.get('tagType') || 'default';
                if (parentTagType === tag) {
                    feature.setStyle(new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: '#2196F3',
                            width: 2,
                            lineDash: [4, 3]
                        })
                    }));
                }
            }
        });
    }

    removeElementHighlighting() {
        const features = this.vectorSource.getFeatures();
        features.forEach(feature => {
            const properties = feature.getProperties();
            if (properties.type === 'leader-line') {
                // Restore leader line style
                feature.setStyle(new ol.style.Style({
                    stroke: new ol.style.Stroke({
                        color: '#666',
                        width: 1,
                        lineDash: [4, 3]
                    })
                }));
            } else {
                // Restore normal style
                feature.setStyle(this.createStyleFunction()(feature));

                // Restore label overlay style
                const overlay = this.labelOverlays.get(feature);
                if (overlay) {
                    const labelElement = overlay.getElement();
                    if (labelElement) {
                        labelElement.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
                        labelElement.style.border = '1px solid rgba(0, 0, 0, 0.3)';
                        labelElement.style.color = '#000';
                    }
                }
            }
        });
    }

    removeAllModifyInteractions() {
        // Remove all Modify interactions from the map
        this.map.getInteractions().getArray().forEach((interaction) => {
            if (interaction instanceof ol.interaction.Modify) {
                this.map.removeInteraction(interaction);
            }
        });
    }

    handleDeleteFeature(feature) {
        // Remove label overlay and leader line if they exist
        this.removeLabelOverlay(feature);
        this.removeLeaderLine(feature);
        // Remove the feature from the source
        this.vectorSource.removeFeature(feature);
        // Update annotations
        this.updateAnnotationsFromFeatures();
    }

    // Test function for debugging cursor styles
    testCursorStyles() {




        this.labelOverlays.forEach((overlay, feature) => {
            const labelElement = overlay.getElement();
            if (!labelElement) {

                return;
            }






            // Manually apply cursor styles
            this.applyCursorStylesToLabel(labelElement);





            // Test hover events

            if (labelElement.onpointerenter) {

                labelElement.onpointerenter();

            }
            if (labelElement.onpointerleave) {

                labelElement.onpointerleave();

            }
        });
    }

    updateAnchorPointVisibility() {
        // Update visibility of all anchor points based on current mode
        this.anchorPointFeatures.forEach((anchorPointFeature, parentFeature) => {
            anchorPointFeature.setStyle(this.createAnchorPointStyleFunction()(anchorPointFeature));
        });

    }

    updateFeatureCursorStyles() {
        // Update cursor styles for the map container based on current mode
        const mapElement = this.map.getTargetElement();
        if (!mapElement) return;

        // Set cursor based on current mode
        switch (this.currentMode) {
            case 'move':
                mapElement.style.cursor = 'default'; // Always default for map background in move mode
                break;
            case 'editLabelText':
                mapElement.style.cursor = 'default';
                break;
            case 'delete':
                mapElement.style.cursor = 'default';
                break;
            case 'changeTag':
                mapElement.style.cursor = 'default';
                break;
            case 'add':
            case 'point':
            case 'polygon':
            case 'line':
                mapElement.style.cursor = 'crosshair';
                break;
            case 'neutral':
            default:
                mapElement.style.cursor = 'default';
                break;
        }
    }
}

// Global instance
let olMapSystem = null; 
