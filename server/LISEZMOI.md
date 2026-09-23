# Serveur de notifications Class Connect (gratuit, sur un vieux PC)

Ce petit programme envoie les notifications « Nouveau message de … » aux téléphones **même quand l'appli est fermée**.
Il doit tourner sur un PC **allumé et connecté à Internet** en permanence (un vieux PC suffit largement).

- **Gratuit** : l'envoi de notifications Firebase ne coûte rien, aucune carte bancaire n'est demandée.
- **Confidentiel** : les messages sont chiffrés de bout en bout, le serveur ne peut pas les lire. Il envoie seulement le pseudo de l'auteur et le nom du canal.
- **Un seul PC à la fois** : ne le lance pas sur deux ordinateurs en même temps.

## Sur Linux (Debian / Ubuntu, par SSH) — recommandé

1. **Sur ton PC Windows**, télécharge la clé (voir l'étape 2 plus bas) : fichier `service-account.json` dans `Téléchargements`.
2. **Connecte-toi au serveur** et récupère le dossier `server` :
   ```bash
   ssh utilisateur@ip-du-serveur
   curl -L https://github.com/nathan0907-creator/class-connect/archive/refs/heads/main.tar.gz | tar xz
   mv class-connect-main/server ~/class-connect-push && rm -rf class-connect-main
   ```
3. **Depuis Windows** (PowerShell), envoie la clé sur le serveur :
   ```powershell
   scp $env:USERPROFILE\Downloads\service-account.json utilisateur@ip-du-serveur:~/class-connect-push/
   ```
   Puis supprime-la de `Téléchargements` (elle n'a plus rien à faire sur ton PC).
4. **Sur le serveur**, installe le service :
   ```bash
   cd ~/class-connect-push && bash installer-debian.sh
   ```
   Le script installe Node.js si besoin, protège la clé (`chmod 600`) et crée le service systemd
   `class-connect-push` : il démarre à chaque allumage et redémarre tout seul s'il plante.
5. Suivre ce qui se passe : `sudo journalctl -u class-connect-push -f` (Ctrl+C pour quitter, le service continue).

Mettre à jour plus tard : refais l'étape 2 dans un dossier temporaire, copie `push-server.mjs` dans `~/class-connect-push/`,
puis `sudo systemctl restart class-connect-push`.

Si c'est un portable : pour qu'il ne se mette pas en veille capot fermé, mets `HandleLidSwitch=ignore` dans
`/etc/systemd/logind.conf` puis `sudo systemctl restart systemd-logind`.

---

## Sur Windows

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
