const sanitizeBaseUrl = (value?: string): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
};

// Production URL as default - works out of the box
const fallbackApiBase = 'https://resumeit-cdqp.onrender.com';
const fallbackPremiumUrl = 'https://resumecraft.dev';

const sanitizeUrl = (value?: string): string => {
  if (!value) return '';
  return value.trim();
};

export const API_BASE_URL = sanitizeBaseUrl(process.env.API_BASE_URL) || fallbackApiBase;
export const AI_ANALYSIS_URL = sanitizeBaseUrl(process.env.AI_ANALYSIS_URL) || '';
export const IS_AI_ANALYSIS_ENABLED = AI_ANALYSIS_URL.length > 0;
export const PREMIUM_REDIRECT_URL = sanitizeUrl(process.env.PREMIUM_REDIRECT_URL) || fallbackPremiumUrl;

export const getApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

export const getAiAnalysisUrl = (path: string): string => {
  if (!IS_AI_ANALYSIS_ENABLED) {
    throw new Error('AI analysis URL is not configured');
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${AI_ANALYSIS_URL}${normalizedPath}`;
};

export const getPremiumRedirectUrl = (context?: string): string => {
  if (!context) return PREMIUM_REDIRECT_URL;
  const hasQuery = PREMIUM_REDIRECT_URL.includes('?');
  const separator = hasQuery ? '&' : '?';
  return `${PREMIUM_REDIRECT_URL}${separator}feature=${encodeURIComponent(context)}`;
};
