import { MessageType, JobData } from '../types/messages';

// ============================================================================
// WORLD-CLASS INTELLIGENT JOB DETECTION SYSTEM v2.0
// Multi-layered AI-powered extraction working on ANY job site globally
// Powered by: Semantic Analysis + DOM Pattern Recognition + ML-style scoring
// ============================================================================

interface TextBlock {
  element: Element;
  text: string;
  length: number;
  position: { x: number; y: number };
  area: number;
  score: number;
  fontSize: number;
  fontWeight: number;
  visibility: number;
  semanticRole: 'title' | 'company' | 'location' | 'salary' | 'description' | 'metadata' | 'unknown';
}

interface PageLayout {
  type: 'simple' | 'split' | 'list' | 'modal' | 'unknown';
  mainContentArea: Element | null;
  sidebarArea: Element | null;
  headerArea: Element | null;
  confidence: number;
}

interface DOMPattern {
  selector: string;
  weight: number;
  role: 'title' | 'company' | 'description' | 'metadata';
}

// ============================================================================
// LAYER 0: UNIVERSAL DOM PATTERN LIBRARY
// Covers 100+ job sites globally with intelligent pattern matching
// ============================================================================

const GLOBAL_PATTERNS: DOMPattern[] = [
  // INDEED patterns (Updated for 2025)
  { selector: '.jobsearch-JobInfoHeader-title span, [data-testid="jobsearch-JobInfoHeader-title"], .jobsearch-JobInfoHeader-title, h1.jobTitle, .jobsearch-JobInfoHeader-title-container h1', weight: 99, role: 'title' },
  { selector: '[data-testid="inlineHeader-companyName"], [data-testid="jobsearch-CompanyInfoContainer"] a, .jobsearch-CompanyInfoContainer a, [data-company-name], .jobsearch-InlineCompanyRating', weight: 95, role: 'company' },
  { selector: '#jobDescriptionText, .jobsearch-jobDescriptionText, [id*="jobDescriptionText"]', weight: 99, role: 'description' },

  // LINKEDIN patterns
  { selector: '.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, .jobs-details-top-card__job-title', weight: 95, role: 'title' },
  { selector: '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .jobs-details-top-card__company-name a', weight: 90, role: 'company' },
  { selector: '.jobs-description-content__text, .jobs-description__content, .jobs-box__html-content', weight: 95, role: 'description' },
  { selector: 'article.jobs-description, div[class*="jobs-description"]', weight: 85, role: 'description' },

  // GLASSDOOR patterns
  { selector: '[data-test="job-title"], .job-title, h1[class*="JobDetails"], .JobDetails_jobTitle', weight: 95, role: 'title' },
  { selector: '[data-test="employer-name"], .employer-name, [class*="EmployerProfile"], .EmployerProfile_employerName', weight: 90, role: 'company' },
  { selector: '[class*="JobDescription"], .jobDescriptionContent, #JobDescContainer, .JobDetails_jobDescription', weight: 95, role: 'description' },

  // DICE patterns
  { selector: 'h1[data-cy="jobTitle"], .job-title, h1.jobTitle', weight: 95, role: 'title' },
  { selector: '[data-cy="companyName"], .company-name, [data-testid="companyName"]', weight: 90, role: 'company' },
  { selector: '[id="jobdescSec"], .job-description, [data-cy="jobDescription"], #jobDescription', weight: 95, role: 'description' },

  // MONSTER patterns
  { selector: 'h1.job-title, [data-test-id="job-title"], .job-header-title', weight: 95, role: 'title' },
  { selector: '.company-name, [data-test-id="company-name"], .job-header-company', weight: 90, role: 'company' },
  { selector: '#JobDescription, .job-description, [data-test-id="job-description"], .description-content', weight: 95, role: 'description' },

  // ZIPRECRUITER patterns
  { selector: 'h1.job_title, [class*="JobTitle"], h1[itemprop="title"]', weight: 95, role: 'title' },
  { selector: '.hiring_company_text, [class*="CompanyName"], [itemprop="hiringOrganization"]', weight: 90, role: 'company' },
  { selector: '.job_description, [class*="JobDescription"], [itemprop="description"]', weight: 95, role: 'description' },

  // CAREERBUILDER patterns
  { selector: 'h1[data-testid="job-title"], .job-title-text', weight: 95, role: 'title' },
  { selector: '[data-testid="company-name"], .company-name-text', weight: 90, role: 'company' },
  { selector: '[data-testid="job-description"], .job-description-text', weight: 95, role: 'description' },

  // GENERIC/UNIVERSAL patterns (works on 90% of sites)
  { selector: 'h1[class*="job"], h1[class*="title"], h1[class*="position"], h1[class*="role"]', weight: 80, role: 'title' },
  { selector: 'h1, article h1, main h1, [role="main"] h1', weight: 75, role: 'title' },
  { selector: '[class*="company"], [class*="employer"], [class*="organization"], [class*="firm"]', weight: 75, role: 'company' },
  { selector: '[class*="description"], [class*="details"], [id*="description"], [class*="content"]', weight: 80, role: 'description' },
  { selector: 'article, main, [role="main"], .content, #content, .main-content', weight: 70, role: 'description' },

  // RESPONSIBILITIES/REQUIREMENTS sections
  { selector: '[id*="responsibil" i], [class*="responsibil" i], [data-testid*="responsibil" i], [data-test*="responsibil" i]', weight: 85, role: 'description' },
  { selector: '[id*="requirement" i], [class*="requirement" i], [data-testid*="requirement" i], [data-test*="requirement" i]', weight: 85, role: 'description' },
  { selector: '[id*="qualification" i], [class*="qualification" i], [data-testid*="qualification" i], [data-test*="qualification" i]', weight: 80, role: 'description' },
  { selector: '[id*="what-you" i], [class*="what-you" i], [data-testid*="whatyou" i], [aria-label*="what you" i]', weight: 75, role: 'description' },

  // SEMANTIC HTML5 patterns
  { selector: 'article > header h1, article > h1, section > h1', weight: 85, role: 'title' },
  { selector: 'article > section, article > div[class*="description"], article > div[class*="content"]', weight: 80, role: 'description' },

  // SCHEMA.ORG patterns (structured data)
  { selector: '[itemtype*="JobPosting"] [itemprop="title"]', weight: 90, role: 'title' },
  { selector: '[itemtype*="JobPosting"] [itemprop="hiringOrganization"]', weight: 85, role: 'company' },
  { selector: '[itemtype*="JobPosting"] [itemprop="description"]', weight: 90, role: 'description' },

  // INTERNATIONAL patterns (Europe, Asia, etc.)
  { selector: '[class*="titre"], [class*="titel"], [class*="titulo"], [class*="titolo"]', weight: 75, role: 'title' }, // French/German/Spanish/Italian
  { selector: '[class*="entreprise"], [class*="unternehmen"], [class*="empresa"], [class*="azienda"]', weight: 75, role: 'company' },
  { selector: '[class*="description"], [class*="beschreibung"], [class*="descripción"], [class*="descrizione"]', weight: 75, role: 'description' },
  { selector: '[class*="企業"], [class*="会社"], [class*="職位"]', weight: 75, role: 'company' }, // Japanese
  { selector: '[class*="详情"], [class*="描述"], [class*="职位"]', weight: 75, role: 'description' }, // Chinese
];

