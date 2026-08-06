/**
 * Maps Convex auth error codes to user-friendly messages
 */
export function mapAuthError(error: unknown): string {
  const errorString = String(error);

  // Sign in errors
  if (errorString.includes("InvalidAccountId")) {
    return "Account doesn't exist. Please check your email or create a new account.";
  }
  if (errorString.includes("InvalidSecret")) {
    return "Invalid password. Please try again.";
  }

  // Sign up errors
  if (errorString.includes("DuplicateIdentifier")) {
    return "This email is already registered. Please sign in or use a different email.";
  }

  // Password reset errors
  if (errorString.includes("InvalidCode")) {
    return "This password reset link has expired or is invalid. Please request a new one.";
  }

  // Email validation
  if (errorString.includes("Email is required")) {
    return "Email is required.";
  }

  // Generic fallback
  return "Authentication failed. Please try again.";
}
