import { openDB } from 'idb';
import { CvDocument } from '../types';
import { blankCv } from '../sampleData';

const DB_NAME = 'cv-pdf-builder';
const STORE_NAME = 'handles';
const BROWSER_PROJECT_STORE_NAME = 'browser-projects';
const HANDLE_KEY = 'project-directory';
const BROWSER_PROJECT_KEY = 'active-project';
const PROJECT_FILE = 'cv-project.json';
const EXPORT_DIR = 'exports';

export interface ProjectStoreState {
  supported: boolean;
  connected: boolean;
  directoryName?: string;
}

async function db() {
  return openDB(DB_NAME, 2, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      if (!database.objectStoreNames.contains(BROWSER_PROJECT_STORE_NAME)) database.createObjectStore(BROWSER_PROJECT_STORE_NAME);
    }
  });
}

async function getSavedHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const database = await db();
  return await database.get(STORE_NAME, HANDLE_KEY);
}

async function setSavedHandle(handle: FileSystemDirectoryHandle) {
  const database = await db();
  await database.put(STORE_NAME, handle, HANDLE_KEY);
}

async function deleteSavedHandle() {
  const database = await db();
  await database.delete(STORE_NAME, HANDLE_KEY);
}

async function verifyPermission(handle: FileSystemDirectoryHandle, write = true): Promise<boolean> {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: write ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(descriptor)) === 'granted') return true;
  return (await handle.requestPermission(descriptor)) === 'granted';
}

async function hasGrantedPermission(handle: FileSystemDirectoryHandle, write = true): Promise<boolean> {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: write ? 'readwrite' : 'read' };
  return (await handle.queryPermission(descriptor)) === 'granted';
}

async function getProjectFile(handle: FileSystemDirectoryHandle, create = true) {
  return await handle.getFileHandle(PROJECT_FILE, { create });
}

async function readText(fileHandle: FileSystemFileHandle): Promise<string> {
  const file = await fileHandle.getFile();
  return await file.text();
}

async function writeText(fileHandle: FileSystemFileHandle, content: string) {
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function writeBlob(fileHandle: FileSystemFileHandle, blob: Blob) {
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export class FileSystemProjectStore {
  private handle?: FileSystemDirectoryHandle;
  private savedHandle?: FileSystemDirectoryHandle;

  get state(): ProjectStoreState {
    return {
      supported: typeof window.showDirectoryPicker === 'function',
      connected: Boolean(this.handle),
      directoryName: this.handle?.name
    };
  }

  async hydrate(): Promise<ProjectStoreState> {
    this.savedHandle = await getSavedHandle();
    this.handle = this.savedHandle && await hasGrantedPermission(this.savedHandle) ? this.savedHandle : undefined;
    return this.state;
  }

  async reconnectSavedDirectory(): Promise<ProjectStoreState> {
    const saved = this.savedHandle ?? await getSavedHandle();
    if (saved && await verifyPermission(saved)) {
      this.savedHandle = saved;
      this.handle = saved;
      await this.ensureStructure();
    }
    return this.state;
  }

  async chooseDirectory(initialDocument: CvDocument = blankCv): Promise<ProjectStoreState> {
    if (!window.showDirectoryPicker) {
      return this.state;
    }

    this.handle = await window.showDirectoryPicker();
    this.savedHandle = this.handle;
    await verifyPermission(this.handle);
    await setSavedHandle(this.handle);
    await this.ensureStructure(initialDocument);
    return this.state;
  }

  async disconnect() {
    this.handle = undefined;
    await deleteSavedHandle();
  }

  async ensureStructure(initialDocument: CvDocument = blankCv) {
    if (!this.handle) return;
    await this.handle.getDirectoryHandle(EXPORT_DIR, { create: true });
    const file = await getProjectFile(this.handle, true);
    const current = await readText(file).catch(() => '');
    if (!current.trim()) {
      await writeText(file, JSON.stringify(initialDocument, null, 2));
    }
  }

  async loadProject(): Promise<CvDocument> {
    if (!this.handle) return structuredClone(blankCv);
    await this.ensureStructure();
    const file = await getProjectFile(this.handle, true);
    const content = await readText(file);
    return JSON.parse(content) as CvDocument;
  }

  async saveProject(document: CvDocument) {
    if (!this.handle) {
      throw new Error('Ingen prosjektmappe er valgt.');
    }

    const file = await getProjectFile(this.handle, true);
    await writeText(file, JSON.stringify(document, null, 2));
  }

  async saveGeneratedPdf(fileName: string, pdf: Blob) {
    if (!this.handle) return;
    const exportDir = await this.handle.getDirectoryHandle(EXPORT_DIR, { create: true });
    const pdfFile = await exportDir.getFileHandle(fileName, { create: true });
    await writeBlob(pdfFile, pdf);
  }
}

export async function loadBrowserProject(): Promise<CvDocument | null> {
  const database = await db();
  return await database.get(BROWSER_PROJECT_STORE_NAME, BROWSER_PROJECT_KEY) ?? null;
}

export async function saveBrowserProject(document: CvDocument) {
  const database = await db();
  await database.put(BROWSER_PROJECT_STORE_NAME, document, BROWSER_PROJECT_KEY);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
