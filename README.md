# 🪐 Class Connect

La station spatiale de ta classe : **chat chiffré de bout en bout** (texte, images, vidéos, GIFs),
**votes sur l'emploi du temps** et un **poste de commandement pour le délégué**, dans un univers 3D.

- **100 % gratuit** : site statique sur **GitHub Pages** + backend **Firebase** (offre Spark, sans carte bancaire).
- **Aucun build** : HTML/CSS/JS pur ; Three.js et Firebase chargés depuis leur CDN officiel.

---

## ✨ Fonctionnalités

| | |
|---|---|
| 🚀 **Connexion « mission »** | Un seul champ (pseudo ou e-mail) et un bouton « Décoller ». La fusée décolle, le pseudo est embarqué. Pseudo inconnu → création de compte (mot de passe + e-mail facultatif) ; pseudo connu → mot de passe (+ « mot de passe oublié »). Atterrissage sur Mars : « Compte créé ! » ou « Connexion réussie ». Bouton retour à chaque étape. |
| 🛡️ **Chiffrement E2E** | Messages et médias chiffrés AES-256-GCM dans le navigateur ; clés de classe distribuées par ECDH P-256. Firebase ne stocke que du charabia. |
| 💬 **Chat** | Temps réel, images (compressées), vidéos (≤ 15 Mo), GIFs (import ou recherche GIPHY), emojis, glisser-déposer, épinglage, « X écrit… », présence en ligne. |
| 🧠 **Révisions IA** | Bibliothèque de cours chiffrée (PDF, photos du cahier, texte) publiée par les délégués et membres « de confiance ». Gemini génère fiches, quiz QCM, évaluations notées /20 et répond aux questions **uniquement à partir de ces cours**, avec les méthodes du cahier. |
| 🗳️ **Votes** | Ajout / modification / suppression de cours, vote secret pour/contre/abstention, compte à rebours. |
| ⭐ **Délégué** | Valide les membres, exclut (avec renouvellement de la clé), nomme des délégués, adopte les propositions (appliquées automatiquement). |
| 🌌 **3D** | Galaxie, planète à anneaux, astéroïdes, nébuleuses, étoiles filantes, saut en hyperespace, transitions 3D. |

---

## 🚀 Mise en ligne

### 1. Firebase (≈ 5 min)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet** (Google Analytics : activé si tu veux les statistiques).
2. **Build → Authentication → Commencer → E-mail/Mot de passe → Activer.**
3. **Build → Firestore Database → Créer une base** (mode production, région `europe-west`).
   Onglet **Règles** : colle le contenu de [`firestore.rules`](firestore.rules) → **Publier**.
4. *(Optionnel, présence & « écrit… »)* **Build → Realtime Database → Créer**, onglet **Règles** : colle [`database.rules.json`](database.rules.json).
5. **Paramètres du projet → Vos applications → Web `</>`** → copie `firebaseConfig` dans [`public/js/config.js`](public/js/config.js).
6. **Authentication → Paramètres → Domaines autorisés** : ajoute `TON-PSEUDO.github.io`.
7. *(Recommandé, anti-spam)* **App Check** : enregistre l'app avec **reCAPTCHA v3** (clé gratuite sur
   [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin)), colle la clé de site dans `RECAPTCHA_SITE_KEY`, puis active l'application forcée pour Firestore.

8. **Assistant de révision IA** : **Build → AI Logic → Commencer → Gemini Developer API** (gratuit, sans facturation).
   Modèles utilisés : `gemini-3.8-flash`, avec `gemini-3.5-flash-lite` en secours (modifiables dans `config.js`).

### 2. GitHub Pages

1. Pousse ce dossier dans un dépôt **public** nommé `class-connect`.
2. **Settings → Pages → Source : GitHub Actions**, puis coche **Enforce HTTPS**.
3. Le workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publie `public/` à chaque push.

---

## ✅ Checklist qualité

| # | Point | Où / comment |
|---|---|---|
| 1 | Page RGPD | [`confidentialite.html`](public/confidentialite.html) + suppression de compte en libre-service |
| 2 | CGU | [`cgu.html`](public/cgu.html), acceptation obligatoire à l'inscription |
| 3 | API hors front-end | Aucun secret dans le code. Toute l'autorisation est vérifiée **côté serveur** par [`firestore.rules`](firestore.rules) ; App Check bloque les appels hors du site |
| 4 | HTTPS forcé | Redirection http→https, `upgrade-insecure-requests`, « Enforce HTTPS » GitHub, HSTS (Firebase Hosting) |
| 5 | Bannière cookies | [`consent.js`](public/js/consent.js) : « Refuser » aussi visible qu'« Accepter », analytics seulement après accord |
| 6 | Meta title | Titre + description uniques sur chaque page |
| 7 | Image réseaux | `img/og-image.jpg` 1200×630 (Open Graph + Twitter) |
| 8 | Favicon | `favicon.ico`, SVG, `apple-touch-icon`, icônes PWA + `site.webmanifest` |
| 9 | Sitemap + robots | `sitemap.xml`, `robots.txt` |
| 10 | Textes images | `alt` sur les images, `aria-label` sur les boutons-icônes, décor en `aria-hidden` |
| 11 | Compression images | Images du site optimisées ; photos envoyées redimensionnées (≤ 2048 px, WebP/JPEG) avant chiffrement |
| 12 | Vitesse | 3D chargée en différé, `preconnect`/`modulepreload`, polices réduites, médias en lazy-load |
| 13 | Contraste | Palette vérifiée WCAG AA (≥ 4,5:1) |
| 14 | Responsive | Mise en page mobile (barre de navigation en bas), testée à 375 px |
| 15 | Page 404 | [`404.html`](public/404.html) « Perdu dans l'espace » |
| 16 | Liens cassés | `npm run check` vérifie tous les liens locaux |
| 17 | Validation formulaires | Messages d'erreur clairs côté client **et** validation stricte côté serveur (règles) |
| 18 | Anti-spam | Pot de miel + délai minimal sur les formulaires, blocage après 5 échecs, 1 message/s imposé par les règles, App Check |
| 19 | Analytics | Google Analytics via Firebase (`measurementId`), après consentement |
| 20 | Un seul CTA | Accueil : un champ, un bouton « Décoller » |

---

## 💻 En local

```bash
npm run dev     # http://localhost:5173
npm run check   # vérifie les liens
```

## 🔒 Sécurité — à savoir

- **Mot de passe** → PBKDF2 (310 000 itérations) → une clé pour se connecter, une autre pour chiffrer ta clé privée.
- **Mot de passe oublié** (si e-mail renseigné) : après réinitialisation, tes clés sont régénérées et un membre en ligne
  te retransmet automatiquement l'accès aux anciens messages.
- **Empreintes de sécurité** (onglet Équipage) : compare-les en vrai pour détecter une substitution de clé.
- Votes et emploi du temps ne sont pas chiffrés (il faut pouvoir compter) mais le bulletin est secret.
- Un pseudo permet de retrouver l'e-mail de connexion associé (nécessaire pour se connecter par pseudo) :
  si tu veux rester discret, n'indique pas d'e-mail.

## 📊 Limites de l'offre gratuite Firebase (par jour)

50 000 lectures · 20 000 écritures · 1 Go stocké — largement suffisant pour une classe. Les vidéos sont limitées à 15 Mo.
