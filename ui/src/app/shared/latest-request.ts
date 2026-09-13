import { DestroyRef, inject } from '@angular/core';
import { Observable, Observer, Subscription } from 'rxjs';

/** Changing a selection cancels the prior read; late results cannot relabel another company's data. */
export class LatestRequest {
  private subscription?: Subscription;
  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }
  cancel() {
    this.subscription?.unsubscribe();
  }
  run<T>(source: Observable<T>, observer: Partial<Observer<T>>) {
    this.cancel();
    this.subscription = source.subscribe(observer);
  }
}
