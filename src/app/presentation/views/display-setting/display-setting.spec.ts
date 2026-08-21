import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DisplaySetting } from './display-setting';

describe('DisplaySetting', () => {
  let component: DisplaySetting;
  let fixture: ComponentFixture<DisplaySetting>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DisplaySetting],
    }).compileComponents();

    fixture = TestBed.createComponent(DisplaySetting);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
