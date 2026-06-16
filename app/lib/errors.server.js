// app/lib/errors.server.js

/**
 * Wraps a loader function with consistent error handling.
 * Catches errors, logs them, and returns a safe error state
 * instead of crashing the entire page.
 */
export async function withErrorHandling(fn, fallback = {}) {
  try {
    return await fn();
  } catch (error) {
    // Log full error server-side for debugging
    console.error("Loader error:", error.message);

    // Return safe fallback data with error flag
    return {
      ...fallback,
      loaderError: error.message || "An unexpected error occurred",
    };
  }
}

/**
 * Extracts a clean error message from various error types.
 * Shopify API errors, Prisma errors, and generic JS errors
 * all have different shapes.
 */
export function getErrorMessage(error) {
  // Shopify API error
  if (error?.response?.errors) {
    return error.response.errors.map((e) => e.message).join(", ");
  }

  // Prisma error
  if (error?.code?.startsWith("P")) {
    return `Database error: ${error.message}`;
  }

  // Generic error
  return error?.message || "An unexpected error occurred";
}