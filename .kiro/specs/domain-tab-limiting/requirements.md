# Requirements Document

## Introduction

This feature extends the existing Tab Limiter extension to include domain-based tab limiting functionality. The primary goal is to help users maintain focus and productivity by preventing cognitive overload from opening too many tabs from distracting websites like YouTube, social media, or news sites. Users will be able to set limits on the number of tabs per domain, view current domain usage with visual progress indicators, and see a breakdown of the top domains with the most open tabs. This adds a third dimension of tab management alongside the existing per-window and total tab limits, specifically targeting the common problem of mindless tab accumulation from attention-grabbing websites.

## Requirements

### Requirement 1

**User Story:** As a user, I want to set a maximum number of tabs allowed per domain, so that I can prevent myself from mindlessly opening too many tabs from distracting websites and maintain focus on my work.

#### Acceptance Criteria

1. WHEN the user opens the extension popup THEN the system SHALL display a new "Domain" card with a stepper control for setting the maximum tabs per domain
2. WHEN the user adjusts the domain limit stepper THEN the system SHALL save the new limit value to browser storage, default value is 10
3. WHEN the user sets a domain limit THEN the system SHALL enforce this limit for all domains
4. WHEN the domain limit is changed THEN the system SHALL immediately apply the new limit to existing tabs

### Requirement 2

**User Story:** As a user, I want to see the current tab count for the active tab's domain with a visual progress bar, so that I can become aware of my tab-opening behavior and make conscious decisions about opening more tabs from potentially distracting sites.

#### Acceptance Criteria

1. WHEN the user opens the extension popup THEN the system SHALL display the domain of the currently active tab
2. WHEN the user opens the extension popup THEN the system SHALL show the number of open tabs for the current domain
3. WHEN the user opens the extension popup THEN the system SHALL show the number of remaining tabs allowed for the current domain
4. WHEN the user opens the extension popup THEN the system SHALL display a progress bar showing the percentage of domain limit used
5. WHEN the domain usage changes THEN the system SHALL update the progress bar color based on usage percentage (following the existing color scheme)

### Requirement 3

**User Story:** As a user, I want to see a collapsible list of the top domains with the most open tabs, so that I can identify which websites are contributing most to my cognitive overload and take action to reduce distractions.

#### Acceptance Criteria

1. WHEN the user clicks a down chevron icon below the domain card THEN the system SHALL expand to show a list of domains
2. WHEN the domain list is expanded THEN the system SHALL display the top 5 domains with the most open tabs
3. WHEN the domain list is expanded THEN the system SHALL sort domains in descending order by tab count
4. WHEN the domain list is expanded THEN the system SHALL show a progress bar for each domain indicating usage against the domain limit
5. WHEN the domain list is expanded THEN the system SHALL display the domain name, open tab count, and remaining tab count for each domain
6. WHEN the user clicks the chevron icon again THEN the system SHALL collapse the domain list
7. WHEN there are no open tabs THEN the system SHALL show an appropriate empty state message

### Requirement 4

**User Story:** As a user, I want the extension to prevent opening new tabs when the domain limit is reached, so that I can break the habit of mindlessly opening multiple tabs from distracting websites and stay focused on my current tasks.

#### Acceptance Criteria

1. WHEN a user attempts to open a new tab for a domain that has reached its limit THEN the system SHALL prevent the tab from opening
2. WHEN a domain limit is exceeded THEN the system SHALL close the newly created tab
3. WHEN a domain limit is exceeded AND the alert setting is enabled THEN the system SHALL display a notification indicating the domain limit has been reached
4. WHEN a domain limit is exceeded THEN the system SHALL include the domain name and limit in the alert message
5. WHEN domain limiting is active THEN the system SHALL continue to enforce existing window and total tab limits as well

### Requirement 5

**User Story:** As a user, I want the domain limiting feature to respect my existing settings for pinned tabs and other preferences, so that the new feature integrates seamlessly with my current workflow.

#### Acceptance Criteria

1. WHEN the "Count Pinned" setting is disabled THEN the system SHALL exclude pinned tabs from domain counts
2. WHEN the "Count Pinned" setting is enabled THEN the system SHALL include pinned tabs in domain counts
3. WHEN the badge display is enabled THEN the system SHALL update the badge to reflect the most restrictive limit (window, total, or domain)
4. WHEN domain limits are enforced THEN the system SHALL respect the existing "Balance Tabs" setting for window distribution
5. WHEN domain limits are active THEN the system SHALL maintain compatibility with all existing extension settings

### Requirement 6

**User Story:** As a user, I want the domain tab counts to update in real-time, so that I always see accurate information about my current tab usage.

#### Acceptance Criteria

1. WHEN tabs are opened or closed THEN the system SHALL immediately update domain counts and progress bars
2. WHEN the user switches between tabs THEN the system SHALL update the displayed domain information for the new active tab
3. WHEN the user navigates to a different domain in an existing tab THEN the system SHALL update the domain counts accordingly
4. WHEN the extension popup is open THEN the system SHALL refresh domain information every second to maintain accuracy
5. WHEN domain counts change THEN the system SHALL update progress bar colors to reflect the new usage levels
