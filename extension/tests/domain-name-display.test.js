// Test for domain name display functionality (Task 9)
// This test verifies the getCurrentDomain function and domain name display logic

// Mock chrome API for testing
const mockChrome = {
    tabs: {
        query: (params, callback) => {
            // Mock active tab data for testing
            const mockActiveTabs = [
                { url: "https://www.youtube.com/watch?v=123", id: 1, active: true },
            ];
            callback(mockActiveTabs);
        },
    },
};

// Set up global chrome for testing
if (typeof global !== "undefined") {
    global.chrome = mockChrome;
} else if (typeof window !== "undefined") {
    window.chrome = mockChrome;
}

// Mock browserRef for testing
const browserRef = mockChrome;

// Domain extraction function (from options.js)
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

// getCurrentDomain function (from options.js)
const getCurrentDomain = async () => {
    try {
        const [activeTab] = await new Promise((resolve) =>
            browserRef.tabs.query({ active: true, currentWindow: true }, resolve)
        );

        if (!activeTab) {
            return null;
        }

        return extractDomainFromUrl(activeTab.url);
    } catch (error) {
        console.error("Error getting current domain:", error);
        return null;
    }
};

// Domain name display formatting function (from options.js)
const formatDomainNameForDisplay = (domain) => {
    if (!domain) return "—";

    let displayName = domain;

    // Handle special domain cases with better display names
    if (domain === "system") {
        displayName = "System";
    } else if (domain === "localhost") {
        displayName = "Localhost";
    } else if (domain === "data") {
        displayName = "Data URL";
    } else if (domain === "file") {
        displayName = "Local File";
    } else if (domain === "unknown") {
        displayName = "Unknown";
    } else {
        // Truncate long domain names for better display
        displayName = domain.length > 25 ? domain.substring(0, 22) + "..." : domain;
    }

    return displayName;
};

