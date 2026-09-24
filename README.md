# dsh-md-preview

> Markdown preview, file tree and editing for the DeepSeek Harness sidebar.

DeepSeek Harness 的 Markdown 预览插件：记忆按钮旁边一个回形针，收集**工作区 + 技能目录**的 markdown 文件树；点开文档在右侧栏渲染，用 markdown-exit + Shiki 渲染、ColaMD 主题排版，可编辑、可看大纲、可看图表。

`lib/` 已随仓库提交，克隆后直接安装即可使用——只有你要改 `src/` 时才需要重新构建。要求 Node ≥ 20，以及一个 DSH 安装。

## 功能

| 能力 | 说明 |
|---|---|
| 回形针按钮 | 会话头部工具区，紧贴「记忆」按钮右侧；点开文件树，再点聚焦 |
| 文件树 | 两个来源：会话工作区（可写）+ 技能根目录（只读，按 `dsh-skill-filesystem` 的 rank 顺序）。只显示 markdown 文件与**含 markdown 的目录**；逐层懒加载 |
| 最近打开 | 按会话隔离，最多 8 条，存在 localStorage；从对话引用、树、文档内链接打开的都会进列表 |
| 预览 | 对话里点 `.md` 引用、内置 Files 树点 `.md`，都由本插件接管渲染 |
| 编辑 | 预览/编辑双态，CodeMirror 6（GFM）；`Ctrl/Cmd+S` 保存 |
| 冲突保护 | 保存带版本校验；文件被外部改过则拒绝写入，给「重新加载 / 强制覆盖」 |
| 自动刷新 | 打开中的文档 **3 秒**探测一次，外部（AI / 编辑器 / 命令）改完自动重渲染并保留滚动位置；正在编辑且有未保存内容时改为提示，不覆盖草稿 |
| 文件树刷新 | 只探测**工作区根**（新增/删除文件自动出现）；展开的子目录与技能根不轮询，用刷新按钮 |
| 大纲 | 从 markdown token 收集标题（不是正则扫源码），点击跳到对应标题 |
| 图表 | mermaid 代码块按需加载渲染；失败时保留源码并给出原因 |
| 数学公式 | `$…$` 行内、`$$…$$` 块级；解析用 `@mdit/plugin-tex`，渲染用按需加载的 KaTeX（MathML 输出，零 CSS 零字体） |
| 主题 | ColaMD 全部 12 套 + 自带的 VuePress 文档风主题（**浅色 + 深色两套**），切换立即生效（含 Shiki 代码配色），默认跟随宿主深浅色 |
| 字体 | 正文与标题用**霞鹜文楷**（LXGW WenKai），代码等宽用 **Cascadia Code + 微软雅黑**；两者都是主题变量（`--content-font` / `--code-font`），主题可各自覆盖 |
| 回到顶部 | VuePress 同款：右下角**圆形**按钮带**阅读进度环**，滚过 100px（VuePress 默认阈值）淡入上移，点击平滑回顶 |
| 面板形态 | 就是官方右栏 tab：停靠 / 浮窗 / 拖宽 / 多 tab 全部由宿主提供 |

## 安装

```powershell
# 必须在 DSH 完全退出时执行（会重建 profile 的 node_modules）
dsh plugin --profile desktop add link:<本仓库路径>
dsh plugin --profile web add link:<本仓库路径>   # 只在你也用 web profile 时才需要
```

装完重启 DSH。之后只改 client 半时，重新 `npm run build` + 刷新页面即可；改动 host 半或新增 bundle 需要重启。

## 开发

```powershell
npm install --cache .npm-cache   # 把 npm 缓存放进仓库内（.gitignore 已忽略）
npm run build                    # scripts/prepare-colamd.mjs + esbuild → lib/client.js
npm test                         # 两个套件，都必须跑（见下）
```

- `tests/smoke.mjs` — host 侧的路径围栏与路由围栏（在真实临时目录上跑）、版本探测、bundle 契约与体积预算。
- `tests/client-load.mjs` — 按宿主契约（`window.__ModuleLoader__` + jsdom + DSH 自带 React）**真实加载 `lib/client.js` 并调用注册到的组件**。这是唯一能抓到"插件装上了、界面却什么都没出现"的套件（JSX 文件漏 import React、注册的组件一渲染就抛错都属此类），纯字符串断言抓不到。它需要找得到 DSH 安装目录：找不到就直接失败而不是跳过，因为跳过的运行看起来和通过一样。

目录：

```
src/host/           host 半（node ESM，直接由 package.json main 引用，无需构建）
  index.js          /md-preview/api 路由、同源围栏、方法分发
  paths.js          根解析、路径围栏、读写、目录列举、版本探测
src/client/         client 半（esbuild 打成单文件 lib/client.js）
  index.jsx         三处注册：md tab 类型 / 树 tab 类型 / 头部按钮
  panel.jsx         预览面板与树面板
  tree.jsx          文件树（含最近打开）
  editor.jsx        CodeMirror 6 markdown 编辑器
  markdown.js       markdown-exit 渲染管线（anchor 插件 + 大纲收集 + 链接/图片处理）
  highlight.js      Shiki 按需高亮（core + JS 引擎 + 语言白名单；每主题一套调色板）
  math.js           KaTeX 按需加载与 MathML 渲染
  mermaid.js        mermaid 按需加载（从 host 的 asset 端点取）
  theme.js          ColaMD 主题切换与样式注入
  styles.js         面板样式（内联注入）
  api.js            与 host route 通信 + 变更轮询
  recent.js         最近打开列表
  address.js        文件路径 ↔ `dsh-resource://` 地址
  float.js          默认浮窗（调官方 `sidebarRight.float`）
  icons.jsx         内联 SVG 图标
vendor/colamd/      上游原样文件（不要手改）
vendor/extra/       本插件自带的主题（vuepress.css / vuepress-dark.css），构建期同等作用域化
templates/theme.css 新主题模板（照 docs/themes.md 填 12 个必填变量即可）
docs/themes.md      主题色标准：变量契约、规则、新增主题步骤
scripts/            build.mjs / prepare-colamd.mjs / theme-spec.mjs（契约单一来源）
tests/              smoke.mjs（host 围栏 + bundle 契约）/ client-load.mjs（真实加载 client bundle）
```

## 设计决策（为什么这么做）

- **自有 HTTP route，而不是官方 workspace-files remote**：官方服务没有写接口、`list` 限工作区内、`changes` 只转发已埋点操作（pwsh / 编辑器 / 子进程写的文件不报），而技能目录在工作区外。预览要覆盖这三种情况，所以自建 `/md-preview/api`（tree / read / write / stat / raw / asset），并自己承担同等强度的围栏：同源校验 + 路径必须落在工作区或技能根内（realpath 之后再验一次，拒 `..` 与符号链接逃逸），写入只允许工作区内的 markdown。
- **注册 tab 类型，而不是 documentPreviews 扩展点**：后者只读、正文是宿主喂的分页 content、变更只提示不刷新、加不了编辑。用 `sidebarRightTabs.register({ patterns: ['*.md'], priority: 'extension' })` 抢下 `.md`，整个 tab 正文归自己，刷新与编辑才能由本插件控制。
- **默认浮窗，不占会话宽度**：树与预览的面板在打开后立刻调官方 `ctx.sidebarRight.float(tabId)`。浮窗宿主是挂到 `document.body` 上的 `position: fixed; z-index: 60` 层（`data-sidebar-right-float-host`），**不参与任何布局列**；`rect` 刻意不传，用官方默认的层叠定位（每次开在上一块旁边而不是盖住它）。官方保证该调用幂等（"已浮动的 tab 会被忽略"），所以用户手动收回成停靠后不会被我们再抢一次。
- **watch 是无状态的**：客户端上报自己关心的路径，host 只 stat 它们并回版本号，客户端自己 diff。host 不留快照缓存、不做全树扫描；一次轮询只花几个 stat。
- **按需加载，而不是把依赖都塞进 bundle**（单文件契约下 bundle 就是下载量）：
  - 代码高亮：Shiki core + 纯 JS 引擎（oniguruma 会产出 `.wasm` 兄弟文件，单文件契约无法服务）+ 语言白名单动态 import。白名单外的语言**零加载**，直接出转义后的纯代码块。
  - 图表：mermaid **完全不进 bundle**，首次遇到图表才从 host 的 `asset` 端点取（同源、离线、无 CDN）。
  - 数学：同理不进 bundle。KaTeX 用 `output: 'mathml'`，因为 HTML 模式要带上 `katex.min.css` 与 20 个 woff2（254 KB），而单文件 bundle 无法附带兄弟字体文件；MathML 由浏览器原生排版，这套依赖直接消失。TeX 的**定界符解析**仍在 bundle 里（`@mdit/plugin-tex`，约 5 KB），它负责 `$5` 这类边界判断。
  - 图标：内联 SVG，不引图标库。
  - 实测：`client.js` = **1.77 MB**（gzip ≈ 372 KB）。语言语法与 12 套高亮调色板是最大头（语言曾因含 C++ 与 JSX/TSX 语法到 2.72 MB，白名单里已剔除）。
- **不复用 `markdown-exit-mermaid`**：它 `import node:fs`（浏览器 bundle 跑不了）、默认从 jsDelivr 取库、且把 `<script>` 注入 HTML —— React 的 `innerHTML` 不会执行 script。三个问题都绕不开，所以自己写 30 行 fence 规则 + 40 行按需加载。
- **TOC 用现成 anchor 插件 + 一小段 core 规则**：markdown-exit 生态没有 toc 包，`@mdit/plugin-anchor` 负责稳定且去重的 heading id，大纲数据用一条 core 规则从 token 收集（侧栏要的是结构化数据，不是拼好的 HTML）。
- **不手搓解析**：表格 / 删除线 / 链接由 markdown-exit 内置；`html: false` 让原文 HTML 以字面文本呈现；链接与图片各过一遍协议白名单，相对图片重写到 host 的 raw 端点。
- **JSX 走 automatic runtime**：`scripts/build.mjs` 设 `jsx: 'automatic'`，由 esbuild 自己发出 `react/jsx-runtime` 引用。classic 工厂（`jsxFactory: 'React.createElement'`）下漏写 `import React` 既不报构建错也不报求值错，只在渲染时抛 `React is not defined` —— 表现就是"插件装好了但界面里什么都没有"，极难查。
- **主题不污染宿主**：ColaMD 的 `#editor .ProseMirror` / `body.theme-*` / `:root` 在构建期被重写成 `.mdp-md` / `.mdp-md.theme-*`（`scripts/prepare-colamd.mjs`，附断言：残留未作用域选择器、残留 `@media print` 都会让构建失败）；主题切换是我们容器上的一个 class，宿主 shell 永不受影响。
- **自带主题放 `vendor/extra/`，不混进 `vendor/colamd/`**：上游目录要求字节级一致，重同步会覆盖任何本地改动，所以自己写的主题（`vuepress.css` + `vuepress-dark.css`）单独成目录，由同一个脚本按**完全相同的规则**作用域化与断言 —— 手写主题不是二等公民，上游升级也不会把它冲掉。VuePress 那两套照官方默认主题的视觉语言写：浅色是品牌绿 `#3eaf7c`、正文 `#2c3e50`、发丝线 `#eaecef`；深色是它暗色面的 `#25272a` 底 + `#adbac7` 正文 + `#3a3f44` 线，品牌绿提亮成 `#4abf8a`。两套都保留 h2 下划线、系统无衬线栈与 `#282c34` 深色代码板（配色交给 Shiki 的 `one-dark-pro`，底色正是 `#282c34`，两套共用**同一份**调色板，不额外增加下载量），深色那套还带 `color-scheme: dark`。**按现有约定它们是一个主题 id 一套调色板**（ColaMD 的「浅色/深色」同理），所以在主题菜单里是两项「VuePress / VuePress 深色」；想让预览自动跟着宿主变，把偏好设成 `auto`。
- **回到顶部照 VuePress 的按钮做，但不跟它一样去用主题色**：形态与行为对齐官方规格（圆形、滚动进度环、100px 出现阈值、平滑回顶，阈值与进度都能在测试里断言），但颜色用宿主的语义变量 + `currentColor`，**不是**主题变量 —— 按钮是文档容器的**兄弟**而不是后代，主题变量定义在容器上，兄弟继承不到，用了就会在深色主题下掉回白色兜底（这个坑当场被探针抓出来，并加了断言钉住）。按钮本身仍是面板内绝对定位（`position: fixed` 会跑到浮窗外）。
- **主题色只走变量，容器布局由插件独占**（`docs/themes.md` 是标准）：文档容器同时扮演上游的 `body` 和 `.ProseMirror`，于是两条按"占满整个视口"假设写的规则会漏进来 —— `.ProseMirror` 的 `max-width: 780px` + `margin: 0 auto` 会把**画主题背景的那个元素自己**缩成居中的一列（面板更宽时主题色只铺中间一条、两侧露宿主底色，14 套主题全中），`#editor` 的 `height: calc(100vh - 40px)` 与 `body` 的 `height: 100%` + `overflow: hidden` 同源。插件用一档更高特异性的 `.mdp-root .mdp-md`（flex 撑满 + 自己滚动 + `max-width: none; margin: 0`）压住它们，主题因此**只负责配色与排版、不写布局**；滚动容器就是这里，`scrollTop` 也才有意义（回到顶部、刷新后保留位置都读它）。
- **主题契约是机器可读的单一来源**：`scripts/theme-spec.mjs` 列出 12 个必填变量（今天 14 套主题全都有、上游 base/premium 真的会消费）与 5 个可选项（其中 3 个各有坑：`--code-block-text` 有 fallback、`--blockquote-bg` 无 fallback、`--table-border` 上游根本不消费，设了必须自带元素规则；另外两个是字体 `--content-font` / `--code-font`，不写就用插件的默认值）。构建对 `vendor/extra/` 的主题缺变量直接失败、对上游只报告（上游文件不能改）；测试再对生成产物核一遍，并检查 `templates/theme.css` 自身是完整的，免得复制模板起步就编译不过。

## 升级

- **ColaMD 主题**：把 `vendor/colamd/` 换成上游新版本（`base.css`、`premium.css`、`themes/*.css`、`LICENSE`，`upstream.json` 记录 commit），再 `npm run build`。选择器重写与主题清单由脚本推导，新增主题文件即自动出现在主题菜单里（中文名在 `scripts/prepare-colamd.mjs` 的 `THEME_LABELS` 里补一条，深色主题补进 `DARK_THEMES`）。
- **自带主题**：按 `docs/themes.md` 走 —— 复制 `templates/theme.css` 到 `vendor/extra/<id>.css`，填 12 个必填变量（+ 需要的可选项），`THEME_LABELS` 补中文名、深色主题补进 `DARK_THEMES`，`src/client/highlight.js` 的 `SHIKI_BY_THEME` + `SHIKI_THEMES` 各补一行代码配色，然后 `npm run build`。构建会把它作用域化成 `.mdp-md.theme-<id>`、断言没有规则逃逸、并检查必填变量齐全；主题 id 与 ColaMD 重名会让构建失败（避免静默顶掉）。
- **高亮语言**：`src/client/highlight.js` 的 `LANGUAGES` 增删一行；每加一个语法约增 60–190 KB（gzip 后小得多）。
- **宿主 API 变动**：插件只依赖三类公开扩展点（`slots`、`sidebarRight`、`sidebarRightTabs`）+ `ctx.webServer`。服务探测不到时只 `console.warn` 并保持不注册，不会让 Web shell 启动失败。

## 已知限制

- 编辑只覆盖工作区内的 markdown（技能根只读，这是有意的：技能文件由宿主 watcher 管）。
- 单文件读取上限 4 MB、图片 16 MB；超大文件报错而不是截断。
- 文件树只按"是否含 markdown"过滤目录；不提供搜索、排序或忽略规则配置。
- 未纳入：任务列表、脚注、导出 HTML。
- 右栏与浮窗由宿主 dockkit 提供，本插件不自绘浮层，因此没有"记住浮窗坐标"这类自有状态。

## 许可

本项目 MIT。`vendor/colamd/` 下的样式文件来自 [marswaveai/ColaMD](https://github.com/marswaveai/ColaMD)（MIT, Copyright (c) 2026 marswave.ai），原样保留其 LICENSE；其余第三方依赖（markdown-exit、Shiki、CodeMirror、mermaid、@mdit/plugin-anchor）均为 MIT。
