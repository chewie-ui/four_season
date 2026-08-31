/**
 * Biens : un bien = une photo source + ses ambiances générées.
 *
 * C'est l'unité de travail de l'agence. Le widget, lui, raisonne par photo ;
 * la console raisonne par bien, parce que c'est ainsi qu'un agent immobilier
 * pense — « la villa des Glycines », pas « le fichier IMG_0956 ».
 */
import { nanoid } from 'nanoid';
import env from '../config/env.js';
import { query } from '../db/pool.js';
import { SCENES, sceneById } from '../config/scenes.js';

const urlPublique = (k) => (k ? `${env.baseUrl.replace(/\/+$/, '')}/media/${k}` : null);

export async function creerBien(agencyId, { titre, ville, reference } = {}) {
  const publicId = nanoid(21);
  const res = await query(
    `INSERT INTO properties (agency_id, public_id, external_ref, title, city)
     VALUES (:a, :p, :r, :t, :v)`,
    {
      a: agencyId,
      p: publicId,
      r: reference ? String(reference).slice(0, 120) : null,
      t: titre ? String(titre).slice(0, 255) : null,
      v: ville ? String(ville).slice(0, 120) : null,
    }
  );
  return { id: res.insertId, publicId };
}

export async function rattacherSource(sourceImageId, propertyId) {
  await query('UPDATE source_images SET property_id = :p WHERE id = :s', {
    p: propertyId,
    s: sourceImageId,
  });
}

/** Un bien avec sa photo d'origine et l'état de chaque ambiance. */
export async function lireBien(agencyId, publicId) {
  const biens = await query(
    `SELECT id, public_id, title, city, external_ref, created_at,
            address, latitude, longitude, country_code, facade_orientation, geocode_precision
       FROM properties
      WHERE agency_id = :a AND public_id = :p
      LIMIT 1`,
    { a: agencyId, p: publicId }
  );
  if (!biens.length) return null;
  const bien = biens[0];

  const sources = await query(
    `SELECT id, public_id, storage_key, width, height
       FROM source_images
      WHERE property_id = :p
      ORDER BY id ASC`,
    { p: bien.id }
  );

  const ids = sources.map((s) => s.id);
  let variantes = [];
  if (ids.length) {
    variantes = await query(
      `SELECT v.public_id, v.scene_id, v.version, v.status, v.storage_key, v.error_message,
              v.latency_ms, v.source_image_id, v.created_at
         FROM variants v
        WHERE v.source_image_id IN (${ids.map(() => '?').join(',')})
        ORDER BY v.id ASC`,
      ids
    );
  }

  return {
    id: bien.id,
    publicId: bien.public_id,
    titre: bien.title,
    ville: bien.city,
    reference: bien.external_ref,
    creeLe: bien.created_at,
    lieu: bien.latitude == null ? null : {
      adresse: bien.address,
      latitude: Number(bien.latitude),
      longitude: Number(bien.longitude),
      pays: bien.country_code,
      orientationFacade: bien.facade_orientation,
      precision: bien.geocode_precision,
    },
    sources: sources.map((s) => ({
      publicId: s.public_id,
      url: urlPublique(s.storage_key),
      largeur: s.width,
      hauteur: s.height,
    })),
    variantes: variantes.map((v) => ({
      jeton: v.public_id,
      scene: v.scene_id,
      version: Number(v.version) || 1,
      label: sceneById[v.scene_id]?.label || (v.scene_id === 'libre' ? 'Demande libre' : v.scene_id),
      statut: v.status,
      url: v.status === 'ready' ? urlPublique(v.storage_key) : null,
      erreur: v.error_message,
      dureeMs: v.latency_ms,
    })),
  };
}

export async function listerBiens(agencyId, limite = 50) {
  return query(
    `SELECT p.public_id, p.title, p.city, p.created_at,
            (SELECT COUNT(*) FROM source_images s WHERE s.property_id = p.id) AS photos,
            (SELECT COUNT(*) FROM variants v
               JOIN source_images s2 ON s2.id = v.source_image_id
              WHERE s2.property_id = p.id AND v.status = 'ready') AS ambiances,
            (SELECT s3.storage_key FROM source_images s3 WHERE s3.property_id = p.id ORDER BY s3.id LIMIT 1) AS apercu
       FROM properties p
      WHERE p.agency_id = :a
      ORDER BY p.id DESC
      LIMIT ${Number(limite) || 50}`,
    { a: agencyId }
  ).then((rows) =>
    rows.map((r) => ({
      publicId: r.public_id,
      titre: r.title,
      ville: r.city,
      creeLe: r.created_at,
      photos: Number(r.photos),
      ambiances: Number(r.ambiances),
      apercu: urlPublique(r.apercu),
    }))
  );
}

/** Le bloc HTML à copier-coller, pré-rempli avec les ambiances déjà prêtes. */
export function extraitIntegration(bien, clePublique = 'pk_live_votre_cle') {
  const pretes = bien.variantes.filter((v) => v.statut === 'ready' && v.scene !== 'libre');
  const base = bien.sources[0]?.url || '';

  // Une ambiance peut avoir plusieurs versions. Les variantes arrivent triées
  // par id croissant : la dernière écrase les précédentes, donc le code
  // d'intégration embarque toujours l'essai le plus récent.
  const variantes = Object.fromEntries(pretes.map((v) => [v.scene, v.url]));
  const json = JSON.stringify(variantes);

  return {
    precalcule:
      `<img src="${base}"\n` +
      `     alt="${(bien.titre || 'Photo du bien').replace(/"/g, '&quot;')}"\n` +
      `     data-fourseason\n` +
      `     data-variantes='${json}'>`,
    aLaDemande:
      `<script src="${env.baseUrl}/fourseason.js"\n` +
      `        data-cle="${clePublique}" defer></script>\n\n` +
      `<img src="${base}"\n` +
      `     data-fourseason\n` +
      `     data-ambiances="${pretes.map((v) => v.scene).join(',') || 'hiver,coucher,heure-bleue'}">`,
    nbPretes: pretes.length,
  };
}

export const TOUTES_SCENES = SCENES;
