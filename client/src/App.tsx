import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { healthCheck } from './api';
import { ProfileEditor } from './components/ProfileEditor';
import { SectionEditor, type MasterEditSession } from './components/SectionEditor';
import { SkillsReferencesEditor } from './components/SkillsReferencesEditor';
import { CvPreview, type CvFormatSettings } from './components/CvPreview';
import { FileSystemProjectStore, downloadBlob, loadBrowserProject, saveBrowserProject, ProjectStoreState } from './storage/fileSystemStore';
import { GoogleDriveProjectStore, GoogleDriveState } from './storage/googleDriveStore';
import { blankCv, exampleCv, withRequiredSections } from './sampleData';
import { CvDocument, CvProjectVersion, CvSection, CvVersionOverrideState, RichLine } from './types';
import { createCvVersion, getMasterBlocks, getSectionIcon, isItemSelection } from './cvVersion';
import { Icon, iconLoaded, loadIcons } from '@iconify/react';
import googleDriveIcon from './media/Google_Drive_icon.svg';
import './styles.css';

const STORAGE_CHOICE_KEY = 'cv-kiwi-storage-choice';
const PC_STORAGE_GUIDE_DISMISSED_KEY = 'cv-kiwi-pc-storage-guide-dismissed';
// Temporary development setting: always open the populated drag-and-drop project.
const USE_FILLED_TEST_PROJECT = false;
// Keep the existing drag-and-drop implementation available for later, but use
// direct include toggles while the CV builder is being simplified.
const USE_DRAG_DROP_CV_BUILDER = false;
const ACTIVE_CV_VERSION_ID = 'current';
const DEFAULT_FORMAT_SETTINGS: CvFormatSettings = {
  lineHeight: 1.45,
  nameSize: 22,
  sectionTitleSize: 12,
  subtitleSize: 11,
  paragraphSize: 11,
  experienceGap: 16,
  experienceElementGap: 5,
  titleUnderlineGap: 0,
  accentColor: '#ffae3d',
  nameColor: '#ffffff',
  personalTextColor: '#d3d3d3',
  sectionTitleColor: '#ffffff',
  entryTitleColor: '#000000',
  metadataColor: '#7a7a7a',
  paragraphColor: '#7a7a7a',
  photoSize: 54,
  showTitleIcons: false,
  showPersonalIcons: true,
  inlineQualificationMetadata: false,
  inlineExperienceMetadata: false,
  linkColor: '#007e7a',
  pageMargins: 24,
  verticalPageMargins: 12,
  sectionTitleBeforeGap: 16,
  sectionTitleAfterGap: 18,
  qualificationTitleDescriptionGap: 18
};
const UNDO_HISTORY_LIMIT = 100;

type AppHistorySnapshot = {
  document: CvDocument;
  cvBlockIds: string[];
  formatSettings: CvFormatSettings;
  activeCvVersionId: string;
};

function sameHistorySnapshot(left: AppHistorySnapshot, right: AppHistorySnapshot) {
  if (left.activeCvVersionId !== right.activeCvVersionId) return false;
  if (left.cvBlockIds.length !== right.cvBlockIds.length || left.cvBlockIds.some((id, index) => id !== right.cvBlockIds[index])) return false;
  if (Object.keys(left.formatSettings).some(key => left.formatSettings[key as keyof CvFormatSettings] !== right.formatSettings[key as keyof CvFormatSettings])) return false;

  const ignoredDocumentKeys = new Set<keyof CvDocument>(['formatSettings', 'selectedBlockIds', 'activeCvVersionId']);
  const documentKeys = new Set([...Object.keys(left.document), ...Object.keys(right.document)] as Array<keyof CvDocument>);
  for (const key of documentKeys) {
    if (!ignoredDocumentKeys.has(key) && left.document[key] !== right.document[key]) return false;
  }
  return true;
}
const MASTER_OVERLAY_STATIC_ICONS = [
  'mdi:account', 'mdi:account-outline', 'mdi:account-group', 'mdi:account-tie',
  'mdi:briefcase', 'mdi:briefcase-outline', 'mdi:school', 'mdi:school-outline',
  'mdi:star', 'mdi:star-outline', 'mdi:star-four-points', 'mdi:hand-back-left', 'mdi:certificate', 'mdi:book-open-variant',
  'mdi:laptop', 'mdi:translate', 'mdi:heart', 'mdi:file-document', 'mdi:pencil',
  'mdi:plus', 'mdi:link-variant', 'mdi:format-clear', 'mdi:content-copy',
  'mdi:image-plus', 'mdi:flip-horizontal', 'mdi:email', 'mdi:phone', 'mdi:calendar', 'mdi:monitor',
  'mdi:web', 'mdi:map-marker', 'mdi:linkedin', 'mdi:share-variant',
  'mdi:key-variant', 'mdi:radiobox-marked', 'mdi:radiobox-blank', 'mdi:delete-outline', 'mdi:file-pdf-box', 'mdi:file-document-outline'
];

function getSavedCvSelections(document: CvDocument) {
  const activeVersion = document.cvVersions?.find(version => version.id === document.activeCvVersionId) ?? document.cvVersions?.[0];
  if (activeVersion) return activeVersion.selectedBlockIds;
  if (document.cvSelectionInitialized) return document.selectedBlockIds ?? [];
  return defaultCvSelections(document);
}

function defaultCvSelections(document: CvDocument) {
  return ['profile', ...document.sections.map(section => section.id), 'references'];
}

function orderByStoredIds<T>(items: T[], storedIds: string[] | undefined, getId: (item: T) => string) {
  if (!storedIds?.length) return items;
  const positions = new Map(storedIds.map((id, index) => [id, index]));
  return items
    .map((item, originalIndex) => ({ item, originalIndex, position: positions.get(getId(item)) }))
    .sort((left, right) => {
      if (left.position !== undefined && right.position !== undefined) return left.position - right.position;
      if (left.position !== undefined) return -1;
      if (right.position !== undefined) return 1;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ item }) => item);
}

function applyCvPreviewOrder(document: CvDocument, overrides: CvVersionOverrideState) {
  const sections = orderByStoredIds(document.sections, overrides.sectionOrderIds, section => section.id)
    .map(section => ({
      ...section,
      entries: orderByStoredIds(section.entries, overrides.entryOrderIds?.[section.id], entry => entry.id)
    }));
  return { ...document, sections };
}

function newestProject(primary: CvDocument, browserBackup: CvDocument | null) {
  if (!browserBackup) return primary;
  const primaryTime = primary.updatedAt ? Date.parse(primary.updatedAt) : 0;
  const browserTime = browserBackup.updatedAt ? Date.parse(browserBackup.updatedAt) : 0;
  return browserTime > primaryTime ? browserBackup : primary;
}

function getMasterOverlayIcons(document: CvDocument) {
  return Array.from(new Set([
    ...MASTER_OVERLAY_STATIC_ICONS,
    ...getMasterBlocks(document).map(block => block.icon),
    ...document.sections.map(section => getSectionIcon(section)),
    ...(document.profile.personalDetails ?? []).map(detail => detail.icon).filter((icon): icon is string => Boolean(icon))
  ]));
}

function waitForIcons(icons: string[]) {
  const pending = Array.from(new Set(icons)).filter(icon => !iconLoaded(icon));
  if (pending.length === 0) return Promise.resolve();

  return new Promise<void>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (typeof unsubscribe === 'function') unsubscribe();
      resolve();
    };
    const timeout = window.setTimeout(finish, 1500);
    const unsubscribe = loadIcons(pending, finish);
  });
}

