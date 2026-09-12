import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../services/auth';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-login',
  imports: [FormsModule, Icon],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  username = '';
  password = '';
  readonly submitting = signal(false);
  readonly error = signal('');

  async submit() {
    this.error.set('');
    this.submitting.set(true);
    try {
      await this.auth.login(this.username.trim(), this.password);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard';
      await this.router.navigateByUrl(returnUrl.startsWith('/') ? returnUrl : '/dashboard');
    } catch (err: unknown) {
      const body = err && typeof err === 'object' && 'error' in err ? (err as { error?: { error?: string } }).error : null;
      this.error.set(body?.error || 'Unable to sign in. Confirm the API is running on port 3000.');
    } finally {
      this.submitting.set(false);
    }
  }
}
