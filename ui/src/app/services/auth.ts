import { HttpClient } from '@angular/common/http';
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

  readonly user = computed(() => this.current());
  readonly ready = computed(() => this.loaded());

  constructor() {
    void this.ensure();
  }

  async ensure() {
    if (this.loaded()) return;
    try {
      const result = await firstValueFrom(this.http.get<{ user: AuthUser }>('/api/auth/session'));
      this.current.set(result.user);
    } catch {
      this.current.set(null);
    } finally {
      this.loaded.set(true);
    }
  }

  async login(username: string, password: string) {
    const result = await firstValueFrom(
      this.http.post<{ user: AuthUser }>('/api/auth/login', { username, password }),
    );
    this.current.set(result.user);
    this.loaded.set(true);
    return result.user;
  }

  async logout() {
    this.current.set(null);
    this.loaded.set(true);
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } catch {
      // Continue to the login screen even if the API is already unavailable.
    }
    await this.router.navigateByUrl('/login');
  }
}
