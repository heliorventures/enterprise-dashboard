import { Component } from '@angular/core';

@Component({
  selector: 'app-brand-mark',
  template: '<img src="brand-mark.svg" width="40" height="40" alt="" />',
  styles: `
    :host {
      display: inline-flex;
      width: 40px;
      height: 40px;
      flex: 0 0 40px;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class BrandMark {}