export default function App() {
  const store = useMemo(() => new FileSystemProjectStore(), []);
  const googleDrive = useMemo(() => new GoogleDriveProjectStore(), []);
  const [storeState, setStoreState] = useState<ProjectStoreState>({ supported: false, connected: false });
  const [googleDriveState, setGoogleDriveState] = useState<GoogleDriveState>(googleDrive.state);
  const [storage, setStorage] = useState<'local' | 'browser' | 'google' | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [storageMenuOpen, setStorageMenuOpen] = useState(false);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [customSectionTitle, setCustomSectionTitle] = useState('');
  const [customCategoryCreator, setCustomCategoryCreator] = useState<'nav' | 'overlay' | null>(null);
  const [cvBlockIds, setCvBlockIds] = useState<string[]>(() => getSavedCvSelections(withRequiredSections(USE_FILLED_TEST_PROJECT ? exampleCv : blankCv)));
  const [qualificationAttention, setQualificationAttention] = useState(false);
  const qualificationAttentionTimerRef = useRef<number | null>(null);
  const [pendingQualificationAttentionBlockId, setPendingQualificationAttentionBlockId] = useState<string | null>(null);
  const [expandedMasterBlockIds, setExpandedMasterBlockIds] = useState<string[]>([]);
  const [editingMasterEntrySectionIds, setEditingMasterEntrySectionIds] = useState<string[]>([]);
  const [editingMasterBlockId, setEditingMasterBlockId] = useState<string | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [mode, setMode] = useState<'cv' | 'master'>('cv');
  const [masterInfoOpen, setMasterInfoOpen] = useState(false);
  const [masterInfoClosing, setMasterInfoClosing] = useState(false);
  const [masterNavMode, setMasterNavMode] = useState<'cv' | 'master'>('cv');
  const [activeMasterBlockId, setActiveMasterBlockId] = useState('profile');
  const versionNavRef = useRef<HTMLElement | null>(null);
  const cvVersionManagerRef = useRef<HTMLDivElement | null>(null);
  const contentColumnRef = useRef<HTMLDivElement | null>(null);
  const masterInfoOverlayRef = useRef<HTMLElement | null>(null);
  const masterInfoScrollRef = useRef<HTMLDivElement | null>(null);
  const masterBlockScrollRef = useRef<HTMLDivElement | null>(null);
  const jsonImportRef = useRef<HTMLInputElement | null>(null);
  const railSaveRef = useRef<HTMLButtonElement | null>(null);
  const railUploadRef = useRef<HTMLButtonElement | null>(null);
  const latestBrowserProjectRef = useRef<CvDocument | null>(null);
  const editingMasterEntrySectionsRef = useRef(new Set<string>());
  const activeMasterEditSessionRef = useRef<MasterEditSession | null>(null);
  const undoHistoryRef = useRef<{ past: AppHistorySnapshot[]; present: AppHistorySnapshot | null; future: AppHistorySnapshot[] }>({ past: [], present: null, future: [] });
  const historyApplyingRef = useRef(false);
  const historyResetPendingRef = useRef(false);
  const masterNavigationLockedRef = useRef(false);
  const masterNavigationUnlockTimerRef = useRef<number | null>(null);
  const masterActiveOverrideRef = useRef<string | null>(null);
  const masterActiveOverrideUntilRef = useRef(0);
  const masterOverlayScrollEndTimerRef = useRef<number | null>(null);
  const [document, setDocument] = useState<CvDocument>(() => structuredClone(withRequiredSections(USE_FILLED_TEST_PROJECT ? exampleCv : blankCv)));
  const [activeCvVersionId, setActiveCvVersionId] = useState(() => document.activeCvVersionId ?? document.cvVersions?.[0]?.id ?? 'cv-1');
  const [cvVersionMenuOpen, setCvVersionMenuOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [pcStorageGuideOpen, setPcStorageGuideOpen] = useState(false);
  const [pcStorageGuideTop, setPcStorageGuideTop] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [storageDebugTitle, setStorageDebugTitle] = useState('');
  const [storageDebugOutput, setStorageDebugOutput] = useState('');
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [status, setStatus] = useState('Velg en lagringsløsning, eller start uten lagring.');
  const [masterBlockScrollState, setMasterBlockScrollState] = useState({ canScrollUp: false, canScrollDown: false });
  const [masterNavInfo, setMasterNavInfo] = useState<{ text: string; top: number; left: number } | null>(null);
  const [pendingMasterAction, setPendingMasterAction] = useState<{ action: () => void; session: MasterEditSession; x: number; y: number } | null>(null);
  const [formatPanelOpen, setFormatPanelOpen] = useState(true);
  const [formatPanelClosing, setFormatPanelClosing] = useState(false);
  const [formatSettings, setFormatSettings] = useState<CvFormatSettings>(() => ({ ...DEFAULT_FORMAT_SETTINGS, ...document.formatSettings }));
  const masterEntryEditing = editingMasterEntrySectionIds.length > 0;
  const handleMasterEntryEditingChange = useCallback((sectionId: string, active: boolean, session?: MasterEditSession) => {
    if (active) {
      editingMasterEntrySectionsRef.current.add(sectionId);
      if (session) activeMasterEditSessionRef.current = session;
    } else {
      editingMasterEntrySectionsRef.current.delete(sectionId);
      if (activeMasterEditSessionRef.current?.sectionId === sectionId) activeMasterEditSessionRef.current = null;
    }
    const next = [...editingMasterEntrySectionsRef.current];
    setEditingMasterEntrySectionIds(current => current.length === next.length && current.every(id => next.includes(id)) ? current : next);
  }, []);

  const requestMasterAction = useCallback((action: () => void, point: { x: number; y: number }) => {
    const session = activeMasterEditSessionRef.current;
    if (!session) {
      action();
      return;
    }
    const popupWidth = 310;
    const popupHeight = 170;
    setPendingMasterAction({
      action,
      session,
      x: Math.max(10, Math.min(point.x + 12, window.innerWidth - popupWidth - 10)),
      y: Math.max(10, Math.min(point.y + 12, window.innerHeight - popupHeight - 10))
    });
  }, []);

  function ensureCvVersions(source: CvDocument): CvProjectVersion[] {
    if (source.cvVersions?.length) return source.cvVersions;
    return [{
      id: source.activeCvVersionId ?? 'cv-1',
      name: 'CV 1',
      selectedBlockIds: getSavedCvSelections(source),
      formatSettings: { ...DEFAULT_FORMAT_SETTINGS, ...source.formatSettings },
      overrides: source.cvVersionOverrides?.[ACTIVE_CV_VERSION_ID] ?? { text: {}, descriptionVariantIds: {}, hiddenFields: {} },
      customCategorySelectionIds: source.customCategorySelectionIds ?? [],
      qualificationDescription: source.qualificationDescription ?? '',
      qualificationDescriptionLines: source.qualificationDescriptionLines
    }];
  }

  function captureActiveCvVersion(source: CvDocument, id = activeCvVersionId): CvProjectVersion {
    const versions = ensureCvVersions(source);
    const existing = versions.find(version => version.id === id) ?? versions[0];
    return {
      ...existing,
      id,
      selectedBlockIds: [...cvBlockIds],
      formatSettings: { ...formatSettings },
      overrides: structuredClone(source.cvVersionOverrides?.[ACTIVE_CV_VERSION_ID] ?? { text: {}, descriptionVariantIds: {}, hiddenFields: {} }),
      customCategorySelectionIds: [...(source.customCategorySelectionIds ?? [])],
      qualificationDescription: source.qualificationDescription ?? '',
      qualificationDescriptionLines: source.qualificationDescriptionLines ? structuredClone(source.qualificationDescriptionLines) : undefined
    };
  }

  function projectWithActiveCvVersion(source: CvDocument) {
    const activeVersion = captureActiveCvVersion(source);
    const versions = ensureCvVersions(source);
    const hasActiveVersion = versions.some(version => version.id === activeCvVersionId);
    return {
      ...source,
      activeCvVersionId,
      cvVersions: hasActiveVersion
        ? versions.map(version => version.id === activeCvVersionId ? activeVersion : version)
        : [...versions, activeVersion]
    };
  }

  function applyCvVersionToDocument(source: CvDocument, version: CvProjectVersion, versions = ensureCvVersions(source)) {
    return {
      ...source,
      activeCvVersionId: version.id,
      cvVersions: versions,
      selectedBlockIds: [...version.selectedBlockIds],
      formatSettings: { ...version.formatSettings },
      cvVersionOverrides: {
        ...source.cvVersionOverrides,
        [ACTIVE_CV_VERSION_ID]: structuredClone(version.overrides)
      },
      customCategorySelectionIds: [...version.customCategorySelectionIds],
      qualificationDescription: version.qualificationDescription,
      qualificationDescriptionLines: version.qualificationDescriptionLines ? structuredClone(version.qualificationDescriptionLines) : undefined
    };
  }

  function applyLoadedDocument(loaded: CvDocument) {
    const versions = ensureCvVersions(loaded);
    const activeVersion = versions.find(version => version.id === loaded.activeCvVersionId) ?? versions[0];
    const prepared = applyCvVersionToDocument(loaded, activeVersion, versions);
    historyResetPendingRef.current = true;
    setActiveCvVersionId(activeVersion.id);
    setDocument(prepared);
    setCvBlockIds([...activeVersion.selectedBlockIds]);
    setFormatSettings({ ...DEFAULT_FORMAT_SETTINGS, ...activeVersion.formatSettings });
  }

  useEffect(() => {
    setDocument(current => ({ ...current, formatSettings }));
  }, [formatSettings]);

  useEffect(() => {
    const next: AppHistorySnapshot = { document, cvBlockIds: [...cvBlockIds], formatSettings: { ...formatSettings }, activeCvVersionId };
    const history = undoHistoryRef.current;

    if (historyResetPendingRef.current) {
      historyResetPendingRef.current = false;
      historyApplyingRef.current = false;
      history.past = [];
      history.present = next;
      history.future = [];
      return;
    }
    if (historyApplyingRef.current) {
      historyApplyingRef.current = false;
      history.present = next;
      return;
    }
    if (!history.present) {
      history.present = next;
      return;
    }
    if (sameHistorySnapshot(history.present, next)) return;

    history.past.push(history.present);
    if (history.past.length > UNDO_HISTORY_LIMIT) history.past.shift();
    history.present = next;
    history.future = [];
  }, [document, cvBlockIds, formatSettings, activeCvVersionId]);

  useEffect(() => {
    const applySnapshot = (snapshot: AppHistorySnapshot) => {
      historyApplyingRef.current = true;
      setDocument(snapshot.document);
      setCvBlockIds([...snapshot.cvBlockIds]);
      setFormatSettings({ ...snapshot.formatSettings });
      setActiveCvVersionId(snapshot.activeCvVersionId);
    };
    const handleUndoRedo = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const undo = key === 'z' && !event.shiftKey;
      const redo = key === 'y' || (key === 'z' && event.shiftKey);
      if (!undo && !redo) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('[contenteditable="true"]')) return;

      const history = undoHistoryRef.current;
      if (!history.present) return;
      if (undo) {
        const previous = history.past.pop();
        if (!previous) return;
        event.preventDefault();
        history.future.push(history.present);
        history.present = previous;
        applySnapshot(previous);
        return;
      }

      const next = history.future.pop();
      if (!next) return;
      event.preventDefault();
      history.past.push(history.present);
      history.present = next;
      applySnapshot(next);
    };
    window.document.addEventListener('keydown', handleUndoRedo);
    return () => window.document.removeEventListener('keydown', handleUndoRedo);
  }, []);

  useEffect(() => {
    void waitForIcons(getMasterOverlayIcons(document));
  }, [document.sections, document.profile.personalDetails]);

  useEffect(() => {
    const keepMasterSection = (event: Event) => {
      const sectionId = (event as CustomEvent<{ sectionId?: string }>).detail?.sectionId;
      if (!sectionId) return;
      masterActiveOverrideRef.current = sectionId;
      masterActiveOverrideUntilRef.current = performance.now() + 150;
      setActiveMasterBlockId(sectionId);
    };
    window.addEventListener('cv-kiwi:keep-master-section', keepMasterSection);
    return () => window.removeEventListener('cv-kiwi:keep-master-section', keepMasterSection);
  }, []);

  useLayoutEffect(() => {
    const scrollArea = masterBlockScrollRef.current;
    if (!scrollArea) return;
    const updateScrollState = () => {
      const next = {
        canScrollUp: scrollArea.scrollTop > 1,
        canScrollDown: scrollArea.scrollTop + scrollArea.clientHeight < scrollArea.scrollHeight - 1
      };
      setMasterBlockScrollState(previous => previous.canScrollUp === next.canScrollUp && previous.canScrollDown === next.canScrollDown ? previous : next);
    };
    updateScrollState();
    scrollArea.addEventListener('scroll', updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(scrollArea);
    if (scrollArea.firstElementChild) observer.observe(scrollArea.firstElementChild);
    return () => {
      scrollArea.removeEventListener('scroll', updateScrollState);
      observer.disconnect();
    };
  }, [document.sections, masterInfoOpen, expandedMasterBlockIds]);

  useEffect(() => {
    const scrollArea = masterBlockScrollRef.current;
    if (!scrollArea) return;
    const dampMouseWheel = (event: WheelEvent) => {
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scrollArea.clientHeight : 1;
      const delta = event.deltaY * unit;
      // Mouse wheels normally send coarse steps. Leave fine touchpad/touch scrolling alone.
      if (Math.abs(delta) < 40) return;
      event.preventDefault();
      scrollArea.scrollTop += delta * .5;
    };
    scrollArea.addEventListener('wheel', dampMouseWheel, { passive: false });
    return () => scrollArea.removeEventListener('wheel', dampMouseWheel);
  }, [masterInfoOpen, document.sections]);

  useLayoutEffect(() => {
    const scrollArea = masterBlockScrollRef.current;
    const activeItem = scrollArea?.querySelector<HTMLElement>('.master-block.is-active');
    if (!masterInfoOpen || !scrollArea || !activeItem || scrollArea.scrollHeight <= scrollArea.clientHeight + 1) return;
    const scrollRect = scrollArea.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const safeTop = scrollRect.top + scrollRect.height * .35;
    const safeBottom = scrollRect.bottom - scrollRect.height * .35;
    if (itemRect.top >= safeTop && itemRect.bottom <= safeBottom) return;
    const offsetToCenter = itemRect.top + itemRect.height / 2 - (scrollRect.top + scrollRect.height / 2);
    const nextScrollTop = Math.max(0, Math.min(scrollArea.scrollHeight - scrollArea.clientHeight, scrollArea.scrollTop + offsetToCenter));
    if (Math.abs(scrollArea.scrollTop - nextScrollTop) < 1) return;
    scrollArea.scrollTop = nextScrollTop;
  }, [masterInfoOpen, activeMasterBlockId]);

  useEffect(() => {
    if (!masterInfoOpen || !masterInfoScrollRef.current || !masterInfoOverlayRef.current) return;
    const scrollArea = masterInfoScrollRef.current;
    const candidates = [
      { blockId: 'profile', elementId: 'profile' },
      ...document.sections.map(section => ({ blockId: section.id, elementId: `section-${section.id}` })),
      { blockId: 'references', elementId: 'references' }
    ];

    const updateActiveSection = () => {
      if (masterNavigationLockedRef.current || masterActiveOverrideRef.current || window.document.documentElement.classList.contains('instant-master-navigation')) return;
      const activationOffset = Number.parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--master-section-trigger-offset-y')) || 0;
      const activationLine = scrollArea.getBoundingClientRect().top + activationOffset;
      let active = candidates[0].blockId;
      for (const candidate of candidates) {
        const element = masterInfoOverlayRef.current?.querySelector<HTMLElement>(`#${candidate.elementId}`);
        const sectionTitle = element?.querySelector<HTMLElement>('h2') ?? element;
        if (sectionTitle && sectionTitle.getBoundingClientRect().top <= activationLine) {
          active = candidate.blockId;
        }
      }
      setActiveMasterBlockId(current => current === active ? current : active);
    };

    const handleScroll = () => {
      window.document.documentElement.classList.add('master-overlay-is-scrolling');
      if (masterOverlayScrollEndTimerRef.current !== null) window.clearTimeout(masterOverlayScrollEndTimerRef.current);
      masterOverlayScrollEndTimerRef.current = window.setTimeout(() => {
        window.document.documentElement.classList.remove('master-overlay-is-scrolling');
        masterOverlayScrollEndTimerRef.current = null;
      }, 120);
      if (masterActiveOverrideRef.current) {
        if (masterActiveOverrideUntilRef.current === Number.POSITIVE_INFINITY) {
          masterActiveOverrideRef.current = null;
          masterActiveOverrideUntilRef.current = 0;
        } else {
        if (performance.now() < masterActiveOverrideUntilRef.current) return;
        masterActiveOverrideRef.current = null;
        }
      }
      updateActiveSection();
    };

    const clearExplicitBottomSelection = () => {
      if (masterActiveOverrideUntilRef.current !== Number.POSITIVE_INFINITY) return;
      masterActiveOverrideRef.current = null;
      masterActiveOverrideUntilRef.current = 0;
    };

    updateActiveSection();
    scrollArea.addEventListener('scroll', handleScroll, { passive: true });
    scrollArea.addEventListener('wheel', clearExplicitBottomSelection, { passive: true });
    scrollArea.addEventListener('pointerdown', clearExplicitBottomSelection);
    scrollArea.addEventListener('touchstart', clearExplicitBottomSelection, { passive: true });
    let animationFrame = window.requestAnimationFrame(function trackSectionPosition() {
      updateActiveSection();
      animationFrame = window.requestAnimationFrame(trackSectionPosition);
    });
    return () => {
      scrollArea.removeEventListener('scroll', handleScroll);
      scrollArea.removeEventListener('wheel', clearExplicitBottomSelection);
      scrollArea.removeEventListener('pointerdown', clearExplicitBottomSelection);
      scrollArea.removeEventListener('touchstart', clearExplicitBottomSelection);
      if (masterOverlayScrollEndTimerRef.current !== null) window.clearTimeout(masterOverlayScrollEndTimerRef.current);
      window.document.documentElement.classList.remove('master-overlay-is-scrolling');
      window.cancelAnimationFrame(animationFrame);
    };
  }, [masterInfoOpen, document.sections]);

  const previousLayoutRef = useRef<{ version?: DOMRect; content?: DOMRect }>({});

  useLayoutEffect(() => {
    const previous = previousLayoutRef.current;
    if (!previous.version || !previous.content || !versionNavRef.current || !contentColumnRef.current) return;

    const animate = (element: HTMLElement, before: DOMRect) => {
      const after = element.getBoundingClientRect();
      const x = before.left - after.left;
      const y = before.top - after.top;
      element.style.transition = 'none';
      element.style.transform = `translate(${x}px, ${y}px)`;
      void element.offsetWidth;
      element.style.transition = 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)';
      element.style.transform = 'translate(0, 0)';
      window.setTimeout(() => { element.style.transition = ''; element.style.transform = ''; }, 540);
    };

    animate(versionNavRef.current, previous.version);
    animate(contentColumnRef.current, previous.content);
    previousLayoutRef.current = {};
  }, [mode]);
  useEffect(() => {
    void (async () => {
      try {
        const state = await store.hydrate();
        setStoreState(state);
        const savedChoice = window.localStorage.getItem(STORAGE_CHOICE_KEY);
        const browserBackup = await loadBrowserProject();

        if (savedChoice === 'google') {
          try {
            const driveState = await googleDrive.restore();
            setGoogleDriveState(driveState);
            const loaded = withRequiredSections(newestProject(await googleDrive.loadProject(), browserBackup));
            applyLoadedDocument(loaded);
            setCvBlockIds(getSavedCvSelections(loaded));
            setStorage('google');
            setStatus('Google Drive er koblet til.');
            setWelcomeOpen(false);
            return;
          } catch {
            // Fall back to the browser backup below when Google needs a new login.
          }
        }

        if (savedChoice === 'local' && state.connected) {
          const loaded = withRequiredSections(newestProject(await store.loadProject(), browserBackup));
          applyLoadedDocument(loaded);
          setCvBlockIds(getSavedCvSelections(loaded));
          setStorage('local');
          setStatus(`Prosjektmappe: ${state.directoryName}`);
          setWelcomeOpen(false);
          return;
        }

        if (browserBackup) {
          const loaded = withRequiredSections(browserBackup);
          applyLoadedDocument(loaded);
          setCvBlockIds(getSavedCvSelections(loaded));
          setStorage('browser');
          window.localStorage.setItem(STORAGE_CHOICE_KEY, 'browser');
          setStatus('Gjenopprettet automatisk fra lokal nettleserlagring.');
          setWelcomeOpen(false);
        }
      } finally {
        setStorageHydrated(true);
      }
    });

    healthCheck().then(setServerOnline);
  }, [store]);

  useEffect(() => {
    if (!storageHydrated || welcomeOpen || masterEntryEditing) return;
    const project: CvDocument = projectWithActiveCvVersion({ ...document, updatedAt: new Date().toISOString(), formatSettings, selectedBlockIds: cvBlockIds, cvSelectionInitialized: true });
    latestBrowserProjectRef.current = project;
    const browserTimer = window.setTimeout(() => {
      void saveBrowserProject(project).catch(error => setStatus(error instanceof Error ? error.message : 'Lokal sikkerhetskopi feilet.'));
    }, 300);

    const remoteTimer = storage === 'google' || storage === 'local'
      ? window.setTimeout(() => {
          const remoteSave = storage === 'google' ? googleDrive.saveProject(project) : store.saveProject(project);
          void remoteSave.catch(error => setStatus(error instanceof Error ? error.message : 'Automatisk lagring feilet.'));
        }, 800)
      : null;
    return () => {
      window.clearTimeout(browserTimer);
      if (remoteTimer !== null) window.clearTimeout(remoteTimer);
    };
  }, [document, cvBlockIds, storage, storageHydrated, welcomeOpen, formatSettings, activeCvVersionId, masterEntryEditing]);

  useEffect(() => {
    if (masterEntryEditing) setStorageMenuOpen(false);
  }, [masterEntryEditing]);

  useEffect(() => {
    if (!cvVersionMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!cvVersionManagerRef.current?.contains(event.target as Node)) setCvVersionMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCvVersionMenuOpen(false);
    };
    window.document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.document.removeEventListener('keydown', closeOnEscape);
    };
  }, [cvVersionMenuOpen]);

  useLayoutEffect(() => {
    if (!pcStorageGuideOpen) return;
    const updateGuidePosition = () => {
      const saveBounds = railSaveRef.current?.getBoundingClientRect();
      const uploadBounds = railUploadRef.current?.getBoundingClientRect();
      if (!saveBounds || !uploadBounds) return;
      const saveCenter = saveBounds.top + saveBounds.height / 2;
      const uploadCenter = uploadBounds.top + uploadBounds.height / 2;
      setPcStorageGuideTop((saveCenter + uploadCenter) / 2);
    };
    updateGuidePosition();
    window.addEventListener('resize', updateGuidePosition);
    return () => window.removeEventListener('resize', updateGuidePosition);
  }, [pcStorageGuideOpen]);

  useEffect(() => {
    const flushBrowserBackup = () => {
      if (latestBrowserProjectRef.current) void saveBrowserProject(latestBrowserProjectRef.current);
    };
    const flushWhenHidden = () => {
      if (window.document.visibilityState === 'hidden') flushBrowserBackup();
    };
    window.addEventListener('pagehide', flushBrowserBackup);
    window.document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flushBrowserBackup);
      window.document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, []);

  async function chooseFolder() {
    const state = await store.chooseDirectory(document);
    setStoreState(state);
    const loaded = withRequiredSections(await store.loadProject());
    applyLoadedDocument(loaded);
    setCvBlockIds(getSavedCvSelections(loaded));
    setStorage('local');
    window.localStorage.setItem(STORAGE_CHOICE_KEY, 'local');
    setStatus(`Prosjektmappe: ${state.directoryName}`);
  }

  async function connectGoogleDrive() {
    try {
      setStatus('Åpner Google-autorisasjon...');
      const state = await googleDrive.connect();
      setGoogleDriveState(state);
      const loaded = withRequiredSections(await googleDrive.loadProject());
      applyLoadedDocument(loaded);
      setCvBlockIds(getSavedCvSelections(loaded));
      setStorage('google');
      window.localStorage.setItem(STORAGE_CHOICE_KEY, 'google');
      setStatus('Google Drive er koblet til. Filer lagres i Google Drive/CV Kiwi.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kunne ikke koble til Google Drive.');
    }
  }

  async function startWithGoogleDrive() {
    await connectGoogleDrive();
    if (googleDrive.state.connected) setWelcomeOpen(false);
  }

  async function startWithLocalFolder() {
    try {
      if (window.localStorage.getItem(STORAGE_CHOICE_KEY) === 'local') {
        const restored = await store.reconnectSavedDirectory();
        if (restored.connected) {
          const loaded = withRequiredSections(await store.loadProject());
          applyLoadedDocument(loaded);
          setCvBlockIds(getSavedCvSelections(loaded));
          setStoreState(restored);
          setStorage('local');
          setStatus(`Prosjektmappe: ${restored.directoryName}`);
          setWelcomeOpen(false);
          return;
        }
      }

      if (store.state.supported) {
        await chooseFolder();
      } else {
        const existing = await loadBrowserProject();
        const loaded = existing ? withRequiredSections(existing) : document;
        if (!existing) await saveBrowserProject(projectWithActiveCvVersion({ ...document, updatedAt: new Date().toISOString(), formatSettings, selectedBlockIds: cvBlockIds, cvSelectionInitialized: true }));
        applyLoadedDocument(loaded);
        setCvBlockIds(existing ? getSavedCvSelections(loaded) : cvBlockIds);
        setStorage('browser');
        window.localStorage.setItem(STORAGE_CHOICE_KEY, 'browser');
        setStatus('Prosjektet lagres automatisk lokalt i nettleseren.');
      }
      setWelcomeOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kunne ikke velge mappe.');
    }
  }

  async function startWithBrowserStorage() {
    const project = projectWithActiveCvVersion({ ...document, updatedAt: new Date().toISOString(), formatSettings, selectedBlockIds: cvBlockIds, cvSelectionInitialized: true });
    await saveBrowserProject(project);
    setStorage('browser');
    window.localStorage.setItem(STORAGE_CHOICE_KEY, 'browser');
    setStatus('Prosjektet lagres automatisk lokalt i nettleseren.');
    setWelcomeOpen(false);
  }

  async function startWithPcStorage() {
    await startWithBrowserStorage();
    if (window.localStorage.getItem(PC_STORAGE_GUIDE_DISMISSED_KEY) !== 'true') setPcStorageGuideOpen(true);
  }

  function dismissPcStorageGuide() {
    window.localStorage.setItem(PC_STORAGE_GUIDE_DISMISSED_KEY, 'true');
    setPcStorageGuideOpen(false);
  }

  async function manageOneDriveFolder() {
    if (!store.state.supported) {
      setStatus('Valg av en synkronisert OneDrive-mappe krever en nettleser med mappevelger, for eksempel Chrome eller Edge.');
      setSettingsOpen(false);
      return;
    }
    try {
      await chooseFolder();
      setStatus(`OneDrive-lagring bruker den valgte synkroniserte mappen: ${store.state.directoryName ?? ''}`);
      setSettingsOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kunne ikke velge OneDrive-mappe.');
    }
  }

  function storageDebugProject(project: CvDocument | null) {
    if (!project) return null;
    const copy = structuredClone(project);
    if (copy.profile.photoDataUrl) copy.profile.photoDataUrl = `[bilde: ${copy.profile.photoDataUrl.length} tegn]`;
    copy.profile.photos = copy.profile.photos?.map(photo => ({ ...photo, dataUrl: `[bilde: ${photo.dataUrl.length} tegn]` }));
    copy.sections = copy.sections.map(section => ({
      ...section,
      entries: section.entries.map(entry => ({
        ...entry,
        imageDataUrl: entry.imageDataUrl ? `[bilde: ${entry.imageDataUrl.length} tegn]` : entry.imageDataUrl
      }))
    }));
    return copy;
  }

  async function inspectStoredBrowserProject() {
    const stored = await loadBrowserProject();
    setStorageDebugTitle('1. PERSISTENT DATA FRA INDEXEDDB');
    setStorageDebugOutput(JSON.stringify({
      origin: window.location.origin,
      storageChoice: window.localStorage.getItem(STORAGE_CHOICE_KEY),
      found: Boolean(stored),
      updatedAt: stored?.updatedAt ?? null,
      project: storageDebugProject(stored)
    }, null, 2));
  }

  function inspectLoadedApplicationProject() {
    const active = projectWithActiveCvVersion({ ...document, formatSettings, selectedBlockIds: cvBlockIds, cvSelectionInitialized: true });
    setStorageDebugTitle('2. DATA SOM ER LASTET INN I APPEN');
    setStorageDebugOutput(JSON.stringify({
      origin: window.location.origin,
      storageChoice: window.localStorage.getItem(STORAGE_CHOICE_KEY),
      activeStorage: storage,
      storageHydrated,
      welcomeOpen,
      updatedAt: document.updatedAt ?? null,
      project: storageDebugProject(active)
    }, null, 2));
  }

  async function copyStorageDebugOutput() {
    if (!storageDebugOutput) return;
    try {
      await navigator.clipboard.writeText(`${storageDebugTitle}\n${storageDebugOutput}`);
      setStatus('Lagringsdiagnostikken er kopiert.');
    } catch {
      setStatus('Kunne ikke kopiere automatisk. Marker teksten manuelt.');
    }
  }

  function startWithFilledExample() {
    // This is deliberately not connected to a storage provider. It is a safe
    // sandbox for testing the CV builder and its drag-and-drop behaviour.
    const example = structuredClone(withRequiredSections(exampleCv));
    setDocument(example);
    setCvBlockIds(getSavedCvSelections(example));
    setStatus('Eksempelprosjektet er åpnet. Endringer lagres ikke før du velger en lagringsmåte.');
    setWelcomeOpen(false);
  }

  async function save() {
    try {
      await saveProject(document);
      setStatus(storage === 'google' ? 'Lagret i Google Drive.' : 'Lagret cv-project.json.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Lagring feilet.');
    }
  }

  async function duplicateDraft() {
    const copy = structuredClone(document);
    copy.generatedVersions = [];
    await saveProject(copy);
    setDocument(copy);
    setStatus('Ny variant er opprettet fra eksisterende innhold.');
  }

  async function exportJson() {
    const project = projectWithActiveCvVersion({ ...document, updatedAt: new Date().toISOString(), formatSettings, selectedBlockIds: cvBlockIds, cvSelectionInitialized: true });
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    downloadBlob(blob, projectExportFileName(document.profile.fullName));
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<CvDocument>;
      if (!parsed || typeof parsed !== 'object' || !parsed.profile || !Array.isArray(parsed.sections) || !Array.isArray(parsed.references)) {
        throw new Error('Filen er ikke et gyldig CV Kiwi-prosjekt.');
      }
      const loaded = withRequiredSections(parsed as CvDocument);
      applyLoadedDocument(loaded);
      setCvBlockIds(getSavedCvSelections(loaded));
      setStatus(`Lastet prosjekt fra ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kunne ikke laste JSON-filen.');
    } finally {
      if (jsonImportRef.current) jsonImportRef.current.value = '';
    }
  }

  function resetAllProjectData() {
    const empty = structuredClone(withRequiredSections(blankCv));
    applyLoadedDocument(empty);
    setCvBlockIds(getSavedCvSelections(empty));
    setExpandedMasterBlockIds([]);
    setEditingMasterBlockId(null);
    setActiveMasterBlockId('profile');
    setResetConfirmationOpen(false);
    setSettingsOpen(false);
    setStatus('All Masterdata og CV-data er nullstilt.');
  }

  async function generate() {
    setStatus('Åpner utskriftsvinduet. Velg «Lagre som PDF» for å laste ned CV-en.');
    await waitForIcons(getMasterOverlayIcons(cvVersion));
    window.print();
  }

  function updateSection(index: number, section: CvSection) {
    setDocument(current => {
      const sections = [...current.sections];
      const structureChanged = sections[index]?.entries.length !== section.entries.length;
      sections[index] = section;
      const next = { ...current, sections };
      if (structureChanged && editingMasterEntrySectionsRef.current.size === 0) {
        const project: CvDocument = projectWithActiveCvVersion({ ...next, updatedAt: new Date().toISOString(), formatSettings, selectedBlockIds: cvBlockIds, cvSelectionInitialized: true });
        latestBrowserProjectRef.current = project;
        void saveBrowserProject(project).catch(error => setStatus(error instanceof Error ? error.message : 'Lokal sikkerhetskopi feilet.'));
      }
      return next;
    });
  }

  function addSection(title: string, idPrefix: string, entryTitle = 'Ny oppføring') {
    const id = `${idPrefix}-${crypto.randomUUID()}`;
    setDocument({
      ...document,
      sections: [...document.sections, {
        id,
        title,
        entries: [{ id: crypto.randomUUID(), title: entryTitle, subtitle: '', lines: [] }]
      }]
    });
    setBlockMenuOpen(false);
    setCustomSectionTitle('');
    window.setTimeout(() => window.document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  function addCustomSection() {
    const title = customSectionTitle.trim();
    if (!title) return;
    const id = `custom-${crypto.randomUUID()}`;
    setDocument(current => ({
      ...current,
      sections: [...current.sections, { id, title, kind: 'custom', entries: [] }]
    }));
    setCustomSectionTitle('');
    setCustomCategoryCreator(null);
    setBlockMenuOpen(false);
    setActiveMasterBlockId(id);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (masterInfoOpen) navigateToMasterBlock(id);
      else window.document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function removeCustomSection(section: CvSection) {
    if (section.kind !== 'custom' && !section.id.startsWith('custom-')) return;
    if (!window.confirm(`Slette kategorien «${section.title}» og alt innholdet i den?`)) return;
    const belongsToSection = (selectionId: string) => selectionId === section.id || selectionId.startsWith(`item:${section.id}:`);
    setCvBlockIds(current => current.filter(selectionId => !belongsToSection(selectionId)));
    setExpandedMasterBlockIds(current => current.filter(sectionId => sectionId !== section.id));
    setDocument(current => ({
      ...current,
      sections: current.sections.filter(candidate => candidate.id !== section.id),
      selectedBlockIds: current.selectedBlockIds?.filter(selectionId => !belongsToSection(selectionId)),
      customCategorySelectionIds: current.customCategorySelectionIds?.filter(selectionId => !belongsToSection(selectionId)),
      cvVersions: current.cvVersions?.map(version => ({
        ...version,
        selectedBlockIds: version.selectedBlockIds.filter(selectionId => !belongsToSection(selectionId)),
        customCategorySelectionIds: version.customCategorySelectionIds.filter(selectionId => !belongsToSection(selectionId)),
        overrides: {
          ...version.overrides,
          sectionOrderIds: version.overrides.sectionOrderIds?.filter(sectionId => sectionId !== section.id),
          entryOrderIds: version.overrides.entryOrderIds
            ? Object.fromEntries(Object.entries(version.overrides.entryOrderIds).filter(([sectionId]) => sectionId !== section.id))
            : undefined
        }
      }))
    }));
    masterActiveOverrideRef.current = null;
    masterActiveOverrideUntilRef.current = 0;
    setActiveMasterBlockId('profile');
  }

  function addSkillGroup(title: string) {
    setDocument({ ...document, skillGroups: [...document.skillGroups, { title, content: '', column: 1 }] });
    setBlockMenuOpen(false);
    window.setTimeout(() => window.document.getElementById('additional')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  function addBlockToVersion(selectionId: string) {
    if (!selectionId) return;
    setCvBlockIds(current => {
      if (current.includes(selectionId)) return current;

      // A whole category already contains every individual item in it.
      if (isItemSelection(selectionId)) {
        const blockId = selectionId.split(':')[1];
        return current.includes(blockId) ? current : [...current, selectionId];
      }

      // Choosing a whole category replaces any previously selected individual items.
      return [...current.filter(id => !isItemSelection(id, selectionId)), selectionId];
    });
  }

  function removeBlockFromVersion(selectionId: string) {
    setCvBlockIds(current => current.filter(id => id !== selectionId));
  }

  function removeVersionCategory(blockId: string) {
    setCvBlockIds(current => current.filter(id => id !== blockId && !isItemSelection(id, blockId)));
  }

  function toggleVersionCategory(blockId: string, itemSelectionIds: string[]) {
    setCvBlockIds(current => {
      const isEnabled = current.includes(blockId) || itemSelectionIds.some(id => current.includes(id));
      return isEnabled
        ? current.filter(id => id !== blockId && !itemSelectionIds.includes(id))
        : [...current.filter(id => !itemSelectionIds.includes(id)), blockId];
    });
  }

  function toggleVersionItem(blockId: string, itemSelectionId: string, siblingSelectionIds: string[]) {
    setCvBlockIds(current => {
      if (current.includes(blockId)) {
        // Convert a complete category into all of its individual parts except this one.
        return [...current.filter(id => id !== blockId), ...siblingSelectionIds.filter(id => id !== itemSelectionId)];
      }
      return current.includes(itemSelectionId)
        ? current.filter(id => id !== itemSelectionId)
        : [...current, itemSelectionId];
    });
  }

  function toggleQualificationItem(blockId: string, itemSelectionId: string, siblingSelectionIds: string[]) {
    setDocument(current => {
      const selected = current.customCategorySelectionIds ?? [];
      const next = selected.includes(blockId)
        ? [...selected.filter(id => id !== blockId), ...siblingSelectionIds.filter(id => id !== itemSelectionId)]
        : selected.includes(itemSelectionId)
          ? selected.filter(id => id !== itemSelectionId)
          : [...selected, itemSelectionId];
      return { ...current, customCategorySelectionIds: Array.from(new Set(next)) };
    });
  }

  function toggleMasterBlock(blockId: string) {
    setExpandedMasterBlockIds(current => current.includes(blockId)
      ? current.filter(id => id !== blockId)
      : [...current, blockId]);
  }

  function versionsIncludingCurrent() {
    const currentVersion = captureActiveCvVersion(document);
    const versions = ensureCvVersions(document);
    return versions.some(version => version.id === activeCvVersionId)
      ? versions.map(version => version.id === activeCvVersionId ? currentVersion : version)
      : [...versions, currentVersion];
  }

  function activateCvVersion(version: CvProjectVersion, versions: CvProjectVersion[]) {
    const nextDocument = applyCvVersionToDocument(document, version, versions);
    setActiveCvVersionId(version.id);
    setCvBlockIds([...version.selectedBlockIds]);
    setFormatSettings({ ...DEFAULT_FORMAT_SETTINGS, ...version.formatSettings });
    setDocument(nextDocument);
    setCvVersionMenuOpen(false);
  }

  function switchCvVersion(versionId: string) {
    if (versionId === activeCvVersionId) {
      setCvVersionMenuOpen(false);
      return;
    }
    const versions = versionsIncludingCurrent();
    const version = versions.find(candidate => candidate.id === versionId);
    if (version) activateCvVersion(version, versions);
  }

  function createNewCvVersion(duplicateCurrent = false) {
    const versions = versionsIncludingCurrent();
    const current = versions.find(version => version.id === activeCvVersionId) ?? versions[0];
    const id = crypto.randomUUID();
    const nextNumber = versions.length + 1;
    const version: CvProjectVersion = duplicateCurrent
      ? {
          ...structuredClone(current),
          id,
          name: `${current.name} kopi`
        }
      : {
          id,
          name: `CV ${nextNumber}`,
          selectedBlockIds: defaultCvSelections(document),
          formatSettings: { ...DEFAULT_FORMAT_SETTINGS },
          overrides: { text: {}, descriptionVariantIds: {}, hiddenFields: {} },
          customCategorySelectionIds: [],
          qualificationDescription: '',
          qualificationDescriptionLines: undefined
        };
    activateCvVersion(version, [...versions, version]);
  }

  function renameCvVersion(versionId: string, name: string) {
    setDocument(current => ({
      ...current,
      cvVersions: ensureCvVersions(current).map(version => version.id === versionId ? { ...version, name } : version)
    }));
  }

  function deleteCvVersion(versionId: string) {
    const versions = versionsIncludingCurrent();
    if (versions.length <= 1) return;
    const remaining = versions.filter(version => version.id !== versionId);
    if (versionId === activeCvVersionId) activateCvVersion(remaining[0], remaining);
    else setDocument(current => ({ ...current, cvVersions: remaining }));
  }

  function openMasterBlock(blockId: string) {
    navigateToMasterBlock(blockId);
  }

  async function openMasterInfo() {
    if (masterInfoOpen) return;
    setMasterNavInfo(null);
    setCvVersionMenuOpen(false);
    setMasterInfoClosing(false);
    await waitForIcons(getMasterOverlayIcons(document));
    setMasterNavMode('master');
    setMasterInfoOpen(true);
  }

  function closeMasterInfo() {
    masterActiveOverrideRef.current = null;
    masterNavigationLockedRef.current = false;
    if (masterNavigationUnlockTimerRef.current !== null) window.clearTimeout(masterNavigationUnlockTimerRef.current);
    masterNavigationUnlockTimerRef.current = null;
    setMasterNavMode('cv');
    setMasterInfoClosing(true);
  }

  function resolvePendingMasterAction(choice: 'save' | 'discard' | 'return') {
    const pending = pendingMasterAction;
    if (!pending) return;
    setPendingMasterAction(null);
    if (choice === 'return') {
      pending.session.returnToEditor();
      return;
    }
    if (choice === 'save') pending.session.save();
    else pending.session.discard();
    pending.action();
  }

  function navigateToMasterBlock(blockId: string) {
    masterActiveOverrideRef.current = null;
    openMasterInfo();
    masterNavigationLockedRef.current = true;
    if (masterNavigationUnlockTimerRef.current !== null) window.clearTimeout(masterNavigationUnlockTimerRef.current);
    setActiveMasterBlockId(blockId);
    const targetId = blockId === 'profile' || blockId === 'references' ? blockId : `section-${blockId}`;
    window.requestAnimationFrame(() => {
      const scrollArea = masterInfoScrollRef.current;
      const target = masterInfoOverlayRef.current?.querySelector<HTMLElement>(`#${targetId}`);
      let released = false;
      const releaseNavigationLock = () => {
        if (released) return;
        released = true;
        masterNavigationLockedRef.current = false;
        if (masterNavigationUnlockTimerRef.current !== null) window.clearTimeout(masterNavigationUnlockTimerRef.current);
        masterNavigationUnlockTimerRef.current = null;
        scrollArea?.removeEventListener('scrollend', releaseNavigationLock);
        const selectedHeading = target?.querySelector<HTMLElement>('h2') ?? target;
        const activationOffset = Number.parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--master-section-trigger-offset-y')) || 0;
        const activationLine = scrollArea ? scrollArea.getBoundingClientRect().top + activationOffset : 0;
        const isAtBottom = Boolean(scrollArea && scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 1);
        if (selectedHeading && isAtBottom && selectedHeading.getBoundingClientRect().top > activationLine) {
          masterActiveOverrideRef.current = blockId;
          masterActiveOverrideUntilRef.current = Number.POSITIVE_INFINITY;
          setActiveMasterBlockId(blockId);
        }
      };

      if (!target) {
        releaseNavigationLock();
        return;
      }

      scrollArea?.addEventListener('scrollend', releaseNavigationLock, { once: true });
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      masterNavigationUnlockTimerRef.current = window.setTimeout(releaseNavigationLock, 900);
    });
  }

  function scrollMasterBlocks(direction: 'up' | 'down') {
    masterBlockScrollRef.current?.scrollBy({ top: direction === 'up' ? -180 : 180, behavior: 'smooth' });
  }

  function switchMode(nextMode: 'cv' | 'master') {
    if (nextMode === mode) return;
    previousLayoutRef.current = {
      version: versionNavRef.current?.getBoundingClientRect(),
      content: contentColumnRef.current?.getBoundingClientRect()
    };
    setMode(nextMode);
  }

  async function saveProject(value: CvDocument) {
    const project = projectWithActiveCvVersion({ ...value, updatedAt: new Date().toISOString(), formatSettings, selectedBlockIds: cvBlockIds, cvSelectionInitialized: true });
    if (storage === 'google') return googleDrive.saveProject(project);
    if (storage === 'local') return store.saveProject(project);
    if (storage === 'browser') return saveBrowserProject(project);
    throw new Error('Velg en lokal prosjektmappe eller koble til Google Drive først.');
  }

  const storageConnected = storage === 'google' ? googleDriveState.connected : storage === 'browser' || storeState.connected;
  const masterBlocks = getMasterBlocks(document);
  const cvVersions = ensureCvVersions(document);
  const activeCvVersion = cvVersions.find(version => version.id === activeCvVersionId) ?? cvVersions[0];
  const customCategorySelectionIds = document.customCategorySelectionIds ?? [];
  const activeCvOverrides: CvVersionOverrideState = document.cvVersionOverrides?.[ACTIVE_CV_VERSION_ID] ?? { text: {}, descriptionVariantIds: {}, hiddenFields: {} };
  const cvVersion = applyCvPreviewOrder(createCvVersion(document, cvBlockIds), activeCvOverrides);
  const selectedVersionBlocks = masterBlocks.flatMap(block => {
    const isWholeCategory = cvBlockIds.includes(block.id);
    const selectedItems = block.items.filter(item => cvBlockIds.includes(item.selectionId));
    return isWholeCategory || selectedItems.length > 0 ? [{ block, isWholeCategory, selectedItems }] : [];
  });
  function updateCvPreviewText(key: string, value: string) {
    setDocument(current => {
      const existing = current.cvVersionOverrides?.[ACTIVE_CV_VERSION_ID] ?? { text: {}, descriptionVariantIds: {}, hiddenFields: {} };
      return {
        ...current,
        cvVersionOverrides: {
          ...current.cvVersionOverrides,
          [ACTIVE_CV_VERSION_ID]: { ...existing, text: { ...existing.text, [key]: value } }
        }
      };
    });
  }

  function updateCvPreviewSectionOrder(sectionIds: string[]) {
    setDocument(current => {
      const existing = current.cvVersionOverrides?.[ACTIVE_CV_VERSION_ID] ?? { text: {}, descriptionVariantIds: {}, hiddenFields: {} };
      return {
        ...current,
        cvVersionOverrides: {
          ...current.cvVersionOverrides,
          [ACTIVE_CV_VERSION_ID]: { ...existing, sectionOrderIds: sectionIds }
        }
      };
    });
  }

  function updateCvPreviewEntryOrder(sectionId: string, entryIds: string[]) {
    setDocument(current => {
      const existing = current.cvVersionOverrides?.[ACTIVE_CV_VERSION_ID] ?? { text: {}, descriptionVariantIds: {}, hiddenFields: {} };
      return {
        ...current,
        cvVersionOverrides: {
          ...current.cvVersionOverrides,
          [ACTIVE_CV_VERSION_ID]: {
            ...existing,
            entryOrderIds: { ...existing.entryOrderIds, [sectionId]: entryIds }
          }
        }
      };
    });
  }

  function updateQualificationHighlightOrder(highlightIds: string[]) {
    setDocument(current => ({ ...current, customCategorySelectionIds: highlightIds }));
  }

  function updateCvDescriptionVariant(entryId: string, variantId: string, resetDescriptionOverride = false) {
    setDocument(current => {
      const existing = current.cvVersionOverrides?.[ACTIVE_CV_VERSION_ID] ?? { text: {}, descriptionVariantIds: {}, hiddenFields: {} };
      const text = { ...existing.text };
      if (resetDescriptionOverride) {
        const descriptionKey = entryId.startsWith('qualification.')
          ? `${entryId}.description`
          : `entry.${entryId}.description`;
        delete text[descriptionKey];
      }
      return {
        ...current,
        cvVersionOverrides: {
          ...current.cvVersionOverrides,
          [ACTIVE_CV_VERSION_ID]: { ...existing, text, descriptionVariantIds: { ...existing.descriptionVariantIds, [entryId]: variantId } }
        }
      };
    });
  }

  function updateCvPreviewFieldVisibility(key: string, hidden: boolean) {
    setDocument(current => {
      const existing = current.cvVersionOverrides?.[ACTIVE_CV_VERSION_ID] ?? { text: {}, descriptionVariantIds: {}, hiddenFields: {} };
      return {
        ...current,
        cvVersionOverrides: {
          ...current.cvVersionOverrides,
          [ACTIVE_CV_VERSION_ID]: { ...existing, hiddenFields: { ...existing.hiddenFields, [key]: hidden } }
        }
      };
    });
  }

  function updateQualificationDescription(lines: RichLine[]) {
    setDocument(current => ({
      ...current,
      qualificationDescriptionLines: lines,
      qualificationDescription: lines.map(line => line.runs.map(run => run.text).join('')).join('\n')
    }));
  }

  function pulseQualificationAttention() {
    if (qualificationAttentionTimerRef.current !== null) window.clearTimeout(qualificationAttentionTimerRef.current);
    setQualificationAttention(false);
    window.requestAnimationFrame(() => {
      setQualificationAttention(true);
      qualificationAttentionTimerRef.current = window.setTimeout(stopQualificationAttention, 850);
    });
  }

  function stopQualificationAttention() {
    if (qualificationAttentionTimerRef.current !== null) window.clearTimeout(qualificationAttentionTimerRef.current);
    qualificationAttentionTimerRef.current = null;
    setQualificationAttention(false);
  }

  function requestQualificationAttention() {
    const hasOpenCategory = masterNavMode === 'cv' && masterBlocks.some(block => block.id !== 'profile' && block.items.length > 0 && expandedMasterBlockIds.includes(block.id));
    if (hasOpenCategory) {
      pulseQualificationAttention();
      return;
    }

    const workBlock = masterBlocks.find(block => {
      const section = document.sections.find(candidate => candidate.id === block.id);
      return section?.kind === 'work' || block.id.toLowerCase().includes('arbeidserfaring') || block.title.toLowerCase().includes('arbeidserfaring');
    });
    if (!workBlock) {
      pulseQualificationAttention();
      return;
    }

    setQualificationAttention(false);
    setPendingQualificationAttentionBlockId(workBlock.id);
    setMasterNavMode('cv');
    setExpandedMasterBlockIds(current => current.includes(workBlock.id) ? current : [...current, workBlock.id]);
    window.requestAnimationFrame(() => window.document.querySelector<HTMLElement>(`[data-master-block-id="${CSS.escape(workBlock.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  function finishPendingQualificationAttention(blockId: string) {
    if (pendingQualificationAttentionBlockId !== blockId) return;
    setPendingQualificationAttentionBlockId(null);
    pulseQualificationAttention();
  }

  useEffect(() => {
    if (!pendingQualificationAttentionBlockId) return;
    const fallback = window.setTimeout(() => finishPendingQualificationAttention(pendingQualificationAttentionBlockId), 600);
    return () => window.clearTimeout(fallback);
  }, [pendingQualificationAttentionBlockId]);

  function openFormatPanel() {
    setFormatPanelClosing(false);
    setFormatPanelOpen(true);
  }

  function closeFormatPanel() {
    if (!formatPanelOpen) return;
    setFormatPanelClosing(true);
  }

  function toggleFormatPanel() {
    if (formatPanelOpen) closeFormatPanel();
    else openFormatPanel();
  }

  return (
    <>
    <div className="app">
      <aside className="icon-rail" aria-label="Hovedmeny">
        <div className="rail-mode-tabs" role="tablist" aria-label="Redigeringsmodus">
          <button
            className={`rail-master-button ${masterNavMode === 'master' ? 'is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={masterNavMode === 'master'}
            onClick={() => { if (masterNavMode !== 'master') void openMasterInfo(); }}
          >
            <span className="rail-master-avatar" aria-hidden="true">
              {document.profile.photoDataUrl
                ? <span className="rail-master-photo-frame"><img src={document.profile.photoDataUrl} alt="" style={railProfilePhotoStyle(document.profile)} /></span>
                : <Icon icon="mdi:account" />}
            </span>
            <span className="rail-master-label"><span>Rediger</span><span>Master</span></span>
          </button>
          <button
            className={`rail-master-button rail-cv-button ${masterNavMode === 'cv' ? 'is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={masterNavMode === 'cv'}
            onClick={event => { if (masterNavMode === 'master') requestMasterAction(closeMasterInfo, { x: event.clientX, y: event.clientY }); }}
          >
            <span className="rail-master-avatar" aria-hidden="true"><Icon icon="mdi:file-document-edit" /></span>
            <span className="rail-master-label"><span>Rediger</span><span>CV</span></span>
          </button>
        </div>
        <span className="rail-spacer" />
        <button className="rail-button rail-action-button" type="button" title="Åpne utskriftsvindu for PDF" aria-label="Eksporter PDF" onClick={() => void generate()}><span className="rail-action-icon"><RoundedPdfIcon /></span><span className="rail-action-label"><span>Eksporter</span><span>PDF</span></span></button>
        <button className={`rail-button rail-action-button ${pcStorageGuideOpen ? 'is-storage-guide-target' : ''}`} ref={railSaveRef} type="button" title="Lagre prosjekt som JSON" aria-label="Lagre prosjekt" onClick={() => void exportJson()}><span className="rail-action-icon"><Icon icon="mdi:content-save-outline" aria-hidden="true" /></span><span className="rail-action-label"><span>Lagre</span><span>prosjekt</span></span></button>
        <button className={`rail-button rail-action-button ${pcStorageGuideOpen ? 'is-storage-guide-target' : ''}`} ref={railUploadRef} type="button" title="Last inn prosjekt fra JSON" aria-label="Importer prosjekt" onClick={() => jsonImportRef.current?.click()}><span className="rail-action-icon"><Icon icon="mdi:upload" aria-hidden="true" /></span><span className="rail-action-label"><span>Importer</span><span>prosjekt</span></span></button>
        <input className="rail-json-input" ref={jsonImportRef} type="file" accept="application/json,.json" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void importJson(file); }} />
        <button className={`rail-button ${settingsOpen ? 'active' : ''}`} type="button" title="Innstillinger" aria-label="Innstillinger" onClick={() => setSettingsOpen(true)}>⚙</button>
        <span className="rail-brand-logo" role="img" aria-label="CV Kiwi" />
      </aside>
      <div className="app-shell" id="top">
      <header className="app-header">
        <div>
          <div className="breadcrumbs"><span>Prosjekter</span><b>/</b><strong>cv-kiwi</strong></div>
        </div>
        <div className="actions">
          <span className={serverOnline ? 'pill ok' : 'pill'}>{serverOnline ? 'API online' : 'API ikke funnet'}</span>
          <span className="header-help">Hjelp</span>
        </div>
      </header>

      <div className={`app-layout cv-mode ${USE_DRAG_DROP_CV_BUILDER ? 'drag-drop-builder' : 'toggle-builder'} ${formatPanelOpen && !formatPanelClosing ? 'is-formatting' : ''}`}>
        <nav className={`local-nav ${masterNavMode === 'master' ? 'is-dimmed' : ''} ${qualificationAttention ? 'is-qualification-attention' : ''} ${masterInfoClosing ? 'is-closing' : ''}`} aria-label="CV-seksjoner" onAnimationEnd={event => { if (event.animationName === 'qualification-key-attention') stopQualificationAttention(); }}>
          <div className="cv-version-manager" ref={cvVersionManagerRef}>
            {masterNavMode === 'cv'
              ? <button className="cv-version-trigger" type="button" aria-expanded={cvVersionMenuOpen} onClick={() => setCvVersionMenuOpen(open => !open)}>{activeCvVersion.name}<Icon icon={cvVersionMenuOpen ? 'mdi:chevron-up' : 'mdi:chevron-down'} aria-hidden="true" /></button>
              : <span className="cv-version-trigger cv-version-trigger-static">Master Redigering</span>}
            {masterNavMode === 'cv' && cvVersionMenuOpen && <div className="cv-version-menu">
              <p>MINE CV-ER</p>
              <div className="cv-version-list">
                {cvVersions.map(version => <div className={`cv-version-row ${version.id === activeCvVersionId ? 'is-active' : ''}`} key={version.id}>
                  <button className="cv-version-select" type="button" onClick={() => switchCvVersion(version.id)} aria-label={`Åpne ${version.name}`}><Icon icon={version.id === activeCvVersionId ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'} aria-hidden="true" /></button>
                  <input value={version.name} aria-label="Navn på CV" onChange={event => renameCvVersion(version.id, event.currentTarget.value)} />
                  <button className="cv-version-delete" type="button" disabled={cvVersions.length <= 1} onClick={() => deleteCvVersion(version.id)} aria-label={`Slett ${version.name}`}><Icon icon="mdi:delete-outline" aria-hidden="true" /></button>
                </div>)}
              </div>
              <div className="cv-version-actions">
                <button type="button" onClick={() => createNewCvVersion(false)}><Icon icon="mdi:plus" aria-hidden="true" />Ny CV</button>
                <button type="button" onClick={() => createNewCvVersion(true)}><Icon icon="mdi:content-copy" aria-hidden="true" />Dupliser</button>
              </div>
            </div>}
          </div>
          <div className="master-navigation">
            <p className="master-navigation-label">INFORMASJON OG ERFARINGER</p>
            <div className={`master-block-scroll-shell ${masterBlockScrollState.canScrollUp ? 'has-scroll-up' : ''} ${masterBlockScrollState.canScrollDown ? 'has-scroll-down' : ''}`}>
              {masterBlockScrollState.canScrollUp && <button className="master-block-scroll-arrow is-top" type="button" onClick={() => scrollMasterBlocks('up')} aria-label="Vis seksjonene over"><Icon icon="mdi:chevron-up" /></button>}
              <div className="master-block-scroll" ref={masterBlockScrollRef} onScroll={() => setMasterNavInfo(null)}>
                <div className="master-block-list">
                  {masterBlocks.map(block => {
                    const isExpanded = expandedMasterBlockIds.includes(block.id);
                    const itemSelectionIds = block.items.map(item => item.selectionId);
                    const categoryEnabled = cvBlockIds.includes(block.id) || itemSelectionIds.some(id => cvBlockIds.includes(id));
                    const isCvReferenceBlock = masterNavMode === 'cv' && block.id === 'references';
                    const isEmptyCvBlock = masterNavMode === 'cv' && block.id !== 'references' && block.items.length === 0;
                    const isCvDisabledBlock = isCvReferenceBlock || isEmptyCvBlock;
                    const navInfoText = isCvReferenceBlock ? 'Referanser skal ikke oppføres i CV' : isEmptyCvBlock ? 'Kategorien er tom' : null;
                    const childrenOpen = masterNavMode === 'cv' && isExpanded && !isCvDisabledBlock;
                    return <div className="master-nav-group" key={block.id}>
                      <div className={`master-block ${isCvDisabledBlock ? 'is-cv-disabled' : ''} ${isCvReferenceBlock ? 'is-cv-reference-placeholder' : ''} ${isEmptyCvBlock ? 'is-cv-empty' : ''} ${draggingBlockId === block.id ? 'is-dragging' : ''} ${masterInfoOpen && activeMasterBlockId === block.id ? 'is-active' : ''}`} data-master-block-id={block.id} draggable={USE_DRAG_DROP_CV_BUILDER && !masterInfoOpen && !isCvDisabledBlock} role="button" aria-disabled={isCvDisabledBlock} tabIndex={isCvDisabledBlock ? -1 : 0} onPointerEnter={event => { if (!navInfoText) return; const bounds = event.currentTarget.getBoundingClientRect(); setMasterNavInfo({ text: navInfoText, top: bounds.top + bounds.height / 2, left: bounds.right + 10 }); }} onPointerLeave={() => setMasterNavInfo(null)} onClick={() => { if (isCvDisabledBlock) return; if (masterInfoOpen) openMasterBlock(block.id); else if (block.items.length > 0) toggleMasterBlock(block.id); }} onKeyDown={event => { if (isCvDisabledBlock || (event.key !== 'Enter' && event.key !== ' ')) return; if (masterInfoOpen) openMasterBlock(block.id); else if (block.items.length > 0) toggleMasterBlock(block.id); }} onDragStart={event => { if (masterInfoOpen || !USE_DRAG_DROP_CV_BUILDER || isCvDisabledBlock) return; setDraggingBlockId(block.id); event.dataTransfer.setData('text/plain', block.id); event.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => setDraggingBlockId(null)}>
                        {!USE_DRAG_DROP_CV_BUILDER && <button className={`cv-include-toggle mode-fade-control ${categoryEnabled ? 'is-on' : ''} ${masterNavMode === 'master' ? 'is-mode-hidden' : ''}`} type="button" role="switch" aria-checked={categoryEnabled} aria-hidden={masterNavMode === 'master'} disabled={isEmptyCvBlock} tabIndex={masterNavMode === 'master' || isEmptyCvBlock ? -1 : 0} aria-label={`${categoryEnabled ? 'Skjul' : 'Vis'} ${block.title} i CV-en`} onClick={event => { event.stopPropagation(); if (!masterInfoOpen && !isEmptyCvBlock) toggleVersionCategory(block.id, itemSelectionIds); }}><Icon icon={categoryEnabled ? 'mdi:eye' : 'mdi:eye-off-outline'} aria-hidden="true" /></button>}
                        <span className={`master-block-icon ${block.id.includes('frivillig') ? 'is-volunteering' : ''}`}><Icon icon={block.icon} aria-hidden="true" /></span><strong>{block.title}</strong>{block.items.length > 0 && !isCvDisabledBlock && <button className={`master-block-expand mode-fade-control ${masterNavMode === 'master' ? 'is-mode-hidden' : ''}`} type="button" aria-label={`${isExpanded ? 'Skjul' : 'Vis'} elementer i ${block.title}`} aria-expanded={isExpanded} aria-hidden={masterNavMode === 'master'} tabIndex={masterNavMode === 'master' ? -1 : 0} onClick={event => { event.stopPropagation(); if (!masterInfoOpen) toggleMasterBlock(block.id); }}><Icon icon={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} /></button>}
                        {!masterInfoOpen && USE_DRAG_DROP_CV_BUILDER && <small>⋮⋮</small>}
                      </div>
                      {block.items.length > 0 && <div className={`master-block-children-shell ${childrenOpen ? 'is-open' : ''}`} aria-hidden={!childrenOpen} onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows' && childrenOpen) finishPendingQualificationAttention(block.id); }}>
                        <div className="master-block-children">
                          {block.items.map(item => {
                            const qualificationSelected = customCategorySelectionIds.includes(block.id) || customCategorySelectionIds.includes(item.selectionId);
                            return <div className={`master-block-child ${qualificationSelected ? 'has-qualification-key' : ''}`} draggable={childrenOpen && USE_DRAG_DROP_CV_BUILDER} onDragStart={event => { if (!childrenOpen || !USE_DRAG_DROP_CV_BUILDER) return; setDraggingBlockId(item.selectionId); event.dataTransfer.setData('text/plain', item.selectionId); event.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => setDraggingBlockId(null)} key={item.selectionId} title={item.subtitle || item.title}>
                              {!USE_DRAG_DROP_CV_BUILDER && <button className={`cv-include-toggle ${cvBlockIds.includes(block.id) || cvBlockIds.includes(item.selectionId) ? 'is-on' : ''}`} type="button" role="switch" aria-checked={cvBlockIds.includes(block.id) || cvBlockIds.includes(item.selectionId)} tabIndex={childrenOpen ? 0 : -1} aria-label={`${cvBlockIds.includes(block.id) || cvBlockIds.includes(item.selectionId) ? 'Skjul' : 'Vis'} ${item.title} i CV-en`} onClick={() => toggleVersionItem(block.id, item.selectionId, itemSelectionIds)}><Icon icon={cvBlockIds.includes(block.id) || cvBlockIds.includes(item.selectionId) ? 'mdi:eye' : 'mdi:eye-off-outline'} aria-hidden="true" /></button>}
                              {USE_DRAG_DROP_CV_BUILDER && <span className="master-block-child-handle">⋮⋮</span>}<span>{item.title}</span>
                              {block.id !== 'profile' && <button className={`qualification-key-toggle ${qualificationSelected ? 'is-selected' : ''}`} type="button" aria-pressed={qualificationSelected} tabIndex={childrenOpen ? 0 : -1} title={qualificationSelected ? 'Fjern fra Nøkkelkvalifikasjoner' : 'Legg til i Nøkkelkvalifikasjoner'} aria-label={`${qualificationSelected ? 'Fjern' : 'Legg til'} ${item.title} ${qualificationSelected ? 'fra' : 'i'} Nøkkelkvalifikasjoner`} onClick={event => { event.stopPropagation(); toggleQualificationItem(block.id, item.selectionId, itemSelectionIds); }}><Icon icon={qualificationSelected ? 'mdi:key' : 'mdi:key-outline'} aria-hidden="true" /></button>}
                            </div>;
                          })}
                        </div>
                      </div>}
                    </div>;
                  })}
                  {masterNavMode === 'master' && <CustomCategoryCreator variant="nav" open={customCategoryCreator === 'nav'} value={customSectionTitle} onOpen={() => { setCustomSectionTitle(''); setCustomCategoryCreator('nav'); }} onChange={setCustomSectionTitle} onCancel={() => { setCustomSectionTitle(''); setCustomCategoryCreator(null); }} onSubmit={addCustomSection} />}
                </div>
              </div>
              {masterBlockScrollState.canScrollDown && <button className="master-block-scroll-arrow is-bottom" type="button" onClick={() => scrollMasterBlocks('down')} aria-label="Vis flere seksjoner"><Icon icon="mdi:chevron-down" /></button>}
            </div>
          </div>
          <button className="add-block" onClick={() => setBlockMenuOpen(true)}><strong>+</strong><span>Ny byggekloss</span></button>
          <p className="nav-label">CV-EDITOR</p>
          <a className="nav-link active" href="#profile"><span>◆</span> Profil</a>
          {document.sections.map(section => <a className="nav-link" href={`#section-${section.id}`} key={section.id}>▤ {section.title}</a>)}
          <a className="nav-link" href="#additional">◫ Ferdigheter og referanser</a>
          <a className="nav-link" href="#versions">▧ Genererte CV-er</a>
          <div className="nav-divider" />
          <p className="nav-label">PROSJEKT</p>
          <div className="save-menu nav-save-menu">
            <button className="nav-action" disabled={masterEntryEditing} onClick={() => setStorageMenuOpen(open => !open)}>▣ Lagre ▾</button>
            {storageMenuOpen && (
              <div className="save-menu-panel">
                <button disabled={!storageConnected} onClick={() => { setStorageMenuOpen(false); void save(); }}>Lagre endringer</button>
                <button disabled={!googleDriveState.configured} onClick={() => { setStorageMenuOpen(false); void connectGoogleDrive(); }}>Koble til Google Drive</button>
                <button disabled={!storeState.supported} onClick={() => { setStorageMenuOpen(false); void chooseFolder(); }}>Velg lokal mappe</button>
                <button onClick={() => { setStorageMenuOpen(false); void exportJson(); }}>Eksporter JSON</button>
              </div>
            )}
          </div>
          <button className="nav-action" disabled={!storageConnected} onClick={duplicateDraft}>▧ Ny variant</button>
          <button className="nav-action nav-generate" onClick={() => void generate()}>▶ Generer PDF</button>
        </nav>
        {USE_DRAG_DROP_CV_BUILDER && <aside className="version-nav" aria-label="CV-versjon" ref={versionNavRef}>
          {mode === 'master' && <button className="mode-switch" onClick={() => { switchMode('cv'); setEditingMasterBlockId(null); }}>Rediger CV-versjon</button>}
          <p className="nav-label">CV-VERSJON</p>
          <h2>CV Kiwi</h2>
          <p className="version-hint">Dra masterdata hit for å inkludere dem i denne CV-en.</p>
          <div className="version-dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addBlockToVersion(event.dataTransfer.getData('text/plain')); }}>
            {selectedVersionBlocks.length === 0 ? <span>Slipp en kategori eller en enkeltdel her</span> : selectedVersionBlocks.map(({ block, isWholeCategory, selectedItems }) => <div className="version-selection-group" key={block.id}>
              <div className="master-block version-block" role="button" tabIndex={0} onClick={() => navigateToMasterBlock(block.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') navigateToMasterBlock(block.id); }}>
                <span className={`master-block-icon ${block.id.includes('frivillig') ? 'is-volunteering' : ''}`}><Icon icon={block.icon} aria-hidden="true" /></span><strong>{block.title}</strong><button onClick={event => { event.stopPropagation(); removeVersionCategory(block.id); }} aria-label={`Fjern ${block.title}`}>×</button>
              </div>
              {!isWholeCategory && <div className="version-subblocks">
                {selectedItems.map(item => <div className="version-subblock" key={item.selectionId}><span>{item.title}</span><button type="button" onClick={() => removeBlockFromVersion(item.selectionId)} aria-label={`Fjern ${item.title}`}>×</button></div>)}
              </div>}
            </div>)}
          </div>
          <div className="nav-divider" />
          <div className="save-menu nav-save-menu">
            <button className="nav-action" disabled={masterEntryEditing} onClick={() => setStorageMenuOpen(open => !open)}>Lagre ▾</button>
            {storageMenuOpen && <div className="save-menu-panel">
              <button disabled={!storageConnected} onClick={() => { setStorageMenuOpen(false); void save(); }}>Lagre endringer</button>
              <button disabled={!googleDriveState.configured} onClick={() => { setStorageMenuOpen(false); void connectGoogleDrive(); }}>Koble til Google Drive</button>
              <button disabled={!storeState.supported} onClick={() => { setStorageMenuOpen(false); void chooseFolder(); }}>Velg lokal mappe</button>
              <button onClick={() => { setStorageMenuOpen(false); void exportJson(); }}>Eksporter JSON</button>
            </div>}
          </div>
          <button className="nav-action" disabled={!storageConnected} onClick={duplicateDraft}>Ny variant</button>
          <button className="nav-action nav-generate" onClick={() => void generate()}>Generer PDF</button>
        </aside>}
        <div className="content-column" ref={contentColumnRef}>
      {false && !storeState.supported && (
        <div className="notice">
          Nettleseren støtter ikke lokal prosjektmappe direkte. Bruk Chrome eller Edge for mappevalg, eller eksporter JSON manuelt.
        </div>
      )}

      {!googleDriveState.configured && (
        <div className="notice">
          Google Drive er ikke konfigurert ennå. Følg oppsettet i README før du kan koble til en Google-konto.
        </div>
      )}

      <div className={`workspace ${editingMasterBlockId ? '' : 'preview-workspace'}`}>
        <main className={editingMasterBlockId ? 'editor' : 'editor composer-hidden'}>
          {mode === 'master' ? (
            <>
              <section className="master-mode-heading">
                <div><p className="eyebrow">MASTERDATA</p><h1>Min informasjon</h1><p>Dette er den komplette informasjonen din. Alle CV-versjoner henter byggeklosser herfra.</p></div>
              </section>
              <ProfileEditor profile={document.profile} onChange={profile => setDocument({ ...document, profile })} />
              {document.sections.map((section, index) => <SectionEditor key={section.id} section={section} onChange={value => updateSection(index, value)} onDelete={removeCustomSection} />)}
              <SkillsReferencesEditor section="references" skillGroups={document.skillGroups} references={document.references} onSkillsChange={skillGroups => setDocument({ ...document, skillGroups })} onReferencesChange={references => setDocument({ ...document, references })} />
            </>
          ) : editingMasterBlockId ? (
            <>
              <section className="composer-panel master-edit-heading">
                <button className="button secondary" onClick={() => setEditingMasterBlockId(null)}>← Til CV-byggeren</button>
                <div><p className="eyebrow">MASTERDATA</p><h2>Rediger {masterBlocks.find(block => block.id === editingMasterBlockId)?.title}</h2><p>Endringer her oppdaterer alle CV-versjoner som bruker denne byggeklossen.</p></div>
              </section>
              {editingMasterBlockId === 'profile' && <ProfileEditor profile={document.profile} onChange={profile => setDocument({ ...document, profile })} />}
              {document.sections.map((section, index) => editingMasterBlockId === section.id ? <SectionEditor key={section.id} section={section} onChange={value => updateSection(index, value)} onDelete={removeCustomSection} /> : null)}
              {editingMasterBlockId === 'references' && <SkillsReferencesEditor section="references" skillGroups={document.skillGroups} references={document.references} onSkillsChange={skillGroups => setDocument({ ...document, skillGroups })} onReferencesChange={references => setDocument({ ...document, references })} />}
            </>
          ) : (
            <section className="composer-panel">
              <p className="eyebrow">BYGG CV-VERSJON</p>
              <h2>Dra byggeklosser fra Masterdata til CV-versjonen</h2>
              <p>CV-versjonen til venstre bestemmer hva som vises i PDF-en. Klikk på en byggekloss i Masterdata når du vil redigere informasjonen.</p>
              <div className="composer-summary"><strong>{cvBlockIds.length}</strong><span>byggeklosser inkludert i denne CV-versjonen</span></div>
            </section>
          )}
          <div className="legacy-editor">
          <ProfileEditor profile={document.profile} onChange={profile => setDocument({ ...document, profile })} />
          {document.sections.map((section, index) => (
            <SectionEditor key={section.id} section={section} onChange={value => updateSection(index, value)} onDelete={removeCustomSection} />
          ))}
          <SkillsReferencesEditor
            section="references"
            skillGroups={document.skillGroups}
            references={document.references}
            onSkillsChange={skillGroups => setDocument({ ...document, skillGroups })}
            onReferencesChange={references => setDocument({ ...document, references })}
          />
          <section className="panel" id="versions">
            <h2>Genererte CV-er</h2>
            {document.generatedVersions.length === 0 ? <p>Ingen genererte versjoner ennå.</p> : (
              <ul>
                {document.generatedVersions.map(version => (
                  <li key={`${version.fileName}-${version.createdAt}`}>{version.fileName} - {new Date(version.createdAt).toLocaleString('no-NO')}</li>
                ))}
              </ul>
            )}
          </section>
          </div>
        </main>
        <CvPreview
          document={cvVersion}
          overrides={activeCvOverrides}
          formatSettings={formatSettings}
          formatPanelOpen={formatPanelOpen && !formatPanelClosing}
          onToggleFormatPanel={toggleFormatPanel}
          onTextChange={updateCvPreviewText}
          onDescriptionVariantChange={updateCvDescriptionVariant}
          onFieldVisibilityChange={updateCvPreviewFieldVisibility}
          onQualificationDescriptionChange={updateQualificationDescription}
          onQualificationAttention={requestQualificationAttention}
          onSectionOrderChange={updateCvPreviewSectionOrder}
          onEntryOrderChange={updateCvPreviewEntryOrder}
          onQualificationHighlightOrderChange={updateQualificationHighlightOrder}
          sortingEnabled={masterNavMode === 'cv'}
        />
      </div>
      </div>
      {formatPanelOpen && (
        <aside className={`preview-format-panel ${formatPanelClosing ? 'is-closing' : ''}`} aria-label="Formatering" onAnimationEnd={event => {
          if (event.animationName === 'preview-format-panel-out') {
            setFormatPanelOpen(false);
            setFormatPanelClosing(false);
          }
          }}>
          <div className="format-navigation">
            <header className="format-navigation-header">
              <div><p>FORMATERING</p><h2>Dokument</h2></div>
              <button className="format-navigation-back" type="button" onClick={closeFormatPanel} aria-label="Skjul formatering"><Icon icon="mdi:chevron-double-right" aria-hidden="true" /></button>
            </header>
            <section className="format-settings-group">
              <h3>Tekst</h3>
              <FormatControl label="Linjeavstand" value={formatSettings.lineHeight} min={1} max={2.2} step={0.05} onChange={lineHeight => setFormatSettings(current => ({ ...current, lineHeight }))} />
              <FormatControl label="Navn" value={formatSettings.nameSize} min={14} max={36} step={1} onChange={nameSize => setFormatSettings(current => ({ ...current, nameSize }))} />
              <FormatControl label="Seksjonstittel" value={formatSettings.sectionTitleSize} min={9} max={22} step={1} onChange={sectionTitleSize => setFormatSettings(current => ({ ...current, sectionTitleSize }))} />
              <FormatControl label="Deltittel" value={formatSettings.subtitleSize} min={8} max={18} step={1} onChange={subtitleSize => setFormatSettings(current => ({ ...current, subtitleSize }))} />
              <FormatControl label="Paragraf" value={formatSettings.paragraphSize} min={8} max={16} step={1} onChange={paragraphSize => setFormatSettings(current => ({ ...current, paragraphSize }))} />
              <FormatControl label="Tittel-underlinje avstand" value={formatSettings.titleUnderlineGap} min={-12} max={12} step={1} onChange={titleUnderlineGap => setFormatSettings(current => ({ ...current, titleUnderlineGap }))} />
              <FormatControl label="Avstand før kategoritittel" value={formatSettings.sectionTitleBeforeGap} min={0} max={48} step={1} onChange={sectionTitleBeforeGap => setFormatSettings(current => ({ ...current, sectionTitleBeforeGap }))} />
              <FormatControl label="Avstand etter kategoritittel" value={formatSettings.sectionTitleAfterGap} min={0} max={48} step={1} onChange={sectionTitleAfterGap => setFormatSettings(current => ({ ...current, sectionTitleAfterGap }))} />
              <FormatControl label="Avstand mellom Nøkkelkvalifikasjoner-tittel og beskrivelse" value={formatSettings.qualificationTitleDescriptionGap} min={0} max={48} step={1} onChange={qualificationTitleDescriptionGap => setFormatSettings(current => ({ ...current, qualificationTitleDescriptionGap }))} />
            </section>
            <section className="format-settings-group">
              <h3>Layout</h3>
              <FormatControl label="Avstand mellom erfaringer" value={formatSettings.experienceGap} min={0} max={40} step={1} onChange={experienceGap => setFormatSettings(current => ({ ...current, experienceGap }))} />
              <FormatControl label="Erfarings-element gap" value={formatSettings.experienceElementGap} min={0} max={24} step={1} onChange={experienceElementGap => setFormatSettings(current => ({ ...current, experienceElementGap }))} />
              <FormatControl label="Bildestørrelse" value={formatSettings.photoSize} min={32} max={90} step={1} onChange={photoSize => setFormatSettings(current => ({ ...current, photoSize }))} />
              <FormatControl label="Sidemarger" value={formatSettings.pageMargins} min={10} max={48} step={1} onChange={pageMargins => setFormatSettings(current => ({ ...current, pageMargins }))} />
              <FormatControl label="Topp-/bunnmarg" value={formatSettings.verticalPageMargins} min={0} max={48} step={1} onChange={verticalPageMargins => setFormatSettings(current => ({ ...current, verticalPageMargins }))} />
              <FormatToggleControl label="Organisasjon, dato og type på én linje – Nøkkelkvalifikasjoner" value={formatSettings.inlineQualificationMetadata} variant="switch" onChange={inlineQualificationMetadata => setFormatSettings(current => ({ ...current, inlineQualificationMetadata }))} />
              <FormatToggleControl label="Organisasjon, dato og type på én linje – øvrige erfaringer" value={formatSettings.inlineExperienceMetadata} variant="switch" onChange={inlineExperienceMetadata => setFormatSettings(current => ({ ...current, inlineExperienceMetadata }))} />
            </section>
            <section className="format-settings-group">
              <h3>Utseende</h3>
              <FormatColorControl label="Kontrastfarge" value={formatSettings.accentColor} onChange={accentColor => setFormatSettings(current => ({ ...current, accentColor }))} />
              <FormatColorControl label="Navnefarge" value={formatSettings.nameColor} onChange={nameColor => setFormatSettings(current => ({ ...current, nameColor }))} />
              <FormatColorControl label="Personalia-detaljer" value={formatSettings.personalTextColor} onChange={personalTextColor => setFormatSettings(current => ({ ...current, personalTextColor }))} />
              <FormatColorControl label="Kategorititler" value={formatSettings.sectionTitleColor} onChange={sectionTitleColor => setFormatSettings(current => ({ ...current, sectionTitleColor }))} />
              <FormatColorControl label="Erfaringstitler" value={formatSettings.entryTitleColor} onChange={entryTitleColor => setFormatSettings(current => ({ ...current, entryTitleColor }))} />
              <FormatColorControl label="Metadata og undertitler" value={formatSettings.metadataColor} onChange={metadataColor => setFormatSettings(current => ({ ...current, metadataColor }))} />
              <FormatColorControl label="Beskrivelsestekst" value={formatSettings.paragraphColor} onChange={paragraphColor => setFormatSettings(current => ({ ...current, paragraphColor }))} />
              <FormatColorControl label="Farge på lenker" value={formatSettings.linkColor} onChange={linkColor => setFormatSettings(current => ({ ...current, linkColor }))} />
              <FormatToggleControl label="Ikoner på titler" value={formatSettings.showTitleIcons} onChange={showTitleIcons => setFormatSettings(current => ({ ...current, showTitleIcons }))} />
              <FormatToggleControl label="Ikoner på personalia" value={formatSettings.showPersonalIcons} onChange={showPersonalIcons => setFormatSettings(current => ({ ...current, showPersonalIcons }))} />
            </section>
          </div>
        </aside>
      )}
      </div>
      </div>
    </div>
    {masterNavInfo && <div className="master-nav-info" role="tooltip" style={{ top: masterNavInfo.top, left: masterNavInfo.left }}>{masterNavInfo.text}</div>}
    {pendingMasterAction && (
      <aside className="master-unsaved-popup" role="dialog" aria-modal="true" aria-label="Ulagrede endringer" style={{ top: pendingMasterAction.y, left: pendingMasterAction.x }}>
        <strong>Vil du lagre «{pendingMasterAction.session.title}»?</strong>
        <p>Du har endringer som ikke er ferdigbehandlet.</p>
        <div className="master-unsaved-actions">
          <button className="button" type="button" onClick={() => resolvePendingMasterAction('save')}>Lagre</button>
          <button className="button secondary" type="button" onClick={() => resolvePendingMasterAction('return')}>Gå tilbake</button>
          <button className="master-unsaved-discard" type="button" onClick={() => resolvePendingMasterAction('discard')}>Forkast endringer</button>
        </div>
      </aside>
    )}
    {masterInfoOpen && (
      <>
      <div className={`master-info-backdrop ${masterInfoClosing ? 'is-closing' : ''}`} onClick={event => requestMasterAction(closeMasterInfo, { x: event.clientX, y: event.clientY })} />
      <section className={`master-info-overlay ${masterInfoClosing ? 'is-closing' : ''}`} aria-modal="true" role="dialog" aria-label="Masterdata" ref={masterInfoOverlayRef} onAnimationEnd={event => {
        if (masterInfoClosing && event.animationName === 'master-overlay-out') {
          setMasterInfoOpen(false);
          setMasterInfoClosing(false);
        }
      }}>
        <span className="master-overlay-corner master-overlay-corner-top" aria-hidden="true" />
        <span className="master-overlay-corner master-overlay-corner-bottom" aria-hidden="true" />
        <div className="master-info-scroll" ref={masterInfoScrollRef}>
          <ProfileEditor profile={document.profile} onChange={profile => setDocument({ ...document, profile })} />
          {document.sections.map((section, index) => <SectionEditor key={section.id} section={section} onChange={value => updateSection(index, value)} onEditingChange={handleMasterEntryEditingChange} onRequestAction={requestMasterAction} onDelete={removeCustomSection} />)}
          <SkillsReferencesEditor section="references" skillGroups={document.skillGroups} references={document.references} onSkillsChange={skillGroups => setDocument({ ...document, skillGroups })} onReferencesChange={references => setDocument({ ...document, references })} />
          <CustomCategoryCreator variant="overlay" open={customCategoryCreator === 'overlay'} value={customSectionTitle} onOpen={() => { setCustomSectionTitle(''); setCustomCategoryCreator('overlay'); }} onChange={setCustomSectionTitle} onCancel={() => { setCustomSectionTitle(''); setCustomCategoryCreator(null); }} onSubmit={addCustomSection} />
        </div>
      </section>
      </>
    )}
    {blockMenuOpen && (
      <div className="block-modal-backdrop" role="presentation" onMouseDown={() => setBlockMenuOpen(false)}>
        <section className="block-modal" role="dialog" aria-modal="true" aria-labelledby="block-modal-title" onMouseDown={event => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setBlockMenuOpen(false)} aria-label="Lukk">×</button>
          <p className="eyebrow">CV-EDITOR</p>
          <h2 id="block-modal-title">Legg til byggekloss</h2>
          <p>Velg en ferdig seksjon. Du kan redigere, flytte eller fjerne innholdet etterpå.</p>
          <div className="block-options">
            <button onClick={() => addSection('Arbeidserfaring', 'arbeid', 'Stillingstittel')}><span className="block-icon">💼</span><strong>Yrke</strong><span>Stilling, arbeidsgiver og periode</span></button>
            <button onClick={() => addSection('Utdanning', 'utdanning', 'Studium eller utdanning')}><span className="block-icon">▤</span><strong>Utdanning</strong><span>Skole, grad og periode</span></button>
            <button onClick={() => addSkillGroup('Nøkkelkompetanse')}><span className="block-icon">✦</span><strong>Nøkkelkompetanse</strong><span>Ferdigheter og verktøy</span></button>
            <button onClick={() => addSection('Sertifiseringer', 'sertifisering', 'Sertifisering')}><span className="block-icon">✓</span><strong>Sertifisering</strong><span>Kurs, sertifikat eller lisens</span></button>
            <button onClick={() => addSection('Kurs og verv', 'kurs', 'Kurs eller verv')}><span className="block-icon">◫</span><strong>Kurs og verv</strong><span>Relevant erfaring utenfor jobb</span></button>
          </div>
          <form className="custom-block" onSubmit={event => { event.preventDefault(); addCustomSection(); }}>
            <label><span>Egendefinert kategori</span><input value={customSectionTitle} onChange={event => setCustomSectionTitle(event.target.value)} placeholder="For eksempel: Publikasjoner" /></label>
            <button className="button secondary" disabled={!customSectionTitle.trim()} type="submit">Legg til egen</button>
          </form>
        </section>
      </div>
    )}
    {settingsOpen && (
      <div className="block-modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
        <section className="block-modal settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={event => event.stopPropagation()}>
          <button className="modal-close" type="button" onClick={() => setSettingsOpen(false)} aria-label="Lukk">×</button>
          <p className="eyebrow">CV KIWI</p>
          <h2 id="settings-title">Innstillinger</h2>
          <section className="settings-storage-zone">
            <div>
              <strong>OneDrive-lagring</strong>
              <p>Velg en OneDrive-mappe som allerede synkroniseres på PC-en. CV Kiwi lagrer da JSON og eksporter i denne mappen.</p>
            </div>
            <button className="button secondary" type="button" onClick={() => void manageOneDriveFolder()}><Icon icon="mdi:microsoft-onedrive" aria-hidden="true" />Administrer OneDrive-lagring</button>
          </section>
          <section className="settings-debug-zone">
            <div className="settings-debug-heading"><div><strong>Debug nettleserlagring</strong><p>Kjør knapp 1 før lukking. Etter at siden er åpnet igjen, kjør både knapp 1 og knapp 2 og send resultatene.</p></div></div>
            <div className="settings-debug-actions">
              <button className="button secondary" type="button" onClick={() => void inspectStoredBrowserProject()}>1. Les persistent IndexedDB-data</button>
              <button className="button secondary" type="button" disabled={!storageHydrated} onClick={inspectLoadedApplicationProject}>{storageHydrated ? '2. Les data lastet inn i appen' : '2. Venter på innlasting…'}</button>
            </div>
            {storageDebugOutput && <div className="settings-debug-result">
              <div><strong>{storageDebugTitle}</strong><button className="button secondary" type="button" onClick={() => void copyStorageDebugOutput()}><Icon icon="mdi:content-copy" aria-hidden="true" />Kopier</button></div>
              <textarea readOnly spellCheck={false} value={storageDebugOutput} aria-label={storageDebugTitle} />
            </div>}
          </section>
          <div className="settings-danger-zone">
            <div><strong>Reset all Master data og CV</strong><p>Sletter alt innhold i det aktive prosjektet og starter med en tom CV.</p></div>
            <button className="settings-reset-button" type="button" onClick={() => setResetConfirmationOpen(true)}>Reset all Master data og CV</button>
          </div>
        </section>
      </div>
    )}
    {resetConfirmationOpen && (
      <div className="block-modal-backdrop reset-confirmation-backdrop" role="presentation" onMouseDown={() => setResetConfirmationOpen(false)}>
        <section className="block-modal reset-confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-confirmation-title" onMouseDown={event => event.stopPropagation()}>
          <p className="eyebrow danger">PERMANENT HANDLING</p>
          <h2 id="reset-confirmation-title">Er du sikker?</h2>
          <p>All Masterdata, alle CV-valg og all formatering i det aktive prosjektet blir slettet. Handlingen kan ikke angres.</p>
          <div className="reset-confirmation-actions">
            <button className="button secondary" type="button" onClick={() => void exportJson()}><Icon icon="mdi:download" aria-hidden="true" />Last ned prosjektet først</button>
            <span className="reset-confirmation-spacer" />
            <button className="button secondary" type="button" onClick={() => setResetConfirmationOpen(false)}>Avbryt</button>
            <button className="settings-reset-button" type="button" onClick={resetAllProjectData}>Ja, nullstill alt</button>
          </div>
        </section>
      </div>
    )}
    {welcomeOpen && (
      <div className="welcome-backdrop" role="presentation">
        <section className="welcome-dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
          <p className="eyebrow">CV KIWI</p>
          <h1 id="welcome-title">Velg hvor prosjektet skal lagres</h1>
          <p>Velg hvor prosjektet skal lagres. Et tidligere lokalt prosjekt åpnes automatisk når nettleseren fortsatt har tilgang.</p>
          <div className="welcome-storage-options">
            <button className="welcome-storage-option" onClick={() => void startWithGoogleDrive()}>
              <span className="welcome-option-icon is-google-drive" aria-hidden="true"><img src={googleDriveIcon} alt="" /></span>
              <strong>Administrer lagring i Google Drive</strong>
              <small>Koble til din egen Drive-mappe.</small>
            </button>
            <button className="welcome-storage-option" onClick={() => void startWithPcStorage()}>
              <span className="welcome-option-icon" aria-hidden="true"><Icon icon="mdi:monitor" /></span>
              <strong>Administrer lagring på PC</strong>
              <small>Lagre lokalt eller last opp et tidligere prosjekt.</small>
            </button>
            <button className="welcome-storage-option" onClick={startWithFilledExample}>
              <span className="welcome-option-icon" aria-hidden="true"><Icon icon="mdi:file-document-outline" /></span>
              <strong>Åpne eksempelprosjekt</strong>
              <small>Utforsk en anonym CV med enkle eksempler i hver kategori.</small>
            </button>
          </div>
        </section>
      </div>
    )}
    {pcStorageGuideOpen && (
      <aside className="pc-storage-guide" style={pcStorageGuideTop === null ? undefined : { top: pcStorageGuideTop }} role="status" aria-live="polite">
        <span>Lagre prosjektet lokalt på maskinen, eller last opp tidligere prosjekt.</span>
        <button type="button" onClick={dismissPcStorageGuide}>OK</button>
      </aside>
    )}
    </>
  );
}

function CustomCategoryCreator({ variant, open, value, onOpen, onChange, onCancel, onSubmit }: { variant: 'nav' | 'overlay'; open: boolean; value: string; onOpen: () => void; onChange: (value: string) => void; onCancel: () => void; onSubmit: () => void }) {
  return (
    <section className={`custom-category-creator is-${variant} ${open ? 'is-open' : ''}`}>
      {!open ? (
        <button className="add-entry custom-category-open" type="button" onClick={onOpen}>+ Legg til egendefinert kategori</button>
      ) : (
        <form onSubmit={event => { event.preventDefault(); onSubmit(); }}>
          <label><span>Navn på kategori</span><input autoFocus value={value} onChange={event => onChange(event.currentTarget.value)} placeholder="For eksempel: Publikasjoner" /></label>
          <div className="custom-category-actions">
            <button className="button" type="submit" disabled={!value.trim()}>Legg til</button>
            <button className="button secondary" type="button" onClick={onCancel}>Avbryt</button>
          </div>
        </form>
      )}
    </section>
  );
}

function railProfilePhotoStyle(profile: CvDocument['profile']) {
  const aspect = profile.photoAspect ?? 1;
  const width = aspect >= 1 ? aspect * 100 : 100;
  const height = aspect >= 1 ? 100 : 100 / aspect;
  return {
    top: `calc(50% + ${profile.photoPositionY ?? 0}%)`,
    left: `calc(50% + ${profile.photoPositionX ?? 0}%)`,
    width: `${width}%`,
    height: `${height}%`,
    transform: `translate(-50%, -50%) scale(${profile.photoScale ?? 1}) scaleX(${profile.photoFlipped ? -1 : 1})`
  };
}

function FormatControl({ label, value, min, max, step, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startValue: number; dragging: boolean } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragValueRef = useRef<number | null>(null);
  const emittedDragValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const [textValue, setTextValue] = useState(String(value));
  const [pointerActive, setPointerActive] = useState(false);
  const decimals = (String(step).split('.')[1] ?? '').length;
  const clamp = (next: number) => Math.min(max, Math.max(min, Number(next.toFixed(decimals))));
  const setFromText = (text: string) => {
    setTextValue(text);
    if (!text.trim()) return;
    const parsed = Number(text.replace(',', '.'));
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
  };

  useEffect(() => {
    setTextValue(String(value));
    emittedDragValueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const commitDragValue = (next: number) => {
      pendingDragValueRef.current = null;
      dragFrameRef.current = null;
      if (emittedDragValueRef.current === next) return;
      emittedDragValueRef.current = next;
      window.dispatchEvent(new Event('cv-kiwi:format-change-start'));
      onChangeRef.current(next);
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const distance = event.clientX - drag.startX;
      if (!drag.dragging && Math.abs(distance) < 4) return;
      drag.dragging = true;
      const next = clamp(drag.startValue + (distance / 6) * step);
      setTextValue(String(next));
      pendingDragValueRef.current = next;
      if (dragFrameRef.current === null) {
        dragFrameRef.current = window.requestAnimationFrame(() => {
          const pending = pendingDragValueRef.current;
          if (pending !== null) commitDragValue(pending);
          else dragFrameRef.current = null;
        });
      }
    };

    const finishDrag = (event?: globalThis.PointerEvent) => {
      const input = inputRef.current;
      const drag = dragRef.current;
      if (!drag || (event && drag.pointerId !== event.pointerId)) return;
      dragRef.current = null;
      setPointerActive(false);
      const pending = pendingDragValueRef.current;
      if (pending !== null) {
        if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
        commitDragValue(pending);
      }
      if (!drag.dragging && input) {
        window.requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      }
    };

    window.document.addEventListener('pointermove', handlePointerMove);
    window.document.addEventListener('pointerup', finishDrag);
    window.document.addEventListener('pointercancel', finishDrag);
    return () => {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      pendingDragValueRef.current = null;
      window.document.removeEventListener('pointermove', handlePointerMove);
      window.document.removeEventListener('pointerup', finishDrag);
      window.document.removeEventListener('pointercancel', finishDrag);
    };
  }, [min, max, step, decimals]);

  return (
    <label className="preview-format-control">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.currentTarget.value))} />
      <span className={`preview-format-number ${pointerActive ? 'is-pointer-active' : ''}`}>
        <input
          type="text"
          ref={inputRef}
          value={textValue}
          inputMode="decimal"
          aria-label={`${label} verdi`}
          onChange={event => setFromText(event.currentTarget.value)}
          onBlur={() => setTextValue(String(value))}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          onPointerDown={event => {
            event.preventDefault();
            setPointerActive(true);
            event.currentTarget.blur();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value, dragging: false };
          }}
        />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  );
}

function FormatColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="preview-format-color">
    <span>{label}</span>
    <span className="preview-format-color-value">
      <input type="color" value={value} onChange={event => onChange(event.currentTarget.value)} aria-label={label} />
      <code>{value.toUpperCase()}</code>
    </span>
  </label>;
}

