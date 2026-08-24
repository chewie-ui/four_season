-- =====================================================================
--  Comptes en libre-service et paiement.
--
--  Jusqu'ici une agence naissait d'un `npm run db:seed` et se connectait
--  avec sa cle secrete. Desormais elle s'inscrit, choisit un mot de passe,
--  gere ses cles et ses domaines, et paie.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Utilisateurs
-- ---------------------------------------------------------------------

-- Verification d'adresse : un compte non verifie peut se connecter mais
-- ne recoit pas ses credits d'essai, ce qui evite les inscriptions en masse.
ALTER TABLE users ADD COLUMN email_verifie TINYINT(1) NOT NULL DEFAULT 0 AFTER email;
ALTER TABLE users ADD COLUMN jeton_verif CHAR(64) NULL AFTER email_verifie;
ALTER TABLE users ADD COLUMN jeton_reset CHAR(64) NULL AFTER jeton_verif;
ALTER TABLE users ADD COLUMN reset_expire DATETIME NULL AFTER jeton_reset;
ALTER TABLE users ADD COLUMN echecs_connexion TINYINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN bloque_jusqu_a DATETIME NULL;

CREATE INDEX ix_users_jeton_verif ON users (jeton_verif);
CREATE INDEX ix_users_jeton_reset ON users (jeton_reset);

-- ---------------------------------------------------------------------
--  Abonnement
-- ---------------------------------------------------------------------

ALTER TABLE agencies ADD COLUMN stripe_customer_id  VARCHAR(64) NULL AFTER plan_id;
ALTER TABLE agencies ADD COLUMN stripe_subscription_id VARCHAR(64) NULL AFTER stripe_customer_id;
ALTER TABLE agencies ADD COLUMN abonnement_statut
  ENUM('aucun','actif','en_retard','annule') NOT NULL DEFAULT 'aucun' AFTER stripe_subscription_id;
ALTER TABLE agencies ADD COLUMN periode_fin DATETIME NULL AFTER abonnement_statut;

CREATE INDEX ix_agencies_stripe_customer ON agencies (stripe_customer_id);

-- ---------------------------------------------------------------------
--  Paiements
-- ---------------------------------------------------------------------

-- Trace de chaque encaissement. `stripe_event_id` porte une contrainte
-- unique : Stripe rejoue ses webhooks en cas de doute, et sans cette
-- contrainte une meme facture crediterait deux fois le compte.
CREATE TABLE IF NOT EXISTS payments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agency_id       BIGINT UNSIGNED NOT NULL,
  stripe_event_id VARCHAR(80)     NOT NULL,
  stripe_object   VARCHAR(80)     NULL,
  montant_cents   INT UNSIGNED    NOT NULL,
  devise          CHAR(3)         NOT NULL DEFAULT 'EUR',
  credits         INT UNSIGNED    NOT NULL DEFAULT 0,
  plan_id         VARCHAR(32)     NULL,
  statut          ENUM('paye','rembourse','echoue') NOT NULL DEFAULT 'paye',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_event (stripe_event_id),
  KEY ix_payments_agency (agency_id, created_at),
  CONSTRAINT fk_payments_agency FOREIGN KEY (agency_id) REFERENCES agencies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Le grand livre gagne deux motifs : l'essai a l'inscription et l'abonnement.
ALTER TABLE credit_ledger
  MODIFY COLUMN reason ENUM(
    'signup','subscription','topup','generation','refund','adjustment','essai'
  ) NOT NULL;
