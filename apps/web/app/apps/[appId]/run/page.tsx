import { AppShell } from './AppShell';

export default async function AppRunPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  return <AppShell appId={appId} />;
}
