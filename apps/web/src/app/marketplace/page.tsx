import Marketplace from './marketplace';

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    category_id?: string | string[];
  }>;
}) {
  const { q, category_id } = await searchParams;
  const initialSearch = typeof q === 'string' ? q : '';
  const initialCategory = typeof category_id === 'string' ? category_id : '';
  return (
    <Marketplace
      key={JSON.stringify([initialSearch, initialCategory])}
      initialSearch={initialSearch}
      initialCategory={initialCategory}
    />
  );
}
