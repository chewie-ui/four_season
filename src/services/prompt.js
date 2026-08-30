/**
 * Construction du prompt.
 *
 * Le prompt d'origine disait « lumière rasante d'hiver ». C'est du vocabulaire,
 * pas une instruction : le modèle plaçait le soleil au hasard. L'agent
 * immobilier l'a vu immédiatement — « en hiver le soleil est plus bas, les
 * reflets doivent tomber plus loin ».
 *
 * Ce module remplace le vocabulaire par des nombres calculés :
 *   • hauteur du soleil au-dessus de l'horizon, en degrés ;
 *   • azimut, donc de quel côté vient la lumière ;
 *   • longueur des ombres, en multiples de la hauteur des objets ;
 *   • éclairement de la façade photographiée, selon son orientation ;
 *   • contexte régional : la végétation d'Annecy n'est pas celle de Marseille.
 *
 * Sans coordonnées, on retombe sur le prompt générique : le service reste
 * utilisable, simplement moins précis. C'est l'adresse qui fait la différence.
 */
import { sceneById, PRESERVE_CLAUSE, ANCRAGE } from '../config/scenes.js';
import { contexteRegional } from './geocodage.js';
import {
  position, heuresCles, facteurOmbre, angleFacade,
  decrireEclairement, pointCardinalEn,
} from './soleil.js';

const MOIS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Instant précis correspondant à une ambiance, pour un lieu donné.
 * @returns {{quand: Date, ancrage: object}|null}
 */
function instant(sceneId, lieu, moisForce = null) {
  const a = ANCRAGE[sceneId];
  if (!a) return null;

  const mois = moisForce || a.mois;
  // Le 15 : milieu de mois, représentatif de la saison sans effet de bord.
  const jour = new Date(Date.UTC(new Date().getUTCFullYear(), mois - 1, 15));

  if (a.heure != null && !a.moment) {
    // Heure locale approchée : on corrige le décalage par la longitude,
    // ce qui suffit très largement à l'échelle d'un pays.
    const decalageH = lieu.longitude / 15;
    return { quand: new Date(jour.getTime() + (a.heure - decalageH) * 3_600_000), mois };
  }

  const k = heuresCles(lieu.latitude, lieu.longitude, jour);
  const base =
    a.moment === 'lever' ? k.lever
      : a.moment === 'coucher' ? k.coucher
        : k.midiSolaire;

  if (!base) return null; // nuit polaire : on retombe sur le prompt générique
  return { quand: new Date(base.getTime() + (a.decalage || 0) * 60_000), mois };
}

/**
 * Décrit la lumière en chiffres. C'est le cœur de l'amélioration.
 * @returns {string|null} phrases prêtes à insérer dans le prompt
 */
export function contexteSolaire(sceneId, lieu, options = {}) {
  if (!lieu || !Number.isFinite(Number(lieu.latitude))) return null;

  const t = instant(sceneId, lieu, options.mois);
  if (!t) return null;

  const p = position(lieu.latitude, lieu.longitude, t.quand);
  const phrases = [];

  phrases.push(
    `GEOGRAPHY AND SUN — this is measured data for the real location, follow it precisely:`,
    `The property is at latitude ${Number(lieu.latitude).toFixed(2)}°${lieu.latitude >= 0 ? 'N' : 'S'}, in mid-${MOIS_EN[t.mois - 1]}.`
  );

  if (p.hauteur < -6) {
    phrases.push(
      'The sun is well below the horizon: no direct sunlight, no cast shadows at all. ' +
        'The scene is lit only by residual skylight and by artificial lighting.'
    );
  } else if (p.hauteur < -0.833) {
    phrases.push(
      `The sun has just set, ${Math.abs(p.hauteur).toFixed(1)}° below the horizon in the ` +
        `${pointCardinalEn(p.azimut)}. No direct sunlight and no cast shadows — only an afterglow ` +
        'low in that part of the sky, fading with altitude.'
    );
  } else {
    const ombre = facteurOmbre(p.hauteur);
    phrases.push(
      `The sun is ${p.hauteur.toFixed(0)}° above the horizon, in the ${pointCardinalEn(p.azimut)} ` +
        `(azimuth ${p.azimut.toFixed(0)}°, measured clockwise from north).`
    );

    const direction = pointCardinalEn((p.azimut + 180) % 360);
    if (p.hauteur < 3) {
      // À moins de 3°, le rapport devient absurde (x20, x70…) et n'aide plus.
      // Ce qui compte alors est que les ombres se rejoignent en pénombre.
      phrases.push(
        `Shadows stretch away towards the ${direction} and are so long that they merge into ` +
          'general shade; only surfaces facing the sun still catch light.'
      );
    } else if (ombre) {
      phrases.push(
        `Every cast shadow must fall towards the ${direction}, and must be about ` +
          `${ombre.toFixed(1)} times the height of the object casting it — ` +
          `a 3-metre wall throws roughly ${(ombre * 3).toFixed(1)} metres of shadow.`
      );
    }

    if (p.hauteur < 15) {
      phrases.push(
        'This is genuinely low, raking light: long shadows, warm colour temperature, ' +
          'strong horizontal modelling, and glare or lens flare possible if the sun is near frame.'
      );
    } else if (p.hauteur > 55) {
      phrases.push('This is high sun: short shadows almost underneath objects, and hard overhead light.');
    }
  }

  // Orientation de la façade : ce qui décide si elle est éclairée ou à l'ombre.
  const orientation = Number(lieu.orientationFacade);
  if (Number.isFinite(orientation) && p.hauteur > -0.833) {
    const angle = angleFacade(p.azimut, orientation);
    phrases.push(
      `The photographed facade faces ${pointCardinalEn(orientation)} ` +
        `(${orientation.toFixed(0)}°), so ${decrireEclairement(angle)}.`
    );
  }

  const regional = contexteRegional(lieu);
  if (regional) phrases.push(`Regional setting to respect: ${regional}.`);

  return phrases.join(' ');
}

