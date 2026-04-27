# Cerebelle Import Wizard & USPTO ODP API — Research Summary

> Generated 2026-03-11. Intended as a handoff document for implementing multi-field USPTO search in the Cerebelle import wizard.

---

## 1. Current Implementation Overview

### Architecture

The import wizard is a 4-step modal flow (USPTO path) or 3-step (Upload/Manual path):

| Step | Component | Purpose |
|------|-----------|---------|
| 1 — Upload | `UploadStep.tsx` | Choose input method: USPTO / Upload / Manual |
| 2 — Review | `ReviewStep.tsx` | Edit extracted data, link DB records |
| 3 — Documents | `DocumentsStep.tsx` | Select USPTO prosecution history docs (USPTO only) |
| 4 — Submit | `SubmitStep.tsx` | Final summary, trigger Firestore write |

### Key Files

| File | Path | Lines | Purpose |
|------|------|-------|---------|
| Main modal | `src/components/applications/importWizard/index.tsx` | 802 | Orchestration, submit handler |
| Types | `src/components/applications/importWizard/types.ts` | 454 | All TypeScript types |
| Upload step | `src/components/applications/importWizard/steps/UploadStep.tsx` | 527 | Input method + USPTO import handler |
| Review step | `src/components/applications/importWizard/steps/ReviewStep.tsx` | ~2000+ | Data review, DB matching |
| Documents step | `src/components/applications/importWizard/steps/DocumentsStep.tsx` | 320 | USPTO doc selection |
| Submit step | `src/components/applications/importWizard/steps/SubmitStep.tsx` | 267 | Read-only summary |
| Extraction util | `src/utils/importExtraction.ts` | 139 | Cloud function wrapper |
| Cloud functions | `functions/src/index.ts` lines 3568–4004 | ~436 | All USPTO functions + mapper |

---

## 2. Cloud Functions (Backend)

### 2a. `importFromUspto` (line 3757)

**Current query method: Application number only.**

**Request schema:**
```typescript
interface UsptoImportRequest {
  applicationNo: string;      // Required — 7-8 digits (e.g., "17/654,170" or "17654170")
  confirmationNo?: string;    // Optional — for verification
}
```

**Input processing:**
- Strips `/`, `,`, `-`, spaces → `"17/654,170"` becomes `"17654170"`
- Validates: must be 7-8 digits (`/^\d{7,8}$/`)

**API base URL:**
```
https://api.uspto.gov/api/v1/patent/applications/{cleanAppNo}
```

**Authentication:**
```
Header: X-API-KEY: <USPTO_API_KEY from Firebase secrets>
Header: Accept: application/json
```

**Endpoints called in parallel (`Promise.allSettled`):**

| # | Endpoint | Required? |
|---|----------|-----------|
| 1 | `/api/v1/patent/applications/{appNo}` | Yes |
| 2 | `/api/v1/patent/applications/{appNo}/continuity` | No |
| 3 | `/api/v1/patent/applications/{appNo}/foreign-priority` | No |
| 4 | `/api/v1/patent/applications/{appNo}/assignment` | No |
| 5 | `/api/v1/patent/applications/{appNo}/attorney` | No |

**Confirmation number validation:** If `confirmationNo` is provided, it's cross-checked against the API response field `applicationMetaData.applicationConfirmationNumber`. Mismatch throws an error.

**Response schema (`UsptoImportResult`):**
```typescript
type UsptoImportResult = {
  // Core identifiers
  applicationNo: string;
  confirmationNo: string;
  title: string;
  filingDate: string;
  effectiveFilingDate: string;
  applicationTypeCode: string;    // "UTL", "DES", "PLT", "PCT"
  applicationTypeLabel: string;   // "Utility", "Design", "Plant"
  entityStatus: string;           // "Regular Undiscounted", "Small Entity", "Micro Entity"
  docketNo: string;
  patentNumber: string;
  grantDate: string;

  // USPTO-specific
  artUnit: string;
  examiner: string;
  applicationStatus: string;      // "Patented Case", "Docketed New Case", etc.
  publicationNumber: string;
  publicationDate: string;
  nationalStage: boolean;
  aiaIndicator: string;           // "Y" or "N"
  customerNumber: number | null;
  cpcClassifications: string[];
  uspcClass: string;
  uspcSubclass: string;

  // Nested arrays
  inventors: Array<{
    firstName: string;
    lastName: string;
    middleName: string;
    fullName: string;
    city: string;
    state: string;
    country: string;
    countryName: string;
    postalCode: string;
    addressLine1: string;
  }>;
  applicants: Array<{
    name: string;
    city: string;
    state: string;
    country: string;
    countryName: string;
  }>;
  attorneys: Array<{
    firstName: string;
    lastName: string;
    registrationNumber: string;
    type: string;     // "ATTNY" or "AGENT"
    phone: string;
  }>;
  continuity: Array<{
    parentApplicationNo: string;
    relationType: string;         // CON, DIV, CIP, PRO
    relationDescription: string;
    filingDate: string;
    patentNumber: string;
    status: string;
  }>;
  foreignPriority: Array<{
    applicationNo: string;
    filingDate: string;
    country: string;
  }>;
};
```

