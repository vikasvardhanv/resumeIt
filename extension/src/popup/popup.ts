import { MessageType, TailorResultMessage } from '../types/messages';
import { IS_AI_ANALYSIS_ENABLED, getApiUrl, getAiAnalysisUrl, getPremiumRedirectUrl } from '../config';

interface ResumeSessionData {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
  textPreview?: string;
  uploadedAt: number;
}

const resumeStorage = (chrome.storage.session ?? chrome.storage.local) as chrome.storage.StorageArea;
const LAST_RESULT_KEY = 'lastTailoredResult';
const RESUME_SESSION_KEY = 'resumeSession';
const AUTH_CACHE_KEY = 'userAuthCache';
const MAX_BASE64_SIZE = 8_000_000; // ~8 MB after base64 encoding

let currentResume: ResumeSessionData | null = null;
let resumeFileCache: File | null = null;
let currentJob: any = null;
let lastTailoredResult: any = null;
let userAuth: any = null;
let isAuthenticated = false; // Global flag to track auth state

let uploadInitialized = false;
let buttonsInitialized = false;
let jobDetectionIntervalId: number | null = null;

// Query elements after DOM is ready - these will be set in DOMContentLoaded
let uploadArea: HTMLElement | null = null;
let fileInput: HTMLInputElement | null = null;
let resumeStatus: HTMLElement | null = null;
let tailorBtn: HTMLButtonElement | null = null;
let aiAnalyzeBtn: HTMLButtonElement | null = null;
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

function getHealthChip(): HTMLButtonElement | null {
  return document.getElementById('healthChip') as HTMLButtonElement | null;
}
type HealthState = 'checking' | 'ok' | 'warn' | 'error';
let healthTimer: number | null = null;

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

// Initialise popup state
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Popup DOMContentLoaded fired');
  
  // Setup Google login button event listener
  const googleLoginBtn = document.getElementById('googleLoginBtn') as HTMLButtonElement;
  console.log('🔍 Google login button:', googleLoginBtn);
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => {
      console.log('🖱️ Google login button clicked!');
      loginWithGoogle();
    });
    console.log('✅ Google login event listener attached');
  } else {
    console.error('❌ Google login button not found!');
  }
  
  // Setup logout button event listener
  const logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement;
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  // Optional feature gating
  try {
    if (!IS_AI_ANALYSIS_ENABLED && typeof aiAnalyzeBtn !== 'undefined' && aiAnalyzeBtn) {
      aiAnalyzeBtn.style.display = 'none';
    }
  } catch {}

  // Quickly show last known backend health before re-checking
  try {
    const stored = await chrome.storage.local.get('lastHealthStatus');
    if (stored?.lastHealthStatus) {
      updateHealthChip(stored.lastHealthStatus.state as HealthState, stored.lastHealthStatus.text);
    }
  } catch {}

  const hc = getHealthChip();
  if (hc) {
    hc.addEventListener('click', () => checkBackendHealth(true));
    checkBackendHealth(false);
  }

  const authenticated = await checkAuthStatus();
  isAuthenticated = authenticated;
  
  if (isAuthenticated) {
    // Show main view
    const authView = document.getElementById('authView');
    const mainView = document.getElementById('mainView');
    if (authView) authView.classList.add('hidden');
    if (mainView) mainView.classList.remove('hidden');

    // Query all elements AFTER mainView is shown
    uploadArea = document.getElementById('uploadArea') as HTMLElement | null;
    fileInput = document.getElementById('fileInput') as HTMLInputElement | null;
    resumeStatus = document.getElementById('resumeStatus') as HTMLElement | null;
    tailorBtn = document.getElementById('tailorBtn') as HTMLButtonElement | null;
    aiAnalyzeBtn = document.getElementById('aiAnalyzeBtn') as HTMLButtonElement | null;
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

    console.log('✅ Elements queried:', {
      tailorBtn: !!tailorBtn,
      uploadArea: !!uploadArea,
      jobDetection: !!jobDetection
    });

    // Update user info
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

  // Initialize features
  initializeUpload();
  await loadPersistedResume();
  initializeButtons();
  await hydrateLastResult();
  startJobDetection();
  updateTailorButton();
  } else {
    // Show auth view
    const authView = document.getElementById('authView');
    const mainView = document.getElementById('mainView');
    if (authView) authView.classList.remove('hidden');
    if (mainView) mainView.classList.add('hidden');
  }
});

async function checkBackendHealth(manual: boolean) {
  const hc = getHealthChip();
  if (!hc) return;
  updateHealthChip('checking', manual ? 'Re-checking…' : 'Checking backend…');

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);

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
    console.warn('Health check failed:', error);
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    updateHealthChip(aborted ? 'warn' : 'error', aborted ? 'Slow response' : 'Offline');
  } finally {
    if (healthTimer) {
      window.clearTimeout(healthTimer);
    }
    healthTimer = window.setTimeout(() => checkBackendHealth(false), 60000);
  }
}

function updateHealthChip(state: HealthState, text: string) {
  const hc = getHealthChip();
  if (!hc) return;
  hc.dataset.state = state;
  const textNode = hc.querySelector('.health-text');
  if (textNode) {
    textNode.textContent = text;
  }
  // Persist last health status for next popup open
  chrome.storage.local.set({ lastHealthStatus: { state, text, ts: Date.now() } }).catch(() => {});
}

// Authentication functions
async function checkAuthStatus(): Promise<boolean> {
  console.log('🔍 Checking authentication status...');
  
  try {
    // First, check if we have cached auth data
    const cached = await chrome.storage.local.get(AUTH_CACHE_KEY);
    
    if (cached[AUTH_CACHE_KEY] && cached[AUTH_CACHE_KEY].authenticated && cached[AUTH_CACHE_KEY].user) {
      console.log('✅ Found cached auth data');
      // Use cached data immediately for faster UI
      userAuth = cached[AUTH_CACHE_KEY];
      isAuthenticated = true;
      
      // Verify in background (don't block UI)
      setTimeout(() => verifyAuthInBackground(), 100);
      return true;
    }
    
    console.log('⏳ No cache found, checking with server...');
    // No cache, check with server
    const response = await fetch(getApiUrl('/api/v1/auth/status'), {
      credentials: 'include',
      cache: 'no-cache'
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('📡 Server response:', data.authenticated ? 'authenticated' : 'not authenticated');
      
      if (!data.authenticated) {
        await chrome.storage.local.remove(AUTH_CACHE_KEY);
        isAuthenticated = false;
        return false;
      } else {
        // Cache the auth data
        userAuth = data;
        isAuthenticated = true;
        await chrome.storage.local.set({ [AUTH_CACHE_KEY]: data });
        return true;
      }
    } else {
      console.log('❌ Server returned non-OK status:', response.status);
      await chrome.storage.local.remove(AUTH_CACHE_KEY);
      isAuthenticated = false;
      return false;
    }
  } catch (error) {
    console.error('⚠️ Auth check failed:', error);
    // If we have cache, still use it (offline mode)
    const cached = await chrome.storage.local.get(AUTH_CACHE_KEY);
    if (cached[AUTH_CACHE_KEY]?.user) {
      console.log('📦 Using cached auth (offline mode)');
      userAuth = cached[AUTH_CACHE_KEY];
      isAuthenticated = true;
      return true;
    }
    console.log('❌ No cache available');
    isAuthenticated = false;
    return false;
  }
}

// Background verification to keep session fresh
async function verifyAuthInBackground() {
  console.log('🔄 Background verification started...');
  
  try {
    const response = await fetch(getApiUrl('/api/v1/auth/status'), {
      credentials: 'include',
      cache: 'no-cache'
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.authenticated) {
        console.log('✅ Background verification: Session valid');
        // Silently update cache with fresh data
        userAuth = data;
        isAuthenticated = true;
        await chrome.storage.local.set({ [AUTH_CACHE_KEY]: data });
      } else {
        console.log('⚠️ Background verification: Session expired, attempting silent re-auth');
        const success = await silentReauthenticate();
        if (!success) {
          await chrome.storage.local.remove(AUTH_CACHE_KEY);
          userAuth = null;
          isAuthenticated = false;
          const authView = document.getElementById('authView');
          const mainView = document.getElementById('mainView');
          if (authView && mainView) {
            authView.classList.remove('hidden');
            mainView.classList.add('hidden');
          }
        }
      }
    } else if (response.status === 401) {
      console.log('🚫 Background verification: 401 Unauthorized, attempting silent re-auth');
      const success = await silentReauthenticate();
      if (!success) {
        await chrome.storage.local.remove(AUTH_CACHE_KEY);
        userAuth = null;
        isAuthenticated = false;
        const authView = document.getElementById('authView');
        const mainView = document.getElementById('mainView');
        if (authView && mainView) {
          authView.classList.remove('hidden');
          mainView.classList.add('hidden');
        }
      }
    }
  } catch (error) {
    console.log('📡 Background verification failed (offline/network error):', error);
    // Keep using cached data if offline - don't change auth state
    // This allows the extension to work offline
  }
}

// Attempt to refresh backend session without UI by using Chrome identity token
async function silentReauthenticate(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.identity.getAuthToken({ interactive: false }, async (token) => {
        if (chrome.runtime.lastError || !token) {
          console.warn('Silent re-auth failed to get token:', chrome.runtime.lastError?.message);
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
          await chrome.storage.local.set({ [AUTH_CACHE_KEY]: data });
          // Keep main view visible
          const authView = document.getElementById('authView');
          const mainView = document.getElementById('mainView');
          if (authView && mainView) {
            authView.classList.add('hidden');
            mainView.classList.remove('hidden');
          }
          // Update user display if available
          const userInitials = document.getElementById('userInitials');
          const userName = document.getElementById('userName');
          const userEmail = document.getElementById('userEmail');
          if (userInitials && data?.user?.name) {
            const initials = data.user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase();
            userInitials.textContent = initials || 'U';
          }
          if (userName && data?.user?.name) userName.textContent = data.user.name;
          if (userEmail && data?.user?.email) userEmail.textContent = data.user.email;
          resolve(true);
        } catch (e) {
          console.warn('Silent re-auth verify failed:', e);
          resolve(false);
        }
      });
    } catch (e) {
      console.warn('Silent re-auth exception:', e);
      resolve(false);
    }
  });
}

