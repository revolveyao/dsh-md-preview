/**
 * The colour contract every preview theme fills in — one source of truth.
 *
 * Used by the build (`scripts/prepare-colamd.mjs` refuses a theme maintained here
 * that skips a required variable, and reports the vendored ones that do) and by
 * the tests (which read the generated stylesheet the same way). The prose version
 * lives in `docs/themes.md`; keep the two in step by editing this file first.
 *
 * Why a contract is enough: every colour in the preview reaches the page through
 * a custom property on the container element. Verified against the generated
 * stylesheet — the container's own `background` is exactly `var(--bg-color)`, its
 * `color` is `var(--text-color)`, and the rest are consumed the same way, so
 * swapping these values is what a theme *is*. Nothing here is style-specific:
 * typography and per-element tweaks stay in the theme's stylesheet.
 */

/**
 * Required of every theme. All of these are defined by all 14 themes shipped
 * today and are consumed by the upstream base/premium stylesheets, so a theme
 * missing one silently inherits the previous theme's value — which looks like a
 * bug in the preview, not in the theme.
 */
export const REQUIRED = [
  { name: '--bg-color', use: '页面底色，容器 background' },
  { name: '--text-color', use: '正文颜色，容器 color' },
  { name: '--text-secondary', use: '次要文字（引用正文等）' },
  { name: '--text-muted', use: '更弱的提示文字' },
  { name: '--border-color', use: '分隔线、hr、h2 下划线' },
  { name: '--link-color', use: '链接' },
  { name: '--code-bg', use: '行内代码底色' },
  { name: '--code-block-bg', use: '代码块底色（Shiki 高亮时会内联覆盖）' },
  { name: '--blockquote-border', use: '引用左侧竖线' },
  { name: '--table-header-bg', use: '表头底色' },
  { name: '--selection-bg', use: '选中文字底色' },
  { name: '--highlight-bg', use: '高亮（mark）底色' },
]

/**
 * Optional, each with a caveat worth knowing before relying on it:
 * `--code-block-text` falls back to `--text-color` upstream; `--blockquote-bg`
 * is consumed by premium.css with no fallback; `--table-border` is consumed by
 * no upstream rule at all, so a theme that sets it must also write the element
 * rule that uses it.
 */
export const OPTIONAL = [
  { name: '--code-block-text', use: '代码块文字色；缺省回落 --text-color' },
  { name: '--blockquote-bg', use: '引用底色（premium.css 消费，无 fallback）' },
  { name: '--table-border', use: '表格网格线；上游不消费，需主题自带元素规则' },
  { name: '--content-font', use: '正文与标题字体栈；缺省用插件的霞鹜文楷栈' },
  { name: '--code-font', use: '代码字体栈；缺省用插件的 Cascadia Code + 微软雅黑栈' },
]

/** Required variable names, in declaration order. */
export const REQUIRED_NAMES = REQUIRED.map((entry) => entry.name)

/**
 * Which required variables a theme stylesheet does not declare.
 * @param source - the theme stylesheet's text.
 * @returns the missing variable names (empty when the theme is complete).
 */
export function missingVariables(source) {
  return REQUIRED_NAMES.filter((name) => !new RegExp(`${name}\\s*:`).test(source))
}
