import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { createPortal } from 'react-dom';
import { CvDocument, CvEntry, CvFormatSettingsData, CvSection, CvVersionOverrideState, DescriptionVariant, QualificationHighlight, RichLine } from '../types';
import { DescriptionVersionsEditor } from './SectionEditor';
import { getSectionIcon } from '../cvVersion';

const DOCUMENT_FONT_SCALE = 0.72;
const REFERENCE_SECTION_ID = '__cv-references';
const REFERENCE_ENTRY_ID = '__cv-reference-request';

type SectionPage = {
  id: string;
  sections: CvSection[];
};

function createSectionPages(sections: CvSection[]): SectionPage[] {
  if (sections.length === 0) return [];
  return [{
    id: `section-page-${crypto.randomUUID()}`,
    sections: sections.map(section => ({ ...section, entries: [...section.entries] }))
  }];
}

interface Props {
  document: CvDocument;
  overrides: CvVersionOverrideState;
  formatSettings: CvFormatSettings;
  formatPanelOpen: boolean;
  onToggleFormatPanel: () => void;
  onTextChange: (key: string, value: string) => void;
  onDescriptionVariantChange: (entryId: string, variantId: string, resetDescriptionOverride?: boolean) => void;
  onFieldVisibilityChange: (key: string, hidden: boolean) => void;
  onQualificationDescriptionChange: (lines: RichLine[]) => void;
  onQualificationAttention: () => void;
  onSectionOrderChange: (sectionIds: string[]) => void;
  onEntryOrderChange: (sectionId: string, entryIds: string[]) => void;
  onQualificationHighlightOrderChange: (highlightIds: string[]) => void;
  sortingEnabled: boolean;
}

export interface CvFormatSettings extends CvFormatSettingsData {}

