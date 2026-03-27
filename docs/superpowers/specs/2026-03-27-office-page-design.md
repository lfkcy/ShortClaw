# ShortClaw Office Page 设计文档

**日期：** 2026-03-27
**状态：** 设计阶段
**作者：** Claude

## 概述

在 ShortClaw 中添加一个 Office（办公室）页面，完整迁移 OpenClaw-bot-review 的 pixel-office 功能，实现动态同步代理活动和完整的编辑功能。

## 目标

1. 在 ShortClaw 左侧 Sidebar 添加 Office 入口
2. 创建独立的 `/office` 路由页面
3. 展示像素风格的办公室场景，实时显示代理活动
4. 支持办公室布局编辑（放置家具、修改地板等）
5. 通过 Electron IPC 从 Gateway 获取实时代理数据

## 设计决策

### 方案选择

**选定方案：直接迁移 + Electron IPC 数据桥接**

- 将 pixel-office 的所有代码和资源完整迁移到 ShortClaw
- 通过 Electron IPC 从主进程获取 Gateway 数据
- 布局数据存储在 ShortClaw 的用户数据目录

**理由：**
- 完全独立，不依赖外部服务
- 充分利用 Electron 的能力（文件系统、原生 API）
- 数据流清晰：Gateway → Main Process → Renderer
- 性能好，无跨域问题

### 功能范围

- ✅ 动态同步代理活动
- ✅ 完整的编辑功能
- ✅ 布局保存和加载
- ✅ 音效和背景音乐
- ✅ 多语言支持（中文/英文）
- ❌ Bug 系统（不迁移，减少复杂度）

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │  /office 页面                                       │ │
│  │  - Canvas 渲染引擎                                  │ │
│  │  - 编辑器工具栏                                     │ │
│  │  - 实时代理动画                                     │ │
│  └────────────────────────────────────────────────────┘ │
│                        ↕ IPC                            │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│                     Main Process                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │  IPC Handlers                                       │ │
│  │  - office:get-layout                                │ │
│  │  - office:save-layout                               │ │
│  │  - office:get-agents                                │ │
│  │  - office:get-contributions                         │ │
│  └────────────────────────────────────────────────────┘ │
│                        ↕                                │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Gateway API Client                                 │ │
│  │  - 获取代理列表和状态                               │ │
│  │  - 获取会话和活动数据                               │ │
│  └────────────────────────────────────────────────────┘ │
│                        ↕                                │
│  ┌────────────────────────────────────────────────────┐ │
│  │  File System                                        │ │
│  │  - 读写布局文件 (layout.json)                       │ │
│  │  - 存储在用户数据目录                               │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 数据流

1. **布局数据流**：用户数据目录 → Main Process → Renderer
2. **代理数据流**：Gateway → Main Process → Renderer
3. **保存操作流**：Renderer → Main Process → 文件系统

## 文件结构

### 需要迁移的文件

#### 1. 核心库文件（约 30 个文件）

```
src/lib/pixel-office/
├── types.ts                    # 类型定义
├── constants.ts                # 常量配置
├── engine/                     # 渲染引擎
│   ├── officeState.ts         # 办公室状态管理
│   ├── renderer.ts            # Canvas 渲染器
│   ├── gameLoop.ts            # 游戏循环
│   ├── characters.ts          # 角色动画
│   └── matrixEffect.ts        # 矩阵特效
├── editor/                     # 编辑器
│   ├── editorState.ts         # 编辑器状态
│   └── editorActions.ts       # 编辑操作
├── layout/                     # 布局管理
│   ├── layoutSerializer.ts    # 布局序列化
│   ├── furnitureCatalog.ts    # 家具目录
│   └── tileMap.ts             # 瓦片地图
├── sprites/                    # 精灵图
│   ├── spriteData.ts
│   ├── spriteCache.ts
│   ├── pngLoader.ts
│   ├── catSprites.ts
│   └── tilesetSprites.ts
├── bugs/                       # Bug 系统（可选）
│   ├── bugSystem.ts
│   ├── renderer.ts
│   └── types.ts
├── agentBridge.ts             # 代理数据桥接
├── notificationSound.ts       # 音效系统
├── colorize.ts
├── floorTiles.ts
└── wallTiles.ts
```

#### 2. 页面组件（3 个文件）

```
src/pages/Office/
├── index.tsx                   # 主页面
├── EditorToolbar.tsx          # 编辑工具栏
└── EditActionBar.tsx          # 编辑操作栏
```

