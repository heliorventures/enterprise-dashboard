import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DataColumn, DataTable } from './data-table';

interface Row {
  id: number;
  name: string;
  amount: string;
  narration: string;
}
describe('DataTable', () => {
  const row: Row = {
    id: 1,
    name: '<img src=x onerror=alert(1)>',
    amount: '₹12,34,56,789.12',
    narration: 'A long supporting narration',
  };
  const columns: DataColumn<Row>[] = [
    {
      key: 'name',
      label: 'Account',
      value: (r) => r.name,
      link: () => ({ path: '/ledgers', query: { company: '2' } }),
    },
    { key: 'amount', label: 'Balance', value: (r) => r.amount, primary: true },
    { key: 'narration', label: 'Narration', value: (r) => r.narration },
  ];
  async function render() {
    await TestBed.configureTestingModule({
      imports: [DataTable],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(DataTable<Row>);
    fixture.componentRef.setInput('label', 'Accounts');
    fixture.componentRef.setInput('rows', [row]);
    fixture.componentRef.setInput('columns', columns);
    fixture.componentRef.setInput('rowKey', (r: Row) => r.id);
    await fixture.whenStable();
    return fixture;
  }
  it('retains exact values and all secondary fields in mobile details', async () => {
    const fixture = await render();
    const mobile: HTMLElement = fixture.nativeElement.querySelector('.mobile-records');
    expect(mobile.textContent).toContain(row.amount);
    expect(mobile.querySelector('details')?.textContent).toContain(row.narration);
    expect(mobile.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(mobile.querySelector('a')?.getAttribute('href')).toBe('/ledgers?company=2');
  });
  it('escapes source text and provides semantic table headers', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('th[scope=col]')).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain(row.name);
  });
  it('aligns totals under the same columns and preserves totals in mobile cards', async () => {
    const fixture = await render();
    fixture.componentRef.setInput('footerRows', [
      { ...row, id: 2, name: 'Combined company totals' },
    ]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tfoot')?.textContent).toContain(
      'Combined company totals',
    );
    expect(fixture.nativeElement.querySelector('.mobile-records')?.textContent).toContain(
      'Combined company totals',
    );
  });
  it('hides old rows while loading and distinguishes failures from empty results', async () => {
    const fixture = await render();
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Loading accounts');
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', 'Unable to load accounts');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Unable to load accounts');
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
  });
});