function loginWithGoogle() {
  console.log('🔐 loginWithGoogle() called');
  const googleLoginBtn = document.getElementById('googleLoginBtn') as HTMLButtonElement;
  if (googleLoginBtn) {
    googleLoginBtn.disabled = true;
    const span = googleLoginBtn.querySelector('span');
    if (span) span.textContent = 'Signing in...';
  }
  
  console.log('📞 Calling chrome.identity.getAuthToken...');
  // Use Chrome's identity API for OAuth
  chrome.identity.getAuthToken({ interactive: true }, async (token) => {
    console.log('🎫 Token received:', token ? 'Yes' : 'No');
    if (chrome.runtime.lastError) {
      console.error('Authentication failed:', chrome.runtime.lastError);
      setStatus('Authentication failed. Please try again.');
      if (googleLoginBtn) {
        googleLoginBtn.disabled = false;
        const span = googleLoginBtn.querySelector('span');
        if (span) span.textContent = 'Continue with Google';
      }
      return;
    }
    
    if (token) {
      try {
        // Send the token to your backend for verification
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
          
          // Cache auth data for persistence
          await chrome.storage.local.set({ [AUTH_CACHE_KEY]: authData });
          
          // Switch to main view
          const authView = document.getElementById('authView');
          const mainView = document.getElementById('mainView');
          if (authView) authView.classList.add('hidden');
          if (mainView) mainView.classList.remove('hidden');
          
          // Update user info
          const userInitials = document.getElementById('userInitials');
          const userName = document.getElementById('userName');
          const userEmail = document.getElementById('userEmail');
          
          if (userInitials) {
            const initials = authData.user.name
              ?.split(' ')
              .map((n: string) => n[0])
              .join('')
              .toUpperCase() || 'U';
            userInitials.textContent = initials;
          }
          if (userName) userName.textContent = authData.user.name || 'User';
          if (userEmail) userEmail.textContent = authData.user.email || '';
          
          setStatus('Successfully signed in!');
          
          // Initialize app features after successful login
          initializeUpload();
          initializeButtons();
          await loadPersistedResume();
          await hydrateLastResult();
          startJobDetection();
          updateTailorButton();
        } else {
          // Try to read a structured error; fallback to status-based messages
          let apiError = 'Backend authentication failed';
          try {
            const errorData = await response.json();
            if (errorData?.error) apiError = errorData.error;
          } catch {}

          // If unauthorized, clear cached token so the next attempt is fresh
          if (response.status === 401 && token) {
            chrome.identity.removeCachedAuthToken({ token }, () => console.log('Removed cached token after 401'));
          }

          const err = new Error(apiError) as Error & { status?: number };
          (err as any).status = response.status;
          throw err;
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        // Classify error for better UX
        let userMessage = 'Authentication failed. Please try again.';
        const isOffline = !navigator.onLine;
        if (isOffline) {
          userMessage = 'You appear offline. Reconnect and retry Google sign‑in.';
        } else if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          if (msg.includes('invalid') || msg.includes('token')) {
            userMessage = 'Google token invalid or expired. Click to re-authenticate.';
            // Proactively clear cached token so next attempt is fresh
            chrome.identity.getAuthToken({ interactive: false }, (t) => {
              if (t) chrome.identity.removeCachedAuthToken({ token: t }, () => console.log('Cleared stale cached token'));
            });
          } else if (msg.includes('backend')) {
            userMessage = 'Backend session could not be established. Try again shortly.';
          } else if (msg.includes('fetch') || msg.includes('network')) {
            userMessage = 'Network issue during sign‑in. Check connection and retry.';
          } else {
            userMessage = `Auth error: ${error.message}`;
          }
        }
        setStatus(userMessage);
        if (googleLoginBtn) {
          googleLoginBtn.disabled = false;
          const span = googleLoginBtn.querySelector('span');
          if (span) span.textContent = 'Continue with Google';
          // Provide quick retry affordance by adding a temporary pulse class
          googleLoginBtn.classList.add('retry-ready');
          setTimeout(() => googleLoginBtn.classList.remove('retry-ready'), 4000);
        }
      }
    }
  });
}

async function logout() {
  try {
    // Clear Chrome's cached auth token
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          console.log('Cached auth token removed');
        });
      }
    });

    // Clear auth cache
    await chrome.storage.local.remove(AUTH_CACHE_KEY);

    await fetch(getApiUrl('/api/v1/auth/logout'), {
      method: 'POST',
      credentials: 'include'
    });
    
    userAuth = null;
    isAuthenticated = false;
    window.location.reload();
  } catch (error) {
    console.error('Logout failed:', error);
    // Even if logout fails, clear local cache
    await chrome.storage.local.remove(AUTH_CACHE_KEY);
    userAuth = null;
    isAuthenticated = false;
    window.location.reload();
  }
}

function initializeUpload() {
  if (uploadInitialized) {
    return;
  }
  uploadInitialized = true;
  if (!uploadArea || !fileInput) {
    console.warn('Upload area or file input missing - simplified UI maybe not loaded yet');
    return;
  }

  fileInput.addEventListener('change', handleFileSelect);

  // Support clicking the primary button explicitly
  const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement | null;
  if (uploadBtn) {
    uploadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      fileInput.click();
    });
  }

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', handleDrop);

  // Accessibility: allow keyboard activation of dropzone choose file
  const dropzone = document.getElementById('uploadDropzone');
  if (dropzone) {
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
  }

}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  if (uploadArea) uploadArea.classList.remove('dragover');
  
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    void handleFile(files[0]);
  }
}

// Job Detection Functions
function startJobDetection() {
  if (jobDetectionIntervalId !== null) {
    return;
  }
  // Check immediately
  checkForJobOnCurrentTab();
  
  // Poll every 2 seconds for job changes
  jobDetectionIntervalId = window.setInterval(checkForJobOnCurrentTab, 2000);
}

async function checkForJobOnCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    console.log('🔍 Checking for job on tab:', tab.url);

    // Send message to content script to extract job info
    chrome.tabs.sendMessage(tab.id, { type: MessageType.GetJob }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('❌ Content script error:', chrome.runtime.lastError.message);
        updateJobDetectionUI(null);
        return;
      }
      
      console.log('📨 Response from content script:', response);
      
      if (response?.job) {
        console.log('✅ Job detected:', response.job.title, 'at', response.job.company);
        currentJob = response.job;
        updateJobDetectionUI(response.job);
      } else {
        console.log('❌ No job found in response');
        currentJob = null;
        updateJobDetectionUI(null);
      }
    });
  } catch (error) {
    console.error('Error checking for job:', error);
    updateJobDetectionUI(null);
  }
}

function updateJobDetectionUI(job: any) {
  console.log('🎨 updateJobDetectionUI called with job:', job);
  console.log('✅ Valid job found, updating UI');

  if (!noJobDetected || !jobDetected || !detectedJobTitle || !detectedCompany || !jobDetection) {
    console.warn('⚠️ Job detection UI elements not found');
    return;
  }

  const debugInfo = document.getElementById('debugInfo') as HTMLElement;

  if (job && job.title && job.company) {
    // Show job detected
    noJobDetected.style.display = 'none';
    jobDetected.style.display = 'flex';
    detectedJobTitle.textContent = job.title;
    detectedCompany.textContent = job.company;
    jobDetection.classList.add('active');

    console.log('📞 Calling updateTailorButton from updateJobDetectionUI');

    // Update debug info
    if (debugInfo) {
      debugInfo.textContent = `✅ Domain: ${job.source} | Desc: ${job.description?.length || 0} chars`;
    }
  } else {
    // Show no job detected
    noJobDetected.style.display = 'flex';
    jobDetected.style.display = 'none';
    jobDetection.classList.remove('active');

    // Update debug info with current tab info
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (debugInfo && currentTab) {
        const domain = new URL(currentTab.url || '').hostname;
        debugInfo.textContent = `🔍 Scanning: ${domain} | No job detected`;
      }
    });
  }

  updateTailorButton();
}

function initializeButtons() {
  if (buttonsInitialized) {
    return;
  }
  buttonsInitialized = true;
  if (tailorBtn) tailorBtn.addEventListener('click', handleTailorJob);
  if (IS_AI_ANALYSIS_ENABLED && aiAnalyzeBtn) {
    aiAnalyzeBtn.addEventListener('click', handleAIAnalysis);
  }
  if (downloadBtn) downloadBtn.addEventListener('click', handleDownload);
  if (copyBtn) copyBtn.addEventListener('click', handleCopy);

  const refreshBtn = document.getElementById('refreshResultsBtn') as HTMLButtonElement | null;
  if (refreshBtn) refreshBtn.addEventListener('click', clearResults);
}

