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

const uploadArea = document.getElementById('uploadArea') as HTMLElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const resumeStatus = document.getElementById('resumeStatus') as HTMLElement;
const tailorBtn = document.getElementById('tailorBtn') as HTMLButtonElement;
const aiAnalyzeBtn = document.getElementById('aiAnalyzeBtn') as HTMLButtonElement;
const resultsSection = document.getElementById('resultsSection') as HTMLElement;
const resultsContent = document.getElementById('resultsContent') as HTMLElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
const copyBtn = document.getElementById('copyBtn') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLElement;
const healthChip = document.getElementById('healthChip') as HTMLButtonElement | null;
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

// Job detection elements
const jobDetection = document.getElementById('jobDetection') as HTMLElement;
const noJobDetected = document.getElementById('noJobDetected') as HTMLElement;
const jobDetected = document.getElementById('jobDetected') as HTMLElement;
const detectedJobTitle = document.getElementById('detectedJobTitle') as HTMLElement;
const detectedCompany = document.getElementById('detectedCompany') as HTMLElement;

// Initialise popup state
document.addEventListener('DOMContentLoaded', async () => {
  if (!IS_AI_ANALYSIS_ENABLED) {
    aiAnalyzeBtn.style.display = 'none';
  }

  if (healthChip) {
    healthChip.addEventListener('click', () => checkBackendHealth(true));
    checkBackendHealth(false);
  }

  const authenticated = await checkAuthStatus();
  isAuthenticated = authenticated;
  
  if (isAuthenticated) {
    initializeUpload();
    initializeButtons();
    await loadPersistedResume();
    await hydrateLastResult();
    startJobDetection(); // Start polling for job detection
    updateTailorButton();
  }
});

async function checkBackendHealth(manual: boolean) {
  if (!healthChip) return;
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
  if (!healthChip) return;
  healthChip.dataset.state = state;
  const textNode = healthChip.querySelector('.health-text');
  if (textNode) {
    textNode.textContent = text;
  }
}

// Authentication functions
async function checkAuthStatus(): Promise<boolean> {
  console.log('🔍 Checking authentication status...');
  
  try {
    // First, check if we have cached auth data
    const cached = await chrome.storage.local.get(AUTH_CACHE_KEY);
    
    if (cached[AUTH_CACHE_KEY] && cached[AUTH_CACHE_KEY].authenticated && cached[AUTH_CACHE_KEY].user) {
      console.log('✅ Found cached auth, showing UI immediately');
      // Use cached data immediately for faster UI
      userAuth = cached[AUTH_CACHE_KEY];
      isAuthenticated = true;
      showAuthenticatedUI(userAuth.user);
      
      // Verify in background (don't block UI)
      // Use setTimeout to avoid blocking the UI thread
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
        showLoginPrompt();
        return false;
      } else {
        // Cache the auth data
        userAuth = data;
        isAuthenticated = true;
        await chrome.storage.local.set({ [AUTH_CACHE_KEY]: data });
        showAuthenticatedUI(data.user);
        return true;
      }
    } else {
      console.log('❌ Server returned non-OK status:', response.status);
      await chrome.storage.local.remove(AUTH_CACHE_KEY);
      isAuthenticated = false;
      showLoginPrompt();
      return false;
    }
  } catch (error) {
    console.error('⚠️ Auth check failed:', error);
    // If we have cache, still show authenticated UI (offline mode)
    const cached = await chrome.storage.local.get(AUTH_CACHE_KEY);
    if (cached[AUTH_CACHE_KEY]?.user) {
      console.log('📦 Using cached auth (offline mode)');
      userAuth = cached[AUTH_CACHE_KEY];
      isAuthenticated = true;
      showAuthenticatedUI(userAuth.user);
      return true;
    }
    console.log('❌ No cache available, showing login');
    isAuthenticated = false;
    showLoginPrompt();
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
        console.log('⚠️ Background verification: Session expired');
        // Session expired - only clear cache and state
        // DO NOT show login prompt if user is actively using the extension
        await chrome.storage.local.remove(AUTH_CACHE_KEY);
        userAuth = null;
        isAuthenticated = false;
        
        // Only show login if we're not already showing authenticated UI
        const authInfo = document.querySelector('.auth-info');
        if (!authInfo) {
          console.log('📋 No auth UI found, showing login prompt');
          showLoginPrompt();
        } else {
          console.log('👤 Auth UI exists, not showing login (user still has UI)');
        }
      }
    } else if (response.status === 401) {
      console.log('🚫 Background verification: 401 Unauthorized');
      // Only act if we're not already showing authenticated UI
      const authInfo = document.querySelector('.auth-info');
      if (!authInfo) {
        await chrome.storage.local.remove(AUTH_CACHE_KEY);
        userAuth = null;
        isAuthenticated = false;
        showLoginPrompt();
      }
    }
  } catch (error) {
    console.log('📡 Background verification failed (offline/network error):', error);
    // Keep using cached data if offline - don't change auth state
    // This allows the extension to work offline
  }
}

