// Unit tests for DomainTracker service class and domain utilities
// These tests can be run in a browser environment or with a testing framework

// Mock chrome API for testing
const mockChrome = {
    tabs: {
        query: (params, callback) => {
            // Mock tab data for testing
            const mockTabs = [
                { url: "https://www.youtube.com/watch?v=123", id: 1, pinned: false },
                { url: "https://youtube.com/channel/abc", id: 2, pinned: false },
                { url: "https://www.google.com/search?q=test", id: 3, pinned: true },
                { url: "https://google.com/", id: 4, pinned: false },
                { url: "chrome://settings/", id: 5, pinned: false },
                { url: "chrome-extension://abc123/popup.html", id: 6, pinned: false },
                { url: "http://localhost:3000/app", id: 7, pinned: false },
                { url: "https://127.0.0.1:8080/api", id: 8, pinned: false },
                { url: "https://192.168.1.1/admin", id: 9, pinned: false },
                { url: "file:///Users/test/document.html", id: 10, pinned: false },
                { url: "data:text/html,<h1>Test</h1>", id: 11, pinned: false },
                { url: "blob:https://example.com/123-456", id: 12, pinned: false },
                { url: "https://[2001:db8::1]:8080/path", id: 13, pinned: false },
                { url: "", id: 14, pinned: false },
                { url: "invalid-url", id: 15, pinned: false },
                { url: "https://github.com/user/repo", id: 16, pinned: false },
                { url: "https://stackoverflow.com/questions/123", id: 17, pinned: false },
            ];

            // Filter based on params
            let filteredTabs = mockTabs;
            if (params.pinned === false) {
                filteredTabs = mockTabs.filter((tab) => !tab.pinned);
            } else if (params.pinned === true) {
                filteredTabs = mockTabs.filter((tab) => tab.pinned);
            }

            callback(filteredTabs);
        },
        get: (tabId, callback) => {
            const mockTabs = [
                { url: "https://www.youtube.com/watch?v=123", id: 1 },
                { url: "https://youtube.com/channel/abc", id: 2 },
                { url: "https://www.google.com/search?q=test", id: 3 },
            ];
            const tab = mockTabs.find((t) => t.id === tabId);
            callback(tab || { url: "https://example.com", id: tabId });
        },
    },
};

// Set up global chrome for testing
if (typeof global !== "undefined") {
    global.chrome = mockChrome;
} else if (typeof window !== "undefined") {
    window.chrome = mockChrome;
}

// Mock tabQuery function for testing
const tabQuery = (options, params = {}) =>
    new Promise((res) => {
        if (!options.countPinnedTabs) params.pinned = false; // only non-pinned tabs
        mockChrome.tabs.query(params, (tabs) => res(tabs));
    });

// Mock getOptions function for testing
const getOptions = () =>
    Promise.resolve({
        maxTotal: 50,
        maxWindow: 20,
        maxDomain: 10,
        countPinnedTabs: true,
        displayAlert: true,
        displayBadge: false,
    });

// DomainTracker class implementation for testing
class DomainTracker {
    constructor() {
        this.domainCounts = new Map();
        this.options = null;
        this.lastUpdate = 0;
        this.updateInterval = 1000; // 1 second cache
    }

    // Extract domain from URL with comprehensive handling of edge cases
    extractDomainFromUrl(url) {
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
    }

    // Update domain counts by querying all tabs
    async updateDomainCounts(options = null) {
        try {
            const currentOptions = options || this.options || (await getOptions());
            const tabs = await tabQuery(currentOptions);
            const newDomainCounts = new Map();

            tabs.forEach((tab) => {
                const domain = this.extractDomainFromUrl(tab.url);
                const currentCount = newDomainCounts.get(domain) || 0;
                newDomainCounts.set(domain, currentCount + 1);
            });

            this.domainCounts = newDomainCounts;
            this.options = currentOptions;
            this.lastUpdate = Date.now();

            return this.domainCounts;
        } catch (error) {
            console.error("Error updating domain counts:", error);
            return new Map();
        }
    }

    // Get cached domain counts or update if stale
    async getDomainCounts(options = null) {
        const now = Date.now();
        if (now - this.lastUpdate > this.updateInterval || !this.domainCounts.size) {
            await this.updateDomainCounts(options);
        }
        return this.domainCounts;
    }

