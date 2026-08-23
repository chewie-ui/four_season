/* =====================================================================
   AURELO — comportements du site
   Aucune dépendance. Tout est optionnel : si le JS ne charge pas,
   la page reste lisible et le formulaire fonctionne.
   ===================================================================== */
(() => {
  'use strict';

  const doux = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------ scène paramétrique */

  // Correspondance entre les tokens de src/config/scenes.js et les variables CSS.
  const CSS_VAR = {
    skyTop: '--sky-top', skyBottom: '--sky-bottom', light: '--light',
    wall: '--wall', roof: '--roof', ground: '--ground',
    foliage: '--foliage', foliageAlt: '--foliage-alt',
    glow: '--glow', stars: '--stars', rain: '--rain',
    snow: '--snow', flakes: '--flakes', fog: '--fog', blossom: '--blossom',
  };

  function appliquer(stage, v) {
    for (const [cle, prop] of Object.entries(CSS_VAR)) {
      if (v[cle] != null) stage.style.setProperty(prop, String(v[cle]));
    }
    stage.style.setProperty('--win-lit', String(v.windowsLit || 0));

    // L'astre : abscisse relative, hauteur déduite de l'angle de lumière.
    const x = (v.sunX != null ? v.sunX : 0.5) * 800;
    const angle = ((v.lightAngle || 0) * Math.PI) / 180;
    const y = 330 - Math.sin(angle) * 285;
    stage.style.setProperty('--sun-x', x.toFixed(1) + 'px');
    stage.style.setProperty('--sun-y', y.toFixed(1) + 'px');
  }

  function initVisionneuse(racine) {
    const stage = racine.querySelector('[data-stage]');
    const boutons = [...racine.querySelectorAll('[data-vars]')];
    if (!stage || !boutons.length) return;

    const titre = racine.querySelector('[data-etiquette-titre]');
    const detail = racine.querySelector('[data-etiquette-detail]');

    let index = Math.max(0, boutons.findIndex((b) => b.getAttribute('aria-pressed') === 'true'));
    let minuteur = null;
    let auto = !doux;

    const choisir = (i, parUtilisateur = false) => {
      index = (i + boutons.length) % boutons.length;
      const btn = boutons[index];
      let vars;
      try {
        vars = JSON.parse(btn.dataset.vars);
      } catch {
        return;
      }
      appliquer(stage, vars);
      boutons.forEach((b, j) => b.setAttribute('aria-pressed', j === index ? 'true' : 'false'));
      if (titre) titre.textContent = btn.dataset.label || '';
      if (detail) detail.textContent = btn.dataset.short || '';
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: doux ? 'auto' : 'smooth' });

      if (parUtilisateur) {
        auto = false;              // dès que l'utilisateur prend la main, on ne l'interrompt plus
        clearInterval(minuteur);
        minuteur = null;
      }
    };

    boutons.forEach((b, i) => b.addEventListener('click', () => choisir(i, true)));
    choisir(index);

    // Défilement automatique, mais seulement quand la visionneuse est visible.
    if (!auto) return;
    const demarrer = () => {
      if (minuteur || !auto) return;
      minuteur = setInterval(() => choisir(index + 1), 4200);
    };
    const arreter = () => {
      clearInterval(minuteur);
      minuteur = null;
    };

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        (entrees) => entrees.forEach((e) => (e.isIntersecting ? demarrer() : arreter())),
        { threshold: 0.35 }
      ).observe(racine);
    } else {
      demarrer();
    }
    document.addEventListener('visibilitychange', () => (document.hidden ? arreter() : demarrer()));
  }

  document.querySelectorAll('[data-visionneuse]').forEach(initVisionneuse);

  /* --------------------------------------------------- apparition douce */

  const aReveler = document.querySelectorAll('.reveler');
  if (aReveler.length && 'IntersectionObserver' in window && !doux) {
    const obs = new IntersectionObserver(
      (entrees) => {
        entrees.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('vu');
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    aReveler.forEach((el) => obs.observe(el));
  } else {
    aReveler.forEach((el) => el.classList.add('vu'));
  }

  /* ---------------------------------------------------------- onglets */

  document.querySelectorAll('[data-onglets]').forEach((groupe) => {
    const boutons = [...groupe.querySelectorAll('[role="tab"]')];
    boutons.forEach((btn) => {
      btn.addEventListener('click', () => {
        boutons.forEach((b) => {
          const actif = b === btn;
          b.setAttribute('aria-selected', actif ? 'true' : 'false');
          const panneau = document.getElementById(b.getAttribute('aria-controls'));
          if (panneau) panneau.hidden = !actif;
        });
      });
    });
  });
})();
