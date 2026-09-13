import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface AuthUser {
  name: string;
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly current = signal<AuthUser | null>(null);
  private readonly loaded = signal(false);
  private readonly publicAccess = signal(false);
  private pending: Promise<void> | null = null;
  private generation = 0;
  readonly failure = signal('');
  get sessionVersion() {
    return this.generation;
  }

  readonly user = computed(() => this.current());
  readonly ready = computed(() => this.loaded());
  readonly open = computed(() => this.publicAccess());

  ensure(): Promise<void> {
    if (this.loaded() && !this.failure()) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.restore().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async restore() {
    const generation = this.generation;
    this.failure.set('');
    try {
      const result = await firstValueFrom(
        this.http.get<{ user: AuthUser; open?: boolean }>('/api/auth/session'),
      );
      if (generation !== this.generation) return;
      this.current.set(result.user);
      this.publicAccess.set(result.open === true);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof HttpErrorResponse && error.status === 401) this.current.set(null);
      else this.failure.set('Unable to verify your session. Retry the connection.');
    } finally {
      if (generation === this.generation) this.loaded.set(true);
    }
  }

  async login(username: string, password: string) {
    const generation = ++this.generation;
    const result = await firstValueFrom(
      this.http.post<{ user: AuthUser }>('/api/auth/login', { username, password }),
    );
    if (generation !== this.generation) return result.user;
    this.failure.set('');
    this.current.set(result.user);
    this.loaded.set(true);
    return result.user;
  }

  async logout() {
    ++this.generation;
    this.current.set(null);
    this.loaded.set(true);
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } catch {
      // Continue to the login screen even if the API is already unavailable.
    }
    await this.router.navigateByUrl('/login');
  }

  expireSession(version: number) {
    if (version !== this.generation) return;
    ++this.generation;
    this.current.set(null);
    this.loaded.set(true);
    void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }
}
