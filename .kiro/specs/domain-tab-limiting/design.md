# Design Document

## Overview

The domain-based tab limiting feature extends the existing Tab Limiter extension by adding a third dimension of tab management focused on preventing cognitive overload from distracting websites. The design maintains consistency with the existing UI patterns while introducing new components for domain tracking, visualization, and enforcement.

The feature consists of two main components:

1. **Domain Card**: A new card in the main view showing domain limits and a list of all domains with their usage
2. **Domain Enforcement**: Background logic to prevent exceeding domain limits

## Architecture

### Data Flow

```
User Action → Options UI → Chrome Storage → Background Script → Tab Management
     ↑                                              ↓
Domain Display ← Tab Queries ← Domain Tracker ← Tab Events
```

### Storage Schema Extension

The existing storage schema will be extended to include domain-specific settings:

```javascript
// Existing storage structure extended with:
{
  maxDomain: 10,                    // Default domain limit
  domainLimits: {                   // Per-domain custom limits (future enhancement)
    "youtube.com": 5,
    "twitter.com": 3
  }
}
```

### Domain Extraction Logic

Domains will be extracted from tab URLs using a consistent algorithm:

-   Extract hostname from URL
-   Remove 'www.' prefix if present
-   Handle special cases (localhost, IP addresses, chrome:// URLs)

## Components and Interfaces

### 1. Domain Card Component

**Location**: Between "All Windows" card and settings toggle
**Structure**: Follows existing card pattern with header, stepper, and domain list sections

```html
<div class="card">
    <div class="card-header">
        <img src="icons/domain.svg" alt="Domain" class="card-icon" />
        <h2>Domain</h2>
    </div>
    <div class="card-content">
        <div class="stepper-group">
            <!-- Stepper for domain limit (1-50 range) -->
        </div>
        <div class="domain-list">
            <div class="domain-list-header">
                <span class="domain-list-title">Open Domains</span>
            </div>
            <div class="domain-list-content">
                <div class="domain-item">
                    <div class="domain-item-header">
                        <span class="domain-name">youtube.com</span>
                        <span class="domain-counts">8 / 10</span>
                    </div>
                    <div class="domain-progress">
                        <div class="progress-bar">
                            <div class="progress-fill"></div>
                        </div>
                    </div>
                </div>
                <!-- Repeat for all domains with tabs -->
            </div>
        </div>
    </div>
</div>
```

**Key Features**:

-   Stepper control with range 1-50 (default: 10)
-   Always-visible domain list (no collapsing needed)
-   Shows up to 10 domains sorted by tab count
-   Individual progress bars for each domain using existing color scheme
-   Compact display with domain name and "current/limit" format

### 3. Domain Tracking Service

**Purpose**: Centralized domain management and tab counting
**Location**: New module in background script

```javascript
class DomainTracker {
    constructor() {
        this.domainCounts = new Map();
        this.options = null;
    }

    async updateDomainCounts() {
        // Query all tabs, group by domain, update counts
    }

    getDomainFromUrl(url) {
        // Extract and normalize domain from URL
    }

    async getCurrentDomainInfo(windowId) {
        // Get active tab domain and its usage
    }

    async getTopDomains(limit = 5) {
        // Return sorted list of domains by tab count
    }

    async checkDomainLimit(domain) {
        // Check if domain has reached its limit
    }
}
```

## Data Models

### Domain Information Object

```javascript
{
  domain: "youtube.com",
  tabCount: 8,
  remaining: 2,
  limit: 10,
  percentage: 80,
  tabs: [/* array of tab objects */]
}
```

### Domain List Item

```javascript
{
  domain: "youtube.com",
  tabCount: 8,
  remaining: 2,
  percentage: 80
}
```

## Error Handling

### Domain Extraction Failures

-   **Issue**: Invalid URLs or special chrome:// pages
-   **Solution**: Fallback to "system" or "extension" categories
-   **User Impact**: Minimal, these tabs typically don't contribute to cognitive overload

### Storage Failures

-   **Issue**: Chrome storage quota exceeded or sync failures
-   **Solution**: Graceful degradation to default limits
-   **User Impact**: Feature continues working with default settings

### Tab Query Failures

-   **Issue**: Permission issues or API failures
-   **Solution**: Retry mechanism with exponential backoff
-   **User Impact**: Temporary inaccurate counts, self-correcting

### Limit Enforcement Edge Cases

-   **Issue**: Race conditions when multiple tabs open simultaneously
-   **Solution**: Debounced limit checking with 100ms delay
-   **User Impact**: Slight delay in enforcement, prevents false positives

## Testing Strategy

### Unit Tests

-   Domain extraction from various URL formats
-   Domain counting logic with different tab configurations
-   Storage operations and data persistence
-   Progress bar color calculations

### Integration Tests

-   End-to-end tab creation and domain limit enforcement
-   UI updates when switching between tabs
-   Settings persistence across browser sessions
-   Interaction with existing window/total limits

### Manual Testing Scenarios

1. **Basic Functionality**

    - Open multiple tabs from same domain
    - Verify progress bar updates
    - Test limit enforcement

2. **Edge Cases**

    - Test with pinned tabs (respect countPinnedTabs setting)
    - Test with chrome:// and extension pages
    - Test with localhost and IP addresses

3. **UI Interactions**

    - Expand/collapse domain list
    - Adjust domain limit with stepper
    - Switch between tabs and verify domain display updates

4. **Integration with Existing Features**
    - Verify window limits still work
    - Verify total limits still work
    - Test with "Balance Tabs" setting enabled
    - Test alert notifications for domain limits

### Performance Considerations

-   Domain counting operations should complete within 50ms
-   UI updates should be debounced to prevent excessive redraws
-   Storage operations should be batched when possible
-   Tab queries should be cached for 1 second to reduce API calls

## Visual Design Specifications

### Domain Card Styling

-   Follows existing card design pattern
-   Uses domain.svg icon (to be created)
-   Maintains consistent spacing and typography
-   Progress bar uses existing color scheme (purple → blue → green → yellow → orange → red)

### Domain List Styling

-   Smooth expand/collapse animation (300ms ease)
-   Consistent with existing UI patterns
-   Chevron icon rotates 180° when expanded
-   Individual domain items have subtle hover states

### Responsive Behavior

-   Maintains existing popup width constraints (340-420px)
-   Domain names truncate with ellipsis if too long
-   Progress bars scale proportionally
-   Touch-friendly tap targets (minimum 44px)

## Implementation Phases

### Phase 1: Core Domain Tracking

-   Implement domain extraction and counting logic
-   Add domain limit storage and persistence
-   Create basic domain tracking service

### Phase 2: UI Components

-   Add Domain card to main view
-   Implement stepper controls and progress display
-   Add domain name display for active tab

### Phase 3: Domain List

-   Create expandable domain list component
-   Implement top domains calculation and display
-   Add smooth animations and interactions

### Phase 4: Limit Enforcement

-   Integrate domain limits with existing tab creation logic
-   Add domain-specific alert messages
-   Test integration with existing limit systems

### Phase 5: Polish and Testing

-   Add comprehensive error handling
-   Implement performance optimizations
-   Conduct thorough testing across different scenarios
