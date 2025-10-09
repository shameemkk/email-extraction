import fetch from 'node-fetch';

// Test script for the queue-based email extraction API
const API_BASE_URL = 'http://localhost:3000';

async function testConcurrentRequests() {
  console.log('Testing concurrent requests...');
  
  const testUrls = [
    'https://example.com',
    'https://httpbin.org',
    'https://jsonplaceholder.typicode.com',
    'https://httpstat.us',
    'https://httpbin.org/html'
  ];

  // Create multiple jobs simultaneously
  const jobPromises = testUrls.map(async (url, index) => {
    try {
      console.log(`Creating job ${index + 1} for ${url}`);
      const response = await fetch(`${API_BASE_URL}/extract-emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url })
      });

      const result = await response.json();
      console.log(`Job ${index + 1} created:`, result.job_id);
      return result.job_id;
    } catch (error) {
      console.error(`Failed to create job ${index + 1}:`, error.message);
      return null;
    }
  });

  const jobIds = await Promise.all(jobPromises);
  const validJobIds = jobIds.filter(id => id !== null);

  console.log(`\nCreated ${validJobIds.length} jobs. Monitoring progress...\n`);

  // Monitor job progress
  const monitorJobs = async () => {
    const statusPromises = validJobIds.map(async (jobId) => {
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

    console.log('Job Status Update:');
    validStatuses.forEach(job => {
      console.log(`  Job ${job.job_id}: ${job.status} (${job.pages_crawled || 0} pages crawled)`);
      if (job.status === 'done') {
        console.log(`    Emails: ${job.emails?.length || 0}`);
        console.log(`    Facebook URLs: ${job.facebook_urls?.length || 0}`);
      } else if (job.status === 'error') {
        console.log(`    Error: ${job.error}`);
      }
    });

    // Check if all jobs are complete
    const allComplete = validStatuses.every(job => 
      job.status === 'done' || job.status === 'error'
    );

    if (!allComplete) {
      console.log('\nWaiting 5 seconds before next check...\n');
      setTimeout(monitorJobs, 5000);
    } else {
      console.log('\nAll jobs completed!');
    }
  };

  // Start monitoring
  setTimeout(monitorJobs, 2000);
}

async function testHealthEndpoint() {
  console.log('Testing health endpoint...');
  
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    const result = await response.json();
    console.log('Health check result:', result);
  } catch (error) {
    console.error('Health check failed:', error.message);
  }
}

async function testSingleJob() {
  console.log('Testing single job...');
  
  try {
    // Create a job
    const createResponse = await fetch(`${API_BASE_URL}/extract-emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://example.com' })
    });

    const createResult = await createResponse.json();
    console.log('Job created:', createResult);

    // Monitor the job
    const jobId = createResult.job_id;
    let attempts = 0;
    const maxAttempts = 20; // 2 minutes max

    const checkJob = async () => {
      attempts++;
      console.log(`Checking job status (attempt ${attempts}/${maxAttempts})...`);
      
      const statusResponse = await fetch(`${API_BASE_URL}/job/${jobId}`);
      const statusResult = await statusResponse.json();
      
      console.log('Job status:', statusResult.job.status);
      
      if (statusResult.job.status === 'done') {
        console.log('Job completed successfully!');
        console.log('Results:', {
          emails: statusResult.job.emails,
          facebook_urls: statusResult.job.facebook_urls,
          pages_crawled: statusResult.job.pages_crawled
        });
      } else if (statusResult.job.status === 'error') {
        console.log('Job failed:', statusResult.job.error);
      } else if (attempts < maxAttempts) {
        setTimeout(checkJob, 6000); // Check every 6 seconds
      } else {
        console.log('Job monitoring timeout');
      }
    };

    setTimeout(checkJob, 3000); // Start checking after 3 seconds

  } catch (error) {
    console.error('Single job test failed:', error.message);
  }
}

// Run tests
async function runTests() {
  console.log('Starting API tests...\n');
  
  await testHealthEndpoint();
  console.log('\n' + '='.repeat(50) + '\n');
  
  await testSingleJob();
  console.log('\n' + '='.repeat(50) + '\n');
  
  await testConcurrentRequests();
}

// Check if server is running
async function checkServer() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (response.ok) {
      console.log('Server is running. Starting tests...\n');
      await runTests();
    } else {
      console.log('Server is not responding properly');
    }
  } catch (error) {
    console.log('Server is not running. Please start the server first:');
    console.log('npm start');
  }
}

checkServer();

