-- =====================================================================
--  Plusieurs versions d'une meme ambiance.
--
--  Le cache est le modele economique : deux visiteurs qui demandent
--  « hiver » sur la meme photo ne doivent payer qu'une generation. Cela
--  reste vrai.
--
--  Mais l'agent, lui, veut pouvoir relancer une ambiance qui ne lui plait
--  pas et GARDER les deux pour choisir. Jusqu'ici la contrainte unique le
--  lui interdisait en silence : il cliquait, rien ne se passait.
--
--  On ajoute donc un numero de version. Par defaut on retombe sur la
--  version 1 — le cache joue. Quand l'agent demande explicitement une
--  nouvelle version, on incremente, et cela coute un credit.
-- =====================================================================

ALTER TABLE variants ADD COLUMN version SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER scene_id;

-- L'unicite porte desormais sur (photo, ambiance, prompt, version).
ALTER TABLE variants DROP INDEX uq_variant_scene;
ALTER TABLE variants
  ADD UNIQUE KEY uq_variant_scene (source_image_id, scene_id, prompt_hash, version);

-- Retrouver rapidement la derniere version d'une ambiance.
CREATE INDEX ix_variants_derniere ON variants (source_image_id, scene_id, version);
