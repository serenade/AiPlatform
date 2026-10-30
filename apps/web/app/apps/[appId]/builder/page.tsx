import { BuilderWorkbench } from './BuilderWorkbench';

export default async function BuilderPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  return <BuilderWorkbench appId={appId} />;
}
