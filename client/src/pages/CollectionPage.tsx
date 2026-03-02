import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import api from '../services/api';
import { RANGES, formatPrice, formatDate } from '../utils/format';

interface CollectionItem {
  id: string;
  collection_id: string;
  card_id: string;
  quantity: number;
  purchase_price: number | null;
  date_acquired: string;
  name: string;
  number: string | null;
  set_name: string;
  set_code: string;
  rarity: string | null;
  image_url: string | null;
  current_price: number | null;
  is_favorited: number | null;
}

interface Collection {
  id: string;
  name: string;
  item_count: number;
}

interface SearchCard {
  id: string;
  name: string;
  number: string | null;
  set_name: string;
  set_code: string;
  rarity: string | null;
  image_url: string | null;
}

interface PricePoint {
  price_usd: number;
  snapshot_date: string;
}

const RARITY_COLORS: Record<string, string> = {
  common: '#888',
  uncommon: '#4caf50',
  rare: '#2196f3',
  'holo rare': '#9c27b0',
  'ultra rare': '#ffc107',
  'secret rare': '#e94560',
};

function rarityColor(rarity: string | null): string {
  if (!rarity) return '#888';
  return RARITY_COLORS[rarity.toLowerCase()] || '#888';
}

// --- Add Cards Modal ---

