/* global chrome, browser */

// Cross-browser API alias (does not throw if `browser` is undefined)
const browserApi =
    typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
const browserRef = browserApi; // Keep old variable name compatibility

// Helper function to get options from storage
const getOptionsFromStorage = () => {
    return new Promise((resolve) => {
        browserRef.storage.sync.get(
            [
                "maxTotal",
                "maxWindow",
                "maxDomain",
                "exceedTabNewWindow",
                "displayAlert",
                "countPinnedTabs",
                "displayBadge",
                "alertMessage",
            ],
            (options) => {
                resolve(options);
            }
        );
    });
};

// ---------------------------------------------------------------------------
// Helpers used also by background script (kept here unchanged in spirit)

const tabQuery = (options, params = {}) =>
    new Promise((res) => {
        if (!options.countPinnedTabs) params.pinned = false; // only non-pinned tabs
        browserRef.tabs.query(params, (tabs) => res(tabs));
    });

// Domain extraction and tracking utilities (shared with background script)
const extractDomainFromUrl = (url) => {
    try {
        // Handle special cases first
        if (!url || typeof url !== "string") {
            return "unknown";
        }

        // Handle chrome:// and extension URLs
        if (
            url.startsWith("chrome://") ||
            url.startsWith("chrome-extension://") ||
            url.startsWith("moz-extension://")
        ) {
            return "system";
        }

        // Handle data: and blob: URLs
        if (url.startsWith("data:") || url.startsWith("blob:")) {
            return "data";
        }

        // Handle file:// URLs
        if (url.startsWith("file://")) {
            return "file";
        }

        // Handle localhost without protocol
        if (url.startsWith("localhost")) {
            return "localhost";
        }

        // Parse the URL
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;

        // Handle localhost and IP addresses
        if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
            return "localhost";
        }

        // Check if it's an IP address (IPv4)
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (ipv4Regex.test(hostname)) {
            return hostname; // Return IP as-is
        }

        // Check if it's an IPv6 address (enclosed in brackets)
        if (hostname.startsWith("[") && hostname.endsWith("]")) {
            return hostname; // Return IPv6 as-is
        }

        // Remove www. prefix if present
        if (hostname.startsWith("www.")) {
            hostname = hostname.substring(4);
        }

        // Return the cleaned hostname
        return hostname || "unknown";
    } catch (error) {
        console.warn("Error extracting domain from URL:", url, error);
        return "unknown";
    }
};

const getDomainCounts = async (options) => {
    try {
        // Use background script for tab queries to avoid permission issues
        const domainCountsArray = await new Promise((resolve) => {
            browserRef.runtime.sendMessage({ action: "getDomainCounts", options }, (response) => {
                resolve(response);
            });
        });

        // Convert array back to Map
        return new Map(domainCountsArray);
    } catch (error) {
        console.error("Error getting domain counts:", error);
        return new Map();
    }
};

const getDomainInfo = async (domain, options) => {
    try {
        const domainCounts = await getDomainCounts(options);
        const tabCount = domainCounts.get(domain) || 0;
        const limit = options.maxDomain || 10;
        const remaining = Math.max(0, limit - tabCount);
        const percentage = Math.min(100, (tabCount / limit) * 100);

        return {
            domain,
            tabCount,
            remaining,
            limit,
            percentage,
        };
    } catch (error) {
        console.error("Error getting domain info:", error);
        return {
            domain,
            tabCount: 0,
            remaining: options.maxDomain || 10,
            limit: options.maxDomain || 10,
            percentage: 0,
        };
    }
};

