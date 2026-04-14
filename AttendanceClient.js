/**
 * ITeMS || Staff Attendance - Mobile App Client Library
 *
 * Simple, production-ready client for communicating with the ITeMS staff attendance API.
 * Handles requests, retries, error codes, and offline queueing.
 *
 * Usage:
 * const client = new AttendanceClient('http://localhost:5001/api');
 * const result = await client.verifyAndMarkAttendance(fingerprintBase64);
 *
 * Installation for React Native / Flutter / Ionic:
 * - Copy and adapt this file to your mobile project
 * - Replace fetch with your preferred HTTP client (axios, http, etc.)
 * - Adapt error handling for your platform
 */

class AttendanceClient {
  constructor(baseURL = 'http://localhost:5001/api', options = {}) {
    this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = options.timeout || 10000;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.offlineQueue = options.offlineQueue || []; // For offline-first apps
    this.onError = options.onError || this._defaultErrorHandler;
  }

  /**
   * Default error handler (override with custom handler if needed)
   */
  _defaultErrorHandler(error) {
    console.error('[AttendanceClient]', error.message, error);
  }

  /**
   * Make HTTP request with timeout and retry logic
   * @private
   */
  async _request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const method = options.method || 'GET';
    const body = options.body ? JSON.stringify(options.body) : undefined;

    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body
    };

    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();

        // Check for API-level errors
        if (!response.ok) {
          const error = new APIError(
            data.error || 'Unknown error',
            response.status,
            data.error_code || 'UNKNOWN',
            data
          );

          // Don't retry on client errors (4xx)
          if (response.status >= 400 && response.status < 500) {
            throw error;
          }

          lastError = error;
          if (attempt < this.maxRetries) {
            await this._delay(this.retryDelay * Math.pow(2, attempt - 1));
            continue;
          }
        }

        return data;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;

        // Don't retry on abort/timeout
        if (error.name === 'AbortError') {
          throw new NetworkError('Request timeout', error);
        }

        if (attempt < this.maxRetries && error.status >= 500) {
          await this._delay(this.retryDelay * Math.pow(2, attempt - 1));
          continue;
        }
      }
    }

    clearTimeout(timeoutId);
    if (lastError instanceof APIError) {
      throw lastError;
    }
    throw new NetworkError('Network request failed after retries', lastError);
  }

  /**
   * Delay helper for retry backoff
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Health Check - Verify server connectivity
   *
   * @returns {Promise<{status: string, timestamp: string}>}
   */
  async getHealth() {
    return this._request('/mobile/health');
  }

  /**
   * Get all active staff (for caching/initialization)
   *
   * @returns {Promise<{success: boolean, staff: Array, count: number}>}
   */
  async getAllStaff() {
    return this._request('/mobile/staff');
  }

  /**
   * Get individual staff member by ID
   *
   * @param {number} staffId - Staff member ID
   * @returns {Promise<{success: boolean, staff: Object}>}
   */
  async getStaffById(staffId) {
    if (!staffId || Number.isNaN(parseInt(staffId))) {
      throw new ValidationError('Invalid staff ID');
    }
    return this._request(`/mobile/staff/${staffId}`);
  }

  /**
   * Verify fingerprint WITHOUT marking attendance (read-only)
   *
   * Useful for:
   * - Two-step process (verify, then confirm)
   * - Checking who's trying to access
   * - Pre-validation before marking
   *
   * @param {string} fingerprintBase64 - Base64-encoded fingerprint image
   * @param {string} [deviceId] - Optional device identifier
   *
   * @returns {Promise<{
   *   success: boolean,
   *   staff: {id, name, position, department, employee_code, photo},
   *   match_score: number,
   *   matched_finger: string,
   *   last_action: string|null,
   *   timestamp: string
   * }>}
   */
  async verifyFingerprint(fingerprintBase64, deviceId = null) {
    if (!fingerprintBase64 || typeof fingerprintBase64 !== 'string') {
      throw new ValidationError('Fingerprint must be a base64 string');
    }

    const body = { fingerprint: fingerprintBase64 };
    if (deviceId) body.device_id = deviceId;

    return this._request('/mobile/verify-fingerprint', {
      method: 'POST',
      body
    });
  }

  /**
   * MAIN ENDPOINT: Verify fingerprint AND mark attendance in one call
   *
   * This is the recommended endpoint for normal attendance workflow:
   * 1. Capture fingerprint from device
   * 2. Send to this endpoint
   * 3. Attendance is automatically marked (in/out determined by system)
   * 4. User confirmation shown on mobile screen
   *
   * Overtime Calculation (Hours-Based):
   * The system calculates overtime as total hours worked beyond the shift duration.
   * 
   * Formula: Overtime Hours = Total Hours Worked - Shift Duration Hours
   * 
   * Examples:
   *   - Shift: 9 AM to 5 PM (8 hrs), Clock in: 9 AM, Clock out: 5 PM
   *     → Total: 8 hrs, Overtime: 0 hrs ✓ No overtime
   *   
   *   - Shift: 9 AM to 5 PM (8 hrs), Clock in: 9 AM, Clock out: 6 PM
   *     → Total: 9 hrs, Overtime: 1 hr ✓ Awarded 1 hour overtime
   *   
   *   - Shift: 9 AM to 5 PM (8 hrs), Clock in: 10 AM, Clock out: 6:30 PM
   *     → Total: 8.5 hrs, Overtime: 0.5 hrs ✓ Awarded 0.5 hours (late doesn't prevent overtime)
   *
   * @param {string} fingerprintBase64 - Base64-encoded fingerprint image
   * @param {Object} [options] - Optional parameters
   * @param {string} [options.deviceId] - Mobile device identifier
   * @param {string} [options.timestamp] - ISO8601 timestamp (server uses now() if omitted)
   *
   * @returns {Promise<{
   *   success: boolean,
   *   staff: {id, name, position, department, employee_code, photo},
   *   attendance: {id, type, timestamp, is_late, overtime_hours, is_overtime, shift_duration_hours},
   *   match_score: number,
   *   timestamp: string
   * }>}
   */
  async verifyAndMarkAttendance(fingerprintBase64, options = {}) {
    if (!fingerprintBase64 || typeof fingerprintBase64 !== 'string') {
      throw new ValidationError('Fingerprint must be a base64 string');
    }

    const body = { fingerprint: fingerprintBase64 };
    if (options.deviceId) body.device_id = options.deviceId;
    if (options.timestamp) body.timestamp = options.timestamp;

    return this._request('/mobile/verify-and-mark-attendance', {
      method: 'POST',
      body
    });
  }

  /**
   * Manual attendance marking (fallback when fingerprint fails)
   *
   * Useful for:
   * - Backup when fingerprint device malfunctions
   * - Voice/facial recognition verification
   * - Override by supervisor
   *
   * @param {number} staffId - Staff member ID
   * @param {string} action - "in" or "out"
   * @param {string} [deviceId] - Optional device identifier
   *
   * @returns {Promise<{
   *   success: boolean,
   *   attendance: {id, type, timestamp},
   *   staff: {id, name, position},
   *   timestamp: string
   * }>}
   */
  async markAttendanceManual(staffId, action, deviceId = null) {
    const parsedId = parseInt(staffId);
    if (Number.isNaN(parsedId) || parsedId <= 0) {
      throw new ValidationError('Staff ID must be a positive number');
    }

    if (!['in', 'out'].includes(action)) {
      throw new ValidationError('Action must be "in" or "out"');
    }

    const body = { staff_id: parsedId, action };
    if (deviceId) body.device_id = deviceId;

    return this._request('/mobile/mark-attendance-manual', {
      method: 'POST',
      body
    });
  }

  /**
   * Handle API errors uniformly
   *
   * Maps error codes to user-friendly actions
   */
  handleError(error) {
    if (error instanceof APIError) {
      const code = error.errorCode;

      // Error handling suggestions for mobile app
      const suggestions = {
        'NO_MATCH': {
          message: 'Fingerprint not recognized',
          action: 'SHOW_RETRY_OR_FALLBACK',
          details: 'Please try again or use manual entry'
        },
        'NO_ENROLLED_PRINTS': {
          message: 'No fingerprints in system',
          action: 'CONTACT_ADMIN',
          details: 'System not configured - contact administrator'
        },
        'INVALID_SEQUENCE': {
          message: error.data.error_code === 'INVALID_SEQUENCE'
            ? `Already clocked ${error.data.last_action}`
            : 'Invalid action sequence',
          action: 'SHOW_CURRENT_STATE',
          details: `Current state: ${error.data.last_action} - cannot repeat same action`
        },
        'MISSING_FINGERPRINT': {
          message: 'No fingerprint data',
          action: 'RETRY_CAPTURE',
          details: 'Ensure device is capturing properly'
        },
        'VERIFICATION_ERROR': {
          message: 'Verification failed',
          action: 'RETRY_WITH_BACKOFF',
          details: 'Server processing error - will retry automatically'
        },
        'PROCESSING_ERROR': {
          message: 'Processing failed',
          action: 'OFFLINE_QUEUE_OR_RETRY',
          details: 'Could not process request - will retry or queue offline'
        }
      };

      return suggestions[code] || {
        message: error.message,
        action: 'SHOW_ERROR',
        details: `Error: ${code}`
      };
    }

    if (error instanceof NetworkError) {
      return {
        message: 'Network error',
        action: 'OFFLINE_MODE',
        details: 'No internet connection - requests will be queued'
      };
    }

    return {
      message: 'Unknown error',
      action: 'RETRY',
      details: error.message
    };
  }
}

