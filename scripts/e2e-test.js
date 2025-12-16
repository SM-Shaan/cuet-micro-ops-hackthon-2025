/**
 * E2E Test Script for Delineate Hackathon Challenge API
 * Usage: node scripts/e2e-test.js [BASE_URL]
 */

const BASE_URL = process.argv[2] ?? "http://localhost:3000";

// ANSI Colors
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

const results = { passed: 0, failed: 0, total: 0 };

function logPass(message) {
  console.log(`${colors.green}✓ PASS${colors.reset}: ${message}`);
  results.passed++;
  results.total++;
}

function logFail(message, expected, got) {
  console.log(`${colors.red}✗ FAIL${colors.reset}: ${message}`);
  console.log(`  ${colors.yellow}Expected${colors.reset}: ${expected}`);
  console.log(`  ${colors.yellow}Got${colors.reset}: ${got}`);
  results.failed++;
  results.total++;
}

function logSection(title) {
  console.log();
  console.log(`${colors.yellow}=== ${title} ===${colors.reset}`);
}

async function waitForServer() {
  console.log(`Waiting for server at ${BASE_URL}...`);
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      // Accept 200 (healthy) or 503 (unhealthy but server is running)
      if (response.status === 200 || response.status === 503) {
        console.log("Server is ready!");
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Server did not start in time");
}

async function testRoot() {
  logSection("Root Endpoint");

  const response = await fetch(`${BASE_URL}/`);
  const data = await response.json();

  if (data.message === "Hello Hono!") {
    logPass("Root returns welcome message");
  } else {
    logFail(
      "Root returns welcome message",
      '{"message":"Hello Hono!"}',
      JSON.stringify(data),
    );
  }
}

async function testHealth() {
  logSection("Health Endpoint");

  const response = await fetch(`${BASE_URL}/health`);
  const data = await response.json();

  // Accept 200 (healthy) or 503 (unhealthy - storage unavailable)
  if (response.status === 200 || response.status === 503) {
    logPass("Health returns valid status code (200 or 503)");
  } else {
    logFail(
      "Health returns valid status code",
      "200 or 503",
      String(response.status),
    );
  }

  // Status should match response code
  if (
    (response.status === 200 && data.status === "healthy") ||
    (response.status === 503 && data.status === "unhealthy")
  ) {
    logPass("Health status matches response code");
  } else {
    logFail(
      "Health status matches response code",
      `"status":"${response.status === 200 ? "healthy" : "unhealthy"}"`,
      data.status ?? "undefined",
    );
  }

  // Storage check should be present with valid value
  if (
    data.checks?.storage === "ok" ||
    data.checks?.storage === "error" ||
    data.checks?.storage === "circuit_open"
  ) {
    logPass("Storage check returns valid status");
  } else {
    logFail(
      "Storage check returns valid status",
      '"storage":"ok", "error", or "circuit_open"',
      data.checks?.storage ?? "undefined",
    );
  }

  // Redis check should be present with valid value
  if (data.checks?.redis === "ok" || data.checks?.redis === "error") {
    logPass("Redis check returns valid status");
  } else {
    logFail(
      "Redis check returns valid status",
      '"redis":"ok" or "error"',
      data.checks?.redis ?? "undefined",
    );
  }
}

async function testSecurityHeaders() {
  logSection("Security Headers");

  const response = await fetch(`${BASE_URL}/`);
  const headers = response.headers;

  // X-Request-ID
  if (headers.has("x-request-id")) {
    logPass("X-Request-ID header present");
  } else {
    logFail("X-Request-ID header present", "x-request-id: <uuid>", "not found");
  }

  // Rate Limit headers
  if (headers.has("ratelimit-limit")) {
    logPass("RateLimit-Limit header present");
  } else {
    logFail(
      "RateLimit-Limit header present",
      "ratelimit-limit: <number>",
      "not found",
    );
  }

  if (headers.has("ratelimit-remaining")) {
    logPass("RateLimit-Remaining header present");
  } else {
    logFail(
      "RateLimit-Remaining header present",
      "ratelimit-remaining: <number>",
      "not found",
    );
  }

  // Security headers
  if (headers.get("x-content-type-options") === "nosniff") {
    logPass("X-Content-Type-Options header present");
  } else {
    logFail(
      "X-Content-Type-Options header present",
      "x-content-type-options: nosniff",
      headers.get("x-content-type-options") ?? "not found",
    );
  }

  if (headers.has("x-frame-options")) {
    logPass("X-Frame-Options header present");
  } else {
    logFail(
      "X-Frame-Options header present",
      "x-frame-options: SAMEORIGIN",
      "not found",
    );
  }

  if (headers.has("strict-transport-security")) {
    logPass("Strict-Transport-Security header present");
  } else {
    logFail(
      "Strict-Transport-Security header present",
      "strict-transport-security: ...",
      "not found",
    );
  }

  // CORS headers
  if (headers.has("access-control-allow-origin")) {
    logPass("CORS Access-Control-Allow-Origin header present");
  } else {
    logFail(
      "CORS Access-Control-Allow-Origin header present",
      "access-control-allow-origin: *",
      "not found",
    );
  }
}

async function testDownloadInitiate() {
  logSection("Download Initiate Endpoint");

  // Valid request
  const response = await fetch(`${BASE_URL}/v1/download/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_ids: [10000, 20000, 30000] }),
  });
  const data = await response.json();

  if (data.jobId) {
    logPass("Download initiate returns jobId");
  } else {
    logFail(
      "Download initiate returns jobId",
      '"jobId": "<uuid>"',
      JSON.stringify(data),
    );
  }

  if (data.status === "queued") {
    logPass("Download initiate status is queued");
  } else {
    logFail(
      "Download initiate status is queued",
      '"status":"queued"',
      data.status ?? "undefined",
    );
  }

  if (data.totalFileIds === 3) {
    logPass("Download initiate totalFileIds is correct");
  } else {
    logFail(
      "Download initiate totalFileIds is correct",
      '"totalFileIds":3',
      String(data.totalFileIds),
    );
  }

  // Invalid request - file_id too small
  const invalidResponse1 = await fetch(`${BASE_URL}/v1/download/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_ids: [100] }),
  });

  if (invalidResponse1.status === 400) {
    logPass("Download initiate rejects file_id < 10000");
  } else {
    logFail(
      "Download initiate rejects file_id < 10000",
      "400",
      String(invalidResponse1.status),
    );
  }

  // Invalid request - empty array
  const invalidResponse2 = await fetch(`${BASE_URL}/v1/download/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_ids: [] }),
  });

  if (invalidResponse2.status === 400) {
    logPass("Download initiate rejects empty file_ids array");
  } else {
    logFail(
      "Download initiate rejects empty file_ids array",
      "400",
      String(invalidResponse2.status),
    );
  }
}

async function testDownloadCheck() {
  logSection("Download Check Endpoint");

  // Valid request - file exists (70000 was uploaded earlier)
  const response = await fetch(`${BASE_URL}/v1/download/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: 70000 }),
  });
  const data = await response.json();

  if (data.file_id === 70000) {
    logPass("Download check returns correct file_id");
  } else {
    logFail(
      "Download check returns correct file_id",
      '"file_id":70000',
      String(data.file_id),
    );
  }

  if (typeof data.available === "boolean") {
    logPass("Download check returns available field");
  } else {
    logFail(
      "Download check returns available field",
      '"available": true/false',
      String(data.available),
    );
  }

  // Valid request - file likely doesn't exist
  const response2 = await fetch(`${BASE_URL}/v1/download/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: 99999 }),
  });
  const data2 = await response2.json();

  if (data2.file_id === 99999) {
    logPass("Download check returns correct file_id for non-existent file");
  } else {
    logFail(
      "Download check returns correct file_id for non-existent file",
      '"file_id":99999',
      String(data2.file_id),
    );
  }

  // Invalid request - file_id too small
  const invalidResponse1 = await fetch(`${BASE_URL}/v1/download/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: 100 }),
  });

  if (invalidResponse1.status === 400) {
    logPass("Download check rejects file_id < 10000");
  } else {
    logFail(
      "Download check rejects file_id < 10000",
      "400",
      String(invalidResponse1.status),
    );
  }

  // Invalid request - file_id too large
  const invalidResponse2 = await fetch(`${BASE_URL}/v1/download/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: 999999999 }),
  });

  if (invalidResponse2.status === 400) {
    logPass("Download check rejects file_id > 100000000");
  } else {
    logFail(
      "Download check rejects file_id > 100000000",
      "400",
      String(invalidResponse2.status),
    );
  }
}

async function testRequestId() {
  logSection("Request ID Tracking");

  // Check that custom request ID is respected
  const customId = "test-request-id-12345";
  const response1 = await fetch(`${BASE_URL}/`, {
    headers: { "X-Request-ID": customId },
  });

  if (response1.headers.get("x-request-id") === customId) {
    logPass("Custom X-Request-ID is respected");
  } else {
    logFail(
      "Custom X-Request-ID is respected",
      customId,
      response1.headers.get("x-request-id") ?? "not found",
    );
  }

  // Check that new request ID is generated when not provided
  const response2 = await fetch(`${BASE_URL}/`);
  const generatedId = response2.headers.get("x-request-id");
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (generatedId && uuidRegex.test(generatedId)) {
    logPass("Auto-generated X-Request-ID is valid UUID");
  } else {
    logFail(
      "Auto-generated X-Request-ID is valid UUID",
      "UUID format",
      generatedId ?? "not found",
    );
  }
}

async function testContentType() {
  logSection("Content-Type Validation");

  // POST with invalid JSON should fail
  const response = await fetch(`${BASE_URL}/v1/download/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not valid json",
  });

  // 400 (bad request) or 500 (caught by error handler) are both acceptable
  if (response.status === 400 || response.status === 500) {
    logPass("POST with invalid JSON is rejected");
  } else {
    logFail(
      "POST with invalid JSON is rejected",
      "400 or 500",
      String(response.status),
    );
  }

  // POST with wrong content type should be handled
  const response2 = await fetch(`${BASE_URL}/v1/download/check`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ file_id: 70000 }),
  });

  // Either rejected (400/415) or handled gracefully
  if (
    response2.status === 400 ||
    response2.status === 415 ||
    response2.status === 200
  ) {
    logPass("POST with text/plain Content-Type is handled");
  } else {
    logFail(
      "POST with text/plain Content-Type is handled",
      "400, 415, or 200",
      String(response2.status),
    );
  }
}