export function CvPreview({ document, overrides, formatSettings, formatPanelOpen, onToggleFormatPanel, onTextChange, onDescriptionVariantChange, onFieldVisibilityChange, onQualificationDescriptionChange, onQualificationAttention, onSectionOrderChange, onEntryOrderChange, onQualificationHighlightOrderChange, sortingEnabled }: Props) {
  const [zoom, setZoom] = useState(1.8);
  const [zoomText, setZoomText] = useState('180');
  const [editingQualifications, setEditingQualifications] = useState(false);
  const [editingEntryAnchorId, setEditingEntryAnchorId] = useState<string | null>(null);
  const [qualificationDraft, setQualificationDraft] = useState<CvEntry>(() => qualificationEntryFromDocument(document));
  const shellRef = useRef<HTMLElement>(null);
  const previewPencilCursorRef = useRef<HTMLSpanElement>(null);
  const pendingEntryReorderRef = useRef<{ before: Map<string, { top: number; left: number; pageIndex?: string }>; primaryKey: string; token: number } | null>(null);
  const stableLayoutSnapshotRef = useRef<Map<string, { top: number; left: number; width: number; height: number; pageIndex?: string }>>(new Map());
  const measuredLayoutRef = useRef<Map<string, { width: number; height: number }>>(new Map());
  const measuredLayoutZoomRef = useRef(zoom);
  const blockedBackwardPullsRef = useRef(new Set<number>());
  const rebuildingPaginationRef = useRef(true);
  const pendingPaginationResetRef = useRef<SectionPage[] | null>(null);
  const pendingPreviewScrollRef = useRef<{ top: number; left: number; windowX: number; windowY: number } | null>(null);
  const previewScrollRestoreFrameRef = useRef<number | null>(null);
  const entryReorderAnimationsRef = useRef<Animation[]>([]);
  const entryReorderTokenRef = useRef(0);
  const lastPointerPositionRef = useRef({ x: -1, y: -1 });
  const skipNextSectionPageResetRef = useRef(false);
  const qualificationTabRef = useRef<HTMLDivElement>(null);
  const [qualificationGuidePosition, setQualificationGuidePosition] = useState<{ top: number; right: number } | null>(null);
  const [zoomControlLeft, setZoomControlLeft] = useState<number | null>(null);
  const hasReferences = Boolean(document.referencesEnabled);
  const contentSections = document.sections.filter(section => section.entries.length > 0);
  const sections: CvSection[] = hasReferences
    ? [...contentSections, {
        id: REFERENCE_SECTION_ID,
        title: 'Referanser',
        entries: [{ id: REFERENCE_ENTRY_ID, title: '', subtitle: '', lines: [] }]
      }]
    : contentSections;
  const sectionSignature = JSON.stringify({ sections, text: overrides.text, descriptionVariants: overrides.descriptionVariantIds, hiddenFields: overrides.hiddenFields });
  const [sectionPages, setSectionPages] = useState<SectionPage[]>(() => createSectionPages(sections));
  const qualificationHighlights = document.qualificationHighlights ?? [];
  const qualificationPaginationSignature = JSON.stringify({
    description: document.qualificationDescription,
    descriptionLines: document.qualificationDescriptionLines,
    highlights: qualificationHighlights.map(highlight => ({
      id: highlight.id,
      title: highlight.title,
      subtitle: highlight.subtitle,
      description: highlight.description,
      descriptionLines: highlight.descriptionLines,
      entryId: highlight.entry?.id
    }))
  });
  const hasQualifications = Boolean(document.qualificationEnabled);
  const hasProfile = [
    document.profile.fullName,
    document.profile.title,
    document.profile.organization,
    document.profile.birthDate,
    document.profile.address,
    document.profile.phone,
    document.profile.email,
    document.profile.socialLabel,
    ...(document.profile.personalDetails ?? []).map(detail => detail.value)
  ].some(Boolean);
  const text = (key: string, fallback: string) => overrides.text[key] ?? fallback;
  const profileTitle = text('profile.title', document.profile.title);
  const profileOrganization = text('profile.organization', document.profile.organization);
  const profileContactRows = getProfileContactRows(document.profile);
  const setPreviewZoom = (value: number) => setZoom(Math.min(3, Math.max(.55, Number(value.toFixed(2)))));

  function pageEntryCount(page: SectionPage | undefined) {
    return page?.sections.reduce((count, section) => count + section.entries.length, 0) ?? 0;
  }

  function canMoveLastEntryForward(page: SectionPage | undefined, pageIndex: number) {
    const minimumEntriesToKeep = pageIndex === 0 && (hasProfile || hasQualifications) ? 0 : 1;
    return pageEntryCount(page) > minimumEntriesToKeep;
  }

  function rememberPreviewViewport() {
    const shell = shellRef.current;
    if (shell && !pendingPreviewScrollRef.current) {
      pendingPreviewScrollRef.current = {
        top: shell.scrollTop,
        left: shell.scrollLeft,
        windowX: window.scrollX,
        windowY: window.scrollY
      };
    }
  }

  function changeFieldVisibilityWithoutMovingViewport(key: string, hidden: boolean) {
    rememberPreviewViewport();
    onFieldVisibilityChange(key, hidden);
  }

  function measureWithoutInlineLayoutTransforms<T>(host: HTMLElement, measure: () => T) {
    const transformed = Array.from(host.querySelectorAll<HTMLElement>('[data-preview-entry-anchor], [data-preview-layout-anchor]'))
      .map(element => ({ element, transform: element.style.transform }));
    for (const { element } of transformed) element.style.removeProperty('transform');
    try {
      return measure();
    } finally {
      for (const { element, transform } of transformed) {
        if (transform) element.style.transform = transform;
        else element.style.removeProperty('transform');
      }
    }
  }

  function pageHasVisualOverflow(page: HTMLElement) {
    const pageBounds = page.getBoundingClientRect();
    const visibleChildren = Array.from(page.children).filter(child => getComputedStyle(child).display !== 'none');
    const contentBottom = visibleChildren.reduce((bottom, child) => {
      const bounds = child.getBoundingClientRect();
      const marginBottom = Number.parseFloat(getComputedStyle(child).marginBottom) * zoom || 0;
      return Math.max(bottom, bounds.bottom + marginBottom);
    }, pageBounds.top);
    const paddingBottom = Number.parseFloat(getComputedStyle(page).paddingBottom) * zoom || 0;
    return contentBottom > pageBounds.bottom - paddingBottom + 1;
  }

  function movePreviewPencilCursor(event: React.PointerEvent<HTMLDivElement>) {
    const cursor = previewPencilCursorRef.current;
    if (!cursor) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.preview-order-controls')) {
      cursor.style.display = 'none';
      return;
    }
    const entry = target?.closest<HTMLElement>('.preview-entry-editable');
    const overEditable = entry ? !entry.classList.contains('is-editing') : Boolean(target?.closest('.qualification-preview-editable'));
    if (!overEditable) {
      cursor.style.display = 'none';
      return;
    }
    cursor.style.display = 'block';
    cursor.style.transform = `translate3d(${event.clientX - 1}px, ${event.clientY - 13}px, 0)`;
  }

  function hidePreviewPencilCursor() {
    if (previewPencilCursorRef.current) previewPencilCursorRef.current.style.display = 'none';
  }

  function queuePreviewLayoutReorder(primaryKey: string, move: () => void) {
    rememberPreviewViewport();
    rebuildingPaginationRef.current = false;
    const shell = shellRef.current;
    for (const animation of entryReorderAnimationsRef.current) animation.cancel();
    entryReorderAnimationsRef.current = [];
    shell?.querySelectorAll<HTMLElement>('.is-order-moving, .is-order-animating').forEach(element => element.classList.remove('is-order-moving', 'is-order-animating'));
    const before = new Map<string, { top: number; left: number; pageIndex?: string }>();
    const coordinateRoot = shell?.querySelector<HTMLElement>('.preview-document');
    const rootBounds = coordinateRoot?.getBoundingClientRect();
    shell?.querySelectorAll<HTMLElement>('[data-preview-entry-anchor], [data-preview-layout-anchor]').forEach(element => {
      const key = element.dataset.previewEntryAnchor
        ? `entry:${element.dataset.previewEntryAnchor}`
        : element.dataset.previewLayoutAnchor
          ? `layout:${element.dataset.previewLayoutAnchor}`
          : undefined;
      if (!key || !rootBounds) return;
      const bounds = element.getBoundingClientRect();
      const pageBounds = element.closest<HTMLElement>('.cv-page')?.getBoundingClientRect() ?? rootBounds;
      const pageIndex = element.closest<HTMLElement>('[data-section-page-index]')?.dataset.sectionPageIndex;
      before.set(key, {
        top: (bounds.top - rootBounds.top) / zoom,
        left: (bounds.left - pageBounds.left) / zoom,
        pageIndex
      });
    });
    const token = ++entryReorderTokenRef.current;
    pendingEntryReorderRef.current = before.size > 0 ? { before, primaryKey, token } : null;
    if (before.size > 0) {
      window.document.body.classList.add('is-entry-reordering');
      window.dispatchEvent(new Event('preview-entry-reorder-start'));
    }
    move();
  }

  function clearEntryReorderAnimations() {
    entryReorderTokenRef.current += 1;
    for (const animation of entryReorderAnimationsRef.current) animation.cancel();
    entryReorderAnimationsRef.current = [];
    shellRef.current?.classList.remove('is-entry-reordering');
    shellRef.current?.classList.remove('is-cross-page-reordering');
    window.document.body.classList.remove('is-entry-reordering');
    window.dispatchEvent(new Event('preview-entry-reorder-end'));
    shellRef.current?.querySelectorAll<HTMLElement>('.is-order-moving, .is-order-animating').forEach(element => element.classList.remove('is-order-moving', 'is-order-animating'));
  }

  function dispatchEntryReorderEnd() {
    window.requestAnimationFrame(() => {
      const { x, y } = lastPointerPositionRef.current;
      let hoveredAnchorId: string | undefined;
      if (x >= 0 && y >= 0) {
        for (const anchor of window.document.querySelectorAll<HTMLElement>('[data-preview-entry-anchor]')) {
          const anchorId = anchor.dataset.previewEntryAnchor;
          const zone = anchor.closest<HTMLElement>('.preview-entry-sort-zone');
          if (!anchorId || !zone) continue;
          const anchorBounds = anchor.getBoundingClientRect();
          const zoneBounds = zone.getBoundingClientRect();
          const insideVerticalRange = y >= anchorBounds.top && y <= anchorBounds.bottom;
          const insideHorizontalRange = x >= zoneBounds.left - 59 && x <= zoneBounds.right;
          if (insideVerticalRange && insideHorizontalRange) {
            hoveredAnchorId = anchorId;
            break;
          }
        }
      }
      window.dispatchEvent(new CustomEvent('preview-entry-reorder-end', { detail: { hoveredAnchorId } }));
    });
  }

  function openQualificationEditor() {
    setQualificationDraft(qualificationEntryFromDocument(document));
    setEditingQualifications(true);
  }

  function saveQualifications() {
    onQualificationDescriptionChange(activeDescriptionLines(qualificationDraft));
    setEditingQualifications(false);
  }

  function cancelQualificationEditing() {
    setQualificationDraft(qualificationEntryFromDocument(document));
    setEditingQualifications(false);
  }

  function drawAttentionToMasterExperiences() {
    onQualificationAttention();
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    const ids = sections.filter(section => section.id !== REFERENCE_SECTION_ID).map(section => section.id);
    const index = ids.indexOf(sectionId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    queuePreviewLayoutReorder(`layout:section-title:${sectionId}`, () => onSectionOrderChange(ids));
  }

  function moveEntry(sectionId: string, entryId: string, direction: -1 | 1) {
    const ids = sections.find(section => section.id === sectionId)?.entries.map(entry => entry.id) ?? [];
    const index = ids.indexOf(entryId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    const primaryAnchorId = `section:${sectionId}:${entryId}`;
    queuePreviewLayoutReorder(`entry:${primaryAnchorId}`, () => {
      skipNextSectionPageResetRef.current = true;
      setSectionPages(current => {
        const entriesById = new Map(current.flatMap(page => page.sections.filter(section => section.id === sectionId).flatMap(section => section.entries)).map(entry => [entry.id, entry]));
        const orderedEntries = ids.map(id => entriesById.get(id)).filter((entry): entry is CvEntry => Boolean(entry));
        let cursor = 0;
        return current.map(page => ({
          ...page,
          sections: page.sections.map(section => {
            if (section.id !== sectionId) return section;
            const entries = orderedEntries.slice(cursor, cursor + section.entries.length);
            cursor += section.entries.length;
            return { ...section, entries };
          })
        }));
      });
      onEntryOrderChange(sectionId, ids);
    });
  }

  function moveQualificationHighlight(highlightId: string, direction: -1 | 1) {
    const ids = qualificationHighlights.map(highlight => highlight.id);
    const index = ids.indexOf(highlightId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    const primaryAnchorId = `qualification:${highlightId}`;
    queuePreviewLayoutReorder(`entry:${primaryAnchorId}`, () => onQualificationHighlightOrderChange(ids));
  }

  function findBackwardPullIndex(pageElements: HTMLElement[]) {
    if (rebuildingPaginationRef.current) return -1;
    for (let index = 0; index < sectionPages.length - 1; index += 1) {
      if (blockedBackwardPullsRef.current.has(index)) continue;
      const currentPage = sectionPages[index];
      const nextPage = sectionPages[index + 1];
      const currentSection = currentPage?.sections[currentPage.sections.length - 1];
      const nextSection = nextPage?.sections[0];
      const currentPageElement = pageElements[index];
      const nextPageElement = pageElements[index + 1];
      if (!nextSection || !currentPageElement || !nextPageElement) continue;
      const nextEntry = nextSection.entries[0];
      if (!nextEntry) continue;
      const groups = currentPageElement.querySelectorAll<HTMLElement>('.preview-section-group');
      const currentGroup = groups[groups.length - 1];
      const nextGroup = nextPageElement.querySelector<HTMLElement>('.preview-section-group');
      const nextEntryAnchor = nextPageElement.querySelector<HTMLElement>(`[data-preview-entry-anchor="${CSS.escape(`section:${nextSection.id}:${nextEntry.id}`)}"]`);
      if (!nextGroup || !nextEntryAnchor) continue;
      const pageBounds = currentPageElement.getBoundingClientRect();
      const contentBottom = currentGroup
        ? currentGroup.getBoundingClientRect().bottom
        : Math.max(pageBounds.top, ...Array.from(currentPageElement.children).map(child => child.getBoundingClientRect().bottom));
      const nextGroupBounds = nextGroup.getBoundingClientRect();
      const entryBounds = nextEntryAnchor.getBoundingClientRect();
      const pagePaddingBottom = Number.parseFloat(getComputedStyle(currentPageElement).paddingBottom) * zoom;
      const availableSpace = pageBounds.bottom - pagePaddingBottom - contentBottom;
      const continuesCurrentSection = currentSection?.id === nextSection.id;
      const experienceFlowMargin = Math.max(0, formatSettings.experienceGap - 10) * zoom;
      const requiredSpace = continuesCurrentSection
        ? entryBounds.height + experienceFlowMargin
        : entryBounds.bottom - nextGroupBounds.top + formatSettings.sectionTitleBeforeGap * zoom;
      if (requiredSpace <= availableSpace - 1) return index;
    }
    return -1;
  }

  useEffect(() => {
    setZoomText(String(Math.round(zoom * 100)));
  }, [zoom]);

  useEffect(() => {
    const capturePreviewBeforeFormatChange = () => {
      const shell = shellRef.current;
      const coordinateRoot = shell?.querySelector<HTMLElement>('.preview-document');
      if (!shell || !coordinateRoot) return;
      rememberPreviewViewport();
      const rootBounds = coordinateRoot.getBoundingClientRect();
      const snapshot = new Map<string, { top: number; left: number; width: number; height: number; pageIndex?: string }>();
      shell.querySelectorAll<HTMLElement>('[data-preview-entry-anchor], [data-preview-layout-anchor]').forEach(element => {
        const key = element.dataset.previewEntryAnchor
          ? `entry:${element.dataset.previewEntryAnchor}`
          : element.dataset.previewLayoutAnchor
            ? `layout:${element.dataset.previewLayoutAnchor}`
            : undefined;
        if (!key) return;
        const bounds = element.getBoundingClientRect();
        const pageBounds = element.closest<HTMLElement>('.cv-page')?.getBoundingClientRect() ?? rootBounds;
        snapshot.set(key, {
          top: (bounds.top - rootBounds.top) / zoom,
          left: (bounds.left - pageBounds.left) / zoom,
          width: bounds.width / zoom,
          height: bounds.height / zoom,
          pageIndex: element.closest<HTMLElement>('[data-section-page-index]')?.dataset.sectionPageIndex
        });
      });
      if (snapshot.size > 0) stableLayoutSnapshotRef.current = snapshot;
      entryReorderTokenRef.current += 1;
      for (const animation of entryReorderAnimationsRef.current) animation.cancel();
      entryReorderAnimationsRef.current = [];
      shell.classList.remove('is-entry-reordering', 'is-cross-page-reordering');
      window.document.body.classList.remove('is-entry-reordering');
    };
    const captureBeforeNativeFormatChange = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.preview-format-control')) capturePreviewBeforeFormatChange();
    };
    window.addEventListener('input', captureBeforeNativeFormatChange, true);
    window.addEventListener('change', captureBeforeNativeFormatChange, true);
    window.addEventListener('cv-kiwi:format-change-start', capturePreviewBeforeFormatChange);
    return () => {
      window.removeEventListener('input', captureBeforeNativeFormatChange, true);
      window.removeEventListener('change', captureBeforeNativeFormatChange, true);
      window.removeEventListener('cv-kiwi:format-change-start', capturePreviewBeforeFormatChange);
    };
  }, [zoom]);

  useLayoutEffect(() => {
    if (skipNextSectionPageResetRef.current) {
      skipNextSectionPageResetRef.current = false;
      return;
    }
    if (stableLayoutSnapshotRef.current.size > 0) rememberPreviewViewport();
    rebuildingPaginationRef.current = true;
    blockedBackwardPullsRef.current.clear();
    const resetPages = createSectionPages(sections);
    pendingPaginationResetRef.current = resetPages;
    setSectionPages(resetPages);
  }, [sectionSignature, qualificationPaginationSignature, formatSettings.lineHeight, formatSettings.nameSize, formatSettings.photoSize, formatSettings.sectionTitleSize, formatSettings.subtitleSize, formatSettings.paragraphSize, formatSettings.experienceGap, formatSettings.experienceElementGap, formatSettings.titleUnderlineGap, formatSettings.sectionTitleBeforeGap, formatSettings.sectionTitleAfterGap, formatSettings.qualificationTitleDescriptionGap, formatSettings.pageMargins, formatSettings.verticalPageMargins, formatSettings.showTitleIcons, formatSettings.showPersonalIcons, formatSettings.inlineQualificationMetadata, formatSettings.inlineExperienceMetadata]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const elements = Array.from(shell.querySelectorAll<HTMLElement>('[data-preview-entry-anchor], [data-preview-layout-anchor]'));
    const coordinateRoot = shell.querySelector<HTMLElement>('.preview-document');
    if (!coordinateRoot) return;
    const keyFor = (element: HTMLElement) => element.dataset.previewEntryAnchor
      ? `entry:${element.dataset.previewEntryAnchor}`
      : element.dataset.previewLayoutAnchor
        ? `layout:${element.dataset.previewLayoutAnchor}`
        : undefined;
    const capture = () => {
      const snapshot = new Map<string, { top: number; left: number; width: number; height: number; pageIndex?: string }>();
      const rootBounds = coordinateRoot.getBoundingClientRect();
      for (const element of elements) {
        const key = keyFor(element);
        if (!key) continue;
        const bounds = element.getBoundingClientRect();
        const page = element.closest<HTMLElement>('.cv-page');
        const horizontalParentBounds = page?.getBoundingClientRect() ?? rootBounds;
        snapshot.set(key, {
          top: (bounds.top - rootBounds.top) / zoom,
          left: (bounds.left - horizontalParentBounds.left) / zoom,
          width: bounds.width / zoom,
          height: bounds.height / zoom,
          pageIndex: element.closest<HTMLElement>('[data-section-page-index]')?.dataset.sectionPageIndex
        });
      }
      return snapshot;
    };
    const holdAtStablePosition = () => {
      const rootBounds = coordinateRoot.getBoundingClientRect();
      for (const element of elements) {
        element.style.removeProperty('transform');
        const key = keyFor(element);
        const previous = key ? stableLayoutSnapshotRef.current.get(key) : undefined;
        if (!previous) continue;
        const bounds = element.getBoundingClientRect();
        const currentTop = (bounds.top - rootBounds.top) / zoom;
        const deltaY = previous.top - currentTop;
        if (Math.abs(deltaY) >= .5) element.style.transform = `translate3d(0, ${deltaY}px, 0)`;
      }
    };
    const pendingReset = pendingPaginationResetRef.current;
    const resetGenerationIsRendered = pendingReset
      ? (pendingReset.length === 0 && sectionPages.length === 0) || pendingReset[0]?.id === sectionPages[0]?.id
      : true;
    if (pendingReset && !resetGenerationIsRendered) {
      if (entryReorderAnimationsRef.current.length > 0) {
        stableLayoutSnapshotRef.current = capture();
        for (const animation of entryReorderAnimationsRef.current) animation.cancel();
        entryReorderAnimationsRef.current = [];
      }
      holdAtStablePosition();
      return;
    }
    if (pendingReset && resetGenerationIsRendered) pendingPaginationResetRef.current = null;
    for (const element of elements) element.style.removeProperty('transform');
    const pages = Array.from(shell.querySelectorAll<HTMLElement>('[data-section-page-index]'));
    const hasForwardOverflow = pages.some((page, index) => pageHasVisualOverflow(page) && canMoveLastEntryForward(sectionPages[index], index));
    if (!hasForwardOverflow) rebuildingPaginationRef.current = false;
    const paginationStillMoving = hasForwardOverflow || findBackwardPullIndex(pages) >= 0;
    if (paginationStillMoving) {
      // Pagination may need several React renders. Hold every existing anchor
      // at its last stable visual position so those internal calculations are
      // never exposed as jumps between pages.
      holdAtStablePosition();
      return;
    }
    const pendingScroll = pendingPreviewScrollRef.current;
    if (pendingScroll) {
      const restoreViewport = () => {
        shell.scrollTop = pendingScroll.top;
        shell.scrollLeft = pendingScroll.left;
        if (Math.abs(window.scrollX - pendingScroll.windowX) > .5 || Math.abs(window.scrollY - pendingScroll.windowY) > .5) {
          window.scrollTo(pendingScroll.windowX, pendingScroll.windowY);
        }
      };
      restoreViewport();
      if (previewScrollRestoreFrameRef.current === null) {
        previewScrollRestoreFrameRef.current = requestAnimationFrame(() => {
          restoreViewport();
          previewScrollRestoreFrameRef.current = requestAnimationFrame(() => {
            restoreViewport();
            previewScrollRestoreFrameRef.current = null;
            if (pendingPreviewScrollRef.current === pendingScroll) pendingPreviewScrollRef.current = null;
          });
        });
      }
    }
    if (entryReorderAnimationsRef.current.length > 0) return;

    const pending = pendingEntryReorderRef.current;
    const hadActiveAnimations = entryReorderAnimationsRef.current.length > 0;
    const visualSnapshot = hadActiveAnimations ? capture() : null;
    for (const animation of entryReorderAnimationsRef.current) animation.cancel();
    entryReorderAnimationsRef.current = [];
    for (const element of elements) element.style.removeProperty('transform');
    const finalSnapshot = capture();
    const zoomChanged = measuredLayoutZoomRef.current !== zoom;
    measuredLayoutZoomRef.current = zoom;

    for (const element of elements) {
      const key = keyFor(element);
      const measurement = key ? finalSnapshot.get(key) : undefined;
      if (!key || !measurement) continue;
      measuredLayoutRef.current.set(key, { width: measurement.width, height: measurement.height });
      element.dataset.previewMeasuredWidth = measurement.width.toFixed(3);
      element.dataset.previewMeasuredHeight = measurement.height.toFixed(3);
    }

    const hadStableLayout = stableLayoutSnapshotRef.current.size > 0;
    const before = pending?.before ?? visualSnapshot ?? stableLayoutSnapshotRef.current;
    stableLayoutSnapshotRef.current = finalSnapshot;
    if (!hadStableLayout || zoomChanged) {
      pendingEntryReorderRef.current = null;
      return;
    }

    const nextAnimations: Animation[] = [];
    let crossesPageBoundary = false;
    for (const element of elements) {
      const key = keyFor(element);
      if (!key) continue;
      const previous = before.get(key);
      const current = finalSnapshot.get(key);
      if (!current) continue;
      element.classList.add('is-order-animating');
      let animation: Animation | null = null;
      if (previous) {
        // Preview pages own horizontal movement during resize/panel changes.
        // Child FLIP animations are therefore intentionally vertical-only.
        const deltaX = 0;
        // CSS zoom also scales transforms, so the logical position delta is
        // already the exact inverse transform needed by FLIP.
        const deltaY = previous.top - current.top;
        if (Math.abs(deltaX) >= .5 || Math.abs(deltaY) >= .5) {
          if (previous.pageIndex !== current.pageIndex) crossesPageBoundary = true;
          animation = element.animate([
            { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' }
          ], { duration: 300, easing: 'cubic-bezier(.4, 0, .2, 1)' });
        }
      } else {
        animation = element.animate([
          { opacity: 0, transform: 'translate3d(0, 6px, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' }
        ], { duration: 220, easing: 'ease-out' });
      }
      if (!animation) {
        element.classList.remove('is-order-animating');
        continue;
      }
      animation.pause();
      animation.currentTime = 0;
      if (key === pending?.primaryKey) element.classList.add('is-order-moving');
      const cleanUp = () => element.classList.remove('is-order-moving', 'is-order-animating');
      animation.addEventListener('finish', cleanUp, { once: true });
      animation.addEventListener('cancel', cleanUp, { once: true });
      nextAnimations.push(animation);
    }

    pendingEntryReorderRef.current = null;
    if (nextAnimations.length === 0) {
      shell.classList.remove('is-entry-reordering', 'is-cross-page-reordering');
      window.document.body.classList.remove('is-entry-reordering');
      if (pending) dispatchEntryReorderEnd();
      return;
    }

    const token = pending?.token ?? ++entryReorderTokenRef.current;
    entryReorderAnimationsRef.current = nextAnimations;
    shell.classList.add('is-entry-reordering');
    if (crossesPageBoundary) shell.classList.add('is-cross-page-reordering');
    else shell.classList.remove('is-cross-page-reordering');
    window.document.body.classList.add('is-entry-reordering');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (entryReorderTokenRef.current !== token || entryReorderAnimationsRef.current !== nextAnimations) return;
      for (const animation of nextAnimations) {
        if (animation.playState === 'paused') animation.play();
      }
    }));
    void Promise.allSettled(nextAnimations.map(animation => animation.finished)).then(() => {
      if (entryReorderTokenRef.current !== token) return;
      shell.classList.remove('is-entry-reordering', 'is-cross-page-reordering');
      window.document.body.classList.remove('is-entry-reordering');
      dispatchEntryReorderEnd();
      entryReorderAnimationsRef.current = [];
    });
  });

  useLayoutEffect(() => {
    if (!hasQualifications) {
      setQualificationGuidePosition(null);
      return;
    }
    const updatePosition = () => {
      const bounds = qualificationTabRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setQualificationGuidePosition({ top: bounds.top + bounds.height / 2, right: window.innerWidth - bounds.left + 10 });
    };
    const frame = window.requestAnimationFrame(updatePosition);
    const observer = new ResizeObserver(updatePosition);
    if (qualificationTabRef.current) observer.observe(qualificationTabRef.current);
    if (shellRef.current) observer.observe(shellRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [hasQualifications, zoom, formatPanelOpen, formatSettings.photoSize, formatSettings.sectionTitleBeforeGap, formatSettings.verticalPageMargins]);

  useLayoutEffect(() => {
    // Expansion while editing may temporarily block a page boundary to avoid
    // pagination oscillation. A new edit state is a new layout generation, so
    // those temporary blocks must not survive after the editor closes.
    blockedBackwardPullsRef.current.clear();
  }, [editingEntryAnchorId]);

  useLayoutEffect(() => {
    const host = shellRef.current;
    if (!host) return;
    const overflow = measureWithoutInlineLayoutTransforms(host, () => {
      const pages = Array.from(host.querySelectorAll<HTMLElement>('[data-section-page-index]'));
      const overflowingIndex = pages.findIndex((page, index) => pageHasVisualOverflow(page) && canMoveLastEntryForward(sectionPages[index], index));
      if (overflowingIndex < 0) return { overflowingIndex, moveCount: 0 };
      const overflowingPage = pages[overflowingIndex];
      const overflowingState = sectionPages[overflowingIndex];
      const minimumEntriesToKeep = overflowingIndex === 0 && (hasProfile || hasQualifications) ? 0 : 1;
      const anchors = Array.from(overflowingPage.querySelectorAll<HTMLElement>('.preview-section-group [data-preview-entry-anchor]'));
      const groups = Array.from(overflowingPage.querySelectorAll<HTMLElement>('.preview-section-group'));
      const zones = anchors.map(anchor => anchor.closest<HTMLElement>('.preview-entry-sort-zone') ?? anchor);
      const originalDisplays = new Map<HTMLElement, string>([...groups, ...zones].map(element => [element, element.style.display]));
      const anchorIndexes = new Map(anchors.map((anchor, index) => [anchor, index]));
      const fits = (keepCount: number) => {
        for (const group of groups) {
          const groupIndexes = Array.from(group.querySelectorAll<HTMLElement>('[data-preview-entry-anchor]'))
            .map(anchor => anchorIndexes.get(anchor))
            .filter((index): index is number => index !== undefined);
          group.style.display = groupIndexes.some(index => index < keepCount) ? (originalDisplays.get(group) ?? '') : 'none';
        }
        zones.forEach((zone, index) => {
          zone.style.display = index < keepCount ? (originalDisplays.get(zone) ?? '') : 'none';
        });
        return !pageHasVisualOverflow(overflowingPage);
      };

      let keepCount = minimumEntriesToKeep;
      const minimumFits = fits(minimumEntriesToKeep);
      if (anchors.length > minimumEntriesToKeep && minimumFits) {
        let low = minimumEntriesToKeep;
        let high = anchors.length - 1;
        while (low <= high) {
          const candidate = Math.floor((low + high) / 2);
          if (fits(candidate)) {
            keepCount = candidate;
            low = candidate + 1;
          } else {
            high = candidate - 1;
          }
        }
      }
      for (const [element, display] of originalDisplays) {
        if (display) element.style.display = display;
        else element.style.removeProperty('display');
      }
      const moveCount = Math.max(1, pageEntryCount(overflowingState) - keepCount);
      return { overflowingIndex, moveCount };
    });
    const { overflowingIndex, moveCount } = overflow;
    if (overflowingIndex < 0) return;
    const overflowing = sectionPages[overflowingIndex];
    if (!overflowing) return;
    blockedBackwardPullsRef.current.add(overflowingIndex);

    const updateOverflowingPage = () => {
      setSectionPages(current => {
        const source = current[overflowingIndex];
        if (!source) return current;
        if (!canMoveLastEntryForward(source, overflowingIndex)) return current;

        const sourceSections = source.sections.map(section => ({ ...section, entries: [...section.entries] }));
        const existingNext = current[overflowingIndex + 1];
        const nextSections = existingNext
          ? existingNext.sections.map(section => ({ ...section, entries: [...section.entries] }))
          : [];
        for (let movedIndex = 0; movedIndex < moveCount; movedIndex += 1) {
          const lastSection = sourceSections[sourceSections.length - 1];
          if (!lastSection) break;
          const moved = lastSection.entries.pop();
          if (!moved) break;
          if (nextSections[0]?.id === lastSection.id) nextSections[0].entries.unshift(moved);
          else nextSections.unshift({ ...lastSection, entries: [moved] });
          if (lastSection.entries.length === 0) sourceSections.pop();
        }

        const nextPage: SectionPage = existingNext
          ? { ...existingNext, sections: nextSections }
          : { id: `section-page-${crypto.randomUUID()}`, sections: nextSections };

        return [
          ...current.slice(0, overflowingIndex),
          { ...source, sections: sourceSections },
          nextPage,
          ...current.slice(overflowingIndex + (existingNext ? 2 : 1))
        ];
      });
    };
    updateOverflowingPage();
  }, [sectionPages, editingQualifications, editingEntryAnchorId, document.qualificationDescription, document.qualificationDescriptionLines, qualificationHighlights, overrides.text, overrides.descriptionVariantIds, overrides.hiddenFields]);

  useLayoutEffect(() => {
    const host = shellRef.current;
    if (!host) return;
    const pullIndex = measureWithoutInlineLayoutTransforms(host, () => {
      const pages = Array.from(host.querySelectorAll<HTMLElement>('[data-section-page-index]'));
      const hasOverflow = pages.some((page, index) => pageHasVisualOverflow(page) && canMoveLastEntryForward(sectionPages[index], index));
      return hasOverflow ? -1 : findBackwardPullIndex(pages);
    });
    if (pullIndex < 0) return;

    const compactPages = () => {
      setSectionPages(current => {
        const source = current[pullIndex];
        const next = current[pullIndex + 1];
        if (!source || !next) return current;
        const sourceSections = source.sections.map(section => ({ ...section, entries: [...section.entries] }));
        const nextSections = next.sections.map(section => ({ ...section, entries: [...section.entries] }));
        const sourceSection = sourceSections[sourceSections.length - 1];
        const nextSection = nextSections[0];
        if (!nextSection) return current;
        const moved = nextSection.entries.shift();
        if (!moved) return current;
        if (sourceSection?.id === nextSection.id) sourceSection.entries.push(moved);
        else sourceSections.push({ ...nextSection, entries: [moved] });
        if (nextSection.entries.length === 0) nextSections.shift();

        const compacted = [...current];
        compacted[pullIndex] = { ...source, sections: sourceSections };
        if (nextSections.length > 0) compacted[pullIndex + 1] = { ...next, sections: nextSections };
        else compacted.splice(pullIndex + 1, 1);
        return compacted;
      });
    };
    compactPages();
  }, [sectionPages, zoom, editingEntryAnchorId, formatSettings.experienceGap, document.qualificationDescription, document.qualificationDescriptionLines, qualificationHighlights, overrides.text, overrides.descriptionVariantIds, overrides.hiddenFields]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const zoomPreview = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom(current => Math.min(3, Math.max(.55, Number((current + (event.deltaY < 0 ? .1 : -.1)).toFixed(2)))));
    };
    shell.addEventListener('wheel', zoomPreview, { passive: false });
    return () => shell.removeEventListener('wheel', zoomPreview);
  }, []);

  useEffect(() => {
    const recordPointerPosition = (event: PointerEvent) => {
      lastPointerPositionRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('pointermove', recordPointerPosition, true);
    window.addEventListener('pointerdown', recordPointerPosition, true);
    return () => {
      window.removeEventListener('pointermove', recordPointerPosition, true);
      window.removeEventListener('pointerdown', recordPointerPosition, true);
    };
  }, []);

  useEffect(() => () => {
    clearEntryReorderAnimations();
    if (previewScrollRestoreFrameRef.current !== null) cancelAnimationFrame(previewScrollRestoreFrameRef.current);
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      const masterNav = window.document.querySelector<HTMLElement>('.local-nav');
      const navRect = masterNav?.getBoundingClientRect();
      setZoomControlLeft((navRect?.right ?? 0) + 8);
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, []);

  const previewStyle = {
    zoom,
    '--preview-ui-inverse-zoom': 1 / zoom,
    '--cv-format-line-height': formatSettings.lineHeight,
    '--cv-format-name-size': `${formatSettings.nameSize * DOCUMENT_FONT_SCALE}px`,
    '--cv-format-section-title-size': `${formatSettings.sectionTitleSize * DOCUMENT_FONT_SCALE}px`,
    '--cv-format-subtitle-size': `${formatSettings.subtitleSize * DOCUMENT_FONT_SCALE}px`,
    '--cv-format-paragraph-size': `${formatSettings.paragraphSize * DOCUMENT_FONT_SCALE}px`,
    '--cv-format-experience-gap': `${formatSettings.experienceGap}px`,
    '--cv-format-experience-element-gap': `${formatSettings.experienceElementGap}px`,
    '--cv-format-title-underline-gap': `${formatSettings.titleUnderlineGap}px`,
    '--cv-format-accent-color': formatSettings.accentColor,
    '--accent': formatSettings.accentColor,
    '--cv-format-name-color': formatSettings.nameColor,
    '--cv-format-personal-text-color': formatSettings.personalTextColor,
    '--cv-format-section-title-color': formatSettings.sectionTitleColor,
    '--cv-format-entry-title-color': formatSettings.entryTitleColor,
    '--cv-format-metadata-color': formatSettings.metadataColor,
    '--cv-format-paragraph-color': formatSettings.paragraphColor,
    '--cv-format-photo-size': `${formatSettings.photoSize}px`,
    '--cv-format-link-color': formatSettings.linkColor,
    '--cv-format-page-margin': `${formatSettings.pageMargins}px`,
    '--cv-format-page-margin-y': `${formatSettings.verticalPageMargins}px`,
    '--cv-format-section-before-gap': `${formatSettings.sectionTitleBeforeGap}px`,
    '--cv-format-section-after-gap': `${formatSettings.sectionTitleAfterGap}px`,
    '--cv-format-qualification-title-description-gap': `${formatSettings.qualificationTitleDescriptionGap}px`
  } as CSSProperties;

  return (
    <aside className="preview-shell" ref={shellRef}>
      <button className={`preview-format-button ${formatPanelOpen ? 'is-active' : ''}`} type="button" onClick={onToggleFormatPanel}>
        <span>Rediger Formatering</span>
      </button>
      <div className="preview-zoom-controls" style={zoomControlLeft === null ? undefined : { left: zoomControlLeft }} aria-label="Zoom i forhåndsvisning">
        <button type="button" onClick={() => setPreviewZoom(zoom + .1)} aria-label="Zoom inn">+</button>
        <label className="preview-zoom-value" aria-label="Zoomnivå">
          <input
            value={zoomText}
            inputMode="numeric"
            onFocus={event => event.currentTarget.select()}
            onChange={event => {
              const next = event.currentTarget.value.replace(/[^\d]/g, '');
              setZoomText(next);
              const parsed = Number(next);
              if (Number.isFinite(parsed) && parsed > 0) setPreviewZoom(parsed / 100);
            }}
            onBlur={() => setZoomText(String(Math.round(zoom * 100)))}
          />
          <span>%</span>
        </label>
        <button type="button" onClick={() => setPreviewZoom(zoom - .1)} aria-label="Zoom ut">−</button>
      </div>

      <div className="preview-document" style={previewStyle} onPointerMove={movePreviewPencilCursor} onPointerLeave={hidePreviewPencilCursor}>
        <div className={`cv-page scaled intro-page ${hasProfile ? 'has-profile' : ''} ${editingQualifications ? 'is-editing' : ''}`} {...(sectionPages.length > 0 ? { 'data-section-page-index': 0 } : {})}>
          {hasProfile && (
            <header className="cv-header">
              <div className="cv-photo">{document.profile.photoDataUrl ? <img src={document.profile.photoDataUrl} alt="" style={photoImageStyle(document.profile)} /> : null}</div>
              <div className={`cv-name ${!profileTitle.trim() && !profileOrganization.trim() ? 'is-name-only' : ''}`}>
                <EditableText value={text('profile.fullName', document.profile.fullName)} onChange={value => onTextChange('profile.fullName', value)} className="preview-name" />
                {profileTitle.trim() && <EditableText value={profileTitle} onChange={value => onTextChange('profile.title', value)} />}
                {profileOrganization.trim() && <EditableText value={profileOrganization} onChange={value => onTextChange('profile.organization', value)} />}
              </div>
              <div className={`cv-contact ${formatSettings.showPersonalIcons ? '' : 'hide-icons'}`}>
                {profileContactRows.map(row => (
                  <div className="cv-contact-row" key={row.id}>
                    {row.url
                      ? <a href={row.url} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}><EditableText value={text(`profile.contact.${row.id}`, row.value)} onChange={value => onTextChange(`profile.contact.${row.id}`, value)} /><NewTabIcon /></a>
                      : <EditableText value={text(`profile.contact.${row.id}`, row.value)} onChange={value => onTextChange(`profile.contact.${row.id}`, value)} />}
                    {formatSettings.showPersonalIcons && (row.icon ? <Icon icon={row.icon} aria-hidden="true" /> : <span className="cv-contact-icon-placeholder" aria-hidden="true" />)}
                  </div>
                ))}
              </div>
            </header>
          )}
          {hasQualifications && (
            <>
              <Tab title="Nøkkelkvalifikasjoner" icon="mdi:key" showIcon={formatSettings.showTitleIcons} tabRef={qualificationTabRef} />
              <main className={`cv-content qualification-preview-content ${editingQualifications ? 'is-editing' : ''}`}>
                {editingQualifications ? (
                  <div className="qualification-inline-editor">
                    <DescriptionVersionsEditor entry={qualificationDraft} onChange={setQualificationDraft} single placeholder="Beskrivelse av nøkkelkvalifikasjoner..." />
                    <div className="qualification-inline-actions">
                      <button type="button" className="qualification-inline-save" onClick={saveQualifications}>Lagre</button>
                      <button type="button" className="qualification-inline-cancel" onClick={cancelQualificationEditing}>Avbryt</button>
                    </div>
                  </div>
                ) : (
                  <div className="qualification-preview-editable" role="button" tabIndex={0} onClick={openQualificationEditor} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openQualificationEditor(); }}>
                    {qualificationDescriptionLines(document).length > 0 && <div className="qualification-preview-description"><RichTextLines lines={qualificationDescriptionLines(document)} /></div>}
                  </div>
                )}
                <QualificationHighlightEntries highlights={qualificationHighlights} inlineMetadata={formatSettings.inlineQualificationMetadata} overrides={overrides} onTextChange={onTextChange} onDescriptionVariantChange={onDescriptionVariantChange} onFieldVisibilityChange={changeFieldVisibilityWithoutMovingViewport} onMove={moveQualificationHighlight} sortingEnabled={sortingEnabled} editingEntryAnchorId={editingEntryAnchorId} onEditingEntryChange={setEditingEntryAnchorId} />
              </main>
            </>
          )}
          {sectionPages[0]?.sections.map((section, sectionIndex) => <PreviewSection section={section} allSections={sections} inlineMetadata={formatSettings.inlineExperienceMetadata} showTitleIcons={formatSettings.showTitleIcons} sortingEnabled={sortingEnabled} overrides={overrides} onTextChange={onTextChange} onDescriptionVariantChange={onDescriptionVariantChange} onFieldVisibilityChange={changeFieldVisibilityWithoutMovingViewport} onMoveSection={moveSection} onMoveEntry={moveEntry} editingEntryAnchorId={editingEntryAnchorId} onEditingEntryChange={setEditingEntryAnchorId} key={`${section.id}-${sectionIndex}`} />)}
        </div>

        {sectionPages.slice(1).map((page, pageIndex) => (
          <div className="cv-page scaled page-two" data-section-page-index={pageIndex + 1} key={page.id}>
            {page.sections.map((section, sectionIndex) => <PreviewSection section={section} allSections={sections} inlineMetadata={formatSettings.inlineExperienceMetadata} showTitleIcons={formatSettings.showTitleIcons} sortingEnabled={sortingEnabled} overrides={overrides} onTextChange={onTextChange} onDescriptionVariantChange={onDescriptionVariantChange} onFieldVisibilityChange={changeFieldVisibilityWithoutMovingViewport} onMoveSection={moveSection} onMoveEntry={moveEntry} editingEntryAnchorId={editingEntryAnchorId} onEditingEntryChange={setEditingEntryAnchorId} key={`${section.id}-${sectionIndex}`} />)}
          </div>
        ))}

      </div>
      {hasQualifications && qualificationGuidePosition && createPortal(
        <button className="qualification-key-guide" type="button" style={qualificationGuidePosition} onClick={drawAttentionToMasterExperiences}>Hovre over erfaring, og trykk på nøkkelsymbolet for å legge til i nøkkelkvalifikasjoner.</button>,
        window.document.body
      )}
      {createPortal(<span className="preview-pencil-cursor" ref={previewPencilCursorRef} aria-hidden="true" />, window.document.body)}
    </aside>
  );
}