function showLoginPrompt() {
  console.log('🔐 Showing login prompt');
  isAuthenticated = false;
  
  // Check if we're already showing authenticated UI
  const authInfo = document.querySelector('.auth-info');
  if (authInfo) {
    console.log('⚠️ Auth info already visible, not showing login prompt');
    return; // Don't show login if already authenticated
  }
  
  // Remove any existing auth section
  const existingAuthSection = document.querySelector('.auth-section');
  if (existingAuthSection) {
    console.log('📋 Removing existing auth section');
    existingAuthSection.remove();
  }
  
  const authSection = document.createElement('div');
  authSection.className = 'auth-section';
  authSection.id = 'authSection';
  authSection.innerHTML = `
    <div class="auth-prompt">
      <h3>🔐 Sign in to continue</h3>
      <p>Sign in with Google to start tailoring your resumes</p>
      <button id="googleLoginBtn" class="google-login-btn">
        <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAxOCAxOCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj4KPHBhdGggZD0iTTE3LjY0IDkuMjA0NTVjMC0uNjM5LS4wNTctMS4yNTItLjE2NC0xLjg0MUg5djMuNDgxaDQuODQ0Yy0uMjA5IDEuMTI1LS44NDMgMi4wNzgtMS43OTYgMi43MTN2Mi4yNTloMi45MDhjMS43MjgtMS4zMDUgMi43MjUtMy4yMzMgMi43MjUtNS41MjN6Ii8+CjxwYXRoIGZpbGw9IiM0Mjg1RjQiIGQ9Ik05IDE4YzIuNDMgMCA0LjQ2Ny0uODA2IDUuOTU2LTIuMTgybC0yLjkwOC0yLjI1OWMtLjgwNi41NzctMS44NzEuOTMtMy4wNDguOTNDNi42OSAxNC40ODQgNS4wMjMgMTMuMzM2IDQuODMgMTIuMjI0SDFWMTUuNmMxLjUgMi42MTQgNC4yNjYgNCAzIDYuNTU0IDEwIDEweiIvPgo8cGF0aCBmaWxsPSIjMzRBODUzIiBkPSJNNCAxMlY2LjIyNkg3LjIyNmMuMzg1IDAtLjQzIDEuMjI1LS40IDIuNzQ2cy0uNzEyIDIuNzUtMS42NDcgMy42MjJMMVYxMHptMC00LjAwNGMwLS4yMSAwLS40MiAxLS42Mk00LjAzMyA2LjY5NmMuOTU5LS45NCAyLjU0LTEuNjk3IDMuOTY3LTEuNjk3IDEuMzE1IDAgMi40LjQ3IDMuMjggMS4zNzZsMS4yMS0xLjIxQzEzLjUgMy43MjUgMTEuNDcgM0g5IDMgNy4zNiAzIDUuOTU2IDRmNUw0LjAzMyA2LjY5NnoiLz4KPHBhdGggZmlsbD0iI0VBNDMzNSIgZD0iTTkgMy41ODJjMS4zNjEgMCAyLjU4Ni40ODkgMy41NTIgMS40MzdsMi44NC0yLjg0QzE0LjAzNS0uMjU2IDExLjcxMC0xIDktMSA1LjkyNi0xIDIuOTI2IDEuNzI2IDEgNS43NGwyLjkxIDIuMjM3QzQuNjkyIDUuNzE2IDYuNjk2IDMuNTgyIDkgMy41ODJ6Ii8+CjwvZz4KPC9zdmc+">
        Continue with Google
      </button>
      <p class="auth-note">Free: 5 tailorings/month • Premium: Unlimited + ATS analysis</p>
    </div>
  `;
  
  const app = document.getElementById('app') as HTMLElement;
  app.appendChild(authSection);
  
  // Add event listener for the login button
  const googleLoginBtn = document.getElementById('googleLoginBtn') as HTMLButtonElement;
  googleLoginBtn.addEventListener('click', loginWithGoogle);
  
  // Hide other sections
  uploadArea.style.display = 'none';
  resultsSection.style.display = 'none';
  jobDetection.style.display = 'none';
}

