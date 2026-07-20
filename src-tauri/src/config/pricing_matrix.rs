#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceItemType {
    Service,
    Product,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceItem {
    pub id: &'static str,
    pub category: &'static str,
    pub label: &'static str,
    pub price: u32, 
    pub item_type: ServiceItemType,
}

pub const PRICING_MATRIX: &[ServiceItem] = &[
    // ── Photocopie (A3 + A4 regroupés) ──────────────────────────────────────────
    ServiceItem { id: "pca3nb", category: "Photocopie", label: "A3 NB", price: 1000, item_type: ServiceItemType::Service },
    ServiceItem { id: "pca3cl", category: "Photocopie", label: "A3 Couleur", price: 2000, item_type: ServiceItemType::Service },
    ServiceItem { id: "pca4etnb", category: "Photocopie", label: "A4 Étudiant NB", price: 100, item_type: ServiceItemType::Service },
    ServiceItem { id: "pca4nb", category: "Photocopie", label: "A4 Normal NB", price: 200, item_type: ServiceItemType::Service },
    ServiceItem { id: "pca4cl", category: "Photocopie", label: "A4 Couleur", price: 500, item_type: ServiceItemType::Service },
    // ── Impression ───────────────────────────────────────────────────────────────
    ServiceItem { id: "impetnb", category: "Impression", label: "Étudiant NB", price: 100, item_type: ServiceItemType::Service },
    ServiceItem { id: "impnb", category: "Impression", label: "Normal NB", price: 400, item_type: ServiceItemType::Service },
    ServiceItem { id: "impcl", category: "Impression", label: "Couleur", price: 500, item_type: ServiceItemType::Service },
    // ── Saisie ───────────────────────────────────────────────────────────────────
    ServiceItem { id: "saibul", category: "Saisie", label: "Bulletin naissance", price: 600, item_type: ServiceItemType::Service },
    ServiceItem { id: "sainor", category: "Saisie", label: "Normal", price: 1500, item_type: ServiceItemType::Service },
    ServiceItem { id: "saicmp", category: "Saisie", label: "Complexe", price: 2000, item_type: ServiceItemType::Service },
    // ── Plastification ───────────────────────────────────────────────────────────
    ServiceItem { id: "plas1", category: "Plastification", label: "Petite", price: 1000, item_type: ServiceItemType::Service },
    ServiceItem { id: "plas2", category: "Plastification", label: "Moyenne", price: 1500, item_type: ServiceItemType::Service },
    ServiceItem { id: "plas3", category: "Plastification", label: "Grande", price: 2000, item_type: ServiceItemType::Service },
    ServiceItem { id: "plas4", category: "Plastification", label: "A4", price: 3000, item_type: ServiceItemType::Service },
    ServiceItem { id: "plas5", category: "Plastification", label: "A3", price: 5000, item_type: ServiceItemType::Service },
    // ── Photo ─────────────────────────────────────────────────────────────────────
    ServiceItem { id: "ph1015", category: "Photo", label: "10×15", price: 500, item_type: ServiceItemType::Service },
    ServiceItem { id: "pha5", category: "Photo", label: "A5", price: 1500, item_type: ServiceItemType::Service },
    ServiceItem { id: "pha4", category: "Photo", label: "A4", price: 3000, item_type: ServiceItemType::Service },
    ServiceItem { id: "pha3", category: "Photo", label: "A3", price: 5000, item_type: ServiceItemType::Service },
    // ── Connexion Poste ──────────────────────────────────────────────────────────
    ServiceItem { id: "cp20", category: "Connexion Poste", label: "20 min", price: 600, item_type: ServiceItemType::Service },
    ServiceItem { id: "cp40", category: "Connexion Poste", label: "40 min", price: 1000, item_type: ServiceItemType::Service },
    ServiceItem { id: "cp90", category: "Connexion Poste", label: "1h30", price: 2000, item_type: ServiceItemType::Service },
    ServiceItem { id: "cp4h", category: "Connexion Poste", label: "4h", price: 5000, item_type: ServiceItemType::Service },
    // ── Service divers ───────────────────────────────────────────────────────────
    ServiceItem { id: "scan", category: "Service", label: "Scan", price: 500, item_type: ServiceItemType::Service },
    ServiceItem { id: "mail", category: "Service", label: "Envoi Mail", price: 600, item_type: ServiceItemType::Service },
    ServiceItem { id: "cptcreate", category: "Service", label: "Création compte", price: 1000, item_type: ServiceItemType::Service },
    // ── Reliure ───────────────────────────────────────────────────────────────────
    ServiceItem { id: "rel1", category: "Reliure", label: "1 000 Ar", price: 1000, item_type: ServiceItemType::Service },
    ServiceItem { id: "rel2", category: "Reliure", label: "1 500 Ar", price: 1500, item_type: ServiceItemType::Service },
    ServiceItem { id: "rel3", category: "Reliure", label: "2 000 Ar", price: 2000, item_type: ServiceItemType::Service },
    ServiceItem { id: "rel4", category: "Reliure", label: "3 000 Ar", price: 3000, item_type: ServiceItemType::Service },
    ServiceItem { id: "rel5", category: "Reliure", label: "5 000 Ar", price: 5000, item_type: ServiceItemType::Service },
    // ── Divers ────────────────────────────────────────────────────────────────────
    ServiceItem { id: "film", category: "Divers", label: "Film", price: 200, item_type: ServiceItemType::Product },
    ServiceItem { id: "serie", category: "Divers", label: "Série", price: 1000, item_type: ServiceItemType::Product },
    // ── Carnet LP ────────────────────────────────────────────────────────────────
    ServiceItem { id: "prpfnl", category: "Carnet LP", label: "PFNL", price: 12500, item_type: ServiceItemType::Product },
    ServiceItem { id: "prchar", category: "Carnet LP", label: "Charbon", price: 12500, item_type: ServiceItemType::Product },
    ServiceItem { id: "prbois", category: "Carnet LP", label: "Bois", price: 12000, item_type: ServiceItemType::Product },
    ServiceItem { id: "prchant", category: "Carnet LP", label: "Cahier chantier", price: 14000, item_type: ServiceItemType::Product },
    // ── Enveloppes ────────────────────────────────────────────────────────────────
    ServiceItem { id: "envc5", category: "Enveloppe", label: "C5", price: 100, item_type: ServiceItemType::Product },
    ServiceItem { id: "enva5", category: "Enveloppe", label: "A5", price: 400, item_type: ServiceItemType::Product },
    ServiceItem { id: "enva4", category: "Enveloppe", label: "A4", price: 500, item_type: ServiceItemType::Product },
    ServiceItem { id: "enva3", category: "Enveloppe", label: "A3", price: 800, item_type: ServiceItemType::Product },
    // ── Produits divers ───────────────────────────────────────────────────────────
    ServiceItem { id: "journal", category: "Produit", label: "Journal", price: 9000, item_type: ServiceItemType::Product },
    ServiceItem { id: "chemise", category: "Produit", label: "Chemise", price: 400, item_type: ServiceItemType::Product },
    ServiceItem { id: "classeur", category: "Produit", label: "Classeur", price: 3000, item_type: ServiceItemType::Product },
    ServiceItem { id: "bristol", category: "Produit", label: "Bristol", price: 500, item_type: ServiceItemType::Product },
];