function qualificationDescriptionLines(document: CvDocument): RichLine[] {
  if (document.qualificationDescriptionLines?.length) return document.qualificationDescriptionLines;
  if (!document.qualificationDescription?.trim()) return [];
  return document.qualificationDescription.split('\n').map(text => ({ runs: [{ text, bold: false }] }));
}

function qualificationEntryFromDocument(document: CvDocument): CvEntry {
  const lines = qualificationDescriptionLines(document).map(line => ({ runs: line.runs.map(run => ({ ...run })) }));
  return {
    id: 'qualification-description',
    title: '',
    subtitle: '',
    lines
  };
}

function activeDescriptionLines(entry: CvEntry): RichLine[] {
  const active = entry.descriptionVariants?.find(variant => variant.id === entry.activeDescriptionVariantId);
  return (active?.lines ?? entry.lines).map(line => ({ runs: line.runs.map(run => ({ ...run })) }));
}

function RichTextLines({ lines }: { lines: RichLine[] }) {
  return <>{lines.map((line, lineIndex) => (
    <span className="qualification-rich-line" key={lineIndex}>
      {line.runs.length ? line.runs.map((run, runIndex) => {
        const content = run.url ? <a href={run.url} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>{run.text}<NewTabIcon /></a> : run.text;
        return <span key={runIndex} style={{ fontWeight: run.bold ? 700 : 400, fontStyle: run.italic ? 'italic' : undefined, textDecoration: run.underline ? 'underline' : undefined }}>{content}</span>;
      }) : <br />}
    </span>
  ))}</>;
}