function FormatToggleControl({ label, value, variant = 'visibility', onChange }: { label: string; value: boolean; variant?: 'visibility' | 'switch'; onChange: (value: boolean) => void }) {
  const activeText = variant === 'switch' ? 'På' : 'Vis';
  const inactiveText = variant === 'switch' ? 'Av' : 'Skjul';
  const icon = variant === 'switch'
    ? value ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off-outline'
    : value ? 'mdi:eye' : 'mdi:eye-off-outline';
  return <div className="preview-format-toggle-row">
    <span>{label}</span>
    <button className={`preview-format-toggle ${value ? 'is-on' : ''}`} type="button" role="switch" aria-checked={value} onClick={() => { window.dispatchEvent(new Event('cv-kiwi:format-change-start')); onChange(!value); }}>
      <Icon icon={icon} aria-hidden="true" />
      <span>{value ? activeText : inactiveText}</span>
    </button>
  </div>;
}

function RoundedPdfIcon() {
  return <svg className="rounded-pdf-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
    <path className="rounded-pdf-page" d="M8.5 2.5h10.8L26 9.2v19.3a2 2 0 0 1-2 2H8.5a2 2 0 0 1-2-2v-24a2 2 0 0 1 2-2Z" />
    <path className="rounded-pdf-fold" d="M19 2.8V8a1.5 1.5 0 0 0 1.5 1.5h5.2" />
    <rect className="rounded-pdf-banner" x="2" y="13" width="28" height="11" rx="3" />
    <text className="rounded-pdf-text" x="16" y="20.7" textAnchor="middle">PDF</text>
  </svg>;
}

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9æøå]+/gi, '-').replace(/^-|-$/g, '') || 'cv';
}

function projectExportFileName(fullName: string, date = new Date()) {
  const safeName = fullName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_') || 'Uten_navn';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `CV_Kiwi_${safeName}_${day}.${month}.${year}.json`;
}
