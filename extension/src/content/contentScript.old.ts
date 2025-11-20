import { MessageType, JobData } from '../types/messages';

// Enhanced job extraction with multiple fallback strategies
function extractJob(): JobData | null {
  const url = window.location.href;
  const domain = window.location.hostname;
  let title: string | undefined;
  let company: string | undefined;
  let description: string | undefined;
  let requirements: string[] = [];
  let jobLocation: string | undefined;

  console.log('🔍 Extracting job from domain:', domain);
  console.log('📄 URL:', url);

  // LinkedIn - Multiple selector strategies
  if (/linkedin\.com/.test(domain)) {
    console.log('📘 Processing LinkedIn page...');
    
    // Try multiple title selectors (updated for 2025)
    const titleSelectors = [
      'h1.job-title',
      '.job-details-jobs-unified-top-card__job-title',
      '.job-details-jobs-unified-top-card__job-title h1',
      'h1[data-anonymize="job-title"]',
      '.jobs-unified-top-card__job-title h1',
      '.job-details__job-title',
      'h1.t-24',
      '.jobs-details__main-content h1',
      '.job-details-jobs-unified-top-card h1',
      'h1.jobs-unified-top-card__job-title',
      'h2.jobs-unified-top-card__job-title',
      '.jobs-details-top-card__job-title h1',
      '.jobs-details-top-card__job-title h2',
      '[class*="job-title"] h1',
      '[class*="job-title"] h2'
    ];
    
    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent?.trim()) {
        title = element.textContent.trim();
        console.log('✅ Found title with selector', selector, ':', title);
        break;
      }
    }
    
    // If still no title, try data attributes and aria-labels
    if (!title) {
      const headings = document.querySelectorAll('h1, h2');
      Array.from(headings).forEach((h) => {
        if (title) return; // Already found
        const text = h.textContent?.trim();
        if (text && text.length > 5 && text.length < 150 && 
            /\b(engineer|developer|manager|analyst|specialist|coordinator|director|lead|designer|architect)\b/i.test(text)) {
          title = text;
          console.log('✅ Found title via heuristic:', title);
        }
      });
    }
    
    // Company selectors (updated)
    const companySelectors = [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name',
      'a[data-anonymize="company-name"]',
      '.job-details__company-name',
      '.topcard__org-name-link',
      '.jobs-details-top-card__company-url',
      '.jobs-company__box a',
      '[class*="company-name"]',
      '.job-details-jobs-unified-top-card__primary-description a'
    ];
    
    for (const selector of companySelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent?.trim()) {
        company = element.textContent.trim();
        console.log('✅ Found company with selector', selector, ':', company);
        break;
      }
    }
    
    // Description selectors - try to get full job description (updated)
    const descSelectors = [
      '.job-details-jobs-unified-top-card__job-description',
      '.jobs-description__content',
      '.job-details__description',
      '.jobs-box__html-content',
      '.show-more-less-html__markup',
      '.jobs-description-content__text',
      '.jobs-description',
      '[class*="job-description"]',
      '.jobs-details__main-content article',
      '#job-details',
      '.jobs-box__html-content .jobs-description-content__text'
    ];
    
    for (const selector of descSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent && element.textContent.length > 100) {
        description = element.textContent.trim();
        console.log('✅ Found description with selector', selector, 'length:', description.length);
        break;
      }
    }
    
    // If description is too short, try to expand "Show more" buttons
    if (!description || description.length < 200) {
      const showMoreButtons = document.querySelectorAll('[aria-label*="Show more"], [aria-label*="show more"], button[aria-expanded="false"]');
      Array.from(showMoreButtons).forEach((button) => {
        if (button instanceof HTMLElement && button.textContent?.toLowerCase().includes('show')) {
          console.log('🔍 Trying to click "Show more" button');
          button.click();
          // Wait a bit for content to load
          setTimeout(() => {
            for (const selector of descSelectors) {
              const element = document.querySelector(selector);
              if (element && element.textContent && element.textContent.length > 100) {
                description = element.textContent.trim();
                console.log('✅ Found expanded description length:', description.length);
                break;
              }
            }
          }, 500);
        }
      });
    }
    
  } 
  // Indeed - Enhanced detection
  else if (/indeed\.com/.test(domain)) {
    console.log('🔍 Processing Indeed page...');
    
    // Title selectors for Indeed
    const titleSelectors = [
      '[data-testid="jobTitle"] h1 span',
      '.jobsearch-JobInfoHeader-title span',
      'h1[data-testid="jobTitle"]',
      '.jobsearch-JobInfoHeader-title',
      'h1.icl-u-xs-mb--xs',
      '[data-jk] h1'
    ];
    
    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent?.trim()) {
        title = element.textContent.trim();
        console.log('✅ Found title:', title);
        break;
      }
    }
    
    // Company selectors
    const companySelectors = [
      '[data-testid="inlineHeader-companyName"] a',
      '[data-testid="inlineHeader-companyName"]',
      '.jobsearch-InlineCompanyRating a',
      '.icl-u-lg-mr--sm .icl-u-xs-mr--xs',
      '[data-testid="company-name"]',
      'span.companyName'
    ];
    
    for (const selector of companySelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent?.trim()) {
        company = element.textContent.trim();
        console.log('✅ Found company:', company);
        break;
      }
    }
    
    // Description selectors
    const descSelectors = [
      '[data-testid="jobDescription"]',
      '#jobDescriptionText',
      '.jobsearch-jobDescriptionText',
      '.jobsearch-JobComponent-description',
      '.jobDescriptionContent'
    ];
    
    for (const selector of descSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent && element.textContent.length > 100) {
        description = element.textContent.trim();
        console.log('✅ Found description length:', description.length);
        break;
      }
    }
    
  }
  // Dice.com - Enhanced detection
  else if (/dice\.com/.test(domain)) {
    console.log('🎲 Processing Dice page...');
    
    const titleSelectors = [
      'h1[data-cy="jobTitle"]',
      '.jobTitle h1',
      'h1.job-title',
      '.job-header h1'
    ];
    
    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent?.trim()) {
        title = element.textContent.trim();
        console.log('✅ Found title:', title);
        break;
      }
    }
    
    const companySelectors = [
      '[data-cy="companyName"] a',
      '.company-name a',
      '.employer-name',
      '.company-header a'
    ];
    
    for (const selector of companySelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent?.trim()) {
        company = element.textContent.trim();
        console.log('✅ Found company:', company);
        break;
      }
    }
    
    const descSelectors = [
      '[data-cy="jobDescription"]',
      '.job-description',
      '#jobDescription',
      '.job-details'
    ];
    
    for (const selector of descSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent && element.textContent.length > 100) {
        description = element.textContent.trim();
        console.log('✅ Found description length:', description.length);
        break;
      }
    }
  }
  // Glassdoor detection
  else if (/glassdoor\.com/.test(domain)) {
    console.log('🏢 Processing Glassdoor page...');
    title = document.querySelector('[data-test="job-title"], .jobTitle, h1')?.textContent?.trim();
    company = document.querySelector('[data-test="employer-name"], .employerName')?.textContent?.trim();
    description = document.querySelector('[data-test="jobDescriptionContent"], .jobDescriptionContent')?.textContent?.trim();
  }
  // Generic fallback with AI-powered detection
  else {
    console.log('🌐 Using generic job detection...');
    title = detectJobTitleGeneric();
    company = detectCompanyGeneric();
    description = detectJobDescriptionGeneric();
  }
  
  // Log what we found
  console.log('📋 Extraction Results:', { 
    title, 
    company, 
    descLength: description?.length,
    url,
    domain
  });
  
  // Validate we have minimum required data
  if (!title && !company && !description) {
    console.log('❌ No job data found - page may not be a job posting');
    console.log('🔍 Debug: Try checking page structure manually');
    console.log('🔍 Debug: Available h1 elements:', Array.from(document.querySelectorAll('h1')).map(h => h.textContent?.trim()).filter(Boolean));
    return null;
  }
  
  // If we have some data but missing critical pieces, try fallback extraction
  if (!title) title = detectJobTitleGeneric();
  if (!company) company = detectCompanyGeneric();
  if (!description || description.length < 100) {
    description = detectJobDescriptionGeneric();
  }
  
  // Final validation
  if (!title || !description || description.length < 50) {
    console.log('❌ Insufficient job data:', { title: !!title, description: description?.length });
    return null;
  }

  return {
    title: title,
    company: company || 'Company',
    description: description,
    requirements: extractRequirements(description),
    hash: generateSimpleHash(title + company),
    source: domain,
    pageUrl: url,
    location: jobLocation
  };
}

