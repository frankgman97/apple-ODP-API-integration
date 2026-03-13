import type { PatentFileWrapperData } from './types';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  triggerDownload(blob, filename);
}

export function exportCSV(data: PatentFileWrapperData[], filename: string) {
  const columns = [
    'applicationNumberText',
    'inventionTitle',
    'filingDate',
    'patentNumber',
    'grantDate',
    'firstInventorName',
    'firstApplicantName',
    'applicationType',
    'entityStatus',
    'applicationStatus',
    'groupArtUnit',
    'cpcClassifications',
    'docketNumber',
    'publicationNumber',
  ];

  const escapeCSV = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const rows = data.map((d) => {
    const m = d.applicationMetaData;
    return [
      d.applicationNumberText ?? '',
      m?.inventionTitle ?? '',
      m?.filingDate ?? '',
      m?.patentNumber ?? '',
      m?.grantDate ?? '',
      m?.firstInventorName ?? '',
      m?.firstApplicantName ?? '',
      m?.applicationTypeLabelName ?? '',
      m?.entityStatusData?.businessEntityStatusCategory ?? '',
      m?.applicationStatusDescriptionText ?? '',
      m?.groupArtUnitNumber ?? '',
      (m?.cpcClassificationBag ?? []).join('; '),
      m?.docketNumber ?? '',
      m?.earliestPublicationNumber ?? '',
    ].map(escapeCSV);
  });

  const csv = [columns.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  triggerDownload(blob, filename);
}

export function exportRawResponse(response: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
  triggerDownload(blob, filename);
}
