/* Page /demo — envoi de la photo et affichage du rendu. */
(() => {
  'use strict';

  const form = document.querySelector('[data-formulaire-demo]');
  if (!form) return;

  const apercu = document.querySelector('[data-apercu]');
  const attente = document.querySelector('[data-attente]');
  const message = form.querySelector('[data-message]');
  const nomFichier = document.querySelector('[data-nom-fichier]');
  const bouton = form.querySelector('button[type=submit]');
  const champPhoto = form.querySelector('#photo');

  const dire = (texte, ton = 'info') => {
    const couleur = ton === 'erreur' ? '#FF9B96' : ton === 'ok' ? 'var(--or-clair)' : 'var(--texte-doux)';
    message.innerHTML = texte
      ? `<p style="margin:0;font-size:.9rem;color:${couleur}">${texte}</p>`
      : '';
  };

  // Aperçu local immédiat : l'utilisateur voit sa photo avant même de générer.
  champPhoto.addEventListener('change', () => {
    const fichier = champPhoto.files && champPhoto.files[0];
    if (!fichier) return;
    if (nomFichier) nomFichier.textContent = fichier.name;
    apercu.src = URL.createObjectURL(fichier);
    apercu.hidden = false;
    dire('Photo chargée. Choisissez une ambiance puis lancez la génération.');
  });

  /* ------------------------------------------------- calcul de la lumière */

  const boutonSoleil = form.querySelector('[data-soleil-calc]');
  const zoneSoleil = form.querySelector('[data-soleil-resultat]');
  const champScene = form.querySelector('#scene');

  const CARDINAUX = {
    0: 'nord', 45: 'nord-est', 90: 'est', 135: 'sud-est',
    180: 'sud', 225: 'sud-ouest', 270: 'ouest', 315: 'nord-ouest',
  };
  const carte = (d) => CARDINAUX[(Math.round(d / 45) * 45) % 360] || d + '°';

  const echapper = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const traduireEclairement = (en) =>
    /fully lit/.test(en) ? 'façade en pleine lumière'
      : /at an angle/.test(en) ? 'façade éclairée de biais, beau relief'
        : /edge-on/.test(en) ? 'lumière rasante sur la façade'
          : /own shade/.test(en) ? 'façade surtout à l’ombre'
            : 'façade à contre-jour';

  let ambiancesSoleil = null;

  const champAdresse = form.querySelector('#adresse');
  let derniereAdresse = '';

  /**
   * Le calcul part quand l'utilisateur QUITTE le champ, pas à chaque frappe :
   * le géocodage interroge un service public gratuit, une requête par lettre
   * serait un abus. Quitter le champ est aussi le moment où l'adresse est
   * réellement finie d'écrire.
   */
  champAdresse.addEventListener('blur', () => {
    const a = champAdresse.value.trim();
    if (a.length > 5 && a !== derniereAdresse) calculerSoleil();
  });
  ['#pays', '#orientation'].forEach((sel) =>
    form.querySelector(sel).addEventListener('change', () => {
      if (champAdresse.value.trim().length > 5) calculerSoleil();
    })
  );

  boutonSoleil.addEventListener('click', calculerSoleil);

  async function calculerSoleil() {
    const adresse = champAdresse.value.trim();
    if (!adresse) {
      zoneSoleil.innerHTML = '<p class="doux" style="font-size:.86rem;margin:0">Indiquez une adresse.</p>';
      return;
    }

    boutonSoleil.disabled = true;
    zoneSoleil.innerHTML = '<p class="doux" style="font-size:.86rem;margin:0">Recherche de l’adresse…</p>';

    try {
      const rep = await fetch('/api/v1/demo/soleil', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adresse,
          pays: form.querySelector('#pays').value,
          orientation: form.querySelector('#orientation').value,
          mois: form.querySelector('#mois').value,
        }),
      });
      const data = await rep.json();
      if (!rep.ok) throw new Error(data.error || 'Adresse introuvable.');

      ambiancesSoleil = data.ambiances;
      derniereAdresse = adresse;
      dessinerSoleil(data.lieu);
    } catch (err) {
      zoneSoleil.innerHTML =
        `<p style="font-size:.86rem;margin:0;color:#FF9B96">${echapper(err.message)}</p>`;
    } finally {
      boutonSoleil.disabled = false;
    }
  }

  // Changer d'ambiance ou de mois met l'aperçu à jour sans rien recalculer
  // côté serveur : les valeurs de toutes les ambiances sont déjà là.
  champScene.addEventListener('change', () => ambiancesSoleil && dessinerSoleil());
  form.querySelector('#mois').addEventListener('change', () => {
    // Le mois change la position du soleil : il faut refaire le calcul.
    if (ambiancesSoleil) boutonSoleil.click();
  });

  function dessinerSoleil(lieu) {
    if (!ambiancesSoleil) return;
    const a = ambiancesSoleil[champScene.value];
    const nom = champScene.selectedOptions[0]?.textContent.trim().split('—')[0].trim() || '';

    if (!a) { zoneSoleil.innerHTML = ''; return; }

    const detail = a.sousHorizon
      ? 'soleil <b>sous l’horizon</b> — aucune ombre portée'
      : `soleil à <b>${a.hauteur}°</b> au <b>${carte(a.azimut)}</b>` +
        (a.ombre ? `, ombres <b>× ${a.ombre}</b> la hauteur des objets` : '');

    zoneSoleil.innerHTML =
      (lieu
        ? `<p class="doux" style="font-size:.8rem;margin:0 0 .5rem">${echapper(lieu.adresse)}` +
          (lieu.precision !== 'exacte' ? ' <span style="color:#E0A458">— adresse approchée</span>' : '') +
          '</p>'
        : '') +
      `<div style="border-left:2px solid var(--or);padding-left:.8rem">
         <p style="margin:0;font-size:.9rem"><b>${echapper(nom)}</b></p>
         <p style="margin:.2rem 0 0;font-size:.88rem;color:var(--texte-doux)">${detail}</p>
         ${a.eclairement ? `<p style="margin:.2rem 0 0;font-size:.84rem;color:var(--texte-doux);opacity:.8">${traduireEclairement(a.eclairement)}</p>` : ''}
       </div>`;
  }

  /* ------------------------------ « aucune ambiance » : la consigne pilote */

  const champConsigne = form.querySelector('#consigne');
  const noteConsigne = form.querySelector('[data-consigne-note]');

  function majConsigne() {
    const libre = champScene.value === 'libre';
    if (noteConsigne) {
      noteConsigne.textContent = libre
        ? '— obligatoire : rien d’autre ne guide le rendu'
        : '— facultatif, en complément de l’ambiance';
    }
    champConsigne.required = libre;
    champConsigne.placeholder = libre
      ? 'ex. : un matin de décembre, sans neige, ciel dégagé'
      : 'ex. : ajouter de la neige sur les haies';
  }
  champScene.addEventListener('change', majConsigne);
  majConsigne();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fichier = champPhoto.files && champPhoto.files[0];
    if (!fichier) return dire('Choisissez d’abord une photo.', 'erreur');
    if (champScene.value === 'libre' && champConsigne.value.trim().length < 3) {
      champConsigne.focus();
      return dire('Sans ambiance, décrivez ce que vous voulez voir.', 'erreur');
    }

    const donnees = new FormData(form);
    bouton.disabled = true;
    attente.hidden = false;
    dire('');

    try {
      const rep = await fetch('/api/v1/demo/generate', { method: 'POST', body: donnees });
      const data = await rep.json().catch(() => ({}));

      if (!rep.ok) {
        dire(data.error || 'La génération a échoué.', 'erreur');
        if (data.hint) dire(`${data.error}<br><span style="opacity:.7">${data.hint}</span>`, 'erreur');
        return;
      }

      apercu.src = data.url;
      apercu.hidden = false;

      // L'étiquette sur l'image affichait l'ambiance de l'illustration
      // vectorielle, pas celle qu'on vient de générer : on lisait « Automne »
      // sur un rendu d'hiver. Elle suit désormais le rendu réel.
      const titre = document.querySelector('[data-etiquette-titre]');
      const detail = document.querySelector('[data-etiquette-detail]');
      if (titre) titre.textContent = data.scene.label;
      if (detail) {
        const mois = form.querySelector('#mois');
        detail.textContent = mois && mois.value
          ? mois.selectedOptions[0].textContent.trim()
          : 'rendu généré';
      }
      // Les boutons d'ambiance ne pilotent que l'illustration : les laisser
      // actifs sous une vraie photo laisse croire qu'ils la changent.
      document.querySelectorAll('.vis-choix button').forEach((b) => {
        b.setAttribute('aria-pressed', 'false');
        b.disabled = true;
        b.title = 'Ces boutons ne pilotent que l’illustration de départ.';
      });

      dire(`Rendu « ${data.scene.label} » généré en ${(data.latencyMs / 1000).toFixed(1)} s.`, 'ok');
    } catch {
      dire('Impossible de joindre le serveur. Réessayez.', 'erreur');
    } finally {
      bouton.disabled = false;
      attente.hidden = true;
    }
  });
})();
