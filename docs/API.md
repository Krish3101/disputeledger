# API Documentation

## Base URL
```
http://localhost:3000
```

## Overview

This API provides endpoints for managing a blockchain-based complaint system with dynamic user management and role-based access control. Users can be registered with either "citizen" or "authority" roles.

## Endpoints

### Health Check

**GET** `/health`

Check if the server is running.

**Response:**
```json
{
  "ok": true
}
```

---

### Setup

**POST** `/setup`

Initialize the system by enrolling the admin user. This must be called before registering users or creating complaints.

**Response:**
```json
{
  "ok": true,
  "message": "Admin enrolled successfully. You can now register users."
}
```

---

## User Management

### Register User

**POST** `/users/register`

Register a new user with an optional role. Users can be registered as "citizen" (default) or "authority". Authority users can resolve complaints.

**Request Body:**
```json
{
  "userId": "john-doe",
  "role": "citizen"
}
```

**Fields:**
- `userId` (required): Unique identifier for the user (1-50 characters, alphanumeric with dash/underscore)
- `role` (optional): Either "citizen" or "authority" (defaults to "citizen")

**Response:**
```json
{
  "ok": true,
  "message": "User john-doe registered successfully",
  "userId": "john-doe",
  "role": "citizen"
}
```

**Validation:**
- `userId`: Required, 1-50 characters, alphanumeric with dash/underscore only
- `role`: Must be either "authority" or "citizen"

---

### List Users

**GET** `/users`

Get a list of all registered users (excluding admin).

**Response:**
```json
{
  "users": [
    { "userId": "john-doe" },
    { "userId": "jane-authority" }
  ]
}
```

---

### Check User Existence

**GET** `/users/:userId/exists`

Check if a specific user is registered in the system.

**Path Parameters:**
- `userId`: User ID to check

**Response:**
```json
{
  "exists": true,
  "userId": "john-doe"
}
```

---

## Complaint Management

### Create Complaint

**POST** `/complaints?as={userId}`

Create a new complaint.

**Query Parameters:**
- `as` (required): User identity to use for authentication

**Request Body:**
```json
{
  "id": "cmp-001",
  "user": "john-doe",
  "description": "Streetlight out on Main Street"
}
```

**Response:**
```json
{
  "complaintID": "cmp-001",
  "user": "john-doe",
  "description": "Streetlight out on Main Street",
  "status": "OPEN",
  "resolutionNote": "",
  "createdAt": 1699012345678,
  "updatedAt": 1699012345678,
  "resolvedAt": null
}
```

**Validation:**
- `id`: Required, 1-100 characters, alphanumeric with dash/underscore only
- `user`: Required, 1-50 characters, alphanumeric with dash/underscore only
- `description`: Required, 1-1000 characters

---

### Read Complaint

**GET** `/complaints/:id?as={userId}`

Read a specific complaint by ID.

**Path Parameters:**
- `id`: Complaint ID

**Query Parameters:**
- `as` (required): User identity to use for authentication

**Response:**
```json
{
  "complaintID": "cmp-001",
  "user": "john-doe",
  "description": "Streetlight out on Main Street",
  "status": "OPEN",
  "resolutionNote": "",
  "createdAt": 1699012345678,
  "updatedAt": 1699012345678,
  "resolvedAt": null
}
```

---

### Update Complaint

**PATCH** `/complaints/:id?as={userId}`

Update a complaint's description (only for OPEN complaints).

**Path Parameters:**
- `id`: Complaint ID

**Query Parameters:**
- `as` (optional): User identity to use (default: `alice`)

**Request Body:**
```json
{
  "description": "Updated description of the issue"
}
```

**Response:**
```json
{
  "complaintID": "cmp-001",
  "user": "john-doe",
  "description": "Updated description of the issue",
  "status": "OPEN",
  "resolutionNote": "",
  "createdAt": 1699012345678,
  "updatedAt": 1699012456789,
  "resolvedAt": null
}
```

**Validation:**
- Cannot update resolved complaints
- `description`: Required, 1-1000 characters

---

### Get Complaints by Status

**GET** `/complaints?status={status}&as={userId}`

Get complaints filtered by status, or all complaints if no status is provided.

**Query Parameters:**
- `status` (optional): Either `OPEN` or `RESOLVED`. If omitted, returns all complaints.
- `as` (required): User identity to use for authentication

