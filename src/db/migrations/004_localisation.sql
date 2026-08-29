-- =====================================================================
--  Localisation des biens et orientation de la façade.
--
--  Sans ces donnees, le prompt ne peut dire que « lumiere d'hiver » — du
--  vocabulaire, que le modele interprete au hasard. Avec, il dit « soleil
--  a 23 degres, ombres portees vers le nord, 2,4 fois la hauteur des
--  objets » : une contrainte verifiable.
--
--  L'agent immobilier l'a repere immediatement sur les premiers rendus :
--  en hiver le soleil est plus bas, les reflets tombent plus loin.
-- =====================================================================

ALTER TABLE properties ADD COLUMN address VARCHAR(255) NULL AFTER city;

-- DECIMAL et non FLOAT : sur des coordonnees, l'arrondi binaire deplace
-- le point de plusieurs metres. 6 decimales = precision decimetrique.
ALTER TABLE properties ADD COLUMN latitude  DECIMAL(9,6) NULL AFTER address;
ALTER TABLE properties ADD COLUMN longitude DECIMAL(9,6) NULL AFTER latitude;

ALTER TABLE properties ADD COLUMN country_code CHAR(2) NULL AFTER longitude;

-- Direction vers laquelle regarde la facade photographiee, en degres
-- depuis le nord dans le sens horaire : 0 = nord, 90 = est, 180 = sud.
-- C'est elle qui decide si la facade est eclairee ou a contre-jour.
ALTER TABLE properties ADD COLUMN facade_orientation SMALLINT UNSIGNED NULL AFTER country_code;

-- Fiabilite du geocodage : une adresse resolue a la ville pres ne vaut pas
-- une adresse resolue au numero. On le montre a l'agent plutot que de
-- laisser croire a une precision qu'on n'a pas.
ALTER TABLE properties ADD COLUMN geocode_precision
  ENUM('exacte','approchee','incertaine') NULL AFTER facade_orientation;

CREATE INDEX ix_properties_position ON properties (latitude, longitude);
