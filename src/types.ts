// --- Search Request ---

export interface SearchRequest {
  q?: string;
  filters?: Array<{ name: string; value: string[] }>;
  rangeFilters?: Array<{ field: string; valueFrom: string; valueTo: string }>;
  pagination?: { offset: number; limit: number };
  sort?: Array<{ field: string; order: 'Asc' | 'Desc' }>;
  fields?: string[];
}

// --- Search Response ---

export interface SearchResponse {
  count: number;
  requestIdentifier?: string;
  patentFileWrapperDataBag: PatentFileWrapperData[];
}

// --- Correspondence Address (shared across inventors, applicants, top-level) ---

export interface CorrespondenceAddress {
  fullAddressText?: string;
  cityName?: string;
  geographicRegionCode?: string;
  geographicRegionName?: string;
  countryCode?: string;
  countryName?: string;
  postalCode?: string;
  streetLineOneText?: string;
  streetLineTwoText?: string;
  streetLineThreeText?: string;
  customerNumber?: number;
}

// --- Inventor ---

export interface InventorData {
  inventorNameText?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  namePrefix?: string;
  nameSuffix?: string;
  countryCode?: string;
  rankOrder?: number;
  correspondenceAddressBag?: CorrespondenceAddress[];
}

// --- Applicant ---

export interface ApplicantData {
  applicantNameText?: string;
  applicantTypeCategory?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  namePrefix?: string;
  nameSuffix?: string;
  rankOrder?: number;
  correspondenceAddressBag?: CorrespondenceAddress[];
}

// --- Entity Status ---

export interface EntityStatusData {
  smallEntityStatusIndicator?: boolean;
  businessEntityStatusCategory?: string;
}

// --- Application MetaData ---

export interface ApplicationMetaData {
  inventionTitle?: string;
  filingDate?: string;
  effectiveFilingDate?: string;
  applicationStatusCode?: number;
  applicationStatusDescriptionText?: string;
  applicationStatusDate?: string;
  patentNumber?: string;
  grantDate?: string;
  applicationTypeLabelName?: string;
  applicationTypeCategory?: string;
  applicationTypeCode?: string;
  firstInventorToFileIndicator?: string;
  firstInventorName?: string;
  firstApplicantName?: string;
  groupArtUnitNumber?: string;
  customerNumber?: number;
  cpcClassificationBag?: string[];
  examinerNameText?: string;
  applicationConfirmationNumber?: string;
  docketNumber?: string;
  earliestPublicationNumber?: string;
  earliestPublicationDate?: string;
  class?: string;
  subclass?: string;
  uspcSymbolText?: string;
  nationalStageIndicator?: boolean;
  publicationDateBag?: string[];
  publicationSequenceNumberBag?: string[];
  publicationCategoryBag?: string[];
  pctPublicationNumber?: string;
  pctPublicationDate?: string;
  entityStatusData?: EntityStatusData;
  inventorBag?: InventorData[];
  applicantBag?: ApplicantData[];
}

// --- Assignment ---

export interface AssignorData {
  executionDate?: string;
  assignorNameText?: string;
}

export interface AssigneeData {
  assigneeNameText?: string;
}

export interface AssigneeAddress {
  fullAddressText?: string;
  cityName?: string;
  geographicRegionCode?: string;
  geographicRegionName?: string;
  countryCode?: string;
  countryName?: string;
  postalCode?: string;
  streetLineOneText?: string;
  streetLineTwoText?: string;
  streetLineThreeText?: string;
  streetLineFourText?: string;
  streetLineFiveText?: string;
}

export interface AssignmentCorrespondenceAddress {
  fullAddressText?: string;
  nameText?: string;
  cityName?: string;
  geographicRegionCode?: string;
  postalCode?: string;
}

export interface DomesticRepresentative {
  nameText?: string;
  cityName?: string;
  geographicRegionCode?: string;
  geographicRegionName?: string;
  countryCode?: string;
  countryName?: string;
  postalCode?: string;
  streetLineOneText?: string;
  streetLineTwoText?: string;
  fullAddressText?: string;
}

export interface AssignmentData {
  mailDate?: string;
  receivedDate?: string;
  recordedDate?: string;
  correspondenceDate?: string;
  pageCount?: number;
  reelNumber?: string;
  frameNumber?: string;
  conveyanceText?: string;
  assignmentRoleText?: string;
  publicationIdentifier?: string;
  assignorBag?: AssignorData[];
  assigneeBag?: AssigneeData[];
  assigneeAddress?: AssigneeAddress;
  correspondenceAddress?: AssignmentCorrespondenceAddress;
  domesticRepresentative?: DomesticRepresentative;
}

// --- Record Attorney ---

