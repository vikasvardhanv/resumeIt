// Helper: Generate project/certification suggestions (stub for now)
function getProjectSuggestions(keywords: string[]): string[] {
  // In a real app, this would use LLM or backend. Here, use simple heuristics.
  const suggestions: string[] = [];
  if (keywords.some(k => /aws|azure|cloud/i.test(k))) {
    suggestions.push('Build a cloud deployment project (e.g., deploy an app to AWS/Azure)');
    suggestions.push('Get AWS Certified Solutions Architect or Azure Fundamentals');
  }
  if (keywords.some(k => /python|data|ml|ai|machine learning/i.test(k))) {
    suggestions.push('Complete a Kaggle ML competition or publish a data science project');
    suggestions.push('Earn TensorFlow Developer or Data Science certification');
  }
  if (keywords.some(k => /react|frontend|javascript/i.test(k))) {
    suggestions.push('Build a portfolio React app with modern UI/UX');
    suggestions.push('Get a Frontend Developer certification (e.g., freeCodeCamp)');
  }
  if (suggestions.length === 0) {
    suggestions.push('Complete a relevant online course or certification');
  }
  return suggestions;
}
import { MessageType, TailorResultMessage } from '../types/messages';
import { IS_AI_ANALYSIS_ENABLED, getApiUrl, getAiAnalysisUrl, getPremiumRedirectUrl } from '../config';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

const CONFIG = {
  STORAGE: {
    MAX_BASE64_SIZE: 8_000_000, // ~8 MB after base64 encoding
    LAST_RESULT_KEY: 'lastTailoredResult',
    RESUME_SESSION_KEY: 'resumeSession',
    AUTH_CACHE_KEY: 'userAuthCache',
    HEALTH_STATUS_KEY: 'lastHealthStatus'
  },

  FILE_UPLOAD: {
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_TYPES: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ],
    ALLOWED_EXTENSIONS: /\.(pdf|doc|docx|txt)$/i,
    TEXT_PREVIEW_LENGTH: 4000
  },

  POLLING: {
    JOB_DETECTION_INTERVAL: 2000, // 2 seconds
    HEALTH_CHECK_INTERVAL: 60000, // 1 minute
    HEALTH_CHECK_TIMEOUT: 2000 // 2 seconds
  },

  RATE_LIMIT: {
    DEFAULT_COOLDOWN_SECONDS: 15,
    MIN_COOLDOWN_SECONDS: 5,
    MAX_COOLDOWN_SECONDS: 120
  },

  INITIALIZATION: {
    FEATURE_DELAY: 100 // ms delay before initializing features after login
  },

  BACKGROUND_VERIFICATION: {
    DELAY: 100 // ms delay before background auth verification
  },

  MATCH_ANALYSIS: {
    TOP_KEYWORDS_LIMIT: 12,
    MIN_KEYWORD_LENGTH: 3,
    CHUNK_SIZE: 0x8000,
    MIN_QUANTIFIED_BULLETS: 1,
    MAX_QUANTIFIED_BULLETS: 8,
    MIN_ACTION_VERBS: 8
  }
} as const;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'will', 'your', 'about',
  'into', 'have', 'more', 'than', 'you', 'our', 'are', 'job', 'role', 'team',
  'work', 'ability', 'must', 'experience', 'skills', 'required', 'year', 'years'
]);

const ACTION_VERBS = [
  'led', 'built', 'launched', 'implemented', 'optimized', 'designed', 'delivered',
  'accelerated', 'orchestrated', 'scaled', 'architected', 'drove', 'transformed',
  'modernized', 'streamlined'
];

const AI_KEYWORDS = [
  'ai', 'machine learning', 'ml', 'automation', 'genai', 'llm', 'data pipeline',
  'predictive', 'analytics', 'nlp', 'computer vision', 'model', 'generative'
];

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface ResumeSessionData {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
  textPreview?: string;
  uploadedAt: number;
}
type HealthState = 'checking' | 'ok' | 'warn' | 'error';

type AnalysisPriority = 'critical' | 'high' | 'medium' | 'low';

interface LlmAnalysisMetric {
  value?: number;
  count?: number;
  note?: string;
  status?: string;
}

interface LlmAnalysisSnapshot {
  match_health?: string;
  summary?: string;
  alignment_text?: string;
  strengths?: string;
  requirement_match?: LlmAnalysisMetric;
  quantified_bullets?: LlmAnalysisMetric;
  action_verbs?: LlmAnalysisMetric;
}

interface LlmAnalysisKeywordGaps {
  missing?: string[];
  covered?: string[];
  missing_note?: string;
  covered_note?: string;
}

interface LlmActionPlanItem {
  priority?: AnalysisPriority;
  recommendation: string;
}

interface LlmAnalysisInsights {
  snapshot?: LlmAnalysisSnapshot;
  keyword_gaps?: LlmAnalysisKeywordGaps;
  action_plan?: LlmActionPlanItem[];
}

type MatchInsights = {
  score: number;
  coverage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  quantifiedCount: number;
  actionVerbHits: number;
  bulletPoints: string[];
  summary?: string;
  llmAnalysis?: LlmAnalysisInsights | null;
};

interface EvidenceContext {
  coverage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  quantifiedCount: number;
  actionVerbHits: number;
  aiDemandCount: number;
  aiCoveredCount: number;
  jobTitle: string;
  company: string;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const resumeStorage = (chrome.storage.session ?? chrome.storage.local) as chrome.storage.StorageArea;

let currentResume: ResumeSessionData | null = null;
let resumeFileCache: File | null = null;
let currentJob: any = null;
let lastTailoredResult: any = null;
let userAuth: any = null;
let isAuthenticated = false;

let uploadInitialized = false;
let buttonsInitialized = false;
let jobDetectionIntervalId: number | null = null;
let healthTimer: number | null = null;
let rateLimitTimer: number | null = null;

// DOM Elements (initialized after DOMContentLoaded)
let uploadArea: HTMLElement | null = null;
let fileInput: HTMLInputElement | null = null;
let resumeStatus: HTMLElement | null = null;
let tailorBtn: HTMLButtonElement | null = null;
let resultsSection: HTMLElement | null = null;
let resultsContent: HTMLElement | null = null;
let downloadBtn: HTMLButtonElement | null = null;
let copyBtn: HTMLButtonElement | null = null;
let status: HTMLElement | null = null;
let jobDetection: HTMLElement | null = null;
let noJobDetected: HTMLElement | null = null;
let jobDetected: HTMLElement | null = null;
let detectedJobTitle: HTMLElement | null = null;
let detectedCompany: HTMLElement | null = null;
let manualJobInput: HTMLElement | null = null;
let manualJobText: HTMLTextAreaElement | null = null;
let toggleManualJobBtn: HTMLButtonElement | null = null;
let isManualJobMode = false;

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  setupAuthListeners();
  await initializeHealthChip();

  const authenticated = await checkAuthStatus();
  isAuthenticated = authenticated;

  if (isAuthenticated) {
    await showMainView();
  } else {
    showAuthView();
  }
});

function setupAuthListeners(): void {
  const googleLoginBtn = document.getElementById('googleLoginBtn') as HTMLButtonElement;
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', loginWithGoogle);
  }

  const logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement;
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
}

async function initializeHealthChip(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(CONFIG.STORAGE.HEALTH_STATUS_KEY);
    if (stored?.[CONFIG.STORAGE.HEALTH_STATUS_KEY]) {
      updateHealthChip(
        stored[CONFIG.STORAGE.HEALTH_STATUS_KEY].state as HealthState,
        stored[CONFIG.STORAGE.HEALTH_STATUS_KEY].text
      );
    }
  } catch { }

  const hc = getHealthChip();
  if (hc) {
    hc.addEventListener('click', () => checkBackendHealth(true));
    checkBackendHealth(false);
  }
}

function showAuthView(): void {
  const authView = document.getElementById('authView');
  const mainView = document.getElementById('mainView');
  if (authView) authView.classList.remove('hidden');
  if (mainView) mainView.classList.add('hidden');
}

async function showMainView(): Promise<void> {
  const authView = document.getElementById('authView');
  const mainView = document.getElementById('mainView');
  if (authView) authView.classList.add('hidden');
  if (mainView) mainView.classList.remove('hidden');

  queryDOMElements();
  updateUserInfo();

  setTimeout(() => {
    uploadInitialized = false;
    buttonsInitialized = false;
    initializeUpload();
    initializeButtons();
  }, CONFIG.INITIALIZATION.FEATURE_DELAY);

  await Promise.all([
    loadPersistedResume(),
    hydrateLastResult()
  ]);

  startJobDetection();
  updateTailorButton();
}

function queryDOMElements(): void {
  uploadArea = document.getElementById('uploadArea') as HTMLElement | null;
  fileInput = document.getElementById('fileInput') as HTMLInputElement | null;
  resumeStatus = document.getElementById('resumeStatus') as HTMLElement | null;
  tailorBtn = document.getElementById('tailorBtn') as HTMLButtonElement | null;
  resultsSection = document.getElementById('resultsSection') as HTMLElement | null;
  resultsContent = document.getElementById('resultsContent') as HTMLElement | null;
  downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement | null;
  copyBtn = document.getElementById('copyBtn') as HTMLButtonElement | null;
  status = document.getElementById('statusMessage') as HTMLElement | null;
  jobDetection = document.getElementById('jobDetection') as HTMLElement | null;
  noJobDetected = document.getElementById('noJobDetected') as HTMLElement | null;
  jobDetected = document.getElementById('jobDetected') as HTMLElement | null;
  detectedJobTitle = document.getElementById('detectedJobTitle') as HTMLElement | null;
  detectedCompany = document.getElementById('detectedCompany') as HTMLElement | null;
  manualJobInput = document.getElementById('manualJobInput') as HTMLElement | null;
  manualJobText = document.getElementById('manualJobText') as HTMLTextAreaElement | null;
  toggleManualJobBtn = document.getElementById('toggleManualJob') as HTMLButtonElement | null;
}

