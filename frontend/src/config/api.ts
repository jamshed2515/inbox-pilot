/**
 * Centralized API and Backend Configuration
 * In development, VITE_API_BASE_URL defaults to '/api' (forwarded via Vite dev proxy to http://localhost:5000).
 * In production (e.g., Vercel), set VITE_API_BASE_URL in your environment settings
 * (e.g., https://inbox-pilot.onrender.com/api or https://inbox-pilot.onrender.com).
 */

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

/**
 * Resolves an API endpoint against API_BASE_URL without producing double slashes or '/api/api'.
 */
export const getApiUrl = (endpoint: string): string => {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (API_BASE_URL.endsWith('/api') && cleanEndpoint.startsWith('/api/')) {
    return `${API_BASE_URL}${cleanEndpoint.slice(4)}`;
  }
  if (API_BASE_URL.endsWith('/api') && cleanEndpoint === '/api') {
    return API_BASE_URL;
  }
  return `${API_BASE_URL}${cleanEndpoint}`;
};

/**
 * Derives the backend root origin for standalone services like Bull Board (/admin/queues).
 */
export const BACKEND_BASE_URL = API_BASE_URL.startsWith('http')
  ? API_BASE_URL.replace(/\/api\/?$/, '')
  : 'http://localhost:5000';

export const BULL_BOARD_URL = `${BACKEND_BASE_URL}/admin/queues`;