#### 3. 静态资源

```
public/assets/pixel-office/
├── characters/                 # 角色精灵图（9 个 PNG）
│   ├── char_0.png
│   ├── char_1.png
│   └── ...
├── walls.png                   # 墙壁贴图
├── server.png                  # 服务器图标
├── server.gif                  # 服务器动画
├── coffee-machine.gif         # 咖啡机动画
└── pixel-adventure.mp3        # 背景音乐
```

#### 4. 主进程代码（新增）

```
electron/api/office.ts          # Office IPC handlers
```

## 关键实现细节

### 1. Sidebar 导航入口

在 `src/components/layout/Sidebar.tsx` 的 `navItems` 数组中添加：

```typescript
{
  to: '/office',
  icon: <Building className="h-[18px] w-[18px]" strokeWidth={2} />,
  label: t('sidebar.office'),
}
```

需要导入 `Building` 图标：
```typescript
import { Building } from 'lucide-react';
```

### 2. 路由配置

在 `src/App.tsx` 中添加路由：

```typescript
import { Office } from './pages/Office';

// 在 MainLayout 内部添加
<Route path="/office" element={<Office />} />
```

### 3. Gateway API 规范

ShortClaw 通过 Gateway RPC 与 OpenClaw 通信。Gateway 使用统一的 RPC 协议：

**协议格式：**
```typescript
// 请求
{
  module: string;    // 模块名，如 'agent', 'session'
  action: string;    // 操作名，如 'list', 'get'
  payload?: unknown; // 可选参数
}

// 响应
{
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; }
}
```

**Office 页面需要的 Gateway API：**

1. **获取代理列表**
   - Module: `agent`
   - Action: `list`
   - Payload: `{}`
   - Response: `{ agents: Array<{ id, name, status, ... }> }`

2. **获取会话列表**
   - Module: `session`
   - Action: `list`
   - Payload: `{}`
   - Response: `{ sessions: Array<{ key, agentId, lastActivity, ... }> }`

3. **获取代理活动统计**
   - Module: `agent`
   - Action: `getStats`
   - Payload: `{ agentId: string }`
   - Response: `{ messageCount, tokenUsage, lastActive }`

**Gateway 客户端调用方式：**
```typescript
// 在 Main Process 中
const result = await gatewayManager.rpc({
  module: 'agent',
  action: 'list',
  payload: {}
});
```

### 4. IPC 通信接口

#### Main Process 端点

**office:get-layout**
- 功能：获取办公室布局数据
- 返回：`{ layout: OfficeLayout | null }`
- 文件位置：`{userData}/pixel-office/layout.json`

**office:save-layout**
- 功能：保存办公室布局数据
- 参数：`{ layout: OfficeLayout }`
- 返回：`{ success: boolean }`

**office:get-agents**
- 功能：获取代理列表和状态
- 返回：`{ agents: AgentData[] }`
- 实现：调用 Gateway RPC `agent.list`

**office:get-contributions**
- 功能：获取代理贡献数据（用于热力图）
- 返回：`{ contributions: Record<string, number> }`
- 实现：调用 Gateway RPC `agent.getStats` 并聚合数据

#### Preload 脚本更新

在 `electron/preload/index.ts` 的 `validChannels` 数组中添加：

```typescript
// Office
'office:get-layout',
'office:save-layout',
'office:get-agents',
'office:get-contributions',
```

#### 数据类型定义

```typescript
interface AgentData {
  id: string;
  name: string;
  status: 'idle' | 'busy' | 'offline';
  activity?: string;
  lastActive?: number;
}

interface OfficeLayout {
  version: 1;
  tiles: TileData[];
  furniture: PlacedFurniture[];
  width: number;
  height: number;
}

// 默认布局
const DEFAULT_LAYOUT: OfficeLayout = {
  version: 1,
  width: 20,
  height: 15,
  tiles: [], // 空数组，将在运行时生成默认地板
  furniture: [
    // 默认放置一些基础家具
    { id: 'desk-1', type: 'desk', x: 5, y: 5, rotation: 0 },
    { id: 'chair-1', type: 'chair', x: 5, y: 6, rotation: 0 },
  ]
}
```

### 5. 数据适配层实现

在 `src/lib/pixel-office/agentBridge.ts` 中实现适配逻辑：