function showAuthenticatedUI(user: any) {
  console.log('👤 Showing authenticated UI for:', user.name);
  isAuthenticated = true;
  
  // Remove login section if it exists
  const authSection = document.getElementById('authSection');
  if (authSection) {
    console.log('📋 Removing login section');
    authSection.remove();
  }
  
  // Check if auth info already exists - don't duplicate
  const existingAuthInfo = document.querySelector('.auth-info');
  if (existingAuthInfo) {
    console.log('✅ Auth UI already exists, skipping');
    // Make sure upload area is visible
    uploadArea.style.display = 'block';
    jobDetection.style.display = 'block';
    return; // Don't create duplicate auth UI
  }
  
  const authInfo = document.createElement('div');
  authInfo.className = 'auth-info';
  authInfo.innerHTML = `
    <div class="user-info">
      <img src="${user.picture || ''}" alt="${user.name}" class="user-avatar">
      <div class="user-details">
        <span class="user-name">${user.name}</span>
        <span class="user-plan">${user.subscription?.plan || 'free'} plan</span>
      </div>
      <button class="logout-btn" id="logoutBtn">Logout</button>
    </div>
  `;
  
  const app = document.getElementById('app') as HTMLElement;
  app.insertBefore(authInfo, app.firstChild);
  
  // Add logout button event listener
  const logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement;
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
  
  // Show main sections
  uploadArea.style.display = 'block';
  jobDetection.style.display = 'block';
}

