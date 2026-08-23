-- Le prompt exact envoye au modele est desormais conserve avec la variante.
--
-- Pourquoi : le worker ne doit pas reconstruire le prompt au moment du
-- traitement. Sans ca, modifier src/config/scenes.js changerait le rendu de
-- jobs deja en file, et un rendu rate serait impossible a rejouer a l'identique.
-- Indispensable aussi pour l'ambiance libre, dont la consigne vient du visiteur.

ALTER TABLE variants ADD COLUMN prompt TEXT NULL AFTER prompt_hash;