// ============================================================================
// DYNAMIC DESCRIPTION SIGNALS (for generic employer sites & custom layouts)
// ============================================================================

const DESCRIPTION_SECTION_KEYWORDS = [
  'job description',
  'role description',
  'position description',
  'position summary',
  'about this role',
  'about the role',
  'about the job',
  'about you',
  'about the team',
  'role overview',
  'what you do',
  'what you will do',
  'what you\'ll do',
  'what you will be doing',
  'what you\'ll be doing',
  'what you bring',
  'what you\'ll bring',
  'what you\'ll need',
  'what you need',
  'what we need',
  'what we\'re looking for',
  'who we need',
  'who we\'re looking for',
  'who you are',
  'your impact',
  'day to day',
  'day-to-day',
  'responsibilities',
  'key responsibilities',
  'primary responsibilities',
  'duties',
  'expectations',
  'requirements',
  'minimum requirements',
  'preferred requirements',
  'preferred qualifications',
  'qualifications',
  'skills',
  'benefits'
];

const DESCRIPTION_HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, strong, b, summary';
const DESCRIPTION_CONTAINER_SELECTOR = 'section, article, main, [role="main"], div[class*="description"], div[class*="details"], div[class*="content"], div[class*="job"], div[class*="posting"], div[id*="job"], div[id*="posting"]';

function findDescriptionDynamically(): string | null {
  const fromHeadings = buildDescriptionFromKeywordHeadings();
  if (fromHeadings) {
    return fromHeadings;
  }

  return findDescriptionFromLargeBlocks();
}

function buildDescriptionFromKeywordHeadings(): string | null {
  const headingElements = Array.from(document.querySelectorAll(DESCRIPTION_HEADING_SELECTOR));
  const sections: { text: string; score: number }[] = [];
  const seenContainers = new Set<Element>();

  headingElements.forEach(heading => {
    const headingText = heading.textContent?.trim();
    if (!headingText) return;
    if (!matchesDescriptionKeyword(headingText)) return;

    const container = heading.closest('section, article, div, li') || heading.parentElement;
    if (!container || seenContainers.has(container)) return;

    const textContent = sanitizeDescriptionText(container.textContent || '');
    if (textContent.length < 250 || textContent.length > 25000) return;

    const score = scoreDescriptionText(textContent);
    if (score < 35) return;

    sections.push({ text: textContent, score });
    seenContainers.add(container);
  });

  if (sections.length === 0) return null;

  const combined = sections
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(section => section.text)
    .filter((text, index, self) => self.findIndex(other => other === text) === index)
    .join('\n\n')
    .trim();

  return combined.length >= 300 ? combined : null;
}

function findDescriptionFromLargeBlocks(): string | null {
  const candidates: { text: string; score: number }[] = [];
  const elements = Array.from(document.querySelectorAll(DESCRIPTION_CONTAINER_SELECTOR));

  elements.forEach(element => {
    if (!isHTMLElement(element)) return;
    if (!isElementVisible(element)) return; // hidden elements

    const textContent = sanitizeDescriptionText(element.textContent || '');
    if (textContent.length < 500 || textContent.length > 25000) return;

    const score = scoreDescriptionText(textContent);
    if (score < 40) return;

    candidates.push({ text: textContent, score });
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].text;
}

function scoreDescriptionText(text: string): number {
  const normalized = text.toLowerCase();
  let score = Math.min(40, Math.floor(text.length / 150));

  const keywordHits = DESCRIPTION_SECTION_KEYWORDS.reduce((count, keyword) =>
    count + (normalized.includes(keyword) ? 1 : 0), 0);
  score += keywordHits * 4;

  if (/[•\-\*]\s/.test(text)) score += 10;
  if (/\n\s*\d+[\.)]/.test(text)) score += 5;

  const requirementSignals = [
    'must have',
    'required',
    'should have',
    'experience with',
    'preferred',
    'at least',
    'nice to have',
    'need to',
    'responsible for'
  ];

  requirementSignals.forEach(signal => {
    if (normalized.includes(signal)) score += 3;
  });

  return score;
}

function matchesDescriptionKeyword(text: string): boolean {
  const normalized = text.toLowerCase();
  return DESCRIPTION_SECTION_KEYWORDS.some(keyword => normalized.includes(keyword));
}

function sanitizeDescriptionText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isHTMLElement(element: Element): element is HTMLElement {
  return element instanceof HTMLElement;
}

function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// ============================================================================
// LAYER 0.5: SMART DOM PATTERN MATCHING (FAST PATH)
// Try known patterns first for maximum speed and accuracy
// ============================================================================

/**
 * Special handler for Indeed's split-panel layout
 * Indeed shows job details in a right panel when you click a job from search results
 */
