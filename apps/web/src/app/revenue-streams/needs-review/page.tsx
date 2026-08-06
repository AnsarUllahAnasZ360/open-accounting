import { redirect } from "next/navigation";

// Redirect old /revenue-streams/needs-review URLs to the main income streams page
// The needs-review functionality will be integrated into income settings in a future update
export default function RevenueStreamsNeedsReviewRedirect() {
  redirect("/income/streams-insights");
}
