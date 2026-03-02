import { useState, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import api from '../services/api';
import { RANGES, formatPrice, formatDate } from '../utils/format';

interface PortfolioItem {
  cardName: string;
  quantity: number;
  purchasePrice: number | null;
  currentPrice: number | null;
  itemPL: number;
  imageUrl: string | null;
}

interface PortfolioData {
  totalValue: number;
  totalCost: number;
  profitLoss: number;
  profitLossPercent: number;
  items: PortfolioItem[];
}

interface ChartPoint {
  date: string;
  totalValue: number;
}

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [range, setRange] = useState('m');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/portfolio');
        setPortfolio(res.data);
      } catch (err) {
        console.error('Failed to load portfolio:', err);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/portfolio/chart', { params: { range } });
        setChart(res.data);
      } catch (err) {
        console.error('Failed to load chart:', err);
        setChart([]);
      }
    })();
  }, [range]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8899aa' }}>
        <p style={{ fontSize: '16px' }}>Loading portfolio...</p>
      </div>
    );
  }

  if (!portfolio || portfolio.items.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Portfolio</h1>
        <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '32px', textAlign: 'center', color: '#8899aa' }}>
          <p style={{ fontSize: '15px', marginBottom: '4px' }}>No holdings yet</p>
          <p style={{ fontSize: '13px' }}>Add cards to your collection to see portfolio value here.</p>
        </div>
      </div>
    );
  }

  const plColor = portfolio.profitLoss >= 0 ? '#4caf50' : '#e94560';
  const plSign = portfolio.profitLoss >= 0 ? '+' : '';

  const sortedItems = [...portfolio.items].sort(
    (a, b) => ((b.currentPrice ?? 0) * b.quantity) - ((a.currentPrice ?? 0) * a.quantity)
  );

  return (
    <div>
      {/* Summary */}
      <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '4px' }}>Portfolio Value</div>
        <div style={{ fontSize: '32px', fontWeight: 700, marginBottom: '8px' }}>{formatPrice(portfolio.totalValue)}</div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: '12px', color: '#8899aa' }}>Cost basis </span>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>{formatPrice(portfolio.totalCost)}</span>
          </div>
          <div>
            <span style={{ fontSize: '12px', color: '#8899aa' }}>P/L </span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: plColor }}>
              {plSign}{formatPrice(portfolio.profitLoss)} ({plSign}{portfolio.profitLossPercent.toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Range selector */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: '8px',
              border: 'none',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: range === r.key ? '#e94560' : '#16213e',
              color: range === r.key ? '#fff' : '#8899aa',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '16px 8px 8px', marginBottom: '16px' }}>
        {chart.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chart}>
              <defs>
                <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e94560" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#e94560" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fill: '#8899aa', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={(v: number) => `$${v}`}
                tick={{ fill: '#8899aa', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={50}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #0f3460', borderRadius: '8px', fontSize: '13px' }}
                labelStyle={{ color: '#8899aa' }}
                itemStyle={{ color: '#e94560' }}
                labelFormatter={(d: any) => formatDate(d)}
                formatter={(value: any) => [formatPrice(value), 'Value']}
              />
              <Area
                type="monotone"
                dataKey="totalValue"
                stroke="#e94560"
                strokeWidth={2}
                fill="url(#valueGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#e94560', stroke: '#16213e', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#8899aa', fontSize: '13px' }}>
            Not enough data for this time range
          </div>
        )}
      </div>

      {/* Holdings */}
      <h2 style={{ fontSize: '16px', marginBottom: '10px' }}>Holdings</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sortedItems.map((item, i) => {
          const value = (item.currentPrice ?? 0) * item.quantity;
          const itemPlColor = item.itemPL >= 0 ? '#4caf50' : '#e94560';
          const itemPlSign = item.itemPL >= 0 ? '+' : '';
          return (
            <div key={i} style={{ backgroundColor: '#16213e', borderRadius: '10px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {item.imageUrl && <img src={item.imageUrl} alt={item.cardName} style={{ width: '40px', height: 'auto', borderRadius: '4px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>{item.cardName}</div>
                  <div style={{ fontSize: '12px', color: '#8899aa' }}>
                    x{item.quantity} · {formatPrice(item.currentPrice)} each
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>{formatPrice(value)}</div>
                <div style={{ fontSize: '12px', color: itemPlColor }}>
                  {itemPlSign}{formatPrice(item.itemPL)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
