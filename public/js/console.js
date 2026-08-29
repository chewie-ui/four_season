/* =====================================================================
   CONSOLE AGENCE
   Téléversement → cases à cocher → génération groupée → suivi → ZIP.
   ===================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const COUT_UNITAIRE = 0.036; // € par ambiance — voir services/gemini.js
  const PRESETS = {
    vendeur: ['coucher', 'heure-bleue', 'hiver'],
    saisons: ['printemps', 'ete', 'automne', 'hiver'],
  };

  let bienActuel = null;
  let sondage = null;

  /* ------------------------------------------------------ téléversement */

  const depot = $('[data-depot]');
  const fichier = $('#photo');
  const apercu = $('[data-depot-apercu]');
  const zoneVide = $('[data-depot-vide]');
  const boutonChanger = $('[data-changer]');

  const ouvrirSelecteur = () => fichier.click();
  depot.addEventListener('click', (e) => {
    if (e.target.closest('[data-changer]')) return;
    ouvrirSelecteur();
  });
  $('[data-parcourir]').addEventListener('click', (e) => { e.stopPropagation(); ouvrirSelecteur(); });
  boutonChanger.addEventListener('click', (e) => { e.stopPropagation(); ouvrirSelecteur(); });

  ['dragenter', 'dragover'].forEach((t) =>
    depot.addEventListener(t, (e) => { e.preventDefault(); depot.classList.add('survol'); })
  );
  ['dragleave', 'drop'].forEach((t) =>
    depot.addEventListener(t, (e) => { e.preventDefault(); depot.classList.remove('survol'); })
  );
  depot.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) { fichier.files = e.dataTransfer.files; montrerApercu(f); }
  });
  fichier.addEventListener('change', () => {
    const f = fichier.files?.[0];
    if (f) montrerApercu(f);
  });

  function montrerApercu(f) {
    apercu.src = URL.createObjectURL(f);
    apercu.hidden = false;
    zoneVide.hidden = true;
    boutonChanger.hidden = false;
    // Nouvelle photo = nouveau bien : on repart d'une galerie vierge.
    bienActuel = null;
    arreterSondage();
    $('[data-galerie]').hidden = true;
    if (!$('#titre').value) $('#titre').value = f.name.replace(/\.[^.]+$/, '').slice(0, 120);
    majBouton();
  }

  /* ---------------------------------------------------------- ambiances */

  const cases = $$('input[name="scene"]');
  const libreActif = $('[data-libre-actif]');
  const libreTexte = $('[data-libre]');

  cases.forEach((c) => c.addEventListener('change', () => { majGroupes(); majBouton(); rafraichirSoleil(); }));

  $$('[data-groupe-tout]').forEach((tout) => {
    tout.addEventListener('change', () => {
      const g = tout.dataset.groupeTout;
      cases.filter((c) => c.dataset.groupe === g).forEach((c) => (c.checked = tout.checked));
      majBouton();
    });
  });

  function majGroupes() {
    $$('[data-groupe-tout]').forEach((tout) => {
      const g = tout.dataset.groupeTout;
      const membres = cases.filter((c) => c.dataset.groupe === g);
      const coches = membres.filter((c) => c.checked).length;
      tout.checked = coches === membres.length;
      tout.indeterminate = coches > 0 && coches < membres.length;
    });
  }

  $$('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = b.dataset.preset;
      if (p === 'tout') cases.forEach((c) => (c.checked = true));
      else if (p === 'rien') { cases.forEach((c) => (c.checked = false)); libreActif.checked = false; }
      else {
        const liste = PRESETS[p] || [];
        cases.forEach((c) => (c.checked = liste.includes(c.value)));
      }
      libreTexte.disabled = !libreActif.checked;
      majGroupes();
      majBouton();
    })
  );

  libreActif.addEventListener('change', () => {
    libreTexte.disabled = !libreActif.checked;
    if (libreActif.checked) libreTexte.focus();
    majBouton();
  });
  libreTexte.addEventListener('input', majBouton);

  const selection = () => cases.filter((c) => c.checked).map((c) => c.value);
  const consigne = () => (libreActif.checked ? libreTexte.value.trim() : '');

  function majBouton() {
    const n = selection().length + (consigne() ? 1 : 0);
    $('[data-compte]').textContent = n;
    $('[data-pluriel]').textContent = n > 1 ? 's' : '';
    $('[data-cout]').textContent = (n * COUT_UNITAIRE).toFixed(2).replace('.', ',') + ' €';
    // Les générations sont parallélisées côté worker : la durée n'est pas linéaire.
    $('[data-duree]').textContent = n <= 4 ? '15 s' : `${Math.ceil(n / 4) * 15} s`;
    // Une photo peut venir du disque (nouveau bien) ou déjà exister en base
    // (bien rouvert depuis « Biens récents ») : les deux cas sont valides.
    const aUnePhoto = Boolean(fichier.files?.[0]) || Boolean(bienActuel?.sources?.length);
    $('[data-generer]').disabled = n === 0 || !aUnePhoto;
  }

  /* ------------------------------------------------------- localisation */

  const etatLoc = $('[data-localisation-etat]');
  const boutonLoc = $('[data-localiser]');
  const selectMois = $('[data-mois]');

  const CARDINAUX = {
    0: 'nord', 45: 'nord-est', 90: 'est', 135: 'sud-est',
    180: 'sud', 225: 'sud-ouest', 270: 'ouest', 315: 'nord-ouest',
  };
  const carte = (d) => CARDINAUX[Math.round(d / 45) * 45 % 360] || d + '°';

  boutonLoc.addEventListener('click', async () => {
    const adresse = $('#adresse').value.trim();
    if (!adresse && !$('#orientation').value) {
      etatLoc.textContent = 'Saisissez une adresse.';
      return;
    }
    if (!bienActuel) {
      etatLoc.textContent = 'Envoyez d’abord une photo : la localisation se rattache au bien.';
      return;
    }

    boutonLoc.disabled = true;
    etatLoc.textContent = 'Recherche de l’adresse…';
    try {
      const rep = await fetch(`/api/console/biens/${bienActuel.publicId}/localiser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adresse,
          pays: $('#pays').value,
          orientation: $('#orientation').value,
          mois: selectMois.value,
        }),
      });
      const data = await rep.json();
      if (!rep.ok) throw new Error(data.error || 'Localisation impossible.');

      bienActuel = data.bien;
      const l = data.bien.lieu;
      if (l) {
        const fiabilite = l.precision === 'exacte' ? '' :
          l.precision === 'approchee' ? ' — adresse approchée, vérifiez' :
            ' — adresse incertaine, précisez la rue et la ville';
        etatLoc.innerHTML = `<span style="color:var(--or-clair)">${echapper(l.adresse)}</span>` +
          `<span class="doux"> (${l.latitude.toFixed(3)}, ${l.longitude.toFixed(3)})${fiabilite}</span>`;
        $('#adresse').value = l.adresse;
      }
      dessinerSoleil(data.soleil);
    } catch (err) {
      etatLoc.innerHTML = `<span style="color:#FF9B96">${echapper(err.message)}</span>`;
    } finally {
      boutonLoc.disabled = false;
    }
  });

  // Changer de mois recalcule la position du soleil sans rien régénérer.
  selectMois.addEventListener('change', async () => {
    majBouton();
    if (!bienActuel?.lieu) return;
    const rep = await fetch(
      `/api/console/biens/${bienActuel.publicId}?mois=${encodeURIComponent(selectMois.value)}`
    );
    if (rep.ok) dessinerSoleil((await rep.json()).soleil);
  });

  /**
   * Montre à l'agent ce que le modèle va recevoir, ambiance par ambiance.
   * C'est ce qui rend le calcul vérifiable au lieu d'être une boîte noire :
   * il peut confronter « soleil à 21°, ombres vers le nord » à ce qu'il sait
   * du terrain, et corriger l'orientation si ça ne colle pas.
   */
  function dessinerSoleil(soleil) {
    dernierSoleil = soleil;
    const boite = $('[data-soleil]');
    const liste = $('[data-soleil-liste]');
    if (!soleil) { boite.hidden = true; return; }

    const choisies = selection();
    const aMontrer = choisies.length ? choisies : ['midi', 'coucher', 'hiver', 'ete'];

    liste.innerHTML = aMontrer
      .filter((s) => soleil[s])
      .map((s) => {
        const a = soleil[s];
        const label = document.querySelector(`input[name=scene][value="${s}"]`)
          ?.closest('.c-case')?.querySelector('b')?.textContent || s;
        const detail = a.sousHorizon
          ? 'soleil sous l’horizon — aucune ombre portée'
          : `soleil à <b>${a.hauteur}°</b> au ${carte(a.azimut)}` +
            (a.ombre ? `, ombres × ${a.ombre}` : '');
        return `<div class="c-case" style="cursor:default;flex-direction:column;align-items:flex-start;gap:.25rem">
            <b style="font-size:.9rem">${echapper(label)}</b>
            <span class="doux" style="font-size:.82rem">${detail}</span>
            ${a.eclairement ? `<span class="doux" style="font-size:.78rem;opacity:.75">${echapper(traduireEclairement(a.eclairement))}</span>` : ''}
          </div>`;
      })
      .join('');
    boite.hidden = false;
  }

  const traduireEclairement = (en) =>
    /fully lit/.test(en) ? 'façade en pleine lumière'
      : /at an angle/.test(en) ? 'façade éclairée de biais, beau relief'
        : /edge-on/.test(en) ? 'lumière rasante sur la façade'
          : /own shade/.test(en) ? 'façade surtout à l’ombre'
            : 'façade à contre-jour';

  /** Redessine l'aperçu solaire quand la sélection d'ambiances change. */
  let dernierSoleil = null;
  function rafraichirSoleil() { if (dernierSoleil) dessinerSoleil(dernierSoleil); }

  /* --------------------------------------------------------- génération */

  const message = $('[data-message]');
  const dire = (txt, type = '') =>
    (message.innerHTML = txt ? `<p class="${type}" style="margin:0">${txt}</p>` : '');

  $('[data-generer]').addEventListener('click', async () => {
    const bouton = $('[data-generer]');
    bouton.disabled = true;
    dire('Envoi de la photo…');

    try {
      if (!bienActuel) {
        const form = new FormData();
        form.append('photo', fichier.files[0]);
        form.append('titre', $('#titre').value);
        form.append('ville', $('#ville').value);
        form.append('reference', $('#reference').value);

        const rep = await fetch('/api/console/biens', { method: 'POST', body: form });
        const data = await rep.json();
        if (!rep.ok) throw new Error(data.error || 'Téléversement impossible.');
        bienActuel = data.bien;
      }

      dire('Mise en file…');
      const rep = await fetch(`/api/console/biens/${bienActuel.publicId}/generer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenes: selection(), consigne: consigne(), mois: selectMois.value || null }),
      });
      const data = await rep.json();
      if (!rep.ok) throw new Error(data.error || 'Génération impossible.');

      dire(`${data.lances} ambiance${data.lances > 1 ? 's' : ''} en cours de génération.`, 'ok');
      $('[data-galerie]').hidden = false;
      $('[data-galerie]').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      demarrerSondage();
    } catch (err) {
      dire(err.message, 'err');
      bouton.disabled = false;
    }
  });

  /* ------------------------------------------------------------ suivi */

  function demarrerSondage() {
    arreterSondage();
    rafraichir();
    sondage = setInterval(rafraichir, 2000);
  }
  function arreterSondage() {
    if (sondage) clearInterval(sondage);
    sondage = null;
  }

  async function rafraichir() {
    if (!bienActuel) return;
    try {
      const rep = await fetch(`/api/console/biens/${bienActuel.publicId}`);
      if (!rep.ok) return;
      const { bien, credits } = await rep.json();
      bienActuel = bien;
      $('[data-credits]').textContent = `${credits} crédits`;
      dessinerGalerie(bien);

      const reste = bien.variantes.some((v) => v.statut === 'pending' || v.statut === 'processing');
      if (!reste) {
        arreterSondage();
        $('[data-generer]').disabled = false;
        majBouton();
      }
    } catch { /* réseau capricieux : le prochain tour réessaiera */ }
  }

  function dessinerGalerie(bien) {
    const grille = $('[data-grille]');
    const pretes = bien.variantes.filter((v) => v.statut === 'ready');
    const total = bien.variantes.length;

    $('[data-avancement]').textContent =
      `${pretes.length} / ${total} prête${pretes.length > 1 ? 's' : ''}`;

    const zip = $('[data-zip]');
    zip.hidden = pretes.length === 0;
    zip.href = `/api/console/biens/${bien.publicId}/zip`;
    $('[data-code]').hidden = pretes.length === 0;

    const morceaux = [];

    if (bien.sources[0]) {
      morceaux.push(vignette({
        url: bien.sources[0].url,
        label: 'Photo d’origine',
        scene: 'origine',
        statut: 'ready',
      }));
    }
    bien.variantes.forEach((v) => morceaux.push(vignette(v)));

    grille.innerHTML = morceaux.join('');

    $$('.c-vignette.prete', grille).forEach((el) =>
      el.addEventListener('click', () => ouvrirLoupe(el.dataset.url, el.dataset.label))
    );
  }

  function vignette(v) {
    const label = v.label || v.scene;
    if (v.statut === 'ready') {
      return `<figure class="c-vignette prete" data-url="${v.url}" data-label="${echapper(label)}">
        <img src="${v.url}" alt="${echapper(label)}" loading="lazy">
        <figcaption><b>${echapper(label)}</b><a href="${v.url}" download onclick="event.stopPropagation()">↓</a></figcaption>
      </figure>`;
    }
    if (v.statut === 'failed') {
      return `<figure class="c-vignette echec">
        <div class="c-etat"><b>Échec</b>${echapper((v.erreur || '').slice(0, 90))}</div>
        <figcaption><b>${echapper(label)}</b></figcaption>
      </figure>`;
    }
    const enCours = v.statut === 'processing';
    return `<figure class="c-vignette attente">
      <div class="c-etat">
        ${enCours ? '<div class="c-rond"></div>' : ''}
        <b>${enCours ? 'Génération' : 'En file'}</b>
        ${enCours ? 'environ 15 s' : 'démarre bientôt'}
      </div>
      <figcaption><b>${echapper(label)}</b></figcaption>
    </figure>`;
  }

  const echapper = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /* ------------------------------------------------------- plein écran */

  const loupe = $('[data-loupe]');
  let urlCourante = null;

  function ouvrirLoupe(url, label) {
    urlCourante = url;
    $('[data-loupe-img]').src = url;
    $('[data-loupe-legende]').textContent = label;
    $('[data-loupe-dl]').href = url;
    loupe.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function fermerLoupe() {
    loupe.hidden = true;
    document.body.style.overflow = '';
  }
  $('[data-loupe-fermer]').addEventListener('click', fermerLoupe);
  loupe.addEventListener('click', (e) => { if (e.target === loupe) fermerLoupe(); });

  // Maintenir le bouton = revoir l'originale. C'est LA comparaison qui compte.
  const avant = $('[data-loupe-avant]');
  const montrerOrigine = () => {
    if (bienActuel?.sources[0]) $('[data-loupe-img]').src = bienActuel.sources[0].url;
  };
  const remontrerRendu = () => { if (urlCourante) $('[data-loupe-img]').src = urlCourante; };
  ['mousedown', 'touchstart'].forEach((t) => avant.addEventListener(t, montrerOrigine));
  ['mouseup', 'mouseleave', 'touchend'].forEach((t) => avant.addEventListener(t, remontrerRendu));

  /* -------------------------------------------------------- intégration */

  const modaleCode = $('[data-modale-code]');
  $('[data-code]').addEventListener('click', async () => {
    const rep = await fetch(`/api/console/biens/${bienActuel.publicId}/integration`);
    const data = await rep.json();
    $('[data-code-html]').textContent = data.precalcule;
    modaleCode.hidden = false;
    document.body.style.overflow = 'hidden';
  });
  const fermerCode = () => { modaleCode.hidden = true; document.body.style.overflow = ''; };
  $('[data-code-fermer]').addEventListener('click', fermerCode);
  modaleCode.addEventListener('click', (e) => { if (e.target === modaleCode) fermerCode(); });

  $('[data-copier]').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText($('[data-code-html]').textContent);
      e.target.textContent = 'Copié ✓';
      setTimeout(() => (e.target.textContent = 'Copier'), 1800);
    } catch {
      e.target.textContent = 'Copie impossible — sélectionnez le texte';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { fermerLoupe(); fermerCode(); }
  });

  /* ------------------------------------------------------------ départ */

  // Ouverture directe sur un bien existant : /console?bien=xxx
  const bienUrl = new URLSearchParams(location.search).get('bien');
  if (bienUrl) {
    fetch(`/api/console/biens/${bienUrl}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        bienActuel = d.bien;
        if (d.bien.sources[0]) {
          apercu.src = d.bien.sources[0].url;
          apercu.hidden = false;
          zoneVide.hidden = true;
          boutonChanger.hidden = false;
        }
        $('#titre').value = d.bien.titre || '';
        $('#ville').value = d.bien.ville || '';
        $('#reference').value = d.bien.reference || '';
        $('[data-galerie]').hidden = false;
        dessinerGalerie(d.bien);
        majBouton();
        if (d.bien.variantes.some((v) => v.statut === 'pending' || v.statut === 'processing')) {
          demarrerSondage();
        }
      });
  }

  majBouton();
})();
