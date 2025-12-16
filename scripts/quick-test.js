#!/usr/bin/env node
/**
 * Quick Test Script (Cross-platform)
 * Runs basic health and functionality checks
 *
 * Usage: node scripts/quick-test.js [BASE_URL]
 */

const BASE_URL = process.argv[2] || "http://localhost:3000";

// Colors for console output
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

let passed = 0;
let failed = 0;

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function check(name, expected, actual) {
  if (actual && actual.includes(expected)) {
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    passed++;
    return true;
  } else {
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    console.log(`  Expected: ${expected}`);
    console.log(`  Got: ${actual}`);
    failed++;
    return false;
  }
}

async function fetchJson(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    return { status: response.status, body: text, headers: response.headers };
  } catch (error) {
    return { status: 0, body: error.message, headers: null };
  }
}

async function runTests() {
  log("yellow", "Quick Test - Delineate API");
  console.log(`Base URL: ${BASE_URL}`);
  console.log("");

  // Health check
  log("yellow", "--- Health ---");
  const health = await fetchJson(`${BASE_URL}/health`);
  check("Health endpoint responds", '"status"', health.body);
  check("Storage check present", '"storage"', health.body);
  check("Redis check present", '"redis"', health.body);

  // Root endpoint
  log("yellow", "--- Root ---");
  const root = await fetchJson(`${BASE_URL}/`);
  check("Root returns message", '"Hello Hono!"', root.body);

  // File list
  log("yellow", "--- Files ---");
  const files = await fetchJson(`${BASE_URL}/v1/files`);
  if (files.status === 200 || files.status === 503) {
    console.log(
      `${colors.green}✓${colors.reset} File list endpoint responds (${files.status})`,
    );
    passed++;
  } else {
    console.log(`${colors.red}✗${colors.reset} File list endpoint responds`);
    console.log(`  Expected: 200 or 503`);
    console.log(`  Got: ${files.status}`);
    failed++;
  }

  // Download check
  log("yellow", "--- Download Check ---");
  const downloadCheck = await fetchJson(`${BASE_URL}/v1/download/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: 70000 }),
  });
  check(
    "Download check returns file_id",
    '"file_id":70000',
    downloadCheck.body,
  );
  check("Download check returns available", '"available"', downloadCheck.body);

  // Download start
  log("yellow", "--- Download Start ---");
  const downloadStart = await fetchJson(`${BASE_URL}/v1/download/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: 70000, user_id: "quick-test" }),
  });
  if (downloadStart.status === 200 || downloadStart.status === 503) {
    console.log(
      `${colors.green}✓${colors.reset} Download start endpoint responds (${downloadStart.status})`,
    );
    passed++;
  } else {
    console.log(
      `${colors.red}✗${colors.reset} Download start endpoint responds`,
    );
    console.log(`  Expected: 200 or 503`);
    console.log(`  Got: ${downloadStart.status}`);
    failed++;
  }

  // Security headers
  log("yellow", "--- Security ---");
  const headersResponse = await fetchJson(`${BASE_URL}/`);
  const headersList = [];
  if (headersResponse.headers) {
    headersResponse.headers.forEach((value, key) => {
      headersList.push(`${key}: ${value}`);
    });
  }
  const headersStr = headersList.join("\n").toLowerCase();
  check("X-Request-ID header", "x-request-id", headersStr);
  check("Rate limit header", "ratelimit-limit", headersStr);
  check("Security headers", "x-content-type-options", headersStr);

  // Summary
  console.log("");
  log("yellow", "==============================");
  console.log(`Passed: ${colors.green}${passed}${colors.reset}`);
  console.log(`Failed: ${colors.red}${failed}${colors.reset}`);
  log("yellow", "==============================");

  if (failed === 0) {
    log("green", "All quick tests passed!");
    process.exit(0);
  } else {
    log("red", "Some tests failed.");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
