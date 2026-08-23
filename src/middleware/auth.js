/**
 * Authentification des appels /api/v1/render.
 *
 * Deux chemins :
 *   - Authorization: Bearer sk_...   → serveur à serveur, pas de contrôle de domaine
 *   - body.cle = pk_...              → widget, contrôle Origin/Referer obligatoire
 */
import { resoudreCle, toucherCle, domaineAutorise } from '../services/keys.js';

class ErreurAuth extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

function extraireCle(req) {
  const entete = req.get('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(entete);
  if (bearer) return { cle: bearer[1].trim(), viaEntete: true };

  const corps = req.body?.cle || req.body?.key;
  if (corps) return { cle: String(corps).trim(), viaEntete: false };

  return { cle: null, viaEntete: false };
}

export async function authentifier(req, res, next) {
  try {
    const { cle, viaEntete } = extraireCle(req);
    if (!cle) throw new ErreurAuth('Clé API manquante.');

    const resolue = await resoudreCle(cle);
    if (!resolue) throw new ErreurAuth('Clé API invalide ou révoquée.', 403);

    if (resolue.kind === 'secret') {
      // Une clé secrète ne doit JAMAIS transiter par le corps d'une requête
      // partie d'un navigateur : ce serait la publier.
      if (!viaEntete) {
        throw new ErreurAuth(
          'Une clé secrète doit être transmise via l’en-tête Authorization, jamais dans le corps.',
          400
        );
      }
    } else {
      const origine = req.get('origin') || req.get('referer') || '';
      if (!(await domaineAutorise(resolue.agencyId, origine))) {
        throw new ErreurAuth(
          'Ce domaine n’est pas autorisé pour cette clé publique. Déclarez-le dans votre espace agence.',
          403
        );
      }
    }

    toucherCle(resolue.keyId);
    req.auth = resolue;
    next();
  } catch (err) {
    if (err instanceof ErreurAuth) {
      return res.status(err.status).json({ error: err.publicMessage });
    }
    next(err);
  }
}

/** CORS restreint aux domaines déclarés : le widget vit sur d'autres origines. */
export function corsWidget(req, res, next) {
  const origine = req.get('origin');
  if (origine) {
    res.set('Access-Control-Allow-Origin', origine);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