function NewTabIcon() {
  return <svg className="new-tab-icon" viewBox="0 0 238 241" fill="none" aria-hidden="true" focusable="false">
    <path d="M70 11H14C12.3431 11 11 12.3431 11 14V226.5C11 228.157 12.3431 229.5 14 229.5H223.5C225.157 229.5 226.5 228.157 226.5 226.5V170.5" />
    <path d="M226.5 95.5V14C226.5 12.3431 225.157 11 223.5 11H144.5" />
    <path d="M218.5 19.5L124 115.5" />
  </svg>;
}

function QualificationHighlightEntries({ highlights, inlineMetadata, overrides, onTextChange, onDescriptionVariantChange, onFieldVisibilityChange, onMove, sortingEnabled, editingEntryAnchorId, onEditingEntryChange }: { highlights: QualificationHighlight[]; inlineMetadata: boolean; onMove: (highlightId: string, direction: -1 | 1) => void; sortingEnabled: boolean; editingEntryAnchorId: string | null; onEditingEntryChange: (anchorId: string | null) => void } & Pick<Props, 'overrides' | 'onTextChange' | 'onDescriptionVariantChange' | 'onFieldVisibilityChange'>) {
  const text = (key: string, fallback: string) => overrides.text[key] ?? fallback;
  return <div className="qualification-preview-list">
    {highlights.map((highlight, index) => highlight.entry
      ? <PreviewEntry key={highlight.id} entry={highlight.entry} anchorId={`qualification:${highlight.id}`} overridePrefix={`qualification.${highlight.id}`} inlineMetadata={inlineMetadata} overrides={overrides} onTextChange={onTextChange} onDescriptionVariantChange={onDescriptionVariantChange} onFieldVisibilityChange={onFieldVisibilityChange} editingEntryAnchorId={editingEntryAnchorId} onEditingEntryChange={onEditingEntryChange} orderControls={sortingEnabled ? { canMoveUp: index > 0, canMoveDown: index < highlights.length - 1, onMove: direction => onMove(highlight.id, direction) } : undefined} />
      : (
      <div className="preview-entry-sort-zone" key={highlight.id}>
        {sortingEnabled && <EntryOrderControls anchorId={`qualification:${highlight.id}`} canMoveUp={index > 0} canMoveDown={index < highlights.length - 1} onMove={direction => onMove(highlight.id, direction)} label={highlight.title} />}
        <article className="preview-entry qualification-preview-entry preview-entry-editable" data-preview-entry-anchor={`qualification:${highlight.id}`}>
          <h4><EditableText value={text(`qualification.${index}.title`, highlight.title)} onChange={value => onTextChange(`qualification.${index}.title`, value)} /></h4>
          {highlight.subtitle && <p className="preview-entry-meta"><EditableText value={text(`qualification.${index}.subtitle`, highlight.subtitle)} onChange={value => onTextChange(`qualification.${index}.subtitle`, value)} /></p>}
          {highlight.description && <p className="preview-entry-description">
            {highlight.descriptionLines?.length && !Object.prototype.hasOwnProperty.call(overrides.text, `qualification.${index}.description`)
              ? <RichTextLines lines={highlight.descriptionLines} />
              : <EditableText value={text(`qualification.${index}.description`, highlight.description)} onChange={value => onTextChange(`qualification.${index}.description`, value)} multiline />}
          </p>}
        </article>
      </div>
    ))}
  </div>;
}