function updateUserInfo(): void {
  if (userAuth?.user) {
    const userInitials = document.getElementById('userInitials');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');

    if (userInitials) {
      const initials = userAuth.user.name
        ?.split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase() || 'U';
      userInitials.textContent = initials;
    }
    if (userName) userName.textContent = userAuth.user.name || 'User';
    if (userEmail) userEmail.textContent = userAuth.user.email || '';
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

function getHealthChip(): HTMLButtonElement | null {
  return document.getElementById('healthChip') as HTMLButtonElement | null;
}

async function checkBackendHealth(manual: boolean): Promise<void> {
  const hc = getHealthChip();
  if (!hc) return;

  updateHealthChip('checking', manual ? 'Re-checking...' : 'Checking...');

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.POLLING.HEALTH_CHECK_TIMEOUT);

  try {
    const response = await fetch(getApiUrl('/health'), {
      cache: 'no-cache',
      signal: controller.signal
    });
    window.clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const versionLabel = data?.version ? `v${data.version}` : '';
    updateHealthChip('ok', `Online ${versionLabel}`.trim());
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    updateHealthChip(aborted ? 'warn' : 'error', aborted ? 'Connection timeout' : 'Offline');
  } finally {
    if (healthTimer) {
      window.clearTimeout(healthTimer);
    }
    healthTimer = window.setTimeout(() => checkBackendHealth(false), CONFIG.POLLING.HEALTH_CHECK_INTERVAL);
  }
}

function updateHealthChip(state: HealthState, text: string): void {
  const hc = getHealthChip();
  if (!hc) return;

  hc.dataset.state = state;
  const textNode = hc.querySelector('.health-text');
  if (textNode) {
    textNode.textContent = text;
  }

  chrome.storage.local.set({
    [CONFIG.STORAGE.HEALTH_STATUS_KEY]: { state, text, ts: Date.now() }
  }).catch(() => { });
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

async function checkAuthStatus(): Promise<boolean> {
  try {
    const cached = await chrome.storage.local.get(CONFIG.STORAGE.AUTH_CACHE_KEY);

    if (cached[CONFIG.STORAGE.AUTH_CACHE_KEY]?.authenticated && cached[CONFIG.STORAGE.AUTH_CACHE_KEY]?.user) {
      userAuth = cached[CONFIG.STORAGE.AUTH_CACHE_KEY];
      isAuthenticated = true;
      setTimeout(() => verifyAuthInBackground(), CONFIG.BACKGROUND_VERIFICATION.DELAY);
      return true;
    }

    const response = await fetch(getApiUrl('/api/v1/auth/status'), {
      credentials: 'include',
      cache: 'no-cache'
    });

    if (response.ok) {
      const data = await response.json();

      if (!data.authenticated) {
        await chrome.storage.local.remove(CONFIG.STORAGE.AUTH_CACHE_KEY);
        isAuthenticated = false;
        return false;
      } else {
        userAuth = data;
        isAuthenticated = true;
        await chrome.storage.local.set({ [CONFIG.STORAGE.AUTH_CACHE_KEY]: data });
        return true;
      }
    } else {
      await chrome.storage.local.remove(CONFIG.STORAGE.AUTH_CACHE_KEY);
      isAuthenticated = false;
      return false;
    }
  } catch (error) {
    const cached = await chrome.storage.local.get(CONFIG.STORAGE.AUTH_CACHE_KEY);
    if (cached[CONFIG.STORAGE.AUTH_CACHE_KEY]?.user) {
      userAuth = cached[CONFIG.STORAGE.AUTH_CACHE_KEY];
      isAuthenticated = true;
      return true;
    }
    isAuthenticated = false;
    return false;
  }
}

async function verifyAuthInBackground(): Promise<void> {
  try {
    const response = await fetch(getApiUrl('/api/v1/auth/status'), {
      credentials: 'include',
      cache: 'no-cache'
    });

    if (response.ok) {
      const data = await response.json();

      if (data.authenticated) {
        userAuth = data;
        isAuthenticated = true;
        await chrome.storage.local.set({ [CONFIG.STORAGE.AUTH_CACHE_KEY]: data });
      } else {
        const success = await silentReauthenticate();
        if (!success) {
          await handleAuthExpired();
        }
      }
    } else if (response.status === 401) {
      const success = await silentReauthenticate();
      if (!success) {
        await handleAuthExpired();
      }
    }
  } catch (error) {
    // Keep using cached data if offline
  }
}

async function handleAuthExpired(): Promise<void> {
  await chrome.storage.local.remove(CONFIG.STORAGE.AUTH_CACHE_KEY);
  userAuth = null;
  isAuthenticated = false;
  showAuthView();
}

async function silentReauthenticate(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.identity.getAuthToken({ interactive: false }, async (token) => {
        if (chrome.runtime.lastError || !token) {
          resolve(false);
          return;
        }

        try {
          const resp = await fetch(getApiUrl('/api/v1/auth/google/verify'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            credentials: 'include'
          });

          if (!resp.ok) {
            resolve(false);
            return;
          }

          const data = await resp.json();
          userAuth = data;
          isAuthenticated = true;
          await chrome.storage.local.set({ [CONFIG.STORAGE.AUTH_CACHE_KEY]: data });

          await showMainView();
          updateUserInfo();
          resolve(true);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      resolve(false);
    }
  });
}

function loginWithGoogle(): void {
  const googleLoginBtn = document.getElementById('googleLoginBtn') as HTMLButtonElement;
  if (googleLoginBtn) {
    googleLoginBtn.disabled = true;
    const span = googleLoginBtn.querySelector('span');
    if (span) span.textContent = 'Signing in...';
  }

  chrome.identity.getAuthToken({ interactive: true }, async (token) => {
    if (chrome.runtime.lastError) {
      setStatus('Authentication failed. Please try again.');
      resetLoginButton();
      return;
    }

    if (token) {
      try {
        const response = await fetch(getApiUrl('/api/v1/auth/google/verify'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          credentials: 'include'
        });

        if (response.ok) {
          const authData = await response.json();
          userAuth = authData;
          isAuthenticated = true;

          await chrome.storage.local.set({ [CONFIG.STORAGE.AUTH_CACHE_KEY]: authData });
          await showMainView();
          setStatus('Successfully signed in!');
        } else {
          let apiError = 'Backend authentication failed';
          try {
            const errorData = await response.json();
            if (errorData?.error) apiError = errorData.error;
          } catch { }

          if (response.status === 401 && token) {
            chrome.identity.removeCachedAuthToken({ token }, () => { });
          }

          throw new Error(apiError);
        }
      } catch (error) {
        handleLoginError(error as Error);
        resetLoginButton();
      }
    }
  });
}

function handleLoginError(error: Error): void {
  let userMessage = 'Authentication failed. Please try again.';
  const isOffline = !navigator.onLine;

  if (isOffline) {
    userMessage = 'You appear offline. Reconnect and retry Google sign-in.';
  } else {
    const msg = error.message.toLowerCase();
    if (msg.includes('invalid') || msg.includes('token')) {
      userMessage = 'Google token invalid or expired. Click to re-authenticate.';
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (t) chrome.identity.removeCachedAuthToken({ token: t }, () => { });
      });
    } else if (msg.includes('backend')) {
      userMessage = 'Backend session could not be established. Try again shortly.';
    } else if (msg.includes('fetch') || msg.includes('network')) {
      userMessage = 'Network issue during sign-in. Check connection and retry.';
    } else {
      userMessage = `Auth error: ${error.message}`;
    }
  }

  setStatus(userMessage);
}

function resetLoginButton(): void {
  const googleLoginBtn = document.getElementById('googleLoginBtn') as HTMLButtonElement;
  if (googleLoginBtn) {
    googleLoginBtn.disabled = false;
    const span = googleLoginBtn.querySelector('span');
    if (span) span.textContent = 'Continue with Google';
    googleLoginBtn.classList.add('retry-ready');
    setTimeout(() => googleLoginBtn.classList.remove('retry-ready'), 4000);
  }
}

async function logout(): Promise<void> {
  try {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => { });
      }
    });

    await chrome.storage.local.remove(CONFIG.STORAGE.AUTH_CACHE_KEY);

    await fetch(getApiUrl('/api/v1/auth/logout'), {
      method: 'POST',
      credentials: 'include'
    });

    userAuth = null;
    isAuthenticated = false;
    window.location.reload();
  } catch (error) {
    await chrome.storage.local.remove(CONFIG.STORAGE.AUTH_CACHE_KEY);
    userAuth = null;
    isAuthenticated = false;
    window.location.reload();
  }
}

// ============================================================================
// FILE UPLOAD
// ============================================================================

function initializeUpload(): void {
  if (uploadInitialized) return;
  uploadInitialized = true;

  if (!uploadArea || !fileInput) return;


  // Click on area triggers input only if no file is uploaded
  uploadArea.addEventListener('click', () => {
    const fileInfo = document.getElementById('fileInfo');
    if (fileInput && (!fileInfo || fileInfo.classList.contains('hidden'))) {
      fileInput.value = '';
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', handleFileSelect);

  // Drag & Drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (uploadArea) uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    if (uploadArea) uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', handleDrop);

  // Clear button
  const clearBtn = document.getElementById('clearResumeBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering upload
      clearResume();
    });
  }
}

function handleDrop(e: DragEvent): void {
  e.preventDefault();
  if (uploadArea) uploadArea.classList.remove('dragover');

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    void handleFile(files[0]);
  }
}

function handleFileSelect(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    void handleFile(file);
    // Reset file input so selecting the same file again triggers change
    target.value = '';
  }
}

async function handleFile(file: File): Promise<void> {
  if (!validateFile(file)) return;

  try {
    const buffer = await file.arrayBuffer();
    const mimeType = resolveMimeType(file);
    const base64 = arrayBufferToBase64(buffer);

    if (base64.length > CONFIG.STORAGE.MAX_BASE64_SIZE) {
      showResumeStatus('File is too large to store in session (limit ~6MB raw)', 'error');
      return;
    }

    const textPreview = generateTextPreview(buffer, mimeType);
    const record: ResumeSessionData = {
      name: file.name,
      mimeType,
      size: file.size,
      base64,
      textPreview,
      uploadedAt: Date.now()
    };

    const isOverwrite = currentResume !== null;
    currentResume = record;
    resumeFileCache = new File([buffer], record.name, { type: record.mimeType });
    await persistResume(record);

    updateUploadUI(record);
    updateTailorButton();
  } catch (error) {
    showResumeStatus('Error processing file', 'error');
  }
  if (fileInput) fileInput.value = '';
}

