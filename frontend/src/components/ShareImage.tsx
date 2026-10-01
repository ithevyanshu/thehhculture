import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share2, X } from 'lucide-react';
import { InstagramGlyph } from './Instagram';

/**
 * Turns a page into an Instagram-ready graphic.
 *
 * No website can post to Instagram: Meta's publishing API only works server-side for a
 * Business account you own, so there is no "post this" button to build. What does work
 * is handing the finished image to the phone's share sheet, where Instagram is one tap
 * away — and on desktop, downloading it with the caption on the clipboard.
 */

export interface ShareContent {
  /** Small line above the title: "New release", "Live", "News". */
  kicker: string;
  title: string;
  /** Under the title: artist name, venue and date, byline. Kept short on purpose. */
  subtitle?: string | null;
  /** Drawn above the text. Must allow cross-origin reads (Apple, Wikimedia and gstatic do). */
  imageUrl?: string | null;
  /** Printed small at the bottom of the card. */
  url: string;
  /** Pill label. Defaults to "Abhi sun" on a story, "Link in bio" on a feed post. */
  cta?: string;
}

type Format = 'story' | 'post';
const SIZES: Record<Format, { w: number; h: number; label: string; note: string }> = {
  story: { w: 1080, h: 1920, label: 'Story', note: '9:16' },
  post: { w: 1080, h: 1350, label: 'Feed post', note: '4:5' },
};

const PAPER = '#f2ecdf';
const INK = '#16130f';
const SAFFRON = '#f05a0a';

/**
 * Loads an image for canvas use.
 *
 * `crossOrigin` is required or the canvas is tainted and can't be exported at all, but
 * it also means a host that doesn't send CORS headers fails to load. Rather than
 * silently dropping the picture, that failure is reported so the editor knows why the
 * card came out text-only and can swap the image for one that works.
 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Greedy word wrap into at most `maxLines`.
 *
 * `truncated` is only true when words were actually left over — text that happens to
 * fill the last line exactly keeps its full stop instead of gaining a stray ellipsis.
 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let truncated = false;

  paragraphs: for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      if (lines.length >= maxLines) {
        truncated = true;
        line = '';
        break paragraphs;
      }
      line = word;
    }
    if (line) {
      if (lines.length >= maxLines) {
        truncated = true;
        break paragraphs;
      }
      lines.push(line);
    }
  }

  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return { lines, truncated };
}

/** "DHH/CULTURE" with the saffron slash. Returns the width it drew. */
function wordmark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string) {
  ctx.font = `400 ${size}px Anton, Impact, sans-serif`;
  let cursor = x;
  const part = (text: string, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillText(text, cursor, y);
    cursor += ctx.measureText(text).width;
  };
  part('DHH', colour);
  part('/', SAFFRON);
  part('CULTURE', colour);
  return cursor - x;
}

/** Solid triangle, for the play button on the story CTA. */
function playGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x + size * 0.88, y + size / 2);
  ctx.closePath();
  ctx.fill();
}

/** Rounded-rectangle pill. */
function pill(ctx: CanvasRenderingContext2D, x: number, y: number, pw: number, ph: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, pw, ph, ph / 2);
  ctx.fill();
}

/**
 * Splits a headline at its last colon: "Naam Sujal — 'Dola Re': Raw energy" becomes an
 * eyebrow line and a shorter headline, which reads far better at poster size than one
 * long string. Without a colon the subtitle does the eyebrow's job.
 */
function splitTitle(content: ShareContent) {
  const at = content.title.lastIndexOf(':');
  if (at > 8 && at < content.title.length - 4) {
    return { eyebrow: content.title.slice(0, at).trim(), headline: content.title.slice(at + 1).trim(), credit: content.subtitle ?? null };
  }
  return { eyebrow: content.subtitle ?? null, headline: content.title, credit: null };
}

/**
 * Draws the card: dark ground, wordmark and kicker badge along the top, the picture
 * full-bleed under it, and the words in a block at the foot.
 *
 * The feed post sets that block on a paper panel with a dark CTA; the story keeps
 * everything dark with a light CTA centred under it. Sizes are canvas pixels at 1080
 * wide, so both formats share one set of numbers.
 */
