-- =====================================================================
--  AURELO — schéma MySQL 8
--  Exécuter avec :  npm run db:migrate
--  Le fichier est idempotent (CREATE TABLE IF NOT EXISTS).
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
--  1. COMPTES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agencies (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       CHAR(21)        NOT NULL,               -- nanoid, exposé côté client
  name            VARCHAR(160)    NOT NULL,
  slug            VARCHAR(160)    NOT NULL,
  plan_id         VARCHAR(32)     NOT NULL DEFAULT 'decouverte',
  credits_balance INT             NOT NULL DEFAULT 15,    -- solde courant, source = credit_ledger
  billing_email   VARCHAR(190)    NULL,
  vat_number      VARCHAR(32)     NULL,
  watermark       TINYINT(1)      NOT NULL DEFAULT 1,     -- filigrane Aurelo sur les rendus
  status          ENUM('active','suspended','cancelled') NOT NULL DEFAULT 'active',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agencies_public_id (public_id),
  UNIQUE KEY uq_agencies_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agency_id     BIGINT UNSIGNED NOT NULL,
  email         VARCHAR(190)    NOT NULL,
  password_hash VARCHAR(255)    NOT NULL,                 -- argon2id
  full_name     VARCHAR(160)    NULL,
  role          ENUM('owner','admin','agent') NOT NULL DEFAULT 'agent',
  last_login_at DATETIME        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_agency (agency_id),
  CONSTRAINT fk_users_agency FOREIGN KEY (agency_id) REFERENCES agencies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
--  2. INTÉGRATION (widget + API)
-- ---------------------------------------------------------------------

-- Deux natures de clé :
--   'public' -> posée en clair dans le <script> du site client, bridée par allowed_domains
--   'secret' -> serveur à serveur, jamais exposée, stockée hachée
CREATE TABLE IF NOT EXISTS api_keys (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agency_id     BIGINT UNSIGNED NOT NULL,
  kind          ENUM('public','secret') NOT NULL,
  label         VARCHAR(120)    NULL,
  key_prefix    VARCHAR(16)     NOT NULL,                 -- ex. 'pk_live_a1b2'
  key_hash      CHAR(64)        NOT NULL,                 -- sha256 de la clé complète
  last_used_at  DATETIME        NULL,
  revoked_at    DATETIME        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_hash (key_hash),
  KEY ix_api_keys_agency (agency_id, kind),
  CONSTRAINT fk_api_keys_agency FOREIGN KEY (agency_id) REFERENCES agencies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Anti-abus : une clé publique n'est acceptée que depuis ces domaines (Origin/Referer).
CREATE TABLE IF NOT EXISTS allowed_domains (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agency_id  BIGINT UNSIGNED NOT NULL,
  domain     VARCHAR(190)    NOT NULL,                    -- 'agence-durand.fr' ou '*.agence-durand.fr'
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_allowed_domain (agency_id, domain),
  CONSTRAINT fk_domains_agency FOREIGN KEY (agency_id) REFERENCES agencies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
--  3. BIENS ET IMAGES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS properties (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agency_id    BIGINT UNSIGNED NOT NULL,
  public_id    CHAR(21)        NOT NULL,
  external_ref VARCHAR(120)    NULL,                      -- référence du logiciel métier (Apimo, Hektor…)
  title        VARCHAR(255)    NULL,
  city         VARCHAR(120)    NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_properties_public_id (public_id),
  KEY ix_properties_agency (agency_id),
  KEY ix_properties_external (agency_id, external_ref),
  CONSTRAINT fk_properties_agency FOREIGN KEY (agency_id) REFERENCES agencies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Photo d'origine fournie par l'agent.
CREATE TABLE IF NOT EXISTS source_images (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agency_id    BIGINT UNSIGNED NOT NULL,
  property_id  BIGINT UNSIGNED NULL,
  public_id    CHAR(21)        NOT NULL,
  storage_key  VARCHAR(512)    NOT NULL,                  -- chemin local ou clé S3
  checksum     CHAR(64)        NOT NULL,                  -- sha256 du binaire : évite de repayer 2x la même photo
  mime         VARCHAR(64)     NOT NULL,
  width        INT UNSIGNED    NULL,
  height       INT UNSIGNED    NULL,
  bytes        INT UNSIGNED    NULL,
  source_url   VARCHAR(1024)   NULL,                      -- si l'image vient du site client par URL
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_source_public_id (public_id),
  UNIQUE KEY uq_source_checksum (agency_id, checksum),
  KEY ix_source_property (property_id),
  CONSTRAINT fk_source_agency   FOREIGN KEY (agency_id)   REFERENCES agencies (id)   ON DELETE CASCADE,
  CONSTRAINT fk_source_property FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Rendu généré pour une ambiance donnée. UNIQUE (source, scene) = cache naturel :
-- deux visiteurs qui demandent « hiver » sur la même photo ne coûtent qu'une génération.
CREATE TABLE IF NOT EXISTS variants (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_image_id BIGINT UNSIGNED NOT NULL,
  agency_id       BIGINT UNSIGNED NOT NULL,
  public_id       CHAR(21)        NOT NULL,
  scene_id        VARCHAR(48)     NOT NULL,               -- 'hiver', 'coucher'… voir src/config/scenes.js
  prompt_hash     CHAR(64)        NOT NULL,               -- pour invalider le cache si le prompt évolue
  status          ENUM('pending','processing','ready','failed') NOT NULL DEFAULT 'pending',
  storage_key     VARCHAR(512)    NULL,
  width           INT UNSIGNED    NULL,
  height          INT UNSIGNED    NULL,
  bytes           INT UNSIGNED    NULL,
  model           VARCHAR(64)     NULL,
  latency_ms      INT UNSIGNED    NULL,
  cost_micro_eur  INT UNSIGNED    NULL,                   -- coût réel en millionièmes d'euro
  error_message   VARCHAR(512)    NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_variants_public_id (public_id),
  UNIQUE KEY uq_variant_scene (source_image_id, scene_id, prompt_hash),
  KEY ix_variants_agency_date (agency_id, created_at),
  KEY ix_variants_status (status, created_at),
  CONSTRAINT fk_variants_source FOREIGN KEY (source_image_id) REFERENCES source_images (id) ON DELETE CASCADE,
  CONSTRAINT fk_variants_agency FOREIGN KEY (agency_id)       REFERENCES agencies (id)      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- File d'attente. Une génération prend 10-40 s : jamais dans le cycle HTTP.
CREATE TABLE IF NOT EXISTS generation_jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  variant_id    BIGINT UNSIGNED NOT NULL,
  agency_id     BIGINT UNSIGNED NOT NULL,
  status        ENUM('queued','running','done','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  priority      TINYINT UNSIGNED NOT NULL DEFAULT 5,      -- 1 = urgent (visiteur qui attend), 9 = pré-calcul de nuit
  locked_by     VARCHAR(64)     NULL,                     -- identifiant du worker
  locked_at     DATETIME        NULL,
  run_after     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error    VARCHAR(512)    NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_jobs_pickup (status, run_after, priority),
  KEY ix_jobs_agency (agency_id),
  CONSTRAINT fk_jobs_variant FOREIGN KEY (variant_id) REFERENCES variants (id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_agency  FOREIGN KEY (agency_id)  REFERENCES agencies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
--  4. CRÉDITS ET FACTURATION
-- ---------------------------------------------------------------------

-- Grand livre : on n'écrase jamais un solde, on ajoute une ligne.
-- credits_balance sur agencies n'est qu'un cache de SUM(delta).
CREATE TABLE IF NOT EXISTS credit_ledger (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agency_id   BIGINT UNSIGNED NOT NULL,
  delta       INT             NOT NULL,                   -- +400 (recharge) / -1 (génération)
  reason      ENUM('signup','subscription','topup','generation','refund','adjustment') NOT NULL,
  variant_id  BIGINT UNSIGNED NULL,
  note        VARCHAR(255)    NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ledger_agency_date (agency_id, created_at),
  CONSTRAINT fk_ledger_agency FOREIGN KEY (agency_id) REFERENCES agencies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------
--  5. SITE VITRINE
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(160)    NOT NULL,
  email      VARCHAR(190)    NOT NULL,
  company    VARCHAR(160)    NULL,
  phone      VARCHAR(40)     NULL,
  volume     VARCHAR(40)     NULL,                        -- nb de biens publiés par mois
  message    TEXT            NULL,
  plan_id    VARCHAR(32)     NULL,                        -- offre cliquée avant le formulaire
  source     VARCHAR(120)    NULL,                        -- utm / page d'origine
  ip_hash    CHAR(64)        NULL,
  status     ENUM('new','contacted','won','lost') NOT NULL DEFAULT 'new',
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_leads_status_date (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Compteur global de dépense API : le garde-fou du budget de test.
CREATE TABLE IF NOT EXISTS spend_daily (
  day             DATE            NOT NULL,
  images          INT UNSIGNED    NOT NULL DEFAULT 0,
  cost_micro_eur  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
