import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { authRouter } from './modules/auth/auth.routes';
import { artistsRouter } from './modules/catalog/artists.routes';
import { songsRouter } from './modules/catalog/songs.routes';
import { albumsRouter, searchRouter, taxonomyRouter } from './modules/catalog/misc.routes';
import { meRouter } from './modules/me/me.routes';
import { playlistsRouter } from './modules/playlists/playlists.routes';
import { suggestionsRouter } from './modules/suggestions/suggestions.routes';
import { showsRouter } from './modules/shows/shows.routes';
import { homeRouter } from './modules/home/home.routes';
import { siteRouter } from './modules/site/site.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { studioRouter } from './modules/studio/studio.routes';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin.toLowerCase())),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(morgan(env.isProd ? 'combined' : 'dev'));

  // Allowed origins are public anyway (sent in CORS headers); listing them makes deploy issues easy to spot.
  app.get('/health', (_req, res) => res.json({ status: 'ok', env: env.NODE_ENV, corsOrigins: env.corsOrigins }));

  const api = express.Router();
  api.use('/auth', authRouter);
  api.use('/home', homeRouter);
  api.use('/site', siteRouter);
  api.use('/artists', artistsRouter);
  api.use('/songs', songsRouter);
  api.use('/albums', albumsRouter);
  api.use('/search', searchRouter);
  api.use('/', taxonomyRouter); // /genres, /regions
  api.use('/me', meRouter);
  api.use('/playlists', playlistsRouter);
  api.use('/suggestions', suggestionsRouter);
  api.use('/shows', showsRouter);
  api.use('/studio', studioRouter);
  api.use('/admin', adminRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