function updateUploadUI(record: ResumeSessionData | null): void {
  const placeholder = document.getElementById('uploadPlaceholder');
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const resumeStatus = document.getElementById('resumeStatus');
  const previewElement = document.getElementById('resumePreview');
  const uploadHint = document.querySelector('.upload-hint-compact') as HTMLElement;

  if (record) {
    if (placeholder) placeholder.classList.add('hidden');
    if (fileInfo) fileInfo.classList.remove('hidden');
    if (fileName) fileName.textContent = record.name;

    if (resumeStatus) {
      // Clear any existing content first to prevent duplication
      resumeStatus.textContent = '';

      // Only show status if it's a new upload or explicit update
      // We don't need to show it on initial load
      if (resumeStatus.textContent === '') {
        const statusMessage = `${record.name} ready`;
        resumeStatus.textContent = statusMessage;
        resumeStatus.className = `resume-status success`;
        resumeStatus.classList.remove('hidden');

        setTimeout(() => {
          resumeStatus.classList.add('hidden');
        }, 3000);
      }
    }

    if (uploadHint) uploadHint.style.display = 'none';

    if (previewElement) {
      if (record.textPreview && record.textPreview.length > 0) {
        previewElement.textContent = record.textPreview.slice(0, CONFIG.FILE_UPLOAD.TEXT_PREVIEW_LENGTH);
        previewElement.classList.remove('hidden');
      } else {
        previewElement.textContent = '';
        previewElement.classList.add('hidden');
      }
    }
  } else {
    if (placeholder) placeholder.classList.remove('hidden');
    if (fileInfo) fileInfo.classList.add('hidden');
    if (fileName) fileName.textContent = '';

    if (resumeStatus) {
      resumeStatus.textContent = '';
      resumeStatus.classList.add('hidden');
    }

    if (uploadHint) uploadHint.style.display = 'block';

    if (previewElement) {
      previewElement.textContent = '';
      previewElement.classList.add('hidden');
    }
  }
}

function clearResume(): void {
  currentResume = null;
  resumeFileCache = null;
  resumeStorage.remove(CONFIG.STORAGE.RESUME_SESSION_KEY);
  updateUploadUI(null);
  updateTailorButton();
}

function validateFile(file: File): boolean {
  const hasValidExtension = CONFIG.FILE_UPLOAD.ALLOWED_EXTENSIONS.test(file.name);

  if (!CONFIG.FILE_UPLOAD.ALLOWED_TYPES.includes(file.type as any) && !hasValidExtension) {
    showResumeStatus('Invalid file format. Please upload a PDF, DOC, DOCX, or TXT file.', 'error');
    return false;
  }

  if (file.size > CONFIG.FILE_UPLOAD.MAX_FILE_SIZE) {
    showResumeStatus('File size must be less than 5MB', 'error');
    return false;
  }

  return true;
}

async function persistResume(record: ResumeSessionData): Promise<void> {
  try {
    await resumeStorage.set({ [CONFIG.STORAGE.RESUME_SESSION_KEY]: record });
  } catch (error) {
    showResumeStatus('Unable to save resume for this session', 'error');
  }
}

function showResumeStatus(message: string, type: 'success' | 'error', preview?: string): void {
  if (!resumeStatus) return;

  resumeStatus.textContent = message;
  resumeStatus.className = `resume-status ${type}`;
  resumeStatus.classList.remove('hidden');

  // Hide upload hint when resume is uploaded successfully
  const uploadHint = document.querySelector('.upload-hint-compact') as HTMLElement;
  if (uploadHint) {
    if (type === 'success') {
      uploadHint.style.display = 'none';
    } else {
      uploadHint.style.display = 'block';
    }
  }

  const previewElement = document.getElementById('resumePreview');
  if (previewElement) {
    if (type === 'success' && preview && preview.length > 0) {
      previewElement.textContent = preview.slice(0, CONFIG.FILE_UPLOAD.TEXT_PREVIEW_LENGTH);
      previewElement.classList.remove('hidden');
    } else {
      previewElement.textContent = '';
      previewElement.classList.add('hidden');
    }
  }
}

// ============================================================================
// JOB DETECTION
// ============================================================================

function startJobDetection(): void {
  if (jobDetectionIntervalId !== null) return;

  checkForJobOnCurrentTab();
  jobDetectionIntervalId = window.setInterval(checkForJobOnCurrentTab, CONFIG.POLLING.JOB_DETECTION_INTERVAL);
}

async function checkForJobOnCurrentTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, { type: MessageType.GetJob }, async (response) => {
      if (chrome.runtime.lastError) {
        // Content script not loaded, try to inject it and retry
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            files: ['contentScript.js']
          });
          // Wait a bit for content script to initialize
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id!, { type: MessageType.GetJob }, (retryResponse) => {
              if (chrome.runtime.lastError) {
                updateJobDetectionUI(null);
                return;
              }
              if (retryResponse?.job) {
                currentJob = retryResponse.job;
                updateJobDetectionUI(retryResponse.job);
              } else {
                currentJob = null;
                updateJobDetectionUI(null);
              }
            });
          }, 500);
        } catch (err) {
          updateJobDetectionUI(null);
        }
        return;
      }
      if (response?.job) {
        currentJob = response.job;
        updateJobDetectionUI(response.job);
      } else {
        currentJob = null;
        updateJobDetectionUI(null);
      }
    });
  } catch (error) {
    updateJobDetectionUI(null);
  }
}

function updateJobDetectionUI(job: any): void {
  console.log('🔄 updateJobDetectionUI called with:', job ? { title: job.title, company: job.company } : 'null');

  if (!noJobDetected || !jobDetected || !detectedJobTitle || !detectedCompany || !jobDetection) {
    console.error('❌ Job detection UI elements not found:', {
      noJobDetected: !!noJobDetected,
      jobDetected: !!jobDetected,
      detectedJobTitle: !!detectedJobTitle,
      detectedCompany: !!detectedCompany,
      jobDetection: !!jobDetection
    });
    return;
  }

  const debugInfo = document.getElementById('debugInfo') as HTMLElement;

  // Filter out invalid job titles (search results, etc.)
  const isValidJob = job && job.title &&
    !job.title.toLowerCase().includes('jobs in') &&
    !job.title.toLowerCase().includes('job search') &&
    !job.title.match(/^\d+[,\d]*\+?\s+.*jobs/i) && // "54,000+ jobs"
    job.title.length < 200;

  if (isValidJob) {
    console.log('✅ Showing detected job:', job.title);
    noJobDetected.style.display = 'none';
    noJobDetected.classList.add('hidden');
    jobDetected.style.display = 'block';
    jobDetected.classList.remove('hidden');
    detectedJobTitle.textContent = job.title;

    // Only show company if it's valid and not a placeholder
    const hasValidCompany = job.company &&
      job.company !== 'Company Name Not Found' &&
      job.company !== 'Company' &&
      job.company.length > 0;

    if (hasValidCompany) {
      detectedCompany.textContent = ` at ${job.company}`;
      detectedCompany.style.display = 'inline';
    } else {
      detectedCompany.textContent = '';
      detectedCompany.style.display = 'none';
    }

    jobDetection.classList.add('active');

    if (debugInfo) {
      debugInfo.textContent = `Domain: ${job.source} | Desc: ${job.description?.length || 0} chars`;
    }
  } else {
    console.log('ℹ️ No valid job detected, showing no-job state');
    noJobDetected.style.display = 'block';
    noJobDetected.classList.remove('hidden');
    jobDetected.style.display = 'none';
    jobDetected.classList.add('hidden');
    jobDetection.classList.remove('active');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (debugInfo && currentTab) {
        const domain = new URL(currentTab.url || '').hostname;
        debugInfo.textContent = `Scanning: ${domain} | No job detected`;
      }
    });
  }

  updateTailorButton();
}

// ============================================================================
// BUTTON INITIALIZATION
// ============================================================================

function initializeButtons(): void {
  if (buttonsInitialized) return;
  buttonsInitialized = true;

  if (tailorBtn) tailorBtn.addEventListener('click', handleTailorJob);
  if (downloadBtn) downloadBtn.addEventListener('click', handleDownload);
  if (copyBtn) copyBtn.addEventListener('click', handleCopy);
  const clearBtn = document.getElementById('clearResultsBtn') as HTMLButtonElement | null;
  if (clearBtn) clearBtn.addEventListener('click', clearResults);

  // Remove any old refreshResultsBtn handler (no longer used)

  const refreshPageBtn = document.getElementById('refreshBtn') as HTMLButtonElement | null;
  if (refreshPageBtn) {
    refreshPageBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        chrome.tabs.reload(tab.id);
        window.close();
      }
    });
  }

  const refreshJobDetectionBtn = document.getElementById('refreshJobDetectionBtn') as HTMLButtonElement | null;
  if (refreshJobDetectionBtn) {
    refreshJobDetectionBtn.addEventListener('click', async () => {
      // Add spin animation
      const icon = refreshJobDetectionBtn.querySelector('svg');
      if (icon) {
        icon.style.animation = 'spin 1s linear infinite';
      }

      // Reload the page to force fresh detection
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        chrome.tabs.reload(tab.id);
        window.close(); // Close popup so user sees the reload
      }
    });
  }

  if (toggleManualJobBtn) {
    toggleManualJobBtn.addEventListener('click', () => {
      isManualJobMode = !isManualJobMode;
      if (manualJobInput) {
        if (isManualJobMode) {
          manualJobInput.classList.remove('hidden');
          toggleManualJobBtn!.textContent = 'Use Detected Job';
          if (jobDetection) jobDetection.classList.add('hidden');
        } else {
          manualJobInput.classList.add('hidden');
          toggleManualJobBtn!.textContent = 'Paste Manually';
          if (jobDetection) jobDetection.classList.remove('hidden');
        }
        updateTailorButton();
      }
    });
  }

  if (manualJobText) {
    manualJobText.addEventListener('input', updateTailorButton);
  }
}

// ============================================================================
// PERSISTENCE & HYDRATION
// ============================================================================

async function loadPersistedResume(): Promise<void> {
  try {
    const stored = await resumeStorage.get(CONFIG.STORAGE.RESUME_SESSION_KEY);
    if (stored[CONFIG.STORAGE.RESUME_SESSION_KEY]) {
      currentResume = stored[CONFIG.STORAGE.RESUME_SESSION_KEY] as ResumeSessionData;
      resumeFileCache = null;
      updateUploadUI(currentResume);
    }
  } catch (error) {
    // Silent fail
  }
}

async function hydrateLastResult(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(CONFIG.STORAGE.LAST_RESULT_KEY);
    const cachedResult = stored[CONFIG.STORAGE.LAST_RESULT_KEY];

    if (cachedResult?.success) {
      lastTailoredResult = cachedResult;
      showResults(cachedResult);
      if (downloadBtn) downloadBtn.disabled = false;
      if (copyBtn) copyBtn.disabled = false;
      setStatus('Loaded your most recent tailored resume.');
    } else {
      lastTailoredResult = null;
      if (resultsSection) resultsSection.classList.add('hidden');
      if (downloadBtn) downloadBtn.disabled = true;
      if (copyBtn) copyBtn.disabled = true;
      setStatus('Ready to tailor your resume!');
    }
  } catch (error) {
    lastTailoredResult = null;
    if (resultsSection) resultsSection.classList.add('hidden');
    if (downloadBtn) downloadBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
    setStatus('Ready to tailor your resume!');
  }

  updateTailorButton();
}

// ============================================================================
// TAILORING
// ============================================================================

