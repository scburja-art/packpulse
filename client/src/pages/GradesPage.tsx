import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';

interface CreditInfo {
  used: number;
  limit: number;
  remaining: number;
}

interface CollectionItem {
  id: string;
  card_id: string;
  name: string;
  number: string | null;
  set_name: string;
  rarity: string | null;
  image_url: string | null;
}

interface GradeResult {
  id: string;
  collection_item_id: string;
  estimated_psa_grade: number | null;
  estimated_psa_range_low: number | null;
  estimated_psa_range_high: number | null;
  estimated_bgs_grade: number | null;
  estimated_bgs_range_low: number | null;
  estimated_bgs_range_high: number | null;
  confidence_score: number | null;
  created_at: string;
  centering_lr: number | null;
  centering_tb: number | null;
  edge_score: number | null;
  corner_score: number | null;
  whitening_score: number | null;
}

interface PregradeResponse {
  estimatedPSA: number;
  psaRange: { low: number; high: number };
  estimatedBGS: number;
  bgsRange: { low: number; high: number };
  confidence: number;
  measurements: {
    centering_lr: number;
    centering_tb: number;
    edge_score: number;
    corner_score: number;
    whitening_score: number;
  };
  disclaimer: string;
}

interface GradedItem {
  item: CollectionItem;
  grade: GradeResult;
}

function psaColor(grade: number | null): string {
  if (grade == null) return '#888';
  if (grade >= 10) return '#4caf50';
  if (grade >= 9) return '#2196f3';
  if (grade >= 8) return '#ffc107';
  if (grade >= 7) return '#ff9800';
  return '#e94560';
}

