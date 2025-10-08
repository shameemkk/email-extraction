import express from 'express';
import cors from 'cors';
import { AdaptivePlaywrightCrawler } from 'crawlee';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Email extraction function - works with HTML content
function extractEmails(html) {
  const emails = [];
  
  // Extract emails from mailto: href attributes
  const mailtoRegex = /href=["']mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']/gi;
  const mailtoMatches = html.matchAll(mailtoRegex);
  for (const match of mailtoMatches) {
    emails.push(match[1]);
  }
  
  // Extract emails from plain text (after removing HTML tags)
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const textEmails = textContent.match(emailRegex) || [];
  emails.push(...textEmails);
  
  return [...new Set(emails)]; // Remove duplicates
}

// Facebook URL extraction function - improved to avoid false links
function extractFacebookUrls(text) {
  // More precise Facebook URL regex that avoids false matches
  const facebookRegex = /(?:https?:\/\/)?(?:www\.)?(?:facebook\.com|fb\.com)\/(?:profile\.php\?id=\d+|pages\/[a-zA-Z0-9._-]+|groups\/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]{2,})(?:\/[a-zA-Z0-9._-]+)*/gi;
  const facebookUrls = text.match(facebookRegex) || [];
  
  // Filter out common false positives and clean URLs
  const filteredUrls = facebookUrls.filter(url => {
    // Clean the URL and remove any trailing slashes or unwanted characters
    let cleanUrl = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
    cleanUrl = cleanUrl.replace(/\/+$/, ''); // Remove trailing slashes
    cleanUrl = cleanUrl.replace(/\\+/g, ''); // Remove backslashes
    
    const pathPart = cleanUrl.split('/')[1] || '';
    
    // Skip if path is too short (likely not a real profile/page)
    if (pathPart.length < 2) return false;
    
    // Skip common non-profile paths
    const skipPatterns = ['home', 'login', 'register', 'help', 'privacy', 'terms', 'cookies', 'settings'];
    if (skipPatterns.includes(pathPart.toLowerCase())) return false;
    
    // Skip URLs with backslashes or other invalid characters
    if (cleanUrl.includes('\\') || cleanUrl.includes('//')) return false;
    
    return true;
  });
  
  // Clean up the final URLs
  const finalUrls = filteredUrls.map(url => {
    return url.replace(/\\+/g, '').replace(/\/+$/, '');
  });
  
  return [...new Set(finalUrls)]; // Remove duplicates
}

