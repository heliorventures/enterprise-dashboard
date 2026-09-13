import { Component, computed, input, output } from '@angular/core';
import { Icon } from './icon';

@Component({
  selector: 'app-pager',
  imports: [Icon],
  templateUrl: './pager.html',
  styleUrl: './pager.css',
})
export class Pager {
  readonly total = input(0);
  readonly busy = input(false);
  readonly page = input(1);
  readonly pageSize = input(25);
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  readonly pageSizes = [25, 50, 100, 250, 500];

  readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly from = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );
  readonly to = computed(() => Math.min(this.total(), this.page() * this.pageSize()));
  readonly pages = computed(() => {
    const current = this.page();
    const last = this.lastPage();
    if (last <= 7) {
      return Array.from({ length: last }, (_, index) => index + 1);
    }

    const marked = new Set([1, last, current, current - 1, current + 1, current - 2, current + 2]);
    const compact = [...marked].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b);
    const items: Array<number | 'ellipsis'> = [];
    compact.forEach((page, index) => {
      if (index > 0 && page - compact[index - 1] > 1) {
        items.push('ellipsis');
      }
      items.push(page);
    });
    return items;
  });

  goTo(page: number) {
    if (this.busy()) return;
    const next = Math.min(this.lastPage(), Math.max(1, page));
    if (next !== this.page()) {
      this.pageChange.emit(next);
    }
  }

  onPageSize(event: Event) {
    this.pageSizeChange.emit(Number((event.target as HTMLSelectElement).value));
  }
}
