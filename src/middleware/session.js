/**
 * Session de la console agence.
 *
 * Volontairement minimal : pas encore de comptes ni de mots de passe.
 * L'agence se connecte avec sa clé secrète, **une seule fois**, sur une page
 * qui la vérifie côté serveur. Le navigateur ne reçoit ensuite qu'un cookie
 * signé contenant l'identifiant de l'agence — la clé secrète, elle, ne
 * descend jamais dans le navigateur et n'apparaît dans aucun JavaScript.
 *
 * Remplacé par une vraie authentification (email + argon2id) quand les
 * comptes seront construits. Le reste du code n'aura pas à bouger :
 * il lit `req.session.agencyId`.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import env from '../config/env.js';

const NOM = 'fourseason_session';
const DUREE_MS = 12 * 60 * 60 * 1000; // 12 h

const signer = (charge) =>
  createHmac('sha256', env.sessionSecret).update(charge).digest('base64url');

function fabriquer(agencyId) {
  const charge = Buffer.from(
    JSON.stringify({ a: agencyId, exp: Date.now() + DUREE_MS, n: randomBytes(6).toString('base64url') })
  ).toString('base64url');
  return `${charge}.${signer(charge)}`;
}

function lire(jeton) {
  if (typeof jeton !== 'string' || !jeton.includes('.')) return null;
  const [charge, signature] = jeton.split('.', 2);
  if (!charge || !signature) return null;

  const attendue = signer(charge);
  const a = Buffer.from(signature);
  const b = Buffer.from(attendue);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return { agencyId: Number(data.a) };
  } catch {
    return null;
  }
}

/** Lit le cookie et remplit `req.session`. Ne bloque jamais. */
export function session(req, res, next) {
  const brut = req.headers.cookie || '';
  const trouve = brut
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(NOM + '='));

  req.session = trouve ? lire(decodeURIComponent(trouve.slice(NOM.length + 1))) : null;

  res.ouvrirSession = (agencyId) => {
    res.cookie
      ? res.cookie(NOM, fabriquer(agencyId), cookieOptions())
      : res.setHeader('Set-Cookie', serialiser(NOM, fabriquer(agencyId), cookieOptions()));
  };
  res.fermerSession = () => {
    res.setHeader('Set-Cookie', serialiser(NOM, '', { ...cookieOptions(), maxAge: 0 }));
  };

  next();
}

function cookieOptions() {
  return {
    httpOnly: true,       // inaccessible au JavaScript : pas de vol par XSS
    sameSite: 'Lax',      // pas envoyé depuis un site tiers : anti-CSRF de base
    secure: env.isProd,   // HTTPS uniquement en production
    path: '/',
    maxAge: DUREE_MS,
  };
}

function serialiser(nom, valeur, o) {
  const bouts = [`${nom}=${encodeURIComponent(valeur)}`, `Path=${o.path}`, `Max-Age=${Math.floor(o.maxAge / 1000)}`];
  if (o.httpOnly) bouts.push('HttpOnly');
  if (o.secure) bouts.push('Secure');
  if (o.sameSite) bouts.push(`SameSite=${o.sameSite}`);
  return bouts.join('; ');
}

/** Barrière : redirige vers la connexion si la session est absente. */
export function exigerSession(req, res, next) {
  if (!req.session?.agencyId) {
    // `req.path` est relatif au point de montage du routeur : dans un routeur
    // monté sur /api/console il vaut « /biens ». C'est `originalUrl` qui porte
    // le chemin complet — sinon un appel fetch reçoit une redirection HTML
    // au lieu d'un 401, et le JavaScript client part en vrille.
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
    }
    return res.redirect('/console/connexion');
  }
  next();
}