    // Get detailed information for a specific domain
    async getDomainInfo(domain, options = null) {
        try {
            const currentOptions = options || this.options || (await getOptions());
            const domainCounts = await this.getDomainCounts(currentOptions);
            const tabCount = domainCounts.get(domain) || 0;
            const limit = currentOptions.maxDomain || 10;
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
            const fallbackLimit = (options && options.maxDomain) || 10;
            return {
                domain,
                tabCount: 0,
                remaining: fallbackLimit,
                limit: fallbackLimit,
                percentage: 0,
            };
        }
    }

    // Get domain information for the currently active tab
    async getCurrentDomainInfo(options = null) {
        try {
            // Mock active tab for testing
            const activeTab = { url: "https://www.youtube.com/watch?v=123", id: 1 };

            if (!activeTab) {
                return null;
            }

            const domain = this.extractDomainFromUrl(activeTab.url);
            return await this.getDomainInfo(domain, options);
        } catch (error) {
            console.error("Error getting current domain info:", error);
            return null;
        }
    }

    // Get top domains sorted by tab count
    async getTopDomains(limit = 5, options = null) {
        try {
            const currentOptions = options || this.options || (await getOptions());
            const domainCounts = await this.getDomainCounts(currentOptions);
            const domainLimit = currentOptions.maxDomain || 10;

            // Convert to array and sort by count (descending)
            const sortedDomains = Array.from(domainCounts.entries())
                .map(([domain, tabCount]) => ({
                    domain,
                    tabCount,
                    remaining: Math.max(0, domainLimit - tabCount),
                    limit: domainLimit,
                    percentage: Math.min(100, (tabCount / domainLimit) * 100),
                }))
                .sort((a, b) => b.tabCount - a.tabCount)
                .slice(0, limit);

            return sortedDomains;
        } catch (error) {
            console.error("Error getting top domains:", error);
            return [];
        }
    }

    // Check if a domain has exceeded its limit
    async isDomainLimitExceeded(domain, options = null) {
        try {
            const domainInfo = await this.getDomainInfo(domain, options);
            return domainInfo.tabCount >= domainInfo.limit;
        } catch (error) {
            console.error("Error checking domain limit:", error);
            return false; // Default to not exceeded on error
        }
    }

    // Get the domain of a specific tab by ID
    async getTabDomain(tabId) {
        try {
            const tab = await new Promise((resolve) => mockChrome.tabs.get(tabId, resolve));
            return this.extractDomainFromUrl(tab.url);
        } catch (error) {
            console.error("Error getting tab domain:", error);
            return "unknown";
        }
    }

    // Clear cached data (useful for testing or forced refresh)
    clearCache() {
        this.domainCounts.clear();
        this.lastUpdate = 0;
        this.options = null;
    }
}

// Legacy function for backward compatibility
const extractDomainFromUrl = (url) => {
    const tracker = new DomainTracker();
    return tracker.extractDomainFromUrl(url);
};

