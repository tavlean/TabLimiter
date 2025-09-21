# Design Document

## Overview

The Top Domains Card feature will add a third card to the Tab Limiter extension's options page that displays the top 5 domains with the most open tabs. This card will integrate seamlessly with the existing architecture, using the same tab querying mechanisms and visual design patterns as the current Window and All Windows cards.

The feature will analyze all open tabs across all browser windows, extract domain information from tab URLs, group tabs by root domain, and display the results in a ranked list format within a card that matches the existing design system.

## Architecture

### High-Level Architecture

The feature follows the existing extension architecture pattern:

1. **Background Script Integration**: Leverage existing `tabQuery()` function to access tab data
2. **Options Page Integration**: Add new card to the existing cards container in `options.html`
3. **Real-time Updates**: Use existing tab event listeners and periodic updates to maintain current data
4. **Styling Integration**: Extend existing CSS classes and design patterns

### Data Flow

```
Tab Events (create/remove/update)
    ↓
Background Script (existing listeners)
    ↓
Options Page Update Trigger
    ↓
Domain Analysis Function
    ↓
UI Update (Top Domains Card)
```

### Component Integration

The feature integrates with existing components:

-   **Tab Query System**: Uses existing `tabQuery()` function from both `background.js` and `options.js`
-   **Update Mechanism**: Integrates with existing `updateTabCounts()` function and periodic updates
-   **Event Handling**: Leverages existing tab event listeners in background script
-   **Storage System**: Uses existing options storage pattern if needed for preferences

## Components and Interfaces

### 1. Domain Analysis Module

**Location**: `options.js` (new functions)

**Functions**:

```javascript
// Extract root domain from URL
const extractDomain = (url) => {
    // Returns root domain (e.g., "google.com" from "https://mail.google.com/inbox")
    // Handles edge cases: chrome://, file://, etc.
};

// Analyze all tabs and return domain statistics
const analyzeDomains = async (options) => {
    // Uses existing tabQuery() function
    // Returns array of {domain, count} objects sorted by count
    // Filters out invalid domains (chrome://, extensions, etc.)
};

// Get top N domains
const getTopDomains = async (options, limit = 5) => {
    // Returns top N domains with tab counts
    // Handles cases where fewer than N domains exist
};
```

### 2. UI Components

**Location**: `options.html` (new card markup)

**Structure**:

```html
<!-- Top Domains Card -->
<div class="card">
    <div class="card-header">
        <img src="icons/domains.svg" alt="Top Domains" class="card-icon" />
        <h2>Top Domains</h2>
    </div>

    <div class="card-content">
        <div class="domains-list" id="domainsList">
            <!-- Dynamic domain entries -->
        </div>
    </div>
</div>
```

**Domain Entry Structure**:

```html
<div class="domain-item">
    <span class="domain-name">google.com</span>
    <span class="domain-count">12</span>
</div>
```

### 3. Update Integration

**Location**: `options.js` (extend existing functions)

**Integration Points**:

```javascript
// Extend existing updateTabCounts function
const updateTabCounts = async () => {
    // ... existing code ...

    // Add domain analysis
    await updateDomainCounts();
};

// New function for domain-specific updates
const updateDomainCounts = async () => {
    // Get domain statistics
    // Update domain card UI
    // Handle empty states
};
```

### 4. Styling Components

**Location**: `options.css` (new classes)

**New CSS Classes**:

```css
.domains-list {
    /* Container for domain entries */
}

.domain-item {
    /* Individual domain entry styling */
}

.domain-name {
    /* Domain name text styling */
}

.domain-count {
    /* Tab count number styling */
}

.domain-empty {
    /* Empty state styling */
}
```

## Data Models

### Domain Statistics Model

```javascript
{
    domain: string,      // Root domain (e.g., "google.com")
    count: number,       // Number of tabs for this domain
    displayName: string  // Formatted display name (truncated if needed)
}
```

### Top Domains Response Model