function loginWithGoogle() {
  const googleLoginBtn = document.getElementById('googleLoginBtn') as HTMLButtonElement;
  if (googleLoginBtn) {
    googleLoginBtn.disabled = true;
    googleLoginBtn.textContent = 'Signing in...';
  }
  
  // Use Chrome's identity API for OAuth
  chrome.identity.getAuthToken({ interactive: true }, async (token) => {
    if (chrome.runtime.lastError) {
      console.error('Authentication failed:', chrome.runtime.lastError);
      setStatus('Authentication failed. Please try again.');
      if (googleLoginBtn) {
        googleLoginBtn.disabled = false;
        googleLoginBtn.innerHTML = '<img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAxOCAxOCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj4KPHBhdGggZD0iTTE3LjY0IDkuMjA0NTVjMC0uNjM5LS4wNTctMS4yNTItLjE2NC0xLjg0MUg5djMuNDgxaDQuODQ0Yy0uMjA5IDEuMTI1LS44NDMgMi4wNzgtMS43OTYgMi43MTN2Mi4yNTloMi45MDhjMS43MjgtMS4zMDUgMi43MjUtMy4yMzMgMi43MjUtNS41MjN6Ii8+CjxwYXRoIGZpbGw9IiM0Mjg1RjQiIGQ9Ik05IDE4YzIuNDMgMCA0LjQ2Ny0uODA2IDUuOTU2LTIuMTgybC0yLjkwOC0yLjI1OWMtLjgwNi41NzctMS44NzEuOTMtMy4wNDguOTNDNi42OSAxNC40ODQgNS4wMjMgMTMuMzM2IDQuODMgMTIuMjI0SDFWMTUuNmMxLjUgMi42MTQgNC4yNjYgNCAzIDYuNTU0IDEwIDEweiIvPgo8cGF0aCBmaWxsPSIjMzRBODUzIiBkPSJNNCAxMlY2LjIyNkg3LjIyNmMuMzg1IDAtLjQzIDEuMjI1LS40IDIuNzQ2cy0uNzEyIDIuNzUtMS42NDcgMy42MjJMMVYxMHptMC00LjAwNGMwLS4yMSAwLS40MiAxLS42Mk00LjAzMyA2LjY5NmMuOTU5LS45NCAyLjU0LTEuNjk3IDMuOTY3LTEuNjk3IDEuMzE1IDAgMi40LjQ3IDMuMjggMS4zNzZsMS4yMS0xLjIxQzEzLjUgMy43MjUgMTEuNDcgM0g5IDMgNy4zNiAzIDUuOTU2IDRmNUw0LjAzMyA2LjY5NnoiLz4KPHBhdGggZmlsbD0iI0VBNDMzNSIgZD0iTTkgMy41ODJjMS4zNjEgMCAyLjU4Ni40ODkgMy41NTIgMS40MzdsMi44NC0yLjg0QzE0LjAzNS0uMjU2IDExLjcxMC0xIDktMSA1LjkyNi0xIDIuOTI2IDEuNzI2IDEgNS43NGwyLjkxIDIuMjM3QzQuNjkyIDUuNzE2IDYuNjk2IDMuNTgyIDkgMy41ODJ6Ii8+CjwvZz4KPC9zdmc+">Continue with Google';
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
          
          // Cache auth data for persistence
          await chrome.storage.local.set({ [AUTH_CACHE_KEY]: authData });
          
          showAuthenticatedUI(authData.user);
          setStatus('Successfully signed in!');
          
          // Initialize app features after successful login
          initializeUpload();
          initializeButtons();
          await loadPersistedResume();
          await hydrateLastResult();
          startJobDetection();
          updateTailorButton();
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Backend authentication failed' }));
          throw new Error(errorData.error || 'Backend authentication failed');
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        setStatus(`Authentication failed: ${error instanceof Error ? error.message : 'Please try again.'}`);
        if (googleLoginBtn) {
          googleLoginBtn.disabled = false;
          googleLoginBtn.innerHTML = '<img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAxOCAxOCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj4KPHBhdGggZD0iTTE3LjY0IDkuMjA0NTVjMC0uNjM5LS4wNTctMS4yNTItLjE2NC0xLjg0MUg5djMuNDgxaDQuODQ0Yy0uMjA5IDEuMTI1LS44NDMgMi4wNzgtMS43OTYgMi43MTN2Mi4yNTloMi45MDhjMS43MjgtMS4zMDUgMi43MjUtMy4yMzMgMi43MjUtNS41MjN6Ii8+CjxwYXRoIGZpbGw9IiM0Mjg1RjQiIGQ9Ik05IDE4YzIuNDMgMCA0LjQ2Ny0uODA2IDUuOTU2LTIuMTgybC0yLjkwOC0yLjI1OWMtLjgwNi41NzctMS44NzEuOTMtMy4wNDguOTNDNi42OSAxNC40ODQgNS4wMjMgMTMuMzM2IDQuODMgMTIuMjI0SDFWMTUuNmMxLjUgMi42MTQgNC4yNjYgNCAzIDYuNTU0IDEwIDEweiIvPgo8cGF0aCBmaWxsPSIjMzRBODUzIiBkPSJNNCAxMlY2LjIyNkg3LjIyNmMuMzg1IDAtLjQzIDEuMjI1LS40IDIuNzQ2cy0uNzEyIDIuNzUtMS42NDcgMy42MjJMMVYxMHptMC00LjAwNGMwLS4yMSAwLS40MiAxLS42Mk00LjAzMyA2LjY5NmMuOTU5LS45NCAyLjU0LTEuNjk3IDMuOTY3LTEuNjk3IDEuMzE1IDAgMi40LjQ3IDMuMjggMS4zNzZsMS4yMS0xLjIxQzEzLjUgMy43MjUgMTEuNDcgM0g5IDMgNy4zNiAzIDUuOTU2IDRmNUw0LjAzMyA2LjY5NnoiLz4KPHBhdGggZmlsbD0iI0VBNDMzNSIgZD0iTTkgMy41ODJjMS4zNjEgMCAyLjU4Ni40ODkgMy41NTIgMS40MzdsMi44NC0yLjg0QzE0LjAzNS0uMjU2IDExLjcxMC0xIDktMSA1LjkyNi0xIDIuOTI2IDEuNzI2IDEgNS43NGwyLjkxIDIuMjM3QzQuNjkyIDUuNzE2IDYuNjk2IDMuNTgyIDkgMy41ODJ6Ii8+CjwvZz4KPC9zdmc+">Continue with Google';
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

  fileInput.addEventListener('change', handleFileSelect);

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', handleDrop);
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  
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
  const debugInfo = document.getElementById('debugInfo') as HTMLElement;
  
  if (job && job.title && job.company) {
    // Show job detected
    noJobDetected.style.display = 'none';
    jobDetected.style.display = 'flex';
    detectedJobTitle.textContent = job.title;
    detectedCompany.textContent = job.company;
    jobDetection.classList.add('active');
    
    // Update tailor button text to be more dynamic
    tailorBtn.innerHTML = '⚡ Tailor for This Job';
    
    // Update debug info
    if (debugInfo) {
      debugInfo.textContent = `✅ Domain: ${job.source} | Desc: ${job.description?.length || 0} chars`;
    }
  } else {
    // Show no job detected
    noJobDetected.style.display = 'flex';
    jobDetected.style.display = 'none';
    jobDetection.classList.remove('active');
    
    // Update tailor button text
    tailorBtn.innerHTML = '🔍 Find a Job First';
    
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

  tailorBtn.addEventListener('click', handleTailorJob);
  if (IS_AI_ANALYSIS_ENABLED) {
    aiAnalyzeBtn.addEventListener('click', handleAIAnalysis);
  }
  downloadBtn.addEventListener('click', handleDownload);
  copyBtn.addEventListener('click', handleCopy);
  
  // Initialize refresh button
  const refreshBtn = document.getElementById('refreshResultsBtn') as HTMLButtonElement;
  if (refreshBtn) {
    refreshBtn.addEventListener('click', clearResults);
  }
  
  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });
}

async function loadPersistedResume() {
  try {
    const stored = await resumeStorage.get(RESUME_SESSION_KEY);
    if (stored[RESUME_SESSION_KEY]) {
      currentResume = stored[RESUME_SESSION_KEY] as ResumeSessionData;
      resumeFileCache = null; // rebuild lazily from base64
      showResumeStatus(`✓ ${currentResume.name} (${formatBytes(currentResume.size)}) ready for this session`, 'success', currentResume.textPreview);
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
      downloadBtn.disabled = false;
      copyBtn.disabled = false;
      setStatus('Loaded your most recent tailored resume.');
    } else {
      lastTailoredResult = null;
      resultsSection.classList.add('hidden');
      downloadBtn.disabled = true;
      copyBtn.disabled = true;
      setStatus('Ready to tailor your resume!');
    }
  } catch (error) {
    console.error('Failed to load cached tailoring result', error);
    lastTailoredResult = null;
    resultsSection.classList.add('hidden');
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
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

    showResumeStatus(`✓ ${record.name} (${formatBytes(record.size)}) saved for this session`, 'success', record.textPreview);
    updateTailorButton();
  } catch (error) {
    console.error('Failed to process resume upload', error);
    showResumeStatus('Error processing file', 'error');
  } finally {
    fileInput.value = '';
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
    showResumeStatus('Please select a PDF, DOC, DOCX, or TXT file', 'error');
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
  const tailorSection = document.getElementById('tailorSection') as HTMLElement;

  if (currentResume) {
    tailorSection.classList.remove('hidden');
    
    // Check if job is detected
    if (currentJob && currentJob.title) {
      tailorBtn.disabled = false;
    } else {
      tailorBtn.disabled = true;
    }
  } else {
    tailorBtn.disabled = true;
    tailorSection.classList.add('hidden');
  }
}

function handleTailorJob() {
  if (!currentResume) {
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
  setButtonLoading(aiAnalyzeBtn, true);

  void analyzeResumeWithAI().finally(() => {
    setButtonLoading(aiAnalyzeBtn, false);
  });
}

async function tailorResume() {
  if (!currentResume || !currentJob) {
    setStatus('Missing resume or job data');
    setButtonLoading(tailorBtn, false);
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

    console.log('🚀 Sending tailoring request...');
    
    const response = await fetch(getApiUrl('/api/v1/analyze-job'), {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });

    console.log('📥 Response status:', response.status);

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const errorDetail = errorPayload?.detail || errorPayload?.error || response.statusText;
      
      console.error('❌ API Error:', {
        status: response.status,
        error: errorPayload?.error,
        detail: errorPayload?.detail
      });
      
      // Handle specific HTTP status codes
      if (response.status === 401) {
        console.log('⚠️ 401 Unauthorized - Checking auth status...');
        
        // Clear cached auth since it's no longer valid
        await chrome.storage.local.remove(AUTH_CACHE_KEY);
        
        // Wait a moment for session cookie to propagate
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verify session is actually established
        const authCheck = await fetch(getApiUrl('/api/v1/auth/status'), {
          credentials: 'include',
          cache: 'no-cache'
        });
        
        if (authCheck.ok) {
          const authData = await authCheck.json();
          if (authData.authenticated) {
            console.log('✅ Session is valid after waiting - you can retry');
            throw new Error('🔄 Session was still connecting. Please try again.');
          }
        }
        
        console.log('❌ Session invalid - need to re-authenticate');
        isAuthenticated = false;
        userAuth = null;
        
        throw new Error('🔐 Session expired (backend restarted). Please sign in again.');
      }
      
      if (response.status === 429) {
        throw new Error('⏱️ Rate limit exceeded. Please wait a moment before trying again.');
      }
      
      if (response.status === 503) {
        throw new Error(`⏳ ${errorDetail || 'AI service temporarily unavailable. Please try again in a moment.'}`);
      }
      
      if (response.status === 500) {
        // Use the error detail from backend
        throw new Error(`⚠️ ${errorDetail}`);
      }
      
      // Generic error
      throw new Error(`❌ Request failed (${response.status}): ${errorDetail}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      console.error('❌ Result Error:', result);
      throw new Error(result.detail || result.error || 'Unknown error from tailoring service');
    }

    console.log('✅ Tailoring successful, result:', result);
    setStatus('Resume tailored successfully!');
    setButtonLoading(tailorBtn, false);
    console.log('🎯 About to call showResults');
    showResults(result);

    lastTailoredResult = result;
    downloadBtn.disabled = false;
    copyBtn.disabled = false;

    await chrome.storage.local.set({
      [LAST_RESULT_KEY]: result,
      lastTailoredTime: Date.now()
    });
  } catch (error) {
    console.error('Tailoring error', error);
    setStatus(`Error: ${(error as Error).message}`);
    setButtonLoading(tailorBtn, false);
  }
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
    resultsSection.appendChild(aiSection);
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

  resultsSection.classList.remove('hidden');
}

function showResults(data: any) {
  console.log('🎯 showResults called with data:', data);
  console.log('🎯 resultsSection element:', resultsSection);
  console.log('🎯 resultsContent element:', resultsContent);
  
  lastTailoredResult = data;
  console.log('📋 Removing hidden class from resultsSection');
  resultsSection.classList.remove('hidden');
  
  // Force visibility and add visual confirmation
  resultsSection.style.display = 'block';
  resultsSection.style.backgroundColor = '#f0f8ff';
  resultsSection.style.border = '2px solid #0073b1';
  
  console.log('📋 resultsSection classes after removal:', resultsSection.classList.toString());
  console.log('📋 resultsSection style display:', resultsSection.style.display);

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
  
  console.log('📋 Results content set, innerHTML length:', resultsContent.innerHTML.length);
  
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
    resultsSection.classList.add('hidden');
    
    // Disable action buttons
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
    
    // Clear results content
    resultsContent.innerHTML = '';
    
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
  status.textContent = message;
}

chrome.runtime.onMessage.addListener((message: TailorResultMessage) => {
  if (message.type === MessageType.TailorResult) {
    setStatus('Resume tailored successfully!');
    setButtonLoading(tailorBtn, false);
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