/**
 * Custom Error Classes
 */
class APIError extends Error {
  constructor(message, status, errorCode, data) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.errorCode = errorCode;
    this.data = data;
  }
}

class NetworkError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'NetworkError';
    this.originalError = originalError;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Example: React Native Integration
 *
 * import { CameraRoll } from '@react-native-camera-roll/camera-roll';
 * import { Buffer } from 'buffer';
 *
 * const AttendanceScreen = () => {
 *   const client = useRef(new AttendanceClient('https://api.items.example.com'));
 *
 *   const handleFingerprintCapture = async (fingerprintImage) => {
 *     try {
 *       const base64 = Buffer.from(fingerprintImage).toString('base64');
 *       const result = await client.current.verifyAndMarkAttendance(base64, {
 *         deviceId: DeviceInfo.getDeviceId()
 *       });
 *
 *       if (result.success) {
 *         showSuccessAnimation(result.staff.name, result.attendance.type);
 *       }
 *     } catch (error) {
 *       const handling = client.current.handleError(error);
 *       showErrorMessage(handling.message);
 *     }
 *   };
 *
 *   return (
 *     <View style={styles.container}>
 *       <FingerprintCapture onCapture={handleFingerprintCapture} />
 *     </View>
 *   );
 * };
 */

/**
 * Example: Flutter Integration
 *
 * import 'package:http/http.dart' as http;
 * import 'dart:convert';
 *
 * Future<Map> verifyAndMarkAttendance(String fingerprintBase64) async {
 *   final response = await http.post(
 *     Uri.parse('https://api.items.example.com/api/mobile/verify-and-mark-attendance'),
 *     headers: {'Content-Type': 'application/json'},
 *     body: jsonEncode({'fingerprint': fingerprintBase64}),
 *   );
 *
 *   if (response.statusCode == 200) {
 *     return jsonDecode(response.body);
 *   } else {
 *     throw Exception(jsonDecode(response.body)['error']);
 *   }
 * }
 */

// Export for use in Node.js/module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AttendanceClient,
    APIError,
    NetworkError,
    ValidationError
  };
}