// Generic job title detection using multiple strategies
function detectJobTitleGeneric(): string | undefined {
  const titleSelectors = [
    'h1',
    '[data-testid*="title"]',
    '[class*="title"]',
    '[class*="job-title"]',
    '[id*="title"]',
    'header h1',
    '.job h1',
    '.position h1'
  ];
  
  for (const selector of titleSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent) {
      const text = element.textContent.trim();
      // Check if it looks like a job title (contains job-related keywords)
      if (text.length > 5 && text.length < 100 && 
          /\b(developer|engineer|manager|analyst|specialist|coordinator|director|lead|senior|junior|intern)\b/i.test(text)) {
        return text;
      }
    }
  }
  
  // Try meta tags
  const metaTitle = document.querySelector('meta[property="og:title"], meta[name="title"]')?.getAttribute('content');
  if (metaTitle && /\b(developer|engineer|manager|analyst|specialist)\b/i.test(metaTitle)) {
    return metaTitle;
  }
  
  return undefined;
}

// Generic company detection
function detectCompanyGeneric(): string | undefined {
  const companySelectors = [
    '[class*="company"]',
    '[data-testid*="company"]',
    '[class*="employer"]',
    '[class*="organization"]',
    '.brand',
    '.org'
  ];
  
  for (const selector of companySelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent) {
      const text = element.textContent.trim();
      if (text.length > 2 && text.length < 50 && !text.includes('Job') && !text.includes('Search')) {
        return text;
      }
    }
  }
  
  // Try domain-based detection
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  if (parts.length > 2) {
    const subdomain = parts[0];
    if (subdomain !== 'www' && subdomain !== 'jobs' && subdomain.length > 2) {
      return subdomain.charAt(0).toUpperCase() + subdomain.slice(1);
    }
  }
  
  return undefined;
}