// Populate and update the domain list display
const updateDomainList = async (options) => {
    try {
        const domainListContent = document.getElementById("domainListContent");
        if (!domainListContent) return;

        // Get all domains with their tab counts
        const domains = await getTopDomains(options, 10); // Show up to 10 domains

        // Clear existing content
        domainListContent.innerHTML = "";

        if (domains.length === 0) {
            domainListContent.innerHTML = '<div class="domain-list-empty">No open domains</div>';
            return;
        }

        // Create domain items
        domains.forEach((domainInfo) => {
            const domainItem = document.createElement("div");
            domainItem.className = "domain-item";

            // Format domain name for display
            let displayName = domainInfo.domain;
            if (domainInfo.domain === "system") {
                displayName = "System";
            } else if (domainInfo.domain === "localhost") {
                displayName = "Localhost";
            } else if (domainInfo.domain === "data") {
                displayName = "Data URL";
            } else if (domainInfo.domain === "file") {
                displayName = "Local File";
            } else if (domainInfo.domain === "unknown") {
                displayName = "Unknown";
            } else {
                // Truncate long domain names
                displayName =
                    domainInfo.domain.length > 20
                        ? domainInfo.domain.substring(0, 17) + "..."
                        : domainInfo.domain;
            }

            domainItem.innerHTML = `
                <div class="domain-item-header">
                    <span class="domain-name" title="${domainInfo.domain}">${displayName}</span>
                    <span class="domain-counts">${domainInfo.tabCount} / ${domainInfo.limit}</span>
                </div>
                <div class="domain-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${domainInfo.percentage}%"></div>
                    </div>
                </div>
            `;

            // Apply color coding to progress bar
            const progressFill = domainItem.querySelector(".progress-fill");
            updateProgressBarColor(progressFill, domainInfo.percentage);

            domainListContent.appendChild(domainItem);
        });
    } catch (error) {
        console.error("Error updating domain list:", error);
    }
};

const getTopDomains = async (options, limit = 5) => {
    try {
        const domainCounts = await getDomainCounts(options);

        // Convert to array and sort by count (descending)
        const sortedDomains = Array.from(domainCounts.entries())
            .map(([domain, tabCount]) => ({
                domain,
                tabCount,
                remaining: Math.max(0, (options.maxDomain || 10) - tabCount),
                limit: options.maxDomain || 10,
                percentage: Math.min(100, (tabCount / (options.maxDomain || 10)) * 100),
            }))
            .sort((a, b) => b.tabCount - a.tabCount)
            .slice(0, limit);

        return sortedDomains;
    } catch (error) {
        console.error("Error getting top domains:", error);
        return [];
    }
};

const windowRemaining = (options) =>
    tabQuery(options, { currentWindow: true }).then((tabs) => options.maxWindow - tabs.length);

const totalRemaining = (options) =>
    tabQuery(options).then((tabs) => options.maxTotal - tabs.length);

// Badge updates are handled by the background script
const updateBadge = (options) => {
    // Send message to background script to update badge
    browserRef.runtime.sendMessage({ action: "updateBadge", options });
};

// Domain limit storage helper functions
const getDomainLimit = async (domain = null) => {
    try {
        const options = await getOptionsFromStorage();
        // For now, return the global domain limit
        // Future enhancement: support per-domain limits from options.domainLimits[domain]
        return options.maxDomain || 10;
    } catch (error) {
        console.error("Error getting domain limit:", error);
        return 10; // Default fallback
    }
};

