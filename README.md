# Email Extraction API - Queue-Based System

A robust, queue-based email and Facebook URL extraction API built with Express.js, Crawlee, and Supabase. This system is designed to handle high concurrent loads without crashing by processing jobs asynchronously.

## Features

- **Queue-based Processing**: Jobs are queued instead of processed immediately
- **Concurrent Workers**: Configurable number of workers (default: 4 concurrent workers)
- **Rate Limiting**: Built-in rate limiting to prevent server overload
- **Job Status Tracking**: Real-time job status updates in Supabase
- **Error Handling**: Comprehensive error handling with retry logic
- **Scalable**: Can handle 1000+ simultaneous requests without crashing

## Architecture

```
Client Request → /extract-emails → Queue Job → Background Workers → Supabase Storage
                     ↓
              Return Job ID → Client polls /job/:jobId for results
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Set up Supabase

1. Create a new Supabase project
2. Run the SQL schema from `supabase-schema.sql` in your Supabase SQL editor
3. Get your project URL and anon key from Supabase dashboard

### 3. Environment Configuration

Create a `.env` file based on `env.example`:

```bash
cp env.example .env
```

Update the `.env` file with your Supabase credentials:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
MAX_CONCURRENT_WORKERS=4
WORKER_BATCH_SIZE=5
RATE_LIMIT_DELAY=1000
PORT=3000
```

### 4. Start the Server

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## API Endpoints

### POST /extract-emails

Queue a job to extract emails and Facebook URLs from a website.

**Request:**
```json
{
  "url": "https://example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Job queued successfully",
  "job_id": "uuid-here",
  "status": "queued",
  "url": "https://example.com"
}
```

### GET /job/:jobId

Check the status and results of a specific job.

**Response:**
```json
{
  "success": true,
  "job": {
    "job_id": "uuid-here",
    "url": "https://example.com",
    "status": "done",
    "emails": ["contact@example.com", "info@example.com"],
    "facebook_urls": ["facebook.com/example"],
    "crawled_urls": ["https://example.com", "https://example.com/about"],
    "pages_crawled": 2,
    "error": null,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:05:00Z",
    "started_at": "2024-01-01T00:01:00Z",
    "completed_at": "2024-01-01T00:05:00Z"
  }
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "OK",
  "message": "Email extraction API is running",
  "worker_status": "running",
  "active_jobs": 2
}
```

## Job Statuses

- `queued`: Job is waiting to be processed
- `processing`: Job is currently being processed
- `done`: Job completed successfully
- `error`: Job failed with an error

## Configuration Options

### Environment Variables

- `MAX_CONCURRENT_WORKERS`: Maximum number of concurrent workers (default: 4)
- `WORKER_BATCH_SIZE`: Number of jobs to fetch per batch (default: 5)
- `RATE_LIMIT_DELAY`: Delay between requests in milliseconds (default: 1000)
- `PORT`: Server port (default: 3000)

### Database Schema

The `email_scrap_jobs` table includes:

- `job_id`: Unique identifier for the job
- `url`: Target URL to scrape
- `status`: Current job status
- `emails`: Extracted email addresses (JSON array)
- `facebook_urls`: Extracted Facebook URLs (JSON array)
- `crawled_urls`: All URLs that were crawled (JSON array)
- `pages_crawled`: Number of pages crawled
- `error`: Error message if job failed
- `retry_count`: Number of retry attempts
- `max_retries`: Maximum retry attempts allowed
- `created_at`, `updated_at`, `started_at`, `completed_at`: Timestamps

## Usage Example

```javascript
// Queue a job
const response = await fetch('http://localhost:3000/extract-emails', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://example.com'
  })
});

const { job_id } = await response.json();

// Poll for results
const checkJob = async () => {
  const jobResponse = await fetch(`http://localhost:3000/job/${job_id}`);
  const { job } = await jobResponse.json();
  
  if (job.status === 'done') {
    console.log('Emails found:', job.emails);
    console.log('Facebook URLs found:', job.facebook_urls);
  } else if (job.status === 'error') {
    console.error('Job failed:', job.error);
  } else {
    // Still processing, check again in 5 seconds
    setTimeout(checkJob, 5000);
  }
};

checkJob();
```

## Performance Characteristics

- **Concurrency**: Handles 1000+ simultaneous requests by queuing them
- **Memory Efficient**: Jobs are processed in batches to prevent memory overflow
- **Rate Limited**: Built-in delays prevent overwhelming target websites
- **Fault Tolerant**: Failed jobs are tracked and can be retried
- **Scalable**: Worker count can be adjusted based on server capacity

## Load Testing

The system includes comprehensive load testing tools to verify it can handle high concurrent loads.

### Basic Load Test

```bash
npm run load-test
```

This will test the system with 100 concurrent requests by default.

### Custom Load Test

```bash
node load-test.js 1000
```

This will test with 1000 concurrent requests.

### Load Test Features

- **Concurrent Request Testing**: Tests multiple simultaneous job creation requests
- **Job Monitoring**: Tracks job progress from queued to completion
- **Performance Metrics**: Measures response times and throughput
- **Error Tracking**: Monitors failed requests and job errors
- **Batch Processing**: Processes requests in batches to avoid overwhelming the server

### Load Test Results

The load test provides detailed metrics:
- Total requests sent
- Successful vs failed requests
- Average response time
- Requests per second
- Job completion rates
- Error rates

## Monitoring

The `/health` endpoint provides real-time information about:
- Server status
- Worker status
- Number of active jobs

Monitor this endpoint to ensure the system is running smoothly under load.

### Performance Expectations

With the default configuration (4 concurrent workers):
- **Concurrent Requests**: Can handle 1000+ simultaneous job creation requests
- **Job Processing**: Processes jobs at ~4-8 jobs per minute (depending on website complexity)
- **Memory Usage**: Stable memory usage even under high load
- **Error Rate**: <1% error rate under normal conditions