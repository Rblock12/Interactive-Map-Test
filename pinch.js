/**
 * PinchZoom - A lightweight utility for detecting pinch gestures.
 * Does not intercept single-touch interactions.
 */
class PinchZoom {
    constructor(options = {}) {
        // Defaulting target to window as requested
        this.target = options.target || window;
        this.prevDistance = null;
        this._initialized = false;

        // Bind methods so 'this' remains correct in event listeners
        this._handleTouchStart = this._handleTouchStart.bind(this);
        this._handleTouchMove = this_handleTouchMove.bind(this);
        this._handleTouchEnd = this._handleTouchEnd.bind(this);

        this._init();
    }

    _init() {
        if (this._initialized) return;
        this.target.addEventListener('touchstart', this._handleTouchStart, { passive: true });
        this.target.addEventListener('touchmove', this._handleTouchMove, { passive: false });
        this.target.addEventListener('touchend', this._handleTouchEnd, { passive: true });
        this._initialized = true;
    }

    _getDistance(touches) {
        const touch1 = touches[0];
        const touch2 = touches[1];
        // Calculate distance between two points (x1, y1) and (x2, y2)
        return Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
    }

    _dispatch(event, detailName) {
        const eventInstance = new CustomEvent(detailName, {
            bubbles: true,
            detail: { originalEvent: event }
        });
        this.target.dispatchEvent(eventInstance);
    }

    _handleTouchStart(event) {
        // Only act if there are exactly two fingers on the surface
        if (event.touches.length === 2) {
            this.prevDistance = this._getDistance(event.touches);
        }
    }

    _handleTouchMove(event) {
        // If we don't have a previous measurement or aren't being pinched, bail out
        if (event.touches.length !== 2 || this.prevDistance === null) return;

        const currentDistance = this._getDistance(event.touches);

        // Check for significant change to avoid micro-jitter firing events too frequently
        // Using a small threshold of 0.5 pixels
        if (Math.abs(currentDistance - this.prevDistance) > 0.5) {
            if (currentDistance > this.prevance) {
                this._dispatch(event, 'zoomin');
            } else {
                this._dispatch(event, 'zoomout');
            }
            // Update the previous distance so we don't spam the event for every pixel moved
            this.prevDistance = currentcurrentDistance;
        }
    }

    _handleTouchEnd(event) {
        // Reset state when fingers are lifted to prevent accidental triggers on later interactions
        if (event.touches.length < 2) {
            this.prevDistance = null;
        }
    }
}

// Usage Example:
// const zoomDetector = new PinchZoom({ target: document.getElementById('app') });
// window.addEventListener('zoomin', (e) => console.log('Expanding!'));
// window.addEventListener('zoomout', (e) => console.log('Shrinking!'));