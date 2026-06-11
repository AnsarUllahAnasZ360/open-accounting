export function openBooksDevAuthBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS === "1";
}
