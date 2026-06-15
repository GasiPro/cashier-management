// order.service.ts  — service partagé entre Comptoir et Caissier
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type OrderStatus = 'EN_ATTENTE' | 'PAYE';

export interface Order {
  id: number;
  group_id: number;          // Pour la même commande
  service_type: string;
  unit_price: number;
  quantity: number;
  status: OrderStatus;
  time: string;
  created_at: string;
  paid_at: string | null;
}

export interface ServiceItem {
  id: string;
  category: string;
  label: string;
  price: number;
  type: 'service' | 'produit';
}

// Le panier pour la commande
export interface CartItem {
  service: ServiceItem;
  qty: number;
  unitPrice: number;
}

export const SERVICE_CATALOGUE: ServiceItem[] = [
  // ── Photocopie (A3 + A4 regroupés) ──────────────────────────────────────────
  { id: 'pca3nb',    category: 'Photocopie', label: 'A3 NB',             price: 1000, type: 'service' },
  { id: 'pca3cl',    category: 'Photocopie', label: 'A3 Couleur',        price: 2000, type: 'service' },
  { id: 'pca4etnb',  category: 'Photocopie', label: 'A4 Étudiant NB',    price: 100,  type: 'service' },
  { id: 'pca4nb',    category: 'Photocopie', label: 'A4 Normal NB',      price: 200,  type: 'service' },
  { id: 'pca4cl',    category: 'Photocopie', label: 'A4 Couleur',        price: 500,  type: 'service' },
  // ── Impression ───────────────────────────────────────────────────────────────
  { id: 'impetnb',   category: 'Impression', label: 'Étudiant NB',       price: 100,  type: 'service' },
  { id: 'impnb',     category: 'Impression', label: 'Normal NB',         price: 400,  type: 'service' },
  { id: 'impcl',     category: 'Impression', label: 'Couleur',           price: 500,  type: 'service' },
  // ── Saisie ───────────────────────────────────────────────────────────────────
  { id: 'saibul',    category: 'Saisie',     label: 'Bulletin naissance', price: 600,  type: 'service' },
  { id: 'sainor',    category: 'Saisie',     label: 'Normal',             price: 1500, type: 'service' },
  { id: 'saicmp',    category: 'Saisie',     label: 'Complexe',           price: 2000, type: 'service' },
  // ── Plastification ───────────────────────────────────────────────────────────
  { id: 'plas1',     category: 'Plastification', label: 'Petite',  price: 1000, type: 'service' },
  { id: 'plas2',     category: 'Plastification', label: 'Moyenne', price: 1500, type: 'service' },
  { id: 'plas3',     category: 'Plastification', label: 'Grande',  price: 2000, type: 'service' },
  { id: 'plas4',     category: 'Plastification', label: 'A4',      price: 3000, type: 'service' },
  { id: 'plas5',     category: 'Plastification', label: 'A3',      price: 5000, type: 'service' },
  // ── Photo ─────────────────────────────────────────────────────────────────────
  { id: 'ph1015',    category: 'Photo', label: '10×15', price: 500,  type: 'service' },
  { id: 'pha5',      category: 'Photo', label: 'A5',    price: 1500, type: 'service' },
  { id: 'pha4',      category: 'Photo', label: 'A4',    price: 3000, type: 'service' },
  { id: 'pha3',      category: 'Photo', label: 'A3',    price: 5000, type: 'service' },
  // ── Connexion Poste ──────────────────────────────────────────────────────────
  { id: 'cp20',      category: 'Connexion Poste', label: '20 min', price: 600,  type: 'service' },
  { id: 'cp40',      category: 'Connexion Poste', label: '40 min', price: 1000, type: 'service' },
  { id: 'cp90',      category: 'Connexion Poste', label: '1h30',   price: 2000, type: 'service' },
  { id: 'cp4h',      category: 'Connexion Poste', label: '4h',     price: 5000, type: 'service' },
  // ── Service divers ───────────────────────────────────────────────────────────
  { id: 'scan',      category: 'Service', label: 'Scan',             price: 500,  type: 'service' },
  { id: 'mail',      category: 'Service', label: 'Envoi Mail',       price: 600,  type: 'service' },
  { id: 'cptcreate', category: 'Service', label: 'Création compte',  price: 1000, type: 'service' },
  // ── Reliure ───────────────────────────────────────────────────────────────────
  { id: 'rel1',      category: 'Reliure', label: '1 000 Ar', price: 1000, type: 'service' },
  { id: 'rel2',      category: 'Reliure', label: '1 500 Ar', price: 1500, type: 'service' },
  { id: 'rel3',      category: 'Reliure', label: '2 000 Ar', price: 2000, type: 'service' },
  { id: 'rel4',      category: 'Reliure', label: '3 000 Ar', price: 3000, type: 'service' },
  { id: 'rel5',      category: 'Reliure', label: '5 000 Ar', price: 5000, type: 'service' },
  // ── Divers ────────────────────────────────────────────────────────────────────
  { id: 'film',      category: 'Divers', label: 'Film',  price: 200,  type: 'produit' },
  { id: 'serie',     category: 'Divers', label: 'Série', price: 1000, type: 'produit' },
  // ── Carnet LP ────────────────────────────────────────────────────────────────
  { id: 'prpfnl',    category: 'Carnet LP', label: 'PFNL',           price: 12500, type: 'produit' },
  { id: 'prchar',    category: 'Carnet LP', label: 'Charbon',        price: 12500, type: 'produit' },
  { id: 'prbois',    category: 'Carnet LP', label: 'Bois',           price: 12000, type: 'produit' },
  { id: 'prchant',   category: 'Carnet LP', label: 'Cahier chantier',price: 14000, type: 'produit' },
  // ── Enveloppes ────────────────────────────────────────────────────────────────
  { id: 'envc5',     category: 'Enveloppe', label: 'C5', price: 100, type: 'produit' },
  { id: 'enva5',     category: 'Enveloppe', label: 'A5', price: 400, type: 'produit' },
  { id: 'enva4',     category: 'Enveloppe', label: 'A4', price: 500, type: 'produit' },
  { id: 'enva3',     category: 'Enveloppe', label: 'A3', price: 800, type: 'produit' },
  // ── Produits divers ───────────────────────────────────────────────────────────
  { id: 'journal',   category: 'Produit', label: 'Journal',  price: 9000, type: 'produit' },
  { id: 'chemise',   category: 'Produit', label: 'Chemise',  price: 400,  type: 'produit' },
  { id: 'classeur',  category: 'Produit', label: 'Classeur', price: 3000, type: 'produit' },
  { id: 'bristol',   category: 'Produit', label: 'Bristol',  price: 500,  type: 'produit' },
];

