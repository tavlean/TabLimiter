/* global chrome, browser */

// Cross-browser API alias (does not throw if `browser` is undefined)
const browserApi =
    typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
const browserRef = browserApi; // Keep old variable name compatibility

// ---------------------------------------------------------------------------
// Helpers used also by background script (kept here unchanged in spirit)

const tabQuery = (options, params = {}) =>
    new Promise((res) => {
        if (!options.countPinnedTabs) params.pinned = false; // only non-pinned tabs
        browserRef.tabs.query(params, (tabs) => res(tabs));
    });

const windowRemaining = (options) =>
    tabQuery(options, { currentWindow: true }).then((tabs) => options.maxWindow - tabs.length);

const totalRemaining = (options) =>
    tabQuery(options).then((tabs) => options.maxTotal - tabs.length);

// Badge updates are handled by the background script
const updateBadge = (options) => {
    // Send message to background script to update badge
    browserRef.runtime.sendMessage({ action: "updateBadge", options });
};

// ---------------------------------------------------------------------------
// Domain Analysis Utility Functions

/**
 * Extract root domain from a URL
 * @param {string} url - The URL to extract domain from
 * @returns {string|null} - The root domain or null if invalid/excluded
 */
const extractDomain = (url) => {
    try {
        // Handle empty or invalid URLs
        if (!url || typeof url !== "string") {
            return null;
        }

        // Exclude special protocols that shouldn't be counted
        const excludedProtocols = [
            "chrome://",
            "chrome-extension://",
            "moz-extension://",
            "edge-extension://",
            "safari-extension://",
            "file://",
            "about:",
            "data:",
            "javascript:",
            "blob:",
        ];

        const lowerUrl = url.toLowerCase();
        for (const protocol of excludedProtocols) {
            if (lowerUrl.startsWith(protocol)) {
                return null;
            }
        }

        // Parse the URL
        const urlObj = new URL(url);
        let hostname = urlObj.hostname.toLowerCase();

        // Handle empty hostname
        if (!hostname) {
            return null;
        }

        // Handle IP addresses - return as-is
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        const ipv6Regex = /^\[?([0-9a-f:]+)\]?$/i;
        if (ipv4Regex.test(hostname) || ipv6Regex.test(hostname)) {
            return hostname;
        }

        // Handle localhost
        if (hostname === "localhost") {
            return hostname;
        }

        // Extract root domain from hostname
        const parts = hostname.split(".");

        // Handle cases with insufficient parts
        if (parts.length < 2) {
            return hostname;
        }

        // For most domains, take the last two parts (domain.tld)
        // This handles cases like:
        // - mail.google.com -> google.com
        // - subdomain.example.org -> example.org
        let rootDomain = parts.slice(-2).join(".");

        // Handle special cases for known multi-part TLDs
        const multiPartTlds = [
            "co.uk",
            "co.jp",
            "co.kr",
            "co.za",
            "co.nz",
            "co.in",
            "com.au",
            "com.br",
            "com.mx",
            "com.ar",
            "com.co",
            "net.au",
            "org.uk",
            "ac.uk",
            "gov.uk",
            "edu.au",
            "github.io",
            "herokuapp.com",
            "blogspot.com",
            "wordpress.com",
            "tumblr.com",
        ];

        // Check if we need to include more parts for multi-part TLDs
        if (parts.length >= 3) {
            const lastThreeParts = parts.slice(-3).join(".");
            const lastTwoParts = parts.slice(-2).join(".");

            for (const tld of multiPartTlds) {
                if (lastThreeParts.endsWith(tld)) {
                    rootDomain = lastThreeParts;
                    break;
                } else if (lastTwoParts === tld && parts.length >= 4) {
                    rootDomain = parts.slice(-3).join(".");
                    break;
                }
            }
        }

        return rootDomain;
    } catch (error) {
        // Return null for any parsing errors
        return null;
    }
};

/**
 * Analyze all tabs and return domain statistics
 * @param {Object} options - Extension options
 * @returns {Promise<Array>} - Array of {domain, count} objects sorted by count
 */
