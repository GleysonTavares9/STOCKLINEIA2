import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-shortcuts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './shortcuts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShortcutsComponent {
  shortcuts = [
    { key: 'C', description: 'Navegar para a página de Criação' },
    { key: 'L', description: 'Navegar para a Biblioteca' },
    { key: 'H', description: 'Navegar para a Home (Feed)' },
    { key: 'S', description: 'Navegar para a página de Inscrição (Subscribe)' },
    { key: 'Espaço', description: 'Tocar / Pausar a música atual' },
    { key: '→', description: 'Próxima música na playlist' },
    { key: '←', description: 'Música anterior na playlist' },
  ];
}