async function draw(canvas: HTMLCanvasElement, content: ShareContent, format: Format): Promise<{ imageFailed: boolean }> {
  const { w, h } = SIZES[format];
  const story = format === 'story';
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { imageFailed: false };

  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);

  const pad = 72;
  const frame = w - pad * 2;
  const { eyebrow, headline, credit } = splitTitle(content);

  // ---- Measure the foot block first; the picture takes whatever is left ----

  const eyebrowH = eyebrow ? 54 : 0;

  const titleMax = story ? 4 : 3;
  let size = 108;
  let lines: string[] = [];
  for (; size >= 52; size -= 6) {
    ctx.font = `400 ${size}px Anton, Impact, sans-serif`;
    const fit = wrap(ctx, headline.toUpperCase(), frame, titleMax);
    lines = fit.lines;
    if (!fit.truncated) break;
  }
  const lineH = Math.round(size * 1.02);

  const ctaLabel = (content.cta ?? (story ? 'Abhi sun' : 'Link in bio')).toUpperCase();
  ctx.font = '700 30px "Space Mono", monospace';
  const ctaTextW = ctx.measureText(ctaLabel).width;
  const ctaH = 86;
  const ctaW = ctaTextW + (story ? 116 : 122);

  const creditH = credit ? 46 : 0;
  // Post keeps the credit and the pill on one row; story stacks pill then link.
  const footH = story ? ctaH + 34 + 44 : ctaH;
  const blockH = eyebrowH + lines.length * lineH + 26 + creditH + 30 + footH;

  const panelTop = h - blockH - (story ? 96 : 88);
  const headerTop = story ? 96 : 60;
  const imageTop = headerTop + 92;

  // ---- Picture, full-bleed between the header and the foot ----

  const img = content.imageUrl ? await loadImage(content.imageUrl) : null;
  if (img) {
    const boxH = Math.max(180, panelTop - imageTop);
    const scale = Math.max(w / img.width, boxH / img.height);
    const sw = w / scale;
    const sh = boxH / scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, imageTop, w, boxH);
    ctx.clip();
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, imageTop, w, boxH);
    ctx.restore();
  }

  // ---- Header ----

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, imageTop);
  wordmark(ctx, pad, headerTop, 40, PAPER);

  const kicker = content.kicker.toUpperCase();
  ctx.font = '700 26px "Space Mono", monospace';
  const kw = ctx.measureText(kicker).width;
  if (story) {
    ctx.fillStyle = SAFFRON;
    ctx.fillRect(w - pad - kw - 34, headerTop - 6, kw + 34, 48);
    ctx.fillStyle = INK;
    ctx.fillText(kicker, w - pad - kw - 17, headerTop + 6);
  } else {
    ctx.fillStyle = SAFFRON;
    ctx.beginPath();
    ctx.arc(w - pad - kw - 24, headerTop + 14, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(kicker, w - pad - kw, headerTop + 2);
  }

  // ---- Foot block ----

  if (!story) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, panelTop, w, h - panelTop);
  }
  const onDark = story;
  let y = panelTop + (story ? 0 : 56);

  if (eyebrow) {
    ctx.font = '700 30px "Space Mono", monospace';
    ctx.fillStyle = SAFFRON;
    ctx.fillText(wrap(ctx, eyebrow, frame, 1).lines[0] ?? '', pad, y);
    y += eyebrowH;
  }

  ctx.font = `400 ${size}px Anton, Impact, sans-serif`;
  ctx.fillStyle = onDark ? PAPER : INK;
  for (const line of lines) {
    ctx.fillText(line, pad, y);
    y += lineH;
  }
  y += 26;

  if (credit) {
    ctx.font = '400 28px "Space Mono", monospace';
    ctx.fillStyle = onDark ? '#8a8174' : '#5c544a';
    ctx.fillText(wrap(ctx, credit, story ? frame : frame - 340, 1).lines[0] ?? '', pad, story ? y : h - 118);
    if (story) y += creditH;
  }

  // ---- Call to action ----

  if (story) {
    y += 30;
    const x = (w - ctaW) / 2;
    pill(ctx, x, y, ctaW, ctaH, PAPER);
    ctx.fillStyle = INK;
    playGlyph(ctx, x + 40, y + ctaH / 2 - 16, 32);
    ctx.font = '700 30px "Space Mono", monospace';
    ctx.fillText(ctaLabel, x + 96, y + ctaH / 2 - 15);
    y += ctaH + 34;

    ctx.font = '400 26px "Space Mono", monospace';
    ctx.fillStyle = '#8a8174';
    const link = content.url.replace(/^https?:\/\//, '');
    ctx.fillText(link, (w - ctx.measureText(link).width) / 2, y);
  } else {
    const x = w - pad - ctaW;
    const pillY = h - 118 - 22;
    pill(ctx, x, pillY, ctaW, ctaH, INK);
    ctx.font = '700 30px "Space Mono", monospace';
    ctx.fillStyle = PAPER;
    ctx.fillText(ctaLabel, x + 40, pillY + ctaH / 2 - 15);
    ctx.fillText('→', x + ctaW - 52, pillY + ctaH / 2 - 15);
  }

  return { imageFailed: !!content.imageUrl && !img };
}