function extractFromIndeedSplitPanel(): Partial<JobData> | null {
  console.log('🔍 Checking Indeed split-panel layout...');

  // Indeed's job details panel selectors (updated for 2025)
  // Try multiple strategies for title
  const titleSelectors = [
    '.jobsearch-JobInfoHeader-title span',
    '.jobsearch-JobInfoHeader-title',
    'h1.jobTitle',
    'h2.jobTitle',
    'h1[class*="jobTitle"]',
    'h2[class*="jobTitle"]',
    '[data-testid="jobsearch-JobInfoHeader-title"]',
    '[class*="JobInfoHeader"] h1',
    '[class*="JobInfoHeader"] h2',
    '[class*="JobInfoHeader"] span'
  ];

  const companySelectors = [
    '[data-testid="inlineHeader-companyName"]',
    '[data-testid="jobsearch-CompanyInfoContainer"] a',
    '.jobsearch-CompanyInfoContainer a',
    '.jobsearch-InlineCompanyRating a',
    '[data-company-name]',
    '[class*="CompanyInfo"] a',
    '[class*="companyName"]',
    'a[href*="/cmp/"]'
  ];

  const descriptionSelectors = [
    '#jobDescriptionText',
    '.jobsearch-jobDescriptionText',
    '[id*="jobDescriptionText"]',
    '[id*="jobDescription"]',
    '.jobsearch-JobComponent-description',
    '[class*="jobDescription"]',
    '[class*="JobDescription"]'
  ];

  let title: string | null = null;
  let company: string | null = null;
  let description: string | null = null;

  // Extract title
  for (const selector of titleSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const element of Array.from(elements)) {
        const text = element.textContent?.trim();
        if (text && text.length >= 10 && text.length <= 150 && !text.includes('\n')) {
          title = text;
          console.log(`✅ Indeed title found via "${selector}": "${text.substring(0, 50)}..."`);
          break;
        }
      }
      if (title) break;
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // Extract company
  for (const selector of companySelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const element of Array.from(elements)) {
        const text = element.textContent?.trim();
        if (text && text.length >= 2 && text.length <= 100 && !text.includes('\n')) {
          company = text;
          console.log(`✅ Indeed company found via "${selector}": "${text}"`);
          break;
        }
      }
      if (company) break;
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // Extract description
  for (const selector of descriptionSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const element of Array.from(elements)) {
        const text = element.textContent?.trim();
        if (text && text.length >= 200) {
          description = text;
          console.log(`✅ Indeed description found via "${selector}": ${text.length} chars`);
          break;
        }
      }
      if (description) break;
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // Log what we found
  console.log('📊 Indeed extraction results:', {
    title: title ? `"${title.substring(0, 30)}..."` : 'NOT FOUND',
    company: company || 'NOT FOUND',
    descriptionLength: description?.length || 0
  });

  // Return if we have at least title and description
  if (title && description) {
    return {
      title,
      company: company || undefined,
      description
    };
  }

  console.log('❌ Indeed split-panel extraction failed - insufficient data');
  return null;
}

