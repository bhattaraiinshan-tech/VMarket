import OrderDetails from './order-details';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ invoice?: string }>;
}) {
  const { orderId } = await params;
  const { invoice } = await searchParams;
  return <OrderDetails orderId={orderId} showInvoice={invoice === '1'} />;
}
