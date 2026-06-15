// src/app/domain/order/order.model.ts
//
// Single source of truth for the Order shape.
// Components and services should import from here so the domain layer
// stays independent of the infrastructure (OrderApi) file.

export type { Order, OrderStatus } from '../../core/service/order-api.service';