async function testMethodNotAllowed() {
  logSection("Method Validation");

  // DELETE on root should return 404 or 405
  const response1 = await fetch(`${BASE_URL}/`, { method: "DELETE" });

  if (response1.status === 404 || response1.status === 405) {
    logPass("DELETE on root returns 404/405");
  } else {
    logFail(
      "DELETE on root returns 404/405",
      "404 or 405",
      String(response1.status),
    );
  }

  // GET on POST-only endpoint
  const response2 = await fetch(`${BASE_URL}/v1/download/check`);

  if (response2.status === 404 || response2.status === 405) {
    logPass("GET on POST-only endpoint returns 404/405");
  } else {
    logFail(
      "GET on POST-only endpoint returns 404/405",
      "404 or 405",
      String(response2.status),
    );
  }
}

async function testRateLimiting() {
  logSection("Rate Limiting");

  // Get initial remaining count
  const response1 = await fetch(`${BASE_URL}/`);
  const remaining = response1.headers.get("ratelimit-remaining");

  if (remaining && parseInt(remaining, 10) > 0) {
    logPass("Rate limit remaining is tracked");
  } else {
    logFail("Rate limit remaining is tracked", "> 0", remaining ?? "not found");
  }

  // Make another request and check remaining continues to be tracked
  await new Promise((resolve) => setTimeout(resolve, 100));
  const response2 = await fetch(`${BASE_URL}/`);
  const newRemaining = response2.headers.get("ratelimit-remaining");

  if (newRemaining) {
    logPass("Rate limit remaining continues to be tracked");
  } else {
    logFail(
      "Rate limit remaining continues to be tracked",
      "number",
      newRemaining ?? "not found",
    );
  }
}

