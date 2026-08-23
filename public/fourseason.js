/* =====================================================================
   AURELO — widget embarquable
   ---------------------------------------------------------------------
   Installation, côté site client :

     <script src="https://fourseason.fr/fourseason.js" data-cle="pk_live_xxx" defer></script>
     <img src="/photos/villa.jpg" data-fourseason data-ambiances="hiver,coucher,nuit">

   Mode « admin » (images déjà calculées, aucun appel réseau) :

     <img src="/photos/villa.jpg" data-fourseason
          data-variantes='{"hiver":"/photos/villa-hiver.jpg","nuit":"/photos/villa-nuit.jpg"}'>

   Contraintes de conception :
   - zéro dépendance, un seul fichier, chargé en `defer` ;
   - Shadow DOM : le CSS du site hôte ne peut pas casser le widget,
     et le widget ne peut pas casser le site hôte ;
   - si l'API ne répond pas, la photo d'origine reste affichée, intacte.
   ===================================================================== */
(function () {
  'use strict';

  if (window.__fourseasonCharge) return;
  window.__fourseasonCharge = true;

  var script = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="fourseason"]');
    return s[s.length - 1];
  })();

  var CFG = {
    cle: (script && script.dataset.cle) || '',
    base: (script && script.dataset.base) || (script && new URL(script.src, location.href).origin) || '',
    libre: !script || script.dataset.libre !== 'non',   // champ de saisie libre
    langue: (script && script.dataset.langue) || 'fr',
  };

  var LIBELLES = {
    printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver',
    aube: 'Aube', midi: 'Plein jour', coucher: 'Coucher de soleil',
    'heure-bleue': 'Heure bleue', nuit: 'Nuit',
    couvert: 'Ciel couvert', pluie: 'Pluie', brouillard: 'Brouillard',
    'neige-tombante': 'Neige',
  };
  var DEFAUT = ['midi', 'coucher', 'heure-bleue', 'hiver'];

  var CSS = [
    ':host{all:initial;display:block;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '*{box-sizing:border-box}',
    '.barre{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 0 0}',
    'button{font:inherit;font-size:13px;line-height:1;padding:8px 13px;border:1px solid rgba(0,0,0,.16);',
    'background:#fff;color:#1b2436;border-radius:999px;cursor:pointer;transition:all .15s ease;white-space:nowrap}',
    'button:hover{border-color:#E0A458;color:#8a5a1c}',
    'button[aria-pressed="true"]{background:#0B1220;border-color:#0B1220;color:#F6F1E8}',
    'button:disabled{opacity:.45;cursor:progress}',
    'form{display:flex;gap:6px;flex:1;min-width:190px}',
    'input{font:inherit;font-size:13px;flex:1;min-width:0;padding:8px 12px;border:1px solid rgba(0,0,0,.16);border-radius:999px;color:#1b2436}',
    'input:focus{outline:2px solid #E0A458;outline-offset:1px;border-color:transparent}',
    '.etat{font-size:12px;color:#5b6579;padding:6px 2px 0;width:100%;min-height:1em}',
    '.etat[data-erreur]{color:#a8342f}',
    '.credit{font-size:11px;color:#8a93a5;padding-top:4px;width:100%}',
    '.credit a{color:inherit;text-decoration:underline;text-underline-offset:2px}',
    '@media (prefers-color-scheme:dark){',
    'button{background:#131E31;border-color:rgba(255,255,255,.16);color:#E8EDF5}',
    'button[aria-pressed="true"]{background:#E0A458;border-color:#E0A458;color:#17110A}',
    'input{background:#131E31;border-color:rgba(255,255,255,.16);color:#E8EDF5}',
    '.etat{color:#95a1b5}}',
  ].join('');

  /* ------------------------------------------------------------ outils */

  function absolu(url) {
    try { return new URL(url, location.href).href; } catch (e) { return url; }
  }

  function memoire() {
    try { return window.sessionStorage; } catch (e) { return null; }
  }

  function lireCache(cle) {
    var m = memoire();
    if (!m) return null;
    try { return m.getItem('fourseason:' + cle); } catch (e) { return null; }
  }

  function ecrireCache(cle, val) {
    var m = memoire();
    if (!m) return;
    try { m.setItem('fourseason:' + cle, val); } catch (e) { /* quota plein : tant pis */ }
  }

  function attendre(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* ------------------------------------------------------- appel API */

  function demander(source, scene, consigne) {
    var cache = source + '|' + scene + '|' + (consigne || '');
    var deja = lireCache(cache);
    if (deja) return Promise.resolve(deja);

    return fetch(CFG.base + '/api/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cle: CFG.cle, image: source, scene: scene, consigne: consigne || '' }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error(d.error || 'Génération indisponible');
          return d;
        });
      })
      .then(function sonder(d) {
        if (d.url) {
          ecrireCache(cache, d.url);
          return d.url;
        }
        if (!d.jeton) throw new Error('Réponse inattendue du serveur');
        // Le rendu est en file d'attente : on interroge jusqu'à 90 s.
        var essais = 0;
        return (function boucle() {
          if (++essais > 45) throw new Error('Le rendu prend trop de temps');
          return attendre(2000)
            .then(function () { return fetch(CFG.base + '/api/v1/render/' + encodeURIComponent(d.jeton)); })
            .then(function (r) { return r.json(); })
            .then(function (s) {
              if (s.url) { ecrireCache(cache, s.url); return s.url; }
              if (s.status === 'failed') throw new Error(s.error || 'La génération a échoué');
              return boucle();
            });
        })();
      });
  }

  /* ------------------------------------------------------ construction */

  function equiper(img) {
    if (img.dataset.fourseasonPret) return;
    img.dataset.fourseasonPret = '1';

    var origine = absolu(img.currentSrc || img.src);
    var precalcule = {};
    if (img.dataset.variantes) {
      try { precalcule = JSON.parse(img.dataset.variantes); } catch (e) { precalcule = {}; }
    }

    var ambiances = (img.dataset.ambiances || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!ambiances.length) ambiances = Object.keys(precalcule);
    if (!ambiances.length) ambiances = DEFAUT.slice();

    var hote = document.createElement('div');
    hote.className = 'fourseason-widget';
    var racine = hote.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = CSS;
    racine.appendChild(style);

    var barre = document.createElement('div');
    barre.className = 'barre';
    racine.appendChild(barre);

    var etat = document.createElement('p');
    etat.className = 'etat';
    etat.setAttribute('role', 'status');
    etat.setAttribute('aria-live', 'polite');

    var boutons = [];
    var courant = null;

    function afficher(url, libelle) {
      img.src = url;
      // srcset/sizes du site hôte écraseraient notre src : on les neutralise.
      if (img.srcset) img.removeAttribute('srcset');
      etat.removeAttribute('data-erreur');
      etat.textContent = libelle ? 'Vue : ' + libelle : '';
    }

    function marquer(actif) {
      courant = actif;
      boutons.forEach(function (b) {
        b.setAttribute('aria-pressed', b.dataset.scene === actif ? 'true' : 'false');
      });
    }

    function activer(scene, libelle, consigne) {
      if (scene === 'original') {
        marquer('original');
        afficher(origine, '');
        return;
      }
      if (precalcule[scene]) {
        marquer(scene);
        afficher(absolu(precalcule[scene]), libelle);
        return;
      }
      if (!CFG.cle) {
        etat.setAttribute('data-erreur', '');
        etat.textContent = 'Widget non configuré (clé manquante).';
        return;
      }

      marquer(scene);
      boutons.forEach(function (b) { b.disabled = true; });
      etat.removeAttribute('data-erreur');
      etat.textContent = 'Génération de la vue « ' + libelle + '»…';

      demander(origine, scene, consigne)
        .then(function (url) { afficher(url, libelle); })
        .catch(function (err) {
          afficher(origine, '');
          marquer('original');
          etat.setAttribute('data-erreur', '');
          etat.textContent = err.message || 'Vue indisponible pour le moment.';
        })
        .then(function () {
          boutons.forEach(function (b) { b.disabled = false; });
        });
    }

    function ajouterBouton(scene, libelle) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = libelle;
      b.dataset.scene = scene;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { activer(scene, libelle, ''); });
      barre.appendChild(b);
      boutons.push(b);
      return b;
    }

    ajouterBouton('original', 'Photo d’origine').setAttribute('aria-pressed', 'true');
    courant = 'original';
    ambiances.forEach(function (id) { ajouterBouton(id, LIBELLES[id] || id); });

    // Saisie libre : « je veux la voir un soir d'été ».
    if (CFG.libre && CFG.cle) {
      var form = document.createElement('form');
      var saisie = document.createElement('input');
      saisie.type = 'text';
      saisie.placeholder = 'Décrivez le moment…';
      saisie.setAttribute('aria-label', 'Décrire l’ambiance souhaitée');
      saisie.maxLength = 160;
      form.appendChild(saisie);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var texte = saisie.value.trim();
        if (texte) activer('libre', texte, texte);
      });
      barre.appendChild(form);
    }

    barre.appendChild(etat);

    var credit = document.createElement('p');
    credit.className = 'credit';
    credit.innerHTML = 'Vues simulées par <a href="' + CFG.base + '" target="_blank" rel="noopener">Four Season</a> — sans valeur contractuelle.';
    barre.appendChild(credit);

    (img.parentNode || document.body).insertBefore(hote, img.nextSibling);
  }

  function balayer() {
    document.querySelectorAll('img[data-fourseason]').forEach(equiper);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', balayer);
  } else {
    balayer();
  }

  // Les sites d'agence chargent souvent leurs annonces en AJAX : on reste à l'écoute.
  if (window.MutationObserver) {
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length) { balayer(); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.FourSeason = { equiper: equiper, balayer: balayer, config: CFG };
})();
