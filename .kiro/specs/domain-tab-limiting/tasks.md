# Implementation Plan

-   [x] 1. Use domain icon and update manifest

    -   use domain.svg icon file in extension/icons/ directory
    -   match existing icon style and theme
    -   _Requirements: 2.1_

-   [x] 2. Implement core domain extraction and tracking utilities

    -   Add domain extraction function that handles various URL formats (http/https, www removal, special cases)
    -   Create domain counting logic that groups tabs by domain
    -   Write unit tests for domain extraction with edge cases (localhost, IP addresses, chrome:// URLs)
    -   _Requirements: 1.1, 2.1, 6.4_

-   [ ] 3. Extend storage schema for domain limits

    -   Add maxDomain field to defaultOptions with default value of 10
    -   Update storage initialization in background.js to include domain settings
    -   Create helper functions for domain limit storage operations
    -   _Requirements: 1.1, 1.4_

-   [ ] 4. Create DomainTracker service class

    -   Implement DomainTracker class with methods for counting tabs by domain
    -   Add getCurrentDomainInfo method to get active tab's domain information
    -   Add getTopDomains method to return sorted list of domains by tab count
    -   Write unit tests for DomainTracker methods
    -   _Requirements: 2.1, 3.2, 3.3, 6.1_

-   [ ] 5. Add Domain card HTML structure

    -   Insert new Domain card after "All Windows" card in options.html
    -   Create card header with domain icon and "Domain" title
    -   Add stepper controls for domain limit
    -   Add progress bar and labels structure for domain usage display
    -   Add domain name display element
    -   _Requirements: 1.1, 2.1, 2.2_

-   [ ] 6. Implement Domain card CSS styling

    -   Add CSS styles for domain card following existing card pattern
    -   Style domain name display with appropriate typography
    -   Ensure responsive behavior and consistent spacing
    -   Add hover states and transitions
    -   _Requirements: 2.1, 2.5_

-   [ ] 7. Add domain stepper functionality to options.js

    -   Wire up domain stepper buttons to increment/decrement domain limit
    -   Add domain limit input validation and bounds checking
    -   Integrate domain limit changes with existing saveOptions function
    -   Update restoreOptions to load domain limit from storage
    -   _Requirements: 1.1, 1.2_

-   [ ] 8. Implement domain progress bar updates

    -   Add updateDomainProgress function to calculate and display current domain usage
    -   Integrate domain progress updates with existing updateTabCounts function
    -   Apply existing color scheme to domain progress bar based on usage percentage
    -   Update domain display when active tab changes
    -   _Requirements: 2.2, 2.3, 2.4, 2.5, 6.2_

-   [ ] 9. Add domain name display functionality

    -   Implement getCurrentDomain function to extract domain from active tab
    -   Add domain name display updates to tab switching logic
    -   Handle edge cases for special URLs (chrome://, extensions, localhost)
    -   Truncate long domain names with ellipsis
    -   _Requirements: 2.1, 6.3_

-   [ ] 10. Create expandable domain list HTML structure

    -   Add domain list container below Domain card with chevron toggle button
    -   Create domain list items structure with progress bars and counts
    -   Add hidden class for initial collapsed state
    -   Include empty state message for when no tabs are open
    -   _Requirements: 3.1, 3.7_

-   [ ] 11. Implement domain list CSS styling and animations

    -   Style domain list container and individual domain items
    -   Add smooth expand/collapse animations (300ms ease)
    -   Style chevron icon with rotation animation
    -   Add hover states for domain list items
    -   Ensure consistent spacing and typography
    -   _Requirements: 3.1, 3.6_

-   [ ] 12. Add domain list toggle functionality

    -   Implement click handler for chevron button to expand/collapse domain list
    -   Add ARIA attributes for accessibility (aria-expanded)
    -   Rotate chevron icon when expanded/collapsed
    -   Save expansion state to storage for persistence
    -   _Requirements: 3.1, 3.6_

-   [ ] 13. Implement domain list population and updates

    -   Add populateDomainList function to fetch and display top 5 domains
    -   Create individual domain list items with progress bars and counts
    -   Sort domains by tab count in descending order
    -   Update domain list when tabs are opened/closed
    -   Handle empty state when no domains have multiple tabs
    -   _Requirements: 3.2, 3.3, 3.4, 3.5, 3.7_

-   [ ] 14. Integrate domain tracking with background script

    -   Add domain tracking initialization to background.js
    -   Update existing tab event listeners to include domain count updates
    -   Implement domain count caching with 1-second refresh interval
    -   Add domain tracking to tab creation, removal, and update events
    -   _Requirements: 6.1, 6.4_

-   [ ] 15. Implement domain limit enforcement

    -   Add domain limit checking to handleTabCreated function
    -   Create detectTooManyTabsInDomain function similar to existing limit checks
    -   Integrate domain limit enforcement with existing tab creation logic
    -   Ensure domain limits work alongside window and total limits
    -   _Requirements: 4.1, 4.2, 4.5_

-   [ ] 16. Add domain-specific alert notifications

    -   Extend displayAlert function to handle domain limit messages
    -   Add domain name and limit information to alert messages
    -   Create domain-specific alert message template
    -   Test alert display when domain limits are exceeded
    -   _Requirements: 4.3, 4.4_

-   [ ] 17. Update badge calculation for domain limits

    -   Modify updateBadge function to consider domain limits alongside window/total limits
    -   Calculate minimum remaining tabs across all limit types (window, total, domain)
    -   Ensure badge shows most restrictive limit
    -   Test badge updates when domain limits are most restrictive
    -   _Requirements: 5.3_

-   [ ] 18. Implement pinned tabs handling for domain counts

    -   Update domain counting logic to respect countPinnedTabs setting
    -   Exclude pinned tabs from domain counts when setting is disabled
    -   Include pinned tabs in domain counts when setting is enabled
    -   Test domain limits with various pinned tab configurations
    -   _Requirements: 5.1, 5.2_

-   [ ] 19. Add real-time domain updates

    -   Implement periodic domain count updates (1-second interval)
    -   Update domain display when switching between tabs
    -   Refresh domain list when tab counts change
    -   Optimize update frequency to balance accuracy and performance
    -   _Requirements: 6.1, 6.2, 6.4, 6.5_

-   [ ] 20. Add comprehensive error handling

    -   Add try-catch blocks around domain extraction and counting operations
    -   Implement fallback behavior for invalid URLs and API failures
    -   Add retry logic for failed tab queries with exponential backoff
    -   Log errors appropriately without breaking functionality
    -   _Requirements: 4.1, 4.2, 6.1_

-   [ ] 21. Write integration tests for domain limiting

    -   Create test scenarios for domain limit enforcement
    -   Test interaction between domain limits and existing window/total limits
    -   Verify domain counting accuracy with various tab configurations
    -   Test UI updates and real-time synchronization
    -   _Requirements: 1.5, 4.5, 5.4, 6.1_

-   [ ] 22. Optimize performance and finalize implementation
    -   Implement domain count caching to reduce API calls
    -   Debounce UI updates to prevent excessive redraws
    -   Batch storage operations where possible
    -   Conduct final testing and bug fixes
    -   _Requirements: 6.1, 6.4, 6.5_
