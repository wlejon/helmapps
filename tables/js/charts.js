/**
 * Column profiling chart renderer (2D Canvas bar/histogram chart using kit CSS tokens).
 */

function readToken(name, fallback) {
  try {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  } catch (_) {
    return fallback;
  }
}

export function drawProfileChart(canvas, profile) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 520, height: 145 };
  const w = Math.max(240, Math.floor(rect.width || 520));
  const h = Math.max(96, Math.floor(rect.height || 145));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  ctx.clearRect(0, 0, w, h);

  const buckets = profile && Array.isArray(profile.buckets) ? profile.buckets : [];
  if (buckets.length === 0) {
    ctx.fillStyle = readToken('--t3', '#8c96ab');
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Select a column in the sidebar to inspect distribution', w / 2, h / 2);
    return;
  }

  const accent = readToken('--accent', '#5b8cff');
  const gridCol = readToken('--hairline', 'rgba(255,255,255,0.08)');
  const textCol = readToken('--t2', '#c8d0e0');

  const padL = 12;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const plotW = Math.max(40, w - padL - padR);
  const plotH = Math.max(30, h - padT - padB);

  let maxCount = 1;
  for (const b of buckets) {
    if (b.count > maxCount) maxCount = b.count;
  }

  ctx.strokeStyle = gridCol;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  const slotW = plotW / buckets.length;
  const barW = Math.max(6, Math.min(48, slotW * 0.72));

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const frac = maxCount > 0 ? (b.count / maxCount) : 0;
    const barH = Math.max(2, Math.round(frac * plotH));
    const x = Math.round(padL + i * slotW + (slotW - barW) / 2);
    const y = Math.round(padT + plotH - barH);

    ctx.fillStyle = accent;
    ctx.fillRect(x, y, barW, barH);

    ctx.fillStyle = textCol;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const countLabel = String(b.count);
    if (y > padT + 10) {
      ctx.fillText(countLabel, x + barW / 2, y - 4);
    }

    const rawLbl = String(b.label ?? '');
    const shortLbl = rawLbl.length > 10 ? rawLbl.slice(0, 9) + '…' : rawLbl;
    ctx.fillText(shortLbl, x + barW / 2, padT + plotH + 15);
  }
}
