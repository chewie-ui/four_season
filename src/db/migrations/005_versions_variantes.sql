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
--
--  ---------------------------------------------------------------------
--  DEUX PRECAUTIONS, apprises en la jouant en production :
--
--  1. L'ORDRE. `uq_variant_scene` commence par source_image_id : MySQL
--     s'en sert comme index de support pour la cle etrangere vers
--     source_images. Le supprimer d'abord echoue avec « needed in a
--     foreign key constraint ». On cree donc le nouvel index AVANT.
--
--  2. LA REJOUABILITE. MySQL ne fait pas de DDL transactionnelle : un
--     ALTER passe, le suivant echoue, et la table reste a mi-chemin.
--     Chaque etape teste donc l'etat reel avant d'agir. MySQL 8 n'a pas
--     `IF NOT EXISTS` sur les colonnes ni les index — d'ou information_schema.
-- =====================================================================

-- 1. La colonne de version -------------------------------------------------
SET @faire = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE variants ADD COLUMN version SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER scene_id',
    'DO 0')
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variants' AND COLUMN_NAME = 'version'
);
PREPARE st FROM @faire; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. Le nouvel index, cree en PREMIER pour reprendre le support de la cle
--    etrangere avant que l'ancien unique ne disparaisse.
SET @faire = (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX ix_variants_derniere ON variants (source_image_id, scene_id, version)',
    'DO 0')
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variants' AND INDEX_NAME = 'ix_variants_derniere'
);
PREPARE st FROM @faire; EXECUTE st; DEALLOCATE PREPARE st;

-- 3. Supprimer l'ancien unique, seulement s'il est encore en 3 colonnes.
SET @faire = (
  SELECT IF(COUNT(*) = 3, 'ALTER TABLE variants DROP INDEX uq_variant_scene', 'DO 0')
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variants' AND INDEX_NAME = 'uq_variant_scene'
);
PREPARE st FROM @faire; EXECUTE st; DEALLOCATE PREPARE st;

-- 4. Le recreer en incluant la version.
SET @faire = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE variants ADD UNIQUE KEY uq_variant_scene (source_image_id, scene_id, prompt_hash, version)',
    'DO 0')
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variants' AND INDEX_NAME = 'uq_variant_scene'
);
PREPARE st FROM @faire; EXECUTE st; DEALLOCATE PREPARE st;
