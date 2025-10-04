# Email Extraction API

A Node.js Express API that extracts email addresses from websites using web crawling.

## Features

- Extract emails from any website URL
- Crawls multiple pages within the same domain
- Handles both static HTML and JavaScript-rendered content
- Returns unique email addresses
- CORS enabled for cross-origin requests
- Comprehensive error handling

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

## API Endpoints

### POST /extract-emails

Extract emails from a website.

**Request Body:**
```json
{
  "url": "https://example.com"
}
```

**Response:**
```json
{
  "success": true,
  "url": "https://example.com",
  "emailsFound": 3,
  "emails": [
    "contact@example.com",
    "info@example.com",
    "support@example.com"
  ],
  "pagesCrawled": 5,
  "crawledUrls": [
    "https://example.com",
    "https://example.com/about",
    "https://example.com/contact"
  ]
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "OK",
  "message": "Email extraction API is running"
}
```

### GET /

API documentation and usage information.

## Usage Examples

### Using curl:
```bash
curl -X POST http://localhost:3000/extract-emails \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Using JavaScript fetch:
```javascript
const response = await fetch('http://localhost:3000/extract-emails', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://example.com'
  })
});

const data = await response.json();
console.log(data.emails);
```

## Configuration

- **Port**: Set the `PORT` environment variable to change the server port (default: 3000)
- **Crawling Limits**: The API limits crawling to 10 requests and 5 additional pages per domain to prevent excessive resource usage

## Error Handling

The API returns appropriate HTTP status codes:
- `400`: Bad Request (missing or invalid URL)
- `500`: Internal Server Error (crawling failed)

## Dependencies

- **express**: Web framework
- **crawlee**: Web scraping and crawling library
- **cors**: Cross-origin resource sharing middleware