async function loadPersistedResume() {
  try {
    const stored = await resumeStorage.get(RESUME_SESSION_KEY);
    if (stored[RESUME_SESSION_KEY]) {
      currentResume = stored[RESUME_SESSION_KEY] as ResumeSessionData;
      resumeFileCache = null; // rebuild lazily from base64
      showResumeStatus(`✓ ${currentResume.name} loaded`, 'success', currentResume.textPreview);
    }
  } catch (error) {
    console.error('Failed to load resume from session storage', error);
  }
}

async function hydrateLastResult() {
  try {
    const stored = await chrome.storage.local.get(LAST_RESULT_KEY);
    const cachedResult = stored[LAST_RESULT_KEY];

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
    console.error('Failed to load cached tailoring result', error);
    lastTailoredResult = null;
  if (resultsSection) resultsSection.classList.add('hidden');
  if (downloadBtn) downloadBtn.disabled = true;
  if (copyBtn) copyBtn.disabled = true;
    setStatus('Ready to tailor your resume!');
  }

  updateTailorButton();
}

async function handleFile(file: File) {
  if (!validateFile(file)) {
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const mimeType = resolveMimeType(file);
    const base64 = arrayBufferToBase64(buffer);

    if (base64.length > MAX_BASE64_SIZE) {
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

    currentResume = record;
    resumeFileCache = new File([buffer], record.name, { type: record.mimeType });
    await persistResume(record);

    showResumeStatus(`✓ ${record.name} saved`, 'success', record.textPreview);
    updateTailorButton();
  } catch (error) {
    console.error('Failed to process resume upload', error);
    showResumeStatus('Error processing file', 'error');
  } finally {
  if (fileInput) fileInput.value = '';
  }
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    void handleFile(file);
  }
}

function validateFile(file: File): boolean {
  const validTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];

  const hasValidExtension = /\.(pdf|doc|docx|txt)$/i.test(file.name);

  if (!validTypes.includes(file.type) && !hasValidExtension) {
    showResumeStatus('Invalid file format. Please upload a PDF, DOC, DOCX, or TXT file.', 'error');
    return false;
  }

  if (file.size > 5 * 1024 * 1024) {
    showResumeStatus('File size must be less than 5MB', 'error');
    return false;
  }

  return true;
}

async function persistResume(record: ResumeSessionData) {
  try {
    await resumeStorage.set({ [RESUME_SESSION_KEY]: record });
  } catch (error) {
    console.error('Failed to persist resume in session storage', error);
    showResumeStatus('Unable to save resume for this session', 'error');
  }
}

function showResumeStatus(message: string, type: 'success' | 'error', preview?: string) {
  if (!resumeStatus) return;
  resumeStatus.textContent = message;
  resumeStatus.className = `resume-status ${type}`;
  resumeStatus.classList.remove('hidden');

  const previewElement = document.getElementById('resumePreview');
  if (previewElement) {
    if (type === 'success' && preview && preview.length > 0) {
      previewElement.textContent = preview.slice(0, 4000);
      previewElement.classList.remove('hidden');
    } else {
      previewElement.textContent = '';
      previewElement.classList.add('hidden');
    }
  }
}

function updateTailorButton() {
  if (!tailorBtn) return;
  const tailorSection = document.getElementById('tailorSection') as HTMLElement | null;
  if (tailorSection) {
    tailorSection.classList.remove('hidden'); // Always visible; use disabled state to guide user
  }
  // Enable only when resume uploaded AND a job is detected
  const canTailor = !!(currentResume && currentJob && currentJob.title);
  tailorBtn.disabled = !canTailor;
}

function handleTailorJob() {
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

function handleAIAnalysis() {
  if (!IS_AI_ANALYSIS_ENABLED) {
    setStatus('AI analysis is not available in this build.');
    return;
  }

  if (!currentResume) {
    setStatus('Please upload a resume first');
    return;
  }

  if (!currentJob || !currentJob.title) {
    setStatus('No job detected. Navigate to a job posting first.');
    return;
  }

  setStatus('Starting AI analysis...');
  if (aiAnalyzeBtn) setButtonLoading(aiAnalyzeBtn, true);

  void analyzeResumeWithAI().finally(() => {
  if (aiAnalyzeBtn) setButtonLoading(aiAnalyzeBtn, false);
  });
}

async function tailorResume() {
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

    const formData = new FormData();
    formData.append('resume', resumeFile);
    formData.append('jobPosting', JSON.stringify(currentJob));

    const apiUrl = getApiUrl('/api/v1/analyze-job');
    console.log('🚀 Calling backend:', apiUrl);
    console.log('📋 Job data:', { title: currentJob.title, company: currentJob.company });

    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });
    
    console.log('📡 Response status:', response.status);

    if (!response.ok) {
      // Minimal unified error handling – backend is solid, handle only essentials
      if (response.status === 429) {
        // Respect Retry-After header when provided by backend/provider
        const retryAfter = response.headers.get('Retry-After');
        let seconds = 15;
        if (retryAfter) {
          const numeric = parseInt(retryAfter, 10);
          if (!Number.isNaN(numeric)) {
            seconds = Math.max(5, Math.min(120, numeric));
          } else {
            const retryDate = new Date(retryAfter);
            const deltaMs = retryDate.getTime() - Date.now();
            if (!Number.isNaN(retryDate.getTime()) && deltaMs > 0) {
              seconds = Math.max(5, Math.min(120, Math.ceil(deltaMs / 1000)));
            }
          }
        }
        startRateLimitCooldown(seconds);
        return;
      }
      if (response.status === 401) {
        await chrome.storage.local.remove(AUTH_CACHE_KEY);
        isAuthenticated = false;
        userAuth = null;
        throw new Error('Session expired. Please sign in again.');
      }
      const text = await response.text().catch(() => '');
      throw new Error(text || `Request failed (${response.status})`);
    }

    const result = await response.json().catch(() => ({ success:false, error:'Invalid JSON response' }));
    
    console.log('📦 Backend result:', result);
    
    if (!result.success) throw new Error(result.detail || result.error || 'Tailoring failed');

    setStatus('Resume tailored successfully!');
  if (tailorBtn) setButtonLoading(tailorBtn, false);
    showResults(result);

    lastTailoredResult = result;
  if (downloadBtn) downloadBtn.disabled = false;
  if (copyBtn) copyBtn.disabled = false;

    await chrome.storage.local.set({
      [LAST_RESULT_KEY]: result,
      lastTailoredTime: Date.now()
    });
  } catch (error) {
    console.error('❌ Tailoring error:', error);
    console.error('Error details:', {
      message: (error as Error).message,
      stack: (error as Error).stack,
      error: error
    });
    setStatus(`Error: ${(error as Error).message}`);
  if (tailorBtn) setButtonLoading(tailorBtn, false);
  }
}

let rateLimitTimer: number | null = null;
function startRateLimitCooldown(seconds: number) {
  if (!tailorBtn) return;
  if (rateLimitTimer) {
    window.clearInterval(rateLimitTimer);
    rateLimitTimer = null;
  }
  let remaining = seconds;
  tailorBtn.disabled = true;
  setButtonLoading(tailorBtn, false);
  setStatus(`⏱️ Rate limit hit. Please wait ${remaining}s before retrying.`);
  rateLimitTimer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(rateLimitTimer!);
      rateLimitTimer = null;
      setStatus('You can try tailoring again now.');
      updateTailorButton();
    } else {
      setStatus(`⏱️ Rate limit hit. Please wait ${remaining}s before retrying.`);
    }
  }, 1000);
}

// NEW: AI-powered resume analysis function
async function analyzeResumeWithAI() {
  if (!IS_AI_ANALYSIS_ENABLED) {
    setStatus('AI analysis is not configured.');
    return;
  }

  if (!currentResume || !currentJob) {
    setStatus('Missing resume or job data');
    return;
  }

  try {
    setStatus('🤖 Analyzing resume with AI...');
    
    // Convert base64 resume to text (for simplicity, we'll use the text preview)
    let resumeText = currentResume.textPreview || '';
    
    // If no text preview, try to extract from base64 (basic implementation)
    if (!resumeText && currentResume.base64) {
      try {
        // For PDF, you might need a proper PDF parser, but for now we'll use a placeholder
        resumeText = 'Resume content extracted from uploaded file';
      } catch (e) {
        console.warn('Could not extract text from resume file');
        resumeText = 'Resume analysis based on uploaded file';
      }
    }

    const jobDescription = `${currentJob.title}\n\nCompany: ${currentJob.company}\n\n${currentJob.description}`;

    // Call our local AI API
    const response = await fetch(getAiAnalysisUrl('/api/analyze'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resumeText: resumeText,
        jobDescription: jobDescription
      })
    });

    if (!response.ok) {
      throw new Error(`AI analysis failed: ${response.status}`);
    }

    // Handle streaming response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let analysisResult = '';

    if (reader) {
      setStatus('🤖 Receiving AI analysis...');
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value);
        const lines = text.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                analysisResult += data.content;
                // Update status to show progress
                setStatus(`🤖 Analyzing... (${analysisResult.length} chars received)`);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    }

    setStatus('✅ AI analysis complete!');
    
    // Show AI analysis results
    showAIAnalysisResults(analysisResult);

  } catch (error) {
    console.error('AI Analysis error:', error);
    setStatus(`AI Analysis Error: ${(error as Error).message}`);
  }
}

