/**
 * IDENTITÉ DE MARQUE — fichier unique.
 * Pour renommer tout le produit, il n'y a que ce fichier à modifier
 * (+ public/img/logo.svg). Tout le site lit ces valeurs.
 */
export const brand = {
  name: 'Four Season',
  legalName: 'Four Season SAS',
  domain: 'restockdesk.com',
  tagline: 'La même maison. Toutes ses saisons.',
  baseline:
    'Vos photos de biens, régénérées automatiquement en hiver, en été, au coucher du soleil ou sous la pluie. Vos acheteurs se projettent enfin.',
  email: 'contact@fourseason.fr',
  phone: '+33 6 00 00 00 00',

  /**
   * Palette — « Les quatre saisons sur nuit bleue ».
   * Chaque saison porte sa teinte ; la nuit profonde les tient ensemble.
   * Ces quatre couleurs sont celles des quadrants du logo.
   */
  colors: {
    nuit: '#0B1220',      // fond principal, bleu nuit profond
    nuitDoux: '#131E31',  // surfaces surélevées
    ardoise: '#243449',   // bordures, séparateurs
    creme: '#F6F1E8',     // texte sur fond sombre / fond des sections claires
    cremeDoux: '#E4DACB',
    or: '#E0A458',        // accent principal — l'été, la lumière chaude
    orClair: '#F2C879',
    ciel: '#7FA8C9',      // l'hiver, la lumière froide
    sauge: '#7A9E7E',     // le printemps
    rouille: '#C4703F',   // l'automne
    alerte: '#D9534F',
  },

  fonts: {
    display: "'Fraunces', 'Iowan Old Style', Georgia, serif",
    body: "'Familjen Grotesk', 'Helvetica Neue', Arial, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },

  // Tarifs affichés sur /tarifs — à réajuster après les premiers tests réels de coût.
  plans: [
    {
      id: 'decouverte',
      name: 'Découverte',
      price: 0,
      period: 'essai',
      credits: 15,
      pitch: 'Pour tester sur vos 3 prochains biens.',
      features: [
        '15 ambiances offertes',
        'Toutes les saisons et heures',
        'Widget à intégrer',
        'Filigrane Four Season',
      ],
      cta: 'Essayer gratuitement',
      highlight: false,
    },
    {
      id: 'agence',
      name: 'Agence',
      price: 79,
      period: 'mois',
      credits: 400,
      pitch: "Le forfait d'une agence qui publie 20 à 40 biens par mois.",
      features: [
        '400 ambiances / mois',
        'Sans filigrane',
        'Widget + API',
        'Génération automatique à la publication',
        'Support par email sous 24 h',
      ],
      cta: 'Choisir Agence',
      highlight: true,
    },
    {
      id: 'reseau',
      name: 'Réseau',
      price: null,
      period: 'sur devis',
      credits: null,
      pitch: 'Plusieurs agences, portail national ou promoteur.',
      features: [
        'Volume illimité négocié',
        'Marque blanche complète',
        'Connecteurs Apimo / Hektor / Netty',
        'SLA et interlocuteur dédié',
      ],
      cta: 'Nous contacter',
      highlight: false,
    },
  ],
};

export default brand;
