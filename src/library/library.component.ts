import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
// Fix: Corrected the import path for MurekaService to point to its actual location in the 'create' directory.
import { MurekaService } from '../create/mureka.service';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './library.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryComponent {
  private murekaService = inject(MurekaService);
  history = this.murekaService.history;
}