```javascript
{
    domains: [
        {
            domain: "google.com",
            count: 12,
            displayName: "google.com"
        },
        {
            domain: "github.com",
            count: 8,
            displayName: "github.com"
        }
        // ... up to 5 entries
    ],
    totalDomains: number,  // Total unique domains found
    totalTabs: number      // Total tabs analyzed
}
```

## Error Handling

### Domain Extraction Errors

-   **Invalid URLs**: Skip tabs with malformed URLs
-   **Special Protocols**: Exclude chrome://, moz-extension://, file:// URLs
-   **Empty Domains**: Handle cases where domain extraction fails

### Tab Access Errors

-   **Permission Issues**: Gracefully handle tabs the extension cannot access
-   **Timing Issues**: Handle race conditions during tab creation/removal
-   **Window Access**: Handle cases where windows become inaccessible

### UI Error States

-   **No Domains Found**: Display appropriate empty state message
-   **Loading State**: Show loading indicator during analysis
-   **Update Failures**: Gracefully handle failed updates without breaking UI

### Error Recovery

```javascript
const updateDomainCounts = async () => {
    try {
        const domains = await getTopDomains(options);
        renderDomainsList(domains);
    } catch (error) {
        console.error("Error updating domain counts:", error);
        renderDomainsError();
    }
};
```

## Testing Strategy

### Unit Testing Approach

**Domain Extraction Testing**:

-   Test various URL formats (http, https, subdomains)
-   Test edge cases (IP addresses, localhost, special protocols)
-   Test malformed URLs and error handling

**Domain Analysis Testing**:

-   Test with different tab configurations
-   Test with mixed domain types
-   Test with no tabs or single domain scenarios

**UI Update Testing**:

-   Test real-time updates during tab operations
-   Test empty states and error conditions
-   Test visual consistency with existing cards

### Integration Testing

**Tab Event Integration**:

-   Verify updates trigger correctly on tab create/remove/update
-   Test cross-window tab counting accuracy
-   Test performance with large numbers of tabs

**Options Page Integration**:

-   Verify card displays correctly alongside existing cards
-   Test responsive behavior and layout consistency
-   Test settings view toggle functionality

### Manual Testing Scenarios

1. **Basic Functionality**:

    - Open tabs from 3-5 different domains
    - Verify correct domain grouping and counting
    - Verify real-time updates when opening/closing tabs

2. **Edge Cases**:

    - Test with chrome:// and extension pages
    - Test with very long domain names
    - Test with no open tabs

3. **Performance**:

    - Test with 50+ tabs across multiple domains
    - Verify smooth updates and no UI lag
    - Test memory usage impact

4. **Visual Integration**:
    - Verify consistent styling with existing cards
    - Test in different browser zoom levels
    - Verify proper spacing and alignment

### Automated Testing Integration

The feature will integrate with existing extension testing patterns:

-   Use existing tab simulation utilities
-   Extend current options page testing
-   Add domain-specific test cases to existing test suites

## Implementation Considerations

### Performance Optimization

-   **Debounced Updates**: Prevent excessive recalculation during rapid tab changes
-   **Efficient Domain Extraction**: Cache domain extraction results where possible
-   **Minimal DOM Updates**: Only update changed domain entries

### Privacy and Security

-   **Local Processing**: All domain analysis happens locally in the browser
-   **No Data Storage**: Domain statistics are calculated in real-time, not stored
-   **Permission Compliance**: Only access tabs the extension already has permission for

### Accessibility

-   **Screen Reader Support**: Proper ARIA labels for domain statistics
-   **Keyboard Navigation**: Ensure card content is accessible via keyboard
-   **Color Contrast**: Maintain existing accessibility standards

### Browser Compatibility

-   **Manifest V3 Compliance**: Use existing service worker patterns
-   **Cross-browser Support**: Leverage existing browserApi abstraction
-   **Graceful Degradation**: Handle missing permissions or API access

### Future Extensibility

-   **Configurable Limit**: Design allows easy modification of "top 5" limit
-   **Additional Metrics**: Architecture supports adding more domain statistics
-   **Filtering Options**: Structure allows future addition of domain filtering
-   **Export Functionality**: Design supports potential data export features