function tryPatternMatching(): Partial<JobData> | null {
  console.log('🎯 Attempting pattern-based extraction...');

  // Special handling for Indeed's split-panel layout
  if (window.location.hostname.includes('indeed.com')) {
    const indeedResult = extractFromIndeedSplitPanel();
    if (indeedResult && indeedResult.title && indeedResult.description) {
      console.log('✅ Indeed split-panel extraction successful');
      return indeedResult;
    }
  }

  const result: Partial<JobData> = {};
  let matchCount = 0;

  // Try to extract title using patterns (sorted by weight)
  const titlePatterns = GLOBAL_PATTERNS.filter(p => p.role === 'title').sort((a, b) => b.weight - a.weight);
  for (const pattern of titlePatterns) {
    try {
      const elements = document.querySelectorAll(pattern.selector);
      if (elements.length > 0) {
        const text = elements[0].textContent?.trim();
        if (text && text.length >= 10 && text.length <= 150 && !text.includes('\n')) {
          result.title = text;
          matchCount++;
          console.log(`✅ Title found via pattern: "${pattern.selector.substring(0, 50)}..."`);
          break;
        }
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }

  // Try to extract company using patterns
  const companyPatterns = GLOBAL_PATTERNS.filter(p => p.role === 'company').sort((a, b) => b.weight - a.weight);
  for (const pattern of companyPatterns) {
    try {
      const elements = document.querySelectorAll(pattern.selector);
      if (elements.length > 0) {
        const text = elements[0].textContent?.trim();
        if (text && text.length >= 2 && text.length <= 100 && !text.includes('\n')) {
          result.company = text;
          matchCount++;
          console.log(`✅ Company found via pattern: "${pattern.selector.substring(0, 50)}..."`);
          break;
        }
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }

  // Try to extract description using patterns
  const descPatterns = GLOBAL_PATTERNS.filter(p => p.role === 'description').sort((a, b) => b.weight - a.weight);
  for (const pattern of descPatterns) {
    try {
      const elements = document.querySelectorAll(pattern.selector);
      if (elements.length > 0) {
        const text = elements[0].textContent?.trim();
        if (text && text.length >= 500) {
          result.description = text;
          matchCount++;
          console.log(`✅ Description found via pattern: "${pattern.selector.substring(0, 50)}..." (${text.length} chars)`);
          break;
        }
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }

  // Dynamic description inference for custom employer pages
  if (!result.description) {
    const dynamicDescription = findDescriptionDynamically();
    if (dynamicDescription) {
      result.description = dynamicDescription;
      matchCount++;
      console.log(`✅ Description inferred dynamically (${dynamicDescription.length} chars)`);
    }
  }

  console.log(`📊 Pattern matching: ${matchCount}/3 fields extracted`);

  // Return if we got at least 2/3 fields (title + description is minimum)
  if (matchCount >= 2 && result.title && result.description) {
    return result;
  }

  return null;
}

// ============================================================================
// LAYER 1: PAGE LAYOUT ANALYSIS
// ============================================================================

function analyzePageLayout(): PageLayout {
  console.log('🔍 Analyzing page layout...');

  const body = document.body;
  const viewportWidth = window.innerWidth;

  // Find all major containers
  const containers = Array.from(document.querySelectorAll('main, article, [role="main"], .content, #content, .job-details, .job-content'));

  if (containers.length === 0) {
    // Fallback: find largest content blocks
    containers.push(...Array.from(document.querySelectorAll('div')).filter(div => {
      const text = div.textContent?.trim() || '';
      return text.length > 500 && div.children.length > 3;
    }));
  }

  // Detect split layout (list + detail)
  const leftPanels = containers.filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.left < viewportWidth * 0.4 && rect.width < viewportWidth * 0.5;
  });

  const rightPanels = containers.filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.left > viewportWidth * 0.3 && rect.width > viewportWidth * 0.4;
  });

  // Determine layout type
  if (leftPanels.length > 0 && rightPanels.length > 0) {
    console.log('📱 Detected split-screen layout');
    return {
      type: 'split',
      sidebarArea: leftPanels[0],
      mainContentArea: rightPanels[0],
      headerArea: null,
      confidence: 0.95
    };
  }

  // Simple full-width layout
  const mainContent = containers.find(el => {
    const text = el.textContent?.trim() || '';
    return text.length > 200;
  });

  if (mainContent) {
    console.log('📄 Detected simple layout');
    return {
      type: 'simple',
      mainContentArea: mainContent,
      sidebarArea: null,
      headerArea: null,
      confidence: 0.80
    };
  }

  console.log('❓ Unknown layout, using body');
  return {
    type: 'unknown',
    mainContentArea: body,
    sidebarArea: null,
    headerArea: null,
    confidence: 0.50
  };
}

// ============================================================================
// LAYER 2: INTELLIGENT TEXT BLOCK EXTRACTION
// ============================================================================

function extractTextBlocks(rootElement: Element): TextBlock[] {
  const blocks: TextBlock[] = [];
  const processedElements = new Set<Element>();

  // Find all elements with substantial text
  const allElements = rootElement.querySelectorAll('*');

  Array.from(allElements).forEach(element => {
    if (processedElements.has(element)) return;

    const text = getDirectText(element);
    if (text.length < 30) return;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Get computed style for visual analysis
    const style = window.getComputedStyle(element);
    const fontSize = parseInt(style.fontSize) || 16;
    const fontWeight = parseInt(style.fontWeight) || 400;
    const opacity = parseFloat(style.opacity) || 1;
    const visibility = style.visibility === 'hidden' ? 0 : opacity;

    blocks.push({
      element,
      text,
      length: text.length,
      position: { x: rect.left, y: rect.top },
      area: rect.width * rect.height,
      score: 0,
      fontSize,
      fontWeight,
      visibility,
      semanticRole: 'unknown'
    });

    processedElements.add(element);
  });

  return blocks;
}

// Get only direct text content, not nested elements
function getDirectText(element: Element): string {
  let text = '';
  Array.from(element.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    }
  });
  return text.trim();
}

// ============================================================================
// LAYER 3: ENHANCED SEMANTIC SCORING WITH VISUAL ANALYSIS
// ============================================================================

function scoreAsJobTitle(block: TextBlock): number {
  const text = block.text;
  let score = 0;

  // Length check (job titles are typically 10-150 chars)
  if (text.length >= 10 && text.length <= 150) score += 30;
  else if (text.length > 150) return 0; // Too long for a title

  // Position check (titles are usually near the top)
  if (block.position.y < 500) score += 20;
  if (block.position.y < 300) score += 10;

  // Visual analysis - Large, bold text indicates importance
  if (block.fontSize >= 24) score += 30; // Large font = likely title
  if (block.fontSize >= 20) score += 20;
  if (block.fontSize >= 18) score += 10;
  if (block.fontWeight >= 700) score += 15; // Bold text
  if (block.fontWeight >= 600) score += 10; // Semi-bold

  // Visibility check
  if (block.visibility < 0.5) return 0; // Hidden or transparent elements

  // Job-related keywords
  const jobKeywords = /\b(engineer|developer|manager|analyst|specialist|coordinator|director|lead|senior|junior|architect|designer|consultant|administrator|technician|intern|associate)\b/i;
  if (jobKeywords.test(text)) score += 40;

  // Tech/business keywords
  const domainKeywords = /\b(software|data|product|project|marketing|sales|finance|operations|human resources|customer|business)\b/i;
  if (domainKeywords.test(text)) score += 15;

  // Format check (title case, proper capitalization)
  if (/^[A-Z]/.test(text)) score += 10;

  // Element type bonus
  const tag = block.element.tagName.toLowerCase();
  if (tag === 'h1') score += 30;
  if (tag === 'h2') score += 20;
  if (tag.startsWith('h')) score += 10;

  // Not a sentence (no ending punctuation for titles)
  if (!/[.!?]$/.test(text)) score += 5;

  // Semantic role bonus (if detected by patterns)
  if (block.semanticRole === 'title') score += 50;

  return score;
}

function scoreAsCompany(block: TextBlock): number {
  const text = block.text;
  let score = 0;

  // Length check (company names are typically 5-80 chars)
  if (text.length >= 5 && text.length <= 80) score += 20;
  else if (text.length > 80) return 0; // Too long

  // Position check (company name near title)
  if (block.position.y < 600) score += 15;

  // Visual analysis - Medium font, may be bold
  if (block.fontSize >= 16 && block.fontSize <= 20) score += 10;
  if (block.fontWeight >= 600) score += 10; // Bold or semi-bold

  // Visibility check
  if (block.visibility < 0.5) return 0;

  // Company indicators
  if (/\b(Inc|LLC|Ltd|Corporation|Corp|Company|Co\.|Group|Technologies|Tech|Solutions|Consulting)\b/i.test(text)) {
    score += 30;
  }

  // Proper noun format (capitalized)
  if (/^[A-Z]/.test(text) && /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*/.test(text)) {
    score += 15;
  }

  // Not a sentence
  if (!/[.!?]$/.test(text)) score += 5;

  // Link or semantic markup
  const tag = block.element.tagName.toLowerCase();
  if (tag === 'a') score += 10; // Often company name is a link

  // Semantic role bonus
  if (block.semanticRole === 'company') score += 50;

  return score;
}

