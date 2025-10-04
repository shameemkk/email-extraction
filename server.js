import express from 'express';
import cors from 'cors';
import { AdaptivePlaywrightCrawler } from 'crawlee';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Email extraction function
function extractEmails(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = text.match(emailRegex) || [];
  return [...new Set(emails)]; // Remove duplicates
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
    const visitedUrls = new Set();

    const crawler = new AdaptivePlaywrightCrawler({
      renderingTypeDetectionRatio: 0.1,
      maxRequestsPerCrawl: 10, // Limit to prevent excessive crawling

      async requestHandler({ page, response, enqueueLinks, log, request }) {
        const currentUrl = request.url;
        
        // Skip if already visited
        if (visitedUrls.has(currentUrl)) {
          return;
        }
        visitedUrls.add(currentUrl);

        let fullText = '';

        try {
          if (page) {
            // If page is defined, we rendered JS — extract the full visible text
            fullText = await page.evaluate(() => {
              // This gets visible text from document body
              return document.body.innerText;
            });
          } else if (response) {
            // If rendering was skipped (straight HTTP), use the raw HTML
            const html = await response.text();
            // Remove tags, scripts etc. (simple approach)
            fullText = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                           .replace(/<style[\s\S]*?<\/style>/gi, '')
                           .replace(/<\/?[^>]+>/gi, ' ')
                           .replace(/\s+/g, ' ')
                           .trim();
          }

          // Extract emails from the text
          const emails = extractEmails(fullText);
          extractedEmails.push(...emails);

          log.info(`Found ${emails.length} emails on ${currentUrl}`);
        } catch (err) {
          log.error(`Failed to extract text from ${currentUrl}: ${err}`);
        }

        // Optionally enqueue more links (limited to same domain)
        await enqueueLinks({
          strategy: 'same-domain',
          limit: 10 // Limit additional pages
        });
      },
    });

    await crawler.run([url]);

    // Remove duplicates and return results
    const uniqueEmails = [...new Set(extractedEmails)];

    res.json({
      fullText: fullText,
      success: true,
      url: url,
      emailsFound: uniqueEmails.length,
      emails: uniqueEmails,
      pagesCrawled: visitedUrls.size,
      crawledUrls: Array.from(visitedUrls)
    });

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
    message: 'Email Extraction API',
    endpoints: {
      'POST /extract-emails': 'Extract emails from a website',
      'GET /health': 'Health check'
    },
    usage: {
      method: 'POST',
      url: '/extract-emails',
      body: { url: 'https://example.com' }
    }
  });
});

app.listen(PORT, () => {
  console.log(`Email extraction API running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} for API documentation`);
});
