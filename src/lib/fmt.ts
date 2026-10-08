export const fmtNum = (n?: number | null): string => {
  if (n == null || !isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(4);
};

export const fmtUsd = (n?: number | null): string => (n == null || !isFinite(n) ? '—' : '$' + fmtNum(n));

export const fmtPrice = (n?: number | null): string => {
  if (n == null || !isFinite(n) || n === 0) return '—';
  if (n >= 0.01) return '$' + n.toFixed(4);
  // Tiny prices: show enough significant digits.
  const s = n.toExponential(2);
  const [m, e] = s.split('e-');
  return `$0.0{${Number(e) - 1}}${m.replace('.', '').slice(0, 3)}`;
};

export const fmtPct = (n?: number | null): string => (n == null || !isFinite(n) ? '' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%');

export const trunc = (s: string, head = 4, tail = 4): string => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

export const ago = (ts?: number | null): string => {
  if (!ts) return '';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
};
