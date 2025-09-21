# Implementation Plan

-   [x] 1. Create domain analysis utility functions

    -   Implement `extractDomain()` function to parse root domain from URLs
    -   Handle edge cases like chrome://, file://, and malformed URLs
    -   Write unit tests for domain extraction with various URL formats
    -   _Requirements: 4.1, 4.2, 4.3, 4.4, 5.4_

-   [x] 2. Implement domain statistics analysis

    -   Create `analyzeDomains()` function that uses existing `tabQuery()` to get all tabs
    -   Group tabs by extracted domain and count occurrences
    -   Implement `getTopDomains()` function to return sorted top N domains
    -   Write tests for domain analysis with mock tab data
    -   _Requirements: 1.2, 1.3, 1.4, 1.5, 4.1, 4.4_

-   [x] 3. Add Top Domains card HTML structure

    -   Add new card markup to `options.html` after existing cards
    -   Include card header with appropriate icon and title
    -   Create container for dynamic domain list content
    -   Ensure card follows existing HTML structure patterns
    -   _Requirements: 1.1, 3.1, 3.2_

-   [x] 4. Create domain card CSS styling

    -   Add CSS classes for domain list container and individual domain items
    -   Style domain name and count display elements
    -   Ensure visual consistency with existing card styling
    -   Add responsive behavior and overflow handling
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.5_

-   [x] 5. Implement domain card UI rendering

    -   Create `renderDomainsList()` function to populate domain card with data
    -   Handle empty state when no domains are found
    -   Implement proper domain name truncation for long domains
    -   Add loading state during domain analysis
    -   _Requirements: 1.5, 3.4, 4.5_

-   [ ] 6. Integrate domain updates with existing tab count system

    -   Create `updateDomainCounts()` function that calls domain analysis
    -   Integrate domain updates into existing `updateTabCounts()` function
    -   Ensure domain card updates when tab counts change
    -   Add error handling for domain analysis failures
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

-   [ ] 7. Add domain icon and finalize card integration

    -   Create or add appropriate icon for Top Domains card header
    -   Ensure icon follows existing icon patterns and styling
    -   Test complete card functionality with real browser tabs
    -   Verify card displays correctly alongside existing Window and All Windows cards
    -   _Requirements: 1.1, 3.1, 3.2_

-   [ ] 8. Implement comprehensive error handling

    -   Add try-catch blocks around domain analysis functions
    -   Create error state rendering for domain card
    -   Handle edge cases like tabs without valid domains
    -   Ensure errors don't break existing functionality
    -   _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

-   [ ] 9. Add real-time update integration

    -   Ensure domain statistics update when tabs are created, removed, or updated
    -   Test integration with existing tab event listeners in background script
    -   Verify periodic updates maintain accurate domain counts
    -   Test cross-window tab counting accuracy
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

-   [ ] 10. Create comprehensive test suite
    -   Write integration tests for complete domain card functionality
    -   Test with various tab configurations and domain scenarios
    -   Test performance with large numbers of tabs
    -   Verify visual consistency and responsive behavior
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_
