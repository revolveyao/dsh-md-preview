/**
 * ColaMD themes for the preview body.
 *
 * The stylesheet arrives as one generated string (see
 * scripts/prepare-colamd.mjs) and is injected once into <head>; the active theme
 * is a `theme-<id>` class on the document container, exactly the switch ColaMD
 * uses on its own <body>. Nothing here touches global selectors, so a ColaMD
 * theme can never repaint the DSH shell.
 *
 * `auto` follows the shell's own light/dark presentation: DSH marks dark mode
 * with `data-ds-dark-theme` on <body>, so the preview matches the app without
 * its own setting.
 */
import { useEffect, useState } from 'react'
import { CSS, THEMES } from './colamd.generated.js'

const STYLE_ID = 'dsh-md-preview-colamd'

/** localStorage key holding the chosen theme id (or `auto`). */
export const THEME_STORAGE_KEY = 'dsh-md-preview.theme'

/** The theme used when the shell is light / dark and the preference is `auto`. */
const AUTO_LIGHT = 'light'
const AUTO_DARK = 'dark'

/** Inject the generated stylesheet once per page. */
export function ensureThemeStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Whether the DSH shell currently presents its dark palette. */
function shellIsDark() {
  return typeof document !== 'undefined' && document.body?.hasAttribute('data-ds-dark-theme') === true
}

/** Track the shell's light/dark presentation. */
export function useShellDark() {
  const [dark, setDark] = useState(shellIsDark)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(shellIsDark()))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

function readPreference() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) ?? 'auto'
  } catch {
    return 'auto'
  }
}

/** The stored theme preference (`auto` or a theme id) and its setter. */
export function useThemePreference() {
  const [preference, setPreference] = useState(readPreference)
  const choose = (value) => {
    setPreference(value)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value)
    } catch {
      /* a blocked storage just means the choice is not remembered */
    }
  }
  return [preference, choose]
}

/** Resolve a preference against the shell's presentation to a theme id. */
export function resolveTheme(preference, dark) {
  if (preference !== 'auto' && THEMES.some((theme) => theme.id === preference)) return preference
  return dark ? AUTO_DARK : AUTO_LIGHT
}

/** Whether a theme id uses a dark palette (Shiki and Mermaid follow it). */
export function isDarkTheme(id) {
  return THEMES.find((theme) => theme.id === id)?.dark === true
}

export { THEMES }