// Generic job description detection
function detectJobDescriptionGeneric(): string | undefined {
  const descSelectors = [
    '[class*="description"]',
    '[class*="job-desc"]',
    '[class*="content"]',
    '[data-testid*="description"]',
    'main',
    'article',
    '.job-details',
    '.posting-content',
    '.position-details'
  ];
  
  for (const selector of descSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent && element.textContent.length > 200) {
      return element.textContent.trim();
    }
  }
  
  // Fallback to body content if nothing else works
  const bodyText = document.body.innerText;
  if (bodyText && bodyText.length > 500) {
    return bodyText.slice(0, 3000);
  }
  
  return undefined;
}

// Extract requirements from job description
function extractRequirements(description: string): string[] {
  if (!description) return [];
  
  const requirements: string[] = [];
  const lines = description.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 10 && trimmed.length < 200) {
      // Look for requirement patterns
      if (/^[•\-\*]\s*/.test(trimmed) || 
          /\b(required|must have|should have|experience with|knowledge of)\b/i.test(trimmed)) {
        requirements.push(trimmed.replace(/^[•\-\*]\s*/, ''));
      }
    }
  }
  
  return requirements.slice(0, 10);
}

// Simple hash function for job identification
function generateSimpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

// Detect if current page is likely a job posting
function detectJobPage(): boolean {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  
  // URL-based detection
  if (/\b(jobs?|career|position|vacancy|hiring|employment)\b/.test(url)) {
    return true;
  }
  
  // Title-based detection
  if (/\b(job|career|position|vacancy|hiring)\b/.test(title)) {
    return true;
  }
  
  // Content-based detection - look for job-related terms
  const pageText = document.body.innerText.toLowerCase();
  const jobKeywords = ['apply now', 'job description', 'requirements', 'qualifications', 'salary', 'benefits'];
  const keywordCount = jobKeywords.filter(keyword => pageText.includes(keyword)).length;
  
  return keywordCount >= 2;
}

// Initialize job detection
console.log('🚀 ResumeCraft Content Script Loaded');

// Check if current page is a job posting
if (detectJobPage()) {
  console.log('✅ Job page detected, enabling extension icon');
  chrome.runtime.sendMessage({ 
    type: 'JOB_PAGE_DETECTED',
    url: window.location.href 
  });
} else {
  console.log('ℹ️ Job page not detected');
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Received message:', request.type);
  
  if (request.type === MessageType.GetJob) {
    const job = extractJob();
    console.log('📤 Sending job data:', job ? { title: job.title, company: job.company } : 'null');
    sendResponse({ job });
    return true;
  }
});

// Also check for job detection on navigation changes
let lastUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    if (detectJobPage()) {
      chrome.runtime.sendMessage({ 
        type: 'JOB_PAGE_DETECTED',
        url: window.location.href 
      });
    }
  }
}, 1000);
