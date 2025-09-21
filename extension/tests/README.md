# Domain Utilities Tests

This directory contains unit tests for the domain extraction and tracking utilities used in the Tab Limiter extension.

## Files

-   `domain-utils.test.js` - Main test suite with comprehensive tests for domain extraction and counting
-   `test-runner.html` - Browser-based test runner for visual testing
-   `README.md` - This file

## Running Tests

### Node.js Environment

```bash
node extension/tests/domain-utils.test.js
```

### Browser Environment

Open `test-runner.html` in a web browser to run the tests visually.

## Test Coverage

The test suite covers:

### Domain Extraction Tests

-   Basic HTTP/HTTPS URLs with and without www prefix
-   Chrome internal pages (chrome://)
-   Extension URLs (chrome-extension://, moz-extension://)
-   Localhost and IP addresses (IPv4 and IPv6)
-   File URLs (file://)
-   Data and blob URLs
-   Edge cases (empty strings, null values, invalid URLs)
-   Subdomains and ports

### Domain Counting Tests

-   Grouping tabs by extracted domain
-   Counting tabs per domain
-   Handling mixed URL types

## Expected Results

All tests should pass with a 100% success rate. The domain extraction function should:

1. Remove 'www.' prefixes consistently
2. Handle special URL schemes appropriately
3. Normalize localhost and IP addresses
4. Gracefully handle invalid or edge case URLs
5. Return predictable domain names for grouping purposes

## Integration

These utilities are integrated into both:

-   `background.js` - For tab limit enforcement and tracking
-   `options.js` - For UI display and user interaction