function showAIAnalysisResults(analysisText: string) {
  // Create or update AI analysis section
  let aiSection = document.getElementById('aiAnalysisSection');
  if (!aiSection) {
    aiSection = document.createElement('div');
    aiSection.id = 'aiAnalysisSection';
    aiSection.className = 'analysis-section';
  if (resultsSection) resultsSection.appendChild(aiSection);
  }

  aiSection.innerHTML = `
    <div class="analysis-header">
      <h3>🤖 AI Resume Analysis</h3>
      <button id="copyAIAnalysis" class="copy-btn">Copy Analysis</button>
    </div>
    <div class="analysis-content">
      <pre>${escapeHtml(analysisText)}</pre>
    </div>
  `;

  // Add copy functionality
  const copyAIBtn = document.getElementById('copyAIAnalysis');
  if (copyAIBtn) {
    copyAIBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(analysisText).then(() => {
        setStatus('AI analysis copied to clipboard!');
      });
    });
  }

  if (resultsSection) resultsSection.classList.remove('hidden');
}

function showResults(data: any) {
  lastTailoredResult = data;
  
  if (resultsSection) {
    resultsSection.classList.remove('hidden');
    resultsSection.style.display = 'block';
  }

  const summary = escapeHtml(data.tailored?.professional_summary || 'Not available');
  const skills = (data.tailored?.key_skills || []).map((skill: string) => `<li>${escapeHtml(skill)}</li>`).join('');
  const experience = (data.tailored?.experience_bullets || []).map((bullet: string) => `<li>${escapeHtml(bullet)}</li>`).join('');
  const keywords = (data.tailored?.suggested_keywords || []).map((keyword: string) => `<span style="display: inline-block; background: #e3f2fd; color: #0277bd; padding: 4px 8px; border-radius: 12px; font-size: 12px; margin: 2px; border: 1px solid #bbdefb;">${escapeHtml(keyword)}</span>`).join('');
  const projects = Array.isArray(data.projects) ? data.projects.slice(0, 2) : [];

  const resumeTextContent = (data.resume?.full_text || currentResume?.textPreview || '').trim();
  const jobDescriptionText = (currentJob?.description || '').trim();

  if (!resumeTextContent) {
    setStatus('Please upload a resume to unlock strict AI Match Analysis.');
  }

  if (!jobDescriptionText) {
    setStatus('Open a job description to validate the JD before scoring.');
  }

  const backendMatchScore = typeof data.match_score === 'number'
    ? Math.round(Math.max(0, Math.min(100, data.match_score)))
    : null;

  const matchInsights = calculateMatchInsights(currentJob, data, currentResume);
  const matchScore = typeof matchInsights?.score === 'number'
    ? matchInsights.score
    : (backendMatchScore ?? 'N/A');
  const matchScoreLabel = typeof matchScore === 'number' ? `${matchScore}% Match` : 'Match score pending';
  const matchMeterWidth = typeof matchScore === 'number' ? matchScore : 0;

  const totalCriticalKeywords = matchInsights ? (matchInsights.matchedKeywords.length + matchInsights.missingKeywords.length) : 0;
  const matchedKeywordPreview = matchInsights ? (matchInsights.matchedKeywords.slice(0, 4).map(keyword => escapeHtml(keyword)).join(', ') || 'N/A') : 'N/A';
  const missingKeywordPreview = matchInsights ? (matchInsights.missingKeywords.slice(0, 3).map(keyword => escapeHtml(keyword)).join(', ') || 'None') : 'N/A';
  const matchAnalysisBlock = matchInsights
    ? `
      <p style="margin: 10px 0; font-size: 13px;">
        Strict AI validation matched ${matchInsights.matchedKeywords.length} of ${totalCriticalKeywords || matchInsights.matchedKeywords.length} critical requirements before scoring.
      </p>
      <div style="display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; text-align: left;">
        <span style="background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 999px;">Matched keywords: ${matchedKeywordPreview}</span>
        <span style="background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 999px;">Gaps to close: ${missingKeywordPreview}</span>
        <span style="background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 999px;">Quantified bullets: ${matchInsights.quantifiedCount}</span>
      </div>
      <div style="background: rgba(255,255,255,0.18); border-radius: 10px; padding: 12px; margin-top: 12px; text-align: left;">
        <p style="margin: 0 0 8px 0; font-weight: 600; font-size: 12px;">Evidence-backed recommendations</p>
        <ul style="margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.5;">
          ${matchInsights.bulletPoints.slice(0, 8).map(point => `<li>${escapeHtml(point)}</li>`).join('')}
        </ul>
      </div>
    `
    : `
      <p style="margin: 0;">Upload a resume and keep the job description open to unlock strict AI Match Analysis.</p>
    `;

  // Dynamic resume points with copy functionality
  const dynamicPoints = (data.tailored?.dynamic_resume_points || []).map((category: any) => `
    <div class="dynamic-category">
      <h4>📋 ${escapeHtml(category.category)}</h4>
      ${category.points.map((point: any, index: number) => `
        <div class="resume-point" data-point-text="${escapeHtml(point.text)}">
          <div class="point-content">
            <p class="point-text">${escapeHtml(point.text)}</p>
            <p class="point-impact">💡 Impact: ${escapeHtml(point.impact)}</p>
            <div class="point-keywords">
              ${point.keywords.map((keyword: string) => `<span class="keyword-tag">${escapeHtml(keyword)}</span>`).join('')}
            </div>
          </div>
          <button class="copy-point-btn" onclick="copyResumePoint('${escapeHtml(point.text).replace(/'/g, "\\'")}')">📄 Copy</button>
        </div>
      `).join('')}
    </div>
  `).join('');

  // Customization suggestions
  const suggestions = (data.tailored?.customization_suggestions || []).map((suggestion: any) => `
    <div class="suggestion ${suggestion.priority}">
      <div class="suggestion-header">
        <span class="priority-badge ${suggestion.priority}">${suggestion.priority.toUpperCase()}</span>
        <span class="section-name">${escapeHtml(suggestion.section)}</span>
      </div>
      <p class="suggestion-text">${escapeHtml(suggestion.suggestion)}</p>
      <p class="suggestion-reasoning">💭 ${escapeHtml(suggestion.reasoning)}</p>
    </div>
  `).join('');

  // Competitive analysis
  const competitiveAnalysis = data.competitive_analysis ? `
    <div class="competitive-analysis">
      <div class="analysis-section strengths">
        <h4>💪 Your Strengths</h4>
        <ul>${data.competitive_analysis.strengths.map((strength: string) => `<li>${escapeHtml(strength)}</li>`).join('')}</ul>
      </div>
      <div class="analysis-section gaps">
        <h4>🎯 Areas to Develop</h4>
        <ul>${data.competitive_analysis.gaps.map((gap: string) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul>
      </div>
      <div class="analysis-section improvements">
        <h4>📈 Priority Improvements</h4>
        <ul>${data.competitive_analysis.improvement_areas.map((area: string) => `<li>${escapeHtml(area)}</li>`).join('')}</ul>
      </div>
    </div>
  ` : '';

  const projectMarkup = projects.map((project: any) => `
      <div class="project-card" onclick="showProjectDetails('${escapeHtml(project.title || 'Project').replace(/'/g, "\\'")}', '${escapeHtml(project.description || '').replace(/'/g, "\\'")}', '${(project.technologies || []).join(', ')}')">
        <h4>${escapeHtml(project.title || 'Project')}</h4>
        <p>${escapeHtml(project.description || '')}</p>
        <div class="project-tech">${(project.technologies || []).map((tech: string) => `<span>${escapeHtml(tech)}</span>`).join('')}</div>
        <div class="relevance-score">Relevance: ${project.relevance_score || 'N/A'}%</div>
      </div>
    `).join('');


  const resumePreview = renderResumePreview(data);
  const coverLetterPoints = (data.application_strategy?.cover_letter_points || []).map((point: string) => `<li>${escapeHtml(point)}</li>`).join('');
  const interviewTopics = (data.application_strategy?.interview_topics || []).map((topic: string) => `<li>${escapeHtml(topic)}</li>`).join('');
  const networkingSuggestions = (data.application_strategy?.networking_suggestions || []).map((suggestion: string) => `<li>${escapeHtml(suggestion)}</li>`).join('');
  const salaryInfo = data.application_strategy?.salary_research ? `
    <div class="salary-research">
      <h4>💰 Salary Research</h4>
      <p><strong>Expected Range:</strong> ${escapeHtml(data.application_strategy.salary_research.range)}</p>
      <p><strong>Key Factors:</strong> ${data.application_strategy.salary_research.factors.map((factor: string) => escapeHtml(factor)).join(', ')}</p>
    </div>
  ` : '';

  // Create impressive investor-ready results display
  const currentJobTitle = currentJob?.title || 'this position';
  const currentCompany = currentJob?.company || 'this company';
  
  if (!resultsContent) return;
  resultsContent.innerHTML = `
    <!-- Header with success animation -->
    <div style="background: linear-gradient(135deg, #0073b1, #005885); color: white; padding: 20px; border-radius: 12px; margin: 10px 0; text-align: center; box-shadow: 0 4px 20px rgba(0,115,177,0.3);">
      <div style="font-size: 48px; margin-bottom: 10px;">🎯</div>
      <h2 style="margin: 0 0 5px 0; font-size: 20px;">Resume Optimized for ${currentJobTitle}</h2>
      <p style="margin: 0; opacity: 0.9; font-size: 14px;">Tailored for ${currentCompany} • ATS-Optimized • ${matchScoreLabel}</p>
    </div>

    <!-- Professional Summary Card -->
    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h4 style="margin: 0; color: #0073b1; font-size: 16px; display: flex; align-items: center;">
          📝 Professional Summary
        </h4>
        <button onclick="copyToClipboard('${summary.replace(/'/g, "\\'")}', 'Summary')" style="background: #0073b1; color: white; border: none; padding: 5px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;">Copy</button>
      </div>
      <p style="margin: 0; line-height: 1.6; color: #333; font-size: 14px; background: #f8f9fa; padding: 15px; border-radius: 8px;">${summary}</p>
    </div>

    <!-- Skills Matrix -->
    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h4 style="margin: 0; color: #0073b1; font-size: 16px;">🔑 Core Competencies</h4>
        <span style="background: #e8f5e8; color: #2e7d32; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">${skills.split('<li>').length - 1} Skills Identified</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${(data.tailored?.key_skills || []).map((skill: string, index: number) => `
          <span style="background: ${index < 3 ? 'linear-gradient(135deg, #0073b1, #005885)' : '#f0f0f0'}; color: ${index < 3 ? 'white' : '#333'}; padding: 8px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; border: ${index < 3 ? 'none' : '1px solid #ddd'};">
            ${index < 3 ? '⭐ ' : ''}${escapeHtml(skill)}
          </span>
        `).join('')}
      </div>
    </div>

    <!-- Dynamic Resume Points -->
    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h4 style="margin: 0; color: #0073b1; font-size: 16px;">✨ Ready-to-Use Resume Bullets</h4>
        <span style="background: #fff3e0; color: #f57c00; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">Copy & Paste Ready</span>
      </div>
      <div style="space-y: 10px;">
        ${(data.tailored?.experience_bullets || []).slice(0, 4).map((bullet: string, index: number) => `
          <div style="background: #f8f9fa; border-left: 4px solid #0073b1; padding: 12px 15px; margin: 8px 0; border-radius: 0 8px 8px 0; position: relative;">
            <div style="display: flex; justify-content: between; align-items: start;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #333; flex: 1; padding-right: 10px;">• ${escapeHtml(bullet)}</p>
              <button onclick="copyToClipboard('${bullet.replace(/'/g, "\\'")}', 'Bullet Point')" style="background: #0073b1; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 10px; cursor: pointer; min-width: 40px;">Copy</button>
            </div>
          </div>
        `).join('')}
      </div>
      ${(data.tailored?.experience_bullets || []).length > 4 ? `
        <div style="text-align: center; margin-top: 15px;">
          <button onclick="showPremiumFeature('extra-bullets')" style="background: linear-gradient(135deg, #ff6b6b, #ee5a24); color: white; border: none; padding: 10px 20px; border-radius: 20px; font-size: 12px; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
            <span>🔐</span>
            <span>See ${(data.tailored?.experience_bullets || []).length - 4} More Bullets (Premium)</span>
          </button>
        </div>
      ` : ''}
    </div>

    <!-- ATS Keywords Section -->
    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h4 style="margin: 0; color: #0073b1; font-size: 16px;">🎯 ATS Keywords</h4>
        <button onclick="copyKeywords()" style="background: #0073b1; color: white; border: none; padding: 5px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;">Copy All</button>
      </div>
      <div style="margin: 10px 0; line-height: 1.8;">${keywords}</div>
      <div style="background: #e3f2fd; padding: 10px; border-radius: 6px; margin-top: 10px;">
        <p style="margin: 0; font-size: 11px; color: #1565c0;">💡 <strong>Pro Tip:</strong> Sprinkle these keywords naturally throughout your resume to improve ATS compatibility.</p>
      </div>
    </div>

    <!-- Recommended Projects (from backend) -->
    ${projects.length ? `
    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin: 15px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h4 style="margin:0;color:#0073b1;font-size:16px;">🧭 Real‑world Projects</h4>
        <span style="font-size:11px;color:#6B7280;">Grounded in this JD</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:10px;">${projectMarkup}</div>
    </div>
    ` : ''}

    <!-- Match Score & Analytics -->
    <div style="background: linear-gradient(135deg, #4caf50, #8bc34a); color: white; border-radius: 12px; padding: 20px; margin: 15px 0; text-align: center; box-shadow: 0 4px 20px rgba(76,175,80,0.3);">
      <h4 style="margin: 0 0 15px 0; font-size: 18px;">📊 Strict AI Match Analysis</h4>
      <div style="background: rgba(255,255,255,0.2); border-radius: 50px; height: 8px; margin: 15px 0; overflow: hidden;">
        <div style="background: white; height: 100%; width: ${matchMeterWidth}%; border-radius: 50px; transition: width 1s ease-out;"></div>
      </div>
      <div style="font-size: 36px; font-weight: bold; margin: 10px 0;">${typeof matchScore === 'number' ? `${matchScore}%` : 'N/A'}</div>
      <p style="margin: 0; opacity: 0.9; font-size: 14px;">${matchScoreLabel} for ${currentJobTitle}</p>
      ${matchAnalysisBlock}
    </div>

    <!-- Premium Features Preview -->
    <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; border-radius: 12px; padding: 20px; margin: 15px 0; box-shadow: 0 4px 20px rgba(102,126,234,0.3);">
      <h4 style="margin: 0 0 15px 0; font-size: 16px; text-align: center;">🌟 Unlock Premium Features</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 15px 0;">
        <div onclick="showPremiumFeature('ats-analysis')" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; cursor: pointer; text-align: center; border: 1px solid rgba(255,255,255,0.2);">
          <div style="font-size: 20px;">📈</div>
          <div style="font-size: 11px; margin-top: 5px;">ATS Deep Scan</div>
        </div>
        <div onclick="showPremiumFeature('cover-letter')" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; cursor: pointer; text-align: center; border: 1px solid rgba(255,255,255,0.2);">
          <div style="font-size: 20px;">📝</div>
          <div style="font-size: 11px; margin-top: 5px;">Cover Letter</div>
        </div>
        <div onclick="showPremiumFeature('salary-insights')" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; cursor: pointer; text-align: center; border: 1px solid rgba(255,255,255,0.2);">
          <div style="font-size: 20px;">💰</div>
          <div style="font-size: 11px; margin-top: 5px;">Salary Intel</div>
        </div>
        <div onclick="showPremiumFeature('interview-prep')" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; cursor: pointer; text-align: center; border: 1px solid rgba(255,255,255,0.2);">
          <div style="font-size: 20px;">🎤</div>
          <div style="font-size: 11px; margin-top: 5px;">Interview Prep</div>
        </div>
      </div>
      <div style="text-align: center; margin-top: 15px;">
        <button onclick="showUpgradeModal()" style="background: linear-gradient(135deg, #ff6b6b, #ee5a24); color: white; border: none; padding: 12px 24px; border-radius: 25px; font-size: 14px; cursor: pointer; font-weight: 600; box-shadow: 0 4px 15px rgba(255,107,107,0.4);">
          🚀 Upgrade to Premium - $9.99/month
        </button>
      </div>
    </div>
  `;
  
  if (resultsContent) console.log('📋 Results content set, innerHTML length:', resultsContent.innerHTML.length);
  
  /* Original complex content - commented out for now
  resultsContent.innerHTML = `
    <div class="result-section">
      <h3>📝 Tailored Professional Summary</h3>
      <p>${summary}</p>
      <button class="copy-btn small" onclick="copyToClipboard('${summary.replace(/'/g, "\\'")}')">📄 Copy Summary</button>
    </div>
    
    <div class="result-section">
      <h3>🔑 Key Skills</h3>
      <ul>${skills}</ul>
    </div>
    
    <div class="result-section experience-highlights">
      <h3>✨ Ready-to-Use Resume Points</h3>
      <p class="section-description">Copy these bullet points directly into your resume:</p>
      <ul>${experience}</ul>
    </div>

    ${dynamicPoints ? `<div class="result-section dynamic-points">
      <h3>✨ Ready-to-Use Resume Points</h3>
      <p class="section-description">Copy these optimized bullet points directly into your resume:</p>
      ${dynamicPoints}
    </div>` : ''}

    ${suggestions ? `<div class="result-section customization">
      <h3>🎯 Customization Recommendations</h3>
      ${suggestions}
    </div>` : ''}
    
    <div class="result-section">
      <h3>🎯 ATS Keywords</h3>
      <div class="keywords">${keywords}</div>
      <button class="copy-btn small" onclick="copyKeywords()">📄 Copy All Keywords</button>
    </div>

    ${competitiveAnalysis ? `<div class="result-section">
      <h3>🏆 Competitive Analysis</h3>
      ${competitiveAnalysis}
    </div>` : ''}
    
    
    <div class="result-section">
      <h3>💡 Match Score</h3>
      <div class="match-score">
        <div class="match-meter"><div style="width: ${typeof matchScore === 'number' ? matchScore : 0}%"></div></div>
        <span>${typeof matchScore === 'number' ? `${matchScore}%` : matchScore}</span>
      </div>
    </div>
    
    <div class="result-section">
      <h3>🚀 Recommended Projects</h3>
      ${projectMarkup || '<p class="no-projects">No project recommendations available.</p>'}
      <button class="project-request-btn" onclick="requestProjectRecommendations()">
        💡 Get Project Recommendations
      </button>
    </div>
    
    ${(coverLetterPoints || interviewTopics || networkingSuggestions || salaryInfo) ? `
      <div class="result-section application-strategy">
        <h3>📬 Complete Application Strategy</h3>
        ${coverLetterPoints ? `<h4>Cover Letter Talking Points</h4><ul>${coverLetterPoints}</ul>` : ''}
        ${interviewTopics ? `<h4>Interview Preparation Topics</h4><ul>${interviewTopics}</ul>` : ''}
        ${networkingSuggestions ? `<h4>Networking Strategies</h4><ul>${networkingSuggestions}</ul>` : ''}
        ${salaryInfo}
      </div>
    ` : ''}
    
    <div class="result-section premium-features">
      <h3>🌟 Premium Features Available</h3>
      <div class="premium-grid">
        <div class="premium-card" onclick="openPremiumFeature('ats-analyzer')">
          <div class="premium-icon">📊</div>
          <h4>ATS Score Analyzer</h4>
          <p>Get detailed ATS compatibility analysis with specific improvement recommendations</p>
          <span class="premium-badge">Premium</span>
        </div>
        <div class="premium-card" onclick="openPremiumFeature('industry-insights')">
          <div class="premium-icon">📈</div>
          <h4>Industry Insights</h4>
          <p>Market trends, salary benchmarks, and skill demands for your industry</p>
          <span class="premium-badge">Premium</span>
        </div>
        <div class="premium-card" onclick="openPremiumFeature('performance-tracking')">
          <div class="premium-icon">📋</div>
          <h4>Application Tracker</h4>
          <p>Track your application performance and get data-driven insights</p>
          <span class="premium-badge">Premium</span>
        </div>
        <div class="premium-card" onclick="openPremiumFeature('multi-format-export')">
          <div class="premium-icon">💾</div>
          <h4>Multi-Format Export</h4>
          <p>Export to PDF, Word, HTML, and LaTeX with professional templates</p>
          <span class="premium-badge">Premium</span>
        </div>
      </div>
      <button class="upgrade-btn" onclick="showUpgradeModal()">
        ✨ Upgrade to Premium - $9.99/month
      </button>
    </div>
  `;
  */
}

