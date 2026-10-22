/* Recovery credentials live only in this closure and the SDK's in-memory session. */
(() => {
  'use strict';
  let token = null;
  let linkState = 'missing';
  try {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const candidate = fragment.get('token_hash');
    if (candidate && fragment.getAll('token_hash').length === 1 &&
        /^[A-Za-z0-9_-]{20,512}$/.test(candidate) &&
        (!fragment.has('type') || (fragment.getAll('type').length === 1 && fragment.get('type') === 'recovery'))) {
      token = candidate;
      linkState = 'ready';
    } else if (window.location.hash) {
      linkState = 'invalid';
    }
    // Run synchronously in <head>, before loading styles, images, or navigation.
    window.history.replaceState(null, '', window.location.pathname);
  } catch (_) {
    token = null;
    linkState = 'unsafe';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('reset-status');
    const start = document.getElementById('reset-start');
    const proceed = document.getElementById('continue-reset');
    const form = document.getElementById('password-form');
    const password = document.getElementById('new-password');
    const confirm = document.getElementById('confirm-password');
    const save = document.getElementById('save-password');
    const requests = new Set();
    let client = null;
    let sdkPromise = null;
    let verified = false;
    let busy = false;
    let closed = false;

    function message(text, error = false) {
      status.textContent = text;
      status.classList.toggle('is-error', error);
      status.setAttribute('role', error ? 'alert' : 'status');
    }
    function clearPasswords() { password.value = ''; confirm.value = ''; }
    function setBusy(value) {
      busy = value;
      proceed.disabled = value;
      save.disabled = value;
      password.disabled = value;
      confirm.disabled = value;
      form.setAttribute('aria-busy', String(value));
    }
    function terminal(text) {
      token = null;
      verified = false;
      start.hidden = true;
      form.hidden = true;
      clearPasswords();
      message(text, true);
    }
    const freshLink = 'This recovery link is invalid, expired, or already used. Please request a new password-reset email from Cribbage of Chaos.';
    const networkError = error => !error?.status || error.status >= 500 || error.name === 'AuthRetryableFetchError';

    // Every Auth request has a deadline; no request can leave the interface stuck.
    async function timedFetch(input, init = {}) {
      if (closed) throw new Error('Page closed');
      const controller = new AbortController();
      requests.add(controller);
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(input, { ...init, signal: controller.signal,
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
        // Keep the deadline active while the response body arrives, too.
        const body = await response.arrayBuffer();
        return new Response([204, 205, 304].includes(response.status) ? null : body,
          { status: response.status, statusText: response.statusText, headers: response.headers });
      } finally {
        clearTimeout(timer);
        requests.delete(controller);
      }
    }
    function loadSdk() {
      if (window.supabase?.createClient) return Promise.resolve();
      if (sdkPromise) return sdkPromise;
      sdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timer = setTimeout(() => finish(false), 10000);
        function finish(ok) {
          clearTimeout(timer);
          script.onload = null;
          script.onerror = null;
          if (ok && window.supabase?.createClient) resolve();
          else { script.remove(); reject(new Error('Unable to load authentication')); }
        }
        script.src = 'static/vendor/supabase-2.118.0.js';
        script.onload = () => finish(true);
        script.onerror = () => finish(false);
        document.head.appendChild(script);
      }).catch(error => { sdkPromise = null; throw error; });
      return sdkPromise;
    }

    if (linkState === 'ready') {
      start.hidden = false;
      message('Your recovery link is ready. Click Continue to verify it and choose a new password.');
    } else if (linkState === 'unsafe') {
      terminal('This browser could not safely clear the recovery link. Close this tab and open a new recovery email in a supported browser.');
    } else {
      terminal(linkState === 'missing' ? 'Open this page using the link in your Cribbage of Chaos password-reset email.' : freshLink);
    }

    proceed.addEventListener('click', async () => {
      if (busy || closed || !token) return;
      setBusy(true);
      message('Verifying your recovery link…');
      try {
        await loadSdk();
        if (closed) return;
        if (!client) client = window.supabase.createClient(
          'https://wzwuhjpzexognkimwpzw.supabase.co',
          'sb_publishable_qA_Bfr9ukCJY_dqLA9SAhg_UvRnApqN',
          { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { fetch: timedFetch } }
        );
        // Only this explicit click consumes the one-time recovery token.
        const { data, error } = await client.auth.verifyOtp({ token_hash: token, type: 'recovery' });
        if (closed) return;
        if (error) {
          if (networkError(error)) message('Unable to verify the link. Check your connection and click Continue to retry. If the link was consumed, request a new email.', true);
          else if (error.status === 429) message('Too many attempts. Please wait a little, then click Continue again.', true);
          else terminal(freshLink);
          return;
        }
        token = null;
        if (!data?.session || !data?.user) { terminal(freshLink); return; }
        verified = true;
        start.hidden = true;
        form.hidden = false;
        message('Link verified. Enter and confirm your new password.');
      } catch (_) {
        if (!closed) message('Unable to connect. Check your connection and click Continue to retry. You may need a new recovery email.', true);
      } finally {
        if (!closed) { setBusy(false); if (verified) password.focus(); }
      }
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || closed || !verified || !client) return;
      if (!password.value) { message('Please enter a new password.', true); password.focus(); return; }
      if (password.value !== confirm.value) { message('The passwords do not match. Please enter them again.', true); confirm.focus(); return; }
      let nextPassword = password.value;
      clearPasswords();
      setBusy(true);
      message('Saving your new password…');
      try {
        const { data, error } = await client.auth.updateUser({ password: nextPassword });
        nextPassword = null;
        if (closed) return;
        if (error) {
          if (error.status === 401 || error.status === 403 || ['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used'].includes(error.code)) {
            terminal('Your recovery session has expired. Please request a new password-reset email.');
          } else if (error.code === 'weak_password') {
            message('That password does not meet the account password requirements. Try a longer password with uppercase and lowercase letters, numbers, and symbols.', true);
          } else if (error.code === 'same_password') {
            message('Choose a password different from your current password.', true);
          } else if (error.status === 429) {
            message('Too many attempts. Please wait a little, then enter your new password again.', true);
          } else if (networkError(error)) {
            message('The server could not confirm the change. Check your connection, then enter your password again to retry. If it was saved, you can sign in with the new password.', true);
          } else {
            message('The password could not be changed. Please try another password or request a new recovery email.', true);
          }
          return;
        }
        if (!data?.user) throw new Error('Password update not confirmed');
        verified = false;
        form.hidden = true;
        message('Your password has been changed. Return to Cribbage of Chaos on the web or Android and sign in with your new password.');
        // Clear only this page's temporary recovery session; never load an existing login.
        const finishedClient = client;
        client = null;
        try { await finishedClient.auth.signOut({ scope: 'local' }); } catch (_) { /* Password was already saved. */ }
      } catch (_) {
        if (!closed) message('The server could not confirm the change. Check your connection and try again, or sign in if the new password was already saved.', true);
      } finally {
        nextPassword = null;
        clearPasswords();
        if (!closed) setBusy(false);
      }
    });

    const hamburger = document.getElementById('hamburger');
    hamburger.addEventListener('click', () => {
      hamburger.setAttribute('aria-expanded', String(document.getElementById('nav-links').classList.contains('active')));
    });
    window.addEventListener('pagehide', () => {
      closed = true;
      token = null;
      verified = false;
      clearPasswords();
      for (const controller of requests) controller.abort();
      if (client) { client.auth.stopAutoRefresh(); client = null; }
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) terminal('For your security, reopen a fresh password-reset email after leaving this page.');
    });
  });
})();
