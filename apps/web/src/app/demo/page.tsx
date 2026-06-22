import { DemoScreen } from "@/components/openbooks/DemoScreen";

// Public, no-login demo route (Epic E4-T10). Renders the single shared demo
// workspace read-only for unauthenticated visitors. The server-side guard in
// `api.demo.demoView` (workspace.isDemo === true) is the boundary — this route
// reads only that flagged workspace and never mutates.
export default function DemoPage() {
  return <DemoScreen />;
}
