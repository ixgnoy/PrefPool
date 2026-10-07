import { CampaignMonitor } from '@/components/CampaignMonitor';

// Public live view: aquarium + pipeline, never results.
export default async function PublicCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignMonitor id={id} owner={false} />;
}
