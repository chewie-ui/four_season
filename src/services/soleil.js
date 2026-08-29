/**
 * Position réelle du soleil.
 *
 * C'est la demande de l'agent immobilier, et elle est fondée : à Annecy
 * (45,9° N) le soleil culmine à 21° le 21 décembre et à 67° le 21 juin.
 * Une façade éclairée de plein fouet en été est rasée en hiver, les ombres
 * passent du simple au triple, et les reflets ne tombent pas au même endroit.
 * Un modèle d'image ne devine pas ça — il faut le lui dire.
 *
 * Algorithme : positions solaires basse précision (Astronomical Almanac),
 * exact à ~0,1°. Largement au-delà de ce qu'une photo peut montrer.
 * Aucune dépendance : c'est une centaine de lignes de trigonométrie.
 */

const RAD = Math.PI / 180;
const OBLIQUITE = 23.4397 * RAD; // inclinaison de l'axe terrestre

/** Jours écoulés depuis J2000.0 (1er janvier 2000, 12 h TU). */
function joursDepuisJ2000(date) {
  return date.getTime() / 86_400_000 - 10957.5;
}

/**
 * Hauteur et azimut du soleil pour un lieu et un instant.
 *
 * @param {number} latitude   degrés, positif au nord
 * @param {number} longitude  degrés, positif à l'est
 * @param {Date}   date       instant en temps universel
 * @returns {{hauteur: number, azimut: number}} degrés.
 *          hauteur : 0 = horizon, 90 = zénith, négatif = sous l'horizon.
 *          azimut  : 0 = nord, 90 = est, 180 = sud, 270 = ouest.
 */
export function position(latitude, longitude, date) {
  const d = joursDepuisJ2000(date);
  const phi = latitude * RAD;

  // Anomalie moyenne du Soleil
  const M = (357.5291 + 0.98560028 * d) * RAD;
  // Équation du centre : l'orbite terrestre n'est pas un cercle
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  // Longitude écliptique
  const lambda = M + C + 102.9372 * RAD + Math.PI;

  const declinaison = Math.asin(Math.sin(OBLIQUITE) * Math.sin(lambda));
  const ascension = Math.atan2(Math.cos(OBLIQUITE) * Math.sin(lambda), Math.cos(lambda));

  // Temps sidéral local, puis angle horaire
  const sideral = (280.16 + 360.9856235 * d) * RAD + longitude * RAD;
  const H = sideral - ascension;

  const hauteur = Math.asin(
    Math.sin(phi) * Math.sin(declinaison) + Math.cos(phi) * Math.cos(declinaison) * Math.cos(H)
  );

  // Azimut compté depuis le sud, vers l'ouest ; on le ramène depuis le nord.
  const azimutSud = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(phi) - Math.tan(declinaison) * Math.cos(phi)
  );

  return {
    hauteur: hauteur / RAD,
    azimut: (azimutSud / RAD + 180 + 360) % 360,
  };
}

/**
 * Lever, coucher et midi solaire, pour un jour donné.
 *
 * Résolu par balayage minute par minute plutôt que par la formule analytique :
 * 1440 évaluations coûtent moins d'une milliseconde, le code reste lisible,
 * et il gère naturellement les cas limites — nuit polaire, soleil de minuit,
 * latitudes extrêmes — là où la formule fermée produit des NaN silencieux.
 *
 * Le seuil de -0,833° tient compte de la réfraction atmosphérique et du
 * rayon apparent du disque solaire : c'est la définition officielle du lever.
 */
export function heuresCles(latitude, longitude, jour) {
  const debut = Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate(), 0, 0, 0);
  const SEUIL = -0.833;

  let lever = null;
  let coucher = null;
  let midi = null;
  let hauteurMax = -Infinity;
  let precedente = position(latitude, longitude, new Date(debut)).hauteur;

  for (let m = 1; m <= 1440; m++) {
    const t = new Date(debut + m * 60_000);
    const h = position(latitude, longitude, t).hauteur;

    if (h > hauteurMax) {
      hauteurMax = h;
      midi = t;
    }
    if (lever === null && precedente <= SEUIL && h > SEUIL) lever = t;
    if (coucher === null && precedente > SEUIL && h <= SEUIL) coucher = t;
    precedente = h;
  }

  return {
    lever,               // null si le soleil ne se lève pas ce jour-là
    coucher,             // null si le soleil ne se couche pas
    midiSolaire: midi,
    hauteurMaximale: hauteurMax,
    polaire: lever === null || coucher === null,
  };
}

/* ------------------------------------------------------ mise en mots ----- */

const ROSE = [
  'nord', 'nord-nord-est', 'nord-est', 'est-nord-est',
  'est', 'est-sud-est', 'sud-est', 'sud-sud-est',
  'sud', 'sud-sud-ouest', 'sud-ouest', 'ouest-sud-ouest',
  'ouest', 'ouest-nord-ouest', 'nord-ouest', 'nord-nord-ouest',
];

const ROSE_EN = [
  'north', 'north-north-east', 'north-east', 'east-north-east',
  'east', 'east-south-east', 'south-east', 'south-south-east',
  'south', 'south-south-west', 'south-west', 'west-south-west',
  'west', 'west-north-west', 'north-west', 'north-north-west',
];

export const pointCardinal = (deg) => ROSE[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
export const pointCardinalEn = (deg) => ROSE_EN[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

/**
 * Longueur de l'ombre portée, en multiples de la hauteur de l'objet.
 * Un mur de 3 m sous un soleil à 20° projette 8,2 m d'ombre ; à 60°, 1,7 m.
 * C'est ce rapport que le modèle doit respecter, pas une vague « ombre longue ».
 */
export function facteurOmbre(hauteurDeg) {
  if (hauteurDeg <= 0.5) return null; // soleil sous l'horizon ou rasant
  return 1 / Math.tan(hauteurDeg * RAD);
}

/**
 * Angle entre la direction du soleil et celle vers laquelle regarde la façade.
 * 0° = soleil pile en face (façade pleinement éclairée)
 * 90° = soleil de côté (relief marqué, l'éclairage le plus flatteur)
 * 180° = soleil derrière la maison (façade à contre-jour, dans son ombre)
 */
export function angleFacade(azimutSoleil, orientationFacade) {
  // Écart angulaire entre les deux directions, ramené dans [0, 180].
  // 0 signifie que le soleil vient exactement d'où la façade regarde :
  // elle lui fait face, donc elle est éclairée.
  return Math.abs(((((azimutSoleil - orientationFacade) % 360) + 540) % 360) - 180);
}

/** Décrit en anglais l'éclairement d'une façade, pour le prompt. */
export function decrireEclairement(angle) {
  if (angle <= 40) return 'the photographed facade is fully lit, front-lit by the sun';
  if (angle <= 80) return 'the photographed facade is lit at an angle, with strong relief and modelling';
  if (angle <= 110) return 'the sun grazes the facade almost edge-on, raking light across its texture';
  if (angle <= 140) return 'the photographed facade is largely in its own shade, lit mainly by skylight';
  return 'the photographed facade is backlit — in shade, with the sun behind the building';
}