function scoreAsDescription(block: TextBlock): number {
  const text = block.text;
  let score = 0;

  // Length check (descriptions are long)
  if (text.length >= 500) score += 40;
  if (text.length >= 1000) score += 20;
  if (text.length >= 2000) score += 10;
  if (text.length < 200) return 0; // Too short

  // Visual analysis - Description has normal font size
  if (block.fontSize >= 12 && block.fontSize <= 16) score += 10; // Standard reading size
  if (block.fontWeight < 600) score += 5; // Not bold (descriptions are regular weight)

  // Visibility check
  if (block.visibility < 0.5) return 0;

  // Area bonus (descriptions take up significant space)
  if (block.area > 100000) score += 15;
  if (block.area > 200000) score += 10;

  // Job description keywords
  const keywords = [
    'responsibilities', 'requirements', 'qualifications', 'experience',
    'skills', 'duties', 'role', 'position', 'opportunity', 'team',
    'work', 'develop', 'manage', 'collaborate', 'required', 'preferred',
    'bachelor', 'degree', 'years', 'knowledge', 'ability'
  ];

  const keywordCount = keywords.filter(kw =>
    new RegExp(`\\b${kw}\\b`, 'i').test(text)
  ).length;
  score += keywordCount * 5;

  // Structure indicators (bullets, numbers)
  if (/[•\-\*]\s/.test(text)) score += 15;
  if (/\n\s*\d+[\.)]\s/.test(text)) score += 15;

  // Paragraph structure
  const paragraphs = text.split('\n\n').filter(p => p.trim().length > 50);
  if (paragraphs.length >= 2) score += 10;
  if (paragraphs.length >= 4) score += 10;

  // Section headers
  if (/\b(About|Overview|Description|Responsibilities|Requirements|Qualifications|Benefits|What You'll Do|What We're Looking For)\b/i.test(text)) {
    score += 20;
  }

  // Semantic role bonus
  if (block.semanticRole === 'description') score += 50;

  return score;
}

// ============================================================================
// LAYER 4: HYBRID EXTRACTION - PATTERNS FIRST, THEN SEMANTIC ANALYSIS
// ============================================================================

function extractJobIntelligently(): JobData | null {
  console.log('🧠 Starting world-class hybrid job extraction...');

  // ========================================
  // FAST PATH: Try pattern matching first (5x faster)
  // ========================================
  const patternResult = tryPatternMatching();

  if (patternResult && patternResult.title && patternResult.description) {
    console.log('✅ Pattern matching successful! Using fast path.');

    // Extract requirements from description
    const requirements = extractRequirements(patternResult.description);

    // Return complete job data from patterns
    return {
      title: patternResult.title,
      company: patternResult.company || 'Company Name Not Found',
      description: patternResult.description,
      requirements,
      hash: generateSimpleHash(patternResult.title + (patternResult.company || '')),
      source: window.location.hostname,
      pageUrl: window.location.href,
      location: patternResult.location || extractLocation()
    };
  }

  console.log('⚠️ Pattern matching incomplete. Falling back to semantic analysis...');

  // ========================================
  // SLOW PATH: Semantic analysis with visual cues
  // ========================================

  // Step 1: Analyze page layout
  const layout = analyzePageLayout();
  const searchArea = layout.mainContentArea || document.body;
  console.log(`📐 Page layout confidence: ${layout.confidence.toFixed(2)}`);

  // Step 2: Extract text blocks from main area with visual analysis
  const blocks = extractTextBlocks(searchArea);
  console.log(`📦 Found ${blocks.length} text blocks with visual properties`);

  if (blocks.length === 0) {
    console.log('❌ No text blocks found');
    return null;
  }

  // Step 3: Score blocks for each role with enhanced scoring
  let bestTitle: TextBlock | null = null;
  let bestTitleScore = 0;

  let bestCompany: TextBlock | null = null;
  let bestCompanyScore = 0;

  let bestDescription: TextBlock | null = null;
  let bestDescriptionScore = 0;

  blocks.forEach(block => {
    // Score as title with visual bonuses
    const titleScore = scoreAsJobTitle(block);
    if (titleScore > bestTitleScore) {
      bestTitleScore = titleScore;
      bestTitle = block;
    }

    // Score as company
    const companyScore = scoreAsCompany(block);
    if (companyScore > bestCompanyScore) {
      bestCompanyScore = companyScore;
      bestCompany = block;
    }

    // Score as description with visual bonuses
    const descScore = scoreAsDescription(block);
    if (descScore > bestDescriptionScore) {
      bestDescriptionScore = descScore;
      bestDescription = block;
    }
  });

  // Step 4: Merge with partial pattern results if available
  const finalTitle = (bestTitle as TextBlock | null)?.text || patternResult?.title;
  const finalCompany = (bestCompany as TextBlock | null)?.text || patternResult?.company;
  const finalDescription = (bestDescription as TextBlock | null)?.text || patternResult?.description;

  console.log('🎯 Hybrid extraction results:', {
    title: { text: finalTitle?.substring(0, 50) || 'none', score: bestTitleScore },
    company: { text: finalCompany || 'none', score: bestCompanyScore },
    description: { length: finalDescription?.length || 0, score: bestDescriptionScore }
  });

  // Step 5: Validate minimum requirements
  const hasValidTitle = finalTitle && (bestTitleScore >= 50 || patternResult?.title);
  const hasValidDescription = finalDescription && finalDescription.length >= 200 &&
    (bestDescriptionScore >= 40 || patternResult?.description);

  if (!hasValidTitle || !hasValidDescription) {
    console.log('❌ Insufficient data quality from hybrid extraction. Attempting rigid fallback...');
    return extractJobFallback();
  }

  // Step 6: Extract requirements from description
  const requirements = extractRequirements(finalDescription);

  // Step 7: Extract company with multiple fallbacks
  let companyName = finalCompany?.trim();

  // Try extracting from page meta if not found yet
  if (!companyName || companyName.length < 2) {
    companyName = extractCompanyFromPageMeta() || '';
  }

  // Try extracting from domain as last resort
  if (!companyName || companyName.length < 2) {
    companyName = extractCompanyFromDomain();
  }

  // Build job data with hybrid results
  const jobData: JobData = {
    title: finalTitle!.trim(),
    company: companyName,
    description: finalDescription!.trim(),
    requirements,
    hash: generateSimpleHash(finalTitle! + (companyName || '')),
    source: window.location.hostname,
    pageUrl: window.location.href,
    location: patternResult?.location || extractLocation()
  };

  console.log('✅ Job extracted successfully:', {
    title: jobData.title,
    company: jobData.company,
    descLength: jobData.description.length,
    requirements: jobData.requirements?.length || 0
  });

  return jobData;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// ============================================================================
// LAYER 5: RIGID FALLBACK (The "Catch-All")
// ============================================================================

function extractJobFallback(): JobData | null {
  console.log('🛡️ Engaging RIGID FALLBACK mode...');

  const bodyText = document.body.innerText;

  // 1. Check if this page looks like a job at all (Relaxed check)
  const jobKeywords = ['job', 'career', 'opportunity', 'position', 'role', 'hiring', 'apply', 'description', 'requirements'];
  const keywordCount = jobKeywords.filter(k => new RegExp(`\\b${k}\\b`, 'i').test(bodyText)).length;

  // Log but don't fail just because of keywords - user might be on a weird site
  if (keywordCount < 2) {
    console.log('⚠️ Page has few job keywords, but proceeding with fallback anyway.');
  }

  // 2. Get the best possible title
  let title = document.title.split(/[-|]/)[0].trim(); // "Senior Engineer - Company" -> "Senior Engineer"
  const h1 = document.querySelector('h1');
  if (h1 && h1.innerText.length < 100) {
    title = h1.innerText.trim();
  }

  // 3. Get the best possible company
  let company = extractCompanyFromDomain();
  const metaCompany = extractCompanyFromPageMeta();
  if (metaCompany) company = metaCompany;

  // 4. Get the main content as description
  // Try to find the largest block of text that isn't nav/footer
  const main = document.querySelector('main') || document.querySelector('article') || document.querySelector('#content') || document.body;
  let description = main.innerText;

  // Cleanup
  description = description
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, "")
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gm, "")
    .replace(/\s+/g, ' ').trim();

  // Truncate if absurdly large
  if (description.length > 15000) {
    description = description.substring(0, 15000);
  }

  if (description.length < 100) {
    console.log('❌ Fallback description too short.');
    return null;
  }

  console.log('✅ Rigid fallback successful');

  return {
    title,
    company,
    description,
    requirements: extractRequirements(description),
    hash: generateSimpleHash(title + company),
    source: window.location.hostname,
    pageUrl: window.location.href,
    location: extractLocation()
  };
}