// Express endpoint for email extraction
app.post('/extract-emails', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        error: 'URL is required',
        message: 'Please provide a URL in the request body'
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({ 
        error: 'Invalid URL format',
        message: 'Please provide a valid URL'
      });
    }

    const extractedEmails = [];
    const extractedFacebookUrls = [];
    const visitedUrls = new Set();
    const allTexts = [];

    const crawler = new AdaptivePlaywrightCrawler({
      renderingTypeDetectionRatio: 0.1,
      maxRequestsPerCrawl: 20, // Increased limit for better navigation coverage
      maxConcurrency: 3, // Allow some parallel processing

      async requestHandler({ page, response, enqueueLinks, log, request }) {
        const currentUrl = request.url;
        
        // Skip if already visited
        if (visitedUrls.has(currentUrl)) {
          return;
        }
        visitedUrls.add(currentUrl);

        let fullText = '';

        try {
          let emails = [];
          let facebookUrls = [];
          let htmlContent = '';
          
          if (page) {
            // Get HTML content for extraction
            htmlContent = await page.evaluate(() => {
              return document.documentElement.outerHTML;
            });
            
            // Extract emails from HTML content
            emails = extractEmails(htmlContent);
            extractedEmails.push(...emails);
            
            // Only extract Facebook URLs if no emails were found
            if (emails.length === 0) {
              facebookUrls = extractFacebookUrls(htmlContent);
              extractedFacebookUrls.push(...facebookUrls);
            }
            
            // Get visible text for response (without HTML replacement)
            fullText = await page.evaluate(() => {
              return document.body.innerText;
            });
            
          } else if (response) {
            // If rendering was skipped (straight HTTP), use the raw HTML
            const html = await response.text();
            htmlContent = html;
            
            // Extract emails from HTML content
            emails = extractEmails(htmlContent);
            extractedEmails.push(...emails);
            
            // Only extract Facebook URLs if no emails were found
            if (emails.length === 0) {
              facebookUrls = extractFacebookUrls(htmlContent);
              extractedFacebookUrls.push(...facebookUrls);
            }
            
            // Get visible text for response (without HTML replacement)
            fullText = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                           .replace(/<style[\s\S]*?<\/style>/gi, '')
                           .replace(/<\/?[^>]+>/gi, ' ')
                           .replace(/\s+/g, ' ')
                           .trim();
          }
          
          // Store the text for response
          allTexts.push({
            url: currentUrl,
            text: fullText
          });

          log.info(`Found ${emails.length} emails and ${facebookUrls.length} Facebook URLs on ${currentUrl}`);
        } catch (err) {
          log.error(`Failed to extract text from ${currentUrl}: ${err}`);
        }

        // Extract and enqueue navigation links and common pages
        if (page) {
          try {
            // Get navigation links from common selectors
            const navLinks = await page.evaluate(() => {
              const links = [];
              
              // Common navigation selectors
              const navSelectors = [
                'nav a', 'header a', '.navbar a', '.nav a', '.navigation a',
                '.menu a', '.main-menu a', '.primary-menu a', '.top-menu a',
                '[role="navigation"] a', '.site-nav a', '.main-nav a'
              ];
              
              navSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                  const href = el.getAttribute('href');
                  if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                    links.push(href);
                  }
                });
              });
              
              return links;
            });
            
            // Add specific common pages to crawl
            const baseUrl = new URL(currentUrl);
            const commonPages = ['/about/', '/contact/', '/about', '/contact', '/about-us/', '/contact-us/'];
            
            commonPages.forEach(page => {
              try {
                const fullUrl = new URL(page, baseUrl.origin).href;
                navLinks.push(fullUrl);
              } catch (e) {
                // Skip invalid URLs
              }
            });
            
            // Enqueue navigation links
            if (navLinks.length > 0) {
              log.info(`Found ${navLinks.length} navigation links on ${currentUrl}:`, navLinks.slice(0, 5)); // Log first 5 links
              await enqueueLinks({
                urls: navLinks,
                strategy: 'same-domain',
                limit: 15 // Increased limit for better coverage
              });
            }
          } catch (err) {
            log.warning(`Failed to extract navigation links from ${currentUrl}: ${err}`);
          }
        }
        
        // Also enqueue general same-domain links as fallback
        await enqueueLinks({
          strategy: 'same-domain',
          limit: 5 // Reduced since we're doing targeted navigation above
        });
      },
    });

    await crawler.run([url]);

    // Remove duplicates and return results
    const uniqueEmails = [...new Set(extractedEmails)];
    const uniqueFacebookUrls = [...new Set(extractedFacebookUrls)];

    // Build response object
    const response = {
      success: true,
      url: url,
      emailsFound: uniqueEmails.length,
      emails: uniqueEmails,
      pagesCrawled: visitedUrls.size,
      crawledUrls: Array.from(visitedUrls),
      // extractedTexts: allTexts
    };

    // Only include Facebook URLs if no emails were found
    if (uniqueEmails.length === 0) {
      response.facebookUrlsFound = uniqueFacebookUrls.length;
      response.facebookUrls = uniqueFacebookUrls;
    }

    res.json(response);

  } catch (error) {
    console.error('Error during email extraction:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to extract emails from the provided URL'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Email extraction API is running' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Email and Facebook URL Extraction API',
    endpoints: {
      'POST /extract-emails': 'Extract emails and Facebook URLs from a website',
      'GET /health': 'Health check'
    },
    usage: {
      method: 'POST',
      url: '/extract-emails',
      body: { url: 'https://example.com' }
    },
    features: [
      'Extract email addresses',
      'Extract Facebook URLs (including profile.php?id=, /tr, pages, groups)',
      'Extract Facebook URLs from script tags and JavaScript code (only if no emails found)',
      'Crawl multiple pages within same domain',
      'Handle JavaScript-rendered content',
      'Conditional script analysis: only analyzes scripts when no emails are found in visible content'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Email extraction API running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} for API documentation`);
});