const setDomainLimit = async (limit) => {
    try {
        if (typeof limit !== "number" || limit < 1 || limit > 50) {
            throw new Error("Domain limit must be a number between 1 and 50");
        }

        await new Promise((resolve, reject) => {
            browserRef.storage.sync.set({ maxDomain: limit }, () => {
                if (browserRef.runtime.lastError) {
                    reject(browserRef.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });

        // Update badge and tab counts after changing domain limit
        const options = await getOptionsFromStorage();
        updateBadge(options);
        updateTabCounts();
        await updateDomainList(options);
    } catch (error) {
        console.error("Error setting domain limit:", error);
        throw error;
    }
};

const isDomainLimitExceeded = async (domain) => {
    try {
        const options = await getOptionsFromStorage();
        const domainInfo = await getDomainInfo(domain, options);
        return domainInfo.tabCount >= domainInfo.limit;
    } catch (error) {
        console.error("Error checking domain limit:", error);
        return false; // Default to not exceeded on error
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
const updateTabCounts = async () => {
    try {
        // Get current options
        const options = await getOptionsFromStorage();

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

        // Update domain list
        await updateDomainList(options);
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
        updateTabCounts(); // Update tab counts when options are saved
    });
};

// Restore options from storage
const restoreOptions = () => {
    // Ensure inputs are present
    if (!$inputs) {
        $inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');
    }

    browserRef.storage.sync.get(
        [
            "maxTotal",
            "maxWindow",
            "maxDomain",
            "exceedTabNewWindow",
            "displayAlert",
            "countPinnedTabs",
            "displayBadge",
            "alertMessage",
        ],
        (options) => {
            for (let i = 0; i < $inputs.length; i++) {
                const input = $inputs[i];
                const valueType = input.type === "checkbox" ? "checked" : "value";
                input[valueType] = options[input.id];
            }
        }
    );
};

document.addEventListener("DOMContentLoaded", () => {
    // Cache inputs first, then restore their values
    $inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');
    restoreOptions();
    updateTabCounts(); // Update tab counts on page load
    loadViewPreference(); // Load saved view preference

    // Settings toggle functionality
    const settingsToggle = document.getElementById("settingsToggle");
    if (settingsToggle) {
        settingsToggle.addEventListener("click", toggleView);
    }

    // Listen for tab changes to update domain list
    if (browserRef.tabs && browserRef.tabs.onCreated) {
        browserRef.tabs.onCreated.addListener(async () => {
            setTimeout(async () => {
                try {
                    const options = await getOptionsFromStorage();
                    await updateDomainList(options);
                } catch (error) {
                    console.error("Error updating domain list on tab creation:", error);
                }
            }, 100);
        });
    }

    if (browserRef.tabs && browserRef.tabs.onRemoved) {
        browserRef.tabs.onRemoved.addListener(async () => {
            setTimeout(async () => {
                try {
                    const options = await getOptionsFromStorage();
                    await updateDomainList(options);
                } catch (error) {
                    console.error("Error updating domain list on tab removal:", error);
                }
            }, 100);
        });
    }

    if (browserRef.tabs && browserRef.tabs.onUpdated) {
        browserRef.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
            // Only update if the URL changed (domain might have changed)
            if (changeInfo.url) {
                setTimeout(async () => {
                    try {
                        const options = await getOptionsFromStorage();
                        await updateDomainList(options);
                    } catch (error) {
                        console.error("Error updating domain list on tab update:", error);
                    }
                }, 100);
            }
        });
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

    // Add specific validation for domain limit input
    const domainInput = document.getElementById("maxDomain");
    if (domainInput) {
        domainInput.addEventListener("input", (event) => {
            const value = parseInt(event.target.value, 10);
            if (isNaN(value) || value < 1) {
                event.target.value = 1;
            } else if (value > 50) {
                event.target.value = 50;
            }
        });

        domainInput.addEventListener("blur", (event) => {
            const value = parseInt(event.target.value, 10);
            if (isNaN(value) || value < 1) {
                event.target.value = 1;
                event.target.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (value > 50) {
                event.target.value = 50;
                event.target.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
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

            // Additional validation for domain limit
            if (inputId === "maxDomain") {
                newValue = Math.max(1, Math.min(50, newValue));
            }

            input.value = newValue;
            input.dispatchEvent(new Event("change", { bubbles: true }));

            // Update tab counts when stepper buttons are clicked
            updateTabCounts();

            // If this is the domain stepper, also update domain list immediately
            if (inputId === "maxDomain") {
                setTimeout(async () => {
                    try {
                        const options = await getOptionsFromStorage();
                        await updateDomainList(options);
                    } catch (error) {
                        console.error("Error updating domain list after stepper change:", error);
                    }
                }, 100); // Small delay to ensure storage is updated
            }
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

    // Update tab counts periodically to keep them current
    setInterval(updateTabCounts, 1000);
});
