import {toast} from 'sonner';

export async function copyText(text: string, label = 'Copié'): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast.success(label);
  } catch {
    toast.error('Copie impossible dans ce navigateur.');
  }
}
