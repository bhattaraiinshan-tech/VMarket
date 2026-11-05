import OrderDetails from './order-details';

export default async function Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <OrderDetails orderId={orderId} />;
}
