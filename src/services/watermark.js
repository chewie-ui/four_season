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
       ${signature(width, height, taille, marge, texte)}
     </svg>`
  );

  return img
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

/**
 * Filigrane de la démonstration publique.
 *
 * ─────────────────────────────────────────────────────────────────────
 * CE QUE CELA FAIT, ET CE QUE CELA NE FAIT PAS.
 *
 * Aucun filigrane visible n'est indéracinable. Qui veut vraiment nettoyer
 * une image y arrivera : recadrage, tampon, ou un modèle de retouche qui
 * fera exactement l'inverse de ce que nous faisons ici. Promettre le
 * contraire serait mentir.
 *
 * Ce que l'on peut faire, c'est rendre l'opération plus coûteuse que
 * l'image ne vaut :
 *
 *   • RÉPÉTITION EN DIAGONALE sur toute la surface — recadrer n'enlève
 *     jamais tout, il faudrait recadrer jusqu'à ne plus rien avoir.
 *   • PASSAGE SUR LE SUJET, pas seulement sur le ciel ou l'herbe : effacer
 *     la mention oblige à reconstruire la façade, donc à abîmer ce que la
 *     personne venait justement chercher.
 *   • DOUBLE CONTOUR clair sur sombre : la marque reste lisible sur un
 *     ciel de nuit comme sur une façade blanche, et un simple réglage de
 *     contraste ne la fait pas disparaître.
 *   • SIGNATURE D'ANGLE pleinement opaque, pour l'attribution lisible.
 *   • MÉTADONNÉES dans le fichier, qui survivent à un recadrage — elles
 *     s'effacent en une commande, mais elles ne coûtent rien à poser.
 *
 * La vraie protection reste ailleurs : la démo est limitée en débit, les
 * rendus sont en basse définition, et un client qui veut l'image propre
 * a plus vite fait de payer 79 € que de retoucher vingt photos.
 * ─────────────────────────────────────────────────────────────────────
 */
export async function filigranerDemo(buffer, texte = brand.domain) {
  const img = sharp(buffer);
  const { width = 1024, height = 768 } = await img.metadata();

  const taille = Math.max(13, Math.round(width * 0.021));
  const marque = echapper(texte.toUpperCase());

  // Le pas doit dépendre de la LONGUEUR du texte, sinon les mentions se
  // chevauchent sur un nom long et se perdent sur un nom court.
  // Serré volontairement : espacer davantage laissait au centre de l'image
  // des plages nettes qu'un simple recadrage aurait suffi à récupérer.
  // 0,66 em par capitale en Georgia, plus les 0,18 em d'interlettrage :
  // oublier le second faisait se chevaucher les mentions, illisibles.
  const pasX = Math.round(taille * (marque.length * 0.84 + 3.5));
  const pasY = Math.round(taille * 3.1);

  // On déborde largement du cadre : une fois le motif incliné, les coins
  // resteraient nus si l'on s'arrêtait aux bords de l'image.
  const debord = Math.max(width, height);
  const traits = [];
  let ligne = 0;

  for (let y = -debord; y < height + debord; y += pasY) {
    // Une ligne sur deux est décalée d'un demi-pas : en quinconce, aucune
    // bande horizontale de l'image n'échappe au motif.
    const decalage = ligne % 2 ? Math.round(pasX / 2) : 0;
    for (let x = -debord + decalage; x < width + debord; x += pasX) {
      traits.push(
        `<text x="${x}" y="${y}" transform="rotate(-30 ${x} ${y})"
               font-family="Georgia, 'Times New Roman', serif" font-size="${taille}"
               letter-spacing="${(taille * 0.18).toFixed(2)}"
               fill="#FFFFFF" fill-opacity="0.23"
               stroke="#000000" stroke-opacity="0.17" stroke-width="${(taille * 0.07).toFixed(2)}"
               paint-order="stroke">${marque}</text>`
      );
    }
    ligne++;
  }

  const tailleSignature = Math.max(16, Math.round(width * 0.024));
  const marge = Math.round(tailleSignature * 0.9);

  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
       ${traits.join('')}
       ${signature(width, height, tailleSignature, marge, `démo — généré par ${brand.name}`)}
     </svg>`
  );

  return img
    .composite([{ input: svg, top: 0, left: 0 }])
    .withMetadata({
      exif: {
        IFD0: {
          Artist: brand.name,
          Copyright: `© ${brand.legalName} — ${brand.domain}`,
          ImageDescription: 'Vue simulée par intelligence artificielle. Ne represente pas l etat reel du bien.',
          Software: `${brand.name} (${brand.domain})`,
        },
      },
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

/** La mention d'angle, commune aux deux filigranes. */
function signature(width, height, taille, marge, texte) {
  return `<text x="${width - marge}" y="${height - marge}" text-anchor="end"
                font-family="Georgia, serif" font-size="${taille}"
                fill="#F6F1E8" fill-opacity="0.88"
                stroke="#0B1220" stroke-opacity="0.42" stroke-width="${Math.max(1, taille * 0.06)}"
                paint-order="stroke">${echapper(texte)}</text>`;
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