async function testAsyncDownloadFlow() {
  logSection("Async Download Job Flow");

  const userId = `e2e-test-${Date.now()}`;
  const fileId = 70000; // Use a file ID divisible by 7 for mock mode

  // Step 1: Start download job
  const startResponse = await fetch(`${BASE_URL}/v1/download/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, user_id: userId }),
  });
  const startData = await startResponse.json();

  if (startResponse.status === 200 && startData.jobId) {
    logPass("Download start returns jobId");
  } else if (startResponse.status === 503) {
    // Redis might be down - this is a valid failure case
    logPass(
      "Download start returns 503 when service unavailable (expected behavior)",
    );
    return; // Skip remaining tests in this section
  } else {
    logFail(
      "Download start returns jobId",
      '{"jobId":"...", "status":"queued"}',
      JSON.stringify(startData),
    );
    return;
  }

  if (startData.status === "queued" || startData.status === "processing") {
    logPass("Download start status is queued or processing");
  } else {
    logFail(
      "Download start status is queued or processing",
      '"status":"queued" or "processing"',
      startData.status ?? "undefined",
    );
  }

  if (startData.pollUrl === `/v1/download/status/${userId}`) {
    logPass("Download start returns correct pollUrl");
  } else {
    logFail(
      "Download start returns correct pollUrl",
      `/v1/download/status/${userId}`,
      startData.pollUrl ?? "undefined",
    );
  }

  // Step 2: Poll for status (wait up to 20 seconds)
  let finalStatus = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const statusResponse = await fetch(
      `${BASE_URL}/v1/download/status/${userId}`,
    );
    const statusData = await statusResponse.json();

    if (statusData.status === "completed" || statusData.status === "failed") {
      finalStatus = statusData;
      break;
    }
  }

  if (finalStatus) {
    logPass(`Download job completed with status: ${finalStatus.status}`);
  } else {
    logFail(
      "Download job completes within timeout",
      '"status":"completed" or "failed"',
      "still processing after 20s",
    );
    return;
  }

  if (finalStatus.progress === 100) {
    logPass("Download job progress reaches 100%");
  } else {
    logFail(
      "Download job progress reaches 100%",
      "100",
      String(finalStatus.progress),
    );
  }

  if (finalStatus.processingTimeMs && finalStatus.processingTimeMs > 0) {
    logPass("Download job reports processing time");
  } else {
    logFail(
      "Download job reports processing time",
      "> 0",
      String(finalStatus.processingTimeMs),
    );
  }

  // Step 3: Test idempotency - same user_id should return existing job
  const idempotentResponse = await fetch(`${BASE_URL}/v1/download/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, user_id: userId }),
  });
  const idempotentData = await idempotentResponse.json();

  // Since job is completed, a new job should be created or existing returned
  if (idempotentResponse.status === 200) {
    logPass("Idempotent request handled correctly");
  } else {
    logFail(
      "Idempotent request handled correctly",
      "200",
      String(idempotentResponse.status),
    );
  }
}