function EntryOrderControls({ anchorId, canMoveUp, canMoveDown, onMove, label }: EntryOrderControlProps & { anchorId: string; label: string }) {
  const hideTimerRef = useRef<number | null>(null);
  const controlsRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number; height: number } | null>(null);

  function showControls() {
    if (window.document.body.classList.contains('is-entry-reordering')) return;
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    setVisible(true);
  }

  function scheduleHideControls() {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setVisible(false), 0);
  }

  function updatePosition() {
    const anchor = window.document.querySelector<HTMLElement>(`[data-preview-entry-anchor="${CSS.escape(anchorId)}"]`);
    const zone = anchor?.closest<HTMLElement>('.preview-entry-sort-zone');
    if (!anchor || !zone) return;
    const anchorBounds = anchor.getBoundingClientRect();
    const zoneBounds = zone.getBoundingClientRect();
    const next = { top: anchorBounds.top + anchorBounds.height / 2, right: window.innerWidth - zoneBounds.left + 7, height: anchorBounds.height };
    setPosition(current => current?.top === next.top && current.right === next.right && current.height === next.height ? current : next);
  }

  // Position once for this anchor. Resize/scroll and reorder completion are
  // handled by the listeners below; measuring on every render feeds animated
  // transforms back into React state and creates an unstable render loop.
  useEffect(updatePosition, [anchorId]);

  useLayoutEffect(() => {
    const anchor = window.document.querySelector<HTMLElement>(`[data-preview-entry-anchor="${CSS.escape(anchorId)}"]`);
    const zone = anchor?.closest<HTMLElement>('.preview-entry-sort-zone');
    if (!anchor || !zone) return;
    const observer = new ResizeObserver(updatePosition);
    const resetControls = (event: Event) => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
      setVisible(false);
      if (event.type === 'preview-entry-reorder-end') {
        updatePosition();
        const hoveredAnchorId = (event as CustomEvent<{ hoveredAnchorId?: string }>).detail?.hoveredAnchorId;
        if (hoveredAnchorId === anchorId) showControls();
      }
    };
    const showOnPointerMove = () => {
      if (zone.matches(':hover')) showControls();
    };
    observer.observe(anchor);
    observer.observe(zone);
    zone.addEventListener('pointerenter', showControls);
    zone.addEventListener('pointerleave', scheduleHideControls);
    zone.addEventListener('pointermove', showOnPointerMove);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('preview-entry-reorder-start', resetControls);
    window.addEventListener('preview-entry-reorder-end', resetControls);
    return () => {
      observer.disconnect();
      zone.removeEventListener('pointerenter', showControls);
      zone.removeEventListener('pointerleave', scheduleHideControls);
      zone.removeEventListener('pointermove', showOnPointerMove);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('preview-entry-reorder-start', resetControls);
      window.removeEventListener('preview-entry-reorder-end', resetControls);
    };
  }, [anchorId]);

  useEffect(() => () => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
  }, []);

  if (!position) return null;
  return (
    createPortal(<span ref={controlsRef} className={`preview-order-controls preview-entry-order-controls ${visible ? 'is-visible' : ''}`} data-preview-entry-controls-anchor={anchorId} style={position} onPointerEnter={showControls} onPointerMove={showControls} onPointerLeave={scheduleHideControls} aria-label={`Endre rekkefølgen på ${label}`}>
      <button type="button" disabled={!canMoveUp} onClick={event => { event.stopPropagation(); onMove(-1); }} aria-label={`Flytt ${label} opp`} title="Flytt opp"><span className="preview-classic-arrow is-up" aria-hidden="true" /></button>
      <span className="preview-order-label" aria-hidden="true"><span>Endre</span><span>Rekkefølge</span></span>
      <button type="button" disabled={!canMoveDown} onClick={event => { event.stopPropagation(); onMove(1); }} aria-label={`Flytt ${label} ned`} title="Flytt ned"><span className="preview-classic-arrow is-down" aria-hidden="true" /></button>
    </span>, window.document.body)
  );
}

