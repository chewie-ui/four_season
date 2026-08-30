/**
 * CATALOGUE DES AMBIANCES — le coeur métier de Four Seasons.
 *
 * Ce fichier est la source unique de vérité pour :
 *   1. les boutons affichés dans le widget et sur le site,
 *   2. la démo animée de la page d'accueil (tokens `visual`),
 *   3. les prompts envoyés à Gemini (champ `prompt`).
 *
 * Règle d'or du prompt d'édition : on décrit CE QUI CHANGE, puis on verrouille
 * explicitement CE QUI NE DOIT PAS CHANGER. Sans la clause de préservation,
 * le modèle a tendance à redessiner la maison.
 */

/**
 * Clause anti-dérive, ajoutée à CHAQUE prompt et toujours en dernier.
 *
 * Elle a été durcie après un rendu où le modèle avait ajouté des maisons
 * voisines qui n'existaient pas. La version précédente ne protégeait que
 * le bâtiment photographié : le modèle en déduisait qu'il pouvait redessiner
 * tout le reste. Un acheteur qui vient visiter doit reconnaître exactement
 * ce qu'il a vu en ligne — voisinage compris.
 *
 * Formulée en interdictions énumérées plutôt qu'en principe général : un
 * modèle d'image suit mieux « ne change pas le nombre de bâtiments » que
 * « reste fidèle ».
 */
export const PRESERVE_CLAUSE = [
  'ABSOLUTE CONSTRAINTS — this is a photo edit, not a new image.',
  'You are re-lighting an existing photograph. Every object present must stay,',
  'in the same place, with the same shape, the same size and the same materials.',

  'NEVER ADD anything that is not already in the photograph:',
  'no new house, no neighbouring building, no extension, no outbuilding, no shed,',
  'no wall, no fence, no hedge, no path, no vehicle, no person, no animal,',
  'no furniture, no decoration, no flowers, no planter, no pool, no terrace,',
  'no mountain, no hill, no lake, no tree that was not already there.',

  'NEVER REMOVE anything that is in the photograph, and never change its position.',

  'PRESERVE EXACTLY:',
  'the main building — roof shape, pitch and covering, number and exact position of every window and door,',
  'chimneys, balconies, facade materials, colour and texture, every visible detail of the walls;',
  'ALL other buildings visible in the frame, including neighbouring houses in the background —',
  'same number, same shapes, same roofs, same positions;',
  'the horizon line and the skyline profile;',
  'the ground layout — driveway, paths, terrace, pool, walls, fences, parked objects;',
  'the number, position, size and species of every tree and shrub;',
  'the exact camera position, angle, focal length, framing, perspective and aspect ratio.',
  'Do not zoom, do not crop, do not re-frame, do not extend the image beyond its original edges.',

  'ONLY THESE MAY CHANGE: the light, the colour and content of the sky, the weather,',
  'the seasonal state of the existing vegetation (leaves, blossom, bare branches),',
  'snow or water on the ground and on existing surfaces, and artificial lighting.',

  'The result must be recognisable, side by side with the original, as the very same',
  'property photographed from the very same spot at a different moment.',
  'Photorealistic real-estate photography, natural colours, no text, no watermark, no logo.',
].join(' ');

export const GROUPS = [
  { id: 'saison', label: 'Saisons', hint: "Le même bien au fil de l'année" },
  { id: 'moment', label: 'Moments', hint: 'Du lever au coucher du soleil' },
  { id: 'meteo', label: 'Météo', hint: "Les jours où il ne fait pas beau" },
];

