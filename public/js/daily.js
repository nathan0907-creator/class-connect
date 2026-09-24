// Fun content that changes every day / week, the same for the whole class (picked from the date, no server needed).

export const QUESTIONS = [
  'Si tu pouvais avoir un super-pouvoir pour une journée, lequel ?',
  'Quel est le meilleur plat de la cantine (sois honnête) ?',
  'Quelle chanson tu écoutes en boucle en ce moment ?',
  'Si la classe partait en voyage demain, on irait où ?',
  'Quel métier tu voudrais essayer pendant une semaine ?',
  'Film ou série préféré de tous les temps ?',
  'Quelle matière tu aimerais qu\'on invente ?',
  'Tu préfères vivre sur Mars ou sous l\'océan ?',
  'Quel est ton emoji le plus utilisé ?',
  'Si tu étais prof, quelle règle tu changerais en premier ?',
  'Le meilleur conseil qu\'on t\'ait donné ?',
  'Quel jeu vidéo ou jeu de société tu recommandes ?',
  'Qu\'est-ce qui te fait rire à tous les coups ?',
  'Petit-déj salé ou sucré ?',
  'Quel animal tu serais, et pourquoi ?',
  'Si tu pouvais dîner avec une personne célèbre, qui ?',
  'Ton endroit préféré pour réviser ?',
  'Quelle est la chose la plus bizarre que tu sais faire ?',
  'Le livre ou la BD que tu conseillerais à la classe ?',
  'Qu\'est-ce que tu ferais avec 1000 € à dépenser aujourd\'hui ?',
  'Été ou hiver ?',
  'Quelle appli tu ne pourrais pas supprimer de ton téléphone ?',
  'Ton meilleur souvenir de classe (sans balancer personne 😇) ?',
  'Si tu créais une fête, elle célébrerait quoi ?',
  'Quel talent tu aimerais apprendre cette année ?',
  'Chiens ou chats ?',
  'La meilleure excuse pour un devoir pas fait ?',
  'Ton goûter parfait ?',
  'Quelle époque tu aimerais visiter en machine à remonter le temps ?',
  'Le sport que tu aimerais essayer ?',
  'Qu\'est-ce qui te motive le lundi matin ?',
  'Quel est le son le plus satisfaisant du monde ?',
  'Si ta vie était un film, quel serait le titre ?',
  'La planète du système solaire qui te ressemble le plus ?',
  'Ton objectif pour cette semaine ?',
  'La meilleure invention de tous les temps ?',
  'Quel pays tu rêves de visiter ?',
  'Qu\'est-ce que tu collectionnes (ou collectionnais) ?',
  'Pizza : ananas ou pas ananas ?',
  'Un compliment pour la classe aujourd\'hui ?',
  'Si tu étais un personnage de dessin animé, lequel ?',
  'Le cours le plus utile de l\'année jusqu\'ici ?',
  'Ta technique secrète pour retenir une leçon ?',
  'Le meilleur moment de la journée ?',
  'Tu préfères pouvoir voler ou être invisible ?',
  'Quelle musique pour une fête de fin d\'année ?',
  'Qu\'est-ce que tu aimerais dire à toi-même dans 10 ans ?',
  'Un fun fact que personne ne connaît ?',
  'Le meilleur dessert du monde ?',
  'Quelle règle de la vie de classe tu ajouterais ?',
];

export const WOULD_YOU_RATHER = [
  ['Pouvoir parler aux animaux', 'Parler toutes les langues du monde'],
  ['Plus jamais de devoirs', 'Plus jamais de contrôles'],
  ['Vivre dans l\'espace', 'Vivre au fond de l\'océan'],
  ['Une journée de 30 heures', 'Une semaine de 4 jours'],
  ['Être super rapide', 'Être super fort'],
  ['Voyager dans le passé', 'Voyager dans le futur'],
  ['Pizza à tous les repas', 'Burger à tous les repas'],
  ['Ne plus jamais avoir froid', 'Ne plus jamais avoir chaud'],
  ['Lire dans les pensées', 'Voir 10 secondes dans le futur'],
  ['Un dragon de compagnie', 'Un robot de compagnie'],
  ['Être célèbre', 'Être très riche mais inconnu'],
  ['Sans téléphone pendant un mois', 'Sans musique pendant un mois'],
  ['Visiter la Lune', 'Visiter les pyramides'],
  ['Cours à 7 h et fin à 14 h', 'Cours à 10 h et fin à 18 h'],
  ['Téléportation', 'Invisibilité'],
  ['Toujours dire la vérité', 'Toujours mentir'],
  ['Chanter tout ce que tu dis', 'Danser à chaque fois que tu marches'],
  ['Vacances à la montagne', 'Vacances à la mer'],
  ['Gagner un match décisif', 'Avoir 20/20 au bac de maths'],
  ['Mémoire photographique', 'Ne plus jamais avoir besoin de dormir'],
];

/** Weekly challenges: `check(stats)` tells if it is done from the member's own counters (see fun.js). */
export const CHALLENGES = [
  { id: 'voice', text: 'Envoie un message vocal', check: (w) => w.voice >= 1 },
  { id: 'react10', text: 'Réagis à 10 messages', check: (w) => w.reactions >= 10 },
  { id: 'qotd3', text: 'Réponds à 3 questions du jour', check: (w) => w.qotd >= 3 },
  { id: 'poll', text: 'Vote à un sondage', check: (w) => w.votes >= 1 },
  { id: 'compliment', text: 'Écris un compliment à quelqu\'un', check: (w) => w.compliments >= 1 },
  { id: 'study', text: 'Fais un quiz de révision', check: (w) => w.quizzes >= 1 },
  { id: 'msgs20', text: 'Envoie 20 messages', check: (w) => w.messages >= 20 },
  { id: 'game', text: 'Joue une partie de mini-jeu', check: (w) => w.games >= 1 },
  { id: 'flash', text: 'Révise 20 flashcards', check: (w) => w.cards >= 20 },
  { id: 'pomodoro', text: 'Termine une session « on révise ensemble »', check: (w) => w.pomodoros >= 1 },
];

/** Day number since 2020 (same everywhere in France, changes at midnight). */
export const dayIndex = (d = new Date()) => Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(2020, 0, 1)) / 864e5);
export const weekIndex = (d = new Date()) => Math.floor((dayIndex(d) + 2) / 7);   // weeks start on Monday (1 Jan 2020 was a Wednesday)

export const questionOfTheDay = (d) => QUESTIONS[dayIndex(d) % QUESTIONS.length];
export const randomWYR = () => WOULD_YOU_RATHER[Math.floor(Math.random() * WOULD_YOU_RATHER.length)];
/** Three challenges per week, the same for everybody. */
export function challengesOfTheWeek(d) {
  const w = weekIndex(d);
  const out = [];
  for (let i = 0; out.length < 3; i++) {
    const c = CHALLENGES[(w * 3 + i * 7) % CHALLENGES.length];
    if (!out.includes(c)) out.push(c);
  }
  return out;
}
