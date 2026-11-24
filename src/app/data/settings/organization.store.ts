import { Injectable, computed, signal } from '@angular/core';
import { getOrganization, setOrganization } from './settings.api';
import { DEFAULT_ORGANIZATION_NAME, Organization } from './settings.model';
@Injectable({ providedIn: 'root' })
export class OrganizationStore {
  readonly name = signal(DEFAULT_ORGANIZATION_NAME);
  readonly email = signal('');
  readonly phone = signal('');
  readonly initial = computed(() => this.name().charAt(0).toUpperCase());
  async load(): Promise<Organization | null> {
    try {
      const organization = await getOrganization();
      if (organization) this.apply(organization);
      return organization;
    } catch (e) {
      console.error('failed to read organization', e);
      return null;
    }
  }
  async save(value: Organization): Promise<void> {
    this.apply(await setOrganization(value));
  }
  private apply(organization: Organization): void {
    this.name.set(organization.name);
    this.email.set(organization.email);
    this.phone.set(organization.phone);
  }
}
