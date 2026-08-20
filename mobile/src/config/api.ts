/**
 * Mobile API Client Configuration
 * In production mode, resolves remote backend URL deployed to Render.
 */
const RENDER_PRODUCTION_URL = 'https://comfeeassistant.onrender.com';
const LOCAL_DEV_URL = 'http://localhost:3000';

export function getApiBaseUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    return RENDER_PRODUCTION_URL;
  }
  return process.env.EXPO_PUBLIC_API_URL || RENDER_PRODUCTION_URL;
}

export const API_BASE_URL = getApiBaseUrl();