const analyzeDomains = async (options) => {
    try {
        // Get all tabs using existing tabQuery function
        const tabs = await tabQuery(options);

        // Count tabs by domain
        const domainCounts = new Map();

        for (const tab of tabs) {
            const domain = extractDomain(tab.url);

            // Skip tabs without valid domains
            if (!domain) {
                continue;
            }

            // Increment count for this domain
            const currentCount = domainCounts.get(domain) || 0;
            domainCounts.set(domain, currentCount + 1);
        }

        // Convert to array and sort by count (descending)
        const domainStats = Array.from(domainCounts.entries())
            .map(([domain, count]) => ({ domain, count }))
            .sort((a, b) => b.count - a.count);

        return domainStats;
    } catch (error) {
        console.error("Error analyzing domains:", error);
        return [];
    }
};

/**
 * Get top N domains with most tabs
 * @param {Object} options - Extension options
 * @param {number} limit - Maximum number of domains to return (default: 5)
 * @returns {Promise<Array>} - Array of top domains with counts
 */
const getTopDomains = async (options, limit = 5) => {
    try {
        const allDomains = await analyzeDomains(options);
        return allDomains.slice(0, limit);
    } catch (error) {
        console.error("Error getting top domains:", error);
        return [];
    }
};

// ---------------------------------------------------------------------------
// Domain Card UI Rendering Functions

/**
 * Truncate domain name if it's too long
 * @param {string} domain - The domain name to truncate
 * @param {number} maxLength - Maximum length before truncation (default: 20)
 * @returns {string} - Truncated domain name with ellipsis if needed
 */
const truncateDomain = (domain, maxLength = 20) => {
    if (!domain || domain.length <= maxLength) {
        return domain;
    }
    return domain.substring(0, maxLength - 1) + "…";
};

/**
 * Render loading state for domains list
 */
const renderDomainsLoading = () => {
    const domainsList = document.getElementById("domainsList");
    if (!domainsList) return;

    domainsList.innerHTML = `
        <div class="domains-loading">
            <span>Analyzing domains...</span>
        </div>
    `;
};

/**
 * Render empty state for domains list
 */
const renderDomainsEmpty = () => {
    const domainsList = document.getElementById("domainsList");
    if (!domainsList) return;

    domainsList.innerHTML = `
        <div class="domains-empty">
            <span>No domains found</span>
            <span style="font-size: 12px; margin-top: 4px; opacity: 0.8;">Open some tabs to see domain statistics</span>
        </div>
    `;
};

/**
 * Render error state for domains list
 */
const renderDomainsError = () => {
    const domainsList = document.getElementById("domainsList");
    if (!domainsList) return;

    domainsList.innerHTML = `
        <div class="domains-error">
            <span>Unable to analyze domains</span>
            <span style="font-size: 12px; margin-top: 4px; opacity: 0.8;">Please try refreshing the page</span>
        </div>
    `;
};

/**
 * Render the domains list with domain statistics
 * @param {Array} domains - Array of domain objects with {domain, count} properties
 */
const renderDomainsList = (domains) => {
    const domainsList = document.getElementById("domainsList");
    if (!domainsList) return;

    // Handle empty domains array
    if (!domains || domains.length === 0) {
        renderDomainsEmpty();
        return;
    }

    // Create HTML for domain items
    const domainItems = domains
        .map(({ domain, count }) => {
            const truncatedDomain = truncateDomain(domain);
            return `
            <div class="domain-item">
                <span class="domain-name" title="${domain}">${truncatedDomain}</span>
                <span class="domain-count">${count}</span>
            </div>
        `;
        })
        .join("");

    domainsList.innerHTML = domainItems;
};

/**
 * Update domain counts and render the domains list
 */
const updateDomainCounts = async () => {
    try {
        // Show loading state
        renderDomainsLoading();

        // Get current options
        const options = await new Promise((resolve) => {
            browserRef.storage.sync.get("defaultOptions", (defaults) => {
                browserRef.storage.sync.get(defaults.defaultOptions, (opts) => {
                    resolve(opts);
                });
            });
        });

        // Get top 5 domains
        const topDomains = await getTopDomains(options, 5);

        // Render the domains list
        renderDomainsList(topDomains);
    } catch (error) {
        console.error("Error updating domain counts:", error);
        renderDomainsError();
    }
};

// ---------------------------------------------------------------------------

let $inputs;
let currentView = "main"; // 'main' or 'settings'

