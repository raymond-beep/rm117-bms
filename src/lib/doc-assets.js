// Browser-side asset helpers shared by the document generators: load + trim the
// company logo, and normalize uploaded images to JPEG bytes for pdf-lib.
import logoUrl from '../assets/rm117-logo-black.png';

let logoPromise = null;

// Load the bundled black logo once and trim its transparent padding so the
// letterhead mark sits tight next to the firm name. Cached module-wide.
export function loadTrimmedLogo() {
  if (logoPromise) return logoPromise;
  logoPromise = (async () => {
    const blob = await (await fetch(logoUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let yy = 0; yy < height; yy++) {
      for (let xx = 0; xx < width; xx++) {
        if (data[(yy * width + xx) * 4 + 3] > 16) {
          if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
          if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
        }
      }
    }
    if (maxX < minX) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' };
    const pad = 2;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const c2 = document.createElement('canvas');
    c2.width = cw; c2.height = ch;
    c2.getContext('2d').drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
    const out = await new Promise((r) => c2.toBlob(r, 'image/png'));
    return { bytes: new Uint8Array(await out.arrayBuffer()), mime: 'image/png' };
  })();
  return logoPromise;
}

// Downscale + re-encode an image to JPEG bytes (phones shoot multi-MB; also
// normalizes formats pdf-lib can embed).
export async function imageToJpegBytes(file, maxDim = 1600, quality = 0.85) {
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataUrl;
  });
  let { width, height } = img;
  if (Math.max(width, height) > maxDim) {
    const s = maxDim / Math.max(width, height);
    width = Math.round(width * s); height = Math.round(height * s);
  }
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  c.getContext('2d').drawImage(img, 0, 0, width, height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}
