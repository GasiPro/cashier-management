import { Component, OnInit, OnDestroy } from '@angular/core';
import { Navbar } from '../../layouts/main-layout/navbar/navbar';
import { LeftSidebar } from '../../layouts/main-layout/sidebar/left-sidebar';
import { BottomBar } from '../../layouts/main-layout/bottom-bar/bottom-bar';
import { CounterStore } from './counter.store';
import { ServicePicker } from './components/service-picker/service-picker';
import { TicketSummary } from './components/ticket-summary/ticket-summary';
import { OrderHistory } from './components/order-history/order-history';
import { OrderHistoryPanel } from './components/order-history/order-history-panel';
import { OrderDetailModal } from './components/order-detail-modal/order-detail-modal';
import { ConnectionStatus } from './components/connection-status/connection-status';
import { ConnectionOverlay } from './components/connection-status/connection-overlay';
import { ServerPanel } from './components/server-panel/server-panel';
import { AccountPanel } from './components/account-panel/account-panel';
@Component({
  selector: 'app-counter',
  standalone: true,
  imports: [
    Navbar,
    LeftSidebar,
    BottomBar,
    ServicePicker,
    TicketSummary,
    OrderHistory,
    OrderHistoryPanel,
    OrderDetailModal,
    ConnectionStatus,
    ConnectionOverlay,
    ServerPanel,
    AccountPanel,
  ],
  providers: [CounterStore],
  templateUrl: './counter.page.html',
})
export class CounterPage implements OnInit, OnDestroy {
  constructor(public store: CounterStore) {}
  ngOnInit(): void {
    this.store.start();
  }
  ngOnDestroy(): void {
    this.store.stop();
  }
}
