
Security Policy
Assumptions
The bridge API is intended for LAN-only use
All communication happens over trusted local networks
Bluetooth pairing is performed securely by the user
Authentication
JWT tokens are used for API authentication
Tokens are short-lived (1 hour)
Shared passphrase is used for initial token generation
Future Enhancements
mTLS support for enhanced security
Certificate pinning in mobile app
Regular JWT secret rotation
Rate limiting for all API endpoints
Reporting Security Issues
Please report security issues to security@campfirebridge.com
