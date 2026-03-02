export const RANGES = [
  { key: 'd', label: '1D' },
  { key: 'w', label: '1W' },
  { key: 'm', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: 'y', label: '1Y' },
  { key: 'all', label: 'ALL' },
];

export function formatPrice(price: number | null | undefined): string {
  if (price == null) return '--';
  return `$${price.toFixed(2)}`;
}

export function formatDate(d: string): string {
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