function updateTailorButton(): void {
  if (!tailorBtn) return;

  const hasResume = !!currentResume;
  let hasJob = false;

  if (isManualJobMode) {
    hasJob = !!(manualJobText && manualJobText.value.trim().length > 10);
  } else {
    hasJob = !!(currentJob && currentJob.title);
  }

  tailorBtn.disabled = !(hasResume && hasJob);
}

function handleTailorJob(): void {
  if (!currentResume || !tailorBtn) {
    setStatus('Please upload a resume first');
    return;
  }

  // Construct job object if manual
  if (isManualJobMode) {
    const text = manualJobText?.value.trim() || '';
    if (text.length < 10) {
      setStatus('Please enter a valid job description');
      return;
    }
    // Simple parsing or just pass as description
    currentJob = {
      title: 'Manual Job Entry',
      company: 'Unknown Company',
      description: text,
      source: 'manual',
      requirements: []
    };
  }

  if (!currentJob || (!currentJob.title && !currentJob.description)) {
    setStatus('No job detected. Navigate to a job posting or paste manually.');
    return;
  }

  setStatus('Tailoring resume...');
  setButtonLoading(tailorBtn, true);

  void tailorResume();
}

async function tailorResume(): Promise<void> {
  if (!currentResume || !currentJob) {
    setStatus('Missing resume or job data');
    if (tailorBtn) setButtonLoading(tailorBtn, false);
    return;
  }

  try {
    const resumeFile = ensureResumeFile();
    if (!resumeFile) {
      throw new Error('Resume data is not available');
    }

    console.log('=== TAILORING REQUEST START ===');
    console.log('📄 Resume:', {
      name: currentResume.name,
      size: currentResume.size,
      type: currentResume.mimeType,
      uploadedAt: new Date(currentResume.uploadedAt).toISOString()
    });
    console.log('💼 Job:', {
      title: currentJob.title,
      company: currentJob.company,
      location: currentJob.location,
      source: currentJob.source,
      descriptionLength: currentJob.description?.length || 0,
      requirementsCount: currentJob.requirements?.length || 0
    });

    const formData = new FormData();
    formData.append('resume', resumeFile);
    formData.append('jobPosting', JSON.stringify(currentJob));

    const apiUrl = getApiUrl('/api/v1/analyze-job');
    console.log('🌐 API URL:', apiUrl);

    const requestStartTime = Date.now();
    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });

    const requestDuration = Date.now() - requestStartTime;
    console.log(`⏱️ Request completed in ${requestDuration}ms | Status: ${response.status}`);

    if (!response.ok) {
      console.error('❌ Request failed:', {
        status: response.status,
        statusText: response.statusText
      });
      if (response.status === 429) {
        await handleRateLimitResponse(response);
        return;
      }
      if (response.status === 401) {
        await chrome.storage.local.remove(CONFIG.STORAGE.AUTH_CACHE_KEY);
        isAuthenticated = false;
        userAuth = null;
        throw new Error('Session expired. Please sign in again.');
      }
      const text = await response.text().catch(() => '');
      throw new Error(text || `Request failed (${response.status})`);
    }

    const result = await response.json().catch(() => ({ success: false, error: 'Invalid JSON response' }));

    console.log('✅ Response received:', {
      success: result.success,
      matchScore: result.match_score,
      hasTailored: !!result.tailored,
      bulletCount: result.tailored?.experience_bullets?.length || 0,
      skillsCount: result.tailored?.key_skills?.length || 0,
      projectsCount: result.projects?.length || 0
    });

    if (result.tailored?.experience_bullets) {
      console.log('📝 Resume Bullets Received:', result.tailored.experience_bullets.length, 'bullets');
      result.tailored.experience_bullets.forEach((bullet: string, index: number) => {
        console.log(`  ${index + 1}. ${bullet.substring(0, 80)}${bullet.length > 80 ? '...' : ''}`);
      });
    } else {
      console.warn('⚠️ No experience_bullets in response!');
    }

    if (!result.success) throw new Error(result.detail || result.error || 'Tailoring failed');

    console.log('=== TAILORING REQUEST END ===');

    setStatus('Resume tailored successfully!');
    if (tailorBtn) setButtonLoading(tailorBtn, false);
    showResults(result);

    lastTailoredResult = result;
    if (downloadBtn) downloadBtn.disabled = false;
    if (copyBtn) copyBtn.disabled = false;

    await chrome.storage.local.set({
      [CONFIG.STORAGE.LAST_RESULT_KEY]: result,
      lastTailoredTime: Date.now()
    });
  } catch (error: any) {
    console.error('Tailoring failed:', error);

    let errorMessage = 'Failed to tailor resume. Please try again.';

    // Handle specific error cases
    if (error.message?.includes('rate limit')) {
      errorMessage = 'High demand. Retrying with backup provider...';
      // The backend should handle fallback, but if it bubbles up:
      errorMessage = 'Service busy. Please try again in a moment.';
    } else if (error.message?.includes('quota')) {
      errorMessage = 'Usage limit reached. Please upgrade.';
    }

    showResumeStatus(errorMessage, 'error');
  } finally {
    if (tailorBtn) {
      tailorBtn.disabled = false;
      tailorBtn.innerHTML = 'Tailor Resume';
    }
  }
}

async function handleRateLimitResponse(response: Response): Promise<void> {
  let errorMessage = 'Rate limit exceeded. Please wait before trying again.';
  let upgradeUrl: string | null = null;

  try {
    const errorData = await response.json();
    if (errorData.message) {
      errorMessage = errorData.message;
    } else if (errorData.error) {
      errorMessage = errorData.error;
    }

    if (errorData.upgradeUrl) {
      upgradeUrl = errorData.upgradeUrl;
    }
  } catch (e) {
    // Use default message
  }

  if (errorMessage.toLowerCase().includes('monthly') || errorMessage.toLowerCase().includes('limit reached')) {
    setStatus(errorMessage);
    if (tailorBtn) {
      setButtonLoading(tailorBtn, false);
      tailorBtn.disabled = true;
    }

    if (upgradeUrl) {
      const statusEl = document.getElementById('statusMessage');
      if (statusEl) {
        statusEl.innerHTML = `
          ${errorMessage}<br>
          <a href="${getApiUrl(upgradeUrl)}" target="_blank" style="color: #0073b1; text-decoration: underline;">
            Upgrade to Premium
          </a>
        `;
      }
    }
    return;
  }

  const retryAfter = response.headers.get('Retry-After');
  let seconds: number = CONFIG.RATE_LIMIT.DEFAULT_COOLDOWN_SECONDS;

  if (retryAfter) {
    const numeric = parseInt(retryAfter, 10);
    if (!Number.isNaN(numeric)) {
      seconds = Math.max(
        CONFIG.RATE_LIMIT.MIN_COOLDOWN_SECONDS,
        Math.min(CONFIG.RATE_LIMIT.MAX_COOLDOWN_SECONDS, numeric)
      );
    } else {
      const retryDate = new Date(retryAfter);
      const deltaMs = retryDate.getTime() - Date.now();
      if (!Number.isNaN(retryDate.getTime()) && deltaMs > 0) {
        seconds = Math.max(
          CONFIG.RATE_LIMIT.MIN_COOLDOWN_SECONDS,
          Math.min(CONFIG.RATE_LIMIT.MAX_COOLDOWN_SECONDS, Math.ceil(deltaMs / 1000))
        );
      }
    }
  }

  startRateLimitCooldown(seconds);
}

function startRateLimitCooldown(seconds: number): void {
  if (!tailorBtn) return;

  if (rateLimitTimer) {
    window.clearInterval(rateLimitTimer);
    rateLimitTimer = null;
  }

  let remaining = seconds;
  tailorBtn.disabled = true;
  setButtonLoading(tailorBtn, false);
  setStatus(`Rate limit hit. Please wait ${remaining}s before retrying.`);

  rateLimitTimer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(rateLimitTimer!);
      rateLimitTimer = null;
      setStatus('You can try tailoring again now.');
      updateTailorButton();
    } else {
      setStatus(`Rate limit hit. Please wait ${remaining}s before retrying.`);
    }
  }, 1000);
}

// ============================================================================
// RESULTS DISPLAY
// ============================================================================

