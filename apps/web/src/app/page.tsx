import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Bot,
  Building2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Landmark,
  Mail,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const metrics: Array<{
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  trend: string;
}> = [
  {
    label: "Cash Balance",
    value: "$128.4K",
    detail: "Across 3 operating accounts",
    icon: Landmark,
    trend: "Synced",
  },
  {
    label: "Revenue MTD",
    value: "$42.8K",
    detail: "Stripe and ACH sources",
    icon: ArrowUpRight,
    trend: "+18%",
  },
  {
    label: "Expenses MTD",
    value: "$19.6K",
    detail: "Software, contractors, fees",
    icon: ArrowDownRight,
    trend: "Review",
  },
  {
    label: "Unresolved",
    value: "14",
    detail: "Need owner context",
    icon: CircleAlert,
    trend: "Action",
  },
];

const reviewRows = [
  ["Jun 6", "OpenAI", "Software and AI tools", "$248.00", "Ready"],
  ["Jun 6", "Stripe payout", "Clearing reconciliation", "$4,892.14", "Match"],
  ["Jun 5", "Wise transfer", "Contractor delivery labor", "$1,850.00", "Review"],
  ["Jun 4", "Mercury ACH", "Marketing retainer revenue", "$5,500.00", "Ready"],
];

const integrations: Array<[string, string, LucideIcon]> = [
  ["Convex", "Dev deployment ready", CheckCircle2],
  ["Vercel", "Project link pending", Clock3],
  ["Plunk", "Keys queued for env storage", Mail],
  ["Plaid", "Deferred until foundation verified", Banknote],
  ["Stripe", "Deferred until foundation verified", Building2],
  ["AI provider", "OpenAI-compatible adapter planned", Bot],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-md border bg-card">
                  <Sparkles className="text-primary" data-icon="inline-start" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold">Ottex AI Accounting</h1>
                  <p className="text-sm text-muted-foreground">
                    Ledger-first bookkeeping for small service businesses
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Next.js 16</Badge>
              <Badge variant="secondary">Convex</Badge>
              <Badge variant="secondary">Plunk</Badge>
              <Badge variant="outline">Foundation</Badge>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <Card key={metric.label}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {metric.label}
                  </CardTitle>
                  <CardAction>
                    <metric.icon className="text-muted-foreground" data-icon="inline-start" />
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="text-3xl font-semibold tracking-normal">{metric.value}</div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">{metric.detail}</p>
                    <Badge variant="outline">{metric.trend}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[1.45fr_0.85fr] lg:px-8">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Weekly Review Queue</CardTitle>
              <CardDescription>
                The owner workflow will clear uncertain transactions before posting.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="review">
              <TabsList>
                <TabsTrigger value="review">Needs review</TabsTrigger>
                <TabsTrigger value="ready">Ready</TabsTrigger>
                <TabsTrigger value="posted">Posted</TabsTrigger>
              </TabsList>
              <TabsContent value="review">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Counterparty</TableHead>
                      <TableHead>Suggestion</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reviewRows.map(([date, counterparty, suggestion, amount, state]) => (
                      <TableRow key={`${date}-${counterparty}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {date}
                        </TableCell>
                        <TableCell className="font-medium">{counterparty}</TableCell>
                        <TableCell>{suggestion}</TableCell>
                        <TableCell className="text-right font-mono">{amount}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={state === "Review" ? "secondary" : "outline"}>
                            {state}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>
              <TabsContent value="ready">
                <div className="rounded-md border px-4 py-8 text-sm text-muted-foreground">
                  High-confidence journal proposals will appear here.
                </div>
              </TabsContent>
              <TabsContent value="posted">
                <div className="rounded-md border px-4 py-8 text-sm text-muted-foreground">
                  Posted journal entries will appear after ledger validation.
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Integration Status</CardTitle>
              <CardDescription>Bootstrap connections and next API gates.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {integrations.map(([name, state, Icon]) => (
                <div key={name} className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-8 items-center justify-center rounded-md border bg-background">
                    <Icon className="text-muted-foreground" data-icon="inline-start" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-sm text-muted-foreground">{state}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trust Boundary</CardTitle>
              <CardDescription>Accounting correctness comes before automation.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-3 text-foreground">
                <ShieldCheck className="text-primary" data-icon="inline-start" />
                <span>AI proposes. The ledger engine posts.</span>
              </div>
              <Separator />
              <p>
                The first production milestone is a deterministic double-entry core, then
                bank and Stripe ingestion, then AI only for unresolved classification.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