// Update progress bar color based on percentage
const updateProgressBarColor = (progressEl, percentage) => {
    // Remove all existing color classes
    progressEl.classList.remove("purple", "blue", "green", "yellow", "orange", "red");

    // Add appropriate color class based on percentage ranges
    if (percentage <= 25) {
        progressEl.classList.add("purple");
    } else if (percentage <= 45) {
        progressEl.classList.add("blue");
    } else if (percentage <= 70) {
        progressEl.classList.add("green");
    } else if (percentage <= 85) {
        progressEl.classList.add("yellow");
    } else if (percentage < 100) {
        progressEl.classList.add("orange");
    } else {
        progressEl.classList.add("red");
    }
};

// Update tab count displays
const updateTabCounts = async (updateDomains = false) => {
    try {
        // Get current options
        const options = await new Promise((resolve) => {
            browserRef.storage.sync.get("defaultOptions", (defaults) => {
                browserRef.storage.sync.get(defaults.defaultOptions, (opts) => {
                    resolve(opts);
                });
            });
        });

        // Get global tab count
        const globalTabs = await tabQuery(options);
        const globalOpen = globalTabs.length;
        const globalLeft = Math.max(0, options.maxTotal - globalOpen);

        // Get current window tab count
        const windowTabs = await tabQuery(options, { currentWindow: true });
        const windowOpen = windowTabs.length;
        const windowLeft = Math.max(0, options.maxWindow - windowOpen);

        // Get window count
        const windows = await new Promise((resolve) => {
            browserRef.windows.getAll({ populate: false }, (wins) => resolve(wins));
        });
        const windowCount = windows.length;

        // Update progress bars and labels
        const globalOpenEl = document.getElementById("globalOpenCount");
        const globalLeftEl = document.getElementById("globalLeftCount");
        const globalProgressEl = document.getElementById("globalProgressFill");
        const windowOpenEl = document.getElementById("windowOpenCount");
        const windowLeftEl = document.getElementById("windowLeftCount");
        const windowProgressEl = document.getElementById("windowProgressFill");
        const windowBadgeEl = document.getElementById("windowCountBadge");

        if (globalOpenEl) {
            globalOpenEl.textContent = globalOpen;
        }

        if (globalLeftEl) {
            globalLeftEl.textContent = globalLeft;
        }

        if (globalProgressEl) {
            const globalProgress = Math.min(100, (globalOpen / options.maxTotal) * 100);
            globalProgressEl.style.width = `${globalProgress}%`;
            updateProgressBarColor(globalProgressEl, globalProgress);
        }

        if (windowOpenEl) {
            windowOpenEl.textContent = windowOpen;
        }

        if (windowLeftEl) {
            windowLeftEl.textContent = windowLeft;
        }

        if (windowProgressEl) {
            const windowProgress = Math.min(100, (windowOpen / options.maxWindow) * 100);
            windowProgressEl.style.width = `${windowProgress}%`;
            updateProgressBarColor(windowProgressEl, windowProgress);
        }

        if (windowBadgeEl) {
            windowBadgeEl.textContent = windowCount;
        }

        // Only update domain counts when explicitly requested or on initial load
        if (updateDomains) {
            await updateDomainCounts();
        }
    } catch (error) {
        console.error("Error updating tab counts:", error);
    }
};

// Toggle between main view and settings view
const toggleView = () => {
    const mainView = document.getElementById("mainView");
    const settingsView = document.getElementById("settingsView");
    const settingsToggle = document.getElementById("settingsToggle");
    const settingsIcon = settingsToggle.querySelector(".settings-icon");
    const subtitle = document.getElementById("subtitle");

    if (currentView === "main") {
        // Switch to settings view
        mainView.classList.add("hidden");
        settingsView.classList.remove("hidden");
        settingsToggle.setAttribute("aria-expanded", "true");
        settingsToggle.setAttribute("aria-label", "Close settings");

        // Show subtitle
        if (subtitle) {
            subtitle.classList.remove("hidden");
        }

        // Change icon to X/close
        settingsIcon.src = "icons/close.svg";
        settingsIcon.alt = "Close settings";

        currentView = "settings";
    } else {
        // Switch to main view
        settingsView.classList.add("hidden");
        mainView.classList.remove("hidden");
        settingsToggle.setAttribute("aria-expanded", "false");
        settingsToggle.setAttribute("aria-label", "Toggle settings");

        // Hide subtitle
        if (subtitle) {
            subtitle.classList.add("hidden");
        }

        // Change icon back to settings gear
        settingsIcon.src = "icons/settings.svg";
        settingsIcon.alt = "Toggle settings";

        currentView = "main";
    }

    // Save current view to storage
    browserRef.storage.sync.set({ optionsView: currentView });
};