function showResults(data: any): void {
  console.log('📊 showResults called with data:', data);
  lastTailoredResult = data;
  bulletsDisplayState = 8;

  if (resultsSection) {
    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth' });
  }

  // Match Score Ring
  const matchScoreRing = document.getElementById('matchScoreRing');
  if (matchScoreRing) {
    const score = data.match_score || 0;
    matchScoreRing.textContent = `${score}%`;

    // Color coding
    matchScoreRing.className = 'match-score-ring'; // Reset
    if (score >= 80) matchScoreRing.classList.add('score-high');
    else if (score >= 60) matchScoreRing.classList.add('score-medium');
    else matchScoreRing.classList.add('score-low');
  }

  // Populate Bullets Tab
  const bulletsList = document.getElementById('optimizedBulletsList');
  const bullets = data.tailored?.experience_bullets || [];
  if (bulletsList) {
    const resultSection = bulletsList.parentElement as HTMLElement | null;
    bulletsList.innerHTML = '';

    const initialCount = Math.min(bullets.length, 8);
    bulletsDisplayState = initialCount;

    bullets.slice(0, initialCount).forEach((bullet: string, index: number) => {
      const li = document.createElement('li');
      li.className = 'bullet-item';
      li.textContent = bullet;
      li.addEventListener('click', () => {
        li.classList.toggle('selected');
      });
      bulletsList.appendChild(li);
    });

    if (resultSection) {
      const staleShowMore = resultSection.querySelector('#showMoreBulletsContainer');
      if (staleShowMore) staleShowMore.remove();
      const staleCta = resultSection.querySelector('.upgrade-pro-cta');
      if (staleCta) staleCta.remove();
    }

    if (bullets.length > 8) {
      const showMoreContainer = document.createElement('div');
      showMoreContainer.id = 'showMoreBulletsContainer';
      showMoreContainer.className = 'show-more-container';
      showMoreContainer.innerHTML = `
        <button id="showMoreBulletsBtn" class="show-more-btn">
          Show 2 more
        </button>
        <p class="show-more-note">We reveal only the next 2 bullets for free</p>
      `;
      resultSection?.appendChild(showMoreContainer);

      const showMoreBtn = document.getElementById('showMoreBulletsBtn');
      if (showMoreBtn) {
        showMoreBtn.addEventListener('click', handleShowMoreBullets);
      }
    } else if (resultSection) {
      const ctaDiv = document.createElement('div');
      ctaDiv.className = 'upgrade-pro-cta';
      ctaDiv.innerHTML = '<button class="btn-upgrade-pro">Upgrade to Pro for deeper resume critiques</button>';
      resultSection.appendChild(ctaDiv);
    }

    console.log(`✅ Showing ${initialCount} of ${bullets.length} bullets`);
  }

  // Populate Keywords Tab
  const keywordsList = document.getElementById('keywordsList');
  const keywords = data.tailored?.suggested_keywords || [];
  if (keywordsList) {
    keywordsList.innerHTML = '';
    // Keywords
    const kwSection = document.createElement('div');
    kwSection.className = 'keywords-section';
    const kwTitle = document.createElement('div');
    kwTitle.className = 'keywords-title';
    kwTitle.textContent = 'Top Keywords';
    kwSection.appendChild(kwTitle);
    const kwUl = document.createElement('ul');
    kwUl.className = 'keywords-ul';
    keywords.forEach((kw: string) => {
      const li = document.createElement('li');
      li.className = 'keyword';
      li.textContent = kw;
      li.addEventListener('click', () => {
        navigator.clipboard.writeText(kw);
        showResumeStatus(`Copied: ${kw}`, 'success');
      });
      kwUl.appendChild(li);
    });
    kwSection.appendChild(kwUl);
    keywordsList.appendChild(kwSection);

    // Project/Certification Suggestions
    const projectSuggestions = getProjectSuggestions(keywords);
    if (projectSuggestions.length > 0) {
      const projSection = document.createElement('div');
      projSection.className = 'keywords-section';
      const projTitle = document.createElement('div');
      projTitle.className = 'keywords-title';
      projTitle.textContent = 'Project/Certification Suggestions';
      projSection.appendChild(projTitle);
      const projUl = document.createElement('ul');
      projUl.className = 'keywords-ul';
      projectSuggestions.forEach((s: string) => {
        const li = document.createElement('li');
        li.className = 'keyword-suggestion';
        li.textContent = s;
        projUl.appendChild(li);
      });
      projSection.appendChild(projUl);
      keywordsList.appendChild(projSection);
    }

    // Upgrade to Pro CTA
    const ctaDiv = document.createElement('div');
    ctaDiv.className = 'upgrade-pro-cta';
    ctaDiv.innerHTML = '<button class="btn-upgrade-pro">Upgrade to Pro for more suggestions</button>';
    keywordsList.appendChild(ctaDiv);
  }

  // Populate Analysis Tab
  const analysisContent = document.getElementById('analysisContent');
  if (analysisContent) {
    const matchInsights = calculateMatchInsights(currentJob, data, currentResume) || {
      score: 0,
      coverage: 0,
      matchedKeywords: [],
      missingKeywords: [],
      bulletPoints: [],
      summary: '',
      quantifiedCount: 0,
      actionVerbHits: 0,
      llmAnalysis: null
    };

    analysisContent.innerHTML = buildMatchAnalysisHTML(matchInsights);
    setupAnalysisTabs();
    console.log('✅ Populated analysis tab');
  }

  // Setup tab switching
  setupResultsTabs();

  // Setup button handlers
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      const allBullets = bullets.join('\n\n');
      navigator.clipboard.writeText(allBullets);
      showResumeStatus('All bullets copied!', 'success');
    };
  }

  const downloadBtn = document.getElementById('downloadBtn');
  if (downloadBtn) {
    downloadBtn.onclick = handleDownload;
  }

  // Add Upgrade to Pro button handler (all tabs)
  setTimeout(() => {
    document.querySelectorAll('.btn-upgrade-pro').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.open('https://resumeit.pro/upgrade', '_blank');
      });
    });
  }, 0);

  console.log('✅ Results display complete');
}

function setupResultsTabs() {
  // Simple tab switcher if not already present
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Deactivate all
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.add('hidden'));

      // Activate clicked
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const targetPane = document.getElementById(targetId!);
      if (targetPane) targetPane.classList.remove('hidden');
    });
  });
}

function setupAnalysisTabs(): void {
  const pillButtons = document.querySelectorAll<HTMLButtonElement>('.analysis-pill');
  const panels = document.querySelectorAll<HTMLElement>('.analysis-panel');

  if (!pillButtons.length || !panels.length) return;

  pillButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-panel');
      if (!targetId) return;

      pillButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      panels.forEach(panel => {
        if (panel.id === targetId) panel.classList.remove('hidden');
        else panel.classList.add('hidden');
      });
    });
  });
}

function buildMatchAnalysisHTML(insights: MatchInsights): string {
  // If LLM suggestions are present, show them in a modern card layout
  if (lastTailoredResult?.llm_suggestions) {
    const llm = lastTailoredResult.llm_suggestions;
    return `
      <div class="match-analysis-card">
        <div class="match-header">
          <span class="match-title">LLM-Powered Resume Analysis</span>
          <span class="match-priority" style="background:#2563eb">AI</span>
        </div>
        <div class="llm-analysis-content">
          ${Array.isArray(llm)
            ? llm.map((s: string, i: number) => `<div class="llm-suggestion"><span class="action-index">${i + 1}.</span> ${s}</div>`).join('')
            : `<div class="llm-suggestion">${llm}</div>`}
        </div>
        <div class="upgrade-pro-cta">
          <button class="btn-upgrade-pro">Upgrade to Pro for deeper analysis</button>
        </div>
      </div>
    `;
  }

  const llmAnalysis = insights.llmAnalysis || (lastTailoredResult?.analysis_insights as LlmAnalysisInsights | undefined) || null;
  const snapshot = llmAnalysis?.snapshot;
  const keywordGaps = llmAnalysis?.keyword_gaps;
  const actionPlan = llmAnalysis?.action_plan;

  const coverageSource = typeof snapshot?.requirement_match?.value === 'number'
    ? snapshot.requirement_match.value
    : insights.coverage * 100;
  const coverage = Math.max(0, Math.min(100, Math.round(coverageSource)));
  const baseScore = typeof coverageSource === 'number' ? coverage : Math.round(insights.coverage * 100);
  const fallbackLabel = coverage < 50 ? '🚨 CRITICAL' : coverage < 70 ? '⚠️ NEEDS WORK' : coverage < 85 ? '✓ GOOD' : '✓✓ STRONG';
  const priorityLabel = escapeHtml((snapshot?.match_health || fallbackLabel).trim());
  const priorityColor = coverage < 50 ? '#dc2626' : coverage < 70 ? '#f59e0b' : coverage < 85 ? '#10b981' : '#059669';

  const matchedKeywords = keywordGaps?.covered && keywordGaps.covered.length > 0
    ? keywordGaps.covered
    : insights.matchedKeywords || [];
  const missingKeywords = keywordGaps?.missing && keywordGaps.missing.length > 0
    ? keywordGaps.missing
    : insights.missingKeywords || [];
  const totalRequirements = matchedKeywords.length + missingKeywords.length;
  const fallbackSummary = totalRequirements > 0
    ? `Matching ${matchedKeywords.length} of ${totalRequirements} requirements.`
    : `Match Score: ${baseScore}%`;
  const summaryText = escapeHtml((snapshot?.summary || insights.summary || fallbackSummary).trim());

  const missingPreview = missingKeywords.slice(0, 3).join(', ');
  const extraMissing = missingKeywords.length > 3 ? ` +${missingKeywords.length - 3} more` : '';
  const fallbackCoverageNarrative = totalRequirements > 0
    ? (missingKeywords.length
      ? `Gaps spotted in: ${missingPreview}${extraMissing}.`
      : 'No noticeable keyword gaps - great coverage!')
    : 'Paste the job description to highlight exact keyword gaps.';
  const coverageNarrative = escapeHtml((snapshot?.alignment_text || fallbackCoverageNarrative).trim());

  const quantifiedCount = typeof snapshot?.quantified_bullets?.count === 'number'
    ? snapshot.quantified_bullets.count
    : insights.quantifiedCount;
  const quantifiedStatus = escapeHtml((snapshot?.quantified_bullets?.note
    || (quantifiedCount >= 4 ? 'Impact is clear' : 'Add measurable metrics')).trim());

  const actionVerbCount = typeof snapshot?.action_verbs?.count === 'number'
    ? snapshot.action_verbs.count
    : insights.actionVerbHits;
  const actionVerbStatus = escapeHtml((snapshot?.action_verbs?.note
    || (actionVerbCount >= 5 ? 'Strong, energetic language' : 'Use more powerful verbs up front')).trim());

  const matchedStrengthCopy = escapeHtml((snapshot?.strengths
    || (matchedKeywords.length
      ? `You are already showcasing ${matchedKeywords.slice(0, 3).join(', ')}. Double down on them in your summary.`
      : 'Once we scan a resume, we\'ll list your standout strengths here.')).trim());

  const missingChipContent = missingKeywords.length
    ? missingKeywords.slice(0, 6).map(keyword => `<span class="gap-chip">${escapeHtml(keyword)}</span>`).join('')
    : `<span class="gap-empty">${keywordGaps ? 'No critical keyword gaps reported.' : 'No missing keywords detected.'}</span>`;
  const matchedChipContent = matchedKeywords.length
    ? matchedKeywords.slice(0, 6).map(keyword => `<span class="gap-chip positive">${escapeHtml(keyword)}</span>`).join('')
    : `<span class="gap-empty">${keywordGaps ? 'LLM did not surface standout strengths.' : 'Upload a resume to surface your keyword strengths.'}</span>`;

  const missingNote = escapeHtml((keywordGaps?.missing_note || 'Highlight these in your summary, bullets, or skills section.').trim());
  const coveredNote = escapeHtml((keywordGaps?.covered_note || 'Keep these front-and-center - they match what the hiring team wants.').trim());

  const llmActionItems = actionPlan && actionPlan.length > 0
    ? actionPlan.map((item: LlmActionPlanItem, index: number) => {
      const priority = item.priority ? `<span class="analysis-action-priority ${item.priority}">${escapeHtml(item.priority.toUpperCase())}</span>` : '';
      return `<li><span class="analysis-action-index">${index + 1}</span><div>${priority}<p>${escapeHtml(item.recommendation)}</p></div></li>`;
    }).join('')
    : null;
  const fallbackActionItems = insights.bulletPoints.length
    ? insights.bulletPoints.slice(0, 6).map((point: string, index: number) => `<li><span class="analysis-action-index">${index + 1}</span><div><p>${point}</p></div></li>`).join('')
    : '<li><div>No tailored insights yet. Generate your resume bullets to unlock this view.</div></li>';
  const actionItems = llmActionItems ?? fallbackActionItems;

  return `
    <div class="match-analysis-card modern">
      <div class="analysis-top">
        <div class="analysis-copy">
          <p class="analysis-eyebrow">Match health</p>
          <div class="match-priority" style="background:${priorityColor}">${priorityLabel}</div>
          <p class="analysis-summary">${summaryText}</p>
          <p class="analysis-subtext">${coverageNarrative}</p>
        </div>
        <div class="analysis-score-ring">
          <span>${coverage}%</span>
          <small>alignment</small>
        </div>
      </div>
      <div class="analysis-subnav">
        <button class="analysis-pill active" data-panel="analysis-overview">Snapshot</button>
        <button class="analysis-pill" data-panel="analysis-gaps">Keyword gaps</button>
        <button class="analysis-pill" data-panel="analysis-actions">Action plan</button>
      </div>
      <div class="analysis-panels">
        <div id="analysis-overview" class="analysis-panel">
          <div class="analysis-metrics-grid">
            <div class="analysis-metric-card">
              <p class="metric-label">Requirement match</p>
              <p class="metric-value">${coverage}%</p>
              <span class="metric-chip">${priorityLabel}</span>
            </div>
            <div class="analysis-metric-card">
              <p class="metric-label">Quantified bullets</p>
              <p class="metric-value">${quantifiedCount}</p>
              <span class="metric-note">${quantifiedStatus}</span>
            </div>
            <div class="analysis-metric-card">
              <p class="metric-label">Action verbs</p>
              <p class="metric-value">${actionVerbCount}</p>
              <span class="metric-note">${actionVerbStatus}</span>
            </div>
          </div>
          <div class="analysis-highlight">
            <span class="analysis-highlight-label">Strength focus</span>
            <p>${matchedStrengthCopy}</p>
          </div>
        </div>
        <div id="analysis-gaps" class="analysis-panel hidden">
          <div class="gap-card critical">
            <p class="gap-card-title">Missing keywords (${missingKeywords.length})</p>
            <div class="gap-chip-grid">
              ${missingChipContent}
            </div>
            <p class="gap-card-note">${missingNote}</p>
          </div>
          <div class="gap-card positive">
            <p class="gap-card-title">Covered strengths (${matchedKeywords.length})</p>
            <div class="gap-chip-grid">
              ${matchedChipContent}
            </div>
            <p class="gap-card-note">${coveredNote}</p>
          </div>
        </div>
        <div id="analysis-actions" class="analysis-panel hidden">
          <ol class="analysis-action-list">
            ${actionItems}
          </ol>
        </div>
      </div>
      <div class="upgrade-pro-cta luxe">
        <button class="btn-upgrade-pro luxe">Upgrade for ATS radar & unlimited bullets</button>
        <p class="upgrade-note">Unlock keyword heatmaps, deeper resume diagnostics, and every tailored bullet we generate.</p>
      </div>
    </div>
  `;
}

