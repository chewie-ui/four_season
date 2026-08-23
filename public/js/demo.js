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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fichier = champPhoto.files && champPhoto.files[0];
    if (!fichier) return dire('Choisissez d’abord une photo.', 'erreur');

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
      dire(`Rendu « ${data.scene.label} » généré en ${(data.latencyMs / 1000).toFixed(1)} s.`, 'ok');
    } catch {
      dire('Impossible de joindre le serveur. Réessayez.', 'erreur');
    } finally {
      bouton.disabled = false;
      attente.hidden = true;
    }
  });
})();
