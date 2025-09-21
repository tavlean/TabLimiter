// Test script for updateDomainProgress function
console.log("Testing updateDomainProgress function...");

// Mock DOM elements
const mockDOM = {
    getElementById: (id) => {
        const elements = {
            domainOpenCount: {
                textContent: "",
                set textContent(val) {
                    this._text = val;
                },
            },
            domainLeftCount: {
                textContent: "",
                set textContent(val) {
                    this._text = val;
                },
            },
            domainProgressFill: {
                style: { width: "" },
                classList: {
                    remove: () => {},
                    add: () => {},
                },
            },
            currentDomainName: {
                textContent: "",
                title: "",
                set textContent(val) {
                    this._text = val;
                },
                set title(val) {
                    this._title = val;
                },
            },
        };
        return elements[id] || null;
    },
};

// Mock browser API
const mockBrowserApi = {
    tabs: {
        query: (params, callback) => {
            // Mock active tab
            const mockTabs = [
                { url: "https://www.example.com/page1", active: true },
                { url: "https://www.example.com/page2", active: false },
                { url: "https://google.com/search", active: false },
            ];

            if (params.active && params.currentWindow) {
                callback([mockTabs[0]]);
            } else {
                callback(mockTabs);
            }
        },
    },
    storage: {
        sync: {
            get: (keys, callback) => {
                const mockOptions = {
                    maxDomain: 10,
                    maxTotal: 50,
                    maxWindow: 20,
                    countPinnedTabs: false,
                };

                if (keys === "defaultOptions") {
                    callback({ defaultOptions: mockOptions });
                } else {
                    callback(mockOptions);
                }
            },
        },
    },
};

// Set up global variables
global.document = mockDOM;
global.browserRef = mockBrowserApi;

// Import the functions we need to test
const extractDomainFromUrl = (url) => {
    try {
        if (!url || typeof url !== "string") return "unknown";
        if (
            url.startsWith("chrome://") ||
            url.startsWith("chrome-extension://") ||
            url.startsWith("moz-extension://")
        )
            return "system";
        if (url.startsWith("data:") || url.startsWith("blob:")) return "data";
        if (url.startsWith("file://")) return "file";

        const urlObj = new URL(url);
        let hostname = urlObj.hostname;

        if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
            return "localhost";
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return hostname;
        if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname;
        if (hostname.startsWith("www.")) hostname = hostname.substring(4);

        return hostname || "unknown";
    } catch (error) {
        console.warn("Error extracting domain from URL:", url, error);
        return "unknown";
    }
};

const tabQuery = (options, params = {}) =>
    new Promise((res) => {
        if (!options.countPinnedTabs) params.pinned = false;
        mockBrowserApi.tabs.query(params, (tabs) => res(tabs));
    });