export const SCENES = [
  // ---------------------------------------------------------------- SAISONS
  {
    id: 'printemps',
    group: 'saison',
    label: 'Printemps',
    short: 'Avril, 11 h',
    description: 'Verdure tendre, arbres en fleurs, lumière claire et douce.',
    visual: {
      skyTop: '#8FB8DA', skyBottom: '#D9E7F0', light: '#FFF3D6', lightAngle: 55,
      foliage: '#8FA98B', foliageAlt: '#B9CDA8', ground: '#A7BE95', wall: '#EFE7DA',
      roof: '#7C4B3A', glow: 0.35, stars: 0, rain: 0, snow: 0, blossom: 1, fog: 0,
    },
    prompt:
      'Transform the lighting and season of this real-estate photograph to a bright spring morning in April, around 11am. ' +
      'Fresh tender green foliage, trees and shrubs in bloom with delicate white and pink blossom, lawn a vivid young green, ' +
      'a few daffodils or tulips in the beds if beds exist. Soft high-key daylight, clear pale blue sky with light scattered cumulus, ' +
      'gentle diffused shadows.',
  },
  {
    id: 'ete',
    group: 'saison',
    label: 'Été',
    short: 'Juillet, 14 h',
    description: 'Plein soleil, ciel franc, ombres nettes, végétation dense.',
    visual: {
      skyTop: '#4E8FC4', skyBottom: '#BEDCEF', light: '#FFF6DC', lightAngle: 78,
      foliage: '#5E8B4E', foliageAlt: '#79A863', ground: '#8FAE6A', wall: '#F6EFE2',
      roof: '#8A5340', glow: 0.55, stars: 0, rain: 0, snow: 0, blossom: 0, fog: 0,
    },
    prompt:
      'Transform the lighting and season of this real-estate photograph to a bright summer afternoon in July, around 2pm. ' +
      'Deep saturated green foliage, dense healthy vegetation, lush lawn, deep blue clear sky with a few crisp white clouds. ' +
      'Strong high sun, crisp well-defined shadows, warm vibrant colours, high visual clarity.',
  },
  {
    id: 'automne',
    group: 'saison',
    label: 'Automne',
    short: 'Octobre, 17 h',
    description: 'Feuillages roux, lumière rasante et dorée, ambiance chaleureuse.',
    visual: {
      skyTop: '#C98A54', skyBottom: '#F2D7A8', light: '#FFC978', lightAngle: 18,
      foliage: '#C4703F', foliageAlt: '#E0A458', ground: '#B08A55', wall: '#F0E2CE',
      roof: '#7A4636', glow: 0.7, stars: 0, rain: 0, snow: 0, blossom: 0, fog: 0,
    },
    prompt:
      'Transform the lighting and season of this real-estate photograph to a golden autumn late afternoon in October, around 5pm. ' +
      'Foliage turned amber, copper, russet and gold, some fallen leaves scattered on the lawn and driveway, ' +
      'low warm raking sunlight from a shallow angle creating long soft shadows, amber-tinted hazy sky. Warm, cosy, inviting atmosphere.',
  },
  {
    id: 'hiver',
    group: 'saison',
    label: 'Hiver',
    short: 'Janvier, neige',
    description: 'Manteau de neige, arbres nus, lumière froide et calme.',
    visual: {
      skyTop: '#9FB4C7', skyBottom: '#E8EEF3', light: '#EAF2FA', lightAngle: 30,
      foliage: '#8A7F72', foliageAlt: '#B9AFA2', ground: '#F2F5F8', wall: '#EDE8E0',
      roof: '#E8EDF2', glow: 0.25, stars: 0, rain: 0, snow: 1, blossom: 0, fog: 0.15,
    },
    prompt:
      'Transform the lighting and season of this real-estate photograph to a calm winter day in January after a snowfall. ' +
      'A clean even layer of fresh snow on the roof, on the ground, on hedges and on the driveway, deciduous trees bare of leaves, ' +
      'evergreens dusted with snow, pale cool overcast winter light, soft blue-grey shadows, cold desaturated palette. ' +
      'Snow must follow the real geometry of the roof and terrain.',
  },

  {
    // Demander « Hiver sans neige » est contradictoire : l'ambiance Hiver
    // décrit la neige sur tout un paragraphe. C'est une ambiance à part
    // entière — et c'est l'hiver réel de la plupart des régions françaises,
    // où il neige quelques jours par an.
    id: 'hiver-sec',
    group: 'saison',
    label: 'Hiver sans neige',
    short: 'Février, sec',
    description: 'Arbres nus, herbe rase, lumière froide — sans un flocon.',
    visual: {
      skyTop: '#8FA3B5', skyBottom: '#D5DDE4', light: '#E2EBF2', lightAngle: 26,
      foliage: '#7E7468', foliageAlt: '#9C9184', ground: '#8C8C74', wall: '#EAE4DA',
      roof: '#6E5346', glow: 0.2, stars: 0, rain: 0, snow: 0, blossom: 0, fog: 0.1,
    },
    prompt:
      'Transform the lighting and season of this real-estate photograph to a cold, dry winter day in February, ' +
      'with NO SNOW anywhere — not on the ground, not on the roof, not on the vegetation. ' +
      'Deciduous trees and shrubs completely bare of leaves, grass short and dormant in muted olive and straw tones, ' +
      'evergreens dark and matt, bare earth visible in the beds. ' +
      'Cold pale winter light, low contrast, slightly desaturated palette, crisp clear air. ' +
      'This is the ordinary winter of most of France: cold and bare, but without snowfall.',
  },

  // ---------------------------------------------------------------- MOMENTS
  {
    id: 'aube',
    group: 'moment',
    label: 'Aube',
    short: '6 h 30',
    description: 'Première lumière rosée, calme absolu, rosée sur la pelouse.',
    visual: {
      skyTop: '#3E5273', skyBottom: '#E6A98C', light: '#FFC9A3', lightAngle: 8,
      foliage: '#5F7361', foliageAlt: '#7E9077', ground: '#7C8E75', wall: '#E7DCCF',
      roof: '#6C4638', glow: 0.5, stars: 0.25, rain: 0, snow: 0, blossom: 0, fog: 0.3,
    },
    prompt:
      'Transform this real-estate photograph to first light at dawn, around 6:30am. ' +
      'Pink and peach gradient sky near the horizon fading to deep blue overhead, sun just below or grazing the horizon, ' +
      'very long soft shadows, cool blue ambient shade with warm rim light on east-facing surfaces, ' +
      'light dew on the grass, faint ground mist. Serene, still, early-morning atmosphere.',
  },
  {
    id: 'midi',
    group: 'moment',
    label: 'Plein jour',
    short: '13 h',
    description: 'La référence : lumière neutre, tout est lisible.',
    visual: {
      skyTop: '#5C9AC9', skyBottom: '#CFE4F2', light: '#FFFBEF', lightAngle: 85,
      foliage: '#6B9155', foliageAlt: '#88AC6C', ground: '#93AF76', wall: '#F7F1E5',
      roof: '#87513E', glow: 0.45, stars: 0, rain: 0, snow: 0, blossom: 0, fog: 0,
    },
    prompt:
      'Transform this real-estate photograph to clear neutral midday light, around 1pm. ' +
      'Bright even daylight, blue sky with light clouds, balanced natural colours, short crisp shadows, ' +
      'maximum readability of the facade and the materials. This is the neutral reference rendering.',
  },
  {
    id: 'coucher',
    group: 'moment',
    label: 'Coucher de soleil',
    short: '20 h 45',
    description: "Heure dorée, façade embrasée, l'image qui fait cliquer.",
    visual: {
      skyTop: '#7E5A8C', skyBottom: '#F0A35E', light: '#FFB35C', lightAngle: 6,
      foliage: '#6A5F4A', foliageAlt: '#9A8659', ground: '#9C8459', wall: '#F6D9AE',
      roof: '#6E3F30', glow: 0.85, stars: 0.1, rain: 0, snow: 0, blossom: 0, fog: 0,
    },
    prompt:
      'Transform this real-estate photograph to golden hour at sunset. ' +
      'The sun very low on the horizon, intense warm golden-orange light raking across the facade, ' +
      'dramatic sky with orange, magenta and violet gradients, long shadows, warm highlights on every edge, ' +
      'a soft glow in the air. Cinematic but photorealistic.',
  },
  {
    id: 'heure-bleue',
    group: 'moment',
    label: 'Heure bleue',
    short: '21 h 30',
    description: 'Fenêtres allumées sur ciel indigo. La photo la plus vendeuse.',
    visual: {
      skyTop: '#101A34', skyBottom: '#3C5C86', light: '#FFD79A', lightAngle: 0,
      foliage: '#2C3B37', foliageAlt: '#42544A', ground: '#33413A', wall: '#5A6272',
      roof: '#2A2A33', glow: 0.9, stars: 0.5, rain: 0, snow: 0, blossom: 0, fog: 0, windowsLit: 1,
    },
    prompt:
      'Transform this real-estate photograph to blue hour, about 30 minutes after sunset. ' +
      'Deep indigo and cobalt sky with a faint warm glow at the horizon, exterior architectural lighting switched on, ' +
      'warm amber light glowing from every window, subtle pools of light on the terrace and path, ' +
      'the facade rendered in cool blue tones contrasting with the warm interior light. ' +
      'This is the classic premium real-estate twilight shot.',
  },
  {
    id: 'nuit',
    group: 'moment',
    label: 'Nuit',
    short: '23 h',
    description: 'Ciel étoilé, éclairage extérieur : vérifier le quartier la nuit.',
    visual: {
      skyTop: '#060B18', skyBottom: '#101B32', light: '#DCE7F5', lightAngle: 62,
      foliage: '#1B241F', foliageAlt: '#28332A', ground: '#1E2620', wall: '#3B4150',
      roof: '#1A1A22', glow: 0.6, stars: 1, rain: 0, snow: 0, blossom: 0, fog: 0, windowsLit: 1,
    },
    prompt:
      'Transform this real-estate photograph to a clear night, around 11pm. ' +
      'Dark star-filled night sky, the property lit only by its own exterior lighting and warm light from the windows, ' +
      'garden and path lights creating soft warm pools, moonlight giving a faint cool edge to the roof, ' +
      'deep but not crushed shadows — the architecture must remain readable.',
  },

  // ------------------------------------------------------------------ MÉTÉO
  {
    id: 'couvert',
    group: 'meteo',
    label: 'Ciel couvert',
    short: 'Lumière plate',
    description: 'Le test de vérité : à quoi ressemble le bien un jour gris ?',
    visual: {
      skyTop: '#8D98A4', skyBottom: '#C3CBD2', light: '#DDE3E8', lightAngle: 50,
      foliage: '#5E6E58', foliageAlt: '#77866D', ground: '#7E8C72', wall: '#E3DED5',
      roof: '#6F5245', glow: 0.15, stars: 0, rain: 0, snow: 0, blossom: 0, fog: 0.1,
    },
    prompt:
      'Transform this real-estate photograph to a fully overcast grey day. ' +
      'Uniform thick cloud cover, flat soft diffused light with almost no visible shadows, ' +
      'slightly desaturated cool palette, damp muted tones. Honest, everyday-weather rendering of the property.',
  },
  {
    id: 'pluie',
    group: 'meteo',
    label: 'Pluie',
    short: 'Sol mouillé',
    description: 'Reflets sur le sol mouillé, atmosphère intimiste.',
    visual: {
      skyTop: '#5A6673', skyBottom: '#98A6B2', light: '#C9D4DC', lightAngle: 45,
      foliage: '#4A5C46', foliageAlt: '#5E7256', ground: '#67766B', wall: '#D8D3CB',
      roof: '#5C443A', glow: 0.12, stars: 0, rain: 1, snow: 0, blossom: 0, fog: 0.25, windowsLit: 1,
    },
    prompt:
      'Transform this real-estate photograph to a rainy day. ' +
      'Heavy grey rain clouds, visible falling rain, wet reflective driveway and terrace mirroring the facade, ' +
      'water droplets on surfaces, saturated dark wet materials, small puddles following the real slope of the ground, ' +
      'warm light from the windows contrasting with the cool wet exterior. Cosy rather than gloomy.',
  },
  {
    id: 'brouillard',
    group: 'meteo',
    label: 'Brouillard',
    short: 'Matin brumeux',
    description: 'Brume matinale, profondeur, silhouette adoucie.',
    visual: {
      skyTop: '#AFB8BE', skyBottom: '#DCE1E3', light: '#EDF1F2', lightAngle: 35,
      foliage: '#6E7C6B', foliageAlt: '#8B978A', ground: '#93A08F', wall: '#E9E6DF',
      roof: '#7A6154', glow: 0.2, stars: 0, rain: 0, snow: 0, blossom: 0, fog: 0.75,
    },
    prompt:
      'Transform this real-estate photograph to a misty early morning with fog. ' +
      'Dense low-lying mist softening the background and distant trees into pale silhouettes, ' +
      'strong atmospheric depth, cool desaturated palette, the property itself remaining clear and readable in the foreground, ' +
      'diffused halo around any light source. Calm and slightly poetic.',
  },
  {
    id: 'neige-tombante',
    group: 'meteo',
    label: 'Neige qui tombe',
    short: 'Flocons',
    description: 'Chute de neige en cours, ambiance de fêtes.',
    visual: {
      skyTop: '#6E7C8C', skyBottom: '#C2CCD6', light: '#E9F1F8', lightAngle: 25,
      foliage: '#7C8478', foliageAlt: '#A7ADA1', ground: '#EDF2F6', wall: '#E6E2DA',
      roof: '#E3EAF1', glow: 0.3, stars: 0, rain: 0, snow: 1, blossom: 0, fog: 0.35, windowsLit: 1,
    },
    prompt:
      'Transform this real-estate photograph to an active snowfall scene. ' +
      'Large snowflakes visibly falling through the air, fresh snow accumulating on the roof, hedges and ground, ' +
      'soft grey-white sky, cool blue shadows, warm amber light glowing from the windows. ' +
      'Festive, cosy winter atmosphere. Snow accumulation must follow the real geometry of the roof and terrain.',
  },
];

