import { redirect } from "next/navigation";

// Redirect old /revenue-streams/manage URLs to the main income streams page
// The manage functionality will be moved to income settings in a future update
export default function RevenueStreamsManageRedirect() {
  redirect("/income/streams-insights");
}
