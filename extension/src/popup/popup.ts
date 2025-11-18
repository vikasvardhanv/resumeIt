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

type MatchInsights = {
  score: number;
  coverage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  quantifiedCount: number;
  actionVerbHits: number;
  bulletPoints: string[];
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
  } catch {}

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
  }).catch(() => {});
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
          } catch {}

          if (response.status === 401 && token) {
            chrome.identity.removeCachedAuthToken({ token }, () => {});
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
        if (t) chrome.identity.removeCachedAuthToken({ token: t }, () => {});
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
        chrome.identity.removeCachedAuthToken({ token }, () => {});
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

  fileInput.addEventListener('change', handleFileSelect);

  const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement | null;
  if (uploadBtn) {
    uploadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (fileInput) fileInput.click();
    });
  }

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (uploadArea) uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    if (uploadArea) uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', handleDrop);

  const dropzone = document.getElementById('uploadDropzone');
  if (dropzone) {
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (fileInput) fileInput.click();
      }
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

    const statusMessage = isOverwrite 
      ? `${record.name} uploaded (previous resume replaced)` 
      : `${record.name} saved`;
    showResumeStatus(statusMessage, 'success', record.textPreview);
    updateTailorButton();
  } catch (error) {
    showResumeStatus('Error processing file', 'error');
  } finally {
    if (fileInput) fileInput.value = '';
  }
}

