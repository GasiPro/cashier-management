import { Injectable, computed, signal } from '@angular/core';
import { getOrganization, setOrganization } from './settings.api';
import { DEFAULT_ORGANIZATION_NAME, Organization } from './settings.model';
@Injectable({ providedIn: 'root' })
export class OrganizationStore {
  readonly name = signal(DEFAULT_ORGANIZATION_NAME);
  readonly initial = computed(() => this.name().charAt(0).toUpperCase());
  async load(): Promise<Organization | null> {
    try {
      const organization = await getOrganization();
      if (organization) this.name.set(organization.name);
      return organization;
    } catch (e) {
      console.error('failed to read organization', e);
      return null;
    }
  }
  async save(value: Organization): Promise<void> {
    const saved = await setOrganization(value);
    this.name.set(saved.name);
  }
}