function CategoryTabWithOrderControls({ title, icon, showIcon, layoutAnchorId, canMoveUp, canMoveDown, onMove }: { title: string; icon: string; showIcon: boolean; layoutAnchorId?: string } & EntryOrderControlProps) {
  const tabRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  function showControls() {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    setControlsVisible(true);
  }

  function scheduleHideControls() {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 120);
  }

  useLayoutEffect(() => {
    if (!controlsVisible) return;
    const updatePosition = () => {
      const bounds = tabRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition({ top: bounds.top + bounds.height / 2, right: window.innerWidth - bounds.left + 7 });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [controlsVisible]);

  useEffect(() => () => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
  }, []);

  return (
    <div className="preview-category-tab-wrap" data-preview-layout-anchor={layoutAnchorId} onPointerEnter={showControls} onPointerLeave={scheduleHideControls}>
      <Tab title={title} icon={icon} showIcon={showIcon} tabRef={tabRef} />
      {controlsVisible && position && createPortal(
        <span className="preview-order-controls preview-category-order-controls" style={position} onPointerEnter={showControls} onPointerLeave={scheduleHideControls} aria-label={`Endre rekkefølgen på kategorien ${title}`}>
          <button type="button" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label={`Flytt ${title} opp`} title="Flytt kategori opp"><span className="preview-classic-arrow is-up" aria-hidden="true" /></button>
          <span className="preview-order-label" aria-hidden="true"><span>Endre</span><span>Rekkefølge</span></span>
          <button type="button" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label={`Flytt ${title} ned`} title="Flytt kategori ned"><span className="preview-classic-arrow is-down" aria-hidden="true" /></button>
        </span>,
        window.document.body
      )}
    </div>
  );
}

