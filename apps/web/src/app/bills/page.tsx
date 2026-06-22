import { redirect } from "next/navigation";

// Bills (AP) moved under the Expenses section as the "Bills" sub-tab (Epic E3).
// Preserve old links and bookmarks: Next 16 server-side redirect (307) to the
// new route — mirrors app/invoices → /income.
export default function BillsRedirectPage() {
  redirect("/expenses/bills");
}