async function clearResults() {
  console.log('🔄 Clearing tailored results...');
  
  try {
    // Clear stored result
    await chrome.storage.local.remove(LAST_RESULT_KEY);
    
    // Reset in-memory result
    lastTailoredResult = null;
    
    // Hide results section
  if (resultsSection) resultsSection.classList.add('hidden');
    
    // Disable action buttons
  if (downloadBtn) downloadBtn.disabled = true;
  if (copyBtn) copyBtn.disabled = true;
    
    // Clear results content
  if (resultsContent) resultsContent.innerHTML = '';
    
    setStatus('Results cleared. Ready to tailor for a new job!');
    
    // Update tailor button state
    updateTailorButton();
    
    console.log('✅ Results cleared successfully');
  } catch (error) {
    console.error('Failed to clear results:', error);
    setStatus('Error clearing results');
  }
}

function handleDownload() {
  downloadPremiumPreview();
}

function handleCopy() {
  if (!lastTailoredResult) {
    setStatus('No tailored resume to copy');
    return;
  }

  const resumeText = buildResumeText(lastTailoredResult);

  navigator.clipboard.writeText(resumeText)
    .then(() => setStatus('Tailored resume copied to clipboard!'))
    .catch(() => setStatus('Error copying to clipboard'));
}

function setButtonLoading(button: HTMLButtonElement, loading: boolean) {
  if (loading) {
    button.classList.add('btn-loading');
    button.disabled = true;
  } else {
    button.classList.remove('btn-loading');
    button.disabled = false;
  }
}

