import { OAuth2Client } from 'google-auth-library';
import config from '../config/index.js';

// null when GOOGLE_CLIENT_ID isn't configured — the auth service turns that
// into a clear "Google login is not configured" error instead of crashing.
export const googleClient = config.google_client_id
  ? new OAuth2Client(config.google_client_id)
  : null;