export interface TelecommunicationAddress {
  telephoneNumber?: string;
  faxNumber?: string;
  emailAddress?: string;
}

export interface AttorneyData {
  registrationNumber?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  namePrefix?: string;
  nameSuffix?: string;
  activeIndicator?: boolean;
  rankOrder?: number;
  telecommunicationAddressBag?: TelecommunicationAddress[];
}

export interface PowerOfAttorneyAddress {
  fullAddressText?: string;
  nameText?: string;
  cityName?: string;
  geographicRegionCode?: string;
  geographicRegionName?: string;
  countryCode?: string;
  countryName?: string;
  postalCode?: string;
  streetLineOneText?: string;
}

export interface RecordAttorneyData {
  customerNumberCorrespondenceData?: {
    customerNumber?: number;
    correspondenceNameText?: string;
  };
  powerOfAttorneyAddressBag?: PowerOfAttorneyAddress[];
  telecommunicationAddressBag?: TelecommunicationAddress[];
  attorneyBag?: AttorneyData[];
}

// --- Continuity ---

export interface ContinuityData {
  parentApplicationNumberText?: string;
  childApplicationNumberText?: string;
  filingDate?: string;
  parentFilingDate?: string;
  childFilingDate?: string;
  parentApplicationStatusCode?: number;
  childApplicationStatusCode?: number;
  claimType?: string;
  applicationTypeLabelName?: string;
  patentNumber?: string;
  aiaIndicator?: boolean;
}

// --- Foreign Priority ---

export interface ForeignPriorityData {
  foreignPriorityDate?: string;
  countryName?: string;
  foreignApplicationNumberText?: string;
}

// --- Patent Term Adjustment ---

export interface PatentTermAdjustmentHistoryData {
  ptaOrPteDate?: string;
  contentDescriptionText?: string;
  applicantDayDelay?: number;
  ptoDayDelay?: number;
  ipOfficeDayDelay?: number;
  overlapDayDelay?: number;
  numberOfDays?: number;
}

export interface PatentTermAdjustmentData {
  aDelay?: number;
  bDelay?: number;
  cDelay?: number;
  overlapDelay?: number;
  applicantDayDelay?: number;
  totalPtaDays?: number;
  ptaAdjustmentTotalDays?: number;
  patentTermAdjustmentHistoryDataBag?: PatentTermAdjustmentHistoryData[];
}

// --- Event Data ---

export interface EventData {
  eventCode?: string;
  eventDate?: string;
  eventDescriptionText?: string;
}

// --- Publication Metadata ---

export interface PgpubDocumentMetaData {
  pgpubDocumentIdentifier?: string;
  pgpubDate?: string;
  inventionTitle?: string;
  pgpubAbstractText?: string;
  pgpubSequenceNumber?: string;
}

export interface GrantDocumentMetaData {
  grantDocumentIdentifier?: string;
  grantDate?: string;
  inventionTitle?: string;
  grantAbstractText?: string;
  grantDocumentSequenceNumber?: string;
}

// --- Main PatentFileWrapperData (top-level response object) ---

export interface PatentFileWrapperData {
  applicationNumberText: string;
  lastIngestionDateTime?: string;
  applicationMetaData?: ApplicationMetaData;
  assignmentBag?: AssignmentData[];
  parentContinuityBag?: ContinuityData[];
  childContinuityBag?: ContinuityData[];
  foreignPriorityBag?: ForeignPriorityData[];
  recordAttorney?: RecordAttorneyData;
  correspondenceAddressBag?: CorrespondenceAddress[];
  patentTermAdjustmentData?: PatentTermAdjustmentData;
  eventDataBag?: EventData[];
  pgpubDocumentMetaData?: PgpubDocumentMetaData;
  grantDocumentMetaData?: GrantDocumentMetaData;
  prosecutionHistoryDataBag?: unknown[];
}

// --- UI Form State ---

export type QueryMode = 'simple' | 'structured' | 'raw';

export interface SearchFormState {
  queryMode: QueryMode;
  simpleQuery: string;
  inventionTitle: string;
  firstInventorName: string;
  firstApplicantName: string;
  applicationNumberText: string;
  patentNumber: string;
  docketNumber: string;
  filingDateFrom: string;
  filingDateTo: string;
  applicationTypeLabelName: string;
  examinerNameText: string;
  groupArtUnitNumber: string;
  cpcClassificationBag: string;
  applicationConfirmationNumber: string;
  earliestPublicationNumber: string;
  rawJson: string;
  offset: number;
  limit: number;
  sortField: string;
  sortOrder: 'Asc' | 'Desc';
}

// --- Log Entry ---

export interface LogEntry {
  timestamp: Date;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  error?: string;
}