**Data mapping (`mapUsptoResponse`, line 3568):**
- Inventors: from `applicationMetaData.inventorBag[].correspondenceAddressBag[0]`
- Applicants: primary from `applicantBag`, fallback to `assignmentData.assigneeBag`, final fallback to `firstApplicantName`
- Continuity: from `parentContinuityBag`
- Foreign priority: from `foreignPriorityBag`
- Attorneys: from `/attorney` endpoint → `recordAttorney.attorneyBag[].telecommunicationAddressBag[0]`

### 2b. `fetchUsptoDocuments` (line 3875)

```typescript
// Request
{ applicationNo: string }

// Endpoint
GET https://api.uspto.gov/api/v1/patent/applications/{appNo}/documents

// Response
{
  documents: Array<{
    documentIdentifier: string;
    documentCode: string;
    documentCodeDescriptionText: string;
    officialDate: string;
    directionCategory: string;  // "INCOMING" | "OUTGOING"
    pageTotalQuantity: number;
    downloadUrl: string;
    mimeType: string;
  }>
}
```

### 2c. `downloadUsptoDocument` (line 3953)

```typescript
// Request
{ downloadUrl: string; storagePath: string }

// Security: hostname must end with "uspto.gov" (SSRF protection)
// Downloads PDF, saves to Firebase Storage
// Response
{ storagePath: string; size: number }
```

---

## 3. Frontend Flow (USPTO Path)

```
User clicks "Import from USPTO"
  → Enters application number (+ optional confirmation number)
  → Clicks "Import from USPTO" button
  → UploadStep.tsx:141 calls handleUsptoImport()
  → httpsCallable(functions, "importFromUspto")
  → Cloud function hits 5 USPTO endpoints in parallel
  → mapUsptoResponse() structures raw data → UsptoImportResult
  → Frontend maps UsptoImportResult → ImportExtractionResult (lines 156-218)
  → Calls onExtracted(mapped) + onContinue()
  → Auto-advances to Review step
  → User edits data, links DB records
  → Continue → Documents step (auto-fetches via fetchUsptoDocuments)
  → User selects prosecution docs to download
  → Continue → Submit step (read-only summary)
  → "Import Application" → handleSubmit() in index.tsx
  → Creates Firestore records, downloads selected docs in batches of 5
```

**Frontend mapping helpers (UploadStep.tsx):**
- `formatApplicationNo()` — `"17654170"` → `"17/654,170"`
- `mapEntityStatus()` — `"Micro Entity"` → `"Micro"`
- `mapSubjectMatter()` — `"DES"` → `"Design"`
- `mapFilingType()` — determines `"provisional"` vs `"nonprovisional"`
- `mapContinuityType()` — `"CON"` → `"continuation"`, `"CIP"` → `"continuation-in-part"`, etc.

---

## 4. The Limitation: Application Number Only

Currently, the entire USPTO import path requires the user to know the **exact application number**. There is no search functionality. The API endpoint used (`api.uspto.gov/api/v1/patent/applications/{appNo}`) is a direct-lookup endpoint, not a search endpoint.

---

## 5. USPTO ODP Search API — What's Available

The USPTO Open Data Portal exposes a **search endpoint** that the app does NOT currently use:

### Search Endpoint

```
POST https://data.uspto.gov/apis/patent-file-wrapper/search
Header: X-API-KEY: <same key>
Header: Accept: application/json
```

### Searchable Fields

