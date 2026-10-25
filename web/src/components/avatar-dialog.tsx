import {Shuffle, Upload} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {api, errorMessage} from '../lib/api';
import {type Avatar, useAuth} from '../lib/auth';
import {cn} from '../lib/cn';
import {GeneratedAvatar, randomSeed, UserAvatar} from './avatar';
import {Button} from './ui/button';
import {Modal} from './ui/dialog';
import {ErrorState} from './ui/empty-state';
import {Segmented} from './ui/segmented';

const OUTPUT_SIZE = 256;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;

function freshSeeds(count = 12): string[] {
  return Array.from({length: count}, randomSeed);
}

async function squareImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas indisponible dans ce navigateur.');
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE,
    );
    const webp = canvas.toDataURL('image/webp', 0.88);
    return webp.startsWith('data:image/webp')
      ? webp
      : canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AvatarDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {user, setAvatar} = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'generated' | 'custom'>('generated');
  const [seeds, setSeeds] = useState<string[]>(freshSeeds);
  const [seed, setSeed] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTab(user?.avatar.kind === 'custom' ? 'custom' : 'generated');
      setSeeds(freshSeeds());
      setSeed(user?.avatar.kind === 'generated' ? user.avatar.seed : null);
      setImage(null);
      setError(null);
    }
  }, [open, user?.avatar]);

  if (!user) {
    return null;
  }

  const pickFile = async (file: File) => {
    setError(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Format non pris en charge : PNG, JPEG ou WebP.');
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError('Image trop lourde (10 Mo maximum avant recadrage).');
      return;
    }
    try {
      const data = await squareImage(file);
      if ((data.length * 3) / 4 > MAX_OUTPUT_BYTES) {
        setError('Image trop lourde après recadrage.');
        return;
      }
      setImage(data);
    } catch (caught) {
      setError(`Image illisible : ${errorMessage(caught)}`);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result =
        tab === 'custom' && image
          ? await api<{avatar: Avatar}>('POST', '/auth/avatar/image', {
              data: image,
            })
          : await api<{avatar: Avatar}>('PUT', '/auth/avatar', {
              seed: seed ?? user.username,
            });
      setAvatar(result.avatar);
      toast.success('Photo de profil mise à jour');
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const result = await api<{avatar: Avatar}>('DELETE', '/auth/avatar');
      setAvatar(result.avatar);
      toast.success('Photo de profil réinitialisée');
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const canSave = tab === 'custom' ? Boolean(image) : Boolean(seed);
  const preview =
    tab === 'custom' ? (
      image ? (
        <img src={image} alt="" className="size-24 rounded-full object-cover" />
      ) : (
        <UserAvatar username={user.username} avatar={user.avatar} size={96} />
      )
    ) : (
      <GeneratedAvatar seed={seed ?? user.username} size={96} />
    );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Photo de profil"
      size="md"
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto"
            onClick={() => void reset()}
            disabled={saving}
          >
            Réinitialiser
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!canSave}
            onClick={() => void save()}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          {preview}
          <div className="space-y-2">
            <p className="text-[13px] font-medium">{user.username}</p>
            <Segmented
              label="Type de photo"
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                {value: 'generated', label: 'Générée'},
                {value: 'custom', label: 'Personnalisée'},
              ]}
            />
          </div>
        </div>

        {tab === 'generated' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                Choisissez une combinaison de formes et de couleurs.
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSeeds(freshSeeds())}
              >
                <Shuffle />
                Autres propositions
              </Button>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {seeds.map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSeed(item)}
                  aria-label="Choisir cet avatar"
                  aria-pressed={seed === item}
                  className={cn(
                    'flex cursor-pointer items-center justify-center rounded-full p-0.5 ring-2 transition-shadow',
                    seed === item
                      ? 'ring-primary'
                      : 'ring-transparent hover:ring-line-strong',
                  )}
                >
                  <GeneratedAvatar seed={item} size={44} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full cursor-pointer flex-col items-center gap-1.5 rounded border border-dashed border-line px-4 py-6 text-center hover:bg-hover"
            >
              <Upload className="size-5 text-faint" />
              <span className="text-[13px] text-muted">
                Choisir une image (PNG, JPEG ou WebP)
              </span>
              <span className="text-xs text-faint">
                Recadrée en carré 256 × 256 dans votre navigateur.
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) {
                  void pickFile(file);
                }
                event.target.value = '';
              }}
            />
          </div>
        )}
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Modal>
  );
}