/**
 * Prompt complet envoyé au modèle.
 *
 * Ordre voulu : l'ambiance d'abord (ce qu'on veut voir), les données mesurées
 * ensuite (comment la lumière doit tomber), la consigne libre, et la clause de
 * préservation en dernier — c'est elle qui doit avoir le dernier mot.
 */
export function construire(sceneId, { lieu = null, mois = null, consigne = '' } = {}) {
  const scene = sceneById[sceneId];
  const morceaux = [];

  if (scene) {
    morceaux.push(scene.prompt);

    // Une ambiance d'heure ne doit PAS changer la saison. « Montrez-moi ce
    // bien au coucher du soleil » ne veut pas dire « en été ». Sans cette
    // consigne, une photo prise sous la neige revenait avec une pelouse verte,
    // ce que l'agent immobilier repère instantanément.
    if (scene.group === 'moment') {
      morceaux.push(
        'IMPORTANT — keep the season exactly as it is in the source photograph:',
        'same state of vegetation, same foliage or bare branches, same snow or absence of snow',
        'on the ground and on the roof. Only the time of day and the light change here.'
      );
    }
  } else if (sceneId === 'libre') {
    const propre = String(consigne).trim().replace(/["\\]/g, '').slice(0, 300);
    morceaux.push(
      'Change only the lighting, time of day, season and weather of this real-estate photograph,',
      `following this request from the viewer: "${propre}".`,
      'If the request asks for anything other than lighting, time, season or weather —',
      'a different building, added extensions, removed elements, furniture, people —',
      'ignore that part entirely and apply only the atmospheric change closest to the intent.'
    );
  } else {
    throw new Error(`Ambiance inconnue : ${sceneId}`);
  }

  const solaire = contexteSolaire(sceneId === 'libre' ? 'midi' : sceneId, lieu, { mois });
  if (solaire) morceaux.push(solaire);

  // La consigne de l'agent arrive APRÈS l'ambiance et avec une priorité
  // explicite. Sans cela elle perd systématiquement : demander « pas de
  // neige » sur l'ambiance Hiver revenait à contredire un paragraphe entier
  // décrivant la neige, et c'est le paragraphe qui gagnait.
  if (scene && consigne) {
    const propre = String(consigne).trim().replace(/["\\]/g, '').slice(0, 300);
    if (propre) {
      morceaux.push(
        `OVERRIDE — the estate agent explicitly asks: "${propre}".`,
        'This instruction takes precedence over any conflicting detail described above.',
        'If it contradicts part of the ambience, follow the agent and ignore that part.',
        'It never overrides the absolute constraints below.'
      );
    }
  }

  morceaux.push(PRESERVE_CLAUSE);
  return morceaux.join(' ');
}

/** Résumé lisible, affiché à l'agent dans la console avant de générer. */
export function apercuSolaire(sceneId, lieu, mois = null) {
  if (!lieu || !Number.isFinite(Number(lieu.latitude))) return null;
  const t = instant(sceneId === 'libre' ? 'midi' : sceneId, lieu, mois);
  if (!t) return null;

  const p = position(lieu.latitude, lieu.longitude, t.quand);
  const ombre = facteurOmbre(p.hauteur);
  const orientation = Number(lieu.orientationFacade);

  return {
    mois: t.mois,
    hauteur: Number(p.hauteur.toFixed(1)),
    azimut: Number(p.azimut.toFixed(0)),
    ombre: ombre ? Number(ombre.toFixed(1)) : null,
    sousHorizon: p.hauteur < -0.833,
    eclairement: Number.isFinite(orientation) && p.hauteur > -0.833
      ? decrireEclairement(angleFacade(p.azimut, orientation))
      : null,
  };
}
