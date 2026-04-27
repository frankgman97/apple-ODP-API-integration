import type { ColDef } from 'ag-grid-community'

export const columnDefs: ColDef[] = [
  { field: 'application_number', headerName: 'App Number', width: 140, pinned: 'left' },
  { field: 'invention_title', headerName: 'Title', flex: 2, minWidth: 250 },
  { field: 'app_type', headerName: 'Type', width: 100 },
  { field: 'app_status', headerName: 'Status', width: 260 },
  { field: 'app_status_date', headerName: 'Status Date', width: 120, hide: true },
  { field: 'filing_date', headerName: 'Filing Date', width: 120, sort: 'desc' },
  { field: 'patent_number', headerName: 'Patent #', width: 120 },
  { field: 'grant_date', headerName: 'Grant Date', width: 120, hide: true },
  { field: 'first_applicant', headerName: 'Applicant', width: 200 },
  { field: 'first_inventor', headerName: 'Inventor', width: 180 },
  { field: 'examiner', headerName: 'Examiner', width: 180 },
  { field: 'group_art_unit', headerName: 'Art Unit', width: 100, hide: true },
  { field: 'cpc_classifications', headerName: 'CPC', width: 180, hide: true },
  { field: 'docket_number', headerName: 'Docket #', width: 140, hide: true },
  { field: 'pub_number', headerName: 'Pub #', width: 140, hide: true },
  { field: 'pub_date', headerName: 'Pub Date', width: 120, hide: true },
  { field: 'correspondence_address', headerName: 'Correspondence', width: 300, hide: true },
]