// Test suite for domain name display functionality
const runDomainNameDisplayTests = async () => {
    console.log("Running domain name display tests (Task 9)...\n");

    let passed = 0;
    let failed = 0;

    // Test 1: getCurrentDomain function
    try {
        const currentDomain = await getCurrentDomain();

        if (currentDomain === "youtube.com") {
            console.log("✅ getCurrentDomain: Returns correct domain for active tab - PASSED");
            passed++;
        } else {
            console.log(
                `❌ getCurrentDomain: Expected 'youtube.com', got '${currentDomain}' - FAILED`
            );
            failed++;
        }
    } catch (error) {
        console.log(`❌ getCurrentDomain: Error - ${error.message} - FAILED`);
        failed++;
    }

    // Test 2: Domain name display formatting for regular domains
    const regularDomainTests = [
        { domain: "youtube.com", expected: "youtube.com" },
        { domain: "google.com", expected: "google.com" },
        { domain: "verylongdomainnamethatexceedslimit.com", expected: "verylongdomainnamethat..." },
        { domain: "short.co", expected: "short.co" },
    ];

    regularDomainTests.forEach((test, index) => {
        try {
            const result = formatDomainNameForDisplay(test.domain);
            if (result === test.expected) {
                console.log(
                    `✅ Regular domain formatting ${index + 1}: '${
                        test.domain
                    }' -> '${result}' - PASSED`
                );
                passed++;
            } else {
                console.log(
                    `❌ Regular domain formatting ${index + 1}: Expected '${
                        test.expected
                    }', got '${result}' - FAILED`
                );
                failed++;
            }
        } catch (error) {
            console.log(
                `❌ Regular domain formatting ${index + 1}: Error - ${error.message} - FAILED`
            );
            failed++;
        }
    });

    // Test 3: Domain name display formatting for special domains
    const specialDomainTests = [
        { domain: "system", expected: "System" },
        { domain: "localhost", expected: "Localhost" },
        { domain: "data", expected: "Data URL" },
        { domain: "file", expected: "Local File" },
        { domain: "unknown", expected: "Unknown" },
        { domain: null, expected: "—" },
        { domain: "", expected: "—" },
    ];

    specialDomainTests.forEach((test, index) => {
        try {
            const result = formatDomainNameForDisplay(test.domain);
            if (result === test.expected) {
                console.log(
                    `✅ Special domain formatting ${index + 1}: '${
                        test.domain
                    }' -> '${result}' - PASSED`
                );
                passed++;
            } else {
                console.log(
                    `❌ Special domain formatting ${index + 1}: Expected '${
                        test.expected
                    }', got '${result}' - FAILED`
                );
                failed++;
            }
        } catch (error) {
            console.log(
                `❌ Special domain formatting ${index + 1}: Error - ${error.message} - FAILED`
            );
            failed++;
        }
    });

    // Test 4: Edge cases for domain extraction and display
    const edgeCaseTests = [
        { url: "chrome://settings/", expectedDomain: "system", expectedDisplay: "System" },
        {
            url: "chrome-extension://abc123/popup.html",
            expectedDomain: "system",
            expectedDisplay: "System",
        },
        {
            url: "http://localhost:3000/app",
            expectedDomain: "localhost",
            expectedDisplay: "Localhost",
        },
        {
            url: "https://127.0.0.1:8080/api",
            expectedDomain: "localhost",
            expectedDisplay: "Localhost",
        },
        {
            url: "file:///Users/test/document.html",
            expectedDomain: "file",
            expectedDisplay: "Local File",
        },
        {
            url: "data:text/html,<h1>Test</h1>",
            expectedDomain: "data",
            expectedDisplay: "Data URL",
        },
        { url: "invalid-url", expectedDomain: "unknown", expectedDisplay: "Unknown" },
        { url: "", expectedDomain: "unknown", expectedDisplay: "Unknown" },
    ];

    edgeCaseTests.forEach((test, index) => {
        try {
            const domain = extractDomainFromUrl(test.url);
            const displayName = formatDomainNameForDisplay(domain);

            if (domain === test.expectedDomain && displayName === test.expectedDisplay) {
                console.log(
                    `✅ Edge case ${index + 1}: '${
                        test.url
                    }' -> '${domain}' -> '${displayName}' - PASSED`
                );
                passed++;
            } else {
                console.log(
                    `❌ Edge case ${index + 1}: Expected domain '${
                        test.expectedDomain
                    }' and display '${
                        test.expectedDisplay
                    }', got '${domain}' and '${displayName}' - FAILED`
                );
                failed++;
            }
        } catch (error) {
            console.log(`❌ Edge case ${index + 1}: Error - ${error.message} - FAILED`);
            failed++;
        }
    });

    // Test 5: Truncation behavior
    const truncationTests = [
        { domain: "a".repeat(20), shouldTruncate: false },
        { domain: "a".repeat(25), shouldTruncate: false },
        { domain: "a".repeat(26), shouldTruncate: true },
        { domain: "a".repeat(50), shouldTruncate: true },
    ];

    truncationTests.forEach((test, index) => {
        try {
            const result = formatDomainNameForDisplay(test.domain);
            const isTruncated = result.endsWith("...");

            if (isTruncated === test.shouldTruncate) {
                console.log(
                    `✅ Truncation test ${index + 1}: Domain length ${
                        test.domain.length
                    }, truncated: ${isTruncated} - PASSED`
                );
                passed++;
            } else {
                console.log(
                    `❌ Truncation test ${index + 1}: Expected truncation: ${
                        test.shouldTruncate
                    }, got: ${isTruncated} - FAILED`
                );
                failed++;
            }
        } catch (error) {
            console.log(`❌ Truncation test ${index + 1}: Error - ${error.message} - FAILED`);
            failed++;
        }
    });

    console.log(`\nDomain name display tests results: ${passed} passed, ${failed} failed`);
    return { passed, failed, total: passed + failed };
};

// Run the tests
runDomainNameDisplayTests().then((results) => {
    console.log("\n" + "=".repeat(50));
    console.log("DOMAIN NAME DISPLAY TEST RESULTS (TASK 9)");
    console.log("=".repeat(50));
    console.log(`Total Tests: ${results.total}`);
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);

    if (results.failed === 0) {
        console.log("\n🎉 All domain name display tests passed!");
        console.log("✅ Task 9 implementation is complete and working correctly!");
    } else {
        console.log("\n❌ Some tests failed. Please review the implementation.");
    }
});

// Export for use in different environments
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        getCurrentDomain,
        formatDomainNameForDisplay,
        extractDomainFromUrl,
        runDomainNameDisplayTests,
    };
}
