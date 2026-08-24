/**
 * Envoi d'emails.
 *
 * Sans SMTP configuré, les messages sont écrits dans les journaux du serveur
 * au lieu d'être envoyés. C'est délibéré : le service reste utilisable dès le
 * premier jour, sans dépendre d'un fournisseur d'envoi. Un lien de
 * vérification lu dans `pm2 logs` vaut mieux qu'une inscription bloquée.
 *
 * Infomaniak fournit déjà du SMTP avec l'hébergement — c'est le plus simple
 * à brancher ici, et l'adresse d'expédition reste sur le domaine.
 */
import nodemailer from 'nodemailer';
import env from '../config/env.js';
import brand from '../config/brand.js';

let transport = null;

function obtenirTransport() {
  if (!env.smtp.configured) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.password },
    });
  }
  return transport;
}

export const estActif = () => env.smtp.configured;

/**
 * Envoie un message, ou le journalise si SMTP n'est pas configuré.
 * Ne lève jamais : un email qui ne part pas ne doit pas faire échouer
 * une inscription déjà enregistrée en base.
 */
export async function envoyer({ a, sujet, texte, html }) {
  const t = obtenirTransport();

  if (!t) {
    console.log('\n┌─ EMAIL NON ENVOYÉ (SMTP non configuré) ────────────────');
    console.log(`│ À      : ${a}`);
    console.log(`│ Sujet  : ${sujet}`);
    console.log('├────────────────────────────────────────────────────────');
    for (const l of String(texte).split('\n')) console.log(`│ ${l}`);
    console.log('└────────────────────────────────────────────────────────\n');
    return { envoye: false, raison: 'smtp-absent' };
  }

  try {
    await t.sendMail({
      from: env.smtp.from || `${brand.name} <${brand.email}>`,
      to: a,
      subject: sujet,
      text: texte,
      html: html || undefined,
    });
    return { envoye: true };
  } catch (err) {
    console.error(`[courriel] échec d'envoi à ${a} :`, err.message);
    return { envoye: false, raison: err.message };
  }
}

/* ---------------------------------------------------------- modeles ----- */

const gabarit = (titre, corps, bouton) => `
<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2733">
  <p style="font-size:20px;margin:0 0 24px"><b>${brand.name}</b></p>
  <h1 style="font-size:22px;font-weight:400;margin:0 0 16px">${titre}</h1>
  <div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#48526a">${corps}</div>
  ${bouton ? `<p style="margin:28px 0"><a href="${bouton.url}" style="background:#0B1220;color:#F6F1E8;padding:12px 22px;border-radius:4px;text-decoration:none;font-family:system-ui,sans-serif;font-size:15px">${bouton.texte}</a></p>` : ''}
  <p style="font-family:system-ui,sans-serif;font-size:12px;color:#8a93a1;margin-top:32px;border-top:1px solid #e6e9ee;padding-top:16px">
    ${brand.name} — ${brand.tagline}
  </p>
</div>`;

export function bienvenue({ a, nomAgence, lienVerif, credits }) {
  return envoyer({
    a,
    sujet: `Bienvenue sur ${brand.name}`,
    texte:
      `Bonjour,\n\nVotre compte « ${nomAgence} » est créé, avec ${credits} ambiances offertes.\n\n` +
      `Confirmez votre adresse :\n${lienVerif}\n\n` +
      `Vos clés d'API vous attendent dans votre espace, onglet Compte.\n\n— ${brand.name}`,
    html: gabarit(
      'Votre compte est ouvert',
      `<p>Votre agence <b>${nomAgence}</b> est créée, avec <b>${credits} ambiances offertes</b> pour commencer.</p>
       <p>Confirmez votre adresse pour activer l'ensemble des fonctions.</p>`,
      { url: lienVerif, texte: 'Confirmer mon adresse' }
    ),
  });
}

export function reinitialisation({ a, lien }) {
  return envoyer({
    a,
    sujet: `Réinitialiser votre mot de passe ${brand.name}`,
    texte:
      `Vous avez demandé à réinitialiser votre mot de passe.\n\n${lien}\n\n` +
      `Ce lien expire dans une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    html: gabarit(
      'Réinitialiser votre mot de passe',
      `<p>Ce lien expire dans une heure.</p>
       <p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne changera.</p>`,
      { url: lien, texte: 'Choisir un nouveau mot de passe' }
    ),
  });
}
