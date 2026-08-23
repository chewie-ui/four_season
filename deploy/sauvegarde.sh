#!/usr/bin/env bash
#
# Sauvegarde quotidienne de Four Season.
#
#   sudo cp deploy/sauvegarde.sh /usr/local/bin/fs-sauvegarde
#   sudo chmod +x /usr/local/bin/fs-sauvegarde
#   sudo crontab -e     →     15 3 * * * /usr/local/bin/fs-sauvegarde >> /var/log/fs-sauvegarde.log 2>&1
#
# Deux choses irremplaçables sont sauvegardées :
#   - la base   : comptes, clés, crédits, grand livre. Perdue = société perdue.
#   - storage/  : les images générées. Perdues = il faut les repayer à Google.
#
set -euo pipefail

APP="${FS_APP:-/srv/fourseason}"
DEST="${FS_BACKUP:-/var/backups/fourseason}"
RETENTION_JOURS="${FS_RETENTION:-14}"
JOUR="$(date +%F)"

# Les identifiants sont lus dans le .env de l'application : pas de mot de passe
# en dur dans ce script, et pas de second endroit à tenir à jour.
if [[ ! -f "$APP/.env" ]]; then
  echo "✖  $APP/.env introuvable — définissez FS_APP" >&2
  exit 1
fi
set -a; source <(grep -E '^(DB_USER|DB_PASSWORD|DB_NAME|DB_HOST|DB_PORT|STORAGE_LOCAL_PATH)=' "$APP/.env"); set +a

mkdir -p "$DEST"

# ---- base de données -------------------------------------------------------
echo "[$(date +%T)] dump de ${DB_NAME}…"
# --no-tablespaces : sans lui, mysqldump 8 tente de lire les tablespaces et
#   exige le privilege PROCESS, qui est global au serveur. Notre utilisateur
#   est volontairement limite a sa seule base — on ne va pas elargir ses
#   droits pour faire taire un avertissement.
# --single-transaction : dump coherent sans verrouiller les ecritures.
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" --user="$DB_USER" \
  --single-transaction --quick --routines --triggers --events \
  --no-tablespaces \
  --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip -9 > "$DEST/base-$JOUR.sql.gz"

# Un dump qui ne contient pas la table des comptes est un dump raté :
# on vérifie plutôt que de découvrir le problème le jour de la restauration.
if ! zgrep -q 'CREATE TABLE `agencies`' "$DEST/base-$JOUR.sql.gz"; then
  echo "✖  le dump semble incomplet — table agencies absente" >&2
  exit 1
fi

# ---- images ----------------------------------------------------------------
STOCKAGE="$APP/${STORAGE_LOCAL_PATH:-./storage}"
STOCKAGE="${STOCKAGE//\/.\//\/}"
if [[ -d "$STOCKAGE" ]]; then
  echo "[$(date +%T)] archivage des images…"
  # Les JPEG sont déjà compressés : on archive sans recompresser.
  tar -cf "$DEST/images-$JOUR.tar" -C "$(dirname "$STOCKAGE")" "$(basename "$STOCKAGE")"
else
  echo "⚠  dossier d'images introuvable : $STOCKAGE" >&2
fi

# ---- rotation --------------------------------------------------------------
find "$DEST" -name 'base-*.sql.gz' -mtime "+$RETENTION_JOURS" -delete
find "$DEST" -name 'images-*.tar'  -mtime "+$RETENTION_JOURS" -delete

echo "[$(date +%T)] ✔ sauvegarde terminée — $(du -sh "$DEST" | cut -f1) dans $DEST"

# ---- hors-site -------------------------------------------------------------
# Une sauvegarde sur la même machine ne protège pas d'une perte de la machine.
# Décommentez une fois Swiss Backup (ou rclone) configuré :
#
# rclone sync "$DEST" "swissbackup:fourseason/" --max-age 48h
#
echo "⚠  rappel : ces fichiers sont sur le MÊME serveur que ce qu'ils protègent."
echo "   Configurez une copie hors-site, et testez une restauration."