/**
 * Ancrage temporel de chaque ambiance.
 *
 * C'est ce qui permet de calculer la position réelle du soleil. Deux façons
 * de situer un instant :
 *
 *   { mois, heure }               heure locale fixe
 *   { mois, moment, decalage }    relatif à un évènement solaire, en minutes
 *
 * La seconde forme est la bonne pour tout ce qui touche au soleil : « coucher
 * de soleil » n'est pas à 21 h — c'est à 15 h 54 le 21 décembre à Annecy et à
 * 19 h 30 le 21 juin. Une heure fixe donnerait un ciel faux une fois sur deux.
 */
export const ANCRAGE = {
  printemps:        { mois: 4,  heure: 11 },
  ete:              { mois: 7,  heure: 14 },
  automne:          { mois: 10, heure: 17 },
  hiver:            { mois: 1,  moment: 'midi' },
  'hiver-sec':      { mois: 2,  moment: 'midi' },

  aube:             { mois: 5,  moment: 'lever',   decalage: 15 },
  midi:             { mois: 5,  moment: 'midi' },
  coucher:          { mois: 7,  moment: 'coucher', decalage: -12 },
  'heure-bleue':    { mois: 7,  moment: 'coucher', decalage: 25 },
  nuit:             { mois: 7,  moment: 'coucher', decalage: 120 },

  couvert:          { mois: 11, heure: 14 },
  pluie:            { mois: 10, heure: 16 },
  brouillard:       { mois: 11, moment: 'lever',   decalage: 45 },
  'neige-tombante': { mois: 1,  heure: 15 },
};