**Response (with status filter):**
```json
[
  {
    "complaintID": "cmp-001",
    "user": "alice",
    "description": "Streetlight out",
    "status": "OPEN",
    "resolutionNote": "",
    "createdAt": 1699012345678,
    "updatedAt": 1699012345678,
    "resolvedAt": null
  }
]
```

**Response (without status filter - all complaints):**
```json
[
  {
    "complaintID": "cmp-001",
    "user": "alice",
    "description": "Streetlight out",
    "status": "OPEN",
    "resolutionNote": "",
    "createdAt": 1699012345678,
    "updatedAt": 1699012345678,
    "resolvedAt": null
  },
  {
    "complaintID": "cmp-002",
    "user": "bob",
    "description": "Pothole on 5th Ave",
    "status": "RESOLVED",
    "resolutionNote": "Filled by road crew",
    "createdAt": 1699012345678,
    "updatedAt": 1699012345678,
    "resolvedAt": 1699012567890
  }
]
```

---

### Assign Complaint

**PATCH** `/complaints/:id/assign?as={userId}`

Assign a complaint to a specific authority user (requires authority role).

**Path Parameters:**
- `id`: Complaint ID

**Query Parameters:**
- `as` (required): User identity to use for authentication (must have authority role)

**Request Body:**
```json
{
  "assignedTo": "city-admin"
}
```

**Response:**
```json
{
  "complaintID": "cmp-001",
  "user": "john-doe",
  "description": "Streetlight out",
  "status": "OPEN",
  "resolutionNote": "",
  "assignedTo": "city-admin",
  "createdAt": 1699012345678,
  "updatedAt": 1699012456789,
  "resolvedAt": null
}
```

**Authorization:**
- Requires user with `role=authority` attribute

---

### Get Assigned Complaints

**GET** `/complaints/assigned/:authorityId?as={userId}`

Get all complaints assigned to a specific authority user.

**Path Parameters:**
- `authorityId`: Authority user ID

**Query Parameters:**
- `as` (required): User identity to use for authentication

**Response:**
```json
[
  {
    "complaintID": "cmp-001",
    "user": "john-doe",
    "description": "Streetlight out",
    "status": "OPEN",
    "resolutionNote": "",
    "assignedTo": "city-admin",
    "createdAt": 1699012345678,
    "updatedAt": 1699012345678,
    "resolvedAt": null
  }
]
```

---

### Delete Complaint

**DELETE** `/complaints/:id?as={userId}`

Delete a complaint permanently (requires authority role).

**Path Parameters:**
- `id`: Complaint ID

**Query Parameters:**
- `as` (required): User identity to use for authentication (must have authority role)

**Response:**
```json
{
  "message": "Complaint cmp-001 has been deleted",
  "deletedComplaint": {
    "complaintID": "cmp-001",
    "user": "john-doe",
    "description": "Streetlight out",
    "status": "OPEN",
    "resolutionNote": "",
    "assignedTo": null,
    "createdAt": 1699012345678,
    "updatedAt": 1699012345678,
    "resolvedAt": null
  }
}
```

**Authorization:**
- Requires user with `role=authority` attribute

---

### Get All Complaints

This is now handled by the `/complaints` endpoint without a status parameter (see above).

---

### Resolve Complaint

**PATCH** `/complaints/:id/resolve?as={userId}`

Resolve a complaint (requires authority role).

**Path Parameters:**
- `id`: Complaint ID

**Query Parameters:**
- `as` (required): User identity to use for authentication

**Request Body:**
```json
{
  "note": "Fixed by maintenance crew"
}
```

**Response:**
```json
{
  "complaintID": "cmp-001",
  "user": "alice",
  "description": "Streetlight out",
  "status": "RESOLVED",
  "resolutionNote": "Fixed by maintenance crew",
  "createdAt": 1699012345678,
  "updatedAt": 1699012345678,
  "resolvedAt": 1699012567890
}
```

**Authorization:**
- Requires user with `role=authority` attribute
- Returns error if user lacks proper role

---

## Error Responses

All endpoints return error responses in the following format:

```json
{
  "error": "Error message describing what went wrong"
}
```

Common HTTP status codes:
- `400`: Bad Request (validation error)
- `500`: Internal Server Error (chaincode error, network error, etc.)

---

## Rate Limiting

API endpoints under `/api/` are rate-limited to 100 requests per 15 minutes per IP address.

---

## Security Headers

The API includes the following security features:
- Helmet.js security headers
- CORS enabled
- Input validation and sanitization
- Rate limiting
