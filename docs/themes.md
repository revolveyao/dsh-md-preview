# 主题色标准

预览主题的**唯一契约就是一组 CSS 变量**。参考别人的配色时，只需要把颜色值填进这组变量，不需要照着对方的样式表抄一遍结构——本文说明为什么这样够用，以及必须遵守的几条规则。

契约的机器可读版本是 `scripts/theme-spec.mjs`（构建与测试都读它），本文是同一份东西的说明；改契约先改那个文件。

## 为什么"只换变量"就够

三件事在代码里已经成立（都是实测确认过的，不是约定）：

1. **颜色只经变量到达页面。** 生成后的样式表里，主题容器自身的背景**只有**一条规则负责：`background: var(--bg-color)`，正文色是 `color: var(--text-color)`，表格/引用/代码/高亮同理。所以容器上这组变量的值 = 这套主题看起来的样子。
2. **主题之间互不干扰。** 每套主题的规则在构建期被作用域化成 `.mdp-md.theme-<id> …`，选择器特异性相同、靠顺序取胜，所以同一时刻只有当前主题那一份生效；启用 14 套主题也不会出现"后一套覆盖前一套"。
3. **不会污染宿主。** 同一次构建会断言"没有选择器逃出 `.mdp-md`"，逃逸即构建失败（历史上曾经把 DSH 桌面的布局改坏过）。主题因此不可能动到 shell 的任何样式。

## 必填变量（12 个）

所有主题都必须定义；上游的 base/premium 样式真的会消费它们，缺一个就会**静默沿用上一套主题的值**（看起来像预览的 bug，其实是主题不完整）。

| 变量 | 用途 |
|---|---|
| `--bg-color` | 页面底色，容器 background |
| `--text-color` | 正文颜色，容器 color |
| `--text-secondary` | 次要文字（引用正文等） |
| `--text-muted` | 更弱的提示文字 |
| `--border-color` | 分隔线、hr、h2 下划线 |
| `--link-color` | 链接 |
| `--code-bg` | 行内代码底色 |
| `--code-block-bg` | 代码块底色（Shiki 高亮时会内联覆盖） |
| `--blockquote-border` | 引用左侧竖线 |
| `--table-header-bg` | 表头底色 |
| `--selection-bg` | 选中文字底色 |
| `--highlight-bg` | 高亮（mark）底色 |

## 可选变量（5 个，各有坑）

| 变量 | 注意事项 |
|---|---|
| `--code-block-text` | 上游带 fallback（回落 `--text-color`），不写也不会坏 |
| `--blockquote-bg` | premium.css 消费它，**没有 fallback**：想用就必须写 |
| `--table-border` | **上游基础样式完全不消费**：主题必须自己写用到它的元素规则（表格边框），否则设了也没效果 |
| `--content-font` | 正文与标题字体栈；缺省用插件的默认值（霞鹜文楷 `LXGW WenKai`） |
| `--code-font` | 代码字体栈；缺省用插件的默认值（`Cascadia Code` + `Microsoft YaHei`） |

字体的默认值由插件定义（`src/client/styles.js` 里挂在容器上的两个自定义属性），而真正生效的 `font-family` 用**三档选择器**（`.mdp-root .mdp-doc .mdp-md`）压过一切硬编码 —— 上游把自己的字体栈写死在一档、主题写死在两档，所以预览的排版是统一的；主题想换字体就设这两个变量，别去写 `font-family`。

## 规则

1. **`vendor/colamd/` 只做上游字节级同步，永不手改。** 升级 = 换文件 + `npm run build`；手改会在下次同步时被覆盖。
2. **自带主题放 `vendor/extra/<id>.css`**，与上游同一套方言（变量挂 `:root`，元素微调挂 `#editor .ProseMirror …`），构建期同等对待、同等断言。id 与上游主题重名会让构建失败，避免静默顶掉。
3. **主题只管配色与排版，不写布局。** 容器的高度、宽度、内边距、滚动由插件固定（见下），主题写这些会跟面板打架。字体走 `--content-font` / `--code-font` 两个变量，不要直接写 `font-family`（写了也会被插件的三档规则压掉）。
4. **一套调色板 = 一个 id**（所以深浅色是两套文件、两个菜单项，和 ColaMD 的「浅色/深色」一致）。`auto` 走的是 ColaMD 的浅/深，不会自动切到本主题的深色版。

## 新增一套主题

1. 复制 `templates/theme.css` 到 `vendor/extra/<id>.css`，填 12 个必填变量（+ 需要的可选项），补排版微调。
2. `scripts/prepare-colamd.mjs`：`THEME_LABELS` 加显示名；深色主题加进 `DARK_THEMES`（它决定 Shiki 与 Mermaid 的深浅）。
3. `src/client/highlight.js`：`SHIKI_BY_THEME` 填这套主题用的 Shiki 调色板，并在 `SHIKI_THEMES` 里加对应的动态 import（多套主题可以共用同一份，共用不增加下载量）。
4. `npm run build`，再 `npm test`。构建会断言必填变量齐全、规则没有逃逸；测试会再核一遍生成产物。

## 构建期的保障

`npm run build` 会做这些检查，任何一条不成立都直接失败或报告：

- 每个选择器都必须落在 `.mdp-md` 里，否则报错并列出前几个逃逸选择器。
- 自带主题（`vendor/extra/`）缺必填变量 → **构建失败**。
- 上游主题缺必填变量 → 打印报告（上游文件不能改，所以不失败；今天 12 套都不缺）。
- 每套主题的规则都必须带 `.theme-<id>` 前缀，否则报错。
- 上游的 `*` 规则必须被作用域化、`@media print` 块必须被丢掉，否则报错。

## 容器事实（主题为什么不该碰布局）

面板的文档容器同时"扮演"上游的 `body` 和 `.ProseMirror`，所以两条只适合 ColaMD 自己编辑器的规则会漏进来，插件用 `.mdp-root .mdp-md` 一档压住它们：

- `.ProseMirror` 的 `max-width: 780px` + `margin: 0 auto`：会让**画主题背景的那个元素自己**只有 780px 宽并居中，面板更宽时主题色只铺中间一条、两侧露出宿主底色。
- `#editor` 的 `height: calc(100vh - 40px)`、以及 `body` 的 `height: 100%` + `overflow: hidden`：按"占满整个视口"假设，对面板不成立。

插件把容器定为「flex 撑满 + 自己滚动 + `max-width: none; margin: 0`」，主题只要不去动这些，背景就会铺满整个面板，滚动位置（回到顶部、刷新后保留位置）也才有意义。
