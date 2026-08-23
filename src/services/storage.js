import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import env from '../config/env.js';

/**
 * Stockage des images. Un seul driver pour l'instant (disque local).
 * L'interface est volontairement minimale pour brancher S3 / Swiss Backup
 * plus tard sans toucher au reste du code.
 */

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** @returns {Promise<{key: string, url: string, bytes: number}>} */
export async function put(buffer, mimeType, prefix = 'variants') {
  const ext = EXT[mimeType] || 'png';
  const now = new Date();
  const key = [
    prefix,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${randomUUID()}.${ext}`,
  ].join('/');

  const full = join(env.storage.localPath, key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, buffer);

  return { key, url: `/media/${key}`, bytes: buffer.length };
}

export async function get(key) {
  return readFile(join(env.storage.localPath, key));
}

export const localRoot = () => env.storage.localPath;
