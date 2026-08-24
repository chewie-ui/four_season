/**
 * Comptes et authentification.
 *
 * Le hachage utilise `scrypt`, présent dans Node lui-même.
 *
 * Argon2id serait légèrement préférable en théorie, mais c'est un module
 * natif : il faut le compiler, il casse au changement de version de Node,
 * et ce projet a déjà payé assez cher les dépendances natives au
 * déploiement. scrypt est memory-hard, recommandé par l'OWASP, et ne
 * peut pas casser un `npm ci` un dimanche soir. Le jour où l'on veut
 * argon2, seules `hacher` et `verifier` changent — le format stocké porte
 * son propre préfixe d'algorithme pour permettre la migration.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { nanoid } from 'nanoid';

import { query, transaction } from '../db/pool.js';
import brand from '../config/brand.js';

const scrypt = promisify(scryptCb);

// N=2^16 : ~64 Mo de mémoire par calcul, ~100 ms sur un VPS modeste.
// Assez lourd pour décourager une attaque par dictionnaire, assez léger
// pour ne pas transformer une page de connexion en déni de service.
const SCRYPT = { N: 65536, r: 8, p: 1, taille: 64, maxmem: 128 * 1024 * 1024 };

const TENTATIVES_MAX = 8;
const BLOCAGE_MINUTES = 15;

export class ErreurAuth extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

/* ------------------------------------------------------------ hachage --- */

