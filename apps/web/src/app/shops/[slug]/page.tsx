import ShopDetails from './shop-details';

export default async function ShopPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ShopDetails slug={slug} />;
}