function ScoreBar({ label, value, max = 1, format }: { label: string; value: number | null; max?: number; format?: (v: number) => string }) {
  const pct = value != null ? Math.min((value / max) * 100, 100) : 0;
  const displayVal = value != null ? (format ? format(value) : `${(value * 100).toFixed(0)}%`) : '--';
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
        <span style={{ color: '#8899aa' }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{displayVal}</span>
      </div>
      <div style={{ height: '6px', borderRadius: '3px', backgroundColor: '#1a1a2e', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: '3px', backgroundColor: pct >= 80 ? '#4caf50' : pct >= 60 ? '#ffc107' : '#e94560', transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

// --- Grade Report Modal ---

function GradeReportModal({ grade, cardName, onClose }: { grade: GradeResult | PregradeResponse | null; cardName: string; onClose: () => void }) {
  if (!grade) return null;

  // Normalize fields between GradeResult (from history) and PregradeResponse (fresh)
  const isHistory = 'estimated_psa_grade' in grade;
  const psa = isHistory ? (grade as GradeResult).estimated_psa_grade : (grade as PregradeResponse).estimatedPSA;
  const psaLow = isHistory ? (grade as GradeResult).estimated_psa_range_low : (grade as PregradeResponse).psaRange.low;
  const psaHigh = isHistory ? (grade as GradeResult).estimated_psa_range_high : (grade as PregradeResponse).psaRange.high;
  const bgs = isHistory ? (grade as GradeResult).estimated_bgs_grade : (grade as PregradeResponse).estimatedBGS;
  const bgsLow = isHistory ? (grade as GradeResult).estimated_bgs_range_low : (grade as PregradeResponse).bgsRange.low;
  const bgsHigh = isHistory ? (grade as GradeResult).estimated_bgs_range_high : (grade as PregradeResponse).bgsRange.high;
  const confidence = isHistory ? (grade as GradeResult).confidence_score : (grade as PregradeResponse).confidence;
  const m = isHistory ? grade as GradeResult : (grade as PregradeResponse).measurements;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px' }} onClick={onClose}>
      <div style={{ backgroundColor: '#16213e', borderRadius: '16px', width: '100%', maxWidth: '420px', maxHeight: '85vh', overflowY: 'auto', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h2 style={{ fontSize: '18px', margin: '0 0 4px' }}>Grade Report</h2>
            <div style={{ fontSize: '13px', color: '#8899aa' }}>{cardName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8899aa', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* PSA & BGS estimates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div style={{ backgroundColor: '#1a1a2e', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#8899aa', marginBottom: '6px', letterSpacing: '0.5px' }}>PSA ESTIMATE</div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: psaColor(psa ?? null) }}>{psa}</div>
            <div style={{ fontSize: '12px', color: '#8899aa', marginTop: '4px' }}>Range: {psaLow}–{psaHigh}</div>
          </div>
          <div style={{ backgroundColor: '#1a1a2e', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#8899aa', marginBottom: '6px', letterSpacing: '0.5px' }}>BGS ESTIMATE</div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: psaColor(bgs ?? null) }}>{bgs}</div>
            <div style={{ fontSize: '12px', color: '#8899aa', marginTop: '4px' }}>Range: {bgsLow}–{bgsHigh}</div>
          </div>
        </div>

        {/* Confidence */}
        <div style={{ marginBottom: '20px' }}>
          <ScoreBar label="Confidence" value={confidence ?? null} max={1} format={(v) => `${(v * 100).toFixed(0)}%`} />
        </div>

        {/* Measurements */}
        <h3 style={{ fontSize: '14px', marginBottom: '12px', color: '#8899aa', letterSpacing: '0.5px' }}>MEASUREMENTS</h3>
        <ScoreBar label="Centering (L/R)" value={m.centering_lr} max={50} format={(v) => `${v.toFixed(1)}%`} />
        <ScoreBar label="Centering (T/B)" value={m.centering_tb} max={50} format={(v) => `${v.toFixed(1)}%`} />
        <ScoreBar label="Edges" value={m.edge_score} />
        <ScoreBar label="Corners" value={m.corner_score} />
        <ScoreBar label="Surface" value={m.whitening_score} />

        <div style={{ marginTop: '16px', padding: '10px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', textAlign: 'center', fontSize: '11px', color: '#8899aa' }}>
          Visual pre-grade estimate only. Actual grades may vary.
        </div>
      </div>
    </div>
  );
}

// --- Main Grades Page ---

export default function GradesPage() {
  const [credits, setCredits] = useState<CreditInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [gradedItems, setGradedItems] = useState<GradedItem[]>([]);
  const [ungradedItems, setUngradedItems] = useState<CollectionItem[]>([]);
  const [gradingItemId, setGradingItemId] = useState<string | null>(null);
  const [gradingResult, setGradingResult] = useState<{ response: PregradeResponse; cardName: string } | null>(null);
  const [viewGrade, setViewGrade] = useState<{ grade: GradeResult; cardName: string } | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingItemRef = useRef<CollectionItem | null>(null);

  const loadCredits = useCallback(async () => {
    try {
      const res = await api.get('/credits');
      setCredits(res.data.pregrade);
    } catch { /* ignore */ }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const colRes = await api.get('/collections');
      if (colRes.data.length === 0) {
        setLoading(false);
        return;
      }
      const collections: { id: string }[] = colRes.data;
      const allItems: CollectionItem[] = [];
      await Promise.all(collections.map(async (col) => {
        const itemsRes = await api.get(`/collections/${col.id}/items`);
        allItems.push(...itemsRes.data);
      }));
      const items: CollectionItem[] = allItems;

      const graded: GradedItem[] = [];
      const ungraded: CollectionItem[] = [];

      await Promise.all(items.map(async (item) => {
        try {
          const gr = await api.get(`/grades/${item.id}`);
          if (gr.data.length > 0) {
            graded.push({ item, grade: gr.data[0] });
          } else {
            ungraded.push(item);
          }
        } catch {
          ungraded.push(item);
        }
      }));

      graded.sort((a, b) => (b.grade.estimated_psa_grade ?? 0) - (a.grade.estimated_psa_grade ?? 0));
      setGradedItems(graded);
      setUngradedItems(ungraded);
    } catch (err) {
      console.error('Failed to load items:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadCredits(); loadItems(); }, [loadCredits, loadItems]);

  const handleGradeClick = (item: CollectionItem) => {
    pendingItemRef.current = item;
    fileRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const item = pendingItemRef.current;
    if (!file || !item) return;
    e.target.value = '';

    setGradingItemId(item.id);
    setError('');
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('collectionItemId', item.id);
      const res = await api.post('/pregrade', form);
      setGradingResult({ response: res.data, cardName: item.name });
      setGradingItemId(null);
      loadCredits();
      loadItems();
    } catch (err: any) {
      setGradingItemId(null);
      if (err.response?.status === 403) {
        setError('No pre-grade credits remaining.');
        loadCredits();
      } else {
        setError(err.response?.data?.error || 'Grading failed');
      }
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8899aa' }}>
        <p style={{ fontSize: '16px' }}>Loading grades...</p>
      </div>
    );
  }

  const noCards = gradedItems.length === 0 && ungradedItems.length === 0;

  // No credits state
  if (credits && credits.remaining <= 0 && ungradedItems.length > 0) {
    // Show page but with warning
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />

      {/* Header + credits */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', margin: 0 }}>Grades</h1>
        {credits && (
          <span style={{ fontSize: '13px', color: '#8899aa', backgroundColor: '#16213e', padding: '6px 12px', borderRadius: '8px' }}>
            {credits.limit >= 999999 ? 'Unlimited' : `${credits.remaining} / ${credits.limit}`} pre-grades
          </span>
        )}
      </div>

      {error && (
        <div style={{ backgroundColor: 'rgba(233,69,96,0.15)', border: '1px solid #e94560', borderRadius: '8px', padding: '10px', marginBottom: '16px', color: '#e94560', fontSize: '14px', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {noCards && (
        <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '32px', textAlign: 'center', color: '#8899aa' }}>
          <p style={{ fontSize: '15px', marginBottom: '4px' }}>No cards to grade</p>
          <p style={{ fontSize: '13px' }}>Add cards to your collection first.</p>
        </div>
      )}

      {/* Graded cards */}
      {gradedItems.length > 0 && (
        <>
          <h2 style={{ fontSize: '16px', marginBottom: '10px' }}>Graded Cards</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {gradedItems.map(({ item, grade }) => (
              <div
                key={item.id}
                onClick={() => setViewGrade({ grade, cardName: item.name })}
                style={{ backgroundColor: '#16213e', borderRadius: '10px', padding: '14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid transparent' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#0f3460')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {item.image_url && <img src={item.image_url} alt={item.name} style={{ width: '40px', height: 'auto', borderRadius: '4px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>{item.name}</div>
                    <div style={{ fontSize: '12px', color: '#8899aa' }}>{item.set_name}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: '8px', fontSize: '14px', fontWeight: 700, color: '#fff', backgroundColor: psaColor(grade.estimated_psa_grade) }}>
                    PSA {grade.estimated_psa_grade}
                  </span>
                  <span style={{ fontSize: '12px', color: '#8899aa' }}>
                    BGS {grade.estimated_bgs_grade}
                  </span>
                  <span style={{ fontSize: '11px', color: '#8899aa' }}>
                    {grade.confidence_score != null ? `${(grade.confidence_score * 100).toFixed(0)}%` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Ungraded cards */}
      {ungradedItems.length > 0 && (
        <>
          <h2 style={{ fontSize: '16px', marginBottom: '10px' }}>Ungraded Cards</h2>
          {credits && credits.remaining <= 0 && (
            <div style={{ backgroundColor: 'rgba(233,69,96,0.15)', border: '1px solid #e94560', borderRadius: '10px', padding: '14px', marginBottom: '12px', textAlign: 'center' }}>
              <p style={{ color: '#e94560', fontSize: '14px', marginBottom: '4px' }}>No pre-grade credits remaining</p>
              <p style={{ color: '#8899aa', fontSize: '12px' }}>Upgrade your plan for more pre-grades.</p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {ungradedItems.map((item) => (
              <div key={item.id} style={{ backgroundColor: '#16213e', borderRadius: '10px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {item.image_url && <img src={item.image_url} alt={item.name} style={{ width: '40px', height: 'auto', borderRadius: '4px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>{item.name}</div>
                    <div style={{ fontSize: '12px', color: '#8899aa' }}>{item.set_name} · {item.number}</div>
                  </div>
                </div>
                {gradingItemId === item.id ? (
                  <span style={{ fontSize: '13px', color: '#e94560' }}>Analyzing...</span>
                ) : (
                  <button
                    onClick={() => handleGradeClick(item)}
                    disabled={credits != null && credits.remaining <= 0}
                    style={{
                      padding: '6px 14px', borderRadius: '6px', border: 'none',
                      backgroundColor: (credits && credits.remaining <= 0) ? '#333' : '#e94560',
                      color: '#fff', fontSize: '13px', cursor: (credits && credits.remaining <= 0) ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Grade
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Grade report modals */}
      {gradingResult && (
        <GradeReportModal
          grade={gradingResult.response}
          cardName={gradingResult.cardName}
          onClose={() => setGradingResult(null)}
        />
      )}
      {viewGrade && (
        <GradeReportModal
          grade={viewGrade.grade}
          cardName={viewGrade.cardName}
          onClose={() => setViewGrade(null)}
        />
      )}
    </div>
  );
}
