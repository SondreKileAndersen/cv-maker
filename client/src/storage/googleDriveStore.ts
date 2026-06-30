import { CvDocument } from '../types';
import { blankCv } from '../sampleData';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const PROJECT_FILE = 'cv-project.json';
const ROOT_FOLDER_NAME = 'CV Kiwi';
const EXPORTS_FOLDER_NAME = 'exports';

type TokenClient = {
  callback: (response: { access_token?: string; error?: string }) => void;
  requestAccessToken: (options?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

export interface GoogleDriveState {
  configured: boolean;
  connected: boolean;
  directoryName?: string;
}

export class GoogleDriveProjectStore {
  private accessToken?: string;
  private rootFolderId?: string;

  get state(): GoogleDriveState {
    return {
      configured: Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID),
      connected: Boolean(this.accessToken && this.rootFolderId),
      directoryName: this.rootFolderId ? ROOT_FOLDER_NAME : undefined
    };
  }

  async connect(): Promise<GoogleDriveState> {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('Google Drive er ikke konfigurert. Legg VITE_GOOGLE_CLIENT_ID i client/.env.local.');
    }

    await loadGoogleIdentityScript();
    const token = await requestAccessToken(clientId, 'consent');
    this.accessToken = token;
    this.rootFolderId = await this.findOrCreateFolder(ROOT_FOLDER_NAME);
    return this.state;
  }

  async restore(): Promise<GoogleDriveState> {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error('Google Drive er ikke konfigurert.');

    await loadGoogleIdentityScript();
    this.accessToken = await requestAccessToken(clientId, '');
    this.rootFolderId = await this.findFile(ROOT_FOLDER_NAME, undefined, FOLDER_MIME_TYPE);
    if (!this.rootFolderId) {
      this.accessToken = undefined;
      throw new Error('Fant ikke CV Kiwi-mappen i Google Drive.');
    }
    return this.state;
  }

  async loadProject(): Promise<CvDocument> {
    const fileId = await this.findFile(PROJECT_FILE, this.requireRootFolder());
    if (!fileId) return structuredClone(blankCv);

    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return await response.json() as CvDocument;
  }

  async saveProject(document: CvDocument) {
    const rootFolderId = this.requireRootFolder();
    const fileId = await this.findFile(PROJECT_FILE, rootFolderId);
    const content = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
    await this.uploadFile(PROJECT_FILE, 'application/json', content, rootFolderId, fileId);
  }

  async saveGeneratedPdf(fileName: string, pdf: Blob) {
    const exportsFolderId = await this.findOrCreateFolder(EXPORTS_FOLDER_NAME, this.requireRootFolder());
    await this.uploadFile(fileName, 'application/pdf', pdf, exportsFolderId);
  }

  disconnect() {
    this.accessToken = undefined;
    this.rootFolderId = undefined;
  }

  private async findOrCreateFolder(name: string, parentId?: string): Promise<string> {
    const existing = await this.findFile(name, parentId, FOLDER_MIME_TYPE);
    if (existing) return existing;

    const metadata: Record<string, unknown> = { name, mimeType: FOLDER_MIME_TYPE };
    if (parentId) metadata.parents = [parentId];
    const response = await this.request('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      body: JSON.stringify(metadata)
    });
    const created = await response.json() as { id: string };
    return created.id;
  }

  private async findFile(name: string, parentId?: string, mimeType?: string): Promise<string | undefined> {
    const clauses = [`name = '${name.replace(/'/g, "\\'")}'`, 'trashed = false'];
    if (parentId) clauses.push(`'${parentId}' in parents`);
    if (mimeType) clauses.push(`mimeType = '${mimeType}'`);
    const query = encodeURIComponent(clauses.join(' and '));
    const response = await this.request(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`);
    const result = await response.json() as { files: Array<{ id: string }> };
    return result.files[0]?.id;
  }

  private async uploadFile(name: string, mimeType: string, content: Blob, parentId: string, fileId?: string) {
    const metadata = fileId ? {} : { name, mimeType, parents: [parentId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', content, name);
    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    await this.request(url, { method: fileId ? 'PATCH' : 'POST', body: form });
  }

  private requireRootFolder(): string {
    if (!this.rootFolderId) throw new Error('Google Drive er ikke koblet til.');
    return this.rootFolderId;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) throw new Error('Google Drive er ikke koblet til.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...init, headers });
    if (!response.ok) throw new Error(`Google Drive-feil (${response.status}): ${await response.text()}`);
    return response;
  }
}

function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Kunne ikke laste Google-innlogging.'));
    document.head.appendChild(script);
  });
}

function requestAccessToken(clientId: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: response => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? 'Google-autorisasjon ble avbrutt.'));
          return;
        }
        resolve(response.access_token);
      }
    });
    client.requestAccessToken({ prompt });
  });
}
