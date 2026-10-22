# Cribbage of Chaos password reset — review and setup

Prepared locally only. No hosting or Supabase settings have been changed.

## Files to publish together after approval

- `reset-password.html`
- `reset-password.css`
- `reset-password.js`
- `static/vendor/supabase-2.118.0.js`
- `static/vendor/supabase-2.118.0.LICENSE`

Keep the existing `style.css`, `script.js`, favicon, and logo at their existing paths. The new page copies the homepage navigation links and footer, uses the same logo and base styles, and adds scoped responsive styles. It deliberately excludes the homepage's analytics and commented widget.

The public project URL and publishable key in `reset-password.js` match the game's configuration. These are public client identifiers, not administrative credentials. The page calls Auth only; it never writes profiles, statistics, or game data.

## Supabase configuration to review later (not applied)

1. Publish these files over HTTPS at `https://www.northernflightsdiscgolf.ca/reset-password.html` after approving the implementation. Verify this exact www address serves the page without redirecting to another hostname/path. Existing CNAME already uses www.
2. In Authentication > URL Configuration, add this exact address to Redirect URLs:
   `https://www.northernflightsdiscgolf.ca/reset-password.html`
   Keep other URLs and the Site URL unchanged; no wildcard is required.
3. In Authentication > Email Templates > Reset Password, use a direct link to this page with the hash in the **fragment**:

   ```html
   <h2>Reset your Cribbage of Chaos password</h2>
   <p>If you requested a password reset, use the link below.</p>
   <p><a href="https://www.northernflightsdiscgolf.ca/reset-password.html#token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a></p>
   <p>If you did not request this, you can ignore this email.</p>
   ```

   This fixed destination avoids relying on an arbitrary redirect parameter. Do not use `{{ .ConfirmationURL }}` for this custom flow: that link verifies through Supabase before the page's Continue step. Do not put TokenHash in `?token_hash=...`; the page only accepts the fragment format. Disable email-provider click tracking/link rewriting for recovery emails, if enabled. It can expose or rewrite recovery links. No SMTP settings or credentials belong in this repository.
4. The game will need a separate approved change to request a reset email using Supabase Auth's recovery endpoint (`POST /auth/v1/recover`) with the public key and `redirect_to` set to the exact page URL. The JavaScript SDK equivalent is `resetPasswordForEmail(email, { redirectTo: resetPageUrl })`. This webpage does not add that game button or send reset emails itself.
5. Keep Supabase's password rules and recovery expiration settings. The server enforces them; this page checks that the two entered passwords match and displays safe messages for password-policy errors.

References: [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser), [resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

## Security behavior

- The first synchronous page script captures only a single valid-looking fragment token, then replaces the current URL with the pathname. Fragments are not part of HTTP requests. No recovery credential is copied into links or page text.
- Verification occurs only after Continue, always with `type: 'recovery'`. Browser refresh after URL cleanup intentionally requires reopening the email.
- The SDK uses memory storage, no automatic URL session detection, and no automatic token refresh. No recovery token, session, or password is written to localStorage, sessionStorage, cookies, application logs, or analytics. Password fields are cleared when submitting and on leaving the page.
- Auth fetches time out after 15 seconds, including response-body receipt. SDK loading times out after 10 seconds. Failures restore controls. A failed response can be ambiguous if the server accepted it: messages explain retrying, signing in, or requesting a fresh link.
- After a confirmed password change the temporary recovery session is signed out locally. This is not a promise to revoke all existing sessions on other devices; normal Supabase session behavior applies.
- The page uses a restrictive Content Security Policy and a no-referrer policy. Hosting response headers can additionally set `frame-ancestors 'none'` and `Cache-Control: no-store` if supported; `frame-ancestors` cannot be enforced through an HTML meta tag. No hosting changes were made.
- The official Supabase JS browser bundle is pinned and served from this site, with its MIT license. Source: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js`. SHA-256: `ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3`.

## Testing after publication and configuration approval

1. Request a real recovery email for a disposable test account. Open it on desktop and in an Android browser. The visible URL should lose its fragment promptly; no verification should occur until Continue.
2. Continue, enter mismatched passwords, then a password rejected by the configured policy, then a valid matching password. Check the messages and that controls recover after errors.
3. Complete the reset yourself. Sign in on web and Android with the new password; the old password should fail. Profile UUID, username, peg color, and statistics should remain unchanged.
4. Reopen the used link, and separately test an expired link. Both should ask for a fresh email. Opening the bare page must not show the password form.
5. Turn the connection off before Continue and before saving. Check that the controls recover and messages explain retrying. If a response was lost after saving, try signing in with the new password.
6. Test the hamburger menu and dropdown links on a narrow phone, desktop navigation, keyboard focus, and the footer. No horizontal scrolling should be needed.

Local checks used synthetic credentials and mocked Auth results, without changing any account: explicit click gating; URL cleanup; rejection of missing, malformed, duplicate, wrong-purpose and legacy access-token links; matching passwords; successful password-only update and cleanup; expired link/session; weak password; network failures; page-exit cleanup. JavaScript syntax checks and a browser preview were also performed. Real Supabase recovery, email delivery, and physical Android testing still require the later approved publication/configuration and a test account.
