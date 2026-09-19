# Roadmap & expansion plans

The v1 schema already contains the hooks for these, so none of them require reshaping existing data.

## 1. Spotify catalog import (data source option 2)

**Already in place:** `Artist.spotifyId`, `Album.spotifyId`, `Song.spotifyTrackId` (unique), admin fields that accept a pasted Spotify URL, and Spotify embeds on song pages.

**Plan:**
1. Create a Spotify developer app. Add `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` to `backend/.env` (Client Credentials flow, no user login needed).
2. Add `backend/src/modules/importers/spotify.ts`:
   - `getToken()`: client-credentials token, cached until expiry.
   - `importArtist(spotifyArtistId)`: upsert Artist (name, image) by `spotifyId`, then page through `/artists/{id}/albums?include_groups=album,single,appears_on`.
   - For each album: upsert Album by `spotifyId`, then its tracks. Upsert Song by `spotifyTrackId` with `durationSec`, `trackNumber`, `explicit`, cover. Link featured artists that already exist in DHH through `SongFeature`.
   - **Never overwrite manually curated fields** (bio, region, genres, featured/verified). Only fill blanks and refresh artwork/durations.
3. Expose `POST /admin/import/spotify/artist` `{ spotifyId }` and an "Import from Spotify" button on the admin artist form.
4. Optional: a nightly job (`npm run import:sync`) that re-syncs every artist with a `spotifyId` to catch new releases.
5. Respect Spotify's developer terms: show their attribution, use embeds for playback, and don't cache audio.

## 2. Google / social login (auth option 2)

**Already in place:** the `OAuthAccount` model (`provider`, `providerAccountId`), a nullable `User.passwordHash`, and a token layer (`issueTokens`) that is independent of how the user signed in.

**Plan:**
1. Create a Google Cloud OAuth client. Add `GOOGLE_CLIENT_ID` to the backend and `VITE_GOOGLE_CLIENT_ID` to the frontend.
2. Frontend: add the Google Identity Services button and send the returned ID token to the backend.
3. Backend: `POST /auth/google` `{ idToken }`. Verify it with `google-auth-library`, then:
   - If an `OAuthAccount(google, sub)` exists, sign in that user.
   - Else if a user with the same **verified** email exists, link the account.
   - Else create a new user (`passwordHash = null`, username derived from the email) and return `needsOnboarding`.
4. Reuse the same `sendSession()` flow, so cookie and token modes both keep working for web and mobile clients.
5. Settings: "Connected accounts". Allow setting a password for OAuth-only users, and block unlinking the last sign-in method.

## 3. Artist accounts ✅ shipped as the Artist Studio

**Done:** admin-linked accounts (one per artist, `Artist.managedById` is unique), `/studio` API and page (profile, songs/releases, posts, stats, activity), the `ArtistChange` review queue / audit log with per-kind auto-publish settings, and artist posts on artist pages and the home feed. Writes go through `modules/catalog/editor.ts`, shared with the admin panel.

**Next:**
1. Public claim flow: `POST /artists/:slug/claim` creates an `ArtistClaim` (userId, artistId, proof links, status); approving it calls the existing link endpoint (`PUT /admin/studio/links/:artistId`).
2. Several managers per artist (artist + manager + label): replace `managedById` with an `ArtistMember` join table with roles.
3. Image uploads for artist photos and covers (currently pasted links).
4. Per-artist auto-publish overrides ("trusted" artists), on top of the global settings.
5. Follower-growth trends over longer periods (daily snapshot table).

## Other ideas

- Image uploads (S3 / Cloudinary) instead of pasting URLs
- Lyrics and annotations (Genius-style) per song
- Events / gigs per city with a "shows near you" home section
- Charts: weekly most-liked songs, rising artists
- Full-text search with `pg_trgm` or Meilisearch for typo tolerance
- Redis caching for `/home` and the rate limiter in multi-instance deployments
- Automated tests (Vitest + Supertest against a throwaway Postgres)
