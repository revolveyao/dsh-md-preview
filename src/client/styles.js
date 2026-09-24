/**
 * Panel chrome styles.
 *
 * Injected at runtime because a plugin may not ship a sibling stylesheet.
 * Everything is scoped under `.mdp-` (the document body keeps ColaMD's own
 * `.mdp-md` scope) and coloured with DSH tokens, so the panel matches the shell
 * in both presentations; the few `--dsw-alias-*` names that are not defined in
 * every build carry a literal fallback.
 */

const STYLE_ID = 'dsh-md-preview-styles'

const CSS = `
.mdp-root { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.6; }
.mdp-root *, .mdp-root *::before, .mdp-root *::after { box-sizing: border-box; }

.mdp-toolbar { display: flex; align-items: center; gap: 2px; flex: none; padding: 3px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); }
.mdp-btn { width: 28px; height: 28px; flex: none; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.mdp-btn:hover:not(:disabled) { background: var(--dsw-alias-fill-l2, rgba(127,127,127,.14)); color: var(--dsw-alias-label-primary); }
.mdp-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-error-primary, #4a8cff); outline-offset: 1px; }
.mdp-btn:disabled { opacity: .45; cursor: default; }
.mdp-btn[aria-pressed="true"] { background: var(--dsw-alias-fill-l2, rgba(127,127,127,.14)); color: var(--dsw-alias-label-primary); }
.mdp-label { flex: 1; min-width: 0; padding: 0 4px; font-size: 12px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.mdp-spacer { flex: 1; min-width: 0; }

.mdp-dirty { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--dsw-alias-state-error-primary, #d14343); }
/* The marker that replaces a decision notice once it auto-hides. */
.mdp-btn-alert { color: var(--dsw-alias-state-error-primary, #d14343); }
.mdp-note { flex: none; padding: 6px 10px; font-size: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-fill-l2, rgba(127,127,127,.08)); display: flex; align-items: center; gap: 8px; }
.mdp-note-error { color: var(--dsw-alias-state-error-primary, #d14343); }
.mdp-note button { font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 6px; padding: 2px 8px; cursor: pointer; }

.mdp-body { flex: 1; min-height: 0; display: flex; }
.mdp-tree { flex: none; width: 260px; min-width: 0; overflow: auto; border-right: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); padding: 4px 0; }
.mdp-tree-collapsed { display: none; }
.mdp-group { padding: 6px 10px 2px; font-size: 11px; text-transform: none; color: var(--dsw-alias-label-tertiary); }
.mdp-row { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 26px; padding: 0 8px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; text-align: left; cursor: pointer; }
.mdp-row:hover { background: var(--dsw-alias-fill-l2, rgba(127,127,127,.12)); color: var(--dsw-alias-label-primary); }
.mdp-row[aria-selected="true"] { background: var(--dsw-alias-fill-l2, rgba(127,127,127,.16)); color: var(--dsw-alias-label-primary); }
.mdp-row-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mdp-twisty { width: 14px; height: 14px; flex: none; display: inline-flex; align-items: center; justify-content: center; transition: transform .12s; }
.mdp-twisty-open { transform: rotate(90deg); }
.mdp-twisty-empty { visibility: hidden; }
.mdp-tree-empty { padding: 8px 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

.mdp-doc { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
/* Back to top, in the shape VuePress's own button takes: a circle in the bottom
   right that fades and rises in 100px into the document (VuePress's threshold),
   with a progress ring around the arrow showing how far the reader has come.
   Hidden with opacity (not display) so it can animate, and taken out of
   hit-testing while hidden. It deliberately uses the host's own tokens rather
   than the theme's: those variables are declared on the document container, and
   this button is its sibling, so a themed colour could not reach it (a dark
   theme would have painted a white fallback). */
.mdp-top { position: absolute; right: 16px; bottom: 16px; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: var(--dsw-alias-fill-l2, rgba(127,127,127,.16)); color: var(--dsw-alias-label-secondary); cursor: pointer; box-shadow: var(--dsw-elevation-prominent, 0 4px 12px rgba(0,0,0,.16)); opacity: 0; transform: translateY(8px); pointer-events: none; transition: opacity .2s ease, transform .2s ease, background .2s ease, color .2s ease; }
.mdp-top[data-visible="true"] { opacity: 1; transform: translateY(0); pointer-events: auto; }
.mdp-top:hover { background: var(--dsw-alias-fill-l3, rgba(127,127,127,.26)); color: var(--dsw-alias-label-primary); }
.mdp-top:focus-visible { outline: 2px solid var(--dsw-alias-state-error-primary, #4a8cff); outline-offset: 1px; }
/* Two concentric SVG circles: a faint track and the progress arc. The arc starts
   at twelve o'clock because the svg itself is rotated a quarter turn, and its
   stroke-dashoffset is what the scroll handler drives. Both strokes are
   currentColor, so they follow the button's own colour and its hover state. */
.mdp-top-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.mdp-top-track, .mdp-top-progress { fill: none; stroke-width: 2; }
.mdp-top-track { stroke: color-mix(in srgb, currentColor 20%, transparent); }
.mdp-top-progress { stroke: currentColor; stroke-linecap: round; transition: stroke-dashoffset .1s linear; }
@media (prefers-reduced-motion: reduce) { .mdp-top, .mdp-top-progress { transition: none; } }
/* The outline is a column on the left of the body, not a strip above the
   document: it is read while scrolling, so it belongs beside the text. */
.mdp-outline { flex: none; width: 200px; min-width: 0; overflow: auto; padding: 4px 0; border-right: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); }
.mdp-outline-item { display: block; width: 100%; padding: 3px 10px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mdp-outline-item:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-fill-l2, rgba(127,127,127,.12)); }

.mdp-scroll { flex: 1; min-height: 0; overflow: auto; }
/* This container is upstream's body AND its .ProseMirror at once, so two rules
   leak in that only fit ColaMD's own app shell: .ProseMirror carries
   max-width: 780px + margin: 0 auto, which shrank the very element that paints
   the theme background down to a centred column (the page colour stopped at
   780px and the host showed through beside it), and #editor forces
   height: calc(100vh - 40px) as though it owned the viewport. This two-class
   selector outranks both: flex fills the box, it scrolls itself, and scrollTop
   stays meaningful for back-to-top and scroll retention. */
.mdp-root .mdp-md {
  flex: 1; min-height: 0; height: auto; max-width: none; margin: 0; overflow: auto;
  padding: 18px 22px 40px;
}
/* Typography defaults, declared the same way the colours are: as custom
   properties, so a theme can override either without touching these rules. The
   body face is LXGW WenKai (霞鹜文楷); code keeps a monospace Latin face and puts
   Microsoft YaHei behind it, so CJK inside a code block aligns with the Latin
   instead of falling back to whatever the system picks. */
.mdp-md {
  --content-font: 'LXGW WenKai', '霞鹜文楷', 'LXGW WenKai Screen', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif;
  --code-font: 'Cascadia Code', 'Microsoft YaHei', '微软雅黑', 'SF Mono', 'Fira Code', Menlo, Consolas, monospace;
}
/* Three classes, so these beat both the upstream hard-coded stacks (one class)
   and a theme's own font-family (two classes): the preview presents one
   typography, and a theme that wants different type sets the variables above. */
.mdp-root .mdp-doc .mdp-md { font-family: var(--content-font); }
.mdp-root .mdp-doc .mdp-md code, .mdp-root .mdp-doc .mdp-md pre, .mdp-root .mdp-doc .mdp-md kbd, .mdp-root .mdp-doc .mdp-md samp { font-family: var(--code-font); }
/* Inline code sits on the page's own background instead of upstream's
   --code-bg chip: only the typeface and its padding set it apart. The
   !important is there because the upstream rule is a two-class theme selector
   of equal weight, and this is a deliberate preference, not a fallback. Code
   blocks are untouched — they keep --code-block-bg. */
.mdp-root .mdp-md :not(pre) > code { background: transparent !important; }
.mdp-md img { max-width: 100%; height: auto; }
/* KaTeX runs in MathML-only mode, so the browser lays the formula out itself:
   no KaTeX stylesheet and no web fonts are involved. */
.mdp-md math[display="block"] { display: block; margin: 14px auto; overflow-x: auto; overflow-y: hidden; }
.mdp-md .mdp-math, .mdp-md .mdp-math-error { font-family: 'Cascadia Code', 'Microsoft YaHei', monospace; }
.mdp-md .mdp-math-error { color: var(--dsw-alias-state-error-primary, #d14343); }
.mdp-md .mdp-mermaid { margin: 12px 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); border-radius: 8px; overflow: auto; text-align: center; }
.mdp-md .mdp-mermaid svg { max-width: 100%; height: auto; }
.mdp-md .mdp-mermaid-error { margin-top: 6px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #d14343); }
.mdp-md .mdp-mermaid-source { margin: 0; text-align: left; }
.mdp-md .mdp-mermaid[data-mermaid-rendered="true"] .mdp-mermaid-source { display: none; }

.mdp-editor { flex: 1; min-height: 0; overflow: hidden; display: flex; }
.mdp-editor .cm-editor { flex: 1; min-width: 0; height: 100%; }
.mdp-editor .cm-scroller { font-family: 'Cascadia Code', 'Microsoft YaHei', monospace; font-size: 12.5px; line-height: 1.55; }
.mdp-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--dsw-alias-label-tertiary); text-align: center; }
.mdp-menu { position: absolute; z-index: 20; right: 6px; top: 32px; min-width: 150px; max-height: 320px; overflow: auto; padding: 4px; border-radius: 10px; background: var(--dsw-specific-menu, var(--dsw-alias-fill-l1, #fff)); box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.18)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); }
.mdp-menu-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; text-align: left; cursor: pointer; }
.mdp-menu-item:hover { background: var(--dsw-alias-fill-l2, rgba(127,127,127,.14)); color: var(--dsw-alias-label-primary); }
.mdp-menu-item[aria-current="true"] { color: var(--dsw-alias-label-primary); }

.mdp-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`

/** Inject the panel stylesheet once per page. */
export function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-md-preview'
  style.textContent = CSS
  document.head.appendChild(style)
}
