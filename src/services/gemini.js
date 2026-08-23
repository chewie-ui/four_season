/**
 * Service de génération d'images — Google Gemini (« Nano Banana »).
 *
 * Pourquoi Gemini plutôt qu'un autre modèle : c'est un modèle d'ÉDITION d'image,
 * pas de génération à partir de rien. On lui donne la photo réelle + une consigne,
 * et il conserve l'architecture, le cadrage et la perspective. C'est exactement
 * ce que le produit exige : le client doit reconnaître SA maison.
 *
 * Modèles :
 *   - gemini-2.5-flash-image        rapide et bon marché  → production, ~0,039 $/image
 *   - gemini-3-pro-image-preview    plus fin, plus cher   → option « qualité brochure »
 *
 * ⚠ Vérifier le nom exact du modèle et la version du SDK au moment de brancher
 *   la clé : https://ai.google.dev/gemini-api/docs/image-generation
 */
import { GoogleGenAI } from '@google/genai';
import env from '../config/env.js';
import { buildPrompt } from '../config/scenes.js';

let client = null;
function getClient() {
  if (!env.gemini.configured) return null;
  if (!client) client = new GoogleGenAI({ apiKey: env.gemini.apiKey });
  return client;
}

export const isConfigured = () => env.gemini.configured;

/** Coût observé par image, en millionièmes d'euro. À recaler avec la facture réelle. */
export const COST_MICRO_EUR = {
  'gemini-2.5-flash-image': 36_000,        // ≈ 0,036 €
  'gemini-3-pro-image-preview': 130_000,   // ≈ 0,13 €
};

export class GeminiError extends Error {
  /**
   * @param {object} opts
   * @param {boolean} [opts.rejouable] false = réessayer ne servira à rien.
   *        Le worker s'en sert pour ne pas brûler trois tentatives sur une
   *        erreur de configuration (facturation absente, modèle inexistant).
   */
  constructor(message, { status = 502, cause, rejouable = true } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.publicMessage = message;
    this.rejouable = rejouable;
    this.cause = cause;
  }
}

/**
 * Régénère une photo de bien dans une ambiance donnée.
 *
 * @param {Buffer} imageBuffer   photo d'origine
 * @param {string} mimeType      'image/jpeg' | 'image/png' | 'image/webp'
 * @param {string} sceneId       identifiant dans src/config/scenes.js
 * @param {object} [opts]
 * @param {string} [opts.extra]          consigne libre ajoutée par l'utilisateur
 * @param {string} [opts.promptComplet]  prompt déjà construit (utilisé par le worker,
 *                                       qui relit celui stocké avec la variante)
 * @param {string} [opts.model]          surcharge du modèle
 * @returns {Promise<{buffer: Buffer, mimeType: string, model: string, latencyMs: number, costMicroEur: number, prompt: string}>}
 */
export async function generateVariant(imageBuffer, mimeType, sceneId, opts = {}) {
  const ai = getClient();
  if (!ai) throw new GeminiError('Clé GEMINI_API_KEY absente du .env', { status: 503 });

  const model = opts.model || env.gemini.model;
  const prompt = opts.promptComplet || buildPrompt(sceneId, opts.extra || '');
  const started = Date.now();

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: imageBuffer.toString('base64') } },
            { text: prompt },
          ],
        },
      ],
    });
  } catch (err) {
    throw traduireErreur(err);
  }

  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);

  if (!imagePart) {
    // Cas fréquent : le modèle a refusé (filtre de sécurité) et n'a renvoyé que du texte.
    const reason = response?.candidates?.[0]?.finishReason;
    const said = parts.find((p) => p.text)?.text;
    throw new GeminiError(
      said
        ? `Le modèle n’a pas produit d’image : ${said.slice(0, 200)}`
        : `Le modèle n’a pas produit d’image (${reason || 'raison inconnue'})`,
      { status: 422 }
    );
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType || 'image/png',
    model,
    latencyMs: Date.now() - started,
    costMicroEur: COST_MICRO_EUR[model] ?? 40_000,
    prompt,
  };
}

/**
 * Traduit une erreur du SDK en diagnostic utilisable.
 *
 * Distinction essentielle sur les 429 : Google renvoie le même code pour
 * « vous allez trop vite » (réessayer marche) et « votre palier n'autorise
 * aucune génération d'image » (réessayer ne marchera jamais). C'est
 * `limit: 0` dans le détail du message qui les sépare. Sans cette lecture,
 * le worker brûle trois tentatives et 50 secondes sur une erreur de compte.
 */
function traduireErreur(err) {
  const msg = String(err?.message || err);

  if (/API key|API_KEY_INVALID/i.test(msg) || /\b401\b/.test(msg)) {
    return new GeminiError('Clé API Gemini invalide.', { status: 401, rejouable: false, cause: err });
  }

  if (/quota|RESOURCE_EXHAUSTED/i.test(msg) || /\b429\b/.test(msg)) {
    // « limit: 0 » sur le palier gratuit = la facturation n'est pas activée.
    if (/limit:\s*0\b/i.test(msg) || /free_tier/i.test(msg)) {
      return new GeminiError(
        'Le palier gratuit Gemini n’autorise aucune génération d’image (limit: 0). ' +
          'Activez la facturation sur le projet Google Cloud associé à la clé : ' +
          'https://aistudio.google.com/apikey → votre projet → Set up billing.',
        { status: 402, rejouable: false, cause: err }
      );
    }
    return new GeminiError('Débit Gemini dépassé. Nouvelle tentative dans quelques instants.', {
      status: 429,
      rejouable: true,
      cause: err,
    });
  }

  if (/not found|NOT_FOUND/i.test(msg) || /\b404\b/.test(msg)) {
    const conseil = /no longer available/i.test(msg)
      ? ' Ce modèle a été retiré : prenez celui indiqué dans le message ci-dessus.'
      : '';
    return new GeminiError(
      `Modèle « ${env.gemini.model} » introuvable ou inaccessible.${conseil} ` +
        'Corrigez GEMINI_IMAGE_MODEL dans .env — la liste réelle est donnée par `npm run gemini:models`.',
      { status: 404, rejouable: false, cause: err }
    );
  }

  if (/permission|PERMISSION_DENIED/i.test(msg) || /\b403\b/.test(msg)) {
    return new GeminiError('Clé refusée pour ce modèle (permission). Vérifiez le projet Google Cloud.', {
      status: 403,
      rejouable: false,
      cause: err,
    });
  }

  if (/deadline|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) {
    return new GeminiError('Délai dépassé côté Gemini.', { status: 504, rejouable: true, cause: err });
  }

  return new GeminiError(`Erreur Gemini : ${msg.slice(0, 200)}`, { status: 502, rejouable: true, cause: err });
}
