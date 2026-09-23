// ──────────────────────────────────────────────────────────────────────
//  Configuration de Class Connect
//  Firebase console > Paramètres du projet > Vos applications > Web (</>)
//  Copie l'objet « firebaseConfig » ci-dessous.
//  Ces valeurs sont publiques par nature (aucun secret ici) : la sécurité repose
//  sur les règles côté serveur (firestore.rules / database.rules.json),
//  sur App Check et sur le chiffrement de bout en bout.
// ──────────────────────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
  // Optionnel — statistiques (Google Analytics), chargées uniquement après accord cookies.
  measurementId: '',
  // Optionnel — présence « en ligne » et « X écrit… » (Realtime Database).
  databaseURL: '',
};

// Optionnel mais recommandé — anti-spam : clé de site reCAPTCHA v3 pour Firebase App Check.
export const RECAPTCHA_SITE_KEY = '';

// Optionnel : clé API GIPHY (developers.giphy.com) pour la recherche de GIFs.
// Sans clé, on peut toujours envoyer des GIFs depuis son appareil.
export const GIPHY_API_KEY = '';
