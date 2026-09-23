// ──────────────────────────────────────────────────────────────────────
//  Configuration de Class Connect
//  Firebase console > Paramètres du projet > Vos applications > Web (</>)
//  Copie l'objet « firebaseConfig » ci-dessous.
//  Ces valeurs sont publiques par nature (aucun secret ici) : la sécurité repose
//  sur les règles côté serveur (firestore.rules / database.rules.json),
//  sur App Check et sur le chiffrement de bout en bout.
// ──────────────────────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA5mzVaTQYjh71Zf8D0PoFwfsYwViiFoE0',
  authDomain: 'class-connectv3.firebaseapp.com',
  projectId: 'class-connectv3',
  storageBucket: 'class-connectv3.firebasestorage.app',
  messagingSenderId: '595535956311',
  appId: '1:595535956311:web:aac14184ed7a3f44249612',
  // Statistiques (Google Analytics), chargées uniquement après accord cookies.
  measurementId: 'G-731WCVC28G',
  // Présence « en ligne » et « X écrit… » (Realtime Database).
  databaseURL: 'https://class-connectv3-default-rtdb.europe-west1.firebasedatabase.app',
};

// Optionnel mais recommandé — anti-spam : clé de site reCAPTCHA v3 pour Firebase App Check.
export const RECAPTCHA_SITE_KEY = '';

// Optionnel : clé API GIPHY (developers.giphy.com) pour la recherche de GIFs.
// Sans clé, on peut toujours envoyer des GIFs depuis son appareil.
export const GIPHY_API_KEY = 'gItZUnu59yAAE3N0jfkL2c5Kfl5AXfAn';
