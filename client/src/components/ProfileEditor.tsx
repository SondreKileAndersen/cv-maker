import { PersonalDetail, Profile, ProfilePhoto } from '../types';
import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePointerSort } from '../hooks/usePointerSort';
import { Icon } from '@iconify/react';

interface Props {
  profile: Profile;
  onChange: (profile: Profile) => void;
}

type PhotoDraft = ProfilePhoto;

const defaultFields: Array<[keyof Profile, string]> = [
  ['fullName', 'Navn'],
  ['birthDate', 'Fødselsdato'],
  ['address', 'Adresse'],
  ['phone', 'Telefon'],
  ['email', 'E-post'],
  ['title', 'Tittel'],
  ['organization', 'Organisasjon'],
  ['socialLabel', 'SoMe']
];

const fixedFields: Array<[keyof Profile, string]> = [
  ['fullName', 'Navn'],
  ['birthDate', 'Fødselsdato'],
  ['address', 'Adresse'],
  ['phone', 'Telefon'],
  ['email', 'E-post']
];

const fixedSourceKeys = new Set(fixedFields.map(([key]) => String(key)));

const iconOptions = [
  ['mdi:account', 'Person'], ['mdi:briefcase', 'Arbeid'], ['mdi:school', 'Utdanning'], ['mdi:map-marker', 'Adresse'],
  ['mdi:phone', 'Telefon'], ['mdi:email', 'E-post'], ['mdi:calendar', 'Dato'], ['mdi:web', 'Nettside'],
  ['mdi:linkedin', 'LinkedIn'], ['mdi:certificate', 'Sertifikat'], ['mdi:star-four-points', 'Ferdighet'], ['mdi:plus', 'Ingen symbol']
] as const;