// Load saved view preference
const loadViewPreference = () => {
    browserRef.storage.sync.get(["optionsView"], (result) => {
        if (result.optionsView === "settings") {
            toggleView();
        } else {
            // Ensure subtitle is hidden in main view
            const subtitle = document.getElementById("subtitle");
            if (subtitle) {
                subtitle.classList.add("hidden");
            }
        }
    });
};

// Collect and save options to storage
const saveOptions = () => {
    // Collect all checkbox and number inputs
    const inputs =
        $inputs || document.querySelectorAll('input[type="checkbox"], input[type="number"]');

    const values = {};

    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const value = input.type === "checkbox" ? input.checked : input.value;
        values[input.id] = value;
    }

    const options = values;

    browserRef.storage.sync.set(options, () => {
        updateBadge(options);
        updateTabCounts(true); // Update tab counts and domains when options are saved
    });
};

// Restore options from storage
const restoreOptions = () => {
    // Ensure inputs are present
    if (!$inputs) {
        $inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');
    }

    browserRef.storage.sync.get("defaultOptions", (defaults) => {
        browserRef.storage.sync.get(defaults.defaultOptions, (options) => {
            for (let i = 0; i < $inputs.length; i++) {
                const input = $inputs[i];
                const valueType = input.type === "checkbox" ? "checked" : "value";
                input[valueType] = options[input.id];
            }
        });
    });
};

document.addEventListener("DOMContentLoaded", () => {
    // Cache inputs first, then restore their values
    $inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');
    restoreOptions();
    updateTabCounts(true); // Update tab counts and domain counts on page load
    loadViewPreference(); // Load saved view preference

    // Settings toggle functionality
    const settingsToggle = document.getElementById("settingsToggle");
    if (settingsToggle) {
        settingsToggle.addEventListener("click", toggleView);
    }

    // Wire up change/keyup events for auto-save
    const onChangeInputs = document.querySelectorAll(
        'input[type="checkbox"], input[type="number"]'
    );
    const onKeyupInputs = document.querySelectorAll('input[type="number"]');

    for (let i = 0; i < onChangeInputs.length; i++) {
        onChangeInputs[i].addEventListener("change", saveOptions);
    }
    for (let i = 0; i < onKeyupInputs.length; i++) {
        onKeyupInputs[i].addEventListener("keyup", saveOptions);
    }

    // Stepper button functionality
    const stepperButtons = document.querySelectorAll(".stepper-btn");
    stepperButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const inputId = button.dataset.input;
            const action = button.dataset.action;
            const input = document.getElementById(inputId);
            const currentValue = parseInt(input.value, 10) || 1;
            const min = parseInt(input.min, 10) || 1;
            const max = parseInt(input.max, 10) || 1337;

            let newValue;
            if (action === "increment") {
                newValue = Math.min(currentValue + 1, max);
            } else {
                newValue = Math.max(currentValue - 1, min);
            }

            input.value = newValue;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            updateTabCounts(); // Update tab counts when stepper buttons are clicked
        });
    });

    // Optional special message guard (kept from original, made safe)
    try {
        const showUntil = new Date("09-20-2020");
        const msgEl = document.querySelector(".message");
        if (msgEl && !localStorage.getItem("readMessage") && new Date() < showUntil) {
            msgEl.classList.remove("hidden");
            setTimeout(() => {
                localStorage.setItem("readMessage", "true");
            }, 2000);
        }
    } catch (e) {
        // no-op
    }

    // Listen for tab changes to update counts and domains
    if (browserRef.tabs && browserRef.tabs.onCreated) {
        browserRef.tabs.onCreated.addListener(() => updateTabCounts(true));
        browserRef.tabs.onRemoved.addListener(() => updateTabCounts(true));
        browserRef.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            // Only update if URL changed (affects domain counts)
            if (changeInfo.url) {
                updateTabCounts(true);
            }
        });
    }

    // Update tab counts periodically but less frequently (every 5 seconds)
    // This is a fallback in case events are missed
    setInterval(() => updateTabCounts(), 5000);
});