// --- Tokens dérivés, uniquement pour la scène SVG de démonstration ---------
// Position horizontale de l'astre (0 = bord gauche, 1 = bord droit) et flocons.
const SUN_X = {
  printemps: 0.3, ete: 0.5, automne: 0.78, hiver: 0.32,
  aube: 0.12, midi: 0.5, coucher: 0.87, 'heure-bleue': 0.9, nuit: 0.22,
  couvert: 0.5, pluie: 0.55, brouillard: 0.35, 'neige-tombante': 0.5,
};
const FLAKES = { 'neige-tombante': 1 };
for (const s of SCENES) {
  s.visual.sunX = SUN_X[s.id] ?? 0.5;
  s.visual.flakes = FLAKES[s.id] ?? 0;
}

/** Ambiances mises en avant dans la démo de la page d'accueil (ordre = ordre du sélecteur). */
export const DEMO_ORDER = ['midi', 'coucher', 'heure-bleue', 'automne', 'hiver', 'pluie'];

export const sceneById = Object.fromEntries(SCENES.map((s) => [s.id, s]));
export const scenesByGroup = (g) => SCENES.filter((s) => s.group === g);

/** Construit le prompt complet envoyé à Gemini pour une ambiance donnée. */
export function buildPrompt(sceneId, extra = '') {
  const scene = sceneById[sceneId];
  if (!scene) throw new Error(`Ambiance inconnue : ${sceneId}`);
  return [scene.prompt, extra.trim(), PRESERVE_CLAUSE].filter(Boolean).join(' ');
}