| Field | ODP API Name | Type | Notes |
|-------|-------------|------|-------|
| Application Number | `applicationNumberText` | text | e.g., "14412875" |
| Invention Title | `inventionTitle` | text | Full-text keyword search |
| Patent Number | `applicationMetaData.patentNumber` | text | Granted patent number |
| First Inventor Name | `firstInventorName` | text | Quick inventor search |
| Inventor Name (nested) | `applicationMetaData.inventorBag.inventorNameText` | text | Full inventor name |
| First Applicant Name | `firstApplicantName` | text | Applicant / assignee |
| Filing Date | `filingDate` | date | Supports range (from/to) |
| Application Type | `applicationTypeLabelName` | enum | "Utility", "Design", "Plant" |
| Confirmation Number | `applicationConfirmationNumber` | text | |
| Docket Number | `docketNumber` | text | Attorney docket |
| Art Unit | `groupArtUnitNumber` | text | USPTO group art unit |
| Customer Number | `customerNumber` | number | Attorney customer number |
| CPC Classification | `cpcClassificationBag` | text | CPC class codes |
| Entity Status | `businessEntityStatusCategory` | text | Micro/Small/Large |
| AIA Indicator | `firstInventorToFileIndicator` | text | First-to-file |
| Publication Number | `earliestPublicationNumber` | text | Published app number |

### Query Syntax Options

**Option 1 — Simple field:value (Simplified Query Syntax):**
```
q=inventionTitle:Nanobody AND filingDate:2024-01-01
```

**Option 2 — Structured filters:**
```json
{
  "q": "Nanobody",
  "filters": [
    { "name": "applicationTypeLabelName", "value": ["Utility"] }
  ],
  "rangeFilters": [
    { "field": "filingDate", "valueFrom": "2022-01-01", "valueTo": "2023-12-31" }
  ],
  "pagination": { "offset": 0, "limit": 25 },
  "sort": [{ "field": "filingDate", "order": "Desc" }]
}
```

**Option 3 — OpenSearch Query (most powerful):**
Full boolean logic with nested conditions, wildcards, and complex filters.

### Important Notes

- **Coverage:** Only applications filed on or after January 1, 2001
- **Authentication:** Same `X-API-KEY` header (same API key should work)
- **Base URL difference:** Search is on `data.uspto.gov`, not `api.uspto.gov`
- **Rate limits:** ~60 requests/min per API key (subject to change)
- **Response:** Returns an array of matching applications with the fields listed above

---

## 6. What Needs to Be Built

### Backend (Cloud Function)

A new cloud function `searchUspto` that:
1. Accepts a search query object (title, inventor, applicant, patent number, date range, etc.)
2. Constructs the appropriate query for the `data.uspto.gov` search endpoint
3. Returns paginated results (application number, title, filing date, status, inventor, applicant — enough for user to identify the correct app)

### Frontend (UploadStep.tsx modification)

1. **Search form** — When user selects "Import from USPTO", show a tabbed or expandable form with:
   - Application Number (existing — direct lookup)
   - Patent Number
   - Invention Title (keyword)
   - Inventor Name
   - Applicant/Assignee Name
   - Filing Date Range
   - Docket Number
2. **Search results list** — Display matching applications in a table/list for user selection
3. **Selection → existing flow** — Once user selects an application from results, extract the application number and feed it into the existing `importFromUspto` function (which fetches full data)

### What Stays the Same

- `importFromUspto` cloud function (unchanged — still used for full data fetch after selection)
- `fetchUsptoDocuments` and `downloadUsptoDocument` (unchanged)
- `mapUsptoResponse` mapper (unchanged)
- Review, Documents, and Submit steps (unchanged)
- All TypeScript types (unchanged)
- Frontend mapping helpers (unchanged)

---

## 7. References

- [USPTO ODP Patent File Wrapper Search API](https://data.uspto.gov/apis/patent-file-wrapper/search)
- [ODP API Query Specification (PDF)](https://data.uspto.gov/documents/documents/ODP-API-Query-Spec.pdf)
- [Patent Client — ODP Documentation](https://patent-client.readthedocs.io/en/latest/user_guide/open_data_portal.html)
- [KennethThompson/uspto_odp (Python client with query examples)](https://github.com/KennethThompson/uspto_odp)
- [USPTO ODP API Syntax Examples](https://data.uspto.gov/apis/api-syntax-examples)
- [data.gov catalog entry (all PFW endpoints)](https://catalog.data.gov/dataset/open-data-portal-odp-patent-file-wrapper-pfw-api-search-application-data-continuity-docume)