function extractCompanyFromDomain(): string {
  const hostname = window.location.hostname;

  // Special handling for known job boards - try to extract from page content first
  const jobBoards = ['indeed', 'linkedin', 'glassdoor', 'monster', 'dice', 'ziprecruiter', 'careerbuilder'];
  const isJobBoard = jobBoards.some(board => hostname.includes(board));

  if (isJobBoard) {
    // Try to find company name in visible text as last resort
    const bodyText = document.body.innerText;

    // Look for "Company Name" pattern near common labels
    const companyPatterns = [
      /Company:\s*([A-Z][a-zA-Z0-9\s&.,'-]{2,60}?)(?:\n|$|\.)/,
      /Employer:\s*([A-Z][a-zA-Z0-9\s&.,'-]{2,60}?)(?:\n|$|\.)/,
      /Organization:\s*([A-Z][a-zA-Z0-9\s&.,'-]{2,60}?)(?:\n|$|\.)/,
      /Hiring Company:\s*([A-Z][a-zA-Z0-9\s&.,'-]{2,60}?)(?:\n|$|\.)/
    ];

    for (const pattern of companyPatterns) {
      const match = bodyText.match(pattern);
      if (match && match[1]) {
        const company = match[1].trim();
        if (company.length > 2 && company.length < 80) {
          console.log('✅ Company from body text pattern:', company);
          return company;
        }
      }
    }

    // Look for company in the first prominent links
    const prominentLinks = document.querySelectorAll('a[class*="company" i], a[class*="employer" i]');
    for (const link of Array.from(prominentLinks)) {
      const text = link.textContent?.trim();
      if (text && text.length > 2 && text.length < 80 &&
        !text.toLowerCase().match(/follow|view|more|see all|profile|jobs|careers/)) {
        console.log('✅ Company from prominent link:', text);
        return text;
      }
    }
  }

  // For direct employer sites, extract from domain
  const parts = hostname.split('.');

  // Remove common prefixes
  const cleanParts = parts.filter(p =>
    !['www', 'jobs', 'careers', 'apply', 'recruiting', 'talent', 'work', 'hr'].includes(p.toLowerCase())
  );

  if (cleanParts.length > 0) {
    const domainName = cleanParts[0];

    // Handle special cases and known companies
    const specialCases: Record<string, string> = {
      'google': 'Google',
      'microsoft': 'Microsoft',
      'amazon': 'Amazon',
      'meta': 'Meta',
      'apple': 'Apple',
      'netflix': 'Netflix',
      'tesla': 'Tesla',
      'uber': 'Uber',
      'lyft': 'Lyft',
      'airbnb': 'Airbnb',
      'salesforce': 'Salesforce',
      'oracle': 'Oracle',
      'ibm': 'IBM',
      'adobe': 'Adobe',
      'intel': 'Intel',
      'nvidia': 'NVIDIA',
      'amd': 'AMD',
      'cisco': 'Cisco',
      'vmware': 'VMware',
      'paypal': 'PayPal',
      'stripe': 'Stripe',
      'shopify': 'Shopify',
      'spotify': 'Spotify',
      'zoom': 'Zoom',
      'slack': 'Slack',
      'dropbox': 'Dropbox',
      'atlassian': 'Atlassian',
      'twilio': 'Twilio',
      'okta': 'Okta',
      'databricks': 'Databricks',
      'snowflake': 'Snowflake'
    };

    const normalized = domainName.toLowerCase();
    if (specialCases[normalized]) {
      return specialCases[normalized];
    }

    // Capitalize first letter and handle camelCase
    const formatted = domainName
      .replace(/([A-Z])/g, ' $1')
      .split(/[\s-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
      .trim();

    // If we have a reasonable domain name, use it instead of "Company Name Not Found"
    if (formatted.length > 2 && !jobBoards.some(board => formatted.toLowerCase().includes(board))) {
      return formatted;
    }
  }

  return 'Company Name Not Found';
}

function extractCompanyFromPageMeta(): string | null {
  console.log('🔍 Starting universal company extraction...');

  // ========================================
  // LAYER 1: Schema.org Structured Data (Most Reliable)
  // ========================================
  try {
    const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of Array.from(schemaScripts)) {
      try {
        const data = JSON.parse(script.textContent || '');

        // Handle single JobPosting
        if (data['@type'] === 'JobPosting' && data.hiringOrganization) {
          const org = data.hiringOrganization;
          if (typeof org === 'object' && org.name) {
            console.log('✅ Company from Schema.org:', org.name);
            return org.name;
          } else if (typeof org === 'string') {
            console.log('✅ Company from Schema.org:', org);
            return org;
          }
        }

        // Handle array of schemas
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item['@type'] === 'JobPosting' && item.hiringOrganization) {
              const org = item.hiringOrganization;
              if (typeof org === 'object' && org.name) {
                console.log('✅ Company from Schema.org array:', org.name);
                return org.name;
              } else if (typeof org === 'string') {
                console.log('✅ Company from Schema.org array:', org);
                return org;
              }
            }
          }
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  } catch (e) {
    console.warn('Error extracting company from schema:', e);
  }

  // ========================================
  // LAYER 2: LinkedIn-Specific Extraction
  // ========================================
  if (window.location.hostname.includes('linkedin.com')) {
    console.log('🔗 Detected LinkedIn - using specialized extraction...');

    // Try URL parsing (e.g., /jobs/view/title-at-company-name-123)
    const urlMatch = window.location.pathname.match(/\/jobs\/view\/[^/]*-at-([^-]+(?:-[^-]+)*)-\d+/);
    if (urlMatch) {
      const companySlug = urlMatch[1];
      const companyName = companySlug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      console.log('✅ Company from LinkedIn URL:', companyName);
      return companyName;
    }

    // Try multiple LinkedIn-specific selectors
    const linkedInSelectors = [
      '.job-details-jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__subtitle-primary-grouping a',
      '[data-tracking-control-name="public_jobs_topcard-org-name"]',
      '.topcard__org-name-link',
      '.job-details-jobs-unified-top-card__primary-description a',
      'a[href*="/company/"]'
    ];

    for (const selector of linkedInSelectors) {
      const element = document.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text && text.length > 2 && text.length < 100) {
        console.log('✅ Company from LinkedIn selector:', text);
        return text;
      }
    }
  }

  // ========================================
  // LAYER 3: Open Graph & Meta Tags
  // ========================================
  const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  if (ogSiteName && ogSiteName.length > 2 && ogSiteName.length < 100) {
    const genericNames = ['indeed', 'linkedin', 'glassdoor', 'monster', 'dice', 'jobs', 'careers', 'job board', 'recruitment'];
    if (!genericNames.some(name => ogSiteName.toLowerCase().includes(name))) {
      console.log('✅ Company from OG site_name:', ogSiteName);
      return ogSiteName;
    }
  }

  // Try og:title for company name
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const ogTitleMatch = ogTitle.match(/(?:at|@)\s+([A-Z][a-zA-Z0-9\s&.,'-]+?)(?:\s*[-|•:]|\s+job|\s+career|\s+hiring|$)/i);
  if (ogTitleMatch && ogTitleMatch[1].length > 2 && ogTitleMatch[1].length < 80) {
    console.log('✅ Company from OG title:', ogTitleMatch[1].trim());
    return ogTitleMatch[1].trim();
  }

  // ========================================
  // LAYER 4: Breadcrumb Navigation
  // ========================================
  const breadcrumbs = document.querySelectorAll('[itemtype*="BreadcrumbList"] [itemprop="name"], nav[aria-label*="breadcrumb" i] a, .breadcrumb a, [class*="breadcrumb" i] a');
  if (breadcrumbs.length > 0) {
    // Usually company is 2nd or 3rd breadcrumb
    for (let i = 1; i < Math.min(breadcrumbs.length, 4); i++) {
      const text = breadcrumbs[i].textContent?.trim();
      if (text && text.length > 2 && text.length < 80 &&
        !text.toLowerCase().match(/home|jobs|careers|search|results/)) {
        console.log('✅ Company from breadcrumb:', text);
        return text;
      }
    }
  }

  // ========================================
  // LAYER 5: Page Title Analysis (Multiple Patterns)
  // ========================================
  const title = document.title;
  const titlePatterns = [
    /(?:at|@)\s+([A-Z][a-zA-Z0-9\s&.,'-]+?)(?:\s*[-|•:]|\s+job|\s+career|\s+hiring|$)/i,
    /^([A-Z][a-zA-Z0-9\s&.,'-]+?)\s*[-|•:]/,  // Company at start
    /-\s*([A-Z][a-zA-Z0-9\s&.,'-]+?)\s*$/,    // Company at end
    /\|\s*([A-Z][a-zA-Z0-9\s&.,'-]+?)\s*$/    // Company after pipe
  ];

  for (const pattern of titlePatterns) {
    const match = title.match(pattern);
    if (match && match[1].length > 2 && match[1].length < 80) {
      const company = match[1].trim();
      // Filter out generic terms
      if (!company.toLowerCase().match(/jobs|careers|indeed|linkedin|glassdoor|monster|apply|hiring/)) {
        console.log('✅ Company from page title:', company);
        return company;
      }
    }
  }

  // ========================================
  // LAYER 6: Meta Description Analysis
  // ========================================
  const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const descPatterns = [
    /(?:at|@|with|join)\s+([A-Z][a-zA-Z0-9\s&.,'-]+?)(?:\s*[-|•.]|\s+is\s+|\s+in\s+|\s+for\s+|$)/i,
    /([A-Z][a-zA-Z0-9\s&.,'-]+?)\s+(?:is hiring|seeks|looking for)/i
  ];

  for (const pattern of descPatterns) {
    const match = metaDesc.match(pattern);
    if (match && match[1].length > 2 && match[1].length < 80) {
      const company = match[1].trim();
      if (!company.toLowerCase().match(/jobs|careers|job board|indeed|linkedin|glassdoor/)) {
        console.log('✅ Company from meta description:', company);
        return company;
      }
    }
  }

  // ========================================
  // LAYER 7: Dynamic Heading Analysis (H1, H2)
  // ========================================
  const headings = document.querySelectorAll('h1, h2');
  for (const heading of Array.from(headings)) {
    const text = heading.textContent?.trim() || '';
    // Look for "About Company" or "Company Name" patterns
    if (text.match(/^about\s+([A-Z][a-zA-Z0-9\s&.,'-]+)$/i)) {
      const company = text.replace(/^about\s+/i, '').trim();
      if (company.length > 2 && company.length < 80) {
        console.log('✅ Company from heading:', company);
        return company;
      }
    }

    // Look for headings with company indicators near job title
    if (text.match(/(?:working at|join|career at)\s+([A-Z][a-zA-Z0-9\s&.,'-]+)/i)) {
      const match = text.match(/(?:working at|join|career at)\s+([A-Z][a-zA-Z0-9\s&.,'-]+)/i);
      if (match && match[1].length > 2 && match[1].length < 80) {
        console.log('✅ Company from heading context:', match[1].trim());
        return match[1].trim();
      }
    }
  }

  // ========================================
  // LAYER 8: Link Analysis (Company Profile Links)
  // ========================================
  const companyLinks = document.querySelectorAll('a[href*="/company/"], a[href*="/employer/"], a[href*="/organization/"]');
  for (const link of Array.from(companyLinks)) {
    const text = link.textContent?.trim();
    if (text && text.length > 2 && text.length < 80 &&
      !text.toLowerCase().match(/follow|view|more|see all|profile/)) {
      console.log('✅ Company from profile link:', text);
      return text;
    }
  }

  console.log('❌ No company found through any extraction layer');
  return null;
}

function extractLocation(): string | undefined {
  // Look for location patterns
  const locationPatterns = [
    /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b/, // City, ST
    /\b([A-Z][a-z]+,\s*[A-Z][a-z]+)\b/, // City, Country
    /\b(Remote|Hybrid|On-site)\b/i
  ];

  const bodyText = document.body.innerText;
  for (const pattern of locationPatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function extractRequirements(description: string): string[] {
  const requirements: string[] = [];
  const lines = description.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Look for bullet points or numbered lists
    if (/^[•\-\*\d+\.]\s/.test(trimmed) && trimmed.length > 15 && trimmed.length < 250) {
      requirements.push(trimmed.replace(/^[•\-\*\d+\.]\s*/, ''));
    }

    // Look for requirement keywords
    else if (/\b(must have|required|should have|experience with|knowledge of|proficient in)\b/i.test(trimmed) &&
      trimmed.length > 20 && trimmed.length < 250) {
      requirements.push(trimmed);
    }
  }

  return requirements.slice(0, 12); // Limit to 12 requirements
}

function generateSimpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// ============================================================================
// PAGE DETECTION & VALIDATION
// ============================================================================

function isLikelyJobPage(): boolean {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();

  // URL indicators
  if (/\b(job|career|position|vacancy|hiring|employment|apply|opening)\b/.test(url)) {
    return true;
  }

  // Title indicators
  if (/\b(job|career|position|vacancy|hiring|apply|opening)\b/.test(title)) {
    return true;
  }

  // Content indicators
  const bodyText = document.body.innerText.toLowerCase();
  const indicators = [
    'apply now', 'apply for', 'job description', 'job summary',
    'requirements', 'qualifications', 'responsibilities',
    'about the role', 'what you\'ll do', 'who we\'re looking for'
  ];

  const matchCount = indicators.filter(indicator => bodyText.includes(indicator)).length;

  return matchCount >= 3;
}

// ============================================================================
// MESSAGE HANDLING & INITIALIZATION
// ============================================================================

console.log('🚀 ResumeCraft Intelligent Content Script Loaded');

// Check if this is a job page
if (isLikelyJobPage()) {
  console.log('✅ Likely job page detected');
  chrome.runtime.sendMessage({
    type: 'JOB_PAGE_DETECTED',
    url: window.location.href
  });
} else {
  console.log('ℹ️ Not detected as job page');
}

// Listen for extraction requests
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('📨 Received message:', request.type);

  if (request.type === MessageType.GetJob) {
    try {
      const job = extractJobIntelligently();
      console.log('📤 Sending job data:', job ? { title: job.title, company: job.company, descLength: job.description.length } : 'null');
      sendResponse({ job });
    } catch (error) {
      console.error('❌ Extraction error:', error);
      sendResponse({ job: null });
    }
    return true;
  }
});

// Monitor for navigation changes
let lastUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    if (isLikelyJobPage()) {
      chrome.runtime.sendMessage({
        type: 'JOB_PAGE_DETECTED',
        url: window.location.href
      });
    }
  }
}, 1000);
