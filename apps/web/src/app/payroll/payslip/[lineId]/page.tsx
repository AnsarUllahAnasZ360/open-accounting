import { PayslipView } from "@/components/openbooks/PayslipView";

export default async function PayslipPage({
  params,
  searchParams,
}: {
  params: Promise<{ lineId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { lineId } = await params;
  const { t } = await searchParams;
  return <PayslipView lineId={lineId} token={t} />;
}