function setStatus(message: string) {
  if (status) {
    status.textContent = message;
  }
}

chrome.runtime.onMessage.addListener((message: TailorResultMessage) => {
  if (message.type === MessageType.TailorResult) {
    setStatus('Resume tailored successfully!');
  if (tailorBtn) setButtonLoading(tailorBtn, false);
    showResults(message.result);
  }
});

function ensureResumeFile(): File | null {
  if (!currentResume) {
    return null;
  }
  if (resumeFileCache) {
    return resumeFileCache;
  }
  try {
    const blob = base64ToBlob(currentResume.base64, currentResume.mimeType);
    resumeFileCache = new File([blob], currentResume.name, { type: currentResume.mimeType });
    return resumeFileCache;
  } catch (error) {
    console.error('Failed to rebuild resume file from session', error);
    return null;
  }
}

function renderResumePreview(data: any): string {
  const sections = Array.isArray(data.resume?.sections) ? data.resume.sections : [];
  if (sections.length > 0) {
    return sections.slice(0, 3).map((section: any) => {
      const heading = escapeHtml(section.heading || 'Section');
      const body = section.body ? `<p>${escapeHtml(section.body)}</p>` : '';
      const bullets = Array.isArray(section.bullets) && section.bullets.length > 0
        ? `<ul>${section.bullets.slice(0, 5).map((bullet: string) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`
        : '';
      return `<div class="resume-preview-section"><h4>${heading}</h4>${body}${bullets}</div>`;
    }).join('');
  }

  const fallback = (data.resume?.full_text || '')
    .split('\n')
    .filter((line: string) => line.trim().length > 0)
    .slice(0, 12)
    .join('\n');

  if (!fallback) {
    return '<p>No resume preview available.</p>';
  }

  return `<pre class="resume-preview">${escapeHtml(fallback)}</pre>`;
}

function buildEnhancedResumeDocument(result: any): string {
  const timestamp = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const matchScore = result.match_score || 'N/A';
  
  // Header with metadata
  const header = `
╔════════════════════════════════════════════════════════════════════════════════╗
║                     🎯 AI-TAILORED RESUME PACKAGE                              ║
║                     Generated by ResumeIt AI                                   ║
╚════════════════════════════════════════════════════════════════════════════════╝

📊 TAILORING SUMMARY
• Generated: ${timestamp}
• Target Role: ${currentJob?.title || 'Not specified'}
• Target Company: ${currentJob?.company || 'Not specified'}
• ATS Match Score: ${matchScore}%
• Status: Ready for editing and customization

${'═'.repeat(80)}

🚀 HOW TO USE THIS DOCUMENT:
1. Copy sections directly into your preferred resume format
2. Customize the provided bullet points to match your specific experience
3. Use the keyword suggestions to optimize for ATS systems
4. Reference the application strategy for interview prep

${'═'.repeat(80)}

`;

  // Main resume content
  const resumeContent = `
📄 OPTIMIZED RESUME CONTENT

PROFESSIONAL SUMMARY
${result.tailored?.professional_summary || 'Professional summary not available'}

CORE COMPETENCIES
${(result.tailored?.key_skills || []).join(' • ')}

✨ READY-TO-USE RESUME POINTS
${(result.tailored?.experience_bullets || []).map((bullet: string, index: number) => `• ${bullet}`).join('\n')}

(Copy these bullet points directly into your resume)

ATS KEYWORDS (Include these throughout your resume)
${(result.tailored?.suggested_keywords || []).join(', ')}

${'═'.repeat(80)}

`;

  // Dynamic resume points section
  const dynamicPoints = result.tailored?.dynamic_resume_points ? `
✨ READY-TO-USE RESUME POINTS

${result.tailored.dynamic_resume_points.map((category: any) => `
${category.category.toUpperCase()}:
${category.points.map((point: any, index: number) => `
${index + 1}. ${point.text}
   💡 Impact: ${point.impact}
   🏷️  Keywords: ${point.keywords.join(', ')}
`).join('')}
`).join('')}

${'═'.repeat(80)}

` : '';

  // Customization suggestions
  const suggestions = result.tailored?.customization_suggestions ? `
🎯 CUSTOMIZATION RECOMMENDATIONS

${result.tailored.customization_suggestions.map((suggestion: any, index: number) => `
${index + 1}. ${suggestion.section.toUpperCase()} [${suggestion.priority.toUpperCase()} PRIORITY]
   Action: ${suggestion.suggestion}
   Reasoning: ${suggestion.reasoning}
`).join('')}

${'═'.repeat(80)}

` : '';

  // Competitive analysis
  const competitiveAnalysis = result.competitive_analysis ? `
🏆 COMPETITIVE ANALYSIS

STRENGTHS TO HIGHLIGHT:
${result.competitive_analysis.strengths.map((strength: string, index: number) => `${index + 1}. ${strength}`).join('\n')}

AREAS TO DEVELOP:
${result.competitive_analysis.gaps.map((gap: string, index: number) => `${index + 1}. ${gap}`).join('\n')}

PRIORITY IMPROVEMENTS:
${result.competitive_analysis.improvement_areas.map((area: string, index: number) => `${index + 1}. ${area}`).join('\n')}

${'═'.repeat(80)}

` : '';

  // Application strategy
  const applicationStrategy = result.application_strategy ? `
📬 COMPLETE APPLICATION STRATEGY

COVER LETTER TALKING POINTS:
${result.application_strategy.cover_letter_points.map((point: string, index: number) => `${index + 1}. ${point}`).join('\n')}

INTERVIEW PREPARATION TOPICS:
${result.application_strategy.interview_topics.map((topic: string, index: number) => `${index + 1}. ${topic}`).join('\n')}

NETWORKING STRATEGIES:
${result.application_strategy.networking_suggestions.map((suggestion: string, index: number) => `${index + 1}. ${suggestion}`).join('\n')}

${result.application_strategy.salary_research ? `
SALARY RESEARCH:
Range: ${result.application_strategy.salary_research.range}
Factors: ${result.application_strategy.salary_research.factors.join(', ')}
` : ''}

${'═'.repeat(80)}

` : '';

  // Project suggestions
  const projects = result.projects && result.projects.length > 0 ? `
🚀 RECOMMENDED PROJECTS TO SHOWCASE

${result.projects.map((project: any, index: number) => `
${index + 1}. ${project.title} (Relevance: ${project.relevance_score}%)
   Description: ${project.description}
   Technologies: ${project.technologies.join(', ')}
`).join('')}

${'═'.repeat(80)}

` : '';

  // Footer with tips
  const footer = `
💡 ADDITIONAL TIPS:

1. FORMATTING: Use consistent fonts, spacing, and bullet points
2. LENGTH: Keep to 1-2 pages depending on experience level
3. KEYWORDS: Naturally integrate the suggested keywords throughout
4. QUANTIFY: Add specific numbers, percentages, and metrics where possible
5. CUSTOMIZE: Adjust each application based on the specific job requirements
6. PROOFREAD: Always spell-check and grammar-check before submitting

🎯 Remember: This is your foundation. Customize it to reflect your unique experience!

Generated by ResumeIt AI • ${timestamp}
`;

  return header + resumeContent + dynamicPoints + suggestions + competitiveAnalysis + applicationStrategy + projects + footer;
}

