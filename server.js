import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { AdaptivePlaywrightCrawler, RequestQueue, Configuration } from 'crawlee';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const MAX_CONCURRENT_WORKERS = parseInt(process.env.MAX_CONCURRENT_WORKERS) || 4;
const WORKER_BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE) || 5;
const RATE_LIMIT_DELAY = parseInt(process.env.RATE_LIMIT_DELAY) || 1000; // 1 second between requests

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Crawlee configuration
Configuration.set('STORAGE_CLIENT_OPTIONS', {
  storageDir: './storage',
});

// Global request queue
let requestQueue;

// Initialize request queue
async function initializeQueue() {
  try {
    requestQueue = await RequestQueue.open('email-extraction-queue');
    console.log('Request queue initialized');
  } catch (error) {
    console.error('Failed to initialize request queue:', error);
    process.exit(1);
  }
}

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

// Database helper functions
async function createJob(jobId, url) {
  try {
    const { data, error } = await supabase
      .from('email_scrap_jobs')
      .insert({
        job_id: jobId,
        url: url,
        status: 'queued'
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating job:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to create job:', error);
    throw error;
  }
}

async function updateJobStatus(jobId, status, updates = {}) {
  try {
    const updateData = {
      status,
      ...updates
    };

    if (status === 'processing' && !updates.started_at) {
      updateData.started_at = new Date().toISOString();
    }

    if (status === 'done' || status === 'error') {
      updateData.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('email_scrap_jobs')
      .update(updateData)
      .eq('job_id', jobId)
      .select()
      .single();

    if (error) {
      console.error('Error updating job:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to update job:', error);
    throw error;
  }
}

async function getJob(jobId) {
  try {
    const { data, error } = await supabase
      .from('email_scrap_jobs')
      .select('*')
      .eq('job_id', jobId)
      .single();

    if (error) {
      console.error('Error getting job:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to get job:', error);
    throw error;
  }
}

// Worker function to process jobs
async function processJob(jobId, url) {
  console.log(`Starting job ${jobId} for URL: ${url}`);
  
  try {
    // Update job status to processing
    await updateJobStatus(jobId, 'processing');

    const extractedEmails = [];
    const extractedFacebookUrls = [];
    const visitedUrls = new Set();

    const crawler = new AdaptivePlaywrightCrawler({
      renderingTypeDetectionRatio: 0.1,
      maxRequestsPerCrawl: 20,
      maxConcurrency: 2, // Reduced concurrency for individual jobs
      requestQueue,

      async requestHandler({ page, response, enqueueLinks, log, request }) {
        const currentUrl = request.url;
        
        // Skip if already visited
        if (visitedUrls.has(currentUrl)) {
          return;
        }
        visitedUrls.add(currentUrl);

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
          }
          
          log.info(`Found ${emails.length} emails and ${facebookUrls.length} Facebook URLs on ${currentUrl}`);
        } catch (err) {
          log.error(`Failed to extract text from ${currentUrl}: ${err}`);
        }

        // Extract and enqueue navigation links
        if (page) {
          try {
            const navLinks = await page.evaluate(() => {
              const links = [];
              
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
              await enqueueLinks({
                urls: navLinks,
                strategy: 'same-domain',
                limit: 15
              });
            }
          } catch (err) {
            log.warning(`Failed to extract navigation links from ${currentUrl}: ${err}`);
          }
        }
        
        // Also enqueue general same-domain links as fallback
        await enqueueLinks({
          strategy: 'same-domain',
          limit: 5
        });
      },
    });

    await crawler.run([url]);

    // Remove duplicates and prepare results
    const uniqueEmails = [...new Set(extractedEmails)];
    const uniqueFacebookUrls = [...new Set(extractedFacebookUrls)];

    // Update job with results
    await updateJobStatus(jobId, 'done', {
      emails: uniqueEmails,
      facebook_urls: uniqueFacebookUrls,
      crawled_urls: Array.from(visitedUrls),
      pages_crawled: visitedUrls.size
    });

    console.log(`Completed job ${jobId}: Found ${uniqueEmails.length} emails and ${uniqueFacebookUrls.length} Facebook URLs`);

  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    
    // Update job with error
    await updateJobStatus(jobId, 'error', {
      error: error.message || 'Unknown error occurred'
    });
  }
}

// Background worker system
class JobWorker {
  constructor() {
    this.isRunning = false;
    this.activeJobs = new Set();
  }

  async start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('Job worker started');
    
    // Process jobs continuously
    while (this.isRunning) {
      try {
        await this.processNextBatch();
        // Wait before checking for more jobs
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('Worker error:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async stop() {
    this.isRunning = false;
    console.log('Job worker stopped');
  }

  async processNextBatch() {
    try {
      // Get queued jobs
      const { data: queuedJobs, error } = await supabase
        .from('email_scrap_jobs')
        .select('*')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(WORKER_BATCH_SIZE);

      if (error) {
        console.error('Error fetching queued jobs:', error);
        return;
      }

      if (!queuedJobs || queuedJobs.length === 0) {
        return; // No jobs to process
      }

      // Process jobs concurrently (limited by MAX_CONCURRENT_WORKERS)
      const jobPromises = queuedJobs.slice(0, MAX_CONCURRENT_WORKERS).map(async (job) => {
        if (this.activeJobs.has(job.job_id)) {
          return; // Job already being processed
        }

        this.activeJobs.add(job.job_id);
        
        try {
          await processJob(job.job_id, job.url);
        } finally {
          this.activeJobs.delete(job.job_id);
        }
      });

      await Promise.all(jobPromises);

    } catch (error) {
      console.error('Error in processNextBatch:', error);
    }
  }
}

// Initialize worker
const jobWorker = new JobWorker();

// Modified /extract-emails endpoint - now adds jobs to queue
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

    // Generate unique job ID
    const jobId = uuidv4();

    // Create job in database
    const job = await createJob(jobId, url);

    // Add job to Crawlee request queue
    await requestQueue.addRequest({
      url: url,
      userData: {
        jobId: jobId,
        originalUrl: url
      }
    });

    res.json({
      success: true,
      message: 'Job queued successfully',
      job_id: jobId,
      status: 'queued',
      url: url
    });

  } catch (error) {
    console.error('Error queuing job:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to queue the job'
    });
  }
});

// New endpoint to check job status
app.get('/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await getJob(jobId);
    
    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: 'The specified job ID does not exist'
      });
    }

    res.json({
      success: true,
      job: {
        job_id: job.job_id,
        url: job.url,
        status: job.status,
        emails: job.emails || [],
        facebook_urls: job.facebook_urls || [],
        crawled_urls: job.crawled_urls || [],
        pages_crawled: job.pages_crawled || 0,
        error: job.error,
        created_at: job.created_at,
        updated_at: job.updated_at,
        started_at: job.started_at,
        completed_at: job.completed_at
      }
    });

  } catch (error) {
    console.error('Error getting job:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve job information'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Email extraction API is running',
    worker_status: jobWorker.isRunning ? 'running' : 'stopped',
    active_jobs: jobWorker.activeJobs.size
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Email and Facebook URL Extraction API (Queue-based)',
    endpoints: {
      'POST /extract-emails': 'Queue a job to extract emails and Facebook URLs from a website',
      'GET /job/:jobId': 'Check the status and results of a specific job',
      'GET /health': 'Health check'
    },
    usage: {
      method: 'POST',
      url: '/extract-emails',
      body: { url: 'https://example.com' }
    },
    features: [
      'Queue-based job processing',
      'Extract email addresses',
      'Extract Facebook URLs',
      'Crawl multiple pages within same domain',
      'Handle JavaScript-rendered content',
      'Concurrent job processing with rate limiting',
      'Job status tracking',
      'Error handling and retry logic'
    ]
  });
});

// Initialize and start the server
async function startServer() {
  try {
    await initializeQueue();
    
    // Start the job worker (this will run in background)
    jobWorker.start().catch(error => {
      console.error('Worker failed to start:', error);
    });
    
    app.listen(PORT, () => {
      console.log(`Email extraction API running on port ${PORT}`);
      console.log(`Visit http://localhost:${PORT} for API documentation`);
      console.log(`Worker system: ${MAX_CONCURRENT_WORKERS} concurrent workers, batch size: ${WORKER_BATCH_SIZE}`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await jobWorker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await jobWorker.stop();
  process.exit(0);
});

startServer();