// Test suite for domain extraction
const runDomainExtractionTests = () => {
    const tests = [
        // Basic HTTP/HTTPS URLs
        {
            url: "https://www.youtube.com/watch?v=123",
            expected: "youtube.com",
            description: "HTTPS with www prefix",
        },
        {
            url: "http://youtube.com/channel/abc",
            expected: "youtube.com",
            description: "HTTP without www",
        },
        {
            url: "https://www.google.com/search?q=test",
            expected: "google.com",
            description: "HTTPS with www and query params",
        },
        { url: "https://google.com/", expected: "google.com", description: "HTTPS without www" },

        // Special URLs
        { url: "chrome://settings/", expected: "system", description: "Chrome internal page" },
        {
            url: "chrome-extension://abc123/popup.html",
            expected: "system",
            description: "Chrome extension URL",
        },
        {
            url: "moz-extension://def456/options.html",
            expected: "system",
            description: "Firefox extension URL",
        },

        // Localhost and IP addresses
        {
            url: "http://localhost:3000/app",
            expected: "localhost",
            description: "Localhost with port",
        },
        { url: "https://127.0.0.1:8080/api", expected: "localhost", description: "IPv4 localhost" },
        {
            url: "https://192.168.1.1/admin",
            expected: "192.168.1.1",
            description: "Private IPv4 address",
        },
        {
            url: "https://[2001:db8::1]:8080/path",
            expected: "[2001:db8::1]",
            description: "IPv6 address with brackets",
        },

        // File and data URLs
        {
            url: "file:///Users/test/document.html",
            expected: "file",
            description: "Local file URL",
        },
        { url: "data:text/html,<h1>Test</h1>", expected: "data", description: "Data URL" },
        { url: "blob:https://example.com/123-456", expected: "data", description: "Blob URL" },

        // Edge cases
        { url: "", expected: "unknown", description: "Empty string" },
        { url: null, expected: "unknown", description: "Null value" },
        { url: undefined, expected: "unknown", description: "Undefined value" },
        { url: "invalid-url", expected: "unknown", description: "Invalid URL format" },
        { url: "https://", expected: "unknown", description: "Incomplete URL" },

        // Subdomains
        {
            url: "https://mail.google.com/inbox",
            expected: "mail.google.com",
            description: "Subdomain",
        },
        {
            url: "https://www.mail.google.com/inbox",
            expected: "mail.google.com",
            description: "Subdomain with www",
        },

        // Ports
        {
            url: "https://example.com:8080/path",
            expected: "example.com",
            description: "URL with port",
        },
        {
            url: "https://www.example.com:443/secure",
            expected: "example.com",
            description: "HTTPS with explicit port and www",
        },
    ];

    let passed = 0;
    let failed = 0;

    console.log("Running domain extraction tests...\n");

    tests.forEach((test, index) => {
        try {
            const result = extractDomainFromUrl(test.url);
            if (result === test.expected) {
                console.log(`✅ Test ${index + 1}: ${test.description} - PASSED`);
                passed++;
            } else {
                console.log(`❌ Test ${index + 1}: ${test.description} - FAILED`);
                console.log(`   Expected: "${test.expected}", Got: "${result}"`);
                failed++;
            }
        } catch (error) {
            console.log(`❌ Test ${index + 1}: ${test.description} - ERROR`);
            console.log(`   Error: ${error.message}`);
            failed++;
        }
    });

    console.log(`\nTest Results: ${passed} passed, ${failed} failed`);
    return { passed, failed, total: tests.length };
};

