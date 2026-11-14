import VendorOrderDetails from './vendor-order-details';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VendorOrderDetails orderId={id} />;
}
