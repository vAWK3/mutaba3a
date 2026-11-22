import { useRef, useState, type DragEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { RECEIPT_MIME_TYPES } from '../../data/receiptFileRules';
import { useReceiptFiles } from '../../data/useReceiptFiles';

/** The camera's own pick: a photo is a JPEG or a PNG (MUT-657). */
const PHOTO_TYPES = 'image/jpeg,image/png';

/**
 * Home's way in for receipts (MUT-657): a drop zone, Add receipt and, where the pointer is coarse (a phone or a
 * tablet), Take a photo. The zone hides on a phone, where nothing is dragged. Every file goes through the gallery's
 * own upload (`useReceiptFiles`): the same rules, messages and "added to To review".
 */
export function ReceiptDropZone({ profileId }: { profileId: string }) {
  const { t } = useLanguage();
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { onFiles, uploading } = useReceiptFiles(profileId);

  const take = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length > 0) void onFiles(files);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) void onFiles(files);
  };

  return (
    <>
      <div
        className={`hp-home-drop${over ? ' hp-home-drop-over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <strong>{t('hosted.home.add.dropTitle')}</strong>
        <span>{t('hosted.home.add.dropHint')}</span>
      </div>
      <input ref={pick} type="file" multiple accept={RECEIPT_MIME_TYPES.join(',')} hidden data-testid="home-receipt-input" onChange={(e) => take(e.target)} />
      <input ref={camera} type="file" accept={PHOTO_TYPES} capture="environment" hidden data-testid="home-photo-input" onChange={(e) => take(e.target)} />
      <div className="hp-home-add-row">
        <Button variant="primary" size="sm" onClick={() => pick.current?.click()} disabled={uploading}>
          {t(uploading ? 'hosted.receipts.uploading' : 'hosted.home.add.receipt')}
        </Button>
        <Button variant="secondary" size="sm" className="hp-home-photo" onClick={() => camera.current?.click()} disabled={uploading}>
          {t('hosted.home.add.photo')}
        </Button>
      </div>
    </>
  );
}
