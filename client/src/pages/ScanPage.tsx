import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';

interface CreditInfo {
  used: number;
  limit: number;
  remaining: number;
}

interface CardResult {
  id: string;
  name: string;
  number: string | null;
  set_name: string;
  set_code: string;
  rarity: string | null;
  image_url: string | null;
}

interface ScanCandidate {
  card: CardResult;
  confidence: number;
}

interface ScanResponse {
  success: boolean;
  confidence: number;
  card: CardResult | null;
  addedToCollection?: boolean;
  candidates?: ScanCandidate[];
}

type Phase = 'choose' | 'camera' | 'preview' | 'hints' | 'scanning' | 'result';

export default function ScanPage() {
  const [credits, setCredits] = useState<CreditInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('choose');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hints, setHints] = useState({ cardName: '', cardNumber: '', setCode: '' });
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadCredits = useCallback(async () => {
    try {
      const res = await api.get('/credits');
      setCredits(res.data.scan);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadCredits(); }, [loadCredits]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setPhase('camera');
    } catch {
      setError('Could not access camera. Check permissions.');
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    stopCamera();
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'scan.jpg', { type: 'image/jpeg' });
        setImageFile(file);
        setImageUrl(URL.createObjectURL(blob));
        setPhase('preview');
      }
    }, 'image/jpeg', 0.85);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImageUrl(URL.createObjectURL(file));
      setPhase('preview');
    }
  };

  const handleRetake = () => {
    setImageFile(null);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    setPhase('choose');
  };

  const handleScan = async () => {
    if (!imageFile) return;
    setPhase('scanning');
    setError('');
    try {
      const form = new FormData();
      form.append('image', imageFile);
      if (hints.cardName) form.append('cardName', hints.cardName);
      if (hints.cardNumber) form.append('cardNumber', hints.cardNumber);
      if (hints.setCode) form.append('setCode', hints.setCode);
      const res = await api.post('/scan', form);
      setResult(res.data);
      setPhase('result');
      loadCredits();
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError('No scan credits remaining.');
        setPhase('choose');
        loadCredits();
      } else {
        setError(err.response?.data?.error || 'Scan failed');
        setPhase('hints');
      }
    }
  };

  const handleConfirmCandidate = async (candidate: ScanCandidate) => {
    setError('');
    try {
      await api.post('/scan/confirm', { cardId: candidate.card.id });
      setResult({ success: true, confidence: 1, card: candidate.card, addedToCollection: true });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add card');
    }
  };

  const resetScan = () => {
    setImageFile(null);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    setResult(null);
    setHints({ cardName: '', cardNumber: '', setCode: '' });
    setError('');
    setPhase('choose');
  };

  // No credits
  if (credits && credits.remaining <= 0 && phase === 'choose') {
    return (
      <div>
        <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Scan Card</h1>
        <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
          <p style={{ fontSize: '16px', marginBottom: '8px' }}>No scan credits remaining</p>
          <p style={{ color: '#8899aa', fontSize: '13px', marginBottom: '16px' }}>
            You've used {credits.used} / {credits.limit >= 999999 ? '∞' : credits.limit} scans this month.
          </p>
          <p style={{ color: '#8899aa', fontSize: '13px' }}>Upgrade your plan for more scans.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />

      {/* Credits bar */}
      {credits && phase !== 'camera' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h1 style={{ fontSize: '24px', margin: 0 }}>Scan Card</h1>
          <span style={{ fontSize: '13px', color: '#8899aa', backgroundColor: '#16213e', padding: '6px 12px', borderRadius: '8px' }}>
            {credits.limit >= 999999 ? 'Unlimited' : `${credits.remaining} / ${credits.limit}`} scans
          </span>
        </div>
      )}

      {error && (
        <div style={{ backgroundColor: 'rgba(233,69,96,0.15)', border: '1px solid #e94560', borderRadius: '8px', padding: '10px', marginBottom: '16px', color: '#e94560', fontSize: '14px', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* Phase: Choose input method */}
      {phase === 'choose' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={startCamera}
            style={{ backgroundColor: '#e94560', color: '#fff', border: 'none', borderRadius: '12px', padding: '24px', fontSize: '16px', fontWeight: 600, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
          >
            <span style={{ fontSize: '32px' }}>📷</span>
            Take Photo
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            style={{ backgroundColor: '#16213e', color: '#eee', border: '1px solid #0f3460', borderRadius: '12px', padding: '24px', fontSize: '16px', fontWeight: 600, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
          >
            <span style={{ fontSize: '32px' }}>📁</span>
            Upload Image
          </button>
        </div>
      )}

      {/* Phase: Camera live preview */}
      {phase === 'camera' && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: '#000', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ flex: 1, objectFit: 'cover', width: '100%' }}
          />
          <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', gap: '16px', backgroundColor: 'rgba(0,0,0,0.6)' }}>
            <button
              onClick={() => { stopCamera(); setPhase('choose'); }}
              style={{ padding: '14px 28px', borderRadius: '10px', border: '1px solid #888', backgroundColor: 'transparent', color: '#fff', fontSize: '15px', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={capturePhoto}
              style={{ padding: '14px 36px', borderRadius: '10px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}
            >
              Capture
            </button>
          </div>
        </div>
      )}

      {/* Phase: Image preview */}
      {phase === 'preview' && imageUrl && (
        <div>
          <div style={{ borderRadius: '12px', overflow: 'hidden', marginBottom: '16px', backgroundColor: '#16213e' }}>
            <img src={imageUrl} alt="Captured card" style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', display: 'block' }} />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleRetake}
              style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #0f3460', backgroundColor: 'transparent', color: '#8899aa', fontSize: '15px', cursor: 'pointer' }}
            >
              Retake
            </button>
            <button
              onClick={() => setPhase('hints')}
              style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}
            >
              Use this photo
            </button>
          </div>
        </div>
      )}

      {/* Phase: Card hints form */}
      {phase === 'hints' && (
        <div>
          {imageUrl && (
            <div style={{ borderRadius: '12px', overflow: 'hidden', marginBottom: '16px', backgroundColor: '#16213e' }}>
              <img src={imageUrl} alt="Card" style={{ width: '100%', maxHeight: '180px', objectFit: 'contain', display: 'block' }} />
            </div>
          )}
          <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', marginBottom: '12px' }}>Card Hints (optional)</h2>
            <p style={{ fontSize: '13px', color: '#8899aa', marginBottom: '16px' }}>Help improve matching accuracy.</p>
            <label style={{ display: 'block', color: '#8899aa', fontSize: '13px', marginBottom: '4px' }}>Card Name</label>
            <input
              type="text"
              placeholder="e.g. Charizard"
              value={hints.cardName}
              onChange={(e) => setHints({ ...hints, cardName: e.target.value })}
              style={inputStyle}
            />
            <label style={{ display: 'block', color: '#8899aa', fontSize: '13px', marginBottom: '4px' }}>Card Number</label>
            <input
              type="text"
              placeholder="e.g. 4/102"
              value={hints.cardNumber}
              onChange={(e) => setHints({ ...hints, cardNumber: e.target.value })}
              style={inputStyle}
            />
            <label style={{ display: 'block', color: '#8899aa', fontSize: '13px', marginBottom: '4px' }}>Set Code</label>
            <input
              type="text"
              placeholder="e.g. BS"
              value={hints.setCode}
              onChange={(e) => setHints({ ...hints, setCode: e.target.value })}
              style={{ ...inputStyle, marginBottom: 0 }}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleRetake}
              style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #0f3460', backgroundColor: 'transparent', color: '#8899aa', fontSize: '15px', cursor: 'pointer' }}
            >
              Back
            </button>
            <button
              onClick={handleScan}
              style={{ flex: 2, padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}
            >
              Scan & Identify
            </button>
          </div>
        </div>
      )}

      {/* Phase: Scanning */}
      {phase === 'scanning' && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', animation: 'pulse 1.5s infinite' }}>🔍</div>
          <p style={{ fontSize: '16px', marginBottom: '8px' }}>Scanning card...</p>
          <p style={{ fontSize: '13px', color: '#8899aa' }}>Identifying and matching your card</p>
          <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        </div>
      )}

      {/* Phase: Result */}
      {phase === 'result' && result && (
        <div>
          {/* High confidence match — auto-added */}
          {result.success && result.card && (
            <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
              {result.card.image_url ? (
                <img src={result.card.image_url} alt={result.card.name} style={{ width: '150px', height: 'auto', borderRadius: '8px', marginBottom: '12px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
              )}
              <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>{result.card.name}</h2>
              <p style={{ color: '#8899aa', fontSize: '13px', marginBottom: '4px' }}>
                {result.card.set_name} · {result.card.number}
              </p>
              <p style={{ fontSize: '13px', color: '#4caf50', marginBottom: '4px' }}>
                Confidence: {(result.confidence * 100).toFixed(0)}%
              </p>
              {result.addedToCollection && (
                <p style={{ fontSize: '14px', color: '#4caf50', marginBottom: '16px' }}>Added to your collection!</p>
              )}
              <button
                onClick={resetScan}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}
              >
                Scan another card
              </button>
            </div>
          )}

          {/* Low confidence — show candidates */}
          {!result.success && result.candidates && result.candidates.length > 0 && (
            <div>
              <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '20px', marginBottom: '16px', textAlign: 'center' }}>
                <p style={{ fontSize: '15px', marginBottom: '4px' }}>No exact match found</p>
                <p style={{ fontSize: '13px', color: '#8899aa' }}>
                  Confidence: {(result.confidence * 100).toFixed(0)}% — Did you mean one of these?
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {result.candidates.map((c) => (
                  <div key={c.card.id} style={{ backgroundColor: '#16213e', borderRadius: '10px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {c.card.image_url && <img src={c.card.image_url} alt={c.card.name} style={{ width: '60px', height: 'auto', borderRadius: '4px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600 }}>{c.card.name}</div>
                        <div style={{ fontSize: '12px', color: '#8899aa' }}>{c.card.set_name} · {c.card.number}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleConfirmCandidate(c)}
                      style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      This one
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={resetScan}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #0f3460', backgroundColor: 'transparent', color: '#8899aa', fontSize: '15px', cursor: 'pointer' }}
              >
                Try again
              </button>
            </div>
          )}

          {/* No match at all */}
          {!result.success && (!result.candidates || result.candidates.length === 0) && (
            <div style={{ backgroundColor: '#16213e', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>❌</div>
              <p style={{ fontSize: '16px', marginBottom: '8px' }}>No match found</p>
              <p style={{ color: '#8899aa', fontSize: '13px', marginBottom: '16px' }}>
                Try again with a clearer photo or add card hints.
              </p>
              <button
                onClick={resetScan}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#e94560', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}
              >
                Try again
              </button>
            </div>
          )}
        </div>
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