export async function hacher(motDePasse) {
  const sel = randomBytes(16);
  const derive = await scrypt(motDePasse.normalize('NFKC'), sel, SCRYPT.taille, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sel.toString('base64')}$${derive.toString('base64')}`;
}

export async function verifier(motDePasse, stocke) {
  try {
    const [algo, N, r, p, sel, attendu] = String(stocke).split('$');
    if (algo !== 'scrypt') return false;
    const derive = await scrypt(motDePasse.normalize('NFKC'), Buffer.from(sel, 'base64'), SCRYPT.taille, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
    const ref = Buffer.from(attendu, 'base64');
    return derive.length === ref.length && timingSafeEqual(derive, ref);
  } catch {
    return false;
  }
}

/* --------------------------------------------------------- inscription --- */

const slugifier = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 140) || 'agence';

/**
 * Crée l'agence, son utilisateur propriétaire, ses clés et ses crédits d'essai,
 * le tout dans une seule transaction : un compte à moitié créé serait
 * impossible à rattraper proprement.
 */
export async function inscrire({ agence, email, motDePasse, nom }) {
  const courriel = String(email).trim().toLowerCase();

  const existe = await query('SELECT id FROM users WHERE email = :e LIMIT 1', { e: courriel });
  if (existe.length) throw new ErreurAuth('Un compte existe déjà avec cette adresse.', 409);

  const hash = await hacher(motDePasse);
  const essai = brand.plans.find((p) => p.id === 'decouverte')?.credits ?? 15;

  let slug = slugifier(agence);
  const pris = await query('SELECT id FROM agencies WHERE slug = :s LIMIT 1', { s: slug });
  if (pris.length) slug = `${slug}-${nanoid(5).toLowerCase()}`;

  const jetonVerif = randomBytes(32).toString('hex');

  const agencyId = await transaction(async (conn) => {
    const [a] = await conn.execute(
      `INSERT INTO agencies (public_id, name, slug, plan_id, credits_balance, billing_email, watermark)
       VALUES (:pid, :nom, :slug, 'decouverte', :credits, :email, 1)`,
      { pid: nanoid(21), nom: String(agence).slice(0, 160), slug, credits: essai, email: courriel }
    );
    const id = a.insertId;

    await conn.execute(
      `INSERT INTO credit_ledger (agency_id, delta, reason, note)
       VALUES (:id, :d, 'essai', 'crédits offerts à l’inscription')`,
      { id, d: essai }
    );

    await conn.execute(
      `INSERT INTO users (agency_id, email, password_hash, full_name, role, jeton_verif)
       VALUES (:a, :e, :h, :n, 'owner', :j)`,
      { a: id, e: courriel, h: hash, n: nom ? String(nom).slice(0, 160) : null, j: jetonVerif }
    );

    return id;
  });

  return { agencyId, jetonVerif, credits: essai };
}

/* ----------------------------------------------------------- connexion --- */

export async function connecter(email, motDePasse) {
  const courriel = String(email).trim().toLowerCase();

  const rows = await query(
    `SELECT u.id, u.agency_id, u.password_hash, u.role, u.full_name,
            u.echecs_connexion, u.bloque_jusqu_a, u.email_verifie,
            a.status AS agence_statut
       FROM users u JOIN agencies a ON a.id = u.agency_id
      WHERE u.email = :e LIMIT 1`,
    { e: courriel }
  );

  // Message volontairement identique qu'il s'agisse d'un email inconnu ou
  // d'un mot de passe faux : sinon le formulaire devient un annuaire des
  // adresses inscrites.
  const refus = new ErreurAuth('Adresse ou mot de passe incorrect.', 401);
  if (!rows.length) {
    // On dépense quand même le temps d'un hachage, pour ne pas révéler
    // par la durée de réponse que l'adresse est inconnue.
    await hacher(String(motDePasse));
    throw refus;
  }

  const u = rows[0];

  if (u.bloque_jusqu_a && new Date(u.bloque_jusqu_a) > new Date()) {
    const minutes = Math.ceil((new Date(u.bloque_jusqu_a) - Date.now()) / 60000);
    throw new ErreurAuth(`Trop de tentatives. Réessayez dans ${minutes} minute(s).`, 429);
  }

  if (!(await verifier(motDePasse, u.password_hash))) {
    const echecs = u.echecs_connexion + 1;
    await query(
      `UPDATE users SET echecs_connexion = :n,
              bloque_jusqu_a = CASE WHEN :n >= :max THEN DATE_ADD(NOW(), INTERVAL :min MINUTE) ELSE NULL END
        WHERE id = :id`,
      { n: echecs, max: TENTATIVES_MAX, min: BLOCAGE_MINUTES, id: u.id }
    );
    throw refus;
  }

  if (u.agence_statut !== 'active') {
    throw new ErreurAuth('Ce compte est suspendu. Écrivez-nous.', 403);
  }

  await query(
    'UPDATE users SET echecs_connexion = 0, bloque_jusqu_a = NULL, last_login_at = NOW() WHERE id = :id',
    { id: u.id }
  );

  return { userId: u.id, agencyId: u.agency_id, role: u.role, nom: u.full_name, emailVerifie: Boolean(u.email_verifie) };
}

/* -------------------------------------------------------- verification --- */

export async function verifierEmail(jeton) {
  if (!/^[a-f0-9]{64}$/.test(String(jeton || ''))) return null;
  const rows = await query('SELECT id, agency_id FROM users WHERE jeton_verif = :j LIMIT 1', { j: jeton });
  if (!rows.length) return null;
  await query('UPDATE users SET email_verifie = 1, jeton_verif = NULL WHERE id = :id', { id: rows[0].id });
  return rows[0];
}

/* ------------------------------------------------ mot de passe oublie ---- */

export async function demanderReinitialisation(email) {
  const rows = await query('SELECT id FROM users WHERE email = :e LIMIT 1', {
    e: String(email).trim().toLowerCase(),
  });
  // On renvoie toujours un jeton nul si l'adresse est inconnue, et l'appelant
  // affiche le même message : le formulaire ne doit pas dire qui est inscrit.
  if (!rows.length) return null;

  const jeton = randomBytes(32).toString('hex');
  await query(
    'UPDATE users SET jeton_reset = :j, reset_expire = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = :id',
    { j: jeton, id: rows[0].id }
  );
  return jeton;
}

export async function reinitialiser(jeton, motDePasse) {
  if (!/^[a-f0-9]{64}$/.test(String(jeton || ''))) throw new ErreurAuth('Lien invalide.', 400);
  const rows = await query(
    'SELECT id FROM users WHERE jeton_reset = :j AND reset_expire > NOW() LIMIT 1',
    { j: jeton }
  );
  if (!rows.length) throw new ErreurAuth('Lien expiré ou déjà utilisé. Redemandez-en un.', 400);

  await query(
    `UPDATE users SET password_hash = :h, jeton_reset = NULL, reset_expire = NULL,
            echecs_connexion = 0, bloque_jusqu_a = NULL
      WHERE id = :id`,
    { h: await hacher(motDePasse), id: rows[0].id }
  );
  return true;
}

/* ------------------------------------------------------------- divers --- */

export const empreinte = (s) => createHash('sha256').update(String(s)).digest('hex');

/** Règles minimales, énoncées à l'utilisateur avant qu'il ne tape. */
export function validerMotDePasse(mdp) {
  const p = String(mdp || '');
  if (p.length < 10) return 'Le mot de passe doit faire au moins 10 caractères.';
  if (p.length > 200) return 'Mot de passe trop long.';
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return 'Ajoutez au moins une lettre et un chiffre.';
  return null;
}