function buildProjectCardHTML(project: any): string {
  const title = escapeHtml(project.title || 'Project');
  const description = escapeHtml(project.description || '');
  const technologies = (project.technologies || []).join(', ');

  return `
    <div class="project-card" data-title="${title.replace(/"/g, '&quot;')}" data-description="${description.replace(/"/g, '&quot;')}" data-technologies="${technologies.replace(/"/g, '&quot;')}" style="cursor: pointer;">
      <h4>${title}</h4>
      <p>${description}</p>
      <div class="project-tech">${(project.technologies || []).map((tech: string) => `<span>${escapeHtml(tech)}</span>`).join('')}</div>
      <div class="relevance-score">Relevance: ${project.relevance_score || 'N/A'}%</div>
    </div>
  `;
}

async function clearResults(): Promise<void> {
  try {
    await chrome.storage.local.remove(CONFIG.STORAGE.LAST_RESULT_KEY);
    lastTailoredResult = null;

    // Also clear resume and job state
    currentResume = null;
    resumeFileCache = null;
    currentJob = null;
    // Remove resume from storage
    resumeStorage.remove(CONFIG.STORAGE.RESUME_SESSION_KEY);

    if (resultsSection) resultsSection.classList.add('hidden');
    if (downloadBtn) downloadBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
    if (resultsContent) resultsContent.innerHTML = '';

    // Reset upload and job detection UI
    updateUploadUI(null);
    updateJobDetectionUI(null);

    setStatus('Results cleared. Ready to tailor for a new job!');
    updateTailorButton();
  } catch (error) {
    setStatus('Error clearing results');
  }
}

// ============================================================================
// COPY & DOWNLOAD HANDLERS
// ============================================================================

function handleDownload(): void {
  downloadPremiumPreview();
}

function handleCopy(): void {
  if (!lastTailoredResult) {
    setStatus('No tailored resume to copy');
    return;
  }

  const resumeText = buildResumeText(lastTailoredResult);

  navigator.clipboard.writeText(resumeText)
    .then(() => setStatus('Tailored resume copied to clipboard!'))
    .catch(() => setStatus('Error copying to clipboard'));
}

function copyToClipboard(text: string, type: string = 'Content'): void {
  navigator.clipboard.writeText(text)
    .then(() => setStatus(`${type} copied to clipboard!`))
    .catch(() => setStatus(`Error copying ${type.toLowerCase()}`));
}

function copyKeywords(): void {
  if (!lastTailoredResult?.tailored?.suggested_keywords) {
    setStatus('No keywords to copy');
    return;
  }

  const keywords = lastTailoredResult.tailored.suggested_keywords.join(', ');
  navigator.clipboard.writeText(keywords)
    .then(() => setStatus('Keywords copied to clipboard!'))
    .catch(() => setStatus('Error copying keywords'));
}

function copyAllBullets(): void {
  if (!lastTailoredResult?.tailored?.experience_bullets) {
    setStatus('No resume bullets to copy');
    return;
  }

  const bullets = lastTailoredResult.tailored.experience_bullets
    .map((bullet: string, index: number) => `${index + 1}. ${bullet}`)
    .join('\n\n');

  navigator.clipboard.writeText(bullets)
    .then(() => setStatus(`All ${lastTailoredResult.tailored.experience_bullets.length} resume bullets copied to clipboard!`))
    .catch(() => setStatus('Error copying bullets'));
}

function showMoreBullets(): void {
  handleShowMoreBullets();
}

let bulletsDisplayState = 8; // Track how many bullets are currently shown

function handleShowMoreBullets(): void {
  if (!lastTailoredResult?.tailored?.experience_bullets) {
    setStatus('No additional bullets available');
    return;
  }

  const totalBullets = lastTailoredResult.tailored.experience_bullets.length;
  const bulletsList = document.getElementById('optimizedBulletsList');
  const showMoreContainer = document.getElementById('showMoreBulletsContainer');

  if (!bulletsList || !showMoreContainer) return;

  if (bulletsDisplayState >= Math.min(totalBullets, 10)) {
    setStatus('Upgrade to Pro to unlock the remaining resume bullets');
    return;
  }

  const additionalBullets = lastTailoredResult.tailored.experience_bullets.slice(
    bulletsDisplayState,
    Math.min(totalBullets, bulletsDisplayState + 2)
  );

  additionalBullets.forEach((bullet: string) => {
    const li = document.createElement('li');
    li.className = 'bullet-item';
    li.textContent = bullet;
    li.addEventListener('click', () => {
      li.classList.toggle('selected');
    });
    bulletsList.appendChild(li);
  });

  bulletsDisplayState += additionalBullets.length;

  const remaining = Math.max(totalBullets - bulletsDisplayState, 0);
  const upgradeWrapper = document.createElement('div');
  upgradeWrapper.className = 'upgrade-pro-cta luxe';
  upgradeWrapper.innerHTML = `
    <button id="bulletUpgradeBtn" class="btn-upgrade-pro luxe">
      ${remaining > 0 ? `Unlock ${remaining} more bullet${remaining === 1 ? '' : 's'}` : 'Upgrade for unlimited bullets'}
    </button>
    <p class="upgrade-note">Premium unlocks unlimited resume bullets, ATS radar, and smart coaching.</p>
  `;

  const upgradeButton = upgradeWrapper.querySelector<HTMLButtonElement>('#bulletUpgradeBtn');
  if (upgradeButton) {
    upgradeButton.addEventListener('click', () => redirectToPremium('resume-bullets'));
  }

  showMoreContainer.replaceWith(upgradeWrapper);

  setStatus(`Revealed ${additionalBullets.length} more bullet${additionalBullets.length === 1 ? '' : 's'}`);
}