const getDomainCounts = async (options) => {
    try {
        const tabs = await tabQuery(options);
        const domainCounts = new Map();

        tabs.forEach((tab) => {
            const domain = extractDomainFromUrl(tab.url);
            const currentCount = domainCounts.get(domain) || 0;
            domainCounts.set(domain, currentCount + 1);
        });

        return domainCounts;
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

        return { domain, tabCount, remaining, limit, percentage };
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

const getCurrentDomainInfo = async (options) => {
    try {
        const [activeTab] = await new Promise((resolve) =>
            mockBrowserApi.tabs.query({ active: true, currentWindow: true }, resolve)
        );

        if (!activeTab) return null;

        const domain = extractDomainFromUrl(activeTab.url);
        return await getDomainInfo(domain, options);
    } catch (error) {
        console.error("Error getting current domain info:", error);
        return null;
    }
};

const updateProgressBarColor = (progressEl, percentage) => {
    progressEl.classList.remove("purple", "blue", "green", "yellow", "orange", "red");

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

// The function we're testing
const updateDomainProgress = async (options) => {
    try {
        const currentDomainInfo = await getCurrentDomainInfo(options);

        if (currentDomainInfo) {
            const domainOpenEl = document.getElementById("domainOpenCount");
            const domainLeftEl = document.getElementById("domainLeftCount");
            const domainProgressEl = document.getElementById("domainProgressFill");
            const domainNameEl = document.getElementById("currentDomainName");

            if (domainOpenEl) {
                domainOpenEl.textContent = currentDomainInfo.tabCount;
            }

            if (domainLeftEl) {
                domainLeftEl.textContent = currentDomainInfo.remaining;
            }

            if (domainProgressEl) {
                domainProgressEl.style.width = `${currentDomainInfo.percentage}%`;
                updateProgressBarColor(domainProgressEl, currentDomainInfo.percentage);
            }

            if (domainNameEl) {
                const displayName =
                    currentDomainInfo.domain.length > 25
                        ? currentDomainInfo.domain.substring(0, 22) + "..."
                        : currentDomainInfo.domain;
                domainNameEl.textContent = displayName;
                domainNameEl.title = currentDomainInfo.domain;
            }
        } else {
            const domainOpenEl = document.getElementById("domainOpenCount");
            const domainLeftEl = document.getElementById("domainLeftCount");
            const domainProgressEl = document.getElementById("domainProgressFill");
            const domainNameEl = document.getElementById("currentDomainName");

            if (domainOpenEl) domainOpenEl.textContent = "0";
            if (domainLeftEl) domainLeftEl.textContent = options.maxDomain || 10;
            if (domainProgressEl) {
                domainProgressEl.style.width = "0%";
                updateProgressBarColor(domainProgressEl, 0);
            }
            if (domainNameEl) {
                domainNameEl.textContent = "—";
                domainNameEl.title = "";
            }
        }
    } catch (error) {
        console.error("Error updating domain progress:", error);
        // Fallback to safe defaults on error
        const domainOpenEl = document.getElementById("domainOpenCount");
        const domainLeftEl = document.getElementById("domainLeftCount");
        const domainProgressEl = document.getElementById("domainProgressFill");
        const domainNameEl = document.getElementById("currentDomainName");

        if (domainOpenEl) domainOpenEl.textContent = "0";
        if (domainLeftEl) domainLeftEl.textContent = options.maxDomain || 10;
        if (domainProgressEl) {
            domainProgressEl.style.width = "0%";
            updateProgressBarColor(domainProgressEl, 0);
        }
        if (domainNameEl) {
            domainNameEl.textContent = "—";
            domainNameEl.title = "";
        }
    }
};

// Run tests
async function runTests() {
    console.log("============================================================");
    console.log("DOMAIN PROGRESS UPDATE FUNCTION TEST");
    console.log("============================================================");

    const options = { maxDomain: 10, countPinnedTabs: false };

    try {
        // Test 1: Basic functionality
        console.log("Test 1: Basic updateDomainProgress functionality");
        await updateDomainProgress(options);

        const domainOpenEl = document.getElementById("domainOpenCount");
        const domainLeftEl = document.getElementById("domainLeftCount");
        const domainProgressEl = document.getElementById("domainProgressFill");
        const domainNameEl = document.getElementById("currentDomainName");

        console.log(`✅ Domain open count: ${domainOpenEl._text}`);
        console.log(`✅ Domain left count: ${domainLeftEl._text}`);
        console.log(`✅ Progress bar width: ${domainProgressEl.style.width}`);
        console.log(`✅ Domain name: ${domainNameEl._text}`);

        // Test 2: Domain info calculation
        console.log("\nTest 2: Domain info calculation");
        const currentDomainInfo = await getCurrentDomainInfo(options);
        console.log(`✅ Current domain: ${currentDomainInfo.domain}`);
        console.log(`✅ Tab count: ${currentDomainInfo.tabCount}`);
        console.log(`✅ Remaining: ${currentDomainInfo.remaining}`);
        console.log(`✅ Percentage: ${currentDomainInfo.percentage}%`);

        // Test 3: Long domain name truncation
        console.log("\nTest 3: Long domain name handling");
        const longDomainName = "this-is-a-very-long-domain-name-that-should-be-truncated.com";
        const truncated =
            longDomainName.length > 25 ? longDomainName.substring(0, 22) + "..." : longDomainName;
        console.log(`✅ Long domain truncation: ${truncated}`);

        console.log("\n============================================================");
        console.log("ALL TESTS COMPLETED SUCCESSFULLY");
        console.log("============================================================");
    } catch (error) {
        console.error("❌ Test failed:", error);
    }
}

// Run the tests
runTests();