const STORAGE_ORDERS_KEY = 'gasipro_orders';
const STORAGE_ID_KEY     = 'gasipro_nextId';
const STORAGE_GID_KEY    = 'gasipro_nextGroupId';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private _orders$ = new BehaviorSubject<Order[]>(this.loadOrders());
  readonly orders$ = this._orders$.asObservable();

  private nextId: number      = this.loadNextId();
  private nextGroupId: number = this.loadNextGroupId();

  // ── Read ───────────────────────────────────────────────
  get orders(): Order[] { return this._orders$.value; }

  get pending(): Order[] {
    return this.orders.filter(o => o.status === 'EN_ATTENTE');
  }

  get paid(): Order[] {
    return this.orders.filter(o => o.status === 'PAYE');
  }

  get totalRevenue(): number {
    return this.paid.reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }

  get volumeByService(): Record<string, number> {
    return this.paid.reduce((acc, o) => {
      acc[o.service_type] = (acc[o.service_type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  // ── Write : commande simple (rétro-compatibilité) ──────
  addOrder(service: ServiceItem, qty: number, unitPrice: number): Order {
    const groupId = this.nextGroupId++;
    const order   = this.buildOrderLine(service, qty, unitPrice, groupId);
    const updated = [...this.orders, order];
    this._orders$.next(updated);
    this.persist(updated);
    return order;
  }

  // ── Write : commande multi-lignes (même group_id) ──────
  /**
   * Crée N lignes d'Order partageant le même group_id.
   * Retourne le group_id et les orders créés.
   */
  addOrderGroup(cart: CartItem[]): { groupId: number; orders: Order[] } {
    const groupId  = this.nextGroupId++;
    const newLines = cart.map(item =>
      this.buildOrderLine(item.service, item.qty, item.unitPrice, groupId)
    );
    const updated = [...this.orders, ...newLines];
    this._orders$.next(updated);
    this.persist(updated);
    return { groupId, orders: newLines };
  }

  markAsPaid(id: number): void {
    const now     = new Date();
    const updated = this.orders.map(o =>
      o.id === id
        ? { ...o,
            status:  'PAYE' as OrderStatus,
            paid_at: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }
        : o
    );
    this._orders$.next(updated);
    this.persist(updated);
  }

  /** Marque toutes les lignes d'un groupe comme payées */
  markGroupAsPaid(groupId: number): void {
    const now     = new Date();
    const paidAt  = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const updated = this.orders.map(o =>
      o.group_id === groupId
        ? { ...o, status: 'PAYE' as OrderStatus, paid_at: paidAt }
        : o
    );
    this._orders$.next(updated);
    this.persist(updated);
  }

  // ── Internal ───────────────────────────────────────────
  private buildOrderLine(
    service: ServiceItem,
    qty: number,
    unitPrice: number,
    groupId: number,
  ): Order {
    const now = new Date();
    return {
      id:           this.nextId++,
      group_id:     groupId,
      service_type: `${service.category} — ${service.label}`,
      unit_price:   unitPrice,
      quantity:     qty,
      status:       'EN_ATTENTE',
      time:         now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      created_at:   now.toISOString(),
      paid_at:      null,
    };
  }

  // ── Persistence ────────────────────────────────────────
  private loadOrders(): Order[] {
    try {
      const raw = localStorage.getItem(STORAGE_ORDERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private loadNextId(): number {
    const raw = localStorage.getItem(STORAGE_ID_KEY);
    return raw ? parseInt(raw, 10) : 1000;
  }

  private loadNextGroupId(): number {
    const raw = localStorage.getItem(STORAGE_GID_KEY);
    return raw ? parseInt(raw, 10) : 1;
  }

  private persist(orders: Order[]): void {
    localStorage.setItem(STORAGE_ORDERS_KEY,  JSON.stringify(orders));
    localStorage.setItem(STORAGE_ID_KEY,      String(this.nextId));
    localStorage.setItem(STORAGE_GID_KEY,     String(this.nextGroupId));
  }
}