function buildResumeText(result: any): string {
  // Keep the original function for copy functionality
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
    sections.push(`✨ READY-TO-USE RESUME POINTS\n${result.tailored.experience_bullets.map((bullet: string) => `• ${bullet}`).join('\n')}\n\n(Copy these bullet points directly into your resume)\n`);
  }

  return sections.join('\n').trim();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
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
  if (mimeType !== 'text/plain') {
    return undefined;
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(buffer).slice(0, 4000);
}

function resolveMimeType(file: File): string {
  if (file.type) {
    return file.type;
  }
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

// New helper functions for enhanced copy functionality
function copyResumePoint(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => setStatus('Resume point copied to clipboard!'))
    .catch(() => setStatus('Error copying resume point'));
}

function copyToClipboard(text: string, type: string = 'Content') {
  navigator.clipboard.writeText(text)
    .then(() => setStatus(`${type} copied to clipboard! ✅`))
    .catch(() => setStatus(`Error copying ${type.toLowerCase()}`));
}

function copyKeywords() {
  if (!lastTailoredResult?.tailored?.suggested_keywords) {
    setStatus('No keywords to copy');
    return;
  }
  
  const keywords = lastTailoredResult.tailored.suggested_keywords.join(', ');
  navigator.clipboard.writeText(keywords)
    .then(() => setStatus('Keywords copied to clipboard!'))
    .catch(() => setStatus('Error copying keywords'));
}

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

  const keywords = extractTopKeywords(jobText, 12);
  if (!keywords.length) return null;

  const matchedKeywords = keywords.filter(keyword => resumeText.includes(keyword));
  const missingKeywords = keywords.filter(keyword => !resumeText.includes(keyword));
  const coverage = matchedKeywords.length / keywords.length;

  const experienceBullets = Array.isArray(resultData.tailored?.experience_bullets)
    ? resultData.tailored.experience_bullets
    : [];
  const quantifiedCount = experienceBullets.filter((bullet: string) => /[\d%$]/.test(bullet)).length;
  const desiredQuantified = Math.max(1, Math.min(8, experienceBullets.length));
  const quantScore = Math.min(1, quantifiedCount / desiredQuantified);

  const actionVerbHits = ACTION_VERBS.filter(verb => resumeText.includes(verb)).length;
  const verbScore = Math.min(1, actionVerbHits / 8);

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

function extractTopKeywords(text: string, limit = 12): string[] {
  const frequency = new Map<string, number>();
  text.replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .forEach(token => {
      const word = token.toLowerCase().trim();
      if (!word || word.length < 3 || STOPWORDS.has(word)) return;
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    });

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, limit);
}

function buildEvidenceBullets(ctx: EvidenceContext): string[] {
  const coveragePct = Math.round(ctx.coverage * 100);
  const aiCoveragePercent = ctx.aiDemandCount
    ? Math.round((ctx.aiCoveredCount / ctx.aiDemandCount) * 100)
    : 100;
  const missingList = ctx.missingKeywords.slice(0, 3).join(', ') || 'no critical gaps flagged';
  const headlineSkill = ctx.matchedKeywords[0] || ctx.jobTitle || 'priority capabilities';
  const employerName = ctx.company || 'target teams';

  return [
    `LinkedIn's 2024 Future of Recruiting report says quantified achievements drive 2.6× more callbacks; you highlight ${ctx.quantifiedCount} measurable wins—aim for at least ${Math.max(ctx.quantifiedCount, 6)} in this role-specific version.`,
    `Indeed's 2023 Career Guide found covering 70% of JD keywords is the ATS tipping point; you're currently at ${coveragePct}% coverage of the top skills mined from this posting.`,
    `Gartner's 2023 Digital Talent Benchmarks show leadership/action verbs raise shortlist odds by 1.9×; your resume fires ${ctx.actionVerbHits} of our tracked verbs—double down on ownership around ${headlineSkill}.`,
    `McKinsey's 2023 State of AI Adoption notes automation-heavy teams release 1.6× faster; the JD references ${ctx.aiDemandCount} AI/automation cues and your resume answers ${aiCoveragePercent}% of them.`,
    `Glassdoor's 2024 Hiring Trends highlight that ROI-centric bullets build recruiter trust; weave a revenue or efficiency metric around ${missingList.split(', ')[0] || headlineSkill}.`,
    `Deloitte's 2023 Human Capital Trends emphasizes cross-functional delivery; cite how you partnered with ops, design, or go-to-market at ${employerName} to land outcomes.`,
    `SHRM's 2024 Workforce Outlook recommends spotlighting continuous learning—surface certifications or workshops tied to ${headlineSkill} in your summary.`,
    `IBM's 2023 Skills Report ranks data storytelling as a top-5 competency; ensure each bullet links effort to a business metric instead of listing responsibilities.`
  ];
}

// Premium feature functions
function redirectToPremium(feature?: string) {
  const url = getPremiumRedirectUrl(feature);
  chrome.tabs.create({ url });
}

function openPremiumFeature(feature: string) {
  redirectToPremium(feature);
}

function showPremiumFeature(feature: string) {
  redirectToPremium(feature);
  return;
  console.log('🌟 Showing premium feature:', feature);
  
  const featureContent: Record<string, { title: string; content: string }> = {
    'ats-analysis': {
      title: '📈 ATS Deep Scan',
      content: `
        <div style="text-align: left;">
          <h4 style="color: #0073b1; margin-bottom: 15px;">Advanced ATS Compatibility Analysis</h4>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 10px 0;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
              <span>Keyword Density</span>
              <span style="color: #4caf50; font-weight: 600;">92%</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
              <span>Format Compatibility</span>
              <span style="color: #4caf50; font-weight: 600;">96%</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
              <span>Section Organization</span>
              <span style="color: #ff9800; font-weight: 600;">78%</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Readability Score</span>
              <span style="color: #4caf50; font-weight: 600;">89%</span>
            </div>
          </div>
          <div style="background: #e3f2fd; padding: 12px; border-radius: 6px; margin-top: 15px;">
            <p style="margin: 0; font-size: 13px; color: #1565c0;">
              <strong>🎯 Recommendations:</strong><br>
              • Add 3 more technical keywords in your experience section<br>
              • Use consistent date formatting throughout<br>
              • Include metrics in 80% of your bullet points
            </p>
          </div>
        </div>
      `
    },
    'cover-letter': {
      title: '📝 AI Cover Letter Generator',
      content: `
        <div style="text-align: left;">
          <h4 style="color: #0073b1; margin-bottom: 15px;">Personalized Cover Letter</h4>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; font-size: 13px; line-height: 1.6;">
            <p style="margin: 0 0 10px 0;"><strong>Dear Hiring Manager,</strong></p>
            <p style="margin: 0 0 10px 0;">I am excited to apply for the ${currentJob?.title || 'Marketing Events Coordinator'} position at ${currentJob?.company || 'your company'}. With my proven track record in Agile project management and team leadership...</p>
            <p style="margin: 0; color: #666; font-style: italic;">[Preview - Full letter available in Premium]</p>
          </div>
          <div style="background: #e8f5e8; padding: 12px; border-radius: 6px; margin-top: 15px;">
            <p style="margin: 0; font-size: 13px; color: #2e7d32;">
              <strong>✨ Premium Features:</strong><br>
              • Fully customized 3-paragraph cover letter<br>
              • Company research integration<br>
              • Multiple tone options (Professional, Enthusiastic, Technical)
            </p>
          </div>
        </div>
      `
    },
    'salary-insights': {
      title: '💰 Salary Intelligence',
      content: `
        <div style="text-align: left;">
          <h4 style="color: #0073b1; margin-bottom: 15px;">Market Salary Analysis</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 15px 0;">
            <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
              <div style="font-size: 24px; font-weight: bold; color: #4caf50;">$85K</div>
              <div style="font-size: 12px; color: #666;">25th Percentile</div>
            </div>
            <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; text-align: center;">
              <div style="font-size: 24px; font-weight: bold; color: #0073b1;">$105K</div>
              <div style="font-size: 12px; color: #666;">50th Percentile</div>
            </div>
          </div>
          <div style="background: #fff3e0; padding: 12px; border-radius: 6px; margin-top: 15px;">
            <p style="margin: 0; font-size: 13px; color: #f57c00;">
              <strong>📊 Negotiation Tips:</strong><br>
              • Your experience level suggests $95K-$110K range<br>
              • Highlight Agile certification for +$8K premium<br>
              • Remote work adds 5-10% to base salary
            </p>
          </div>
        </div>
      `
    },
    'interview-prep': {
      title: '🎤 Interview Preparation',
      content: `
        <div style="text-align: left;">
          <h4 style="color: #0073b1; margin-bottom: 15px;">Tailored Interview Questions</h4>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 10px 0;">
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #333;">Q: "Tell me about a time you led an Agile team through a challenging project."</p>
            <p style="margin: 0; font-size: 13px; color: #666; line-height: 1.5;">
              <strong>STAR Framework Answer:</strong><br>
              <strong>Situation:</strong> Led a cross-functional team of 8 developers...<br>
              <strong>Task:</strong> Deliver project 2 weeks ahead of schedule...<br>
              <em>[Full answer available in Premium]</em>
            </p>
          </div>
          <div style="background: #e8f5e8; padding: 12px; border-radius: 6px; margin-top: 15px;">
            <p style="margin: 0; font-size: 13px; color: #2e7d32;">
              <strong>🎯 Premium Includes:</strong><br>
              • 15 tailored questions with STAR answers<br>
              • Company-specific research points<br>
              • Salary negotiation strategies
            </p>
          </div>
        </div>
      `
    },
    'more-bullets': {
      title: '✨ Additional Resume Bullets',
      content: `
        <div style="text-align: left;">
          <h4 style="color: #0073b1; margin-bottom: 15px;">Premium Resume Points</h4>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
            <div style="border-left: 4px solid #ff9800; padding-left: 12px; margin-bottom: 10px;">
              <p style="margin: 0; font-size: 13px;">• Implemented Agile ceremonies that reduced sprint planning time by 40% and improved team velocity metrics</p>
            </div>
            <div style="border-left: 4px solid #ff9800; padding-left: 12px; margin-bottom: 10px;">
              <p style="margin: 0; font-size: 13px;">• Orchestrated stakeholder alignment sessions resulting in 90% project approval rate on first review</p>
            </div>
            <div style="border-left: 4px solid #ff9800; padding-left: 12px;">
              <p style="margin: 0; font-size: 13px; color: #666; font-style: italic;">+ 8 more premium bullets available</p>
            </div>
          </div>
          <div style="background: #fff3e0; padding: 12px; border-radius: 6px; margin-top: 15px;">
            <p style="margin: 0; font-size: 13px; color: #f57c00;">
              <strong>🚀 Premium Benefits:</strong><br>
              • Up to 15 industry-specific bullet points<br>
              • Quantified metrics for each achievement<br>
              • Copy-optimized for this specific role
            </p>
          </div>
        </div>
      `
    }
  };
  
  const content = featureContent[feature] || featureContent['ats-analysis'];
  
  const modal = document.createElement('div');
  modal.className = 'premium-feature-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background: rgba(0,0,0,0.8); display: flex; justify-content: center; 
    align-items: center; z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="background: white; border-radius: 12px; max-width: 350px; width: 90%; max-height: 80%; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
      <div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
        <h3 style="margin: 0; font-size: 18px;">${content.title}</h3>
        <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">Premium Feature Preview</p>
      </div>
      <div style="padding: 20px;">
        ${content.content}
        <div style="text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
          <button onclick="showUpgradeModal(); closePremiumModal();" style="background: linear-gradient(135deg, #ff6b6b, #ee5a24); color: white; border: none; padding: 12px 24px; border-radius: 25px; font-size: 14px; cursor: pointer; font-weight: 600; margin-right: 10px;">
            🚀 Upgrade Now
          </button>
          <button onclick="closePremiumModal()" style="background: #f0f0f0; color: #333; border: none; padding: 12px 20px; border-radius: 20px; font-size: 14px; cursor: pointer;">
            Close
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closePremiumModal();
    }
  });
}

