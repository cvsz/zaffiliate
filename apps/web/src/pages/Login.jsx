import { useState } from 'react';
import { loginSession } from '../api';

export default function Login() {
  const [form, setForm] = useState({ tenantId: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await loginSession(form);
    setBusy(false);
    if (!result.ok) {
      setError(result.status === 429 ? 'Too many attempts. Try again later.' : 'Sign-in failed.');
      return;
    }
    window.location.assign('/dashboard');
  }
  return (
    <main className="main" style={{ maxWidth: 560, margin: '4rem auto' }}>
      <section className="panel">
        <p className="eyebrow">ZEAZ Affiliate Control Plane</p>
        <h1>Operator sign in</h1>
        <p className="note">Credentials are exchanged server-side. The browser receives only an HttpOnly, Secure, SameSite=Strict session cookie.</p>
        <form onSubmit={submit}>
          <label>Tenant ID<input required autoComplete="organization" value={form.tenantId} onChange={(e)=>setForm({...form,tenantId:e.target.value})} /></label>
          <label>Email<input required type="email" autoComplete="username" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})} /></label>
          <label>Password<input required type="password" autoComplete="current-password" value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})} /></label>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </section>
    </main>
  );
}
