# ITeMS || Staff Attendance - Mobile App Integration Guide

## Overview

This document describes the API endpoints available for mobile app communication with the ITeMS || Staff Attendance web application.

**Base URL:** `http://<web-app-host>:<port>/api`
**Default:** `http://localhost:5001/api`

---

## Core Workflow

The mobile app captures fingerprint data from a smart card reader or biometric device and communicates with this web app to:

1. **Verify** that the fingerprint matches a registered staff member
2. **Mark Attendance** automatically upon successful match
3. **Handle Errors** gracefully when no match is found or system conflicts occur

```
┌─────────────┐      ┌──────────────┐      ┌──────────────────┐
│ Mobile App  │─────▶│ Smart Card / │─────▶│ ITeMS Web Server │
│             │      │ ZK Device    │      │                  │
└─────────────┘      └──────────────┘      └──────────────────┘
       │                                             │
       │ Fingerprint captured                       │
       │ & base64 encoded                           │
       └──────────────────────────────────────────▶│
                                                    │
                              POST /api/mobile/verify-and-mark-attendance
                                                    │
       ┌─────────────┐◀─────────────────────────────┘
       │   Response  │
       │ { staff,    │
       │   attendance│
       │   status }  │
       └─────────────┘
```

---

## Health Check

### GET `/api/mobile/health`

**Purpose:** Verify that the web app is online and accessible

**Request:**
```bash
GET /api/mobile/health
```