function PreviewSection({ section, allSections, inlineMetadata, showTitleIcons, sortingEnabled, overrides, onTextChange, onDescriptionVariantChange, onFieldVisibilityChange, onMoveSection, onMoveEntry, editingEntryAnchorId, onEditingEntryChange }: Pick<Props, 'overrides' | 'onTextChange' | 'onDescriptionVariantChange' | 'onFieldVisibilityChange'> & { section: CvSection; allSections: CvSection[]; inlineMetadata: boolean; showTitleIcons: boolean; sortingEnabled: boolean; onMoveSection: (sectionId: string, direction: -1 | 1) => void; onMoveEntry: (sectionId: string, entryId: string, direction: -1 | 1) => void; editingEntryAnchorId: string | null; onEditingEntryChange: (anchorId: string | null) => void }) {
  if (section.id === REFERENCE_SECTION_ID) {
    return <section className="preview-section-group preview-reference-section">
      <div className="preview-category-tab-wrap" data-preview-layout-anchor={`section-title:${REFERENCE_SECTION_ID}`}><Tab title="Referanser" icon="mdi:account-group" showIcon={showTitleIcons} /></div>
      <main className="cv-content">
        <div className="preview-entry-sort-zone">
          <p className="preview-reference-request" data-preview-entry-anchor={`section:${REFERENCE_SECTION_ID}:${REFERENCE_ENTRY_ID}`}>Referanser oppgis på forespørsel.</p>
        </div>
      </main>
    </section>;
  }
  const fullSection = allSections.find(candidate => candidate.id === section.id) ?? section;
  const sortableSections = allSections.filter(candidate => candidate.id !== REFERENCE_SECTION_ID);
  const sectionIndex = sortableSections.findIndex(candidate => candidate.id === section.id);
  const primaryEntryId = fullSection.entries[0]?.id;
  const isPrimaryFragment = primaryEntryId ? section.entries.some(entry => entry.id === primaryEntryId) : false;
  return (
    <section className="preview-section-group">
      {sortingEnabled
        ? <CategoryTabWithOrderControls title={section.title} icon={getSectionIcon(section)} showIcon={showTitleIcons} layoutAnchorId={isPrimaryFragment ? `section-title:${section.id}` : undefined} canMoveUp={sectionIndex > 0} canMoveDown={sectionIndex >= 0 && sectionIndex < sortableSections.length - 1} onMove={direction => onMoveSection(section.id, direction)} />
        : <div className="preview-category-tab-wrap" data-preview-layout-anchor={isPrimaryFragment ? `section-title:${section.id}` : undefined}><Tab title={section.title} icon={getSectionIcon(section)} showIcon={showTitleIcons} /></div>}
      <main className="cv-content">
        {section.entries.map(entry => {
          const entryIndex = fullSection.entries.findIndex(candidate => candidate.id === entry.id);
          return <PreviewEntry key={entry.id} entry={entry} sectionKind={section.kind} anchorId={`section:${section.id}:${entry.id}`} inlineMetadata={inlineMetadata} overrides={overrides} onTextChange={onTextChange} onDescriptionVariantChange={onDescriptionVariantChange} onFieldVisibilityChange={onFieldVisibilityChange} editingEntryAnchorId={editingEntryAnchorId} onEditingEntryChange={onEditingEntryChange} orderControls={sortingEnabled ? { canMoveUp: entryIndex > 0, canMoveDown: entryIndex >= 0 && entryIndex < fullSection.entries.length - 1, onMove: direction => onMoveEntry(section.id, entry.id, direction) } : undefined} />;
        })}
      </main>
    </section>
  );
}

type EntryOrderControlProps = { canMoveUp: boolean; canMoveDown: boolean; onMove: (direction: -1 | 1) => void };