function downloadPremiumPreview(): void {
  if (!lastTailoredResult) {
    setStatus('No tailored resume available');
    return;
  }

  const premiumLink = getPremiumRedirectUrl('download-preview');

  const premiumPreview = `
PREMIUM FEATURES PREVIEW
This enhanced download includes a preview of our premium features.
Upgrade to unlock full functionality!

═══════════════════════════════════════════════════════════════

ATS COMPATIBILITY ANALYSIS (Premium Feature)
Overall ATS Score: 85% (Excellent)
Keyword Match: 78%
Format Score: 92%

Issues Detected:
- Consider adding more quantified achievements
- Include additional technical skills

Premium Recommendations:
- Add cloud computing certifications
- Include leadership experience metrics
- Optimize for mobile development keywords

═══════════════════════════════════════════════════════════════

INDUSTRY INSIGHTS (Premium Feature)
Market Growth: 15% projected growth in software engineering
Salary Range: $85,000 - $120,000 (Mid-level)
Top Skills in Demand: React, Node.js, AWS, Python

═══════════════════════════════════════════════════════════════

${buildEnhancedResumeDocument(lastTailoredResult)}

═══════════════════════════════════════════════════════════════

Want the full premium experience?
- Advanced ATS analysis with detailed recommendations
- Real-time industry insights and salary benchmarks
- Multi-format exports (PDF, Word, LaTeX)
- Application performance tracking
- Premium templates and layouts

Start your 7-day free trial at: ${premiumLink}
`;

  const blob = new Blob([premiumPreview], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().split('T')[0];

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `premium-resume-preview-${timestamp}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  setStatus('Premium preview downloaded! Upgrade for full features.');
}

// ============================================================================
// PREMIUM FEATURES
// ============================================================================

function redirectToPremium(feature?: string): void {
  const url = getPremiumRedirectUrl(feature);
  chrome.tabs.create({ url });
}

function showPremiumFeature(feature: string): void {
  redirectToPremium(feature);
}

function showUpgradeModal(): void {
  redirectToPremium('upgrade');
}

function showProjectDetails(title: string, description: string, technologies: string): void {
  const modal = document.createElement('div');
  modal.className = 'project-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="close-modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="project-details">
          <h4>Project Description</h4>
          <p>${description}</p>

          <h4>Technologies</h4>
          <div class="tech-list">
            ${technologies.split(', ').map(tech => `<span class="tech-tag">${tech}</span>`).join('')}
          </div>

          <div class="project-actions">
            <button class="action-btn primary copy-project-btn">
              Copy Project Details
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.style.display = 'flex';

  // Add event listeners
  const closeBtn = modal.querySelector('.close-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeProjectModal());
  }

  const copyBtn = modal.querySelector('.copy-project-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyProjectDetails(title, description, technologies));
  }

  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeProjectModal();
    }
  });
}

function closeProjectModal(): void {
  const modal = document.querySelector('.project-modal') as HTMLElement;
  if (modal) {
    modal.remove();
  }
}

function copyProjectDetails(title: string, description: string, technologies: string): void {
  const projectText = `Project: ${title}

Description: ${description}

Technologies: ${technologies}

Implementation Tips:
1. Start with a basic MVP version
2. Focus on core functionality first
3. Add the features that directly relate to the job requirements
4. Document your process and decisions
5. Deploy to a public platform (GitHub, Vercel, etc.)`;

  navigator.clipboard.writeText(projectText)
    .then(() => {
      setStatus('Project details copied to clipboard!');
      closeProjectModal();
    })
    .catch(() => setStatus('Error copying project details'));
}

// ============================================================================
// MATCH ANALYSIS
// ============================================================================

function calculateMatchInsights(job: any, tailoredResult: any, resume: any): MatchInsights {
  console.log('🔍 Match Analysis Debug:', {
    jobTitle: job?.title,
    hasJobText: !!(job?.description || job?.title),
    jobTextLength: (job?.description || '').length,
    hasResumeFullText: !!resume?.textPreview,
    hasResumePreview: !!resume?.textPreview,
    hasTailoredContent: !!tailoredResult?.tailored,
    finalResumeTextLength: (resume?.textPreview || '').length,
    sources: {
      fromFullText: !!resume?.textPreview,
      fromPreview: !!resume?.textPreview,
      fromTailored: !!tailoredResult?.tailored
    }
  });

  const llmAnalysis = (tailoredResult?.analysis_insights ?? null) as LlmAnalysisInsights | null;

  // 1. Gather Text Sources
  const resumeText = (resume?.textPreview || '').toLowerCase();
  const tailoredBullets = (tailoredResult?.tailored?.experience_bullets || []).join(' ').toLowerCase();
  const fullResumeContext = resumeText + ' ' + tailoredBullets;

  // 2. Use job.requirements as the authoritative list of requirements/keywords
  const requirements: string[] = Array.isArray(job?.requirements) ? job.requirements : [];
  const fallbackMatched: string[] = [];
  const fallbackMissing: string[] = [];

  requirements.forEach((req) => {
    // Check if the requirement (or its main keywords) are present in the resume
    const reqNorm = req.toLowerCase();
    // Simple check: does the requirement phrase or its main noun/verb appear?
    const mainWord = reqNorm.split(' ').find(w => w.length > 3) || reqNorm;
    if (fullResumeContext.includes(reqNorm) || fullResumeContext.includes(mainWord)) {
      fallbackMatched.push(req.trim());
    } else {
      fallbackMissing.push(req.trim());
    }
  });

  const totalRequirements = requirements.length || 1;
  const fallbackCoverage = fallbackMatched.length / totalRequirements;
  const fallbackScore = Math.round(fallbackCoverage * 100);

  // 3. Generate actionable suggestions for missing requirements
  const fallbackActionItems: string[] = [];
  if (fallbackMissing.length > 0) {
    fallbackMissing.forEach((req) => {
      // Suggest adding the requirement and provide a sample bullet
      fallbackActionItems.push(`Missing requirement: <b>${req}</b>. Add a bullet or skill mentioning this.`);
      // Simple LLM-style suggestion (could be improved with real LLM):
      fallbackActionItems.push(`Example: "${generateSampleBullet(req)}"`);
    });
  }

  if (fallbackScore < 50) {
    fallbackActionItems.push('Low requirement match. Your resume might be filtered out by ATS. Try incorporating more job-specific requirements.');
  } else if (fallbackScore < 70) {
    fallbackActionItems.push('Moderate match. You have a good foundation, but could improve by adding more requirements from the job posting.');
  } else {
    fallbackActionItems.push('Great match! Your resume covers most of the key requirements.');
  }

  // Check for quantification
  const fallbackQuantifiedCount = (fullResumeContext.match(/\d+%|\d+\s*years|\$\d+|\d+\s*users|\d+\s*teams/g) || []).length;
  if (fallbackQuantifiedCount < 3) {
    fallbackActionItems.push('Lack of quantified impact. Try adding numbers (e.g., "increased sales by 20%", "managed team of 5") to prove your achievements.');
  }

  const fallbackActionVerbHits = ACTION_VERBS.reduce((count, verb) => {
    return fullResumeContext.includes(verb) ? count + 1 : count;
  }, 0);

  const llmCoverageValue = typeof llmAnalysis?.snapshot?.requirement_match?.value === 'number'
    ? Math.max(0, Math.min(100, llmAnalysis.snapshot.requirement_match.value))
    : null;

  const score = typeof llmCoverageValue === 'number'
    ? llmCoverageValue
    : (typeof tailoredResult?.match_score === 'number' ? tailoredResult.match_score : fallbackScore);

  const coverage = typeof llmCoverageValue === 'number'
    ? llmCoverageValue / 100
    : fallbackCoverage;

  const matchedKeywords = llmAnalysis?.keyword_gaps?.covered && llmAnalysis.keyword_gaps.covered.length > 0
    ? llmAnalysis.keyword_gaps.covered
    : fallbackMatched;

  const missingKeywords = llmAnalysis?.keyword_gaps?.missing && llmAnalysis.keyword_gaps.missing.length > 0
    ? llmAnalysis.keyword_gaps.missing
    : fallbackMissing;

  const bulletPoints = llmAnalysis?.action_plan?.length
    ? llmAnalysis.action_plan.map((item: LlmActionPlanItem) => item.recommendation)
    : fallbackActionItems;

  const summary = llmAnalysis?.snapshot?.summary
    || (typeof llmCoverageValue === 'number'
      ? `Match Score: ${llmCoverageValue}%`
      : `Match Score: ${fallbackScore}%`);

  const quantifiedCount = typeof llmAnalysis?.snapshot?.quantified_bullets?.count === 'number'
    ? llmAnalysis.snapshot.quantified_bullets.count
    : fallbackQuantifiedCount;

  const actionVerbHits = typeof llmAnalysis?.snapshot?.action_verbs?.count === 'number'
    ? llmAnalysis.snapshot.action_verbs.count
    : fallbackActionVerbHits;

  return {
    score,
    coverage,
    matchedKeywords,
    missingKeywords,
    bulletPoints,
    summary,
    quantifiedCount,
    actionVerbHits,
    llmAnalysis
  };
}

// Helper: Generate a sample bullet for a missing requirement
function generateSampleBullet(requirement: string): string {
  // Simple template, can be improved with LLM
  if (/dashboard|presentation/i.test(requirement)) {
    return `Built dashboards and presentations to support department goals using modern BI tools.`;
  }
  if (/collaborat|team/i.test(requirement)) {
    return `Collaborated with cross-functional teams to achieve project objectives.`;
  }
  if (/analy/i.test(requirement)) {
    return `Analyzed data to identify trends and inform business decisions.`;
  }
  if (/report/i.test(requirement)) {
    return `Generated and presented reports to stakeholders on key metrics.`;
  }
  // Default
  return `Demonstrated experience with: ${requirement}`;
}

function extractTopKeywords(text: string, limit: number): string[] {
  const frequency = new Map<string, number>();

  // Also extract multi-word phrases (bigrams)
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 0);

  // Single words
  words.forEach(word => {
    if (!word || word.length < CONFIG.MATCH_ANALYSIS.MIN_KEYWORD_LENGTH || STOPWORDS.has(word)) return;
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  });

  // Bigrams (two-word phrases)
  for (let i = 0; i < words.length - 1; i++) {
    const word1 = words[i];
    const word2 = words[i + 1];

    if (STOPWORDS.has(word1) || STOPWORDS.has(word2)) continue;
    if (word1.length < 3 || word2.length < 3) continue;

    const bigram = `${word1} ${word2}`;
    frequency.set(bigram, (frequency.get(bigram) ?? 0) + 1);
  }

  // Technical skills and tools (case-sensitive extraction from original text)
  const techKeywords = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Ruby', 'Go', 'Rust', 'Swift', 'Kotlin',
    'React', 'Angular', 'Vue', 'Node.js', 'Django', 'Flask', 'Spring', 'Express',
    'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Jenkins', 'Git', 'GitHub',
    'SQL', 'NoSQL', 'MongoDB', 'PostgreSQL', 'MySQL', 'Redis',
    'API', 'REST', 'GraphQL', 'Microservices', 'Agile', 'Scrum', 'CI/CD',
    'Machine Learning', 'AI', 'Deep Learning', 'NLP', 'Computer Vision',
    'Tableau', 'PowerBI', 'Excel', 'Pandas', 'NumPy', 'TensorFlow', 'PyTorch'
  ];

  techKeywords.forEach(tech => {
    if (text.includes(tech)) {
      frequency.set(tech.toLowerCase(), 5); // Boost technical keywords
    }
  });

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, limit);
}

function buildEvidenceBullets(ctx: EvidenceContext): string[] {
  const coveragePct = Math.round(ctx.coverage * 100);
  const recommendations: string[] = [];

  // Priority 1: Overall Match Score with specific action
  if (ctx.coverage < 0.5) {
    recommendations.push(
      `<strong>🚨 CRITICAL - Low Match (${coveragePct}%):</strong> Your resume has significant gaps. IMMEDIATE ACTION: Add 2-3 bullet points highlighting your experience with <u>${ctx.missingKeywords.slice(0, 3).join(', ')}</u>. Even transferable skills count.`
    );
  } else if (ctx.coverage < 0.7) {
    recommendations.push(
      `<strong>⚠️ MODERATE Match (${coveragePct}%):</strong> You're in the running but need improvements. ACTION: Revise your summary and experience sections to include these keywords: <u>${ctx.missingKeywords.slice(0, 3).join(', ')}</u>.`
    );
  } else if (ctx.coverage < 0.85) {
    recommendations.push(
      `<strong>✓ GOOD Match (${coveragePct}%):</strong> You're competitive! OPTIMIZATION: Add 1-2 mentions of <u>${ctx.missingKeywords.slice(0, 2).join(', ')}</u> to push your score above 85%.`
    );
  } else {
    recommendations.push(
      `<strong>✓✓ EXCELLENT Match (${coveragePct}%):</strong> Your resume strongly aligns with ${ctx.jobTitle}. You're well-positioned for this role. Focus on tailoring your cover letter.`
    );
  }

  // Missing Keywords - Specific and Actionable
  if (ctx.missingKeywords.length > 0 && ctx.coverage < 0.85) {
    const criticalMissing = ctx.missingKeywords.slice(0, 4);
    if (criticalMissing.length <= 2) {
      recommendations.push(
        `<strong>🔑 Close the Gap:</strong> Add <u>${criticalMissing.join(' and ')}</u> to your experience section. Even if not central to your role, mention any exposure: "Collaborated with teams using ${criticalMissing[0]}" or "Gained familiarity with ${criticalMissing[0]} through X project".`
      );
    } else {
      recommendations.push(
        `<strong>🎯 Priority Keywords:</strong> Job emphasizes <u>${criticalMissing.slice(0, 3).join(', ')}</u>. ACTION: Review each bullet point and naturally integrate 2-3 of these terms where truthful. Example: "Developed solutions" → "Developed ${criticalMissing[0]}-based solutions".`
      );
    }
  }

  // Priority 2: Quantified Achievements (Crucial for ATS and hiring managers)
  if (ctx.quantifiedCount < 3) {
    recommendations.push(
      `<strong>📊 URGENT - Add Numbers:</strong> Only ${ctx.quantifiedCount} quantified results found. ATS systems prioritize metrics. ADD NOW: "Improved X by Y%", "Managed team of Z", "Processed N+ records/day". Convert 3-4 bullets to include specific numbers.`
    );
  } else if (ctx.quantifiedCount < 5) {
    recommendations.push(
      `<strong>📈 Strengthen Impact:</strong> ${ctx.quantifiedCount} quantified achievements is good, but ${6 - ctx.quantifiedCount} more would make you stand out. Example: Change "Led project" → "Led 5-person project delivering 25% efficiency gain".`
    );
  } else {
    recommendations.push(
      `<strong>💪 Excellent Impact:</strong> ${ctx.quantifiedCount} quantified achievements clearly demonstrate measurable results. This is a major strength in your application.`
    );
  }

  // Priority 3: Action Verbs (Critical for ATS parsing)
  if (ctx.actionVerbHits < 3) {
    recommendations.push(
      `<strong>⚡ Fix Weak Verbs:</strong> Only ${ctx.actionVerbHits} strong action verbs detected. REPLACE NOW: Change passive phrases like "Responsible for" or "Worked on" → Start with "Developed", "Implemented", "Led", "Architected", "Optimized", "Delivered".`
    );
  } else if (ctx.actionVerbHits < 6) {
    recommendations.push(
      `<strong>🎯 Good Verbs, Add Variety:</strong> ${ctx.actionVerbHits} action verbs found. Enhance impact: Mix technical verbs (Built, Engineered) with leadership verbs (Spearheaded, Championed) for different accomplishments.`
    );
  } else {
    recommendations.push(
      `<strong>💼 Strong Professional Language:</strong> ${ctx.actionVerbHits} impactful action verbs demonstrate ownership and drive. Your resume conveys clear initiative.`
    );
  }

  // Highlight Strengths - Encouraging and Specific
  if (ctx.matchedKeywords.length >= 3) {
    const topMatches = ctx.matchedKeywords.slice(0, 4);
    recommendations.push(
      `<strong>✨ Your Competitive Edge:</strong> You have proven experience with <u>${topMatches.join(', ')}</u> - these are core requirements for this role. LEVERAGE THIS: Mention these prominently in your cover letter and interview prep.`
    );
  }

  if (ctx.aiDemandCount > 0) {
    const aiCoveragePercent = Math.round((ctx.aiCoveredCount / ctx.aiDemandCount) * 100);
    if (aiCoveragePercent < 40) {
      recommendations.push(
        `<strong>Technical Gap:</strong> Job mentions ${ctx.aiDemandCount} technical areas where your resume shows limited coverage (${aiCoveragePercent}%). Highlight any related experience.`
      );
    } else if (aiCoveragePercent < 70) {
      recommendations.push(
        `<strong>Technical Alignment:</strong> ${aiCoveragePercent}% coverage of technical requirements. Good foundation, but emphasize depth in these areas where possible.`
      );
    } else {
      recommendations.push(
        `<strong>Technical Fit:</strong> ${aiCoveragePercent}% coverage of technical requirements shows strong alignment with the role's technical needs.`
      );
    }
  }

  if (ctx.jobTitle) {
    const roleLevel = ctx.jobTitle.toLowerCase().includes('senior') || ctx.jobTitle.toLowerCase().includes('lead')
      ? 'senior-level'
      : ctx.jobTitle.toLowerCase().includes('junior') || ctx.jobTitle.toLowerCase().includes('associate')
        ? 'entry-level'
        : 'mid-level';

    if (roleLevel === 'senior-level' && ctx.actionVerbHits < 6) {
      recommendations.push(
        `<strong>Leadership Emphasis:</strong> For ${ctx.jobTitle}, emphasize team leadership, strategic decisions, and cross-functional collaboration in your bullets.`
      );
    } else if (roleLevel === 'entry-level' && ctx.quantifiedCount < 3) {
      recommendations.push(
        `<strong>Show Learning:</strong> For ${ctx.jobTitle}, highlight specific projects, coursework, or internship outcomes with measurable results.`
      );
    }
  }

  if (ctx.company) {
    recommendations.push(
      `<strong>Tailor to ${ctx.company}:</strong> Research their recent projects and priorities. Adjust your summary to mention experience relevant to their current focus areas.`
    );
  }

  return recommendations.slice(0, 8);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function setButtonLoading(button: HTMLButtonElement, loading: boolean): void {
  if (loading) {
    button.classList.add('btn-loading');
    button.disabled = true;
  } else {
    button.classList.remove('btn-loading');
    button.disabled = false;
  }
}

