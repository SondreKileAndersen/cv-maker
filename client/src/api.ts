import { CvDocument } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export async function generatePdf(document: CvDocument): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/pdf/${document.templateId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `PDF-generering feilet med status ${response.status}`);
  }

  return await response.blob();
}

export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}
