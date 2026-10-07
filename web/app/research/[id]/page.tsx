import { CampaignMonitor } from '@/components/CampaignMonitor';

export default async function OwnerCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignMonitor id={id} owner />;
}