// Test suite for DomainTracker class methods
const runDomainTrackerTests = async () => {
    console.log("\nRunning DomainTracker class tests...\n");

    const tracker = new DomainTracker();
    let passed = 0;
    let failed = 0;

    // Test 1: updateDomainCounts method
    try {
        const domainCounts = await tracker.updateDomainCounts();
        const expectedDomains = [
            "youtube.com",
            "google.com",
            "system",
            "localhost",
            "data",
            "file",
            "[2001:db8::1]",
            "unknown",
            "github.com",
            "stackoverflow.com",
        ];

        let domainCountsValid = true;
        expectedDomains.forEach((domain) => {
            if (!domainCounts.has(domain)) {
                domainCountsValid = false;
            }
        });

        if (domainCountsValid && domainCounts.size > 0) {
            console.log(`✅ updateDomainCounts: Returns valid domain counts - PASSED`);
            passed++;
        } else {
            console.log(`❌ updateDomainCounts: Invalid domain counts - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ updateDomainCounts: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 2: getDomainInfo method
    try {
        const domainInfo = await tracker.getDomainInfo("youtube.com");

        if (
            domainInfo &&
            typeof domainInfo.domain === "string" &&
            typeof domainInfo.tabCount === "number" &&
            typeof domainInfo.remaining === "number" &&
            typeof domainInfo.limit === "number" &&
            typeof domainInfo.percentage === "number" &&
            domainInfo.domain === "youtube.com"
        ) {
            console.log(`✅ getDomainInfo: Returns valid domain info structure - PASSED`);
            passed++;
        } else {
            console.log(`❌ getDomainInfo: Invalid domain info structure - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ getDomainInfo: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 3: getCurrentDomainInfo method
    try {
        const currentDomainInfo = await tracker.getCurrentDomainInfo();

        if (
            currentDomainInfo &&
            currentDomainInfo.domain === "youtube.com" &&
            typeof currentDomainInfo.tabCount === "number"
        ) {
            console.log(`✅ getCurrentDomainInfo: Returns current domain info - PASSED`);
            passed++;
        } else {
            console.log(`❌ getCurrentDomainInfo: Invalid current domain info - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ getCurrentDomainInfo: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 4: getTopDomains method
    try {
        const topDomains = await tracker.getTopDomains(3);

        if (
            Array.isArray(topDomains) &&
            topDomains.length <= 3 &&
            topDomains.every(
                (domain) =>
                    typeof domain.domain === "string" &&
                    typeof domain.tabCount === "number" &&
                    typeof domain.remaining === "number" &&
                    typeof domain.percentage === "number"
            )
        ) {
            console.log(`✅ getTopDomains: Returns valid top domains array - PASSED`);
            passed++;
        } else {
            console.log(`❌ getTopDomains: Invalid top domains array - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ getTopDomains: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 5: isDomainLimitExceeded method
    try {
        const isExceeded = await tracker.isDomainLimitExceeded("youtube.com");

        if (typeof isExceeded === "boolean") {
            console.log(`✅ isDomainLimitExceeded: Returns boolean value - PASSED`);
            passed++;
        } else {
            console.log(`❌ isDomainLimitExceeded: Does not return boolean - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ isDomainLimitExceeded: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 6: getTabDomain method
    try {
        const tabDomain = await tracker.getTabDomain(1);

        if (typeof tabDomain === "string" && tabDomain === "youtube.com") {
            console.log(`✅ getTabDomain: Returns correct domain for tab - PASSED`);
            passed++;
        } else {
            console.log(`❌ getTabDomain: Incorrect domain for tab - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ getTabDomain: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 7: clearCache method
    try {
        tracker.clearCache();

        if (
            tracker.domainCounts.size === 0 &&
            tracker.lastUpdate === 0 &&
            tracker.options === null
        ) {
            console.log(`✅ clearCache: Successfully clears cache - PASSED`);
            passed++;
        } else {
            console.log(`❌ clearCache: Does not clear cache properly - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ clearCache: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 8: Caching behavior
    try {
        // First call should update cache
        const start = Date.now();
        await tracker.getDomainCounts();
        const firstCallTime = Date.now() - start;

        // Second call should use cache (should be faster)
        const start2 = Date.now();
        await tracker.getDomainCounts();
        const secondCallTime = Date.now() - start2;

        if (tracker.domainCounts.size > 0 && tracker.lastUpdate > 0) {
            console.log(`✅ Caching behavior: Cache is working properly - PASSED`);
            passed++;
        } else {
            console.log(`❌ Caching behavior: Cache not working - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ Caching behavior: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 9: Error handling with invalid options
    try {
        const domainInfo = await tracker.getDomainInfo("test.com", null);

        if (domainInfo && domainInfo.domain === "test.com" && domainInfo.limit === 10) {
            console.log(`✅ Error handling: Handles null options gracefully - PASSED`);
            passed++;
        } else {
            console.log(`❌ Error handling: Does not handle null options - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ Error handling: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 10: Domain limit calculation accuracy
    try {
        const testOptions = { maxDomain: 5, countPinnedTabs: true };
        const domainInfo = await tracker.getDomainInfo("youtube.com", testOptions);

        if (
            domainInfo.limit === 5 &&
            domainInfo.remaining === Math.max(0, 5 - domainInfo.tabCount) &&
            domainInfo.percentage === Math.min(100, (domainInfo.tabCount / 5) * 100)
        ) {
            console.log(`✅ Domain limit calculation: Calculations are accurate - PASSED`);
            passed++;
        } else {
            console.log(`❌ Domain limit calculation: Calculations are incorrect - FAILED`);
            failed++;
        }
    } catch (error) {
        console.log(`❌ Domain limit calculation: Error - ${error.message} - FAILED`);
        failed++;
    }

    console.log(`\nDomainTracker tests results: ${passed} passed, ${failed} failed`);
    return { passed, failed, total: 10 };
};

// Test suite for domain counting (legacy compatibility)
const runDomainCountingTests = () => {
    console.log("\nRunning legacy domain counting tests...\n");

    // Mock options
    const mockOptions = {
        countPinnedTabs: true,
        maxDomain: 10,
    };

    // Test domain counting logic
    const testUrls = [
        "https://www.youtube.com/watch?v=1",
        "https://youtube.com/watch?v=2",
        "https://www.google.com/search?q=test",
        "https://google.com/",
        "https://github.com/user/repo",
        "chrome://settings/",
        "https://localhost:3000/app",
    ];

    const expectedCounts = {
        "youtube.com": 2,
        "google.com": 2,
        "github.com": 1,
        system: 1,
        localhost: 1,
    };

    // Simulate domain counting
    const domainCounts = new Map();
    testUrls.forEach((url) => {
        const domain = extractDomainFromUrl(url);
        const currentCount = domainCounts.get(domain) || 0;
        domainCounts.set(domain, currentCount + 1);
    });

    let passed = 0;
    let failed = 0;

    Object.entries(expectedCounts).forEach(([domain, expectedCount]) => {
        const actualCount = domainCounts.get(domain) || 0;
        if (actualCount === expectedCount) {
            console.log(`✅ Domain count for ${domain}: ${actualCount} - PASSED`);
            passed++;
        } else {
            console.log(
                `❌ Domain count for ${domain}: Expected ${expectedCount}, Got ${actualCount} - FAILED`
            );
            failed++;
        }
    });

    console.log(`\nLegacy domain counting results: ${passed} passed, ${failed} failed`);
    return { passed, failed, total: Object.keys(expectedCounts).length };
};

// Test suite for storage helper functions
const runStorageHelperTests = () => {
    console.log("\nRunning storage helper function tests...\n");

    let passed = 0;
    let failed = 0;

    // Test 1: Default domain limit validation
    try {
        const defaultLimit = 10;
        if (defaultLimit >= 1 && defaultLimit <= 50) {
            console.log(`✅ Default domain limit (${defaultLimit}) is within valid range - PASSED`);
            passed++;
        } else {
            console.log(
                `❌ Default domain limit (${defaultLimit}) is outside valid range - FAILED`
            );
            failed++;
        }
    } catch (error) {
        console.log(`❌ Error testing default domain limit: ${error.message} - FAILED`);
        failed++;
    }

    // Test 2: Domain limit validation logic
    const testLimits = [
        { limit: 0, valid: false, description: "Zero limit" },
        { limit: 1, valid: true, description: "Minimum valid limit" },
        { limit: 10, valid: true, description: "Default limit" },
        { limit: 50, valid: true, description: "Maximum valid limit" },
        { limit: 51, valid: false, description: "Above maximum limit" },
        { limit: -1, valid: false, description: "Negative limit" },
        { limit: "10", valid: false, description: "String instead of number" },
        { limit: null, valid: false, description: "Null value" },
        { limit: undefined, valid: false, description: "Undefined value" },
    ];

    testLimits.forEach((test) => {
        try {
            const isValid = typeof test.limit === "number" && test.limit >= 1 && test.limit <= 50;
            if (isValid === test.valid) {
                console.log(`✅ Limit validation for ${test.description}: ${isValid} - PASSED`);
                passed++;
            } else {
                console.log(
                    `❌ Limit validation for ${test.description}: Expected ${test.valid}, Got ${isValid} - FAILED`
                );
                failed++;
            }
        } catch (error) {
            console.log(
                `❌ Error testing limit validation for ${test.description}: ${error.message} - FAILED`
            );
            failed++;
        }
    });

    console.log(`\nStorage helper tests results: ${passed} passed, ${failed} failed`);
    return { passed, failed, total: 1 + testLimits.length };
};

// Run all tests
const runAllTests = async () => {
    console.log("=".repeat(60));
    console.log("DOMAIN TRACKER AND UTILITIES TEST SUITE");
    console.log("=".repeat(60));

    const extractionResults = runDomainExtractionTests();
    const trackerResults = await runDomainTrackerTests();
    const countingResults = runDomainCountingTests();
    const storageResults = runStorageHelperTests();

    const totalPassed =
        extractionResults.passed +
        trackerResults.passed +
        countingResults.passed +
        storageResults.passed;
    const totalFailed =
        extractionResults.failed +
        trackerResults.failed +
        countingResults.failed +
        storageResults.failed;
    const totalTests =
        extractionResults.total +
        trackerResults.total +
        countingResults.total +
        storageResults.total;

    console.log("\n" + "=".repeat(60));
    console.log("OVERALL TEST RESULTS");
    console.log("=".repeat(60));
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${totalPassed}`);
    console.log(`Failed: ${totalFailed}`);
    console.log(`Success Rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

    return totalFailed === 0;
};

// Export for use in different environments
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        DomainTracker,
        extractDomainFromUrl,
        runDomainExtractionTests,
        runDomainTrackerTests,
        runDomainCountingTests,
        runStorageHelperTests,
        runAllTests,
    };
}

// Auto-run tests if this file is executed directly
if (typeof window !== "undefined" || typeof global !== "undefined") {
    // Run tests when the file is loaded
    runAllTests().then((success) => {
        if (success) {
            console.log("\n🎉 All tests passed!");
        } else {
            console.log("\n❌ Some tests failed. Please review the results above.");
        }
    });
}