function PreviewEntry({ entry, sectionKind, anchorId, overridePrefix, inlineMetadata = false, overrides, onTextChange, onDescriptionVariantChange, onFieldVisibilityChange, orderControls, editingEntryAnchorId, onEditingEntryChange }: Pick<Props, 'overrides' | 'onTextChange' | 'onDescriptionVariantChange' | 'onFieldVisibilityChange'> & { entry: CvEntry; sectionKind?: CvSection['kind']; anchorId?: string; overridePrefix?: string; inlineMetadata?: boolean; orderControls?: EntryOrderControlProps; editingEntryAnchorId: string | null; onEditingEntryChange: (anchorId: string | null) => void }) {
  const isEditingEntry = Boolean(anchorId && editingEntryAnchorId === anchorId);
  const entryOverrideKey = overridePrefix ?? `entry.${entry.id}`;
  const descriptionVariantKey = overridePrefix ?? entry.id;
  const text = (field: string, fallback: string) => overrides.text[`${entryOverrideKey}.${field}`] ?? fallback;
  const fieldKey = (field: string) => `${entryOverrideKey}.${field}`;
  const isHidden = (field: string) => overrides.hiddenFields?.[fieldKey(field)] ?? false;
  const variants: DescriptionVariant[] = entry.descriptionVariants?.length ? entry.descriptionVariants : [{ id: 'legacy-description', label: 'Versjon 1', lines: entry.lines }];
  const variantId = overrides.descriptionVariantIds[descriptionVariantKey] ?? entry.activeDescriptionVariantId ?? variants[0].id;
  const selectedVariant = variants.find(variant => variant.id === variantId);
  const defaultDescription = selectedVariant ? linesToText(selectedVariant.lines) : '';
  const descriptionOverrideKey = `${entryOverrideKey}.description`;
  const hasDescriptionOverride = Object.prototype.hasOwnProperty.call(overrides.text, descriptionOverrideKey);
  const description = text('description', defaultDescription);
  const descriptionIsHidden = variantId === '__none__' || isHidden('description');
  const isLanguage = sectionKind === 'languages';
  const languageOralLevel = (entry.employmentType || entry.subtitle || entry.organization || '').trim();
  const languageWrittenLevel = (entry.location || languageOralLevel).trim();
  const subtitle = isLanguage ? '' : text('subtitle', entry.organization !== undefined ? entry.organization : entry.subtitle);
  const metadata = isLanguage
    ? [languageOralLevel && `Muntlig: ${languageOralLevel}`, languageWrittenLevel && `Skriftlig: ${languageWrittenLevel}`].filter(Boolean).join(' · ')
    : [text('period', formatPeriod(entry)), text('employmentType', entry.employmentType ?? ''), text('location', entry.location ?? '')].filter(Boolean).join(' · ');
  const useInlineMetadata = inlineMetadata || isEditingEntry;

  return (
    <div className="preview-entry-sort-zone">
      {orderControls && anchorId && <EntryOrderControls {...orderControls} anchorId={anchorId} label={entry.title} />}
      <article
        className={`preview-entry preview-entry-editable ${isEditingEntry ? 'is-editing' : ''}`}
        data-entry-id={entry.id}
        data-preview-entry-anchor={anchorId}
        onPointerDown={event => {
          const target = event.target as HTMLElement | null;
          if (!target) return;
          if (target.closest('button,select,input,textarea,label,a,[contenteditable="true"]')) return;
          if (event.button !== 0 && event.pointerType !== 'touch') return;
          if (anchorId) onEditingEntryChange(anchorId);
        }}
      >
      <PreviewField hidden={isHidden('title')} fieldKey={fieldKey('title')} hiddenLabel="Tittel skjult" isEditingEntry={isEditingEntry} onFieldVisibilityChange={onFieldVisibilityChange}>
        <h4><EditableText value={text('title', entry.title)} onChange={value => onTextChange(`${entryOverrideKey}.title`, value)} editable={isEditingEntry} /></h4>
      </PreviewField>

      {useInlineMetadata && (subtitle || metadata) ? (
        <div className="preview-entry-inline-meta">
          {subtitle && (
            <PreviewField hidden={isHidden('subtitle')} fieldKey={fieldKey('subtitle')} hiddenLabel="Undertittel skjult" isEditingEntry={isEditingEntry} onFieldVisibilityChange={onFieldVisibilityChange}>
              <p><EditableText value={subtitle} onChange={value => onTextChange(`${entryOverrideKey}.subtitle`, value)} editable={isEditingEntry} /></p>
            </PreviewField>
          )}
          {metadata && (
            <PreviewField hidden={isHidden('period')} fieldKey={fieldKey('period')} hiddenLabel="Periode/sted skjult" isEditingEntry={isEditingEntry} onFieldVisibilityChange={onFieldVisibilityChange}>
              <p className="preview-entry-meta"><EditableText value={metadata} onChange={value => onTextChange(`${entryOverrideKey}.period`, value)} editable={isEditingEntry} /></p>
            </PreviewField>
          )}
        </div>
      ) : (
        <>
          {subtitle && (
            <PreviewField hidden={isHidden('subtitle')} fieldKey={fieldKey('subtitle')} hiddenLabel="Undertittel skjult" isEditingEntry={isEditingEntry} onFieldVisibilityChange={onFieldVisibilityChange}>
              <p><EditableText value={subtitle} onChange={value => onTextChange(`${entryOverrideKey}.subtitle`, value)} editable={isEditingEntry} /></p>
            </PreviewField>
          )}
          {metadata && (
            <PreviewField hidden={isHidden('period')} fieldKey={fieldKey('period')} hiddenLabel="Periode/sted skjult" isEditingEntry={isEditingEntry} onFieldVisibilityChange={onFieldVisibilityChange}>
              <p className="preview-entry-meta"><EditableText value={metadata} onChange={value => onTextChange(`${entryOverrideKey}.period`, value)} editable={isEditingEntry} /></p>
            </PreviewField>
          )}
        </>
      )}

      <div className="preview-description-editor">
        {isEditingEntry && variants.length > 0 && (
          <div className="preview-description-tabs" aria-label="Velg beskrivelsesversjon">
            {variants.map(variant => (
              <button
                type="button"
                className={`preview-description-tab ${variant.id === variantId ? 'is-active' : ''}`}
                onClick={() => onDescriptionVariantChange(descriptionVariantKey, variant.id, true)}
                key={variant.id}
              >
                {variant.label}
              </button>
            ))}
          </div>
        )}

        {(description || isEditingEntry) && (
          <PreviewField
            hidden={descriptionIsHidden}
            fieldKey={fieldKey('description')}
            hiddenLabel="Beskrivelse skjult"
            isEditingEntry={isEditingEntry}
            onFieldVisibilityChange={(key, hidden) => {
              onFieldVisibilityChange(key, hidden);
              if (hidden) onDescriptionVariantChange(descriptionVariantKey, '__none__');
              if (!hidden && variantId === '__none__') onDescriptionVariantChange(descriptionVariantKey, variants[0].id);
            }}
          >
            <p className="preview-entry-description">
              {!isEditingEntry && !hasDescriptionOverride && selectedVariant
                ? <RichTextLines lines={selectedVariant.lines} />
                : <EditableText value={description} onChange={value => onTextChange(descriptionOverrideKey, value)} multiline editable={isEditingEntry} />}
            </p>
          </PreviewField>
        )}
      </div>

      {entry.customFields?.map(field => field.value && (
        <PreviewField hidden={isHidden(`custom.${field.id}`)} fieldKey={fieldKey(`custom.${field.id}`)} hiddenLabel={`${field.label} skjult`} isEditingEntry={isEditingEntry} onFieldVisibilityChange={onFieldVisibilityChange} key={field.id}>
          <p className="preview-entry-custom">
            <strong>{field.label}: </strong>
            <EditableText value={text(`custom.${field.id}`, field.value)} onChange={value => onTextChange(`${entryOverrideKey}.custom.${field.id}`, value)} editable={isEditingEntry} />
          </p>
        </PreviewField>
      ))}

        {isEditingEntry && <div className="preview-entry-actions">
          <button className="preview-entry-done" type="button" onClick={() => onEditingEntryChange(null)}>Lagre</button>
          <button className="preview-entry-cancel" type="button" onClick={() => onEditingEntryChange(null)}>Avbryt</button>
        </div>}
      </article>
    </div>
  );
}

function PreviewField({ children, hidden, fieldKey, hiddenLabel, isEditingEntry, onFieldVisibilityChange }: { children: ReactNode; hidden: boolean; fieldKey: string; hiddenLabel: string; isEditingEntry: boolean; onFieldVisibilityChange: (key: string, hidden: boolean) => void }) {
  if (hidden && !isEditingEntry) return null;

  return (
    <div className={`preview-field ${hidden ? 'is-hidden' : ''}`}>
      {isEditingEntry && (
        <button className="preview-field-eye" type="button" onClick={() => onFieldVisibilityChange(fieldKey, !hidden)} title={hidden ? 'Vis felt' : 'Skjul felt'}>
          <Icon icon={hidden ? 'mdi:eye-off' : 'mdi:eye'} aria-hidden="true" />
        </button>
      )}
      {hidden ? <span className="preview-hidden-label">{hiddenLabel}</span> : children}
    </div>
  );
}

function EditableText({ value, onChange, multiline = false, className = '', editable = true }: { value: string; onChange: (value: string) => void; multiline?: boolean; className?: string; editable?: boolean }) {
  const [editing, setEditing] = useState(false);
  const editableRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!editing) return;
    const node = editableRef.current;
    if (!node) return;
    node.focus();
    const range = window.document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]);

  if (editing) {
    return (
      <span
        ref={editableRef}
        className={`preview-editable preview-editing-text ${className}`}
        contentEditable
        suppressContentEditableWarning
        onBlur={event => {
          onChange(event.currentTarget.innerText.replace(/\n$/, ''));
          setEditing(false);
        }}
        onKeyDown={event => {
          if (!multiline && event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
          }
        }}
      >
        {value}
      </span>
    );
  }

  return <span className={`preview-editable ${className} ${editable ? 'is-editable' : ''}`} onClick={() => editable && setEditing(true)} title={editable ? 'Klikk for å redigere' : undefined}><span>{value}</span></span>;
}

function Tab({ title, icon, showIcon = false, tabRef }: { title: string; icon?: string; showIcon?: boolean; tabRef?: React.Ref<HTMLDivElement> }) {
  return <div className="cv-tab" ref={tabRef}>{showIcon && icon && <Icon icon={icon} aria-hidden="true" />}<span>{title}</span></div>;
}

function linesToText(lines: CvEntry['lines']) {
  return lines.map(line => line.runs.map(run => run.text).join('')).join('\n');
}

function formatPeriod(entry: CvEntry) {
  if (!entry.startDate && !entry.endDate && !entry.isCurrent) return '';
  return [formatPeriodDate(entry.startDate), entry.isCurrent ? 'nå' : formatPeriodDate(entry.endDate)].filter(Boolean).join(' – ');
}

function formatPeriodDate(value?: string) {
  if (!value) return '';
  const [year, month] = value.split('-');
  return month ? `${month}.${year}` : year;
}

function getProfileContactRows(profile: CvDocument['profile']) {
  const stored = profile.personalDetails ?? [];
  const fixed = [
    { sourceKey: 'birthDate', value: profile.birthDate, icon: 'mdi:calendar' },
    { sourceKey: 'address', value: profile.address, icon: 'mdi:map-marker' },
    { sourceKey: 'phone', value: profile.phone, icon: 'mdi:phone' },
    { sourceKey: 'email', value: profile.email, icon: 'mdi:email' },
    { sourceKey: 'socialLabel', value: profile.socialLabel, icon: 'mdi:share-variant' }
  ].map(item => {
    const saved = stored.find(detail => detail.sourceKey === item.sourceKey);
    const savedUrl = saved?.url ?? profile.links?.[item.sourceKey] ?? (item.sourceKey === 'socialLabel' ? profile.socialUrl : '');
    return {
      id: item.sourceKey,
      value: saved?.value ?? item.value,
      icon: saved?.icon ?? item.icon,
      url: item.sourceKey === 'email' && profile.emailLinkEnabled ? `mailto:${saved?.value ?? item.value}` : savedUrl
    };
  });
  const representedSourceKeys = new Set(['fullName', 'title', 'organization', 'birthDate', 'address', 'phone', 'email', 'socialLabel']);
  const custom = stored
    .filter(detail => !detail.sourceKey || !representedSourceKeys.has(detail.sourceKey))
    .map(detail => ({ id: detail.id, value: detail.value, icon: detail.icon, url: detail.url }));

  return [...fixed, ...custom].filter(row => row.value.trim());
}

function photoImageStyle(profile: CvDocument['profile']) {
  const aspect = profile.photoAspect ?? 1;
  return {
    top: `calc(50% + ${profile.photoPositionY ?? 0}%)`,
    left: `calc(50% + ${profile.photoPositionX ?? 0}%)`,
    width: `${aspect >= 1 ? aspect * 100 : 100}%`,
    height: `${aspect >= 1 ? 100 : 100 / aspect}%`,
    transform: `translate(-50%, -50%) scale(${profile.photoScale ?? 1}) scaleX(${profile.photoFlipped ? -1 : 1})`
  };
}