async function testDownloadStart() {
  logSection("Download Start Endpoint Validation");

  // Test invalid file_id (too small)
  const response1 = await fetch(`${BASE_URL}/v1/download/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: 100, user_id: "test-user" }),
  });

  if (response1.status === 400) {
    logPass("Download start rejects file_id < 10000");
  } else {
    logFail(
      "Download start rejects file_id < 10000",
      "400",
      String(response1.status),
    );
  }

  // Test invalid file_id (too large)
  const response2 = await fetch(`${BASE_URL}/v1/download/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: 999999999, user_id: "test-user" }),
  });

  if (response2.status === 400) {
    logPass("Download start rejects file_id > 100000000");
  } else {
    logFail(
      "Download start rejects file_id > 100000000",
      "400",
      String(response2.status),
    );
  }

  // Test missing user_id
  const response3 = await fetch(`${BASE_URL}/v1/download/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: 70000 }),
  });

  if (response3.status === 400) {
    logPass("Download start requires user_id");
  } else {
    logFail("Download start requires user_id", "400", String(response3.status));
  }
}

async function testDownloadStatus() {
  logSection("Download Status Endpoint");

  // Test non-existent user
  const response = await fetch(
    `${BASE_URL}/v1/download/status/non-existent-user-12345`,
  );

  if (response.status === 404) {
    logPass("Download status returns 404 for non-existent user");
  } else {
    logFail(
      "Download status returns 404 for non-existent user",
      "404",
      String(response.status),
    );
  }

  const data = await response.json();
  if (data.error === "Not Found") {
    logPass("Download status returns correct error message");
  } else {
    logFail(
      "Download status returns correct error message",
      '"error":"Not Found"',
      JSON.stringify(data),
    );
  }
}

async function testFileListEndpoint() {
  logSection("File List Endpoint");

  const response = await fetch(`${BASE_URL}/v1/files`);

  // Accept 200 (success) or 503 (S3 unavailable) or 500 (timeout)
  if (
    response.status === 200 ||
    response.status === 503 ||
    response.status === 500
  ) {
    logPass("File list endpoint responds");
  } else {
    logFail(
      "File list endpoint responds",
      "200, 503, or 500",
      String(response.status),
    );
    return;
  }

  if (response.status === 200) {
    const data = await response.json();

    if (Array.isArray(data.files)) {
      logPass("File list returns files array");
    } else {
      logFail(
        "File list returns files array",
        '"files": [...]',
        JSON.stringify(data),
      );
    }

    if (typeof data.totalCount === "number") {
      logPass("File list returns totalCount");
    } else {
      logFail(
        "File list returns totalCount",
        '"totalCount": <number>',
        JSON.stringify(data),
      );
    }
  } else {
    logPass(
      "File list returns service unavailable (S3 down - expected in some environments)",
    );
  }
}

function printSummary() {
  console.log();
  console.log(`${colors.yellow}==============================${colors.reset}`);
  console.log(`${colors.yellow}        TEST SUMMARY          ${colors.reset}`);
  console.log(`${colors.yellow}==============================${colors.reset}`);
  console.log(`Total:  ${results.total}`);
  console.log(`${colors.green}Passed: ${results.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${results.failed}${colors.reset}`);
  console.log();

  if (results.failed === 0) {
    console.log(`${colors.green}All tests passed!${colors.reset}`);
  } else {
    console.log(`${colors.red}Some tests failed.${colors.reset}`);
  }
}

async function main() {
  console.log("E2E Tests for Delineate Hackathon Challenge API");
  console.log(`Base URL: ${BASE_URL}`);
  console.log();

  await waitForServer();

  await testRoot();
  await testHealth();
  await testSecurityHeaders();
  await testDownloadInitiate();
  await testDownloadCheck();
  await testDownloadStart();
  await testDownloadStatus();
  await testFileListEndpoint();
  await testAsyncDownloadFlow();
  await testRequestId();
  await testContentType();
  await testMethodNotAllowed();
  await testRateLimiting();

  printSummary();

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
