/**
 * Adresse → coordonnées.
 *
 * Deux fournisseurs, tous deux gratuits et sans clé :
 *
 *   • la Base Adresse Nationale (api-adresse.data.gouv.fr) pour la France —
 *     précise à la porte, sans limite de débit, maintenue par l'État ;
 *   • Nominatim (OpenStreetMap) pour le reste, Belgique et Suisse comprises.
 *
 * Nominatim impose un User-Agent identifiable et une requête par seconde.
 * On géocode une fois par bien, à la saisie : on est très loin du plafond.
 *
 * Aucune clé d'API à gérer, donc rien de plus à configurer au déploiement —
 * et rien de plus à payer.
 */
import env from '../config/env.js';
import brand from '../config/brand.js';

const DELAI_MS = 8000;

export class ErreurGeocodage extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

/** Dernier appel à Nominatim, pour respecter leur limite d'une requête/seconde. */
let dernierNominatim = 0;

async function patienter(ms) {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} adresse texte libre saisi par l'agent
 * @param {string} [pays]  code ISO à deux lettres, si connu
 * @returns {Promise<{latitude, longitude, adresse, ville, codePostal, pays, precision, source}>}
 */
export async function geocoder(adresse, pays = '') {
  const texte = String(adresse || '').trim();
  if (texte.length < 4) throw new ErreurGeocodage('Adresse trop courte.');
  if (texte.length > 250) throw new ErreurGeocodage('Adresse trop longue.');

  const codePays = String(pays || '').trim().toUpperCase();
  const francais = !codePays || codePays === 'FR';

  if (francais) {
    const r = await viaBan(texte);
    if (r) return r;
  }
  return viaNominatim(texte, codePays);
}

/* ------------------------------------------------------------- France --- */

async function viaBan(texte) {
  const url = `https://api-adresse.data.gouv.fr/search/?limit=1&q=${encodeURIComponent(texte)}`;
  let rep;
  try {
    rep = await fetch(url, { signal: AbortSignal.timeout(DELAI_MS) });
  } catch {
    return null; // service muet : on laissera Nominatim tenter sa chance
  }
  if (!rep.ok) return null;

  const data = await rep.json().catch(() => null);
  const t = data?.features?.[0];
  if (!t) return null;

  const [lon, lat] = t.geometry.coordinates;
  const p = t.properties;

  return {
    latitude: lat,
    longitude: lon,
    adresse: p.label,
    ville: p.city || null,
    codePostal: p.postcode || null,
    pays: 'FR',
    // `score` de la BAN : 1 = correspondance parfaite. En dessous de 0,5,
    // l'adresse est probablement mal comprise — on le signale à l'agent.
    precision: p.score >= 0.8 ? 'exacte' : p.score >= 0.5 ? 'approchee' : 'incertaine',
    source: 'BAN',
  };
}

/* -------------------------------------------------------------- monde --- */

async function viaNominatim(texte, codePays) {
  const attente = 1100 - (Date.now() - dernierNominatim);
  await patienter(attente);
  dernierNominatim = Date.now();

  const params = new URLSearchParams({
    q: texte,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1',
  });
  if (codePays) params.set('countrycodes', codePays.toLowerCase());

  let rep;
  try {
    rep = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      signal: AbortSignal.timeout(DELAI_MS),
      headers: {
        // Exigé par leur politique d'usage. Sans en-tête identifiable,
        // ils bloquent — et ils ont raison.
        'User-Agent': `${brand.name}/1.0 (${env.baseUrl})`,
        'Accept-Language': 'fr',
      },
    });
  } catch {
    throw new ErreurGeocodage('Le service de géocodage ne répond pas. Réessayez.', 503);
  }
  if (!rep.ok) throw new ErreurGeocodage(`Géocodage indisponible (HTTP ${rep.status}).`, 503);

  const data = await rep.json().catch(() => []);
  const t = data[0];
  if (!t) throw new ErreurGeocodage('Adresse introuvable. Précisez la ville et le pays.', 404);

  const a = t.address || {};
  return {
    latitude: Number(t.lat),
    longitude: Number(t.lon),
    adresse: t.display_name,
    ville: a.city || a.town || a.village || a.municipality || null,
    codePostal: a.postcode || null,
    pays: (a.country_code || '').toUpperCase() || null,
    // Nominatim renvoie le type d'objet trouvé : une maison est bien plus
    // fiable qu'une ville entière pour calculer une position solaire.
    precision: ['house', 'building', 'residential'].includes(t.addresstype)
      ? 'exacte'
      : ['road', 'neighbourhood', 'suburb'].includes(t.addresstype)
        ? 'approchee'
        : 'incertaine',
    source: 'OpenStreetMap',
  };
}

/**
 * Le climat visuel d'une région, que la latitude seule ne dit pas.
 * Marseille et Bordeaux sont à la même latitude et ne se ressemblent en rien :
 * pins et pierre sèche d'un côté, feuillus et brique de l'autre.
 */
export function contexteRegional({ latitude, longitude, pays }) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat)) return null;

  // Méditerranée française et Corse
  if (pays === 'FR' && lat < 44 && lon > 3) {
    return 'Mediterranean southern France: umbrella pines, cypresses, olive trees, dry stone, ' +
      'terracotta roof tiles, intense luminous light, sparse dry vegetation';
  }
  // Sud-ouest atlantique
  if (pays === 'FR' && lat < 45.5 && lon < 1) {
    return 'south-west Atlantic France: maritime pines, vineyards, pale limestone, ' +
      'soft humid light';
  }
  // Alpes et Jura
  if (pays === 'FR' && lon > 5.5 && lat > 44.5) {
    return 'French Alpine foothills: conifers, mountain silhouettes on the horizon, ' +
      'crisp clear air, deep winter snow cover';
  }
  if (pays === 'BE' || pays === 'NL') {
    return 'Belgium and Low Countries: brick architecture, flat horizon, frequent overcast ' +
      'skies, diffuse northern light, deciduous trees';
  }
  if (pays === 'CH') {
    return 'Switzerland: alpine or lakeside setting, conifers, very clean air, ' +
      'mountains often visible in the background';
  }
  if (pays === 'FR' && lat > 48.5) {
    return 'northern France: slate and brick, deciduous trees, often overcast, ' +
      'soft low-contrast northern light';
  }
  if (pays === 'FR') {
    return 'temperate central France: deciduous trees, limestone and rendered facades, ' +
      'moderate seasonal contrast';
  }
  return null;
}