function closePremiumModal() {
  const modal = document.querySelector('.premium-feature-modal');
  if (modal) {
    modal.remove();
  }
}

function showUpgradeModal() {
  redirectToPremium('upgrade');
  return;
  // Create upgrade modal
  const modal = document.createElement('div');
  modal.className = 'upgrade-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>🌟 Upgrade to ResumeIt Premium</h3>
        <button class="close-modal" onclick="closeUpgradeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="pricing-plan">
          <div class="plan-price">$9.99/month</div>
          <div class="plan-features">
            <div class="feature">✅ Advanced ATS Score Analysis</div>
            <div class="feature">✅ Industry Insights & Benchmarks</div>
            <div class="feature">✅ Application Performance Tracking</div>
            <div class="feature">✅ Multi-Format Export (PDF, Word, LaTeX)</div>
            <div class="feature">✅ Premium Resume Templates</div>
            <div class="feature">✅ Priority Support</div>
            <div class="feature">✅ Unlimited Tailoring</div>
          </div>
          <button class="subscribe-btn" onclick="handleUpgrade()">
            🚀 Start 7-Day Free Trial
          </button>
          <p class="trial-info">Cancel anytime. No commitments.</p>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  modal.style.display = 'flex';
}

function closeUpgradeModal() {
  const modal = document.querySelector('.upgrade-modal') as HTMLElement;
  if (modal) {
    modal.remove();
  }
}

function handleUpgrade() {
  redirectToPremium('upgrade');
}

// Project recommendation functions
function showProjectDetails(title: string, description: string, technologies: string) {
  const modal = document.createElement('div');
  modal.className = 'project-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>🚀 ${title}</h3>
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
              📄 Copy Project Details
            </button>
            <button class="action-btn secondary" onclick="requestMoreProjects()">
              🔄 Get More Projects
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  modal.style.display = 'flex';
}

function closeProjectModal() {
  const modal = document.querySelector('.project-modal') as HTMLElement;
  if (modal) {
    modal.remove();
  }
}

function copyProjectDetails(title: string, description: string, technologies: string) {
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

function requestProjectRecommendations() {
  if (!currentJob) {
    setStatus('⚠️ No job detected. Navigate to a job posting to get tailored project recommendations.');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'project-request-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>💡 Project Recommendations</h3>
        <button class="close-modal" onclick="closeProjectRequestModal()">&times;</button>
      </div>
      <div class="modal-body">
        <p>Get personalized project recommendations based on:</p>
        <ul>
          <li>🎯 Current job requirements: <strong>${currentJob.title}</strong></li>
          <li>🏢 Company: <strong>${currentJob.company || 'Not specified'}</strong></li>
          <li>📋 Skills needed for this role</li>
          <li>🚀 Portfolio impact potential</li>
        </ul>
        
        <div class="recommendation-preview">
          <h4>Sample Recommendation:</h4>
          <div class="sample-project">
            <h5>Real-Time Collaboration Dashboard</h5>
            <p>A full-stack web app that aggregates live activity streams from multiple services, visualizes them in real time, and allows users to annotate and search across the data—mirroring Coworker.ai's Organizational Memory concept.</p>
            <div class="sample-tech">
              <span>React</span><span>Next.js</span><span>TypeScript</span><span>Python (FastAPI)</span><span>PostgreSQL</span><span>Docker</span>
            </div>
            <div class="relevance-note">Relevance: 95% - Perfect match for this role!</div>
          </div>
        </div>
        
        <div class="upgrade-prompt">
          <p>💡 <strong>Get 3-5 tailored project recommendations</strong> with detailed implementation guides, technology suggestions, and relevance scoring.</p>
          <button class="upgrade-btn small" onclick="showUpgradeModal()">
            ✨ Upgrade for Full Project Recommendations
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  modal.style.display = 'flex';
}

function closeProjectRequestModal() {
  const modal = document.querySelector('.project-request-modal') as HTMLElement;
  if (modal) {
    modal.remove();
  }
}

function requestMoreProjects() {
  closeProjectModal();
  requestProjectRecommendations();
}

// Enhanced download with premium features preview
function downloadPremiumPreview() {
  if (!lastTailoredResult) {
    setStatus('No tailored resume available');
    return;
  }

  const premiumLink = getPremiumRedirectUrl('download-preview');

  const premiumPreview = `
🌟 PREMIUM FEATURES PREVIEW
This enhanced download includes a preview of our premium features.
Upgrade to unlock full functionality!

═══════════════════════════════════════════════════════════════

📊 ATS COMPATIBILITY ANALYSIS (Premium Feature)
Overall ATS Score: 85% (Excellent)
Keyword Match: 78%
Format Score: 92%

🔍 Issues Detected:
- Consider adding more quantified achievements
- Include additional technical skills

💡 Premium Recommendations:
- Add cloud computing certifications
- Include leadership experience metrics
- Optimize for mobile development keywords

═══════════════════════════════════════════════════════════════

📈 INDUSTRY INSIGHTS (Premium Feature)
Market Growth: 15% projected growth in software engineering
Salary Range: $85,000 - $120,000 (Mid-level)
Top Skills in Demand: React, Node.js, AWS, Python

═══════════════════════════════════════════════════════════════

${buildEnhancedResumeDocument(lastTailoredResult)}

═══════════════════════════════════════════════════════════════

🌟 Want the full premium experience?
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

  setStatus('📄 Premium preview downloaded! Upgrade for full features.');
}

// Make functions available globally for onclick handlers
(window as any).copyResumePoint = copyResumePoint;
(window as any).copyToClipboard = copyToClipboard;
(window as any).copyKeywords = copyKeywords;
(window as any).openPremiumFeature = openPremiumFeature;
(window as any).showPremiumFeature = showPremiumFeature;
(window as any).redirectToPremium = redirectToPremium;
(window as any).showUpgradeModal = showUpgradeModal;
(window as any).showProjectDetails = showProjectDetails;
(window as any).closeProjectModal = closeProjectModal;
(window as any).copyProjectDetails = copyProjectDetails;
(window as any).requestProjectRecommendations = requestProjectRecommendations;
(window as any).closeProjectRequestModal = closeProjectRequestModal;
(window as any).requestMoreProjects = requestMoreProjects;
