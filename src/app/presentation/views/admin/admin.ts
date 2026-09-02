import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

const LS_USERNAME = 'gasipro:username';

interface AdminNavItem {
  id: string;
  label: string;
}

const NAV_ITEMS: AdminNavItem[] = [
  { id: 'comptes', label: 'Comptes' },
  { id: 'appareils', label: 'Appareils & connexions' },
  { id: 'grille-tarifaire', label: 'Grille tarifaire' },
  { id: 'commandes', label: 'Commandes' },
  { id: 'rapport', label: 'Rapport' },
];

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin {
  readonly navItems = NAV_ITEMS;
  readonly username = localStorage.getItem(LS_USERNAME) ?? 'Admin';

  /** Currently selected section in the sidebar; 'accueil' is the default landing section. */
  activeSection = signal<string>('accueil');

  selectSection(id: string): void {
    this.activeSection.set(id);
  }

  isActive(id: string): boolean {
    return this.activeSection() === id;
  }

  navItemClass(id: string): string {
    const base = 'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors';
    return this.isActive(id)
      ? `${base} bg-[#EFF4FA] text-[#1E3A5F] font-medium`
      : `${base} text-gray-700 hover:bg-gray-50`;
  }

  activeLabel(): string {
    if (this.activeSection() === 'accueil') return 'Accueil';
    return this.navItems.find((item) => item.id === this.activeSection())?.label ?? '';
  }
}