export function ProfileEditor({ profile, onChange }: Props) {
  const [linkEditorId, setLinkEditorId] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft | null>(null);
  const [isPhotoDragging, setIsPhotoDragging] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const iconPickerRef = useRef<HTMLDivElement>(null);
  const linkEditorRef = useRef<HTMLDivElement>(null);
  const photoDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const profilePhotos: ProfilePhoto[] = profile.photos?.length ? profile.photos : profile.photoDataUrl ? [{
    id: 'legacy-photo',
    dataUrl: profile.photoDataUrl,
    scale: profile.photoScale ?? 1,
    positionX: profile.photoPositionX ?? 0,
    positionY: profile.photoPositionY ?? 0,
    flipped: Boolean(profile.photoFlipped),
    aspect: profile.photoAspect ?? 1
  }] : [];
  const activePhoto = profilePhotos.find(photo => photo.id === profile.activePhotoId) ?? profilePhotos[0];
  const storedDetails: PersonalDetail[] = profile.personalDetails ?? defaultFields.map(([key, type]) => ({
    id: String(key),
    type,
    value: String(profile[key] ?? ''),
    url: profile.links?.[String(key)] ?? (key === 'socialLabel' ? profile.socialUrl : ''),
    sourceKey: String(key)
  }));
  const fixedDetails: PersonalDetail[] = fixedFields.map(([key, type]) => {
    const sourceKey = String(key);
    const existing = storedDetails.find(detail => detail.sourceKey === sourceKey);
    return existing ? { ...existing, type, sourceKey } : {
      id: sourceKey,
      type,
      value: String(profile[key] ?? ''),
      url: profile.links?.[sourceKey] ?? '',
      sourceKey
    };
  });
  const details = [...fixedDetails, ...storedDetails.filter(detail => !detail.sourceKey || !fixedSourceKeys.has(detail.sourceKey))];

  useEffect(() => {
    if (!iconPickerId && !linkEditorId) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (iconPickerId && !iconPickerRef.current?.contains(target)) setIconPickerId(null);
      if (linkEditorId && !linkEditorRef.current?.contains(target)) {
        setLinkEditorId(null);
        setLinkDraft('');
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIconPickerId(null);
      setLinkEditorId(null);
      setLinkDraft('');
    };
    window.document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.document.removeEventListener('keydown', closeOnEscape);
    };
  }, [iconPickerId, linkEditorId]);

  async function onPhotoSelected(file?: File) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    const aspect = await imageAspect(dataUrl);
    setPhotoDraft({ id: crypto.randomUUID(), dataUrl, scale: 1, positionX: 0, positionY: 0, flipped: false, aspect });
    setPhotoEditorOpen(true);
  }

  function openPhotoEditor() {
    if (!activePhoto) return;
    setPhotoDraft(activePhoto);
    setPhotoEditorOpen(true);
  }

  function closePhotoEditor() {
    setIsPhotoDragging(false);
    photoDragRef.current = null;
    setPhotoEditorOpen(false);
    setPhotoDraft(null);
  }

  function savePhoto() {
    if (!photoDraft) return;
    const existing = profilePhotos.findIndex(photo => photo.id === photoDraft.id);
    const photos = existing >= 0
      ? profilePhotos.map(photo => photo.id === photoDraft.id ? photoDraft : photo)
      : [...profilePhotos, photoDraft];
    onChange({
      ...profile,
      photos,
      activePhotoId: photoDraft.id,
      photoDataUrl: photoDraft.dataUrl,
      photoScale: photoDraft.scale,
      photoPositionX: photoDraft.positionX,
      photoPositionY: photoDraft.positionY,
      photoFlipped: photoDraft.flipped,
      photoAspect: photoDraft.aspect
    });
    closePhotoEditor();
  }

  function selectPhoto(photo: ProfilePhoto) {
    onChange({
      ...profile,
      activePhotoId: photo.id,
      photoDataUrl: photo.dataUrl,
      photoScale: photo.scale,
      photoPositionX: photo.positionX,
      photoPositionY: photo.positionY,
      photoFlipped: photo.flipped,
      photoAspect: photo.aspect
    });
  }

  function startPhotoDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!photoDraft) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    photoDragRef.current = { pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startX: photoDraft.positionX, startY: photoDraft.positionY };
    setIsPhotoDragging(true);
  }

  function movePhotoDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = photoDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const factor = 100 / Math.min(bounds.width, bounds.height);
    setPhotoDraft(current => current ? constrainPhoto({
      ...current,
      positionX: drag.startX + (event.clientX - drag.startClientX) * factor,
      positionY: drag.startY + (event.clientY - drag.startClientY) * factor
    }) : current);
  }

  function endPhotoDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (photoDragRef.current?.pointerId !== event.pointerId) return;
    photoDragRef.current = null;
    setIsPhotoDragging(false);
  }

  function updateDetails(next: PersonalDetail[]) {
    const legacyUpdates: Record<string, string> = {};
    const links = { ...profile.links };
    for (const detail of next) {
      if (!detail.sourceKey) continue;
      legacyUpdates[detail.sourceKey] = detail.value;
      links[detail.sourceKey] = detail.url;
      if (detail.sourceKey === 'socialLabel') legacyUpdates.socialUrl = detail.url;
    }
    onChange({ ...profile, ...legacyUpdates, links, personalDetails: next });
  }

  function updateDetail(index: number, patch: Partial<PersonalDetail>) {
    const next = [...details];
    next[index] = { ...next[index], ...patch };
    updateDetails(next);
  }

  function removeDetail(index: number) {
    const removed = details[index];
    if (removed.sourceKey && fixedSourceKeys.has(removed.sourceKey)) return;
    const next = details.filter((_, currentIndex) => currentIndex !== index);
    if (removed.sourceKey) {
      onChange({ ...profile, [removed.sourceKey]: '', ...(removed.sourceKey === 'socialLabel' ? { socialUrl: '' } : {}), personalDetails: next });
      return;
    }
    updateDetails(next);
  }

  function addDetail() {
    updateDetails([...details, { id: crypto.randomUUID(), type: 'Ny informasjon', value: '', url: '' }]);
  }

  function openLinkEditor(detail: PersonalDetail) {
    setIconPickerId(null);
    setLinkDraft(detail.url);
    setLinkEditorId(detail.id);
  }

  function saveLink(index: number) {
    updateDetail(index, { url: linkDraft.trim() });
    setLinkEditorId(null);
  }

  function moveDetail(from: number, to: number) {
    if (from === to || to < 0 || to >= details.length) return;
    if ((details[from].sourceKey && fixedSourceKeys.has(details[from].sourceKey)) || (details[to].sourceKey && fixedSourceKeys.has(details[to].sourceKey))) return;
    const next = [...details];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    updateDetails(next);
  }

  const sortable = usePointerSort(details.map(detail => detail.id), moveDetail);

  return (
    <section className="panel" id="profile">
      <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={event => { void onPhotoSelected(event.target.files?.[0]); event.currentTarget.value = ''; }} />
      <div className="photo-box">
        {activePhoto ? <>
          <div className="profile-photo-preview" aria-label="Profilbilde">
            <img src={activePhoto.dataUrl} alt="Profil" style={photoImageStyle(activePhoto)} />
          </div>
          <button className="photo-edit-button" type="button" onClick={openPhotoEditor} aria-label="Rediger profilbilde"><Icon icon="mdi:pencil" /></button>
          <button className="photo-add-button" type="button" onClick={() => photoInputRef.current?.click()} aria-label="Legg til nytt profilbilde"><Icon icon="mdi:plus" /></button>
        </> : <button className="photo-empty-button" type="button" onClick={() => photoInputRef.current?.click()}>
          <Icon icon="mdi:account-outline" aria-hidden="true" />
          <span>Last opp bilde</span>
        </button>}
      </div>
      {profilePhotos.length > 1 && <div className="profile-photo-list" aria-label="Velg profilbilde">
        {profilePhotos.map(photo => <button className={`profile-photo-thumb ${photo.id === activePhoto?.id ? 'is-active' : ''}`} type="button" key={photo.id} onClick={() => selectPhoto(photo)} aria-label="Velg profilbilde"><img src={photo.dataUrl} alt="" style={photoImageStyle(photo)} /></button>)}
      </div>}
      <h2 className="master-section-heading"><Icon icon="mdi:account" aria-hidden="true" />Personalia</h2>
      <div className="profile-grid">
        <div className="profile-rows">
          <div className="profile-row profile-row-head"><span /><span /><span>Beskrivelse</span><span>Ikon</span><span /><span /></div>
          {details.map((detail, index) => (
            <Fragment key={detail.id}>
            <div
              className={`profile-row ${sortable.draggingId === detail.id ? 'is-sorting' : ''}`}
              ref={sortable.getRowRef(detail.id)}
            >
              {detail.sourceKey && fixedSourceKeys.has(detail.sourceKey)
                ? <span className="detail-drag detail-drag-placeholder" aria-hidden="true" />
                : <button className="detail-drag" {...sortable.handleProps(detail.id)} aria-label={`Dra ${detail.type}`}>⋮⋮</button>}
              {detail.sourceKey && fixedSourceKeys.has(detail.sourceKey)
                ? <span className="profile-type">{detail.type}</span>
                : <input value={detail.type} placeholder="Type..." onChange={event => updateDetail(index, { type: event.target.value })} aria-label="Type" />}
              <input value={detail.value} placeholder={`${detail.type || 'Beskrivelse'}...`} onChange={event => updateDetail(index, { value: event.target.value })} aria-label="Visning" />
              <div className="detail-icon-picker" ref={iconPickerId === detail.id ? iconPickerRef : undefined}>
                <button className={`detail-icon ${detail.icon ? 'is-set' : ''}`} onClick={() => { setLinkEditorId(null); setIconPickerId(current => current === detail.id ? null : detail.id); }} aria-label={`Velg symbol for ${detail.type}`}>
                  <Icon icon={detail.icon ?? 'mdi:plus'} />
                </button>
                {iconPickerId === detail.id && (
                  <div className="detail-icon-popover">
                    {iconOptions.map(([icon, label]) => (
                      <button key={icon} onClick={() => { updateDetail(index, { icon: icon === 'mdi:plus' ? undefined : icon }); setIconPickerId(null); }} title={label} aria-label={label}>
                        <Icon icon={icon} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {detail.sourceKey && fixedSourceKeys.has(detail.sourceKey)
                ? detail.sourceKey === 'email'
                  ? <button className={`detail-link email-detail-link ${profile.emailLinkEnabled ? 'is-set' : ''}`} data-tooltip="Med denne aktiv, åpnes e-postprogrammet automatisk når brukeren klikker - Mottakeradressen fylles inn på forhånd." onClick={() => onChange({ ...profile, emailLinkEnabled: !profile.emailLinkEnabled })} aria-label="Slå e-postlenke av eller på"><span className="email-link-symbol" /></button>
                  : <span className="detail-url-placeholder" aria-hidden="true" />
                : <div className="detail-link-editor" ref={linkEditorId === detail.id ? linkEditorRef : undefined}>
                    <button className={`detail-link ${detail.url ? 'is-set' : ''}`} onClick={() => openLinkEditor(detail)} aria-label={`Rediger lenke for ${detail.type}`}><Icon icon="mdi:link-variant" /></button>
                    {linkEditorId === detail.id && (
                      <div className="detail-link-popover">
                        <label>Lenke / URL<input autoFocus value={linkDraft} placeholder="https://..." onChange={event => setLinkDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveLink(index); if (event.key === 'Escape') setLinkEditorId(null); }} /></label>
                        <div><button className="button primary" onClick={() => saveLink(index)}>Lagre</button><button className="button secondary" onClick={() => setLinkEditorId(null)}>Avbryt</button></div>
                      </div>
                    )}
                  </div>}
              {detail.sourceKey && fixedSourceKeys.has(detail.sourceKey)
                ? <span className="detail-delete detail-delete-placeholder" aria-hidden="true" />
                : <button className="detail-delete" onClick={() => removeDetail(index)} aria-label={`Slett ${detail.type}`}>×</button>}
            </div>
            {detail.sourceKey === 'email' && <div className="profile-group-divider" aria-hidden="true" />}
            </Fragment>
          ))}
          {!linkEditorId && <button className="add-detail" onClick={addDetail}>+ Legg til egendefinert rad</button>}
        </div>
      </div>
      {sortable.dragPreview && createPortal((() => {
        const detail = details.find(item => item.id === sortable.dragPreview?.id);
        return detail ? (
          <div className="profile-row detail-drag-preview" style={{ left: sortable.dragPreview.left, top: sortable.dragPreview.top, width: sortable.dragPreview.width, height: sortable.dragPreview.height }}>
            <span className="detail-drag">⋮⋮</span>
            <span className="drag-preview-value">{detail.type || 'Type'}</span>
            <span className="drag-preview-value">{detail.value || 'Visning'}</span>
            <span className="drag-preview-value">{detail.icon ? <Icon icon={detail.icon} /> : 'Symbol'}</span>
            <span className="drag-preview-value">{detail.url ? <Icon icon="mdi:link-variant" /> : 'Lenke'}</span>
            <span className="detail-delete">×</span>
          </div>
        ) : null;
      })(), document.body)}
      {photoEditorOpen && photoDraft && createPortal(
        <div className="photo-editor-backdrop" onMouseDown={closePhotoEditor}>
          <section className="photo-editor-modal" role="dialog" aria-modal="true" aria-label="Rediger profilbilde" onMouseDown={event => event.stopPropagation()}>
            <div className="photo-editor-stage">
              {isPhotoDragging && <img className="photo-editor-ghost" src={photoDraft.dataUrl} alt="" style={photoImageStyle(photoDraft)} draggable={false} />}
              <div
                className={`photo-editor-canvas ${isPhotoDragging ? 'is-dragging' : ''}`}
                onPointerDown={startPhotoDrag}
                onPointerMove={movePhotoDrag}
                onPointerUp={endPhotoDrag}
                onPointerCancel={endPhotoDrag}
              >
                <img src={photoDraft.dataUrl} alt="Forhåndsvisning av profilbilde" style={photoImageStyle(photoDraft)} draggable={false} />
              </div>
            </div>
            <div className="photo-editor-tools">
              <div className="photo-editor-top-tools">
                <button className={`photo-flip-button ${photoDraft.flipped ? 'is-active' : ''}`} type="button" onClick={() => setPhotoDraft(current => current ? { ...current, flipped: !current.flipped } : current)}><Icon icon="mdi:flip-horizontal" /><span>Flip</span></button>
                <button className="photo-replace-button" type="button" onClick={() => photoInputRef.current?.click()}>Erstatt bilde</button>
              </div>
              <label className="photo-zoom-control"><span>Zoom</span><input type="range" min="1" max="2.5" step="0.01" value={photoDraft.scale} onChange={event => setPhotoDraft(current => current ? constrainPhoto({ ...current, scale: Number(event.target.value) }) : current)} /></label>
            </div>
            <div className="photo-editor-actions">
              <button className="button primary" type="button" onClick={savePhoto}>Lagre</button>
              <button className="photo-cancel-button" type="button" onClick={closePhotoEditor}>Avbryt</button>
            </div>
          </section>
        </div>,
        document.body
      )}
    </section>
  );
}

function photoImageStyle(photo: Pick<PhotoDraft, 'scale' | 'positionX' | 'positionY' | 'flipped' | 'aspect'>) {
  const width = photo.aspect >= 1 ? photo.aspect * 100 : 100;
  const height = photo.aspect >= 1 ? 100 : 100 / photo.aspect;
  return {
    top: `calc(50% + ${photo.positionY}%)`,
    left: `calc(50% + ${photo.positionX}%)`,
    width: `${width}%`,
    height: `${height}%`,
    transform: `translate(-50%, -50%) scale(${photo.scale}) scaleX(${photo.flipped ? -1 : 1})`
  };
}

function constrainPhoto(photo: PhotoDraft): PhotoDraft {
  const baseWidth = Math.max(1, photo.aspect);
  const baseHeight = Math.max(1, 1 / photo.aspect);
  const maxX = Math.max(0, (baseWidth * photo.scale - 1) * 50);
  const maxY = Math.max(0, (baseHeight * photo.scale - 1) * 50);
  return { ...photo, positionX: clamp(photo.positionX, -maxX, maxX), positionY: clamp(photo.positionY, -maxY, maxY) };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function imageAspect(dataUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth / image.naturalHeight || 1);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
