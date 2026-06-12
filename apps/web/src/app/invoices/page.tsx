import { redirect } from "next/navigation";

// The "Invoices" section was renamed to "Income" (Epic A3). Preserve old links
// and bookmarks: Next 16 server-side redirect (307) to the new route.
export default function InvoicesRedirectPage() {
  redirect("/income");
}
