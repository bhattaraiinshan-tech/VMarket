import type { Metadata } from 'next';

import SupportPage from './support-page';

export const metadata: Metadata = {
  title: "Support Center | Vendor's Market",
  description:
    'Find answers, submit support tickets, and follow your requests.',
};

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
