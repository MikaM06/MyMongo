const stored = (() => {
  try {
    return localStorage.getItem('mymongo.theme');
  } catch {
    return null;
  }
})();
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const dark = stored ? stored === 'dark' : prefersDark;
document.documentElement.classList.toggle('dark', dark);
