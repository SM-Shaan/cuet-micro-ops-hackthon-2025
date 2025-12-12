/**
 * UUID generation utility with fallback for browsers that don't support crypto.randomUUID()
 */

/**
 * Generates a UUID v4
 * Uses crypto.randomUUID() if available, otherwise falls back to a polyfill
 */
export function generateUUID(): string {
  // Check if crypto.randomUUID is available (modern browsers, secure context)
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // Fallback implementation for older browsers or non-secure contexts
  // This uses Math.random() which is not cryptographically secure but sufficient for UI purposes
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
