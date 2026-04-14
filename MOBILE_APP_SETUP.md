# Mobile App Integration Setup

## Overview

This document guides you through preparing the ITeMS || Staff Attendance web app to receive and process attendance data from a mobile app that captures fingerprints from a smart card reader or biometric device.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile Device (ZK Device)                │
│  • Smart Card Reader                                        │
│  • Fingerprint Scanner                                      │
│  • Hosted Mobile App (React Native / Flutter / Ionic)       │
└────────────────────────┬────────────────────────────────────┘
                         │
                    Captures Fingerprint
                    (Base64 Image)
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           ITeMS || Staff Attendance Web App                 │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Mobile API Routes (/api/mobile/*)                  │  │
│  │  • /health                                          │  │
│  │  • /staff                                           │  │
│  │  • /verify-fingerprint                              │  │
│  │  • /verify-and-mark-attendance ⭐ MAIN ENDPOINT    │  │
│  │  • /mark-attendance-manual (fallback)               │  │
│  └──────────────────────────────────────────────────────┘  │
│                         │                                   │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Fingerprint Matching Engine                        │  │
│  │  • Pearson correlation algorithm                    │  │
│  │  • 75% threshold (MATCH_THRESHOLD)                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                         │                                   │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Database                                           │  │
│  │  • staff table (id, name, position, etc)           │  │
│  │  • fingerprints table (image_data, finger)         │  │
│  │  • attendance_logs table (staff_id, type, time)    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ✅ Setup Status: READY FOR MOBILE INTEGRATION             │
└─────────────────────────────────────────────────────────────┘
```

## What's Configured

### ✅ Mobile API Endpoints

All endpoints are available at: `http://<server>:5001/api/mobile/*`

1. **GET `/api/mobile/health`** - Server health check
2. **GET `/api/mobile/staff`** - List all active staff
3. **GET `/api/mobile/staff/:id`** - Get individual staff details
4. **POST `/api/mobile/verify-fingerprint`** - Verify without marking attendance
5. **POST `/api/mobile/verify-and-mark-attendance`** ⭐ **PRIMARY ENDPOINT**
6. **POST `/api/mobile/mark-attendance-manual`** - Fallback manual entry

### ✅ Database Schema

**Staff Table** (for reference matching):
```sql
CREATE TABLE staff (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  position VARCHAR(255) NOT NULL,
  employee_code VARCHAR(100),
  department VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(100),
  status VARCHAR(50) DEFAULT 'active',
  photo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Fingerprints Table** (for biometric matching):
```sql
CREATE TABLE fingerprints (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
  finger VARCHAR(20) NOT NULL,       -- e.g., "left_thumb", "right_index"
  image_data TEXT NOT NULL,           -- Base64-encoded fingerprint image
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Attendance Logs Table** (for marking attendance):
```sql
CREATE TABLE attendance_logs (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  type VARCHAR(10) NOT NULL,         -- "in" or "out"
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  device_id VARCHAR(100)             -- Optional: mobile device identifier
);
```

### ✅ Fingerprint Matching Algorithm

- **Method:** Pearson correlation on greyscale pixel arrays
- **Threshold:** 75% match confidence (MATCH_THRESHOLD = 0.75)
- **Image Resolution:** 150x150 pixels recommended
- **Processing:** Automatic on server side

**Match Confidence Ranges:**
- 0-50%: Definitely not a match (different person)
- 50-75%: Borderline (may accept or reject based on policy)
- 75-85%: Good match (normal acceptance)
- 85-95%: Very good match
- 95-100%: Excellent match (same finger, excellent placement)

### ✅ Response Format

All responses follow this standard structure:

**Success (200):**
```json
{
  "success": true,
  "staff": { "id": 1, "name": "John Doe", ... },
  "attendance": { "id": 123, "type": "in", "timestamp": "...", ... },
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

**Error (4xx/5xx):**
```json
{
  "success": false,
  "error": "Human-readable message",
  "error_code": "MACHINE_CODE",
  "timestamp": "2025-04-14T10:30:00.123Z"
}
```

## How to Integrate

### Step 1: Start the Server

```bash
npm run server
```

Expected output:
```
ITeMS || Staff Attendance API running on http://localhost:5001
```

### Step 2: Register Staff with Fingerprints

Use the admin web interface to:
1. Go to `/admin/staff` (AdminDashboard)
2. Register staff members with their details:
   - Name ✅
   - Position ✅
   - Employee Code ✅
   - Department ✅
   - Email (optional)
   - Phone (optional)

3. Capture and store fingerprints:
   - For each staff member, capture multiple fingerprints (left thumb, right index, etc.)
   - Fingerprints are stored in the `fingerprints` table
   - Each staff member should have at least one fingerprint enrolled

### Step 3: Test Mobile Endpoints

#### Test 1: Health Check
```bash
curl -X GET http://localhost:5001/api/mobile/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-04-14T10:30:00.123Z",
  "message": "ITeMS || Staff Attendance API is online"
}
```

#### Test 2: Get Staff List
```bash
curl -X GET http://localhost:5001/api/mobile/staff
```

#### Test 3: Verify a Fingerprint

First, you'll need a base64-encoded fingerprint image:
```bash
curl -X POST http://localhost:5001/api/mobile/verify-fingerprint \
  -H "Content-Type: application/json" \
  -d '{
    "fingerprint": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "device_id": "ZK_001"
  }'
```

#### Test 4: Mark Attendance (Manual)
```bash
curl -X POST http://localhost:5001/api/mobile/mark-attendance-manual \
  -H "Content-Type: application/json" \
  -d '{
    "staff_id": 1,
    "action": "in",
    "device_id": "ZK_001"
  }'
```

### Step 4: Integrate with Mobile App

Use the provided `AttendanceClient.js` library:

**JavaScript/React Native:**
```javascript
import { AttendanceClient } from './AttendanceClient.js';

const client = new AttendanceClient('http://localhost:5001/api');

// Capture fingerprint from device
const fingerprint = await zkDevice.captureFingerprintAsBase64();

// Mark attendance
try {
  const result = await client.verifyAndMarkAttendance(fingerprint, {
    deviceId: 'ZK_001'
  });

  if (result.success) {
    console.log(`✅ ${result.staff.name} clocked ${result.attendance.type}`);
    showSuccessScreen(result);
  }
} catch (error) {
  const handling = client.handleError(error);
  console.error(handling.message);
  showErrorScreen(handling);
}
```

**Flutter/Dart:**
```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

Future<void> markAttendance(String fingerprintBase64) async {
  final response = await http.post(
    Uri.parse('http://localhost:5001/api/mobile/verify-and-mark-attendance'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'fingerprint': fingerprintBase64,
      'device_id': 'ZK_001'
    }),
  );

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    print('✅ ${data['staff']['name']} clocked ${data['attendance']['type']}');
  } else {
    final data = jsonDecode(response.body);
    print('❌ ${data['error']}');
  }
}
```

**React Native:**
```javascript
const handleFingerprintCapture = async (fingerprintImage) => {
  const base64 = Buffer.from(fingerprintImage).toString('base64');

  try {
    const response = await fetch('http://localhost:5001/api/mobile/verify-and-mark-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fingerprint: base64,
        device_id: 'ZK_MOBILE_001'
      })
    });

    const result = await response.json();

    if (result.success) {
      Alert.alert('✅ Success', `${result.staff.name} clocked ${result.attendance.type}`);
    } else {
      Alert.alert('❌ Error', result.error);
    }
  } catch (error) {
    Alert.alert('❌ Network Error', error.message);
  }
};
```

## API Response Examples

### Successful Attendance Marking

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
    "is_overtime": false
  },
  "match_score": 92,
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

### Error: Fingerprint Not Recognized

```json
{
  "success": false,
  "error": "Fingerprint not recognized",
  "error_code": "NO_MATCH",
  "timestamp": "2025-04-14T09:05:00.123Z"
}
```

**Mobile App Response:**
- Show red screen
- Display "Fingerprint not recognized"
- Offer retry or manual entry fallback

### Error: Already Clocked In

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

**Mobile App Response:**
- Show yellow/warning screen
- Display current state: "Already clocked in at 09:00"
- Prevent duplicate action

## Workflow Diagram

```
Mobile App Workflow
===================

┌─────────────────────────────────────────┐
│  User approaches biometric device       │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  Capture fingerprint from device        │
│  (ZK SDK or Smart Card Reader)          │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  Convert to Base64                      │
│  Buffer.from(image).toString('base64')  │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  POST /api/mobile/verify-and-mark-      │
│       attendance                        │
│  { fingerprint: "iVBORw0..." }          │
└────────────┬────────────────────────────┘
             │
             ▼
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌─────────────┐  ┌──────────────────┐
│  ✅ Success  │  │  ❌ Error        │
│             │  │                  │
│ Match Score │  │ - No Match       │
│ Staff Found │  │ - Already In     │
│ Attendance  │  │ - Network Error  │
│ Recorded    │  │ - Server Error   │
└─────────────┘  └──────────────────┘
    │                    │
    ▼                    ▼
┌─────────────┐  ┌──────────────────┐
│ Green       │  │ Red/Yellow       │
│ Success     │  │ Screen           │
│ Animation   │  │ with Message     │
│ Play Sound  │  │ + Retry/Fallback │
└─────────────┘  └──────────────────┘
```

## Security Best Practices

### For Mobile App Developers:

1. **Use HTTPS in Production:**
   ```javascript
   const client = new AttendanceClient('https://api.items.yourdomain.com');
   ```

2. **Handle Network Errors Gracefully:**
   ```javascript
   try {
     const result = await client.verifyAndMarkAttendance(fingerprint);
   } catch (error) {
     if (error instanceof NetworkError) {
       // Queue request for later
       offlineQueue.push({ fingerprint, timestamp: Date.now() });
       showOfflineModeMessage();
     }
   }
   ```

3. **Validate Response Format:**
   ```javascript
   if (result?.success === true && result?.attendance?.id) {
     // Process valid response
   }
   ```

4. **Rate Limit Attempts:**
   - Max 3 fingerprint attempts per staff member per minute
   - Prevents brute-force attacks on weak "No Match" cases

5. **Secure Fingerprint Storage:**
   - Never log raw fingerprint data
   - Don't persist fingerprints on mobile device if possible
   - Use device encryption for temporary storage

## Troubleshooting

### "Connection Refused" Error
```
Error: connect ECONNREFUSED 127.0.0.1:5001
```
**Solution:** Ensure server is running:
```bash
npm run server
```

### "No Enrolled Fingerprints Found"
```json
{
  "success": false,
  "error": "No enrolled fingerprints found in system",
  "error_code": "NO_ENROLLED_PRINTS"
}
```
**Solution:** 
1. Register staff members in web admin
2. Capture and enroll their fingerprints
3. Verify fingerprints are in database:
   ```sql
   SELECT COUNT(*) FROM fingerprints;
   ```

### "Fingerprint Not Recognized" (But Should Match)
**Solution:**
1. Check image quality and resolution (150x150 pixels)
2. Verify enrollment quality
3. Check match threshold (currently 0.75, adjustable in fingerprintMatch.js)
4. Try different finger (some fingers match better than others)

### "Already Clocked In" on First Attempt
**Solution:**
1. Verify previous attendance isn't still in database
2. Clear test data:
   ```sql
   DELETE FROM attendance_logs WHERE staff_id = 1;
   ```
3. Try clock out action first, then clock in

## Monitoring & Logging

### Server Logs

The server logs important events:
```bash
npm run server
# Logs output:
# ITeMS || Staff Attendance API running on http://localhost:5001
# [Fingerprint verification] Match found: John Doe (score: 0.92)
# [Attendance] Clock in recorded for staff_id 1
```

### Database Inspection

Monitor attendance in real-time:
```sql
-- Last 10 attendance records
SELECT
  al.id,
  s.name,
  al.type,
  al.timestamp,
  NOW() - al.timestamp AS time_ago
FROM attendance_logs al
LEFT JOIN staff s ON s.id = al.staff_id
ORDER BY al.timestamp DESC
LIMIT 10;

-- Today's attendance
SELECT
  s.name,
  COUNT(CASE WHEN al.type = 'in' THEN 1 END) AS clock_ins,
  COUNT(CASE WHEN al.type = 'out' THEN 1 END) AS clock_outs,
  MIN(CASE WHEN al.type = 'in' THEN al.timestamp END) AS first_in,
  MAX(CASE WHEN al.type = 'out' THEN al.timestamp END) AS last_out
FROM staff s
LEFT JOIN attendance_logs al ON s.id = al.staff_id
  AND DATE(al.timestamp) = CURRENT_DATE
GROUP BY s.id, s.name
ORDER BY s.name;
```

## Performance Considerations

### Request Size:
- Fingerprint image: ~20-50 KB (base64 encoded)
- Server processes ~10-50 requests/second
- Database can handle thousands of attendance records per day

### Response Time:
- Fingerprint matching: ~200-500ms
- Database query: ~50-100ms
- Total: ~300-600ms per request

### Optimization Tips:
1. **Cache staff list** on mobile device (refresh daily)
2. **Implement offline queueing** for network resilience
3. **Use device batching** if processing multiple staff at once
4. **Monitor database** for slow queries

## Documentation Files

- **MOBILE_API_INTEGRATION.md** - Comprehensive API documentation
- **AttendanceClient.js** - Ready-to-use client library
- **MOBILE_APP_SETUP.md** - This file

## Next Steps

1. ✅ Web app backend prepared with mobile API endpoints
2. ⏭️ Develop mobile app using the provided client library
3. ⏭️ Register staff and enroll fingerprints via web admin
4. ⏭️ Test fingerprint matching and attendance marking
5. ⏭️ Deploy to production with HTTPS
6. ⏭️ Monitor attendance logs and system performance

## Support

For issues:
1. Check API documentation (MOBILE_API_INTEGRATION.md)
2. Review error codes and suggested actions
3. Check server logs: `npm run server` output
4. Verify database connection: Check `.env` DATABASE_URL
5. Test endpoints with curl before mobile integration

---

**Server Status:** ✅ READY FOR MOBILE INTEGRATION
**API Endpoints:** 6 endpoints operational
**Database:** fully configured with staff, fingerprint, and attendance tables
**Last Updated:** April 2025
