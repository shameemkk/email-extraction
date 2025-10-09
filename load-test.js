import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

// Load testing script for the queue-based email extraction API
const API_BASE_URL = 'http://localhost:3000';

// Test URLs for load testing
const TEST_URLS = [
  'https://example.com',
  'https://httpbin.org',
  'https://jsonplaceholder.typicode.com',
  'https://httpstat.us',
  'https://httpbin.org/html',
  'https://httpbin.org/json',
  'https://httpbin.org/xml',
  'https://httpbin.org/robots.txt',
  'https://httpbin.org/user-agent',
  'https://httpbin.org/headers'
];

class LoadTester {
  constructor() {
    this.results = [];
    this.jobIds = [];
  }

  async createJob(url, index) {
    const startTime = performance.now();
    
    try {
      const response = await fetch(`${API_BASE_URL}/extract-emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url })
      });

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      if (response.ok) {
        const result = await response.json();
        this.jobIds.push(result.job_id);
        
        this.results.push({
          index,
          url,
          jobId: result.job_id,
          status: 'queued',
          responseTime,
          success: true,
          timestamp: new Date().toISOString()
        });

        console.log(`✓ Job ${index + 1} created: ${result.job_id} (${responseTime.toFixed(2)}ms)`);
        return result.job_id;
      } else {
        const error = await response.text();
        this.results.push({
          index,
          url,
          status: 'failed',
          responseTime,
          success: false,
          error: error,
          timestamp: new Date().toISOString()
        });
        
        console.log(`✗ Job ${index + 1} failed: ${response.status} - ${error}`);
        return null;
      }
    } catch (error) {
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      
      this.results.push({
        index,
        url,
        status: 'error',
        responseTime,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✗ Job ${index + 1} error: ${error.message}`);
      return null;
    }
  }

  async createConcurrentJobs(concurrency = 100) {
    console.log(`\n🚀 Starting load test with ${concurrency} concurrent requests...\n`);
    
    const startTime = performance.now();
    
    // Create batches to avoid overwhelming the server
    const batchSize = 50;
    const batches = [];
    
    for (let i = 0; i < concurrency; i += batchSize) {
      const batch = [];
      for (let j = i; j < Math.min(i + batchSize, concurrency); j++) {
        const url = TEST_URLS[j % TEST_URLS.length];
        batch.push(this.createJob(url, j));
      }
      batches.push(batch);
    }

    // Process batches with small delays
    for (const batch of batches) {
      await Promise.all(batch);
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    console.log(`\n📊 Load Test Results:`);
    console.log(`Total requests: ${concurrency}`);
    console.log(`Successful requests: ${this.results.filter(r => r.success).length}`);
    console.log(`Failed requests: ${this.results.filter(r => !r.success).length}`);
    console.log(`Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`Average response time: ${(this.results.reduce((sum, r) => sum + r.responseTime, 0) / this.results.length).toFixed(2)}ms`);
    console.log(`Requests per second: ${(concurrency / (totalTime / 1000)).toFixed(2)}`);

    return this.jobIds;
  }

  async monitorJobs() {
    console.log(`\n🔍 Monitoring ${this.jobIds.length} jobs...\n`);
    
    let completedJobs = 0;
    let errorJobs = 0;
    const maxChecks = 60; // 5 minutes max
    let checkCount = 0;

    const checkJobs = async () => {
      checkCount++;
      console.log(`\nCheck ${checkCount}/${maxChecks}:`);
      
      const statusPromises = this.jobIds.map(async (jobId) => {
        try {
          const response = await fetch(`${API_BASE_URL}/job/${jobId}`);
          const result = await response.json();
          return { jobId, ...result.job };
        } catch (error) {
          console.error(`Failed to get status for job ${jobId}:`, error.message);
          return null;
        }
      });

      const jobStatuses = await Promise.all(statusPromises);
      const validStatuses = jobStatuses.filter(status => status !== null);

      const statusCounts = {
        queued: 0,
        processing: 0,
        done: 0,
        error: 0
      };

      validStatuses.forEach(job => {
        statusCounts[job.status]++;
        if (job.status === 'done') completedJobs++;
        if (job.status === 'error') errorJobs++;
      });

      console.log(`Status: Queued: ${statusCounts.queued}, Processing: ${statusCounts.processing}, Done: ${statusCounts.done}, Error: ${statusCounts.error}`);

      // Check if all jobs are complete or we've reached max checks
      const allComplete = validStatuses.every(job => 
        job.status === 'done' || job.status === 'error'
      );

      if (allComplete) {
        console.log(`\n✅ All jobs completed!`);
        console.log(`Completed: ${completedJobs}, Errors: ${errorJobs}`);
        return;
      }

      if (checkCount >= maxChecks) {
        console.log(`\n⏰ Monitoring timeout reached`);
        console.log(`Completed: ${completedJobs}, Errors: ${errorJobs}, Still processing: ${validStatuses.length - completedJobs - errorJobs}`);
        return;
      }

      // Continue monitoring
      setTimeout(checkJobs, 5000);
    };

    // Start monitoring after 2 seconds
    setTimeout(checkJobs, 2000);
  }

  async testHealthEndpoint() {
    console.log('🏥 Testing health endpoint...');
    
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      const result = await response.json();
      console.log('Health check:', result);
      return result;
    } catch (error) {
      console.error('Health check failed:', error.message);
      return null;
    }
  }

  async runLoadTest(concurrency = 100) {
    console.log('🧪 Starting Load Test Suite\n');
    
    // Test health endpoint first
    const health = await this.testHealthEndpoint();
    if (!health) {
      console.log('❌ Server is not running. Please start the server first.');
      return;
    }

    console.log(`\n📈 Server Status: ${health.status}`);
    console.log(`Worker Status: ${health.worker_status}`);
    console.log(`Active Jobs: ${health.active_jobs}\n`);

    // Run load test
    const jobIds = await this.createConcurrentJobs(concurrency);
    
    if (jobIds.length > 0) {
      // Monitor job progress
      await this.monitorJobs();
    }

    console.log('\n🎯 Load test completed!');
  }
}

// Run the load test
async function main() {
  const concurrency = process.argv[2] ? parseInt(process.argv[2]) : 100;
  
  if (isNaN(concurrency) || concurrency < 1) {
    console.log('Usage: node load-test.js [concurrency]');
    console.log('Example: node load-test.js 100');
    return;
  }

  const loadTester = new LoadTester();
  await loadTester.runLoadTest(concurrency);
}

main().catch(console.error);

