// Unit tests for domain extraction and tracking utilities
// These tests can be run in a browser environment or with a testing framework

// Mock chrome API for testing
const mockChrome = {
    tabs: {
        query: (params, callback) => {
            // Mock tab data for testing
            const mockTabs = [
                { url: "https://www.youtube.com/watch?v=123", id: 1 },
                { url: "https://youtube.com/channel/abc", id: 2 },
                { url: "https://www.google.com/search?q=test", id: 3 },
                { url: "https://google.com/", id: 4 },
                { url: "chrome://settings/", id: 5 },
                { url: "chrome-extension://abc123/popup.html", id: 6 },
                { url: "http://localhost:3000/app", id: 7 },
                { url: "https://127.0.0.1:8080/api", id: 8 },
                { url: "https://192.168.1.1/admin", id: 9 },
                { url: "file:///Users/test/document.html", id: 10 },
                { url: "data:text/html,<h1>Test</h1>", id: 11 },
                { url: "blob:https://example.com/123-456", id: 12 },
                { url: "https://[2001:db8::1]:8080/path", id: 13 },
                { url: "", id: 14 },
                { url: "invalid-url", id: 15 },
            ];
            callback(mockTabs);
        },
    },
};

// Set up global chrome for testing
if (typeof global !== "undefined") {
    global.chrome = mockChrome;
} else if (typeof window !== "undefined") {
    window.chrome = mockChrome;
}

// Import the domain extraction function (in a real test environment, this would be imported)
// For now, we'll copy the function here for testing
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

// Test suite for domain counting
const runDomainCountingTests = () => {
    console.log("\nRunning domain counting tests...\n");

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

    console.log(`\nDomain counting results: ${passed} passed, ${failed} failed`);
    return { passed, failed, total: Object.keys(expectedCounts).length };
};

// Run all tests
const runAllTests = () => {
    console.log("=".repeat(50));
    console.log("DOMAIN UTILITIES TEST SUITE");
    console.log("=".repeat(50));

    const extractionResults = runDomainExtractionTests();
    const countingResults = runDomainCountingTests();

    const totalPassed = extractionResults.passed + countingResults.passed;
    const totalFailed = extractionResults.failed + countingResults.failed;
    const totalTests = extractionResults.total + countingResults.total;

    console.log("\n" + "=".repeat(50));
    console.log("OVERALL TEST RESULTS");
    console.log("=".repeat(50));
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${totalPassed}`);
    console.log(`Failed: ${totalFailed}`);
    console.log(`Success Rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

    return totalFailed === 0;
};

// Export for use in different environments
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        extractDomainFromUrl,
        runDomainExtractionTests,
        runDomainCountingTests,
        runAllTests,
    };
}

// Auto-run tests if this file is executed directly
if (typeof window !== "undefined" || typeof global !== "undefined") {
    // Run tests when the file is loaded
    runAllTests();
}
