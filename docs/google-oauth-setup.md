# BrainOS Google Drive runtime authorization

This is the app's own OAuth connection. Codex/ChatGPT connector consent does not supply these runtime credentials. No new Drive folder is needed.

## Exact Google Cloud configuration

1. In [Google Cloud Console](https://console.cloud.google.com/), select your existing BrainOS project, or create a dedicated project named **BrainOS** if none exists. Enable **Google Drive API** (`drive.googleapis.com`). No billing account is needed for this integration.
2. In **Google Auth Platform → Branding**, use **BrainOS** as the app name, your own support email and developer contact. This is a private single-editor app.
3. In **Audience**, choose **External** for a personal Google account. While in **Testing**, add **Danix3102@gmail.com**, which owns the personal **Daniel AI Content OS** folder as a test user. The BrainOS login email and Google account do not have to match. Testing-mode Drive refresh tokens normally expire after seven days; testing is not a permanent unattended authorization. Before relying on long-term access, review Google's personal-use/verification requirements and the consent app's publishing status. This Google setting is separate from Vercel production deployment.
4. In **Data Access**, configure the existing app scope: `https://www.googleapis.com/auth/drive`. This is a restricted full-Drive scope. The app checks the configured root and descendants for production media, but Google consent itself is not limited to that folder. Do not add Gmail scopes. The current implementation needs existing arbitrary file IDs; changing to `drive.file` would require a separate picker/access redesign and is outside this hardening pass.
5. In **Clients → Create client → Web application**, name the client **BrainOS preview**. Set this exact **Authorized redirect URI**:

   ```text
   https://brainos-daniel-st3s-projects.vercel.app/api/integrations/google/callback
   ```

   This stable alias is the current BrainOS Vercel **preview**, not a production promotion. Its initial candidate deployment was `brainos-cf45gssv9-daniel-st3s-projects.vercel.app`. Use the stable alias for login and consent so session/state cookies and the callback share the same origin. No wildcard, trailing slash, localhost callback or OAuth Playground is needed. JavaScript origins are not required by this server-side authorization flow.
6. Download the **web client JSON** to a private local file. Do not paste its contents into chat or commit it. Use the configuration command below, or provide its local path to the agent.

## Secure configuration

```sh
python3 scripts/configure-google-preview.py --client '/absolute/path/to/client_secret.json'
```

The script validates the web-client type and exact redirect URI, stores the JSON under `~/Library/Application Support/BrainOS/oauth/` with mode 0600, and sets encrypted **preview-only** Vercel environment variables on the dedicated BrainOS project. It preserves the existing encryption key and folder ID. It does not deploy or promote anything. Redeploy the preview afterward to load the new environment.

Required settings:

| Setting | Value |
| --- | --- |
| `CONTENT_OS_ORIGIN` | `https://brainos-daniel-st3s-projects.vercel.app` |
| `GOOGLE_DRIVE_ROOT_ID` | `1ioH_s2oxNZni7OwG54TScSxSaC33zIje` |
| `GOOGLE_DRIVE_ACCOUNT_EMAIL` | `Danix3102@gmail.com` |
| `GOOGLE_CLIENT_ID` | From downloaded web-client JSON |
| `GOOGLE_CLIENT_SECRET` | From downloaded web-client JSON; encrypted, server only |
| `INTEGRATION_ENCRYPTION_KEY` | Existing runtime key; do not rotate while saved tokens depend on it |
| `GMAIL_INTAKE_ENABLED` | `false` |

## Owner's one-click authorization

Once credentials are installed and the preview redeployed, sign into [the preview studio](https://brainos-daniel-st3s-projects.vercel.app/production/studio), click **Conectar Drive**, and approve with the Google account that can upload to the existing folder. Direct start link: [Authorize BrainOS Drive](https://brainos-daniel-st3s-projects.vercel.app/api/integrations/google/start). Do not use that link before client setup is complete.

The callback requires a matching editor session, encrypted short-lived state and PKCE verifier. It verifies offline Drive scope and upload access to the existing root before encrypting and storing the refresh token. Denial, expired state or missing access fails closed.

## Verification after consent

Run `node --env-file=.env.local --import tsx scripts/verify-drive-runtime.ts` from the repository with the server's private runtime environment. It checks the exact existing root, uploads one clearly labelled temporary text fixture into that root, reads it back, verifies its parent/stable ID, then removes only that fixture. It never creates a folder or edits existing content. A real recording can then be linked by stable Drive file ID in the studio; the normal worker verifies root ancestry and downloads it without copying originals to a second provider.

Until those checks run with the app's own OAuth token, Drive upload/link/download is **not verified**, even if a separate Drive connector can access the folder.

References: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [token expiry in Testing](https://developers.google.com/identity/protocols/oauth2), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Personal-only enforcement

The only permitted Google account is **Danix3102@gmail.com** and the only root is the personal folder above. OAuth callback and every refreshed Drive token verify the account before accessing a folder, then require write access (`capabilities.canAddChildren`); ownership is not required. All linked media must descend from that root. A wrong account or changed root fails closed. No work folder is used or modified.


### Read-only consent diagnostics

The callback verifies `about.get` (personal email), `files.get` (exact root and `canAddChildren`), and `files.list` (children of that root only) before saving the encrypted refresh token. These checks do not create or modify Drive files. Google failures return the exact GET URL, HTTP status and Google error envelope in the authenticated callback response and runtime logs; OAuth codes, tokens and request headers are excluded. Successful checks log only the account/root and status. A failed callback does not retain a token, so another consent attempt is required after correcting configuration. Older callback versions discarded the underlying Google error response.

Production Studio shows **Drive connected** with the personal account and folder only after finding a saved connection and successfully refreshing its token and checking the account/root. A query parameter such as `google=connected` alone cannot set that status. Failed runtime checks leave the studio usable and show a retry/reconnect notice; **Actualizar estados** rechecks the status. Tokens and encrypted credentials stay on the server.
