// Kept free of React so the root (server) layout can inline it.

export const THEME_STORAGE_KEY = 'friday-theme';

/**
 * Runs inline in <head> before first paint so the page never flashes the wrong theme.
 * Dark is the default; "system" follows the OS.
 */
export const themeBootScript = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');var t=p==='light'?'light':p==='system'&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t}catch(e){}})()`;
