import sharp from 'sharp';
import brand from '../config/brand.js';

/**
 * Filigrane discret en bas à droite.
 *
 * Ce n'est pas qu'une marque commerciale : afficher qu'une image est simulée
 * est la condition juridique du produit. Sur les offres payantes, la mention
 * disparaît mais le widget continue d'afficher « vues simulées » sous la photo.
 */
export async function filigraner(buffer, texte = `généré par ${brand.name}`) {
  const img = sharp(buffer);
  const { width = 1024, height = 768 } = await img.metadata();
  const taille = Math.max(16, Math.round(width * 0.022));
  const marge = Math.round(taille * 0.9);

  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
       <text x="${width - marge}" y="${height - marge}" text-anchor="end"
             font-family="Georgia, serif" font-size="${taille}"
             fill="#F6F1E8" fill-opacity="0.82"
             stroke="#0B1220" stroke-opacity="0.35" stroke-width="${Math.max(1, taille * 0.06)}"
             paint-order="stroke">${echapper(texte)}</text>
     </svg>`
  );

  return img.composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Le texte finit dans du XML : il doit être échappé. */
function echapper(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Encode sans filigrane (offres payantes). */
export async function encoder(buffer) {
  return sharp(buffer).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}
