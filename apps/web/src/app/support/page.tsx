import SupportPage from './support-page';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; kind?: string }>;
}) {
  const { orderId, kind } = await searchParams;
  return (
    <SupportPage
      initialKind={kind === 'dispute' ? 'dispute' : 'support'}
      orderId={orderId ?? ''}
    />
  );
}