function AddCardsModal({ collectionId, onClose, onAdded }: { collectionId: string; onClose: () => void; onAdded: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<{ card: SearchCard; quantity: string; price: string } | null>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get('/cards', { params: { search: query, limit: 20 } });
        setResults(res.data.data);
      } catch { setResults([]); }
      setLoading(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const handleAdd = async () => {
    if (!addForm) return;
    const quantity = parseInt(addForm.quantity) || 1;
    const purchasePrice = addForm.price ? parseFloat(addForm.price) : undefined;
    setAdding(addForm.card.id);
    try {
      await api.post(`/collections/${collectionId}/items`, { cardId: addForm.card.id, quantity, purchasePrice });
      setAddForm(null);
      onAdded();
    } catch (err) {
      console.error('Failed to add card:', err);
    }
    setAdding(null);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }} onClick={onClose}>
      <div style={{ backgroundColor: '#16213e', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '500px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '16px', borderBottom: '1px solid #0f3460', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>{addForm ? `Add ${addForm.card.name}` : 'Browse & Add Cards'}</h2>
          <button onClick={addForm ? () => setAddForm(null) : onClose} style={{ background: 'none', border: 'none', color: '#8899aa', fontSize: '20px', cursor: 'pointer' }}>{addForm ? '←' : '✕'}</button>
        </div>
        {addForm ? (
          <div style={{ padding: '16px' }}>
            <div style={{ marginBottom: '16px', color: '#8899aa', fontSize: '13px' }}>{addForm.card.set_name} · {addForm.card.number}</div>
            <label style={{ display: 'block', color: '#8899aa', fontSize: '13px', marginBottom: '4px' }}>Quantity</label>
            <input type="number" min="1" value={addForm.quantity} onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })} style={inputStyle} />
            <label style={{ display: 'block', color: '#8899aa', fontSize: '13px', marginBottom: '4px' }}>Purchase Price (optional)</label>
            <input type="number" step="0.01" min="0" placeholder="e.g. 12.50" value={addForm.price} onChange={(e) => setAddForm({ ...addForm, price: e.target.value })} style={{ ...inputStyle, marginBottom: '20px' }} />
            <button onClick={handleAdd} disabled={adding === addForm.card.id} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', opacity: adding === addForm.card.id ? 0.6 : 1 }}>
              {adding === addForm.card.id ? 'Adding...' : 'Add to Collection'}
            </button>
          </div>
        ) : (
          <>
            <div style={{ padding: '12px 16px' }}>
              <input type="text" placeholder="Search by name..." value={query} onChange={(e) => setQuery(e.target.value)} autoFocus style={inputStyle} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
              {loading && <p style={{ color: '#8899aa', textAlign: 'center', padding: '20px' }}>Searching...</p>}
              {!loading && query && results.length === 0 && <p style={{ color: '#8899aa', textAlign: 'center', padding: '20px' }}>No cards found</p>}
              {results.map((card) => (
                <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #0f3460' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                    {card.image_url ? (
                      <img src={card.image_url} alt={card.name} style={{ width: '40px', height: 'auto', borderRadius: '4px', flexShrink: 0 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div style={{ width: '40px', height: '56px', borderRadius: '4px', backgroundColor: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#555', flexShrink: 0, textAlign: 'center', padding: '2px' }}>{card.name}</div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 500 }}>{card.name}</div>
                      <div style={{ fontSize: '12px', color: '#8899aa' }}>{card.set_name} · {card.number}</div>
                      {card.rarity && <span style={{ fontSize: '11px', color: rarityColor(card.rarity), fontWeight: 600 }}>{card.rarity}</span>}
                    </div>
                  </div>
                  <button onClick={() => setAddForm({ card, quantity: '1', price: '' })} style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: '8px' }}>Add</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Price Chart Modal ---

function PriceChartModal({ cardId, cardName, currentPrice, onClose }: { cardId: string; cardName: string; currentPrice: number | null; onClose: () => void }) {
  const [range, setRange] = useState('m');
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await api.get(`/cards/${cardId}/chart`, { params: { range } });
        setPrices(res.data.prices || []);
      } catch { setPrices([]); }
      setLoading(false);
    })();
  }, [cardId, range]);

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 110, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px' }} onClick={onClose}>
      <div style={{ backgroundColor: '#16213e', borderRadius: '16px', width: '100%', maxWidth: '460px', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <div>
            <h2 style={{ fontSize: '18px', margin: '0 0 4px' }}>{cardName}</h2>
            <div style={{ fontSize: '13px', color: '#8899aa' }}>Price History</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8899aa', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ fontSize: '28px', fontWeight: 700, marginBottom: '16px' }}>{formatPrice(currentPrice)}</div>

        {/* Range selector */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)} style={{ flex: 1, padding: '6px 0', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer', backgroundColor: range === r.key ? '#e94560' : '#1a1a2e', color: range === r.key ? '#fff' : '#8899aa' }}>
              {r.label}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div style={{ backgroundColor: '#1a1a2e', borderRadius: '10px', padding: '12px 4px 4px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#8899aa', fontSize: '13px' }}>Loading...</div>
          ) : prices.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={prices}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e94560" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#e94560" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="snapshot_date" tickFormatter={formatDate} tick={{ fill: '#8899aa', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis tickFormatter={(v: number) => `$${v}`} tick={{ fill: '#8899aa', fontSize: 10 }} axisLine={false} tickLine={false} width={45} />
                <Tooltip contentStyle={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '8px', fontSize: '12px' }} labelStyle={{ color: '#8899aa' }} labelFormatter={(d: any) => formatDate(d)} formatter={(value: any) => [formatPrice(value), 'Price']} />
                <Area type="monotone" dataKey="price_usd" stroke="#e94560" strokeWidth={2} fill="url(#priceGrad)" dot={false} activeDot={{ r: 3, fill: '#e94560', stroke: '#16213e', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#8899aa', fontSize: '13px' }}>Not enough price data yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Card Detail Modal ---

function CardDetailModal({ item, onClose, onToggleFav }: { item: CollectionItem; onClose: () => void; onToggleFav: (cardId: string) => void }) {
  const navigate = useNavigate();
  const [showChart, setShowChart] = useState(false);
  const pl = (item.current_price != null && item.purchase_price != null)
    ? (item.current_price - item.purchase_price) * item.quantity
    : null;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px' }} onClick={onClose}>
        <div style={{ backgroundColor: '#16213e', borderRadius: '16px', width: '100%', maxWidth: '400px', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '20px', margin: '0 0 4px' }}>{item.name}</h2>
              <div style={{ fontSize: '13px', color: '#8899aa' }}>{item.set_name} · {item.number}</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onToggleFav(item.card_id); }} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', padding: '0 8px', color: item.is_favorited ? '#e94560' : '#555' }}>
              {item.is_favorited ? '♥' : '♡'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8899aa', fontSize: '20px', cursor: 'pointer' }}>✕</button>
          </div>

          {item.image_url && (
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <img src={item.image_url} alt={item.name} style={{ maxWidth: '200px', width: '100%', height: 'auto', borderRadius: '8px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          )}

          {item.rarity && (
            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, color: '#fff', backgroundColor: rarityColor(item.rarity), marginBottom: '16px' }}>
              {item.rarity}
            </span>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div style={{ backgroundColor: '#1a1a2e', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#8899aa', marginBottom: '4px' }}>Purchase Price</div>
              <div style={{ fontSize: '18px', fontWeight: 600 }}>{formatPrice(item.purchase_price)}</div>
            </div>
            <div style={{ backgroundColor: '#1a1a2e', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#8899aa', marginBottom: '4px' }}>Current Price</div>
              <div style={{ fontSize: '18px', fontWeight: 600 }}>{formatPrice(item.current_price)}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            <div style={{ backgroundColor: '#1a1a2e', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#8899aa', marginBottom: '4px' }}>Quantity</div>
              <div style={{ fontSize: '18px', fontWeight: 600 }}>{item.quantity}</div>
            </div>
            <div style={{ backgroundColor: '#1a1a2e', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#8899aa', marginBottom: '4px' }}>P/L</div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: pl == null ? '#8899aa' : pl >= 0 ? '#4caf50' : '#e94560' }}>
                {pl == null ? '--' : `${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}`}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => { onClose(); navigate('/scan'); }} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '14px', cursor: 'pointer' }}>
              Pre-grade this card
            </button>
            <button onClick={() => setShowChart(true)} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #0f3460', backgroundColor: 'transparent', color: '#8899aa', fontSize: '14px', cursor: 'pointer' }}>
              View Price Chart
            </button>
          </div>
        </div>
      </div>
      {showChart && (
        <PriceChartModal cardId={item.card_id} cardName={item.name} currentPrice={item.current_price} onClose={() => setShowChart(false)} />
      )}
    </>
  );
}

// --- Main Collection Page ---

export default function CollectionPage() {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const loadCollection = useCallback(async () => {
    try {
      let res = await api.get('/collections');
      let collections: Collection[] = res.data;
      if (collections.length === 0) {
        const createRes = await api.post('/collections', { name: 'My Collection' });
        collections = [{ ...createRes.data, item_count: 0 }];
      }
      setCollection(collections[0]);
      // Fetch items from ALL collections so scan-added cards also appear
      const allItems: CollectionItem[] = [];
      await Promise.all(collections.map(async (col) => {
        const itemsRes = await api.get(`/collections/${col.id}/items`);
        allItems.push(...itemsRes.data);
      }));
      setItems(allItems);
    } catch (err) {
      console.error('Failed to load collection:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadCollection(); }, [loadCollection]);

  const toggleFavorite = async (cardId: string) => {
    const item = items.find(i => i.card_id === cardId);
    const wasFav = item?.is_favorited;
    // Optimistic update
    setItems(prev => prev.map(i => i.card_id === cardId ? { ...i, is_favorited: wasFav ? null : 1 } : i));
    if (selectedItem?.card_id === cardId) {
      setSelectedItem(prev => prev ? { ...prev, is_favorited: wasFav ? null : 1 } : prev);
    }
    try {
      if (wasFav) {
        await api.delete(`/favorites/${cardId}`);
      } else {
        await api.post(`/favorites/${cardId}`);
      }
    } catch {
      // Revert on failure
      setItems(prev => prev.map(i => i.card_id === cardId ? { ...i, is_favorited: wasFav ?? null } : i));
    }
  };

  const displayItems = showFavoritesOnly ? items.filter(i => i.is_favorited) : items;
  const totalCards = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalValue = items.reduce((sum, i) => sum + (i.current_price ?? 0) * i.quantity, 0);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8899aa' }}>
        <p style={{ fontSize: '16px' }}>Loading collection...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <div style={{ flex: 1, backgroundColor: '#16213e', borderRadius: '12px', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '4px' }}>Total Cards</div>
          <div style={{ fontSize: '24px', fontWeight: 700 }}>{totalCards}</div>
        </div>
        <div style={{ flex: 1, backgroundColor: '#16213e', borderRadius: '12px', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '4px' }}>Est. Value</div>
          <div style={{ fontSize: '24px', fontWeight: 700 }}>{totalValue > 0 ? formatPrice(totalValue) : '--'}</div>
        </div>
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <button onClick={() => setShowAdd(true)} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}>
          Browse & Add Cards
        </button>
        {items.some(i => i.is_favorited) && (
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            style={{ padding: '12px 16px', borderRadius: '10px', border: 'none', fontSize: '18px', cursor: 'pointer', backgroundColor: showFavoritesOnly ? '#e94560' : '#16213e', color: showFavoritesOnly ? '#fff' : '#8899aa' }}
          >
            ♥
          </button>
        )}
      </div>

      {/* Card grid */}
      {displayItems.length === 0 ? (
        <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '32px', textAlign: 'center', color: '#8899aa' }}>
          {showFavoritesOnly ? (
            <p style={{ fontSize: '15px' }}>No favorited cards</p>
          ) : (
            <>
              <p style={{ fontSize: '15px', marginBottom: '4px' }}>No cards yet</p>
              <p style={{ fontSize: '13px' }}>Tap "Browse & Add Cards" to start building your collection.</p>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
          {displayItems.map((item) => (
            <div
              key={item.id}
              style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '14px', cursor: 'pointer', border: '1px solid transparent', position: 'relative' }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#0f3460')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
            >
              {/* Favorite heart */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(item.card_id); }}
                style={{ position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: item.is_favorited ? '#e94560' : '#444', padding: '2px' }}
              >
                {item.is_favorited ? '♥' : '♡'}
              </button>

              <div onClick={() => setSelectedItem(item)}>
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} style={{ width: '100%', height: 'auto', borderRadius: '6px', marginBottom: '8px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div style={{ width: '100%', height: '150px', borderRadius: '6px', backgroundColor: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px', color: '#555', fontSize: '12px', textAlign: 'center', padding: '8px' }}>{item.name}</div>
                )}
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '3px', lineHeight: 1.3, paddingRight: '20px' }}>{item.name}</div>
                <div style={{ fontSize: '11px', color: '#8899aa', marginBottom: '4px' }}>{item.set_name} · {item.number}</div>
                {item.rarity && (
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600, color: '#fff', backgroundColor: rarityColor(item.rarity), marginBottom: '6px' }}>
                    {item.rarity}
                  </span>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#8899aa' }}>
                  <span>x{item.quantity}</span>
                  <span style={{ color: '#eee', fontWeight: 600 }}>{formatPrice(item.current_price)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showAdd && collection && (
        <AddCardsModal collectionId={collection.id} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); loadCollection(); }} />
      )}
      {selectedItem && (
        <CardDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} onToggleFav={toggleFavorite} />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid #0f3460',
  backgroundColor: '#1a1a2e',
  color: '#eee',
  fontSize: '15px',
  marginBottom: '14px',
  outline: 'none',
  boxSizing: 'border-box',
};
