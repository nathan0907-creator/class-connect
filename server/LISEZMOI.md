# Serveur de notifications Class Connect (gratuit, sur un vieux PC)

Ce petit programme envoie les notifications « Nouveau message de … » aux téléphones **même quand l'appli est fermée**.
Il doit tourner sur un PC **allumé et connecté à Internet** en permanence (un vieux PC suffit largement).

- **Gratuit** : l'envoi de notifications Firebase ne coûte rien, aucune carte bancaire n'est demandée.
- **Confidentiel** : les messages sont chiffrés de bout en bout, le serveur ne peut pas les lire. Il envoie seulement le pseudo de l'auteur et le nom du canal.
- **Un seul PC à la fois** : ne le lance pas sur deux ordinateurs en même temps.

## 1. Installer Node.js sur le vieux PC

Télécharge la version **LTS** sur https://nodejs.org et installe-la (tout par défaut).
Il faut Windows 10 ou 11 (Windows 7 / 8 ne sont plus pris en charge par Node.js).

## 2. Télécharger la clé du serveur (à faire toi-même)

1. Ouvre https://console.firebase.google.com/project/class-connectv3/settings/serviceaccounts/adminsdk
2. Clique sur **« Générer une nouvelle clé privée »** puis **« Générer la clé »** : un fichier `.json` se télécharge.
3. Renomme-le exactement **`service-account.json`**.

> ⚠️ **Cette clé donne un accès total à la base de données.** Ne l'envoie à personne, ne la mets jamais sur GitHub,
> dans un chat ou sur une clé USB partagée. Si elle fuite : même page → supprime la clé, puis génère-en une nouvelle.

## 3. Copier le dossier `server` sur le vieux PC

1. Télécharge le projet : https://github.com/nathan0907-creator/class-connect/archive/refs/heads/main.zip
2. Décompresse-le et copie le dossier **`server`** où tu veux sur le vieux PC (par exemple `C:\ClassConnect\server`).
3. Mets le fichier **`service-account.json`** dans ce dossier `server`.

## 4. Lancer le serveur

Double-clique sur **`installer-demarrage-auto.bat`** :
- le serveur démarre (fenêtre réduite dans la barre des tâches) ;
- il redémarrera **tout seul à chaque allumage du PC**, et se relance s'il plante.

Dans la fenêtre, tu dois voir `🚀 Serveur de notifications Class Connect démarré` puis `✔ users chargés`, `✔ tokens chargés`…
À chaque message envoyé dans une classe, une ligne `🔔 … notification(s)` s'affiche.

Pour juste le lancer une fois (sans démarrage automatique) : double-clique sur **`demarrer.bat`**.

## 5. Empêcher le PC de se mettre en veille

Paramètres Windows → **Système → Alimentation** → « Mettre en veille » : **Jamais** (sur secteur).
Tu peux éteindre l'écran, ça ne gêne pas.

## 6. Tester

1. Sur ton téléphone : ouvre l'appli installée → onglet **Équipage** → **Activer les notifications**.
2. **Ferme complètement** l'appli.
3. Depuis un autre compte, envoie un message dans la classe : la notification arrive sur le téléphone.

## Arrêter / désinstaller

- Arrêter : ferme la fenêtre « Class Connect - notifications ».
- Ne plus démarrer automatiquement : supprime `class-connect-notifications.bat` dans le dossier
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` (tape ce chemin dans l'explorateur).

Quand le PC est éteint, le site marche normalement : seules les notifications « appli fermée » sont en pause.
