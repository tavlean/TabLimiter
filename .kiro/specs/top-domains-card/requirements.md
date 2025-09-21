# Requirements Document

## Introduction

This feature adds a new card to the Tab Limiter extension that displays the top 5 domains with the most number of open tabs across all browser windows. This will help users identify which websites are consuming the most of their tab quota and make informed decisions about tab management.

## Requirements

### Requirement 1

**User Story:** As a Tab Limiter user, I want to see which domains have the most open tabs, so that I can identify tab-heavy websites and manage my browsing more effectively.

#### Acceptance Criteria

1. WHEN the options page is opened THEN the system SHALL display a new "Top Domains" card alongside the existing Window and All Windows cards
2. WHEN tabs are open across all browser windows THEN the system SHALL analyze all tabs and group them by domain
3. WHEN displaying domain statistics THEN the system SHALL show the top 5 domains with the highest tab counts
4. WHEN a domain has multiple tabs open THEN the system SHALL count all tabs from that domain including subdomains (e.g., mail.google.com and drive.google.com both count as google.com)
5. WHEN there are fewer than 5 domains with open tabs THEN the system SHALL display only the domains that have open tabs

### Requirement 2

**User Story:** As a Tab Limiter user, I want the domain statistics to update in real-time, so that I always see current information about my tab usage.

#### Acceptance Criteria

1. WHEN a new tab is opened THEN the system SHALL update the domain statistics within 1 second
2. WHEN a tab is closed THEN the system SHALL update the domain statistics within 1 second
3. WHEN a tab's URL changes THEN the system SHALL recalculate domain statistics to reflect the change
4. WHEN the user switches between windows THEN the system SHALL maintain accurate domain counts across all windows
5. WHEN the options page is visible THEN the system SHALL refresh domain statistics every 1 second to ensure accuracy

### Requirement 3

**User Story:** As a Tab Limiter user, I want the domain card to have a consistent visual design with the existing cards, so that the interface feels cohesive and familiar.

#### Acceptance Criteria

1. WHEN the Top Domains card is displayed THEN the system SHALL use the same card styling as existing Window and All Windows cards
2. WHEN displaying domain information THEN the system SHALL include an appropriate icon in the card header
3. WHEN showing domain names THEN the system SHALL display them in a clean, readable format
4. WHEN displaying tab counts THEN the system SHALL use consistent number formatting with other cards
5. WHEN the card content exceeds available space THEN the system SHALL handle overflow gracefully without breaking the layout

### Requirement 4

**User Story:** As a Tab Limiter user, I want to see meaningful domain names rather than complex URLs, so that I can quickly identify websites.

#### Acceptance Criteria

1. WHEN processing tab URLs THEN the system SHALL extract the root domain (e.g., "google.com" from "https://mail.google.com/inbox")
2. WHEN a tab has no valid domain (e.g., chrome:// pages) THEN the system SHALL exclude it from domain statistics
3. WHEN displaying domain names THEN the system SHALL show only the readable domain name without protocol or path
4. WHEN multiple subdomains exist for the same root domain THEN the system SHALL group them under the root domain
5. WHEN a domain name is very long THEN the system SHALL truncate it appropriately with ellipsis to maintain layout

### Requirement 5

**User Story:** As a Tab Limiter user, I want the domain statistics to respect my privacy settings, so that my browsing data is handled securely.

#### Acceptance Criteria

1. WHEN collecting domain statistics THEN the system SHALL only access tab information that the extension already has permission to view
2. WHEN processing tab data THEN the system SHALL not store or transmit domain information outside the browser
3. WHEN the extension is disabled or uninstalled THEN the system SHALL not retain any domain statistics data
4. WHEN calculating domain statistics THEN the system SHALL only use currently open tabs and not access browsing history
5. WHEN displaying domain information THEN the system SHALL not reveal specific page titles or full URLs to maintain privacy
