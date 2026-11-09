import Marketplace from './marketplace';

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const initialSearch = typeof q === 'string' ? q : '';
  return <Marketplace key={initialSearch} initialSearch={initialSearch} />;
}
