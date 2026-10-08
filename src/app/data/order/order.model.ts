export type OrderStatus = 'EN_ATTENTE' | 'PAYE' | 'REJETEE';

export interface OrderLine {
  id: number;
  group_id: number;
  service_type: string;
  unit_price: number;
  original_unit_price: number;
  quantity: number;
  status: OrderStatus;
  time: string;
  counter_username: string;
  created_at: string;
  paid_at: string | null;
  observation: string;
  raison: string | null;
}

export interface OrderGroup {
  groupId: number;
  lines: OrderLine[];
  status: OrderStatus;
  totalAmount: number;
  time: string;
  createdAt: string;
  paidAt: string | null;
  counterUsername: string;
  observation: string;
  raison: string | null;
}