function setStatus(message: string): void {
  if (status) {
    status.textContent = message;
  }
}

function ensureResumeFile(): File | null {
  if (!currentResume) return null;

  if (resumeFileCache) return resumeFileCache;

  try {
    const blob = base64ToBlob(currentResume.base64, currentResume.mimeType);
    resumeFileCache = new File([blob], currentResume.name, { type: currentResume.mimeType });
    return resumeFileCache;
  } catch (error) {
    return null;
  }
}

function buildResumeText(result: any): string {
  if (typeof result?.resume?.full_text === 'string' && result.resume.full_text.trim().length > 0) {
    return result.resume.full_text.trim();
  }

  const sections = [];

  if (result.tailored?.professional_summary) {
    sections.push(`PROFESSIONAL SUMMARY\n${result.tailored.professional_summary}\n`);
  }

  if (result.tailored?.key_skills && result.tailored.key_skills.length > 0) {
    sections.push(`CORE COMPETENCIES\n${result.tailored.key_skills.join(' • ')}\n`);
  }

  if (result.tailored?.experience_bullets && result.tailored.experience_bullets.length > 0) {
    sections.push(`READY-TO-USE RESUME POINTS\n${result.tailored.experience_bullets.map((bullet: string) => `• ${bullet}`).join('\n')}\n\n(Copy these bullet points directly into your resume)\n`);
  }

  return sections.join('\n').trim();
}

function buildEnhancedResumeDocument(result: any): string {
  const timestamp = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const matchScore = result.match_score || 'N/A';

  const header = `
╔════════════════════════════════════════════════════════════════════════════════╗
║                     AI-TAILORED RESUME PACKAGE                                 ║
║                     Generated by ResumeIt AI                                   ║
╚════════════════════════════════════════════════════════════════════════════════╝

TAILORING SUMMARY
- Generated: ${timestamp}
- Target Role: ${currentJob?.title || 'Not specified'}
- Target Company: ${currentJob?.company || 'Not specified'}
- ATS Match Score: ${matchScore}%
- Status: Ready for editing and customization

${'═'.repeat(80)}

HOW TO USE THIS DOCUMENT:
1. Copy sections directly into your preferred resume format
2. Customize the provided bullet points to match your specific experience
3. Use the keyword suggestions to optimize for ATS systems
4. Reference the application strategy for interview prep

${'═'.repeat(80)}

`;

  const resumeContent = `
OPTIMIZED RESUME CONTENT

PROFESSIONAL SUMMARY
${result.tailored?.professional_summary || 'Professional summary not available'}

CORE COMPETENCIES
${(result.tailored?.key_skills || []).join(' • ')}

READY-TO-USE RESUME POINTS
${(result.tailored?.experience_bullets || []).map((bullet: string) => `• ${bullet}`).join('\n')}

(Copy these bullet points directly into your resume)

ATS KEYWORDS (Include these throughout your resume)
${(result.tailored?.suggested_keywords || []).join(', ')}

${'═'.repeat(80)}

`;

  const footer = `
ADDITIONAL TIPS:

1. FORMATTING: Use consistent fonts, spacing, and bullet points
2. LENGTH: Keep to 1-2 pages depending on experience level
3. KEYWORDS: Naturally integrate the suggested keywords throughout
4. QUANTIFY: Add specific numbers, percentages, and metrics where possible
5. CUSTOMIZE: Adjust each application based on the specific job requirements
6. PROOFREAD: Always spell-check and grammar-check before submitting

Remember: This is your foundation. Customize it to reflect your unique experience!

Generated by ResumeIt AI • ${timestamp}
`;

  return header + resumeContent + footer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < bytes.length; i += CONFIG.MATCH_ANALYSIS.CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CONFIG.MATCH_ANALYSIS.CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);

  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }

  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

function generateTextPreview(buffer: ArrayBuffer, mimeType: string): string | undefined {
  if (mimeType !== 'text/plain') return undefined;

  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(buffer).slice(0, CONFIG.FILE_UPLOAD.TEXT_PREVIEW_LENGTH);
}

function resolveMimeType(file: File): string {
  if (file.type) return file.type;

  const extension = file.name.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'application/octet-stream';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((message: TailorResultMessage) => {
  if (message.type === MessageType.TailorResult) {
    setStatus('Resume tailored successfully!');
    if (tailorBtn) setButtonLoading(tailorBtn, false);
    showResults(message.result);
  }
});

// ============================================================================
// GLOBAL WINDOW FUNCTIONS (for onclick handlers)
// ============================================================================

(window as any).copyToClipboard = copyToClipboard;
(window as any).copyKeywords = copyKeywords;
(window as any).copyAllBullets = copyAllBullets;
(window as any).showMoreBullets = showMoreBullets;
(window as any).showPremiumFeature = showPremiumFeature;
(window as any).showUpgradeModal = showUpgradeModal;
(window as any).showProjectDetails = showProjectDetails;
(window as any).closeProjectModal = closeProjectModal;
(window as any).copyProjectDetails = copyProjectDetails;
(window as any).handleCopyFromInline = handleCopy;
(window as any).handleDownloadFromInline = handleDownload;
(window as any).clearResultsFromInline = clearResults;
