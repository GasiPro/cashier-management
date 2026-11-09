export interface SearchSegment {
  text: string;
  match: boolean;
}
export interface SearchResult {
  label: string;
  page: string;
  route: string;
  segments: SearchSegment[];
}
interface SearchPage {
  label: string;
  route: string;
  items: string[];
}
const PAGE_TAG = 'Page';
const SEARCH_PAGES: SearchPage[] = [
  {
    label: 'Accueil',
    route: 'dashboard',
    items: [
      'Total des ventes (cette année)',
      "Total des ventes (aujourd'hui)",
      "Total des transactions (aujourd'hui)",
      "Ventes : aujourd'hui vs hier",
      'Performance',
      'Historique des commandes',
    ],
  },
  {
    label: 'Comptes',
    route: 'comptes',
    items: [
      'Liste des comptes',
      'Rechercher un compte',
      'Nouveau compte',
      "Nom d'utilisateur",
      'Nom affiché',
      'Mot de passe',
      'Dernière connexion',
      'Historique',
      'Activité des comptes',
    ],
  },
  {
    label: 'Appareils & connexions',
    route: 'appareils',
    items: [
      "En attente d'approbation",
      'Appareils connectés',
      'Historique des connexions',
      'Adresse IP',
      'Adresse à partager',
      'Liste noire',
      'Entrées bloquées',
      'Ajouter une entrée',
      'Approuver',
      'Refuser',
    ],
  },
  {
    label: 'Grille tarifaire',
    route: 'grille-tarifaire',
    items: [
      'Tarifs existants',
      'Rechercher un tarif',
      'Nouveau tarif',
      'Libellé',
      'Catégorie',
      'Prix (Ar)',
      'Services',
      'Produits',
    ],
  },
  {
    label: 'Commandes',
    route: 'commandes',
    items: [
      'Rechercher une commande',
      'Trier par',
      'Payées',
      'En attente',
      'Refusées',
      'Chiffre encaissé',
      'Article',
      'Sous-total',
    ],
  },
  {
    label: 'Rapport',
    route: 'rapport',
    items: [
      'Jour',
      'Semaine',
      'Mois',
      'Année',
      'Choisir une date',
      'Filtrer par comptoir',
      'Transactions',
      'Panier moyen',
      'Articles vendus',
      'Plage horaire',
      'Par comptoir',
      'Top ventes',
      'Ajustements de prix',
      'Détail par comptoir',
    ],
  },
  {
    label: 'Mise à jour',
    route: 'mise-a-jour',
    items: ['Version actuelle', 'Vérifier les mises à jour', 'Nouvelle version disponible', 'Mettre à jour'],
  },
  {
    label: 'Profil',
    route: 'profil',
    items: ["Nom d'utilisateur", 'Nom affiché', 'Nouveau mot de passe', 'Confirmer le nouveau mot de passe'],
  },
];
const ENTRIES = SEARCH_PAGES.flatMap((page) => [
  { label: page.label, page: PAGE_TAG, route: page.route },
  ...page.items.map((label) => ({ label, page: page.label, route: page.route })),
]);
/** Lower-cases and strips accents one character at a time, so indexes still match the original text. */
function fold(value: string): string {
  return value
    .split('')
    .map((c) => c.normalize('NFD').charAt(0).toLowerCase().charAt(0))
    .join('');
}
function highlight(label: string, needle: string): SearchSegment[] {
  const folded = fold(label);
  const segments: SearchSegment[] = [];
  let from = 0;
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, from)) {
    if (at > from) segments.push({ text: label.slice(from, at), match: false });
    segments.push({ text: label.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < label.length) segments.push({ text: label.slice(from), match: false });
  return segments;
}
/** Every entry whose text includes the query (case and accent insensitive), in index order. */
export function searchAdmin(query: string): SearchResult[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  return ENTRIES.filter((entry) => fold(entry.label).includes(needle)).map((entry) => ({
    ...entry,
    segments: highlight(entry.label, needle),
  }));
}
