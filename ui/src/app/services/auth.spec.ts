import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Auth } from './auth';
import { authInterceptor } from '../auth.interceptor';

describe('Session restoration with the real interceptor', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('restores a valid cookie session on a fresh application instance with one shared request', async () => {
    const auth = TestBed.inject(Auth);
    const first = auth.ensure();
    const second = auth.ensure();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/auth/session');
    expect(request.request.withCredentials).toBe(true);
    expect(auth.ready()).toBe(false);
    request.flush({ user: { name: 'admin' } });
    await Promise.all([first, second]);
    expect(auth.user()?.name).toBe('admin');
    expect(auth.ready()).toBe(true);
  });

  it('does not let an old restoration response overwrite a successful login', async () => {
    const auth = TestBed.inject(Auth),
      http = TestBed.inject(HttpTestingController);
    const restoring = auth.ensure();
    const session = http.expectOne('/api/auth/session');
    const login = auth.login('admin', 'test');
    http.expectOne('/api/auth/login').flush({ user: { name: 'admin' } });
    await login;
    session.flush({}, { status: 401, statusText: 'Expired' });
    await restoring;
    expect(auth.user()?.name).toBe('admin');
  });

  it('distinguishes an expired session from a connection failure and retries the latter', async () => {
    const auth = TestBed.inject(Auth),
      http = TestBed.inject(HttpTestingController);
    let restoring = auth.ensure();
    http.expectOne('/api/auth/session').flush({}, { status: 503, statusText: 'Unavailable' });
    await restoring;
    expect(auth.failure()).toContain('Retry');
    restoring = auth.ensure();
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Expired' });
    await restoring;
    expect(auth.failure()).toBe('');
    expect(auth.user()).toBeNull();
    expect(auth.ready()).toBe(true);
  });

  it('ignores an old protected-request rejection after a new login', async () => {
    const auth = TestBed.inject(Auth),
      http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(HttpClient)
      .get('/api/dashboard')
      .subscribe({ error: () => {} });
    const old = http.expectOne('/api/dashboard');
    const login = auth.login('admin', 'test');
    http.expectOne('/api/auth/login').flush({ user: { name: 'admin' } });
    await login;
    old.flush({}, { status: 401, statusText: 'Expired' });
    expect(auth.user()?.name).toBe('admin');
    expect(navigate).not.toHaveBeenCalled();
    http.expectNone('/api/auth/logout');
  });

  it('explicit sign-out clears the cookie through the API and prevents late restoration', async () => {
    const auth = TestBed.inject(Auth),
      http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const restoring = auth.ensure();
    const session = http.expectOne('/api/auth/session');
    const logout = auth.logout();
    const request = http.expectOne('/api/auth/logout');
    expect(request.request.method).toBe('POST');
    request.flush({ ok: true });
    await logout;
    session.flush({ user: { name: 'admin' } });
    await restoring;
    expect(auth.user()).toBeNull();
  });
});