**核心功能：**
```typescript
// 轮询获取代理数据
export async function fetchAgentData(): Promise<AgentData[]> {
  const result = await window.electron.ipcRenderer.invoke('office:get-agents');
  return result.agents || [];
}

// 转换为 Character 对象
export function agentDataToCharacters(agents: AgentData[]): Character[] {
  return agents.map((agent, index) => ({
    id: agent.id,
    name: agent.name,
    state: mapAgentStatusToCharacterState(agent.status),
    variant: index % 9, // 循环使用 9 个角色精灵
    x: 0, y: 0, // 初始位置，由布局系统分配
    activity: agent.activity,
  }));
}

// 状态映射
function mapAgentStatusToCharacterState(status: string): CharacterState {
  switch (status) {
    case 'busy': return CharacterState.WORKING;
    case 'idle': return CharacterState.SITTING;
    case 'offline': return CharacterState.IDLE;
    default: return CharacterState.IDLE;
  }
}
```

**React Hook 接口：**
```typescript
export function useAgentData(pollingInterval = 5000) {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await fetchAgentData();
        if (!cancelled) setAgents(data);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      }
    }

    poll(); // 立即执行一次
    const timer = setInterval(poll, pollingInterval);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollingInterval]);

  return { agents, error };
}
```

### 6. 资源路径处理

**策略：使用 Vite 的 `?url` 导入**

在组件中导入静态资源：
```typescript
// 导入角色精灵图
import char0 from '@/assets/pixel-office/characters/char_0.png?url';
import char1 from '@/assets/pixel-office/characters/char_1.png?url';
// ... 其他资源

// 在代码中使用
const characterSprites = [char0, char1, char2, ...];
```

**资源加载示例：**
```typescript
// src/lib/pixel-office/sprites/pngLoader.ts
export async function loadCharacterPNGs(): Promise<HTMLImageElement[]> {
  const sprites = [
    await import('@/assets/pixel-office/characters/char_0.png?url'),
    await import('@/assets/pixel-office/characters/char_1.png?url'),
    // ... 其他 7 个
  ];

  return Promise.all(
    sprites.map(s => {
      const img = new Image();
      img.src = s.default;
      return new Promise<HTMLImageElement>((resolve) => {
        img.onload = () => resolve(img);
      });
    })
  );
}
```

**开发环境 vs 生产环境：**
- 开发环境：Vite dev server 提供资源
- 生产环境：资源打包到 `dist/renderer/assets/`，路径自动处理

### 6. 布局存储位置

- 原项目：`~/.openclaw/pixel-office/layout.json`
- 新项目：`{app.getPath('userData')}/pixel-office/layout.json`

### 7. 音频系统

**实现方式：**
- 使用浏览器原生 Audio API
- 音频文件通过 Vite 导入

**功能：**
```typescript
// src/lib/pixel-office/notificationSound.ts

// 背景音乐
export function playBackgroundMusic() {
  const audio = new Audio(bgMusicUrl);
  audio.loop = true;
  audio.volume = 0.3;
  audio.play();
}

// 音效
export function playDoneSound() {
  const audio = new Audio(doneSound);
  audio.volume = 0.5;
  audio.play();
}
```

**用户控制：**
- 提供音效开关按钮
- 音量控制滑块
- 设置保存到 localStorage

### 8. 贡献热力图说明

**数据来源：**
- 通过 `office:get-contributions` 获取每个代理的消息数量
- 格式：`{ "agent-1": 150, "agent-2": 80, ... }`

**视觉呈现：**
- 代理角色周围显示光晕效果
- 光晕颜色和大小根据贡献值变化
- 高贡献：大光晕，亮色
- 低贡献：小光晕，暗色

