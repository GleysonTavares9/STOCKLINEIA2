import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './privacy.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyComponent {}