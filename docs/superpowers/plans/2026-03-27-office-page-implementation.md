# ShortClaw Office Page 实现计划

**日期：** 2026-03-27
**基于规范：** docs/superpowers/specs/2026-03-27-office-page-design.md
**预计工作量：** 中等（约 30+ 文件迁移 + 适配）

## 概述

将 OpenClaw-bot-review 的 pixel-office 功能完整迁移到 ShortClaw，实现动态同步代理活动的像素风格办公室可视化页面，包含完整的编辑功能。

## 实施策略

采用**增量迁移**策略，分 6 个阶段逐步实现：
1. 基础迁移（库文件和资源）
2. 主进程集成（IPC handlers）
3. 页面开发（React 组件）
4. UI 集成（导航和路由）
5. 数据适配（agentBridge）
6. 测试和优化

每个阶段完成后进行验证，确保功能正常再进入下一阶段。

## 阶段 1：基础迁移

### 目标
复制 pixel-office 的核心库文件和静态资源到 ShortClaw 项目。

### 任务清单

#### 1.1 迁移核心库文件

**操作：** 从 OpenClaw-bot-review 复制以下目录到 ShortClaw

```bash
# 源路径：/Users/wenuts/code/claw-products/OpenClaw-bot-review/lib/pixel-office/
# 目标路径：/Users/wenuts/code/claw-products/ShortClaw/src/lib/pixel-office/

# 复制整个 pixel-office 目录（排除 bugs 系统）
cp -r OpenClaw-bot-review/lib/pixel-office ShortClaw/src/lib/
rm -rf ShortClaw/src/lib/pixel-office/bugs
```

**需要复制的文件：**
- `types.ts`, `constants.ts`
- `engine/` 目录（5 个文件）
- `editor/` 目录（2 个文件）
- `layout/` 目录（3 个文件）
- `sprites/` 目录（5 个文件）
- `agentBridge.ts`, `notificationSound.ts`, `colorize.ts`, `floorTiles.ts`, `wallTiles.ts`

**验证：** 确认所有文件已复制，目录结构正确

#### 1.2 迁移静态资源

**操作：** 复制图片和音频资源

```bash
# 复制资源目录
cp -r OpenClaw-bot-review/public/assets/pixel-office ShortClaw/public/assets/
```

**资源清单：**
- `characters/` - 9 个角色 PNG 文件
- `walls.png` - 墙壁贴图
- `server.png`, `server.gif` - 服务器图标
- `coffee-machine.gif` - 咖啡机动画
- `pixel-adventure.mp3` - 背景音乐

**验证：** 确认所有资源文件已复制

#### 1.3 调整导入路径

**操作：** 修复复制文件中的导入路径

**需要调整的模式：**
- `@/lib/pixel-office/` → 保持不变（ShortClaw 使用相同的别名）
- 相对导入 `../` → 检查并确保正确

**验证：** 运行 TypeScript 编译检查是否有导入错误

```bash
cd ShortClaw
pnpm typecheck
```

---

## 阶段 2：主进程集成

### 目标
在 Electron 主进程中实现 Office 相关的 IPC handlers。

### 任务清单

#### 2.1 创建 Office API 文件

**文件：** `electron/api/office.ts`

**实现内容：**
- 布局文件读写函数
- Gateway RPC 调用封装
- 4 个 IPC handler 函数

**关键代码结构：**
```typescript
import { app } from 'electron';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';

const OFFICE_DIR = join(app.getPath('userData'), 'pixel-office');
const LAYOUT_FILE = join(OFFICE_DIR, 'layout.json');

export async function handleOfficeGetLayout() { /* ... */ }
export async function handleOfficeSaveLayout(layout: unknown) { /* ... */ }
export async function handleOfficeGetAgents(ctx: HostApiContext) { /* ... */ }
export async function handleOfficeGetContributions(ctx: HostApiContext) { /* ... */ }
```

#### 2.2 注册 IPC handlers

**文件：** `electron/main/index.ts`

**操作：** 在主进程启动时注册 office IPC handlers

**验证：** 主进程启动无错误

#### 2.3 更新 Preload 脚本

**文件：** `electron/preload/index.ts`

**操作：** 在 `validChannels` 数组添加：
```typescript
'office:get-layout',
'office:save-layout',
'office:get-agents',
'office:get-contributions',
```

**验证：** Preload 脚本编译无错误

---

## 阶段 3：页面开发

### 目标
创建 Office 页面组件，迁移并适配 UI 代码。

### 任务清单

#### 3.1 创建页面目录结构

**操作：** 创建 Office 页面目录
```bash
mkdir -p src/pages/Office
```

#### 3.2 迁移主页面组件

**文件：** `src/pages/Office/index.tsx`

**源文件：** `OpenClaw-bot-review/app/pixel-office/page.tsx`

**需要适配：**
- 移除 Next.js 特定代码（`'use client'`）
- API 调用改为 IPC 调用
- 资源路径使用 Vite 导入

**关键修改：**
```typescript
// 原代码
const res = await fetch('/api/pixel-office/layout');

// 新代码
const res = await window.electron.ipcRenderer.invoke('office:get-layout');
```

#### 3.3 迁移工具栏组件

**文件：** `src/pages/Office/EditorToolbar.tsx`