**实现：**
```typescript
function renderContributionHalo(
  ctx: CanvasRenderingContext2D,
  character: Character,
  contribution: number
) {
  const maxContribution = Math.max(...Object.values(contributions));
  const intensity = contribution / maxContribution;
  const radius = 20 + intensity * 30;

  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(255, 200, 0, ${intensity * 0.5})`);
  gradient.addColorStop(1, 'rgba(255, 200, 0, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
```

复用 ShortClaw 现有的 i18n 系统，添加翻译 key：

```json
{
  "sidebar": {
    "office": "办公室"
  },
  "office": {
    "title": "像素办公室",
    "editMode": "编辑模式",
    "viewMode": "查看模式",
    "save": "保存布局",
    "reset": "重置布局"
  }
}
```

## 现有架构参考

### ShortClaw 架构模式

Office 页面应遵循 ShortClaw 现有的架构模式：

**1. IPC 通信模式**
- 参考：`src/pages/Chat/index.tsx` 如何调用 IPC
- 模式：`window.electron.ipcRenderer.invoke(channel, args)`
- 错误处理：使用 try-catch 包裹，显示用户友好的错误提示

**2. 路由和导航**
- 参考：`src/pages/Settings/index.tsx` 的路由结构
- 使用 React Router 的 `<Route>` 组件
- 在 Sidebar 中使用 `<NavLink>` 组件

**3. 状态管理**
- 本地状态：使用 React `useState` 和 `useEffect`
- 不需要 Zustand store（Office 页面状态不需要全局共享）

**4. 样式**
- 使用 Tailwind CSS
- 遵循现有的设计系统（颜色、间距等）
- Canvas 使用内联样式

### 类型定义位置

**Office 相关类型：**
- 核心类型：`src/lib/pixel-office/types.ts`（从原项目迁移）
- IPC 接口类型：在使用处内联定义或在 `src/types/office.ts`

**示例：**
```typescript
// src/types/office.ts
export interface OfficeIpcApi {
  getLayout: () => Promise<{ layout: OfficeLayout | null }>;
  saveLayout: (layout: OfficeLayout) => Promise<{ success: boolean }>;
  getAgents: () => Promise<{ agents: AgentData[] }>;
  getContributions: () => Promise<{ contributions: Record<string, number> }>;
}
```

### 阶段 1：基础迁移
1. 复制 `lib/pixel-office/` 所有文件到 ShortClaw
2. 复制 `public/assets/pixel-office/` 静态资源
3. 调整导入路径和类型引用

### 阶段 2：主进程集成
4. 创建 `electron/api/office.ts` IPC handlers
5. 实现布局文件读写逻辑
6. 实现 Gateway 数据获取逻辑
7. 在 `electron/main/index.ts` 中注册 handlers

### 阶段 3：页面开发
8. 创建 `src/pages/Office/` 目录
9. 迁移页面组件（index.tsx, EditorToolbar.tsx, EditActionBar.tsx）
10. 适配 IPC 调用替代 API 调用
11. 适配资源路径

### 阶段 4：UI 集成
12. 在 Sidebar 添加 Office 导航入口
13. 在 App.tsx 添加路由配置
14. 添加国际化翻译

### 阶段 5：数据适配
15. 实现 agentBridge 适配逻辑
16. 测试代理数据同步
17. 调整动画和状态映射

### 阶段 6：测试和优化
18. 功能测试（编辑、保存、加载）
19. 性能优化（Canvas 渲染、数据轮询）
20. 边界情况处理

## 技术细节

### 性能优化

1. **Canvas 渲染**
   - 使用 `requestAnimationFrame` 控制帧率
   - 目标：60 FPS
   - 仅在有变化时重绘

2. **数据轮询**
   - 代理数据轮询间隔：5 秒
   - 仅在页面可见时轮询
   - 使用 `visibilitychange` 事件控制

3. **布局保存**
   - 防抖延迟：2 秒
   - 避免频繁写入文件系统

### 错误处理

1. **布局文件不存在**
   - 使用默认布局
   - 自动创建目录和文件

2. **Gateway 连接失败**
   - 显示离线状态
   - 提示用户检查 Gateway

3. **IPC 调用失败**
   - 捕获异常并显示错误提示
   - 记录日志便于调试

### 兼容性

- **平台**：macOS, Windows, Linux
- **Electron 版本**：40+
- **Node.js 版本**：18+

## 依赖项

无需添加新的 npm 依赖，所有功能使用现有依赖实现：
- Canvas API（浏览器原生）
- Electron IPC（已有）
- React（已有）
- Lucide React（已有，用于图标）

## 测试计划

### 功能测试

1. **导航测试**
   - ✓ 点击 Sidebar 的 Office 入口能正确跳转
   - ✓ 路由 `/office` 能正确渲染页面

2. **渲染测试**
   - ✓ Canvas 正确显示办公室场景
   - ✓ 角色动画流畅运行
   - ✓ 代理数据正确映射到角色

3. **编辑测试**
   - ✓ 能切换编辑模式
   - ✓ 能放置和移动家具
   - ✓ 能修改地板颜色
   - ✓ 能保存和加载布局

4. **数据同步测试**
   - ✓ 代理状态变化能实时反映
   - ✓ 新增代理能自动显示
   - ✓ 离线代理能正确处理

### 性能测试

1. **渲染性能**
   - 目标：60 FPS
   - 测试场景：10+ 个代理同时活动

2. **内存占用**
   - 监控长时间运行的内存泄漏
   - 确保资源正确释放

## 关键流程序列图

### 1. 页面初始加载流程

```
User → Sidebar: 点击 Office 入口
Sidebar → Router: 导航到 /office
Router → Office Page: 渲染组件
Office Page → IPC: invoke('office:get-layout')
IPC → Main Process: 处理请求
Main Process → File System: 读取 layout.json
File System → Main Process: 返回布局数据（或 null）
Main Process → IPC: 返回 { layout }
IPC → Office Page: 接收布局
Office Page → Office Page: 初始化 Canvas
Office Page → IPC: invoke('office:get-agents')
IPC → Main Process: 处理请求
Main Process → Gateway: RPC call (agent.list)
Gateway → Main Process: 返回代理列表
Main Process → IPC: 返回 { agents }
IPC → Office Page: 接收代理数据
Office Page → Canvas: 渲染办公室和角色
```

### 2. 布局保存流程

```
User → Editor: 编辑布局（放置家具等）
Editor → Office Page: 触发保存（防抖 2 秒）
Office Page → IPC: invoke('office:save-layout', { layout })
IPC → Main Process: 处理请求
Main Process → File System: 写入 layout.json
File System → Main Process: 确认写入成功
Main Process → IPC: 返回 { success: true }
IPC → Office Page: 显示保存成功提示
```

### 3. 实时代理状态更新流程

```
Office Page → Timer: 每 5 秒触发
Timer → Office Page: 执行轮询
Office Page → IPC: invoke('office:get-agents')
IPC → Main Process: 处理请求
Main Process → Gateway: RPC call (agent.list)
Gateway → Main Process: 返回最新代理状态
Main Process → IPC: 返回 { agents }
IPC → Office Page: 更新代理数据
Office Page → agentBridge: 转换为 Character 对象
agentBridge → Office Page: 返回 Character[]
Office Page → Canvas: 更新角色状态和动画
```

## 回滚策略

如果迁移过程中遇到问题需要回滚：

**1. 代码回滚**
```bash
# 回滚到迁移前的提交
git revert <commit-hash>
# 或者重置到迁移前
git reset --hard <commit-hash>
```

**2. 文件清理**
- 删除 `src/lib/pixel-office/` 目录
- 删除 `src/pages/Office/` 目录
- 删除 `public/assets/pixel-office/` 目录
- 删除 `electron/api/office.ts` 文件
- 从 `electron/preload/index.ts` 移除 office 相关的 IPC channels
- 从 `src/App.tsx` 移除 Office 路由
- 从 `Sidebar.tsx` 移除 Office 导航项

**3. 用户数据保留**
- 保留 `{userData}/pixel-office/layout.json`（用户的布局数据）
- 如果后续重新实现，可以复用

**4. 分阶段回滚**
- 如果只是某个功能有问题，可以只回滚该功能
- 例如：保留查看模式，回滚编辑功能

### 风险 1：迁移工作量大
- **影响**：开发时间可能超出预期
- **缓解**：分阶段实现，先实现核心功能

### 风险 2：性能问题
- **影响**：Canvas 渲染可能在低端设备上卡顿
- **缓解**：实现帧率控制和性能监控

### 风险 3：数据格式不兼容
- **影响**：Gateway 数据可能与 pixel-office 期望格式不匹配
- **缓解**：实现完善的适配层和类型检查

## 未来扩展

1. **实时协作**
   - 多用户同时查看同一个办公室
   - 显示其他用户的光标位置

2. **更多交互**
   - 点击角色查看代理详情
   - 点击家具触发特殊动画

3. **自定义主题**
   - 支持更多办公室风格
   - 自定义角色外观

4. **统计面板**
   - 显示代理活动统计
   - 生成活动报告

## 总结

本设计方案通过完整迁移 OpenClaw-bot-review 的 pixel-office 功能到 ShortClaw，实现了一个独立的、功能完整的办公室可视化页面。采用 Electron IPC 架构确保了数据流的清晰性和性能，同时保留了完整的编辑功能，为用户提供了良好的交互体验。