function ShareDialog({ content, onClose }: { content: ShareContent; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState<Format>('story');
  const [busy, setBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    // Web fonts have to be ready or the canvas falls back to a system face.
    document.fonts.ready
      .then(() => draw(canvas, content, format))
      .then((r) => setImageFailed(!!r?.imageFailed))
      .finally(() => setBusy(false));
  }, [content, format]);

  // toBlob() returns undefined and answers through its callback, so it can't be chained
  // with ?? — doing that resolves the promise with null before the encoder ever replies.
  const toBlob = () =>
    new Promise<Blob | null>((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) return resolve(null);
      canvas.toBlob(resolve, 'image/png');
    });

  const fileName = `${content.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'dhhculture'}-${format}.png`;

  /** Phones: hand the file to the OS share sheet, where Instagram is one tap away. */
  const share = async () => {
    const blob = await toBlob();
    if (!blob) return setNote('Could not render the image');
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        setNote(null);
      } catch {
        /* the person dismissed the sheet */
      }
    } else {
      setNote('Sharing straight to apps only works on a phone. Download it and upload from Instagram instead.');
    }
  };

  const download = async () => {
    const blob = await toBlob();
    if (!blob) return setNote('Could not render the image');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="max-h-full w-full max-w-4xl overflow-y-auto border-2 border-ink bg-paper shadow-hard" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b-2 border-ink bg-surface px-4 py-3">
          <InstagramGlyph size={18} />
          <h2 className="display text-2xl">Share to Instagram</h2>
          <button className="btn-ghost ml-auto !px-3 !py-1.5" onClick={onClose}>
            <X size={14} /> Close
          </button>
        </header>

        <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,260px)_1fr]">
          <div>
            <canvas ref={canvasRef} className="w-full border-2 border-ink bg-surface shadow-hard-sm" aria-label="Preview of the image to share" />
            {busy && <p className="mono mt-2 text-dim">Drawing…</p>}
          </div>

          <div className="space-y-4">
            <div>
              <p className="label">Size</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(SIZES) as Format[]).map((f) => (
                  <button key={f} className={`chip ${format === f ? 'chip-active' : ''}`} onClick={() => setFormat(f)}>
                    {SIZES[f].label} <span className="text-dim">{SIZES[f].note}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {canShareFiles && (
                <button className="btn-primary" onClick={share} disabled={busy}>
                  <Share2 size={14} /> Share
                </button>
              )}
              <button className="btn-ghost" onClick={download} disabled={busy}>
                <Download size={14} /> Download
              </button>
            </div>

            <p className="text-xs text-dim">
              On a phone, <b>Share</b> opens the share sheet — pick Instagram and the image lands in the composer. On a computer, download it and upload it
              from Instagram.
            </p>
            {imageFailed && (
              <p className="border-2 border-red bg-red/10 px-3 py-2 text-sm text-red">
                That picture wouldn't load into the card — its host doesn't allow other sites to read it. The card is fine without it; swap in an image from
                another host if you want one.
              </p>
            )}
            {note && <p className="text-sm text-red">{note}</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The button itself. Render it only where you want it; it does no permission checks. */
export function ShareButton({ content, className = '' }: { content: ShareContent; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`btn-ghost !px-3 !py-2 ${className}`} onClick={() => setOpen(true)} title="Make an Instagram graphic">
        <InstagramGlyph size={14} /> Share
      </button>
      {open && <ShareDialog content={content} onClose={() => setOpen(false)} />}
    </>
  );
}

