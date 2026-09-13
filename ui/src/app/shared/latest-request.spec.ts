import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { LatestRequest } from './latest-request';

describe('LatestRequest', () => {
  it('ignores late responses after a company or filter changes', () => {
    const request = TestBed.runInInjectionContext(() => new LatestRequest());
    const oldCompany = new Subject<string>();
    const newCompany = new Subject<string>();
    const values: string[] = [];
    request.run(oldCompany, { next: (value) => values.push(value) });
    request.run(newCompany, { next: (value) => values.push(value) });
    oldCompany.next('old balances');
    newCompany.next('new balances');
    expect(values).toEqual(['new balances']);
  });
});