**Success Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2025-04-14T10:30:00.123Z",
  "message": "ITeMS || Staff Attendance API is online"
}
```

**Use Case:** Mobile app startup check and keep-alive ping

---

## Staff Management

### GET `/api/mobile/staff`

**Purpose:** Retrieve list of all active staff for caching/initialization

**Request:**
```bash
GET /api/mobile/staff
```

**Success Response (200):**
```json
{
  "success": true,
  "staff": [
    {
      "id": 1,
      "name": "John Doe",
      "position": "Manager",
      "department": "Human Resources",
      "employee_code": "EMP001",
      "photo": "data:image/jpeg;base64,...",
      "status": "active"
    },
    {
      "id": 2,
      "name": "Jane Smith",
      "position": "Developer",
      "department": "IT",
      "employee_code": "EMP002",
      "photo": null,
      "status": "active"
    }
  ],
  "count": 2,
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

**Error Response (500):**
```json
{
  "success": false,
  "error": "Failed to fetch staff list"
}
```

**Use Case:** 
- Initialize staff database on mobile app
- Provide fallback lookup if fingerprint matching fails
- Display staff directory with photos

---

### GET `/api/mobile/staff/:id`

**Purpose:** Get detailed information about a specific staff member

**Request:**
```bash
GET /api/mobile/staff/1
```

**Success Response (200):**
```json
{
  "success": true,
  "staff": {
    "id": 1,
    "name": "John Doe",
    "position": "Manager",
    "department": "Human Resources",
    "employee_code": "EMP001",
    "email": "john@example.com",
    "phone": "+1-555-0101",
    "photo": "data:image/jpeg;base64,...",
    "status": "active",
    "created_at": "2025-01-15T08:00:00Z",
    "last_action": "in",
    "last_action_time": "2025-04-14T09:05:00Z"
  },
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "Staff member not found"
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Invalid staff ID"
}
```

---

## Fingerprint Verification

### POST `/api/mobile/verify-fingerprint`

**Purpose:** Verify a fingerprint without marking attendance (read-only verification)

**Request Body:**
```json
{
  "fingerprint": "<base64 encoded fingerprint image>",
  "device_id": "ZK_DEVICE_001"
}
```

**Fingerprint Format:**
- **Type:** Base64-encoded image data (JPEG or PNG)
- **Resolution:** 150x150 pixels recommended
- **Encoding:** `Buffer.toString('base64')` or equivalent
- **Max Size:** 20 MB (configured on server)

**Success Response (200):**
```json
{
  "success": true,
  "staff": {
    "id": 1,
    "name": "John Doe",
    "position": "Manager",
    "department": "Human Resources",
    "employee_code": "EMP001",
    "photo": "data:image/jpeg;base64,..."
  },
  "match_score": 92,
  "matched_finger": "left_thumb",
  "last_action": "out",
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

**Response Fields:**
- `match_score` (0-100): Confidence percentage of the fingerprint match
  - 0+: No match
  - 75+: Confident match (MATCH_THRESHOLD = 0.75)
  - 85+: High confidence match
  - 95+: Excellent match
- `matched_finger`: Which finger was matched (e.g., "left_thumb", "right_index")
- `last_action`: "in" | "out" | null — the user's last recorded action
- `shift_duration_hours`: The configured shift duration in hours (e.g., 8.0 for 9am-5pm)
- `overtime_hours`: Hours worked beyond the shift duration (rounded to 2 decimals)
- `is_overtime`: Boolean flag if `overtime_hours > 0`

**Error Response (404) — No Match:**
```json
{
  "success": false,
  "error": "Fingerprint not recognized",
  "error_code": "NO_MATCH",
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

**Error Response (404) — No Enrolled Fingerprints:**
```json
{
  "success": false,
  "error": "No enrolled fingerprints found in system",
  "error_code": "NO_ENROLLED_PRINTS",
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

**Error Response (400) — Missing Data:**
```json
{
  "success": false,
  "error": "No fingerprint data provided",
  "error_code": "MISSING_FINGERPRINT",
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

**Use Case:**
- Verify staff identity before marking attendance
- Display user confirmation screen on mobile device
- Implement two-step verification process

---

## Attendance Marking (Combined)

### POST `/api/mobile/verify-and-mark-attendance`

**⭐ RECOMMENDED ENDPOINT ⭐**

**Purpose:** Verify fingerprint AND automatically record attendance in one call

**Request Body:**
```json
{
  "fingerprint": "<base64 encoded fingerprint image>",
  "device_id": "ZK_DEVICE_001",
  "timestamp": "2025-04-14T09:05:00Z"
}
```

**Parameters:**
- `fingerprint` (required): Base64-encoded fingerprint image
- `device_id` (optional): Identifier for the mobile device (for logging)
- `timestamp` (optional): ISO8601 timestamp. If omitted, server uses current time

**Success Response (200) — Clock In:**
```json
{
  "success": true,
  "staff": {
    "id": 1,
    "name": "John Doe",
    "position": "Manager",
    "department": "Human Resources",
    "employee_code": "EMP001",
    "photo": "data:image/jpeg;base64,..."
  },
  "attendance": {
    "id": 5432,
    "type": "in",
    "timestamp": "2025-04-14T09:05:00.000Z",
    "is_late": true,
    "overtime_hours": 0,
    "is_overtime": false,
    "shift_duration_hours": 8.0
  },
  "match_score": 92,
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

**Success Response (200) — Clock Out with Overtime:**
```json
{
  "success": true,
  "staff": {
    "id": 1,
    "name": "John Doe",
    "position": "Manager",
    "department": "Human Resources",
    "employee_code": "EMP001",
    "photo": "data:image/jpeg;base64,..."
  },
  "attendance": {
    "id": 5433,
    "type": "out",
    "timestamp": "2025-04-14T18:00:00.000Z",
    "is_late": false,
    "overtime_hours": 1.0,
    "is_overtime": true,
    "shift_duration_hours": 8.0
  },
  "match_score": 88,
  "timestamp": "2025-04-14T18:00:00.123Z"
}
```

**Success Response (200) — Late arrival but with Overtime:**
```json
{
  "success": true,
  "staff": {
    "id": 1,
    "name": "Jane Smith",
    "position": "Developer",
    "department": "IT",
    "employee_code": "EMP002",
    "photo": "data:image/jpeg;base64,..."
  },
  "attendance": {
    "id": 5434,
    "type": "out",
    "timestamp": "2025-04-14T18:30:00.000Z",
    "is_late": true,
    "overtime_hours": 0.5,
    "is_overtime": true,
    "shift_duration_hours": 8.0
  },
  "match_score": 92,
  "timestamp": "2025-04-14T18:30:00.123Z"
}
```

**Overtime Calculation (Hours-Based):**

Overtime is calculated based on **total hours worked** during the day, not simply the clock-out time.

**Formula:**
```
Overtime Hours = Total Hours Worked - Expected Shift Hours
is_overtime = (Overtime Hours > 0)
```

**Examples:**
1. **Standard day without overtime:**
   - Shift: 9:00 AM to 5:00 PM (8 hours)
   - Clock in: 9:00 AM, Clock out: 5:00 PM
   - Total worked: 8.0 hours
   - Overtime: 0.0 hours ✅ No overtime

2. **Staff comes in on time but works late:**
   - Shift: 9:00 AM to 5:00 PM (8 hours)
   - Clock in: 9:00 AM, Clock out: 6:00 PM
   - Total worked: 9.0 hours
   - Overtime: 1.0 hour ⏱️ Awarded 1 hour overtime

3. **Staff comes in late but works extra hours:**
   - Shift: 9:00 AM to 5:00 PM (8 hours)
   - Clock in: 10:00 AM, Clock out: 6:30 PM
   - Total worked: 8.5 hours
   - Overtime: 0.5 hours ⏱️ Awarded 0.5 hours overtime (late doesn't prevent overtime eligibility)

4. **Staff comes in very late with minimal overtime:**
   - Shift: 9:00 AM to 5:00 PM (8 hours)
   - Clock in: 2:00 PM, Clock out: 5:30 PM
   - Total worked: 3.5 hours
   - Overtime: 0.0 hours ✅ No overtime (didn't meet minimum hours)

**Key Points:**
- Overtime is awarded for ANY hours worked beyond the configured shift duration
- Even late arrivals can be awarded overtime if they work more than the shift duration
- The system calculates actual hours worked by matching today's clock-in and clock-out times
- Overtime hours are rounded to 2 decimal places (e.g., 0.5, 1.25, 2.33)

**Error Response (404) — No Match:**
```json
{
  "success": false,
  "error": "Fingerprint not recognized",
  "error_code": "NO_MATCH",
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

**Error Response (409) — Already Clocked In:**
```json
{
  "success": false,
  "error": "Already clocked in",
  "error_code": "INVALID_SEQUENCE",
  "staff": {
    "id": 1,
    "name": "John Doe",
    "position": "Manager",
    "employee_code": "EMP001"
  },
  "last_action": "in",
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

**Error Response (500) — Processing Error:**
```json
{
  "success": false,
  "error": "Failed to process fingerprint and attendance",
  "error_code": "PROCESSING_ERROR",
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

---

## Attendance Marking (Manual Backup)

### POST `/api/mobile/mark-attendance-manual`

**Purpose:** Mark attendance by staff ID (fallback when fingerprint fails)

**Request Body:**
```json
{
  "staff_id": 1,
  "action": "in",
  "device_id": "ZK_DEVICE_001"
}
```

**Parameters:**
- `staff_id` (required): Integer ID of staff member
- `action` (required): "in" or "out"
- `device_id` (optional): Device identifier for logging

**Success Response (200):**
```json
{
  "success": true,
  "attendance": {
    "id": 5432,
    "type": "in",
    "timestamp": "2025-04-14T09:05:00.000Z"
  },
  "staff": {
    "id": 1,
    "name": "John Doe",
    "position": "Manager"
  },
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

**Error Response (404) — Staff Not Found:**
```json
{
  "success": false,
  "error": "Staff member not found",
  "error_code": "STAFF_NOT_FOUND",
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

**Error Response (400) — Invalid Action:**
```json
{
  "success": false,
  "error": "Action must be \"in\" or \"out\"",
  "error_code": "INVALID_ACTION",
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

**Error Response (409) — Invalid Sequence:**
```json
{
  "success": false,
  "error": "Already clocked in",
  "error_code": "INVALID_SEQUENCE",
  "last_action": "in",
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

---

## Error Handling

### Standard Error Codes

| Error Code | HTTP | Meaning | Action |
|-----------|------|---------|--------|
| `NO_MATCH` | 404 | Fingerprint not recognized | Show "Fingerprint not recognized" message, allow retry or manual entry |
| `NO_ENROLLED_PRINTS` | 404 | No fingerprints in system | Contact administrator, system not set up |
| `INVALID_SEQUENCE` | 409 | Already clocked in/out | Show current state, prevent duplicate action |
| `MISSING_FINGERPRINT` | 400 | No fingerprint data | Ensure device is capturing properly |
| `INVALID_STAFF_ID` | 400 | Invalid staff ID format | Verify staff ID is numeric |
| `INVALID_ACTION` | 400 | Action not "in" or "out" | Use correct action value |
| `STAFF_NOT_FOUND` | 404 | Staff member doesn't exist | Verify staff ID, may be deleted |
| `VERIFICATION_ERROR` | 500 | Fingerprint verification failed | Retry or contact support |
| `PROCESSING_ERROR` | 500 | General processing error | Retry, check network connection |

### Error Response Structure

All error responses follow this structure:
```json
{
  "success": false,
  "error": "Human-readable error message",
  "error_code": "MACHINE_READABLE_CODE",
  "timestamp": "2025-04-14T10:30:00.123Z",
  "additional_field": "optional context"
}
```

### Retry Strategy

**Recommended retry logic:**
- **Temporary Errors (5xx):** Retry up to 3 times with exponential backoff
- **Permanent Errors (4xx):** Don't retry; show error to user and provide alternatives
- **Network Errors:** Implement offline queue; sync when connection restored

```javascript
// Pseudo-code example
async function markAttendanceWithRetry(fingerprint, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await POST('/api/mobile/verify-and-mark-attendance', { fingerprint });
      return response;
    } catch (error) {
      if (error.status >= 500) {
        // Server error, retry
        await delay(Math.pow(2, attempt) * 1000);
      } else {
        // Client error, don't retry
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## Response Structure Conventions

### Success Response (`success: true`)

All successful responses include:
- `success: true` (boolean flag)
- Relevant data fields (staff, attendance, etc.)
- `timestamp: ISO8601string` (server timestamp)

```json
{
  "success": true,
  "staff": { ... },
  "attendance": { ... },
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

### Error Response (`success: false`)

All error responses include:
- `success: false` (boolean flag)
- `error: "Human-readable message"` (string)
- `error_code: "MACHINE_CODE"` (string, uppercase with underscores)
- `timestamp: ISO8601string` (server timestamp)
- Optional context fields (last_action, staff, etc.)

```json
{
  "success": false,
  "error": "Fingerprint not recognized",
  "error_code": "NO_MATCH",
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

---

## Request/Response Size Optimization

### Request Size
- **Fingerprint image:** Base64-encoded, ~20-50 KB typical
- **Server limit:** 20 MB per request (configured)
- **Compression:** Recommended to compress fingerprint before sending

### Response Size
- **Verification only:** ~500 bytes
- **With staff data:** ~1-2 KB
- **With photo:** +5-50 KB (depends on photo quality)

**Optimization Tips:**
- Use `GET /api/mobile/staff` once on app startup and cache locally
- Send only fingerprint image in `/api/mobile/verify-and-mark-attendance`
- Photos are base64-encoded; consider separate image endpoint if needed

---

## Example Integration (Pseudo-code)

```javascript
// 1. App startup: Cache staff list and check health
async function initializeMobileApp() {
  // Health check
  const health = await fetch('/api/mobile/health').then(r => r.json());
  console.log('Server status:', health.status);

  // Cache staff
  const staffList = await fetch('/api/mobile/staff').then(r => r.json());
  localStorage.setItem('staff', JSON.stringify(staffList.staff));
}

// 2. Capture fingerprint and mark attendance
async function captureAndMarkAttendance() {
  const fingerprint = await device.captureFingerprint(); // From ZK device
  const base64 = fingerprint.toBase64();

  try {
    const response = await fetch('/api/mobile/verify-and-mark-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fingerprint: base64,
        device_id: 'ZK_001'
      })
    });

    const data = await response.json();

    if (data.success) {
      // ✅ Attendance marked
      showGreenScreen(data.staff.name, data.attendance.type);
      playSuccessSound();
    } else {
      if (data.error_code === 'NO_MATCH') {
        // Fingerprint not recognized
        showRedScreen('Fingerprint not recognized');
        offerManualEntry();
      } else if (data.error_code === 'INVALID_SEQUENCE') {
        // Already clocked in
        showYellowScreen(`Already clocked ${data.last_action}`);
      }
    }
  } catch (error) {
    // Network error
    showNetworkError(error.message);
    addToOfflineQueue();
  }
}

// 3. Manual fallback (if fingerprint fails)
async function manualAttendanceEntry(staffId, action) {
  const response = await fetch('/api/mobile/mark-attendance-manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      staff_id: staffId,
      action: action
    })
  });

  return response.json();
}
```

---

## Security Considerations

### Authentication
- **Current:** No API key or authentication required (mobile device is trusted hardware)
- **Future Enhancement:** Consider implementing:
  - API key for device identification
  - Request signing with HMAC-SHA256
  - Time-based request validation (prevent replay attacks)

### Data Privacy
- **Fingerpint Data:** Only base64 images are transmitted; processed server-side
- **Staff Data:** Basic public info (name, position) only
- **Attendance Data:** Not exposed in responses (only recorded)
- **HTTPS Recommended:** Use HTTPS in production to encrypt data in transit

### Rate Limiting (Future)
- Recommend implementing rate limiting per device:
  - Max 10 requests per second per IP
  - Max 3 failed fingerprint attempts per staff member per minute
  - Prevents brute-force attacks

---

## Testing

### cURL Examples

**Health Check:**
```bash
curl -X GET http://localhost:5001/api/mobile/health
```

**Get Staff List:**
```bash
curl -X GET http://localhost:5001/api/mobile/staff
```

**Get Individual Staff:**
```bash
curl -X GET http://localhost:5001/api/mobile/staff/1
```

**Verify Fingerprint (with dummy base64):**
```bash
curl -X POST http://localhost:5001/api/mobile/verify-fingerprint \
  -H "Content-Type: application/json" \
  -d '{"fingerprint":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}'
```

**Mark Attendance Manually:**
```bash
curl -X POST http://localhost:5001/api/mobile/mark-attendance-manual \
  -H "Content-Type: application/json" \
  -d '{"staff_id":1,"action":"in"}'
```

---

## Deployment Checklist

- [ ] `npm install` to install all dependencies
- [ ] `npm run build` to verify production build
- [ ] `npm run server` to start the API server
- [ ] Test `/api/mobile/health` endpoint
- [ ] Test `/api/mobile/staff` endpoint
- [ ] Configure `.env` with correct database connection string
- [ ] Configure `.env` with `SERVER_PORT` (default 5001)
- [ ] Enable CORS for mobile app domains
- [ ] Set up SSL/TLS certificate for HTTPS
- [ ] Configure rate limiting (optional but recommended)
- [ ] Set up logging and monitoring

---

## Support & Assistance

For issues or questions:
1. Check the error_code in the response
2. Review the Employee Attendance section above
3. Check server logs: `npm run server` output
4. Verify database connection: Check `.env` DATABASE_URL
5. Test endpoints with cURL before integrating in mobile app

---

**Last Updated:** April 2025
**API Version:** 1.0.0
**Server:** ITeMS || Staff Attendance