function validateFile(file: File): boolean {
  const hasValidExtension = CONFIG.FILE_UPLOAD.ALLOWED_EXTENSIONS.test(file.name);

  if (!CONFIG.FILE_UPLOAD.ALLOWED_TYPES.includes(file.type) && !hasValidExtension) {
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

    chrome.tabs.sendMessage(tab.id, { type: MessageType.GetJob }, (response) => {
      if (chrome.runtime.lastError) {
        updateJobDetectionUI(null);
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
  if (!noJobDetected || !jobDetected || !detectedJobTitle || !detectedCompany || !jobDetection) {
    return;
  }

  const debugInfo = document.getElementById('debugInfo') as HTMLElement;

  if (job && job.title) {
    noJobDetected.style.display = 'none';
    jobDetected.style.display = 'block';
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
    noJobDetected.style.display = 'block';
    jobDetected.style.display = 'none';
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

  const refreshBtn = document.getElementById('refreshResultsBtn') as HTMLButtonElement | null;
  if (refreshBtn) refreshBtn.addEventListener('click', clearResults);
  
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
      showResumeStatus(`${currentResume.name} loaded`, 'success', currentResume.textPreview);
      
      // Hide upload hint since resume is already loaded
      const uploadHint = document.querySelector('.upload-hint-compact') as HTMLElement;
      if (uploadHint) {
        uploadHint.style.display = 'none';
      }
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
  
  const tailorSection = document.getElementById('tailorSection') as HTMLElement | null;
  if (tailorSection) {
    tailorSection.classList.remove('hidden');
  }
  
  const canTailor = !!(currentResume && currentJob && currentJob.title);
  tailorBtn.disabled = !canTailor;
}

function handleTailorJob(): void {
  if (!currentResume || !tailorBtn) {
    setStatus('Please upload a resume first');
    return;
  }

  if (!currentJob || !currentJob.title) {
    setStatus('No job detected. Navigate to a job posting first.');
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
  } catch (error) {
    console.error('❌ Tailoring error:', error);
    setStatus(`Error: ${(error as Error).message}`);
    if (tailorBtn) setButtonLoading(tailorBtn, false);
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
  let seconds = CONFIG.RATE_LIMIT.DEFAULT_COOLDOWN_SECONDS;
  
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
  console.log('🎨 Displaying results:', {
    success: data.success,
    bulletCount: data.tailored?.experience_bullets?.length || 0,
    displayingBullets: Math.min(8, data.tailored?.experience_bullets?.length || 0)
  });
  
  lastTailoredResult = data;
  
  if (resultsSection) {
    resultsSection.classList.remove('hidden');
    resultsSection.style.display = 'block';
  }

  const summary = escapeHtml(data.tailored?.professional_summary || 'Not available');
  const currentJobTitle = escapeHtml(currentJob?.title || 'Position');
  const currentCompany = escapeHtml(currentJob?.company || 'Company');
  
  const matchInsights = calculateMatchInsights(currentJob, data, currentResume);
  const matchScore = typeof matchInsights?.score === 'number'
    ? matchInsights.score
    : (typeof data.match_score === 'number' ? Math.round(Math.max(0, Math.min(100, data.match_score))) : 'N/A');
  
  const matchAnalysisBlock = matchInsights
    ? buildMatchAnalysisHTML(matchInsights)
    : '<p style="margin: 0;">Upload a resume and keep the job description open to unlock strict AI Match Analysis.</p>';

  const projects = Array.isArray(data.projects) ? data.projects.filter((p: any) => (p.relevance_score || 0) >= 70).slice(0, 2) : [];
  const projectMarkup = projects.map((project: any) => buildProjectCardHTML(project)).join('');

  if (!resultsContent) return;
  
  const bulletCount = data.tailored?.experience_bullets?.length || 0;
  const skillsCount = data.tailored?.key_skills?.length || 0;
  const summaryPreview = (data.tailored?.professional_summary || '').substring(0, 100) + '...';

  resultsContent.innerHTML = `
    <div style="background: linear-gradient(135deg, #0073b1 0%, #005a8d 100%); color: white; padding: 14px; margin: 0 0 10px 0; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,115,177,0.2);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
        <div style="flex: 1;">
          <h3 style="margin: 0 0 4px 0; font-size: 17px; font-weight: 700; color: white;">${currentJobTitle}</h3>
          <p style="margin: 0 0 8px 0; font-size: 13px; color: rgba(255,255,255,0.9);">${currentCompany}</p>
          <p style="margin: 0; font-size: 11px; color: rgba(255,255,255,0.8); line-height: 1.4; font-style: italic;">${escapeHtml(summaryPreview)}</p>
        </div>
        <div style="text-align: center; background: rgba(255,255,255,0.15); padding: 10px 14px; border-radius: 8px; min-width: 80px;">
          <div style="font-size: 28px; font-weight: 700; color: white;">${typeof matchScore === 'number' ? `${matchScore}%` : 'N/A'}</div>
          <div style="font-size: 10px; color: rgba(255,255,255,0.9); font-weight: 500;">Match</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.2);">
        <div style="text-align: center; background: rgba(255,255,255,0.1); padding: 6px; border-radius: 6px;">
          <div style="font-size: 18px; font-weight: 700;">${bulletCount}</div>
          <div style="font-size: 9px; opacity: 0.9;">Resume Bullets</div>
        </div>
        <div style="text-align: center; background: rgba(255,255,255,0.1); padding: 6px; border-radius: 6px;">
          <div style="font-size: 18px; font-weight: 700;">${skillsCount}</div>
          <div style="font-size: 9px; opacity: 0.9;">Key Skills</div>
        </div>
        <div style="text-align: center; background: rgba(255,255,255,0.1); padding: 6px; border-radius: 6px;">
          <div style="font-size: 18px; font-weight: 700;">${projects.length}</div>
          <div style="font-size: 9px; opacity: 0.9;">Projects</div>
        </div>
      </div>
    </div>

    <div style="background: #fff; border-left: 3px solid #0073b1; padding: 12px 14px; margin: 0 0 8px 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <h4 style="margin: 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">Professional Summary</h4>
        <button onclick="copyToClipboard(\`${summary.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`, 'Summary')" style="background: #fff; color: #0073b1; border: 1px solid #0073b1; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 500;">Copy</button>
      </div>
      <p style="margin: 0; line-height: 1.5; color: #333; font-size: 13px;">${summary}</p>
    </div>

    <div style="background: #fff; border-left: 3px solid #0073b1; padding: 12px 14px; margin: 0 0 8px 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h4 style="margin: 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">Core Skills</h4>
        <span style="background: #e8f5e8; color: #2e7d32; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">${(data.tailored?.key_skills || []).length} Skills</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        ${(data.tailored?.key_skills || []).map((skill: string) => `
          <span style="background: #f0f0f0; color: #333; padding: 5px 9px; border-radius: 14px; font-size: 11px; border: 1px solid #ddd;">
            ${escapeHtml(skill)}
          </span>
        `).join('')}
      </div>
    </div>

    <div style="background: #fff; border-left: 3px solid #0073b1; padding: 12px 14px; margin: 0 0 8px 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h4 style="margin: 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">Ready-to-Use Resume Bullets</h4>
        <button onclick="copyAllBullets()" style="background: #0073b1; color: white; border: none; padding: 4px 12px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 500;">
          Copy All
        </button>
      </div>
      <ul style="list-style: none; padding: 0; margin: 0;">
        ${(data.tailored?.experience_bullets || []).map((bullet: string, index: number) => `
          <li style="background: #f8f9fa; padding: 9px 11px; margin: 5px 0; border-radius: 4px; border-left: 2px solid #ddd;">
            <p style="margin: 0; font-size: 12px; line-height: 1.4; color: #333;">
              <span style="color: #0073b1; font-weight: 600; margin-right: 5px;">${index + 1}.</span>${escapeHtml(bullet)}
            </p>
          </li>
        `).join('')}
      </ul>
    </div>

    <div style="background: #fff; border-left: 3px solid #0073b1; padding: 12px 14px; margin: 0 0 8px 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h4 style="margin: 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">ATS Keywords</h4>
        <button onclick="copyKeywords()" style="background: #fff; color: #0073b1; border: 1px solid #0073b1; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 500;">Copy All</button>
      </div>
      <div style="line-height: 1.6;">
        ${(data.tailored?.suggested_keywords || []).map((keyword: string) => `<span style="display: inline-block; background: #e3f2fd; color: #0277bd; padding: 4px 8px; border-radius: 12px; font-size: 11px; margin: 2px; border: 1px solid #bbdefb;">${escapeHtml(keyword)}</span>`).join('')}
      </div>
    </div>

    ${projects.length ? `
    <div style="background: #fff; border-left: 3px solid #0073b1; padding: 12px 14px; margin: 0 0 8px 0;">
      <h4 style="margin: 0 0 8px 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">Relevant Projects</h4>
      <div style="display:grid;grid-template-columns:1fr;gap:6px;">${projectMarkup}</div>
    </div>
    ` : ''}

    <div style="background: linear-gradient(135deg, #0073b1, #005a8d); color: white; padding: 12px 14px; margin: 0 0 8px 0; border-radius: 4px;">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">AI Match Analysis</h4>
      ${matchAnalysisBlock}
    </div>

    <div style="background: #f8f9fa; border: 1px dashed #ccc; padding: 12px 14px; margin: 0 0 8px 0; border-radius: 4px; text-align: center;">
      <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #333;">Premium Features Available</h4>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 8px 0;">
        <button onclick="showPremiumFeature('ats-analysis')" style="background: #fff; border: 1px solid #ddd; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px; color: #333;">
          ATS Deep Scan
        </button>
        <button onclick="showPremiumFeature('cover-letter')" style="background: #fff; border: 1px solid #ddd; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px; color: #333;">
          Cover Letter
        </button>
        <button onclick="showPremiumFeature('salary-insights')" style="background: #fff; border: 1px solid #ddd; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px; color: #333;">
          Salary Intel
        </button>
        <button onclick="showPremiumFeature('interview-prep')" style="background: #fff; border: 1px solid #ddd; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px; color: #333;">
          Interview Prep
        </button>
      </div>
      <button onclick="showUpgradeModal()" style="background: #0073b1; color: white; border: none; padding: 9px 18px; border-radius: 20px; font-size: 12px; cursor: pointer; font-weight: 600; margin-top: 6px;">
        Upgrade to Premium - $9.99/month
      </button>
    </div>

    <div style="display: flex; gap: 8px; justify-content: center; margin-top: 10px; padding: 10px 0 4px 0; border-top: 2px solid #e0e0e0;">
      <button id="copyBtn" onclick="handleCopyFromInline()" style="flex: 1; background: #fff; color: #0073b1; border: 1px solid #0073b1; padding: 9px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 500;">
        Copy
      </button>
      <button id="downloadBtn" onclick="handleDownloadFromInline()" style="flex: 1; background: #fff; color: #0073b1; border: 1px solid #0073b1; padding: 9px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 500;">
        Download
      </button>
      <button id="refreshResultsBtn" onclick="clearResultsFromInline()" style="flex: 1; background: #fff; color: #dc2626; border: 1px solid #dc2626; padding: 9px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 500;">
        Clear
      </button>
    </div>
  `;
}

function buildMatchAnalysisHTML(insights: MatchInsights): string {
  return `
    <div style="margin: 15px 0;">
      <p style="margin: 0 0 10px 0; font-size: 13px; font-weight: 600;">
        Resume vs Job Requirements Analysis
      </p>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0;">
        <div style="background: rgba(255,255,255,0.2); padding: 8px; border-radius: 8px; text-align: center;">
          <div style="font-size: 20px; font-weight: 700;">${Math.round(insights.coverage * 100)}%</div>
          <div style="font-size: 10px; opacity: 0.9;">Keyword Match</div>
        </div>
        <div style="background: rgba(255,255,255,0.2); padding: 8px; border-radius: 8px; text-align: center;">
          <div style="font-size: 20px; font-weight: 700;">${insights.quantifiedCount}/${Math.max(6, insights.quantifiedCount + 2)}</div>
          <div style="font-size: 10px; opacity: 0.9;">Quantified Bullets</div>
        </div>
        <div style="background: rgba(255,255,255,0.2); padding: 8px; border-radius: 8px; text-align: center;">
          <div style="font-size: 20px; font-weight: 700;">${insights.actionVerbHits}</div>
          <div style="font-size: 10px; opacity: 0.9;">Action Verbs</div>
        </div>
      </div>
      <div style="background: rgba(255,255,255,0.18); border-radius: 10px; padding: 14px; margin-top: 15px; text-align: left;">
        <p style="margin: 0 0 10px 0; font-weight: 600; font-size: 13px;">ATS & Hiring Manager Recommendations</p>
        <ul style="margin: 0; padding-left: 0; list-style: none; font-size: 12px; line-height: 1.6;">
          ${insights.bulletPoints.map((point: string) => `
            <li style="margin-bottom: 10px; padding-left: 18px; position: relative;">
              <span style="position: absolute; left: 0; top: 2px;">•</span>
              ${point}
            </li>
          `).join('')}
        </ul>
      </div>
    </div>
  `;
}

function buildProjectCardHTML(project: any): string {
  return `
    <div class="project-card" onclick="showProjectDetails('${escapeHtml(project.title || 'Project').replace(/'/g, "\\'")}', '${escapeHtml(project.description || '').replace(/'/g, "\\'")}', '${(project.technologies || []).join(', ')}')">
      <h4>${escapeHtml(project.title || 'Project')}</h4>
      <p>${escapeHtml(project.description || '')}</p>
      <div class="project-tech">${(project.technologies || []).map((tech: string) => `<span>${escapeHtml(tech)}</span>`).join('')}</div>
      <div class="relevance-score">Relevance: ${project.relevance_score || 'N/A'}%</div>
    </div>
  `;
}

async function clearResults(): Promise<void> {
  try {
    await chrome.storage.local.remove(CONFIG.STORAGE.LAST_RESULT_KEY);
    lastTailoredResult = null;
    
    if (resultsSection) resultsSection.classList.add('hidden');
    if (downloadBtn) downloadBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
    if (resultsContent) resultsContent.innerHTML = '';
    
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
  if (!lastTailoredResult?.tailored?.experience_bullets) {
    setStatus('No additional bullets available');
    return;
  }
  
  const totalBullets = lastTailoredResult.tailored.experience_bullets.length;
  if (totalBullets <= 8) {
    setStatus('All bullets are already displayed');
    return;
  }
  
  setStatus(`Upgrade to Pro to unlock ${totalBullets - 8} additional resume bullets!`);
  setTimeout(() => {
    setStatus('Pro features include: unlimited bullets, advanced ATS analysis, and more.');
  }, 2500);
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
        <button class="close-modal" onclick="closeProjectModal()">&times;</button>
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
            <button class="action-btn primary" onclick="copyProjectDetails('${title}', '${description}', '${technologies}')">
              Copy Project Details
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  modal.style.display = 'flex';
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

function calculateMatchInsights(job: any, resultData: any, resumeData: ResumeSessionData | null): MatchInsights | null {
  const resumeText = (resultData.resume?.full_text || resumeData?.textPreview || '').toLowerCase();
  const jobSegments: string[] = [];
  
  if (job?.title) jobSegments.push(job.title);
  if (job?.company) jobSegments.push(job.company);
  if (job?.description) jobSegments.push(job.description);
  if (Array.isArray(job?.requirements)) jobSegments.push(job.requirements.join(' '));
  
  const jobText = jobSegments.join(' ').toLowerCase();

  if (!resumeText.trim() || !jobText.trim()) {
    return null;
  }

  const keywords = extractTopKeywords(jobText, CONFIG.MATCH_ANALYSIS.TOP_KEYWORDS_LIMIT);
  if (!keywords.length) return null;

  const matchedKeywords = keywords.filter(keyword => resumeText.includes(keyword));
  const missingKeywords = keywords.filter(keyword => !resumeText.includes(keyword));
  const coverage = matchedKeywords.length / keywords.length;

  const experienceBullets = Array.isArray(resultData.tailored?.experience_bullets)
    ? resultData.tailored.experience_bullets
    : [];
  const quantifiedCount = experienceBullets.filter((bullet: string) => /[\d%$]/.test(bullet)).length;
  const desiredQuantified = Math.max(
    CONFIG.MATCH_ANALYSIS.MIN_QUANTIFIED_BULLETS,
    Math.min(CONFIG.MATCH_ANALYSIS.MAX_QUANTIFIED_BULLETS, experienceBullets.length)
  );
  const quantScore = Math.min(1, quantifiedCount / desiredQuantified);

  const actionVerbHits = ACTION_VERBS.filter(verb => resumeText.includes(verb)).length;
  const verbScore = Math.min(1, actionVerbHits / CONFIG.MATCH_ANALYSIS.MIN_ACTION_VERBS);

  const aiDemandCount = AI_KEYWORDS.filter(term => jobText.includes(term)).length;
  const aiCoveredCount = AI_KEYWORDS.filter(term => resumeText.includes(term)).length;
  const aiCoverage = aiDemandCount ? Math.min(1, aiCoveredCount / aiDemandCount) : 1;

  const highRiskGap = missingKeywords.length >= Math.ceil(keywords.length * 0.4);
  const penalty = highRiskGap ? 0.1 : 0;

  let rawScore = (0.55 * coverage) + (0.25 * quantScore) + (0.15 * verbScore) + (0.05 * aiCoverage) - penalty;
  rawScore = Math.max(0, Math.min(1, rawScore));
  const score = Math.round(rawScore * 100);

  const bulletPoints = buildEvidenceBullets({
    coverage,
    matchedKeywords,
    missingKeywords,
    quantifiedCount,
    actionVerbHits,
    aiDemandCount,
    aiCoveredCount,
    jobTitle: job?.title || '',
    company: job?.company || ''
  });

  return {
    score,
    coverage,
    matchedKeywords,
    missingKeywords,
    quantifiedCount,
    actionVerbHits,
    bulletPoints
  };
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
  
  if (ctx.coverage < 0.5) {
    recommendations.push(
      `<strong>Critical Mismatch:</strong> Your resume matches only ${coveragePct}% of the required skills and experience. Focus on: ${ctx.missingKeywords.slice(0, 4).join(', ')}.`
    );
  } else if (ctx.coverage < 0.7) {
    recommendations.push(
      `<strong>Moderate Match:</strong> ${coveragePct}% alignment with job requirements. To improve, add experience with: ${ctx.missingKeywords.slice(0, 3).join(', ')}.`
    );
  } else if (ctx.coverage < 0.85) {
    recommendations.push(
      `<strong>Good Match:</strong> ${coveragePct}% keyword coverage. You're competitive. Strengthen by highlighting: ${ctx.missingKeywords.slice(0, 2).join(', ')}.`
    );
  } else {
    recommendations.push(
      `<strong>Strong Match:</strong> ${coveragePct}% alignment detected. Your experience closely matches the requirements for ${ctx.jobTitle}.`
    );
  }
  
  if (ctx.missingKeywords.length > 0) {
    const criticalMissing = ctx.missingKeywords.slice(0, 4);
    if (criticalMissing.length <= 2) {
      recommendations.push(
        `<strong>Skills Gap:</strong> Add ${criticalMissing.join(' and ')} to your experience if you have relevant work in these areas.`
      );
    } else {
      recommendations.push(
        `<strong>Key Skills Missing:</strong> The job emphasizes ${criticalMissing.join(', ')}. Add specific examples where you used these skills or technologies.`
      );
    }
  }
  
  if (ctx.quantifiedCount < 3) {
    recommendations.push(
      `<strong>Add Metrics:</strong> Only ${ctx.quantifiedCount} quantified results found. Add specific numbers showing impact (e.g., "reduced time by 30%", "managed team of 5", "processed 10K+ records").`
    );
  } else if (ctx.quantifiedCount < 5) {
    recommendations.push(
      `<strong>Strengthen Impact:</strong> You have ${ctx.quantifiedCount} quantified achievements. Add ${6 - ctx.quantifiedCount} more with concrete metrics to demonstrate measurable results.`
    );
  } else {
    recommendations.push(
      `<strong>Results-Focused:</strong> ${ctx.quantifiedCount} quantified achievements demonstrate clear impact. This strengthens your candidacy significantly.`
    );
  }
  
  if (ctx.actionVerbHits < 3) {
    recommendations.push(
      `<strong>Weak Action Verbs:</strong> Only ${ctx.actionVerbHits} strong action verbs detected. Begin bullets with: Developed, Implemented, Led, Designed, Built, Optimized, Managed.`
    );
  } else if (ctx.actionVerbHits < 6) {
    recommendations.push(
      `<strong>Good Start:</strong> ${ctx.actionVerbHits} action verbs found. For stronger impact, use varied leadership verbs throughout your experience section.`
    );
  } else {
    recommendations.push(
      `<strong>Strong Language:</strong> ${ctx.actionVerbHits} impactful action verbs convey ownership and initiative, which aligns well with this role's requirements.`
    );
  }
  
  if (ctx.matchedKeywords.length >= 3) {
    const topMatches = ctx.matchedKeywords.slice(0, 4);
    recommendations.push(
      `<strong>Your Strengths:</strong> Resume clearly demonstrates experience with ${topMatches.join(', ')}. These are directly relevant to the position.`
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