**源文件：** `OpenClaw-bot-review/app/pixel-office/components/EditorToolbar.tsx`

**需要适配：**
- 使用 ShortClaw 的 i18n 系统
- 样式保持 Tailwind CSS

#### 3.4 迁移操作栏组件

**文件：** `src/pages/Office/EditActionBar.tsx`

**源文件：** `OpenClaw-bot-review/app/pixel-office/components/EditActionBar.tsx`

**验证：** 组件编译无错误

---

## 阶段 4：UI 集成

### 目标
将 Office 页面集成到 ShortClaw 的导航和路由系统。

### 任务清单

#### 4.1 添加路由配置

**文件：** `src/App.tsx`

**操作：**
1. 导入 Office 组件：`import { Office } from './pages/Office';`
2. 在 MainLayout 内添加路由：`<Route path="/office" element={<Office />} />`

#### 4.2 添加 Sidebar 导航入口

**文件：** `src/components/layout/Sidebar.tsx`

**操作：**
1. 导入图标：`import { Building } from 'lucide-react';`
2. 在 `navItems` 数组添加：
```typescript
{
  to: '/office',
  icon: <Building className="h-[18px] w-[18px]" strokeWidth={2} />,
  label: t('sidebar.office'),
}
```

#### 4.3 添加国际化翻译

**文件：** `src/i18n/locales/zh.json` 和 `en.json`

**添加内容：**
```json
{
  "sidebar": {
    "office": "办公室" // en: "Office"
  }
}
```

**验证：** 点击 Sidebar 的 Office 入口能正确跳转

---

## 阶段 5：数据适配

### 目标
实现 agentBridge 适配层，连接 Gateway 数据和 pixel-office 渲染。

### 任务清单

#### 5.1 适配 agentBridge

**文件：** `src/lib/pixel-office/agentBridge.ts`

**操作：** 修改数据获取方式
```typescript
// 原代码使用 fetch
const res = await fetch('/api/pixel-office/agents');

// 新代码使用 IPC
const res = await window.electron.ipcRenderer.invoke('office:get-agents');
```

#### 5.2 实现轮询逻辑

**在 Office 页面组件中实现：**
```typescript
useEffect(() => {
  const interval = setInterval(async () => {
    const data = await window.electron.ipcRenderer.invoke('office:get-agents');
    // 更新状态
  }, 5000);
  return () => clearInterval(interval);
}, []);
```

**验证：** 代理数据能正确显示和更新

---

## 阶段 6：测试和优化

### 目标
全面测试功能，修复 bug，优化性能。

### 任务清单

#### 6.1 功能测试
- [ ] 页面正常渲染
- [ ] Canvas 动画流畅
- [ ] 编辑模式切换正常
- [ ] 布局保存和加载正常
- [ ] 代理数据实时更新
- [ ] 音效和背景音乐正常

#### 6.2 性能优化
- [ ] 检查 FPS（目标 60）
- [ ] 优化轮询间隔
- [ ] 检查内存泄漏

#### 6.3 错误处理
- [ ] Gateway 离线时的提示
- [ ] 布局文件损坏的处理
- [ ] IPC 调用失败的提示

**验证：** 所有功能正常，无明显 bug

---

## 关键文件清单

### 新增文件
- `electron/api/office.ts` - IPC handlers
- `src/pages/Office/index.tsx` - 主页面
- `src/pages/Office/EditorToolbar.tsx` - 工具栏
- `src/pages/Office/EditActionBar.tsx` - 操作栏
- `src/lib/pixel-office/` - 整个目录（~25 个文件）
- `public/assets/pixel-office/` - 资源目录

### 修改文件
- `electron/preload/index.ts` - 添加 IPC channels
- `electron/main/index.ts` - 注册 handlers
- `src/App.tsx` - 添加路由
- `src/components/layout/Sidebar.tsx` - 添加导航
- `src/i18n/locales/*.json` - 添加翻译

---

## 验收标准

1. ✅ 能从 Sidebar 进入 Office 页面
2. ✅ 页面显示像素风格办公室场景
3. ✅ 代理角色实时显示和动画
4. ✅ 能切换编辑模式
5. ✅ 能编辑布局（放置家具、修改地板）
6. ✅ 布局能保存和加载
7. ✅ 音效和背景音乐正常播放
8. ✅ 中英文切换正常
9. ✅ 性能流畅（60 FPS）
10. ✅ 无明显 bug 和错误

---

## 风险和注意事项

1. **资源路径问题** - 确保 Vite 正确处理静态资源
2. **TypeScript 类型错误** - 迁移后可能有类型不匹配
3. **性能问题** - Canvas 渲染需要优化
4. **Gateway 连接** - 确保 Gateway 正常运行

---

## 预计时间

- 阶段 1：1-2 小时（文件复制和路径调整）
- 阶段 2：1-2 小时（IPC handlers 实现）
- 阶段 3：2-3 小时（页面组件适配）
- 阶段 4：30 分钟（UI 集成）
- 阶段 5：1-2 小时（数据适配）
- 阶段 6：1-2 小时（测试和优化）

**总计：** 约 7-12 小时

---

## 下一步

执行计划，按阶段逐步实现。每个阶段完成后进行验证，确保功能正常再进入下一阶段。

